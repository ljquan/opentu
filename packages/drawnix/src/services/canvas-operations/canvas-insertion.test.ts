import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';

const mocks = vi.hoisted(() => ({
  insertImageFromUrl: vi.fn(),
  insertImageNodeAtPoint: vi.fn(),
  insertVideoFromUrl: vi.fn(),
  insertAudioFromUrl: vi.fn(),
  insertCardsToCanvas: vi.fn(),
  parseMarkdownToCards: vi.fn(),
  insertText: vi.fn(),
  insertImage: vi.fn(),
  canvasBoard: null as PlaitBoard | null,
}));

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
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

vi.mock('../../data/image', () => ({
  insertImageFromUrl: mocks.insertImageFromUrl,
  insertImageNodeAtPoint: mocks.insertImageNodeAtPoint,
  loadImageElementForCanvas: vi.fn(),
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
  setCanvasBoard: vi.fn(),
}));

import {
  executeCanvasInsertion,
  insertAIFlow,
  insertImageGroup,
} from './canvas-insertion';

function createBoard(): PlaitBoard {
  return { children: [] } as unknown as PlaitBoard;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('canvas insertion service metadata binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canvasBoard = null;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      })
    );
    mocks.parseMarkdownToCards.mockReturnValue(null);
    mocks.insertText.mockImplementation((board: any) => {
      board.children.push({
        id: `text-${board.children.length}`,
        type: 'text',
      });
    });
    mocks.insertImage.mockImplementation((board: any) => {
      board.children.push({
        id: `image-${board.children.length}`,
        type: 'image',
      });
    });
    mocks.insertImageNodeAtPoint.mockImplementation(
      (board: any, imageItem: any, point: [number, number]) => {
        const element = {
          id: `image-${board.children.length}`,
          type: 'image',
          points: [
            point,
            [point[0] + imageItem.width, point[1] + imageItem.height],
          ],
          url: imageItem.url,
        };
        board.children.push(element);
        return element;
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('binds concurrent image metadata by the returned element ID', async () => {
    const board = createBoard();
    const first = deferred<string>();
    const second = deferred<string>();

    mocks.insertImageFromUrl.mockImplementation(
      async (targetBoard: PlaitBoard, url: string) => {
        const id = await (url.endsWith('first.png')
          ? first.promise
          : second.promise);
        targetBoard.children.push({ id, type: 'image', url } as any);
        return id;
      }
    );

    const firstInsertion = executeCanvasInsertion({
      board,
      startPoint: [0, 0],
      items: [
        {
          type: 'image',
          content: 'first.png',
          metadata: { prompt: 'first prompt', generationTaskId: 'task-first' },
        },
      ],
    });
    const secondInsertion = executeCanvasInsertion({
      board,
      startPoint: [0, 0],
      items: [
        {
          type: 'image',
          content: 'second.png',
          metadata: {
            prompt: 'second prompt',
            generationTaskId: 'task-second',
          },
        },
      ],
    });

    second.resolve('image-second');
    const secondResult = await secondInsertion;
    board.children.push({ id: 'unrelated', type: 'text' } as any);
    first.resolve('image-first');
    const firstResult = await firstInsertion;

    expect(
      board.children.find((item) => item.id === 'image-first')
    ).toMatchObject({
      generationPrompt: 'first prompt',
      generationTaskId: 'task-first',
    });
    expect(
      board.children.find((item) => item.id === 'image-second')
    ).toMatchObject({
      generationPrompt: 'second prompt',
      generationTaskId: 'task-second',
    });
    expect(
      board.children.find((item) => item.id === 'unrelated')
    ).not.toHaveProperty('generationTaskId');
    expect((firstResult.data as any).firstElementId).toBe('image-first');
    expect((secondResult.data as any).firstElementId).toBe('image-second');
  });

  it('stages multiple images with the DOM-free insertion option', async () => {
    const board = createBoard();
    mocks.insertImageFromUrl.mockImplementation(
      async (targetBoard: PlaitBoard, url: string, ...args: unknown[]) => {
        expect(args[8]).toBe(true);
        const id = `image-${targetBoard.children.length}`;
        targetBoard.children.push({ id, type: 'image', url } as any);
        return id;
      }
    );

    const result = await executeCanvasInsertion({
      board,
      items: [
        {
          type: 'image',
          content: 'first.png',
          dimensions: { width: 400, height: 400 },
        },
        {
          type: 'image',
          content: 'second.png',
          dimensions: { width: 400, height: 400 },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(board.children.map((item) => (item as any).url)).toEqual([
      'first.png',
      'second.png',
    ]);
  });

  it('preserves each generated image dimensions in a mixed-ratio group', async () => {
    const board = createBoard();
    mocks.insertImageFromUrl.mockImplementation(
      async (
        targetBoard: PlaitBoard,
        url: string,
        _point: unknown,
        _isDrop: unknown,
        dimensions: { width: number; height: number }
      ) => {
        const id = `image-${targetBoard.children.length}`;
        targetBoard.children.push({ id, type: 'image', url } as any);
        return id;
      }
    );

    const result = await insertImageGroup(
      ['landscape.png', 'portrait.png'],
      [100, 100],
      [
        { width: 512, height: 341 },
        { width: 400, height: 600 },
      ],
      board
    );

    expect(result.success).toBe(true);
    expect(mocks.insertImageFromUrl).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'landscape.png',
      expect.anything(),
      false,
      { width: 512, height: 341 },
      true,
      false,
      true,
      true,
      undefined,
      true
    );
    expect(mocks.insertImageFromUrl).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'portrait.png',
      expect.anything(),
      false,
      { width: 400, height: 600 },
      true,
      false,
      true,
      true,
      undefined,
      true
    );
    expect((result.data as any).items.map((item: any) => item.size)).toEqual([
      { width: 512, height: 341 },
      { width: 400, height: 600 },
    ]);
  });

  it('keeps the real board unchanged when a later staged item fails', async () => {
    const board = createBoard();
    mocks.insertImageFromUrl.mockImplementation(
      async (targetBoard: PlaitBoard, url: string) => {
        if (url === 'second.png') {
          throw new Error('second image failed');
        }
        targetBoard.children.push({
          id: 'image-first',
          type: 'image',
          url,
        } as any);
        return 'image-first';
      }
    );

    const result = await executeCanvasInsertion({
      board,
      items: [
        {
          type: 'image',
          content: 'first.png',
          dimensions: { width: 400, height: 400 },
        },
        {
          type: 'image',
          content: 'second.png',
          dimensions: { width: 400, height: 400 },
        },
      ],
    });

    expect(result).toMatchObject({
      success: false,
      error: '插入失败: second image failed',
    });
    expect(board.children).toEqual([]);
  });

  it('stages multiple videos with the DOM-free insertion option', async () => {
    const board = createBoard();
    mocks.insertVideoFromUrl.mockImplementation(
      async (targetBoard: PlaitBoard, url: string, ...args: unknown[]) => {
        expect(args[7]).toBe(true);
        const id = `video-${targetBoard.children.length}`;
        targetBoard.children.push({ id, type: 'image', url } as any);
        return id;
      }
    );

    const result = await executeCanvasInsertion({
      board,
      items: [
        { type: 'video', content: 'first.mp4' },
        { type: 'video', content: 'second.mp4' },
      ],
    });

    expect(result.success).toBe(true);
    expect(board.children.map((item) => (item as any).url)).toEqual([
      'first.mp4',
      'second.mp4',
    ]);
  });

  it('stages multiple SVG images without a board host', async () => {
    const board = createBoard();

    const result = await executeCanvasInsertion({
      board,
      items: [
        { type: 'svg', content: '<svg></svg>' },
        { type: 'svg', content: '<svg></svg>' },
      ],
    });

    expect(result.success).toBe(true);
    expect(mocks.insertImageNodeAtPoint).toHaveBeenCalledTimes(2);
    expect(board.children).toHaveLength(2);
  });

  it('binds generation prompt metadata to an inserted audio node', async () => {
    const board = createBoard();
    mocks.insertAudioFromUrl.mockImplementation(
      async (targetBoard: PlaitBoard, url: string) => {
        const audioNode = {
          id: 'audio-generated',
          type: 'audio',
          audioUrl: url,
          points: [
            [0, 0],
            [340, 128],
          ],
          createdAt: 1,
          children: [],
        } as any;
        targetBoard.children.push(audioNode);
        return audioNode;
      }
    );

    const result = await executeCanvasInsertion({
      board,
      startPoint: [0, 0],
      items: [
        {
          type: 'audio',
          content: 'generated.mp3',
          metadata: {
            prompt: '安静的钢琴背景音乐',
            generationTaskId: 'task-audio',
          },
        },
      ],
    });

    expect(board.children[0]).toMatchObject({
      prompt: '安静的钢琴背景音乐',
      aiPrompt: '安静的钢琴背景音乐',
      generationPrompt: '安静的钢琴背景音乐',
      generationTaskId: 'task-audio',
    });
    expect((result.data as any).firstElementId).toBe('audio-generated');
  });

  it('binds every generated card to its own text item metadata', async () => {
    const board = createBoard();
    mocks.parseMarkdownToCards.mockImplementation((text: string) => [
      { title: `${text}-1`, body: 'one' },
      { title: `${text}-2`, body: 'two' },
    ]);
    mocks.insertCardsToCanvas.mockImplementation(
      (targetBoard: PlaitBoard, blocks: Array<{ title: string }>) => {
        const ids = blocks.map((block) => `card-${block.title}`);
        ids.forEach((id) =>
          targetBoard.children.push({ id, type: 'card' } as any)
        );
        return ids;
      }
    );

    const result = await executeCanvasInsertion({
      board,
      startPoint: [0, 0],
      items: [
        {
          type: 'text',
          content: 'alpha',
          metadata: { prompt: 'prompt alpha', generationTaskId: 'task-alpha' },
        },
        {
          type: 'text',
          content: 'beta',
          metadata: { prompt: 'prompt beta', generationTaskId: 'task-beta' },
        },
      ],
    });

    expect(
      board.children.filter((item) => item.id.startsWith('card-alpha'))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ generationTaskId: 'task-alpha' }),
        expect.objectContaining({ generationTaskId: 'task-alpha' }),
      ])
    );
    expect(
      board.children.filter((item) => item.id.startsWith('card-beta'))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ generationTaskId: 'task-beta' }),
        expect.objectContaining({ generationTaskId: 'task-beta' }),
      ])
    );
    expect(
      (result.data as any).items.map((item: any) => item.elementId)
    ).toEqual(['card-alpha-1', 'card-beta-1']);
  });

  it('does not promote an ordinary video prompt unless generation is explicit', async () => {
    const board = createBoard();
    mocks.canvasBoard = board;
    mocks.insertVideoFromUrl.mockImplementation(
      async (targetBoard: PlaitBoard, url: string) => {
        const id = `video-${targetBoard.children.length}`;
        targetBoard.children.push({ id, type: 'video', url } as any);
        return id;
      }
    );

    await executeCanvasInsertion({
      board,
      startPoint: [0, 0],
      items: [
        {
          type: 'video',
          content: 'ordinary.mp4',
          metadata: { prompt: 'display only' },
        },
      ],
    });

    expect(board.children[0]).toMatchObject({ prompt: 'display only' });
    expect(board.children[0]).not.toHaveProperty('generationPrompt');
    expect(board.children[0]).not.toHaveProperty('aiPrompt');

    await insertAIFlow(
      'generated video',
      [{ type: 'video', url: 'generated.mp4' }],
      [0, 200]
    );

    expect(
      board.children.find((item) => item.url === 'generated.mp4')
    ).toMatchObject({
      prompt: 'generated video',
      generationPrompt: 'generated video',
      aiPrompt: 'generated video',
    });
  });
});
