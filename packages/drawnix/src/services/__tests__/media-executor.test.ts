/**
 * Media Executor Tests
 * 媒体执行器模块测试
 *
 * 测试场景：
 * 1. 执行器接口验证
 * 2. 执行器工厂基本功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  IMediaExecutor,
  ImageGenerationParams,
  VideoGenerationParams,
  AIAnalyzeParams,
} from '../media-executor/types';
import type {
  ImageModelAdapter,
  VideoModelAdapter,
} from '../model-adapters/types';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

describe('Media Executor Module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../media-executor/task-storage-writer');
    vi.doUnmock('../media-executor/fallback-adapter-routes');
    vi.doUnmock('../media-executor/fallback-utils');
    vi.doUnmock('../media-api');
    vi.doUnmock('../../utils/settings-manager');
    vi.doUnmock('../sw-channel/client');
    vi.doUnmock('../task-storage-reader');
    vi.doUnmock('../media-executor/llm-api-logger');
    vi.doUnmock('../unified-cache-service');
    vi.doUnmock('../../utils/api-auth-error-event');
    vi.doUnmock('../model-adapters');
    vi.doUnmock('../provider-routing');
    vi.doUnmock('../task-invocation-route');
  });

  describe('IMediaExecutor Interface', () => {
    it('should define correct interface structure', () => {
      // 验证接口类型定义存在
      const imageParams: ImageGenerationParams = {
        taskId: 'test-1',
        prompt: 'A cat',
      };

      const videoParams: VideoGenerationParams = {
        taskId: 'test-2',
        prompt: 'A dancing cat',
      };

      const analyzeParams: AIAnalyzeParams = {
        taskId: 'test-3',
        prompt: 'Analyze this image',
        images: ['http://example.com/image.png'],
      };

      expect(imageParams.taskId).toBe('test-1');
      expect(videoParams.prompt).toBe('A dancing cat');
      expect(analyzeParams.images).toHaveLength(1);
    });

    it('should support optional parameters for image generation', () => {
      const params: ImageGenerationParams = {
        taskId: 'test-1',
        prompt: 'A landscape',
        model: 'imagen-3.0-generate-002',
        size: '1024x1024',
        count: 4,
        referenceImages: ['http://example.com/ref.png'],
      };

      expect(params.model).toBe('imagen-3.0-generate-002');
      expect(params.size).toBe('1024x1024');
      expect(params.count).toBe(4);
      expect(params.referenceImages).toHaveLength(1);
    });

    it('should support optional parameters for video generation', () => {
      const params: VideoGenerationParams = {
        taskId: 'test-1',
        prompt: 'A video',
        model: 'veo-2.0-generate-001',
        duration: '10',
        size: '1280x720',
      };

      expect(params.model).toBe('veo-2.0-generate-001');
      expect(params.duration).toBe('10');
      expect(params.size).toBe('1280x720');
    });
  });

  // SWMediaExecutor tests removed - sw-executor.ts has been deleted
  // All task execution now happens on the main thread via FallbackMediaExecutor

  describe('FallbackMediaExecutor', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should have correct executor name', async () => {
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          isAvailable: async () => true,
          createTask: async () => {},
          updateTaskStatus: async () => {},
          completeTask: async () => {},
          failTask: async () => {},
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));

      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com',
            }),
          },
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      expect(executor.name).toBe('FallbackMediaExecutor');
    }, 15000);

    it('should implement IMediaExecutor interface', async () => {
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          isAvailable: async () => true,
          createTask: async () => {},
          updateTaskStatus: async () => {},
          completeTask: async () => {},
          failTask: async () => {},
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com',
            }),
          },
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor: IMediaExecutor = new FallbackMediaExecutor();

      expect(typeof executor.name).toBe('string');
      expect(typeof executor.isAvailable).toBe('function');
      expect(typeof executor.generateImage).toBe('function');
      expect(typeof executor.generateVideo).toBe('function');
      expect(typeof executor.aiAnalyze).toBe('function');
      expect(typeof executor.generateText).toBe('function');
    }, 15000);

    it('passes GPT Image edit schema through fallback adapter routes', async () => {
      const actualInvocationRoute = {
        operation: 'image' as const,
        providerProfileId: 'tuzi-profile',
        modelId: 'gpt-image-2',
        binding: {
          id: 'tuzi-image-edit',
          protocol: 'openai.images.edits',
          submitPath: '/images/edits',
          baseUrlStrategy: 'ensure-v1' as const,
        },
      };
      const createTaskInvocationRouteSnapshot = vi.fn(
        () => actualInvocationRoute
      );
      vi.doMock('../task-invocation-route', () => ({
        createTaskInvocationRouteSnapshot,
      }));
      const completeTask = vi.fn(async () => undefined);
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateImageRecovery: vi.fn(async () => {}),
          completeTask,
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(async () => ({
            type: 'image',
            value: 'data:image/png;base64,abc',
          })),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return {
          ...actual,
          cacheRemoteUrls: vi.fn(
            async (
              urls: string[],
              _taskId: string,
              _mediaType: 'image' | 'video' | 'audio',
              _format: string,
              options?: { onCacheWarning?: (warning: unknown) => void }
            ) => {
              options?.onCacheWarning?.({
                status: 'failed',
                reasonCode: 'cache_missing',
                message: 'cache unavailable',
                detectedAt: Date.now(),
              });
              return urls;
            }
          ),
        };
      });
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();

        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
            binding: {
              id: 'tuzi-image-edit',
              protocol: 'openai.images.edits',
              requestSchema: 'openai.image.gpt-edit-form',
              submitPath: '/images/edits',
            },
          })),
        };
      });

      const modelAdapters = await import('../model-adapters');
      const { executeImageViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      const adapter: ImageModelAdapter = {
        id: 'gpt-image-adapter',
        label: 'GPT Image',
        kind: 'image',
        async generateImage(context) {
          await context.onSubmissionAttempt?.();
          return {
            url: 'https://example.com/out.png',
            format: 'png',
            width: 1024,
            height: 1536,
          };
        },
      };
      const generateSpy = vi.spyOn(adapter, 'generateImage');
      const onSubmissionAttempt = vi.fn();
      const controller = new AbortController();

      await executeImageViaAdapter(
        'task-1',
        adapter,
        {
          prompt: 'Edit this',
          model: 'gpt-image-2',
          referenceImages: ['data:image/png;base64,source'],
          generationMode: 'image_edit',
          maskImage: 'data:image/png;base64,mask',
          outputFormat: 'png',
        },
        { onSubmissionAttempt, signal: controller.signal }
      );

      expect(modelAdapters.getAdapterContextFromSettings).toHaveBeenCalledWith(
        'image',
        'gpt-image-2',
        {
          preferredRequestSchema: [
            'openai.image.gpt-edit-form',
            'tuzi.image.gpt-edit-json',
          ],
        }
      );
      expect(generateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'task-1',
          signal: controller.signal,
        }),
        expect.objectContaining({
          generationMode: 'image_edit',
          referenceImages: ['data:image/png;base64,abc'],
          maskImage: 'data:image/png;base64,mask',
          outputFormat: 'png',
        })
      );
      expect(createTaskInvocationRouteSnapshot).toHaveBeenCalledWith(
        'image',
        'gpt-image-2',
        { bindingId: 'tuzi-image-edit' }
      );
      expect(onSubmissionAttempt).toHaveBeenCalledWith(actualInvocationRoute);
      expect(completeTask).toHaveBeenCalledWith(
        'task-1',
        {
          url: 'https://example.com/out.png',
          urls: undefined,
          format: 'png',
          size: 0,
          width: 1024,
          height: 1536,
          cacheWarning: expect.objectContaining({
            status: 'failed',
            reasonCode: 'cache_missing',
          }),
        },
        'task-1',
        expect.objectContaining({
          shouldUpdate: expect.any(Function),
        })
      );
    }, 15000);

    it('passes remote references through Tuzi JSON image requests without browser fetch', async () => {
      const getImageForAI = vi.fn();
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateImageRecovery: vi.fn(async () => {}),
          completeTask: vi.fn(async () => true),
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI,
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
            binding: {
              requestSchema: 'tuzi.image.gpt-edit-json',
              submitPath: '/images/generations',
            },
          })),
        };
      });

      const { executeImageViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      const adapter: ImageModelAdapter = {
        id: 'tuzi-gpt-image-adapter',
        label: 'Tuzi GPT Image',
        kind: 'image',
        generateImage: vi.fn(async () => ({
          url: 'data:image/png;base64,cG5n',
          format: 'png',
        })),
      };
      const remoteReference =
        'https://apioss28.sydney-ai.com/img/generated-reference.png';

      await executeImageViaAdapter('task-remote-reference', adapter, {
        prompt: 'Edit this',
        model: 'gpt-image-2',
        referenceImages: [remoteReference],
        generationMode: 'image_edit',
      });

      expect(adapter.generateImage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ referenceImages: [remoteReference] })
      );
      expect(getImageForAI).not.toHaveBeenCalled();
    }, 15000);

    it('uses the local task ID for direct image submissions', async () => {
      const actualInvocationRoute = {
        operation: 'image' as const,
        providerProfileId: 'provider-test',
        modelId: 'legacy-image-model',
        modelRef: {
          profileId: 'provider-test',
          modelId: 'legacy-image-model',
        },
        binding: {
          id: 'direct-image-binding',
          protocol: 'openai.images.generations',
          submitPath: '/images/generations',
        },
      };
      const createTaskInvocationRouteSnapshot = vi.fn(
        () => actualInvocationRoute
      );
      vi.doMock('../task-invocation-route', () => ({
        createTaskInvocationRouteSnapshot,
      }));
      let submittedResponse: Response | undefined;
      const send = vi.fn(async () => {
        submittedResponse = new Response(
          JSON.stringify({
            data: [{ url: 'https://example.com/out.png' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
        return submittedResponse;
      });
      let bodyUsedAtDownloadProgress = false;
      const onProgress = vi.fn((update: { progress: number }) => {
        if (update.progress === 80) {
          bodyUsedAtDownloadProgress = submittedResponse?.bodyUsed === true;
        }
      });
      const onSubmissionAttempt = vi.fn();

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateImageRecovery: vi.fn(async () => {}),
          completeTask: vi.fn(async () => {}),
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn((operation: string) => ({
            routeType: operation,
            modelId: operation === 'image' ? 'legacy-image-model' : '',
            profileId: 'provider-test',
            profileName: 'Test Provider',
            providerType: 'custom',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        const imagePlan = {
          provider: {
            profileId: 'provider-test',
            profileName: 'Test Provider',
            providerType: 'custom',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            authType: 'bearer' as const,
          },
          modelRef: {
            profileId: 'provider-test',
            modelId: 'legacy-image-model',
          },
          binding: {
            id: 'direct-image-binding',
            profileId: 'provider-test',
            modelId: 'legacy-image-model',
            operation: 'image' as const,
            protocol: 'openai.images.generations',
            requestSchema: 'openai.image.basic-json',
            responseSchema: 'openai.image',
            submitPath: '/images/generations',
            priority: 100,
            confidence: 'high' as const,
            source: 'manual' as const,
          },
        };
        return {
          ...actual,
          providerTransport: { send },
          resolveInvocationPlanFromRoute: vi.fn((operation: string) =>
            operation === 'image' ? imagePlan : null
          ),
        };
      });
      vi.doMock('../model-adapters', () => ({
        resolveAdapterForInvocation: vi.fn(() => undefined),
        GPT_IMAGE_EDIT_REQUEST_SCHEMAS: ['openai.image.gpt-edit-form'],
      }));

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      await executor.generateImage(
        {
          taskId: 'task-direct-image-1',
          prompt: '生成一只兔子',
          model: 'legacy-image-model',
        },
        { onProgress, onSubmissionAttempt }
      );

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://api.example.com/v1',
        }),
        expect.objectContaining({
          path: '/images/generations',
          method: 'POST',
          requestId: 'task-direct-image-1',
        })
      );
      expect(bodyUsedAtDownloadProgress).toBe(true);
      expect(createTaskInvocationRouteSnapshot).toHaveBeenCalledWith(
        'image',
        {
          profileId: 'provider-test',
          modelId: 'legacy-image-model',
        },
        { bindingId: 'direct-image-binding' }
      );
      expect(onSubmissionAttempt).toHaveBeenCalledWith(actualInvocationRoute);
    }, 15000);

    it('propagates an ambiguous adapter submission without failing it', async () => {
      const failTask = vi.fn(async () => true);
      const adapter = {
        id: 'tuzi-gpt-image-adapter',
        kind: 'image',
        generateImage: vi.fn(async () => {
          throw Object.assign(new Error('submission response lost'), {
            code: 'IMAGE_SUBMISSION_OUTCOME_UNKNOWN',
          });
        }),
      } as unknown as ImageModelAdapter;

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          completeTask: vi.fn(async () => true),
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: 'https://bus.tu-zi.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
          })),
        };
      });

      const { executeImageViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      await expect(
        executeImageViaAdapter(
          'task-unknown-outcome',
          adapter,
          {
            requestId: 'request-unknown-outcome',
            prompt: '生成一只兔子',
            model: 'gpt-image-2',
          },
          undefined,
          Date.now()
        )
      ).rejects.toMatchObject({
        code: 'IMAGE_SUBMISSION_OUTCOME_UNKNOWN',
      });

      expect(failTask).not.toHaveBeenCalled();
    }, 15000);

    it('routes Midjourney runtime image models through the MJ adapter', async () => {
      const executeImageViaAdapter = vi.fn(async () => undefined);
      const resolveAdapterForInvocation = vi.fn(() => ({
        id: 'mj-image-adapter',
        kind: 'image',
      }));

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateImageRecovery: vi.fn(async () => {}),
          completeTask: vi.fn(async () => {}),
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        isAuthError: vi.fn(() => false),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com/v1',
            }),
          },
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });
      vi.doMock('../model-adapters', () => ({
        resolveAdapterForInvocation,
        getAdapterContextFromSettings: vi.fn(),
        GPT_IMAGE_EDIT_REQUEST_SCHEMAS: ['openai.image.gpt-edit-form'],
      }));
      vi.doMock('../media-executor/fallback-adapter-routes', () => ({
        executeImageViaAdapter,
        executeVideoViaAdapter: vi.fn(async () => undefined),
      }));

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      await executor.generateImage({
        taskId: 'task-mj-1',
        prompt: '生成一个兔子',
        model: 'mj_fast_background_eraser',
        modelRef: {
          profileId: 'tuzi',
          modelId: 'mj_fast_background_eraser',
        },
        resultVisibility: 'internal',
      });

      expect(resolveAdapterForInvocation).toHaveBeenCalledWith(
        'image',
        'mj_fast_background_eraser',
        {
          profileId: 'tuzi',
          modelId: 'mj_fast_background_eraser',
        },
        {
          preferredRequestSchema: undefined,
        }
      );
      expect(executeImageViaAdapter).toHaveBeenCalledWith(
        'task-mj-1',
        expect.objectContaining({
          id: 'mj-image-adapter',
          kind: 'image',
        }),
        expect.objectContaining({
          model: 'mj_fast_background_eraser',
          modelRef: {
            profileId: 'tuzi',
            modelId: 'mj_fast_background_eraser',
          },
          resultVisibility: 'internal',
        }),
        undefined,
        expect.any(Number)
      );
    }, 15000);

    it('adds the stable task ID header to the direct image fallback request', async () => {
      const send = vi.fn(async () =>
        Response.json({
          data: [{ url: 'data:image/png;base64,aW1hZ2U=' }],
        })
      );

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateImageRecovery: vi.fn(async () => {}),
          completeTask: vi.fn(async () => {}),
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return {
          ...actual,
          cacheRemoteUrls: vi.fn(async (urls: string[]) => urls),
        };
      });
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn(() => ({
            routeType: 'image',
            modelId: 'legacy-image-model',
            profileId: 'legacy-provider',
            profileName: 'Legacy Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'secret',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          providerTransport: { send },
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });
      vi.doMock('../model-adapters', () => ({
        resolveAdapterForInvocation: vi.fn(() => null),
        GPT_IMAGE_EDIT_REQUEST_SCHEMAS: ['openai.image.gpt-edit-form'],
      }));

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const controller = new AbortController();
      await new FallbackMediaExecutor().generateImage(
        {
          taskId: 'task-direct-image-1',
          prompt: '生成一只兔子',
          model: 'legacy-image-model',
        },
        { signal: controller.signal }
      );

      expect(send).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          path: '/images/generations',
          requestId: 'task-direct-image-1',
          signal: controller.signal,
        })
      );
    }, 15000);

    it('restores virtual text references sequentially and rejects cache fallback paths', async () => {
      const send = vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ output: { text: 'hello' } }),
      }));
      const firstVirtualUrl = '/__aitu_cache__/image/text-reference-1.png';
      const publicUrl = 'https://cdn.example.com/text-reference.png';
      const secondVirtualUrl = '/__aitu_cache__/image/text-reference-2.png';
      const firstRestoredUrl = 'data:image/png;base64,RklSU1Q=';
      const secondRestoredUrl = 'data:image/png;base64,U0VDT05E';
      const recoveryEvents: string[] = [];
      const getImageForAI = vi.fn(
        async (
          url: string
        ): Promise<{ type: 'base64' | 'url'; value: string }> => {
          recoveryEvents.push(`start:${url}`);
          await Promise.resolve();
          recoveryEvents.push(`end:${url}`);
          return {
            type: 'base64',
            value:
              url === firstVirtualUrl ? firstRestoredUrl : secondRestoredUrl,
          };
        }
      );

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateProgress: vi.fn(async () => {}),
          completeTask: vi.fn(async () => {}),
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI,
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn(() => ({
            routeType: 'text',
            modelId: 'custom-chat-model',
            profileId: 'provider-manual',
            profileName: 'Manual Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'manual-key',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          providerTransport: {
            send,
          },
          resolveInvocationPlanFromRoute: vi.fn(() => ({
            provider: {
              profileId: 'provider-manual',
              profileName: 'Manual Provider',
              providerType: 'openai-compatible',
              baseUrl: 'https://api.example.com/v1',
              apiKey: 'manual-key',
              authType: 'bearer',
            },
            modelRef: {
              profileId: 'provider-manual',
              modelId: 'custom-chat-model',
            },
            binding: {
              id: 'provider-manual:custom-chat-model:text:manual:openai.chat.messages',
              profileId: 'provider-manual',
              modelId: 'custom-chat-model',
              operation: 'text',
              protocol: 'custom-http',
              requestSchema: 'custom-http',
              responseSchema: 'custom-http.text',
              submitPath: '/v1/custom/chat',
              baseUrlStrategy: 'trim-v1',
              priority: 900,
              confidence: 'high',
              source: 'manual',
              metadata: {
                manualHttp: {
                  method: 'POST',
                  bodyTemplate:
                    '{"model":"{{model}}","prompt":"{{prompt}}","messages":"{{messages}}","images":"{{images}}"}',
                  responsePaths: {
                    text: 'output.text',
                  },
                },
              },
            },
          })),
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      const result = await executor.generateText({
        taskId: 'task-text-1',
        prompt: 'hello',
        model: 'custom-chat-model',
        modelRef: {
          profileId: 'provider-manual',
          modelId: 'custom-chat-model',
        },
        referenceImages: [firstVirtualUrl, publicUrl, secondVirtualUrl],
      });

      expect(result.content).toBe('hello');
      expect(recoveryEvents).toEqual([
        `start:${firstVirtualUrl}`,
        `end:${firstVirtualUrl}`,
        `start:${secondVirtualUrl}`,
        `end:${secondVirtualUrl}`,
      ]);
      expect(getImageForAI).toHaveBeenCalledTimes(2);
      expect(getImageForAI).not.toHaveBeenCalledWith(publicUrl);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: 'provider-manual',
          apiKey: 'manual-key',
        }),
        expect.objectContaining({
          path: '/v1/custom/chat',
          baseUrlStrategy: 'trim-v1',
          method: 'POST',
          body: JSON.stringify({
            model: 'custom-chat-model',
            prompt: 'hello',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'hello' },
                  {
                    type: 'image_url',
                    image_url: { url: firstRestoredUrl },
                  },
                  {
                    type: 'image_url',
                    image_url: { url: publicUrl },
                  },
                  {
                    type: 'image_url',
                    image_url: { url: secondRestoredUrl },
                  },
                ],
              },
            ],
            images: [firstRestoredUrl, publicUrl, secondRestoredUrl],
          }),
        })
      );

      getImageForAI.mockReset().mockResolvedValue({
        type: 'url',
        value: firstVirtualUrl,
      });
      send.mockClear();

      await expect(
        executor.generateText({
          taskId: 'task-text-missing-reference',
          prompt: 'hello',
          model: 'custom-chat-model',
          modelRef: {
            profileId: 'provider-manual',
            modelId: 'custom-chat-model',
          },
          referenceImages: [firstVirtualUrl],
        })
      ).rejects.toThrow(`虚拟参考图片缓存不可用: ${firstVirtualUrl}`);
      expect(send).not.toHaveBeenCalled();
    }, 15000);

    it('does not persist a late text response after its execution is replaced', async () => {
      let resolveSend!: (response: Response) => void;
      const send = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveSend = resolve;
          })
      );
      const completeTask = vi.fn(async () => {});
      const failTask = vi.fn(async () => {});

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateProgress: vi.fn(async () => {}),
          completeTask,
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn((operation: string) => ({
            routeType: operation,
            modelId: 'chat-model',
            profileId: 'provider-text',
            profileName: 'Text Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          providerTransport: { send },
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();
      let current = true;
      const execution = executor.generateText(
        {
          taskId: 'task-stale-text',
          prompt: 'Old prompt',
          model: 'chat-model',
        },
        { isCurrentAttempt: () => current }
      );
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

      current = false;
      resolveSend(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Late response' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
      expect(completeTask).not.toHaveBeenCalled();
      expect(failTask).not.toHaveBeenCalled();
    }, 15000);

    it('does not persist late video adapter callbacks after replacement', async () => {
      const updateRemoteId = vi.fn(async () => {});
      const completeTask = vi.fn(async () => {});
      const failTask = vi.fn(async () => {});
      let finishAdapter!: () => void;
      let submitRemoteId!: (remoteId: string) => void;

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: { updateRemoteId, completeTask, failTask },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: { getImageForAI: vi.fn() },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
          })),
        };
      });

      const adapter: VideoModelAdapter = {
        id: 'late-video-adapter',
        label: 'Late video adapter',
        kind: 'video',
        generateVideo: vi.fn(
          async (_context, request) =>
            new Promise((resolve) => {
              submitRemoteId = request.params?.onSubmitted as (
                remoteId: string
              ) => void;
              finishAdapter = () =>
                resolve({
                  url: 'https://example.com/late.mp4',
                  format: 'mp4',
                });
            })
        ),
      };
      const { executeVideoViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      let current = true;
      const execution = executeVideoViaAdapter(
        'task-stale-video-adapter',
        adapter,
        { prompt: 'Old video', model: 'video-model' },
        { isCurrentAttempt: () => current }
      );
      await vi.waitFor(() =>
        expect(adapter.generateVideo).toHaveBeenCalledOnce()
      );

      current = false;
      submitRemoteId('remote-old');
      finishAdapter();

      await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
      expect(updateRemoteId).not.toHaveBeenCalled();
      expect(completeTask).not.toHaveBeenCalled();
      expect(failTask).not.toHaveBeenCalled();
    }, 15000);

    it('does not persist a stale remote id from a late built-in video submission', async () => {
      let resolveSubmission!: (remoteId: string) => void;
      const submitVideoGeneration = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveSubmission = resolve;
          })
      );
      const pollVideoStatus = vi.fn();
      const updateRemoteId = vi.fn(async () => {});
      const completeTask = vi.fn(async () => {});
      const failTask = vi.fn(async () => {});

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateRemoteId,
          completeTask,
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn((operation: string) => ({
            routeType: operation,
            modelId: 'video-model',
            profileId: 'provider-video',
            profileName: 'Video Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
        return {
          ...actual,
          resolveAdapterForInvocation: vi.fn(() => undefined),
        };
      });
      vi.doMock('../media-api', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../media-api')>();
        return { ...actual, submitVideoGeneration };
      });
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return { ...actual, pollVideoStatus };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();
      let current = true;
      const execution = executor.generateVideo(
        {
          taskId: 'task-stale-built-in-video',
          prompt: 'Old video',
          model: 'video-model',
        },
        { isCurrentAttempt: () => current }
      );
      await vi.waitFor(() =>
        expect(submitVideoGeneration).toHaveBeenCalledOnce()
      );

      current = false;
      resolveSubmission('remote-old');
      await execution;

      expect(updateRemoteId).not.toHaveBeenCalled();
      expect(pollVideoStatus).not.toHaveBeenCalled();
      expect(completeTask).not.toHaveBeenCalled();
      expect(failTask).not.toHaveBeenCalled();
    }, 15000);

    it('keeps new video recovery ownership when an old same-id poll finishes late', async () => {
      const pollResolvers: Array<(result: { url: string }) => void> = [];
      const pollVideoStatus = vi.fn(
        () =>
          new Promise<{ url: string }>((resolve) => {
            pollResolvers.push(resolve);
          })
      );
      const cacheRemoteUrl = vi.fn(async (url: string) => url);

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateProgress: vi.fn(async () => {}),
          completeTask: vi.fn(async () => {}),
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn((operation: string) => ({
            routeType: operation,
            modelId: 'video-model',
            profileId: 'provider-video',
            profileName: 'Video Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return { ...actual, pollVideoStatus, cacheRemoteUrl };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();
      const original: Task = {
        id: 'task-video-replacement',
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: { prompt: 'Old video', model: 'video-model' },
        remoteId: 'remote-old',
        createdAt: 1,
        updatedAt: 1,
        startedAt: 1,
      };
      const oldUpdates = vi.fn();
      const newUpdates = vi.fn();
      let oldCurrent = true;
      const oldRecovery = (executor as any).resumeVideoTask(
        original,
        oldUpdates,
        () => oldCurrent
      );
      await vi.waitFor(() => expect(pollVideoStatus).toHaveBeenCalledOnce());

      oldCurrent = false;
      const replacement: Task = {
        ...original,
        remoteId: 'remote-new',
        updatedAt: 2,
      };
      const newRecovery = (executor as any).resumeVideoTask(
        replacement,
        newUpdates,
        () => true
      );
      await vi.waitFor(() => expect(pollVideoStatus).toHaveBeenCalledTimes(2));

      pollResolvers[0]({ url: 'https://example.com/old.mp4' });
      await oldRecovery;
      expect((executor as any).pollingTasks.size).toBe(1);
      expect(oldUpdates).not.toHaveBeenCalled();

      pollResolvers[1]({ url: 'https://example.com/new.mp4' });
      await newRecovery;

      expect(newUpdates).toHaveBeenCalledWith(
        original.id,
        TaskStatus.COMPLETED,
        expect.objectContaining({
          result: expect.objectContaining({
            url: 'https://example.com/new.mp4',
          }),
        })
      );
      expect((executor as any).pollingTasks.size).toBe(0);
    }, 15000);

    it('preserves internal visibility when a recovered video completes', async () => {
      const pollVideoStatus = vi.fn(async () => ({
        url: 'https://example.com/internal.mp4',
      }));
      const cacheRemoteUrl = vi.fn(
        async () => '/__aitu_cache__/video/internal.mp4'
      );

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => undefined),
          updateProgress: vi.fn(async () => undefined),
          completeTask: vi.fn(async () => undefined),
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn((operation: string) => ({
            routeType: operation,
            modelId: 'video-model',
            profileId: 'provider-video',
            profileName: 'Video Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return { ...actual, pollVideoStatus, cacheRemoteUrl };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();
      const task: Task = {
        id: 'task-video-internal-recovery',
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: {
          prompt: 'Resume internal video',
          model: 'video-model',
          resultVisibility: 'internal',
        },
        remoteId: 'remote-internal',
        createdAt: 1,
        updatedAt: 1,
        startedAt: 1,
      };
      const onTaskUpdate = vi.fn();

      await (
        executor as unknown as {
          resumeVideoTask: (
            task: Task,
            onTaskUpdate: typeof onTaskUpdate,
            isCurrent: () => boolean
          ) => Promise<void>;
        }
      ).resumeVideoTask(task, onTaskUpdate, () => true);

      expect(cacheRemoteUrl).toHaveBeenCalledWith(
        'https://example.com/internal.mp4',
        task.id,
        'video',
        'mp4',
        undefined,
        { resultVisibility: 'internal' }
      );
      expect(onTaskUpdate).toHaveBeenCalledWith(
        task.id,
        TaskStatus.COMPLETED,
        expect.objectContaining({
          result: expect.objectContaining({
            url: '/__aitu_cache__/video/internal.mp4',
            resultVisibility: 'internal',
          }),
        })
      );
    }, 15000);

    it('aborts a hanging recovered video poll when the task is deleted', async () => {
      let pollingSignal: AbortSignal | undefined;
      const pollVideoStatus = vi.fn(
        (
          _videoId: string,
          _config: unknown,
          _onProgress: unknown,
          signal?: AbortSignal
        ) =>
          new Promise<{ url: string }>((_resolve, reject) => {
            pollingSignal = signal;
            signal?.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          })
      );

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => undefined),
          updateProgress: vi.fn(async () => undefined),
          completeTask: vi.fn(async () => undefined),
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn((operation: string) => ({
            routeType: operation,
            modelId: 'video-model',
            profileId: 'provider-video',
            profileName: 'Video Provider',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            source: 'preset',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../provider-routing')
        >();
        return {
          ...actual,
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return { ...actual, pollVideoStatus };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();
      const task: Task = {
        id: 'task-video-delete-hanging-poll',
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: { prompt: 'Resume video', model: 'video-model' },
        remoteId: 'remote-hanging',
        createdAt: 1,
        updatedAt: 1,
        startedAt: 1,
      };
      const onTaskUpdate = vi.fn();

      const recovery = (executor as any).resumeVideoTask(
        task,
        onTaskUpdate,
        () => true
      );
      await vi.waitFor(() => expect(pollVideoStatus).toHaveBeenCalledOnce());

      executor.cancelPendingTask(task.id);

      expect(pollingSignal?.aborted).toBe(true);
      await recovery;
      expect(onTaskUpdate).not.toHaveBeenCalled();
      expect((executor as any).pollingTasks.size).toBe(0);
    }, 15000);

    it('fails a resumed video when its persisted invocation route is unavailable', async () => {
      const pollVideoStatus = vi.fn();
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          updateProgress: vi.fn(async () => {}),
          completeTask: vi.fn(async () => {}),
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../task-invocation-route', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../task-invocation-route')
        >();
        return {
          ...actual,
          shouldUseStrictTaskInvocationRoute: vi.fn(() => true),
          assertTaskInvocationRouteAvailable: vi.fn(() => {
            throw Object.assign(new Error('Provider route unavailable'), {
              code: 'INVOCATION_ROUTE_UNAVAILABLE',
            });
          }),
        };
      });
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return { ...actual, pollVideoStatus };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();
      const task: Task = {
        id: 'task-video-missing-route',
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: { prompt: 'Resume video', model: 'removed-model' },
        remoteId: 'remote-missing-route',
        invocationRoute: {
          operation: 'video',
          providerProfileId: 'removed-provider',
          modelId: 'removed-model',
        },
        createdAt: 1,
        updatedAt: 1,
        startedAt: 1,
      };
      const onTaskUpdate = vi.fn();

      await (executor as any).resumeVideoTask(task, onTaskUpdate, () => true);

      expect(pollVideoStatus).not.toHaveBeenCalled();
      expect(onTaskUpdate).toHaveBeenCalledWith(task.id, TaskStatus.FAILED, {
        error: {
          code: 'INVOCATION_ROUTE_UNAVAILABLE',
          message: 'Provider route unavailable',
        },
      });
      expect((executor as any).pollingTasks.size).toBe(0);
    }, 15000);

    it('passes video adapter progress through fallback adapter routes', async () => {
      const updateRemoteId = vi.fn(async () => {});
      const completeTask = vi.fn(async () => {});
      const onProgress = vi.fn();

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateRemoteId,
          completeTask,
          failTask: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        isAuthError: vi.fn(() => false),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();

        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
          })),
        };
      });

      const { executeVideoViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      const adapter: VideoModelAdapter = {
        id: 'happyhorse-adapter',
        label: 'HappyHorse',
        kind: 'video',
        async generateVideo(_context, request) {
          const handleProgress = request.params?.onProgress as
            | ((progress: number, status?: string) => void)
            | undefined;
          const handleSubmitted = request.params?.onSubmitted as
            | ((videoId: string) => void)
            | undefined;

          handleSubmitted?.('video-task-1');
          handleProgress?.(30, 'in_progress');

          return {
            url: 'https://example.com/out.mp4',
            format: 'mp4',
          };
        },
      };

      await executeVideoViaAdapter(
        'task-1',
        adapter,
        {
          prompt: 'A dancing cat',
          model: 'happyhorse-1.0-t2v',
        },
        { onProgress }
      );

      expect(updateRemoteId).toHaveBeenCalledWith(
        'task-1',
        'video-task-1',
        expect.objectContaining({
          operation: 'video',
          modelId: 'happyhorse-1.0-t2v',
        }),
        undefined,
        expect.objectContaining({ shouldUpdate: expect.any(Function) })
      );
      expect(onProgress).toHaveBeenCalledWith({
        progress: 30,
        phase: 'polling',
      });
      expect(completeTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          url: 'https://example.com/out.mp4',
          format: 'mp4',
        }),
        undefined,
        expect.objectContaining({ shouldUpdate: expect.any(Function) })
      );
    }, 15000);

    it('does not claim PPT explainer polling tasks during generic video recovery', async () => {
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          isAvailable: async () => true,
          createTask: async () => undefined,
          updateTaskStatus: async () => undefined,
          completeTask: async () => undefined,
          failTask: async () => undefined,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com',
            }),
          },
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();
      const resumeVideoTask = vi.fn(async () => undefined);
      Object.assign(executor, { resumeVideoTask });
      const genericVideoTask: Task = {
        id: 'generic-video',
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: { prompt: '普通视频' },
        createdAt: 1,
        updatedAt: 1,
        remoteId: 'remote-generic',
      };
      const pptExplainerTask: Task = {
        id: 'ppt-explainer-video',
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: {
          prompt: 'PPT 讲解视频',
          pptExplainer: { schemaVersion: 1, stage: 'polling' },
        },
        createdAt: 1,
        updatedAt: 1,
        remoteId: 'remote-ppt',
      };

      await executor.resumePendingTasks(undefined, [
        pptExplainerTask,
        genericVideoTask,
      ]);

      expect(resumeVideoTask).toHaveBeenCalledTimes(1);
      expect(resumeVideoTask).toHaveBeenCalledWith(
        genericVideoTask,
        undefined,
        undefined
      );
      expect(resumeVideoTask).not.toHaveBeenCalledWith(
        pptExplainerTask,
        expect.anything(),
        expect.anything()
      );
    }, 15000);
  });

  describe('ExecutorFactory', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should export getExecutor function', async () => {
      vi.doMock('../sw-channel/client', () => ({
        swChannelClient: {
          isInitialized: () => false,
          ping: async () => false,
        },
      }));

      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          isAvailable: async () => true,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => {}),
        },
      }));

      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com',
            }),
          },
        };
      });

      const { executorFactory } = await import('../media-executor/factory');

      expect(typeof executorFactory.getExecutor).toBe('function');
    }, 15000);
  });

  describe('Task Polling Types', () => {
    it('should export waitForTaskCompletion function', async () => {
      vi.doMock('../task-storage-reader', () => ({
        taskStorageReader: {
          isAvailable: async () => true,
          getTask: async () => null,
        },
      }));

      const { waitForTaskCompletion } = await import(
        '../media-executor/task-polling'
      );

      expect(typeof waitForTaskCompletion).toBe('function');
    });
  });
});
