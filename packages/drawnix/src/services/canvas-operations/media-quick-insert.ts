import type { PlaitBoard, Point } from '@plait/core';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import { scrollToPointIfNeeded } from '../../utils/selection-utils';
import { insertMediaIntoSelectedFrame } from '../../utils/frame-insertion-utils';
import { getCanvasBoard } from './canvas-board-ref';
import {
  CANVAS_INSERTION_LAYOUT,
  getBottomMostInsertionPoint,
  getInsertionPointFromSavedSelection,
} from '../../utils/canvas-insertion-layout';

type CanvasMediaType = 'image' | 'video';

interface CanvasMediaInsertResult {
  success: boolean;
  error?: string;
  data?: {
    insertedCount: number;
    items: Array<{
      type: CanvasMediaType;
      point: Point;
      elementId?: string;
      size: { width: number; height: number };
    }>;
    firstElementId?: string;
    firstElementPosition?: Point;
    firstElementSize?: { width: number; height: number };
  };
  type: 'text' | 'error';
}

const MEDIA_DEFAULT_SIZE = 400;

function getDefaultMediaSize(type: CanvasMediaType): {
  width: number;
  height: number;
} {
  if (type === 'video') {
    return {
      width: MEDIA_DEFAULT_SIZE,
      height: Math.round(MEDIA_DEFAULT_SIZE * (9 / 16)),
    };
  }

  return {
    width: MEDIA_DEFAULT_SIZE,
    height: MEDIA_DEFAULT_SIZE,
  };
}

async function insertMedia(
  board: PlaitBoard,
  type: CanvasMediaType,
  content: string,
  point: Point,
  dimensions?: { width: number; height: number }
): Promise<{ width: number; height: number }> {
  const size = dimensions || getDefaultMediaSize(type);

  if (type === 'video') {
    await insertVideoFromUrl(board, content, point, false, size, true, true);
    return size;
  }

  // skipSelect: true - 快速插入通常用于自动插入场景，不选中新图片避免覆盖用户当前选中状态
  await insertImageFromUrl(board, content, point, false, size, true, true, undefined, true);
  return size;
}

export async function quickInsertCanvasMedia(
  type: CanvasMediaType,
  content: string,
  point?: Point,
  dimensions?: { width: number; height: number }
): Promise<CanvasMediaInsertResult> {
  const board = getCanvasBoard();

  if (!board) {
    return {
      success: false,
      error: '画布未初始化，请先打开画布',
      type: 'error',
    };
  }

  try {
    if (!point) {
      const inserted = await insertMediaIntoSelectedFrame(
        board,
        content,
        type,
        dimensions
      );

      if (inserted) {
        return {
          success: true,
          data: {
            insertedCount: 1,
            items: [
              {
                type,
                point: inserted.point,
                elementId: inserted.elementId,
                size: inserted.size,
              },
            ],
            firstElementId: inserted.elementId,
            firstElementPosition: inserted.point,
            firstElementSize: inserted.size,
          },
          type: 'text',
        };
      }
    }

    const targetPoint =
      point ||
      getInsertionPointFromSavedSelection(board, {
        logPrefix: 'MediaQuickInsert',
      }) ||
      getBottomMostInsertionPoint(board, {
        emptyPoint: CANVAS_INSERTION_LAYOUT.DEFAULT_POINT,
      }) ||
      CANVAS_INSERTION_LAYOUT.DEFAULT_POINT;
    const childrenCountBefore = board.children.length;
    const size = await insertMedia(board, type, content, targetPoint, dimensions);
    const insertedElement = board.children[childrenCountBefore] as
      | { id?: string }
      | undefined;

    requestAnimationFrame(() => {
      scrollToPointIfNeeded(board, [
        targetPoint[0] + MEDIA_DEFAULT_SIZE / 2,
        targetPoint[1] + MEDIA_DEFAULT_SIZE / 2,
      ]);
    });

    return {
      success: true,
      data: {
        insertedCount: 1,
        items: [
          {
            type,
            point: targetPoint,
            elementId: insertedElement?.id,
            size,
          },
        ],
        firstElementId: insertedElement?.id,
        firstElementPosition: targetPoint,
        firstElementSize: size,
      },
      type: 'text',
    };
  } catch (error: any) {
    console.error('[MediaQuickInsert] Failed to insert media:', error);
    return {
      success: false,
      error: `插入失败: ${error.message || '未知错误'}`,
      type: 'error',
    };
  }
}
