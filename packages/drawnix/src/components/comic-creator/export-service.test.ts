import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComicRecord } from './types';
import {
  buildComicExportFiles,
  buildComicExportManifest,
  buildComicPageImageFilename,
  calculateContainRect,
  exportComicAsPdf,
  exportComicAsPptx,
  exportComicAsZip,
  resolveComicImageExtension,
  resolveComicImageSources,
  sanitizeComicFilenamePart,
} from './export-service';

const mockState = vi.hoisted(() => ({
  downloads: [] as Array<{ blob: Blob; filename: string }>,
  zipInstances: [] as Array<{
    files: Array<{ path: string; data: Blob | string }>;
    generateAsync: ReturnType<typeof vi.fn>;
  }>,
  pptxInstances: [] as Array<{
    layout?: string;
    defineLayout: ReturnType<typeof vi.fn>;
    addSlide: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    slides: Array<{
      addText: ReturnType<typeof vi.fn>;
      addImage: ReturnType<typeof vi.fn>;
    }>;
  }>,
  pdfInstances: [] as Array<{
    options: Record<string, unknown> | undefined;
    addPage: ReturnType<typeof vi.fn>;
    addImage: ReturnType<typeof vi.fn>;
    text: ReturnType<typeof vi.fn>;
    output: ReturnType<typeof vi.fn>;
  }>,
  batchCalls: [] as Array<{ count: number; concurrency?: number }>,
}));

vi.mock('@aitu/utils', () => ({
  downloadFromBlob: vi.fn((blob: Blob, filename: string) => {
    mockState.downloads.push({ blob, filename });
  }),
  getFileExtension: vi.fn((url: string, mimeType?: string) => {
    if (mimeType?.includes('jpeg')) {
      return 'jpg';
    }
    const cleanUrl = url.split('?')[0];
    return cleanUrl.split('.').pop() || 'png';
  }),
  normalizeImageDataUrl: vi.fn((value: string) => value),
  processBatchWithConcurrency: vi.fn(
    async <T, R>(
      items: T[],
      handler: (item: T, index: number) => Promise<R>,
      concurrency?: number
    ) => {
      mockState.batchCalls.push({ count: items.length, concurrency });
      const results: R[] = [];
      for (let index = 0; index < items.length; index += 1) {
        results.push(await handler(items[index], index));
      }
      return results;
    }
  ),
}));

vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(() => {
    const instance = {
      files: [] as Array<{ path: string; data: Blob | string }>,
      file: vi.fn((path: string, data: Blob | string) => {
        instance.files.push({ path, data });
      }),
      generateAsync: vi.fn(async () => new Blob(['zip'])),
    };
    mockState.zipInstances.push(instance);
    return instance;
  }),
}));

vi.mock('pptxgenjs', () => ({
  default: vi.fn().mockImplementation(() => {
    const instance = {
      layout: undefined as string | undefined,
      defineLayout: vi.fn(),
      slides: [] as Array<{
        addText: ReturnType<typeof vi.fn>;
        addImage: ReturnType<typeof vi.fn>;
      }>,
      addSlide: vi.fn(() => {
        const slide = {
          addText: vi.fn(),
          addImage: vi.fn(),
        };
        instance.slides.push(slide);
        return slide;
      }),
      write: vi.fn(async () => new Blob(['pptx'])),
    };
    mockState.pptxInstances.push(instance);
    return instance;
  }),
}));

vi.mock('jspdf', () => ({
  default: vi.fn().mockImplementation((options?: Record<string, unknown>) => {
    const instance = {
      options,
      text: vi.fn(),
      addPage: vi.fn(),
      addImage: vi.fn(),
      output: vi.fn(() => new Blob(['pdf'])),
    };
    mockState.pdfInstances.push(instance);
    return instance;
  }),
}));

const record: ComicRecord = {
  id: 'comic-1',
  starred: false,
  title: '水滴:旅行/第一话',
  sourcePrompt: '节水故事',
  commonPrompt: '统一水滴角色',
  pageCount: 2,
  createdAt: 1,
  updatedAt: 2,
  pages: [
    {
      id: 'page-01',
      pageNumber: 1,
      title: '出发?',
      script: '水滴醒来',
      prompt: '清晨水滴',
      imageUrl: 'https://cdn.example.com/page-01.png',
      imageMimeType: 'image/png',
    },
    {
      id: 'page-02',
      pageNumber: 2,
      title: '云上',
      script: '飞到云里',
      prompt: '云层',
      imageUrl: 'https://cdn.example.com/page-02.jpg',
      imageMimeType: 'image/jpeg',
    },
  ],
};

