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
  taskExecutionToken: Symbol('task-execution') as symbol,
  taskExecutionTokens: new Map<string, symbol>(),
  allTasks: null as Task[] | null,
  taskListener: null as ((event: { type: string; task: Task }) => void) | null,
  recoveryCallbacks: null as null | {
    onSucceeded(result: any, signal: AbortSignal): void | Promise<void>;
    onFailed(error: any, signal: AbortSignal): void | Promise<void>;
  },
  updateTaskStatus: vi.fn(),
  completeImageAttempt: vi.fn(),
  failImageAttempt: vi.fn(),
  markImageAttemptRecovering: vi.fn(),
  activateImageAttempt: vi.fn(),
  cacheRemoteUrls: vi.fn(),
  registerImageMetadata: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  stopAll: vi.fn(),
  hasPendingTerminalWriteback: vi.fn(() => false),
  cancelRequest: vi.fn(),
  generate: vi.fn(),
  resumeAsyncImageGeneration: vi.fn(),
  resumeAudioGeneration: vi.fn(),
  isTaskExecutionActive: vi.fn(() => false),
  isResumableAsyncImageTask: vi.fn(() => false),
  isTaskTimeout: vi.fn(() => false),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {},
  legacyTaskQueueService: {
    getTask: vi.fn(
      (taskId: string) =>
        mocks.allTasks?.find((task) => task.id === taskId) ||
        (mocks.currentTask?.id === taskId ? mocks.currentTask : undefined)
    ),
    getAllTasks: vi.fn(
      () => mocks.allTasks || (mocks.currentTask ? [mocks.currentTask] : [])
    ),
    updateTaskStatus: mocks.updateTaskStatus,
    completeImageAttempt: mocks.completeImageAttempt,
    failImageAttempt: mocks.failImageAttempt,
    markImageAttemptRecovering: mocks.markImageAttemptRecovering,
    activateImageAttempt: mocks.activateImageAttempt,
    isTaskExecutionActive: mocks.isTaskExecutionActive,
    getTaskExecutionToken: vi.fn((taskId: string) => {
      const task =
        mocks.allTasks?.find((candidate) => candidate.id === taskId) ||
        (mocks.currentTask?.id === taskId ? mocks.currentTask : undefined);
      return task
        ? mocks.taskExecutionTokens.get(taskId) || mocks.taskExecutionToken
        : undefined;
    }),
    isTaskExecutionTokenCurrent: vi.fn((taskId: string, token: symbol) => {
      const task =
        mocks.allTasks?.find((candidate) => candidate.id === taskId) ||
        (mocks.currentTask?.id === taskId ? mocks.currentTask : undefined);
      return Boolean(
        task &&
          token ===
            (mocks.taskExecutionTokens.get(taskId) || mocks.taskExecutionToken)
      );
    }),
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
    generate: mocks.generate,
    cancelRequest: mocks.cancelRequest,
    resumeAudioGeneration: mocks.resumeAudioGeneration,
    resumeAsyncImageGeneration: mocks.resumeAsyncImageGeneration,
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
  isResumableAsyncImageTask: mocks.isResumableAsyncImageTask,
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
    start: mocks.start,
    stop: mocks.stop,
    stopAll: mocks.stopAll,
    hasPendingTerminalWriteback: mocks.hasPendingTerminalWriteback,
  },
  isCurrentImageRecoveryAttempt: (
    task: Task | undefined,
    requestId: string,
    startedAt: number
  ) =>
    Boolean(
      task &&
        task.type === TaskType.IMAGE &&
        task.status === TaskStatus.PROCESSING &&
        task.params.imageSubmissionAttempted === true &&
        ((task.params.submissionRequestId as string | undefined) || task.id) ===
          requestId &&
        (task.startedAt ?? task.createdAt) === startedAt &&
        !task.remoteId &&
        !task.syncedFromRemote
    ),
  isImageRequestRecoveryCandidate: (task: Task) =>
    task.type === TaskType.IMAGE &&
    task.status === TaskStatus.PROCESSING &&
    task.params.imageSubmissionAttempted === true &&
    task.executionPhase === TaskExecutionPhase.POLLING &&
    !task.remoteId,
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

