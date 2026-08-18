import { createTestingBoard } from '@plait/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PPTOutline } from '../../../services/ppt';
import { setBoard } from '../shared';
import {
  generatePPT,
  materializePPTOutline,
  pptGenerationTool,
  removePptExplainerOwnedOutline,
} from '../ppt-generation';

const mocks = vi.hoisted(() => ({
  sendChat: vi.fn(),
}));

vi.mock('../../../utils/gemini-api', () => ({
  defaultGeminiClient: {
    sendChat: mocks.sendChat,
  },
}));

vi.mock('../../../services/unified-cache-service', () => ({
  CacheStatus: {
    IDLE: 'idle',
    LOADING: 'loading',
    CACHED: 'cached',
    ERROR: 'error',
  },
  unifiedCacheService: {
    subscribe: vi.fn(() => vi.fn()),
    getCacheStatus: vi.fn(() => 'idle'),
    getCachedBlob: vi.fn(),
    getCachedUrl: vi.fn(),
    getAllCachedUrls: vi.fn(() => []),
    getStorageUsage: vi.fn(() => Promise.resolve({ used: 0, quota: 0 })),
    formatSize: vi.fn((size) => `${size}`),
  },
}));

vi.mock('../../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-provider',
  settingsManager: {
    getSetting: vi.fn(),
    updateSettings: vi.fn(),
    updateSetting: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    getActiveInvocationPreset: vi.fn(() => null),
    resolveInvocationRoute: vi.fn(() => null),
    hasInvocationRouteCredentials: vi.fn(() => false),
    updateActiveInvocationRouteModel: vi.fn(),
  },
  geminiSettings: {
    get: () => ({
      textModelName: 'mock-text-model',
    }),
    update: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  ttsSettings: {
    get: vi.fn(() => ({})),
    update: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  providerProfilesSettings: {
    get: vi.fn(() => []),
    update: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  providerCatalogsSettings: {
    get: vi.fn(() => []),
    update: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  providerPricingCacheSettings: {
    get: vi.fn(() => []),
    update: vi.fn(),
  },
  invocationPresetsSettings: {
    get: vi.fn(() => []),
    update: vi.fn(),
    getActivePresetId: vi.fn(() => null),
    setActivePresetId: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  getActiveInvocationPreset: vi.fn(() => null),
  resolveInvocationRoute: vi.fn(() => null),
  hasInvocationRouteCredentials: vi.fn(() => false),
  updateActiveInvocationRouteModel: vi.fn(),
}));

function createFrame(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'frame',
    name: id,
    points: [
      [0, 0],
      [1920, 1080],
    ],
    children: [],
    ...overrides,
  };
}

function mockOutlineResponse() {
  mocks.sendChat.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: '新产品发布',
            styleSpec: {
              visualStyle: 'premium launch deck',
              colorPalette: 'white background, black text, blue accent',
              typography: 'bold title, readable body',
              layout: 'stable grid with visual anchor',
              decorativeElements: 'thin blue lines and cards',
              avoid: 'avoid mixed style',
            },
            pages: [
              { layout: 'cover', title: '新品发布' },
              {
                layout: 'title-body',
                title: '核心亮点',
                bullets: ['性能全面提升', '体验更加稳定'],
              },
              { layout: 'ending', title: '谢谢' },
            ],
          }),
        },
      },
    ],
  });
}

