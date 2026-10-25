import { createTestingBoard, RectangleClient, type Point } from '@plait/core';
import {
  ArrowLineComponent,
  ArrowLineMarkerType,
  ArrowLineShape,
  createArrowLineElement,
} from '@plait/draw';
import { describe, expect, it, vi } from 'vitest';
import {
  CanvasAssociationLineComponent,
  drawCanvasAssociationLine,
  getCanvasAssociationPath,
} from './canvas-association-line';
import {
  withCanvasAssociation,
  createCanvasAssociationLines,
} from './canvas-association';

describe('managed association line drawing', () => {
  it('shares the departure lead for same-side siblings with different vertical offsets', () => {
    const upper = getCanvasAssociationPath([
      [100, 100],
      [400, 0],
    ]);
    const lower = getCanvasAssociationPath([
      [100, 100],
      [500, 300],
    ]);
    expect(upper.split(' C ')[0]).toBe('M 106 100 L 138 100');
    expect(lower.split(' C ')[0]).toBe(upper.split(' C ')[0]);
    expect(upper).toContain(' L 394 0');
    expect(lower).toContain(' L 494 300');
  });

  it('uses horizontal tangents even when the result is far below the source', () => {
    expect(
      getCanvasAssociationPath([
        [100, 50],
        [500, 540],
      ])
    ).toBe('M 106 50 L 138 50 C 258 50, 342 540, 462 540 L 494 540');
  });

  it('keeps leftward and vertical paths on their facing axes', () => {
    expect(
      getCanvasAssociationPath([
        [400, 50],
        [100, 100],
      ])
    ).toContain('M 394 50 L 362 50');
    expect(
      getCanvasAssociationPath(
        [
          [140, 100],
          [170, 300],
        ],
        false
      )
    ).toContain('M 140 106 L 140 138');
    expect(
      getCanvasAssociationPath(
        [
          [140, 300],
          [170, 100],
        ],
        false
      )
    ).toContain('M 140 294 L 140 262');
  });

  it.each([1, 8, 40])(
    'scales the lead and clearance down for a %s-unit gap',
    (gap) => {
      const path = getCanvasAssociationPath([
        [0, 0],
        [gap, 10],
      ]);
      const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
      expect(values.every(Number.isFinite)).toBe(true);
      const x = values.filter((_, index) => index % 2 === 0);
      expect(x.every((value) => value >= 0 && value <= gap)).toBe(true);
      expect(x).toEqual([...x].sort((a, b) => a - b));
    }
  );

  it('ignores empty, invalid or coincident endpoints', () => {
    expect(getCanvasAssociationPath([])).toBe('');
    expect(
      getCanvasAssociationPath([
        [0, 0],
        [NaN, 10],
      ])
    ).toBe('');
    expect(
      getCanvasAssociationPath([
        [0, 0],
        [0, 0],
      ])
    ).toBe('');
  });

  it('draws a crisp gray SVG path with rounded caps and stable screen width', () => {
    const line = createArrowLineElement(
      ArrowLineShape.curve,
      [
        [0, 0],
        [300, 100],
      ],
      { marker: ArrowLineMarkerType.none },
      { marker: ArrowLineMarkerType.none }
    );
    const snapshot = structuredClone(line);
    const group = drawCanvasAssociationLine(line);
    const path = group.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('#9ca3af');
    expect(path?.getAttribute('stroke-width')).toBe('1.5');
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(group.querySelectorAll('path')).toHaveLength(1);
    expect(line).toEqual(snapshot);
  });

  it('registers the renderer only for managed lines while retaining their persistent endpoints', () => {
    const source = {
      id: 'source',
      type: 'image',
      points: [
        [0, 0],
        [100, 80],
      ] as Point[],
    };
    const result = {
      id: 'result',
      type: 'image',
      points: [
        [300, 0],
        [400, 80],
      ] as Point[],
    };
    const originalDraw = vi.fn(() => ArrowLineComponent);
    const board = createTestingBoard(
      [
        (current) => {
          current.drawElement = originalDraw;
          current.getRectangle = (element) =>
            RectangleClient.getRectangleByPoints(element.points);
          return current;
        },
        withCanvasAssociation,
      ],
      [source, result]
    );
    const [line] = createCanvasAssociationLines(board, {
      boardId: 'board',
      sourceElementIds: ['source'],
      resultElementId: 'result',
    });
    expect(
      board.drawElement({ element: line } as Parameters<
        typeof board.drawElement
      >[0])
    ).toBe(CanvasAssociationLineComponent);
    expect(line.points).toEqual([
      [100, 40],
      [300, 40],
    ]);
    expect(board.isHit(line, [200, 40])).toBe(true);
    expect(board.isHit(line, [200, 80])).toBe(false);
    expect(
      board.drawElement({ element: source } as Parameters<
        typeof board.drawElement
      >[0])
    ).toBe(ArrowLineComponent);
    expect(originalDraw).toHaveBeenCalledOnce();
  });

  it('hits the displayed branch and steep curve instead of the old hand-drawn path', () => {
    const board = createTestingBoard(
      [withCanvasAssociation],
      [
        {
          id: 'source',
          type: 'image',
          points: [
            [0, 0],
            [100, 100],
          ],
        },
        {
          id: 'result',
          type: 'image',
          points: [
            [500, 490],
            [600, 590],
          ],
        },
      ]
    );
    board.getRectangle = (element) =>
      RectangleClient.getRectangleByPoints(element.points);
    const [line] = createCanvasAssociationLines(board, {
      boardId: 'board',
      sourceElementIds: ['source'],
      resultElementId: 'result',
    });
    expect(board.isHit(line, [122, 50])).toBe(true);
    // t = 0.25 on the curve M106,50 L138,50 C258,50 342,540 462,540.
    expect(board.isHit(line, [222.375, 126.5625])).toBe(true);
    expect(board.isHit(line, [222.375, 190])).toBe(false);
  });
});
