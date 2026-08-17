const COORDINATION_NAMESPACE = 'opentu:ppt-explainer:v1';
const CANCEL_MESSAGE_TYPE = 'ppt-explainer-cancel';
const CANCEL_TOMBSTONE_STORAGE_KEY = `${COORDINATION_NAMESPACE}:cancel-tombstones`;
const CANCEL_TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CANCEL_TOMBSTONES = 256;
const MAX_CANCEL_TOMBSTONE_STORAGE_LENGTH = 64 * 1024;

const cancelledTaskIds = new Set<string>();
const cancelTombstoneExpirations = new Map<string, number>();

interface CoordinatorLock {
  readonly name: string;
}

export interface PptExplainerLockManagerAdapter {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: CoordinatorLock | null) => T | PromiseLike<T>
  ): Promise<T>;
}

export interface PptExplainerBroadcastChannelAdapter {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: { data: unknown }) => void
  ): void;
  close(): void;
}

export interface PptExplainerCrossTabCoordinatorOptions {
  /** `undefined` detects the browser API; `null` explicitly disables it. */
  lockManager?: PptExplainerLockManagerAdapter | null;
  /** `undefined` detects the browser API; `null` explicitly disables it. */
  createBroadcastChannel?:
    | ((name: string) => PptExplainerBroadcastChannelAdapter)
    | null;
}

export type PptExplainerCoordinationMechanism = 'web-locks' | 'local';

export type PptExplainerExclusiveRunResult<T> =
  | {
      acquired: true;
      mechanism: PptExplainerCoordinationMechanism;
      value: T;
    }
  | {
      acquired: false;
      mechanism: PptExplainerCoordinationMechanism;
    };

export interface PptExplainerCrossTabCoordinator {
  runExclusive<T>(
    taskId: string,
    run: (signal: AbortSignal) => T | Promise<T>
  ): Promise<PptExplainerExclusiveRunResult<T>>;
  runDeliveryExclusive<T>(
    boardId: string,
    taskId: string,
    run: (signal: AbortSignal) => T | Promise<T>
  ): Promise<PptExplainerExclusiveRunResult<T>>;
  cancel(taskId: string): void;
  dispose(): void;
}

interface ActiveRun {
  controller: AbortController;
  channel?: PptExplainerBroadcastChannelAdapter;
  messageListener?: (event: { data: unknown }) => void;
  cleanedUp: boolean;
}

interface CancelMessage {
  schemaVersion: 1;
  type: typeof CANCEL_MESSAGE_TYPE;
  taskId: string;
}

function getDefaultLockManager(): PptExplainerLockManagerAdapter | null {
  if (typeof navigator === 'undefined') return null;
  const lockManager = navigator.locks;
  return lockManager && typeof lockManager.request === 'function'
    ? (lockManager as PptExplainerLockManagerAdapter)
    : null;
}

function getDefaultBroadcastChannelFactory():
  | ((name: string) => PptExplainerBroadcastChannelAdapter)
  | null {
  const BroadcastChannelConstructor = globalThis.BroadcastChannel;
  if (typeof BroadcastChannelConstructor !== 'function') return null;
  return (name) =>
    new BroadcastChannelConstructor(
      name
    ) as PptExplainerBroadcastChannelAdapter;
}

function normalizeTaskId(taskId: string): string {
  const normalized = taskId.trim();
  if (!normalized) throw new Error('PPT 讲解任务 ID 不能为空');
  return normalized;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isValidTombstoneExpiration(
  expiresAt: unknown,
  now: number
): expiresAt is number {
  return (
    typeof expiresAt === 'number' &&
    Number.isFinite(expiresAt) &&
    expiresAt > now &&
    expiresAt <= now + CANCEL_TOMBSTONE_TTL_MS
  );
}

function getBoundedTombstones(
  tombstones: ReadonlyMap<string, unknown>,
  now: number
): Map<string, number> {
  return new Map(
    [...tombstones]
      .map(([taskId, expiresAt], insertionOrder) => ({
        taskId,
        expiresAt,
        insertionOrder,
      }))
      .filter((entry): entry is typeof entry & { expiresAt: number } =>
        isValidTombstoneExpiration(entry.expiresAt, now)
      )
      .sort(
        (left, right) =>
          left.expiresAt - right.expiresAt ||
          left.insertionOrder - right.insertionOrder
      )
      .slice(-MAX_CANCEL_TOMBSTONES)
      .map(({ taskId, expiresAt }) => [taskId, expiresAt] as const)
  );
}

function pruneMemoryTombstones(now: number): void {
  const bounded = getBoundedTombstones(cancelTombstoneExpirations, now);
  cancelTombstoneExpirations.clear();
  cancelledTaskIds.clear();
  for (const [taskId, expiresAt] of bounded) {
    cancelTombstoneExpirations.set(taskId, expiresAt);
    cancelledTaskIds.add(taskId);
  }
}

function writePersistedTombstones(
  tombstones: ReadonlyMap<string, number>
): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    if (tombstones.size === 0) {
      storage.removeItem(CANCEL_TOMBSTONE_STORAGE_KEY);
      return;
    }
    storage.setItem(
      CANCEL_TOMBSTONE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(tombstones))
    );
  } catch {
    // Private browsing and restricted contexts may reject localStorage access.
  }
}

