import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard } from '@plait/core';
import { setCanvasBoard } from './canvas-board-ref';
import { insertSplitImages } from './insert-split-images';
const mocks = vi.hoisted(() => ({ insert: vi.fn(), associate: vi.fn() }));
vi.mock('./canvas-insertion', () => ({ executeCanvasInsertion: mocks.insert }));
vi.mock('../../plugins/canvas-association', () => ({
  createCanvasAssociationLines: mocks.associate,
}));
const source = {
  id: 'source',
  type: 'image',
  url: 'source.png',
  points: [
    [0, 0],
    [100, 80],
  ],
};
const board = createBoard([source]);
const binding = { board, boardId: 'first' };
beforeEach(() => {
  vi.clearAllMocks();
  board.children = [source];
  setCanvasBoard(board, 'first');
  mocks.insert.mockResolvedValue({
    success: true,
    data: { items: [{ elementId: 'a' }, { elementId: 'b' }] },
  });
});
afterEach(() => setCanvasBoard(null));
describe('editor split insertion', () => {
  it('inserts the complete batch, associates results and retains the source', async () => {
    await insertSplitImages(binding, source, ['a.png', 'b.png']);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        board,
        referenceElementIds: [source.id],
        items: [
          { type: 'image', content: 'a.png', waitForImageLoad: true },
          { type: 'image', content: 'b.png', waitForImageLoad: true },
        ],
      })
    );
    expect(mocks.associate).toHaveBeenCalledTimes(2);
    expect(board.children).toEqual([source]);
  });
  it('refuses insertion after switching boards', async () => {
    setCanvasBoard(board, 'second');
    await expect(insertSplitImages(binding, source, ['a.png'])).rejects.toThrow(
      '画布或原图已变更'
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('guards pending insertion against board switches and skips associations', async () => {
    mocks.insert.mockImplementation(async ({ boardGuard }) => {
      setCanvasBoard(board, 'second');
      expect(boardGuard()).toBe(false);
      return { success: false, error: '画布已切换' };
    });
    await expect(insertSplitImages(binding, source, ['a.png'])).rejects.toThrow(
      '画布已切换'
    );
    expect(mocks.associate).not.toHaveBeenCalled();
  });
  it('refuses to split a removed or replaced original image', async () => {
    board.children = [{ ...source, url: 'replacement.png' }];
    await expect(insertSplitImages(binding, source, ['a.png'])).rejects.toThrow(
      '画布或原图已变更'
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
