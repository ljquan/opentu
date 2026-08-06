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
  isTaskExecutionActive: vi.fn(() => false),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    restoreTasks: mocks.restoreTasks,
    isTaskExecutionActive: mocks.isTaskExecutionActive,
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
  IMAGE_SUBMISSION_REQUEST_ID_PARAM: 'submissionRequestId',
  getImageSubmissionRequestId: (task: Pick<Task, 'id' | 'params'>) =>
    (task.params.submissionRequestId as string | undefined) || task.id,
  isImageRequestRecoveryCandidate: (task: Task) =>
    task.type === TaskType.IMAGE &&
    task.status === TaskStatus.PROCESSING &&
    typeof task.params.submissionRequestId === 'string' &&
    task.params.imageSubmissionAttempted === true &&
    task.executionPhase === TaskExecutionPhase.POLLING &&
    !task.remoteId &&
    !task.syncedFromRemote,
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
      ...(requestId === undefined ? {} : { submissionRequestId: requestId }),
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
    mocks.isTaskExecutionActive.mockReset().mockReturnValue(false);
    mocks.storedTasks = [];
  });

  it('does not treat an in-page active request as a refreshed task', async () => {
    mocks.isTaskExecutionActive.mockReturnValue(true);
    mocks.storedTasks = [
      createImageTask(TaskStatus.PROCESSING, true, 'submission-live'),
    ];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('does not recover a refreshed task that explicitly never submitted its POST', async () => {
    mocks.storedTasks = [createImageTask(TaskStatus.PROCESSING, false)];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      'image-task-1',
      TaskStatus.FAILED,
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INTERRUPTED' }),
      })
    );
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
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
      'submission-1'
    );
  });

  it('does not guess the task ID for legacy image submissions', async () => {
    mocks.storedTasks = [createImageTask(TaskStatus.PROCESSING, true)];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      'image-task-1',
      TaskStatus.FAILED,
      expect.any(Object)
    );
  });

  it('does not recover a task without a persisted submission phase', async () => {
    const task = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-without-phase'
    );
    task.executionPhase = undefined;
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).toHaveBeenCalledWith(
      'image-task-1',
      'submission-without-phase',
      expect.objectContaining({ code: 'INTERRUPTED' }),
      { clearStartedAt: true }
    );
  });
});
