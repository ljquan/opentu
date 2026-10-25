import type { PlaitElement } from '@plait/core';
import { createCanvasAssociationLines } from '../../plugins/canvas-association';
import {
  getCanvasBoardBinding,
  type CanvasBoardBinding,
} from './canvas-board-ref';
import {
  executeCanvasInsertion,
  type CanvasInsertionResultData,
} from './canvas-insertion';

/** Keep a split operation attached to the board and source selected when the editor opened. */
export async function insertSplitImages(
  binding: CanvasBoardBinding,
  source: PlaitElement,
  images: string[]
): Promise<void> {
  const isCurrentBoard = () => {
    const current = getCanvasBoardBinding();
    return (
      current?.board === binding.board &&
      current?.boardId === binding.boardId &&
      binding.board.children.some(
        (element) => element.id === source.id && element.url === source.url
      )
    );
  };
  if (!isCurrentBoard()) throw new Error('画布或原图已变更，请重新选择图片。');
  const result = await executeCanvasInsertion({
    board: binding.board,
    items: images.map((content) => ({
      type: 'image' as const,
      content,
      waitForImageLoad: true,
    })),
    boardGuard: isCurrentBoard,
  });
  if (!result.success) throw new Error(result.error || '图片插入失败');
  if (!isCurrentBoard())
    throw new Error('画布或原图已变更，请返回原画布查看结果。');
  if (binding.boardId) {
    for (const item of (result.data as CanvasInsertionResultData | undefined)
      ?.items || []) {
      if (item.elementId)
        createCanvasAssociationLines(binding.board, {
          boardId: binding.boardId,
          sourceElementIds: [source.id],
          resultElementId: item.elementId,
        });
    }
  }
}
