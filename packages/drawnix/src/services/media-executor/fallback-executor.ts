/**
 * Media Executor (Main Thread)
 *
 * 主线程媒体执行器，直接调用 API 并将结果写入 IndexedDB。
 * 所有 LLM API 请求在主线程直接发起（不经过 Service Worker）。
 */

import type {
  IMediaExecutor,
  ImageGenerationParams,
  VideoGenerationParams,
  AIAnalyzeParams,
  AIAnalyzeResult,
  TextGenerationParams,
  TextGenerationResult,
  ExecutionOptions,
  GeminiConfig,
  VideoAPIConfig,
} from './types';
import { Task, TaskStatus } from '../../types/task.types';
import { taskStorageWriter } from './task-storage-writer';
import { taskStorageReader } from '../task-storage-reader';
import {
  resolveInvocationRoute,
  type ModelRef,
} from '../../utils/settings-manager';
import { getDefaultImageModel } from '../../constants/model-config';
import {
  providerTransport,
  readProviderResponseJson,
  readProviderResponseText,
  isImageSubmissionOutcomeUnknownError,
  resolveInvocationPlanFromRoute,
  type ProviderAuthStrategy,
  type ResolvedProviderContext,
} from '../provider-routing';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  updateLLMApiLogMetadata,
  LLMReferenceImage,
} from './llm-api-logger';
import {
  callApiWithRetry,
  callGoogleGenerateContentRaw,
} from '../../utils/gemini-api/apiCalls';
import {
  buildManualHttpRequestPayload,
  buildManualHttpVariables,
  getManualHttpTemplate,
  normalizeManualTextResponse,
  renderTemplate,
} from '../provider-routing/manual-http-template';
import type { GeminiMessage as UnifiedGeminiMessage } from '../../utils/gemini-api/types';
import {
  classifyApiCredentialError,
  dispatchApiAuthError,
} from '../../utils/api-auth-error-event';
import { extractTextContent, parseToolCalls } from '../agent/tool-parser';
import { unifiedCacheService } from '../unified-cache-service';
import { submitVideoGeneration } from '../media-api';
import {
  extractPromptFromMessages,
  buildImageRequestBody,
  parseImageResponse,
  pollVideoStatus,
  generateAsyncImage,
  ensureBase64ForAI,
  materializeReferenceImagesSequentially,
  cacheRemoteUrl,
  cacheRemoteUrls,
} from './fallback-utils';
import { resolveAdapterForInvocation } from '../model-adapters';
import { GPT_IMAGE_EDIT_REQUEST_SCHEMAS } from '../model-adapters';
import {
  executeImageViaAdapter,
  executeVideoViaAdapter,
} from './fallback-adapter-routes';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';
import {
  assertTaskInvocationRouteAvailable,
  createTaskInvocationRouteSnapshot,
  resolveLegacyTaskInvocationRouteModel,
  shouldUseStrictTaskInvocationRoute,
} from '../task-invocation-route';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';
import { isPptExplainerTask } from '../ppt-explainer/validation';

function isCurrentExecutionAttempt(options?: ExecutionOptions): boolean {
  return !options?.signal?.aborted && options?.isCurrentAttempt?.() !== false;
}

function assertCurrentExecutionAttempt(options?: ExecutionOptions): void {
  if (!isCurrentExecutionAttempt(options)) {
    const error = new Error('任务执行已被取消或替代');
    error.name = 'AbortError';
    throw error;
  }
}

function requireRestoredVirtualImage(
  sourceUrl: string,
  imageData: { type: string; value: string } | null | undefined
): string {
  const restoredValue =
    typeof imageData?.value === 'string' ? imageData.value.trim() : '';
  const payloadStart = restoredValue.indexOf(',');
  if (
    imageData?.type !== 'base64' ||
    !/^data:image\/[a-z0-9.+-]+;base64,/i.test(restoredValue) ||
    payloadStart < 0 ||
    payloadStart === restoredValue.length - 1
  ) {
    throw new Error(`虚拟参考图片缓存不可用: ${sourceUrl}`);
  }
  return restoredValue;
}

function createStorageWriteGuard(options?: ExecutionOptions): {
  shouldUpdate: () => boolean;
} {
  return { shouldUpdate: () => isCurrentExecutionAttempt(options) };
}

interface VideoPollingAttempt {
  isCurrent: () => boolean;
  recoveryController?: AbortController;
}

function inferAuthTypeFromRoute(
  route: ReturnType<typeof resolveInvocationRoute>
): ProviderAuthStrategy {
  return 'bearer';
}

function buildProviderContext(config: {
  apiKey: string;
  baseUrl: string;
  authType?: ProviderAuthStrategy;
  providerType?: string;
  extraHeaders?: Record<string, string>;
  provider?: ResolvedProviderContext | null;
}): ResolvedProviderContext {
  return (
    config.provider || {
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: config.providerType || 'custom',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      authType: config.authType || 'bearer',
      extraHeaders: config.extraHeaders,
    }
  );
}

async function readResponseTextPreview(
  response: Response,
  limit = 1000
): Promise<string> {
  if (!response.body) {
    try {
      return (await response.clone().text()).slice(0, limit);
    } catch {
      return '';
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';

  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (text.length >= limit) {
      await reader.cancel().catch(() => undefined);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
  }

  return text.slice(0, limit);
}

function extractProviderErrorMessage(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed) as {
      message?: string;
      detail?: string;
      error?:
        | string
        | {
            message?: string;
            details?: string;
          };
    };
    if (typeof parsed.error === 'string') return parsed.error;
    return (
      parsed.error?.message ||
      parsed.error?.details ||
      parsed.message ||
      parsed.detail ||
      ''
    ).trim();
  } catch {
    return trimmed.replace(/\s+/g, ' ');
  }
}

/** 从 uploadedImages 提取 URL 列表，与 SW ImageHandler 逻辑一致 */
function extractUrlsFromUploadedImages(
  uploadedImages: unknown
): string[] | undefined {
  if (!uploadedImages || !Array.isArray(uploadedImages)) return undefined;
  const urls = (uploadedImages as Array<{ url?: string }>)
    .filter(
      (img) => img && typeof img === 'object' && typeof img.url === 'string'
    )
    .map((img) => img.url as string);
  return urls.length > 0 ? urls : undefined;
}

