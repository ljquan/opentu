/**
 * Adapter routes for FallbackMediaExecutor
 *
 * 将专用 adapter（mj-imagine、kling 等）的执行逻辑从 fallback-executor 中提取出来，
 * 保持 LLM 日志、任务存储、认证错误检测等基础设施。
 */

import type { ModelRef } from '../../utils/settings-manager';
import type {
  GenerationParams,
  TaskResultVisibility,
} from '../../types/shared/core.types';
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
import {
  getAdapterContextFromSettings,
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS,
  isGPTImageEditRequestSchema,
} from '../model-adapters';
import type { ImageModelAdapter, VideoModelAdapter } from '../model-adapters';
import {
  materializeReferenceImagesSequentially,
  cacheRemoteUrl,
  cacheRemoteUrls,
} from './fallback-utils';
import { isImageSubmissionOutcomeUnknownError } from '../provider-routing';

type ImageGenerationMode = 'text_to_image' | 'image_to_image' | 'image_edit';
type ImageInputFidelity = 'high' | 'low';
type ImageBackground = 'transparent' | 'opaque' | 'auto';
type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

const supportsRemoteImageReferences = (requestSchema?: string): boolean =>
  requestSchema === 'tuzi.image.gpt-generation-json' ||
  requestSchema === 'tuzi.image.gpt-edit-json';

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

function createStorageWriteGuard(options?: ExecutionOptions): {
  shouldUpdate: () => boolean;
} {
  return { shouldUpdate: () => isCurrentExecutionAttempt(options) };
}

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
    requestId?: string;
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
    resultVisibility?: TaskResultVisibility;
    preferredRequestSchema?: string | readonly string[];
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  const submissionRequestId = params.requestId || taskId;
  const preferredRequestSchema = resolvePreferredRequestSchema(params);
  const adapterContext = getAdapterContextFromSettings(
    'image',
    params.modelRef || params.model,
    { preferredRequestSchema }
  );
  const invocationRoute = createTaskInvocationRouteSnapshot(
    'image',
    params.modelRef || params.model,
    { bindingId: adapterContext.binding?.id }
  );

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

  try {
    let processedImages: string[] | undefined;
    if (params.referenceImages && params.referenceImages.length > 0) {
      processedImages = await materializeReferenceImagesSequentially(
        params.referenceImages,
        {
          ...options,
          preserveUrl: (imgUrl) =>
            supportsRemoteImageReferences(
              adapterContext.binding?.requestSchema
            ) && /^https?:\/\//i.test(imgUrl),
        }
      );
    }

    options?.onProgress?.({ progress: 10, phase: 'submitting' });

    const result = await adapter.generateImage(
      {
        ...adapterContext,
        requestId: submissionRequestId,
        onSubmissionAttempt: async () => {
          await options?.onSubmissionAttempt?.(invocationRoute);
        },
        signal: options?.signal,
      },
      {
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
      }
    );
    assertCurrentExecutionAttempt(options);

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
      forceRemoteCache: true,
      returnLocalCacheUrl: true,
      cacheKey: submissionRequestId,
      extraMetadata: params.assetMetadata
        ? { ...params.assetMetadata }
        : undefined,
      resultVisibility: params.resultVisibility,
    });
    assertCurrentExecutionAttempt(options);
    const cachedPrimary = cachedUrls[0];

    const completed = await taskStorageWriter.completeTask(
      taskId,
      {
        url: cachedPrimary,
        urls: cachedUrls.length > 1 ? cachedUrls : undefined,
        format: fmt,
        size: 0,
        width: result.width,
        height: result.height,
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
    const errorMessage = error.message || 'Image generation failed (adapter)';

    if (options?.isCurrentAttempt?.() === false) {
      failLLMApiLog(logId, { duration, errorMessage });
      throw error;
    }

    const credentialErrorKind = classifyApiCredentialError(error);
    if (credentialErrorKind) {
      dispatchApiAuthError({
        message: errorMessage,
        source: 'image',
        reason: credentialErrorKind,
      });
    }

    failLLMApiLog(logId, { duration, errorMessage });
    if (isImageSubmissionOutcomeUnknownError(error)) {
      throw error;
    }
    await taskStorageWriter.failTask(
      taskId,
      {
        code: 'IMAGE_GENERATION_ERROR',
        message: errorMessage,
      },
      submissionRequestId,
      createStorageWriteGuard(options)
    );
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
    resultVisibility?: TaskResultVisibility;
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  let remoteIdWrite: Promise<unknown> | undefined;

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
      processedImages = await materializeReferenceImagesSequentially(refUrls, {
        ...options,
        preserveUrl: (url) => !isVirtualPath(url),
      });
    }
    assertCurrentExecutionAttempt(options);

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
            if (
              options?.signal?.aborted ||
              options?.isCurrentAttempt?.() === false
            ) {
              return;
            }
            const safeProgress = Math.min(100, Math.max(10, progress));
            options?.onProgress?.({
              progress: safeProgress,
              phase: safeProgress <= 10 ? 'submitting' : 'polling',
            });
          },
          onSubmitted: (videoId: string) => {
            if (
              options?.signal?.aborted ||
              options?.isCurrentAttempt?.() === false
            ) {
              return;
            }
            remoteIdWrite = taskStorageWriter.updateRemoteId(
              taskId,
              videoId,
              createTaskInvocationRouteSnapshot(
                'video',
                params.modelRef || params.model
              ),
              undefined,
              createStorageWriteGuard(options)
            );
          },
        },
      }
    );
    assertCurrentExecutionAttempt(options);
    await remoteIdWrite;
    assertCurrentExecutionAttempt(options);

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
      videoFmt,
      undefined,
      {
        signal: options?.signal,
        resultVisibility: params.resultVisibility,
      }
    );
    assertCurrentExecutionAttempt(options);

    await taskStorageWriter.completeTask(
      taskId,
      {
        url: cachedVideoUrl,
        format: videoFmt,
        size: 0,
        duration: result.duration,
      },
      undefined,
      createStorageWriteGuard(options)
    );
  } catch (error: any) {
    const duration = Date.now() - logStartTime;
    const errorMessage = error.message || 'Video generation failed (adapter)';

    if (options?.signal?.aborted || options?.isCurrentAttempt?.() === false) {
      failLLMApiLog(logId, { duration, errorMessage });
      throw error;
    }

    const credentialErrorKind = classifyApiCredentialError(error);
    if (credentialErrorKind) {
      dispatchApiAuthError({
        message: errorMessage,
        source: 'video',
        reason: credentialErrorKind,
      });
    }

    failLLMApiLog(logId, { duration, errorMessage });
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
