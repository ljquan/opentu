/**
 * Thumbnail Utilities for Service Worker
 * 
 * 预览图工具函数：在图片/视频缓存时自动生成预览图
 * 预览图存储在独立的 Cache Storage (drawnix-images-thumb) 中，使用原URL作为key
 */

const IMAGE_CACHE_NAME_THUMB = 'drawnix-images-thumb';
const THUMBNAIL_MAX_SIZE_SMALL = 128; // 小尺寸：用于任务列表、缩略图导航
const THUMBNAIL_MAX_SIZE_LARGE = 400; // 大尺寸：用于素材库大图预览
const THUMBNAIL_QUALITY = 0.8;

export type ThumbnailSize = 'small' | 'large';

/**
 * 计算预览图尺寸（保持宽高比）
 */
function calculateThumbnailSize(
  originalWidth: number,
  originalHeight: number,
  maxSize: number
): { width: number; height: number } {
  const aspectRatio = originalWidth / originalHeight;
  
  let width = maxSize;
  let height = maxSize;
  
  if (aspectRatio > 1) {
    // 横向图片
    height = maxSize / aspectRatio;
  } else {
    // 纵向图片
    width = maxSize * aspectRatio;
  }
  
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * 获取预览图缓存key（带尺寸标识）
 * @param originalUrl 原始 URL
 * @param size 预览图尺寸
 * @returns 预览图缓存key
 */
function getThumbnailCacheKey(originalUrl: string, size: ThumbnailSize): string {
  try {
    // 如果 originalUrl 已经是完整 URL，直接使用；否则使用 self.location.origin 作为 base
    let url: URL;
    try {
      url = new URL(originalUrl);
      // 已经是完整 URL，直接使用
    } catch {
      // 不是完整 URL，使用 self.location.origin 作为 base
      url = new URL(originalUrl, self.location.origin);
    }
    // 确保移除可能存在的 thumbnail 参数
    url.searchParams.delete('thumbnail');
    // 添加 _thumb 参数标识尺寸
    url.searchParams.set('_thumb', size);
    return url.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接参数
    const separator = originalUrl.includes('?') ? '&' : '?';
    // 移除可能存在的 thumbnail 参数
    const cleanUrl = originalUrl.replace(/[?&]thumbnail=[^&]*/g, '').replace(/thumbnail=[^&]*&?/, '');
    return `${cleanUrl}${separator}_thumb=${size}`;
  }
}

/**
 * 生成图片预览图（在 Service Worker 中）
 * @param blob 原始图片 Blob
 * @param originalUrl 原始图片 URL（用作缓存key）
 * @param sizes 要生成的尺寸列表（默认生成两种尺寸）
 */
export async function generateImageThumbnail(
  blob: Blob,
  originalUrl: string,
  sizes: ThumbnailSize[] = ['small', 'large']
): Promise<void> {
  try {
    // 生成所有需要的尺寸
    for (const size of sizes) {
      await generateThumbnailForSize(blob, originalUrl, size);
    }
  } catch (error) {
    console.warn('[ThumbnailUtils] Failed to generate image thumbnail:', error);
    // 生成失败不影响主流程，静默失败
  }
}

/**
 * 生成指定尺寸的预览图
 */
async function generateThumbnailForSize(
  blob: Blob,
  originalUrl: string,
  size: ThumbnailSize
): Promise<void> {
  try {
    const maxSize = size === 'large' ? THUMBNAIL_MAX_SIZE_LARGE : THUMBNAIL_MAX_SIZE_SMALL;
    const cacheKey = getThumbnailCacheKey(originalUrl, size);
    
    // 1. 检查预览图是否已存在
    const thumbCache = await caches.open(IMAGE_CACHE_NAME_THUMB);
    
    // 尝试多种格式匹配（兼容不同的URL格式）
    let existingThumbnail = await thumbCache.match(cacheKey);
    if (!existingThumbnail) {
      // 尝试使用 Request 对象匹配
      const request = new Request(cacheKey, { method: 'GET' });
      existingThumbnail = await thumbCache.match(request);
    }
    if (!existingThumbnail) {
      // 尝试pathname（对于 /__aitu_cache__/ 路径）
      try {
        const url = new URL(cacheKey);
        existingThumbnail = await thumbCache.match(url.pathname);
      } catch {
        // URL解析失败，忽略
      }
    }
    
    if (existingThumbnail) {
      return; // 已存在，无需重复生成
    }

    // 2. 使用 createImageBitmap 和 OffscreenCanvas 生成预览图
    const imageBitmap = await createImageBitmap(blob);
    const { width, height } = calculateThumbnailSize(
      imageBitmap.width,
      imageBitmap.height,
      maxSize
    );

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[ThumbnailUtils] Failed to get canvas context');
      return;
    }

    ctx.drawImage(imageBitmap, 0, 0, width, height);
    imageBitmap.close();

    const thumbnailBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: THUMBNAIL_QUALITY,
    });

    // 3. 缓存预览图到独立的Cache（使用带尺寸标识的key）
    // 为每个缓存 key 创建独立的 Response 对象，避免 body 被消费后无法 clone
    const createResponse = () => new Response(thumbnailBlob, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': thumbnailBlob.size.toString(),
      },
    });
    
    // 使用 Request 对象作为key，确保与查找时一致
    const thumbnailRequest = new Request(cacheKey, { method: 'GET' });
    await thumbCache.put(thumbnailRequest, createResponse());
    
    // 同时使用URL字符串作为key（兼容性）
    await thumbCache.put(cacheKey, createResponse());
    
    // 对于 /__aitu_cache__/ 路径，也使用pathname作为key（但需要包含 _thumb 参数）
    try {
      const url = new URL(cacheKey);
      if (url.pathname.startsWith('/__aitu_cache__/') || url.pathname.startsWith('/asset-library/')) {
        // 使用带 _thumb 参数的完整 URL 作为 key，而不是只使用 pathname
        await thumbCache.put(cacheKey, createResponse());
      }
    } catch {
      // URL解析失败，忽略
    }
  } catch (error) {
    console.warn('[ThumbnailUtils] Failed to generate image thumbnail:', error);
    // 生成失败不影响主流程，静默失败
  }
}

