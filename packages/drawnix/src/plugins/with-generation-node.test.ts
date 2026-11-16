import {
  createTestingBoard,
  IS_BOARD_ALIVE,
  PlaitHistoryBoard,
  RectangleClient,
  Transforms,
  withHistory,
} from '@plait/core';
import { describe, expect, it, vi } from 'vitest';
import * as Draw from '@plait/draw';
import {
  appendGenerationReference,
  GenerationNodeData,
  updateGenerationNode,
} from '../services/generation-node';
import {
  isGenerationInputLine,
  reconcileGenerationInputLines,
  withGenerationNode,
} from './with-generation-node';
vi.mock('@plait/draw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/draw')>();
  return {
    ...actual,
    createArrowLineElement: vi.fn(actual.createArrowLineElement),
  };
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fixture() {
  const a = {
    id: 'a',
    type: 'image',
    url: '/a.png',
    points: [
      [0, 0],
      [100, 100],
    ],
  };
  const data: GenerationNodeData = {
    version: 1,
    generationType: 'image',
    prompt: '',
    params: {},
    count: 1,
    references: [],
  };
  const node = {
    id: 'node',
    type: 'geometry',
    points: [
      [300, 0],
      [600, 160],
    ],
    generationNode: appendGenerationReference(data, a),
  };
  const board = createTestingBoard(
    [
      withHistory,
      (board) => {
        board.getRectangle = (el) =>
          RectangleClient.getRectangleByPoints(el.points!);
        return board;
      },
      withGenerationNode,
    ],
    [a, node] as any
  );
  IS_BOARD_ALIVE.set(board, true);
  PlaitHistoryBoard.withoutSaving(board, () =>
    reconcileGenerationInputLines(board)
  );
  return { board, node, a };
}
describe('generation input line lifecycle', () => {
  it('moves with a source and follows undo/redo without creating extra history', async () => {
    const { board } = fixture();
    await flush();
    PlaitHistoryBoard.withNewBatch(board, () =>
      Transforms.setNode(
        board,
        {
          points: [
            [0, 100],
            [100, 200],
          ],
        },
        [0]
      )
    );
    await flush();
    expect(board.children.find(isGenerationInputLine)?.points?.[0]).toEqual([
      100, 150,
    ]);
    board.undo();
    await flush();
    expect(board.children.find(isGenerationInputLine)?.points?.[0]).toEqual([
      100, 50,
    ]);
    board.redo();
    await flush();
    expect(board.children.find(isGenerationInputLine)?.points?.[0]).toEqual([
      100, 150,
    ]);
  });
  it('deleting a line removes only its reference and is reversible', async () => {
    const { board } = fixture();
    await flush();
    PlaitHistoryBoard.withNewBatch(board, () =>
      Transforms.removeNode(board, [2])
    );
    await flush();
    expect(board.children[1].generationNode.references).toHaveLength(0);
    expect(board.children.map((el) => el.id)).toEqual(['a', 'node']);
    board.undo();
    await flush();
    expect(board.children[1].generationNode.references).toHaveLength(1);
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
    board.redo();
    await flush();
    expect(board.children[1].generationNode.references).toHaveLength(0);
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(0);
  });
  it('refreshes live image content and restores it with undo without changing a submitted snapshot', async () => {
    const { board, node } = fixture();
    await flush();
    const submitted = structuredClone(node.generationNode.references);
    Transforms.setNode(board, { url: '/new.png' }, [0]);
    await flush();
    expect(board.children[1].generationNode.references[0].url).toBe('/new.png');
    expect(submitted[0].url).toBe('/a.png');
    board.undo();
    await flush();
    expect(board.children[1].generationNode.references[0].url).toBe('/a.png');
  });

  it('routes from the facing edges when the source crosses to the right of the card', async () => {
    const { board } = fixture();
    await flush();
    Transforms.setNode(
      board,
      {
        points: [
          [800, 0],
          [900, 100],
        ],
      },
      [0]
    );
    await flush();
    const line = board.children.find(isGenerationInputLine)!;
    expect(line.source.connection).toEqual([0, 0.5]);
    expect(line.target.connection[0]).toBe(1);
    expect(line.points?.[0]).toEqual([800, 50]);
    expect(line.points?.[1][0]).toBe(600);
    board.undo();
    await flush();
    expect(
      board.children.find(isGenerationInputLine)?.source.connection
    ).toEqual([1, 0.5]);
  });

  it('rotates the source connection point with the image', async () => {
    const { board } = fixture();
    await flush();
    Transforms.setNode(board, { angle: Math.PI / 2 }, [0]);
    await flush();
    const point = board.children.find(isGenerationInputLine)?.points?.[0];
    expect(point?.[0]).toBeCloseTo(50);
    expect(point?.[1]).toBeCloseTo(100);
  });

  it('deleting a node removes its derived lines and undo recovers the draft', async () => {
    const { board } = fixture();
    await flush();
    PlaitHistoryBoard.withNewBatch(board, () =>
      Transforms.removeNode(board, [1])
    );
    await flush();
    expect(board.children).toHaveLength(1);
    board.undo();
    await flush();
    expect(board.children[1].generationNode.references[0].sourceElementId).toBe(
      'a'
    );
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
  });

  it('deleting a thumbnail removes the line; undo restores both', async () => {
    const { board, node } = fixture();
    await flush();
    PlaitHistoryBoard.withNewBatch(board, () =>
      updateGenerationNode(board, node.id, {
        ...node.generationNode,
        references: [],
      })
    );
    await flush();
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(0);
    board.undo();
    await flush();
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
  });
  it('deleting the source retains the missing reference, and undo recovers the line', async () => {
    const { board } = fixture();
    await flush();
    PlaitHistoryBoard.withNewBatch(board, () =>
      Transforms.removeNode(board, [0])
    );
    await flush();
    expect(board.children[0].generationNode.references[0].sourceElementId).toBe(
      'a'
    );
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(0);
    board.undo();
    await flush();
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
  });
  it('uses separate bound ports and upgrades old straight lines on reload', async () => {
    const { board, node } = fixture();
    await flush();
    const b = {
      id: 'b',
      type: 'image',
      url: '/b.png',
      points: [
        [0, 200],
        [100, 300],
      ],
    };
    Transforms.insertNode(board, b as any, [board.children.length]);
    updateGenerationNode(
      board,
      node.id,
      appendGenerationReference(node.generationNode, b)
    );
    await flush();
    const lines = board.children.filter(isGenerationInputLine);
    expect(lines).toHaveLength(2);
    expect(
      lines.every(
        (line) =>
          line.shape === 'curve' &&
          line.target.marker === 'none' &&
          line.target.boundId === node.id
      )
    ).toBe(true);
    expect(lines[0].target.connection[1]).not.toBe(
      lines[1].target.connection[1]
    );
    const index = board.children.findIndex((el) => el.id === lines[0].id);
    Transforms.setNode(
      board,
      { shape: 'straight', target: { marker: 'arrow' } },
      [index]
    );
    await flush();
    expect(board.children[index].shape).toBe('curve');
    expect(board.children[index].target.boundId).toBe(node.id);
  });

  it('does not rebuild wires for viewport, selection or unrelated shapes', async () => {
    const { board } = fixture();
    await flush();
    const spy = vi.mocked(Draw.createArrowLineElement);
    spy.mockClear();
    try {
      Transforms.insertNode(
        board,
        {
          id: 'unrelated',
          type: 'geometry',
          points: [
            [900, 0],
            [1000, 100],
          ],
        } as any,
        [board.children.length]
      );
      Transforms.setSelection(board, null);
      await flush();
      expect(spy).not.toHaveBeenCalled();
      Transforms.setNode(
        board,
        {
          points: [
            [0, 50],
            [100, 150],
          ],
        },
        [0]
      );
      await flush();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockClear();
    }
  });
});
