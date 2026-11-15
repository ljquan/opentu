import { PlaitBoard, PlaitElement, Point } from '@plait/core';
import { getAutoCompletePoints } from '@plait/draw';

export const IMAGE_REFERENCE_PORT_RADIUS = 12;
export const IMAGE_REFERENCE_HIT_RADIUS = 22;
export const IMAGE_REFERENCE_CONNECTIONS: Point[] = [
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
  [0.5, 0],
];
/** Active coordinates are screen-sized, independent of canvas zoom. */
export function getImageReferencePorts(
  board: PlaitBoard,
  image: PlaitElement
): Point[] {
  // Plait returns top/right/bottom/left; reference actions use right/bottom/left/top.
  const native = getAutoCompletePoints(
    board,
    image as Parameters<typeof getAutoCompletePoints>[1],
    true
  );
  return [native[1], native[2], native[3], native[0]].map(([x, y], index) => {
    const [cx, cy] = IMAGE_REFERENCE_CONNECTIONS[index];
    return [x + (cx - 0.5) * 16, y + (cy - 0.5) * 16];
  });
}
export function hitImageReferencePort(point: Point, ports: Point[]): number {
  return ports.findIndex(
    (port) =>
      Math.hypot(point[0] - port[0], point[1] - port[1]) <=
      IMAGE_REFERENCE_HIT_RADIUS
  );
}