function createPendingChatTask(id: string, prompt: string): Task {
  const now = Date.now();
  return {
    id,
    type: TaskType.CHAT,
    status: TaskStatus.PENDING,
    params: { prompt, model: 'test-chat-model' },
    createdAt: now,
    updatedAt: now,
  };
}

describe('useTaskExecutor image recovery', () => {
  beforeEach(() => {
    mocks.currentTask = createRecoveringTask();
    mocks.taskExecutionToken = Symbol('task-execution');
    mocks.taskExecutionTokens.clear();
    mocks.allTasks = null;
    mocks.taskListener = null;
    mocks.recoveryCallbacks = null;
    mocks.updateTaskStatus.mockReset();
    mocks.completeImageAttempt.mockReset();
    mocks.failImageAttempt.mockReset();
    mocks.markImageAttemptRecovering.mockReset();
    mocks.activateImageAttempt.mockReset();
    mocks.cacheRemoteUrls.mockReset();
    mocks.registerImageMetadata.mockReset();
    mocks.start
      .mockReset()
      .mockImplementation((_task: Task, callbacks: any) => {
        mocks.recoveryCallbacks = callbacks;
        return {
          status: 'started',
          handle: { taskId: _task.id, stop: vi.fn() },
        };
      });
    mocks.stop.mockReset();
    mocks.stopAll.mockReset();
    mocks.hasPendingTerminalWriteback.mockReset().mockReturnValue(false);
    mocks.cancelRequest.mockReset();
    mocks.generate.mockReset();
    mocks.resumeAsyncImageGeneration.mockReset();
    mocks.resumeAudioGeneration.mockReset();
    mocks.isTaskExecutionActive.mockReset().mockReturnValue(false);
    mocks.isResumableAsyncImageTask.mockReset().mockReturnValue(false);
    mocks.isTaskTimeout.mockReset().mockReturnValue(false);
    mocks.updateTaskStatus.mockImplementation(
      (taskId: string, status: TaskStatus, updates?: Partial<Task>) => {
        const applyUpdate = (task: Task): Task =>
          task.id === taskId ? { ...task, ...updates, status } : task;
        if (mocks.allTasks) {
          mocks.allTasks = mocks.allTasks.map(applyUpdate);
        }
        if (mocks.currentTask?.id === taskId) {
          mocks.currentTask = applyUpdate(mocks.currentTask);
        }
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
    mocks.activateImageAttempt.mockImplementation(async () => {
      mocks.currentTask = {
        ...mocks.currentTask!,
        status: TaskStatus.PROCESSING,
      };
      return true;
    });
    mocks.markImageAttemptRecovering.mockImplementation(async () => {
      mocks.currentTask = {
        ...mocks.currentTask!,
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.POLLING,
        error: undefined,
      };
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start recovery while the current page still owns the request', async () => {
    mocks.isTaskExecutionActive.mockReturnValue(true);
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });

    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledWith('recover-image-1');

    unmount();
  });

  it('fails the current attempt immediately when recovery cannot start', async () => {
    mocks.start.mockReturnValue({
      status: 'rejected',
      reason: 'route-unavailable',
    });
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });

    await waitFor(() =>
      expect(mocks.failImageAttempt).toHaveBeenCalledWith(
        'recover-image-1',
        'submission-1',
        expect.objectContaining({ code: 'RECOVERY_ROUTE_UNAVAILABLE' })
      )
    );
    expect(mocks.start).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('retries a rejected recovery start writeback without restarting recovery', async () => {
    mocks.start.mockReturnValue({
      status: 'rejected',
      reason: 'route-unavailable',
    });
    mocks.failImageAttempt
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('IndexedDB temporarily unavailable'))
      .mockResolvedValueOnce(true);
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });

    await waitFor(() =>
      expect(mocks.failImageAttempt).toHaveBeenCalledTimes(3)
    );
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.failImageAttempt).toHaveBeenLastCalledWith(
      'recover-image-1',
      'submission-1',
      expect.objectContaining({ code: 'RECOVERY_ROUTE_UNAVAILABLE' })
    );

    unmount();
  });

  it('persists an expired recovery start as a recovery timeout', async () => {
    mocks.start.mockReturnValue({
      status: 'rejected',
      reason: 'expired',
    });
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });

    await waitFor(() =>
      expect(mocks.failImageAttempt).toHaveBeenCalledWith(
        'recover-image-1',
        'submission-1',
        expect.objectContaining({ code: 'RECOVERY_TIMEOUT' })
      )
    );
    expect(mocks.start).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('starts read-only recovery after an online submission outcome becomes unknown', async () => {
    mocks.currentTask = {
      ...createRecoveringTask(),
      status: TaskStatus.PENDING,
      executionPhase: TaskExecutionPhase.SUBMITTING,
    };
    mocks.generate.mockRejectedValue(
      Object.assign(new Error('图片请求连接中断，正在确认生成结果'), {
        code: 'IMAGE_SUBMISSION_OUTCOME_UNKNOWN',
      })
    );
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskCreated',
        task: mocks.currentTask!,
      });
    });

    await waitFor(() => {
      expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
        'recover-image-1',
        'submission-1'
      );
      expect(mocks.start).toHaveBeenCalledTimes(1);
    });

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.POLLING,
      }),
      expect.any(Object)
    );

    unmount();
  });

  it('does not resume an async image while the task queue still owns the request', async () => {
    mocks.currentTask = {
      ...createRecoveringTask(),
      id: 'async-image-1',
      remoteId: 'remote-image-1',
    };
    mocks.isResumableAsyncImageTask.mockReturnValue(true);
    mocks.isTaskExecutionActive.mockReturnValue(true);
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });

    expect(mocks.resumeAsyncImageGeneration).not.toHaveBeenCalled();

    unmount();
  });

  it('does not let a deleted audio resume overwrite or release a same-id replacement', async () => {
    let finishOldAudio!: (result: Task['result']) => void;
    mocks.currentTask = {
      id: 'shared-task-1',
      type: TaskType.AUDIO,
      status: TaskStatus.PROCESSING,
      params: { prompt: 'old audio', model: 'suno-v4' },
      remoteId: 'old-remote-id',
      createdAt: 1,
      startedAt: 1,
      updatedAt: 1,
    };
    mocks.resumeAudioGeneration.mockReturnValue(
      new Promise((resolve) => {
        finishOldAudio = resolve;
      })
    );
    mocks.generate.mockReturnValue(new Promise(() => {}));
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({ type: 'taskUpdated', task: mocks.currentTask! });
    });
    await waitFor(() =>
      expect(mocks.resumeAudioGeneration).toHaveBeenCalledTimes(1)
    );

    const deletedTask = mocks.currentTask;
    act(() => {
      mocks.currentTask = null;
      mocks.taskListener?.({ type: 'taskDeleted', task: deletedTask! });
    });

    mocks.taskExecutionToken = Symbol('replacement-execution');
    mocks.currentTask = {
      id: 'shared-task-1',
      type: TaskType.CHAT,
      status: TaskStatus.PENDING,
      params: { prompt: 'replacement chat', model: 'gpt-4o-mini' },
      createdAt: 2,
      updatedAt: 2,
    };
    act(() => {
      mocks.taskListener?.({ type: 'taskCreated', task: mocks.currentTask! });
    });
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));

    finishOldAudio({
      url: 'https://example.com/stale.mp3',
      format: 'mp3',
      size: 1,
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      mocks.taskListener?.({ type: 'taskUpdated', task: mocks.currentTask! });
    });

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.currentTask?.params.prompt).toBe('replacement chat');
    expect(mocks.updateTaskStatus).not.toHaveBeenCalledWith(
      'shared-task-1',
      TaskStatus.COMPLETED,
      expect.objectContaining({
        result: expect.objectContaining({
          url: 'https://example.com/stale.mp3',
        }),
      })
    );
    unmount();
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
      await mocks.recoveryCallbacks?.onSucceeded(
        {
          status: 'succeeded',
          requestId: 'submission-1',
          url: 'https://images.example.com/recovered.png',
          urls: ['https://images.example.com/recovered.png'],
        },
        new AbortController().signal
      );
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

  it('writes back a recovered result for a restored task without startedAt', async () => {
    mocks.currentTask = {
      ...createRecoveringTask(),
      startedAt: undefined,
      invocationRoute: undefined,
    };
    mocks.cacheRemoteUrls.mockResolvedValue([
      'https://images.example.com/restored.png',
    ]);
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
      await mocks.recoveryCallbacks?.onSucceeded(
        {
          status: 'succeeded',
          requestId: 'submission-1',
          url: 'https://images.example.com/restored.png',
          urls: ['https://images.example.com/restored.png'],
        },
        new AbortController().signal
      );
    });

    expect(mocks.cacheRemoteUrls).toHaveBeenCalledWith(
      ['https://images.example.com/restored.png'],
      'recover-image-1',
      'image',
      'png',
      expect.objectContaining({
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
        cacheKey: 'submission-1',
        signal: expect.any(AbortSignal),
      })
    );

    expect(mocks.completeImageAttempt).toHaveBeenCalledWith(
      'recover-image-1',
      'submission-1',
      expect.objectContaining({
        url: 'https://images.example.com/restored.png',
      })
    );
    expect(mocks.currentTask?.status).toBe(TaskStatus.COMPLETED);
    expect(mocks.currentTask?.result?.url).toBe(
      'https://images.example.com/restored.png'
    );

    unmount();
  });

  it('does not persist a recovered result after its cache fetch is aborted', async () => {
    let cacheSignal: AbortSignal | undefined;
    mocks.cacheRemoteUrls.mockImplementation(
      async (
        _urls: string[],
        _taskId: string,
        _mediaType: string,
        _format: string,
        options: { signal?: AbortSignal }
      ) => {
        cacheSignal = options.signal;
        return new Promise<string[]>(() => undefined);
      }
    );
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });
    await waitFor(() => expect(mocks.recoveryCallbacks).not.toBeNull());

    const controller = new AbortController();
    const callbackPromise = mocks.recoveryCallbacks?.onSucceeded(
      {
        status: 'succeeded',
        requestId: 'submission-1',
        url: 'https://images.example.com/aborted.png',
        urls: ['https://images.example.com/aborted.png'],
      },
      controller.signal
    );
    await waitFor(() => expect(cacheSignal).toBe(controller.signal));
    controller.abort(new Error('recovery stopped'));
    await callbackPromise;

    expect(mocks.completeImageAttempt).not.toHaveBeenCalled();
    expect(mocks.registerImageMetadata).not.toHaveBeenCalled();
    unmount();
  });

  it('falls back to the remote URL when the writeback watchdog aborts caching', async () => {
    let cacheSignal: AbortSignal | undefined;
    mocks.cacheRemoteUrls.mockImplementation(
      async (
        _urls: string[],
        _taskId: string,
        _mediaType: string,
        _format: string,
        options: { signal?: AbortSignal }
      ) => {
        cacheSignal = options.signal;
        return new Promise<string[]>((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason),
            { once: true }
          );
        });
      }
    );
    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: mocks.currentTask!,
      });
    });
    await waitFor(() => expect(mocks.recoveryCallbacks).not.toBeNull());

    const controller = new AbortController();
    const callbackPromise = mocks.recoveryCallbacks?.onSucceeded(
      {
        status: 'succeeded',
        requestId: 'submission-1',
        url: 'https://images.example.com/watchdog.png',
        urls: ['https://images.example.com/watchdog.png'],
      },
      controller.signal
    );
    await waitFor(() => expect(cacheSignal).toBe(controller.signal));
    const timeoutError = new Error(
      'Image recovery terminal callback timed out'
    );
    timeoutError.name = 'TimeoutError';
    controller.abort(timeoutError);
    await callbackPromise;

    expect(mocks.completeImageAttempt).toHaveBeenCalledWith(
      'recover-image-1',
      'submission-1',
      expect.objectContaining({
        url: 'https://images.example.com/watchdog.png',
      })
    );
    expect(mocks.currentTask?.status).toBe(TaskStatus.COMPLETED);
    expect(mocks.registerImageMetadata).not.toHaveBeenCalled();
    unmount();
  });

  it('reuses cached URLs when terminal writeback is retried', async () => {
    mocks.cacheRemoteUrls.mockResolvedValue([
      '/__aitu_cache__/image/submission-1.png',
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

    const result = {
      status: 'succeeded',
      requestId: 'submission-1',
      url: 'https://images.example.com/retry-cache.png',
      urls: ['https://images.example.com/retry-cache.png'],
    };
    await expect(
      mocks.recoveryCallbacks?.onSucceeded(result, new AbortController().signal)
    ).rejects.toThrow('恢复图片结果写入失败，稍后重试');
    await expect(
      mocks.recoveryCallbacks?.onSucceeded(result, new AbortController().signal)
    ).rejects.toThrow('恢复图片结果写入失败，稍后重试');

    expect(mocks.cacheRemoteUrls).toHaveBeenCalledTimes(1);
    expect(mocks.completeImageAttempt).toHaveBeenCalledTimes(2);
    unmount();
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
      await mocks.recoveryCallbacks?.onSucceeded(
        {
          status: 'succeeded',
          requestId: 'submission-1',
          url: 'https://images.example.com/stale.png',
          urls: ['https://images.example.com/stale.png'],
        },
        new AbortController().signal
      );
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
      mocks.recoveryCallbacks?.onSucceeded(
        {
          status: 'succeeded',
          requestId: 'submission-1',
          url: 'https://images.example.com/retry-writeback.png',
          urls: ['https://images.example.com/retry-writeback.png'],
        },
        new AbortController().signal
      )
    ).rejects.toThrow('恢复图片结果写入失败，稍后重试');

    expect(mocks.currentTask?.status).toBe(TaskStatus.PROCESSING);
    unmount();
  });

  it('retries terminal delivery when completion reports success but the current task is still processing', async () => {
    mocks.cacheRemoteUrls.mockResolvedValue([
      'https://images.example.com/readback-processing.png',
    ]);
    mocks.completeImageAttempt.mockResolvedValue(true);
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
      mocks.recoveryCallbacks?.onSucceeded(
        {
          status: 'succeeded',
          requestId: 'submission-1',
          url: 'https://images.example.com/readback-processing.png',
          urls: ['https://images.example.com/readback-processing.png'],
        },
        new AbortController().signal
      )
    ).rejects.toThrow('恢复图片结果尚未写入完成，稍后重试');

    expect(mocks.currentTask?.status).toBe(TaskStatus.PROCESSING);
    unmount();
  });

  it('does not let the task timeout preempt a pending terminal writeback', async () => {
    vi.useFakeTimers();
    mocks.isTaskTimeout.mockReturnValue(true);
    mocks.hasPendingTerminalWriteback.mockReturnValue(true);

    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mocks.hasPendingTerminalWriteback).toHaveBeenCalledWith(
      'recover-image-1'
    );
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();

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

    expect(mocks.failImageAttempt).toHaveBeenCalledWith(
      'recover-image-1',
      'submission-1',
      expect.objectContaining({ code: 'TIMEOUT' })
    );
    expect(mocks.cancelRequest).toHaveBeenCalledWith('recover-image-1');

    unmount();
  });

  it('keeps at most one timeout writeback pending per image task', async () => {
    vi.useFakeTimers();
    mocks.currentTask = {
      ...createRecoveringTask(),
      executionPhase: TaskExecutionPhase.SUBMITTING,
    };
    mocks.isTaskTimeout.mockReturnValue(true);
    mocks.failImageAttempt.mockReturnValue(new Promise<boolean>(() => {}));

    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mocks.failImageAttempt).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not execute a queued chat task after it is cancelled', async () => {
    const tasks = Array.from({ length: 21 }, (_, index) =>
      createPendingChatTask(
        `chat-${index + 1}`,
        index === 20 ? 'cancelled while queued' : `blocker-${index + 1}`
      )
    );
    mocks.currentTask = null;
    mocks.allTasks = tasks;
    tasks.forEach((task) =>
      mocks.taskExecutionTokens.set(task.id, Symbol(task.id))
    );
    mocks.generate.mockImplementation(() => new Promise(() => undefined));

    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());
    act(() => {
      mocks.taskListener?.({ type: 'taskCreated', task: tasks[0] });
    });
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(20));

    const cancelled = { ...tasks[20], status: TaskStatus.CANCELLED };
    mocks.allTasks = mocks.allTasks.map((task) =>
      task.id === cancelled.id ? cancelled : task
    );
    act(() => {
      mocks.taskListener?.({ type: 'taskUpdated', task: cancelled });
    });

    expect(mocks.generate).toHaveBeenCalledTimes(20);
    expect(mocks.generate).not.toHaveBeenCalledWith(
      'chat-21',
      expect.anything(),
      TaskType.CHAT
    );
    unmount();
  });

  it('executes only the newer same-id replacement after a queue slot opens', async () => {
    const tasks = Array.from({ length: 21 }, (_, index) =>
      createPendingChatTask(
        `chat-${index + 1}`,
        index === 20 ? 'old queued prompt' : `blocker-${index + 1}`
      )
    );
    const resolvers = new Map<string, (result: any) => void>();
    mocks.currentTask = null;
    mocks.allTasks = tasks;
    tasks.forEach((task) =>
      mocks.taskExecutionTokens.set(task.id, Symbol(task.id))
    );
    mocks.generate.mockImplementation(
      (taskId: string) =>
        new Promise((resolve) => {
          resolvers.set(taskId, resolve);
        })
    );

    const { useTaskExecutor } = await import('../useTaskExecutor');
    const { unmount } = renderHook(() => useTaskExecutor());
    act(() => {
      mocks.taskListener?.({ type: 'taskCreated', task: tasks[0] });
    });
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(20));

    const replacement = {
      ...tasks[20],
      params: { ...tasks[20].params, prompt: 'new queued prompt' },
      updatedAt: tasks[20].updatedAt + 1,
    };
    mocks.allTasks = mocks.allTasks.map((task) =>
      task.id === replacement.id ? replacement : task
    );
    mocks.taskExecutionTokens.set(replacement.id, Symbol('replacement'));
    act(() => {
      mocks.taskListener?.({ type: 'taskUpdated', task: replacement });
    });
    await act(async () => {
      resolvers.get('chat-1')?.({});
    });

    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(21));
    expect(mocks.generate).toHaveBeenLastCalledWith(
      'chat-21',
      expect.objectContaining({ prompt: 'new queued prompt' }),
      TaskType.CHAT
    );
    expect(
      mocks.generate.mock.calls.some(
        ([taskId, params]) =>
          taskId === 'chat-21' && params.prompt === 'old queued prompt'
      )
    ).toBe(false);
    unmount();
  });
});