describe('ppt-generation MCP tool', () => {
  beforeEach(() => {
    mocks.sendChat.mockReset();
    mockOutlineResponse();
  });

  afterEach(() => {
    setBoard(null);
  });

  it('replaces existing PPT outline instead of appending to it', async () => {
    const board = createTestingBoard(
      [],
      [
        createFrame('regular-frame'),
        createFrame('old-ppt-frame', {
          pptMeta: {
            pageIndex: 1,
            slidePrompt: 'old slide prompt',
            slideImageElementId: 'old-slide-image',
            slideImageHistory: [
              {
                id: 'history-1',
                imageUrl: 'https://example.com/history.png',
                elementId: 'old-history-image',
                createdAt: 1,
              },
            ],
          },
        }),
        {
          id: 'old-bound-note',
          type: 'text',
          frameId: 'old-ppt-frame',
        },
        {
          id: 'old-slide-image',
          type: 'image',
          frameId: 'old-ppt-frame',
          pptSlideImage: true,
        },
        {
          id: 'old-history-image',
          type: 'image',
          pptSlideImage: true,
        },
      ]
    ) as any;
    setBoard(board);

    const chunks: string[] = [];
    const result = await pptGenerationTool.execute(
      {
        topic: '新产品发布',
        pageCount: 'short',
        language: '中文',
      },
      {
        onChunk: (chunk) => chunks.push(chunk),
      }
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        pageCount: 3,
      },
    });
    expect(
      board.children.some((element: any) => element.id === 'regular-frame')
    ).toBe(true);
    expect(
      board.children.some((element: any) => element.id === 'old-ppt-frame')
    ).toBe(false);
    expect(
      board.children.some((element: any) => element.id === 'old-bound-note')
    ).toBe(false);
    expect(
      board.children.some((element: any) => element.id === 'old-slide-image')
    ).toBe(false);
    expect(
      board.children.some((element: any) => element.id === 'old-history-image')
    ).toBe(false);

    const pptFrames = board.children.filter((element: any) => element.pptMeta);
    expect(pptFrames).toHaveLength(3);
    expect(pptFrames.map((frame: any) => frame.pptMeta.pageIndex)).toEqual([
      1, 2, 3,
    ]);
    expect(chunks.join('')).toContain('已替换画布中原有 1 个 PPT 页面');
  });

  it('stores lightweight reference image URLs for generated PPT slides', async () => {
    const board = createTestingBoard([], []) as any;
    setBoard(board);

    const chunks: string[] = [];
    const result = await pptGenerationTool.execute(
      {
        topic: '新产品发布',
        pageCount: 'short',
        language: '中文',
        referenceImages: [
          'https://example.com/reference.png',
          'data:image/png;base64,large-inline-image',
        ],
      },
      {
        onChunk: (chunk) => chunks.push(chunk),
      }
    );

    expect(result.success).toBe(true);
    expect(chunks.join('')).toContain('已关联 1 张参考图片');

    const pptFrames = board.children.filter((element: any) => element.pptMeta);
    expect(pptFrames).toHaveLength(3);
    pptFrames.forEach((frame: any) => {
      expect(frame.pptMeta.referenceImages).toEqual([
        'https://example.com/reference.png',
      ]);
      expect(frame.pptMeta.commonPrompt).toContain('参考图片配图规则');
      expect(frame.pptMeta.slidePrompt).toContain('参考图片策略');
    });
  });

  it('marks and restores an explainer-owned outline without another model call', async () => {
    const board = createTestingBoard([], []) as any;
    setBoard(board);

    const result = await generatePPT(
      { topic: '新产品发布', pageCount: 'short', language: '中文' },
      { pptExplainerJobId: 'job-a' }
    );
    expect(result.success).toBe(true);
    expect(
      board.children
        .filter((element: any) => element.pptMeta)
        .map((frame: any) => frame.pptMeta.pptExplainerJobId)
    ).toEqual(['job-a', 'job-a', 'job-a']);

    const outline = (result.data as { outline: PPTOutline }).outline;
    mocks.sendChat.mockClear();
    materializePPTOutline(
      board,
      outline,
      { topic: '新产品发布' },
      {
        pptExplainerJobId: 'job-b',
        focusFirstFrame: false,
        openEditor: false,
      }
    );

    expect(mocks.sendChat).not.toHaveBeenCalled();
    expect(
      board.children
        .filter((element: any) => element.pptMeta)
        .map((frame: any) => frame.pptMeta.pptExplainerJobId)
    ).toEqual(['job-b', 'job-b', 'job-b']);
  });

  it('preserves existing PPT pages when an explainer adds another deck', async () => {
    const board = createTestingBoard([], []) as any;
    setBoard(board);

    const result = await generatePPT(
      { topic: '已有方案', pageCount: 'short', language: '中文' },
      { pptExplainerJobId: 'job-a' }
    );
    const originalFrameIds = board.children
      .filter((element: any) => element.pptMeta)
      .map((frame: any) => frame.id);
    const outline = (result.data as { outline: PPTOutline }).outline;

    materializePPTOutline(
      board,
      outline,
      { topic: '新增方案' },
      {
        pptExplainerJobId: 'job-b',
        replaceExistingPpt: false,
        focusFirstFrame: false,
        openEditor: false,
      }
    );

    const frames = board.children.filter((element: any) => element.pptMeta);
    expect(frames).toHaveLength(6);
    expect(frames.slice(0, 3).map((frame: any) => frame.id)).toEqual(
      originalFrameIds
    );
    expect(frames.map((frame: any) => frame.pptMeta.pptExplainerJobId)).toEqual(
      ['job-a', 'job-a', 'job-a', 'job-b', 'job-b', 'job-b']
    );
  });

  it('removes only the incomplete outline owned by one explainer task', async () => {
    const board = createTestingBoard([], []) as any;
    setBoard(board);

    const result = await generatePPT(
      { topic: '已有方案', pageCount: 'short', language: '中文' },
      { pptExplainerJobId: 'job-a' }
    );
    const outline = (result.data as { outline: PPTOutline }).outline;
    materializePPTOutline(
      board,
      outline,
      { topic: '保留方案' },
      {
        pptExplainerJobId: 'job-b',
        replaceExistingPpt: false,
        focusFirstFrame: false,
        openEditor: false,
      }
    );

    expect(removePptExplainerOwnedOutline(board, 'job-a')).toBe(3);
    expect(
      board.children
        .filter((element: any) => element.pptMeta)
        .map((frame: any) => frame.pptMeta.pptExplainerJobId)
    ).toEqual(['job-b', 'job-b', 'job-b']);
  });
});
