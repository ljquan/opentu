import { act, renderHook } from '@testing-library/react';
import { createTestingBoard, withHistory } from '@plait/core';
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  BasicShapes,
  createArrowLineElement,
} from '@plait/draw';
import { describe, expect, it, vi } from 'vitest';
import {
  createAutoCompleteElements,
  setAutoCompleteState,
} from '../plugins/with-arrow-line-auto-complete-extend';
import {
  AI_INPUT_PREFILL_EVENT,
  CANVAS_IMAGE_EDIT_EVENT,
} from '../services/ai-input-ui-events';
import { useAutoCompleteShapePicker } from './useAutoCompleteShapePicker';

vi.mock(
  '../plugins/with-arrow-line-auto-complete-extend',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../plugins/with-arrow-line-auto-complete-extend')
    >()),
    createAutoCompleteElements: vi.fn(),
  })
);

function setup(mode: 'click' | 'arrowLine' = 'arrowLine') {
  const source = {
    id: 'source',
    type: 'image',
    url: '/reference.png',
    points: [
      [0, 0],
      [100, 100],
    ],
  };
  const board = createTestingBoard([withHistory], [source] as any);
  const line = createArrowLineElement(
    ArrowLineShape.curve,
    [
      [100, 50],
      [300, 50],
    ],
    {
      boundId: source.id,
      connection: [1, 0.5],
      marker: ArrowLineMarkerType.none,
    },
    { marker: ArrowLineMarkerType.none }
  );
  setAutoCompleteState(board, {
    visible: true,
    position: { x: 300, y: 50 },
    sourceElement: source as any,
    currentShape: BasicShapes.rectangle,
    hitIndex: 0,
    hitPoint: [100, 50],
    mode,
    arrowLineElement: mode === 'click' ? null : line,
    arrowLineEndPoint: mode === 'click' ? null : [300, 50],
  });
  const hook = renderHook(() => useAutoCompleteShapePicker(board));
  return { board, line, hook };
}

describe.each(['click', 'arrowLine'] as const)(
  'image connection action menu (%s)',
  (mode) => {
    it('cancel leaves canvas and undo history untouched', () => {
      const { board, hook } = setup(mode);
      act(() => hook.result.current.closePicker());
      expect(board.children).toHaveLength(1);
      expect(board.history.undos).toHaveLength(0);
      expect(hook.result.current.state.visible).toBe(false);
      hook.unmount();
    });
    it('ordinary line dispatches the click action or commits an undoable drag preview', async () => {
      const { board, line, hook } = setup(mode);
      await act(async () => hook.result.current.selectGeneration('line'));
      if (mode === 'arrowLine') {
        expect(board.children.map((element) => element.id)).toContain(line.id);
      } else {
        expect(createAutoCompleteElements).toHaveBeenCalledWith(
          board,
          board.children[0],
          1,
          [100, 50],
          BasicShapes.rectangle
        );
        expect(hook.result.current.state.visible).toBe(false);
        hook.unmount();
        return;
      }
      expect(board.history.undos).toHaveLength(1);
      await act(async () => board.undo());
      expect(board.children).toHaveLength(1);
      hook.unmount();
    });
    it('text passes only the source image into the existing input bar', () => {
      const listener = vi.fn();
      window.addEventListener(AI_INPUT_PREFILL_EVENT, listener);
      const { board, hook } = setup(mode);
      act(() => hook.result.current.selectGeneration('text'));
      expect(listener.mock.calls[0][0].detail).toMatchObject({
        generationType: 'text',
        intent: 'edit',
        images: [{ url: '/reference.png', sourceElementId: 'source' }],
      });
      expect(board.children).toHaveLength(1);
      window.removeEventListener(AI_INPUT_PREFILL_EVENT, listener);
      hook.unmount();
    });
    it('quick edit opens the source without adding a canvas operation', () => {
      const listener = vi.fn();
      window.addEventListener(CANVAS_IMAGE_EDIT_EVENT, listener);
      const { board, hook } = setup(mode);
      act(() => hook.result.current.selectGeneration('edit'));
      expect(listener.mock.calls[0][0].detail.elementId).toBe('source');
      expect(board.history.undos).toHaveLength(0);
      window.removeEventListener(CANVAS_IMAGE_EDIT_EVENT, listener);
      hook.unmount();
    });
  }
);
