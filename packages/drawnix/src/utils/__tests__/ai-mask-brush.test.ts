import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMaskStrokeCommands,
  exportImageMaskFromBrushes,
  fitMaskSizeToMaxPixels,
  findMaskBrushesForImage,
  MAX_AI_MASK_BYTES,
  MAX_AI_MASK_PIXELS,
} from '../ai-mask-brush';
import { FreehandShape } from '../../plugins/freehand/type';

const mocks = vi.hoisted(() => ({
  cacheMediaFromBlob: vi.fn(async (url: string) => url),
  getCachedBlob: vi.fn(),
  getImageNaturalSize: vi.fn(),
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
    getCachedBlob: mocks.getCachedBlob,
  },
}));

vi.mock('../image-natural-size', () => ({
  getImageNaturalSize: mocks.getImageNaturalSize,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function createMockCanvas(blobSize = 128) {
  const compositeOperations: GlobalCompositeOperation[] = [];
  const clearRects: Array<[number, number, number, number]> = [];
  const context = {
    clearRect: vi.fn((x: number, y: number, width: number, height: number) => {
      clearRects.push([x, y, width, height]);
    }),
    fillRect: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    restore: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    set fillStyle(_value: string) {},
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      compositeOperations.push(value);
    },
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array(blobSize)], { type: 'image/png' }));
    }),
  } as unknown as HTMLCanvasElement;

  return { canvas, context, compositeOperations, clearRects };
}

function imageElement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'image-1',
    type: 'image',
    url: 'https://example.com/source.png',
    angle: 0,
    points: [
      [10, 20],
      [110, 70],
    ],
    ...overrides,
  } as any;
}

function maskElement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mask-1',
    type: 'freehand',
    shape: FreehandShape.mask,
    points: [
      [20, 30],
      [60, 50],
    ],
    strokeWidth: 10,
    ...overrides,
  } as any;
}

