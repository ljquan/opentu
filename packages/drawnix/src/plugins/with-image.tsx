import {
  getElementOfFocusedImage,
  isResizing,
  type PlaitImageBoard,
} from '@plait/common';
import {
  ClipboardData,
  getHitElementByPoint,
  isDragging,
  isSelectionMoving,
  BoardTransforms,
  PlaitBoard,
  Point,
  toHostPoint,
  toViewBoxPoint,
  WritableClipboardOperationType,
} from '@plait/core';
import {
  isSupportedAudioFileType,
  getSupportedVideoFileMimeType,
  getSupportedImageFileMimeType,
} from '../data/blob';
import { insertImage, insertImageFromUrlAndSelect } from '../data/image';
import { insertVideoFromUrl } from '../data/video';
import {
  insertAudioFromUrl,
  getAudioFileDuration,
  extractAudioCoverArt,
} from '../data/audio';
import { unifiedCacheService } from '../services/unified-cache-service';
import { assetStorageService } from '../services/asset-storage-service';
import { isHitImage, MindElement, ImageData } from '@plait/mind';
import { ImageViewer } from '../libs/image-viewer';
import { AssetSource, AssetType } from '../types/asset.types';

const MULTI_DROP_COLUMNS = 3;
const MULTI_DROP_COLUMN_WIDTH = 440;
const MULTI_DROP_ROW_HEIGHT = 300;

type DroppedMediaKind = 'image' | 'video' | 'audio';

interface DroppedMediaFile {
  file: File;
  kind: DroppedMediaKind;
  mimeType: string;
}

interface DropViewportAnchor {
  point: Point;
  activePoint: Point;
  zoom: number;
}

function getDroppedMediaFiles(files: FileList): DroppedMediaFile[] {
  const mediaFiles: DroppedMediaFile[] = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const imageMimeType = getSupportedImageFileMimeType(file);
    if (imageMimeType) {
      mediaFiles.push({ file, kind: 'image', mimeType: imageMimeType });
      continue;
    }

    const videoMimeType = getSupportedVideoFileMimeType(file);
    if (videoMimeType) {
      mediaFiles.push({ file, kind: 'video', mimeType: videoMimeType });
      continue;
    }

    if (isSupportedAudioFileType(file.type)) {
      mediaFiles.push({ file, kind: 'audio', mimeType: file.type });
    }
  }

  return mediaFiles;
}

function getDropPoint(board: PlaitBoard, event: DragEvent): Point {
  return toViewBoxPoint(board, toHostPoint(board, event.x, event.y));
}

function getDropViewportAnchor(
  board: PlaitBoard,
  event: DragEvent
): DropViewportAnchor {
  const boardRect = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
  const activePoint: Point = [
    event.clientX - boardRect.x,
    event.clientY - boardRect.y,
  ];

  return {
    point: getDropPoint(board, event),
    activePoint,
    zoom: board.viewport.zoom,
  };
}

function restoreDropViewportAnchor(
  board: PlaitBoard,
  anchor: DropViewportAnchor
): void {
  const restore = () => {
    const zoom =
      Number.isFinite(board.viewport.zoom) && board.viewport.zoom > 0
        ? board.viewport.zoom
        : anchor.zoom;
    BoardTransforms.updateViewport(
      board,
      [
        anchor.point[0] - anchor.activePoint[0] / zoom,
        anchor.point[1] - anchor.activePoint[1] / zoom,
      ],
      zoom
    );
  };

  if (
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function'
  ) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(restore));
    return;
  }

  setTimeout(restore, 0);
}

function getDropPointByIndex(origin: Point, index: number, total: number): Point {
  if (total <= 1) {
    return origin;
  }

  const column = index % MULTI_DROP_COLUMNS;
  const row = Math.floor(index / MULTI_DROP_COLUMNS);
  return [
    origin[0] + column * MULTI_DROP_COLUMN_WIDTH,
    origin[1] + row * MULTI_DROP_ROW_HEIGHT,
  ];
}

