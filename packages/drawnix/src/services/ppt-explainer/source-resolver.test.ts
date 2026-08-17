import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
}));

vi.mock('../../utils/frame-insertion-utils', () => ({
  findPPTSlideImage: vi.fn(() => undefined),
}));

vi.mock('../../utils/frame-preview-snapshot', () => ({
  getPPTFrameSnapshotElements: (board: any, frame: any) => [
    frame,
    ...board.children.filter((element: any) => element.frameId === frame.id),
  ],
  createPPTFrameSnapshotKey: (elements: unknown[]) => JSON.stringify(elements),
  createPPTFrameSnapshotDataUrl: vi.fn(),
}));

vi.mock('../media-generation/image-generation-service', () => ({
  generateImage: mocks.generateImage,
}));

vi.mock('../ppt', () => ({
  buildPPTImageGenerationPrompt: (_common: string, prompt: string) => prompt,
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: { getCachedBlob: vi.fn() },
}));

vi.mock('./internal-artifact-cache', () => ({
  putPptExplainerArtifact: vi.fn(),
}));

// Vitest mocks must be declared before importing the module under test.
// eslint-disable-next-line import/first
import {
  applyPptxCheckpointToExplainerState,
  captureCurrentPptSourceSelection,
  prepareMissingPptSlideImages,
} from './source-resolver';

function createFrame(id: string, pageIndex: number, slidePrompt?: string) {
  return {
    id,
    type: 'frame',
    name: `PPT 页面 ${pageIndex}`,
    points: [
      [0, 0],
      [1600, 900],
    ],
    pptMeta: { pageIndex, slidePrompt },
  };
}

describe('current PPT source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not absorb PPT frames added after task creation', async () => {
    const board = {
      children: [createFrame('frame-1', 1), createFrame('frame-2', 2)],
    } as any;
    const selection = await captureCurrentPptSourceSelection(board);
    board.children.push(createFrame('frame-3', 3, '新增页图片'));

    const result = await prepareMissingPptSlideImages(board, {
      selection,
      model: 'image-model',
    });

    expect(result.size).toBe(0);
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('fails explicitly when a submitted frame is deleted', async () => {
    const board = {
      children: [createFrame('frame-1', 1), createFrame('frame-2', 2)],
    } as any;
    const selection = await captureCurrentPptSourceSelection(board);
    board.children = [board.children[0]];

    await expect(
      prepareMissingPptSlideImages(board, { selection })
    ).rejects.toThrow('第 2 页已缺失');
  });

  it('fails explicitly when submitted page content changes', async () => {
    const board = {
      children: [
        createFrame('frame-1', 1),
        { id: 'text-1', type: 'text', frameId: 'frame-1', text: '原内容' },
      ],
    } as any;
    const selection = await captureCurrentPptSourceSelection(board);
    board.children[1] = {
      ...board.children[1],
      text: '修改后的内容',
    };

    await expect(
      prepareMissingPptSlideImages(board, { selection })
    ).rejects.toThrow('第 1 页内容已变更');
  });

  it('keeps reviewed topic pages editable while excluding newly added frames', async () => {
    const board = {
      children: [createFrame('frame-1', 1)],
    } as any;
    const selection = { frameIds: ['frame-1'] };
    board.children[0] = {
      ...board.children[0],
      pptMeta: { ...board.children[0].pptMeta, notes: '审核后修改' },
    };
    board.children.push(createFrame('frame-2', 2, '新增页图片'));

    await expect(
      prepareMissingPptSlideImages(board, { selection })
    ).resolves.toEqual(new Map());
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('reports every generated internal image task to its owner', async () => {
    const board = {
      children: [createFrame('frame-1', 1, '生成页面图')],
    } as any;
    const selection = await captureCurrentPptSourceSelection(board);
    const onInternalTaskCreated = vi.fn();
    mocks.generateImage.mockImplementation(async (_prompt, options) => {
      options.onTaskCreated?.('internal-image-1');
      return {
        url: '/__aitu_cache__/image/internal-image-1.png',
        task: { result: { url: '/__aitu_cache__/image/internal-image-1.png' } },
      };
    });

    const result = await prepareMissingPptSlideImages(board, {
      selection,
      model: 'image-model',
      onInternalTaskCreated,
    });

    expect(onInternalTaskCreated).toHaveBeenCalledWith('internal-image-1');
    expect(result.get('frame-1')).toBe(
      '/__aitu_cache__/image/internal-image-1.png'
    );
  });

  it('keeps cache-only PPTX slides free of nonexistent snapshot URLs', () => {
    const state = {
      slides: [],
      diagnostics: [],
    } as any;
    const checkpoint = {
      source: {
        fileName: 'deck.pptx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        cacheUrl: '/__aitu_cache__/pptx-import/source.pptx',
        fingerprint: 'fingerprint',
      },
      slides: [{ pageIndex: 1, notes: '备注', diagnostics: [] }],
      diagnostics: [],
      slideSize: {},
      renderer: {},
    } as any;

    const result = applyPptxCheckpointToExplainerState(state, checkpoint);

    expect(result.slides[0]).toMatchObject({ pageIndex: 1, notes: '备注' });
    expect(result.slides[0]).not.toHaveProperty('snapshotUrl');
    expect(result.slides[0]).not.toHaveProperty('snapshotMimeType');
  });
});
