import { act, renderHook } from '@testing-library/react';
import { createTestingBoard, withHistory } from '@plait/core';
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  BasicShapes,
  createArrowLineElement,
} from '@plait/draw';
import { describe, expect, it, vi } from 'vitest';
import { setAutoCompleteState } from '../plugins/with-arrow-line-auto-complete-extend';
import {
  AI_INPUT_PREFILL_EVENT,
  CANVAS_IMAGE_EDIT_EVENT,
} from '../services/ai-input-ui-events';
import { useAutoCompleteShapePicker } from './useAutoCompleteShapePicker';

function setup() {
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
    mode: 'arrowLine',
    arrowLineElement: line,
    arrowLineEndPoint: [300, 50],
  });
  const hook = renderHook(() => useAutoCompleteShapePicker(board));
  return { board, line, hook };
}

describe('image connection action menu', () => {
  it('cancel leaves canvas and undo history untouched', () => {
    const { board, hook } = setup();
    act(() => hook.result.current.closePicker());
    expect(board.children).toHaveLength(1);
    expect(board.history.undos).toHaveLength(0);
    expect(hook.result.current.state.visible).toBe(false);
    hook.unmount();
  });
  it('ordinary line commits the preview exactly once and can be undone', async () => {
    const { board, line, hook } = setup();
    await act(async () => hook.result.current.selectGeneration('line'));
    expect(board.children.map((element) => element.id)).toContain(line.id);
    expect(board.history.undos).toHaveLength(1);
    await act(async () => board.undo());
    expect(board.children).toHaveLength(1);
    hook.unmount();
  });
  it('text passes only the source image into the existing input bar', () => {
    const listener = vi.fn();
    window.addEventListener(AI_INPUT_PREFILL_EVENT, listener);
    const { board, hook } = setup();
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
    const { board, hook } = setup();
    act(() => hook.result.current.selectGeneration('edit'));
    expect(listener.mock.calls[0][0].detail.elementId).toBe('source');
    expect(board.history.undos).toHaveLength(0);
    window.removeEventListener(CANVAS_IMAGE_EDIT_EVENT, listener);
    hook.unmount();
  });
});
