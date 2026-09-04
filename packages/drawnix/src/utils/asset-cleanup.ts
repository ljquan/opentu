/**
 * Asset Cleanup Utilities
 *
 * 处理虚拟URL资源的清理和元素删除
 */

import { PlaitBoard, PlaitElement, CoreTransforms } from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import {
  ASSET_LIBRARY_URL_PREFIX,
  CACHE_URL_PREFIX,
  isVirtualMediaUrl,
} from './virtual-media-url';

const VIRTUAL_IMAGE_ERROR_RETRY_DELAYS = [250, 750, 1500];
const virtualImageErrorAttempts = new Map<string, number>();

const getVirtualImageErrorKey = (
  board: PlaitBoard,
  element: PlaitElement,
  imageUrl: string
): string =>
  `${(board as any).__plait_id || 'board'}:${element.id}:${imageUrl}`;

interface VirtualImageRetry {
  retryUrl: string;
  delay: number;
}

export function clearVirtualUrlImageError(
  board: PlaitBoard,
  element: PlaitElement,
  imageUrl: string
): void {
  if (!isVirtualUrl(imageUrl)) {
    return;
  }
  virtualImageErrorAttempts.delete(
    getVirtualImageErrorKey(board, element, imageUrl)
  );
}

function verifyVirtualImageCache(
  key: string,
  board: PlaitBoard,
  element: PlaitElement,
  imageUrl: string
): void {
  void import('../services/unified-cache-service')
    .then(({ unifiedCacheService }) =>
      unifiedCacheService.getCachedBlob(imageUrl)
    )
    .then((blob) => {
      if (blob) {
        virtualImageErrorAttempts.delete(key);
        return;
      }

      virtualImageErrorAttempts.delete(key);
      // 渲染失败可能来自局域网 HTTP 的安全上下文限制或缓存瞬时不可用。
      // 保留元素，避免一次读取失败永久删除用户白板内容。
    })
    .catch(() => {
      virtualImageErrorAttempts.delete(key);
    });
}

/**
 * 检查是否为虚拟URL（素材库本地URL）
 */
export function isVirtualUrl(url: string): boolean {
  return isVirtualMediaUrl(url);
}

/**
 * 检查是否为缓存URL（合并图片/视频，删除后画布中的图片也会丢失）
 * 支持相对路径 (/__aitu_cache__/...) 和完整 URL (http://xxx/__aitu_cache__/...)
 */
export function isCacheUrl(url: string): boolean {
  return isVirtualUrl(url);
}

/**
 * 从虚拟URL中提取素材ID
 * 例如: /asset-library/87501b99-6c6d-4053-8b38-37bfaabce9a3.png -> 87501b99-6c6d-4053-8b38-37bfaabce9a3
 */
export function extractAssetIdFromUrl(url: string): string | null {
  if (!url.startsWith(ASSET_LIBRARY_URL_PREFIX)) {
    return null;
  }

  // 移除前缀和扩展名
  const pathPart = url.slice(ASSET_LIBRARY_URL_PREFIX.length);
  const dotIndex = pathPart.lastIndexOf('.');
  if (dotIndex > 0) {
    return pathPart.slice(0, dotIndex);
  }
  return pathPart;
}

/**
 * 根据素材ID生成虚拟URL的匹配模式
 */
export function getAssetUrlPattern(assetId: string): string {
  return `${ASSET_LIBRARY_URL_PREFIX}${assetId}`;
}

/**
 * 检查元素的URL是否匹配指定的素材ID
 */
export function isElementUsingAsset(
  element: PlaitElement,
  assetId: string
): boolean {
  const url = (element as any).url;
  if (!url || typeof url !== 'string') {
    return false;
  }

  // 检查URL是否包含素材ID
  const pattern = getAssetUrlPattern(assetId);
  return url.startsWith(pattern);
}

/**
 * 从画布中删除指定的元素
 */
