import {
  getSelectedElements,
  PlaitBoard,
  PlaitHistoryBoard,
  Point,
  RectangleClient,
  Transforms,
} from '@plait/core';
import { isMaskBrushEligibleImage } from '../../utils/ai-mask-brush';
import { Freehand, FreehandShape } from './type';
import { getFreehandRectangle } from './utils';

function isMask(element: unknown): element is Freehand {
  return !!element && Freehand.isFreehand(element) &&
    element.shape === FreehandShape.mask && Array.isArray(element.points) && element.points.length > 0;
}

function getMaskOwner(board: PlaitBoard, mask: Freehand) {
  if (mask.aiMaskTargetId) {
    return board.children.find(
      (element) => element.id === mask.aiMaskTargetId && isMaskBrushEligibleImage(element)
    );
  }
  const strokeRect = getFreehandRectangle(mask);
  const images = board.children.filter(
    (element) => isMaskBrushEligibleImage(element) && RectangleClient.isHit(
      RectangleClient.getRectangleByPoints(element.points), strokeRect
    )
  );
  return images.length === 1 ? images[0] : undefined;
}

function getNewMaskOwner(board: PlaitBoard, mask: Freehand) {
  const images = board.children.filter(
    (element) => isMaskBrushEligibleImage(element) && RectangleClient.isPointInRectangle(
      RectangleClient.getRectangleByPoints(element.points), mask.points[0]
    )
  );
  const selectedImages = getSelectedElements(board).filter(
    (element) => images.includes(element)
  );
  return selectedImages.length === 1 ? selectedImages[0] : images.at(-1);
}

/** Keep image-local mask geometry in the same history batch as its source image. */
export const withImageMaskBinding = (board: PlaitBoard) => {
  const { apply } = board;
  let syncing = false;

  board.apply = (operation) => {
    // Undo/redo already replay the recorded image and stroke operations together.
    if (syncing || PlaitHistoryBoard.isSaving(board) === false) {
      return apply(operation);
    }

    if (operation.type === 'insert_node' && isMask(operation.node)) {
      const existingOwner = getMaskOwner(board, operation.node);
      if (operation.node.aiMaskTargetId && existingOwner && RectangleClient.isPointInRectangle(
        RectangleClient.getRectangleByPoints(existingOwner.points || []), operation.node.points[0]
      )) {
        return apply(operation);
      }
      const owner = getNewMaskOwner(board, operation.node);
      return apply({
        ...operation,
        node: { ...operation.node, aiMaskTargetId: owner?.id },
      });
    }

    if (
      (operation.type !== 'set_node' && operation.type !== 'remove_node') ||
      operation.path.length !== 1
    ) {
      return apply(operation);
    }

    const image = board.children[operation.path[0]];
    if (!isMaskBrushEligibleImage(image)) return apply(operation);
    const newPoints = operation.type === 'set_node' ? operation.newProperties.points : null;
    if (operation.type === 'set_node' && (!Array.isArray(newPoints) || newPoints.length !== 2)) {
      return apply(operation);
    }
    const masks = board.children.filter(
      (element): element is Freehand => isMask(element) && getMaskOwner(board, element)?.id === image.id
    );
    const selectedIds = new Set(getSelectedElements(board).map((element) => element.id));
    const before = RectangleClient.getRectangleByPoints(image.points);
    const after = newPoints && RectangleClient.getRectangleByPoints(newPoints as Point[]);

    apply(operation);
    syncing = true;
    try {
      PlaitHistoryBoard.withMerging(board, () => {
        for (const mask of masks) {
          const index = board.children.findIndex((element) => element.id === mask.id);
          if (index < 0) continue;
          if (operation.type === 'remove_node') {
            Transforms.removeNode(board, [index]);
          } else if (after && before.width > 0 && before.height > 0) {
            // Multi-selection transforms already update explicitly selected strokes.
            if (selectedIds.has(mask.id)) {
              if (!mask.aiMaskTargetId) {
                Transforms.setNode(board, { aiMaskTargetId: image.id } as Partial<Freehand>, [index]);
              }
              continue;
            }
            const scaleX = after.width / before.width;
            const scaleY = after.height / before.height;
            const points: Point[] = mask.points.map(([x, y]) => [
              after.x + (x - before.x) * scaleX,
              after.y + (y - before.y) * scaleY,
            ]);
            Transforms.setNode(board, {
              aiMaskTargetId: image.id,
              points,
              strokeWidth: (mask.strokeWidth || 2) * Math.max(scaleX, scaleY),
            } as Partial<Freehand>, [index]);
          }
        }
      });
    } finally {
      syncing = false;
    }
  };
  return board;
};
