import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSemanticReplacementGenerationPrompt,
  createSemanticForegroundEditMask,
  prepareSemanticForegroundReplacement,
  resolveSemanticForegroundTarget,
} from './semantic-layer-edit';

const mocks = vi.hoisted(() => ({
  decompose: vi.fn(),
  cacheRemoteUrl: vi.fn(),
  getCachedImageBlobWithThumbnailFallback: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
  loadImageElementForCanvas: vi.fn(),
  candidatePrompt: vi.fn(),
}));

vi.mock('./api', () => ({
  createLayerDecompositionApiClient: () => ({ decompose: mocks.decompose }),
}));

vi.mock('../media-executor/fallback-utils', () => ({
  cacheRemoteUrl: mocks.cacheRemoteUrl,
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedImageBlobWithThumbnailFallback:
      mocks.getCachedImageBlobWithThumbnailFallback,
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
  },
}));

vi.mock('../../data/image', () => ({
  loadImageElementForCanvas: mocks.loadImageElementForCanvas,
}));

vi.mock('./provider', () => ({
  createConfiguredProviderCandidatePrompt: mocks.candidatePrompt,
  decomposeWithConfiguredImageProvider: vi.fn().mockResolvedValue(null),
  SEEDREAM_LAYER_MODEL_ID: 'doubao-seedream-5-0-pro-260628',
}));

const semanticLayer = {
  schemaVersion: 1 as const,
  providerGroupId: 'source-group',
  kind: 'foreground' as const,
  zIndex: 1,
  name: '人物',
  description: '中央人物',
  confidence: 0.96,
  boundingBox: {
    absolute: [10, 20, 90, 180] as [number, number, number, number],
    normalized: [100, 100, 900, 900] as [number, number, number, number],
  },
};

function transparentPngBytes(): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[25] = 6;
  return bytes;
}

function transparentPngHeader(): Blob {
  return new Blob([transparentPngBytes()], { type: 'image/png' });
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    groupId: 'edit-group',
    resultKind: 'inference',
    width: 100,
    height: 200,
    background: { zIndex: 0 },
    layers: [
      {
        groupId: 'edit-group',
        url: '/api/layer-decompositions/task/assets/layers/01.png',
        zIndex: 1,
        boundingBox: {
          absolute: [10, 20, 90, 180],
          normalized: [100, 100, 900, 900],
        },
        name: '人物',
        description: '中央人物',
      },
    ],
    quality: { ssim: 0.9995, channelErrorRate: 0.0005, passed: true },
    decisions: [],
    ...overrides,
  };
}

describe('semantic foreground replacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decompose.mockResolvedValue(result());
    mocks.candidatePrompt.mockResolvedValue(
      '__opentu_layer_candidates__{"candidates":[{"bbox":[50,50,950,950]}]}'
    );
    mocks.cacheRemoteUrl.mockResolvedValue(
      '/__aitu_cache__/image/semantic-layer-edit-task-1_1.png'
    );
    mocks.getCachedImageBlobWithThumbnailFallback.mockResolvedValue(
      transparentPngHeader()
    );
    mocks.loadImageElementForCanvas.mockResolvedValue({
      naturalWidth: 80,
      naturalHeight: 160,
      width: 80,
      height: 160,
    });
    mocks.cacheMediaFromBlob.mockImplementation(async (url: string) => url);
  });

  it('按原语义边界二次抠图并返回本地透明 PNG', async () => {
    await expect(
      prepareSemanticForegroundReplacement(
        '/__aitu_cache__/image/generated.png',
        'task-1',
        semanticLayer
      )
    ).resolves.toMatchObject({
      url: '/__aitu_cache__/image/semantic-layer-edit-task-1_1.png',
      width: 100,
      height: 200,
      layer: expect.objectContaining({
        name: '人物',
        url: '/__aitu_cache__/image/semantic-layer-edit-task-1_1.png',
      }),
    });

    expect(mocks.decompose).toHaveBeenCalledWith(
      expect.objectContaining({
        image: '/__aitu_cache__/image/generated.png',
        maxLayers: 1,
        prompt: expect.stringContaining('__opentu_layer_candidates__'),
      }),
      expect.any(Object)
    );
    expect(mocks.candidatePrompt).toHaveBeenCalledWith(
      '/__aitu_cache__/image/generated.png',
      undefined,
      {
        editInstruction: undefined,
        excludedTargetName: '人物',
        excludedTargetDescription: '中央人物',
        maxCandidates: 1,
      }
    );
    expect(mocks.cacheRemoteUrl).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/layer-decompositions/task/assets/layers/01.png'
      ),
      'semantic-layer-edit-task-1',
      'image',
      'png',
      1,
      expect.objectContaining({
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
      })
    );
  });

  it('按新编辑意图定位新主体，不再按旧主体名称定位', async () => {
    await prepareSemanticForegroundReplacement(
      '/__aitu_cache__/image/generated.png',
      'task-1',
      semanticLayer,
      { editPrompt: '把猫替换成兔子' }
    );

    expect(mocks.candidatePrompt).toHaveBeenCalledWith(
      '/__aitu_cache__/image/generated.png',
      undefined,
      expect.objectContaining({
        editInstruction: '把猫替换成兔子',
        excludedTargetName: '人物',
      })
    );
  });

  it.each([
    ['测试结果', { resultKind: 'test' }],
    ['整图回退', { decisions: ['fallback_full_canvas'] }],
    [
      '质量失败',
      {
        quality: { ssim: 0.98, channelErrorRate: 0.02, passed: false },
      },
    ],
    ['没有唯一前景', { layers: [] }],
  ])('%s 时拒绝替换且不缓存', async (_label, overrides) => {
    mocks.decompose.mockResolvedValue(result(overrides));

    await expect(
      prepareSemanticForegroundReplacement(
        '/__aitu_cache__/image/generated.png',
        'task-1',
        semanticLayer
      )
    ).rejects.toThrow('原图层保持不变');
    expect(mocks.cacheRemoteUrl).not.toHaveBeenCalled();
  });

  it('拒绝没有 Alpha 通道或尺寸与 bbox 不一致的产物', async () => {
    const rgbHeader = transparentPngBytes();
    rgbHeader[25] = 2;
    mocks.getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(
      new Blob([rgbHeader], { type: 'image/png' })
    );

    await expect(
      prepareSemanticForegroundReplacement(
        '/__aitu_cache__/image/generated.png',
        'task-1',
        semanticLayer
      )
    ).rejects.toThrow('Alpha');

    mocks.getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(
      transparentPngHeader()
    );
    mocks.loadImageElementForCanvas.mockResolvedValueOnce({
      naturalWidth: 100,
      naturalHeight: 200,
    });
    await expect(
      prepareSemanticForegroundReplacement(
        '/__aitu_cache__/image/generated.png',
        'task-2',
        semanticLayer
      )
    ).rejects.toThrow('尺寸');
  });
});

