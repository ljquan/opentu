import { describe, expect, it } from 'vitest';
import { mapNativeModels } from './native-models';
import {
  mergeNativeModels,
  isGenerationRequest,
} from '../shared/generation-bridge';
import type { ModelConfig } from '../../constants/model-config';
import type { ProviderProfile } from '../../utils/settings-types';

describe('native workflow models', () => {
  it('publishes a provider display address without exporting credentials', () => {
    const result = mapNativeModels([{id:'legacy-default',name:'Default',enabled:true,baseUrl:'https://user:password@api.tu-zi.com/v1?key=secret#private',apiKey:'secret-key'}] as ProviderProfile[],[],[],[{id:'text',type:'text'}] as ModelConfig[]);
    expect(result.channels[0].baseUrl).toBe('https://api.tu-zi.com/v1');
    expect(result.channels[0].apiKey).toBe('');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('removes unavailable native routes while retaining user script models', () => {
    const channel = { id: 'native', name: 'Native', opentuProfileId: 'removed', baseUrl: '', apiKey: '', apiFormat: 'openai' as const, models: [{ name: 'raw-native', capability: 'image' as const }, { name: 'user-script', capability: 'image' as const, script: 'return 1' }] };
    const result = mergeNativeModels({ channels: [channel], models: [], imageModel: 'native::user-script', videoModel: '', textModel: '', audioModel: '' }, { channels: [], defaults: { image: '', video: '', text: '', audio: '' }, warnings: [] });
    expect(result.channels[0].models).toEqual([channel.models[1]]);
    expect(result.imageModel).toBe('native::user-script');
  });
  it('includes every built-in capability for the configured default provider', () => {
    const result = mapNativeModels(
      [
        { id: 'legacy-default', name: 'Default', enabled: true },
      ] as ProviderProfile[],
      [],
      [],
      [
        { id: 'image', type: 'image' },
        { id: 'video', type: 'video' },
        { id: 'text', type: 'text' },
        { id: 'audio', type: 'audio' },
      ] as ModelConfig[]
    );
    expect(result.channels[0]?.models.map((model) => model.capability)).toEqual(
      ['image', 'video', 'text', 'audio']
    );
  });
  it('includes configured manual-only models with their declared capability', () => {
    const result = mapNativeModels(
      [{ id: 'custom', name: 'Custom', enabled: true }] as ProviderProfile[],
      [
        {
          profileId: 'custom',
          discoveredAt: null,
          discoveredModels: [],
          selectedModelIds: [],
          manualBindings: [
            {
              id: 'binding',
              modelId: 'private-video',
              operation: 'video',
              protocol: 'custom-http',
              requestSchema: 'custom-http',
              responseSchema: 'custom-http',
              submitPath: '/generate',
              priority: 100,
              confidence: 'high',
              source: 'manual',
            },
          ],
        },
      ],
      [],
      []
    );
    expect(result.channels[0]?.models).toMatchObject([
      {
        name: 'private-video',
        capability: 'video',
        parameters: [],
        referenceInputs: {},
      },
    ]);
  });
  it('expands the migrated default group with a non-null profile id', () => {
    const result = mapNativeModels(
      [
        { id: 'legacy-default', name: 'default 分组', enabled: true },
      ] as ProviderProfile[],
      [],
      [
        {
          routeType: 'image',
          modelId: 'gpt-image-2',
          profileId: 'legacy-default',
          apiKey: '',
          baseUrl: '',
          source: 'preset',
          profileName: 'default 分组',
          providerType: 'openai-compatible',
        },
      ],
      [
        { id: 'gpt-image-2', type: 'image' },
        { id: 'seedream', type: 'image' },
      ] as ModelConfig[]
    );
    expect(result.channels[0].models.map((model) => model.name)).toEqual([
      'gpt-image-2',
      'seedream',
    ]);
    expect(result.defaults.image).toBe(
      'opentu-native-legacy-default::gpt-image-2'
    );
  });
  it('offers the built-in catalog for legacy capabilities without changing the default', () => {
    const models = [
      { id: 'first', type: 'image' },
      { id: 'second', type: 'image' },
      { id: 'video', type: 'video' },
    ] as ModelConfig[];
    const result = mapNativeModels(
      [],
      [],
      [
        {
          routeType: 'image',
          modelId: 'first',
          profileId: null,
          apiKey: '',
          baseUrl: '',
          source: 'legacy',
          profileName: '',
          providerType: 'openai-compatible',
        },
      ],
      models
    );
    expect(result.channels[0].models).toMatchObject([
      { name: 'first', capability: 'image' },
      { name: 'second', capability: 'image' },
    ]);
    expect(result.defaults.image).toBe('opentu-native-legacy::first');
  });

  it('offers unselected discovered models only in their own enabled provider', () => {
    const profiles = [
      { id: 'a', name: 'A', enabled: true },
      { id: 'b', name: 'B', enabled: false },
    ] as ProviderProfile[];
    const result = mapNativeModels(
      profiles,
      [
        {
          profileId: 'a',
          discoveredAt: null,
          discoveredModels: [
            { id: 'discovered', type: 'video' },
          ] as ModelConfig[],
          selectedModelIds: [],
        },
        {
          profileId: 'b',
          discoveredAt: null,
          discoveredModels: [{ id: 'private', type: 'image' }] as ModelConfig[],
          selectedModelIds: [],
        },
      ],
      [],
      [{ id: 'unrelated', type: 'image' }] as ModelConfig[]
    );
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].id).toBe('opentu-native-a');
    expect(result.channels[0].models).toMatchObject([
      { name: 'discovered', capability: 'video' },
    ]);
  });
  it('publishes legacy media defaults without copying credentials', () => {
    const result = mapNativeModels(
      [],
      [],
      [
        {
          routeType: 'image',
          modelId: 'seedream',
          profileId: null,
          apiKey: 'secret',
          baseUrl: 'https://example.com',
          source: 'legacy',
          profileName: 'legacy',
          providerType: 'openai-compatible',
        },
      ],
      []
    );
    expect(result.channels[0].models).toMatchObject([
      { name: 'seedream', capability: 'image' },
    ]);
    expect(result.channels[0].opentuProfileId).toBeNull();
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.defaults.image).toBe('opentu-native-legacy::seedream');
  });

  it('adds native models without replacing custom scripts or valid choices', () => {
    const incoming = mapNativeModels(
      [],
      [],
      [
        {
          routeType: 'video',
          modelId: 'seedance',
          profileId: null,
          apiKey: '',
          baseUrl: '',
          source: 'legacy',
          profileName: '',
          providerType: 'openai-compatible',
        },
      ],
      []
    );
    const custom = {
      id: 'custom',
      name: 'Custom',
      baseUrl: '',
      apiKey: '',
      apiFormat: 'openai' as const,
      models: [
        { name: 'mine', capability: 'image' as const, script: 'return 1' },
      ],
    };
    const config = {
      channels: [custom],
      models: ['custom::mine'],
      imageModel: 'custom::mine',
      videoModel: '',
      textModel: '',
      audioModel: '',
    };
    const result = mergeNativeModels(config, incoming);
    expect(result.channels[0]).toEqual(custom);
    expect(result.imageModel).toBe('custom::mine');
    expect(result.videoModel).toBe('opentu-native-legacy::seedance');
    expect(mergeNativeModels(result, incoming)).toEqual(result);
  });

  it('rejects malformed references and counts', () => {
    const request = {
      capability: 'image',
      channelId: 'c',
      model: 'm',
      prompt: 'test',
      images: [],
    };
    expect(isGenerationRequest(request)).toBe(true);
    expect(
      isGenerationRequest({ ...request, images: ['file:///private'] })
    ).toBe(false);
    expect(isGenerationRequest({ ...request, count: 0 })).toBe(false);
  });
});
