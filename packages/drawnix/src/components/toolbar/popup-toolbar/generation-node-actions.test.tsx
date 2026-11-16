import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addSelectedElement,
  clearSelectedElement,
  createTestingBoard,
  fakeNodeWeakMap,
  getSelectedElements,
  IS_BOARD_ALIVE,
  PlaitHistoryBoard,
  type PlaitElement,
  RectangleClient,
  withHistory,
} from '@plait/core';
import { GenerationNodeActions } from './generation-node-actions';
import {
  appendGenerationReference,
  GENERATION_NODE_CHANGE,
  type GenerationNodeData,
  type GenerationNodeElement,
} from '../../../services/generation-node';
import {
  isGenerationInputLine,
  reconcileGenerationInputLines,
  withGenerationNode,
} from '../../../plugins/with-generation-node';

afterEach(cleanup);
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function setup(generationType: 'image' | 'video') {
  const source: PlaitElement = {
    id: 'source',
    type: 'image',
    url: '/source.png',
    points: [
      [0, 0],
      [100, 100],
    ],
  };
  const data: GenerationNodeData = {
    version: 1,
    generationType,
    prompt: 'keep me',
    params: {},
    count: 1,
    references: [],
  };
  const node: GenerationNodeElement = {
    id: 'draft',
    type: 'geometry',
    points: [
      [300, 0],
      [644, 224],
    ],
    generationNode: appendGenerationReference(data, source),
  };
  const result: PlaitElement = {
    id: 'result',
    type: 'image',
    url: '/result.png',
    generationNodeId: node.id,
    points: [
      [800, 0],
      [900, 100],
    ],
  };
  const board = createTestingBoard(
    [
      withHistory,
      (b) => {
        b.getRectangle = (el) =>
          RectangleClient.getRectangleByPoints(el.points ?? []);
        b.getDeletedFragment = () => getSelectedElements(b);
        return b;
      },
      withGenerationNode,
    ],
    [source, node, result]
  );
  IS_BOARD_ALIVE.set(board, true);
  PlaitHistoryBoard.withoutSaving(board, () =>
    reconcileGenerationInputLines(board)
  );
  addSelectedElement(board, node);
  return { board, node };
}

describe('generation card actions', () => {
  it.each(['image', 'video'] as const)(
    'deletes a %s draft and its line, preserves media, and supports undo/redo',
    async (type) => {
      const { board, node } = setup(type);
      await flush();
      fakeNodeWeakMap(board);
      expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
      const view = render(
        <GenerationNodeActions board={board} elements={[node]} language="zh" />
      );
      await act(async () => {
        PlaitHistoryBoard.withNewBatch(board, () =>
          fireEvent.click(view.getByRole('button', { name: '删除' }))
        );
        await flush();
      });
      expect(board.children.map((el) => el.id)).toEqual(['source', 'result']);
      await act(async () => {
        board.undo();
        await flush();
      });
      expect(
        board.children.find((el) => el.id === 'draft')?.generationNode.prompt
      ).toBe('keep me');
      expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
      await act(async () => {
        board.redo();
        await flush();
      });
      expect(board.children.map((el) => el.id)).toEqual(['source', 'result']);
    }
  );

  it('deletes only the selected input line and restores the reference on undo', async () => {
    const { board } = setup('image');
    await flush();
    const line = board.children.find(isGenerationInputLine);
    if (!line) throw new Error('Expected a generated reference line');
    clearSelectedElement(board);
    addSelectedElement(board, line);
    fakeNodeWeakMap(board);
    const view = render(
      <GenerationNodeActions board={board} elements={[line]} language="zh" />
    );
    expect(view.queryByRole('button', { name: '复制' })).toBeNull();
    expect(view.queryByRole('button', { name: '编辑' })).toBeNull();
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: '删除' }));
      await flush();
    });
    expect(board.children.map((el) => el.id)).toEqual([
      'source',
      'draft',
      'result',
    ]);
    expect(board.children[1].generationNode.references).toHaveLength(0);
    await act(async () => {
      board.undo();
      await flush();
    });
    expect(board.children[1].generationNode.references).toHaveLength(1);
    expect(board.children.filter(isGenerationInputLine)).toHaveLength(1);
  });

  it('reopens the selected editor and keeps button gestures out of the canvas', () => {
    const { board, node } = setup('image');
    let opened: string | undefined;
    const handler = (event: Event) => {
      opened = (event as CustomEvent).detail.openNodeId;
    };
    window.addEventListener(GENERATION_NODE_CHANGE, handler);
    let bubbled = false;
    const view = render(
      <div
        onPointerDown={() => {
          bubbled = true;
        }}
      >
        <GenerationNodeActions board={board} elements={[node]} language="zh" />
      </div>
    );
    fireEvent.pointerDown(view.getByRole('button', { name: '编辑' }));
    fireEvent.click(view.getByRole('button', { name: '编辑' }));
    expect(opened).toBe(node.id);
    expect(bubbled).toBe(false);
    window.removeEventListener(GENERATION_NODE_CHANGE, handler);
  });
});
