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
    activeImageRoute?: {
      profileId: string;
      modelId: string;
    };
    customProfiles?: Array<{
      id: string;
      baseUrl: string;
      apiKey: string;
      enabled: boolean;
    }>;
  } = {}
) {
  const storedTasks = new Map<string, any>();

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
    pauseWrites: vi.fn(),
    clearAllTasks: vi.fn(async () => {
      storedTasks.clear();
    }),
    archiveTasks: vi.fn(async () => undefined),
    invalidateCache: vi.fn(),
    updateStatus: vi.fn(
      async (taskId: string, status: string, expectedRequestId?: string) => {
        const task = storedTasks.get(taskId);
        if (
          !task ||
          (expectedRequestId &&
            task.params?.submissionRequestId !== expectedRequestId)
        ) {
          return false;
        }
        storedTasks.set(taskId, {
          ...clone(task),
          status,
          updatedAt: Date.now(),
        });
        return true;
      }
    ),
    markImageSubmissionAttempted: vi.fn(
      async (
        taskId: string,
        expectedRequestId: string,
        invocationRoute?: Task['invocationRoute']
      ) => {
        const task = storedTasks.get(taskId);
        if (task?.params?.submissionRequestId !== expectedRequestId) {
          return false;
        }
        storedTasks.set(taskId, {
          ...clone(task),
          status: TaskStatus.PROCESSING,
          params: {
            ...clone(task.params),
            imageSubmissionAttempted: true,
          },
          executionPhase: TaskExecutionPhase.SUBMITTING,
          ...(invocationRoute
            ? { invocationRoute: clone(invocationRoute) }
            : {}),
          updatedAt: Date.now(),
        });
        return true;
      }
    ),
    markImageAttemptRecovering: vi.fn(
      async (
        taskId: string,
        expectedRequestId: string,
        options?: {
          expectedStartedAt?: number;
          shouldUpdate?: () => boolean;
        }
      ) => {
        const task = storedTasks.get(taskId);
        if (
          task?.status !== TaskStatus.PROCESSING ||
          task.params?.submissionRequestId !== expectedRequestId ||
          (options?.expectedStartedAt !== undefined &&
            (task.startedAt ?? task.createdAt) !== options.expectedStartedAt) ||
          (options?.shouldUpdate && !options.shouldUpdate())
        ) {
          return false;
        }
        storedTasks.set(taskId, {
          ...clone(task),
          status: TaskStatus.PROCESSING,
          executionPhase: TaskExecutionPhase.POLLING,
          error: undefined,
          updatedAt: Date.now(),
        });
        return true;
      }
    ),
    failTask: vi.fn(
      async (
        taskId: string,
        error: Task['error'],
        expectedRequestId?: string,
        options?: {
          expectedStartedAt?: number;
          shouldUpdate?: () => boolean;
        }
      ) => {
        const task = storedTasks.get(taskId);
        if (
          !task ||
          (expectedRequestId &&
            task.params?.submissionRequestId !== expectedRequestId) ||
          (options?.expectedStartedAt !== undefined &&
            (task.startedAt ?? task.createdAt) !== options.expectedStartedAt) ||
          (options?.shouldUpdate && !options.shouldUpdate())
        ) {
          return false;
        }
        storedTasks.set(taskId, {
          ...clone(task),
          status: TaskStatus.FAILED,
          error: clone(error),
          updatedAt: Date.now(),
          completedAt: Date.now(),
          executionPhase: undefined,
        });
        return true;
      }
    ),
    generateImage: vi.fn(async (_params?: any, _options?: any) => undefined),
    generateVideo: vi.fn(async (_params?: any, _options?: any) => undefined),
    generateText: vi.fn(async (_params?: any, _options?: any) => ({
      content: 'Generated response',
    })),
    generateAudio: vi.fn(async () => ({
      url: 'https://example.com/out.mp3',
      format: 'mp3',
    })),
    sendChatWithGemini: vi.fn(async () => ({
      choices: [{ message: { content: 'Generated response' } }],
    })),
    cacheRemoteUrl: vi.fn(async (url: string) => url),
    stopImageRecovery: vi.fn(),
    cancelPptExplainerRemoteTask: vi.fn(async () => undefined),
    cleanupPptExplainerTask: vi.fn(async () => undefined),
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
      updateStatus: mocks.updateStatus,
      markImageSubmissionAttempted: mocks.markImageSubmissionAttempted,
      markImageAttemptRecovering: mocks.markImageAttemptRecovering,
      failTask: mocks.failTask,
      deleteTask: mocks.deleteTask,
      pauseWrites: mocks.pauseWrites,
      clearAllTasks: mocks.clearAllTasks,
      archiveTasks: mocks.archiveTasks,
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
        generateVideo: mocks.generateVideo,
        generateText: mocks.generateText,
      })),
    },
    waitForTaskCompletion,
  }));

  vi.doMock('../../utils/settings-manager', () => ({
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
    hasInvocationRouteCredentials: vi.fn(() => true),
    createModelRef: (profileId?: string | null, modelId?: string | null) =>
      profileId || modelId
        ? {
            profileId: profileId || null,
            modelId: modelId || null,
          }
        : null,
    resolveInvocationRoute: vi.fn((operation: string, routeModel?: any) => {
      const activeRoute =
        operation === 'image' && !routeModel ? options.activeImageRoute : null;
      return {
        routeType: operation,
        modelId:
          activeRoute?.modelId ||
          (typeof routeModel === 'string'
            ? routeModel
            : routeModel?.modelId || 'default-model'),
        profileId:
          activeRoute?.profileId ||
          (typeof routeModel === 'object'
            ? routeModel?.profileId || null
            : null),
        profileName: null,
        providerType: null,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        source: activeRoute ? 'preset' : 'legacy',
      };
    }),
    providerProfilesSettings: {
      get: vi.fn(() => options.customProfiles || []),
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
            baseUrl: 'https://api.example.com/v1',
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
            protocol: 'openai.async.video',
            requestSchema: 'openai.video.form-input-reference',
            responseSchema: 'openai.async.task',
            submitPath: '/videos',
            pollPathTemplate: '/videos/{taskId}',
            priority: 100,
            confidence: 'high',
            source: 'template',
          },
        };
      }
    ),
    isImageSubmissionOutcomeUnknownError: (error: unknown) =>
      Boolean(
        error &&
          typeof error === 'object' &&
          (error as { code?: unknown }).code ===
            'IMAGE_SUBMISSION_OUTCOME_UNKNOWN'
      ),
  }));

  vi.doMock('../image-generation-recovery-service', async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../image-generation-recovery-service')
    >();
    return {
      ...actual,
      imageGenerationRecoveryService: {
        ...actual.imageGenerationRecoveryService,
        stop: mocks.stopImageRecovery,
      },
    };
  });

  vi.doMock('../../utils/umami-analytics', () => ({
    analytics: {
      track: vi.fn(),
      trackModelCall: vi.fn(),
      trackModelSuccess: vi.fn(),
      trackModelFailure: vi.fn(),
      trackTaskCancellation: vi.fn(),
    },
  }));

  vi.doMock('../model-adapters', () => ({
    getAdapterContextFromSettings: vi.fn(() => ({})),
    resolveAdapterForInvocation: vi.fn(() => ({
      kind: 'audio',
      generateAudio: mocks.generateAudio,
    })),
  }));

  vi.doMock('../media-executor/fallback-utils', () => ({
    cacheRemoteUrl: mocks.cacheRemoteUrl,
  }));

  vi.doMock('../ppt-explainer/orchestrator', () => ({
    cancelPptExplainerRemoteTask: mocks.cancelPptExplainerRemoteTask,
    cleanupPptExplainerTask: mocks.cleanupPptExplainerTask,
  }));

  vi.doMock('../unified-cache-service', () => ({
    unifiedCacheService: {
      getImageForAI: vi.fn(),
      isCached: vi.fn(async () => false),
      cacheMediaFromBlob: vi.fn(async () => undefined),
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
    sendChatWithGemini: mocks.sendChatWithGemini,
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
    parseScriptRewriteResponse: vi.fn(() => ({
      shots: [],
      hasCharacters: false,
    })),
    parseVideoPromptGenerationResponse: vi.fn(() => ({ shots: [] })),
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
      generateTaskId: () => 'task-image-edit-1',
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

function createPptExplainerLifecycleTask(
  id: string,
  status: TaskStatus,
  options: {
    remoteId?: string;
    cancelBinding?: boolean;
    updatedAt?: number;
  } = {}
): Task {
  return {
    id,
    type: TaskType.VIDEO,
    status,
    remoteId: options.remoteId,
    executionPhase:
      status === TaskStatus.PROCESSING
        ? options.remoteId
          ? TaskExecutionPhase.POLLING
          : TaskExecutionPhase.SUBMITTING
        : undefined,
    params: {
      prompt: `PPT explainer lifecycle ${id}`,
      model: 'video-model',
      pptExplainer: {
        schemaVersion: 1,
        jobId: `job-${id}`,
        source: 'pptx',
        stage:
          status === TaskStatus.CANCELLED
            ? 'cancelled'
            : status === TaskStatus.COMPLETED
            ? 'completed'
            : status === TaskStatus.FAILED
            ? 'failed'
            : options.remoteId
            ? 'polling'
            : 'submitting',
        remoteId: options.remoteId,
        idempotencyKey: `idem-${id}`,
        diagnostics: [],
        pptxImport: { status: 'completed' },
        originalRoute: {
          binding: {
            pptExplainer: options.cancelBinding
              ? { cancel: { method: 'POST' } }
              : {},
          },
        },
      },
    },
    createdAt: 1,
    updatedAt: options.updatedAt ?? 1,
    ...(status === TaskStatus.COMPLETED || status === TaskStatus.FAILED
      ? { completedAt: options.updatedAt ?? 1 }
      : {}),
  };
}

describe('task-queue-service image edit retry persistence', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports only a live in-page execution as active', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    mocks.generateImage.mockImplementation(() => new Promise(() => undefined));

    const task = taskQueueService.createTask(
      {
        prompt: 'Keep request in flight',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );
    await flushAsyncWork();

    expect(taskQueueService.isTaskExecutionActive(task.id)).toBe(true);

    taskQueueService.cancelTask(task.id);

    expect(taskQueueService.isTaskExecutionActive(task.id)).toBe(false);
  });

  it('does not start recovery when recovery state cannot be persisted', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const recoveryEvents: Array<{ task: Task; executionActive: boolean }> = [];
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.();
      throw Object.assign(new Error('submission response lost'), {
        code: 'IMAGE_SUBMISSION_OUTCOME_UNKNOWN',
      });
    });
    mocks.markImageAttemptRecovering
      .mockResolvedValueOnce(false)
      .mockRejectedValue(new Error('transient storage failure'));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (
          event.type === 'taskUpdated' &&
          event.task.executionPhase === TaskExecutionPhase.POLLING
        ) {
          recoveryEvents.push({
            task: event.task,
            executionActive: taskQueueService.isTaskExecutionActive(
              event.task.id
            ),
          });
        }
      });

    const task = taskQueueService.createTask(
      {
        prompt: 'Recover without a second POST',
        model: 'gpt-image-2',
        modelRef: {
          profileId: 'tuzi-profile',
          modelId: 'gpt-image-2',
        },
        size: '1x1',
      },
      TaskType.IMAGE
    );
    await vi.waitFor(() => {
      expect(mocks.markImageAttemptRecovering).toHaveBeenCalledTimes(3);
    });

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();
    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      executionPhase: TaskExecutionPhase.SUBMITTING,
      params: {
        imageSubmissionAttempted: true,
      },
    });
    expect(recoveryEvents).toEqual([]);
    expect(taskQueueService.isTaskExecutionActive(task.id)).toBe(false);

    subscription.unsubscribe();
  });

  it('persists the adapter-selected route with the formal submission marker', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const actualInvocationRoute: Task['invocationRoute'] = {
      operation: 'image',
      providerProfileId: 'tuzi-profile',
      modelId: 'gpt-image-2',
      binding: {
        id: 'tuzi-image-edit',
        protocol: 'openai.images.edits',
        submitPath: '/images/edits',
        baseUrlStrategy: 'ensure-v1',
      },
    };
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      await options?.onSubmissionAttempt?.(actualInvocationRoute);
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Persist the edit route',
        model: 'gpt-image-2',
        generationMode: 'image_edit',
        referenceImages: ['data:image/png;base64,source'],
      },
      TaskType.IMAGE
    );

    await vi.waitFor(() =>
      expect(mocks.markImageSubmissionAttempted).toHaveBeenCalledWith(
        task.id,
        expect.any(String),
        actualInvocationRoute
      )
    );
    expect(taskQueueService.getTask(task.id)).toMatchObject({
      invocationRoute: actualInvocationRoute,
      params: { imageSubmissionAttempted: true },
    });
  });

  it.each(['cancelled', 'deleted', 'replaced'] as const)(
    'stops recovery persistence retries after the attempt is %s',
    async (transition) => {
      const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
        TaskStatus.COMPLETED,
      ]);
      const requestId = 'request-current';
      const task: Task = {
        id: `recovery-${transition}`,
        type: TaskType.IMAGE,
        status: TaskStatus.PROCESSING,
        params: {
          prompt: 'Recover once',
          model: 'gpt-image-2',
          submissionRequestId: requestId,
          imageSubmissionAttempted: true,
        },
        executionPhase: TaskExecutionPhase.POLLING,
        createdAt: Date.now(),
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      taskQueueService.restoreTasks([task]);
      mocks.markImageAttemptRecovering.mockImplementationOnce(async () => {
        if (transition === 'cancelled') {
          taskQueueService.cancelTask(task.id);
        } else if (transition === 'deleted') {
          taskQueueService.deleteTask(task.id);
        } else {
          taskQueueService.restoreTasks([
            {
              ...task,
              params: {
                ...task.params,
                submissionRequestId: 'request-new',
              },
              updatedAt: task.updatedAt + 1,
            },
          ]);
        }
        throw new Error('transient storage failure');
      });

      await expect(
        taskQueueService.markImageAttemptRecovering(task.id, requestId)
      ).resolves.toBe(false);
      expect(mocks.markImageAttemptRecovering).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['recover', 'fail'] as const)(
    'rejects a late guarded settings %s write after a same-request-id replacement',
    async (operation) => {
      const { taskQueueService, storedTasks, mocks } =
        await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
      const task: Task = {
        id: `settings-${operation}-replacement`,
        type: TaskType.IMAGE,
        status: TaskStatus.PROCESSING,
        params: {
          prompt: 'Original recovery task',
          model: 'gpt-image-2',
          submissionRequestId: 'shared-request-id',
          imageSubmissionAttempted: true,
        },
        executionPhase: TaskExecutionPhase.SUBMITTING,
        createdAt: Date.now(),
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
      storedTasks.set(task.id, clone(task));
      await taskQueueService.restoreTasks([clone(task)]);
      const executionToken = taskQueueService.getTaskExecutionToken(task.id);
      expect(executionToken).toBeDefined();

      const replacement: Task = {
        ...task,
        params: {
          ...task.params,
          prompt: 'Replacement recovery task',
        },
        updatedAt: task.updatedAt + 1,
      };
      const installReplacement = async () => {
        storedTasks.set(task.id, clone(replacement));
        await taskQueueService.restoreTasks([clone(replacement)]);
      };

      if (operation === 'recover') {
        mocks.markImageAttemptRecovering.mockImplementationOnce(
          async (_taskId, _requestId, options) => {
            await installReplacement();
            return options?.shouldUpdate?.() ?? true;
          }
        );
        await expect(
          taskQueueService.markImageAttemptRecovering(
            task.id,
            'shared-request-id',
            { startedAt: task.startedAt!, executionToken: executionToken! }
          )
        ).resolves.toBe(false);
      } else {
        mocks.failTask.mockImplementationOnce(
          async (_taskId, _error, _requestId, options) => {
            await installReplacement();
            return options?.shouldUpdate?.() ?? true;
          }
        );
        await expect(
          taskQueueService.failImageAttempt(
            task.id,
            'shared-request-id',
            { code: 'RECOVERY_TIMEOUT', message: 'Recovery timed out' },
            {
              executionGuard: {
                startedAt: task.startedAt!,
                executionToken: executionToken!,
              },
            }
          )
        ).resolves.toBe(false);
      }

      expect(taskQueueService.getTask(task.id)).toMatchObject({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        params: { prompt: 'Replacement recovery task' },
      });
      expect(storedTasks.get(task.id)).toMatchObject({
        status: TaskStatus.PROCESSING,
        params: { prompt: 'Replacement recovery task' },
      });
    }
  );

  it('releases a settled deletion fence without letting an abort-ignoring execution overwrite a replacement', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishExecutor!: () => void;
    let releaseDelete!: () => void;
    let capturedSignal: AbortSignal | undefined;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      capturedSignal = options?.signal;
      await new Promise<void>((resolve) => {
        finishExecutor = resolve;
      });
    });
    mocks.deleteTask.mockImplementationOnce(async (taskId: string) => {
      await deleteGate;
      storedTasks.delete(taskId);
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Old execution',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );
    await vi.waitFor(() => expect(mocks.generateImage).toHaveBeenCalledOnce());

    taskQueueService.deleteTask(task.id);

    expect(capturedSignal?.aborted).toBe(true);
    expect(taskQueueService.getTask(task.id)).toBeUndefined();
    expect((taskQueueService as any).blockedTaskIds.has(task.id)).toBe(true);

    const replacement: Task = {
      ...task,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Replacement task', model: 'gpt-image-2' },
      result: {
        url: 'https://example.com/replacement.png',
        format: 'png',
        size: 1,
      },
      updatedAt: task.updatedAt + 1,
      completedAt: task.updatedAt + 1,
    };
    const restorePromise = taskQueueService.restoreTasks([clone(replacement)], {
      allowDeletedTaskRestore: true,
    });
    expect(taskQueueService.getTask(task.id)?.params.prompt).toBe(
      'Replacement task'
    );
    expect((taskQueueService as any).blockedTaskIds.has(task.id)).toBe(true);

    releaseDelete();
    await restorePromise;
    await vi.waitFor(() =>
      expect(storedTasks.get(task.id)?.result?.url).toBe(
        'https://example.com/replacement.png'
      )
    );

    finishExecutor();
    await flushAsyncWork();

    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();
    expect(taskQueueService.getTask(task.id)?.params.prompt).toBe(
      'Replacement task'
    );
    expect(storedTasks.get(task.id)?.result?.url).toBe(
      'https://example.com/replacement.png'
    );
  });

  it('persists an explicit same-id restore after an in-flight deletion', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const original: Task = {
      id: 'restore-after-delete',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Original task', model: 'gpt-image-2' },
      result: {
        url: 'https://example.com/original.png',
        format: 'png',
        size: 1,
      },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    };
    storedTasks.set(original.id, clone(original));
    taskQueueService.restoreTasks([clone(original)]);
    mocks.deleteTask.mockImplementationOnce(async (taskId: string) => {
      await deleteGate;
      storedTasks.delete(taskId);
    });

    taskQueueService.deleteTask(original.id);
    const restored: Task = {
      ...original,
      params: {
        prompt: 'Restored task',
        model: 'gpt-image-2',
        referenceImages: ['data:image/png;base64,restored-source'],
      },
      result: {
        url: 'https://example.com/restored.png',
        format: 'png',
        size: 1,
      },
      updatedAt: 2,
      completedAt: 2,
    };
    const restorePromise = taskQueueService.restoreTasks([clone(restored)], {
      allowDeletedTaskRestore: true,
    });

    expect(taskQueueService.getTask(original.id)?.params.prompt).toBe(
      'Restored task'
    );
    expect(
      taskQueueService.getTask(original.id)?.params.referenceImages
    ).toBeUndefined();
    expect((taskQueueService as any).blockedTaskIds.has(original.id)).toBe(
      true
    );

    releaseDelete();
    await restorePromise;
    await vi.waitFor(() => {
      expect(storedTasks.get(original.id)?.result?.url).toBe(
        'https://example.com/restored.png'
      );
      expect(storedTasks.get(original.id)?.params.referenceImages).toEqual([
        'data:image/png;base64,restored-source',
      ]);
      expect((taskQueueService as any).blockedTaskIds.has(original.id)).toBe(
        false
      );
    });
  });

  it('re-emits an explicitly restored task after a settled deletion fence clears', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const original: Task = {
      id: 'restore-after-settled-delete',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Original task', model: 'gpt-image-2' },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    };
    storedTasks.set(original.id, clone(original));
    await taskQueueService.restoreTasks([clone(original)]);

    taskQueueService.deleteTask(original.id);
    await vi.waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect((taskQueueService as any).pendingTaskDeletions.size).toBe(0)
    );

    const events: string[] = [];
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.task.id === original.id) {
          events.push(event.type);
        }
      });
    const restored: Task = {
      ...original,
      status: TaskStatus.PENDING,
      params: { prompt: 'Restored pending task', model: 'gpt-image-2' },
      updatedAt: 2,
      completedAt: undefined,
    };

    await taskQueueService.restoreTasks([clone(restored)], {
      allowDeletedTaskRestore: true,
    });

    expect(events).toContain('taskCreated');
    expect(events).toContain('taskUpdated');
    expect(
      (taskQueueService as any).recentlyDeletedTaskIds.has(original.id)
    ).toBe(false);
    subscription.unsubscribe();
  });

  it('restricts a deleted-only restore batch to tombstoned tasks', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const deletedTask: Task = {
      id: 'deleted-only-target',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Deleted original', model: 'gpt-image-2' },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    };
    const retainedTask: Task = {
      ...deletedTask,
      id: 'deleted-only-retained',
      params: { prompt: 'Retained local', model: 'gpt-image-2' },
    };
    storedTasks.set(deletedTask.id, clone(deletedTask));
    storedTasks.set(retainedTask.id, clone(retainedTask));
    await taskQueueService.restoreTasks([
      clone(deletedTask),
      clone(retainedTask),
    ]);

    taskQueueService.deleteTask(deletedTask.id);
    await vi.waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect((taskQueueService as any).pendingTaskDeletions.size).toBe(0)
    );

    await taskQueueService.restoreTasks(
      [
        {
          ...deletedTask,
          params: { prompt: 'Deleted restored', model: 'gpt-image-2' },
          updatedAt: 2,
        },
        {
          ...retainedTask,
          params: { prompt: 'Remote replacement', model: 'gpt-image-2' },
          updatedAt: 2,
        },
      ],
      {
        allowDeletedTaskRestore: true,
        deletedTasksOnly: true,
      }
    );

    expect(taskQueueService.getTask(deletedTask.id)?.params.prompt).toBe(
      'Deleted restored'
    );
    expect(taskQueueService.getTask(retainedTask.id)?.params.prompt).toBe(
      'Retained local'
    );
  });

  it('stops an older recovery before installing a newer same-id restore', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const recoveringTask: Task = {
      id: 'restore-stops-old-recovery',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      params: {
        prompt: 'old recovery',
        model: 'gpt-image-2',
        submissionRequestId: 'old-request',
        imageSubmissionAttempted: true,
      },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
      executionPhase: TaskExecutionPhase.POLLING,
    };
    await taskQueueService.restoreTasks([clone(recoveringTask)]);
    const oldToken = taskQueueService.getTaskExecutionToken(recoveringTask.id);

    const replacement: Task = {
      ...recoveringTask,
      status: TaskStatus.COMPLETED,
      params: {
        prompt: 'new restored result',
        model: 'gpt-image-2',
        submissionRequestId: 'new-request',
      },
      updatedAt: 2,
      completedAt: 2,
      executionPhase: undefined,
      result: {
        url: 'https://example.com/new-restored-result.png',
        format: 'png',
        size: 1,
      },
    };
    await taskQueueService.restoreTasks([clone(replacement)]);

    expect(mocks.stopImageRecovery).toHaveBeenCalledWith(recoveringTask.id);
    expect(taskQueueService.getTask(recoveringTask.id)?.params.prompt).toBe(
      'new restored result'
    );
    expect(taskQueueService.getTaskExecutionToken(recoveringTask.id)).not.toBe(
      oldToken
    );
  });

  it('does not create a task from a late status update after tombstone eviction', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const evictedTaskId = 'evicted-delete-0';

    for (let index = 0; index <= 1000; index += 1) {
      (taskQueueService as any).rememberRecentlyDeletedTask(
        `evicted-delete-${index}`
      );
    }
    expect(
      (taskQueueService as any).recentlyDeletedTaskIds.has(evictedTaskId)
    ).toBe(false);

    taskQueueService.updateTaskStatus(evictedTaskId, TaskStatus.COMPLETED, {
      result: {
        url: 'https://example.com/late.png',
        format: 'png',
        size: 1,
      },
    });

    expect(taskQueueService.getTask(evictedTaskId)).toBeUndefined();
  });

  it('does not revive a deleted audio task after late result caching finishes', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let releaseCache!: () => void;
    const cacheGate = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    mocks.cacheRemoteUrl.mockImplementationOnce(async (url: string) => {
      await cacheGate;
      return url;
    });
    const task: Task = {
      id: 'delete-during-audio-cache',
      type: TaskType.AUDIO,
      status: TaskStatus.PROCESSING,
      params: { prompt: 'Cache audio result', model: 'suno-v4' },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    };
    storedTasks.set(task.id, clone(task));
    await taskQueueService.restoreTasks([clone(task)]);

    const execution = (taskQueueService as any).executeTask(clone(task));
    await vi.waitFor(() => expect(mocks.cacheRemoteUrl).toHaveBeenCalledOnce());

    taskQueueService.deleteTask(task.id);
    await vi.waitFor(() => expect(mocks.deleteTask).toHaveBeenCalledOnce());
    releaseCache();
    await execution;
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)).toBeUndefined();
    expect(storedTasks.has(task.id)).toBe(false);
  });

  it('does not let a late analyzer response overwrite a newer same-id restore', async () => {
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    });
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let releaseChat!: () => void;
    mocks.sendChatWithGemini.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseChat = () =>
            resolve({ choices: [{ message: { content: 'Old response' } }] });
        })
    );
    const original: Task = {
      id: 'replace-running-analyzer',
      type: TaskType.CHAT,
      status: TaskStatus.PROCESSING,
      params: {
        prompt: 'Old task',
        model: 'gemini-2.5-pro',
        videoAnalyzerAction: 'rewrite',
        videoAnalyzerPrompt: 'Rewrite old task',
      },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    };
    storedTasks.set(original.id, clone(original));
    await taskQueueService.restoreTasks([clone(original)]);

    const oldToken = taskQueueService.getTaskExecutionToken(original.id);
    const execution = (taskQueueService as any).executeTask(clone(original));
    await vi.waitFor(() =>
      expect(mocks.sendChatWithGemini).toHaveBeenCalledOnce()
    );

    const replacementTime = Date.now() + 1000;
    const replacement: Task = {
      ...original,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Replacement task', model: 'gemini-2.5-pro' },
      result: {
        url: '',
        format: 'md',
        size: 11,
        resultKind: 'chat',
        chatResponse: 'Replacement',
      },
      progress: 100,
      updatedAt: replacementTime,
      completedAt: replacementTime,
    };
    storedTasks.set(replacement.id, clone(replacement));
    await taskQueueService.restoreTasks([clone(replacement)]);

    expect(taskQueueService.getTaskExecutionToken(original.id)).not.toBe(
      oldToken
    );
    releaseChat();
    await execution;
    await flushAsyncWork();

    expect(taskQueueService.getTask(original.id)?.params.prompt).toBe(
      'Replacement task'
    );
    expect(taskQueueService.getTask(original.id)?.result?.chatResponse).toBe(
      'Replacement'
    );
    expect(storedTasks.get(original.id)?.result?.chatResponse).toBe(
      'Replacement'
    );
  });

  it('starts a fresh audio execution immediately after cancelling and retrying', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let releaseOldAudio!: () => void;
    mocks.generateAudio
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOldAudio = () =>
              resolve({
                url: 'https://example.com/old.mp3',
                format: 'mp3',
              });
          })
      )
      .mockResolvedValueOnce({
        url: 'https://example.com/retry.mp3',
        format: 'mp3',
      });

    const task = taskQueueService.createTask(
      { prompt: 'Retry audio', model: 'suno-v4' },
      TaskType.AUDIO
    );
    await vi.waitFor(() => expect(mocks.generateAudio).toHaveBeenCalledOnce());

    taskQueueService.cancelTask(task.id);
    taskQueueService.retryTask(task.id);

    await vi.waitFor(() =>
      expect(mocks.generateAudio).toHaveBeenCalledTimes(2)
    );
    await vi.waitFor(() =>
      expect(taskQueueService.getTask(task.id)?.result?.url).toBe(
        'https://example.com/retry.mp3'
      )
    );

    releaseOldAudio();
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.result?.url).toBe(
      'https://example.com/retry.mp3'
    );
    expect(storedTasks.get(task.id)?.result?.url).toBe(
      'https://example.com/retry.mp3'
    );
  });

  it('does not let a stale local storage snapshot revive a deleting task', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const task: Task = {
      id: 'stale-local-restore',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Delete me', model: 'gpt-image-2' },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    };
    storedTasks.set(task.id, clone(task));
    await taskQueueService.restoreTasks([clone(task)]);
    mocks.deleteTask.mockImplementationOnce(async (taskId: string) => {
      await deleteGate;
      storedTasks.delete(taskId);
    });

    taskQueueService.deleteTask(task.id);
    await taskQueueService.restoreTasks([clone(task)]);

    expect(taskQueueService.getTask(task.id)).toBeUndefined();
    releaseDelete();
    await vi.waitFor(() => expect(storedTasks.has(task.id)).toBe(false));

    taskQueueService.updateTaskStatus(task.id, TaskStatus.COMPLETED, {
      result: {
        url: 'https://example.com/late.png',
        format: 'png',
        size: 1,
      },
    });

    expect(taskQueueService.getTask(task.id)).toBeUndefined();
    expect(storedTasks.has(task.id)).toBe(false);
  });

  it('rolls memory back when persistent deletion fails', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const task: Task = {
      id: 'failed-persistent-delete',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Keep after failed delete', model: 'gpt-image-2' },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    };
    storedTasks.set(task.id, clone(task));
    await taskQueueService.restoreTasks([clone(task)]);
    mocks.deleteTask.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    taskQueueService.deleteTask(task.id);

    await vi.waitFor(() =>
      expect(taskQueueService.getTask(task.id)?.params.prompt).toBe(
        'Keep after failed delete'
      )
    );
    expect(storedTasks.has(task.id)).toBe(true);
    expect((taskQueueService as any).blockedTaskIds.has(task.id)).toBe(false);
    expect((taskQueueService as any).recentlyDeletedTaskIds.has(task.id)).toBe(
      false
    );
  });

  it.each([
    ['chat', TaskType.CHAT],
    ['submitting video', TaskType.VIDEO],
  ])(
    'restores an active %s task as cancelled when persistent deletion fails',
    async (_label, taskType) => {
      const { taskQueueService, storedTasks, mocks } =
        await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
      let releaseExecution!: () => void;
      let executionSignal: AbortSignal | undefined;
      const executionGate = new Promise<void>((resolve) => {
        releaseExecution = resolve;
      });
      const executionMock =
        taskType === TaskType.CHAT ? mocks.generateText : mocks.generateVideo;
      executionMock.mockImplementationOnce(async (_params, options) => {
        executionSignal = options?.signal;
        await executionGate;
        return taskType === TaskType.CHAT
          ? { content: 'Late response' }
          : undefined;
      });
      const task: Task = {
        id: `failed-delete-active-${taskType}`,
        type: taskType,
        status: TaskStatus.PROCESSING,
        params: { prompt: 'Delete active task', model: 'test-model' },
        createdAt: 1,
        updatedAt: 1,
        startedAt: 1,
      };
      storedTasks.set(task.id, clone(task));
      await taskQueueService.restoreTasks([clone(task)]);

      const execution = (taskQueueService as any).executeTask(clone(task));
      await vi.waitFor(() => expect(executionMock).toHaveBeenCalledOnce());
      mocks.deleteTask.mockRejectedValueOnce(
        new Error('IndexedDB unavailable')
      );

      taskQueueService.deleteTask(task.id);

      expect(executionSignal?.aborted).toBe(true);
      await vi.waitFor(() =>
        expect(taskQueueService.getTask(task.id)?.status).toBe(
          TaskStatus.CANCELLED
        )
      );
      await vi.waitFor(() =>
        expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED)
      );

      releaseExecution();
      await execution;
      await flushAsyncWork();

      expect(taskQueueService.getTask(task.id)?.status).toBe(
        TaskStatus.CANCELLED
      );
      expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED);
    }
  );

  it('clears execution blocks after clearing all tasks', async () => {
    const { taskQueueService, storedTasks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const task: Task = {
      id: 'clear-all-task',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: 'Clear all', model: 'gpt-image-2' },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    };
    storedTasks.set(task.id, clone(task));
    await taskQueueService.restoreTasks([clone(task)]);

    await taskQueueService.clearAllTasks();

    expect(taskQueueService.getAllTasks()).toEqual([]);
    expect(storedTasks.size).toBe(0);
    expect((taskQueueService as any).blockedTaskIds.size).toBe(0);
    expect((taskQueueService as any).pendingTaskDeletions.size).toBe(0);
  });

  it('does not retain deletion fences after many settled deletes', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const tasks = Array.from(
      { length: 64 },
      (_, index): Task => ({
        id: `settled-delete-${index}`,
        type: TaskType.IMAGE,
        status: TaskStatus.COMPLETED,
        params: { prompt: `Delete ${index}`, model: 'gpt-image-2' },
        createdAt: index + 1,
        updatedAt: index + 1,
        completedAt: index + 1,
      })
    );
    for (const task of tasks) {
      storedTasks.set(task.id, clone(task));
    }
    taskQueueService.restoreTasks(tasks.map(clone));

    tasks.forEach((task) => taskQueueService.deleteTask(task.id));

    await vi.waitFor(() => {
      expect(mocks.deleteTask).toHaveBeenCalledTimes(tasks.length);
      expect((taskQueueService as any).pendingTaskDeletions.size).toBe(0);
      expect((taskQueueService as any).blockedTaskIds.size).toBe(0);
      expect((taskQueueService as any).taskStorageOperations.size).toBe(0);
    });
    expect(storedTasks.size).toBe(0);
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
        resultVisibility: 'internal',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

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
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      generationMode: 'image_to_image',
      referenceImages: ['data:image/png;base64,source'],
      maskImage: 'data:image/png;base64,mask',
      outputFormat: 'png',
      resultVisibility: 'internal',
    });
    expect(storedTasks.get(task.id)?.params.referenceImages).toEqual([
      'data:image/png;base64,source',
    ]);
  });

  it('forwards internal result visibility when executing video tasks', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);

    taskQueueService.createTask(
      {
        prompt: 'Generate an internal narration segment',
        model: 'seedance-1.5-pro',
        resultVisibility: 'internal',
      },
      TaskType.VIDEO
    );

    await flushAsyncWork();

    expect(mocks.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Generate an internal narration segment',
        resultVisibility: 'internal',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
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

  it('uses the invocation route model id when retrying a task with a stale model field', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-image-edit-1',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: {
        prompt: 'Retry routed image',
        model: 'image2',
      },
      invocationRoute: {
        operation: 'image',
        providerProfileId: 'custom-profile',
        modelId: 'gpt-image-2',
        modelRef: {
          profileId: 'custom-profile',
          modelId: 'gpt-image-2',
        },
        binding: {
          id: 'custom-profile:gpt-image-2:image',
          protocol: 'openai.images.generations',
          requestSchema: 'openai.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
        },
      },
      createdAt: 1,
      updatedAt: 1,
      error: {
        code: 'EXECUTION_ERROR',
        message: '分组 default 下模型 image2 无可用渠道 (distributor)',
      },
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      model: 'gpt-image-2',
      modelRef: {
        profileId: 'custom-profile',
        modelId: 'gpt-image-2',
      },
    });
  });

  it('uses the invocation route model id on the first execution of a new task', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-image-first-execution',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      params: {
        prompt: '兔子',
        model: 'image2',
      },
      invocationRoute: {
        operation: 'image',
        providerProfileId: 'custom-profile',
        modelId: 'gemini',
        modelRef: {
          profileId: 'custom-profile',
          modelId: 'gemini',
        },
        binding: {
          id: 'custom-profile:gemini:image:manual:custom-http',
          protocol: 'custom-http',
          requestSchema: 'custom-http',
          responseSchema: 'custom-http.image',
          submitPath: '/render',
        },
      },
      createdAt: 1,
      updatedAt: 1,
    };

    taskQueueService.trackExternalTask(clone(task));
    await (taskQueueService as any).executeTask(
      taskQueueService.getTask(task.id)
    );
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      model: 'gemini',
      modelRef: {
        profileId: 'custom-profile',
        modelId: 'gemini',
      },
    });
  });

  it('repairs an unrouted image2 channel failure with the active custom image route', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.COMPLETED],
      {
        activeImageRoute: {
          profileId: 'custom-profile',
          modelId: 'gpt-image-2',
        },
      }
    );
    const task: Task = {
      id: 'task-image-edit-1',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: {
        prompt: '兔子',
        model: 'image2',
      },
      createdAt: 1,
      updatedAt: 1,
      error: {
        code: 'EXECUTION_ERROR',
        message: '分组 default 下模型 image2 无可用渠道 (distributor)',
      },
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      model: 'gpt-image-2',
      modelRef: {
        profileId: 'custom-profile',
        modelId: 'gpt-image-2',
      },
    });
  });

  it('repairs an unrouted custom model failure with its provider catalog binding', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.COMPLETED],
      {
        customProfiles: [
          {
            id: 'provider-custom',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            enabled: true,
          },
        ],
      }
    );
    const task: Task = {
      id: 'task-custom-gemini-retry',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: {
        prompt: '兔子',
        model: 'gemini',
      },
      createdAt: 1,
      updatedAt: 1,
      error: {
        code: 'EXECUTION_ERROR',
        message: '分组 default 下模型 gemini 无可用渠道 (distributor)',
      },
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      model: 'gemini',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gemini',
      },
    });
  });

  it('replaces a failed legacy-default route snapshot with the matching custom route', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.COMPLETED],
      {
        customProfiles: [
          {
            id: 'provider-custom',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            enabled: true,
          },
        ],
      }
    );
    const task: Task = {
      id: 'task-custom-gemini-legacy-route-retry',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: {
        prompt: '兔子',
        model: 'gemini',
      },
      invocationRoute: {
        operation: 'image',
        providerProfileId: 'legacy-default',
        modelId: 'gemini',
        modelRef: {
          profileId: 'legacy-default',
          modelId: 'gemini',
        },
        binding: {
          id: 'legacy-default:gemini:image',
          protocol: 'google.generateContent',
          requestSchema: 'google.gemini.generate-content.image',
          responseSchema: 'google.gemini.generate-content',
          submitPath: '/v1beta/models/{model}:generateContent',
        },
      },
      createdAt: 1,
      updatedAt: 1,
      error: {
        code: 'EXECUTION_ERROR',
        message: '分组 default 下模型 gemini 无可用渠道 (distributor)',
      },
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      model: 'gemini',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gemini',
      },
    });
    expect(taskQueueService.getTask(task.id)?.invocationRoute).toMatchObject({
      providerProfileId: 'provider-custom',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gemini',
      },
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

    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      capturedSignal = options?.signal;
      await new Promise<void>((resolve) => {
        finishExecutor = resolve;
      });

      const storedTask = storedTasks.get('task-image-edit-1');
      storedTasks.set('task-image-edit-1', {
        ...storedTask,
        status: TaskStatus.COMPLETED,
        progress: 100,
        result: {
          url: 'https://example.com/late.png',
          format: 'png',
          size: 1,
        },
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
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

    finishExecutor();
    await flushAsyncWork();

    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.CANCELLED
    );
    expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED);
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

  it('cancels a PPT explainer locally before invoking optional remote cancel', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    let statusObservedByRemoteCancel: TaskStatus | undefined;
    mocks.cancelPptExplainerRemoteTask.mockImplementationOnce(async (task) => {
      statusObservedByRemoteCancel = task.status;
    });
    const task: Task = {
      id: 'ppt-explainer-cancel',
      type: TaskType.VIDEO,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-cancel',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        prompt: 'PPT explainer cancellation',
        model: 'video-model',
        pptExplainer: {
          schemaVersion: 1,
          jobId: 'job-cancel',
          stage: 'polling',
          remoteId: 'remote-cancel',
          idempotencyKey: 'idem-cancel',
          diagnostics: [],
          originalRoute: { binding: { pptExplainer: {} } },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    };
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.cancelTask(task.id);

    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.CANCELLED,
      params: {
        pptExplainer: {
          stage: 'cancelled',
          remoteId: 'remote-cancel',
          idempotencyKey: 'idem-cancel',
          diagnostics: ['供应商未声明远端取消，远端任务可能继续执行和计费'],
        },
      },
    });
    await vi.waitFor(() =>
      expect(mocks.cancelPptExplainerRemoteTask).toHaveBeenCalledTimes(1)
    );
    expect(statusObservedByRemoteCancel).toBe(TaskStatus.CANCELLED);

    taskQueueService.retryTask(task.id);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.CANCELLED
    );

    taskQueueService.deleteTask(task.id);
    await vi.waitFor(() =>
      expect(mocks.cleanupPptExplainerTask).toHaveBeenCalledTimes(1)
    );
    expect(mocks.cancelPptExplainerRemoteTask).toHaveBeenCalledTimes(1);
  });

  it('persists a safe warning when remote PPT cancellation fails', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    mocks.cancelPptExplainerRemoteTask.mockRejectedValueOnce(
      new Error('HTTP 500 provider response contains secret-token')
    );
    const task = createPptExplainerLifecycleTask(
      'ppt-explainer-cancel-failure',
      TaskStatus.PROCESSING,
      { remoteId: 'remote-cancel-failure', cancelBinding: true }
    );
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.cancelTask(task.id);

    await vi.waitFor(() =>
      expect(mocks.cancelPptExplainerRemoteTask).toHaveBeenCalledTimes(1)
    );
    await vi.waitFor(() => {
      const diagnostics = (
        taskQueueService.getTask(task.id)?.params.pptExplainer as {
          diagnostics?: string[];
        }
      )?.diagnostics;
      expect(diagnostics).toEqual([
        '远端取消失败，远端任务可能继续执行和计费；可再次尝试取消',
      ]);
      expect(diagnostics?.join('\n')).not.toContain('secret-token');
    });
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.CANCELLED
    );
    await vi.waitFor(() => {
      const storedState = storedTasks.get(task.id)?.params?.pptExplainer as
        | { diagnostics?: string[] }
        | undefined;
      expect(storedState?.diagnostics).toEqual([
        '远端取消失败，远端任务可能继续执行和计费；可再次尝试取消',
      ]);
      expect(storedState?.diagnostics?.join('\n')).not.toContain(
        'secret-token'
      );
      expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED);
    });
  });

  it('warns about an unknown remote submission when cancelling without remoteId', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task = createPptExplainerLifecycleTask(
      'ppt-explainer-missing-remote-id',
      TaskStatus.PROCESSING,
      { cancelBinding: true }
    );
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.cancelTask(task.id);

    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.CANCELLED,
      params: {
        pptExplainer: {
          diagnostics: [
            expect.stringContaining('提交结果可能未知'),
            expect.stringContaining('远端任务可能继续执行和计费'),
          ],
        },
      },
    });
    await vi.waitFor(() =>
      expect(mocks.cancelPptExplainerRemoteTask).toHaveBeenCalledTimes(1)
    );
  });

  it('cancels an active PPT explainer before deleting it', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task = createPptExplainerLifecycleTask(
      'ppt-explainer-active-delete',
      TaskStatus.PROCESSING,
      { remoteId: 'remote-delete', cancelBinding: true }
    );
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.deleteTask(task.id);

    expect(taskQueueService.getTask(task.id)).toBeUndefined();
    await vi.waitFor(() => {
      expect(mocks.cancelPptExplainerRemoteTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id })
      );
      expect(mocks.deleteTask).toHaveBeenCalledWith(task.id);
    });
    expect(mocks.cleanupPptExplainerTask).not.toHaveBeenCalled();
  });

  it('cleans a terminal PPT explainer when deleting without remote cancel', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task = createPptExplainerLifecycleTask(
      'ppt-explainer-failed-delete',
      TaskStatus.FAILED,
      { remoteId: 'remote-failed' }
    );
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.deleteTask(task.id);

    await vi.waitFor(() =>
      expect(mocks.cleanupPptExplainerTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id })
      )
    );
    expect(mocks.cancelPptExplainerRemoteTask).not.toHaveBeenCalled();
  });

  it('cancels active and cleans terminal PPT explainers before clearing all tasks', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const active = createPptExplainerLifecycleTask(
      'ppt-explainer-clear-active',
      TaskStatus.PROCESSING,
      { remoteId: 'remote-clear', cancelBinding: true }
    );
    const terminal = createPptExplainerLifecycleTask(
      'ppt-explainer-clear-failed',
      TaskStatus.FAILED
    );
    const normal: Task = {
      id: 'normal-clear-active',
      type: TaskType.VIDEO,
      status: TaskStatus.PROCESSING,
      params: { prompt: 'normal video', model: 'video-model' },
      createdAt: 1,
      updatedAt: 1,
    };
    taskQueueService.trackExternalTask(clone(active));
    taskQueueService.trackExternalTask(clone(terminal));
    taskQueueService.trackExternalTask(clone(normal));

    await taskQueueService.clearAllTasks();

    expect(mocks.cancelPptExplainerRemoteTask).toHaveBeenCalledTimes(1);
    expect(mocks.cancelPptExplainerRemoteTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: active.id })
    );
    expect(mocks.cleanupPptExplainerTask).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupPptExplainerTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminal.id })
    );
    expect(taskQueueService.getAllTasks()).toEqual([]);
  });

  it('cleans a failed PPT explainer when retention archives it', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const archived = createPptExplainerLifecycleTask(
      'ppt-explainer-retention-archive',
      TaskStatus.FAILED,
      { updatedAt: 1 }
    );
    const ordinaryTasks: Task[] = Array.from({ length: 100 }, (_, index) => ({
      id: `ordinary-retention-${index}`,
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      params: { prompt: `ordinary ${index}`, model: 'image-model' },
      createdAt: index + 2,
      updatedAt: index + 2,
      completedAt: index + 2,
    }));

    await taskQueueService.restoreTasks([
      clone(archived),
      ...ordinaryTasks.map(clone),
    ]);

    await vi.waitFor(() => {
      expect(mocks.archiveTasks).toHaveBeenCalledWith([archived.id]);
      expect(mocks.cleanupPptExplainerTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: archived.id })
      );
    });
    expect(mocks.cancelPptExplainerRemoteTask).not.toHaveBeenCalled();
  });

  it('retries a transient 429 PPT explainer poll failure by preserving remoteId and idempotency', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'ppt-explainer-remote-retry',
      type: TaskType.VIDEO,
      status: TaskStatus.FAILED,
      remoteId: 'remote-retry',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        prompt: 'PPT explainer remote retry',
        model: 'video-model',
        pptExplainer: {
          schemaVersion: 1,
          jobId: 'job-retry',
          stage: 'failed',
          remoteId: 'remote-retry',
          idempotencyKey: 'stable-idempotency-key',
          slides: [],
        },
      },
      createdAt: 1,
      updatedAt: 1,
      error: {
        code: 'http_error',
        message: 'PPT 讲解视频任务查询失败：HTTP 429 请求过于频繁',
      },
    };
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.retryTask(task.id);

    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-retry',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        pptExplainer: {
          stage: 'polling',
          remoteId: 'remote-retry',
          idempotencyKey: 'stable-idempotency-key',
        },
      },
    });
  });

  it('retries an explicitly failed remote PPT explainer with a fresh submission identity', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'ppt-explainer-remote-terminal-retry',
      type: TaskType.VIDEO,
      status: TaskStatus.FAILED,
      remoteId: 'remote-terminal',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        prompt: 'PPT explainer remote terminal retry',
        model: 'video-model',
        pptExplainer: {
          schemaVersion: 1,
          jobId: 'job-remote-terminal',
          source: 'pptx',
          stage: 'failed',
          remoteId: 'remote-terminal',
          idempotencyKey: 'used-idempotency-key',
          executionAttempt: 3,
          slides: [
            {
              pageIndex: 1,
              snapshotUrl: '/slide-1.png',
              turns: [{ speakerId: 'host', text: '第一页讲解' }],
            },
          ],
        },
      },
      createdAt: 1,
      updatedAt: 1,
      error: { code: 'remote_failed', message: 'provider rejected job' },
    };
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.retryTask(task.id);

    const retried = taskQueueService.getTask(task.id);
    expect(retried).toMatchObject({
      status: TaskStatus.PROCESSING,
      executionPhase: TaskExecutionPhase.SUBMITTING,
      params: {
        pptExplainer: {
          stage: 'submitting',
          idempotencyKey: 'job-remote-terminal-retry-4',
          executionAttempt: 3,
        },
      },
    });
    expect(retried?.remoteId).toBeUndefined();
    expect(
      (retried?.params.pptExplainer as { remoteId?: string }).remoteId
    ).toBeUndefined();
  });

  it('retries a failed topic preparation from its recoverable preparing stage', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'ppt-explainer-preparing-retry',
      type: TaskType.VIDEO,
      status: TaskStatus.FAILED,
      params: {
        prompt: 'PPT explainer preparing retry',
        model: 'video-model',
        pptExplainer: {
          schemaVersion: 1,
          jobId: 'job-preparing',
          source: 'topic',
          stage: 'failed',
          idempotencyKey: 'idem-preparing',
          slides: [],
        },
      },
      createdAt: 1,
      updatedAt: 1,
      error: { code: 'PREPARE_FAILED', message: 'outline interrupted' },
    };
    taskQueueService.trackExternalTask(clone(task));

    taskQueueService.retryTask(task.id);

    expect(taskQueueService.getTask(task.id)).toMatchObject({
      status: TaskStatus.PROCESSING,
      executionPhase: TaskExecutionPhase.SUBMITTING,
      params: {
        pptExplainer: {
          stage: 'preparing',
          idempotencyKey: 'idem-preparing',
        },
      },
    });
  });
});