/**
 * 生成视频预览图（通过 postMessage 委托主线程）
 * @param blob 原始视频 Blob
 * @param originalUrl 原始视频 URL（用作缓存key）
 * @param sizes 要生成的尺寸列表（默认生成两种尺寸）
 */
export async function generateVideoThumbnail(
  blob: Blob,
  originalUrl: string,
  sizes: ThumbnailSize[] = ['small', 'large']
): Promise<void> {
  try {
    // 生成所有需要的尺寸
    for (const size of sizes) {
      await generateVideoThumbnailForSize(blob, originalUrl, size);
    }
  } catch (error) {
    console.warn('[ThumbnailUtils] Failed to generate video thumbnail:', error);
    // 生成失败不影响主流程，静默失败
  }
}

/**
 * 生成指定尺寸的视频预览图
 */
async function generateVideoThumbnailForSize(
  blob: Blob,
  originalUrl: string,
  size: ThumbnailSize
): Promise<void> {
  try {
    const cacheKey = getThumbnailCacheKey(originalUrl, size);
    
    // 1. 检查预览图是否已存在
    const thumbCache = await caches.open(IMAGE_CACHE_NAME_THUMB);
    
    // 尝试多种格式匹配（兼容不同的URL格式）
    let existingThumbnail = await thumbCache.match(cacheKey);
    if (!existingThumbnail) {
      // 尝试使用 Request 对象匹配
      const request = new Request(cacheKey, { method: 'GET' });
      existingThumbnail = await thumbCache.match(request);
    }
    if (!existingThumbnail) {
      // 尝试pathname（对于 /__aitu_cache__/ 路径）
      try {
        const url = new URL(cacheKey);
        existingThumbnail = await thumbCache.match(url.pathname);
      } catch {
        // URL解析失败，忽略
      }
    }
    
    if (existingThumbnail) {
      return; // 已存在，无需重复生成
    }

    // 2. 通过 postMessage 委托主线程生成视频预览图（使用指定尺寸）
    const maxSize = size === 'large' ? THUMBNAIL_MAX_SIZE_LARGE : THUMBNAIL_MAX_SIZE_SMALL;
    const thumbnailBlob = await requestVideoThumbnailFromMainThread(blob, maxSize);
    if (!thumbnailBlob) {
      console.warn(`[ThumbnailUtils] Failed to generate ${size} video thumbnail from main thread`);
      return;
    }

    // 3. 缓存预览图到独立的Cache（使用带尺寸标识的key）
    // 为每个缓存 key 创建独立的 Response 对象，避免 body 被消费后无法 clone
    const createResponse = () => new Response(thumbnailBlob, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': thumbnailBlob.size.toString(),
      },
    });
    
    // 使用 Request 对象作为key，确保与查找时一致
    const thumbnailRequest = new Request(cacheKey, { method: 'GET' });
    await thumbCache.put(thumbnailRequest, createResponse());
    
    // 同时使用URL字符串作为key（兼容性）
    await thumbCache.put(cacheKey, createResponse());
    
    // 对于 /__aitu_cache__/ 路径，也使用带 _thumb 参数的完整 URL 作为 key
    try {
      const url = new URL(cacheKey);
      if (url.pathname.startsWith('/__aitu_cache__/') || url.pathname.startsWith('/asset-library/')) {
        // 使用带 _thumb 参数的完整 URL 作为 key，而不是只使用 pathname
        await thumbCache.put(cacheKey, createResponse());
      }
    } catch {
      // URL解析失败，忽略
    }
  } catch (error) {
    console.warn(`[ThumbnailUtils] ❌ Failed to generate ${size} video thumbnail:`, error);
    // 生成失败不影响主流程，静默失败
  }
}

