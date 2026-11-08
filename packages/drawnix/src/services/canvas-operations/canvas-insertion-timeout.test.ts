import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RectangleClient, type PlaitBoard } from '@plait/core';
import {
  executeCanvasInsertion,
  type CanvasInsertionParams,
} from './canvas-insertion';
import { cacheRemoteUrl } from '../media-executor/fallback-utils';

const mocks = vi.hoisted(() => ({
  insertImageFromUrl: vi.fn(),
  insertImageNodeAtPoint: vi.fn(),
  insertVideoFromUrl: vi.fn(),
  insertAudioFromUrl: vi.fn(),
  insertCardsToCanvas: vi.fn(),
  parseMarkdownToCards: vi.fn(),
  insertText: vi.fn(),
  insertImage: vi.fn(),
  loadImage: vi.fn(),
  buildImage: vi.fn(),
  canvasBoard: null as PlaitBoard | null,
  binding: null as { board: PlaitBoard; boardId: string } | null,
}));

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    getHitElementByPoint: vi.fn(() => null),
    Transforms: {
      ...actual.Transforms,
      setNode: vi.fn(
        (board: any, patch: Record<string, unknown>, path: number[]) => {
          Object.assign(board.children[path[0]], patch);
        }
      ),
    },
  };
});

vi.mock('@plait/draw', () => ({
  DrawTransforms: {
    insertText: mocks.insertText,
    insertImage: mocks.insertImage,
  },
}));

vi.mock('../../plugins/canvas-association', () => ({
  isCanvasAssociationLine: () => false,
}));

vi.mock('../../data/video', () => ({
  insertVideoFromUrl: mocks.insertVideoFromUrl,
}));

vi.mock('../../data/audio', () => ({
  insertAudioFromUrl: mocks.insertAudioFromUrl,
  resolveAudioCardDimensions: vi.fn(() => ({ width: 340, height: 128 })),
}));

vi.mock('../../utils/insert-cards', () => ({
  insertCardsToCanvas: mocks.insertCardsToCanvas,
}));

vi.mock('../../utils/markdown-to-cards', () => ({
  parseMarkdownToCards: mocks.parseMarkdownToCards,
}));

vi.mock('../../utils/selection-utils', () => ({
  scrollToPointIfNeeded: vi.fn(),
}));

vi.mock('../../utils/canvas-insertion-layout', () => ({
  CANVAS_INSERTION_LAYOUT: {
    DEFAULT_VERTICAL_GAP: 50,
    DEFAULT_HORIZONTAL_GAP: 20,
    DEFAULT_POINT: [100, 100],
    MEDIA_DEFAULT_SIZE: 400,
  },
  createBatchInsertionFlowState: vi.fn(() => ({
    startX: 100,
    startY: 100,
    rowRightLimit: 2000,
    bounds: null,
  })),
  estimateCanvasTextSize: vi.fn(() => ({ width: 200, height: 80 })),
  getBatchInsertionFlowCenter: vi.fn(() => [100, 100]),
  getBottomMostInsertionPoint: vi.fn(() => [100, 100]),
  getInsertionPointFromSavedSelection: vi.fn(() => [100, 100]),
  getViewportAwareCardWidth: vi.fn(() => 320),
  getViewportCanvasMetrics: vi.fn(() => ({
    width: 2000,
    height: 1200,
    zoom: 1,
  })),
  logCanvasInsertionDebug: vi.fn(),
  precalculateGroupedGridLayout: vi.fn((startPoint, items) => ({
    positions: items.map((_: unknown, index: number) => [
      startPoint[0] + index * 400,
      startPoint[1],
    ]),
    bounds: null,
  })),
}));

vi.mock('../../utils/frame-insertion-utils', () => ({
  getSelectedInsertionFrame: vi.fn(() => null),
  insertMediaIntoSelectedFrame: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../../utils/svg-utils', () => ({
  normalizeSvg: vi.fn((value: string) => value),
  parseSvgDimensions: vi.fn(() => ({ width: 100, height: 100 })),
  svgToDataUrl: vi.fn(() => 'data:image/svg+xml,test'),
}));

