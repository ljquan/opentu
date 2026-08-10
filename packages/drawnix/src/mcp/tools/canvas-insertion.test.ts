import { createBoard, type PlaitBoard } from '@plait/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pendingImageInsertions = vi.hoisted(() => new Map<string, () => void>());

vi.mock('../../data/image', () => ({
  insertImageFromUrl: vi.fn(
    (board: PlaitBoard, imageUrl: string, ...args: unknown[]) =>
      new Promise<string>((resolve, reject) => {
        const boardGuard = args[7] as (() => boolean) | undefined;
        pendingImageInsertions.set(imageUrl, () => {
          if (boardGuard && !boardGuard()) {
            reject(new Error('画板已切换，取消本次插入'));
            return;
          }
          const elementId = `element-${imageUrl}`;
          board.children.push({ id: elementId, type: 'image' } as never);
          resolve(elementId);
        });
      })
  ),
  loadImageElementForCanvas: vi.fn(),
}));

vi.mock('../../data/video', () => ({
  insertVideoFromUrl: vi.fn(),
}));

vi.mock('../../data/audio', () => ({
  insertAudioFromUrl: vi.fn(),
  resolveAudioCardDimensions: vi.fn(() => ({ width: 320, height: 96 })),
}));

vi.mock('../../utils/selection-utils', () => ({
  scrollToPointIfNeeded: vi.fn(),
}));

vi.mock('../../utils/markdown-to-cards', () => ({
  parseMarkdownToCards: vi.fn(() => null),
}));

vi.mock('../../utils/insert-cards', () => ({
  insertCardsToCanvas: vi.fn(() => []),
}));

vi.mock('../../utils/frame-insertion-utils', () => ({
  getSelectedInsertionFrame: vi.fn(() => null),
  insertMediaIntoSelectedFrame: vi.fn(async () => null),
}));

vi.mock('../../utils/canvas-insertion-layout', () => ({
  CANVAS_INSERTION_LAYOUT: {
    DEFAULT_HORIZONTAL_GAP: 20,
    DEFAULT_POINT: [100, 100],
    DEFAULT_VERTICAL_GAP: 50,
    MEDIA_DEFAULT_SIZE: 400,
  },
  createBatchInsertionFlowState: vi.fn(() => ({ bounds: null })),
  estimateCanvasTextSize: vi.fn(() => ({ width: 100, height: 40 })),
  getBatchInsertionFlowCenter: vi.fn(() => [200, 200]),
  getBottomMostInsertionPoint: vi.fn(() => [100, 100]),
  getInsertionPointFromSavedSelection: vi.fn(() => null),
  getViewportAwareCardWidth: vi.fn(() => 400),
  getViewportCanvasMetrics: vi.fn(() => ({
    height: 800,
    width: 1200,
    zoom: 1,
  })),
  logCanvasInsertionDebug: vi.fn(),
  precalculateGroupedGridLayout: vi.fn(
    (startPoint: [number, number], items: unknown[]) => ({
      bounds: null,
      positions: items.map(() => startPoint),
    })
  ),
}));

vi.mock('../../utils/svg-utils', () => ({
  normalizeSvg: vi.fn((value: string) => value),
  parseSvgDimensions: vi.fn(() => ({ width: 100, height: 100 })),
  svgToDataUrl: vi.fn(() => 'data:image/svg+xml,test'),
}));

async function expectInterleavedInsertionsToKeepTheirIds(
  quickInsert: (
    type: 'image',
    content: string,
    point: [number, number],
    dimensions: { width: number; height: number }
  ) => Promise<{
    data?: { firstElementId?: string };
  }>
): Promise<void> {
  const first = quickInsert('image', 'first', [0, 0], {
    width: 100,
    height: 100,
  });
  const second = quickInsert('image', 'second', [200, 0], {
    width: 100,
    height: 100,
  });

  await vi.waitFor(() => expect(pendingImageInsertions.size).toBe(2));

  pendingImageInsertions.get('second')?.();
  const secondResult = await second;
  pendingImageInsertions.get('first')?.();
  const firstResult = await first;

  expect(firstResult.data?.firstElementId).toBe('element-first');
  expect(secondResult.data?.firstElementId).toBe('element-second');
}

