import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSelectedElement,
  createTestingBoard,
  fakeNodeWeakMap,
  getSelectedElements,
  PlaitBoard,
  PlaitElement,
  RectangleClient,
  withHistory,
  withOptions,
  withSelection,
} from '@plait/core';
import { getSelectedDrawElements, PlaitDrawElement } from '@plait/draw';
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

const pointer = (x: number, y: number, buttons = 0) =>
  new MouseEvent('pointermove', {
    clientX: x,
    clientY: y,
    button: 0,
    buttons,
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
  it.each([false, true])(
    'selects both images in the marquee (initial selection: %s)',
    async (initialSelection) => {
      const container = document.createElement('div');
      const host = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
      );
      Object.defineProperty(host, 'viewBox', {
        value: { baseVal: { x: 0, y: 0 } },
      });
      vi.spyOn(PlaitBoard, 'getHost').mockReturnValue(host);
      vi.spyOn(PlaitBoard, 'getBoardContainer').mockReturnValue(container);
      const makeGroup = () =>
        document.createElementNS('http://www.w3.org/2000/svg', 'g');
      vi.spyOn(PlaitBoard, 'getActiveHost').mockReturnValue(makeGroup());
      vi.spyOn(PlaitBoard, 'getRoughSVG').mockReturnValue({
        rectangle: makeGroup,
      } as ReturnType<typeof PlaitBoard.getRoughSVG>);
      vi.spyOn(PlaitBoard, 'isAlive').mockReturnValue(true);
      vi.spyOn(PlaitElement, 'getElementRef').mockReturnValue(
        {} as ReturnType<typeof PlaitElement.getElementRef>
      );
      vi.mocked(getSelectedDrawElements).mockImplementation((board) =>
        getSelectedElements(board).filter(PlaitDrawElement.isDrawElement)
      );

      const image = (id: string, x: number): PlaitElement => ({
        id,
        type: 'image',
        url: `/${id}.png`,
        points: [
          [x, 20],
          [x + 60, 80],
        ],
      });
      const first = image('first', 20);
      const second = image('second', 120);
      const outside = image('outside', 220);
      const board = createTestingBoard(
        [
          withOptions,
          (board) => {
            board.getRectangle = (element) =>
              element.points
                ? RectangleClient.getRectangleByPoints(element.points)
                : null;
            board.isRectangleHit = (element, { anchor, focus }) => {
              const rectangle = board.getRectangle(element);
              return (
                rectangle !== null &&
                RectangleClient.isHit(
                  rectangle,
                  RectangleClient.getRectangleByPoints([anchor, focus])
                )
              );
            };
            board.drawSelectionRectangle = makeGroup;
            return board;
          },
          withSelection,
          withArrowLineAutoCompleteExtend,
        ],
        [first, second, outside]
      );
      fakeNodeWeakMap(board);
      if (initialSelection) addSelectedElement(board, first);

      board.pointerDown(pointer(5, 5, 1));
      board.pointerMove(pointer(95, 95, 1));
      await vi.advanceTimersByTimeAsync(20);
      expect(getSelectedElements(board)).toEqual([first]);

      board.pointerMove(pointer(195, 95, 1));
      board.pointerUp(pointer(195, 95));
      board.globalPointerUp(pointer(195, 95));
      await vi.advanceTimersByTimeAsync(20);
      expect(
        getSelectedElements(board)
          .map(({ id }) => id)
          .sort()
      ).toEqual(['first', 'second']);
      expect(getAutoCompleteState(board).visible).toBe(false);
    }
  );

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
