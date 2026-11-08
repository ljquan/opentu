import { RectangleClient, type PlaitBoard } from '@plait/core';
import type { PlaitImageGenerationAnchor } from '../types/image-generation-anchor.types';

type Size = { width: number; height: number };
const renderedSizes = new WeakMap<PlaitBoard, Map<string, Size>>();

/** UI-only bounds: expanding details must not change the requested image size. */
export function setImageGenerationAnchorRenderedSize(
  board: PlaitBoard,
  id: string,
  size: Size
): boolean {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  )
    return false;
  let sizes = renderedSizes.get(board);
  if (!sizes) {
    sizes = new Map();
    renderedSizes.set(board, sizes);
  }
  const previous = sizes.get(id);
  if (previous?.width === size.width && previous?.height === size.height)
    return false;
  sizes.set(id, size);
  return true;
}

export function clearImageGenerationAnchorRenderedSize(
  board: PlaitBoard,
  id: string
): void {
  renderedSizes.get(board)?.delete(id);
}

export function getImageGenerationAnchorRenderedRectangle(
  board: PlaitBoard,
  element: PlaitImageGenerationAnchor
): RectangleClient {
  const rect = RectangleClient.getRectangleByPoints(element.points);
  const size = renderedSizes.get(board)?.get(element.id);
  return size
    ? {
        ...rect,
        width: Math.max(rect.width, size.width),
        height: Math.max(rect.height, size.height),
      }
    : rect;
}
