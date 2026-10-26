import { createBoard } from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resizeCanvasImage } from './resize-canvas-image';
import { setCanvasBoard } from './canvas-board-ref';

const mocks = vi.hoisted(() => ({ insert: vi.fn(), associate: vi.fn() }));
vi.mock('./canvas-insertion', () => ({ executeCanvasInsertion: mocks.insert }));
vi.mock('../../plugins/canvas-association', () => ({
  createCanvasAssociationLines: mocks.associate,
}));

const source = {
  id: 'source',
  type: 'image',
  url: 'original.png',
  points: [
    [0, 0],
    [100, 80],
  ],
};
const board = createBoard([source]);
const binding = { board, boardId: 'first' };
const options = {
  image: {
    width: 100,
    height: 80,
    naturalWidth: 100,
    naturalHeight: 80,
  } as HTMLImageElement,
  target: 200,
  algorithm: 'high' as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  board.children = [source];
  setCanvasBoard(board, 'first');
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0)
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,processed'
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCanvasBoard(null);
});

describe('editor local resize guards', () => {
  it.each(['high', 'bilinear', 'nearest'] as const)(
    'downscales original pixels with %s and records the smaller output',
    async (algorithm) => {
      mocks.insert.mockResolvedValue({ success: true, data: { items: [] } });
      const output = await resizeCanvasImage(
        binding,
        source,
        { ...options, target: 50, algorithm },
        vi.fn(),
        new AbortController().signal
      );
      expect(output).toEqual({ width: 50, height: 40 });
      const request = mocks.insert.mock.calls[0][0];
      expect(request.referenceElementIds).toEqual([source.id]);
      expect(request.items[0].metadata.localImageOperation).toMatchObject({
        type: 'resize',
        sourceWidth: 100,
        sourceHeight: 80,
        outputWidth: 50,
        outputHeight: 40,
        algorithm,
      });
      expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
      expect(board.children).toEqual([source]);
    }
  );

  it('refuses a no-op size before encoding or insertion', async () => {
    await expect(
      resizeCanvasImage(
        binding,
        source,
        { ...options, target: 100 },
        vi.fn(),
        new AbortController().signal
      )
    ).rejects.toThrow('目标尺寸与原图一致');
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('refuses to process a removed or replaced original', async () => {
    board.children = [{ ...source, url: 'replacement.png' }];
    await expect(
      resizeCanvasImage(
        binding,
        source,
        options,
        vi.fn(),
        new AbortController().signal
      )
    ).rejects.toThrow('原图已变更');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('cancels before insertion if the editor aborts after encoding', async () => {
    const controller = new AbortController();
    await expect(
      resizeCanvasImage(
        binding,
        source,
        options,
        (stage) => {
          if (stage === 'inserting') controller.abort();
        },
        controller.signal
      )
    ).rejects.toThrow('原图已变更');
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.associate).not.toHaveBeenCalled();
  });

  it('keeps the insertion guard tied to the original while persistence is pending', async () => {
    mocks.insert.mockImplementation(async ({ boardGuard }) => {
      board.children = [];
      expect(boardGuard()).toBe(false);
      return { success: false, error: '原图已删除' };
    });
    await expect(
      resizeCanvasImage(
        binding,
        source,
        options,
        vi.fn(),
        new AbortController().signal
      )
    ).rejects.toThrow('原图已删除');
    expect(mocks.associate).not.toHaveBeenCalled();
  });

  it('does not insert any result after encoding fails', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(() => {
      throw new Error('编码失败');
    });
    await expect(
      resizeCanvasImage(
        binding,
        source,
        options,
        vi.fn(),
        new AbortController().signal
      )
    ).rejects.toThrow('编码失败');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
