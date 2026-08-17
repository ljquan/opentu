import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeStorageNamespaceForStartup,
  initializeStorageNamespaceFromVault,
} from './storage-namespace-bootstrap';
import {
  activateStorageNamespace,
  createStorageNamespace,
  getActiveStorageNamespace,
} from './storage-context';
import { switchStorageNamespace } from './storage-namespace-switch';

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  return {
    events,
    appDatabase: {
      closeAppDB: vi.fn(() => events.push('app:close')),
      migrateFromLegacyDB: vi.fn(async () => {
        events.push('app:migrate');
      }),
    },
    taskStorageWriter: {
      pauseWrites: vi.fn(() => events.push('task-writer:pause')),
      resumeWrites: vi.fn(() => events.push('task-writer:resume')),
      close: vi.fn(() => events.push('task-writer:close')),
    },
    taskQueueService: {
      prepareForStorageNamespaceSwitch: vi.fn(async () => {
        events.push('tasks:prepare');
      }),
      restoreTasks: vi.fn(async () => {
        events.push('tasks:restore');
      }),
    },
    taskStorageReader: {
      close: vi.fn(() => events.push('task-reader:close')),
      getAllTasks: vi.fn(async () => {
        events.push('tasks:read');
        return [{ id: 'target-task' }];
      }),
    },
    workflowStorageReader: {
      close: vi.fn(() => events.push('workflow-reader:close')),
    },
    workflowStorageWriter: {
      pauseWrites: vi.fn(() => events.push('workflow-writer:pause')),
      resumeWrites: vi.fn(() => events.push('workflow-writer:resume')),
    },
    workspaceService: {
      isInitialized: vi.fn(() => true),
      reload: vi.fn(async () => {
        events.push('workspace:reload');
      }),
    },
    workspaceStorageService: {
      suspendWrites: vi.fn(() => events.push('workspace:suspend')),
      flushPendingWrites: vi.fn(async () => {
        events.push('workspace:flush');
      }),
      close: vi.fn(async () => {
        events.push('workspace:close');
      }),
      initialize: vi.fn(async () => {
        events.push('workspace:initialize');
      }),
      resumeWrites: vi.fn(() => events.push('workspace:resume')),
    },
    configIndexedDBWriter: {
      pauseWrites: vi.fn(() => events.push('config:pause')),
      flushPendingWrites: vi.fn(async () => {
        events.push('config:flush');
      }),
      resumeWrites: vi.fn(() => events.push('config:resume')),
    },
    managedProviderProfileRuntime: {
      profiles: ['credential-a-key'],
      clearManagedProviderProfileOverlay: vi.fn(() => {
        events.push('managed-profiles:clear');
        mocks.managedProviderProfileRuntime.profiles = [];
      }),
    },
  };
});

vi.mock('./app-database', () => mocks.appDatabase);
vi.mock('./media-executor/task-storage-writer', () => ({
  taskStorageWriter: mocks.taskStorageWriter,
}));
vi.mock('./task-queue-service', () => ({
  taskQueueService: mocks.taskQueueService,
}));
vi.mock('./task-storage-reader', () => ({
  taskStorageReader: mocks.taskStorageReader,
}));
vi.mock('./workflow-storage-reader', () => ({
  workflowStorageReader: mocks.workflowStorageReader,
}));
vi.mock('./workflow-engine/workflow-storage-writer', () => ({
  workflowStorageWriter: mocks.workflowStorageWriter,
}));
vi.mock('./workspace-service', () => ({
  workspaceService: mocks.workspaceService,
}));
vi.mock('./workspace-storage-service', () => ({
  workspaceStorageService: mocks.workspaceStorageService,
}));
vi.mock('../utils/config-indexeddb-writer', () => ({
  configIndexedDBWriter: mocks.configIndexedDBWriter,
}));
vi.mock(
  './managed-provider-profile-runtime',
  () => mocks.managedProviderProfileRuntime
);

function occursBefore(first: string, second: string): boolean {
  return mocks.events.indexOf(first) < mocks.events.indexOf(second);
}