function getStringParam(
  params: ImageGenerationParams,
  keys: string[]
): string | undefined {
  const rawParams = params as unknown as Record<string, unknown>;
  const nestedParams =
    rawParams.params && typeof rawParams.params === 'object'
      ? (rawParams.params as Record<string, unknown>)
      : undefined;

  for (const key of keys) {
    const value = rawParams[key] ?? nestedParams?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function isImageEditRequest(
  params: ImageGenerationParams,
  referenceImages?: string[]
): boolean {
  const generationMode = getStringParam(params, [
    'generationMode',
    'generation_mode',
  ]);

  return (
    !!referenceImages?.length ||
    generationMode === 'image_edit' ||
    generationMode === 'image_to_image' ||
    !!getStringParam(params, ['maskImage', 'mask_image'])
  );
}

/**
 * 主线程媒体执行器
 *
 * 在主线程直接执行媒体生成任务，所有 API 请求使用原生 fetch。
 * 页面刷新会中断任务执行，通过 beforeunload 提示用户保护。
 */
export class FallbackMediaExecutor implements IMediaExecutor {
  readonly name = 'FallbackMediaExecutor';

  /**
   * 正在轮询的任务 ID 集合
   * 用于防止同一个任务被重复轮询（例如 resumePendingTasks 被多次调用时）
   */
  private pollingTasks = new Map<string, VideoPollingAttempt>();

  cancelPendingTask(taskId: string): void {
    const pollingAttempt = this.pollingTasks.get(taskId);
    pollingAttempt?.recoveryController?.abort();
    if (this.pollingTasks.get(taskId) === pollingAttempt) {
      this.pollingTasks.delete(taskId);
    }
  }

  cancelAllPendingTaskRecoveries(): void {
    for (const [taskId, pollingAttempt] of this.pollingTasks) {
      if (pollingAttempt.recoveryController) {
        this.cancelPendingTask(taskId);
      }
    }
  }

  /**
   * 降级执行器始终可用（只要浏览器支持 fetch）
   */
  async isAvailable(): Promise<boolean> {
    return typeof fetch === 'function';
  }

  /**
   * 生成图片
   * 参考图逻辑与 SW ImageHandler 对齐：支持 referenceImages 与 uploadedImages
   */
  async generateImage(
    params: ImageGenerationParams,
    options?: ExecutionOptions
  ): Promise<void> {
    const {
      taskId,
      requestId = taskId,
      prompt,
      model,
      modelRef,
      size,
      quality,
      count = 1,
    } = params;
    const referenceImages =
      (params.referenceImages && params.referenceImages.length > 0
        ? params.referenceImages
        : undefined) || extractUrlsFromUploadedImages(params.uploadedImages);
    const shouldUseEditSchema = isImageEditRequest(params, referenceImages);
    const invocationOptions = {
      preferredRequestSchema: shouldUseEditSchema
        ? GPT_IMAGE_EDIT_REQUEST_SCHEMAS
        : undefined,
    };

    const config = this.getConfig({ imageModel: modelRef || model });

    // 更新任务状态为 processing
    const activated = await taskStorageWriter.updateStatus(
      taskId,
      'processing',
      requestId,
      createStorageWriteGuard(options)
    );
    if (activated === false) {
      const staleAttemptError = new Error('图片提交已被取消或替代');
      staleAttemptError.name = 'AbortError';
      throw staleAttemptError;
    }
    options?.onProgress?.({ progress: 0, phase: 'submitting' });

    const startTime = Date.now();
    const modelName =
      modelRef?.modelId ||
      config.imageConfig.binding?.modelId ||
      config.imageConfig.modelName ||
      model ||
      getDefaultImageModel();

    // 异步图片模型：使用 /v1/videos 接口（仅当 binding 为 async-image 时）
    const imagePlan = resolveInvocationPlanFromRoute(
      'image',
      modelRef || modelName,
      invocationOptions
    );
    if (
      imagePlan?.binding.protocol === 'openai.async.media' ||
      imagePlan?.binding.requestSchema === 'openai.async.image.form'
    ) {
      return this.generateAsyncImageTask(
        taskId,
        {
          requestId,
          prompt,
          model: modelName,
          modelRef: modelRef || null,
          size,
          referenceImages,
          maskImage: params.maskImage,
          assetMetadata: params.assetMetadata,
          resultVisibility: params.resultVisibility,
        },
        config,
        options,
        startTime
      );
    }

    const imageAdapter = resolveAdapterForInvocation(
      'image',
      modelName,
      modelRef || null,
      invocationOptions
    );
    const shouldUseImageAdapter =
      imageAdapter?.kind === 'image' &&
      (imageAdapter.id !== 'gemini-image-adapter' ||
        imagePlan?.binding.protocol === 'google.generateContent');
    if (shouldUseImageAdapter) {
      return executeImageViaAdapter(
        taskId,
        imageAdapter,
        {
          requestId,
          prompt,
          model: modelName,
          modelRef: modelRef || null,
          size,
          resolution: params.resolution,
          quality,
          count,
          referenceImages,
          generationMode: params.generationMode,
          maskImage: params.maskImage,
          inputFidelity: params.inputFidelity,
          background: params.background,
          outputFormat: params.outputFormat,
          outputCompression: params.outputCompression,
          params: params.params,
          assetMetadata: params.assetMetadata,
          resultVisibility: params.resultVisibility,
          preferredRequestSchema: invocationOptions.preferredRequestSchema,
        },
        options,
        startTime
      );
    }

    // 开始记录 LLM API 调用
    const logId = startLLMApiLog({
      endpoint: '/images/generations',
      model: modelName,
      taskType: 'image',
      prompt,
      hasReferenceImages: !!referenceImages && referenceImages.length > 0,
      referenceImageCount: referenceImages?.length,
      referenceImages: referenceImages?.map(
        (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
      ),
      taskId,
    });
    try {
      // 处理参考图片：统一转为 base64（API 要求）
      let processedImages: string[] | undefined;
      if (referenceImages && referenceImages.length > 0) {
        processedImages = await materializeReferenceImagesSequentially(
          referenceImages,
          options
        );
      }

      // 构建请求体
      const requestBody = buildImageRequestBody({
        prompt,
        model: modelName,
        size,
        referenceImages: processedImages,
        quality,
        n: Math.min(Math.max(1, count), 10),
      });

      options?.onProgress?.({ progress: 10, phase: 'submitting' });

      // 直接调用 API
      const invocationRoute = imagePlan
        ? createTaskInvocationRouteSnapshot('image', imagePlan.modelRef, {
            bindingId: imagePlan.binding.id,
          })
        : undefined;
      await options?.onSubmissionAttempt?.(invocationRoute);
      const response = await providerTransport.send(
        buildProviderContext(config.imageConfig),
        {
          path: '/images/generations',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: options?.signal,
          timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
          requestId,
        }
      );

      if (!response.ok) {
        const duration = Date.now() - startTime;
        const errorBody = await readProviderResponseText(response).catch(
          () => `HTTP ${response.status} ${response.statusText || 'Error'}`
        );
        failLLMApiLog(logId, {
          httpStatus: response.status,
          duration,
          errorMessage: errorBody.substring(0, 500),
        });
        throw Object.assign(
          new Error(
            `Image generation failed: ${
              response.status
            } - ${errorBody.substring(0, 200)}`
          ),
          { httpStatus: response.status }
        );
      }

      const data = await readProviderResponseJson<Record<string, unknown>>(
        response
      );
      options?.onProgress?.({ progress: 80, phase: 'downloading' });
      const result = parseImageResponse(data);
      assertCurrentExecutionAttempt(options);
      const duration = Date.now() - startTime;
      // 记录成功
      completeLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        resultType: 'image',
        resultCount: 1,
        resultUrl: result.url,
      });

      options?.onProgress?.({ progress: 100 });

      // 缓存远程 URL 到本地，避免签名 URL 的 Referer 校验问题
      const allImgUrls = result.urls?.length ? result.urls : [result.url];
      const cachedImgUrls = await cacheRemoteUrls(
        allImgUrls,
        taskId,
        'image',
        'png',
        {
          forceRemoteCache: true,
          returnLocalCacheUrl: true,
          cacheKey: requestId,
          resultVisibility: params.resultVisibility,
        }
      );
      assertCurrentExecutionAttempt(options);

      // 完成任务
      const completed = await taskStorageWriter.completeTask(
        taskId,
        {
          url: cachedImgUrls[0],
          urls: cachedImgUrls.length > 1 ? cachedImgUrls : undefined,
          format: 'png',
          size: 0,
        },
        requestId,
        createStorageWriteGuard(options)
      );
      if (completed === false) {
        const staleAttemptError = new Error('图片提交已被取消或替代');
        staleAttemptError.name = 'AbortError';
        throw staleAttemptError;
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errorMessage = error.message || 'Image generation failed';

      if (options?.isCurrentAttempt?.() === false) {
        failLLMApiLog(logId, { duration, errorMessage });
        throw error;
      }
      console.error(
        '[FallbackMediaExecutor] generateImage failed:',
        errorMessage,
        'taskId:',
        taskId,
        'duration:',
        duration,
        'ms'
      );

      // 检测认证错误，触发设置弹窗
      const credentialErrorKind = classifyApiCredentialError(error);
      if (credentialErrorKind) {
        dispatchApiAuthError({
          message: errorMessage,
          source: 'image',
          reason: credentialErrorKind,
        });
      }

      // 如果日志还未更新为失败，更新它
      failLLMApiLog(logId, {
        duration,
        errorMessage,
      });
      if (isImageSubmissionOutcomeUnknownError(error)) {
        throw error;
      }
      await taskStorageWriter.failTask(
        taskId,
        {
          code: 'IMAGE_GENERATION_ERROR',
          message: errorMessage,
        },
        requestId,
        createStorageWriteGuard(options)
      );
      throw error;
    }
  }

  /**
   * 生成异步图片（使用 /v1/videos 接口）
   * 与 SW 模式保持一致的实现
   */
  private async generateAsyncImageTask(
    taskId: string,
    params: {
      requestId?: string;
      prompt: string;
      model: string;
      modelRef?: ImageGenerationParams['modelRef'];
      size?: string;
      referenceImages?: string[];
      maskImage?: string;
      assetMetadata?: ImageGenerationParams['assetMetadata'];
      resultVisibility?: ImageGenerationParams['resultVisibility'];
    },
    config: { imageConfig: GeminiConfig; videoConfig: VideoAPIConfig },
    options?: ExecutionOptions,
    startTime?: number
  ): Promise<void> {
    const logStartTime = startTime || Date.now();
    const submissionRequestId = params.requestId || taskId;
    // 开始记录 LLM API 调用
    const logId = startLLMApiLog({
      endpoint: '/v1/videos (async image)',
      model: params.model,
      taskType: 'image',
      prompt: params.prompt,
      hasReferenceImages:
        params.referenceImages && params.referenceImages.length > 0,
      referenceImageCount: params.referenceImages?.length,
      referenceImages: params.referenceImages?.map(
        (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
      ),
      taskId,
    });

    try {
      // 处理参考图片：统一转为 base64（与同步路径一致）
      let processedImages: string[] | undefined;
      if (params.referenceImages && params.referenceImages.length > 0) {
        processedImages = await materializeReferenceImagesSequentially(
          params.referenceImages,
          options
        );
      }
      let processedMaskImage: string | undefined;
      if (params.maskImage) {
        const maskData = await unifiedCacheService.getImageForAI(
          params.maskImage
        );
        processedMaskImage = await ensureBase64ForAI(maskData, options?.signal);
      }

      // 调用异步图片生成
      const result = await generateAsyncImage(
        {
          prompt: params.prompt,
          model: params.model,
          size: params.size,
          referenceImages: processedImages,
          maskImage: processedMaskImage,
        },
        config.imageConfig,
        {
          onSubmissionAttempt: async () => {
            await options?.onSubmissionAttempt?.();
          },
          onProgress: (progress) => {
            options?.onProgress?.({
              progress,
              phase: progress < 10 ? 'submitting' : 'polling',
            });
          },
          onSubmitted: async (remoteId) => {
            assertCurrentExecutionAttempt(options);
            // 保存 remoteId，用于页面刷新后恢复轮询
            const updated = await taskStorageWriter.updateRemoteId(
              taskId,
              remoteId,
              createTaskInvocationRouteSnapshot(
                'image',
                params.modelRef || params.model
              ),
              submissionRequestId,
              createStorageWriteGuard(options)
            );
            if (updated === false) {
              const staleAttemptError = new Error('图片提交已被取消或替代');
              staleAttemptError.name = 'AbortError';
              throw staleAttemptError;
            }
          },
          signal: options?.signal,
          requestId: submissionRequestId,
        }
      );
      assertCurrentExecutionAttempt(options);

      const duration = Date.now() - logStartTime;

      // 记录成功
      completeLLMApiLog(logId, {
        httpStatus: 200,
        duration,
        resultType: 'image',
        resultCount: 1,
        resultUrl: result.url,
      });

      options?.onProgress?.({ progress: 100 });

      // 缓存远程 URL 到本地
      const cachedAsyncUrl = await cacheRemoteUrl(
        result.url,
        taskId,
        'image',
        result.format,
        undefined,
        {
          forceRemoteCache: true,
          returnLocalCacheUrl: true,
          cacheKey: submissionRequestId,
          extraMetadata: params.assetMetadata
            ? { ...params.assetMetadata }
            : undefined,
          resultVisibility: params.resultVisibility,
        }
      );
      assertCurrentExecutionAttempt(options);

      // 完成任务
      const completed = await taskStorageWriter.completeTask(
        taskId,
        {
          url: cachedAsyncUrl,
          format: result.format,
          size: 0,
        },
        submissionRequestId,
        createStorageWriteGuard(options)
      );
      if (completed === false) {
        const staleAttemptError = new Error('图片提交已被取消或替代');
        staleAttemptError.name = 'AbortError';
        throw staleAttemptError;
      }
    } catch (error: any) {
      const duration = Date.now() - logStartTime;
      const errorMessage = error.message || 'Async image generation failed';

      if (options?.isCurrentAttempt?.() === false) {
        failLLMApiLog(logId, { duration, errorMessage });
        throw error;
      }

      // 检测认证错误，触发设置弹窗
      const credentialErrorKind = classifyApiCredentialError(error);
      if (credentialErrorKind) {
        dispatchApiAuthError({
          message: errorMessage,
          source: 'async-image',
          reason: credentialErrorKind,
        });
      }

      failLLMApiLog(logId, {
        duration,
        errorMessage,
      });
      await taskStorageWriter.failTask(
        taskId,
        {
          code: 'ASYNC_IMAGE_GENERATION_ERROR',
          message: errorMessage,
        },
        submissionRequestId,
        createStorageWriteGuard(options)
      );
      throw error;
    }
  }

  /**
   * 生成视频
   * 使用共享 submitVideoGeneration，支持参考图且参考图体积控制在 1MB 内
   */
  async generateVideo(
    params: VideoGenerationParams,
    options?: ExecutionOptions
  ): Promise<void> {
    const {
      taskId,
      prompt,
      model = 'veo3',
      modelRef,
      duration,
      size = '1280x720',
    } = params;
    const invocationRoute = createTaskInvocationRouteSnapshot(
      'video',
      modelRef || model
    );
    const config = this.getConfig({ videoModel: modelRef || model });
    const startTime = Date.now();
    const durationEncodedInModel = (m?: string | null) =>
      Boolean(m && m.startsWith('sora-2-'));
    const shouldSkipSeconds = durationEncodedInModel(model);
    const secondsToSend = shouldSkipSeconds ? undefined : duration ?? '8';

    assertCurrentExecutionAttempt(options);
    await taskStorageWriter.updateStatus(
      taskId,
      'processing',
      undefined,
      createStorageWriteGuard(options)
    );
    assertCurrentExecutionAttempt(options);
    options?.onProgress?.({ progress: 0, phase: 'submitting' });

    // 专用 adapter 路由（kling 等非 gemini 模型）
    const videoAdapter = resolveAdapterForInvocation(
      'video',
      model,
      modelRef || null
    );
    if (videoAdapter && videoAdapter.kind === 'video') {
      return executeVideoViaAdapter(
        taskId,
        videoAdapter,
        {
          prompt,
          model,
          modelRef: modelRef || null,
          size,
          duration,
          referenceImages: params.referenceImages,
          inputReference: params.inputReference,
          params: params.params,
        },
        options,
        startTime
      );
    }

    // 收集参考图原始 URL（用于日志记录）
    const logRefUrls =
      (params.referenceImages && params.referenceImages.length > 0
        ? params.referenceImages
        : undefined) ||
      (params.inputReference ? [params.inputReference] : undefined);

    const logId = startLLMApiLog({
      endpoint: '/v1/videos',
      model,
      taskType: 'video',
      prompt,
      taskId,
      hasReferenceImages: !!logRefUrls && logRefUrls.length > 0,
      referenceImageCount: logRefUrls?.length,
      referenceImages: logRefUrls?.map(
        (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
      ),
    });

    try {
      // 参考图：虚拟路径先转为 data URL（1MB 内），再交给 submitVideoGeneration 走 FormData+压缩
      const refUrls =
        (params.referenceImages && params.referenceImages.length > 0
          ? params.referenceImages
          : undefined) ||
        (params.inputReference ? [params.inputReference] : undefined);
      let referenceImages: string[] | undefined;
      if (refUrls && refUrls.length > 0) {
        const isVirtual = (u: string) =>
          u.startsWith('/__aitu_cache__/') || u.startsWith('/asset-library/');
        referenceImages = await materializeReferenceImagesSequentially(
          refUrls,
          {
            ...options,
            preserveUrl: (url) => !isVirtual(url),
          }
        );
      }
      assertCurrentExecutionAttempt(options);

      const videoApiConfig = {
        ...config.videoConfig,
        params: params.params,
        defaultModel: 'veo3' as const,
      };
      const videoId = await submitVideoGeneration(
        {
          prompt,
          model,
          size,
          duration: secondsToSend,
          referenceImages,
          params: params.params,
        },
        videoApiConfig,
        options?.signal
      );
      assertCurrentExecutionAttempt(options);

      if (!videoId) {
        const elapsedTime = Date.now() - startTime;
        failLLMApiLog(logId, {
          httpStatus: 200,
          duration: elapsedTime,
          errorMessage: 'No video ID returned from API',
        });
        throw new Error('No video ID returned from API');
      }

      updateLLMApiLogMetadata(logId, {
        remoteId: videoId,
        httpStatus: 200,
      });

      // 保存 remoteId，用于页面刷新后恢复轮询
      await taskStorageWriter.updateRemoteId(
        taskId,
        videoId,
        invocationRoute,
        undefined,
        createStorageWriteGuard(options)
      );
      assertCurrentExecutionAttempt(options);

      options?.onProgress?.({ progress: 10, phase: 'polling' });

      // 轮询等待视频完成
      const isCurrentTaskAttempt = () =>
        !options?.signal?.aborted && options?.isCurrentAttempt?.() !== false;
      const currentPollingAttempt = this.pollingTasks.get(taskId);
      if (!currentPollingAttempt?.isCurrent()) {
        const isCurrentPollingAttempt = () =>
          this.pollingTasks.get(taskId)?.isCurrent ===
            isCurrentPollingAttempt && isCurrentTaskAttempt();
        const pollingAttempt = { isCurrent: isCurrentPollingAttempt };
        this.pollingTasks.set(taskId, pollingAttempt);
        try {
          const result = await pollVideoStatus(
            videoId,
            config.videoConfig,
            (progress) => {
              if (!isCurrentPollingAttempt()) return;
              // progress 是 0-1 范围（来自 pollVideoStatus 的 progress/100）
              // 映射到 10-90 范围：10 + (0~1) * 80 = 10~90
              options?.onProgress?.({
                progress: 10 + progress * 80,
                phase: 'polling',
              });
            },
            options?.signal,
            isCurrentPollingAttempt
          );
          assertCurrentExecutionAttempt(options);

          const elapsedTime = Date.now() - startTime;

          // 记录成功
          completeLLMApiLog(logId, {
            httpStatus: 200,
            duration: elapsedTime,
            resultType: 'video',
            resultCount: 1,
            resultUrl: result.url,
            remoteId: videoId,
          });

          options?.onProgress?.({ progress: 100 });

          // 缓存远程 URL 到本地
          const cachedVidUrl = await cacheRemoteUrl(
            result.url,
            taskId,
            'video',
            'mp4'
          );
          assertCurrentExecutionAttempt(options);

          // 完成任务
          await taskStorageWriter.completeTask(
            taskId,
            {
              url: cachedVidUrl,
              format: 'mp4',
              size: 0,
              duration: duration ? parseInt(duration, 10) : undefined,
            },
            undefined,
            createStorageWriteGuard(options)
          );
        } finally {
          if (this.pollingTasks.get(taskId) === pollingAttempt) {
            this.pollingTasks.delete(taskId);
          }
        }
      }
    } catch (error: any) {
      if (options?.signal?.aborted || options?.isCurrentAttempt?.() === false) {
        return;
      }
      const elapsedTime = Date.now() - startTime;
      const errorMessage = error.message || 'Video generation failed';

      // 检测认证错误，触发设置弹窗
      const credentialErrorKind = classifyApiCredentialError(error);
      if (credentialErrorKind) {
        dispatchApiAuthError({
          message: errorMessage,
          source: 'video',
          reason: credentialErrorKind,
        });
      }

      failLLMApiLog(logId, {
        duration: elapsedTime,
        errorMessage,
      });
      await taskStorageWriter.failTask(
        taskId,
        {
          code: error.code || 'VIDEO_GENERATION_ERROR',
          message: errorMessage,
        },
        undefined,
        createStorageWriteGuard(options)
      );
      throw error;
    }
  }

  /**
   * AI 分析
   */
  async aiAnalyze(
    params: AIAnalyzeParams,
    options?: ExecutionOptions
  ): Promise<AIAnalyzeResult> {
    const {
      taskId,
      prompt,
      messages,
      images,
      referenceImages,
      model,
      textModel,
      modelRef,
      systemPrompt,
    } = params;
    const config = this.getConfig({
      textModel: modelRef || textModel || model,
    });
    const startTime = Date.now();
    // 优先使用用户选择的模型
    const modelName = textModel || model || config.textConfig.modelName;
    // 合并图片参数
    const allImages = referenceImages || images || [];

    // 注意：AI 分析任务不写入 tasks 表，chat 类型不应该出现在用户任务列表
    options?.onProgress?.({ progress: 0, phase: 'submitting' });

    // 构建消息数组
    let chatMessages: Array<{ role: string; content: unknown }>;

    if (messages && messages.length > 0) {
      // 使用预构建的消息（与 SW 端一致）
      chatMessages = messages;
    } else if (prompt) {
      // 使用 prompt 构建消息
      const contents: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }> = [{ type: 'text', text: prompt }];

      // 添加图片
      if (allImages.length > 0) {
        for (const imageUrl of allImages) {
          contents.push({
            type: 'image_url',
            image_url: { url: imageUrl },
          });
        }
      }

      chatMessages = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: contents },
      ];
    } else {
      throw new Error('缺少必填参数：需要 messages 或 prompt');
    }

    // 提取 prompt 用于日志记录
    const logPrompt = extractPromptFromMessages(chatMessages);

    // 开始记录 LLM API 调用
    const logId = startLLMApiLog({
      endpoint: '/chat/completions',
      model: modelName,
      taskType: 'chat',
      prompt: logPrompt,
      hasReferenceImages: allImages.length > 0,
      referenceImageCount: allImages.length,
      taskId,
    });

    try {
      options?.onProgress?.({ progress: 30, phase: 'submitting' });

      const unifiedMessages: UnifiedGeminiMessage[] = chatMessages.map(
        (message) => ({
          role: message.role as 'system' | 'user' | 'assistant',
          content:
            typeof message.content === 'string'
              ? [{ type: 'text', text: message.content }]
              : (message.content as UnifiedGeminiMessage['content']),
        })
      );

      const data = await callApiWithRetry(config.textConfig, unifiedMessages);

      options?.onProgress?.({ progress: 80 });

      const fullResponse = data.choices?.[0]?.message?.content || '';
      const elapsedTime = Date.now() - startTime;

      // 记录成功
      completeLLMApiLog(logId, {
        httpStatus: 200,
        duration: elapsedTime,
        resultType: 'text',
        resultCount: 1,
        resultText: fullResponse.substring(0, 500),
        responseBody: JSON.stringify(data), // 记录完整的 JSON 响应体
      });

      // 解析 tool calls（AI 规划的后续任务）
      const toolCalls = parseToolCalls(fullResponse);
      const textContent = extractTextContent(fullResponse);

      // 转换为 addSteps 格式
      const addSteps = toolCalls.map((tc, index) => {
        // 替换图片占位符
        const processedArgs = { ...tc.arguments };
        if (images && images.length > 0 && processedArgs.referenceImages) {
          const refs = processedArgs.referenceImages as string[];
          processedArgs.referenceImages = refs.map((placeholder) => {
            const match = placeholder.match(/\[图片(\d+)\]/);
            if (match) {
              const idx = parseInt(match[1], 10) - 1;
              return images[idx] || placeholder;
            }
            return placeholder;
          });
        }

        return {
          id: `ai-step-${Date.now()}-${index}`,
          mcp: tc.name,
          args: processedArgs,
          description: textContent || `执行 ${tc.name}`,
          status: 'pending' as const,
        };
      });

      options?.onProgress?.({ progress: 100 });

      return {
        content: textContent,
        addSteps: addSteps.length > 0 ? addSteps : undefined,
      };
    } catch (error: any) {
      const elapsedTime = Date.now() - startTime;
      const errorMessage = error.message || 'AI analyze failed';

      // 检测认证错误，触发设置弹窗
      const credentialErrorKind = classifyApiCredentialError(error);
      if (credentialErrorKind) {
        dispatchApiAuthError({
          message: errorMessage,
          source: 'ai-analyze',
          reason: credentialErrorKind,
        });
      }

      failLLMApiLog(logId, {
        duration: elapsedTime,
        errorMessage,
      });
      throw error;
    }
  }

  async generateText(
    params: TextGenerationParams,
    options?: ExecutionOptions
  ): Promise<TextGenerationResult> {
    const {
      taskId,
      prompt,
      model,
      modelRef,
      referenceImages,
      inlineDataParts,
      params: extraParams,
    } = params;
    const startTime = Date.now();
    const config = this.getConfig({
      textModel: modelRef || model,
    });
    const modelName = model || config.textConfig.modelName;
    const normalizedPrompt = prompt.trim();
    let resolvedReferenceImages = referenceImages;
    if (referenceImages?.some(isVirtualMediaUrl)) {
      resolvedReferenceImages = [];
      for (const url of referenceImages) {
        assertCurrentExecutionAttempt(options);
        if (!isVirtualMediaUrl(url)) {
          resolvedReferenceImages.push(url);
          continue;
        }
        const imageData = await unifiedCacheService.getImageForAI(url);
        resolvedReferenceImages.push(
          requireRestoredVirtualImage(url, imageData)
        );
      }
      assertCurrentExecutionAttempt(options);
    }
    const messages: UnifiedGeminiMessage[] = [
      {
        role: 'user',
        content: [
          ...(normalizedPrompt
            ? [{ type: 'text' as const, text: normalizedPrompt }]
            : []),
          ...((inlineDataParts || []).map((part) => part) || []),
          ...((resolvedReferenceImages || []).map((url) => ({
            type: 'image_url' as const,
            image_url: { url },
          })) || []),
        ],
      },
    ];

    const logId = startLLMApiLog({
      endpoint: '/chat/completions',
      model: modelName,
      taskType: 'chat',
      prompt,
      hasReferenceImages: !!referenceImages?.length,
      referenceImageCount: referenceImages?.length,
    });

    const toNumber = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return undefined;
    };

    try {
      assertCurrentExecutionAttempt(options);
      if (taskId) {
        await taskStorageWriter.updateStatus(
          taskId,
          'processing',
          undefined,
          createStorageWriteGuard(options)
        );
      }
      assertCurrentExecutionAttempt(options);
      options?.onProgress?.({ progress: 30, phase: 'submitting' });
      if (taskId) {
        await taskStorageWriter.updateProgress(
          taskId,
          30,
          'submitting',
          undefined,
          createStorageWriteGuard(options)
        );
      }
      assertCurrentExecutionAttempt(options);

      const manualHttpTemplate = getManualHttpTemplate(
        config.textConfig.binding?.metadata
      );
      const manualVariables = manualHttpTemplate
        ? buildManualHttpVariables({
            model: modelName,
            modelRef: config.textConfig.binding?.modelId
              ? {
                  profileId: config.textConfig.binding.profileId,
                  modelId: config.textConfig.binding.modelId,
                }
              : null,
            prompt: normalizedPrompt,
            messages,
            images: resolvedReferenceImages,
            params: extraParams,
          })
        : null;
      const manualPayload =
        manualHttpTemplate && manualVariables
          ? await buildManualHttpRequestPayload(
              manualHttpTemplate,
              manualVariables,
              undefined,
              options?.signal
            )
          : null;
      const data = manualHttpTemplate
        ? await providerTransport
            .send(buildProviderContext(config.textConfig), {
              path: renderTemplate(
                config.textConfig.binding?.submitPath || '/chat/completions',
                manualVariables || {}
              ) as string,
              baseUrlStrategy: config.textConfig.binding?.baseUrlStrategy,
              method:
                manualHttpTemplate.method ||
                (manualPayload?.body === undefined ? 'GET' : 'POST'),
              headers: {
                ...(manualPayload?.contentType
                  ? { 'Content-Type': manualPayload.contentType }
                  : {}),
                ...(!manualPayload?.contentType &&
                manualPayload?.body !== undefined &&
                !(manualPayload.body instanceof FormData)
                  ? { 'Content-Type': 'application/json' }
                  : {}),
                ...(renderTemplate(
                  manualHttpTemplate.headers || {},
                  manualVariables || {}
                ) as Record<string, string>),
              },
              body: manualPayload?.body,
              signal: options?.signal,
            })
            .then(async (response) => {
              if (!response.ok) {
                const rawError = await readResponseTextPreview(response);
                const providerMessage = extractProviderErrorMessage(rawError);
                throw new Error(
                  `HTTP ${response.status}: ${
                    providerMessage ||
                    response.statusText ||
                    'Text generation failed'
                  }`
                );
              }
              const rawText = await response.text();
              let payload: unknown = rawText;
              if (rawText.trim()) {
                try {
                  payload = JSON.parse(rawText);
                } catch {
                  payload = rawText;
                }
              }
              return normalizeManualTextResponse(
                payload,
                manualHttpTemplate.responsePaths
              );
            })
        : config.textConfig.protocol === 'google.generateContent'
        ? await callGoogleGenerateContentRaw(config.textConfig, messages, {
            stream: false,
            signal: options?.signal,
            generationConfig: {
              ...(toNumber(extraParams?.temperature) !== undefined
                ? { temperature: toNumber(extraParams?.temperature) }
                : {}),
              ...(toNumber(extraParams?.top_p) !== undefined
                ? { topP: toNumber(extraParams?.top_p) }
                : {}),
              ...(toNumber(extraParams?.max_tokens) !== undefined
                ? { maxOutputTokens: toNumber(extraParams?.max_tokens) }
                : {}),
              ...(typeof extraParams?.response_mime_type === 'string' &&
              extraParams.response_mime_type.trim()
                ? {
                    responseMimeType: extraParams.response_mime_type.trim(),
                  }
                : {}),
            },
          })
        : await providerTransport
            .send(buildProviderContext(config.textConfig), {
              path:
                config.textConfig.binding?.submitPath || '/chat/completions',
              baseUrlStrategy: config.textConfig.binding?.baseUrlStrategy,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: modelName,
                messages,
                stream: false,
                ...(toNumber(extraParams?.temperature) !== undefined
                  ? { temperature: toNumber(extraParams?.temperature) }
                  : {}),
                ...(toNumber(extraParams?.top_p) !== undefined
                  ? { top_p: toNumber(extraParams?.top_p) }
                  : {}),
                ...(toNumber(extraParams?.max_tokens) !== undefined
                  ? { max_tokens: toNumber(extraParams?.max_tokens) }
                  : {}),
                ...(typeof extraParams?.response_format === 'object'
                  ? { response_format: extraParams.response_format }
                  : {}),
              }),
              signal: options?.signal,
            })
            .then(async (response) => {
              if (!response.ok) {
                const rawError = await readResponseTextPreview(response);
                const providerMessage = extractProviderErrorMessage(rawError);
                throw new Error(
                  `HTTP ${response.status}: ${
                    providerMessage ||
                    response.statusText ||
                    'Text generation failed'
                  }`
                );
              }
              return response.json();
            });
      assertCurrentExecutionAttempt(options);

      const fullResponse = data.choices?.[0]?.message?.content || '';
      options?.onProgress?.({ progress: 100 });
      assertCurrentExecutionAttempt(options);
      if (taskId) {
        await taskStorageWriter.completeTask(
          taskId,
          {
            url: '',
            format: 'md',
            size: fullResponse.length,
            resultKind: 'chat',
            title: prompt.slice(0, 80),
            chatResponse: fullResponse,
          },
          undefined,
          createStorageWriteGuard(options)
        );
      }
      assertCurrentExecutionAttempt(options);
      completeLLMApiLog(logId, {
        httpStatus: 200,
        duration: Date.now() - startTime,
        resultType: 'text',
        resultCount: 1,
        resultText: fullResponse.substring(0, 500),
      });

      return {
        content: fullResponse,
      };
    } catch (error: any) {
      if (options?.signal?.aborted || options?.isCurrentAttempt?.() === false) {
        throw error;
      }
      if (taskId) {
        await taskStorageWriter.failTask(
          taskId,
          {
            code: 'TEXT_GENERATION_FAILED',
            message: error?.message || 'Text generation failed',
          },
          undefined,
          createStorageWriteGuard(options)
        );
      }
      failLLMApiLog(logId, {
        duration: Date.now() - startTime,
        errorMessage: error?.message || 'Text generation failed',
      });
      throw error;
    }
  }

  /**
   * 恢复未完成的任务（例如页面刷新导致中断的任务）
   * 仅恢复有 remoteId 且状态为 processing 的通用视频任务
   * PPT 讲解任务由专用编排器恢复。
   *
   * @param onTaskUpdate - 任务状态更新回调
   * @param tasksFromMemory - 可选，从内存中传入的任务列表（避免 IndexedDB 读取竞态）
   */
  async resumePendingTasks(
    onTaskUpdate?: (
      taskId: string,
      status: TaskStatus,
      updates?: Partial<Task>
    ) => void,
    tasksFromMemory?: Task[],
    createTaskExecutionGuard?: (taskId: string) => () => boolean
  ): Promise<void> {
    try {
      // 优先使用内存中的任务列表，避免 useTaskStorage 的 fire-and-forget persistTask
      // 尚未写入 IndexedDB 导致读取到旧状态的竞态问题
      let pendingTasks: Task[];
      if (tasksFromMemory) {
        pendingTasks = tasksFromMemory.filter(
          (t) => t.status === TaskStatus.PROCESSING
        );
        console.warn(
          `[FallbackMediaExecutor] resumePendingTasks: found ${pendingTasks.length} processing tasks from memory`
        );
      } else {
        pendingTasks = await taskStorageReader.getAllTasks({
          status: TaskStatus.PROCESSING,
        });
        console.warn(
          `[FallbackMediaExecutor] resumePendingTasks: found ${pendingTasks.length} processing tasks from IndexedDB (fallback)`
        );
      }

      // 筛选出有 remoteId 的视频任务
      const videoTasks = pendingTasks.filter(
        (t) =>
          t.type === 'video' &&
          !isPptExplainerTask(t) &&
          t.remoteId &&
          t.status === TaskStatus.PROCESSING
      );

      // 日志：列出所有处理中的任务及其筛选结果
      for (const t of pendingTasks) {
        const isVideo = t.type === 'video';
        const hasRemoteId = !!t.remoteId;
        const isPptExplainer = isPptExplainerTask(t);
        const willResume = isVideo && !isPptExplainer && hasRemoteId;
        console.warn(
          `[FallbackMediaExecutor]   task=${t.id} type=${t.type} remoteId=${
            t.remoteId || 'none'
          } → ${willResume ? 'RESUME' : 'SKIP'}${
            !isVideo ? ' (not video)' : ''
          }${isPptExplainer ? ' (ppt explainer)' : ''}${
            !hasRemoteId ? ' (no remoteId)' : ''
          }`
        );
      }

      if (videoTasks.length === 0) {
        console.warn('[FallbackMediaExecutor] No video tasks to resume');
        return;
      }
      // 并行恢复
      await Promise.all(
        videoTasks.map((task) =>
          this.resumeVideoTask(
            task,
            onTaskUpdate,
            createTaskExecutionGuard?.(task.id)
          )
        )
      );
    } catch (error) {
      console.error(
        '[FallbackMediaExecutor] Failed to resume pending tasks:',
        error
      );
    }
  }

  /**
   * 恢复单个视频任务的轮询
   */
  private async resumeVideoTask(
    task: Task,
    onTaskUpdate?: (
      taskId: string,
      status: TaskStatus,
      updates?: Partial<Task>
    ) => void,
    isTaskExecutionCurrent: () => boolean = () => true
  ): Promise<void> {
    // 如果任务已经在轮询中，直接跳过
    const currentPollingAttempt = this.pollingTasks.get(task.id);
    if (currentPollingAttempt?.isCurrent()) {
      return;
    }
    if (!isTaskExecutionCurrent()) return;

    currentPollingAttempt?.recoveryController?.abort();

    const videoId = task.remoteId!;
    const recoveryController = new AbortController();

    // 标记为正在轮询
    const isCurrentPollingAttempt = () =>
      this.pollingTasks.get(task.id)?.isCurrent === isCurrentPollingAttempt &&
      !recoveryController.signal.aborted &&
      isTaskExecutionCurrent();
    const pollingAttempt = {
      isCurrent: isCurrentPollingAttempt,
      recoveryController,
    };
    this.pollingTasks.set(task.id, pollingAttempt);

    try {
      if (shouldUseStrictTaskInvocationRoute(task)) {
        assertTaskInvocationRouteAvailable('video', task);
      }
      const routeModel = resolveLegacyTaskInvocationRouteModel('video', task);
      const config = this.getConfig({ videoModel: routeModel });
      config.videoConfig.params = (task.params as any).params;

      // 重新开始轮询
      const result = await pollVideoStatus(
        videoId,
        config.videoConfig,
        (progress) => {
          if (!isCurrentPollingAttempt()) return;
          // 这里的 progress 是 0-1
          // 视频生成中，polling 阶段通常对应 10%-90%
          const mappedProgress = 10 + progress * 80;

          if (onTaskUpdate) {
            onTaskUpdate(task.id, TaskStatus.PROCESSING, {
              progress: mappedProgress,
            });
          } else {
            // taskStorageWriter.updateStatus 会写入 storage
            taskStorageWriter
              .updateStatus(task.id, TaskStatus.PROCESSING, undefined, {
                shouldUpdate: isCurrentPollingAttempt,
              })
              .catch(() => undefined);
            taskStorageWriter
              .updateProgress(task.id, mappedProgress, undefined, undefined, {
                shouldUpdate: isCurrentPollingAttempt,
              })
              .catch(() => undefined);
          }
        },
        recoveryController.signal,
        isCurrentPollingAttempt
      );
      if (!isCurrentPollingAttempt()) return;

      // 缓存远程 URL
      const cachedVidUrl = await cacheRemoteUrl(
        result.url,
        task.id,
        'video',
        'mp4'
      );
      if (!isCurrentPollingAttempt()) return;

      const duration = task.params.duration as string | undefined;

      const completionResult = {
        url: cachedVidUrl,
        format: 'mp4',
        size: 0,
        duration: duration ? parseInt(duration, 10) : undefined,
      };

      if (onTaskUpdate) {
        onTaskUpdate(task.id, TaskStatus.COMPLETED, {
          result: completionResult,
          progress: 100,
          completedAt: Date.now(),
        });
      } else {
        await taskStorageWriter.completeTask(
          task.id,
          completionResult,
          undefined,
          { shouldUpdate: isCurrentPollingAttempt }
        );
      }
    } catch (error: any) {
      if (!isCurrentPollingAttempt()) return;
      console.error(
        `[FallbackMediaExecutor] Failed to resume task ${task.id}:`,
        error
      );

      const errorInfo = {
        code: error.code || 'RESUME_FAILED',
        message: error.message || 'Failed to resume task',
      };

      if (onTaskUpdate) {
        onTaskUpdate(task.id, TaskStatus.FAILED, { error: errorInfo });
      } else {
        await taskStorageWriter
          .failTask(task.id, errorInfo, undefined, {
            shouldUpdate: isCurrentPollingAttempt,
          })
          .catch(() => undefined);
        console.warn(
          `[FallbackMediaExecutor] No onTaskUpdate callback for failed task ${task.id}, UI won't update`
        );
      }
    } finally {
      // 无论成功还是失败，都移除标记
      if (this.pollingTasks.get(task.id) === pollingAttempt) {
        this.pollingTasks.delete(task.id);
      }
    }
  }

  /**
   * 规范化 baseUrl，移除尾部 / 或 /v1，便于拼接 /v1/videos
   */
  private normalizeApiBase(url: string): string {
    let base = url.replace(/\/+$/, '');
    if (base.endsWith('/v1')) {
      base = base.slice(0, -3);
    }
    return base;
  }

  /**
   * 获取 API 配置
   */
  private getConfig(models?: {
    imageModel?: string | ModelRef | null;
    textModel?: string | ModelRef | null;
    videoModel?: string | ModelRef | null;
  }): {
    imageConfig: GeminiConfig;
    textConfig: GeminiConfig;
    videoConfig: VideoAPIConfig;
  } {
    const imageRoute = resolveInvocationRoute('image', models?.imageModel);
    const textRoute = resolveInvocationRoute('text', models?.textModel);
    const videoRoute = resolveInvocationRoute('video', models?.videoModel);
    const imagePlan = resolveInvocationPlanFromRoute(
      'image',
      models?.imageModel
    );
    const textPlan = resolveInvocationPlanFromRoute('text', models?.textModel);
    const videoPlan = resolveInvocationPlanFromRoute(
      'video',
      models?.videoModel
    );
    return {
      imageConfig: {
        apiKey: imageRoute.apiKey,
        baseUrl: imageRoute.baseUrl || 'https://api.tu-zi.com/v1',
        modelName: imageRoute.modelId,
        authType:
          imagePlan?.provider.authType || inferAuthTypeFromRoute(imageRoute),
        providerType:
          imagePlan?.provider.providerType ||
          imageRoute.providerType ||
          'custom',
        extraHeaders: imagePlan?.provider.extraHeaders,
        protocol: imagePlan?.binding.protocol || null,
        binding: imagePlan?.binding || null,
        provider: imagePlan?.provider || null,
      },
      textConfig: {
        apiKey: textRoute.apiKey,
        baseUrl: textRoute.baseUrl || 'https://api.tu-zi.com/v1',
        modelName: textRoute.modelId,
        authType:
          textPlan?.provider.authType || inferAuthTypeFromRoute(textRoute),
        providerType:
          textPlan?.provider.providerType || textRoute.providerType || 'custom',
        extraHeaders: textPlan?.provider.extraHeaders,
        protocol: textPlan?.binding.protocol || null,
        binding: textPlan?.binding || null,
        provider: textPlan?.provider || null,
      },
      videoConfig: {
        apiKey: videoRoute.apiKey,
        // 规范化 baseUrl，移除尾部 / 或 /v1，便于拼接 /v1/videos
        baseUrl: this.normalizeApiBase(
          videoRoute.baseUrl || 'https://api.tu-zi.com'
        ),
        authType:
          videoPlan?.provider.authType || inferAuthTypeFromRoute(videoRoute),
        providerType:
          videoPlan?.provider.providerType ||
          videoRoute.providerType ||
          'custom',
        extraHeaders: videoPlan?.provider.extraHeaders,
        binding: videoPlan?.binding || null,
        provider: videoPlan?.provider || null,
      },
    };
  }
}

/**
 * 降级执行器单例
 */
export const fallbackMediaExecutor = new FallbackMediaExecutor();
