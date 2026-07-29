import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

const mocks = vi.hoisted(() => ({
  migrateFromLegacyDB: vi.fn(),
  getAllTasks: vi.fn(),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    getAllTasks: vi.fn(() => []),
  },
}));

vi.mock('../../services/app-database', () => ({
  migrateFromLegacyDB: mocks.migrateFromLegacyDB,
}));

vi.mock('../../services/task-storage-reader', () => ({
  taskStorageReader: {
    getAllTasks: mocks.getAllTasks,
  },
}));

function createTask(overrides: Partial<Task>): Task {
  const now = Date.now();
  return {
    id: 'persisted-task',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: { prompt: '兔子', model: 'gpt-image-2' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('persisted recoverable task detection', () => {
  beforeEach(() => {
    mocks.migrateFromLegacyDB.mockReset().mockResolvedValue(undefined);
    mocks.getAllTasks.mockReset().mockResolvedValue([]);
  });

  it('wakes the deferred runtime for a persisted processing task', async () => {
    mocks.getAllTasks.mockImplementation(
      async ({ status }: { status: TaskStatus }) =>
        status === TaskStatus.PROCESSING ? [createTask({})] : []
    );
    const { hasPersistedRecoverableTasks } = await import('../active-tasks');

    await expect(hasPersistedRecoverableTasks()).resolves.toBe(true);
    expect(mocks.migrateFromLegacyDB).toHaveBeenCalledTimes(1);
  });

  it('wakes the deferred runtime for a recoverable failed image task', async () => {
    mocks.getAllTasks.mockImplementation(
      async ({ status }: { status: TaskStatus }) =>
        status === TaskStatus.FAILED
          ? [
              createTask({
                status: TaskStatus.FAILED,
                params: {
                  prompt: '兔子',
                  model: 'gpt-image-2',
                  imageSubmissionAttempted: true,
                },
                error: { code: 'RECOVERY_TIMEOUT', message: '稍后恢复' },
              }),
            ]
          : []
    );
    const { hasPersistedRecoverableTasks } = await import('../active-tasks');

    await expect(hasPersistedRecoverableTasks()).resolves.toBe(true);
  });

  it('keeps the deferred runtime lazy for terminal business failures', async () => {
    mocks.getAllTasks.mockImplementation(
      async ({ status }: { status: TaskStatus }) =>
        status === TaskStatus.FAILED
          ? [
              createTask({
                status: TaskStatus.FAILED,
                error: { code: 'HTTP_400', message: '参数错误' },
              }),
            ]
          : []
    );
    const { hasPersistedRecoverableTasks } = await import('../active-tasks');

    await expect(hasPersistedRecoverableTasks()).resolves.toBe(false);
  });
});