function getDroppedFileName(file: File, fallbackPrefix: DroppedMediaKind): string {
  const trimmedName = file.name?.trim();
  return trimmedName || `${fallbackPrefix}-${Date.now()}`;
}

async function insertDroppedVideo(
  board: PlaitBoard,
  file: File,
  mimeType: string,
  point: Point
): Promise<void> {
  const videoBlob =
    file.type === mimeType ? file : file.slice(0, file.size, mimeType);

  await assetStorageService.initialize();
  const asset = await assetStorageService.addAsset({
    type: AssetType.VIDEO,
    source: AssetSource.LOCAL,
    name: getDroppedFileName(file, 'video'),
    blob: videoBlob,
    mimeType,
  });

  await insertVideoFromUrl(board, asset.url, point, true, undefined, true, true);
}

async function insertDroppedAudio(
  board: PlaitBoard,
  file: File,
  mimeType: string,
  point: Point
): Promise<void> {
  const fileName = getDroppedFileName(file, 'audio');
  const title = fileName.replace(/\.[^.]+$/, '');

  await assetStorageService.initialize();
  const asset = await assetStorageService.addAsset({
    type: AssetType.AUDIO,
    source: AssetSource.LOCAL,
    name: fileName,
    blob: file,
    mimeType,
  });
  await unifiedCacheService.updateCachedMedia(asset.url, {
    metadata: {
      name: title,
    },
  });

  const [duration, coverBlob] = await Promise.all([
    getAudioFileDuration(file),
    extractAudioCoverArt(file),
  ]);

  let previewImageUrl: string | undefined;
  if (coverBlob) {
    const coverUrl = `/__aitu_cache__/image/${asset.id}-cover.png`;
    await unifiedCacheService.cacheMediaFromBlob(coverUrl, coverBlob, 'image', {
      taskId: `${asset.id}-cover`,
      name: `${title}-cover`,
    });
    previewImageUrl = coverUrl;
  }

  await insertAudioFromUrl(
    board,
    asset.url,
    {
      title,
      duration,
      previewImageUrl,
    },
    point,
    true
  );
}

async function insertDroppedMediaFiles(
  board: PlaitBoard,
  mediaFiles: DroppedMediaFile[],
  origin: Point,
  anchor: DropViewportAnchor
): Promise<void> {
  const shouldReplaceSingleImage =
    mediaFiles.length === 1 && mediaFiles[0].kind === 'image';

  for (let index = 0; index < mediaFiles.length; index++) {
    const mediaFile = mediaFiles[index];
    const point = getDropPointByIndex(origin, index, mediaFiles.length);

    try {
      if (mediaFile.kind === 'image') {
        await insertImage(
          board,
          mediaFile.file,
          point,
          shouldReplaceSingleImage,
          !shouldReplaceSingleImage
        );
      } else if (mediaFile.kind === 'video') {
        await insertDroppedVideo(
          board,
          mediaFile.file,
          mediaFile.mimeType,
          point
        );
      } else {
        await insertDroppedAudio(
          board,
          mediaFile.file,
          mediaFile.mimeType,
          point
        );
      }
    } catch (err) {
      console.error('[withImagePlugin] Failed to insert dropped media:', err);
    }
  }

  restoreDropViewportAnchor(board, anchor);
}

/**
 * 从 dataTransfer 中提取图片 URL
 * 支持从 iframe 拖拽图片的场景
 */
function extractImageUrlFromDataTransfer(
  dataTransfer: DataTransfer
): string | null {
  // 尝试获取 text/uri-list（标准的 URI 列表格式）
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    // URI 列表可能包含多行，取第一个非注释行
    const urls = uriList
      .split('\n')
      .filter((line) => line && !line.startsWith('#'));
    if (urls.length > 0 && isImageUrl(urls[0])) {
      return urls[0].trim();
    }
  }

  // 尝试获取 text/plain（可能是图片 URL）
  const text = dataTransfer.getData('text/plain');
  if (text && isImageUrl(text.trim())) {
    return text.trim();
  }

  // 尝试获取 text/html（可能包含 img 标签）
  const html = dataTransfer.getData('text/html');
  if (html) {
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch && imgMatch[1]) {
      return imgMatch[1];
    }
  }

  return null;
}

