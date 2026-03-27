/**
 * useThumbnailUrl Hook
 * 
 * 提供预览图URL获取功能，支持按需生成
 * 优化：使用内存缓存避免重复检查 Cache Storage
 */

import { useState, useEffect } from 'react';
import { normalizeImageDataUrl } from '@aitu/utils';
import { swChannelClient } from '../services/sw-channel/client';

// 内存缓存：记录已检查过的缩略图 URL
// key: originalUrl, value: 检查时间戳
const thumbnailCheckCache = new Map<string, number>();
// 缓存有效期：5 分钟
const CACHE_TTL = 5 * 60 * 1000;

// 待检查队列和处理状态
const pendingChecks = new Set<string>();
let isProcessingQueue = false;

// 缓存的 Cache 对象引用，避免重复调用 caches.open
let thumbCachePromise: Promise<Cache> | null = null;
let imageCachePromise: Promise<Cache> | null = null;

/**
 * 获取或创建缓存引用
 */
function getThumbCache(): Promise<Cache> {
  if (!thumbCachePromise) {
    thumbCachePromise = caches.open('drawnix-images-thumb');
  }
  return thumbCachePromise;
}

function getImageCache(): Promise<Cache> {
  if (!imageCachePromise) {
    imageCachePromise = caches.open('drawnix-images');
  }
  return imageCachePromise;
}

function shouldBypassThumbnailForUrl(originalUrl: string): boolean {
  return (
    originalUrl.startsWith('http://') ||
    originalUrl.startsWith('https://') ||
    originalUrl.startsWith('data:') ||
    originalUrl.startsWith('blob:')
  );
}

/**
 * 获取预览图 URL（通过添加查询参数）
 * 仅对虚拟路径（/__aitu_cache__/、/asset-library/）追加 thumbnail 参数，
 * 外部 URL（如 TOS 签名 URL）或 data/blob URL 追加参数会破坏资源，直接返回原 URL。
 * @param originalUrl 原始 URL
 * @param size 预览图尺寸（默认 small）
 * @returns 预览图 URL（带 ?thumbnail={size} 参数）
 */
function getThumbnailUrl(originalUrl: string, size: 'small' | 'large' = 'small'): string {
  const normalizedUrl = normalizeImageDataUrl(originalUrl);

  // 外部 URL / data URL / blob URL 不追加参数，避免破坏资源或签名
  if (shouldBypassThumbnailForUrl(normalizedUrl)) {
    return normalizedUrl;
  }
  try {
    const url = new URL(normalizedUrl, window.location.origin);
    url.searchParams.set('thumbnail', size);
    return url.toString();
  } catch {
    // 如果 URL 解析失败，直接拼接参数
    const separator = normalizedUrl.includes('?') ? '&' : '?';
    return `${normalizedUrl}${separator}thumbnail=${size}`;
  }
}

/**
 * 处理缩略图检查队列（批量处理，避免阻塞主线程）
 */
async function processCheckQueue(): Promise<void> {
  if (isProcessingQueue || pendingChecks.size === 0) return;
  
  isProcessingQueue = true;
  
  try {
    // 每次处理最多 5 个
    const batchSize = 5;
    const batch = Array.from(pendingChecks).slice(0, batchSize);
    
    for (const item of batch) {
      pendingChecks.delete(item);
      const [originalUrl, type] = item.split('|');
      
      try {
        await ensureThumbnailImpl(originalUrl, type as 'image' | 'video');
        // 记录已检查
        thumbnailCheckCache.set(originalUrl, Date.now());
      } catch (error) {
        console.warn('[useThumbnailUrl] Failed to ensure thumbnail:', originalUrl, error);
      }
    }
    
    // 如果队列还有项目，延迟继续处理
    if (pendingChecks.size > 0) {
      if ('requestIdleCallback' in window) {
        (window as Window).requestIdleCallback(processCheckQueue);
      } else {
        setTimeout(processCheckQueue, 100);
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * 确保预览图存在（不存在则按需生成）- 实现
 * @param originalUrl 原始 URL
 * @param type 媒体类型
 */
async function ensureThumbnailImpl(
  originalUrl: string,
  type: 'image' | 'video'
): Promise<void> {
  const normalizedUrl = normalizeImageDataUrl(originalUrl);
  if (shouldBypassThumbnailForUrl(normalizedUrl)) {
    return;
  }

  // 使用缓存的 Cache 引用，避免重复 caches.open
  const thumbCache = await getThumbCache();
  
  // 快速检查：只用原始 URL 检查一次
  const existingThumbnail = await thumbCache.match(normalizedUrl);
  if (existingThumbnail) {
    return; // 已存在
  }

  // 预览图不存在，尝试从原媒体生成
  const cache = await getImageCache();
  
  // 尝试匹配原媒体
  let cachedResponse = await cache.match(normalizedUrl);
  if (!cachedResponse) {
    try {
      const url = new URL(normalizedUrl, window.location.origin);
      if (url.pathname.startsWith('/__aitu_cache__/') || url.pathname.startsWith('/asset-library/')) {
        cachedResponse = await cache.match(url.pathname);
      }
    } catch {
      // URL解析失败，忽略
    }
  }
  
  if (cachedResponse) {
    const blob = await cachedResponse.blob();
    
    // 通过 swChannelClient 通知 SW 生成预览图
    if (swChannelClient.isInitialized()) {
      const arrayBuffer = await blob.arrayBuffer();
      await swChannelClient.generateThumbnail(
        normalizedUrl,
        type,
        arrayBuffer,
        blob.type
      );
    }
  }
}

/**
 * 确保预览图存在（排队处理）
 * @param originalUrl 原始 URL
 * @param type 媒体类型
 */
function ensureThumbnail(originalUrl: string, type: 'image' | 'video'): void {
  const normalizedUrl = normalizeImageDataUrl(originalUrl);
  if (shouldBypassThumbnailForUrl(normalizedUrl)) {
    return;
  }

  // 检查内存缓存
  const lastCheck = thumbnailCheckCache.get(normalizedUrl);
  if (lastCheck && Date.now() - lastCheck < CACHE_TTL) {
    return; // 最近已检查过
  }
  
  // 加入待检查队列
  const queueKey = `${normalizedUrl}|${type}`;
  if (!pendingChecks.has(queueKey)) {
    pendingChecks.add(queueKey);
    
    // 使用 requestIdleCallback 延迟处理队列
    if ('requestIdleCallback' in window) {
      (window as Window).requestIdleCallback(processCheckQueue, { timeout: 2000 });
    } else {
      setTimeout(processCheckQueue, 200);
    }
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

    const normalizedUrl = normalizeImageDataUrl(originalUrl);
    const url = getThumbnailUrl(normalizedUrl, size);
    setThumbnailUrl(url);

    // 如果提供了类型，排队检查/生成预览图（非阻塞）
    if (type && !shouldBypassThumbnailForUrl(normalizedUrl)) {
      ensureThumbnail(normalizedUrl, type);
    }
  }, [originalUrl, type, size]);

  return thumbnailUrl;
}
