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

describe('Media Executor Module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../media-executor/task-storage-writer');
    vi.doUnmock('../media-executor/fallback-adapter-routes');
    vi.doUnmock('../../utils/settings-manager');
    vi.doUnmock('../sw-channel/client');
    vi.doUnmock('../task-storage-reader');
    vi.doUnmock('../media-executor/llm-api-logger');
    vi.doUnmock('../unified-cache-service');
    vi.doUnmock('../../utils/api-auth-error-event');
    vi.doUnmock('../model-adapters');
    vi.doUnmock('../provider-routing');
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
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          completeTask: vi.fn(async () => {}),
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
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
            binding: {
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
        async generateImage() {
          return {
            url: 'https://example.com/out.png',
            format: 'png',
          };
        },
      };
      const generateSpy = vi.spyOn(adapter, 'generateImage');

      await executeImageViaAdapter('task-1', adapter, {
        prompt: 'Edit this',
        model: 'gpt-image-2',
        referenceImages: ['data:image/png;base64,source'],
        generationMode: 'image_edit',
        maskImage: 'data:image/png;base64,mask',
        outputFormat: 'png',
      });

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
        expect.any(Object),
        expect.objectContaining({
          generationMode: 'image_edit',
          referenceImages: ['data:image/png;base64,abc'],
          maskImage: 'data:image/png;base64,mask',
          outputFormat: 'png',
        })
      );
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
      vi.doMock('../provider-routing', () => ({
        resolveInvocationPlanFromRoute: vi.fn(() => null),
      }));
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
        }),
        undefined,
        expect.any(Number)
      );
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
            | ((videoId: string) => void | Promise<void>)
            | undefined;

          await handleSubmitted?.('video-task-1');
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
        })
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
        })
      );
    }, 15000);

    it('routes legacy veo3.1 /v1 settings to the Tuzi video endpoint', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL) => {
          expect(String(input)).toBe('https://api.tu-zi.com/v1/videos');
          return new Response('<!doctype html><title>Not Found</title>', {
            status: 404,
            headers: { 'Content-Type': 'text/html' },
          });
        });

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus: vi.fn(async () => {}),
          prepareAsyncSubmission: vi.fn(async () => {}),
          updateRemoteId: vi.fn(async () => {}),
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
          resolveInvocationRoute: vi.fn(() => ({
            profileId: null,
            profileName: null,
            providerType: 'custom',
            baseUrl: '/v1',
            apiKey: 'test-key',
            modelId: 'veo3.1',
            source: 'legacy',
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

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      await expect(
        executor.generateVideo({
          taskId: 'task-veo-legacy',
          prompt: 'A cinematic rabbit',
          model: 'veo3.1',
        })
      ).rejects.toThrow('视频 API 端点返回了网页');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
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
