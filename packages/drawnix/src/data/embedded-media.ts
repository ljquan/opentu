import { PlaitElement } from '@plait/core';
import { EmbeddedMediaItem } from './types';
import { unifiedCacheService } from '../services/unified-cache-service';

/**
 * 将 Base64 字符串转换为 Blob
 */
const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
};

/**
 * 检查 URL 是否为虚拟 URL（需要嵌入媒体数据）
 */
const isVirtualUrl = (url: string): boolean => {
  return url.startsWith('/__aitu_cache__/') || url.startsWith('/asset-library/');
};

/**
 * 从元素树中递归提取所有虚拟 URL
 */
const extractVirtualUrls = (elements: PlaitElement[]): Set<string> => {
  const urls = new Set<string>();

  const traverse = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(traverse);
      return;
    }

    const record = obj as Record<string, unknown>;

    const urlFields = ['url', 'imageUrl', 'videoUrl', 'poster', 'src', 'sourceUrl'];
    for (const field of urlFields) {
      if (typeof record[field] === 'string' && isVirtualUrl(record[field] as string)) {
        urls.add(record[field] as string);
      }
    }

    for (const value of Object.values(record)) {
      traverse(value);
    }
  };

  traverse(elements);
  return urls;
};

/**
 * 获取媒体的 MIME 类型
 */
const getMimeType = (url: string, blob: Blob): string => {
  if (blob.type) return blob.type;

  if (url.includes('/video/') || url.endsWith('.mp4')) return 'video/mp4';
  if (url.endsWith('.webm')) return 'video/webm';
  if (url.endsWith('.png')) return 'image/png';
  if (url.endsWith('.gif')) return 'image/gif';
  if (url.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
};

/**
 * 获取媒体类型
 */
const getMediaType = (mimeType: string): 'image' | 'video' => {
  return mimeType.startsWith('video/') ? 'video' : 'image';
};

/**
 * 将 Blob 转换为 Base64（不含 data: 前缀）
 */
const blobToBase64 = async (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * 收集嵌入式媒体数据
 */
const collectEmbeddedMedia = async (
  virtualUrls: Set<string>
): Promise<EmbeddedMediaItem[]> => {
  const embeddedMedia: EmbeddedMediaItem[] = [];

  for (const url of virtualUrls) {
    try {
      const blob = await unifiedCacheService.getCachedBlob(url);
      if (!blob) {
        console.warn(`[serializeAsJSON] 无法获取缓存媒体: ${url}`);
        continue;
      }

      const mimeType = getMimeType(url, blob);
      const mediaType = getMediaType(mimeType);
      const base64Data = await blobToBase64(blob);
      const cacheMetadata = await unifiedCacheService.getCacheInfo(url);

      embeddedMedia.push({
        url,
        type: mediaType,
        mimeType,
        data: base64Data,
        cachedAt: cacheMetadata.cachedAt,
        lastUsed: cacheMetadata.lastUsed,
        taskId: cacheMetadata.metadata?.taskId,
      });
    } catch (error) {
      console.error(`[serializeAsJSON] 处理媒体失败: ${url}`, error);
    }
  }

  return embeddedMedia;
};

export const collectEmbeddedMediaFromElements = async (
  elements: PlaitElement[]
): Promise<EmbeddedMediaItem[] | undefined> => {
  const virtualUrls = extractVirtualUrls(elements);
  if (virtualUrls.size === 0) return undefined;

  const embeddedMedia = await collectEmbeddedMedia(virtualUrls);
  return embeddedMedia.length > 0 ? embeddedMedia : undefined;
};

/**
 * 恢复嵌入的媒体数据到缓存中
 */
export const restoreEmbeddedMedia = async (
  embeddedMedia?: EmbeddedMediaItem[]
): Promise<void> => {
  if (!embeddedMedia || embeddedMedia.length === 0) return;

  for (const item of embeddedMedia) {
    try {
      const exists = await unifiedCacheService.isCached(item.url);
      if (exists) {
        continue;
      }

      const blob = base64ToBlob(item.data, item.mimeType);

      await unifiedCacheService.cacheMediaFromBlob(item.url, blob, item.type, {
        metadata: {
          taskId: item.taskId || `imported-${Date.now()}`,
        },
        cachedAt: item.cachedAt,
        lastUsed: item.lastUsed || item.cachedAt,
      });
    } catch (error) {
      console.error(`[restoreEmbeddedMedia] 恢复媒体失败: ${item.url}`, error);
    }
  }
};
