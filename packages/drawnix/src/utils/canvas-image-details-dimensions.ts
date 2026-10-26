import { PlaitHistoryBoard, Transforms, type PlaitBoard } from '@plait/core';
import type { CanvasImageDetailsSource } from './canvas-image-details';
import { getImageNaturalSize } from './image-natural-size';
import { isVirtualMediaUrl } from './virtual-media-url';
import { getCanvasBoardBinding } from '../services/canvas-operations/canvas-board-ref';
import {
  IMAGE_CACHE_TIMEOUT_MS,
  withImageOperationTimeout,
} from './image-operation-timeout';

/** Read the original only; preview thumbnails and canvas geometry are not pixels. */
export async function resolveCanvasImageDetailsDimensions(
  source: CanvasImageDetailsSource,
  board?: PlaitBoard,
  isCurrent = () => true
): Promise<CanvasImageDetailsSource> {
  if (
    !source.url ||
    (source.kind && source.kind !== 'image') ||
    source.localOperation ||
    (source.width && source.height)
  )
    return source;
  const binding = getCanvasBoardBinding();
  let objectUrl: string | undefined;
  try {
    let originalUrl = source.url;
    if (isVirtualMediaUrl(originalUrl)) {
      const { unifiedCacheService } = await import(
        '../services/unified-cache-service'
      );
      const blob = await withImageOperationTimeout(
        () =>
          unifiedCacheService.getCachedBlob(originalUrl, {
            allowNetwork: false,
          }),
        IMAGE_CACHE_TIMEOUT_MS,
        '图片原图读取超时'
      );
      if (!blob?.size || !isCurrent()) return source;
      objectUrl = URL.createObjectURL(blob);
      originalUrl = objectUrl;
    }
    const size = await getImageNaturalSize(originalUrl, 0, 0);
    if (
      !Number.isInteger(size.width) ||
      !Number.isInteger(size.height) ||
      size.width <= 0 ||
      size.height <= 0 ||
      !isCurrent()
    )
      return source;
    const currentBinding = getCanvasBoardBinding();
    if (
      board &&
      !board.options?.readonly &&
      !source.url.startsWith('data:') &&
      binding?.board === board &&
      currentBinding?.board === board &&
      binding.boardId === currentBinding.boardId
    ) {
      const index = board.children.findIndex(
        (element) => element.id === source.id && element.url === source.url
      );
      if (index >= 0) {
        PlaitHistoryBoard.withoutSaving(board, () => {
          Transforms.setNode(
            board,
            {
              imageNaturalSize: { url: source.url, ...size },
            },
            [index]
          );
        });
      }
    }
    return { ...source, ...size };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
