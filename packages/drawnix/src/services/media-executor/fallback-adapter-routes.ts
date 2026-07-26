/**
 * Adapter routes for FallbackMediaExecutor
 *
 * 将专用 adapter（mj-imagine、kling 等）的执行逻辑从 fallback-executor 中提取出来，
 * 保持 LLM 日志、任务存储、认证错误检测等基础设施。
 */

import type { ModelRef } from '../../utils/settings-manager';
import type { GenerationParams } from '../../types/shared/core.types';
import type { ExecutionOptions } from './types';
import { taskStorageWriter } from './task-storage-writer';
import { createTaskInvocationRouteSnapshot } from '../task-invocation-route';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  LLMReferenceImage,
} from './llm-api-logger';
import {
  classifyApiCredentialError,
  dispatchApiAuthError,
} from '../../utils/api-auth-error-event';
import { unifiedCacheService } from '../unified-cache-service';
import {
  getAdapterContextFromSettings,
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS,
  isGPTImageEditRequestSchema,
} from '../model-adapters';
import type { ImageModelAdapter, VideoModelAdapter } from '../model-adapters';
import {
  ensureBase64ForAI,
  cacheRemoteUrl,
  cacheRemoteUrls,
} from './fallback-utils';
import { recoverImageByRequestId } from '../media-api';
import { updateLLMApiLogRequestId } from './llm-api-logger';
import type { ImageApiConfig } from '../media-api';

function isTimeoutErrorForAdapterRecover(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      /Request timeout|请求超时/.test(error.message))
  );
}

type ImageGenerationMode = 'text_to_image' | 'image_to_image' | 'image_edit';
type ImageInputFidelity = 'high' | 'low';
type ImageBackground = 'transparent' | 'opaque' | 'auto';
type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

