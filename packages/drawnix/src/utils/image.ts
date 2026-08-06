import { getSelectedElements, PlaitBoard } from '@plait/core';
import { base64ToBlob, download } from '@aitu/utils';
import { boardToImage } from './common';
import { fileOpen, isFileSystemAbortError } from '../data/filesystem';
import { IMAGE_MIME_TYPES } from '../constants';
import { insertImage } from '../data/image';
import { MessagePlugin } from './message-plugin';
import { getImageNaturalSize } from './image-natural-size';
import { getSupportedImageFileMimeType } from '../data/blob';

export { getImageNaturalSize } from './image-natural-size';

/**
 * 计算图片编辑后的新尺寸和位置
 * 保持原图的缩放比例，左上角位置不变
 */
export interface ImageElementInfo {
  url: string;
  width?: number;
  height?: number;
  points: [[number, number], [number, number]];
}

export interface ScaledImageResult {
  newPoints: [[number, number], [number, number]];
  scale: number;
}

export async function calculateEditedImagePoints(
  element: ImageElementInfo,
  newNaturalWidth: number,
  newNaturalHeight: number
): Promise<ScaledImageResult> {
  const [start, end] = element.points;
  const originalDisplayWidth = end[0] - start[0];
  const originalDisplayHeight = end[1] - start[1];
  
  // 获取原图的实际尺寸
  let originalNaturalWidth = element.width;
  let originalNaturalHeight = element.height;
  
  if (!originalNaturalWidth || !originalNaturalHeight) {
    const size = await getImageNaturalSize(
      element.url,
      originalDisplayWidth,
      originalDisplayHeight
    );
    originalNaturalWidth = size.width;
    originalNaturalHeight = size.height;
  }
  
  // 计算原图的缩放比例
  const scaleX = originalDisplayWidth / originalNaturalWidth;
  const scaleY = originalDisplayHeight / originalNaturalHeight;
  // 使用较小的缩放比例保持宽高比一致
  const scale = Math.min(scaleX, scaleY);
  
  // 计算新的显示尺寸
  const newDisplayWidth = newNaturalWidth * scale;
  const newDisplayHeight = newNaturalHeight * scale;
  
  return {
    newPoints: [start, [start[0] + newDisplayWidth, start[1] + newDisplayHeight]],
    scale,
  };
}

export const saveAsImage = (board: PlaitBoard, isTransparent: boolean) => {
  const selectedElements = getSelectedElements(board);
  void (async () => {
    try {
      const image = await boardToImage(board, {
        elements: selectedElements.length > 0 ? selectedElements : undefined,
        fillStyle: isTransparent ? 'transparent' : 'white',
      });

      if (image) {
        const ext = isTransparent ? 'png' : 'jpg';
        const pngImage = base64ToBlob(image);
        const imageName = `drawnix-${new Date().getTime()}.${ext}`;
        download(pngImage, imageName);
      }
    } catch (error) {
      console.warn('[ImageExport] Failed to export image:', error);
      MessagePlugin.error('导出图片失败，请稍后重试');
    }
  })();
};

export const addImage = async (board: PlaitBoard) => {
  try {
    const imageFile = await fileOpen({
      description: 'Image',
      extensions: Object.keys(
        IMAGE_MIME_TYPES
      ) as (keyof typeof IMAGE_MIME_TYPES)[],
    });
    const imageMimeType = getSupportedImageFileMimeType(imageFile);
    if (!imageMimeType) {
      MessagePlugin.error('不支持该图片格式');
      return;
    }

    const normalizedImageFile =
      imageFile.type === imageMimeType
        ? imageFile
        : new File([imageFile], imageFile.name, { type: imageMimeType });
    await insertImage(board, normalizedImageFile);
  } catch (error) {
    if (isFileSystemAbortError(error)) {
      return;
    }
    console.error('[ImageImport] Failed to insert local image:', error);
    MessagePlugin.error('插入本地图片失败，请检查图片格式或存储空间');
  }
};
