import {
  getElementById,
  getRectangleByElements,
  type PlaitBoard,
  type Point,
} from '@plait/core';
import {
  ArrowLineComponent,
  isHitPolyLine,
  type PlaitArrowLine,
} from '@plait/draw';
import type { PlaitCanvasAssociationLine } from './canvas-association';

export const ASSOCIATION_STROKE_COLOR = '#9ca3af';
export const ASSOCIATION_STROKE_WIDTH = 1.5;

/** Keep horizontal/vertical departure and arrival with a shared short lead. */
function getCanvasAssociationGeometry(
  points: readonly Point[],
  horizontal = true
) {
  const source = points[0];
  const target = points[points.length - 1];
  if (!source || !target || ![...source, ...target].every(Number.isFinite))
    return null;
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  // Endpoints on facing side edges always use horizontal departure, including
  // references with a large vertical offset. Vertically aligned nodes fall back
  // to a vertical path. A short gap scales down the lead and image clearance.
  const distance = Math.abs(horizontal ? dx : dy);
  if (distance === 0) return null;
  const direction = Math.sign(horizontal ? dx : dy);
  const gap = Math.min(6, distance / 8);
  const lead = Math.min(32, (distance - 2 * gap) / 3);
  const control = Math.min(120, Math.max(0, distance - 2 * gap - 2 * lead) / 2);
  const offset = (point: Point, amount: number): Point =>
    horizontal
      ? [point[0] + amount * direction, point[1]]
      : [point[0], point[1] + amount * direction];
  const start = offset(source, gap);
  const end = offset(target, -gap);
  const branch = offset(start, lead);
  const arrival = offset(end, -lead);
  const c1 = offset(branch, control);
  const c2 = offset(arrival, -control);
  return { start, branch, c1, c2, arrival, end };
}

export function getCanvasAssociationPath(
  points: readonly Point[],
  horizontal = true
): string {
  const geometry = getCanvasAssociationGeometry(points, horizontal);
  if (!geometry) return '';
  const { start, branch, c1, c2, arrival, end } = geometry;
  return `M ${start.join(' ')} L ${branch.join(' ')} C ${c1.join(
    ' '
  )}, ${c2.join(' ')}, ${arrival.join(' ')} L ${end.join(' ')}`;
}

function isHorizontalAssociation(
  board: PlaitBoard,
  element: PlaitCanvasAssociationLine
) {
  const source = getElementById(
    board,
    element.canvasAssociation.sourceElementId
  );
  if (source) {
    const rect = getRectangleByElements(board, [source], false);
    return (
      element.points[0][0] === rect.x ||
      element.points[0][0] === rect.x + rect.width
    );
  }
  return (
    Math.abs(element.points[1][0] - element.points[0][0]) >=
    Math.abs(element.points[1][1] - element.points[0][1])
  );
}

/** Hit test the same smooth curve that is drawn, using Plait's hit tolerance. */
export function isHitCanvasAssociationLine(
  board: PlaitBoard,
  element: PlaitCanvasAssociationLine,
  point: Point
): boolean {
  const geometry = getCanvasAssociationGeometry(
    element.points,
    isHorizontalAssociation(board, element)
  );
  if (!geometry) return false;
  const { start, branch, c1, c2, arrival, end } = geometry;
  const samples: Point[] = [start, branch];
  for (let step = 1; step <= 64; step++) {
    const t = step / 64;
    const u = 1 - t;
    samples.push(
      [0, 1].map(
        (axis) =>
          u ** 3 * branch[axis] +
          3 * u ** 2 * t * c1[axis] +
          3 * u * t ** 2 * c2[axis] +
          t ** 3 * arrival[axis]
      ) as Point
    );
  }
  samples.push(end);
  return isHitPolyLine(samples, point);
}

export function drawCanvasAssociationLine(
  element: PlaitArrowLine,
  horizontal = true
): SVGGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(namespace, 'g');
  const path = document.createElementNS(namespace, 'path');
  group.setAttribute('data-canvas-association-line', element.id);
  path.setAttribute('d', getCanvasAssociationPath(element.points, horizontal));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', ASSOCIATION_STROKE_COLOR);
  path.setAttribute('stroke-width', String(ASSOCIATION_STROKE_WIDTH));
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  group.appendChild(path);
  return group;
}

/** Reuse Plait's element lifecycle, replacing only the managed line's drawing. */
export class CanvasAssociationLineComponent extends ArrowLineComponent {
  initializeGenerator(): void {
    super.initializeGenerator();
    this.shapeGenerator.draw = (element) => {
      return drawCanvasAssociationLine(
        element,
        isHorizontalAssociation(
          this.board,
          element as PlaitCanvasAssociationLine
        )
      );
    };
  }
}