vi.mock('./canvas-board-ref', () => ({
  getCanvasBoard: vi.fn(() => mocks.canvasBoard),
  getCanvasBoardBinding: vi.fn(() => mocks.binding),
  setCanvasBoard: vi.fn(),
}));

// Regression tests: production insertion, image loading and
// cacheRemoteUrl are real; browser I/O and unrelated board services are simulated.
const io = vi.hoisted(() => ({
  isCached: vi.fn(),
  getCachedBlob: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
  getCachedImageBlobWithThumbnailFallback: vi.fn(),
}));
vi.mock('../unified-cache-service', () => ({ unifiedCacheService: io }));
vi.mock('../asset-storage-service', () => ({ assetStorageService: {} }));
vi.mock('../../utils/umami-analytics', () => ({
  analytics: { track: vi.fn() },
}));
vi.mock('../provider-routing/provider-transport', () => ({
  providerTransport: {},
}));
vi.mock('../../utils/config-indexeddb-writer', () => ({
  configIndexedDBWriter: { saveConfig: vi.fn().mockResolvedValue(undefined) },
}));

const localUrl = '/__aitu_cache__/image/repro.png';
const remoteUrl = 'https://cdn.example.test/generated.png';
const timeoutError = '画布插入超时，可重试插入已有结果';
const images: SimulatedImage[] = [];
let imageDelay = 1;
class SimulatedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 2048;
  height = 2048;
  naturalWidth = 2048;
  naturalHeight = 2048;
  private value = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    images.push(this);
  }
  get src() {
    return this.value;
  }
  set src(value: string) {
    this.value = value;
    clearTimeout(this.timer);
    if (value) this.timer = setTimeout(() => this.onload?.(), imageDelay);
  }
}
function insert(
  board: PlaitBoard,
  urls: string[],
  options: Partial<CanvasInsertionParams> = {}
) {
  return executeCanvasInsertion({
    ...options,
    board,
    startPoint: [0, 0],
    items: urls.map((content) => ({
      type: 'image' as const,
      content,
      dimensions: { width: 400, height: 400 },
      waitForImageLoad: true,
    })),
  });
}
function board() {
  return { children: [] } as unknown as PlaitBoard;
}

