import type { PlaitBoard, PlaitElement } from '@plait/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCanvasAssociationRef,
  findCanvasAssociationElement,
  getCanvasAssociationKind,
  resolveCanvasAssociationsForSubmission,
  validateCanvasAssociationCapability,
} from './canvas-association-resolver';

const {
  cacheLocalMediaByContent,
  convertElementsToImage,
  getCachedBlob,
  getImageDimensionsFromUrl,
} = vi.hoisted(() => ({
  cacheLocalMediaByContent: vi.fn(),
  convertElementsToImage: vi.fn(),
  getCachedBlob: vi.fn(),
  getImageDimensionsFromUrl: vi.fn(),
}));

vi.mock('../../services/unified-cache-service', () => ({
  CACHE_CONSTANTS: { MAX_IMAGE_SIZE: 8 },
  unifiedCacheService: { cacheLocalMediaByContent, getCachedBlob },
}));

vi.mock('@plait/core', async () => {
  const actual = await vi.importActual<typeof import('@plait/core')>(
    '@plait/core'
  );
  return {
    ...actual,
    getRectangleByElements: (_board: PlaitBoard, elements: PlaitElement[]) => {
      const points = elements.flatMap((element) =>
        Array.isArray(element.points) ? element.points : []
      ) as number[][];
      if (points.length === 0) {
        return { x: 0, y: 0, width: 1, height: 1 };
      }
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      };
    },
  };
});

vi.mock('../../utils/selection-utils', () => ({
  convertElementsToImage,
  extractImagesFromElementForAI: async (
    _board: PlaitBoard,
    element: PlaitElement
  ) =>
    (element as { images?: Array<{ url: string }> }).images ||
    ('url' in element ? [{ url: element.url }] : []),
  extractTextFromElement: (element: PlaitElement) =>
    String(
      (element as { text?: string; body?: string }).text ||
        (element as { body?: string }).body ||
        ''
    ),
  getImageDimensionsFromUrl,
  isGraphicsElement: (_board: PlaitBoard, element: PlaitElement) =>
    element.type === 'graphics',
  isImageElement: (_board: PlaitBoard, element: PlaitElement) =>
    element.type === 'image',
  isTextElement: (_board: PlaitBoard, element: PlaitElement) =>
    element.type === 'text',
}));

function createBoard(children: PlaitElement[]): PlaitBoard {
  return { children } as PlaitBoard;
}

function createReference(
  elementId: string,
  kind: 'image' | 'video' | 'audio' | 'text' | 'graphics' = 'image'
) {
  return {
    referenceId: `ref-${elementId}`,
    boardId: 'board-a',
    elementId,
    kind,
    label: elementId,
  };
}