function readPersistedTombstones(now: number): Map<string, number> {
  const storage = getLocalStorage();
  if (!storage) return new Map();

  try {
    const raw = storage.getItem(CANCEL_TOMBSTONE_STORAGE_KEY);
    if (!raw) return new Map();
    if (raw.length > MAX_CANCEL_TOMBSTONE_STORAGE_LENGTH) {
      storage.removeItem(CANCEL_TOMBSTONE_STORAGE_KEY);
      return new Map();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      storage.removeItem(CANCEL_TOMBSTONE_STORAGE_KEY);
      return new Map();
    }

    const entries = Object.entries(parsed as Record<string, unknown>);
    const bounded = getBoundedTombstones(new Map(entries), now);
    if (bounded.size !== entries.length) writePersistedTombstones(bounded);
    return bounded;
  } catch {
    return new Map();
  }
}

function cacheTombstones(
  tombstones: ReadonlyMap<string, number>,
  now: number
): void {
  for (const [taskId, expiresAt] of tombstones) {
    if (!isValidTombstoneExpiration(expiresAt, now)) continue;
    const cachedExpiration = cancelTombstoneExpirations.get(taskId) || 0;
    cancelTombstoneExpirations.set(
      taskId,
      Math.max(cachedExpiration, expiresAt)
    );
    cancelledTaskIds.add(taskId);
  }
  pruneMemoryTombstones(now);
}

function hasCancellationTombstone(taskId: string): boolean {
  const now = Date.now();
  pruneMemoryTombstones(now);
  if (cancelledTaskIds.has(taskId)) return true;

  const persisted = readPersistedTombstones(now);
  cacheTombstones(persisted, now);
  return cancelledTaskIds.has(taskId);
}

function recordCancellationTombstone(taskId: string): void {
  const now = Date.now();
  const expiresAt = now + CANCEL_TOMBSTONE_TTL_MS;
  const tombstones = readPersistedTombstones(now);
  for (const [cachedTaskId, cachedExpiresAt] of cancelTombstoneExpirations) {
    tombstones.set(cachedTaskId, cachedExpiresAt);
  }
  tombstones.set(taskId, expiresAt);

  const bounded = getBoundedTombstones(tombstones, now);
  cacheTombstones(bounded, now);
  writePersistedTombstones(bounded);
}

function clearCancellationTombstonesForTests(): void {
  cancelledTaskIds.clear();
  cancelTombstoneExpirations.clear();
  try {
    getLocalStorage()?.removeItem(CANCEL_TOMBSTONE_STORAGE_KEY);
  } catch {
    // Tests must still reset the in-memory fallback when storage is restricted.
  }
}

function getLockName(taskId: string): string {
  return `${COORDINATION_NAMESPACE}:lock:${taskId}`;
}

function getDeliveryLockName(boardId: string, taskId: string): string {
  return `${COORDINATION_NAMESPACE}:delivery:${encodeURIComponent(
    boardId
  )}:${encodeURIComponent(taskId)}`;
}

function getCancelChannelName(taskId: string): string {
  return `${COORDINATION_NAMESPACE}:cancel:${taskId}`;
}

function createAbortError(message: string): Error {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isCancelMessage(
  value: unknown,
  taskId: string
): value is CancelMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<CancelMessage>;
  return (
    message.schemaVersion === 1 &&
    message.type === CANCEL_MESSAGE_TYPE &&
    message.taskId === taskId
  );
}

