import { PlaitBoard, PlaitElement } from '@plait/core';
import { MIME_TYPES, VERSIONS } from '../constants';
import { fileOpen, fileSave } from './filesystem';
import { DrawnixExportedData, DrawnixExportedType, EmbeddedMediaItem } from './types';
import { loadFromBlob, normalizeFile } from './blob';
import { unifiedCacheService } from '../services/unified-cache-service';

export const getDefaultName = () => {
  const time = new Date().getTime();
  return time.toString();
};

/**
 * 检查 URL 是否为虚拟 URL（需要嵌入媒体数据）
 */
const isVirtualUrl = (url: string): boolean => {
  return (
    url.startsWith('/__aitu_cache__/') ||
    url.startsWith('/asset-library/')
  );
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

    // 检查常见的 URL 字段
    const urlFields = ['url', 'imageUrl', 'videoUrl', 'poster', 'src'];
    for (const field of urlFields) {
      if (typeof record[field] === 'string' && isVirtualUrl(record[field] as string)) {
        urls.add(record[field] as string);
      }
    }

    // 递归遍历所有子对象
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
  
  // 根据 URL 推断
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
      // 移除 "data:xxx;base64," 前缀
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

export const saveAsJSON = async (
  board: PlaitBoard,
  name: string = getDefaultName()
) => {
  const serialized = await serializeAsJSONAsync(board);
  const blob = new Blob([serialized], {
    type: MIME_TYPES.drawnix,
  });

  const fileHandle = await fileSave(blob, {
    name,
    extension: 'drawnix',
    description: 'Drawnix file',
  });
  return { fileHandle };
};

export const loadFromJSON = async (board: PlaitBoard) => {
  const file = await fileOpen({
    description: 'Drawnix files',
    // ToDo: Be over-permissive until https://bugs.webkit.org/show_bug.cgi?id=34442
    // gets resolved. Else, iOS users cannot open `.drawnix` files.
    // extensions: ["json", "drawnix", "png", "svg"],
  });
  return loadFromBlob(board, await normalizeFile(file));
};

export const isValidDrawnixData = (data?: any): data is DrawnixExportedData => {
  return (
    data &&
    data.type === DrawnixExportedType.drawnix &&
    Array.isArray(data.elements) &&
    typeof data.viewport === 'object'
  );
};

/**
 * 同步序列化（向后兼容，不包含嵌入式媒体）
 */
export const serializeAsJSON = (board: PlaitBoard): string => {
  const data = {
    type: DrawnixExportedType.drawnix,
    version: VERSIONS.drawnix,
    source: 'web',
    elements: board.children,
    viewport: board.viewport,
  };

  return JSON.stringify(data, null, 2);
};

/**
 * 异步序列化（包含嵌入式媒体数据）
 * 用于保存文件时，将虚拟 URL 对应的媒体数据内嵌到文件中
 */
export const serializeAsJSONAsync = async (board: PlaitBoard): Promise<string> => {
  const embeddedMedia = await collectEmbeddedMediaFromElements(board.children);

  const data: DrawnixExportedData = {
    type: DrawnixExportedType.drawnix,
    version: VERSIONS.drawnix,
    source: 'web',
    elements: board.children,
    viewport: board.viewport,
    embeddedMedia,
  };

  return JSON.stringify(data, null, 2);
};
