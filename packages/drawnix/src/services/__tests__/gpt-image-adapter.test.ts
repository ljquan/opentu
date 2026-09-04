import { describe, expect, it, vi } from 'vitest';
import {
  buildGPTImageEditFormData,
  buildGPTImageGenerationBody,
  gptImageAdapter,
  parseGPTImageResponse,
  resolveGeneratedImageDimensions,
} from '../model-adapters/gpt-image-adapter';

const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const tinyPngBase64Only =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('gpt-image-adapter', () => {
  it('builds official GPT Image generation JSON without response_format by default', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '16x9',
      params: {
        resolution: '2k',
        quality: 'high',
        output_format: 'webp',
        output_compression: 80,
        n: 2,
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '2736x1536',
      quality: 'high',
      output_format: 'webp',
      output_compression: 80,
      n: 2,
    });
  });

  it.each(['gpt-image2-vip', 'gpt-image2'])(
    'maps the GPT Image 2 alias %s without rewriting the submitted model id',
    (modelId) => {
      const body = buildGPTImageGenerationBody({
        model: modelId,
        prompt: 'Draw a clean product photo',
        size: '16x9',
        params: {
          resolution: '4k',
        },
      });

      expect(body).toEqual({
        model: modelId,
        prompt: 'Draw a clean product photo',
        size: '3840x2160',
      });
    }
  );

  it('treats legacy 1K/2K/4K quality values as resolution compatibility hints', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '4x3',
      params: {
        quality: '2k',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '2368x1776',
    });
  });

  it('normalizes invalid GPT Image pixel sizes back to a supported mapped size', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '800x600',
      params: {
        resolution: '2k',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '2368x1776',
    });
  });

  it('keeps legacy GPT Image models on official standard sizes only', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-1',
      prompt: 'Draw a clean product photo',
      size: '16x9',
      params: {
        resolution: '4k',
        quality: 'high',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-1',
      prompt: 'Draw a clean product photo',
      size: '1536x1024',
      quality: 'high',
    });
  });

  it('preserves explicit b64_json response_format for GPT Image generation', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      params: {
        response_format: 'b64_json',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      response_format: 'b64_json',
    });
  });

  it('builds official GPT Image edit form data with image files', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      size: '1x1',
      referenceImages: [tinyPngDataUrl],
      maskImage: tinyPngDataUrl,
      inputFidelity: 'high',
      background: 'transparent',
      outputFormat: 'png',
      outputCompression: 80,
      params: {},
    });

    expect(body.get('model')).toBe('gpt-image-2');
    expect(body.get('prompt')).toBe('Change the style');
    expect(body.has('response_format')).toBe(false);
    expect(body.get('input_fidelity')).toBe('high');
    expect(body.get('size')).toBe('1024x1024');
    expect(body.get('output_format')).toBe('png');
    expect(body.get('output_compression')).toBe('80');
    expect(body.get('background')).toBe('transparent');
    expect(body.getAll('image[]')).toHaveLength(1);
    expect(body.get('image[]')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeInstanceOf(Blob);
  });

  it('builds official GPT Image edit form data without response_format by default', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      referenceImages: [tinyPngDataUrl],
      generationMode: 'image_edit',
    });

    expect(body.has('response_format')).toBe(false);
  });

  it('accepts params.mask_image as a compatible edit mask input', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      referenceImages: [tinyPngDataUrl],
      generationMode: 'image_edit',
      params: {
        mask_image: tinyPngDataUrl,
      },
    });

    expect(body.getAll('image[]')).toHaveLength(1);
    expect(body.get('image[]')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeInstanceOf(Blob);
  });

  it('maps GPT Image 2 edit requests through resolution tiers', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      size: '800x600',
      referenceImages: [tinyPngDataUrl],
      params: {
        resolution: '4k',
      },
    });

    expect(body.get('size')).toBe('3312x2480');
  });

  it('keeps legacy GPT Image edit requests on standard edit sizes', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-1',
      prompt: 'Change the style',
      size: '16x9',
      referenceImages: [tinyPngDataUrl],
      params: {
        resolution: '4k',
      },
    });

    expect(body.get('size')).toBe('1536x1024');
  });

  it('fetches remote image and mask URLs for edit form data', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const type = url.endsWith('.webp') ? 'image/webp' : 'image/png';
      return new Response(new Blob(['ok'], { type }), { status: 200 });
    });

    const body = await buildGPTImageEditFormData(
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        size: '16x9',
        referenceImages: ['https://example.com/source.webp'],
        maskImage: 'https://example.com/mask.png',
      },
      fetcher as unknown as typeof fetch
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://example.com/source.webp'
    );
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://example.com/mask.png');
    expect(body.get('size')).toBe('1360x768');
    expect(body.get('image[]')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeInstanceOf(Blob);
  });

  it('accepts bare base64 image inputs without fetching', async () => {
    const fetcher = vi.fn();

    const body = await buildGPTImageEditFormData(
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        referenceImages: [tinyPngBase64Only],
      },
      fetcher as unknown as typeof fetch
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(body.get('image[]')).toBeInstanceOf(Blob);
  });

  it('surfaces remote image fetch failures for edit form data', async () => {
    const fetcher = vi.fn(async () => {
      return new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      });
    });

    await expect(
      buildGPTImageEditFormData(
        {
          model: 'gpt-image-2',
          prompt: 'Change the style',
          referenceImages: ['https://example.com/missing.png'],
        },
        fetcher as unknown as typeof fetch
      )
    ).rejects.toThrow('GPT Image 编辑图片读取失败: 404 Not Found');
  });

  it('requires reference images for official GPT Image edit form data', async () => {
    await expect(
      buildGPTImageEditFormData({
        model: 'gpt-image-2',
        prompt: 'Change the style',
      })
    ).rejects.toThrow('GPT Image 编辑请求缺少参考图片');
  });

  it('parses GPT Image b64_json results into data URLs', () => {
    const result = parseGPTImageResponse(
      {
        output_format: 'png',
        data: [
          {
            b64_json:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
        ],
      },
      'png'
    );

    expect(result.url).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
    expect(result.format).toBe('png');
  });

  it('accepts gateway URL results for compatibility', () => {
    const result = parseGPTImageResponse({
      data: [
        {
          url: 'https://example.com/image.webp',
        },
      ],
    });

    expect(result.url).toBe('https://example.com/image.webp');
    expect(result.format).toBe('webp');
  });

  it.each([
    [{ width: 1024, height: 1536 }, 1024, 1536],
    [{ width: '1536', height: '1024' }, 1536, 1024],
    [{ size: '1024x1536' }, 1024, 1536],
  ])(
    'preserves provider image dimensions from %o',
    (metadata, width, height) => {
      const result = parseGPTImageResponse({
        data: [{ url: 'https://example.com/image.png', ...metadata }],
      });

      expect(result).toMatchObject({ width, height });
    }
  );

  it('preserves a provider size shared by the response', () => {
    const result = parseGPTImageResponse({
      size: '1024x1536',
      data: [{ url: 'https://example.com/image.png' }],
    });

    expect(result).toMatchObject({ width: 1024, height: 1536 });
  });

  it('does not invent dimensions when provider metadata is invalid', () => {
    const result = parseGPTImageResponse({
      data: [
        {
          url: 'https://example.com/image.png',
          width: 0,
          height: 1536,
          size: '2x3',
        },
      ],
    });

    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
  });

  it('reads the final upstream image pixel size when response metadata is absent', async () => {
    class StubImage {
      naturalWidth = 1024;
      naturalHeight = 1536;
      decoding = 'auto';
      referrerPolicy = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', StubImage);

    try {
      const result = await resolveGeneratedImageDimensions({
        url: 'https://example.com/final.png',
        format: 'png',
        raw: { data: [{ url: 'https://example.com/final.png' }] },
      });

      expect(result).toMatchObject({ width: 1024, height: 1536 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends official GPT Image requests through provider transport', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              width: 1,
              height: 1,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        requestId: 'task-gpt-image-1',
        signal: controller.signal,
        fetcher,
        binding: {
          id: 'binding',
          profileId: 'openai',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'openai.image.gpt-generation-json',
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
        size: '1x1',
        params: {},
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    });
    expect(init?.headers).not.toHaveProperty('X-Request-Id');
    expect(init?.signal).toBe(controller.signal);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '1024x1024',
    });
  });

  it('uses the provider binding model id instead of a stale task model alias', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ url: 'https://example.com/out.png' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        requestId: 'task-gpt-image-1',
        signal: controller.signal,
        fetcher,
        binding: {
          id: 'binding',
          profileId: 'openai',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'openai.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 900,
          confidence: 'high',
          source: 'manual',
        },
      },
      {
        model: 'image2',
        prompt: '兔子',
        size: '1x1',
      }
    );

    const [, init] = fetcher.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-image-2',
      prompt: '兔子',
    });
  });

  it('retries a Tuzi image-2 custom binding with gpt-image-2 after model_not_found', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'model_not_found',
              message: '分组 default 下模型 dall-e 无可用渠道',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ url: 'https://example.com/out.png' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'legacy-binding',
          profileId: 'tuzi',
          modelId: 'image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'openai.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 900,
          confidence: 'high',
          source: 'manual',
        },
      },
      {
        model: 'image-2',
        prompt: '兔子',
        size: '1x1',
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'image-2',
      prompt: '兔子',
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      model: 'gpt-image-2',
      prompt: '兔子',
    });
  });

  it('sends official GPT Image edit requests to the edits endpoint', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          output_format: 'png',
          data: [
            {
              b64_json:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              width: 1,
              height: 1,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'binding',
          profileId: 'openai',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.edits',
          requestSchema: 'openai.image.gpt-edit-form',
          responseSchema: 'openai.image.data',
          submitPath: '/images/edits',
          priority: 319,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        size: '1x1',
        referenceImages: [tinyPngDataUrl],
        generationMode: 'image_edit',
        maskImage: tinyPngDataUrl,
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
    });
    expect(
      (init?.headers as Record<string, string>)['Content-Type']
    ).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
    const formData = init?.body as FormData;
    expect(formData.get('model')).toBe('gpt-image-2');
    expect(formData.get('prompt')).toBe('Change the style');
    expect(formData.has('response_format')).toBe(false);
    expect(formData.get('size')).toBe('1024x1024');
    expect(formData.getAll('image[]')).toHaveLength(1);
    expect(formData.get('image[]')).toBeInstanceOf(Blob);
    expect(formData.get('mask')).toBeInstanceOf(Blob);
  });

  it('keeps edit mode on the edits endpoint even with a generation binding fallback', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              url: 'https://example.com/out.png',
              width: 1024,
              height: 1024,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'binding',
          profileId: 'openai',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'openai.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 320,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        referenceImages: [tinyPngDataUrl],
        generationMode: 'image_to_image',
      }
    );

    const [url] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
  });
});
