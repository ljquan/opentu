/**
 * Fallback Executor 辅助函数
 *
 * 提供降级执行器的通用工具函数
 * 大部分逻辑已迁移到 media-api 共享模块
 */

import type { VideoAPIConfig, GeminiConfig } from './types';
import {
  calculateBlobChecksum,
  compressImageBlob,
  getFileExtension,
  isDataURL,
  normalizeImageDataUrl,
} from '@aitu/utils';
import { getDataURL } from '../../data/blob';
import { unifiedCacheService } from '../unified-cache-service';
import { providerTransport } from '../provider-routing/provider-transport';
import {
  AI_GENERATED_AUDIO_URL_PREFIX,
  isVirtualMediaUrl,
} from '../../utils/virtual-media-url';
import {
  downloadVideoContentToLocalUrl,
  extractInlineVideoUrl,
  shouldDownloadVideoContent,
} from '../video-binding-utils';

/** 参考图转 base64 时最大体积（1MB），避免请求体过大 */
export const MAX_REFERENCE_IMAGE_BYTES = 1 * 1024 * 1024;

/** 将 Blob 压缩到 1MB 以内再转 base64（仅图片类型） */
export async function blobToBase64Under1MB(blob: Blob): Promise<string> {
  let target = blob;
  if (
    blob.type.startsWith('image/') &&
    blob.size > MAX_REFERENCE_IMAGE_BYTES
  ) {
    target = await compressImageBlob(blob, 1);
  }
  return getDataURL(target);
}

/** 确保图片为 base64 数据（API 要求），且体积控制在 1MB 内 */
export async function ensureBase64ForAI(
  imageData: { type: string; value: string },
  signal?: AbortSignal
): Promise<string> {
  const value = imageData.value;
  if (value.startsWith('data:')) {
    const base64Part = value.slice(value.indexOf(',') + 1);
    const estimatedBytes = (base64Part.length * 3) / 4;
    if (estimatedBytes <= MAX_REFERENCE_IMAGE_BYTES) return value;
    const res = await fetch(value, { signal });
    const blob = await res.blob();
    return blobToBase64Under1MB(blob);
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const res = await fetch(value, { signal, referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`Failed to fetch reference image: ${res.status}`);
    const blob = await res.blob();
    return blobToBase64Under1MB(blob);
  }
  return value;
}

// 从共享模块重新导出
export {
  isAsyncImageModel,
  extractPromptFromMessages,
  buildImageRequestBody,
  parseImageResponse,
} from '../media-api';

// 导入共享模块的工具函数
import {
  normalizeApiBase,
  getExtensionFromUrl,
  sizeToAspectRatio,
  sleep,
  parseErrorMessage,
} from '../media-api';

/**
 * 轮询视频状态
 * 注意：此函数保留以保持向后兼容，新代码应使用 media-api/video-api.ts 中的 pollVideoUntilComplete
 */
export async function pollVideoStatus(
  videoId: string,
  config: VideoAPIConfig,
  onProgress: (progress: number) => void,
  signal?: AbortSignal
): Promise<{ url: string }> {
  console.log(`[pollVideoStatus] Starting poll for videoId: ${videoId}`);
  const maxAttempts = 120; // 最多轮询 10 分钟
  const interval = 5000; // 5 秒轮询间隔
  const maxConsecutiveErrors = 3; // 连续 HTTP 错误超过此数才放弃
  let consecutiveErrors = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      console.log(`[pollVideoStatus] Polling cancelled for videoId: ${videoId}`);
      throw new Error('Video generation cancelled');
    }

    console.log(`[pollVideoStatus] Polling attempt ${attempt + 1}/${maxAttempts} for videoId: ${videoId}`);

    let data: any;
    try {
      const response = await providerTransport.send(
        config.provider || {
          profileId: 'runtime',
          profileName: 'Runtime',
          providerType: config.providerType || 'custom',
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          authType: config.authType || 'bearer',
          extraHeaders: config.extraHeaders,
        },
        {
          path: '/videos/' + videoId,
          baseUrlStrategy: config.binding?.baseUrlStrategy,
          method: 'GET',
          signal,
        }
      );

      if (!response.ok) {
        consecutiveErrors++;
        console.warn(
          `[pollVideoStatus] HTTP ${response.status} for videoId: ${videoId} (${consecutiveErrors}/${maxConsecutiveErrors} consecutive errors)`
        );
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`Failed to check video status: ${response.status} (after ${maxConsecutiveErrors} retries)`);
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
        continue;
      }

      data = await response.json();
    } catch (error: any) {
      // 网络错误（fetch 本身失败）也计入连续错误
      if (error?.name === 'AbortError') throw error;
      consecutiveErrors++;
      console.warn(
        `[pollVideoStatus] Network error for videoId: ${videoId}: ${error.message} (${consecutiveErrors}/${maxConsecutiveErrors})`
      );
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
      continue;
    }

    // 请求成功，重置连续错误计数
    consecutiveErrors = 0;

    const status = data.status || data.state;
    const progress = data.progress || 0;

    console.log(`[pollVideoStatus] Status for videoId: ${videoId}: ${status}, progress: ${progress}`);

    onProgress(progress / 100);

    if (status === 'completed' || status === 'succeeded') {
      const inlineUrl = extractInlineVideoUrl(data);
      const url =
        inlineUrl ||
        (shouldDownloadVideoContent(data.model || config.model, config.binding, data)
          ? await downloadVideoContentToLocalUrl({
              videoId,
              provider:
                config.provider || {
                  profileId: 'runtime',
                  profileName: 'Runtime',
                  providerType: config.providerType || 'custom',
                  baseUrl: config.baseUrl,
                  apiKey: config.apiKey,
                  authType: config.authType || 'bearer',
                  extraHeaders: config.extraHeaders,
                },
              binding: config.binding,
              modelId: data.model || config.model,
              cacheKey: videoId,
            })
          : undefined);
      if (!url) {
        throw new Error('No video URL in completed response');
      }
      return { url };
    }

    if (status === 'failed' || status === 'error') {
      // data.error 可能是字符串或对象 { code, message }
      const errMsg = typeof data.error === 'string'
        ? data.error
        : (data.error?.message || data.message || 'Video generation failed');
      const errCode = typeof data.error === 'object' ? data.error?.code : undefined;
      const error = new Error(errMsg);
      if (errCode) {
        (error as any).code = errCode;
      }
      throw error;
    }

    // 等待下一次轮询
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Video generation timeout');
}

