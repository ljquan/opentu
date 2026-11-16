import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  addSelectedElement,
  clearSelectedElement,
  createTestingBoard,
  IS_BOARD_ALIVE,
  PlaitHistoryBoard,
  RectangleClient,
  Transforms,
  withHistory,
} from '@plait/core';
import { withGenerationNode } from '../plugins/with-generation-node';
import {
  appendGenerationReference,
  notifyGenerationNodeChange,
  type GenerationNodeData,
  updateGenerationNode,
} from '../services/generation-node';
import { useGenerationNodeDraft } from './useGenerationNodeDraft';

const data: GenerationNodeData = {
  version: 1,
  generationType: 'image',
  prompt: 'original',
  params: {},
  count: 1,
  references: [],
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function setup(deferred = false) {
  let pendingLoad: (() => void) | undefined;
  const source = {
    id: 'a',
    type: 'image',
    url: '/a.png',
    points: [
      [0, 0],
      [100, 100],
    ],
  };
  const node = {
    id: 'n',
    type: 'geometry',
    points: [
      [300, 0],
      [644, 224],
    ],
    generationNode: data,
  };
  const board = createTestingBoard(
    [
      withHistory,
      (b) => {
        b.getRectangle = (el) =>
          RectangleClient.getRectangleByPoints(el.points!);
        return b;
      },
      withGenerationNode,
    ],
    [source, node] as any
  );
  IS_BOARD_ALIVE.set(board, true);
  const hook = renderHook(() => {
    const [value, setValue] = useState(data);
    const boardRef = useRef(board);
    const editor = useGenerationNodeDraft(
      boardRef,
      'board',
      {
        read: () => value,
        load: (next) => {
          if (deferred) pendingLoad = () => setValue(next);
          else setValue(next);
        },
        detach: () => setValue(data),
        unsupported: () => undefined,
      },
      value
    );
    return { editor, value, setValue };
  });
  return {
    board,
    hook,
    source,
    finishLoad: () => {
      pendingLoad?.();
      pendingLoad = undefined;
    },
  };
}

describe('generation editor synchronization', () => {
  it('reopens a dismissed selected card on a deliberate click without editing canvas data', async () => {
    const { board, hook } = setup();
    await act(async () => {
      addSelectedElement(board, board.children[1]);
      await flush();
    });
    await waitFor(() => expect(hook.result.current.editor.activeId).toBe('n'));
    await act(async () => {
      hook.result.current.editor.end(false);
    });
    expect(hook.result.current.editor.activeId).toBeNull();
    const before = JSON.stringify(board.children);
    await act(async () => {
      notifyGenerationNodeChange(board);
    });
    expect(hook.result.current.editor.activeId).toBeNull();
    await act(async () => {
      notifyGenerationNodeChange(board, 'n');
    });
    expect(hook.result.current.editor.activeId).toBe('n');
    expect(JSON.stringify(board.children)).toBe(before);
    hook.unmount();
  });

  it('does not overwrite a reference undo with the previous editor value', async () => {
    const { board, hook, source } = setup();
    await act(async () => {
      addSelectedElement(board, board.children[1]);
      await flush();
    });
    await waitFor(() => expect(hook.result.current.editor.activeId).toBe('n'));
    await act(async () => {
      PlaitHistoryBoard.withNewBatch(board, () =>
        updateGenerationNode(
          board,
          'n',
          appendGenerationReference(data, source)
        )
      );
      await flush();
    });
    await waitFor(() =>
      expect(hook.result.current.value.references).toHaveLength(1)
    );
    await act(async () => {
      board.undo();
      await flush();
    });
    await waitFor(() =>
      expect(hook.result.current.value.references).toHaveLength(0)
    );
    expect(
      board.children.find((el) => el.id === 'n')!.generationNode.references
    ).toHaveLength(0);
    await act(async () => {
      board.redo();
      await flush();
    });
    await waitFor(() =>
      expect(hook.result.current.value.references).toHaveLength(1)
    );
    hook.unmount();
  });

  it('preserves redo while the input bar is still applying a canvas reference change', async () => {
    const { board, hook, source, finishLoad } = setup(true);
    await act(async () => {
      addSelectedElement(board, board.children[1]);
      await flush();
    });
    await waitFor(() => expect(hook.result.current.editor.activeId).toBe('n'));
    await act(async () => {
      finishLoad();
    });
    await act(async () => {
      hook.result.current.setValue(appendGenerationReference(data, source));
    });
    await flush();
    await act(async () => {
      board.undo();
      await flush();
    });
    // An unrelated render happens before the input bar finishes its multi-state load.
    await act(async () => {
      hook.result.current.setValue({ ...hook.result.current.value });
    });
    expect(
      board.children.find((el) => el.id === 'n')!.generationNode.references
    ).toHaveLength(0);
    expect(board.history.redos).toHaveLength(1);
    await act(async () => {
      finishLoad();
    });
    await act(async () => {
      board.redo();
      await flush();
      finishLoad();
    });
    expect(hook.result.current.value.references).toHaveLength(1);
    hook.unmount();
  });

  it('does not save stale model parameters while history is loading', async () => {
    const { board, hook, finishLoad } = setup(true);
    await act(async () => {
      addSelectedElement(board, board.children[1]);
      await flush();
    });
    await waitFor(() => expect(hook.result.current.editor.activeId).toBe('n'));
    await act(async () => {
      finishLoad();
    });
    await act(async () => {
      hook.result.current.setValue({ ...data, params: { size: 'large' } });
    });
    await flush();
    await act(async () => {
      board.undo();
      await flush();
    });
    await act(async () => {
      hook.result.current.setValue({ ...hook.result.current.value });
    });
    expect(board.history.redos).toHaveLength(1);
    await act(async () => {
      finishLoad();
    });
    await act(async () => {
      board.redo();
      await flush();
      finishLoad();
    });
    expect(hook.result.current.value.params).toEqual({ size: 'large' });
    hook.unmount();
  });

  it('saves edits and closes on deselection without clearing another selection', async () => {
    const { board, hook, source } = setup();
    await act(async () => {
      addSelectedElement(board, board.children[1]);
      await flush();
    });
    await waitFor(() => expect(hook.result.current.editor.activeId).toBe('n'));
    await act(async () => {
      hook.result.current.setValue({ ...data, prompt: 'updated' });
    });
    await waitFor(() =>
      expect(board.children[1].generationNode.prompt).toBe('updated')
    );
    await act(async () => {
      clearSelectedElement(board);
      addSelectedElement(board, source as any);
      Transforms.setSelection(board, null);
      await flush();
    });
    await waitFor(() => expect(hook.result.current.editor.activeId).toBeNull());
    expect(board.children[1].generationNode.prompt).toBe('updated');
    hook.unmount();
  });
});
