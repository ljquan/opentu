/**
 * Adapter routes for FallbackMediaExecutor
 *
 * 将专用 adapter（mj-imagine、kling 等）的执行逻辑从 fallback-executor 中提取出来，
 * 保持 LLM 日志、任务存储、认证错误检测等基础设施。
 */

import type { ModelRef } from '../../utils/settings-manager';
import type { ExecutionOptions } from './types';
import { taskStorageWriter } from './task-storage-writer';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  LLMReferenceImage,
} from './llm-api-logger';
import {
  isAuthError,
  dispatchApiAuthError,
} from '../../utils/api-auth-error-event';
import { unifiedCacheService } from '../unified-cache-service';
import { getAdapterContextFromSettings } from '../model-adapters';
import type { ImageModelAdapter, VideoModelAdapter } from '../model-adapters';
import {
  ensureBase64ForAI,
  cacheRemoteUrl,
  cacheRemoteUrls,
} from './fallback-utils';

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
    quality?: string;
    count?: number;
    referenceImages?: string[];
    params?: Record<string, unknown>;
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();

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
      processedImages = await Promise.all(
        params.referenceImages.map(async (imgUrl) => {
          const imageData = await unifiedCacheService.getImageForAI(imgUrl);
          return ensureBase64ForAI(imageData, options?.signal);
        })
      );
    }

    options?.onProgress?.({ progress: 10, phase: 'submitting' });

    const result = await adapter.generateImage(
      getAdapterContextFromSettings('image', params.modelRef || params.model),
      {
        prompt: params.prompt,
        model: params.model,
        modelRef: params.modelRef || null,
        size: params.size,
        referenceImages: processedImages,
        params: { quality: params.quality, n: params.count, ...params.params },
      }
    );

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
    const cachedUrls = await cacheRemoteUrls(allUrls, taskId, 'image', fmt);
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

    if (isAuthError(errorMessage)) {
      dispatchApiAuthError({ message: errorMessage, source: 'image' });
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
        params: params.params,
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

    if (isAuthError(errorMessage)) {
      dispatchApiAuthError({ message: errorMessage, source: 'video' });
    }

    failLLMApiLog(logId, { duration, errorMessage });
    await taskStorageWriter.failTask(taskId, {
      code: error.code || 'VIDEO_GENERATION_ERROR',
      message: errorMessage,
    });
    throw error;
  }
}
