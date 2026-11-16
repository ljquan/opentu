import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBoard } from '@plait/core';
import { setCanvasBoard } from '../canvas-operations/canvas-board-ref';
import { decomposeSeedream55 } from './seedream55';
const mocks = vi.hoisted(() => ({ decompose: vi.fn(), insert: vi.fn() }));
vi.mock('./provider', () => ({
  decomposeWithConfiguredImageProvider: mocks.decompose,
  SEEDREAM_55_LAYER_MODEL_ID: 'doubao-seedream-5-5-261028',
}));
vi.mock('./canvas', () => ({ insertLayerDecomposition: mocks.insert }));
const source = { id: 'source', url: '/image.png', type: 'image' };
const board = createBoard([source]);
const binding = { board, boardId: 'board-1' };
const options = () => ({
  maxLayers: 99,
  textRecognition: true,
  signal: new AbortController().signal,
});
beforeEach(() => {
  vi.clearAllMocks();
  board.children = [source];
  setCanvasBoard(board, 'board-1');
  mocks.decompose.mockResolvedValue({
    groupId: 'g',
    layers: Array.from({ length: 99 }, () => ({
      textRecognition: { text: 'x' },
    })),
  });
  mocks.insert.mockResolvedValue({});
});
afterEach(() => setCanvasBoard(null));
it('explicitly invokes native 5.5 once and inserts all 100 artifacts', async () => {
  expect(await decomposeSeedream55(binding, source, options())).toEqual({
    layerCount: 100,
    textLayerCount: 99,
  });
  expect(mocks.decompose).toHaveBeenCalledOnce();
  expect(mocks.decompose).toHaveBeenCalledWith(
    { image: source.url, maxLayers: 99, textRecognition: true },
    expect.objectContaining({ modelId: 'doubao-seedream-5-5-261028' })
  );
  expect(mocks.insert).toHaveBeenCalledOnce();
});
it.each(['switch', 'delete', 'replace', 'cancel'])(
  'does not insert stale results after %s',
  async (action) => {
    const controller = new AbortController();
    mocks.decompose.mockImplementation(async () => {
      if (action === 'switch') setCanvasBoard(board, 'board-2');
      if (action === 'delete') board.children = [];
      if (action === 'replace')
        board.children = [{ ...source, url: '/other.png' }];
      if (action === 'cancel') controller.abort();
      return { layers: [] };
    });
    await expect(
      decomposeSeedream55(binding, source, {
        ...options(),
        signal: controller.signal,
      })
    ).rejects.toThrow('变化');
    expect(mocks.insert).not.toHaveBeenCalled();
  }
);
it('blocks duplicates while pending and never retries unknown failures', async () => {
  let reject!: (error: Error) => void;
  mocks.decompose.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    })
  );
  const first = decomposeSeedream55(binding, source, options());
  const failed = expect(first).rejects.toThrow('network');
  await expect(decomposeSeedream55(binding, source, options())).rejects.toThrow(
    '正在分层'
  );
  reject(new Error('network'));
  await failed;
  expect(mocks.decompose).toHaveBeenCalledOnce();
  expect(mocks.insert).not.toHaveBeenCalled();
});
it('surfaces cache/insertion failure without submitting again', async () => {
  mocks.insert.mockRejectedValue(new Error('cache failed'));
  await expect(decomposeSeedream55(binding, source, options())).rejects.toThrow(
    'cache failed'
  );
  expect(mocks.decompose).toHaveBeenCalledOnce();
});
it('manual recovery never resubmits and still guards the original source', async () => {
  const recover = vi
    .fn()
    .mockResolvedValue({ layers: [{ textRecognition: { text: 'SALE' } }] });
  const recovery = { requestId: 'request-1', recover };
  await expect(
    decomposeSeedream55(binding, source, { ...options(), recovery })
  ).resolves.toEqual({ layerCount: 2, textLayerCount: 1 });
  expect(mocks.decompose).not.toHaveBeenCalled();
  expect(recover).toHaveBeenCalledOnce();
  expect(mocks.insert).toHaveBeenCalledOnce();
  recover.mockImplementation(async () => {
    board.children = [];
    return { layers: [] };
  });
  await expect(
    decomposeSeedream55(binding, source, { ...options(), recovery })
  ).rejects.toThrow('变化');
  expect(mocks.insert).toHaveBeenCalledOnce();
});
