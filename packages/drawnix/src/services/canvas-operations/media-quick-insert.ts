import { Transforms, type PlaitBoard, type Point } from '@plait/core';
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

function readStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function attachGenerationMetadata(
  board: PlaitBoard,
  elementId: string | undefined,
  metadata: Record<string, unknown> | undefined
): void {
  if (!elementId) return;

  const prompt = readStringMetadata(metadata, 'prompt');
  const explicitGenerationPrompt =
    readStringMetadata(metadata, 'generationPrompt') ||
    readStringMetadata(metadata, 'aiPrompt');
  const generationTaskId = readStringMetadata(metadata, 'generationTaskId');
  const generationAnchorId = readStringMetadata(metadata, 'generationAnchorId');
  const generationPrompt =
    explicitGenerationPrompt ||
    (generationTaskId || generationAnchorId ? prompt : undefined);
  const patch: Record<string, unknown> = {};

  if (prompt) patch.prompt = prompt;
  if (generationPrompt) {
    patch.aiPrompt = generationPrompt;
    patch.generationPrompt = generationPrompt;
  }
  if (generationTaskId) patch.generationTaskId = generationTaskId;
  if (generationAnchorId) patch.generationAnchorId = generationAnchorId;
  if (Object.keys(patch).length === 0) return;

  const elementIndex = board.children.findIndex(
    (element) => element.id === elementId
  );
  if (elementIndex < 0) return;
  Transforms.setNode(board, patch as Partial<PlaitBoard['children'][number]>, [
    elementIndex,
  ]);
}

async function insertMedia(
  board: PlaitBoard,
  type: CanvasMediaType,
  content: string,
  point: Point,
  dimensions?: { width: number; height: number }
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  const size = dimensions || getDefaultMediaSize(type);
  const elementId =
    type === 'video'
      ? await insertVideoFromUrl(board, content, point, false, size, true, true)
      : await insertImageFromUrl(
          board,
          content,
          point,
          false,
          size,
          true,
          true
        );
  return { elementId, size };
}

export async function quickInsertCanvasMedia(
  type: CanvasMediaType,
  content: string,
  point?: Point,
  dimensions?: { width: number; height: number },
  metadata?: Record<string, unknown>
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
        dimensions,
        { metadata }
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
    const inserted = await insertMedia(
      board,
      type,
      content,
      targetPoint,
      dimensions
    );
    attachGenerationMetadata(board, inserted.elementId, metadata);

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
            elementId: inserted.elementId,
            size: inserted.size,
          },
        ],
        firstElementId: inserted.elementId,
        firstElementPosition: targetPoint,
        firstElementSize: inserted.size,
      },
      type: 'text',
    };
  } catch (error: unknown) {
    console.error('[MediaQuickInsert] Failed to insert media:', error);
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : typeof error === 'string' && error.trim()
        ? error
        : '未知错误';
    return {
      success: false,
      error: `插入失败: ${message}`,
      type: 'error',
    };
  }
}
