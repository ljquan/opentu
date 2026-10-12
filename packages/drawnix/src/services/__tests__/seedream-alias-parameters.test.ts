import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStaticModelConfig } from '../../constants/model-config';
import { inferBindingsForProviderModel } from '../provider-routing/binding-inference';
import {
  clearModelAdapters,
  registerModelAdapter,
  resolveAdapterForBinding,
  resolveAdapterForModel,
} from '../model-adapters/registry';
import { seedreamImageAdapter } from '../model-adapters/seedream-adapter';

const mocks = vi.hoisted(() => ({ sendAdapterRequest: vi.fn() }));
vi.mock('../model-adapters/context', () => ({ sendAdapterRequest: mocks.sendAdapterRequest }));

afterEach(() => {
  clearModelAdapters();
  mocks.sendAdapterRequest.mockReset();
});

describe.each(['doubao-seedream-5-0-lite-260128', 'seedream-5.0'])(
  '%s exact API identity and parameter consumption', (id) => {

  it.each([
    ['2k', '2560x1440'],
    ['3k', '4096x2304'],
  ])('sends the selected %s size with the original model ID', async (quality, size) => {
    registerModelAdapter(seedreamImageAdapter);
    const model = getStaticModelConfig(id);
    if (!model) throw new Error('Expected Seedream model contract');
    const profile = {
      id: 'tuzi', name: 'Tuzi', providerType: 'openai-compatible' as const,
      baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test', authType: 'bearer' as const,
    };
    const binding = inferBindingsForProviderModel(profile, model)
      .find(item => item.requestSchema === 'openai.image.seedream-json');
    if (!binding) throw new Error('Expected Seedream JSON binding');
    expect(binding).toMatchObject({ modelId: id, profileId: 'tuzi' });
    expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(seedreamImageAdapter.id);
    expect(resolveAdapterForModel(id, 'image')?.id).toBe(seedreamImageAdapter.id);

    mocks.sendAdapterRequest.mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://example.test/result.png' }],
    })));
    await seedreamImageAdapter.generateImage({
      baseUrl: profile.baseUrl, apiKey: 'test', authType: 'bearer', binding,
    }, {
      model: id, modelRef: { profileId: 'tuzi', modelId: id }, prompt: 'test', size: '16x9',
      params: { seedream_quality: quality, watermark: true, output_format: 'jpeg' },
      referenceImages: ['https://example.test/reference.png'],
    });

    expect(mocks.sendAdapterRequest).toHaveBeenCalledTimes(1);
    const request = mocks.sendAdapterRequest.mock.calls[0][1];
    expect(request.path).toBe('/images/generations');
    expect(JSON.parse(request.body)).toEqual({
      model: id, prompt: 'test', response_format: 'url', size,
      image: 'https://example.test/reference.png',
    });
  });
});
