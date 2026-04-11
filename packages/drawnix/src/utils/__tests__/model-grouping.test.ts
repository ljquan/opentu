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
});
