import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  findPPTSlideImage: vi.fn(() => undefined),
  insertMediaIntoFrame: vi.fn(),
  removePPTImagePlaceholder: vi.fn(),
  replacePPTSlideImage: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
  getCachedBlob: vi.fn(),
  putArtifact: vi.fn(),
}));

vi.mock('../../utils/frame-insertion-utils', () => ({
  findPPTSlideImage: mocks.findPPTSlideImage,
  insertMediaIntoFrame: mocks.insertMediaIntoFrame,
  removePPTImagePlaceholder: mocks.removePPTImagePlaceholder,
  replacePPTSlideImage: mocks.replacePPTSlideImage,
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
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
  },
}));

vi.mock('./internal-artifact-cache', () => ({
  putPptExplainerArtifact: mocks.putArtifact,
}));

// Vitest mocks must be declared before importing the module under test.
// eslint-disable-next-line import/first
import {
  applyPptxCheckpointToExplainerState,
  captureCurrentPptSourceSelection,
  freezeCurrentPptSource,
  materializePptExplainerSlideImages,
  prepareMissingPptSlideImages,
} from './source-resolver';

function createFrame(
  id: string,
  pageIndex: number,
  slidePrompt?: string,
  pptExplainerJobId?: string
) {
  return {
    id,
    type: 'frame',
    name: `PPT 页面 ${pageIndex}`,
    points: [
      [0, 0],
      [1600, 900],
    ],
    pptMeta: { pageIndex, slidePrompt, pptExplainerJobId },
  };
}

describe('current PPT source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPPTSlideImage.mockImplementation(() => undefined);
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['image'], { type: 'image/png' })
    );
    mocks.cacheMediaFromBlob.mockImplementation(async (url: string) => url);
    mocks.putArtifact.mockResolvedValue(
      '/__aitu_ppt_explainer__/job-1/slide-1.png'
    );
    mocks.insertMediaIntoFrame.mockResolvedValue({
      elementId: 'inserted-image',
      point: [0, 0],
      size: { width: 1600, height: 900 },
    });
    mocks.replacePPTSlideImage.mockImplementation(
      (targetBoard, frameId, elementId, imageUrl) => {
        const image = targetBoard.children.find(
          (element: any) => element.id === elementId
        );
        if (image) image.pptSlideImage = true;
        const frame = targetBoard.children.find(
          (element: any) => element.id === frameId
        );
        if (frame) {
          frame.pptMeta = {
            ...frame.pptMeta,
            slideImageElementId: elementId,
            slideImageUrl: imageUrl,
          };
        }
      }
    );
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

  it('captures only the pages owned by the requested explainer task', async () => {
    const board = {
      children: [
        createFrame('job-a-1', 1, undefined, 'job-a'),
        createFrame('job-b-1', 1, undefined, 'job-b'),
        createFrame('job-a-2', 2, undefined, 'job-a'),
      ],
    } as any;

    const selection = await captureCurrentPptSourceSelection(board, 'job-a');

    expect(selection.frameIds).toEqual(['job-a-1', 'job-a-2']);
    expect(Object.keys(selection.frameRevisions || {})).toEqual([
      'job-a-1',
      'job-a-2',
    ]);
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

  it('writes generated page images to the visible PPT before freezing', async () => {
    const frame = createFrame('frame-1', 1, '生成页面图');
    const board = { children: [frame] } as any;
    const selection = await captureCurrentPptSourceSelection(board);
    mocks.insertMediaIntoFrame.mockImplementation(
      async (targetBoard, imageUrl, _mediaType, frameId) => {
        targetBoard.children.push({
          id: 'inserted-image',
          type: 'image',
          frameId,
          url: imageUrl,
        });
        return {
          elementId: 'inserted-image',
          point: [0, 0],
          size: { width: 1600, height: 900 },
        };
      }
    );
    mocks.findPPTSlideImage.mockImplementation((targetBoard) => {
      const image = targetBoard.children.find(
        (element: any) => element.id === 'inserted-image'
      );
      return image
        ? {
            element: image,
            elementId: image.id,
            index: targetBoard.children.indexOf(image),
            url: image.url,
          }
        : undefined;
    });

    const result = await materializePptExplainerSlideImages(
      board,
      new Map([['frame-1', '/__aitu_cache__/image/internal-image-1.png']]),
      { jobId: 'job-1', selection }
    );

    const visibleUrl = '/__aitu_cache__/image/ppt-explainer-job-1-frame-1.png';
    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
      visibleUrl,
      expect.any(Blob),
      'image',
      { taskId: 'job-1', resultVisibility: 'internal' }
    );
    expect(mocks.insertMediaIntoFrame).toHaveBeenCalledWith(
      board,
      visibleUrl,
      'image',
      'frame-1',
      { width: 1600, height: 900 },
      undefined,
      undefined,
      expect.objectContaining({ fit: 'stretch' })
    );
    expect(mocks.replacePPTSlideImage).toHaveBeenCalledWith(
      board,
      'frame-1',
      'inserted-image',
      visibleUrl,
      expect.objectContaining({ slidePrompt: '生成页面图' })
    );
    expect(mocks.removePPTImagePlaceholder).toHaveBeenCalledWith(
      board,
      'frame-1'
    );
    if (!result) throw new Error('expected materialized selection');
    expect(result?.frameIds).toEqual(['frame-1']);
    expect(result?.frameRevisions?.['frame-1']).toEqual(expect.any(String));
    await expect(
      prepareMissingPptSlideImages(board, { selection: result })
    ).resolves.toEqual(new Map());
    const frozen = await freezeCurrentPptSource(board, 'job-1', {
      selection: result,
    });
    expect(mocks.getCachedBlob).toHaveBeenLastCalledWith(visibleUrl);
    expect(frozen.slides[0]).toMatchObject({
      frameId: 'frame-1',
      snapshotUrl: '/__aitu_ppt_explainer__/job-1/slide-1.png',
    });
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
