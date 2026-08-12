import { createBoard, type PlaitBoard } from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWCapabilitiesHandler, setCapabilitiesBoard } from './handler';

const pendingImageInsertions = vi.hoisted(() => new Map<string, () => void>());

vi.mock('../../data/image', () => ({
  insertImageFromUrl: vi.fn(
    (board: PlaitBoard, imageUrl: string, ...args: unknown[]) =>
      new Promise<string>((resolve, reject) => {
        const boardGuard = args[7] as (() => boolean) | undefined;
        pendingImageInsertions.set(imageUrl, () => {
          pendingImageInsertions.delete(imageUrl);
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
      positions: items.map((_, index) => [
        startPoint[0] + index * 120,
        startPoint[1],
      ]),
    })
  ),
}));

vi.mock('../../utils/svg-utils', () => ({
  normalizeSvg: vi.fn((value: string) => value),
  parseSvgDimensions: vi.fn(() => ({ width: 100, height: 100 })),
  svgToDataUrl: vi.fn(() => 'data:image/svg+xml,test'),
}));

function releaseImageInsertion(imageUrl: string): void {
  const release = pendingImageInsertions.get(imageUrl);
  if (!release) throw new Error(`Missing pending image insertion: ${imageUrl}`);
  release();
}

describe('SW capabilities canvas insertion', () => {
  beforeEach(() => {
    pendingImageInsertions.clear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    setCapabilitiesBoard(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects a delayed insertion when the same Board is rebound', async () => {
    const board = createBoard([]);
    const handler = new SWCapabilitiesHandler();
    setCapabilitiesBoard(board);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const insertion = handler.execute({
      operation: 'canvas_insert',
      args: {
        items: [
          {
            type: 'image',
            content: 'delayed-image',
            dimensions: { width: 100, height: 100 },
          },
        ],
        startPoint: [0, 0],
      },
    });

    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('delayed-image')).toBe(true)
    );

    setCapabilitiesBoard(board);
    releaseImageInsertion('delayed-image');

    await expect(insertion).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('画板已切换'),
    });
    expect(board.children).toEqual([]);
  });

  it('commits two staged images together in one successful request', async () => {
    const board = createBoard([]);
    const handler = new SWCapabilitiesHandler();
    setCapabilitiesBoard(board);

    const insertion = handler.execute({
      operation: 'canvas_insert',
      args: {
        items: [
          {
            type: 'image',
            content: 'first-image',
            dimensions: { width: 100, height: 100 },
          },
          {
            type: 'image',
            content: 'second-image',
            dimensions: { width: 100, height: 100 },
          },
        ],
        startPoint: [0, 0],
      },
    });

    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('first-image')).toBe(true)
    );
    expect(board.children).toEqual([]);
    releaseImageInsertion('first-image');

    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('second-image')).toBe(true)
    );
    expect(board.children).toEqual([]);
    releaseImageInsertion('second-image');

    await expect(insertion).resolves.toMatchObject({
      success: true,
      data: { insertedCount: 2 },
    });
    expect(board.children.map((element) => element.id)).toEqual([
      'element-first-image',
      'element-second-image',
    ]);
  });

  it('dispatches the legacy completion event after insert_to_canvas succeeds', async () => {
    const board = createBoard([]);
    const handler = new SWCapabilitiesHandler();
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    setCapabilitiesBoard(board);

    const insertion = handler.execute({
      operation: 'insert_to_canvas',
      args: {
        items: [
          {
            type: 'image',
            content: 'completion-event-image',
            dimensions: { width: 100, height: 100 },
          },
        ],
        startPoint: [0, 0],
      },
    });

    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('completion-event-image')).toBe(true)
    );
    releaseImageInsertion('completion-event-image');

    await expect(insertion).resolves.toMatchObject({ success: true });
    const completionEvents = dispatchEvent.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === 'ai-generation-complete');
    expect(completionEvents).toHaveLength(1);
    expect((completionEvents[0] as CustomEvent).detail).toEqual({
      type: 'text',
      success: true,
    });
  });

  it('does not dispatch the completion event when insert_to_canvas fails', async () => {
    const board = createBoard([]);
    const handler = new SWCapabilitiesHandler();
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    setCapabilitiesBoard(board);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const insertion = handler.execute({
      operation: 'insert_to_canvas',
      args: {
        items: [
          {
            type: 'image',
            content: 'failed-completion-event-image',
            dimensions: { width: 100, height: 100 },
          },
        ],
        startPoint: [0, 0],
      },
    });

    await vi.waitFor(() =>
      expect(pendingImageInsertions.has('failed-completion-event-image')).toBe(
        true
      )
    );
    setCapabilitiesBoard(board);
    releaseImageInsertion('failed-completion-event-image');

    await expect(insertion).resolves.toMatchObject({ success: false });
    expect(
      dispatchEvent.mock.calls.some(
        ([event]) => event.type === 'ai-generation-complete'
      )
    ).toBe(false);
  });
});
