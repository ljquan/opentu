import {
  getElementById,
  getRectangleByElements,
  type Point,
} from '@plait/core';
import { ArrowLineComponent, type PlaitArrowLine } from '@plait/draw';
import type { PlaitCanvasAssociationLine } from './canvas-association';

export const ASSOCIATION_STROKE_COLOR = '#9ca3af';
export const ASSOCIATION_STROKE_WIDTH = 1.5;

/** Keep horizontal/vertical departure and arrival with a shared short lead. */
export function getCanvasAssociationPath(
  points: readonly Point[],
  horizontal = true
): string {
  const source = points[0];
  const target = points[points.length - 1];
  if (!source || !target || ![...source, ...target].every(Number.isFinite))
    return '';
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  // Endpoints on facing side edges always use horizontal departure, including
  // references with a large vertical offset. Vertically aligned nodes fall back
  // to a vertical path. A short gap scales down the lead and image clearance.
  const distance = Math.abs(horizontal ? dx : dy);
  if (distance === 0) return '';
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
  return `M ${start.join(' ')} L ${branch.join(' ')} C ${c1.join(
    ' '
  )}, ${c2.join(' ')}, ${arrival.join(' ')} L ${end.join(' ')}`;
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
      const metadata = (element as PlaitCanvasAssociationLine)
        .canvasAssociation;
      const source = getElementById(this.board, metadata.sourceElementId);
      let horizontal =
        Math.abs(element.points[1][0] - element.points[0][0]) >=
        Math.abs(element.points[1][1] - element.points[0][1]);
      if (source) {
        const rect = getRectangleByElements(this.board, [source], false);
        horizontal =
          element.points[0][0] === rect.x ||
          element.points[0][0] === rect.x + rect.width;
      }
      return drawCanvasAssociationLine(element, horizontal);
    };
  }
}
