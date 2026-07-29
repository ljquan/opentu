import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
} from '../../types/task.types';
import type { Task } from '../../types/task.types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function flushAsyncWork(turns = 6): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function setupTaskQueueServiceHarness(
  statusSequence: TaskStatus[],
  options: {
    trustedImageRecovery?: boolean;
    hasCredentials?: boolean;
    timedOutImageRecovery?: boolean;
  } = {}
) {
  const storedTasks = new Map<string, any>();
  let generatedTaskIdCount = 0;
  const updateStoredImageAttempt = async (
    taskId: string,
    requestId: string,
    update: (task: any) => void,
    updateOptions: {
      allowPending?: boolean;
      allowFailed?: boolean;
      expectedErrorCodes?: readonly string[];
      allowLegacyRequestId?: boolean;
    } = {}
  ) => {
    const task = storedTasks.get(taskId);
    const requestIdMatches =
      task?.params.submissionRequestId === requestId ||
      (updateOptions.allowLegacyRequestId &&
        task?.params.submissionRequestId === undefined &&
        task?.id === requestId);
    if (
      !task ||
      task.type !== TaskType.IMAGE ||
      (task.status !== TaskStatus.PROCESSING &&
        (!updateOptions.allowPending || task.status !== TaskStatus.PENDING) &&
        (!updateOptions.allowFailed ||
          task.status !== TaskStatus.FAILED ||
          !updateOptions.expectedErrorCodes?.includes(
            task.error?.code || ''
          ))) ||
      !requestIdMatches
    ) {
      return false;
    }
    const updatedTask = clone(task);
    update(updatedTask);
    storedTasks.set(taskId, updatedTask);
    return true;
  };

  const mocks = {
    saveTask: vi.fn(async (task: any) => {
      storedTasks.set(task.id, clone(task));
    }),
    getStoredTask: vi.fn(async (taskId: string) => {
      const task = storedTasks.get(taskId);
      return task ? clone(task) : null;
    }),
    deleteTask: vi.fn(async (taskId: string) => {
      storedTasks.delete(taskId);
    }),
    archiveTasks: vi.fn(async () => {}),
    updateStatus: vi.fn(
      async (
        taskId: string,
        status: TaskStatus,
        requestId: string,
        updateOptions: { allowLegacyRequestId?: boolean } = {}
      ) =>
        updateStoredImageAttempt(
          taskId,
          requestId,
          (task) => {
            task.status = status;
          },
          { allowPending: true, ...updateOptions }
        )
    ),
    markImageSubmissionAttempted: vi.fn(
      async (taskId: string, requestId: string) =>
        updateStoredImageAttempt(
          taskId,
          requestId,
          (task) => {
            task.status = TaskStatus.PROCESSING;
            task.params.imageSubmissionAttempted = true;
            task.executionPhase = TaskExecutionPhase.POLLING;
          },
          { allowPending: true }
        )
    ),
    updateProgress: vi.fn(
      async (
        taskId: string,
        progress: number,
        phase: string | undefined,
        requestId: string
      ) =>
        updateStoredImageAttempt(
          taskId,
          requestId,
          (task) => {
            task.progress = progress;
            task.executionPhase = phase;
          },
          { allowPending: true }
        )
    ),
    updateRemoteId: vi.fn(
      async (
        taskId: string,
        remoteId: string,
        invocationRoute: Task['invocationRoute'],
        requestId: string
      ) =>
        updateStoredImageAttempt(taskId, requestId, (task) => {
          task.remoteId = remoteId;
          task.invocationRoute = invocationRoute;
          task.executionPhase = TaskExecutionPhase.POLLING;
        })
    ),
    markImageAttemptRecovering: vi.fn(
      async (
        taskId: string,
        requestId: string,
        updateOptions: {
          allowFailed?: boolean;
          expectedErrorCodes?: readonly string[];
          migrateLegacy?: boolean;
          timeoutRecoveryAttemptedAt?: number;
        } = {}
      ) =>
        updateStoredImageAttempt(
          taskId,
          requestId,
          (task) => {
            task.status = TaskStatus.PROCESSING;
            task.error = undefined;
            task.completedAt = undefined;
            task.executionPhase = TaskExecutionPhase.POLLING;
            task.progress = undefined;
            if (updateOptions.migrateLegacy) {
              task.params.submissionRequestId = requestId;
              task.params.imageSubmissionAttempted = true;
            }
            if (
              typeof updateOptions.timeoutRecoveryAttemptedAt === 'number'
            ) {
              task.params.imageTimeoutRecoveryAttemptedAt =
                updateOptions.timeoutRecoveryAttemptedAt;
            }
          },
          {
            allowFailed: updateOptions.allowFailed,
            expectedErrorCodes: updateOptions.expectedErrorCodes,
            allowLegacyRequestId: updateOptions.migrateLegacy,
          }
        )
    ),
    completeTask: vi.fn(
      async (taskId: string, result: Task['result'], requestId: string) =>
        updateStoredImageAttempt(taskId, requestId, (task) => {
          task.status = TaskStatus.COMPLETED;
          task.result = result;
          task.error = undefined;
          task.progress = 100;
          task.executionPhase = undefined;
        })
    ),
    failTask: vi.fn(
      async (
        taskId: string,
        error: Task['error'],
        requestId: string,
        updateOptions: {
          allowPending?: boolean;
          allowLegacyRequestId?: boolean;
          clearStartedAt?: boolean;
        } = {}
      ) =>
        updateStoredImageAttempt(
          taskId,
          requestId,
          (task) => {
            task.status = TaskStatus.FAILED;
            task.error = error;
            task.executionPhase = undefined;
            if (updateOptions.clearStartedAt) {
              task.startedAt = undefined;
            }
          },
          updateOptions
        )
    ),
    invalidateCache: vi.fn(),
    generateImage: vi.fn(async (_params?: any, _options?: any) => undefined),
    hasInvocationRouteCredentials: vi.fn(
      () => options.hasCredentials !== false
    ),
  };

  const waitForTaskCompletion = vi.fn(async (taskId: string, options?: any) => {
    const currentTask = storedTasks.get(taskId);
    if (!currentTask) {
      return { success: false, error: 'missing-task' };
    }

    const callIndex = waitForTaskCompletion.mock.calls.length - 1;
    const nextStatus =
      statusSequence[callIndex] || statusSequence[statusSequence.length - 1];
    const now = Date.now();
    const updatedTask =
      nextStatus === TaskStatus.COMPLETED
        ? {
            ...clone(currentTask),
            status: TaskStatus.COMPLETED,
            updatedAt: now,
            completedAt: now,
            progress: 100,
            result: {
              url: 'https://example.com/out.png',
              format: 'png',
              size: 1,
            },
          }
        : {
            ...clone(currentTask),
            status: TaskStatus.FAILED,
            updatedAt: now,
            completedAt: now,
            error: {
              code: 'EXECUTION_ERROR',
              message: 'Image generation failed',
            },
          };

    storedTasks.set(taskId, clone(updatedTask));
    options?.onProgress?.(clone(updatedTask));

    return nextStatus === TaskStatus.COMPLETED
      ? { success: true, task: clone(updatedTask) }
      : {
          success: false,
          task: clone(updatedTask),
          error: updatedTask.error?.message || 'failed',
        };
  });

  vi.doMock('../media-executor/task-storage-writer', () => ({
    taskStorageWriter: {
      saveTask: mocks.saveTask,
      getTask: mocks.getStoredTask,
      deleteTask: mocks.deleteTask,
      archiveTasks: mocks.archiveTasks,
      updateStatus: mocks.updateStatus,
      markImageSubmissionAttempted: mocks.markImageSubmissionAttempted,
      updateProgress: mocks.updateProgress,
      updateRemoteId: mocks.updateRemoteId,
      markImageAttemptRecovering: mocks.markImageAttemptRecovering,
      completeTask: mocks.completeTask,
      failTask: mocks.failTask,
    },
  }));

  vi.doMock('../task-storage-reader', () => ({
    taskStorageReader: {
      invalidateCache: mocks.invalidateCache,
      getTask: vi.fn(async (taskId: string) => {
        const task = storedTasks.get(taskId);
        return task ? clone(task) : null;
      }),
      getAllTasks: vi.fn(async () => []),
    },
  }));

  vi.doMock('../media-executor', () => ({
    executorFactory: {
      getExecutor: vi.fn(async () => ({
        generateImage: mocks.generateImage,
      })),
    },
    waitForTaskCompletion,
  }));

  vi.doMock('../../utils/settings-manager', () => ({
    hasInvocationRouteCredentials: mocks.hasInvocationRouteCredentials,
    createModelRef: (profileId?: string | null, modelId?: string | null) =>
      profileId || modelId
        ? {
            profileId: profileId || null,
            modelId: modelId || null,
          }
        : null,
    resolveInvocationRoute: vi.fn((operation: string, routeModel?: any) => ({
      routeType: operation,
      modelId:
        typeof routeModel === 'string'
          ? routeModel
          : routeModel?.modelId || 'default-model',
      profileId:
        typeof routeModel === 'object' ? routeModel?.profileId || null : null,
      profileName: null,
      providerType: null,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      source: 'legacy',
    })),
    providerProfilesSettings: {
      get: vi.fn(() => []),
    },
    providerPricingCacheSettings: {
      get: vi.fn(() => []),
      set: vi.fn(),
    },
  }));

  vi.doMock('../provider-routing', () => ({
    providerTransport: {
      prepareRequest: vi.fn(),
    },
    resolveInvocationPlanFromRoute: vi.fn(
      (operation: string, routeModel?: any) => {
        const profileId =
          typeof routeModel === 'object' ? routeModel?.profileId : null;
        if (!profileId) {
          return null;
        }

        const modelId =
          typeof routeModel === 'string'
            ? routeModel
            : routeModel?.modelId || 'default-model';
        return {
          provider: {
            profileId,
            profileName: profileId,
            providerType: 'custom',
            baseUrl: options.trustedImageRecovery
              ? 'https://api.tu-zi.com/v1'
              : 'https://api.example.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
          },
          modelRef: {
            profileId,
            modelId,
          },
          binding: {
            id: `${profileId}:${modelId}:${operation}`,
            profileId,
            modelId,
            operation,
            protocol: options.trustedImageRecovery
              ? 'openai.images.generations'
              : 'openai.async.video',
            requestSchema: options.trustedImageRecovery
              ? 'tuzi.image.gpt-generation-json'
              : 'openai.video.form-input-reference',
            responseSchema: options.trustedImageRecovery
              ? 'openai.image.url'
              : 'openai.async.task',
            submitPath: options.trustedImageRecovery
              ? '/images/generations'
              : '/videos',
            pollPathTemplate: options.trustedImageRecovery
              ? undefined
              : '/videos/{taskId}',
            priority: 100,
            confidence: 'high',
            source: 'template',
          },
        };
      }
    ),
  }));

  vi.doMock('../../utils/posthog-analytics', () => ({
    analytics: {
      track: vi.fn(),
      trackModelCall: vi.fn(),
      trackModelSuccess: vi.fn(),
      trackModelFailure: vi.fn(),
      trackTaskCancellation: vi.fn(),
    },
  }));

  vi.doMock('../model-adapters', () => ({
    getAdapterContextFromSettings: vi.fn(),
    resolveAdapterForInvocation: vi.fn(),
  }));

  vi.doMock('../unified-cache-service', () => ({
    unifiedCacheService: {
      getImageForAI: vi.fn(),
      isCached: vi.fn(async () => false),
      cacheMediaFromBlob: vi.fn(async () => {}),
    },
  }));

  vi.doMock('../analysis-core', () => ({
    buildGenerateContentConfig: vi.fn(() => ({})),
  }));

  vi.doMock('../video-analysis-service', () => ({
    executeVideoAnalysis: vi.fn(),
  }));

  vi.doMock('../music-analysis-service', () => ({
    DEFAULT_MUSIC_ANALYSIS_PROMPT: 'default',
    executeMusicAnalysis: vi.fn(),
    MAX_AUDIO_ANALYZE_FILE_SIZE: 1024,
  }));

  vi.doMock('../../utils/gemini-api/services', () => ({
    sendChatWithGemini: vi.fn(),
  }));

  vi.doMock('../../utils/gemini-api/message-utils', () => ({
    buildInlineDataPart: vi.fn(),
  }));

  vi.doMock('../../utils/gemini-api/logged-calls', () => ({
    callGoogleGenerateContentWithLog: vi.fn(),
  }));

  vi.doMock('../../components/video-analyzer/storage', () => ({
    loadRecords: vi.fn(async () => []),
  }));

  vi.doMock('../../components/video-analyzer/utils', () => ({
    applyRewriteShotUpdates: vi.fn(),
    parseRewriteShotUpdates: vi.fn(),
  }));

  vi.doMock('../../components/music-analyzer/storage', () => ({
    loadRecords: vi.fn(async () => []),
  }));

  vi.doMock('../../components/music-analyzer/utils', () => ({
    parseLyricsRewriteResult: vi.fn(),
  }));

  vi.doMock('../../utils/task-utils', async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../../utils/task-utils')
    >();

    return {
      ...actual,
      generateTaskId: () => {
        generatedTaskIdCount += 1;
        return generatedTaskIdCount === 1
          ? 'task-image-edit-1'
          : `image-submission-${generatedTaskIdCount}`;
      },
    };
  });

  vi.doMock('../image-generation-recovery-service', async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../image-generation-recovery-service')
    >();

    return {
      ...actual,
      isTimedOutImageRequestRecoveryTask: options.timedOutImageRecovery
        ? vi.fn(() => true)
        : actual.isTimedOutImageRequestRecoveryTask,
    };
  });

  const { taskQueueService } = await import('../task-queue-service');

  return {
    taskQueueService,
    storedTasks,
    mocks: {
      ...mocks,
      waitForTaskCompletion,
    },
  };
}

