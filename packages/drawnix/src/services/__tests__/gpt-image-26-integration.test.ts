import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMAGE_MODEL_ID,
  getCompatibleParams,
  getStaticModelConfig,
  isGPTImage2ModelId,
  isGPTImage25ModelId,
  isGPTImage26ModelId,
} from '../../constants/model-config';
import {
  buildGPTImageGenerationBody,
  buildGPTImageEditFormData,
  gptImageAdapter,
  parseGPTImageResponse,
} from '../model-adapters/gpt-image-adapter';
import {
  buildTuziGPTImageRequestBody,
  buildTuziGPTImageEditFormData,
  tuziGPTImageAdapter,
} from '../model-adapters/tuzi-gpt-image-adapter';
import {
  resolveOfficialGPTImageSize,
  resolveOfficialGPTImageEditSize,
} from '../model-adapters/image-size-quality-resolver';
import { inferBindingsForProviderModel } from '../provider-routing';
import type { ImageGenerationRequest } from '../model-adapters/types';
import { normalizeGPTImage26Request } from '../model-adapters/gpt-image-26-request';

const model = 'gpt-image-2.6-1k';
const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const svg = btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><circle r="10"/></svg>'
);
const staleRequest: ImageGenerationRequest = {
  model,
  prompt: '生成 GIF 图：小猫挥手',
  size: '4096x4096',
  background: 'transparent',
  outputFormat: 'jpeg',
  outputCompression: 40,
  inputFidelity: 'high',
  params: {
    size: '4096x4096',
    resolution: '4k',
    quality: 'max',
    n: 4,
    output_format: 'png',
    response_format: 'url',
    background: 'opaque',
    moderation: 'low',
    user: 'old-setting',
    thinking: 'high',
  },
};

