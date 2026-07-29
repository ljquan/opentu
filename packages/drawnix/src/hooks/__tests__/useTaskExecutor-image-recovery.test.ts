// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';

const mocks = vi.hoisted(() => ({
  currentTask: null as Task | null,
  taskListener: null as ((event: { type: string; task: Task }) => void) | null,
  recoveryCallbacks: null as null | {
    onSucceeded(result: any): void | Promise<void>;
    onFailed(error: any): void | Promise<void>;
  },
  updateTaskStatus: vi.fn(),
  completeImageAttempt: vi.fn(),
  failImageAttempt: vi.fn(),
  activateImageAttempt: vi.fn(),
  markImageAttemptRecovering: vi.fn(),
  cacheRemoteUrls: vi.fn(),
  registerImageMetadata: vi.fn(),
  stop: vi.fn(),
  stopAll: vi.fn(),
  cancelRequest: vi.fn(),
  isTaskTimeout: vi.fn(() => false),
  isTimedOutImageRequestRecoveryTask: vi.fn(() => false),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {},
  legacyTaskQueueService: {
    getTask: vi.fn(() => mocks.currentTask || undefined),
    getAllTasks: vi.fn(() => (mocks.currentTask ? [mocks.currentTask] : [])),
    updateTaskStatus: mocks.updateTaskStatus,
    completeImageAttempt: mocks.completeImageAttempt,
    failImageAttempt: mocks.failImageAttempt,
    activateImageAttempt: mocks.activateImageAttempt,
    markImageAttemptRecovering: mocks.markImageAttemptRecovering,
    observeTaskUpdates: vi.fn(() => ({
      subscribe: (listener: (event: { type: string; task: Task }) => void) => {
        mocks.taskListener = listener;
        return { unsubscribe: vi.fn() };
      },
    })),
  },
}));

vi.mock('../../services/generation-api-service', () => ({
  generationAPIService: {
    generate: vi.fn(),
    cancelRequest: mocks.cancelRequest,
    resumeAudioGeneration: vi.fn(),
    resumeImageGeneration: vi.fn(),
  },
}));

vi.mock('../../services/character-api-service', () => ({
  characterAPIService: {},
}));

vi.mock('../../services/character-storage-service', () => ({
  characterStorageService: {},
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    registerImageMetadata: mocks.registerImageMetadata,
  },
}));

vi.mock('../../utils/task-utils', () => ({
  isResumableAsyncImageTask: vi.fn(() => false),
  isTaskTimeout: mocks.isTaskTimeout,
}));

vi.mock('../../utils/api-auth-error-event', () => ({
  classifyApiCredentialError: vi.fn(() => null),
}));

vi.mock('../../services/task-invocation-route', () => ({
  assertTaskInvocationRouteAvailable: vi.fn(),
  resolveTaskInvocationRouteModel: vi.fn(),
  shouldUseStrictTaskInvocationRoute: vi.fn(() => false),
}));

vi.mock('../../services/media-executor/fallback-utils', () => ({
  cacheRemoteUrls: mocks.cacheRemoteUrls,
}));

vi.mock('../../services/image-generation-recovery-service', () => ({
  getImageSubmissionRequestId: (task: Pick<Task, 'id' | 'params'>) =>
    (task.params.submissionRequestId as string | undefined) || task.id,
  imageGenerationRecoveryService: {
    start: vi.fn((_task: Task, callbacks: any) => {
      mocks.recoveryCallbacks = callbacks;
      return { taskId: _task.id, stop: vi.fn() };
    }),
    stop: mocks.stop,
    stopAll: mocks.stopAll,
  },
  isCurrentImageRecoveryAttempt: (
    task: Task | undefined,
    requestId: string,
    startedAt: number
  ) =>
    Boolean(
      task &&
        task.status === TaskStatus.PROCESSING &&
        task.executionPhase === TaskExecutionPhase.POLLING &&
        ((task.params.submissionRequestId as string | undefined) || task.id) ===
          requestId &&
        task.startedAt === startedAt
    ),
  isImageRequestRecoveryTask: (task: Task) =>
    task.status === TaskStatus.PROCESSING &&
    task.executionPhase === TaskExecutionPhase.POLLING,
  isTimedOutImageRequestRecoveryTask:
    mocks.isTimedOutImageRequestRecoveryTask,
  shouldRecoverImageSubmission: vi.fn(() => false),
}));

function createRecoveringTask(): Task {
  const now = Date.now();
  return {
    id: 'recover-image-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: {
      prompt: '画一只兔子',
      model: 'gpt-image-2',
      submissionRequestId: 'submission-1',
      imageSubmissionAttempted: true,
    },
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    executionPhase: TaskExecutionPhase.POLLING,
  };
}

