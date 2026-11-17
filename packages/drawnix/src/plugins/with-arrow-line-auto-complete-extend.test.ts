import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestingBoard, PlaitBoard, withHistory } from '@plait/core';
import { getSelectedDrawElements } from '@plait/draw';
import {
  getAutoCompleteState,
  resetAutoCompleteState,
  withArrowLineAutoCompleteExtend,
} from './with-arrow-line-auto-complete-extend';

vi.mock('@plait/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plait/core')>()),
  toActivePoint: (_board: unknown, x: number, y: number) => [x, y],
  toHostPoint: (_board: unknown, x: number, y: number) => [x, y],
  toViewBoxPoint: (_board: unknown, point: number[]) => point,
}));
vi.mock('@plait/draw', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@plait/draw')>()),
  getSelectedDrawElements: vi.fn(),
  getAutoCompletePoints: () => [
    [50, -16],
    [116, 50],
    [50, 116],
    [-16, 50],
  ],
  drawArrowLine: () =>
    document.createElementNS('http://www.w3.org/2000/svg', 'g'),
}));

const pointer = (x: number, y: number) =>
  new MouseEvent('pointermove', {
    clientX: x,
    clientY: y,
    button: 0,
  }) as PointerEvent;

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
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(host);
  vi.spyOn(PlaitBoard, 'getActiveHost').mockReturnValue(host as any);
  vi.spyOn(PlaitBoard, 'getElementTopHost').mockReturnValue(host as any);
  vi.spyOn(PlaitBoard, 'isReadonly').mockReturnValue(false);
  vi.spyOn(PlaitBoard, 'isPointer').mockReturnValue(true);
  vi.mocked(getSelectedDrawElements).mockReturnValue([source] as any);
  const board = createTestingBoard(
    [withHistory, withArrowLineAutoCompleteExtend],
    [source] as any
  );
  return { board, host };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('image reference menu gestures', () => {
  it.each([
    [124, 50],
    [50, 124],
    [-24, 50],
    [50, -24],
  ])(
    'keeps a clicked port menu open after pointer movement (%s, %s)',
    (x, y) => {
      const { board, host } = setup();
      board.pointerDown(pointer(x, y));
      board.globalPointerUp(pointer(x, y));
      expect(getAutoCompleteState(board).visible).toBe(true);
      // Images are not shape elements: the old hover path closed immediately here.
      board.pointerMove(pointer(x + 10, y + 10));
      board.pointerMove(pointer(400, 300));
      board.pointerLeave(pointer(500, 400));
      vi.advanceTimersByTime(1000);
      expect(getAutoCompleteState(board)).toMatchObject({
        visible: true,
        mode: 'click',
      });
      expect(
        host.querySelector('[data-generation-connection-preview]')
      ).toBeNull();
      expect(board.children).toHaveLength(1);
      expect(board.history.undos).toHaveLength(0);
      resetAutoCompleteState(board);
      expect(getAutoCompleteState(board).visible).toBe(false);
    }
  );

  it('keeps a drag preview until the menu is dismissed without saving it', () => {
    const { board, host } = setup();
    board.pointerDown(pointer(124, 50));
    board.globalPointerMove(pointer(400, 200));
    board.globalPointerUp(pointer(400, 200));
    board.pointerMove(pointer(410, 210));
    vi.advanceTimersByTime(1000);
    expect(getAutoCompleteState(board)).toMatchObject({
      visible: true,
      mode: 'arrowLine',
    });
    expect(
      host.querySelector('[data-generation-connection-preview]')
    ).not.toBeNull();
    expect(board.children).toHaveLength(1);
    resetAutoCompleteState(board);
    expect(
      host.querySelector('[data-generation-connection-preview]')
    ).toBeNull();
    expect(board.history.undos).toHaveLength(0);
  });
});
