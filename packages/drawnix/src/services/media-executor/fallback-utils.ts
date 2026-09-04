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
import type { TaskResultVisibility } from '../../types/task.types';
import type { CacheWarning } from '../../types/cache-warning.types';
import {
  downloadVideoContentToLocalUrl,
  extractInlineVideoUrl,
  resolveVideoPollPath,
  shouldDownloadVideoContent,
} from '../video-binding-utils';

/** 参考图转 base64 时最大体积（1MB），避免请求体过大 */
export const MAX_REFERENCE_IMAGE_BYTES = 1 * 1024 * 1024;

/** 将 Blob 压缩到 1MB 以内再转 base64（仅图片类型） */
export async function blobToBase64Under1MB(blob: Blob): Promise<string> {
  let target = blob;
  if (blob.type.startsWith('image/') && blob.size > MAX_REFERENCE_IMAGE_BYTES) {
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
    if (!res.ok)
      throw new Error(`Failed to fetch reference image: ${res.status}`);
    const blob = await res.blob();
    return blobToBase64Under1MB(blob);
  }
  return value;
}

interface MaterializeReferenceImagesOptions {
  signal?: AbortSignal;
  isCurrentAttempt?: () => boolean;
  preserveUrl?: (url: string) => boolean;
}

function assertReferenceMaterializationActive(
  options?: MaterializeReferenceImagesOptions
): void {
  options?.signal?.throwIfAborted();
  if (options?.isCurrentAttempt?.() === false) {
    const error = new Error('任务执行已被取消或替代');
    error.name = 'AbortError';
    throw error;
  }
}