describe('GPT Image 2.6 1K integration', () => {
  it('keeps the chosen provider while aligning a stale model reference with the binding', () => {
    expect(
      normalizeGPTImage26Request(
        {
          ...staleRequest,
          modelRef: {
            profileId: 'selected-provider',
            modelId: 'gpt-image-2.5',
          },
        },
        model
      ).modelRef
    ).toEqual({ profileId: 'selected-provider', modelId: model });
  });
  it('registers an isolated channel model without changing the default', () => {
    expect(getStaticModelConfig(model)).toMatchObject({
      id: model,
      label: model,
      shortCode: 'gpt261k',
      type: 'image',
      vendor: 'GPT',
    });
    expect(DEFAULT_IMAGE_MODEL_ID).toBe('gpt-image-2.5-sunburst');
    expect(getCompatibleParams(model)).toEqual([
      expect.objectContaining({
        id: 'size',
        defaultValue: 'auto',
        options: [
          { value: 'auto', label: '自动（原始尺寸）' },
          { value: '1024x1024', label: '1:1 方形' },
          { value: '1024x1536', label: '2:3 竖版' },
          { value: '1536x1024', label: '3:2 横版' },
          { value: '16x9', label: '16:9 横屏' },
          { value: '9x16', label: '9:16 竖屏' },
        ],
      }),
    ]);
    expect(isGPTImage26ModelId(` ${model.toUpperCase()} `)).toBe(true);
    expect(isGPTImage2ModelId(model)).toBe(false);
    expect(isGPTImage25ModelId(model)).toBe(false);
    for (const unavailable of [
      'gpt-image-2.6',
      'gpt-image-2.6-exact',
      'gpt-image-2.6-flare',
    ]) {
      expect(getStaticModelConfig(unavailable)).toBeUndefined();
      expect(isGPTImage26ModelId(unavailable)).toBe(false);
      expect(isGPTImage2ModelId(unavailable)).toBe(false);
    }
  });

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])(
    'sends only verified parameters despite saved settings from other models',
    (build) => {
      expect(build(staleRequest)).toEqual({
        model,
        prompt: staleRequest.prompt,
        size: 'auto',
        n: 1,
        response_format: 'b64_json',
      });
    }
  );

  it.each([
    ['auto', 'auto'],
    ['1024x1024', '1024x1024'],
    ['1024x1536', '1024x1536'],
    ['1536x1024', '1536x1024'],
    ['16:9', '16x9'],
    ['9:16', '9x16'],
    ['1:1', '1024x1024'],
    ['2x3', '1024x1536'],
    [' 1536X1024 ', '1536x1024'],
    ['4096x4096', 'auto'],
  ])('preserves verified size %s across GPT and Tuzi generation routes', (size, expected) => {
    const request = {
      ...staleRequest,
      size: '4096x4096',
      params: { ...staleRequest.params, size },
    };
    for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
      expect(build(request)).toEqual({
        model,
        prompt: request.prompt,
        size: expected,
        n: 1,
        response_format: 'b64_json',
      });
    }
    expect(resolveOfficialGPTImageSize(model, size, { resolution: '4k' })).toBe(expected);
    expect(resolveOfficialGPTImageEditSize(model, size, { resolution: '4k' })).toBe(expected);
  });

  it('uses the selected top-level size when no size parameter is provided', () => {
    const request = { model, prompt: '静态图', size: '1536x1024' };
    expect(buildGPTImageGenerationBody(request).size).toBe('1536x1024');
    expect(buildTuziGPTImageRequestBody(request).size).toBe('1536x1024');
  });

  it('keeps explicit dimensions in both multipart edit paths without restoring stale output parameters', async () => {
    const request = {
      ...staleRequest,
      referenceImages: [`data:image/gif;base64,${gif}`],
      maskImage: `data:image/gif;base64,${gif}`,
      params: { ...staleRequest.params, size: '1024x1536' },
    };
    const forms = [
      await buildGPTImageEditFormData(request),
      await buildTuziGPTImageEditFormData(request, model),
    ];
    for (const form of forms) {
      expect(form.get('model')).toBe(model);
      expect(form.get('size')).toBe('1024x1536');
      expect(form.has('image[]')).toBe(true);
      expect(form.has('mask')).toBe(true);
      expect(form.has('quality')).toBe(false);
      expect(form.has('output_format')).toBe(false);
    }
  });

  it('normalizes against the binding model and keeps references for Tuzi edits', () => {
    expect(
      buildTuziGPTImageRequestBody(
        {
          ...staleRequest,
          model: 'gpt-image-2.5',
          referenceImages: ['https://example.com/source.png'],
        },
        model
      )
    ).toEqual({
      model,
      prompt: staleRequest.prompt,
      size: 'auto',
      n: 1,
      response_format: 'b64_json',
      image: ['https://example.com/source.png'],
    });
  });

  it('keeps references in multipart edits without inherited quality/output fields', async () => {
    const form = await buildGPTImageEditFormData({
      ...staleRequest,
      referenceImages: [`data:image/gif;base64,${gif}`],
    });
    expect([...form.keys()].sort()).toEqual([
      'image[]',
      'model',
      'n',
      'prompt',
      'response_format',
      'size',
    ]);
    expect(form.get('model')).toBe(model);
    expect(form.get('size')).toBe('auto');
    expect((form.get('image[]') as File).type).toBe('image/gif');
  });

  it.each(['auto', 'openai-gpt-image'] as const)(
    'retains provider/model identities when inferring %s routes',
    (compatibility) => {
      const bindings = inferBindingsForProviderModel(
        {
          id: 'selected-tuzi',
          name: 'Selected provider',
          providerType: 'openai-compatible',
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-key',
          authType: 'bearer',
          imageApiCompatibility: compatibility,
        },
        getStaticModelConfig(model)!
      );
      expect(bindings).toHaveLength(2);
      expect(
        bindings.every(
          (binding) =>
            binding.modelId === model && binding.profileId === 'selected-tuzi'
        )
      ).toBe(true);
      expect(bindings[0].requestSchema).toBe(
        compatibility === 'auto'
          ? 'tuzi.image.gpt-generation-json'
          : 'openai.image.gpt-generation-json'
      );
    }
  );

  it.each([
    ['gif', gif, 'image/gif'],
    ['svg', svg, 'image/svg+xml'],
  ])(
    'preserves %s bytes in both primary and batch results despite PNG format hints',
    (format, encoded, mime) => {
      const result = parseGPTImageResponse({
        output_format: 'png',
        data: [{ b64_json: encoded, width: 80, height: 40 }],
      });
      expect(result).toMatchObject({
        url: `data:${mime};base64,${encoded}`,
        urls: [`data:${mime};base64,${encoded}`],
        format,
        width: 80,
        height: 40,
      });
      expect(
        parseGPTImageResponse({
          data: [{ b64_json: `data:image/png;base64,${encoded}` }],
        }).format
      ).toBe(format);
    }
  );

  it.each([
    'sandbox:/mnt/data/result.svg',
    '[下载图片](sandbox:/mnt/data/result.svg)',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'not an image',
    'data:image/png;base64,bm90YW5pbWFnZQ==',
  ])('rejects unusable successful response content: %s', (url) => {
    expect(() => parseGPTImageResponse({ data: [null, { url }] })).toThrow(
      '未返回有效的图片数据'
    );
  });

  it('falls back to a valid URL when an invalid base64 field accompanies it', () => {
    expect(
      parseGPTImageResponse({
        data: [{ b64_json: 'invalid', url: 'https://example.com/result.gif' }],
      })
    ).toMatchObject({ url: 'https://example.com/result.gif', format: 'gif' });
  });

  it.each([gptImageAdapter, tuziGPTImageAdapter])(
    '$id completes an animated result without changing model or output format',
    async (adapter) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ b64_json: gif, width: 553, height: 309 }],
          }),
          { status: 200 }
        )
      );
      const result = await adapter.generateImage(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-key',
          authType: 'bearer',
          fetcher,
        },
        staleRequest
      );
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
        model,
        prompt: staleRequest.prompt,
        size: 'auto',
        n: 1,
        response_format: 'b64_json',
      });
      expect(result).toMatchObject({ format: 'gif', width: 553, height: 309 });
    }
  );

  it.each([gptImageAdapter, tuziGPTImageAdapter])(
    '$id surfaces upstream SVG rejection without retrying or claiming success',
    async (adapter) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            accepted: true,
            retryable: false,
            error: {
              message: '[下载 SVG](sandbox:/mnt/data/result.svg)',
              code: 'bad_request',
            },
          }),
          { status: 400 }
        )
      );
      await expect(
        adapter.generateImage(
          { baseUrl: 'https://api.tu-zi.com/v1', fetcher },
          staleRequest
        )
      ).rejects.toMatchObject({
        httpStatus: 400,
        message: expect.stringContaining('sandbox:'),
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  );
});
