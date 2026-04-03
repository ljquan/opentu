import { PlaitBoard } from '@plait/core';
import { isValidDrawnixData } from './json';
import { IMAGE_MIME_TYPES, MIME_TYPES } from '../constants';
import { ValueOf } from '@aitu/utils';
import { DataURL } from '../types';
import { DrawnixExportedData, EmbeddedMediaItem } from './types';
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
 * 恢复嵌入的媒体数据到缓存中
 */
export const restoreEmbeddedMedia = async (
  embeddedMedia?: EmbeddedMediaItem[]
): Promise<void> => {
  if (!embeddedMedia || embeddedMedia.length === 0) return;

  for (const item of embeddedMedia) {
    try {
      // 检查是否已经存在
      const exists = await unifiedCacheService.isCached(item.url);
      if (exists) {
        // console.log(`[restoreEmbeddedMedia] 媒体已存在，跳过: ${item.url}`);
        continue;
      }

      // 将 Base64 转换为 Blob
      const blob = base64ToBlob(item.data, item.mimeType);

      // 缓存到 unifiedCacheService
      await unifiedCacheService.cacheMediaFromBlob(item.url, blob, item.type, {
        metadata: {
          taskId: item.taskId || `imported-${Date.now()}`,
        },
        cachedAt: item.cachedAt,
        lastUsed: item.lastUsed || item.cachedAt,
      });

      // console.log(`[restoreEmbeddedMedia] 已恢复媒体: ${item.url}`);
    } catch (error) {
      console.error(`[restoreEmbeddedMedia] 恢复媒体失败: ${item.url}`, error);
    }
  }
};

export const loadFromBlob = async (board: PlaitBoard, blob: Blob | File) => {
  const contents = await parseFileContents(blob);
  let data: DrawnixExportedData;
  try {
    data = JSON.parse(contents);
    if (isValidDrawnixData(data)) {
      // 如果存在嵌入的媒体数据，先恢复它们
      await restoreEmbeddedMedia(data.embeddedMedia);
      return data;
    }
    throw new Error('Error: invalid file');
  } catch (error: any) {
    throw new Error('Error: invalid file');
  }
};

export const createFile = (
  blob: File | Blob | ArrayBuffer,
  mimeType: ValueOf<typeof MIME_TYPES>,
  name: string | undefined
) => {
  return new File([blob], name || '', {
    type: mimeType,
  });
};

export const blobToArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => {
  if ('arrayBuffer' in blob) {
    return blob.arrayBuffer();
  }
  // Safari
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (!event.target?.result) {
        return reject(new Error("Couldn't convert blob to ArrayBuffer"));
      }
      resolve(event.target.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(blob);
  });
};

export const normalizeFile = async (file: File) => {
  if (!file.type) {
    if (file?.name?.endsWith('.drawnix')) {
      file = createFile(
        await blobToArrayBuffer(file),
        MIME_TYPES.drawnix,
        file.name
      );
    }
  }
  return file;
};

export const parseFileContents = async (blob: Blob | File) => {
  let contents: string;
  if ('text' in Blob) {
    contents = await blob.text();
  } else {
    contents = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsText(blob, 'utf8');
      reader.onloadend = () => {
        if (reader.readyState === FileReader.DONE) {
          resolve(reader.result as string);
        }
      };
    });
  }
  return contents;
};

export const getDataURL = async (file: Blob | File): Promise<DataURL> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = reader.result as DataURL;
      resolve(dataURL);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
};

export const isSupportedImageFileType = (type: string | null | undefined) => {
  return !!type && (Object.values(IMAGE_MIME_TYPES) as string[]).includes(type);
};

export const isSupportedImageFile = (
  blob: Blob | null | undefined
): blob is Blob & { type: ValueOf<typeof IMAGE_MIME_TYPES> } => {
  const { type } = blob || {};
  return isSupportedImageFileType(type);
};
