// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';

const mocks = vi.hoisted(() => ({
  storedTasks: [] as Task[],
  restoreTasks: vi.fn(),
  updateTaskStatus: vi.fn(),
  markImageAttemptRecovering: vi.fn(),
  failImageAttempt: vi.fn(),
  canRecover: vi.fn((task: Task) =>
    Boolean(task.params.imageSubmissionAttempted)
  ),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    restoreTasks: mocks.restoreTasks,
  },
  legacyTaskQueueService: {
    updateTaskStatus: mocks.updateTaskStatus,
    markImageAttemptRecovering: mocks.markImageAttemptRecovering,
    failImageAttempt: mocks.failImageAttempt,
  },
}));

vi.mock('../../services/task-storage-reader', () => ({
  taskStorageReader: {
    getAllTasks: vi.fn(async () => mocks.storedTasks),
  },
}));

vi.mock('../../services/app-database', () => ({
  migrateFromLegacyDB: vi.fn(async () => undefined),
}));

vi.mock('../../utils/task-utils', () => ({
  isResumableAsyncImageTask: vi.fn(() => false),
}));

vi.mock('../../services/image-generation-recovery-service', () => ({
  createImageSubmissionParams: (
    params: Task['params'],
    requestId: string,
    attempted = false
  ) => ({
    ...params,
    submissionRequestId: requestId,
    imageSubmissionAttempted: attempted,
  }),
  getImageSubmissionRequestId: (task: Pick<Task, 'id' | 'params'>) =>
    (task.params.submissionRequestId as string | undefined) || task.id,
  imageGenerationRecoveryService: {
    canRecover: mocks.canRecover,
  },
  isLegacyInterruptedImageRequestTask: (task: Task) =>
    task.type === TaskType.IMAGE &&
    task.status === TaskStatus.FAILED &&
    task.params.imageSubmissionAttempted === undefined &&
    ['INTERRUPTED', 'INTERRUPTED_DURING_SUBMISSION'].includes(
      task.error?.code || ''
    ),
}));

function createImageTask(
  status: TaskStatus,
  attempted?: boolean,
  requestId?: string
): Task {
  return {
    id: 'image-task-1',
    type: TaskType.IMAGE,
    status,
    params: {
      prompt: '画一只兔子',
      model: 'gpt-image-2',
      ...(requestId === undefined
        ? {}
        : { submissionRequestId: requestId }),
      ...(attempted === undefined
        ? {}
        : { imageSubmissionAttempted: attempted }),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    executionPhase: TaskExecutionPhase.SUBMITTING,
    invocationRoute: {
      operation: 'image',
      providerProfileId: 'tuzi-profile',
      modelId: 'gpt-image-2',
    },
  };
}

describe('useTaskStorage image request recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.restoreTasks.mockReset();
    mocks.updateTaskStatus.mockReset();
    mocks.markImageAttemptRecovering.mockReset().mockResolvedValue(true);
    mocks.failImageAttempt.mockReset().mockResolvedValue(true);
    mocks.canRecover.mockClear();
    mocks.storedTasks = [];
  });

  it('does not recover a refreshed task that explicitly never submitted its POST', async () => {
    mocks.storedTasks = [createImageTask(TaskStatus.PROCESSING, false)];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.failImageAttempt).toHaveBeenCalledWith(
      'image-task-1',
      'image-task-1',
      expect.objectContaining({
        code: 'INTERRUPTED',
      }),
      { allowLegacyRequestId: true, clearStartedAt: true }
    );
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('resumes a persisted formal submission in polling state after reload', async () => {
    mocks.storedTasks = [
      createImageTask(TaskStatus.PROCESSING, true, 'submission-1'),
    ];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-1',
      'submission-1',
      { allowFailed: false, migrateLegacy: false }
    );
  });

  it('migrates a legacy processing image task by falling back to the task ID', async () => {
    mocks.storedTasks = [createImageTask(TaskStatus.PROCESSING)];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-1',
      'image-task-1',
      { allowFailed: false, migrateLegacy: true }
    );
  });

  it('migrates a legacy interrupted image task by falling back to the task ID', async () => {
    const task = createImageTask(TaskStatus.FAILED);
    task.error = {
      code: 'INTERRUPTED',
      message: '任务被中断（页面刷新）',
    };
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-1',
      'image-task-1',
      {
        allowFailed: true,
        expectedErrorCodes: [
          'INTERRUPTED',
          'INTERRUPTED_DURING_SUBMISSION',
        ],
        migrateLegacy: true,
      }
    );
  });
});
