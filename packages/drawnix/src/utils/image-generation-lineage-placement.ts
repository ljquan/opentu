import {
  getRectangleByElements,
  type PlaitBoard,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { isCanvasAssociationLine } from '../plugins/canvas-association';
import { getRetainedTaskCardRectangles } from './generation-task-placement';

type Rect = { x: number; y: number; width: number; height: number };
export const IMAGE_LINEAGE_GAP = 120;
const SLOT_GAP = 40;

function rectangle(board: PlaitBoard, element: PlaitElement): Rect | null {
  try {
    const rect = getRectangleByElements(board, [element], false);
    if (
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return null;
    const reserved =
      element.type === 'generation-anchor'
        ? element.reservedInsertSize
        : undefined;
    return reserved &&
      Number.isFinite(reserved.width) &&
      Number.isFinite(reserved.height)
      ? {
          ...rect,
          width: Math.max(rect.width, reserved.width),
          height: Math.max(rect.height, reserved.height),
        }
      : rect;
  } catch {
    return null;
  }
}

function occupied(board: PlaitBoard): Rect[] {
  return board.children
    .flatMap((element) => {
      if (element.type === 'arrow-line' || element.type === 'workzone')
        return [];
      const rect = rectangle(board, element);
      return rect ? [rect] : [];
    })
    .concat(getRetainedTaskCardRectangles(board));
}

export function getImageReferenceBounds(
  board: PlaitBoard,
  sourceIds: readonly string[]
): Rect | null {
  const ids = new Set(sourceIds);
  const rects = board.children
    .filter((element) => ids.has(element.id))
    .flatMap((element) => {
      const rect = rectangle(board, element);
      return rect ? [rect] : [];
    });
  if (!rects.length) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

/** Independent creations stay in the root lane, below sources rather than their descendants. */
export function getIndependentImagePosition(
  board: PlaitBoard,
  emptyPosition: Point
): Point {
  const derivedIds = new Set(
    board.children
      .filter(isCanvasAssociationLine)
      .map((line) => line.canvasAssociation.resultElementId)
  );
  const roots = board.children.filter(
    (element) =>
      element.type !== 'arrow-line' &&
      element.type !== 'workzone' &&
      !derivedIds.has(element.id)
  );
  const rects = roots.flatMap((element) => {
    const rect = rectangle(board, element);
    return rect ? [rect] : [];
  });
  return rects.length
    ? [
        Math.min(...rects.map((rect) => rect.x)),
        Math.max(...rects.map((rect) => rect.y + rect.height)) +
          IMAGE_LINEAGE_GAP,
      ]
    : emptyPosition;
}

/** Search down one column only: never silently move siblings into a new derivation column. */
export function placeImageColumn(
  board: PlaitBoard,
  origin: Point,
  sizes: readonly { width: number; height: number }[]
): Point[] {
  const obstacles = occupied(board);
  let y = origin[1];
  return sizes.map((size) => {
    const x = origin[0];
    for (let pass = 0; pass <= obstacles.length; pass++) {
      const currentY = y;
      const blockers = obstacles.filter(
        (rect) =>
          x < rect.x + rect.width + SLOT_GAP &&
          x + size.width + SLOT_GAP > rect.x &&
          currentY < rect.y + rect.height + SLOT_GAP &&
          currentY + size.height + SLOT_GAP > rect.y
      );
      if (!blockers.length) break;
      y = Math.max(...blockers.map((rect) => rect.y + rect.height + SLOT_GAP));
    }
    const point: Point = [x, y];
    obstacles.push({ x, y, ...size });
    y += size.height + SLOT_GAP;
    return point;
  });
}

export function resolveImageLineagePositions(
  board: PlaitBoard,
  sourceIds: readonly string[],
  size: { width: number; height: number },
  count: number,
  emptyPosition: Point
): Point[] {
  const bounds = getImageReferenceBounds(board, sourceIds);
  const totalHeight = count * size.height + Math.max(0, count - 1) * SLOT_GAP;
  const origin: Point = bounds
    ? [
        bounds.x + bounds.width + IMAGE_LINEAGE_GAP,
        bounds.y + (bounds.height - totalHeight) / 2,
      ]
    : getIndependentImagePosition(board, emptyPosition);
  if (bounds) {
    const sources = new Set(sourceIds);
    const siblingIds = new Set(
      board.children
        .filter(isCanvasAssociationLine)
        .filter((line) => sources.has(line.canvasAssociation.sourceElementId))
        .map((line) => line.canvasAssociation.resultElementId)
    );
    for (const sibling of board.children.filter((element) =>
      siblingIds.has(element.id)
    )) {
      const rect = rectangle(board, sibling);
      if (rect && Math.abs(rect.x - origin[0]) < 1)
        origin[1] = Math.max(origin[1], rect.y + rect.height + SLOT_GAP);
    }
  }
  return placeImageColumn(
    board,
    origin,
    Array.from({ length: count }, () => size)
  );
}
