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
});