describe('useTaskExecutor image recovery', () => {
  beforeEach(() => {
    mocks.currentTask = createRecoveringTask();
    mocks.taskListener = null;
    mocks.recoveryCallbacks = null;
    mocks.updateTaskStatus.mockReset();
    mocks.completeImageAttempt.mockReset();
    mocks.failImageAttempt.mockReset();
    mocks.activateImageAttempt.mockReset();
    mocks.markImageAttemptRecovering.mockReset();
    mocks.cacheRemoteUrls.mockReset();
    mocks.registerImageMetadata.mockReset();
    mocks.stop.mockReset();
    mocks.stopAll.mockReset();
    mocks.cancelRequest.mockReset();
    mocks.isTaskTimeout.mockReset().mockReturnValue(false);
    mocks.isTimedOutImageRequestRecoveryTask
      .mockReset()
      .mockReturnValue(false);
    mocks.updateTaskStatus.mockImplementation(
      (_taskId: string, status: TaskStatus, updates?: Partial<Task>) => {
        mocks.currentTask = {
          ...mocks.currentTask!,
          ...updates,
          status,
        };
      }
    );
    mocks.completeImageAttempt.mockImplementation(
      async (_taskId: string, _requestId: string, result: Task['result']) => {
        mocks.currentTask = {
          ...mocks.currentTask!,
          status: TaskStatus.COMPLETED,
          result,
        };
        return true;
      }
    );
    mocks.failImageAttempt.mockResolvedValue(true);
    mocks.activateImageAttempt.mockResolvedValue(true);
    mocks.markImageAttemptRecovering.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a valid remote URL when recovered-image caching fails', async () => {
    mocks.cacheRemoteUrls.mockRejectedValue(new Error('cache unavailable'));
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });
    await waitFor(() => expect(mocks.recoveryCallbacks).not.toBeNull());

    await act(async () => {
      await mocks.recoveryCallbacks?.onSucceeded({
        status: 'succeeded',
        requestId: 'submission-1',
        url: 'https://images.example.com/recovered.png',
        urls: ['https://images.example.com/recovered.png'],
      });
    });

    expect(mocks.completeImageAttempt).toHaveBeenCalledWith(
      'recover-image-1',
      'submission-1',
      expect.objectContaining({
        url: 'https://images.example.com/recovered.png',
        resultKind: 'image',
      })
    );
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.currentTask?.status).toBe(TaskStatus.COMPLETED);
    expect(mocks.currentTask?.result?.url).toBe(
      'https://images.example.com/recovered.png'
    );

    unmount();
    expect(mocks.stopAll).toHaveBeenCalledTimes(1);
  });

  it('does not expose or register a stale recovery result after a newer retry', async () => {
    mocks.cacheRemoteUrls.mockResolvedValue([
      'https://images.example.com/stale.png',
    ]);
    mocks.completeImageAttempt.mockImplementation(async () => {
      mocks.currentTask = {
        ...mocks.currentTask!,
        params: {
          ...mocks.currentTask!.params,
          submissionRequestId: 'submission-2',
        },
        startedAt: (mocks.currentTask!.startedAt || 0) + 1,
      };
      return false;
    });
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });
    await waitFor(() => expect(mocks.recoveryCallbacks).not.toBeNull());

    await act(async () => {
      await mocks.recoveryCallbacks?.onSucceeded({
        status: 'succeeded',
        requestId: 'submission-1',
        url: 'https://images.example.com/stale.png',
        urls: ['https://images.example.com/stale.png'],
      });
    });

    expect(mocks.completeImageAttempt).toHaveBeenCalledWith(
      'recover-image-1',
      'submission-1',
      expect.any(Object)
    );
    expect(mocks.registerImageMetadata).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();

    unmount();
  });

  it('rejects terminal delivery when storage still has the current processing attempt', async () => {
    mocks.cacheRemoteUrls.mockResolvedValue([
      'https://images.example.com/retry-writeback.png',
    ]);
    mocks.completeImageAttempt.mockResolvedValue(false);
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });
    await waitFor(() => expect(mocks.recoveryCallbacks).not.toBeNull());

    await expect(
      mocks.recoveryCallbacks?.onSucceeded({
        status: 'succeeded',
        requestId: 'submission-1',
        url: 'https://images.example.com/retry-writeback.png',
        urls: ['https://images.example.com/retry-writeback.png'],
      })
    ).rejects.toThrow('恢复图片结果写入失败，稍后重试');

    expect(mocks.currentTask?.status).toBe(TaskStatus.PROCESSING);
    unmount();
  });

  it('hands a formally submitted image task to extended recovery at the live timeout', async () => {
    vi.useFakeTimers();
    mocks.currentTask = {
      ...createRecoveringTask(),
      executionPhase: TaskExecutionPhase.SUBMITTING,
    };
    mocks.isTaskTimeout.mockReturnValue(true);
    mocks.isTimedOutImageRequestRecoveryTask.mockReturnValue(true);

    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'recover-image-1',
      'submission-1',
      { timeoutRecoveryAttemptedAt: expect.any(Number) }
    );
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.cancelRequest).toHaveBeenCalledWith('recover-image-1');

    unmount();
  });

  it('keeps the original timeout failure for a non-recoverable image task', async () => {
    vi.useFakeTimers();
    mocks.currentTask = {
      ...createRecoveringTask(),
      executionPhase: TaskExecutionPhase.SUBMITTING,
    };
    mocks.isTaskTimeout.mockReturnValue(true);

    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).toHaveBeenCalledWith(
      'recover-image-1',
      'submission-1',
      expect.objectContaining({ code: 'TIMEOUT' }),
      { allowLegacyRequestId: true }
    );
    expect(mocks.cancelRequest).toHaveBeenCalledWith('recover-image-1');

    unmount();
  });

  it('does not cancel or fail an image when the live-timeout recovery write loses a race', async () => {
    vi.useFakeTimers();
    mocks.currentTask = {
      ...createRecoveringTask(),
      executionPhase: TaskExecutionPhase.SUBMITTING,
    };
    mocks.isTaskTimeout.mockReturnValue(true);
    mocks.isTimedOutImageRequestRecoveryTask.mockReturnValue(true);
    mocks.markImageAttemptRecovering.mockResolvedValueOnce(false);

    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledTimes(1);
    expect(mocks.cancelRequest).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();

    unmount();
  });
});
