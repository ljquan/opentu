import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import { fluxImageAdapter } from '../model-adapters/flux-adapter';
import { gptImageAdapter } from '../model-adapters/gpt-image-adapter';
import { mjImageAdapter } from '../model-adapters/mj-image-adapter';
import {
  clearModelAdapters,
  registerModelAdapter,
  resolveAdapterForBinding,
  resolveAdapterForInvocation,
} from '../model-adapters/registry';
import { seedreamImageAdapter } from '../model-adapters/seedream-adapter';
import { tuziGPTImageAdapter } from '../model-adapters/tuzi-gpt-image-adapter';
import type { ImageModelAdapter } from '../model-adapters/types';
import { inferBindingsForProviderModel } from '../provider-routing';
import type { ProviderProfileSnapshot } from '../provider-routing';

const defaultBasicImageAdapter: ImageModelAdapter = {
  id: 'gemini-image-adapter',
  label: 'Default Image',
  kind: 'image',
  matchProtocols: ['openai.images.generations', 'openai.async.media'],
  matchRequestSchemas: ['openai.image.basic-json', 'openai.async.image.form'],
  async generateImage() {
    throw new Error('not implemented');
  },
};

const openaiProfile: ProviderProfileSnapshot = {
  id: 'openai',
  name: 'OpenAI',
  providerType: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'openai-key',
  authType: 'bearer',
  imageApiCompatibility: 'auto',
};

const tuziProfile: ProviderProfileSnapshot = {
  id: 'tuzi',
  name: 'Tuzi',
  providerType: 'openai-compatible',
  baseUrl: 'https://api.tu-zi.com/v1',
  apiKey: 'tuzi-key',
  authType: 'bearer',
  imageApiCompatibility: 'auto',
};

function firstImageBinding(
  profile: ProviderProfileSnapshot,
  model: ModelConfig
) {
  const binding = inferBindingsForProviderModel(profile, model).find(
    (entry) => entry.operation === 'image'
  );
  if (!binding) {
    throw new Error(`No image binding for ${model.id}`);
  }
  return binding;
}

function imageBindingBySchema(
  profile: ProviderProfileSnapshot,
  model: ModelConfig,
  requestSchema: string
) {
  const binding = inferBindingsForProviderModel(profile, model).find(
    (entry) =>
      entry.operation === 'image' && entry.requestSchema === requestSchema
  );
  if (!binding) {
    throw new Error(`No ${requestSchema} image binding for ${model.id}`);
  }
  return binding;
}

