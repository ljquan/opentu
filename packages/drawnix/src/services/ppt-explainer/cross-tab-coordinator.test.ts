// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelPptExplainerTaskAcrossTabs,
  createPptExplainerCrossTabCoordinator,
  isPptExplainerTaskCancellationRecorded,
  resetPptExplainerCrossTabCoordinatorForTests,
  runPptExplainerTaskExclusive,
  type PptExplainerBroadcastChannelAdapter,
  type PptExplainerLockManagerAdapter,
} from './cross-tab-coordinator';

class FakeLockManager implements PptExplainerLockManagerAdapter {
  readonly requests: Array<{
    name: string;
    options: { mode: 'exclusive'; ifAvailable: true };
  }> = [];
  private readonly heldLocks = new Set<string>();

  async request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: { readonly name: string } | null) => T | PromiseLike<T>
  ): Promise<T> {
    this.requests.push({ name, options });
    if (this.heldLocks.has(name)) return await callback(null);
    this.heldLocks.add(name);
    try {
      return await callback({ name });
    } finally {
      this.heldLocks.delete(name);
    }
  }
}

class FakeBroadcastHub {
  private readonly channels = new Map<string, Set<FakeBroadcastChannel>>();
  createdCount = 0;
  closedCount = 0;

  create = (name: string): PptExplainerBroadcastChannelAdapter => {
    const channel = new FakeBroadcastChannel(this, name);
    const channels = this.channels.get(name) || new Set();
    channels.add(channel);
    this.channels.set(name, channels);
    this.createdCount += 1;
    return channel;
  };

  broadcast(sender: FakeBroadcastChannel, data: unknown): void {
    for (const channel of this.channels.get(sender.name) || []) {
      if (channel !== sender) channel.dispatch(data);
    }
  }

  remove(channel: FakeBroadcastChannel): void {
    const channels = this.channels.get(channel.name);
    if (!channels?.delete(channel)) return;
    this.closedCount += 1;
    if (channels.size === 0) this.channels.delete(channel.name);
  }

  get listenerCount(): number {
    let count = 0;
    for (const channels of this.channels.values()) {
      for (const channel of channels) count += channel.listenerCount;
    }
    return count;
  }
}

class FakeBroadcastChannel implements PptExplainerBroadcastChannelAdapter {
  private readonly listeners = new Set<(event: { data: unknown }) => void>();
  private closed = false;