describe('image canvas timeout: default compatibility and generated-result recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    images.length = 0;
    mocks.binding = null;
    imageDelay = 1;
    io.cacheMediaFromBlob.mockReset();
    io.isCached.mockReset().mockResolvedValue(false);
    io.getCachedBlob
      .mockReset()
      .mockResolvedValue(new Blob(['image bytes'], { type: 'image/png' }));
    io.getCachedImageBlobWithThumbnailFallback
      .mockReset()
      .mockResolvedValue(null);
    vi.stubGlobal('Image', SimulatedImage);
    const OriginalURL = URL;
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static createObjectURL() {
          return 'blob:diagnostic';
        }
        static revokeObjectURL() {
          return undefined;
        }
      }
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 0)
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              'abort',
              () => reject(options.signal?.reason),
              { once: true }
            );
          })
      )
    );
    mocks.insertImage.mockImplementation(
      (target: PlaitBoard, item: any, point: any) => {
        target.children.push({
          id: `image-${target.children.length}`,
          type: 'image',
          url: item.url,
          points: [point, [point[0] + item.width, point[1] + item.height]],
        } as any);
      }
    );
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('control: five locally cached images insert successfully with fast reads and decoding', async () => {
    const target = board();
    const pending = insert(target, Array(5).fill(localUrl));
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).success).toBe(true);
    expect(target.children).toHaveLength(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('remote download timeout plus a healthy 35s fallback load hits 60s; retry repeats', async () => {
    const cached = cacheRemoteUrl(
      remoteUrl,
      'generated-task',
      'image',
      'png',
      undefined,
      { forceRemoteCache: true, returnLocalCacheUrl: true }
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await cached).toBe(remoteUrl);
    imageDelay = 35_000;
    const target = board();
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = insert(target, [remoteUrl]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toMatchObject({
        success: false,
        error: timeoutError,
      });
      expect(target.children).toHaveLength(0);
      // Outer cancellation is NOT propagated to the image loader.
      const image = images.at(-1)!;
      expect(image.src).toBe(remoteUrl);
      expect(image.onload).toBeTypeOf('function');
      // The image loads at 65s, but the board guard prevents its late insertion.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(image.onload).toBeNull();
      expect(target.children).toHaveLength(0);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('five cached images at 13s each fail together at 60s, while each alone succeeds', async () => {
    io.getCachedBlob.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(new Blob(['bytes'], { type: 'image/png' })),
            2_000
          )
        )
    );
    imageDelay = 11_000;
    const target = board();
    const pending = insert(target, Array(5).fill(localUrl));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({
      success: false,
      error: timeoutError,
    });
    expect(target.children).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(target.children).toHaveLength(0);
    for (let index = 0; index < 5; index++) {
      const single = insert(target, [localUrl]);
      await vi.advanceTimersByTimeAsync(13_000);
      expect((await single).success).toBe(true);
    }
    expect(target.children).toHaveLength(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('one already cached remote image repeatedly times out from serial local cache operations alone', async () => {
    const cachedUrls = new Set([remoteUrl]);
    const validBlob = {
      size: 8,
      type: 'image/png',
      slice: () => ({
        arrayBuffer: async () =>
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            .buffer,
      }),
    } as unknown as Blob;
    const delay = <T>(value: T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(value), 13_000));
    io.isCached.mockImplementation((url: string) => delay(cachedUrls.has(url)));
    io.getCachedBlob.mockImplementation(() => delay(validBlob));
    io.cacheMediaFromBlob.mockImplementation(async (url: string) => {
      await delay(undefined);
      cachedUrls.add(url);
      return url;
    });
    const target = board();
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = insert(target, [remoteUrl]);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await pending).toMatchObject({
        success: false,
        error: timeoutError,
      });
      expect(target.children).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    // All cache stages finish within their 20s budgets. No image network
    // request or decode is ever reached; every retry creates another cache key.
    expect(fetch).not.toHaveBeenCalled();
    expect(images).toHaveLength(0);
    expect(io.cacheMediaFromBlob).toHaveBeenCalledTimes(2);
    expect(io.cacheMediaFromBlob.mock.calls[0][0]).not.toBe(
      io.cacheMediaFromBlob.mock.calls[1][0]
    );
    expect(cachedUrls.size).toBe(3);
  });

  it('a hung local cache read reports the specific 20s error, not the screenshot error', async () => {
    io.getCachedBlob.mockReturnValue(new Promise(() => undefined));
    const target = board();
    const pending = insert(target, [localUrl]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({
      success: false,
      error: '插入失败: 图片缓存读取超时（20秒），可重试插入已有结果',
    });
    expect(target.children).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  const generated = { imageInsertionPolicy: 'generated-result' as const };
  const pngBlob = () =>
    ({
      size: 8,
      type: 'image/png',
      slice: () => ({
        arrayBuffer: async () =>
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            .buffer,
      }),
    } as unknown as Blob);

  function useWorkingCache() {
    const cached = new Set<string>();
    io.isCached.mockImplementation(async (url: string) => cached.has(url));
    io.getCachedBlob.mockResolvedValue(pngBlob());
    io.cacheMediaFromBlob.mockImplementation(async (url: string) => {
      cached.add(url);
      return url;
    });
    return cached;
  }

  it('generated result finishes a 45s original download without aborting/restarting it at 30s', async () => {
    useWorkingCache();
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({ ok: true, blob: async () => pngBlob() } as Response),
            45_000
          );
        })
    );
    const target = board();
    const pending = insert(target, [remoteUrl], generated);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(false);
    expect(target.children).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(15_010);
    expect((await pending).success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(target.children).toHaveLength(1);
    expect((target.children[0] as any).url).toMatch(/^\/__aitu_cache__\//);
  });

  it('generated cached batch keeps its atomic layout when total preparation exceeds 60s', async () => {
    io.getCachedBlob.mockImplementation(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(pngBlob()), 2_000))
    );
    imageDelay = 11_000;
    const target = board();
    const pending = insert(target, Array(5).fill(localUrl), generated);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(target.children).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).success).toBe(true);
    expect(target.children).toHaveLength(5);
    expect(target.children.map((item) => item.points[0])).toEqual([
      [0, 0],
      [400, 0],
      [800, 0],
      [1200, 0],
      [1600, 0],
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('generated result allows serial healthy cache stages exceeding 60s without a network download', async () => {
    const cached = useWorkingCache();
    cached.add(remoteUrl);
    const delay = <T>(value: T) =>
      new Promise<T>((resolve) => setTimeout(() => resolve(value), 13_000));
    io.isCached.mockImplementation((url: string) => delay(cached.has(url)));
    io.getCachedBlob.mockImplementation(() => delay(pngBlob()));
    io.cacheMediaFromBlob.mockImplementation(async (url: string) => {
      await delay(undefined);
      cached.add(url);
      return url;
    });
    const target = board();
    const pending = insert(target, [remoteUrl], generated);
    await vi.advanceTimersByTimeAsync(80_000);
    expect((await pending).success).toBe(true);
    expect(target.children).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves direct Image fallback when a generated original cannot be fetched with CORS', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    imageDelay = 35_000;
    const target = board();
    const pending = insert(target, [remoteUrl], generated);
    await vi.advanceTimersByTimeAsync(35_000);
    expect((await pending).success).toBe(true);
    expect((target.children[0] as any).url).toBe(remoteUrl);
  });

  it('bounds each generated image at 5min, stops late loading and permits a successful retry', async () => {
    imageDelay = 400_000;
    const target = board();
    const pending = insert(target, [remoteUrl, remoteUrl], generated);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await pending).toMatchObject({
      success: false,
      error: expect.stringContaining(timeoutError),
    });
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(images.at(-1)?.src).toBe('');
    expect(images.at(-1)?.onload).toBeNull();
    expect(target.children).toHaveLength(0);

    // A new attempt gets a fresh signal, and completed resources are not deleted.
    const cached = useWorkingCache();
    cached.add(remoteUrl);
    imageDelay = 1;
    const retry = insert(target, [remoteUrl], generated);
    await vi.advanceTimersByTimeAsync(10);
    expect((await retry).success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400_000);
    expect(target.children).toHaveLength(1);
  });

  it('does not commit generated results to a board switched during download', async () => {
    const cached = useWorkingCache();
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({ ok: true, blob: async () => pngBlob() } as Response),
            45_000
          )
        )
    );
    let current = true;
    const target = board();
    const pending = insert(target, [remoteUrl, remoteUrl], {
      ...generated,
      boardGuard: () => current,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    current = false;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await pending).toMatchObject({
      success: false,
      error: expect.stringContaining('画板已切换'),
    });
    expect(target.children).toHaveLength(0);
    expect(cached.size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not extend a genuinely hung local cache read for generated results', async () => {
    io.getCachedBlob.mockReturnValue(new Promise(() => undefined));
    const target = board();
    const pending = insert(target, [localUrl], generated);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({
      success: false,
      error: expect.stringContaining('图片缓存读取超时（20秒）'),
    });
    expect(target.children).toHaveLength(0);
  });
  it('guards manual generated-result insertion when the same Board is reused for another document', async () => {
    const target = board();
    mocks.binding = { board: target, boardId: 'original-board' };
    imageDelay = 10_000;
    const pending = insert(target, [localUrl, localUrl], generated);
    await vi.advanceTimersByTimeAsync(1_000);
    mocks.binding = { board: target, boardId: 'other-board' };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({
      success: false,
      error: expect.stringContaining('画板已切换'),
    });
    expect(target.children).toHaveLength(0);
  });
});
