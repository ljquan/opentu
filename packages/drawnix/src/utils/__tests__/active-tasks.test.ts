import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';

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

  it('wakes the deferred runtime only for an explicitly submitted image task', async () => {
    mocks.getAllTasks.mockResolvedValue([
      createTask({
        executionPhase: TaskExecutionPhase.SUBMITTING,
        params: {
          prompt: '兔子',
          model: 'gpt-image-2',
          submissionRequestId: 'request-1',
          imageSubmissionAttempted: true,
        },
        invocationRoute: {
          operation: 'image',
          providerProfileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      }),
    ]);
    const { hasPersistedRecoverableTasks } = await import('../active-tasks');

    await expect(hasPersistedRecoverableTasks()).resolves.toBe(true);
    expect(mocks.migrateFromLegacyDB).toHaveBeenCalledTimes(1);
  });

  it('keeps the deferred runtime lazy for legacy processing images', async () => {
    mocks.getAllTasks.mockResolvedValue([createTask({})]);
    const { hasPersistedRecoverableTasks } = await import('../active-tasks');

    await expect(hasPersistedRecoverableTasks()).resolves.toBe(false);
  });

  it('keeps the deferred runtime lazy for terminal business failures', async () => {
    mocks.getAllTasks.mockResolvedValue([]);
    const { hasPersistedRecoverableTasks } = await import('../active-tasks');

    await expect(hasPersistedRecoverableTasks()).resolves.toBe(false);
  });
});
