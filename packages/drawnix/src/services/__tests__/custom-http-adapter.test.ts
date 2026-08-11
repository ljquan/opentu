import { describe, expect, it, vi } from 'vitest';
import {
  customHttpAudioAdapter,
  customHttpImageAdapter,
  customHttpVideoAdapter,
} from '../model-adapters/custom-http-adapter';
import type { AdapterContext } from '../model-adapters/types';
import { IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE } from '../provider-routing';

function buildContext(fetcher: typeof fetch): AdapterContext {
  return {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    authType: 'bearer',
    operation: 'image',
    fetcher,
    provider: {
      profileId: 'provider-custom',
      profileName: 'Custom',
      providerType: 'custom',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    },
    binding: {
      id: 'custom-http-binding',
      profileId: 'provider-custom',
      modelId: 'custom-model',
      operation: 'image',
      protocol: 'custom-http',
      requestSchema: 'custom-http',
      responseSchema: 'custom-http.image',
      submitPath: '/render',
      priority: 900,
      confidence: 'high',
      source: 'manual',
      metadata: {
        manualHttp: {
          method: 'POST',
          bodyTemplate:
            '{"model":"{{model}}","prompt":"{{prompt}}","images":"{{images}}"}',
          responsePaths: {
            imageUrls: 'result.images.*.url',
          },
        },
      },
    },
  };
}