/** 串行物化参考图，避免多个 Blob 与 Base64 同时驻留内存。 */
export async function materializeReferenceImagesSequentially(
  referenceImages: readonly string[],
  options?: MaterializeReferenceImagesOptions
): Promise<string[]> {
  const materialized: string[] = [];
  for (const url of referenceImages) {
    assertReferenceMaterializationActive(options);
    if (options?.preserveUrl?.(url)) {
      materialized.push(url);
      continue;
    }

    const imageData = await unifiedCacheService.getImageForAI(url);
    assertReferenceMaterializationActive(options);
    const base64 = await ensureBase64ForAI(imageData, options?.signal);
    assertReferenceMaterializationActive(options);
    materialized.push(base64);
  }
  return materialized;
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
  signal?: AbortSignal,
  isCurrentAttempt: () => boolean = () => true
): Promise<{ url: string }> {
  const maxAttempts = 120; // 最多轮询 10 分钟
  const interval = 5000; // 5 秒轮询间隔
  const maxConsecutiveErrors = 3; // 连续 HTTP 错误超过此数才放弃
  let consecutiveErrors = 0;
  const assertPollingActive = () => {
    signal?.throwIfAborted();
    if (!isCurrentAttempt()) {
      const error = new Error('视频轮询已被取消或替代');
      error.name = 'AbortError';
      throw error;
    }
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    assertPollingActive();
    let data: any;
    try {
      const statusPath = resolveVideoPollPath(
        videoId,
        config.binding,
        config.params
      );
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
          path: statusPath,
          baseUrlStrategy: config.binding?.baseUrlStrategy,
          method: 'GET',
          signal,
        }
      );
      assertPollingActive();

      if (!response.ok) {
        consecutiveErrors++;
        console.warn(
          `[pollVideoStatus] HTTP ${response.status} for videoId: ${videoId} (${consecutiveErrors}/${maxConsecutiveErrors} consecutive errors)`
        );
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `Failed to check video status: ${response.status} (after ${maxConsecutiveErrors} retries)`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
        assertPollingActive();
        continue;
      }

      data = await response.json();
      assertPollingActive();
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
      assertPollingActive();
      continue;
    }

    // 请求成功，重置连续错误计数
    consecutiveErrors = 0;

    const status = data.status || data.state;
    const progress = data.progress || 0;
    onProgress(progress / 100);

    if (status === 'completed' || status === 'succeeded') {
      const inlineUrl = extractInlineVideoUrl(data);
      const url =
        inlineUrl ||
        (shouldDownloadVideoContent(
          data.model || config.model,
          config.binding,
          data
        )
          ? await downloadVideoContentToLocalUrl({
              videoId,
              provider: config.provider || {
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
      assertPollingActive();
      if (!url) {
        throw new Error('No video URL in completed response');
      }
      return { url };
    }

    if (status === 'failed' || status === 'error') {
      // data.error 可能是字符串或对象 { code, message }
      const errMsg =
        typeof data.error === 'string'
          ? data.error
          : data.error?.message || data.message || 'Video generation failed';
      const errCode =
        typeof data.error === 'object' ? data.error?.code : undefined;
      const error = new Error(errMsg);
      if (errCode) {
        (error as any).code = errCode;
      }
      throw error;
    }

    // 等待下一次轮询
    await new Promise((resolve) => setTimeout(resolve, interval));
    assertPollingActive();
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
  onSubmissionAttempt?: () => void | Promise<void>;
  onSubmitted?: (remoteId: string) => void;
  requestId?: string;
  signal?: AbortSignal;
}

function notifyCacheWarning(
  options: Parameters<typeof cacheRemoteUrl>[5] | undefined,
  error: unknown,
  reasonCode?: CacheWarning['reasonCode'],
  message?: string
): void {
  if (!options?.onCacheWarning) return;
  const text = error instanceof Error ? error.message : String(error || '');
  const normalized = text.toLowerCase();
  const resolvedReason =
    reasonCode ||
    (normalized.includes('opaque') || normalized.includes('cors')
      ? 'cors_opaque'
      : normalized.includes('quota') || normalized.includes('storage')
      ? 'storage_error'
      : normalized.includes('http') || normalized.includes('failed to fetch')
      ? 'http_error'
      : normalized.includes('missing') || normalized.includes('not found')
      ? 'cache_missing'
      : normalized.includes('body') || normalized.includes('blob')
      ? 'response_unreadable'
      : normalized.includes('fetch') || normalized.includes('network')
      ? 'network_error'
      : 'unknown');
  try {
    options.onCacheWarning({
      status: 'failed',
      reasonCode: resolvedReason,
      message:
        message ||
        '该资源未能缓存到浏览器，原始链接可能会过期，请尽快下载保存。',
      detectedAt: Date.now(),
      expiresHint: '原始链接可能带有效期',
    });
  } catch (callbackError) {
    console.warn(
      '[cacheRemoteUrl] Failed to report cache warning:',
      callbackError
    );
  }
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
    maskImage?: string;
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
      maskImage: params.maskImage,
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
      onSubmissionAttempt: options.onSubmissionAttempt,
      onSubmitted: options.onSubmitted,
      signal: options.signal,
      requestId: options.requestId,
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
    returnLocalCacheUrl?: boolean;
    cacheKey?: string;
    materializeContentUrl?: boolean;
    extraMetadata?: Record<string, unknown>;
    resultVisibility?: TaskResultVisibility;
    signal?: AbortSignal;
    onCacheWarning?: (warning: CacheWarning) => void;
  }
): Promise<string> {
  options?.signal?.throwIfAborted();
  const normalizedUrl =
    mediaType === 'image' ? normalizeImageDataUrl(remoteUrl) : remoteUrl;

  // 已经是本地路径且不要求固化时，无需缓存。
  if (isVirtualMediaUrl(normalizedUrl) && !options?.materializeContentUrl) {
    return normalizedUrl;
  }

  if (
    options?.materializeContentUrl &&
    (isVirtualMediaUrl(normalizedUrl) || normalizedUrl.startsWith('blob:'))
  ) {
    try {
      const blob =
        mediaType === 'image'
          ? await unifiedCacheService.getCachedImageBlobWithThumbnailFallback(
              normalizedUrl
            )
          : await unifiedCacheService.getCachedBlob(normalizedUrl);
      if (blob && blob.size > 0) {
        const cached = await unifiedCacheService.cacheLocalMediaByContent(
          blob,
          mediaType,
          {
            taskId,
            source: options.source || 'AI_GENERATED',
            ...options.extraMetadata,
          }
        );
        return cached.url;
      }
      throw new Error('图片原图和缩略图缓存均不可用');
    } catch (error) {
      // 固化只是增强项，不能阻断原始 URL 的画布插入。远程/Blob/虚拟地址
      // 仍交给图片加载链路处理；只有加载本身失败时才报告真正的插入错误。
      console.warn(
        '[cacheRemoteUrl] Failed to materialize media content, using original URL:',
        error
      );
      notifyCacheWarning(options, error);
      return normalizedUrl;
    }
  }

  if (
    normalizedUrl.startsWith('http://') ||
    normalizedUrl.startsWith('https://')
  ) {
    if (mediaType !== 'audio' && !options?.forceRemoteCache) {
      return normalizedUrl;
    }

    try {
      const cacheSource = options?.source || 'AI_GENERATED';
      const suffix = index !== undefined ? `_${index}` : '';
      const cacheKey = encodeURIComponent(options?.cacheKey || taskId);
      const cacheTargetUrl = options?.returnLocalCacheUrl
        ? `/__aitu_cache__/${mediaType}/${cacheKey}${suffix}.${format}`
        : normalizedUrl;

      if (await unifiedCacheService.isCached(cacheTargetUrl)) {
        return cacheTargetUrl;
      }
      options?.signal?.throwIfAborted();

      if (
        options?.returnLocalCacheUrl &&
        (await unifiedCacheService.isCached(normalizedUrl))
      ) {
        const cachedBlob = await unifiedCacheService.getCachedBlob(
          normalizedUrl
        );
        options?.signal?.throwIfAborted();
        if (cachedBlob && cachedBlob.size > 0) {
          const migratedUrl = await unifiedCacheService.cacheMediaFromBlob(
            cacheTargetUrl,
            cachedBlob,
            mediaType,
            {
              taskId,
              source: cacheSource,
              ...options?.extraMetadata,
              ...(options?.resultVisibility
                ? { resultVisibility: options.resultVisibility }
                : {}),
            }
          );
          options?.signal?.throwIfAborted();
          if (
            migratedUrl &&
            (await unifiedCacheService.isCached(cacheTargetUrl))
          ) {
            return migratedUrl;
          }
          notifyCacheWarning(
            options,
            new Error('cache missing'),
            'cache_missing',
            '资源未能写入浏览器缓存，原始链接可能会过期，请尽快下载保存。'
          );
          return normalizedUrl;
        }
      }

      const response = await fetch(normalizedUrl, {
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      options?.signal?.throwIfAborted();
      if (!response.ok) {
        notifyCacheWarning(
          options,
          new Error(`HTTP ${response.status}`),
          'http_error',
          `资源缓存请求失败（HTTP ${response.status}），原始链接可能会过期，请尽快下载保存。`
        );
        return normalizedUrl;
      }

      const blob = await response.blob();
      options?.signal?.throwIfAborted();
      if (blob.size === 0) {
        notifyCacheWarning(
          options,
          new Error('empty response body'),
          'response_unreadable',
          '资源缓存响应为空，原始链接可能会过期，请尽快下载保存。'
        );
        return normalizedUrl;
      }

      const cacheUrl = await unifiedCacheService.cacheMediaFromBlob(
        cacheTargetUrl,
        blob,
        mediaType,
        {
          taskId,
          source: cacheSource,
          ...options?.extraMetadata,
          ...(options?.resultVisibility
            ? { resultVisibility: options.resultVisibility }
            : {}),
        }
      );
      options?.signal?.throwIfAborted();
      if (!options?.returnLocalCacheUrl) {
        return normalizedUrl;
      }
      if (cacheUrl && (await unifiedCacheService.isCached(cacheTargetUrl))) {
        return cacheUrl;
      }
      notifyCacheWarning(
        options,
        new Error('cache missing'),
        'cache_missing',
        '资源未能写入浏览器缓存，原始链接可能会过期，请尽快下载保存。'
      );
      return normalizedUrl;
    } catch (error) {
      options?.signal?.throwIfAborted();
      console.warn(
        '[cacheRemoteUrl] Remote media cache failed, using original URL:',
        error
      );
      notifyCacheWarning(options, error);
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
      const response = options?.signal
        ? await fetch(normalizedUrl, { signal: options.signal })
        : await fetch(normalizedUrl);
      options?.signal?.throwIfAborted();
      const blob = await response.blob();
      options?.signal?.throwIfAborted();
      if (blob.size === 0) {
        console.warn(
          '[cacheRemoteUrl] Empty data URL blob, using original URL'
        );
        notifyCacheWarning(
          options,
          new Error('empty data URL response body'),
          'response_unreadable',
          '资源缓存响应为空，请尽快下载保存。'
        );
        return normalizedUrl;
      }
      const contentHash = await calculateBlobChecksum(blob);
      options?.signal?.throwIfAborted();
      const hashedFormat = getFileExtension('', blob.type);
      const contentAddressedUrl =
        mediaType === 'audio'
          ? `${AI_GENERATED_AUDIO_URL_PREFIX}content-${contentHash}.${
              hashedFormat !== 'bin' ? hashedFormat : finalFormat
            }`
          : `/__aitu_cache__/${mediaType}/content-${contentHash}.${
              hashedFormat !== 'bin' ? hashedFormat : finalFormat
            }`;

      if (await unifiedCacheService.isCached(contentAddressedUrl)) {
        return contentAddressedUrl;
      }

      await unifiedCacheService.cacheMediaFromBlob(
        contentAddressedUrl,
        blob,
        mediaType,
        {
          taskId,
          ...(mediaType === 'audio' ? { source: 'AI_GENERATED' } : {}),
          ...options?.extraMetadata,
          ...(options?.resultVisibility
            ? { resultVisibility: options.resultVisibility }
            : {}),
        }
      );
      options?.signal?.throwIfAborted();
      if (await unifiedCacheService.isCached(contentAddressedUrl)) {
        return contentAddressedUrl;
      }
      notifyCacheWarning(
        options,
        new Error('cache missing'),
        'cache_missing',
        '资源未能写入浏览器缓存，请尽快下载保存。'
      );
      return normalizedUrl;
    }

    return normalizedUrl;
  } catch (error) {
    options?.signal?.throwIfAborted();
    console.warn('[cacheRemoteUrl] Cache failed, using original URL:', error);
    notifyCacheWarning(options, error);
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
  format: string,
  options?: Parameters<typeof cacheRemoteUrl>[5]
): Promise<string[]> {
  if (options?.forceRemoteCache) {
    const cachedUrls: string[] = [];
    for (const [index, url] of urls.entries()) {
      cachedUrls.push(
        await cacheRemoteUrl(
          url,
          taskId,
          mediaType,
          format,
          urls.length > 1 ? index : undefined,
          options
        )
      );
    }
    return cachedUrls;
  }

  return Promise.all(
    urls.map((url, i) =>
      cacheRemoteUrl(
        url,
        taskId,
        mediaType,
        format,
        urls.length > 1 ? i : undefined,
        options
      )
    )
  );
}
