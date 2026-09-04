import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConfiguredProviderCandidatePrompt,
  decomposeWithConfiguredImageProvider,
  inspectGeneratedImageArtifacts,
  parseGeneratedArtifactInspection,
  LayerDecompositionProviderUnsupportedError,
} from './provider';

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  send: vi.fn(),
  waitForInitialization: vi.fn(),
  supportsImageInput: vi.fn(),
  buildTextConfig: vi.fn(),
  callText: vi.fn(),
  extractJsonObjects: vi.fn(),
  resolveRoute: vi.fn(),
}));

vi.mock('../../utils/settings-manager', () => ({
  settingsManager: {
    waitForInitialization: mocks.waitForInitialization,
  },
  resolveInvocationRoute: mocks.resolveRoute,
  createModelRef: (profileId: string, modelId: string) => ({
    profileId,
    modelId,
  }),
}));

vi.mock('../model-adapters/context', () => ({
  getAdapterContextFromSettings: mocks.getContext,
  sendAdapterRequest: mocks.send,
}));

vi.mock('../provider-routing', () => ({
  readProviderResponseJson: (response: Response) => response.json(),
}));

vi.mock('../provider-routing/text-binding-capabilities', () => ({
  supportsTextBindingImageInput: mocks.supportsImageInput,
}));

vi.mock('../analysis-core', () => ({
  buildAnalysisTextConfig: mocks.buildTextConfig,
  extractJsonObjects: mocks.extractJsonObjects,
}));

vi.mock('../../utils/gemini-api/apiCalls', () => ({
  callApiWithRetry: mocks.callText,
}));

function context(
  layerDecomposition?: boolean,
  modelId = 'private-layer-model'
) {
  return {
    baseUrl: 'https://api.example.com/v1',
    binding: {
      modelId,
      protocol: 'openai.images.generations',
      submitPath: '/images/generations',
      metadata:
        layerDecomposition === undefined
          ? {}
          : { layerDecomposition: { enabled: layerDecomposition } },
    },
  };
}

function request() {
  return {
    image: 'data:image/png;base64,cG5n',
    mode: 'auto' as const,
    maxLayers: 16,
  };
}

