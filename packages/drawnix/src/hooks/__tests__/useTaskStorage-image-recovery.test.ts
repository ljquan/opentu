// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';

const IMAGE_TIMEOUT_MS = 15 * 60 * 1000;

function isTimeoutRecoveryCandidate(task: Task): boolean {
  const now = Date.now();
  const recoveryStartedAt = task.params.imageTimeoutRecoveryAttemptedAt;
  const activePersistedWindow =
    typeof recoveryStartedAt === 'number' &&
    now - recoveryStartedAt < 24 * 60 * 60 * 1000;
  const timeoutAt = (task.startedAt || task.createdAt) + IMAGE_TIMEOUT_MS;
  const failedAt = task.completedAt || task.updatedAt;

  return (
    task.type === TaskType.IMAGE &&
    task.params.imageSubmissionAttempted === true &&
    !task.remoteId &&
    !task.syncedFromRemote &&
    ((task.status === TaskStatus.PROCESSING &&
      recoveryStartedAt === undefined &&
      now >= timeoutAt &&
      now - timeoutAt <= 24 * 60 * 60 * 1000) ||
      (task.status === TaskStatus.FAILED &&
        ['TIMEOUT', 'RECOVERY_TIMEOUT'].includes(task.error?.code || '') &&
        (activePersistedWindow ||
          (recoveryStartedAt === undefined &&
            now - failedAt <= 24 * 60 * 60 * 1000))))
  );
}

const mocks = vi.hoisted(() => ({
  storedTasks: [] as Task[],
  restoreTasks: vi.fn(),
  updateTaskStatus: vi.fn(),
  markImageAttemptRecovering: vi.fn(),
  failImageAttempt: vi.fn(),
  canRecover: vi.fn((task: Task) =>
    Boolean(task.params.imageSubmissionAttempted)
  ),
  canRecoverTimedOut: vi.fn(() => false),
  isTimeoutRecoveryCandidate: vi.fn(),
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
  IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM: 'imageTimeoutRecoveryAttemptedAt',
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
  isImageRequestRecoveryCandidate: (task: Task) =>
    task.type === TaskType.IMAGE &&
    task.status === TaskStatus.PROCESSING &&
    task.params.imageSubmissionAttempted === true &&
    task.executionPhase !== TaskExecutionPhase.SUBMITTING &&
    !task.remoteId &&
    !task.syncedFromRemote,
  isImageRequestTimeoutRecoveryCandidate:
    mocks.isTimeoutRecoveryCandidate,
  isLegacyInterruptedImageRequestTask: (task: Task) =>
    task.type === TaskType.IMAGE &&
    task.status === TaskStatus.FAILED &&
    task.params.imageSubmissionAttempted === undefined &&
    ['INTERRUPTED', 'INTERRUPTED_DURING_SUBMISSION'].includes(
      task.error?.code || ''
    ),
  isTimedOutImageRequestRecoveryTask: (task: Task) =>
    mocks.isTimeoutRecoveryCandidate(task),
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
    mocks.canRecover
      .mockReset()
      .mockImplementation((task: Task) =>
        Boolean(task.params.imageSubmissionAttempted)
      );
    mocks.canRecoverTimedOut.mockReset().mockReturnValue(false);
    mocks.isTimeoutRecoveryCandidate
      .mockReset()
      .mockImplementation(isTimeoutRecoveryCandidate);
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

  it('keeps a submitted image recoverable while provider settings are temporarily unavailable', async () => {
    mocks.canRecover.mockReturnValue(false);
    mocks.storedTasks = [
      createImageTask(TaskStatus.PROCESSING, true, 'submission-delayed-key'),
    ];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-1',
      'submission-delayed-key',
      { allowFailed: false, migrateLegacy: false }
    );
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
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

  it('starts the extended window for an expired image even while provider settings are unavailable', async () => {
    const task = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-expired-1'
    );
    task.startedAt = Date.now() - IMAGE_TIMEOUT_MS - 1_000;
    mocks.canRecover.mockReturnValue(false);
    mocks.canRecoverTimedOut.mockReturnValue(false);
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
    expect(mocks.canRecoverTimedOut).not.toHaveBeenCalled();
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

  it('starts an extended recovery window for a recent timed-out image', async () => {
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

  it('resumes a timed-out image with an active persisted recovery window', async () => {
    const task = createImageTask(
      TaskStatus.FAILED,
      true,
      'submission-timeout-1'
    );
    task.error = { code: 'RECOVERY_TIMEOUT', message: '暂未查询到上游结果' };
    task.completedAt = Date.now() - 1_000;
    const recoveryStartedAt = Date.now() - 2_000;
    task.params.imageTimeoutRecoveryAttemptedAt = recoveryStartedAt;
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
        timeoutRecoveryAttemptedAt: recoveryStartedAt,
      }
    );
  });

  it('does not resume a timed-out image after its persisted recovery window expires', async () => {
    const task = createImageTask(
      TaskStatus.FAILED,
      true,
      'submission-timeout-expired'
    );
    task.error = { code: 'RECOVERY_TIMEOUT', message: '暂未查询到上游结果' };
    task.completedAt = Date.now() - 1_000;
    task.params.imageTimeoutRecoveryAttemptedAt =
      Date.now() - 24 * 60 * 60 * 1000 - 1;
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
  });
});