describe('task-queue-service image edit retry persistence', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('keeps stripped image edit params in IndexedDB so retry can rehydrate them', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([
        TaskStatus.FAILED,
        TaskStatus.COMPLETED,
      ]);

    const task = taskQueueService.createTask(
      {
        prompt: 'Edit this image',
        model: 'gpt-image-2',
        size: '1x1',
        generationMode: 'image_to_image',
        referenceImages: ['data:image/png;base64,source'],
        maskImage: 'data:image/png;base64,mask',
        outputFormat: 'png',
      },
      TaskType.IMAGE
    );

    await vi.waitFor(
      () =>
        expect(taskQueueService.getTask(task.id)?.status).toBe(
          TaskStatus.FAILED
        ),
      { timeout: 3000 }
    );

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(
      taskQueueService.getTask(task.id)?.params.referenceImages
    ).toBeUndefined();
    expect(storedTasks.get(task.id)?.params.referenceImages).toEqual([
      'data:image/png;base64,source',
    ]);

    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]?.taskId).toBe(task.id);
    expect(mocks.generateImage.mock.calls[0]?.[0]?.requestId).toBe(task.id);
    expect(mocks.generateImage.mock.calls[1]?.[0]?.requestId).not.toBe(task.id);
    expect(mocks.generateImage.mock.calls[1]?.[0]?.requestId).not.toBe(
      mocks.generateImage.mock.calls[0]?.[0]?.requestId
    );
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      generationMode: 'image_to_image',
      referenceImages: ['data:image/png;base64,source'],
      maskImage: 'data:image/png;base64,mask',
      outputFormat: 'png',
    });
    expect(storedTasks.get(task.id)?.params.referenceImages).toEqual([
      'data:image/png;base64,source',
    ]);
  });

  it('keeps an attempted trusted Tuzi submission processing after an ambiguous disconnect', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.FAILED], {
        trustedImageRecovery: true,
      });
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      expect(storedTasks.get('task-image-edit-1')?.params).toMatchObject({
        imageSubmissionAttempted: true,
      });
      throw new Error('Failed to fetch');
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Recover this image',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      executionPhase: TaskExecutionPhase.POLLING,
      error: undefined,
      params: {
        imageSubmissionAttempted: true,
      },
    });
    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();
  });

  it('starts read-only recovery eligibility before the original POST response settles', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED], {
        trustedImageRecovery: true,
      });
    let resolveOriginalPost!: () => void;
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      await new Promise<void>((resolve) => {
        resolveOriginalPost = resolve;
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Poll while the original response is still pending',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      },
      TaskType.IMAGE
    );
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)).toMatchObject({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.POLLING,
        params: { imageSubmissionAttempted: true },
      })
    );
    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      executionPhase: TaskExecutionPhase.POLLING,
    });
    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();

    resolveOriginalPost();
    await flushAsyncWork();
  });

  it('does not report image completion when the same Request ID reads back as processing', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-readback-processing',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      params: {
        prompt: 'Verify terminal readback',
        submissionRequestId: 'request-current',
        imageSubmissionAttempted: true,
      },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
      executionPhase: TaskExecutionPhase.POLLING,
    };
    taskQueueService.trackExternalTask(clone(task));
    await flushAsyncWork();
    mocks.completeTask.mockResolvedValueOnce(true);

    await expect(
      taskQueueService.completeImageAttempt(task.id, 'request-current', {
        url: 'https://example.com/not-committed.png',
        format: 'png',
        size: 0,
      })
    ).resolves.toBe(false);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.PROCESSING
    );
  });

  it('starts extended read-only recovery when the live image execution reaches its timeout', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.FAILED], {
        trustedImageRecovery: true,
        timedOutImageRecovery: true,
      });
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      const error = new Error('Image execution timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Recover this timed out image',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      task.id,
      task.id,
      { timeoutRecoveryAttemptedAt: expect.any(Number) }
    );
    await vi.waitFor(() =>
      expect(taskQueueService.getTask(task.id)).toMatchObject({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.POLLING,
        error: undefined,
        params: {
          imageTimeoutRecoveryAttemptedAt: expect.any(Number),
        },
      })
    );
    expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.PROCESSING);
    expect(mocks.failTask).not.toHaveBeenCalled();
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
  });

  it('hands a task-queue polling timeout to extended recovery without another POST', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.FAILED],
      {
        trustedImageRecovery: true,
        timedOutImageRecovery: true,
      }
    );
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
    });
    mocks.waitForTaskCompletion.mockResolvedValueOnce({
      success: false,
      error: 'Polling timeout',
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Recover task queue timeout',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      task.id,
      task.id,
      { timeoutRecoveryAttemptedAt: expect.any(Number) }
    );
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.PROCESSING
    );
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.failTask).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer terminal state when timeout recovery loses the storage race', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.FAILED], {
        trustedImageRecovery: true,
        timedOutImageRecovery: true,
      });
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      throw new Error('Image execution timeout');
    });
    mocks.markImageAttemptRecovering.mockImplementationOnce(
      async (taskId: string) => {
        const current = clone(storedTasks.get(taskId));
        storedTasks.set(taskId, {
          ...current,
          status: TaskStatus.COMPLETED,
          progress: 100,
          result: { url: 'https://example.com/race-winner.png' },
        });
        return false;
      }
    );

    const task = taskQueueService.createTask(
      {
        prompt: 'Keep the terminal race winner',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.COMPLETED,
      result: { url: 'https://example.com/race-winner.png' },
    });
    expect(mocks.failTask).not.toHaveBeenCalled();
  });

  it('keeps the timed-out attempt active when the recovery marker write rejects', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.FAILED],
      {
        trustedImageRecovery: true,
        timedOutImageRecovery: true,
      }
    );
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      throw new Error('Image execution timeout');
    });
    mocks.markImageAttemptRecovering.mockRejectedValueOnce(
      new Error('IndexedDB temporarily unavailable')
    );

    const task = taskQueueService.createTask(
      {
        prompt: 'Retry timeout recovery persistence later',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.PROCESSING
    );
    expect(mocks.failTask).not.toHaveBeenCalled();
  });

  it('fails normally when the request breaks before the formal image submission attempt', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.FAILED],
      { trustedImageRecovery: true }
    );
    mocks.generateImage.mockRejectedValueOnce(new Error('Failed to fetch'));

    const task = taskQueueService.createTask(
      {
        prompt: 'Reference preprocessing fails',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.status).toBe(TaskStatus.FAILED);
    expect(taskQueueService.getTask(task.id)?.executionPhase).toBeUndefined();
  });

  it('does not let an old missing-credentials failure overwrite a newer cross-tab retry', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const newRequestId = 'request-new-tab';

    mocks.hasInvocationRouteCredentials.mockImplementationOnce(() => {
      const storedTask = storedTasks.get('task-image-edit-1');
      storedTasks.set('task-image-edit-1', {
        ...clone(storedTask),
        status: TaskStatus.PROCESSING,
        params: {
          ...storedTask?.params,
          submissionRequestId: newRequestId,
          imageSubmissionAttempted: true,
        },
        error: undefined,
        completedAt: undefined,
      });
      return false;
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Keep the newer retry when old credentials are missing',
        model: 'gpt-image-2',
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(mocks.failTask).toHaveBeenCalledWith(
      task.id,
      { code: 'NO_API_KEY', message: '未配置 API Key' },
      task.id,
      { allowLegacyRequestId: true }
    );
    expect(storedTasks.get(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      params: { submissionRequestId: newRequestId },
    });
    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      params: { submissionRequestId: newRequestId },
    });
  });

  it('checks IndexedDB even when the in-memory submission marker is already set', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const oldRequestId = 'request-old-tab';
    const newRequestId = 'request-new-tab';
    const task: Task = {
      id: 'task-cross-tab-marker',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      params: {
        prompt: 'Keep the newer browser tab attempt',
        submissionRequestId: oldRequestId,
        imageSubmissionAttempted: true,
      },
      createdAt: 1,
      updatedAt: 1,
    };

    taskQueueService.trackExternalTask(clone(task));
    await flushAsyncWork();
    storedTasks.set(task.id, {
      ...clone(task),
      params: {
        ...task.params,
        submissionRequestId: newRequestId,
        imageSubmissionAttempted: false,
      },
    });

    await expect(
      taskQueueService.markImageSubmissionAttempted(task.id, oldRequestId)
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(mocks.markImageSubmissionAttempted).toHaveBeenCalledWith(
      task.id,
      oldRequestId
    );
    expect(storedTasks.get(task.id)?.params).toMatchObject({
      submissionRequestId: newRequestId,
      imageSubmissionAttempted: false,
    });
    expect(taskQueueService.getTask(task.id)?.params).toMatchObject({
      submissionRequestId: newRequestId,
      imageSubmissionAttempted: false,
    });
  });

  it('allows explicit manual retry for completed image tasks and clears stale results', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
      TaskStatus.COMPLETED,
    ]);

    const task = taskQueueService.createTask(
      {
        prompt: 'Regenerate completed image',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.COMPLETED
    );
    expect(taskQueueService.getTask(task.id)?.result).toBeTruthy();

    taskQueueService.retryTask(task.id, { allowCompleted: true });

    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.PROCESSING
    );
    expect(taskQueueService.getTask(task.id)?.result).toBeUndefined();
    expect(taskQueueService.getTask(task.id)?.insertedToCanvas).toBe(false);

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      prompt: 'Regenerate completed image',
      model: 'gpt-image-2',
      size: '1x1',
    });
  });

  it('rehydrates stripped edit params after restoreTasks before retry execution', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);

    const restoredTask: Task = {
      id: 'task-image-edit-1',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: {
        prompt: 'Retry restored edit',
        model: 'gpt-image-2',
        size: '1x1',
        generationMode: 'image_to_image',
        referenceImages: ['data:image/png;base64,restored-source'],
        maskImage: 'data:image/png;base64,restored-mask',
      },
      createdAt: 1,
      updatedAt: 1,
      error: {
        code: 'EXECUTION_ERROR',
        message: 'Image generation failed',
      },
    };

    storedTasks.set(restoredTask.id, clone(restoredTask));

    taskQueueService.restoreTasks([clone(restoredTask)]);

    expect(
      taskQueueService.getTask(restoredTask.id)?.params.referenceImages
    ).toBeUndefined();

    taskQueueService.retryTask(restoredTask.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      generationMode: 'image_to_image',
      referenceImages: ['data:image/png;base64,restored-source'],
      maskImage: 'data:image/png;base64,restored-mask',
    });
  });

  it('keeps a cancelled active task from being overwritten by late executor completion', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishExecutor!: () => void;
    let capturedSignal: AbortSignal | undefined;
    let lateCompletionAccepted: boolean | undefined;

    mocks.generateImage.mockImplementationOnce(async (params, options) => {
      capturedSignal = options?.signal;
      await new Promise<void>((resolve) => {
        finishExecutor = resolve;
      });

      lateCompletionAccepted = await mocks.completeTask(
        'task-image-edit-1',
        {
          url: 'https://example.com/late.png',
          format: 'png',
          size: 1,
        },
        params.requestId
      );
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Cancel this image',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    taskQueueService.cancelTask(task.id);

    expect(capturedSignal?.aborted).toBe(true);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.CANCELLED
    );
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED)
    );

    finishExecutor();
    await flushAsyncWork();

    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();
    expect(lateCompletionAccepted).toBe(false);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.CANCELLED
    );
    expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED);
  });

  it('does not let an old tab cancel a newer cross-tab retry', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishOldExecutor!: () => void;

    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      await new Promise<void>((resolve) => {
        finishOldExecutor = resolve;
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Do not cancel the newer browser tab attempt',
        model: 'gpt-image-2',
      },
      TaskType.IMAGE
    );
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)?.params.imageSubmissionAttempted).toBe(
        true
      )
    );
    const oldRequestId = storedTasks.get(task.id)?.params.submissionRequestId;
    const newRequestId = 'request-retry-from-new-tab';
    storedTasks.set(task.id, {
      ...clone(storedTasks.get(task.id)),
      status: TaskStatus.PROCESSING,
      params: {
        ...storedTasks.get(task.id)?.params,
        submissionRequestId: newRequestId,
        imageSubmissionAttempted: true,
      },
      error: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    });

    taskQueueService.cancelTask(task.id);
    await vi.waitFor(() =>
      expect(taskQueueService.getTask(task.id)?.params.submissionRequestId).toBe(
        newRequestId
      )
    );

    expect(mocks.updateStatus).toHaveBeenCalledWith(
      task.id,
      TaskStatus.CANCELLED,
      oldRequestId,
      { allowLegacyRequestId: true }
    );
    expect(storedTasks.get(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      params: { submissionRequestId: newRequestId },
    });
    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      params: { submissionRequestId: newRequestId },
    });

    finishOldExecutor();
    await flushAsyncWork();
  });

  it('unblocks terminal metadata when cancellation loses the same-attempt race', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishExecutor!: () => void;

    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      await new Promise<void>((resolve) => {
        finishExecutor = resolve;
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Keep terminal metadata writable',
        model: 'gpt-image-2',
      },
      TaskType.IMAGE
    );
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)?.params.imageSubmissionAttempted).toBe(
        true
      )
    );
    const requestId = storedTasks.get(task.id)?.params.submissionRequestId;
    expect(
      await mocks.completeTask(
        task.id,
        {
          url: 'https://example.com/completed-first.png',
          format: 'png',
          size: 1,
        },
        requestId
      )
    ).toBe(true);

    taskQueueService.cancelTask(task.id);
    await vi.waitFor(() =>
      expect(taskQueueService.getTask(task.id)?.status).toBe(
        TaskStatus.COMPLETED
      )
    );

    taskQueueService.markAsSaved(task.id);
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)?.savedToLibrary).toBe(true)
    );

    finishExecutor();
    await flushAsyncWork();
    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.COMPLETED,
      savedToLibrary: true,
    });
  });

  it('does not let an old cancelled executor overwrite a newer cross-tab retry', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishOldExecutor!: () => void;

    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      await new Promise<void>((resolve) => {
        finishOldExecutor = resolve;
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Retry this image from another tab',
        model: 'gpt-image-2',
      },
      TaskType.IMAGE
    );
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)?.params.imageSubmissionAttempted).toBe(
        true
      )
    );
    const oldRequestId = storedTasks.get(task.id)?.params.submissionRequestId;

    taskQueueService.cancelTask(task.id);
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED)
    );

    const newRequestId = 'request-retry-from-new-tab';
    storedTasks.set(task.id, {
      ...clone(storedTasks.get(task.id)),
      status: TaskStatus.PROCESSING,
      params: {
        ...storedTasks.get(task.id)?.params,
        submissionRequestId: newRequestId,
        imageSubmissionAttempted: true,
      },
      error: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    });

    finishOldExecutor();
    await flushAsyncWork();

    expect(mocks.updateStatus).toHaveBeenCalledWith(
      task.id,
      TaskStatus.CANCELLED,
      oldRequestId,
      { allowLegacyRequestId: true }
    );
    expect(storedTasks.get(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      params: {
        submissionRequestId: newRequestId,
        imageSubmissionAttempted: true,
      },
    });
    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      params: {
        submissionRequestId: newRequestId,
      },
    });
  });

  it('starts an immediate retry with a new Request ID and ignores the old attempt', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let releaseFirstAttempt!: () => void;

    mocks.generateImage
      .mockImplementationOnce(async (_params, options) => {
        await options?.onSubmissionAttempt?.();
        await new Promise<void>((resolve) => {
          releaseFirstAttempt = resolve;
        });
      })
      .mockImplementationOnce(async (_params, options) => {
        await options?.onSubmissionAttempt?.();
      });

    const task = taskQueueService.createTask(
      {
        prompt: 'Retry without waiting for the old request',
        model: 'gpt-image-2',
      },
      TaskType.IMAGE
    );

    await vi.waitFor(() =>
      expect(mocks.generateImage).toHaveBeenCalledTimes(1)
    );
    const firstRequestId = mocks.generateImage.mock.calls[0]?.[0]?.requestId;

    taskQueueService.cancelTask(task.id);
    taskQueueService.retryTask(task.id);

    await vi.waitFor(() =>
      expect(mocks.generateImage).toHaveBeenCalledTimes(2)
    );
    const secondRequestId = mocks.generateImage.mock.calls[1]?.[0]?.requestId;
    expect(secondRequestId).not.toBe(firstRequestId);
    await vi.waitFor(() =>
      expect(taskQueueService.getTask(task.id)?.status).toBe(
        TaskStatus.COMPLETED
      )
    );

    releaseFirstAttempt();
    await flushAsyncWork();

    expect(mocks.waitForTaskCompletion).toHaveBeenCalledTimes(1);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.COMPLETED
    );
    expect(storedTasks.get(task.id)?.params).toMatchObject({
      submissionRequestId: secondRequestId,
      imageSubmissionAttempted: true,
    });
  });

  it('does not let an old pre-submit callback mark or send the new retry attempt', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishOldPreprocessing!: () => void;
    let oldPostSent = false;

    mocks.generateImage
      .mockImplementationOnce(async (_params, options) => {
        await new Promise<void>((resolve) => {
          finishOldPreprocessing = resolve;
        });
        await options?.onSubmissionAttempt?.();
        oldPostSent = true;
      })
      .mockImplementationOnce(async (_params, options) => {
        await options?.onSubmissionAttempt?.();
      });

    const task = taskQueueService.createTask(
      {
        prompt: 'Replace the request during preprocessing',
        model: 'gpt-image-2',
      },
      TaskType.IMAGE
    );
    await vi.waitFor(() =>
      expect(mocks.generateImage).toHaveBeenCalledTimes(1)
    );

    taskQueueService.cancelTask(task.id);
    taskQueueService.retryTask(task.id);
    await vi.waitFor(() =>
      expect(mocks.generateImage).toHaveBeenCalledTimes(2)
    );
    const retryRequestId = mocks.generateImage.mock.calls[1]?.[0]?.requestId;
    await vi.waitFor(() =>
      expect(taskQueueService.getTask(task.id)?.status).toBe(
        TaskStatus.COMPLETED
      )
    );

    finishOldPreprocessing();
    await flushAsyncWork();

    expect(oldPostSent).toBe(false);
    expect(storedTasks.get(task.id)?.params).toMatchObject({
      submissionRequestId: retryRequestId,
      imageSubmissionAttempted: true,
    });
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.COMPLETED
    );
  });

  it('emits storage sync updates when completed result or insertion flag changes without status progress changes', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-storage-sync-1',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      progress: 100,
      params: {
        prompt: 'Sync completed storage task',
        autoInsertToCanvas: true,
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const updatedTasks: Task[] = [];

    taskQueueService.trackExternalTask(clone(task));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskUpdated') {
          updatedTasks.push(event.task);
        }
      });

    taskQueueService.syncTaskFromStorage(task.id, {
      status: TaskStatus.COMPLETED,
      progress: 100,
      completedAt: 2,
      result: {
        url: 'https://example.com/storage-result.png',
        format: 'png',
        size: 1,
      },
    });
    taskQueueService.syncTaskFromStorage(task.id, {
      status: TaskStatus.COMPLETED,
      progress: 100,
      insertedToCanvas: true,
    });

    expect(updatedTasks).toHaveLength(2);
    expect(taskQueueService.getTask(task.id)?.result?.url).toBe(
      'https://example.com/storage-result.png'
    );
    expect(taskQueueService.getTask(task.id)?.insertedToCanvas).toBe(true);

    subscription.unsubscribe();
  });

  it('persists invocation route for externally tracked video tasks', async () => {
    const { taskQueueService, storedTasks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const task: Task = {
      id: 'task-video-route-1',
      type: TaskType.VIDEO,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-video-1',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        prompt: 'Resume original provider',
        model: 'happyhorse-1.0-t2v',
        modelRef: {
          profileId: 'happyhorse-profile',
          modelId: 'happyhorse-1.0-t2v',
        },
      },
      createdAt: 1,
      updatedAt: 1,
    };

    taskQueueService.trackExternalTask(clone(task));
    await flushAsyncWork();

    const stored = storedTasks.get(task.id);
    expect(stored?.remoteId).toBe('remote-video-1');
    expect(stored?.executionPhase).toBe('polling');
    expect(stored?.params.modelRef).toEqual({
      profileId: 'happyhorse-profile',
      modelId: 'happyhorse-1.0-t2v',
    });
    expect(stored?.invocationRoute).toMatchObject({
      operation: 'video',
      providerProfileId: 'happyhorse-profile',
      modelId: 'happyhorse-1.0-t2v',
      binding: {
        id: 'happyhorse-profile:happyhorse-1.0-t2v:video',
        pollPathTemplate: '/videos/{taskId}',
      },
    });
  });

  it('emits storage sync updates when invocation route changes', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-video-route-sync-1',
      type: TaskType.VIDEO,
      status: TaskStatus.PROCESSING,
      params: {
        prompt: 'Sync route',
        model: 'happyhorse-1.0-t2v',
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const updatedTasks: Task[] = [];

    taskQueueService.trackExternalTask(clone(task));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskUpdated') {
          updatedTasks.push(event.task);
        }
      });

    taskQueueService.syncTaskFromStorage(task.id, {
      invocationRoute: {
        operation: 'video',
        providerProfileId: 'happyhorse-profile',
        modelId: 'happyhorse-1.0-t2v',
        binding: {
          id: 'happyhorse-profile:happyhorse-1.0-t2v:video',
          pollPathTemplate: '/videos/{taskId}',
        },
      },
    });

    expect(updatedTasks).toHaveLength(1);
    expect(
      taskQueueService.getTask(task.id)?.invocationRoute?.providerProfileId
    ).toBe('happyhorse-profile');

    subscription.unsubscribe();
  });
});
