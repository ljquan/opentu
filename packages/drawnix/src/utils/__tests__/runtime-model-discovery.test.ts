import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime-model-discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('不会把图片模型钉到音频类型列表里', async () => {
    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [
          {
            profileId: 'provider-image',
            discoveredAt: Date.now(),
            discoveredModels: [
              {
                id: 'gemini-3-pro-image-preview',
                label: 'Gemini Image',
                shortLabel: 'Gemini Image',
                shortCode: 'gmi',
                type: 'image',
                vendor: 'GEMINI',
              },
            ],
            selectedModelIds: ['gemini-3-pro-image-preview'],
          },
        ],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-image',
            name: '图片供应商',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { getPinnedSelectableModel } = await import(
      '../runtime-model-discovery'
    );

    expect(
      getPinnedSelectableModel('audio', 'gemini-3-pro-image-preview', {
        profileId: 'provider-image',
        modelId: 'gemini-3-pro-image-preview',
      })
    ).toBeNull();
  });

  it('主流最新静态模型可被初始选择器解析', async () => {
    const { getStaticModelConfig } = await import(
      '../../constants/model-config'
    );

    expect(getStaticModelConfig('gpt-5.1')?.type).toBe('text');
    expect(getStaticModelConfig('claude-sonnet-4-6')?.type).toBe('text');
    expect(getStaticModelConfig('seedream-v4')?.type).toBe('image');
    expect(getStaticModelConfig('veo3-fast-frames')?.type).toBe('video');
  });

  it('默认选择器隐藏旧 GPT 入口但仍可钉住历史选择', async () => {
    const { getPinnedSelectableModel, getSelectableModels } = await import(
      '../runtime-model-discovery'
    );

    const selectableIds = getSelectableModels('text').map((model) => model.id);
    expect(selectableIds.slice(0, 3)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(selectableIds).not.toContain('gpt-5.4');
    expect(selectableIds).not.toContain('gpt-5.2');
    expect(getPinnedSelectableModel('text', 'gpt-5.4')).toMatchObject({
      id: 'gpt-5.4',
      type: 'text',
    });
  });

  it('应用模型选择时会返回新增和移除增量', async () => {
    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [
          {
            profileId: 'provider-text',
            discoveredAt: Date.now(),
            discoveredModels: [
              {
                id: 'model-a',
                label: 'Model A',
                shortLabel: 'Model A',
                type: 'text',
                vendor: 'OPENAI',
              },
              {
                id: 'model-b',
                label: 'Model B',
                shortLabel: 'Model B',
                type: 'text',
                vendor: 'OPENAI',
              },
              {
                id: 'model-c',
                label: 'Model C',
                shortLabel: 'Model C',
                type: 'text',
                vendor: 'OPENAI',
              },
            ],
            selectedModelIds: ['model-a', 'model-b'],
          },
        ],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-text',
            name: '文本供应商',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    const result = runtimeModelDiscovery.applySelection('provider-text', [
      'model-b',
      'model-c',
    ]);

    expect(result.models.map((model) => model.id)).toEqual([
      'model-b',
      'model-c',
    ]);
    expect(result.addedModelIds).toEqual(['model-c']);
    expect(result.removedModelIds).toEqual(['model-a']);
  });

  it('加载旧目录时会刷新 HappyHorse 的供应商分类', async () => {
    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [
          {
            profileId: 'provider-happyhorse',
            discoveredAt: Date.now(),
            discoveredModels: [
              {
                id: 'happyhorse-1.0-t2v',
                label: 'HappyHorse 1.0 T2V',
                shortLabel: 'HappyHorse 1.0 T2V',
                type: 'video',
                vendor: 'OTHER',
                tags: ['happyhorse'],
              },
            ],
            selectedModelIds: ['happyhorse-1.0-t2v'],
          },
        ],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-happyhorse',
            name: 'HappyHorse',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );
    const state = runtimeModelDiscovery.getState('provider-happyhorse');

    expect(state.discoveredModels[0]).toMatchObject({
      id: 'happyhorse-1.0-t2v',
      type: 'video',
      vendor: 'HAPPYHORSE',
      sourceProfileId: 'provider-happyhorse',
    });
    expect(state.models[0]?.vendor).toBe('HAPPYHORSE');
  });

  it('运行时发现模型会识别 HappyHorse 供应商', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [{ id: 'happyhorse-alpha-video', owned_by: 'happyhorse' }],
          }),
      }))
    );

    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-happyhorse',
            name: 'HappyHorse',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    const models = await runtimeModelDiscovery.discover(
      'provider-happyhorse',
      'https://api.example.com/v1',
      'test-key'
    );

    expect(models[0]).toMatchObject({
      id: 'happyhorse-alpha-video',
      type: 'video',
      vendor: 'HAPPYHORSE',
    });
  });

  it('运行时发现 Omni Flash 系列会识别为 Gemini 供应商', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'omni-flash',
                owned_by: 'openai',
                supported_endpoint_types: ['videos.generate'],
              },
              {
                id: 'omni-flash-components',
                owned_by: 'openai',
                supported_endpoint_types: ['videos.generate'],
              },
            ],
          }),
      }))
    );

    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-video',
            name: 'Video Provider',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    const models = await runtimeModelDiscovery.discover(
      'provider-video',
      'https://api.example.com/v1',
      'test-key'
    );

    expect(models.map((model) => model.vendor)).toEqual(['GEMINI', 'GEMINI']);
    expect(models.map((model) => model.type)).toEqual(['video', 'video']);
  });

  it('可添加自定义接口模型并在刷新远端模型后保留', async () => {
    const persistedCatalogs: unknown[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [{ id: 'remote-image-model', category: '生图' }],
          }),
      }))
    );

    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [
          {
            profileId: 'provider-custom',
            discoveredAt: Date.now(),
            discoveredModels: [],
            selectedModelIds: [],
            manualBindings: [],
          },
        ],
        addListener: () => {},
        removeListener: () => {},
        update: async (catalogs: unknown[]) => {
          persistedCatalogs.splice(0, persistedCatalogs.length, ...catalogs);
        },
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-custom',
            name: 'Custom Provider',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    runtimeModelDiscovery.addManualModel('provider-custom', {
      id: 'custom-gpt-image',
      type: 'image',
      label: 'Custom GPT Image',
      invocation: {
        protocol: 'openai.images.edits',
        requestSchema: 'tuzi.image.gpt-edit-json',
        responseSchema: 'openai.image.data',
        submitPath: '/images/edits',
      },
    });
    runtimeModelDiscovery.addManualModel('provider-custom', {
      id: 'custom-chat-model',
      type: 'text',
      invocation: {
        protocol: 'openai.chat.completions',
        requestSchema: 'openai.chat.messages',
        responseSchema: 'openai.chat.choices',
        submitPath: '/chat/completions',
      },
    });
    runtimeModelDiscovery.addManualModel('provider-custom', {
      id: 'custom-video-model',
      type: 'video',
      invocation: {
        protocol: 'openai.async.video',
        requestSchema: 'openai.video.form-input-reference',
        responseSchema: 'openai.async.task',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
      },
    });
    runtimeModelDiscovery.addManualModel('provider-custom', {
      id: 'custom-audio-model',
      type: 'audio',
      invocation: {
        protocol: 'tuzi.suno.music',
        requestSchema: 'tuzi.suno.music.submit',
        responseSchema: 'tuzi.suno.task',
        submitPath: '/suno/submit/music',
        pollPathTemplate: '/suno/fetch/{taskId}',
        baseUrlStrategy: 'trim-v1',
      },
    });

    expect(runtimeModelDiscovery.getState('provider-custom')).toMatchObject({
      selectedModelIds: [
        'custom-gpt-image',
        'custom-chat-model',
        'custom-video-model',
        'custom-audio-model',
      ],
      manualBindings: [
        {
          modelId: 'custom-gpt-image',
          source: 'manual',
          requestSchema: 'tuzi.image.gpt-edit-json',
          submitPath: '/images/edits',
        },
        {
          modelId: 'custom-chat-model',
          operation: 'text',
          requestSchema: 'openai.chat.messages',
          submitPath: '/chat/completions',
        },
        {
          modelId: 'custom-video-model',
          operation: 'video',
          requestSchema: 'openai.video.form-input-reference',
          pollPathTemplate: '/videos/{taskId}',
        },
        {
          modelId: 'custom-audio-model',
          operation: 'audio',
          requestSchema: 'tuzi.suno.music.submit',
          baseUrlStrategy: 'trim-v1',
        },
      ],
    });
    expect(persistedCatalogs[0]).toMatchObject({
      manualBindings: expect.arrayContaining([
        expect.objectContaining({
          modelId: 'custom-gpt-image',
          source: 'manual',
        }),
        expect.objectContaining({
          modelId: 'custom-chat-model',
          operation: 'text',
        }),
        expect.objectContaining({
          modelId: 'custom-video-model',
          operation: 'video',
        }),
        expect.objectContaining({
          modelId: 'custom-audio-model',
          operation: 'audio',
        }),
      ]),
    });

    await runtimeModelDiscovery.discover(
      'provider-custom',
      'https://api.example.com/v1',
      'test-key'
    );

    const state = runtimeModelDiscovery.getState('provider-custom');
    expect(state.discoveredModels.map((model) => model.id)).toContain(
      'custom-gpt-image'
    );
    expect(state.selectedModelIds).toContain('custom-gpt-image');
    expect(state.selectedModelIds).toContain('custom-chat-model');
    expect(state.selectedModelIds).toContain('custom-video-model');
    expect(state.selectedModelIds).toContain('custom-audio-model');
    expect(state.manualBindings).toHaveLength(4);
  });

  it('拒绝同一供应商下同 ID 的不同类型手动模型', async () => {
    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [
          {
            profileId: 'provider-custom',
            discoveredAt: Date.now(),
            discoveredModels: [],
            selectedModelIds: [],
            manualBindings: [],
          },
        ],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-custom',
            name: 'Custom Provider',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    runtimeModelDiscovery.addManualModel('provider-custom', {
      id: 'custom-model',
      type: 'image',
      invocation: {
        protocol: 'openai.images.edits',
        requestSchema: 'openai.image.gpt-edit-form',
        responseSchema: 'openai.image.data',
        submitPath: '/images/edits',
      },
    });

    expect(() =>
      runtimeModelDiscovery.addManualModel('provider-custom', {
        id: 'custom-model',
        type: 'text',
        invocation: {
          protocol: 'openai.chat.completions',
          requestSchema: 'openai.chat.messages',
          responseSchema: 'openai.chat.choices',
          submitPath: '/chat/completions',
        },
      })
    ).toThrow('同一供应商下模型 ID 已作为图片模型存在');
  });

  it('主端点浏览器 fetch 失败时会尝试 tuzi-api 候选端点获取模型', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://apisz.ourzhishi.top/v1/models') {
        throw new TypeError('Failed to fetch');
      }

      if (url === 'https://api.tu-zi.com/v1/models') {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              data: [
                {
                  id: 'gpt-image-2',
                  owned_by: 'openai',
                  category: '生图',
                },
              ],
            }),
        };
      }

      throw new Error(`Unexpected url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-tuzi',
            name: 'Tuzi',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    const models = await runtimeModelDiscovery.discover(
      'provider-tuzi',
      'https://apisz.ourzhishi.top/v1',
      'test-key',
      ['https://api.tu-zi.com']
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://apisz.ourzhishi.top/v1/models',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.tu-zi.com/v1/models',
      expect.any(Object)
    );
    expect(models[0]).toMatchObject({
      id: 'gpt-image-2',
      type: 'image',
    });
  });

  it('不会把 OpenAI 自有 omni 模型误归类为 Gemini', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'omni-moderation-latest',
                owned_by: 'openai',
                supported_endpoint_types: ['moderations'],
              },
            ],
          }),
      }))
    );

    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-openai',
            name: 'OpenAI',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    const models = await runtimeModelDiscovery.discover(
      'provider-openai',
      'https://api.example.com/v1',
      'test-key'
    );

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: 'omni-moderation-latest',
      vendor: 'GPT',
    });
  });

  it('优先按接口 category 分类模型', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'gpt-4o-image-async',
                owned_by: 'openai',
                category: '生图',
                supported_endpoint_types: [
                  'OpenAI-Chat',
                  'edit',
                  'generate',
                  'openai-video',
                ],
              },
              {
                id: 'research-video-preview',
                owned_by: 'openai',
                category: '文本',
                supported_endpoint_types: ['openai-video'],
              },
            ],
          }),
      }))
    );

    vi.doMock('../settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      providerCatalogsSettings: {
        get: () => [],
        addListener: () => {},
        removeListener: () => {},
        update: async () => {},
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'provider-openai',
            name: 'OpenAI',
            enabled: true,
          },
        ],
        addListener: () => {},
        removeListener: () => {},
      },
      invocationPresetsSettings: {
        addListener: () => {},
        removeListener: () => {},
      },
      settingsManager: {
        getSetting: () => ({}),
        addListener: () => {},
        removeListener: () => {},
      },
    }));

    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );

    const models = await runtimeModelDiscovery.discover(
      'provider-openai',
      'https://api.example.com/v1',
      'test-key'
    );

    expect(models).toHaveLength(2);
    expect(
      models.find((model) => model.id === 'gpt-4o-image-async')
    ).toMatchObject({
      type: 'image',
      vendor: 'GPT',
    });
    expect(
      models.find((model) => model.id === 'research-video-preview')
    ).toMatchObject({
      type: 'text',
      vendor: 'GPT',
    });
  });
});