class DefaultPptExplainerCrossTabCoordinator
  implements PptExplainerCrossTabCoordinator
{
  private readonly lockManager: PptExplainerLockManagerAdapter | null;
  private readonly createBroadcastChannel:
    | ((name: string) => PptExplainerBroadcastChannelAdapter)
    | null;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly activeDeliveryRuns = new Map<string, ActiveRun>();
  private disposed = false;

  constructor(options: PptExplainerCrossTabCoordinatorOptions = {}) {
    this.lockManager =
      options.lockManager === undefined
        ? getDefaultLockManager()
        : options.lockManager;
    this.createBroadcastChannel =
      options.createBroadcastChannel === undefined
        ? getDefaultBroadcastChannelFactory()
        : options.createBroadcastChannel;
  }

  async runExclusive<T>(
    taskId: string,
    run: (signal: AbortSignal) => T | Promise<T>
  ): Promise<PptExplainerExclusiveRunResult<T>> {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (this.disposed) {
      throw new Error('PPT 讲解跨标签协调器已释放');
    }
    if (hasCancellationTombstone(normalizedTaskId)) {
      return { acquired: false, mechanism: this.getMechanism() };
    }
    if (this.activeRuns.has(normalizedTaskId)) {
      return { acquired: false, mechanism: this.getMechanism() };
    }
    if (!this.lockManager) {
      return this.runAcquired(normalizedTaskId, 'local', run);
    }

    let lockCallbackInvoked = false;
    try {
      return await this.lockManager.request(
        getLockName(normalizedTaskId),
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          lockCallbackInvoked = true;
          if (
            !lock ||
            this.disposed ||
            hasCancellationTombstone(normalizedTaskId)
          ) {
            return { acquired: false, mechanism: 'web-locks' } as const;
          }
          return this.runAcquired(normalizedTaskId, 'web-locks', run);
        }
      );
    } catch (error) {
      if (lockCallbackInvoked) throw error;
      return this.runAcquired(normalizedTaskId, 'local', run);
    }
  }

  async runDeliveryExclusive<T>(
    boardId: string,
    taskId: string,
    run: (signal: AbortSignal) => T | Promise<T>
  ): Promise<PptExplainerExclusiveRunResult<T>> {
    const normalizedBoardId = normalizeTaskId(boardId);
    const normalizedTaskId = normalizeTaskId(taskId);
    const deliveryKey = `${normalizedBoardId}\u0000${normalizedTaskId}`;
    if (this.disposed) {
      throw new Error('PPT 讲解跨标签协调器已释放');
    }
    if (this.activeDeliveryRuns.has(deliveryKey)) {
      return { acquired: false, mechanism: this.getMechanism() };
    }
    if (!this.lockManager) {
      return this.runDeliveryAcquired(deliveryKey, 'local', run);
    }

    let lockCallbackInvoked = false;
    try {
      return await this.lockManager.request(
        getDeliveryLockName(normalizedBoardId, normalizedTaskId),
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          lockCallbackInvoked = true;
          if (!lock || this.disposed || this.activeDeliveryRuns.has(deliveryKey)) {
            return { acquired: false, mechanism: 'web-locks' } as const;
          }
          return this.runDeliveryAcquired(deliveryKey, 'web-locks', run);
        }
      );
    } catch (error) {
      if (lockCallbackInvoked) throw error;
      return this.runDeliveryAcquired(deliveryKey, 'local', run);
    }
  }

  cancel(taskId: string): void {
    const normalizedTaskId = normalizeTaskId(taskId);
    recordCancellationTombstone(normalizedTaskId);
    if (this.disposed) return;

    this.activeRuns
      .get(normalizedTaskId)
      ?.controller.abort(createAbortError('PPT 讲解任务已取消'));

    if (!this.createBroadcastChannel) return;
    let channel: PptExplainerBroadcastChannelAdapter | undefined;
    try {
      channel = this.createBroadcastChannel(
        getCancelChannelName(normalizedTaskId)
      );
      channel.postMessage({
        schemaVersion: 1,
        type: CANCEL_MESSAGE_TYPE,
        taskId: normalizedTaskId,
      } satisfies CancelMessage);
    } catch {
      // BroadcastChannel may be unavailable in a non-secure or restricted context.
    } finally {
      try {
        channel?.close();
      } catch {
        // Cancellation remains local when a restricted channel cannot close.
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [taskId, activeRun] of this.activeRuns) {
      activeRun.controller.abort(
        createAbortError('PPT 讲解跨标签协调器已释放')
      );
      this.cleanupActiveRun(taskId, activeRun);
    }
    for (const [deliveryKey, activeRun] of this.activeDeliveryRuns) {
      activeRun.controller.abort(
        createAbortError('PPT 讲解画布交付协调器已释放')
      );
      this.cleanupActiveDeliveryRun(deliveryKey, activeRun);
    }
  }

  private getMechanism(): PptExplainerCoordinationMechanism {
    return this.lockManager ? 'web-locks' : 'local';
  }

  private async runAcquired<T>(
    taskId: string,
    mechanism: PptExplainerCoordinationMechanism,
    run: (signal: AbortSignal) => T | Promise<T>
  ): Promise<PptExplainerExclusiveRunResult<T>> {
    if (
      this.disposed ||
      this.activeRuns.has(taskId) ||
      hasCancellationTombstone(taskId)
    ) {
      return { acquired: false, mechanism };
    }

    const activeRun = this.createActiveRun(taskId);
    this.activeRuns.set(taskId, activeRun);
    try {
      return {
        acquired: true,
        mechanism,
        value: await run(activeRun.controller.signal),
      };
    } finally {
      this.cleanupActiveRun(taskId, activeRun);
    }
  }

  private async runDeliveryAcquired<T>(
    deliveryKey: string,
    mechanism: PptExplainerCoordinationMechanism,
    run: (signal: AbortSignal) => T | Promise<T>
  ): Promise<PptExplainerExclusiveRunResult<T>> {
    if (this.disposed || this.activeDeliveryRuns.has(deliveryKey)) {
      return { acquired: false, mechanism };
    }

    const activeRun: ActiveRun = {
      controller: new AbortController(),
      cleanedUp: false,
    };
    this.activeDeliveryRuns.set(deliveryKey, activeRun);
    try {
      return {
        acquired: true,
        mechanism,
        value: await run(activeRun.controller.signal),
      };
    } finally {
      this.cleanupActiveDeliveryRun(deliveryKey, activeRun);
    }
  }

  private createActiveRun(taskId: string): ActiveRun {
    const activeRun: ActiveRun = {
      controller: new AbortController(),
      cleanedUp: false,
    };
    if (!this.createBroadcastChannel) return activeRun;

    let channel: PptExplainerBroadcastChannelAdapter | undefined;
    try {
      channel = this.createBroadcastChannel(getCancelChannelName(taskId));
      activeRun.channel = channel;
      const messageListener = (event: { data: unknown }) => {
        if (isCancelMessage(event.data, taskId)) {
          recordCancellationTombstone(taskId);
          activeRun.controller.abort(
            createAbortError('PPT 讲解任务已在其他标签页取消')
          );
        }
      };
      channel.addEventListener('message', messageListener);
      activeRun.messageListener = messageListener;
    } catch {
      try {
        channel?.close();
      } catch {
        // The run can still use local cancellation when channel setup fails.
      }
      activeRun.channel = undefined;
      activeRun.messageListener = undefined;
    }
    return activeRun;
  }

  private cleanupActiveRun(taskId: string, activeRun: ActiveRun): void {
    if (activeRun.cleanedUp) return;
    activeRun.cleanedUp = true;
    if (activeRun.channel && activeRun.messageListener) {
      try {
        activeRun.channel.removeEventListener(
          'message',
          activeRun.messageListener
        );
      } catch {
        // Closing below remains the authoritative resource release.
      }
    }
    try {
      activeRun.channel?.close();
    } catch {
      // A restricted browser implementation may already have invalidated it.
    }
    if (this.activeRuns.get(taskId) === activeRun) {
      this.activeRuns.delete(taskId);
    }
  }

  private cleanupActiveDeliveryRun(
    deliveryKey: string,
    activeRun: ActiveRun
  ): void {
    if (activeRun.cleanedUp) return;
    activeRun.cleanedUp = true;
    if (this.activeDeliveryRuns.get(deliveryKey) === activeRun) {
      this.activeDeliveryRuns.delete(deliveryKey);
    }
  }
}

