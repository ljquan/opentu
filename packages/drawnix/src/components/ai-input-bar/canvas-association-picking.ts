import {
  findElements,
  RectangleClient,
  toHostPoint,
  toViewBoxPoint,
  type PlaitBoard,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { isCanvasAssociationCandidate } from '../../plugins/canvas-association';

type CanvasAssociationPointer = Pick<
  PointerEvent,
  'clientX' | 'clientY' | 'pointerType'
>;

function isLockedElementHit(
  board: PlaitBoard,
  element: PlaitElement,
  point: Point
): boolean {
  try {
    const rectangle = board.getRectangle(element);
    return Boolean(
      rectangle && RectangleClient.isPointInRectangle(rectangle, point)
    );
  } catch {
    return false;
  }
}

export function getCanvasAssociationPickElements(
  board: PlaitBoard,
  pointer: CanvasAssociationPointer
): PlaitElement[] {
  const point = toViewBoxPoint(
    board,
    toHostPoint(board, pointer.clientX, pointer.clientY)
  );
  const hitElements = findElements(board, {
    match: (element) => {
      if (!isCanvasAssociationCandidate(element)) return false;
      if (element.locked) {
        return isLockedElementHit(board, element, point);
      }
      try {
        return board.isHit(element, point);
      } catch {
        return false;
      }
    },
    recursion: () => true,
  });
  const hitElement =
    hitElements.length > 0 ? board.getOneHitElement(hitElements) : null;
  return hitElement ? [hitElement] : [];
}
