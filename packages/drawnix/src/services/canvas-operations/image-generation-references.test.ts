import { createBoard, RectangleClient, type PlaitElement } from '@plait/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareImageGenerationReferences } from './image-generation-references';
const mocks = vi.hoisted(() => ({ cache: vi.fn(), load: vi.fn() }));
vi.mock('../media-executor/fallback-utils', () => ({
  cacheRemoteUrl: mocks.cache,
}));
vi.mock('../../data/image', () => ({ loadImageElementForCanvas: mocks.load }));

const source = () => ({
  id: 'source',
  type: 'image',
  url: '/__aitu_cache__/image/source.png',
  points: [
    [0, 0],
    [200, 400],
  ],
});
function board(elements: PlaitElement[] = []) {
  const result = createBoard(elements);
  result.getRectangle = (element) =>
    RectangleClient.getRectangleByPoints(element.points || []);
  return result;
}
function options(current = board()) {
  return {
    board: current,
    boardId: 'board-1',
    associations: [],
    images: [] as Array<{ url: string; sourceElementId?: string }>,
    emptyPosition: [100, 100] as [number, number],
    boardGuard: () => true,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cache.mockImplementation(
    async (_url, id) => `/__aitu_cache__/image/${id}.png`
  );
  mocks.load.mockResolvedValue({ naturalWidth: 1600, naturalHeight: 800 });
});

describe('generation reference preparation', () => {
  it('reuses actual canvas references without loading or moving them', async () => {
    const original = source();
    const current = board([original]);
    const result = await prepareImageGenerationReferences({
      ...options(current),
      images: [{ url: original.url, sourceElementId: original.id }],
    });
    expect(result.imageSourceIds).toEqual(['source']);
    expect(result.references[0]).toMatchObject({
      boardId: 'board-1',
      elementId: 'source',
      kind: 'image',
    });
    expect(current.children).toEqual([original]);
    expect(mocks.cache).not.toHaveBeenCalled();
  });

  it('materializes missing references at send time and reuses them after persistence', async () => {
    const current = board();
    const input = {
      ...options(current),
      images: [{ url: 'data:image/png;base64,bG9jYWw=' }],
    };
    const first = await prepareImageGenerationReferences(input);
    expect(current.children).toHaveLength(1);
    expect(current.children[0].points).toEqual([
      [100, 100],
      [500, 300],
    ]);
    expect(String(current.children[0].url)).toMatch(/^\/__aitu_cache__\//);
    expect(JSON.stringify(current.children)).not.toContain('base64');
    const restored = board(JSON.parse(JSON.stringify(current.children)));
    const second = await prepareImageGenerationReferences({
      ...input,
      board: restored,
    });
    expect(second.imageSourceIds).toEqual(first.imageSourceIds);
    expect(restored.children).toHaveLength(1);
    expect(mocks.cache).toHaveBeenCalledTimes(1);
  });

  it('combines existing and new references and deduplicates a repeated uploaded URL', async () => {
    const original = source();
    const current = board([original]);
    const result = await prepareImageGenerationReferences({
      ...options(current),
      images: [
        { url: original.url },
        { url: '/upload.png' },
        { url: '/upload.png' },
      ],
    });
    expect(current.children).toHaveLength(2);
    expect(result.imageSourceIds).toHaveLength(2);
    expect(result.references).toHaveLength(2);
    expect(current.children[0]).toBe(original);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(current.children[1].points[0]).toEqual([0, 440]);
  });

  it('matches an existing cache image through retry transport parameters', async () => {
    const current = board([source()]);
    const result = await prepareImageGenerationReferences({
      ...options(current),
      images: [{ url: '/__aitu_cache__/image/source.png?bypass_sw=1' }],
    });
    expect(result.imageSourceIds).toEqual(['source']);
    expect(mocks.cache).not.toHaveBeenCalled();
  });

  it('does not insert any partial references when a later image fails to decode', async () => {
    const current = board();
    mocks.load
      .mockResolvedValueOnce({ width: 100, height: 100 })
      .mockRejectedValueOnce(new Error('decode failed'));
    await expect(
      prepareImageGenerationReferences({
        ...options(current),
        images: [{ url: '/a.png' }, { url: '/b.png' }],
      })
    ).rejects.toThrow('decode failed');
    expect(current.children).toEqual([]);
  });

  it('aborts when the board changes during cache loading', async () => {
    const current = board();
    let active = true;
    mocks.cache.mockImplementation(async () => {
      active = false;
      return '/__aitu_cache__/image/a.png';
    });
    await expect(
      prepareImageGenerationReferences({
        ...options(current),
        images: [{ url: '/a.png' }],
        boardGuard: () => active,
      })
    ).rejects.toThrow('画板已切换');
    expect(current.children).toEqual([]);
  });

  it('rejects an unavailable selected source rather than recreating it from an old URL', async () => {
    await expect(
      prepareImageGenerationReferences({
        ...options(),
        images: [{ url: '/a.png', sourceElementId: 'deleted' }],
      })
    ).rejects.toThrow('参考图已从画布删除');
    expect(mocks.cache).not.toHaveBeenCalled();
  });

  it('does not write uploaded sources when a used canvas source is deleted during preparation', async () => {
    const original = source();
    const current = board([original]);
    mocks.load.mockImplementationOnce(async () => {
      current.children = [];
      return { width: 100, height: 100 };
    });
    await expect(
      prepareImageGenerationReferences({
        ...options(current),
        images: [{ url: original.url }, { url: '/upload.png' }],
      })
    ).rejects.toThrow('参考图在准备过程中已变化');
    expect(current.children).toEqual([]);
  });

  it('rejects a cross-board explicit association without writing sources', async () => {
    const current = board([source()]);
    await expect(
      prepareImageGenerationReferences({
        ...options(current),
        associations: [
          {
            referenceId: 'r',
            boardId: 'another',
            elementId: 'source',
            kind: 'image',
            label: '参考图',
          },
        ],
      })
    ).rejects.toThrow('引用来源已变化');
    expect(current.children).toHaveLength(1);
  });

  it('rejects cache failure and invalid dimensions without inserting source nodes', async () => {
    const current = board();
    mocks.cache.mockResolvedValueOnce('https://example.invalid/image.png');
    await expect(
      prepareImageGenerationReferences({
        ...options(current),
        images: [{ url: '/a.png' }],
      })
    ).rejects.toThrow('未能保存');
    mocks.load.mockResolvedValueOnce({ width: 0, height: 0 });
    await expect(
      prepareImageGenerationReferences({
        ...options(current),
        images: [{ url: '/a.png' }],
      })
    ).rejects.toThrow('尺寸无效');
    expect(current.children).toEqual([]);
  });
});
