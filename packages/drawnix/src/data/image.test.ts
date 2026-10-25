import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_CACHE_TIMEOUT_MS,
  IMAGE_DECODE_TIMEOUT_MS,
  IMAGE_ELEMENT_LOAD_TIMEOUT_MS,
} from '../utils/image-operation-timeout';
import { createBoard, type PlaitBoard } from '@plait/core';

const mocks = vi.hoisted(() => ({
  cacheRemoteUrl: vi.fn(),
  getCachedBlob: vi.fn(),
  getCacheInfo: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
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
    getCacheInfo: mocks.getCacheInfo,
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
    getCachedImageBlobWithThumbnailFallback: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../services/asset-storage-service', () => ({
  assetStorageService: {},
}));

vi.mock('../utils/umami-analytics', () => ({
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

async function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();

  // jsdom Blob lacks arrayBuffer in some Node versions; preserve byte checks.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('insertImageFromUrl', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    mocks.cacheRemoteUrl.mockReset();
    mocks.getCachedBlob.mockReset();
    mocks.getCacheInfo.mockReset();
    mocks.cacheMediaFromBlob.mockReset();
    mocks.insertImage.mockReset();
    mocks.isVirtualMediaUrl.mockReset().mockReturnValue(false);
  });

  it('强制缓存远程图片并要求返回可离线读取的本地地址', async () => {
    const remoteUrl = 'https://cdn.example.com/generated/image.png';
    const localUrl = '/__aitu_cache__/image/insert-123.png';
    mocks.cacheRemoteUrl.mockResolvedValue(localUrl);

    const { insertImageFromUrl } = await import('./image');
    const board = createBoard([]) as PlaitBoard;

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

  it('无 DOM 暂存画板可按明确坐标插入图片节点', async () => {
    const remoteUrl = 'https://cdn.example.com/generated/staged.png';
    const localUrl = '/__aitu_cache__/image/staged.png';
    mocks.cacheRemoteUrl.mockResolvedValue(localUrl);

    const { insertImageFromUrl } = await import('./image');
    const board = createBoard([]) as PlaitBoard;

    await insertImageFromUrl(
      board,
      remoteUrl,
      [10, 20],
      false,
      { width: 320, height: 180 },
      true,
      true,
      true,
      true,
      undefined,
      true
    );

    expect(mocks.insertImage).not.toHaveBeenCalled();
    expect(board.children).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: 'image',
        points: [
          [10, 20],
          [330, 200],
        ],
        url: localUrl,
      }),
    ]);
  });

  it('等待加载时，缓存不可用则不插入空白节点', async () => {
    const remoteUrl = 'https://cdn.example.com/generated/missing.png';
    const localUrl = '/__aitu_cache__/image/missing.png';
    mocks.cacheRemoteUrl.mockResolvedValue(localUrl);
    mocks.isVirtualMediaUrl.mockImplementation((url: string) =>
      url.startsWith('/__aitu_cache__/')
    );
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

  it('缓存图片解码失败时回退到生成接口返回的原始地址', async () => {
    const localUrl = '/__aitu_cache__/image/gemini-result.png';
    const sourceUrl = 'https://cdn.example.com/generated/gemini-result.png';
    mocks.isVirtualMediaUrl.mockImplementation((url: string) =>
      url.startsWith('/__aitu_cache__/')
    );
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['truncated'], { type: 'image/png' })
    );
    mocks.getCacheInfo.mockResolvedValue({
      metadata: { sourceUrl },
    });

    const brokenBlob = new Blob(['truncated'], { type: 'image/png' });
    const repairedBlob = new Blob(['repaired'], { type: 'image/png' });
    mocks.getCachedBlob
      .mockReset()
      .mockResolvedValueOnce(brokenBlob)
      .mockResolvedValueOnce(repairedBlob);
    mocks.cacheMediaFromBlob.mockResolvedValue(localUrl);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      )
    );

    const createObjectURL = vi.fn(() =>
      createObjectURL.mock.calls.length === 1
        ? 'blob:cached-image'
        : 'blob:repaired-image'
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      referrerPolicy = '';
      crossOrigin: string | null = null;
      set src(value: string) {
        queueMicrotask(() => {
          if (value === 'blob:cached-image') this.onerror?.();
          else this.onload?.();
        });
      }
    }
    vi.stubGlobal('Image', FakeImage);

    try {
      const { loadImageElementForCanvas } = await import('./image');
      const image = await loadImageElementForCanvas(localUrl);
      expect(image).toBeInstanceOf(FakeImage);
      expect(mocks.getCacheInfo).toHaveBeenCalledWith(localUrl);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(sourceUrl, {
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'image/*' },
        referrerPolicy: 'no-referrer',
        signal: expect.any(AbortSignal),
      });
      expect(mocks.cacheMediaFromBlob).toHaveBeenCalledExactlyOnceWith(
        localUrl,
        expect.objectContaining({ type: 'image/png', size: 4 }),
        'image',
        { sourceUrl }
      );
      const cachedBytes = await readBlobBytes(mocks.cacheMediaFromBlob.mock.calls[0][1]);
      expect(new Uint8Array(cachedBytes)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      expect(mocks.getCachedBlob).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [
      'HTTP 403',
      new Response(null, { status: 403 }),
      '原图下载失败（HTTP 403）',
    ],
    ['empty body', new Response(null), '原图下载内容为空'],
    ['invalid image', new Response('invalid'), '原图下载完成，但图片解码失败'],
  ])('缓存损坏时报告恢复失败：%s', async (_case, response, message) => {
    const localUrl = '/__aitu_cache__/image/broken.png';
    mocks.isVirtualMediaUrl.mockReturnValue(true);
    mocks.getCachedBlob.mockResolvedValue(new Blob(['broken']));
    mocks.getCacheInfo.mockResolvedValue({
      metadata: { sourceUrl: 'https://cdn.example.com/original.png' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:broken',
      revokeObjectURL,
    });
    class BrokenImage {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', BrokenImage);

    try {
      const { loadImageElementForCanvas } = await import('./image');
      await expect(loadImageElementForCanvas(localUrl)).rejects.toThrow(
        `图片缓存损坏，恢复失败：${message}`
      );
      expect(mocks.cacheMediaFromBlob).not.toHaveBeenCalled();
      expect(mocks.insertImage).not.toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stalled image loading times out without inserting, even after a late load event', async () => {
    const { insertImageFromUrl } = await import('./image');
    vi.useFakeTimers();
    const source = 'https://cdn.example.com/pending.png';
    mocks.cacheRemoteUrl.mockResolvedValue(source);
    const instances: PendingImage[] = [];
    class PendingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      constructor() {
        instances.push(this);
      }
    }
    vi.stubGlobal('Image', PendingImage);
    const promise = insertImageFromUrl(
      { children: [] } as unknown as PlaitBoard,
      source,
      [0, 0],
      false,
      { width: 100, height: 100 },
      true,
      false,
      true,
      true
    );
    const rejected = expect(promise).rejects.toThrow('图片加载超时（5分钟）');
    await vi.advanceTimersByTimeAsync(0);
    const instance = instances[0];
    const lateLoad = instance.onload;
    await vi.advanceTimersByTimeAsync(IMAGE_ELEMENT_LOAD_TIMEOUT_MS);
    await rejected;
    expect(instance.onload).toBeNull();
    expect(instance.onerror).toBeNull();
    expect(instance.src).toBe('');
    lateLoad?.();
    await Promise.resolve();
    expect(mocks.insertImage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retry backoff shares the load deadline and cannot restart after timeout', async () => {
    const { loadHTMLImageElementWithRetry } = await import('./image');
    vi.useFakeTimers();
    const instances: PendingImage[] = [];
    const sources: string[] = [];
    class PendingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        instances.push(this);
      }
      set src(value: string) {
        sources.push(value);
      }
    }
    vi.stubGlobal('Image', PendingImage);
    const promise = loadHTMLImageElementWithRetry(
      'https://cdn.example.com/retry.png'
    );
    const instance = instances[0];
    const rejected = expect(promise).rejects.toThrow('图片加载超时');
    await vi.advanceTimersByTimeAsync(IMAGE_ELEMENT_LOAD_TIMEOUT_MS - 500);
    instance.onerror?.();
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sources).toEqual(['https://cdn.example.com/retry.png', '']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('missing virtual cache without a Service Worker does not restart an exhausted load', async () => {
    const { loadHTMLImageElementWithRetry } = await import('./image');
    vi.useFakeTimers();
    mocks.isVirtualMediaUrl.mockReturnValue(true);
    const createImage = vi.fn();
    vi.stubGlobal('Image', class {
      src = '';
      onload = null;
      onerror = null;
      constructor() { createImage(); }
    });
    const promise = loadHTMLImageElementWithRetry('/__aitu_cache__/image/missing.png');
    const rejected = expect(promise).rejects.toThrow('图片加载超时');
    await vi.advanceTimersByTimeAsync(IMAGE_ELEMENT_LOAD_TIMEOUT_MS);
    await rejected;
    expect(createImage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cache reads have a deadline instead of keeping canvas insertion pending', async () => {
    const { loadImageElementForCanvas } = await import('./image');
    vi.useFakeTimers();
    mocks.isVirtualMediaUrl.mockReturnValue(true);
    mocks.getCachedBlob.mockReturnValue(new Promise(() => undefined));
    const rejected = expect(
      loadImageElementForCanvas('/__aitu_cache__/image/pending.png')
    ).rejects.toThrow('图片缓存读取超时');
    await vi.advanceTimersByTimeAsync(IMAGE_CACHE_TIMEOUT_MS);
    await rejected;
    expect(mocks.insertImage).not.toHaveBeenCalled();
  });

  it('stalled cached image decoding releases the temporary Blob URL', async () => {
    const { loadImageElementForCanvas } = await import('./image');
    vi.useFakeTimers();
    mocks.isVirtualMediaUrl.mockReturnValue(true);
    mocks.getCachedBlob.mockResolvedValue(new Blob(['image']));
    mocks.getCacheInfo.mockResolvedValue({ isCached: true });
    const revoke = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:pending',
      revokeObjectURL: revoke,
    });
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        onload = null;
        onerror = null;
      }
    );
    const rejected = expect(
      loadImageElementForCanvas('/__aitu_cache__/image/decode.png')
    ).rejects.toThrow('图片解码超时');
    await vi.advanceTimersByTimeAsync(IMAGE_DECODE_TIMEOUT_MS);
    await rejected;
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:pending');
  });
});
