import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCatalog } from '../settings-manager';
import type { ProviderPricingCache } from '../model-pricing-types';

const profileId = 'tuzi-token-default';
const mixedTags = '文本,图像,代码,推理,智能体,工具,长上下文';

function mockSettings(
  catalogs: Partial<ProviderCatalog>[] = [],
  caches: Partial<ProviderPricingCache>[] = []
) {
  vi.doMock('../settings-manager', () => ({
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
    providerCatalogsSettings: {
      get: () => catalogs,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      update: vi.fn(),
    },
    providerProfilesSettings: {
      get: () => [
        {
          profileId,
          id: profileId,
          enabled: true,
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-key',
        },
      ],
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    invocationPresetsSettings: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    settingsManager: {
      getSetting: (key: string) =>
        key === 'providerPricingCache' ? caches : {},
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  }));
}

describe('marketplace output classification', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('does not treat multimodal text tags as image output or lose explicit generation tags', async () => {
    mockSettings();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );
    const cases = [
      {
        id: 'gpt-6-astra',
        category: mixedTags,
        type: 'text',
        endpoints: ['openai'],
      },
      {
        id: 'gpt-6.1-sol',
        category: mixedTags,
        type: 'text',
        endpoints: ['openai'],
      },
      { id: 'vision-chat', category: 'text,image,video,audio', type: 'text' },
      { id: 'vision-reasoner', category: '图像,推理,代码', type: 'text' },
      {
        id: 'mixed-image-generator',
        category: '文本,生图',
        type: 'image',
        endpoints: ['openai'],
      },
      {
        id: 'english-image-generator',
        category: 'text,image-generation',
        type: 'image',
      },
      { id: 'mixed-video-generator', category: '文本,视频生成', type: 'video' },
      {
        id: 'english-video-generator',
        category: 'text,video_generation',
        type: 'video',
      },
      { id: 'mixed-audio-generator', category: '文本,语音合成', type: 'audio' },
      {
        id: 'gpt-image-2.5',
        category: '生图',
        type: 'image',
        endpoints: ['image-generation', 'openai', 'openai-video'],
      },
      { id: 'legacy-image-category', category: '图像', type: 'image' },
      { id: 'legacy-video-category', category: '视频', type: 'video' },
      { id: 'legacy-audio-category', category: '音频', type: 'audio' },
    ];
    const models = await runtimeModelDiscovery.discover(
      profileId,
      'https://api.tu-zi.com/v1',
      'test-key',
      [],
      {
        authoritativeModels: cases.map(({ id, category, endpoints }) => ({
          id,
          category,
          supported_endpoint_types: endpoints,
        })),
      }
    );

    for (const { id, type } of cases) {
      expect(
        models.find((model) => model.id === id),
        id
      ).toMatchObject({ type });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      runtimeModelDiscovery.getPinnedSelectableModel('image', 'gpt-6-astra', {
        profileId,
        modelId: 'gpt-6-astra',
      })
    ).toBeNull();
  });

  it.each(['marketplace', 'models-endpoint'] as const)(
    'reload of %s catalogs corrects only automatic marketplace classifications from local metadata',
    async (discoverySource) => {
      const modelIds = [
        'gpt-6-astra',
        'runtime-vision-chat',
        'manual-renderer',
        'without-metadata',
      ];
      mockSettings(
        [
          {
            profileId,
            discoverySource,
            selectedModelIds: modelIds,
            discoveredModels: modelIds.map(
              (id) =>
                ({
                  id,
                  label: id,
                  shortLabel: id,
                  type: 'image',
                  vendor: 'OTHER',
                  tags: id === 'manual-renderer' ? ['manual'] : ['runtime'],
                  imageDefaults: {
                    width: 1024,
                    height: 1024,
                    aspectRatio: 'auto',
                  },
                } as ProviderCatalog['discoveredModels'][number])
            ),
          },
        ],
        [
          {
            profileId,
            modelCatalog: Object.fromEntries(
              modelIds.slice(0, 3).map((id) => [
                id,
                {
                  category: mixedTags,
                  supported_endpoint_types: ['openai'],
                },
              ])
            ),
          },
        ]
      );
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { runtimeModelDiscovery } = await import(
        '../runtime-model-discovery'
      );
      const state = runtimeModelDiscovery.getState(profileId);
      for (const id of modelIds.slice(0, 2)) {
        expect(state.models.find((model) => model.id === id)).toMatchObject({
          type: discoverySource === 'marketplace' ? 'text' : 'image',
        });
        if (discoverySource === 'marketplace') {
          expect(
            state.models.find((model) => model.id === id)?.imageDefaults
          ).toBeUndefined();
        }
      }
      expect(
        state.models.find((model) => model.id === 'manual-renderer')?.type
      ).toBe('image');
      expect(
        state.models.find((model) => model.id === 'without-metadata')?.type
      ).toBe('image');
      expect(state.selectedModelIds).toEqual(modelIds);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('uses exact marketplace output tags instead of treating image capabilities as generation', async () => {
    mockSettings();
    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );
    const cases = [
      { id: 'gpt-6-astra', tags: mixedTags, type: 'text' },
      { id: 'gpt-6.1-sol', tags: mixedTags, type: 'text' },
      { id: 'image-understanding', tags: '图像', type: 'text' },
      { id: 'image-input-only', tags: '图片,多模态', type: 'text' },
      { id: 'image-comprehension', tags: '图像理解,角色对话', type: 'text' },
      { id: 'not-a-generator', tags: '非生图', type: 'text' },
      { id: 'tagged-renderer', tags: '文本,生图,图片编辑', type: 'image' },
      { id: 'tagged-upscaler', tags: '生图,图片放大', type: 'image' },
      { id: 'tagged-video', tags: '视频,图生视频', type: 'video' },
      { id: 'tagged-music', tags: '音频,音乐生成', type: 'audio' },
      {
        id: 'glm-5.3-flash',
        tags: '文本,多模态,代码,推理,视频,图片',
        type: 'text',
      },
      {
        id: 'gemini-3.1-flash-lite',
        tags: '多模态,推理,工具,文件,音频',
        type: 'text',
      },
      { id: 'gpt-5.1', tags: '图像,推理', type: 'text' },
    ];
    const models = await runtimeModelDiscovery.discover(
      profileId,
      'https://api.tu-zi.com/v1',
      'test-key',
      [],
      {
        authoritativeModels: cases.map(({ id, tags }) => ({
          id,
          tags,
          supported_endpoint_types: ['openai'],
        })),
      }
    );
    for (const { id, type } of cases) {
      expect(
        models.find((model) => model.id === id),
        id
      ).toMatchObject({ type });
    }
  });

  it('restores cached output tags without changing actual category semantics', async () => {
    mockSettings(
      [
        {
          profileId,
          discoverySource: 'marketplace',
          selectedModelIds: ['tagged-vision', 'categorized-renderer'],
          discoveredModels: ['tagged-vision', 'categorized-renderer'].map(
            (id) =>
              ({
                id,
                label: id,
                shortLabel: id,
                type: 'image',
                vendor: 'OTHER',
                tags: ['runtime'],
              } as ProviderCatalog['discoveredModels'][number])
          ),
        },
      ],
      [
        {
          profileId,
          modelCatalog: {
            'tagged-vision': { tags: '图像' },
            'categorized-renderer': { category: 'image', tags: '文本' },
          },
        },
      ]
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { runtimeModelDiscovery } = await import(
      '../runtime-model-discovery'
    );
    expect(
      runtimeModelDiscovery
        .getDiscoveredModels(profileId, 'image')
        .map((m) => m.id)
    ).toEqual(['categorized-renderer']);
    expect(
      runtimeModelDiscovery
        .getDiscoveredModels(profileId, 'text')
        .map((m) => m.id)
    ).toEqual(['tagged-vision']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let unrelated tags override known image and video capabilities', async () => {
    mockSettings();
    const { runtimeModelDiscovery } = await import('../runtime-model-discovery');
    const cases = [
      { id: 'doubao-seedream-4-0-250828', tags: 'NEW', type: 'image' },
      { id: 'doubao-seedream-4-5-251128', tags: 'featured,popular', type: 'image' },
      { id: 'sora-2', tags: 'recommended', type: 'video' },
      { id: 'new-image-generator', tags: 'NEW', type: 'image', supported_endpoint_types: ['image-generation'] },
      { id: 'image-input-only', tags: '图片,多模态', type: 'text' },
    ];
    const models = await runtimeModelDiscovery.discover(
      profileId, 'https://api.tu-zi.com/v1', 'test-key', [],
      { authoritativeModels: cases }
    );
    for (const { id, type } of cases) {
      expect(models.find((model) => model.id === id), id).toMatchObject({ type });
    }
  });

  it.each(['text', 'video'] as const)(
    'keeps an already corrected static model classified as %s across repeated catalog restores',
    async (type) => {
      const id = 'doubao-seedream-4-0-250828';
      const catalogs: Partial<ProviderCatalog>[] = [{
        profileId,
        discoverySource: 'marketplace',
        selectedModelIds: [id],
        discoveredModels: [{
          id, label: id, shortLabel: id, type, vendor: 'DOUBAO',
          tags: ['runtime'], description: 'Marketplace model',
        } as ProviderCatalog['discoveredModels'][number]],
      }];
      const caches = [{ profileId, modelCatalog: { [id]: { category: type } } }];
      mockSettings(catalogs, caches);
      vi.stubGlobal('fetch', vi.fn());

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { runtimeModelDiscovery } = await import('../runtime-model-discovery');
        const state = runtimeModelDiscovery.getState(profileId);
        expect(state.models[0]).toMatchObject({ id, type });
        expect(state.models[0].imageDefaults).toBeUndefined();
        expect(state.selectedModelIds).toEqual([id]);
        catalogs[0] = { ...catalogs[0], discoveredModels: state.discoveredModels };
        vi.resetModules();
      }
      expect(fetch).not.toHaveBeenCalled();
    }
  );
});
