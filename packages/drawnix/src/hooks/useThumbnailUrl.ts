/**
 * useThumbnailUrl Hook
 * 
 * 提供预览图URL获取功能，支持按需生成
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * 获取预览图 URL（通过添加查询参数）
 * @param originalUrl 原始 URL
 * @param size 预览图尺寸（默认 small）
 * @returns 预览图 URL（带 ?thumbnail={size} 参数）
 */
function getThumbnailUrl(originalUrl: string, size: 'small' | 'large' = 'small'): string {
  try {
    const url = new URL(originalUrl, window.location.origin);
    url.searchParams.set('thumbnail', size);
    return url.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接参数
    const separator = originalUrl.includes('?') ? '&' : '?';
    return `${originalUrl}${separator}thumbnail=${size}`;
  }
}

/**
 * 确保预览图存在（不存在则按需生成）
 * @param originalUrl 原始 URL
 * @param type 媒体类型
 */
async function ensureThumbnail(
  originalUrl: string,
  type: 'image' | 'video'
): Promise<void> {
  try {
    // 检查预览图是否存在（尝试多种格式）
    const thumbCache = await caches.open('drawnix-images-thumb');
    let existingThumbnail = await thumbCache.match(originalUrl);
    if (!existingThumbnail) {
      // 尝试使用 Request 对象匹配
      const request = new Request(originalUrl, { method: 'GET' });
      existingThumbnail = await thumbCache.match(request);
    }
    if (!existingThumbnail) {
      // 尝试pathname（对于 /__aitu_cache__/ 路径）
      try {
        const url = new URL(originalUrl, window.location.origin);
        if (url.pathname.startsWith('/__aitu_cache__/') || url.pathname.startsWith('/asset-library/')) {
          existingThumbnail = await thumbCache.match(url.pathname);
        }
      } catch {
        // URL解析失败，忽略
      }
    }
    
    if (existingThumbnail) {
      return; // 已存在
    }

    // 预览图不存在，尝试从原媒体生成
    const cache = await caches.open('drawnix-images');
    
    // 尝试多种格式匹配原媒体
    let cachedResponse = await cache.match(originalUrl);
    if (!cachedResponse) {
      const request = new Request(originalUrl, { method: 'GET' });
      cachedResponse = await cache.match(request);
    }
    if (!cachedResponse) {
      try {
        const url = new URL(originalUrl, window.location.origin);
        if (url.pathname.startsWith('/__aitu_cache__/') || url.pathname.startsWith('/asset-library/')) {
          cachedResponse = await cache.match(url.pathname);
        }
      } catch {
        // URL解析失败，忽略
      }
    }
    
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      
      // 通过 postMessage 通知 SW 生成预览图
      if (navigator.serviceWorker) {
        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
          const arrayBuffer = await blob.arrayBuffer();
          registration.active.postMessage({
            type: 'GENERATE_THUMBNAIL',
            url: originalUrl,
            mediaType: type,
            blob: arrayBuffer,
            mimeType: blob.type,
          });
        }
      }
    }
  } catch (error) {
    console.warn('[useThumbnailUrl] Failed to ensure thumbnail:', error);
  }
}

/**
 * 获取预览图 URL 的 Hook
 * @param originalUrl 原始 URL
 * @param type 媒体类型（可选，用于按需生成）
 * @param size 预览图尺寸（默认 small）
 * @returns 预览图 URL
 */
export function useThumbnailUrl(
  originalUrl: string | undefined | null,
  type?: 'image' | 'video',
  size: 'small' | 'large' = 'small'
): string | undefined {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(
    originalUrl ? getThumbnailUrl(originalUrl, size) : undefined
  );

  useEffect(() => {
    if (!originalUrl) {
      setThumbnailUrl(undefined);
      return;
    }

    const url = getThumbnailUrl(originalUrl, size);
    setThumbnailUrl(url);

    // 如果提供了类型，尝试确保预览图存在（生成两种尺寸）
    if (type) {
      ensureThumbnail(originalUrl, type).catch((err) => {
        console.warn('[useThumbnailUrl] Failed to ensure thumbnail:', err);
      });
    }
  }, [originalUrl, type, size]);

  return thumbnailUrl;
}