describe('ai-mask-brush', () => {
  it('画布显示 400px 时按原始缓存的 1254px 导出并缩放左侧笔迹', async () => {
    const blob = new Blob(['source'], { type: 'image/png' });
    mocks.getCachedBlob.mockResolvedValueOnce(blob);
    mocks.getImageNaturalSize.mockResolvedValueOnce({ width: 1254, height: 1254 });
    const createObjectURL = vi.fn(() => 'blob:original-source');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const { canvas } = createMockCanvas();
    const strokes: Array<{ points: unknown[]; strokeWidth: number }> = [];

    await exportImageMaskFromBrushes({
      imageElement: imageElement({
        url: '/__aitu_cache__/image/source.png', width: 400, height: 400,
        points: [[100, 200], [500, 600]],
      }),
      maskElements: [maskElement({ points: [[180, 360]], strokeWidth: 40 })],
      createCanvas: (width, height) => Object.assign(canvas, { width, height }),
      onDrawStroke: (command) => strokes.push(command),
    });

    expect(mocks.getCachedBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/source.png', { allowNetwork: false }
    );
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(mocks.getImageNaturalSize).toHaveBeenCalledWith('blob:original-source', 0, 0);
    expect([canvas.width, canvas.height]).toEqual([1254, 1254]);
    expect(strokes[0].points).toEqual([[250.8, 501.6]]);
    expect(strokes[0].strokeWidth).toBeCloseTo(125.4);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:original-source');
  });

  it('远程原图的像素尺寸也优先于画布尺寸', async () => {
    mocks.getImageNaturalSize.mockResolvedValueOnce({ width: 1254, height: 1254 });
    const { canvas } = createMockCanvas();
    await exportImageMaskFromBrushes({
      imageElement: imageElement({ width: 400, height: 400 }),
      maskElements: [maskElement()],
      createCanvas: (width, height) => Object.assign(canvas, { width, height }),
    });
    expect(mocks.getImageNaturalSize).toHaveBeenCalledWith('https://example.com/source.png', 0, 0);
    expect([canvas.width, canvas.height]).toEqual([1254, 1254]);
  });

  it('原图无法解码时不回退到画布尺寸，且释放临时 URL', async () => {
    mocks.getCachedBlob.mockResolvedValueOnce(new Blob(['broken']));
    mocks.getImageNaturalSize.mockResolvedValueOnce({ width: 0, height: 0 });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:broken', revokeObjectURL });
    await expect(exportImageMaskFromBrushes({
      imageElement: imageElement({ url: '/__aitu_cache__/image/broken.png', width: 400, height: 400 }),
      maskElements: [maskElement()],
    })).rejects.toThrow('像素尺寸');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:broken');
    expect(mocks.cacheMediaFromBlob).not.toHaveBeenCalled();
  });

  it('原图缓存丢失时阻止导出', async () => {
    mocks.getCachedBlob.mockResolvedValueOnce(null);
    await expect(exportImageMaskFromBrushes({
      imageElement: imageElement({ url: '/__aitu_cache__/image/missing.png', width: 400, height: 400 }),
      maskElements: [maskElement()],
    })).rejects.toThrow('缓存已失效');
    expect(mocks.cacheMediaFromBlob).not.toHaveBeenCalled();
  });

  it('按图片自然尺寸缩放蒙版笔迹坐标和线宽', () => {
    const commands = buildMaskStrokeCommands(
      imageElement(),
      [maskElement()],
      { width: 200, height: 100 }
    );

    expect(commands).toHaveLength(1);
    expect(commands[0].points).toEqual([
      [20, 20],
      [100, 60],
    ]);
    expect(commands[0].strokeWidth).toBe(20);
  });

  it('只查找与图片矩形相交的蒙版笔迹', () => {
    const image = imageElement();
    const overlapping = maskElement({ id: 'mask-overlap' });
    const outside = maskElement({
      id: 'mask-outside',
      points: [
        [300, 300],
        [320, 320],
      ],
    });
    const normalPen = maskElement({
      id: 'pen',
      shape: FreehandShape.feltTipPen,
    });
    const board = {
      children: [image, overlapping, outside, normalPen],
    };

    expect(findMaskBrushesForImage(board as any, image)).toEqual([overlapping]);
  });

  it('导出 PNG 后缓存为稳定 URL', async () => {
    const { canvas, clearRects } = createMockCanvas();
    const strokes: Array<{ points: unknown[]; strokeWidth: number }> = [];

    const url = await exportImageMaskFromBrushes({
      imageElement: imageElement(),
      maskElements: [maskElement()],
      naturalSize: { width: 200, height: 100 },
      cacheId: 'test-mask',
      createCanvas: (width, height) => {
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      onDrawStroke: (command) => strokes.push(command),
    });

    expect(url).toBe('/__aitu_cache__/image/test-mask.png');
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(clearRects).toEqual(
      expect.arrayContaining([
        [0, 0, 200, 2],
        [198, 0, 2, 100],
        [0, 98, 200, 2],
        [0, 0, 2, 100],
      ])
    );
    expect(strokes[0]).toMatchObject({
      points: [
        [20, 20],
        [100, 60],
      ],
      strokeWidth: 20,
    });
    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/test-mask.png',
      expect.any(Blob),
      'image',
      expect.objectContaining({
        metadata: expect.objectContaining({ source: 'ai-mask-brush' }),
      })
    );
  });

  it('反选时把蒙版笔迹作为不透明区域绘制', async () => {
    const { canvas, compositeOperations, clearRects } = createMockCanvas();

    const url = await exportImageMaskFromBrushes({
      imageElement: imageElement(),
      maskElements: [maskElement()],
      naturalSize: { width: 200, height: 100 },
      cacheId: 'test-mask-invert',
      invert: true,
      createCanvas: (width, height) => {
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
    });

    expect(url).toBe('/__aitu_cache__/image/test-mask-invert.png');
    expect(compositeOperations).toContain('source-over');
    expect(clearRects).toEqual([[0, 0, 200, 100]]);
    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/test-mask-invert.png',
      expect.any(Blob),
      'image',
      expect.objectContaining({
        metadata: expect.objectContaining({ invert: true }),
      })
    );
  });

  it('空蒙版不导出', async () => {
    await expect(
      exportImageMaskFromBrushes({
        imageElement: imageElement(),
        maskElements: [],
        naturalSize: { width: 200, height: 100 },
      })
    ).resolves.toBeUndefined();
  });

  it('图片像素超限时阻止生成', async () => {
    const { canvas } = createMockCanvas();
    const strokes: Array<{ points: unknown[]; strokeWidth: number }> = [];
    let exportInfo:
      | { width: number; height: number; naturalWidth: number; naturalHeight: number; scale: number }
      | undefined;

    const url = await exportImageMaskFromBrushes({
      imageElement: imageElement(),
      maskElements: [maskElement()],
      naturalSize: { width: 6000, height: 3000 },
      cacheId: 'large-landscape-mask',
      createCanvas: (width, height) => {
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      onDrawStroke: (command) => strokes.push(command),
      onExportInfo: (info) => {
        exportInfo = info;
      },
    });

    expect(url).toBe('/__aitu_cache__/image/large-landscape-mask.png');
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(MAX_AI_MASK_PIXELS);
    expect(canvas.width).toBeLessThan(6000);
    expect(canvas.height).toBeLessThan(3000);
    expect(strokes[0]).toMatchObject({
      points: [
        [canvas.width * 0.1, canvas.height * 0.2],
        [canvas.width * 0.5, canvas.height * 0.6],
      ],
      strokeWidth: canvas.width / 10,
    });
    expect(exportInfo).toMatchObject({
      width: canvas.width,
      height: canvas.height,
      naturalWidth: 6000,
      naturalHeight: 3000,
    });
  });

  it('PNG 体积超限时继续降采样重绘', async () => {
    const blobSizes = [
      MAX_AI_MASK_BYTES + 1024,
      MAX_AI_MASK_BYTES - 1024,
    ];
    const createdSizes: Array<{ width: number; height: number }> = [];

    await exportImageMaskFromBrushes({
      imageElement: imageElement(),
      maskElements: [maskElement()],
      naturalSize: { width: 2000, height: 1000 },
      cacheId: 'byte-resized-mask',
      createCanvas: (width, height) => {
        createdSizes.push({ width, height });
        return createMockCanvas(blobSizes.shift() || 128).canvas;
      },
    });

    expect(createdSizes).toHaveLength(2);
    expect(createdSizes[1].width).toBeLessThan(createdSizes[0].width);
    expect(createdSizes[1].height).toBeLessThan(createdSizes[0].height);
  });

  it('计算大图蒙版降采样尺寸', () => {
    const fitted = fitMaskSizeToMaxPixels({ width: 7680, height: 4320 });

    expect(fitted.width * fitted.height).toBeLessThanOrEqual(MAX_AI_MASK_PIXELS);
    expect(fitted.scale).toBeLessThan(1);
  });
});
