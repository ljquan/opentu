import {
  createBoard,
  RectangleClient,
  Transforms,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { describe, expect, it } from 'vitest';
import { createCanvasAssociationLines } from '../../plugins/canvas-association';
import {
  getIndependentImagePosition,
  resolveImageLineagePositions,
} from '../image-generation-lineage-placement';

function image(
  id: string,
  x: number,
  y: number,
  width = 400,
  height = 400
): PlaitElement {
  return {
    id,
    type: 'image',
    url: `/${id}.png`,
    points: [
      [x, y],
      [x + width, y + height],
    ],
  };
}
function board(elements: PlaitElement[]) {
  const result = createBoard(elements);
  result.getRectangle = (element) =>
    RectangleClient.getRectangleByPoints(element.points || []);
  return result;
}
const size = { width: 400, height: 400 };

describe('image lineage placement', () => {
  it.each([
    [200, 600],
    [600, 200],
  ])(
    'places portrait/landscape references on the right (%s x %s)',
    (width, height) => {
      const current = board([image('source', 100, 200, width, height)]);
      const [point] = resolveImageLineagePositions(
        current,
        ['source'],
        size,
        1,
        [0, 0]
      );
      expect(point).toEqual([100 + width + 120, 200 + (height - 400) / 2]);
      expect(current.children[0].points).toEqual([
        [100, 200],
        [100 + width, 200 + height],
      ]);
    }
  );

  it('uses all actual sources and ignores an unrelated current selection', () => {
    const current = board([
      image('a', 0, 0),
      image('b', 0, 500),
      image('unrelated', 2500, 2500),
    ]);
    Object.assign(current, {
      appState: { lastSelectedElementIds: ['unrelated'] },
    });
    expect(
      resolveImageLineagePositions(current, ['a', 'b'], size, 1, [0, 0])
    ).toEqual([[520, 250]]);
  });

  it('keeps sibling requests in one right-hand column and derived requests in the next', () => {
    const current = board([image('a', 0, 0), image('b', 520, 0)]);
    expect(
      resolveImageLineagePositions(current, ['a'], size, 1, [0, 0])
    ).toEqual([[520, 440]]);
    expect(
      resolveImageLineagePositions(current, ['b'], size, 1, [0, 0])
    ).toEqual([[1040, 0]]);
  });

  it('reserves all batch slots before tasks finish and respects small placeholders with larger reservations', () => {
    const pending = {
      ...image('pending', 520, 0, 168, 72),
      type: 'generation-anchor',
      reservedInsertSize: { width: 400, height: 600 },
    };
    const current = board([image('a', 0, 0), pending]);
    createCanvasAssociationLines(current, {
      boardId: 'board',
      sourceElementIds: ['a'],
      resultElementId: 'pending',
    });
    const positions = resolveImageLineagePositions(
      current,
      ['a'],
      size,
      3,
      [0, 0]
    );
    expect(positions.map((point) => point[0])).toEqual([520, 520, 520]);
    expect(positions[0][1]).toBeGreaterThanOrEqual(640);
    expect(positions[1][1] - positions[0][1]).toBeGreaterThanOrEqual(440);
    expect(positions[2][1] - positions[1][1]).toBeGreaterThanOrEqual(440);
  });

  it('places independent creations below roots, without letting distant descendants shift the root lane', () => {
    const current = board([image('a', 100, 100), image('child', 620, 5000)]);
    createCanvasAssociationLines(current, {
      boardId: 'board',
      sourceElementIds: ['a'],
      resultElementId: 'child',
    });
    expect(getIndependentImagePosition(current, [0, 0])).toEqual([100, 620]);
    expect(resolveImageLineagePositions(current, [], size, 1, [0, 0])).toEqual([
      [100, 620],
    ]);
  });

  it('avoids occupied slots after a reserved batch placeholder has become a real result', () => {
    const current = board([image('a', 0, 0)]);
    const positions = resolveImageLineagePositions(
      current,
      ['a'],
      size,
      2,
      [0, 0]
    );
    positions
      .reverse()
      .forEach((point, index) =>
        Transforms.insertNode(current, image(`result-${index}`, ...point), [
          current.children.length,
        ])
      );
    const [next] = resolveImageLineagePositions(
      current,
      ['a'],
      size,
      1,
      [0, 0]
    );
    expect(next[0]).toBe(520);
    expect(next[1]).toBeGreaterThan(
      Math.max(...positions.map((point) => point[1]))
    );
  });

  it('uses the fallback only on an empty canvas', () => {
    expect(
      resolveImageLineagePositions(board([]), [], size, 1, [123, 456] as Point)
    ).toEqual([[123, 456]]);
  });

  it.each([2, 5, 10])('places all %s results in one row without wrapping', (count) => {
    const positions = resolveImageLineagePositions(board([]), [], size, count, [100, 200], 'row');
    expect(positions).toEqual(
      Array.from({ length: count }, (_, index) => [100 + index * 440, 200])
    );
  });

  it('starts a horizontal batch to the right of all actual references', () => {
    const current = board([image('a', 0, 0), image('b', 100, 500)]);
    expect(resolveImageLineagePositions(current, ['a', 'b'], size, 3, [0, 0], 'row')).toEqual([
      [620, 250], [1060, 250], [1500, 250],
    ]);
  });

  it('moves the entire row below an obstacle that only intersects a later slot', () => {
    const current = board([image('source', 0, 0), image('blocker', 1000, 0)]);
    expect(resolveImageLineagePositions(current, ['source'], size, 3, [0, 0], 'row')).toEqual([
      [520, 440], [960, 440], [1400, 440],
    ]);
  });

  it('clears every reserved slot of a previous batch and keeps later requests in their own row', () => {
    const current = board([image('source', 0, 0)]);
    const reserved = { width: 400, height: 600 };
    const first = resolveImageLineagePositions(current, ['source'], reserved, 3, [0, 0], 'row');
    for (const [index, point] of first.entries()) {
      const anchor = {
        ...image(`pending-${index}`, ...point, 168, 72),
        type: 'generation-anchor',
        reservedInsertSize: reserved,
      };
      Transforms.insertNode(current, anchor, [current.children.length]);
      createCanvasAssociationLines(current, {
        boardId: 'board', sourceElementIds: ['source'], resultElementId: anchor.id,
      });
    }
    const second = resolveImageLineagePositions(current, ['source'], reserved, 3, [0, 0], 'row');
    expect(second.map((point) => point[0])).toEqual([520, 960, 1400]);
    expect(second.every((point) => point[1] === second[0][1])).toBe(true);
    expect(second[0][1]).toBeGreaterThanOrEqual(first[0][1] + 640);
    expect(current.children.filter((element) => element.type === 'generation-anchor').map((element) => element.points[0])).toEqual(first);
  });

  it('clears retained failed cards without splitting a horizontal batch', () => {
    const current = board([
      image('source', 0, 0),
      {
        id: 'failed', type: 'workzone', workflow: { status: 'failed' }, zoom: 0.5,
        points: [[1000, 0], [1360, 240]],
      },
    ]);
    const positions = resolveImageLineagePositions(current, ['source'], size, 3, [0, 0], 'row');
    expect(positions).toEqual([[520, 520], [960, 520], [1400, 520]]);
  });

  it('can switch back to a column without moving existing results', () => {
    const current = board([]);
    const first = resolveImageLineagePositions(current, [], size, 3, [100, 200], 'row');
    first.forEach((point, index) => Transforms.insertNode(current, image(`result-${index}`, ...point), [current.children.length]));
    const second = resolveImageLineagePositions(current, [], size, 3, [0, 0], 'column');
    expect(second).toEqual([[100, 720], [100, 1160], [100, 1600]]);
    expect(current.children.map((element) => element.points[0])).toEqual(first);
  });

  it('keeps single-image positions unchanged with either setting', () => {
    const current = board([image('source', 100, 200, 200, 600)]);
    expect(resolveImageLineagePositions(current, ['source'], size, 1, [0, 0], 'row')).toEqual(
      resolveImageLineagePositions(current, ['source'], size, 1, [0, 0], 'column')
    );
  });
});
