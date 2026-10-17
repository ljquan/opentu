import {
  addSelectedElement,
  createTestingBoard,
  fakeNodeWeakMap,
  IS_BOARD_ALIVE,
  PlaitHistoryBoard,
  RectangleClient,
  Transforms,
  withHistory,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { describe, expect, it } from 'vitest';
import { Freehand, FreehandShape } from '../type';
import { withImageMaskBinding } from '../with-image-mask-binding';
import { findMaskBrushesForImage, buildMaskStrokeCommands } from '../../../utils/ai-mask-brush';
import type { PlaitDrawElement } from '@plait/draw';

function image(id = 'cups', points: Point[] = [[100, 200], [500, 600]]) {
  return { id, type: 'image', url: '/source.png', points } as PlaitDrawElement;
}

function mask(overrides: Partial<Freehand> = {}): Freehand {
  return {
    id: 'mask', type: 'freehand', shape: FreehandShape.mask,
    points: [[180, 360], [220, 400]], strokeWidth: 20,
    ...overrides,
  } as Freehand;
}

function createBoard(children: PlaitElement[]) {
  const board = createTestingBoard([
    withHistory,
    (testingBoard) => {
      testingBoard.getRectangle = (element) => RectangleClient.getRectangleByPoints(element.points || []);
      return testingBoard;
    },
    withImageMaskBinding,
  ], children);
  IS_BOARD_ALIVE.set(board, true);
  fakeNodeWeakMap(board);
  return board;
}

describe('image mask binding', () => {
  it('新蒙版绑定绘制起点所在的图片，重叠时优先当前选中图片', () => {
    const first = image();
    const second = image('other');
    const board = createBoard([first, second]);
    addSelectedElement(board, first);
    Transforms.insertNode(board, mask(), [2]);
    expect(board.children[2].aiMaskTargetId).toBe(first.id);
    expect(findMaskBrushesForImage(board, first)).toHaveLength(1);
    expect(findMaskBrushesForImage(board, second)).toHaveLength(0);
  });

  it('旧蒙版随唯一重叠图片平移并保持原图像素位置', () => {
    const source = image();
    const stroke = mask();
    const before = buildMaskStrokeCommands(source, [stroke], { width: 1254, height: 1254 });
    const board = createBoard([source, stroke]);
    Transforms.setNode(board, { points: [[600, 300], [1000, 700]] }, [0]);
    const movedMask = board.children[1] as Freehand;
    expect(movedMask.points).toEqual([[680, 460], [720, 500]]);
    expect(movedMask.aiMaskTargetId).toBe(source.id);
    expect(buildMaskStrokeCommands(board.children[0] as PlaitDrawElement, [movedMask], {
      width: 1254, height: 1254,
    })).toEqual(before);
  });

  it('图片等比缩放时同步蒙版点和笔刷宽度', () => {
    const board = createBoard([image(), mask({ aiMaskTargetId: 'cups' })]);
    Transforms.setNode(board, { points: [[100, 200], [900, 1000]] }, [0]);
    expect(board.children[1].points).toEqual([[260, 520], [340, 600]]);
    expect(board.children[1].strokeWidth).toBe(40);
  });

  it('持久化后重新加载仍按图片 ID 跟随，连续移动不会漂移', () => {
    const board = createBoard([image(), mask({ aiMaskTargetId: 'cups' })]);
    const restored = createBoard(JSON.parse(JSON.stringify(board.children)));
    for (let x = 101; x <= 110; x++) {
      Transforms.setNode(restored, { points: [[x, 200], [x + 400, 600]] }, [0]);
    }
    expect(restored.children[1].points).toEqual([[190, 360], [230, 400]]);
    expect(restored.children[1].strokeWidth).toBe(20);
  });

  it('在图片外开始的普通蒙版笔迹不绑定图片', () => {
    const board = createBoard([image()]);
    Transforms.insertNode(board, mask({ points: [[0, 0], [180, 360]] }), [1]);
    expect(board.children[1].aiMaskTargetId).toBeUndefined();
  });

  it('粘贴到新图片位置的笔迹重新绑定而不是继续跟随旧图片', () => {
    const board = createBoard([image(), image('copy', [[600, 200], [1000, 600]])]);
    Transforms.insertNode(board, mask({
      aiMaskTargetId: 'cups', points: [[680, 360], [720, 400]],
    }), [2]);
    expect(board.children[2].aiMaskTargetId).toBe('copy');
    Transforms.setNode(board, { points: [[200, 300], [600, 700]] }, [0]);
    expect(board.children[2].points).toEqual([[680, 360], [720, 400]]);
  });

  it('平移与缩放合并为一步撤销，重做不会重复移动', () => {
    const source = image();
    const stroke = mask();
    const board = createBoard([source, stroke]);
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.setNode(board, { points: [[600, 300], [1400, 1100]] }, [0]);
    });
    expect(board.history.undos).toHaveLength(1);
    const moved = structuredClone(board.children);
    board.undo();
    expect(board.children).toEqual([source, stroke]);
    board.redo();
    expect(board.children).toEqual(moved);
  });

  it('图片和蒙版一起多选移动时不重复应用偏移', () => {
    const source = image();
    const stroke = mask({ aiMaskTargetId: source.id });
    const board = createBoard([source, stroke]);
    addSelectedElement(board, source);
    addSelectedElement(board, stroke);
    Transforms.setNode(board, { points: [[200, 300], [600, 700]] }, [0]);
    Transforms.setNode(board, { points: [[280, 460], [320, 500]] }, [1]);
    expect(board.children[1].points).toEqual([[280, 460], [320, 500]]);
  });

  it('绑定笔迹不会因与其他图片重叠而跟错目标', () => {
    const source = image();
    const other = image('other');
    const stroke = mask({ aiMaskTargetId: source.id });
    const board = createBoard([source, other, stroke]);
    Transforms.setNode(board, { points: [[700, 300], [1100, 700]] }, [1]);
    expect(board.children[2]).toEqual(stroke);
  });

  it('历史笔迹与多张图重叠时不猜测归属', () => {
    const stroke = mask();
    const board = createBoard([image(), image('other'), stroke]);
    Transforms.setNode(board, { points: [[700, 300], [1100, 700]] }, [0]);
    expect(board.children[2]).toEqual(stroke);
  });

  it('普通画笔和无关图片不随目标移动', () => {
    const pen = mask({ id: 'pen', shape: FreehandShape.feltTipPen });
    const outside = mask({ id: 'outside', points: [[2000, 2000]] });
    const board = createBoard([image(), pen, outside]);
    Transforms.setNode(board, { points: [[700, 300], [1100, 700]] }, [0]);
    expect(board.children.slice(1)).toEqual([pen, outside]);
  });

  it('删除图片同时删除所属蒙版，撤销可以恢复两者', () => {
    const source = image();
    const stroke = mask({ aiMaskTargetId: source.id });
    const unrelated = mask({ id: 'outside', points: [[2000, 2000]] });
    const board = createBoard([source, stroke, unrelated]);
    PlaitHistoryBoard.withNewBatch(board, () => Transforms.removeNode(board, [0]));
    expect(board.children).toEqual([unrelated]);
    board.undo();
    expect(board.children).toEqual([source, stroke, unrelated]);
    board.redo();
    expect(board.children).toEqual([unrelated]);
  });

  it('改变图片 URL 或画布视口不移动笔迹', () => {
    const stroke = mask({ aiMaskTargetId: 'cups' });
    const board = createBoard([image(), stroke]);
    Transforms.setNode(board, { url: '/replacement.png' }, [0]);
    board.apply({ type: 'set_viewport', properties: {}, newProperties: { zoom: 2 } });
    expect(board.children[1]).toEqual(stroke);
  });
});
