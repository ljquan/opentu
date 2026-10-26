import {
  createTestingBoard,
  fakeNodeWeakMap,
  IS_BOARD_ALIVE,
  withHistory,
} from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCanvasGenerationDetailsSource } from './canvas-generation-details-source';
import { resolveCanvasImageDetailsDimensions } from './canvas-image-details-dimensions';
import { setCanvasBoard } from '../services/canvas-operations/canvas-board-ref';

const mocks = vi.hoisted(() => ({ dimensions: vi.fn(), blob: vi.fn() }));
vi.mock('./image-natural-size', () => ({
  getImageNaturalSize: mocks.dimensions,
}));
vi.mock('../services/unified-cache-service', () => ({
  unifiedCacheService: { getCachedBlob: mocks.blob },
}));
vi.mock('../plugins/with-video', () => ({ isVideoElement: () => false }));
vi.mock('../plugins/with-tool', () => ({ isToolElement: () => false }));
const BrowserURL = URL;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dimensions.mockResolvedValue({ width: 2752, height: 1536 });
  mocks.blob.mockResolvedValue(new Blob(['original'], { type: 'image/png' }));
  vi.stubGlobal(
    'URL',
    class extends BrowserURL {
      static createObjectURL = vi.fn(() => 'blob:original');
      static revokeObjectURL = vi.fn();
    }
  );
});
afterEach(() => {
  setCanvasBoard(null);
  vi.unstubAllGlobals();
});

function boardWithImage() {
  const element = {
    id: 'gemini',
    type: 'image',
    url: '/__aitu_cache__/image/result.png',
    points: [
      [10, 20],
      [410, 243],
    ],
  };
  const board = createTestingBoard([withHistory], [element]);
  IS_BOARD_ALIVE.set(board, true);
  fakeNodeWeakMap(board);
  setCanvasBoard(board, 'first');
  const source = getCanvasGenerationDetailsSource(element);
  if (!source) throw new Error('Expected image details source');
  return { board, element, source };
}

describe('original image dimensions in canvas details', () => {
  it('decodes the original cache, persists actual pixels and restores them without changing display size or undo history', async () => {
    const { board, element, source } = boardWithImage();
    const result = await resolveCanvasImageDetailsDimensions(source, board);
    expect(result).toMatchObject({ width: 2752, height: 1536 });
    expect(mocks.blob).toHaveBeenCalledWith(element.url, {
      allowNetwork: false,
    });
    expect(mocks.dimensions).toHaveBeenCalledWith('blob:original', 0, 0);
    const restored = JSON.parse(JSON.stringify(board.children[0]));
    expect(getCanvasGenerationDetailsSource(restored)).toMatchObject({
      width: 2752,
      height: 1536,
    });
    expect(restored.points).toEqual(element.points);
    expect(board.history.undos).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original');
    expect(
      getCanvasGenerationDetailsSource({ ...restored, url: '/replaced.png' })
        ?.width
    ).toBeUndefined();
  });

  it.each([
    'https://images.example.test/result.jpg',
    'data:image/png;base64,iVBORw0KGgo=',
  ])(
    'reads %s without substituting request or display dimensions',
    async (url) => {
      const result = await resolveCanvasImageDetailsDimensions({
        id: 'legacy',
        url,
        kind: 'image',
      });
      expect(result).toMatchObject({ width: 2752, height: 1536 });
      expect(mocks.dimensions).toHaveBeenCalledWith(url, 0, 0);
      expect(mocks.blob).not.toHaveBeenCalled();
    }
  );

  it('leaves missing originals unknown without consulting a thumbnail', async () => {
    mocks.blob.mockResolvedValue(null);
    const { board, source } = boardWithImage();
    expect(await resolveCanvasImageDetailsDimensions(source, board)).toEqual(
      source
    );
    expect(mocks.dimensions).not.toHaveBeenCalled();
    expect(board.children[0].imageNaturalSize).toBeUndefined();
  });

  it.each(['board', 'source', 'cancel'] as const)(
    'does not write stale dimensions after a %s change',
    async (change) => {
      const { board, source } = boardWithImage();
      let active = true;
      mocks.dimensions.mockImplementation(async () => {
        if (change === 'board') setCanvasBoard(board, 'second');
        if (change === 'source')
          board.children = [{ ...board.children[0], url: '/replacement.png' }];
        if (change === 'cancel') active = false;
        return { width: 2752, height: 1536 };
      });
      await resolveCanvasImageDetailsDimensions(source, board, () => active);
      expect(board.children[0].imageNaturalSize).toBeUndefined();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original');
    }
  );

  it('keeps failed decodes unknown and retains trustworthy saved/local dimensions', async () => {
    mocks.dimensions.mockResolvedValue({ width: 0, height: 0 });
    const { board, source } = boardWithImage();
    expect(await resolveCanvasImageDetailsDimensions(source, board)).toEqual(
      source
    );
    expect(board.children[0].imageNaturalSize).toBeUndefined();
    mocks.dimensions.mockClear();
    const saved = { ...source, width: 2560, height: 1440 };
    expect(await resolveCanvasImageDetailsDimensions(saved, board)).toEqual(
      saved
    );
    expect(mocks.dimensions).not.toHaveBeenCalled();
  });
});