  constructor(private readonly hub: FakeBroadcastHub, readonly name: string) {}

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('channel closed');
    this.hub.broadcast(this, message);
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: unknown }) => void
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: 'message',
    listener: (event: { data: unknown }) => void
  ): void {
    this.listeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.hub.remove(this);
  }

  dispatch(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const localStorageEntries = new Map<string, string>();
const memoryLocalStorage: Storage = {
  get length() {
    return localStorageEntries.size;
  },
  clear: () => localStorageEntries.clear(),
  getItem: (key) => localStorageEntries.get(key) ?? null,
  key: (index) => [...localStorageEntries.keys()][index] ?? null,
  removeItem: (key) => {
    localStorageEntries.delete(key);
  },
  setItem: (key, value) => {
    localStorageEntries.set(key, value);
  },
};

beforeEach(() => {
  memoryLocalStorage.clear();
  vi.stubGlobal('localStorage', memoryLocalStorage);
});

afterEach(() => {
  resetPptExplainerCrossTabCoordinatorForTests({
    lockManager: null,
    createBroadcastChannel: null,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PptExplainerCrossTabCoordinator', () => {
  it('uses a non-blocking exclusive Web Lock for the same task', async () => {
    const lockManager = new FakeLockManager();
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const firstCoordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });
    const secondCoordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });

    const firstRun = firstCoordinator.runExclusive('task-1', async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return 'first';
    });
    await firstStarted.promise;

    const secondResult = await secondCoordinator.runExclusive(
      'task-1',
      vi.fn()
    );
    expect(secondResult).toEqual({
      acquired: false,
      mechanism: 'web-locks',
    });
    expect(lockManager.requests).toHaveLength(2);
    expect(lockManager.requests[0]).toMatchObject({
      name: expect.stringContaining('task-1'),
      options: { mode: 'exclusive', ifAvailable: true },
    });

    releaseFirst.resolve();
    await expect(firstRun).resolves.toEqual({
      acquired: true,
      mechanism: 'web-locks',
      value: 'first',
    });
    firstCoordinator.dispose();
    secondCoordinator.dispose();
  });

  it('broadcasts cancellation to the lock-holding tab', async () => {
    const lockManager = new FakeLockManager();
    const broadcastHub = new FakeBroadcastHub();
    const holderStarted = deferred();
    const holder = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: broadcastHub.create,
    });
    const cancellingTab = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: broadcastHub.create,
    });

    const holderRun = holder.runExclusive('task-2', async (signal) => {
      holderStarted.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return { aborted: signal.aborted, reason: signal.reason };
    });
    await holderStarted.promise;

    cancellingTab.cancel('task-2');
    const result = await holderRun;
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.value.aborted).toBe(true);
      expect(result.value.reason).toMatchObject({ name: 'AbortError' });
    }
    expect(broadcastHub.listenerCount).toBe(0);
    expect(broadcastHub.closedCount).toBe(broadcastHub.createdCount);
    holder.dispose();
    cancellingTab.dispose();
  });

  it('records an incoming cancellation before aborting the active run', async () => {
    const broadcastHub = new FakeBroadcastHub();
    const holderStarted = deferred();
    const holder = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: broadcastHub.create,
    });
    const sender = broadcastHub.create(
      'opentu:ppt-explainer:v1:cancel:task-incoming'
    );

    const holderRun = holder.runExclusive('task-incoming', async (signal) => {
      holderStarted.resolve();
      return await new Promise<boolean>((resolve) => {
        signal.addEventListener(
          'abort',
          () =>
            resolve(isPptExplainerTaskCancellationRecorded('task-incoming')),
          { once: true }
        );
      });
    });
    await holderStarted.promise;

    sender.postMessage({
      schemaVersion: 1,
      type: 'ppt-explainer-cancel',
      taskId: 'task-incoming',
    });
    await expect(holderRun).resolves.toMatchObject({
      acquired: true,
      value: true,
    });
    sender.close();
    holder.dispose();
  });

  it('refuses a cancelled task before requesting its lock', async () => {
    const lockManager = new FakeLockManager();
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });
    const run = vi.fn();

    coordinator.cancel('task-before-lock');

    await expect(
      coordinator.runExclusive('task-before-lock', run)
    ).resolves.toEqual({ acquired: false, mechanism: 'web-locks' });
    expect(lockManager.requests).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('rechecks cancellation after acquiring its lock', async () => {
    let cancelWhileWaiting = () => undefined;
    const lockManager: PptExplainerLockManagerAdapter = {
      request: vi.fn(async (name, _options, callback) => {
        cancelWhileWaiting();
        return await callback({ name });
      }),
    };
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });
    cancelWhileWaiting = () => coordinator.cancel('task-after-lock');
    const run = vi.fn();

    await expect(
      coordinator.runExclusive('task-after-lock', run)
    ).resolves.toEqual({ acquired: false, mechanism: 'web-locks' });
    expect(run).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it('falls back to safe same-tab exclusion without Web Locks', async () => {
    const releaseFirst = deferred();
    const firstStarted = deferred();
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: null,
    });

    const firstRun = coordinator.runExclusive('task-3', async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return 1;
    });
    await firstStarted.promise;
    const duplicate = vi.fn();

    await expect(
      coordinator.runExclusive('task-3', duplicate)
    ).resolves.toEqual({ acquired: false, mechanism: 'local' });
    expect(duplicate).not.toHaveBeenCalled();

    releaseFirst.resolve();
    await expect(firstRun).resolves.toMatchObject({
      acquired: true,
      mechanism: 'local',
    });
    await expect(
      coordinator.runExclusive('task-3', async () => 2)
    ).resolves.toMatchObject({ acquired: true, value: 2 });
    coordinator.dispose();
  });

  it('serializes canvas delivery by board and task across coordinators', async () => {
    const lockManager = new FakeLockManager();
    const firstCoordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });
    const secondCoordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });
    const release = deferred();
    const started = deferred();

    const firstRun = firstCoordinator.runDeliveryExclusive(
      'board-1',
      'task-delivery',
      async () => {
        started.resolve();
        await release.promise;
        return 'first';
      }
    );
    await started.promise;

    await expect(
      secondCoordinator.runDeliveryExclusive('board-1', 'task-delivery', vi.fn())
    ).resolves.toEqual({ acquired: false, mechanism: 'web-locks' });

    release.resolve();
    await expect(firstRun).resolves.toMatchObject({
      acquired: true,
      value: 'first',
    });
    await expect(
      secondCoordinator.runDeliveryExclusive('board-1', 'task-delivery', async () => 'second')
    ).resolves.toMatchObject({ acquired: true, value: 'second' });
    expect(lockManager.requests[0]?.name).toContain(':delivery:');
    firstCoordinator.dispose();
    secondCoordinator.dispose();
  });

  it('releases a failed canvas delivery so another tab can retry', async () => {
    const lockManager = new FakeLockManager();
    const firstCoordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });
    const secondCoordinator = createPptExplainerCrossTabCoordinator({
      lockManager,
      createBroadcastChannel: null,
    });

    await expect(
      firstCoordinator.runDeliveryExclusive(
        'board-retry',
        'task-retry',
        async () => {
          throw new Error('canvas insert failed');
        }
      )
    ).rejects.toThrow('canvas insert failed');
    await expect(
      secondCoordinator.runDeliveryExclusive(
        'board-retry',
        'task-retry',
        async () => 'retried'
      )
    ).resolves.toMatchObject({ acquired: true, value: 'retried' });

    firstCoordinator.dispose();
    secondCoordinator.dispose();
  });

  it('still cancels the current tab when BroadcastChannel is unavailable', async () => {
    const started = deferred();
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: null,
    });
    const run = coordinator.runExclusive('task-4', async (signal) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            expect(isPptExplainerTaskCancellationRecorded('task-4')).toBe(true);
            resolve();
          },
          { once: true }
        );
      });
      return signal.reason;
    });
    await started.promise;

    coordinator.cancel('task-4');
    const result = await run;
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.value).toMatchObject({ name: 'AbortError' });
    }
    coordinator.dispose();
  });

  it('persists cancellation when BroadcastChannel is unavailable', async () => {
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: null,
    });
    coordinator.cancel('task-persisted');

    vi.resetModules();
    const freshModule = await import('./cross-tab-coordinator');
    const run = vi.fn();
    expect(
      freshModule.isPptExplainerTaskCancellationRecorded('task-persisted')
    ).toBe(true);
    await expect(
      freshModule.runPptExplainerTaskExclusive('task-persisted', run)
    ).resolves.toEqual({ acquired: false, mechanism: 'local' });
    expect(run).not.toHaveBeenCalled();

    freshModule.resetPptExplainerCrossTabCoordinatorForTests({
      lockManager: null,
      createBroadcastChannel: null,
    });
    coordinator.dispose();
  });

  it('keeps the newest tombstones with identical expirations and expires stale cancellations', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: null,
    });

    for (let index = 0; index < 300; index += 1) {
      coordinator.cancel(`task-bounded-${index}`);
    }

    const storageKey = 'opentu:ppt-explainer:v1:cancel-tombstones';
    const persisted = JSON.parse(
      localStorage.getItem(storageKey) || '{}'
    ) as Record<string, number>;
    expect(Object.keys(persisted)).toHaveLength(256);
    expect(new Set(Object.values(persisted)).size).toBe(1);
    expect(persisted['task-bounded-299']).toBeDefined();
    expect(persisted['task-bounded-0']).toBeUndefined();

    vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'));
    expect(isPptExplainerTaskCancellationRecorded('task-bounded-299')).toBe(
      false
    );
    expect(localStorage.getItem(storageKey)).toBeNull();
    coordinator.dispose();
  });

  it('falls back to bounded memory when localStorage is unavailable', () => {
    vi.spyOn(memoryLocalStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(memoryLocalStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(memoryLocalStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: null,
    });

    expect(() => coordinator.cancel('task-memory-only')).not.toThrow();
    expect(isPptExplainerTaskCancellationRecorded('task-memory-only')).toBe(
      true
    );
    expect(isPptExplainerTaskCancellationRecorded('task-never-cancelled')).toBe(
      false
    );
    coordinator.dispose();
  });

  it('closes a partially initialized channel and continues locally', async () => {
    const close = vi.fn();
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: () => ({
        postMessage: vi.fn(),
        addEventListener: vi.fn(() => {
          throw new Error('messages unavailable');
        }),
        removeEventListener: vi.fn(),
        close,
      }),
    });

    await expect(
      coordinator.runExclusive(
        'task-channel-error',
        async (signal) => signal.aborted
      )
    ).resolves.toEqual({
      acquired: true,
      mechanism: 'local',
      value: false,
    });
    expect(close).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it('falls back locally only when Web Locks fails before invoking the run', async () => {
    const failingLockManager: PptExplainerLockManagerAdapter = {
      request: vi.fn(async () => {
        throw new Error('Web Locks unavailable');
      }),
    };
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: failingLockManager,
      createBroadcastChannel: null,
    });

    await expect(
      coordinator.runExclusive('task-5', async () => 'fallback')
    ).resolves.toEqual({
      acquired: true,
      mechanism: 'local',
      value: 'fallback',
    });

    const callbackError = new Error('run failed');
    const callbackLockManager = new FakeLockManager();
    const callbackCoordinator = createPptExplainerCrossTabCoordinator({
      lockManager: callbackLockManager,
      createBroadcastChannel: null,
    });
    const run = vi.fn(async () => {
      throw callbackError;
    });
    await expect(callbackCoordinator.runExclusive('task-5', run)).rejects.toBe(
      callbackError
    );
    expect(run).toHaveBeenCalledTimes(1);
    coordinator.dispose();
    callbackCoordinator.dispose();
  });

  it('disposes listeners and aborts an active run', async () => {
    const broadcastHub = new FakeBroadcastHub();
    const started = deferred();
    const coordinator = createPptExplainerCrossTabCoordinator({
      lockManager: null,
      createBroadcastChannel: broadcastHub.create,
    });
    const run = coordinator.runExclusive('task-6', async (signal) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return signal.aborted;
    });
    await started.promise;

    coordinator.dispose();
    await expect(run).resolves.toMatchObject({ acquired: true, value: true });
    expect(broadcastHub.listenerCount).toBe(0);
    expect(broadcastHub.closedCount).toBe(broadcastHub.createdCount);
    await expect(
      coordinator.runExclusive('task-6', async () => undefined)
    ).rejects.toThrow('协调器已释放');
  });

  it('resets the default coordinator for isolated tests', async () => {
    resetPptExplainerCrossTabCoordinatorForTests({
      lockManager: null,
      createBroadcastChannel: null,
    });
    const started = deferred();
    const run = runPptExplainerTaskExclusive('task-7', async (signal) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return signal.aborted;
    });
    await started.promise;

    cancelPptExplainerTaskAcrossTabs('task-7');
    await expect(run).resolves.toMatchObject({ acquired: true, value: true });

    resetPptExplainerCrossTabCoordinatorForTests({
      lockManager: null,
      createBroadcastChannel: null,
    });
    expect(isPptExplainerTaskCancellationRecorded('task-7')).toBe(false);
  });
});
