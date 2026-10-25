import {
  deleteTemporaryElements,
  getTemporaryRef,
  Transforms,
  type PlaitElement,
} from '@plait/core';
import { createCanvasAssociationLines } from '../../plugins/canvas-association';
import {
  drawImageRegion,
  imageResizeDimensions,
} from '../../utils/canvas-image-tools';
import {
  getCanvasBoardBinding,
  type CanvasBoardBinding,
} from './canvas-board-ref';
import {
  executeCanvasInsertion,
  type CanvasInsertionResultData,
} from './canvas-insertion';

export type ImageResizeStage = 'resizing' | 'inserting';
export interface ImageResizeOptions {
  image: HTMLImageElement;
  target: number;
  algorithm: 'high' | 'bilinear' | 'nearest';
}

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });

/** Preserve the original, its operation record and the existing selection lifecycle. */
export async function resizeCanvasImage(
  binding: CanvasBoardBinding,
  source: PlaitElement,
  { image, target, algorithm }: ImageResizeOptions,
  onStage: (stage: ImageResizeStage) => void,
  signal: AbortSignal
): Promise<{ width: number; height: number }> {
  const { board, boardId } = binding;
  const isCurrentBoard = () => {
    const current = getCanvasBoardBinding();
    return (
      !signal.aborted &&
      current?.board === board &&
      current?.boardId === boardId &&
      board.children.some(
        (item) => item.id === source.id && item.url === source.url
      )
    );
  };
  const assertCurrent = () => {
    if (!isCurrentBoard())
      throw new Error('画布或原图已变更，请重新选择图片。');
  };
  assertCurrent();
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const output = imageResizeDimensions(width, height, target);
  if (output.width === width && output.height === height)
    throw new Error('目标尺寸与原图一致，请调整目标长边');
  onStage('resizing');
  await waitForPaint();
  assertCurrent();
  const content = drawImageRegion(
    image,
    0,
    0,
    width,
    height,
    output,
    algorithm
  );
  onStage('inserting');
  await waitForPaint();
  assertCurrent();
  const result = await executeCanvasInsertion({
    board,
    items: [
      {
        type: 'image',
        content,
        waitForImageLoad: true,
        metadata: {
          localImageOperation: {
            type: 'resize',
            sourceWidth: width,
            sourceHeight: height,
            outputWidth: output.width,
            outputHeight: output.height,
            algorithm,
            createdAt: Date.now(),
            sourcePrompt: [
              source.localImageOperation?.sourcePrompt,
              source.generationPrompt,
              source.aiPrompt,
              source.prompt,
            ].find((value) => typeof value === 'string' && value.trim()),
          },
        },
      },
    ],
    boardGuard: isCurrentBoard,
  });
  if (!result.success) throw new Error(result.error || '图片插入失败');
  assertCurrent();
  const items =
    (result.data as CanvasInsertionResultData | undefined)?.items || [];
  if (boardId) {
    for (const item of items) {
      if (item.elementId)
        createCanvasAssociationLines(board, {
          boardId,
          sourceElementIds: [source.id],
          resultElementId: item.elementId,
        });
    }
  }
  const firstResultId = items.find((item) => item.type === 'image')?.elementId;
  const resizedImage = board.children.find((item) => item.id === firstResultId);
  if (resizedImage) {
    const pendingSelection = getTemporaryRef(board);
    if (pendingSelection) {
      clearTimeout(pendingSelection.timeoutId);
      deleteTemporaryElements(board);
    }
    Transforms.addSelectionWithTemporaryElements(board, [resizedImage]);
  }
  return output;
}
