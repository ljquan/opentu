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
  canRecoverTimedOut: vi.fn(
    (task: Task) =>
      task.type === TaskType.IMAGE &&
      ((task.status === TaskStatus.FAILED &&
        ['TIMEOUT', 'RECOVERY_TIMEOUT'].includes(task.error?.code || '')) ||
        (task.status === TaskStatus.PROCESSING &&
          task.params.expiredForTest === true)) &&
      task.params.imageSubmissionAttempted === true &&
      task.params.imageTimeoutRecoveryAttemptedAt === undefined
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
  IMAGE_TIMEOUT_RECOVERY_ERROR_CODES: ['TIMEOUT', 'RECOVERY_TIMEOUT'],
  createImageSubmissionParams: (
    params: Task['params'],
    requestId: string,
    attempted = false
  ) => {
    const { imageTimeoutRecoveryAttemptedAt: _ignored, ...nextParams } = params;
    return {
      ...nextParams,
      submissionRequestId: requestId,
      imageSubmissionAttempted: attempted,
    };
  },
  getImageSubmissionRequestId: (task: Pick<Task, 'id' | 'params'>) =>
    (task.params.submissionRequestId as string | undefined) || task.id,
  imageGenerationRecoveryService: {
    canRecover: mocks.canRecover,
    canRecoverTimedOut: mocks.canRecoverTimedOut,
  },
  isLegacyInterruptedImageRequestTask: (task: Task) =>
    task.type === TaskType.IMAGE &&
    task.status === TaskStatus.FAILED &&
    task.params.imageSubmissionAttempted === undefined &&
    ['INTERRUPTED', 'INTERRUPTED_DURING_SUBMISSION'].includes(
      task.error?.code || ''
    ),
  isTimedOutImageRequestRecoveryTask: (task: Task) =>
    mocks.canRecoverTimedOut(task),
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
    mocks.canRecoverTimedOut.mockClear();
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

  it('rechecks an expired processing image instead of marking it interrupted', async () => {
    const task = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-expired-1'
    );
    task.params.expiredForTest = true;
    mocks.canRecover.mockReturnValueOnce(false);
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-1',
      'submission-expired-1',
      {
        allowFailed: false,
        migrateLegacy: false,
        timeoutRecoveryAttemptedAt: expect.any(Number),
      }
    );
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
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

  it('rechecks a recent timed-out submitted image once after reload', async () => {
    const task = createImageTask(
      TaskStatus.FAILED,
      true,
      'submission-timeout-1'
    );
    task.error = { code: 'TIMEOUT', message: '任务执行超时' };
    task.completedAt = Date.now() - 1_000;
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-1',
      'submission-timeout-1',
      {
        allowFailed: true,
        expectedErrorCodes: ['TIMEOUT', 'RECOVERY_TIMEOUT'],
        timeoutRecoveryAttemptedAt: expect.any(Number),
      }
    );
  });

  it('does not recheck a timed-out image after the compensation marker is persisted', async () => {
    const task = createImageTask(
      TaskStatus.FAILED,
      true,
      'submission-timeout-1'
    );
    task.error = { code: 'RECOVERY_TIMEOUT', message: '暂未查询到上游结果' };
    task.completedAt = Date.now() - 1_000;
    task.params.imageTimeoutRecoveryAttemptedAt = Date.now() - 2_000;
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
  });
});