function getStringParam(
  params: { params?: Record<string, unknown> },
  keys: string[]
): string | undefined {
  const rawParams = params as unknown as Record<string, unknown>;
  const nestedParams = params.params;

  for (const key of keys) {
    const value = rawParams[key] ?? nestedParams?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function resolvePreferredRequestSchema(params: {
  generationMode?: ImageGenerationMode;
  maskImage?: string;
  referenceImages?: string[];
  params?: Record<string, unknown>;
  preferredRequestSchema?: string | readonly string[];
}): string | readonly string[] | undefined {
  const generationMode =
    params.generationMode ||
    getStringParam(params, ['generationMode', 'generation_mode']);

  if (
    params.referenceImages?.length ||
    generationMode === 'image_to_image' ||
    generationMode === 'image_edit' ||
    params.maskImage ||
    getStringParam(params, ['maskImage', 'mask_image'])
  ) {
    return params.preferredRequestSchema || GPT_IMAGE_EDIT_REQUEST_SCHEMAS;
  }

  return params.preferredRequestSchema;
}

/**
 * 通过专用 adapter 生成图片（mj-imagine 等非 gemini 模型）
 * 复用 LLM 日志、任务存储、认证错误检测
 */
export async function executeImageViaAdapter(
  taskId: string,
  adapter: ImageModelAdapter,
  params: {
    prompt: string;
    model: string;
    modelRef?: ModelRef | null;
    size?: string;
    resolution?: '1k' | '2k' | '4k';
    quality?: string;
    count?: number;
    referenceImages?: string[];
    generationMode?: ImageGenerationMode;
    maskImage?: string;
    inputFidelity?: ImageInputFidelity;
    background?: ImageBackground;
    outputFormat?: ImageOutputFormat;
    outputCompression?: number;
    params?: Record<string, unknown>;
    assetMetadata?: GenerationParams['assetMetadata'];
    preferredRequestSchema?: string | readonly string[];
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  const preferredRequestSchema = resolvePreferredRequestSchema(params);

  const logId = startLLMApiLog({
    endpoint: `adapter:${adapter.id}`,
    model: params.model,
    taskType: 'image',
    prompt: params.prompt,
    hasReferenceImages:
      !!params.referenceImages && params.referenceImages.length > 0,
    referenceImageCount: params.referenceImages?.length,
    referenceImages: params.referenceImages?.map(
      (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
    ),
    taskId,
  });

  // 由 sendAdapterRequest 生成的 X-Request-Id 通过 onRequestSent 回传，用于超时兜底找回
  let capturedRequestId: string | undefined;
  const adapterContext = getAdapterContextFromSettings(
    'image',
    params.modelRef || params.model,
    { preferredRequestSchema }
  );
  adapterContext.onRequestSent = ({ requestId }) => {
    if (!capturedRequestId && requestId) {
      capturedRequestId = requestId;
      // 补写日志的 requestId 字段
      updateLLMApiLogRequestId(logId, requestId);
    }
  };

  try {
    let processedImages: string[] | undefined;
    if (params.referenceImages && params.referenceImages.length > 0) {
      processedImages = await Promise.all(
        params.referenceImages.map(async (imgUrl) => {
          const imageData = await unifiedCacheService.getImageForAI(imgUrl);
          return ensureBase64ForAI(imageData, options?.signal);
        })
      );
    }

    options?.onProgress?.({ progress: 10, phase: 'submitting' });

    let result;
    try {
      result = await adapter.generateImage(adapterContext, {
        prompt: params.prompt,
        model: params.model,
        modelRef: params.modelRef || null,
        size: params.size,
        generationMode:
          params.generationMode ||
          (isGPTImageEditRequestSchema(preferredRequestSchema)
            ? 'image_to_image'
            : 'text_to_image'),
        referenceImages: processedImages,
        maskImage: params.maskImage,
        inputFidelity: params.inputFidelity,
        background: params.background,
        outputFormat: params.outputFormat,
        outputCompression: params.outputCompression,
        params: {
          resolution: params.resolution,
          quality: params.quality,
          n: params.count,
          ...params.params,
        },
      });
    } catch (adapterError) {
      // 超时兜底：通过 /log/get-request 找回已经生成成功的结果
      const recoverRequestId =
        capturedRequestId ||
        (typeof (adapterError as { requestId?: unknown })?.requestId ===
        'string'
          ? ((adapterError as { requestId?: string }).requestId as string)
          : undefined);

      if (
        isTimeoutErrorForAdapterRecover(adapterError) &&
        recoverRequestId &&
        adapterContext.provider
      ) {
        console.warn(
          `[FallbackAdapterRoutes] 生图请求超时，尝试通过 X-Request-Id 找回: ${recoverRequestId}`
        );
        try {
          // 构造 ImageApiConfig：从 provider 上下文取字段
          const recoverConfig: ImageApiConfig = {
            apiKey: adapterContext.provider.apiKey || '',
            baseUrl: adapterContext.provider.baseUrl,
            authType: adapterContext.provider.authType,
            providerType: adapterContext.provider.providerType,
            extraHeaders: adapterContext.provider.extraHeaders,
            provider: adapterContext.provider,
            binding: adapterContext.binding || null,
          };
          result = await recoverImageByRequestId(
            recoverRequestId,
            recoverConfig,
            options?.signal
          );
          console.info(
            `[FallbackAdapterRoutes] ✅ 通过 X-Request-Id 找回结果成功: ${recoverRequestId}`
          );
        } catch (recoverError) {
          console.error(
            `[FallbackAdapterRoutes] ❌ 通过 X-Request-Id 找回失败: ${recoverRequestId}`,
            recoverError
          );
          throw adapterError;
        }
      } else {
        throw adapterError;
      }
    }

    const duration = Date.now() - logStartTime;

    completeLLMApiLog(logId, {
      httpStatus: 200,
      duration,
      resultType: 'image',
      resultCount: 1,
      resultUrl: result.url,
    });

    options?.onProgress?.({ progress: 100 });

    // 缓存远程签名 URL 到本地，避免 Referer 校验导致 403
    const fmt = result.format || 'png';
    const allUrls = result.urls?.length ? result.urls : [result.url];
    const cachedUrls = await cacheRemoteUrls(allUrls, taskId, 'image', fmt, {
      extraMetadata: params.assetMetadata
        ? { ...params.assetMetadata }
        : undefined,
    });
    const cachedPrimary = cachedUrls[0];

    await taskStorageWriter.completeTask(taskId, {
      url: cachedPrimary,
      urls: cachedUrls.length > 1 ? cachedUrls : undefined,
      format: fmt,
      size: 0,
    });
  } catch (error: any) {
    const duration = Date.now() - logStartTime;
    const errorMessage = error.message || 'Image generation failed (adapter)';

    const credentialErrorKind = classifyApiCredentialError(error);
    if (credentialErrorKind) {
      dispatchApiAuthError({
        message: errorMessage,
        source: 'image',
        reason: credentialErrorKind,
      });
    }

    failLLMApiLog(logId, { duration, errorMessage });
    await taskStorageWriter.failTask(taskId, {
      code: 'IMAGE_GENERATION_ERROR',
      message: errorMessage,
    });
    throw error;
  }
}

const isVirtualPath = (u: string) =>
  u.startsWith('/__aitu_cache__/') || u.startsWith('/asset-library/');

/**
 * 通过专用 adapter 生成视频（kling 等非 gemini 模型）
 * 复用 LLM 日志、任务存储、认证错误检测
 */
export async function executeVideoViaAdapter(
  taskId: string,
  adapter: VideoModelAdapter,
  params: {
    prompt: string;
    model: string;
    modelRef?: ModelRef | null;
    size?: string;
    duration?: string;
    referenceImages?: string[];
    inputReference?: string;
    params?: Record<string, unknown>;
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();

  const refUrls =
    (params.referenceImages && params.referenceImages.length > 0
      ? params.referenceImages
      : undefined) ||
    (params.inputReference ? [params.inputReference] : undefined);

  const logId = startLLMApiLog({
    endpoint: `adapter:${adapter.id}`,
    model: params.model,
    taskType: 'video',
    prompt: params.prompt,
    taskId,
    hasReferenceImages: !!refUrls && refUrls.length > 0,
    referenceImageCount: refUrls?.length,
    referenceImages: refUrls?.map(
      (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
    ),
  });

  try {
    let processedImages: string[] | undefined;
    if (refUrls && refUrls.length > 0) {
      processedImages = await Promise.all(
        refUrls.map(async (url) => {
          if (isVirtualPath(url)) {
            const imageData = await unifiedCacheService.getImageForAI(url);
            return ensureBase64ForAI(imageData, options?.signal);
          }
          return url;
        })
      );
    }

    options?.onProgress?.({ progress: 10, phase: 'submitting' });

    const durationNum = params.duration
      ? parseInt(params.duration, 10)
      : undefined;

    const result = await adapter.generateVideo(
      getAdapterContextFromSettings('video', params.modelRef || params.model),
      {
        prompt: params.prompt,
        model: params.model,
        modelRef: params.modelRef || null,
        size: params.size,
        duration: durationNum,
        referenceImages: processedImages,
        params: {
          ...params.params,
          onProgress: (progress: number) => {
            const safeProgress = Math.min(100, Math.max(10, progress));
            options?.onProgress?.({
              progress: safeProgress,
              phase: safeProgress <= 10 ? 'submitting' : 'polling',
            });
          },
          onSubmitted: async (videoId: string) => {
            await taskStorageWriter.updateRemoteId(
              taskId,
              videoId,
              createTaskInvocationRouteSnapshot(
                'video',
                params.modelRef || params.model
              )
            );
          },
        },
      }
    );

    const duration = Date.now() - logStartTime;

    completeLLMApiLog(logId, {
      httpStatus: 200,
      duration,
      resultType: 'video',
      resultCount: 1,
      resultUrl: result.url,
    });

    options?.onProgress?.({ progress: 100 });

    // 缓存远程签名 URL 到本地
    const videoFmt = result.format || 'mp4';
    const cachedVideoUrl = await cacheRemoteUrl(
      result.url,
      taskId,
      'video',
      videoFmt
    );

    await taskStorageWriter.completeTask(taskId, {
      url: cachedVideoUrl,
      format: videoFmt,
      size: 0,
      duration: result.duration,
    });
  } catch (error: any) {
    const duration = Date.now() - logStartTime;
    const errorMessage = error.message || 'Video generation failed (adapter)';

    const credentialErrorKind = classifyApiCredentialError(error);
    if (credentialErrorKind) {
      dispatchApiAuthError({
        message: errorMessage,
        source: 'video',
        reason: credentialErrorKind,
      });
    }

    failLLMApiLog(logId, { duration, errorMessage });
    await taskStorageWriter.failTask(taskId, {
      code: error.code || 'VIDEO_GENERATION_ERROR',
      message: errorMessage,
    });
    throw error;
  }
}
