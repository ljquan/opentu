import { describe, expect, it, vi } from 'vitest';
import {
  createTestingBoard,
  RectangleClient,
  type PlaitElement,
  type PlaitPlugin,
  type Point,
} from '@plait/core';
import { getCanvasAssociationPickElements } from './canvas-association-picking';

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    toHostPoint: (_board: unknown, x: number, y: number): Point => [x, y],
    toViewBoxPoint: (_board: unknown, point: Point): Point => point,
  };
});

interface TestElement extends PlaitElement {
  locked?: boolean;
  rectangle: RectangleClient;
}

function createElement(
  id: string,
  rectangle: RectangleClient,
  locked = false
): TestElement {
  return { id, type: 'test', rectangle, locked };
}

function createBoard(elements: TestElement[]) {
  const hit = vi.fn((element: TestElement, point: Point) =>
    RectangleClient.isPointInRectangle(element.rectangle, point)
  );
  const plugin: PlaitPlugin = (board) => {
    board.getRectangle = (element) => (element as TestElement).rectangle;
    board.isHit = (element, point) =>
      element.locked === true ? false : hit(element as TestElement, point);
    return board;
  };
  return {
    board: createTestingBoard([plugin], elements),
    hit,
  };
}

describe('canvas-association-picking', () => {
  it.each(['mouse', 'touch', 'pen'] as const)(
    'pointerup 统一支持 %s 拾取',
    (pointerType) => {
      const element = createElement('element-a', {
        x: 0,
        y: 0,
        width: 40,
        height: 30,
      });
      const { board } = createBoard([element]);

      expect(
        getCanvasAssociationPickElements(board, {
          clientX: 10,
          clientY: 10,
          pointerType,
        })
      ).toEqual([element]);
    }
  );

  it('仅通过只读边界命中锁定元素，不调用常规 isHit', () => {
    const locked = createElement(
      'locked-a',
      { x: 10, y: 10, width: 40, height: 30 },
      true
    );
    const { board, hit } = createBoard([locked]);

    expect(
      getCanvasAssociationPickElements(board, {
        clientX: 20,
        clientY: 20,
        pointerType: 'touch',
      })
    ).toEqual([locked]);
    expect(hit).not.toHaveBeenCalled();
    expect(locked.locked).toBe(true);
  });

  it('未命中或系统连线时返回空结果', () => {
    const element = createElement('element-a', {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    });
    const associationLine = {
      ...createElement(
        'association-line',
        { x: 30, y: 30, width: 20, height: 20 },
        true
      ),
      type: 'arrow-line',
      canvasAssociation: {
        version: 1,
        boardId: 'board-a',
        sourceElementId: 'source-a',
        resultElementId: 'result-a',
      },
    };
    const { board } = createBoard([element, associationLine]);

    expect(
      getCanvasAssociationPickElements(board, {
        clientX: 40,
        clientY: 40,
        pointerType: 'pen',
      })
    ).toEqual([]);
    expect(
      getCanvasAssociationPickElements(board, {
        clientX: 100,
        clientY: 100,
        pointerType: 'mouse',
      })
    ).toEqual([]);
  });
});
