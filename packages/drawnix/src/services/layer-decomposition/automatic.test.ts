import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startAutomaticLayerDecomposition } from './automatic';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  providerDecompose: vi.fn(),
  localDecompose: vi.fn(),
}));

vi.mock('./api', () => ({
  createLayerDecompositionApiClient: () => ({
    decompose: mocks.localDecompose,
  }),
  LayerDecompositionCorrectionRequiredError: class extends Error {
    constructor(readonly taskId: string, readonly phase?: string) {
      super('分层结果需要人工修正');
      this.name = 'LayerDecompositionCorrectionRequiredError';
    }
  },
}));

vi.mock('./provider', () => ({
  decomposeWithConfiguredImageProvider: mocks.providerDecompose,
  LayerDecompositionProviderUnsupportedError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'LayerDecompositionProviderUnsupportedError';
    }
  },
  SEEDREAM_LAYER_MODEL_ID: 'doubao-seedream-5-0-pro-260628',
}));

vi.mock('./canvas', () => ({
  insertLayerDecomposition: mocks.insert,
}));

function createBoard() {
  return {
    children: [
      {
        id: 'source-image',
        type: 'image',
        url: 'data:image/png;base64,cG5n',
      },
    ],
  } as any;
}

describe('automatic layer decomposition coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({});
    mocks.localDecompose.mockRejectedValue(new Error('local unavailable'));
  });

  it('同一画板和源图片的并发调用只提交并应用一次', async () => {
    let resolveDecomposition!: (value: any) => void;
    mocks.providerDecompose.mockReturnValue(
      new Promise((resolve) => {
        resolveDecomposition = resolve;
      })
    );
    const board = createBoard();

    const first = startAutomaticLayerDecomposition(
      board,
      'source-image',
      'data:image/png;base64,cG5n'
    );
    const duplicate = startAutomaticLayerDecomposition(
      board,
      'source-image',
      'data:image/png;base64,cG5n'
    );

    expect(first.started).toBe(true);
    expect(duplicate.started).toBe(false);
    expect(duplicate.promise).toBe(first.promise);
    await vi.waitFor(() =>
      expect(mocks.providerDecompose).toHaveBeenCalledTimes(1)
    );
    expect(mocks.providerDecompose).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'data:image/png;base64,cG5n',
        mode: 'auto',
        maxLayers: 16,
      }),
      expect.objectContaining({
        modelId: 'doubao-seedream-5-0-pro-260628',
      })
    );

    resolveDecomposition({
      groupId: 'group-1',
      background: { zIndex: 0 },
      layers: [{ zIndex: 1 }, { zIndex: 2 }],
      quality: { ssim: 0.9995, channelErrorRate: 0.0005, passed: true },
    });

    await expect(first.promise).resolves.toEqual({
      kind: 'applied',
      layerCount: 3,
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('本地 YOLO + SAM2 分层成功时优先使用本地结果，不调用 Seedream', async () => {
    mocks.localDecompose.mockResolvedValue({
      groupId: 'local-group',
      background: { zIndex: 0 },
      layers: [{ zIndex: 1 }, { zIndex: 2 }],
      quality: { ssim: 0.9995, channelErrorRate: 0.0005, passed: true },
    });
    const board = createBoard();

    await expect(
      startAutomaticLayerDecomposition(board, 'source-image', 'data:image/png;base64,cG5n').promise
    ).resolves.toEqual({ kind: 'applied', layerCount: 3 });
    expect(mocks.localDecompose).toHaveBeenCalledTimes(1);
    expect(mocks.providerDecompose).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('测试后端结果不写入画布', async () => {
    mocks.providerDecompose.mockResolvedValue({
      groupId: 'test-group',
      background: { zIndex: 0 },
      layers: [{ zIndex: 1 }],
      resultKind: 'test',
    });
    const board = createBoard();

    const launch = startAutomaticLayerDecomposition(
      board,
      'source-image',
      'data:image/png;base64,cG5n'
    );

    await expect(launch.promise).resolves.toEqual({ kind: 'test' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('原生 Provider 失败时保留源图且不回退本地分层', async () => {
    mocks.providerDecompose.mockRejectedValue(new Error('unsupported'));
    const board = createBoard();

    const launch = startAutomaticLayerDecomposition(
      board,
      'source-image',
      'data:image/png;base64,cG5n'
    );

    await expect(launch.promise).rejects.toThrow(
      'Seedream 5.0 Pro 兜底分层失败：unsupported'
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('未找到可用 Seedream Provider 时返回可操作提示', async () => {
    mocks.providerDecompose.mockResolvedValue(null);
    const board = createBoard();

    await expect(
      startAutomaticLayerDecomposition(
        board,
        'source-image',
        'data:image/png;base64,cG5n'
      ).promise
    ).rejects.toThrow('未找到可调用的 Seedream 5.0 Pro 图片 Provider');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('未通过重合成质量门禁时保留源图', async () => {
    mocks.providerDecompose.mockResolvedValue({
      groupId: 'low-quality',
      background: { zIndex: 0 },
      layers: [{ zIndex: 1 }],
      quality: { ssim: 0.98, channelErrorRate: 0.02, passed: false },
    });
    const board = createBoard();

    const launch = startAutomaticLayerDecomposition(
      board,
      'source-image',
      'data:image/png;base64,cG5n'
    );

    await expect(launch.promise).rejects.toMatchObject({
      name: 'LayerDecompositionCorrectionRequiredError',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('整图回退或空前景时不提交伪分层结果', async () => {
    mocks.providerDecompose.mockResolvedValue({
      groupId: 'fallback-group',
      background: { zIndex: 0 },
      layers: [{ zIndex: 1 }],
      decisions: ['fallback_full_canvas'],
      quality: { ssim: 1, channelErrorRate: 0, passed: true },
    });
    const board = createBoard();

    await expect(
      startAutomaticLayerDecomposition(
        board,
        'source-image',
        'data:image/png;base64,cG5n'
      ).promise
    ).rejects.toMatchObject({
      name: 'LayerDecompositionCorrectionRequiredError',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('源元素换图后允许新任务独立提交', async () => {
    let resolveFirst!: (value: any) => void;
    mocks.providerDecompose
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValueOnce({
        groupId: 'group-2',
        background: { zIndex: 0 },
        layers: [{ zIndex: 1 }],
        quality: { ssim: 0.9995, channelErrorRate: 0.0005, passed: true },
      });
    const board = createBoard();
    const first = startAutomaticLayerDecomposition(
      board,
      'source-image',
      'data:image/png;base64,cG5n'
    );
    board.children[0].url = 'data:image/png;base64,bmV3';
    const second = startAutomaticLayerDecomposition(
      board,
      'source-image',
      'data:image/png;base64,bmV3'
    );

    expect(second.started).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.providerDecompose).toHaveBeenCalledTimes(2)
    );
    await expect(second.promise).resolves.toEqual({
      kind: 'applied',
      layerCount: 2,
    });
    resolveFirst({
      groupId: 'group-1',
      background: { zIndex: 0 },
      layers: [],
      quality: { ssim: 0.9995, channelErrorRate: 0.0005, passed: true },
    });
    await expect(first.promise).rejects.toThrow('源图片已变化');
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
});
