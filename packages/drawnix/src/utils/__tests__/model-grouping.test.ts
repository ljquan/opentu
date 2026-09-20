import { describe, expect, it } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import { groupModelsByProvider } from '../model-grouping';

const LEGACY_DEFAULT_PROVIDER_PROFILE_ID = 'legacy-default';

describe('model-grouping', () => {
  it('同一 provider 下按 type + id 去重，但保留跨 provider 同名模型', () => {
    const duplicateInDefault: ModelConfig = {
      id: 'gpt-4o-image',
      label: 'GPT-4o Image',
      type: 'image',
      vendor: ModelVendor.GPT,
    };

    const groups = groupModelsByProvider(
      [
        duplicateInDefault,
        {
          ...duplicateInDefault,
          label: 'GPT-4o Image duplicate',
        },
        {
          ...duplicateInDefault,
          sourceProfileId: 'custom-openai',
          sourceProfileName: 'Custom OpenAI',
          selectionKey: 'custom-openai::gpt-4o-image',
        },
      ],
      [
        {
          id: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
          name: 'default',
          baseUrl: '',
          apiKey: '',
          enabled: true,
          capabilities: {
            text: true,
            image: true,
            video: true,
            audio: false,
          },
        },
        {
          id: 'custom-openai',
          name: 'Custom OpenAI',
          baseUrl: '',
          apiKey: '',
          enabled: true,
          capabilities: {
            text: true,
            image: true,
            video: false,
            audio: false,
          },
        },
      ]
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]?.totalCount).toBe(1);
    expect(groups[0]?.vendorCategories[0]?.models).toHaveLength(1);
    expect(groups[1]?.totalCount).toBe(1);
    expect(groups[1]?.vendorCategories[0]?.models).toHaveLength(1);
  });

  it('Omni Flash 系列归到 Gemini 厂商分类', () => {
    const groups = groupModelsByProvider(
      [
        {
          id: 'omni-flash',
          label: 'Gemini Omni Flash',
          type: 'video',
          vendor: ModelVendor.GEMINI,
        },
        {
          id: 'omni-flash-components',
          label: 'Gemini Omni Flash Components',
          type: 'video',
          vendor: ModelVendor.GEMINI,
        },
      ],
      []
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.vendorCategories).toHaveLength(1);
    expect(groups[0]?.vendorCategories[0]?.vendor).toBe(ModelVendor.GEMINI);
    expect(groups[0]?.vendorCategories[0]?.label).toBe('Gemini');
    expect(
      groups[0]?.vendorCategories[0]?.models.map((model) => model.id)
    ).toEqual(['omni-flash-components', 'omni-flash']);
  });

  it('视频模型优先展示 MiniMax，其次展示豆包', () => {
    const groups = groupModelsByProvider(
      [
        {
          id: 'omni-flash',
          label: 'Gemini Omni Flash',
          type: 'video',
          vendor: ModelVendor.GEMINI,
        },
        {
          id: 'doubao-seedance-2-0-260128',
          label: 'Seedance 2.0',
          type: 'video',
          vendor: ModelVendor.DOUBAO,
        },
        {
          id: 'MiniMax-H3',
          label: 'MiniMax-H3',
          type: 'video',
          vendor: ModelVendor.MINIMAX,
        },
      ],
      []
    );

    expect(
      groups[0]?.vendorCategories.map((category) => category.vendor)
    ).toEqual([ModelVendor.MINIMAX, ModelVendor.DOUBAO, ModelVendor.GEMINI]);
  });

  it('已启用且配置完整但还没有模型的供应商也会显示出来', () => {
    const groups = groupModelsByProvider(
      [],
      [
        {
          id: 'configured-provider',
          name: 'Configured Provider',
          baseUrl: 'https://example.com/v1',
          apiKey: 'sk-test',
          enabled: true,
          providerType: 'openai-compatible',
          authType: 'bearer',
          capabilities: {
            supportsModelsEndpoint: true,
            supportsText: true,
            supportsImage: true,
            supportsVideo: false,
            supportsAudio: false,
            supportsTools: false,
          },
        },
        {
          id: 'disabled-provider',
          name: 'Disabled Provider',
          baseUrl: 'https://example.com/v1',
          apiKey: 'sk-test',
          enabled: false,
          providerType: 'openai-compatible',
          authType: 'bearer',
          capabilities: {
            supportsModelsEndpoint: true,
            supportsText: true,
            supportsImage: true,
            supportsVideo: false,
            supportsAudio: false,
            supportsTools: false,
          },
        },
      ]
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.providerId).toBe('configured-provider');
    expect(groups[0]?.totalCount).toBe(0);
    expect(groups[0]?.vendorCategories).toHaveLength(0);
  });

  it('Tuzi managed default 会合并旧默认模型，不重复显示同名分组', () => {
    const groups = groupModelsByProvider(
      [
        {
          id: 'MiniMax-H3',
          label: 'MiniMax-H3',
          type: 'video',
          vendor: ModelVendor.MINIMAX,
        },
        {
          id: 'seedance-1.5-pro',
          label: 'Seedance 1.5 Pro',
          type: 'video',
          vendor: ModelVendor.DOUBAO,
          sourceProfileId: 'tuzi-managed-default',
          sourceProfileName: 'default 分组',
          selectionKey: 'tuzi-managed-default::seedance-1.5-pro',
        },
      ],
      [
        {
          id: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
          name: 'default 分组',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'legacy-key',
          enabled: true,
          providerType: 'openai-compatible',
          authType: 'bearer',
          capabilities: {
            supportsModelsEndpoint: true,
            supportsText: true,
            supportsImage: true,
            supportsVideo: true,
            supportsAudio: true,
            supportsTools: true,
          },
        },
        {
          id: 'tuzi-managed-default',
          name: 'default 分组',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'managed-key',
          enabled: true,
          providerType: 'openai-compatible',
          authType: 'bearer',
          pricingGroup: 'default',
          capabilities: {
            supportsModelsEndpoint: true,
            supportsText: true,
            supportsImage: true,
            supportsVideo: true,
            supportsAudio: true,
            supportsTools: true,
          },
        },
        {
          id: 'aaa-provider',
          name: 'AAA Provider',
          baseUrl: 'https://aaa.example.com/v1',
          apiKey: 'aaa-key',
          enabled: true,
          providerType: 'openai-compatible',
          authType: 'bearer',
          capabilities: {
            supportsModelsEndpoint: true,
            supportsText: true,
            supportsImage: true,
            supportsVideo: true,
            supportsAudio: true,
            supportsTools: true,
          },
        },
      ]
    );

    expect(groups).toHaveLength(2);
    expect(
      groups.filter((group) => group.providerName === 'default 分组')
    ).toHaveLength(1);
    expect(groups[0]?.providerId).toBe('tuzi-managed-default');
    expect(groups[0]?.providerName).toBe('default 分组');
    expect(groups[0]?.totalCount).toBe(2);
  });
});