/**
 * 通过 postMessage 请求主线程生成视频预览图
 * @param blob 视频 Blob
 * @param maxSize 最大尺寸（默认 400）
 */
async function requestVideoThumbnailFromMainThread(blob: Blob, maxSize: number = THUMBNAIL_MAX_SIZE_LARGE): Promise<Blob | null> {
  return new Promise((resolve) => {
    const requestId = `video-thumb-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const timeout = setTimeout(() => {
      resolve(null);
    }, 30000); // 30秒超时

    const handleMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'VIDEO_THUMBNAIL_RESPONSE' &&
        event.data?.requestId === requestId
      ) {
        clearTimeout(timeout);
        self.removeEventListener('message', handleMessage);

        if (event.data.success && event.data.blob) {
          // 将 ArrayBuffer 转换回 Blob
          const blob = new Blob([event.data.blob], { type: 'image/jpeg' });
          resolve(blob);
        } else {
          resolve(null);
        }
      }
    };

    self.addEventListener('message', handleMessage);

    // 将 Blob 转换为 ArrayBuffer 以便通过 postMessage 传递
    blob.arrayBuffer().then((arrayBuffer) => {
      // 发送请求到主线程
      // @ts-ignore - Service Worker 全局作用域
      self.clients.matchAll().then((clients: readonly Client[]) => {
        if (clients.length === 0) {
          clearTimeout(timeout);
          self.removeEventListener('message', handleMessage);
          resolve(null);
          return;
        }

        clients.forEach((client) => {
          client.postMessage({
            type: 'VIDEO_THUMBNAIL_REQUEST',
            requestId,
            blob: arrayBuffer,
            mimeType: blob.type,
            maxSize, // 传递最大尺寸
          });
        });
      });
    });
  });
}

/**
 * 获取预览图 URL（通过添加查询参数）
 * @param originalUrl 原始 URL
 * @param size 预览图尺寸（默认 small）
 * @returns 预览图 URL（带 ?thumbnail={size} 参数）
 */
export function getThumbnailUrl(originalUrl: string, size: ThumbnailSize = 'small'): string {
  try {
    const url = new URL(originalUrl, self.location.origin);
    url.searchParams.set('thumbnail', size);
    return url.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接参数
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}thumbnail=${size}`;
  }
}

/**
 * 确保预览图存在（不存在则按需生成，生成两种尺寸）
 * @param originalUrl 原始 URL
 * @param type 媒体类型
 * @returns 预览图 URL（小尺寸）
 */
export async function ensureThumbnail(
  originalUrl: string,
  type: 'image' | 'video'
): Promise<string> {
  // 预览图不存在，尝试从原媒体生成（生成两种尺寸）
  try {
    // 从原始 Cache 获取媒体
    const cache = await caches.open('drawnix-images');
    const cachedResponse = await cache.match(originalUrl);
    
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      
      if (type === 'image') {
        await generateImageThumbnail(blob, originalUrl, ['small', 'large']);
      } else {
        await generateVideoThumbnail(blob, originalUrl, ['small', 'large']);
      }
    }
  } catch (error) {
    console.warn('[ThumbnailUtils] Failed to generate thumbnail on demand:', error);
  }

  // 返回预览图 URL（小尺寸，即使生成失败，SW 会回退到原图）
  return getThumbnailUrl(originalUrl, 'small');
}