function mockFetchImages() {
  const calls: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(new Blob(['image'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  }) as unknown as typeof fetch;
  return calls;
}

describe('comic export service pure helpers', () => {
  beforeEach(() => {
    mockState.downloads.length = 0;
    mockState.zipInstances.length = 0;
    mockState.pptxInstances.length = 0;
    mockState.pdfInstances.length = 0;
    mockState.batchCalls.length = 0;
    vi.clearAllMocks();
  });

  it('sanitizes manifest and file names', () => {
    expect(sanitizeComicFilenamePart(' 水滴:旅行/第一话 ')).toBe(
      '水滴-旅行-第一话'
    );
    expect(
      buildComicPageImageFilename({
        pageNumber: 1,
        title: '出发?',
        extension: 'jpg',
      })
    ).toBe('images/page-01 出发.jpg');
    expect(
      buildComicPageImageFilename({
        pageNumber: 1,
        title: ' | 出发?',
        extension: 'jpg',
        variantNumber: 1,
      })
    ).toBe('images/page-01 出发-1.jpg');
    expect(resolveComicImageExtension({ mimeType: 'image/jpeg' })).toBe('jpg');
    expect(
      resolveComicImageExtension({ url: 'https://example.com/a.webp?x=1' })
    ).toBe('webp');
  });

  it('builds manifest without embedding base64 image data', () => {
    const recordWithBase64 = {
      ...record,
      pages: [
        {
          ...record.pages[0],
          imageUrl: 'data:image/png;base64,should-not-export',
        },
        record.pages[1],
      ],
    };
    const manifest = buildComicExportManifest(recordWithBase64, {
      now: new Date('2026-04-30T00:00:00.000Z'),
      imageSources: [
        {
          pageId: 'page-01',
          url: 'data:image/png;base64,abc',
          mimeType: 'image/png',
        },
      ],
    });

    expect(manifest.exportedAt).toBe('2026-04-30T00:00:00.000Z');
    expect(manifest.pages[0].imageFilename).toBe('images/page-01 出发.png');
    expect(JSON.stringify(manifest)).not.toContain('base64');
    expect(JSON.stringify(manifest)).not.toContain('should-not-export');
  });

  it('builds export file payloads with markdown and manifest json', () => {
    const files = buildComicExportFiles(record, {
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    expect(files.baseName).toBe('水滴-旅行-第一话');
    expect(files.manifestJson).toContain('"pageCount": 2');
    expect(files.markdown).toContain('## 分页脚本');
    expect(files.markdown).toContain('### 第 2 页：云上');
  });

  it('uses record page imageUrl as default export sources', async () => {
    expect(resolveComicImageSources(record)).toEqual([
      {
        pageId: 'page-01',
        pageNumber: 1,
        url: 'https://cdn.example.com/page-01.png',
        mimeType: 'image/png',
      },
      {
        pageId: 'page-02',
        pageNumber: 2,
        url: 'https://cdn.example.com/page-02.jpg',
        mimeType: 'image/jpeg',
      },
    ]);

    const fetchCalls = mockFetchImages();
    await exportComicAsZip(record);

    expect(fetchCalls).toEqual([
      'https://cdn.example.com/page-01.png',
      'https://cdn.example.com/page-02.jpg',
    ]);
    expect(mockState.batchCalls).toEqual([{ count: 2, concurrency: 1 }]);
    expect(mockState.zipInstances[0].files.map((file) => file.path)).toEqual([
      'manifest.json',
      'script.md',
      'images/page-01 出发.png',
      'images/page-02 云上.jpg',
    ]);
    expect(mockState.downloads[0].filename).toBe('水滴-旅行-第一话.zip');
  });

  it('exports every zip image source and numbers unselected variants', async () => {
    const fetchCalls = mockFetchImages();
    await exportComicAsZip(record, {
      imageSources: [
        {
          pageId: 'page-01',
          url: '/page-01-selected.png',
          mimeType: 'image/png',
        },
        {
          pageId: 'page-01',
          url: '/page-01-alt.webp',
          mimeType: 'image/webp',
          variantNumber: 1,
        },
        {
          pageId: 'page-01',
          url: '/page-01-alt-2.jpg',
          mimeType: 'image/jpeg',
          variantNumber: 2,
        },
        {
          pageId: 'page-02',
          url: '/page-02-selected.jpg',
          mimeType: 'image/jpeg',
        },
        {
          pageId: 'page-02',
          url: '/page-02-alt.png',
          mimeType: 'image/png',
          variantNumber: 1,
        },
      ],
    });

    expect(fetchCalls).toEqual([
      '/page-01-selected.png',
      '/page-01-alt.webp',
      '/page-01-alt-2.jpg',
      '/page-02-selected.jpg',
      '/page-02-alt.png',
    ]);
    expect(mockState.batchCalls).toEqual([{ count: 5, concurrency: 1 }]);
    expect(mockState.zipInstances[0].files.map((file) => file.path)).toEqual([
      'manifest.json',
      'script.md',
      'images/page-01 出发.png',
      'images/page-01 出发-1.webp',
      'images/page-01 出发-2.jpg',
      'images/page-02 云上.jpg',
      'images/page-02 云上-1.png',
    ]);
  });

  it('calculates contain rectangles without stretching', () => {
    expect(
      calculateContainRect({ width: 10, height: 10 }, { width: 16, height: 9 })
    ).toEqual({
      x: 0,
      y: 2.1875,
      width: 10,
      height: 5.625,
    });
    expect(
      calculateContainRect({ width: 10, height: 5 }, { width: 1, height: 1 })
    ).toEqual({
      x: 2.5,
      y: 0,
      width: 5,
      height: 5,
    });
  });

  it('exports PPTX as one image-only slide per page using source aspect ratio', async () => {
    mockFetchImages();

    await exportComicAsPptx(record, {
      filename: '连环画 输出',
      imageSources: [
        {
          pageId: 'page-01',
          url: '/one.png',
          mimeType: 'image/png',
          width: 900,
          height: 1600,
        },
        {
          pageId: 'page-02',
          url: '/two.png',
          mimeType: 'image/png',
          width: 1600,
          height: 900,
        },
      ],
    });

    const pptx = mockState.pptxInstances[0];
    expect(pptx.defineLayout).toHaveBeenCalledWith({
      name: 'COMIC_IMAGE_ONLY',
      width: 10,
      height: 10 / (900 / 1600),
    });
    expect(pptx.layout).toBe('COMIC_IMAGE_ONLY');
    expect(pptx.slides).toHaveLength(2);
    expect(pptx.slides[0].addText).not.toHaveBeenCalled();
    expect(pptx.slides[0].addImage).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 0,
        y: 0,
        w: 10,
        h: 10 / (900 / 1600),
      })
    );
    expect(pptx.slides[1].addImage).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 0,
        w: 10,
      })
    );
    expect(mockState.downloads[0].filename).toBe('连环画-输出.pptx');
  });

  it('exports PDF as image-only pages without prefetching all images', async () => {
    const activeFetchCounts: number[] = [];
    let activeFetches = 0;
    global.fetch = vi.fn(async () => {
      activeFetches += 1;
      activeFetchCounts.push(activeFetches);
      await Promise.resolve();
      activeFetches -= 1;
      return new Response(new Blob(['image'], { type: 'image/jpeg' }), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }) as unknown as typeof fetch;

    await exportComicAsPdf(record, {
      imageSources: [
        {
          pageNumber: 1,
          url: '/one.jpg',
          mimeType: 'image/jpeg',
          aspectRatio: '4:3',
        },
        {
          pageNumber: 2,
          url: '/two.jpg',
          mimeType: 'image/jpeg',
          aspectRatio: '1:1',
        },
      ],
    });

    const pdf = mockState.pdfInstances[0];
    expect(pdf.options).toMatchObject({
      unit: 'mm',
      format: [297, 297 / (4 / 3)],
      orientation: 'landscape',
    });
    expect(pdf.text).not.toHaveBeenCalled();
    expect(pdf.addImage).toHaveBeenCalledTimes(2);
    expect(pdf.addPage).toHaveBeenCalledTimes(1);
    expect(Math.max(...activeFetchCounts)).toBe(1);
    expect(mockState.downloads[0].filename).toBe('水滴-旅行-第一话.pdf');
  });
});