describe('image routing to default registered adapters', () => {
  beforeEach(() => {
    clearModelAdapters();
    registerModelAdapter(gptImageAdapter);
    registerModelAdapter(tuziGPTImageAdapter);
    registerModelAdapter(defaultBasicImageAdapter);
    registerModelAdapter(mjImageAdapter);
    registerModelAdapter(fluxImageAdapter);
    registerModelAdapter(seedreamImageAdapter);
  });

  afterEach(() => {
    clearModelAdapters();
  });

  it('routes official GPT Image schema to the dedicated adapter', () => {
    const binding = firstImageBinding(openaiProfile, {
      id: 'gpt-image-2',
      label: 'GPT Image 2',
      type: 'image',
      vendor: ModelVendor.GPT,
    });

    expect(binding.requestSchema).toBe('openai.image.gpt-generation-json');
    expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(
      'gpt-image-adapter'
    );
  });

  it('routes official GPT Image edit schema to the dedicated adapter', () => {
    const binding = imageBindingBySchema(
      openaiProfile,
      {
        id: 'gpt-image-2',
        label: 'GPT Image 2',
        type: 'image',
        vendor: ModelVendor.GPT,
      },
      'openai.image.gpt-edit-form'
    );

    expect(binding.protocol).toBe('openai.images.edits');
    expect(binding.submitPath).toBe('/images/edits');
    expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(
      'gpt-image-adapter'
    );
  });

  it('routes Tuzi GPT Image compatibility to the dedicated adapter', () => {
    const binding = firstImageBinding(tuziProfile, {
      id: 'gpt-image-2',
      label: 'GPT Image 2',
      type: 'image',
      vendor: ModelVendor.GPT,
    });

    expect(binding.requestSchema).toBe('tuzi.image.gpt-generation-json');
    expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(
      'tuzi-gpt-image-adapter'
    );
  });

  it('executes legacy versioned Tuzi image bindings without duplicating /v1', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ url: 'https://example.com/generated.png' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );

    const result = await tuziGPTImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'legacy-versioned-binding',
          profileId: 'tuzi',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'tuzi.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/v1/images/generations',
          priority: 320,
          confidence: 'high',
          source: 'manual',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.tu-zi.com/v1/images/generations'
    );
    expect(result.url).toBe('https://example.com/generated.png');
  });

  it('executes Tuzi image requests when endpoint selection stores an origin', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ url: 'https://example.com/generated.png' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );

    await tuziGPTImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com',
        apiKey: 'test-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'origin-binding',
          profileId: 'tuzi',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'tuzi.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 320,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
      }
    );

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      'https://api.tu-zi.com/v1/images/generations'
    );
  });

  it('routes Tuzi GPT Image edit compatibility to the dedicated adapter', () => {
    const binding = imageBindingBySchema(
      tuziProfile,
      {
        id: 'gpt-image-2',
        label: 'GPT Image 2',
        type: 'image',
        vendor: ModelVendor.GPT,
      },
      'tuzi.image.gpt-edit-json'
    );

    expect(binding.protocol).toBe('openai.images.generations');
    expect(binding.submitPath).toBe('/images/generations');
    expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(
      'tuzi-gpt-image-adapter'
    );
  });

  it('keeps legacy model-only GPT Image requests on the Tuzi GPT adapter', () => {
    const adapter = resolveAdapterForInvocation('image', 'gpt-image-2', null);

    expect(adapter?.id).toBe('tuzi-gpt-image-adapter');
  });

  it('keeps generic non-GPT OpenAI-compatible image models on the default adapter', () => {
    const binding = firstImageBinding(tuziProfile, {
      id: 'qwen-image-2.0',
      label: 'Qwen Image 2.0',
      type: 'image',
      vendor: ModelVendor.QWEN,
    });

    expect(binding.requestSchema).toBe('openai.image.basic-json');
    expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(
      'gemini-image-adapter'
    );
  });

  it('routes pricing async-image bindings to the default image adapter', () => {
    const asyncTuziProfile = {
      ...tuziProfile,
      preferAsyncImageEndpoint: true,
    };
    const binding = inferBindingsForProviderModel(
      asyncTuziProfile,
      {
        id: 'gemini-3-pro-image-preview-async',
        label: 'Gemini Async Image',
        type: 'image',
        vendor: ModelVendor.GEMINI,
      },
      {
        'openai-video': {
          path: '/v1/videos',
          method: 'POST',
          scenario: 'async-image',
        },
      }
    ).find((entry) => entry.requestSchema === 'openai.async.image.form');

    expect(binding?.protocol).toBe('openai.async.media');
    expect(binding?.submitPath).toBe('/videos');
    expect(resolveAdapterForBinding(binding!, 'image')?.id).toBe(
      'gemini-image-adapter'
    );
  });

  it('keeps MJ, Flux, and Seedream on their dedicated adapters', () => {
    const cases: Array<{
      model: ModelConfig;
      adapterId: string;
    }> = [
      {
        model: {
          id: 'mj-imagine',
          label: 'Midjourney',
          type: 'image',
          vendor: ModelVendor.MIDJOURNEY,
          tags: ['mj'],
        },
        adapterId: 'mj-image-adapter',
      },
      {
        model: {
          id: 'bfl-flux-2-pro',
          label: 'Flux 2 Pro',
          type: 'image',
          vendor: ModelVendor.FLUX,
        },
        adapterId: 'flux-image-adapter',
      },
      {
        model: {
          id: 'doubao-seedream-5-0-260128',
          label: 'Seedream 5',
          type: 'image',
          vendor: ModelVendor.DOUBAO,
          tags: ['seedream'],
        },
        adapterId: 'seedream-image-adapter',
      },
    ];

    cases.forEach(({ model, adapterId }) => {
      const binding = firstImageBinding(tuziProfile, model);
      expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(adapterId);
    });
  });
});