// 从共享模块导入异步图片生成
import { generateImageAsync as sharedGenerateImageAsync } from '../media-api';

/**
 * 异步图片生成选项
 */
interface AsyncImageOptions {
  onProgress: (progress: number) => void;
  onSubmitted?: (remoteId: string) => void;
  signal?: AbortSignal;
}

/**
 * 异步图片生成：提交任务并轮询结果
 * 此函数现在委托给共享模块的 generateImageAsync
 */
export async function generateAsyncImage(
  params: {
    prompt: string;
    model: string;
    size?: string;
    referenceImages?: string[];
  },
  config: GeminiConfig,
  options: AsyncImageOptions
): Promise<{ url: string; format: string }> {
  const result = await sharedGenerateImageAsync(
    {
      prompt: params.prompt,
      model: params.model,
      size: params.size,
      referenceImages: params.referenceImages,
    },
    {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      defaultModel: params.model,
      authType: config.authType,
      providerType: config.providerType,
      extraHeaders: config.extraHeaders,
      provider: config.provider,
    },
    {
      onProgress: options.onProgress,
      onSubmitted: options.onSubmitted,
      signal: options.signal,
    }
  );

  return {
    url: result.url,
    format: result.format || 'png',
  };
}

/**
 * 收敛任务结果里的媒体 URL。
 * - data URL / 原始 base64：落到本地 Cache Storage，并返回稳定虚拟路径
 * - 远程音频 URL：主动缓存到本地稳定路径，避免签名链接过期后无法播放
 * - 其他 http/https：保留原始远程 URL，交给既有 SW 请求拦截链路处理，避免把远程素材误判成本地素材
 */
