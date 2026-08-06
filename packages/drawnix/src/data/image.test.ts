import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';

const mocks = vi.hoisted(() => ({
  cacheRemoteUrl: vi.fn(),
  getCachedBlob: vi.fn(),
  insertImage: vi.fn(),
  isVirtualMediaUrl: vi.fn(),
}));

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    getHitElementByPoint: vi.fn(() => null),
  };
});

vi.mock('@plait/draw', () => ({
  DrawTransforms: {
    insertImage: mocks.insertImage,
  },
}));

vi.mock('../services/media-executor/fallback-utils', () => ({
  cacheRemoteUrl: mocks.cacheRemoteUrl,
}));

vi.mock('../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
  },
}));

vi.mock('../services/asset-storage-service', () => ({
  assetStorageService: {},
}));

vi.mock('../utils/posthog-analytics', () => ({
  analytics: {
    track: vi.fn(),
  },
}));

vi.mock('../utils/selection-utils', () => ({
  getInsertionPointForSelectedElements: vi.fn(),
  getInsertionPointBelowBottommostElement: vi.fn(() => [0, 0]),
  scrollToPointIfNeeded: vi.fn(),
}));

vi.mock('../utils/canvas-insertion-layout', () => ({
  getInsertionPointFromSavedSelection: vi.fn(() => [0, 0]),
  calculateImageDisplayDimensions: vi.fn(),
}));

vi.mock('../utils/virtual-media-url', () => ({
  isVirtualMediaUrl: mocks.isVirtualMediaUrl,
}));

describe('insertImageFromUrl', () => {
  beforeEach(() => {
    mocks.cacheRemoteUrl.mockReset();
    mocks.getCachedBlob.mockReset();
    mocks.insertImage.mockReset();
    mocks.isVirtualMediaUrl.mockReset().mockReturnValue(false);
  });

  it('强制缓存远程图片并要求返回可离线读取的本地地址', async () => {
    const remoteUrl = 'https://cdn.example.com/generated/image.png';
    const localUrl = '/__aitu_cache__/image/insert-123.png';
    mocks.cacheRemoteUrl.mockResolvedValue(localUrl);

    const { insertImageFromUrl } = await import('./image');
    const board = { children: [] } as unknown as PlaitBoard;

    await insertImageFromUrl(
      board,
      remoteUrl,
      [10, 20],
      false,
      { width: 320, height: 180 },
      true,
      true,
      true,
      true
    );

    expect(mocks.cacheRemoteUrl).toHaveBeenCalledWith(
      remoteUrl,
      expect.stringMatching(
        /^insert-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
      'image',
      'png',
      undefined,
      { forceRemoteCache: true, returnLocalCacheUrl: true }
    );
    expect(mocks.insertImage).toHaveBeenCalledWith(
      board,
      { url: localUrl, width: 320, height: 180 },
      [10, 20]
    );
  });

  it('等待加载时，缓存不可用则不插入空白节点', async () => {
    const remoteUrl = 'https://cdn.example.com/generated/missing.png';
    const localUrl = '/__aitu_cache__/image/missing.png';
    mocks.cacheRemoteUrl.mockResolvedValue(localUrl);
    mocks.isVirtualMediaUrl.mockReturnValue(true);
    mocks.getCachedBlob.mockResolvedValue(null);

    const { insertImageFromUrl } = await import('./image');
    const board = { children: [] } as unknown as PlaitBoard;

    await expect(
      insertImageFromUrl(
        board,
        remoteUrl,
        [10, 20],
        false,
        { width: 320, height: 180 },
        true,
        false,
        true,
        true
      )
    ).rejects.toThrow('图片缓存不可用');
    expect(mocks.insertImage).not.toHaveBeenCalled();
  });
});