/**
 * 查找预览图（支持多种缓存 key 格式匹配）
 * @param cacheKey 原始缓存 key（不带 thumbnail 参数）
 * @param size 预览图尺寸
 * @param fallbackKeys 可选的备用 key 列表（如 pathname）
 * @returns 预览图 Response 或 null
 */
export async function findThumbnail(
  cacheKey: string,
  size: ThumbnailSize,
  fallbackKeys?: string[]
): Promise<Response | null> {
  try {
    const thumbCache = await caches.open(IMAGE_CACHE_NAME_THUMB);
    const thumbCacheKey = getThumbnailCacheKey(cacheKey, size);
    
    // 1. 尝试使用完整 URL（带 _thumb 参数）
    let thumbnailResponse = await thumbCache.match(thumbCacheKey);
    
    // 2. 尝试使用 Request 对象匹配
    if (!thumbnailResponse) {
      const thumbnailRequest = new Request(thumbCacheKey, { method: 'GET' });
      thumbnailResponse = await thumbCache.match(thumbnailRequest);
    }
    
    // 3. 尝试备用 key（如 pathname）
    if (!thumbnailResponse && fallbackKeys) {
      for (const fallbackKey of fallbackKeys) {
        const fallbackResponse = await thumbCache.match(fallbackKey);
        if (fallbackResponse) {
          thumbnailResponse = fallbackResponse;
          break;
        }
      }
    }
    
    return thumbnailResponse ? thumbnailResponse : null;
  } catch (error) {
    console.warn('[ThumbnailUtils] Error finding thumbnail:', error);
    return null;
  }
}

/**
 * 查找预览图（支持降级到另一个尺寸）
 * @param cacheKey 原始缓存 key（不带 thumbnail 参数）
 * @param requestedSize 请求的预览图尺寸
 * @param fallbackKeys 可选的备用 key 列表（如 pathname）
 * @returns 预览图 Response 和实际找到的尺寸，或 null
 */
export async function findThumbnailWithFallback(
  cacheKey: string,
  requestedSize: ThumbnailSize,
  fallbackKeys?: string[]
): Promise<{ response: Response; size: ThumbnailSize } | null> {
  // 1. 首先尝试查找请求的尺寸
  let thumbnailResponse = await findThumbnail(cacheKey, requestedSize, fallbackKeys);
  
  if (thumbnailResponse) {
    return { response: thumbnailResponse, size: requestedSize };
  }
  
  // 2. 如果没找到，尝试降级到另一个尺寸
  const fallbackSize = requestedSize === 'small' ? 'large' : 'small';
  thumbnailResponse = await findThumbnail(cacheKey, fallbackSize, fallbackKeys);
  
  if (thumbnailResponse) {
    return { response: thumbnailResponse, size: fallbackSize };
  }
  
  return null;
}

/**
 * 创建预览图响应
 * @param blob 预览图 Blob
 * @returns Response 对象
 */
export function createThumbnailResponse(blob: Blob): Response {
  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': blob.size.toString(),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=31536000',
    },
  });
}

/**
 * 异步生成预览图（不阻塞主流程）
 * @param blob 原始媒体 Blob
 * @param originalUrl 原始 URL
 * @param mediaType 媒体类型
 * @param sizes 要生成的尺寸列表（默认生成两种尺寸）
 */
export function generateThumbnailAsync(
  blob: Blob,
  originalUrl: string,
  mediaType: 'image' | 'video',
  sizes: ThumbnailSize[] = ['small', 'large']
): void {
  (async () => {
    try {
      if (mediaType === 'image') {
        await generateImageThumbnail(blob, originalUrl, sizes);
      } else {
        await generateVideoThumbnail(blob, originalUrl, sizes);
      }
    } catch (error) {
      console.warn(`[ThumbnailUtils] Failed to generate ${mediaType} thumbnail:`, error);
    }
  })();
}

// 导出常量供其他模块使用
export { IMAGE_CACHE_NAME_THUMB };
