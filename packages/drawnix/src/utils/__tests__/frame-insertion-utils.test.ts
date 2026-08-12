import { createTestingBoard, Transforms } from '@plait/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findPreviousPPTSlideImage,
  findPPTSlideImage,
  getPPTSlidePrompt,
  insertMediaIntoFrame,
  insertMediaIntoSelectedFrame,
  markPPTSlideImage,
  replacePPTSlideImage,
  setFramePPTMeta,
  syncEditedPPTSlideImage,
} from '../frame-insertion-utils';

vi.mock('@plait/draw', () => ({
  DrawTransforms: {
    insertImage: (board: any, imageItem: any, point: [number, number]) => {
      Transforms.insertNode(
        board,
        {
          id: `mock-image-${board.children.length}`,
          type: 'image',
          ...imageItem,
          points: [
            point,
            [point[0] + imageItem.width, point[1] + imageItem.height],
          ],
          children: [],
        },
        [board.children.length]
      );
    },
  },
}));

function createBoard(children: any[] = []) {
  return createTestingBoard([], children) as any;
}

function createFrame(overrides: Record<string, unknown> = {}) {
  return {
    id: 'frame-1',
    type: 'frame',
    name: 'Slide 1',
    points: [
      [0, 0],
      [1920, 1080],
    ],
    children: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frame-insertion-utils PPT helpers', () => {
  it('uses slidePrompt first and falls back to legacy imagePrompt', () => {
    expect(
      getPPTSlidePrompt({
        slidePrompt: '  whole slide prompt  ',
        imagePrompt: 'legacy prompt',
      })
    ).toBe('whole slide prompt');

    expect(getPPTSlidePrompt({ imagePrompt: ' legacy prompt ' })).toBe(
      'legacy prompt'
    );
  });

  it('keeps final generation prompt in history without overwriting slide prompt', () => {
    const board = createBoard([
      createFrame(),
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/slide.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    markPPTSlideImage(
      board,
      'frame-1',
      'image-1',
      'https://example.com/slide.png',
      'common prompt\n\n---\n\nsingle slide prompt',
      [],
      undefined,
      'single slide prompt'
    );

    expect(board.children[0].pptMeta).toMatchObject({
      slidePrompt: 'single slide prompt',
      slideImageHistory: [
        expect.objectContaining({
          prompt: 'common prompt\n\n---\n\nsingle slide prompt',
        }),
      ],
    });
  });

  it('marks the inserted image as the PPT slide image', () => {
    const board = createBoard([
      createFrame(),
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/slide.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    markPPTSlideImage(
      board,
      'frame-1',
      'image-1',
      'https://example.com/slide.png',
      'new prompt'
    );

    expect(board.children[1].pptSlideImage).toBe(true);
    expect(board.children[0].pptMeta).toMatchObject({
      slidePrompt: 'new prompt',
      slideImageElementId: 'image-1',
      slideImageUrl: 'https://example.com/slide.png',
      slideImageStatus: 'generated',
      slideImageHistory: [
        expect.objectContaining({
          imageUrl: 'https://example.com/slide.png',
          elementId: 'image-1',
          prompt: 'new prompt',
        }),
      ],
    });
    expect(findPPTSlideImage(board, 'frame-1')?.elementId).toBe('image-1');
  });

  it('syncs ppt meta when the current slide image is edited on canvas', () => {
    const board = createBoard([
      createFrame({
        pptMeta: {
          slidePrompt: 'existing prompt',
          slideImageElementId: 'image-1',
          slideImageUrl: 'https://example.com/old.png',
          slideImageStatus: 'generated',
        },
      }),
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        pptSlideImage: true,
        url: 'https://example.com/old.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    syncEditedPPTSlideImage(board, 'image-1', '/__aitu_cache__/image/new.png');

    expect(board.children[0].pptMeta).toMatchObject({
      slidePrompt: 'existing prompt',
      slideImageElementId: 'image-1',
      slideImageUrl: '/__aitu_cache__/image/new.png',
      slideImageStatus: 'generated',
    });
    expect(board.children[1].pptSlideImage).toBe(true);
  });

  it('finds the previous PPT slide image by page index', () => {
    const board = createBoard([
      createFrame({
        id: 'frame-1',
        pptMeta: {
          pageIndex: 1,
          slideImageElementId: 'image-1',
        },
      }),
      createFrame({
        id: 'frame-2',
        name: 'Slide 2',
        pptMeta: {
          pageIndex: 2,
        },
      }),
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        pptSlideImage: true,
        url: 'https://example.com/slide-1.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    expect(findPreviousPPTSlideImage(board, 'frame-2')).toMatchObject({
      elementId: 'image-1',
      url: 'https://example.com/slide-1.png',
    });
  });

  it('uses the first 10 prompt characters as title for default PPT frame titles', () => {
    const board = createBoard([
      createFrame({ name: 'Frame 3' }),
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/slide.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    markPPTSlideImage(
      board,
      'frame-1',
      'image-1',
      'https://example.com/slide.png',
      '  这是一个用于生成PPT页面的提示词  '
    );

    expect(board.children[0].name).toBe('这是一个用于生成PP');
  });

  it('keeps custom PPT frame titles when marking slide image', () => {
    const board = createBoard([
      createFrame({ name: '产品路线图' }),
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/slide.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    markPPTSlideImage(
      board,
      'frame-1',
      'image-1',
      'https://example.com/slide.png',
      '新的生图提示词'
    );

    expect(board.children[0].name).toBe('产品路线图');
  });

  it('replaces the previous PPT slide image after new image is inserted', () => {
    const board = createBoard([
      createFrame({
        pptMeta: {
          slideImageElementId: 'old-image',
          slideImageUrl: 'https://example.com/old.png',
        },
      }),
      {
        id: 'old-image',
        type: 'image',
        frameId: 'frame-1',
        pptSlideImage: true,
        url: 'https://example.com/old.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
      {
        id: 'new-image',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/new.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    replacePPTSlideImage(
      board,
      'frame-1',
      'new-image',
      'https://example.com/new.png',
      {
        prompt: 'regenerated prompt',
      }
    );

    expect(
      board.children.some((element: any) => element.id === 'old-image')
    ).toBe(false);
    expect(findPPTSlideImage(board, 'frame-1')?.elementId).toBe('new-image');
    expect(board.children[0].pptMeta).toMatchObject({
      slidePrompt: 'regenerated prompt',
      slideImageElementId: 'new-image',
      slideImageUrl: 'https://example.com/new.png',
      slideImageStatus: 'generated',
      slideImageHistory: [
        expect.objectContaining({
          imageUrl: 'https://example.com/new.png',
          elementId: 'new-image',
          prompt: 'regenerated prompt',
        }),
      ],
    });
  });

  it('keeps all generated PPT slide images in history while using the latest as current', () => {
    const board = createBoard([
      createFrame(),
      {
        id: 'image-3',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/3.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    markPPTSlideImage(
      board,
      'frame-1',
      'image-3',
      'https://example.com/3.png',
      'batch prompt',
      [
        { imageUrl: 'https://example.com/1.png', prompt: 'batch prompt' },
        { imageUrl: 'https://example.com/2.png', prompt: 'batch prompt' },
      ]
    );

    expect(board.children[0].pptMeta).toMatchObject({
      slideImageElementId: 'image-3',
      slideImageUrl: 'https://example.com/3.png',
    });
    expect(
      board.children[0].pptMeta.slideImageHistory.map(
        (item: any) => item.imageUrl
      )
    ).toEqual([
      'https://example.com/1.png',
      'https://example.com/2.png',
      'https://example.com/3.png',
    ]);
  });

  it('keeps PPT slide image history order when switching current image', () => {
    const board = createBoard([
      createFrame({
        pptMeta: {
          slideImageElementId: 'image-2',
          slideImageUrl: 'https://example.com/2.png',
          slideImageHistory: [
            {
              id: 'history-1',
              imageUrl: 'https://example.com/1.png',
              elementId: 'image-1',
              prompt: 'prompt 1',
              createdAt: 100,
            },
            {
              id: 'history-2',
              imageUrl: 'https://example.com/2.png',
              elementId: 'image-2',
              prompt: 'prompt 2',
              createdAt: 200,
            },
            {
              id: 'history-3',
              imageUrl: 'https://example.com/3.png',
              elementId: 'image-3',
              prompt: 'prompt 3',
              createdAt: 300,
            },
          ],
        },
      }),
      ...[1, 2, 3].map((index) => ({
        id: `image-${index}`,
        type: 'image',
        frameId: 'frame-1',
        url: `https://example.com/${index}.png`,
        points: [
          [0, 0],
          [1920, 1080],
        ],
      })),
    ]);

    replacePPTSlideImage(
      board,
      'frame-1',
      'image-1',
      'https://example.com/1.png',
      {
        replaceElementId: 'image-2',
        prompt: 'prompt 1',
        imageCreatedAt: 100,
      }
    );

    expect(
      board.children[0].pptMeta.slideImageHistory.map(
        (item: any) => item.imageUrl
      )
    ).toEqual([
      'https://example.com/1.png',
      'https://example.com/2.png',
      'https://example.com/3.png',
    ]);
    expect(board.children[0].pptMeta.slideImageHistory[0]).toMatchObject({
      id: 'history-1',
      createdAt: 100,
    });
  });

  it('uses image generation time for PPT slide image history', () => {
    const board = createBoard([
      createFrame(),
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/slide.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);
    const generatedAt = 1710000000000;

    markPPTSlideImage(
      board,
      'frame-1',
      'image-1',
      'https://example.com/slide.png',
      'new prompt',
      [],
      generatedAt
    );

    expect(board.children[0].pptMeta.slideImageHistory[0]).toMatchObject({
      imageUrl: 'https://example.com/slide.png',
      createdAt: generatedAt,
    });
  });

  it('falls back to the current PPT slide image when the requested replace image is stale', () => {
    const board = createBoard([
      createFrame({
        pptMeta: {
          slideImageElementId: 'current-image',
          slideImageUrl: 'https://example.com/current.png',
        },
      }),
      {
        id: 'current-image',
        type: 'image',
        frameId: 'frame-1',
        pptSlideImage: true,
        url: 'https://example.com/current.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
      {
        id: 'new-image',
        type: 'image',
        frameId: 'frame-1',
        url: 'https://example.com/new.png',
        points: [
          [0, 0],
          [1920, 1080],
        ],
      },
    ]);

    replacePPTSlideImage(
      board,
      'frame-1',
      'new-image',
      'https://example.com/new.png',
      {
        replaceElementId: 'already-removed-image',
        prompt: 'new prompt',
      }
    );

    expect(
      board.children.some((element: any) => element.id === 'current-image')
    ).toBe(false);
    expect(findPPTSlideImage(board, 'frame-1')?.elementId).toBe('new-image');
  });

  it('deduplicates and caps PPT slide image history', () => {
    const board = createBoard([
      createFrame(),
      ...Array.from({ length: 22 }, (_, index) => ({
        id: `image-${index}`,
        type: 'image',
        frameId: 'frame-1',
        url: `https://example.com/${index}.png`,
        points: [
          [0, 0],
          [1920, 1080],
        ],
      })),
    ]);

    for (let index = 0; index < 22; index += 1) {
      markPPTSlideImage(
        board,
        'frame-1',
        `image-${index}`,
        `https://example.com/${index}.png`,
        `prompt ${index}`
      );
    }

    markPPTSlideImage(
      board,
      'frame-1',
      'image-21',
      'https://example.com/21.png',
      'updated prompt'
    );

    const history = board.children[0].pptMeta.slideImageHistory;
    expect(history).toHaveLength(20);
    expect(
      history.filter(
        (item: any) => item.imageUrl === 'https://example.com/21.png'
      )
    ).toHaveLength(1);
    expect(history[history.length - 1]).toMatchObject({
      elementId: 'image-21',
      prompt: 'updated prompt',
    });
  });

  it('keeps existing metadata when marking generation failure', () => {
    const board = createBoard([
      createFrame({
        pptMeta: {
          slideImageElementId: 'old-image',
          slideImageUrl: 'https://example.com/old.png',
          slideImageStatus: 'generated',
        },
      }),
    ]);

    setFramePPTMeta(board, 'frame-1', {
      slideImageStatus: 'failed',
      imageStatus: 'failed',
    });

    expect(board.children[0].pptMeta).toMatchObject({
      slideImageElementId: 'old-image',
      slideImageUrl: 'https://example.com/old.png',
      slideImageStatus: 'failed',
      imageStatus: 'failed',
    });
  });

  it('inserts media into the saved selected frame and fits it to the PPT page', async () => {
    const board = createBoard([createFrame()]);
    board.appState = { lastSelectedElementIds: ['frame-1'] };

    const result = await insertMediaIntoSelectedFrame(
      board,
      'https://example.com/video.mp4',
      'video',
      { width: 800, height: 600 }
    );

    expect(result).toMatchObject({
      point: [240, 0],
      size: { width: 1440, height: 1080 },
    });
    expect(board.children[1]).toMatchObject({
      type: 'image',
      frameId: 'frame-1',
      isVideo: true,
      points: [
        [240, 0],
        [1680, 1080],
      ],
    });
  });

  it('binds and returns the image inserted after an interleaved canvas update', async () => {
    let finishImageLoad: (() => void) | undefined;

    class PendingImage {
      width = 800;
      height = 400;
      crossOrigin = '';
      referrerPolicy = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        finishImageLoad = () => this.onload?.();
      }
    }

    vi.stubGlobal('Image', PendingImage);

    const board = createBoard([createFrame()]);
    const insertion = insertMediaIntoFrame(
      board,
      'https://example.com/image.png',
      'image',
      'frame-1',
      { width: 1920, height: 1080 }
    );

    await vi.waitFor(() => expect(finishImageLoad).toBeTypeOf('function'));

    const interleavedElement = {
      id: 'interleaved-element',
      type: 'shape',
      frameId: 'other-frame',
      points: [
        [20, 30],
        [120, 130],
      ],
      children: [],
    };
    board.children.push(interleavedElement);

    finishImageLoad?.();
    const result = await insertion;
    const insertedImage = board.children.find(
      (element: any) => element.url === 'https://example.com/image.png'
    );

    expect(result).toMatchObject({
      elementId: insertedImage.id,
      point: [0, 60],
      size: { width: 1920, height: 960 },
    });
    expect(insertedImage).toMatchObject({
      frameId: 'frame-1',
      points: [
        [0, 60],
        [1920, 1020],
      ],
    });
    expect(interleavedElement).toEqual({
      id: 'interleaved-element',
      type: 'shape',
      frameId: 'other-frame',
      points: [
        [20, 30],
        [120, 130],
      ],
      children: [],
    });
  });

  it('does not insert a delayed Frame image after the board guard changes', async () => {
    let finishImageLoad: (() => void) | undefined;
    let isCurrentBoard = true;

    class PendingImage {
      width = 800;
      height = 400;
      crossOrigin = '';
      referrerPolicy = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        finishImageLoad = () => this.onload?.();
      }
    }

    vi.stubGlobal('Image', PendingImage);

    const board = createBoard([createFrame()]);
    const insertion = insertMediaIntoFrame(
      board,
      'https://example.com/delayed.png',
      'image',
      'frame-1',
      { width: 1920, height: 1080 },
      undefined,
      undefined,
      { boardGuard: () => isCurrentBoard }
    );

    await vi.waitFor(() => expect(finishImageLoad).toBeTypeOf('function'));
    isCurrentBoard = false;
    finishImageLoad?.();

    await expect(insertion).rejects.toThrow('画板已切换');
    expect(board.children).toEqual([createFrame()]);
  });

  it('binds and returns each concurrent image when loads finish out of order', async () => {
    const pendingLoads = new Map<string, () => void>();

    class PendingImage {
      width = 800;
      height = 400;
      crossOrigin = '';
      referrerPolicy = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        pendingLoads.set(value, () => this.onload?.());
      }
    }

    vi.stubGlobal('Image', PendingImage);

    const board = createBoard([createFrame()]);
    const firstUrl = 'https://example.com/first.png';
    const secondUrl = 'https://example.com/second.png';
    const firstInsertion = insertMediaIntoFrame(
      board,
      firstUrl,
      'image',
      'frame-1'
    );
    const secondInsertion = insertMediaIntoFrame(
      board,
      secondUrl,
      'image',
      'frame-1'
    );

    await vi.waitFor(() => expect(pendingLoads.size).toBe(2));

    pendingLoads.get(secondUrl)?.();
    const secondResult = await secondInsertion;
    pendingLoads.get(firstUrl)?.();
    const firstResult = await firstInsertion;
    const firstImage = board.children.find(
      (element: any) => element.url === firstUrl
    );
    const secondImage = board.children.find(
      (element: any) => element.url === secondUrl
    );

    expect(firstResult.elementId).toBe(firstImage.id);
    expect(secondResult.elementId).toBe(secondImage.id);
    expect(firstResult.elementId).not.toBe(secondResult.elementId);
    expect(firstImage.frameId).toBe('frame-1');
    expect(secondImage.frameId).toBe('frame-1');
  });
});