async function expectSelectedFrameInsertionToKeepItsId(
  quickInsert: (
    type: 'image',
    content: string
  ) => Promise<{
    data?: { firstElementId?: string };
  }>
): Promise<void> {
  const { insertMediaIntoSelectedFrame } = await import(
    '../../utils/frame-insertion-utils'
  );
  vi.mocked(insertMediaIntoSelectedFrame).mockResolvedValueOnce({
    point: [10, 20],
    size: { width: 300, height: 200 },
    elementId: 'frame-image-id',
  });

  const result = await quickInsert('image', 'frame-image');

  expect(result.data?.firstElementId).toBe('frame-image-id');
}

describe('canvas insertion result ids', () => {
  beforeEach(() => {
    pendingImageInsertions.clear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('keeps each MCP insertion id when concurrent inserts finish out of order', async () => {
    const { quickInsert, setCanvasBoard } = await import('./canvas-insertion');
    const board = createBoard([]);
    setCanvasBoard(board);

    await expectInterleavedInsertionsToKeepTheirIds(quickInsert);

    setCanvasBoard(null);
  });

  it('does not mutate a reused MCP board after its binding changes', async () => {
    const { canvasInsertionTool, setCanvasBoard } = await import(
      './canvas-insertion'
    );
    const board = createBoard([]);
    setCanvasBoard(board);

    const insertion = canvasInsertionTool.execute({
      items: [
        {
          type: 'image',
          content: 'delayed-board-switch',
          dimensions: { width: 100, height: 100 },
        },
      ],
      startPoint: [0, 0],
    });
    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('delayed-board-switch')).toBe(true)
    );

    // SelectionWatcher reuses the Board instance but rebinds it for each board id.
    setCanvasBoard(board);
    pendingImageInsertions.get('delayed-board-switch')?.();

    await expect(insertion).resolves.toMatchObject({ success: false });
    expect(board.children).toEqual([]);
    setCanvasBoard(null);
  });

  it('keeps the real board unchanged when a prepared batch loses its binding', async () => {
    const { canvasInsertionTool, setCanvasBoard } = await import(
      './canvas-insertion'
    );
    const board = createBoard([]);
    setCanvasBoard(board);

    const insertion = canvasInsertionTool.execute({
      items: [
        {
          type: 'image',
          content: 'batch-first',
          dimensions: { width: 100, height: 100 },
        },
        {
          type: 'image',
          content: 'batch-second',
          dimensions: { width: 100, height: 100 },
        },
      ],
      startPoint: [0, 0],
    });

    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('batch-first')).toBe(true)
    );
    pendingImageInsertions.get('batch-first')?.();
    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('batch-second')).toBe(true)
    );

    setCanvasBoard(board);
    pendingImageInsertions.get('batch-second')?.();

    await expect(insertion).resolves.toMatchObject({ success: false });
    expect(board.children).toEqual([]);
    setCanvasBoard(null);
  });

  it('keeps each service insertion id when concurrent inserts finish out of order', async () => {
    const { quickInsert, setCanvasBoard } = await import(
      '../../services/canvas-operations/canvas-insertion'
    );
    const board = createBoard([]);
    setCanvasBoard(board);

    await expectInterleavedInsertionsToKeepTheirIds(quickInsert);

    setCanvasBoard(null);
  });

  it('keeps the selected Frame image id in the MCP insertion result', async () => {
    const { quickInsert, setCanvasBoard } = await import('./canvas-insertion');
    const board = createBoard([]);
    setCanvasBoard(board);

    await expectSelectedFrameInsertionToKeepItsId(quickInsert);

    setCanvasBoard(null);
  });

  it('keeps the selected Frame image id in the service insertion result', async () => {
    const { quickInsert, setCanvasBoard } = await import(
      '../../services/canvas-operations/canvas-insertion'
    );
    const board = createBoard([]);
    setCanvasBoard(board);

    await expectSelectedFrameInsertionToKeepItsId(quickInsert);

    setCanvasBoard(null);
  });
});