describe('storage namespace host identity integration', () => {
  afterEach(() => {
    activateStorageNamespace(createStorageNamespace(null));
    mocks.events.length = 0;
    mocks.managedProviderProfileRuntime.profiles = ['credential-a-key'];
    vi.clearAllMocks();
  });

  it('waits for the final vault identity before selecting the startup namespace', async () => {
    let resolveIdentity!: (value: { credentialId: string }) => void;
    const identity = new Promise<{ credentialId: string }>((resolve) => {
      resolveIdentity = resolve;
    });
    const initialization = initializeStorageNamespaceFromVault({
      load: () => identity,
    });

    expect(getActiveStorageNamespace().kind).toBe('anonymous');
    resolveIdentity({ credentialId: 'host-credential-1' });
    await expect(initialization).resolves.toMatchObject({
      kind: 'credential',
      credentialId: 'host-credential-1',
    });
    expect(getActiveStorageNamespace()).toMatchObject({
      kind: 'credential',
      credentialId: 'host-credential-1',
    });
  });

  it('uses the host-verified identity without reading a stale active vault', async () => {
    const load = vi.fn(async () => ({ credentialId: 'stale-credential' }));

    await expect(
      initializeStorageNamespaceForStartup(
        { handled: true, credentialId: 'verified-credential' },
        { load }
      )
    ).resolves.toMatchObject({
      kind: 'credential',
      credentialId: 'verified-credential',
    });
    expect(load).not.toHaveBeenCalled();
    expect(getActiveStorageNamespace()).toMatchObject({
      credentialId: 'verified-credential',
    });
  });

  it('rejects a handled binding without a verified credential identity', async () => {
    const load = vi.fn(async () => ({ credentialId: 'stale-credential' }));

    await expect(
      initializeStorageNamespaceForStartup({ handled: true }, { load })
    ).rejects.toThrow('Verified OpenTu binding credential ID is required');
    expect(load).not.toHaveBeenCalled();
    expect(getActiveStorageNamespace().kind).toBe('anonymous');
  });

  it('restores the active vault identity only for a non-binding start', async () => {
    const load = vi.fn(async () => ({ credentialId: 'saved-credential' }));

    await expect(
      initializeStorageNamespaceForStartup({ handled: false }, { load })
    ).resolves.toMatchObject({
      kind: 'credential',
      credentialId: 'saved-credential',
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('quiesces old state before restoring only the target namespace', async () => {
    await switchStorageNamespace('host-credential-2');

    expect(getActiveStorageNamespace()).toMatchObject({
      kind: 'credential',
      credentialId: 'host-credential-2',
    });
    expect(occursBefore('workspace:suspend', 'workspace:close')).toBe(true);
    expect(occursBefore('managed-profiles:clear', 'app:migrate')).toBe(true);
    expect(mocks.managedProviderProfileRuntime.profiles).toEqual([]);
    expect(occursBefore('workspace:flush', 'workspace:close')).toBe(true);
    expect(occursBefore('config:flush', 'app:close')).toBe(true);
    expect(occursBefore('tasks:prepare', 'task-writer:close')).toBe(true);
    expect(occursBefore('app:close', 'app:migrate')).toBe(true);
    expect(occursBefore('workspace:initialize', 'workspace:reload')).toBe(true);
    expect(occursBefore('tasks:read', 'tasks:restore')).toBe(true);
    expect(occursBefore('tasks:restore', 'workspace:resume')).toBe(true);
    expect(mocks.taskQueueService.restoreTasks).toHaveBeenCalledWith([
      { id: 'target-task' },
    ]);
  });

  it('clears account A managed keys before account B migration completes', async () => {
    let releaseMigration!: () => void;
    mocks.appDatabase.migrateFromLegacyDB.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseMigration = resolve;
        })
    );

    activateStorageNamespace(createStorageNamespace('credential-a'));
    const switching = switchStorageNamespace('credential-b');
    await vi.waitFor(() => {
      expect(mocks.managedProviderProfileRuntime.profiles).toEqual([]);
    });
    expect(getActiveStorageNamespace()).toMatchObject({
      credentialId: 'credential-b',
    });

    releaseMigration();
    await switching;
  });

  it('serializes rapid host identity changes and leaves the newest active', async () => {
    let releaseFirst!: () => void;
    const firstMigration = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.appDatabase.migrateFromLegacyDB
      .mockImplementationOnce(async () => {
        mocks.events.push('app:migrate:first');
        await firstMigration;
      })
      .mockImplementationOnce(async () => {
        mocks.events.push('app:migrate:second');
      });

    const first = switchStorageNamespace('host-credential-3');
    const second = switchStorageNamespace('host-credential-4');
    await vi.waitFor(() => {
      expect(mocks.events).toContain('app:migrate:first');
    });
    expect(mocks.events).not.toContain('app:migrate:second');

    releaseFirst();
    await Promise.all([first, second]);
    expect(occursBefore('app:migrate:first', 'app:migrate:second')).toBe(true);
    expect(getActiveStorageNamespace()).toMatchObject({
      credentialId: 'host-credential-4',
    });
  });
});