/**
 * 判断 URL 是否是图片 URL
 */
function isImageUrl(url: string): boolean {
  if (!url) return false;

  // 检查是否是有效的 URL
  try {
    new URL(url);
  } catch {
    return false;
  }

  // 检查常见的图片扩展名
  const imageExtensions = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.svg',
    '.bmp',
    '.ico',
  ];
  const lowerUrl = url.toLowerCase();

  // 检查扩展名
  if (imageExtensions.some((ext) => lowerUrl.includes(ext))) {
    return true;
  }

  // 检查常见的图片服务 URL 模式
  const imagePatterns = [
    /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i,
    /\/image\//i,
    /\/images\//i,
    /\/img\//i,
    /\/photo\//i,
    /data:image\//i,
    /blob:/i,
  ];

  return imagePatterns.some((pattern) => pattern.test(url));
}

export const withImagePlugin = (board: PlaitBoard) => {
  const newBoard = board as PlaitBoard & PlaitImageBoard;
  const { insertFragment, drop, pointerUp } = newBoard;
  const viewer = new ImageViewer({
    zoomStep: 0.3,
    minZoom: 0.1,
    maxZoom: 5,
    enableKeyboard: true,
  });

  newBoard.insertFragment = (
    clipboardData: ClipboardData | null,
    targetPoint: Point,
    operationType?: WritableClipboardOperationType
  ) => {
    if (
      clipboardData?.files?.length &&
      getSupportedImageFileMimeType(clipboardData.files[0])
    ) {
      const imageFile = clipboardData.files[0];
      insertImage(board, imageFile, targetPoint, false).catch(() => {});
      return;
    }
    insertFragment(clipboardData, targetPoint, operationType);
  };

  newBoard.drop = (event: DragEvent) => {
    // 优先处理文件拖拽
    if (event.dataTransfer?.files?.length) {
      const mediaFiles = getDroppedMediaFiles(event.dataTransfer.files);
      if (mediaFiles.length > 0) {
        const anchor = getDropViewportAnchor(board, event);
        insertDroppedMediaFiles(
          board,
          mediaFiles,
          anchor.point,
          anchor
        ).catch((err) => {
          console.error(
            '[withImagePlugin] Failed to insert dropped media files:',
            err
          );
        });
        return true;
      }
    }

    // 处理从 iframe 或其他来源拖拽的图片 URL
    if (event.dataTransfer) {
      const imageUrl = extractImageUrlFromDataTransfer(event.dataTransfer);
      if (imageUrl) {
        const point = toViewBoxPoint(
          board,
          toHostPoint(board, event.x, event.y)
        );
        // 异步插入图片并选中
        insertImageFromUrlAndSelect(board, imageUrl, point).catch((err) => {
          console.error(
            '[withImagePlugin] Failed to insert image from URL:',
            err
          );
        });
        return true;
      }
    }

    return drop(event);
  };

  newBoard.pointerUp = (event: PointerEvent) => {
    if (document.documentElement.classList.contains('slideshow-active')) {
      pointerUp(event);
      return;
    }

    const focusMindNode = getElementOfFocusedImage(board);
    if (
      focusMindNode &&
      !isResizing(board) &&
      !isSelectionMoving(board) &&
      !isDragging(board)
    ) {
      const point = toViewBoxPoint(board, toHostPoint(board, event.x, event.y));
      const hitElement = getHitElementByPoint(board, point);
      const isHittingImage =
        hitElement &&
        MindElement.isMindElement(board, hitElement) &&
        MindElement.hasImage(hitElement) &&
        isHitImage(board, hitElement as MindElement<ImageData>, point);
      if (isHittingImage && focusMindNode === hitElement) {
        viewer.open(hitElement.data.image.url);
      }
    }
    pointerUp(event);
  };

  return newBoard;
};
