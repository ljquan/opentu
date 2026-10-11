import type { PlaitBoard, Point } from '@plait/core';
import {
  getWorkZoneRenderScale,
  getWorkZoneVisualRectangle,
  isWorkZoneElement,
} from '../plugins/workzone-transforms';

export function occupiesGenerationPlacement(element: {
  type?: string;
  workflow?: { status?: string; steps?: { status?: string }[] };
}): boolean {
  return (
    element.type !== 'workzone' ||
    element.workflow?.status === 'failed' ||
    element.workflow?.status === 'cancelled' ||
    element.workflow?.steps?.some((step) => step.status === 'failed') === true
  );
}

export function getRetainedTaskCardRectangles(board: PlaitBoard) {
  return board.children.flatMap((element) => {
    if (!isWorkZoneElement(element) || !occupiesGenerationPlacement(element))
      return [];
    return [getWorkZoneVisualRectangle(element)];
  });
}

export function placeBelowRetainedTaskCards(
  board: PlaitBoard,
  position: Point,
  size: { width: number; height: number },
  gap = 50,
  zoom = 1
): Point {
  const obstacles = getRetainedTaskCardRectangles(board);
  const scale = getWorkZoneRenderScale({ zoom });
  const width = size.width * scale;
  const height = size.height * scale;
  const [x, startY] = position;
  let y = startY;
  // A downward move can meet another retained card, so resolve the full chain.
  for (let pass = 0; pass < obstacles.length; pass += 1) {
    let nextY = y;
    for (const rect of obstacles) {
      if (
        x < rect.x + rect.width &&
        x + width > rect.x &&
        y < rect.y + rect.height + gap &&
        y + height + gap > rect.y
      ) {
        nextY = Math.max(nextY, rect.y + rect.height + gap);
      }
    }
    if (nextY === y) break;
    y = nextY;
  }
  return [x, y];
}