export function createPptExplainerCrossTabCoordinator(
  options: PptExplainerCrossTabCoordinatorOptions = {}
): PptExplainerCrossTabCoordinator {
  return new DefaultPptExplainerCrossTabCoordinator(options);
}

let defaultCoordinator = createPptExplainerCrossTabCoordinator();

export function runPptExplainerTaskExclusive<T>(
  taskId: string,
  run: (signal: AbortSignal) => T | Promise<T>
): Promise<PptExplainerExclusiveRunResult<T>> {
  return defaultCoordinator.runExclusive(taskId, run);
}

export function runPptExplainerDeliveryExclusive<T>(
  boardId: string,
  taskId: string,
  run: (signal: AbortSignal) => T | Promise<T>
): Promise<PptExplainerExclusiveRunResult<T>> {
  return defaultCoordinator.runDeliveryExclusive(boardId, taskId, run);
}

export function cancelPptExplainerTaskAcrossTabs(taskId: string): void {
  defaultCoordinator.cancel(taskId);
}

export function isPptExplainerTaskCancellationRecorded(
  taskId: string
): boolean {
  return hasCancellationTombstone(normalizeTaskId(taskId));
}

export function resetPptExplainerCrossTabCoordinatorForTests(
  options: PptExplainerCrossTabCoordinatorOptions = {}
): void {
  defaultCoordinator.dispose();
  clearCancellationTombstonesForTests();
  defaultCoordinator = createPptExplainerCrossTabCoordinator(options);
}