export function removeElementFromBoard(
  board: PlaitBoard,
  element: PlaitElement
): boolean {
  try {
    const elementToRemove = board.children.find(
      (child: any) => child.id === element.id
    );
    if (elementToRemove) {
      CoreTransforms.removeElements(board, [elementToRemove]);
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

/**
 * 处理虚拟URL图片加载失败，自动删除对应元素
 */
export function handleVirtualUrlImageError(
  board: PlaitBoard,
  element: PlaitElement,
  imageUrl: string
): VirtualImageRetry | undefined {
  if (!isVirtualUrl(imageUrl)) {
    return undefined; // 只处理虚拟URL
  }

  const key = getVirtualImageErrorKey(board, element, imageUrl);
  const attempt = virtualImageErrorAttempts.get(key) || 0;
  const delay = VIRTUAL_IMAGE_ERROR_RETRY_DELAYS[attempt];

  if (delay !== undefined) {
    virtualImageErrorAttempts.set(key, attempt + 1);

    return {
      retryUrl: `${imageUrl}${
        imageUrl.includes('?') ? '&' : '?'
      }_retry=${Date.now()}`,
      delay,
    };
  }

  verifyVirtualImageCache(key, board, element, imageUrl);

  return undefined;
}

/**
 * 根据素材ID删除画布上使用该素材的所有元素
 * @param board - 画布实例
 * @param assetId - 素材ID
 * @returns 删除的元素数量
 */
export function removeElementsByAssetId(
  board: PlaitBoard,
  assetId: string
): number {
  if (!board.children || board.children.length === 0) {
    return 0;
  }

  const elementsToRemove: PlaitElement[] = [];

  for (const element of board.children) {
    // 检查是否为图片元素
    if (
      PlaitDrawElement.isDrawElement(element) &&
      PlaitDrawElement.isImage(element)
    ) {
      if (isElementUsingAsset(element, assetId)) {
        elementsToRemove.push(element);
      }
    }
    // 检查是否为视频元素（视频也可能使用虚拟URL）
    else if ((element as any).type === 'video' || (element as any).isVideo) {
      if (isElementUsingAsset(element, assetId)) {
        elementsToRemove.push(element);
      }
    }
  }

  if (elementsToRemove.length > 0) {
    try {
      CoreTransforms.removeElements(board, elementsToRemove);
    } catch (error) {
      return 0;
    }
  }

  return elementsToRemove.length;
}

/**
 * 根据多个素材ID批量删除画布上使用这些素材的所有元素
 * @param board - 画布实例
 * @param assetIds - 素材ID数组
 * @returns 删除的元素数量
 */
export function removeElementsByAssetIds(
  board: PlaitBoard,
  assetIds: string[]
): number {
  if (!board.children || board.children.length === 0 || assetIds.length === 0) {
    return 0;
  }

  const assetIdSet = new Set(assetIds);
  const elementsToRemove: PlaitElement[] = [];

  for (const element of board.children) {
    const url = (element as any).url;
    if (!url || typeof url !== 'string') {
      continue;
    }

    // 提取URL中的素材ID
    const elementAssetId = extractAssetIdFromUrl(url);
    if (elementAssetId && assetIdSet.has(elementAssetId)) {
      // 检查是否为图片或视频元素
      const isImage =
        PlaitDrawElement.isDrawElement(element) &&
        PlaitDrawElement.isImage(element);
      const isVideo =
        (element as any).type === 'video' || (element as any).isVideo;

      if (isImage || isVideo) {
        elementsToRemove.push(element);
      }
    }
  }

  if (elementsToRemove.length > 0) {
    try {
      CoreTransforms.removeElements(board, elementsToRemove);
    } catch (error) {
      return 0;
    }
  }

  return elementsToRemove.length;
}

/**
 * 从完整 URL 或相对路径中提取缓存路径部分
 * 例如: http://localhost:7200/__aitu_cache__/image/xxx.png -> /__aitu_cache__/image/xxx.png
 *       /__aitu_cache__/image/xxx.png -> /__aitu_cache__/image/xxx.png
 */
function extractCachePath(url: string): string | null {
  const cacheIndex = url.indexOf(CACHE_URL_PREFIX);
  if (cacheIndex === -1) {
    return null;
  }
  return url.slice(cacheIndex);
}

/**
 * 根据素材 URL 查找画布上使用该素材的元素数量
 * @param board - 画布实例
 * @param assetUrl - 素材 URL
 * @returns 使用该素材的元素数量
 */
export function countElementsByAssetUrl(
  board: PlaitBoard,
  assetUrl: string
): number {
  if (!board.children || board.children.length === 0) {
    return 0;
  }

  // 提取缓存路径用于匹配
  const targetCachePath = extractCachePath(assetUrl);

  let count = 0;

  for (const element of board.children) {
    const candidateUrls = [
      (element as any).url,
      (element as any).audioUrl,
    ].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    if (candidateUrls.length === 0) {
      continue;
    }

    const isMatch = candidateUrls.some((url) => {
      const elementCachePath = extractCachePath(url);
      return (
        url === assetUrl ||
        (targetCachePath &&
          elementCachePath &&
          targetCachePath === elementCachePath)
      );
    });

    if (isMatch) {
      const isImage =
        PlaitDrawElement.isDrawElement(element) &&
        PlaitDrawElement.isImage(element);
      const isVideo =
        (element as any).type === 'video' || (element as any).isVideo;
      const isAudio = typeof (element as any).audioUrl === 'string';

      if (isImage || isVideo || isAudio) {
        count++;
      }
    }
  }

  return count;
}

export function countElementsByAssetUrls(
  board: PlaitBoard,
  assetUrls: string[]
): number {
  return assetUrls.reduce(
    (total, assetUrl) => total + countElementsByAssetUrl(board, assetUrl),
    0
  );
}

/**
 * 根据素材 URL 删除画布上使用该素材的所有元素
 * @param board - 画布实例
 * @param assetUrl - 素材 URL
 * @returns 删除的元素数量
 */
export function removeElementsByAssetUrl(
  board: PlaitBoard,
  assetUrl: string
): number {
  if (!board.children || board.children.length === 0) {
    return 0;
  }

  // 提取缓存路径用于匹配
  const targetCachePath = extractCachePath(assetUrl);

  const elementsToRemove: PlaitElement[] = [];

  for (const element of board.children) {
    const candidateUrls = [
      (element as any).url,
      (element as any).audioUrl,
    ].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    if (candidateUrls.length === 0) {
      continue;
    }

    const isMatch = candidateUrls.some((url) => {
      const elementCachePath = extractCachePath(url);
      return (
        url === assetUrl ||
        (targetCachePath &&
          elementCachePath &&
          targetCachePath === elementCachePath)
      );
    });

    if (isMatch) {
      const isImage =
        PlaitDrawElement.isDrawElement(element) &&
        PlaitDrawElement.isImage(element);
      const isVideo =
        (element as any).type === 'video' || (element as any).isVideo;
      const isAudio = typeof (element as any).audioUrl === 'string';

      if (isImage || isVideo || isAudio) {
        elementsToRemove.push(element);
      }
    }
  }

  if (elementsToRemove.length > 0) {
    try {
      CoreTransforms.removeElements(board, elementsToRemove);
    } catch (error) {
      return 0;
    }
  }

  return elementsToRemove.length;
}

export function removeElementsByAssetUrls(
  board: PlaitBoard,
  assetUrls: string[]
): number {
  return assetUrls.reduce(
    (total, assetUrl) => total + removeElementsByAssetUrl(board, assetUrl),
    0
  );
}