describe('canvas association resolver', () => {
  beforeEach(() => {
    convertElementsToImage
      .mockReset()
      .mockResolvedValue('data:image/png;base64,YWFh');
    getImageDimensionsFromUrl.mockReset().mockResolvedValue({
      width: 320,
      height: 180,
    });
    cacheLocalMediaByContent
      .mockReset()
      .mockImplementation(async (_blob: Blob, type: 'image' | 'audio') => ({
        url:
          type === 'audio'
            ? '/__aitu_generated__/audio/content-reference.mp3'
            : '/__aitu_cache__/image/content-raster.png',
        contentHash: 'content-reference',
        reused: false,
      }));
    getCachedBlob
      .mockReset()
      .mockImplementation(async (url: string) =>
        url.includes('/audio/')
          ? new Blob(['audio'], { type: 'audio/mpeg' })
          : new Blob(['image'], { type: 'image/png' })
      );
  });

  it('finds nested elements and creates a bounded lightweight reference', () => {
    const nested = {
      id: 'nested-text',
      type: 'text',
      text: '  第一行\n第二行  ',
    } as PlaitElement;
    const frame = {
      id: 'frame-1',
      type: 'frame',
      children: [nested],
    } as PlaitElement;
    const board = createBoard([frame]);

    expect(findCanvasAssociationElement(board.children, 'nested-text')).toBe(
      nested
    );
    expect(getCanvasAssociationKind(board, nested)).toBe('text');
    expect(
      createCanvasAssociationRef(board, ' board-a ', nested, 'ref-fixed')
    ).toEqual({
      referenceId: 'ref-fixed',
      boardId: 'board-a',
      elementId: 'nested-text',
      kind: 'text',
      label: '第一行 第二行',
    });
    expect(
      createCanvasAssociationRef(board, 'board-a', {
        id: 'workzone-1',
        type: 'workzone',
      } as PlaitElement)
    ).toBeNull();
  });

  it('finds a deeply nested element without recursive stack growth', () => {
    const root = {
      id: 'depth-0',
      type: 'graphics',
      children: [],
    } as unknown as PlaitElement;
    let current = root as PlaitElement & { children: PlaitElement[] };
    for (let index = 1; index < 350; index += 1) {
      const child = {
        id: `depth-${index}`,
        type: 'graphics',
        children: [],
      } as unknown as PlaitElement;
      current.children = [child];
      current = child as PlaitElement & { children: PlaitElement[] };
    }

    expect(findCanvasAssociationElement([root], 'depth-349')?.id).toBe(
      'depth-349'
    );
  });

  it('treats geometry with embedded text as graphics and rasterizes it', async () => {
    const rectangle = {
      id: 'rectangle-1',
      type: 'geometry',
      shape: 'rectangle',
      text: { children: [{ text: '' }] },
      points: [
        [0, 0],
        [320, 180],
      ],
    } as unknown as PlaitElement;
    const board = createBoard([rectangle]);
    const reference = createCanvasAssociationRef(
      board,
      'board-a',
      rectangle,
      'ref-rectangle'
    );

    expect(getCanvasAssociationKind(board, rectangle)).toBe('graphics');
    expect(reference?.kind).toBe('graphics');
    if (!reference) throw new Error('Expected rectangle reference');

    const result = await resolveCanvasAssociationsForSubmission(
      board,
      'board-a',
      [reference]
    );

    expect(result.errors).toEqual([]);
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'graphics' }),
    ]);
    expect(convertElementsToImage).toHaveBeenCalledWith(board, [rectangle]);
  });

  it('resolves ordinary image and text references after 200 board elements', async () => {
    let childrenReads = 0;
    const boardChildren: PlaitElement[] = Array.from(
      { length: 200 },
      (_, index) =>
        ({
          id: `filler-${index}`,
          type: 'graphics',
        } as PlaitElement)
    );
    boardChildren.push(
      {
        id: 'image-late',
        type: 'image',
        url: 'https://example.com/image-late.png',
      } as PlaitElement,
      {
        id: 'text-late',
        type: 'text',
        text: '第 200 个元素之后的文字',
      } as PlaitElement
    );
    const readChildren = () => {
      childrenReads += 1;
      return undefined;
    };
    for (const element of boardChildren) {
      Object.defineProperty(element, 'children', {
        configurable: true,
        get: readChildren,
      });
    }

    const result = await resolveCanvasAssociationsForSubmission(
      createBoard(boardChildren),
      'board-a',
      [createReference('image-late'), createReference('text-late', 'text')]
    );

    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'image',
        url: 'https://example.com/image-late.png',
      }),
      expect.objectContaining({
        type: 'text',
        text: '第 200 个元素之后的文字',
      }),
    ]);
    expect(result.errors).toEqual([]);
    expect(childrenReads).toBe(201);
  });

  it('resolves image, video, audio, text and raster content without changing source order', async () => {
    const board = createBoard([
      {
        id: 'image-1',
        type: 'image',
        url: 'https://example.com/image.png',
      } as PlaitElement,
      {
        id: 'video-1',
        type: 'video',
        url: 'https://example.com/video.mp4',
        width: 1280,
        height: 720,
      } as PlaitElement,
      {
        id: 'audio-1',
        type: 'audio',
        audioUrl: 'https://example.com/audio.mp3',
      } as PlaitElement,
      { id: 'text-1', type: 'text', text: '画布文字' } as PlaitElement,
      {
        id: 'shape-1',
        type: 'graphics',
        points: [
          [0, 0],
          [320, 180],
        ],
      } as PlaitElement,
    ]);

    const result = await resolveCanvasAssociationsForSubmission(
      board,
      'board-a',
      [
        createReference('image-1'),
        createReference('video-1', 'video'),
        createReference('audio-1', 'audio'),
        createReference('text-1', 'text'),
        createReference('shape-1', 'graphics'),
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.content.map((item) => item.type)).toEqual([
      'image',
      'video',
      'audio',
      'text',
      'graphics',
    ]);
    expect(result.content.at(-1)).toMatchObject({
      url: '/__aitu_cache__/image/content-raster.png',
      width: 320,
      height: 180,
    });
    expect(convertElementsToImage).toHaveBeenCalledTimes(1);
    expect(cacheLocalMediaByContent).toHaveBeenCalledWith(
      expect.any(Blob),
      'image',
      {
        source: 'CANVAS_ASSOCIATION',
        boardId: 'board-a',
        elementId: 'shape-1',
      }
    );
  });

  it('replaces inline image and audio payloads with verified virtual URLs', async () => {
    const board = createBoard([
      {
        id: 'image-1',
        type: 'image',
        url: 'data:image/png;base64,YWFh',
      } as PlaitElement,
      {
        id: 'audio-1',
        type: 'audio',
        audioUrl: 'data:audio/mpeg;base64,YWFh',
      } as PlaitElement,
    ]);

    const result = await resolveCanvasAssociationsForSubmission(
      board,
      'board-a',
      [createReference('image-1'), createReference('audio-1', 'audio')]
    );

    expect(result.errors).toEqual([]);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'image',
        url: '/__aitu_cache__/image/content-raster.png',
      }),
      expect.objectContaining({
        type: 'audio',
        url: '/__aitu_generated__/audio/content-reference.mp3',
      }),
    ]);
    expect(cacheLocalMediaByContent).toHaveBeenCalledTimes(2);
    expect(getCachedBlob).toHaveBeenCalledTimes(2);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'doubao-seedance-2-0-260128',
        content: result.content,
      })
    ).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('base64');
    expect(JSON.stringify(result).length).toBeLessThan(1024);
  });

  it('rejects oversized inline images before fetch, hash or cache work', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const board = createBoard([
      {
        id: 'image-large',
        type: 'image',
        url: `data:image/png;base64,${'A'.repeat(16)}`,
      } as PlaitElement,
    ]);

    try {
      const result = await resolveCanvasAssociationsForSubmission(
        board,
        'board-a',
        [createReference('image-large')]
      );

      expect(result.content).toEqual([]);
      expect(result.errors).toEqual([
        expect.objectContaining({ code: 'raster_limit' }),
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(cacheLocalMediaByContent).not.toHaveBeenCalled();
      expect(getCachedBlob).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('accepts exactly 16 MiB then rejects overflow before decoding or caching', async () => {
    const dataUrlPrefix = 'data:audio/x;base64,';
    const halfBudget = 8 * 1024 * 1024;
    const audio1 = {
      id: 'audio-1',
      type: 'audio',
      audioUrl: `${dataUrlPrefix}${'A'.repeat(
        halfBudget - dataUrlPrefix.length
      )}`,
    } as PlaitElement & { audioUrl: string };
    const audio2 = {
      id: 'audio-2',
      type: 'audio',
      audioUrl: `${dataUrlPrefix}${'B'.repeat(
        halfBudget - dataUrlPrefix.length
      )}`,
    } as PlaitElement & { audioUrl: string };
    const board = createBoard([audio1, audio2]);
    const references = [
      createReference('audio-1', 'audio'),
      createReference('audio-2', 'audio'),
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }),
    } as Response);

    try {
      const withinLimit = await resolveCanvasAssociationsForSubmission(
        board,
        'board-a',
        references,
        { enforceSeedanceAudioDataUrlLimit: true }
      );

      expect(withinLimit.errors).toEqual([]);
      expect(withinLimit.content.length).toBeGreaterThan(0);
      expect(JSON.stringify(withinLimit)).not.toContain('data:audio/');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(cacheLocalMediaByContent).toHaveBeenCalledTimes(2);
      expect(getCachedBlob).toHaveBeenCalledTimes(2);

      audio2.audioUrl = `${audio2.audioUrl}AAAA`;
      fetchSpy.mockClear();
      cacheLocalMediaByContent.mockClear();
      getCachedBlob.mockClear();

      const result = await resolveCanvasAssociationsForSubmission(
        board,
        'board-a',
        references,
        { enforceSeedanceAudioDataUrlLimit: true }
      );

      expect(result.content).toEqual([]);
      expect(result.errors).toEqual([
        expect.objectContaining({
          code: 'audio_payload_limit',
          message: 'Seedance 2.0 音频 Data URL 合计不能超过 16 MiB',
        }),
      ]);
      expect(JSON.stringify(result)).not.toContain('data:audio/');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(cacheLocalMediaByContent).not.toHaveBeenCalled();
      expect(getCachedBlob).not.toHaveBeenCalled();

      const defaultResult = await resolveCanvasAssociationsForSubmission(
        board,
        'board-a',
        references
      );
      expect(defaultResult.errors).toEqual([]);
      expect(JSON.stringify(defaultResult)).not.toContain('data:audio/');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(cacheLocalMediaByContent).toHaveBeenCalledTimes(2);
      expect(
        validateCanvasAssociationCapability({
          generationType: 'image',
          modelId: 'gpt-image-1',
          content: defaultResult.content,
        })
      ).toEqual(['当前图片模型不支持音频联想引用']);

      const singleAudioPrefix = 'data:audio/x;base64,';
      audio1.audioUrl = `${singleAudioPrefix}${'A'.repeat(
        16 * 1024 * 1024 - singleAudioPrefix.length
      )}`;
      audio2.audioUrl = 'https://example.com/audio-2.mp3';
      fetchSpy.mockClear();
      cacheLocalMediaByContent.mockClear();
      getCachedBlob.mockClear();

      const exactLimit = await resolveCanvasAssociationsForSubmission(
        board,
        'board-a',
        references
      );
      expect(exactLimit.errors).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      audio1.audioUrl = `${audio1.audioUrl}A`;
      fetchSpy.mockClear();
      cacheLocalMediaByContent.mockClear();
      getCachedBlob.mockClear();

      const singleOverflow = await resolveCanvasAssociationsForSubmission(
        board,
        'board-a',
        references
      );
      expect(singleOverflow.errors).toEqual([
        expect.objectContaining({ code: 'audio_payload_limit' }),
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(cacheLocalMediaByContent).not.toHaveBeenCalled();
      expect(getCachedBlob).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects a virtual URL when the cache write did not persist a blob', async () => {
    getCachedBlob.mockResolvedValueOnce(null);
    const board = createBoard([
      {
        id: 'shape-1',
        type: 'graphics',
        points: [
          [0, 0],
          [320, 180],
        ],
      } as PlaitElement,
    ]);

    const result = await resolveCanvasAssociationsForSubmission(
      board,
      'board-a',
      [createReference('shape-1', 'graphics')]
    );

    expect(result.content).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'raster_failed' }),
    ]);
  });

  it('fails raster resolution instead of persisting a base64 payload', async () => {
    cacheLocalMediaByContent.mockRejectedValueOnce(
      new Error('cache unavailable')
    );
    const board = createBoard([
      {
        id: 'shape-1',
        type: 'graphics',
        points: [
          [0, 0],
          [320, 180],
        ],
      } as PlaitElement,
    ]);

    const result = await resolveCanvasAssociationsForSubmission(
      board,
      'board-a',
      [createReference('shape-1', 'graphics')]
    );

    expect(result.content).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'raster_failed' }),
    ]);
  });

  it('returns explicit errors for board changes and deleted nodes', async () => {
    const result = await resolveCanvasAssociationsForSubmission(
      createBoard([]),
      'board-a',
      [
        { ...createReference('other-board'), boardId: 'board-b' },
        createReference('deleted'),
      ]
    );

    expect(result.content).toEqual([]);
    expect(result.errors.map((error) => error.code)).toEqual([
      'board_changed',
      'element_missing',
    ]);
  });

  it('rejects a frame with more than 200 raster candidates', async () => {
    const frame = {
      id: 'frame-1',
      type: 'frame',
      points: [
        [0, 0],
        [320, 180],
      ],
    } as PlaitElement;
    const frameElements = Array.from({ length: 200 }, (_, index) => ({
      id: `child-${index}`,
      type: 'graphics',
      frameId: 'frame-1',
      points: [
        [0, 0],
        [10, 10],
      ],
    })) as PlaitElement[];

    const result = await resolveCanvasAssociationsForSubmission(
      createBoard([frame, ...frameElements]),
      'board-a',
      [createReference('frame-1', 'graphics')]
    );

    expect(result.content).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'raster_limit' }),
    ]);
    expect(convertElementsToImage).not.toHaveBeenCalled();
  });

  it('rejects a group with more than 200 raster candidates', async () => {
    const group = {
      id: 'group-1',
      type: 'group',
      points: [
        [0, 0],
        [320, 180],
      ],
      children: Array.from({ length: 200 }, (_, index) => ({
        id: `group-child-${index}`,
        type: 'graphics',
        points: [
          [0, 0],
          [10, 10],
        ],
      })),
    } as unknown as PlaitElement;

    const result = await resolveCanvasAssociationsForSubmission(
      createBoard([group]),
      'board-a',
      [createReference('group-1', 'graphics')]
    );

    expect(result.content).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'raster_limit' }),
    ]);
    expect(convertElementsToImage).not.toHaveBeenCalled();
  });

  it('rejects an oversized raster surface before rendering it', async () => {
    const board = createBoard([
      {
        id: 'shape-large',
        type: 'graphics',
        points: [
          [0, 0],
          [3000, 100],
        ],
      } as PlaitElement,
    ]);

    const result = await resolveCanvasAssociationsForSubmission(
      board,
      'board-a',
      [createReference('shape-large', 'graphics')]
    );

    expect(result.content).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'raster_limit' }),
    ]);
    expect(convertElementsToImage).not.toHaveBeenCalled();
  });

  it('rejects unsupported modalities before request submission', () => {
    const content = [
      {
        type: 'video' as const,
        url: 'https://cdn.example.com/video-1.mp4',
        name: '视频 1',
      },
      {
        type: 'video' as const,
        url: 'https://cdn.example.com/video-2.mp4',
        name: '视频 2',
      },
      { type: 'audio' as const, url: 'audio-material-1', name: '音频 1' },
    ];

    expect(
      validateCanvasAssociationCapability({
        generationType: 'image',
        modelId: 'gpt-image-1',
        content,
      })
    ).toEqual([
      '当前图片模型不支持视频联想引用',
      '当前图片模型不支持音频联想引用',
    ]);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'doubao-seedance-2-0-260128',
        content,
      })
    ).toEqual([]);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'happyhorse-1.0-video-edit',
        content,
      })
    ).toEqual([
      '当前视频编辑模型最多支持 1 个视频联想引用',
      '当前视频模型不支持音频联想引用',
    ]);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'agent',
        modelId: 'gpt-5',
        content,
      })
    ).toEqual([
      '当前文本流程不支持视频联想引用',
      '当前文本流程不支持音频联想引用',
    ]);
  });

  it('requires public HTTP(S) video references for HappyHorse edit', () => {
    const createVideoContent = (url: string) => [
      {
        type: 'video' as const,
        url,
        name: '参考视频',
      },
    ];

    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'happyhorse-1.0-video-edit',
        content: createVideoContent('/__aitu_cache__/video/reference.mp4'),
      })
    ).toEqual(['当前视频编辑模型的视频联想引用仅支持公网 HTTP(S) 地址']);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'happyhorse-1.0-video-edit',
        content: createVideoContent('https://cdn.example.com/reference.mp4'),
      })
    ).toEqual([]);
  });

  it('requires explicit text image input support and enforces its limit', () => {
    const visualContent = [
      {
        type: 'image' as const,
        url: 'https://cdn.example.com/image-1.png',
        name: '图片 1',
      },
      {
        type: 'graphics' as const,
        url: 'data:image/png;base64,AAAA',
        name: '图形 1',
      },
    ];

    expect(
      validateCanvasAssociationCapability({
        generationType: 'text',
        modelId: 'gpt-5',
        content: visualContent,
      })
    ).toEqual(['当前文本流程不支持图片联想引用']);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'agent',
        modelId: 'gpt-5',
        content: visualContent,
        textImageInput: { supported: false, maxCount: 20 },
      })
    ).toEqual(['当前文本流程不支持图片联想引用']);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'text',
        modelId: 'gpt-5',
        content: visualContent,
        textImageInput: { supported: true, maxCount: 2 },
      })
    ).toEqual([]);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'agent',
        modelId: 'gpt-5',
        content: visualContent,
        textImageInput: { supported: true, maxCount: 1 },
      })
    ).toEqual(['当前文本流程最多支持 1 个图片联想引用']);
  });

  it('enforces video image input limits', () => {
    const visualContent = [
      {
        type: 'image' as const,
        url: 'https://cdn.example.com/image-1.png',
        name: '图片 1',
      },
      {
        type: 'graphics' as const,
        url: 'data:image/png;base64,AAAA',
        name: '图形 1',
      },
    ];

    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'video-model',
        content: visualContent,
        videoImageInput: { maxCount: 0 },
      })
    ).toEqual(['当前视频模型不支持图片联想引用']);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'video-model',
        content: visualContent,
        videoImageInput: { maxCount: 1 },
      })
    ).toEqual(['当前视频模型最多支持 1 个图片联想引用']);
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'video-model',
        content: visualContent,
        videoImageInput: { maxCount: 9 },
      })
    ).toEqual([]);
  });

  it('rejects invalid Seedance media references during preflight', () => {
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'doubao-seedance-2-0-260128',
        content: [
          {
            type: 'video',
            url: 'blob:https://app.example.com/video-1',
            name: '本地视频',
          },
          {
            type: 'audio',
            url: 'data:audio/mpeg;base64,%%%',
            name: '非法音频',
          },
        ],
      })
    ).toEqual([
      'Seedance 2.0 视频联想引用仅支持公网 HTTP(S) 地址',
      'Seedance 2.0 音频联想引用仅支持 HTTP(S)、asset://、音频 Data URL 或素材 ID',
    ]);

    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'doubao-seedance-2-0-260128',
        content: [
          {
            type: 'video',
            url: 'https://cdn.example.com/video-1.mp4',
            name: '公网视频',
          },
          {
            type: 'audio',
            url: 'asset://audio-1',
            name: '素材音频',
          },
        ],
      })
    ).toEqual([]);
  });

  it('rejects four Seedance video and audio references during preflight', () => {
    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'doubao-seedance-2-0-260128',
        content: [
          ...Array.from({ length: 4 }, (_, index) => ({
            type: 'video' as const,
            url: `https://cdn.example.com/video-${index + 1}.mp4`,
            name: `视频 ${index + 1}`,
          })),
          ...Array.from({ length: 4 }, (_, index) => ({
            type: 'audio' as const,
            url: `asset://audio-${index + 1}`,
            name: `音频 ${index + 1}`,
          })),
        ],
      })
    ).toEqual([
      'Seedance 2.0 最多支持 3 个视频联想引用',
      'Seedance 2.0 最多支持 3 个音频联想引用',
    ]);
  });

  it('validates video URLs while oversized inline audio skips format scanning', () => {
    const oversizedAudio = `data:audio/mpeg;base64,${'A'.repeat(
      16 * 1024 * 1024
    )}`;

    expect(
      validateCanvasAssociationCapability({
        generationType: 'video',
        modelId: 'doubao-seedance-2-0-260128',
        content: [
          {
            type: 'video',
            url: 'blob:https://app.example.com/video-1',
            name: '本地视频',
          },
          {
            type: 'audio',
            url: oversizedAudio,
            name: '超限音频',
          },
        ],
      })
    ).toEqual([
      'Seedance 2.0 视频联想引用仅支持公网 HTTP(S) 地址',
      'Seedance 2.0 音频 Data URL 合计不能超过 16 MiB',
    ]);
  });
});