describe('custom-http-adapter', () => {
  it('submits image requests with the configured body template', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              images: [{ url: 'https://cdn.example.com/out.png' }],
            },
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;

    const result = await customHttpImageAdapter.generateImage(
      buildContext(fetcher),
      {
        model: 'custom-image',
        prompt: 'draw cat',
        referenceImages: ['https://example.com/ref.png'],
      }
    );

    expect(result.url).toBe('https://cdn.example.com/out.png');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/render',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'custom-model',
          prompt: 'draw cat',
          images: ['https://example.com/ref.png'],
        }),
      })
    );
  });

  it('submits image edit requests with configured form-data fields', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://example.com/ref.png') {
        return new Response(new Blob(['image'], { type: 'image/png' }), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn.example.com/edited.png' }],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const context = buildContext(fetcher);
    context.binding = {
      ...context.binding!,
      submitPath: '/images/edits',
      metadata: {
        manualHttp: {
          method: 'POST',
          bodyType: 'form-data',
          formFields: [
            { name: 'model', value: '{{model}}' },
            { name: 'prompt', value: '{{prompt}}' },
            { name: 'image', value: '{{images}}', kind: 'file-list' },
            { name: 'quality', value: '{{params.quality}}' },
          ],
          responsePaths: {
            imageUrls: 'data.*.url',
          },
        },
      },
    };

    const result = await customHttpImageAdapter.generateImage(context, {
      model: 'gpt-image-2',
      prompt: 'edit cat',
      referenceImages: ['https://example.com/ref.png'],
      params: { quality: 'high' },
    });

    expect(result.url).toBe('https://cdn.example.com/edited.png');
    const submitCall = (fetcher as any).mock.calls.find(
      (call: unknown[]) => call[0] === 'https://api.example.com/v1/images/edits'
    );
    expect(submitCall?.[1].body).toBeInstanceOf(FormData);
    expect(submitCall?.[1].headers).not.toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('keeps the configured custom image endpoint unchanged', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ url: 'https://cdn.example.com/rabbit.png' }],
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const context = buildContext(fetcher);
    context.binding = {
      ...context.binding!,
      submitPath: '/images/edits',
      metadata: {
        manualHttp: {
          method: 'POST',
          bodyType: 'form-data',
          formFields: [
            { name: 'model', value: '{{model}}' },
            { name: 'prompt', value: '{{prompt}}' },
            { name: 'image', value: '{{images}}', kind: 'file-list' },
          ],
          responsePaths: {
            imageUrls: 'data.*.url',
          },
        },
      },
    };

    const result = await customHttpImageAdapter.generateImage(context, {
      model: 'image-2',
      prompt: '兔子',
      generationMode: 'text_to_image',
    });

    expect(result.url).toBe('https://cdn.example.com/rabbit.png');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/images/edits',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('uses modelRef.modelId for custom HTTP model template variables', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ url: 'https://cdn.example.com/edited.png' }],
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const context = buildContext(fetcher);
    context.binding = {
      ...context.binding!,
      modelId: 'gpt-image-2',
      submitPath: '/images/edits',
      metadata: {
        manualHttp: {
          method: 'POST',
          bodyType: 'form-data',
          formFields: [
            { name: 'model', value: '{{model}}' },
            { name: 'prompt', value: '{{prompt}}' },
          ],
          responsePaths: {
            imageUrls: 'data.*.url',
          },
        },
      },
    };

    await customHttpImageAdapter.generateImage(context, {
      model: 'image2',
      modelRef: { profileId: 'provider-custom', modelId: 'gpt-image-2' },
      prompt: 'edit cat',
      generationMode: 'image_edit',
    });

    const submitCall = (fetcher as any).mock.calls.find(
      (call: unknown[]) => call[0] === 'https://api.example.com/v1/images/edits'
    );
    expect(submitCall?.[1].body).toBeInstanceOf(FormData);
    expect((submitCall?.[1].body as FormData).get('model')).toBe('gpt-image-2');
  });

  it('uses binding model id for custom HTTP templates when request modelRef is missing', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ url: 'https://cdn.example.com/rabbit.png' }],
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const context = buildContext(fetcher);
    context.binding = {
      ...context.binding!,
      modelId: 'image-2',
      submitPath: '/images/generations',
      metadata: {
        manualHttp: {
          method: 'POST',
          bodyTemplate:
            '{"model":"{{model}}","prompt":"{{prompt}}","size":"{{size}}"}',
          responsePaths: {
            imageUrls: 'data.*.url',
          },
        },
      },
    };

    await customHttpImageAdapter.generateImage(context, {
      model: '',
      prompt: '兔子',
      size: '1024x1024',
      generationMode: 'text_to_image',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/images/generations',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'image-2',
          prompt: '兔子',
          size: '1024x1024',
        }),
      })
    );
  });

  it('propagates an interrupted trusted synchronous image response', async () => {
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
    const context = buildContext(fetcher);
    context.baseUrl = 'https://api.tu-zi.com/v1';
    context.requestId = 'custom-http-interrupted-response';
    context.provider = {
      ...context.provider!,
      baseUrl: 'https://api.tu-zi.com/v1',
    };
    context.binding = {
      ...context.binding!,
      submitPath: '/images/generations',
    };

    await expect(
      customHttpImageAdapter.generateImage(context, {
        model: 'custom-image',
        prompt: 'draw cat',
      })
    ).rejects.toMatchObject({
      code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the implicit POST method for recoverable custom image submissions', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('Failed to fetch'));
    const context = buildContext(fetcher);
    context.baseUrl = 'https://api.tu-zi.com/v1';
    context.requestId = 'custom-http-implicit-post';
    context.provider = {
      ...context.provider!,
      baseUrl: 'https://api.tu-zi.com/v1',
    };
    context.binding = {
      ...context.binding!,
      submitPath: '/images/generations',
      metadata: {
        manualHttp: {
          bodyTemplate: '{"model":"{{model}}","prompt":"{{prompt}}"}',
        },
      },
    };

    await expect(
      customHttpImageAdapter.generateImage(context, {
        model: 'custom-image',
        prompt: 'draw cat',
      })
    ).rejects.toMatchObject({
      code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://bus.tu-zi.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('propagates a cleanly closed truncated synchronous image response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"data":[', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const context = buildContext(fetcher);
    context.baseUrl = 'https://api.tu-zi.com/v1';
    context.requestId = 'custom-http-truncated-response';
    context.provider = {
      ...context.provider!,
      baseUrl: 'https://api.tu-zi.com/v1',
    };
    context.binding = {
      ...context.binding!,
      submitPath: '/images/generations',
    };

    const thrown = await customHttpImageAdapter
      .generateImage(context, {
        model: 'custom-image',
        prompt: 'draw cat',
      })
      .catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      message: '自定义接口未按配置返回图片 URL',
    });
    expect(thrown).not.toMatchObject({
      code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves a complete non-JSON response as a protocol error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('[plain text', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
    const context = buildContext(fetcher);
    context.baseUrl = 'https://api.tu-zi.com/v1';
    context.requestId = 'custom-http-complete-non-json';
    context.provider = {
      ...context.provider!,
      baseUrl: 'https://api.tu-zi.com/v1',
    };
    context.binding = {
      ...context.binding!,
      submitPath: '/images/generations',
    };

    const thrown = await customHttpImageAdapter
      .generateImage(context, {
        model: 'custom-image',
        prompt: 'draw cat',
      })
      .catch((error: unknown) => error);

    expect(thrown).toMatchObject({
      message: '自定义接口未按配置返回图片 URL',
    });
    expect(thrown).not.toMatchObject({
      code: IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps custom async image submissions out of synchronous recovery', async () => {
    const networkError = new Error('Failed to fetch');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);
    const context = buildContext(fetcher);
    context.baseUrl = 'https://api.tu-zi.com/v1';
    context.requestId = 'custom-http-async-response';
    context.provider = {
      ...context.provider!,
      baseUrl: 'https://api.tu-zi.com/v1',
    };
    context.binding = {
      ...context.binding!,
      submitPath: '/images/generations',
      pollPathTemplate: '/custom/tasks/{taskId}',
    };

    await expect(
      customHttpImageAdapter.generateImage(context, {
        model: 'custom-image',
        prompt: 'draw cat',
      })
    ).rejects.toBe(networkError);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('normalizes direct video result URLs from configured paths', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              video: 'https://cdn.example.com/out.mp4',
            },
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const context = buildContext(fetcher);
    context.operation = 'video';
    context.binding = {
      ...context.binding!,
      operation: 'video',
      responseSchema: 'custom-http.task',
      metadata: {
        manualHttp: {
          method: 'POST',
          bodyTemplate: '{"model":"{{model}}","prompt":"{{prompt}}"}',
          responsePaths: {
            resultUrl: 'data.video',
          },
        },
      },
    };

    const result = await customHttpVideoAdapter.generateVideo(context, {
      model: 'custom-video',
      prompt: 'move slowly',
    });

    expect(result.url).toBe('https://cdn.example.com/out.mp4');
  });

  it('normalizes direct audio URLs without requiring a task id', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              audio: 'https://cdn.example.com/out.mp3',
            },
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    const context = buildContext(fetcher);
    context.operation = 'audio';
    context.binding = {
      ...context.binding!,
      operation: 'audio',
      responseSchema: 'custom-http.audio',
      submitPath: '/audio/generations',
      metadata: {
        manualHttp: {
          method: 'POST',
          bodyTemplate:
            '{"model":"{{model}}","prompt":"{{prompt}}","title":"{{params.title}}"}',
          responsePaths: {
            audioUrl: 'result.audio',
          },
        },
      },
    };

    const result = await customHttpAudioAdapter.generateAudio(context, {
      model: 'custom-audio',
      prompt: 'soft piano',
      title: 'Night',
    });

    expect(result).toMatchObject({
      url: 'https://cdn.example.com/out.mp3',
      title: 'Night',
      format: 'mp3',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/audio/generations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'custom-model',
          prompt: 'soft piano',
          title: 'Night',
        }),
      })
    );
  });
});