export async function cacheRemoteUrl(
  remoteUrl: string,
  taskId: string,
  mediaType: 'image' | 'video' | 'audio',
  format: string,
  index?: number,
  options?: {
    source?: 'AI_GENERATED' | 'PLAYBACK_CACHE';
    forceRemoteCache?: boolean;
    extraMetadata?: Record<string, unknown>;
  }
): Promise<string> {
  const normalizedUrl =
    mediaType === 'image' ? normalizeImageDataUrl(remoteUrl) : remoteUrl;

  // 已经是本地路径，无需缓存
  if (isVirtualMediaUrl(normalizedUrl)) {
    return normalizedUrl;
  }

  if (normalizedUrl.startsWith('http://') || normalizedUrl.startsWith('https://')) {
    if (mediaType !== 'audio' && !options?.forceRemoteCache) {
      return normalizedUrl;
    }

    try {
      const cacheSource = options?.source || 'AI_GENERATED';
      const hintedFormat = getFileExtension(normalizedUrl);
      const guessedFormat = hintedFormat !== 'bin' ? hintedFormat : format;
      const guessedSuffix = index !== undefined ? `_${index}` : '';
      const safeTaskId =
        cacheSource === 'PLAYBACK_CACHE'
          ? taskId.replace(/[^a-zA-Z0-9._-]+/g, '-')
          : taskId;
      const guessedLocalUrl =
        cacheSource === 'PLAYBACK_CACHE'
          ? `/__aitu_cache__/audio/${safeTaskId}${guessedSuffix}.${guessedFormat}`
          : mediaType === 'audio'
          ? `${AI_GENERATED_AUDIO_URL_PREFIX}${taskId}${guessedSuffix}.${guessedFormat}`
          : `/__aitu_cache__/${mediaType}/${taskId}${guessedSuffix}.${guessedFormat}`;

      if (await unifiedCacheService.isCached(guessedLocalUrl)) {
        return guessedLocalUrl;
      }

      const response = await fetch(normalizedUrl, {
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        return normalizedUrl;
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        return normalizedUrl;
      }

      const mimeFormat = getFileExtension('', blob.type);
      const finalFormat =
        mimeFormat !== 'bin'
          ? mimeFormat
          : hintedFormat !== 'bin'
          ? hintedFormat
          : guessedFormat;
      const localUrl =
        cacheSource === 'PLAYBACK_CACHE'
          ? `/__aitu_cache__/audio/${safeTaskId}${guessedSuffix}.${finalFormat}`
          : mediaType === 'audio'
          ? `${AI_GENERATED_AUDIO_URL_PREFIX}${taskId}${guessedSuffix}.${finalFormat}`
          : `/__aitu_cache__/${mediaType}/${taskId}${guessedSuffix}.${finalFormat}`;

      if (await unifiedCacheService.isCached(localUrl)) {
        return localUrl;
      }

      await unifiedCacheService.cacheMediaFromBlob(localUrl, blob, mediaType, {
        taskId,
        source: cacheSource,
        ...options?.extraMetadata,
      });
      return localUrl;
    } catch (error) {
      console.warn('[cacheRemoteUrl] Remote audio cache failed, using original URL:', error);
      return normalizedUrl;
    }
  }

  const suffix = index !== undefined ? `_${index}` : '';
  const inferredFormat = getFileExtension(normalizedUrl);
  const finalFormat = inferredFormat !== 'bin' ? inferredFormat : format;
  const localUrl =
    mediaType === 'audio'
      ? `${AI_GENERATED_AUDIO_URL_PREFIX}${taskId}${suffix}.${finalFormat}`
      : `/__aitu_cache__/${mediaType}/${taskId}${suffix}.${finalFormat}`;

  try {
    // data URL / 原始 base64：直接转 Blob 再缓存，避免把大串 base64 存进任务结果
    if (isDataURL(normalizedUrl)) {
      const response = await fetch(normalizedUrl);
      const blob = await response.blob();
      if (blob.size === 0) {
        console.warn('[cacheRemoteUrl] Empty data URL blob, using original URL');
        return normalizedUrl;
      }
      const contentHash = await calculateBlobChecksum(blob);
      const hashedFormat = getFileExtension('', blob.type);
      const contentAddressedUrl =
        mediaType === 'audio'
          ? `${AI_GENERATED_AUDIO_URL_PREFIX}content-${contentHash}.${hashedFormat !== 'bin' ? hashedFormat : finalFormat}`
          : `/__aitu_cache__/${mediaType}/content-${contentHash}.${hashedFormat !== 'bin' ? hashedFormat : finalFormat}`;

      if (await unifiedCacheService.isCached(contentAddressedUrl)) {
        return contentAddressedUrl;
      }

      await unifiedCacheService.cacheMediaFromBlob(contentAddressedUrl, blob, mediaType, {
        taskId,
        ...(mediaType === 'audio' ? { source: 'AI_GENERATED' } : {}),
        ...options?.extraMetadata,
      });
      return contentAddressedUrl;
    }

    return normalizedUrl;
  } catch (error) {
    console.warn('[cacheRemoteUrl] Cache failed, using original URL:', error);
    return normalizedUrl;
  }
}

/**
 * 批量缓存多个远程 URL
 */
export async function cacheRemoteUrls(
  urls: string[],
  taskId: string,
  mediaType: 'image' | 'video' | 'audio',
  format: string
): Promise<string[]> {
  return Promise.all(
    urls.map((url, i) => cacheRemoteUrl(url, taskId, mediaType, format, urls.length > 1 ? i : undefined))
  );
}