describe('semantic foreground edit input', () => {
  it('分层组只有一个前景时自动绑定该前景，多前景时保持组选择', () => {
    const foreground = {
      id: 'foreground',
      type: 'image',
      groupId: 'group',
      url: '/foreground.png',
      metadata: { semanticLayer },
    } as any;
    const group = {
      id: 'group',
      type: 'group',
      metadata: {
        semanticLayerGroup: { providerGroupId: 'source-group' },
      },
    } as any;
    const board = { children: [foreground, group] } as any;

    expect(resolveSemanticForegroundTarget(board, group)).toBe(foreground);

    board.children.splice(1, 0, {
      ...foreground,
      id: 'foreground-2',
    });
    expect(resolveSemanticForegroundTarget(board, group)).toBe(group);
  });

  it('多前景组根据替换提示自动绑定被替换的旧主体', () => {
    const cat = {
      id: 'cat',
      type: 'image',
      groupId: 'group',
      url: '/cat.png',
      metadata: {
        semanticLayer: {
          ...semanticLayer,
          name: '猫',
          description: '中央的灰色宠物猫',
        },
      },
    } as any;
    const plant = {
      id: 'plant',
      type: 'image',
      groupId: 'group',
      url: '/plant.png',
      metadata: {
        semanticLayer: {
          ...semanticLayer,
          zIndex: 2,
          name: '植物',
          description: '左侧绿植',
        },
      },
    } as any;
    const group = {
      id: 'group',
      type: 'group',
      metadata: {
        semanticLayerGroup: { providerGroupId: 'source-group' },
      },
    } as any;
    const board = { children: [cat, plant, group] } as any;

    expect(
      resolveSemanticForegroundTarget(board, group, '把猫替换成兔子')
    ).toBe(cat);
    expect(
      resolveSemanticForegroundTarget(board, group, '把植物换成花瓶')
    ).toBe(plant);
    expect(resolveSemanticForegroundTarget(board, group, '调整画面')).toBe(
      group
    );
  });

  it('从干净背景创建蒙版，并扩张旧主体编辑区域', async () => {
    mocks.getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(null);
    mocks.loadImageElementForCanvas.mockResolvedValueOnce({
      naturalWidth: 100,
      naturalHeight: 200,
      width: 100,
      height: 200,
    });
    const clearRect = vi.fn();
    const fillRect = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect, clearRect }),
      toBlob: (callback: (blob: Blob) => void) =>
        callback(new Blob(['png'], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement);

    const url = await createSemanticForegroundEditMask({
      foregroundElementId: 'foreground',
      foregroundUrl: '/old-cat.png',
      backgroundElementId: 'background',
      backgroundUrl: '/clean-background.png',
      semanticLayer,
    });

    expect(url).toContain('semantic-replace-mask-source-group-1');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 200);
    expect(clearRect).toHaveBeenCalledWith(6, 16, 88, 168);
    expect(mocks.loadImageElementForCanvas).toHaveBeenCalledWith(
      '/clean-background.png'
    );
  });

  it('替换提示明确禁止旧主体残留', () => {
    const prompt = buildSemanticReplacementGenerationPrompt(
      '把猫替换成兔子',
      '猫',
      '灰色宠物猫'
    );
    expect(prompt).toContain('干净背景');
    expect(prompt).toContain('把猫替换成兔子');
    expect(prompt).toContain('禁止恢复旧主体');
    expect(prompt).toContain('尾巴');
  });
});
