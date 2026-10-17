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
import {
  IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
  inferBindingsForProviderModel,
} from '../provider-routing';
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

  it.each(['gpt-image2-vip', 'gpt-image2', 'image-2.5'])(
    'routes the GPT Image 2 alias %s to the Tuzi adapter',
    (modelId) => {
      const binding = firstImageBinding(tuziProfile, {
        id: modelId,
        label: modelId,
        type: 'image',
        vendor: ModelVendor.GPT,
      });

      expect(binding.modelId).toBe(modelId);
      expect(binding.requestSchema).toBe('tuzi.image.gpt-generation-json');
      expect(resolveAdapterForBinding(binding, 'image')?.id).toBe(
        'tuzi-gpt-image-adapter'
      );
    }
  );

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
            data: [
              {
                url: 'https://example.com/generated.png',
                width: 1024,
                height: 1024,
              },
            ],
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
            data: [
              {
                url: 'https://example.com/generated.png',
                width: 1024,
                height: 1024,
              },
            ],
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

  it('repairs legacy image-2 only for Tuzi image routing', () => {
    const tuziBinding = firstImageBinding(tuziProfile, {
      id: 'image-2',
      label: 'Legacy Image 2',
      type: 'image',
      vendor: ModelVendor.OTHER,
      tags: ['runtime', 'manual'],
    });
    const openaiBinding = firstImageBinding(openaiProfile, {
      id: 'image-2',
      label: 'Third-party Image 2',
      type: 'image',
      vendor: ModelVendor.OTHER,
      tags: ['runtime', 'manual'],
    });

    expect(tuziBinding.requestSchema).toBe('tuzi.image.gpt-generation-json');
    expect(resolveAdapterForBinding(tuziBinding, 'image')?.id).toBe(
      'tuzi-gpt-image-adapter'
    );
    expect(openaiBinding.requestSchema).toBe('openai.image.basic-json');
    expect(resolveAdapterForBinding(openaiBinding, 'image')?.id).toBe(
      'gemini-image-adapter'
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

  it.each(['/images/generations', '/images/edits'])(
    'submits a masked Tuzi edit through provider transport despite the %s binding',
    async (submitPath) => {
      const binding = imageBindingBySchema(tuziProfile, {
        id: 'gpt-image-2', label: 'GPT Image 2', type: 'image', vendor: ModelVendor.GPT,
      }, 'tuzi.image.gpt-edit-json');
      binding.submitPath = submitPath;
      const adapter = resolveAdapterForBinding(binding, 'image') as ImageModelAdapter;
      const controller = new AbortController();
      const onSubmissionAttempt = vi.fn();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
        data: [{ url: 'https://example.com/edited.png', width: 1024, height: 1024 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
      const result = await adapter.generateImage({
        baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test-key', authType: 'bearer',
        operation: 'image', requestId: 'masked-edit-1', signal: controller.signal,
        binding, fetcher, onSubmissionAttempt,
      }, {
        model: 'gpt-image-2', prompt: 'Replace the masked region',
        generationMode: 'image_edit', referenceImages: [png], maskImage: png,
      });
      expect(onSubmissionAttempt).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe('https://api.tu-zi.com/v1/images/edits');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-key');
      expect(headers.get('X-Request-Id')).toBe('masked-edit-1');
      expect(headers.has('Content-Type')).toBe(false);
      expect(init?.signal?.aborted).toBe(false);
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.getAll('image[]')).toHaveLength(1);
      expect(form.get('image[]')).toBeInstanceOf(Blob);
      expect(form.get('mask')).toBeInstanceOf(Blob);
      expect(result.url).toBe('https://example.com/edited.png');
    }
  );

  it('routes the exact Tuzi image-2.5 ID to multipart edits without changing its model ID', async () => {
    const binding = imageBindingBySchema(tuziProfile, {
      id: 'image-2.5', label: 'image-2.5', type: 'image', vendor: ModelVendor.GPT,
    }, 'tuzi.image.gpt-edit-json');
    const adapter = resolveAdapterForBinding(binding, 'image') as ImageModelAdapter;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://example.com/edit.png', width: 1024, height: 1024 }],
    }), { status: 200 }));
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    await adapter.generateImage({
      baseUrl: tuziProfile.baseUrl, apiKey: 'test-key', binding, fetcher,
    }, { model: 'image-2.5', prompt: 'Edit cup', referenceImages: [png], maskImage: png });
    expect(adapter.id).toBe('tuzi-gpt-image-adapter');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.tu-zi.com/v1/images/edits');
    const form = fetcher.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get('model')).toBe('image-2.5');
    expect(form.get('mask')).toBeInstanceOf(Blob);
  });

  it('does not apply the Tuzi image-2.5 alias to another provider', () => {
    const binding = firstImageBinding(openaiProfile, {
      id: 'image-2.5', label: 'image-2.5', type: 'image', vendor: ModelVendor.GPT,
    });
    expect(binding.requestSchema).toBe('openai.image.basic-json');
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

  it.each([
    ['GPT Image', gptImageAdapter],
    ['Tuzi GPT Image', tuziGPTImageAdapter],
  ])(
    'propagates an interrupted %s response as an unknown submission outcome',
    async (_label, adapter) => {
      let emittedPartialBody = false;
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!emittedPartialBody) {
                emittedPartialBody = true;
                controller.enqueue(new TextEncoder().encode('{"data":['));
                return;
              }
              controller.error(new Error('response stream disconnected'));
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      await expect(
        adapter.generateImage(
          {
            baseUrl: 'https://bus.tu-zi.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
            operation: 'image',
            requestId: `interrupted-${adapter.id}`,
            fetcher,
            binding: null,
          },
          {
            model: 'gpt-image-2',
            prompt: 'Draw a clean product photo',
          }
        )
      ).rejects.toMatchObject({
        code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
      });

      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('propagates an interrupted Seedream response as an unknown submission outcome', async () => {
    let emittedPartialBody = false;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!emittedPartialBody) {
              emittedPartialBody = true;
              controller.enqueue(new TextEncoder().encode('{"data":['));
              return;
            }
            controller.error(new Error('response stream disconnected'));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    await expect(
      seedreamImageAdapter.generateImage(
        {
          baseUrl: 'https://bus.tu-zi.com/v1',
          apiKey: 'test-key',
          authType: 'bearer',
          operation: 'image',
          requestId: 'seedream-interrupted-response',
          fetcher,
          binding: null,
        },
        {
          model: 'doubao-seedream-5-0-260128',
          prompt: 'Draw a clean product photo',
        }
      )
    ).rejects.toMatchObject({
      code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