describe('configured image provider layer decomposition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitForInitialization.mockResolvedValue(undefined);
    mocks.supportsImageInput.mockReturnValue(false);
    mocks.extractJsonObjects.mockImplementation((value: string) => [value]);
    mocks.resolveRoute.mockReturnValue({
      profileId: 'profile-1',
      modelId: 'private-layer-model',
    });
  });

  it('普通图片 binding 不会被调用', async () => {
    mocks.getContext.mockReturnValue(context());

    await expect(
      decomposeWithConfiguredImageProvider(request())
    ).resolves.toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('Seedream 5.0 Pro 未声明能力时也会优先尝试原生分层请求', async () => {
    mocks.getContext.mockReturnValue(
      context(undefined, 'doubao-seedream-5-0-pro-260628')
    );
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              url: 'https://cdn.example.com/background.png',
              z_index: 0,
            },
            {
              url: 'https://cdn.example.com/subject.png',
              z_index: 1,
              bounding_box: {
                absolute: [10, 10, 90, 90],
                normalized: [100, 100, 900, 900],
              },
            },
          ],
          quality: {
            ssim: 1,
            channel_error_rate: 0,
            passed: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      decomposeWithConfiguredImageProvider(request(), {
        modelId: 'doubao-seedream-5-0-pro-260628',
      })
    ).resolves.toMatchObject({ layers: [{ zIndex: 1 }] });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toMatchObject({
      model: 'doubao-seedream-5-0-pro-260628',
      layer_decomposition: true,
      size: 'auto',
      response_format: 'url',
      output_format: 'png',
      watermark: false,
    });
    expect(mocks.send.mock.calls[0][1].timeoutMs).toBe(180_000);
  });

  it('可以显式指定 Seedream 5.0 Pro，而不依赖当前选中的普通图片模型', async () => {
    mocks.getContext.mockReturnValue(
      context(undefined, 'doubao-seedream-5-0-pro-260628')
    );
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { url: 'https://cdn.example.com/background.png', z_index: 0 },
            {
              url: 'https://cdn.example.com/subject.png',
              z_index: 1,
              bounding_box: {
                absolute: [10, 10, 90, 90],
                normalized: [100, 100, 900, 900],
              },
            },
          ],
          quality: { ssim: 1, channel_error_rate: 0, passed: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      decomposeWithConfiguredImageProvider(request(), {
        modelId: 'doubao-seedream-5-0-pro-260628',
      })
    ).resolves.toMatchObject({ layers: [{ zIndex: 1 }] });
    expect(JSON.parse(mocks.send.mock.calls[0][1].body).model).toBe(
      'doubao-seedream-5-0-pro-260628'
    );
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toMatchObject({
      size: 'auto',
      response_format: 'url',
      output_format: 'png',
      watermark: false,
    });
  });

  it('Seedream 5.0 Pro 缺少 binding 元数据时仍会发起分层请求', async () => {
    mocks.getContext.mockReturnValue({
      baseUrl: 'https://api.example.com/v1',
      binding: null,
    });
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { url: 'https://cdn.example.com/background.png', z_index: 0 },
            {
              url: 'https://cdn.example.com/subject.png',
              z_index: 1,
              bounding_box: {
                absolute: [10, 10, 90, 90],
                normalized: [100, 100, 900, 900],
              },
            },
          ],
          quality: { ssim: 1, channel_error_rate: 0, passed: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      decomposeWithConfiguredImageProvider(request(), {
        modelId: 'doubao-seedream-5-0-pro-260628',
      })
    ).resolves.toMatchObject({ layers: [{ zIndex: 1 }] });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('固定 Seedream 未单独绑定时复用当前图片 Provider', async () => {
    mocks.resolveRoute.mockImplementation(
      (_routeType: string, requestedModelId?: string) =>
        requestedModelId
          ? {
              profileId: null,
              modelId: requestedModelId,
              baseUrl: 'https://legacy.example.com/v1',
            }
          : {
              profileId: 'active-profile',
              modelId: 'active-image-model',
              baseUrl: 'https://active.example.com/v1',
            }
    );
    const legacyContext = {
      baseUrl: 'https://legacy.example.com/v1',
      apiKey: 'legacy-key',
      binding: null,
    };
    const activeContext = {
      baseUrl: 'https://active.example.com/v1',
      apiKey: 'active-key',
      binding: null,
    };
    mocks.getContext
      .mockReturnValueOnce(legacyContext)
      .mockReturnValueOnce(activeContext);
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { url: 'https://cdn.example.com/background.png', z_index: 0 },
            {
              url: 'https://cdn.example.com/subject.png',
              z_index: 1,
              bounding_box: {
                absolute: [10, 10, 90, 90],
                normalized: [100, 100, 900, 900],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      decomposeWithConfiguredImageProvider(request(), {
        modelId: 'doubao-seedream-5-0-pro-260628',
      })
    ).resolves.toMatchObject({ layers: [{ zIndex: 1 }] });

    expect(mocks.send).toHaveBeenCalledWith(
      activeContext,
      expect.objectContaining({ path: '/images/generations' })
    );
  });

  it('按官方响应格式接受缺少质量字段的原生图层结果', async () => {
    mocks.getContext.mockReturnValue(
      context(undefined, 'doubao-seedream-5-0-pro-260628')
    );
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'doubao-seedream-5-0-pro-260628',
          data: [
            {
              url: 'https://cdn.example.com/base.png',
              size: '2048x1365',
              z_index: 0,
              output_format: 'png',
            },
            {
              url: 'https://cdn.example.com/subject.png',
              size: '842x1200',
              z_index: 1,
              bounding_box: {
                absolute: [603, 85, 1445, 1285],
                normalized: [294, 62, 706, 941],
              },
              name: '主体',
              description: '原图中的主要主体',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await decomposeWithConfiguredImageProvider(request(), {
      modelId: 'doubao-seedream-5-0-pro-260628',
    });

    expect(result).toMatchObject({
      width: 2048,
      height: 1365,
      quality: { ssim: 1, channelErrorRate: 0, passed: true },
      background: {
        boundingBox: {
          absolute: [0, 0, 2048, 1365],
          normalized: [0, 0, 1000, 1000],
        },
      },
      layers: [{ zIndex: 1 }],
    });
  });

  it('显式支持时复用当前 provider 并解析真实图层', async () => {
    mocks.getContext.mockReturnValue(context(true));
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'provider-group',
          data: [
            {
              url: 'https://cdn.example.com/background.png',
              z_index: 0,
              name: '背景',
            },
            {
              url: 'https://cdn.example.com/person.png',
              z_index: 1,
              name: '人物',
              description: '主体人物',
              bounding_box: {
                absolute: [10, 20, 90, 100],
                normalized: [100, 200, 900, 1000],
              },
            },
          ],
          quality: {
            ssim: 0.9995,
            channel_error_within_one_ratio: 0.9995,
            passed: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await decomposeWithConfiguredImageProvider(request());

    expect(result?.groupId).toBe('provider-group');
    expect(result?.layers).toHaveLength(1);
    const sent = mocks.send.mock.calls[0][1];
    expect(JSON.parse(sent.body)).toMatchObject({
      model: 'private-layer-model',
      layer_decomposition: true,
      image: 'data:image/png;base64,cG5n',
    });
  });

  it('原生响应没有通过质量门禁时拒绝写入', async () => {
    mocks.getContext.mockReturnValue(context(true));
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { url: 'https://cdn.example.com/background.png', z_index: 0 },
            {
              url: 'https://cdn.example.com/person.png',
              z_index: 1,
              bounding_box: {
                absolute: [10, 20, 90, 100],
                normalized: [100, 200, 900, 1000],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      decomposeWithConfiguredImageProvider(request())
    ).rejects.toBeInstanceOf(LayerDecompositionProviderUnsupportedError);
  });

  it('不会把普通多图响应伪装为图层', async () => {
    mocks.getContext.mockReturnValue(context(true));
    mocks.send.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { url: 'https://cdn.example.com/one.png' },
            { url: 'https://cdn.example.com/two.png' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      decomposeWithConfiguredImageProvider(request())
    ).rejects.toBeInstanceOf(LayerDecompositionProviderUnsupportedError);
  });

  it('复用当前视觉文本模型生成有界候选，不传递凭据', async () => {
    mocks.supportsImageInput.mockReturnValue(true);
    mocks.buildTextConfig.mockResolvedValue({ binding: { id: 'vision' } });
    const modelJson = JSON.stringify({
      objects: [
        {
          name: '人物',
          description: '中央人物',
          bbox: [100, 80, 900, 980],
          confidence: 0.93,
        },
      ],
    });
    mocks.extractJsonObjects.mockReturnValue([modelJson]);
    mocks.callText.mockResolvedValue({
      choices: [{ message: { content: modelJson } }],
    });

    const prompt = await createConfiguredProviderCandidatePrompt(
      'data:image/png;base64,cG5n'
    );

    expect(prompt).toContain('__opentu_layer_candidates__');
    expect(prompt).toContain('"bbox":[100,80,900,980]');
    const sentMessages = mocks.callText.mock.calls[0][1];
    expect(sentMessages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,cG5n' },
    });
  });

  it('只接受高置信度且有边界的瑕疵诊断', () => {
    expect(
      parseGeneratedArtifactInspection(
        '{"needsRepair":true,"boxes":[[100,200,300,400]],"confidence":0.91,"reason":"多余耳缘"}'
      )
    ).toEqual({
      needsRepair: true,
      boxes: [[100, 200, 300, 400]],
      confidence: 0.91,
      reason: '多余耳缘',
    });
    expect(
      parseGeneratedArtifactInspection(
        '{"needsRepair":true,"boxes":[[100,200,300,400]],"confidence":0.4}'
      )
    ).toMatchObject({ needsRepair: false, boxes: [] });
  });

  it('主体替换检查明确识别旧主体残留', async () => {
    mocks.supportsImageInput.mockReturnValue(true);
    mocks.buildTextConfig.mockResolvedValue({ binding: { id: 'vision' } });
    const inspectionJson =
      '{"needsRepair":true,"boxes":[[400,700,600,900]],"confidence":0.93,"reason":"残留猫尾"}';
    mocks.extractJsonObjects.mockReturnValue([inspectionJson]);
    mocks.callText.mockResolvedValue({
      choices: [{ message: { content: inspectionJson } }],
    });

    await inspectGeneratedImageArtifacts(
      'data:image/png;base64,cG5n',
      undefined,
      {
        editInstruction: '把猫替换成兔子',
        excludedTargetName: '猫',
        excludedTargetDescription: '灰色宠物猫',
      }
    );

    const text = mocks.callText.mock.calls[0][1][0].content[0].text;
    expect(text).toContain('原主体“猫”');
    expect(text).toContain('尾巴');
    expect(text).toContain('必须将残留区域标记为待修复伪影');
  });

  it('视觉模型不可用时跳过瑕疵检查', async () => {
    mocks.buildTextConfig.mockResolvedValue({ binding: {} });
    mocks.supportsImageInput.mockReturnValue(false);
    await expect(
      inspectGeneratedImageArtifacts('data:image/png;base64,cG5n')
    ).resolves.toBeUndefined();
    expect(mocks.callText).not.toHaveBeenCalled();
  });
});
