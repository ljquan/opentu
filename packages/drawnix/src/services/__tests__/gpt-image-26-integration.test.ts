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
  getTuziGPTImageRequestPath,
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
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const svg = btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><circle r="10"/></svg>'
);
const staleRequest: ImageGenerationRequest = {
  model,
  prompt: '小猫挥手',
  size: '4096x4096',
  background: 'transparent',
  outputFormat: 'jpeg',
  outputCompression: 40,
  inputFidelity: 'high',
  params: {
    gpt_image_26_output: 'gif',
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

describe.each(['gpt-image-2.6', 'gpt-image-2.6-1k', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])(
  'GPT Image 2.6 integration: %s', (model) => {
  const staleRequestForModel = { ...staleRequest, model };
  const responseParams = model === 'gpt-image-2.6-1k' ? { response_format: 'b64_json' } : {};
  const gifParams = model === 'gpt-image-2.6-1k' ? {} : { output_format: 'gif' };
  const sentPrompt = `${staleRequest.prompt}\n透明图\n生成 GIF 图`;
  const staleEditRequestForModel = {
    ...staleRequestForModel,
    outputFormat: undefined,
    params: { ...staleRequest.params, gpt_image_26_output: 'auto', output_format: undefined },
  };
  const imageParams = { background: 'transparent', moderation: 'low', user: 'old-setting' };

  it('keeps the chosen provider while aligning a stale model reference with the binding', () => {
    expect(
      normalizeGPTImage26Request(
        {
          ...staleRequestForModel,
          modelRef: {
            profileId: 'selected-provider',
            modelId: 'gpt-image-2.5',
          },
        },
        model
      ).modelRef
    ).toEqual({ profileId: 'selected-provider', modelId: model });
  });

  it('sends reference-guided GIF requests to multipart edits', async () => {
    const modelId = model;
    for (const adapter of [gptImageAdapter, tuziGPTImageAdapter]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({ data: [{ b64_json: gif, width: 437, height: 389 }] }),
        { status: 200 }
      ));
      const result = await adapter.generateImage({
        baseUrl: 'https://api.tu-zi.com/v1', fetcher,
      }, {
        model: modelId,
        prompt: '让主体挥手，背景不变',
        referenceImages: [png],
        size: 'auto',
        outputFormat: 'jpeg',
        outputCompression: 40,
        params: {
          gpt_image_26_output: modelId === 'gpt-image-2.6-1k' ? 'gif' : 'gif_official',
          output_format: 'png',
          response_format: 'url',
          frame_count: 5,
        },
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toContain('/images/edits');
      const form = fetcher.mock.calls[0][1]?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('model')).toBe(modelId);
      expect(form.get('output_format')).toBe('gif');
      expect(form.get('response_format')).toBe(modelId === 'gpt-image-2.6-1k' ? 'b64_json' : null);
      expect(form.get('image[]')).toBeInstanceOf(Blob);
      expect(form.has('mask')).toBe(false);
      expect(form.has('output_compression')).toBe(false);
      expect(form.get('frame_count')).toBe(modelId === 'gpt-image-2.6-1k' ? null : '5');
      expect(result).toMatchObject({ format: 'gif', width: 437, height: 389 });
    }
  });

  it('keeps ordinary Tuzi reference edits on the existing JSON route', () => {
    const request = { model, prompt: '调整颜色', referenceImages: [png] };
    expect(getTuziGPTImageRequestPath(request)).toBe('/images/generations');
    expect(buildTuziGPTImageRequestBody(request).image).toEqual([png]);
    expect(normalizeGPTImage26Request(request).params?.output_format).toBeUndefined();
    expect(getTuziGPTImageRequestPath({ model, prompt: '生成 GIF 图' })).toBe('/images/generations');
    expect(getTuziGPTImageRequestPath({ model, prompt: '循环播放', referenceImages: [png] })).toBe('/images/edits');
    expect(getTuziGPTImageRequestPath({ model: 'gpt-image-2.5', prompt: '生成 GIF 图', referenceImages: [png] })).toBe('/images/generations');
  });

  it('accepts explicit GIF output for an edit without a GIF keyword', async () => {
    const request = { model, prompt: 'Wave once',
      referenceImages: [png], size: '512x512', params: { output_format: 'gif' },
    };
    const form = await buildGPTImageEditFormData(request);
    expect(form.get('output_format')).toBe('gif');
    expect(form.get('size')).toBe('auto');
    expect((await buildTuziGPTImageEditFormData(request)).get('size')).toBe('auto');
  });
  it('registers the channel model without changing the default', () => {
    expect(getStaticModelConfig(model)).toMatchObject({
      id: model,
      label: model,
      shortCode: {
        'gpt-image-2.6': 'gpt26',
        'gpt-image-2.6-1k': 'gpt261k',
        'gpt-image-2.6-flare': 'gpt26f',
        'gpt-image-2.6-sunburst': 'gpt26s',
      }[model],
      type: 'image',
      vendor: 'GPT',
    });
    expect(DEFAULT_IMAGE_MODEL_ID).toBe('gpt-image-2.5-sunburst');
    expect(getCompatibleParams(model)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'size',
        defaultValue: 'auto',
        options: model !== 'gpt-image-2.6-1k' ? [
          { value: 'auto', label: '自动' },
          { value: '1x1', label: '1:1 方形' },
          { value: '2x3', label: '2:3 竖版' },
          { value: '3x2', label: '3:2 横版' },
          { value: '3x4', label: '3:4 竖版' },
          { value: '4x3', label: '4:3 横版' },
          { value: '4x5', label: '4:5 竖版' },
          { value: '5x4', label: '5:4 横版' },
          { value: '9x16', label: '9:16 竖版' },
          { value: '16x9', label: '16:9 横版' },
          { value: '21x9', label: '21:9 超宽' },
        ] : [
          { value: 'auto', label: '自动（原始尺寸）' },
          { value: '1024x1024', label: '1:1 方形' },
          { value: '1024x1536', label: '2:3 竖版' },
          { value: '1536x1024', label: '3:2 横版' },
          { value: '16x9', label: '16:9 横屏' },
          { value: '9x16', label: '9:16 竖屏' },
        ],
      }),
      expect.objectContaining({ id: 'gpt_image_26_output', defaultValue: 'auto' }),
    ]));
    expect(getCompatibleParams(model).some((param) => param.id === 'resolution')).toBe(model !== 'gpt-image-2.6-1k');
    for (const id of ['background', 'quality', 'output_format', 'output_compression', 'input_fidelity', 'moderation', 'user']) {
      expect(getCompatibleParams(model).some((param) => param.id === id), id).toBe(true);
    }
    expect(isGPTImage26ModelId(` ${model.toUpperCase()} `)).toBe(true);
    expect(isGPTImage2ModelId(model)).toBe(false);
    expect(isGPTImage25ModelId(model)).toBe(false);
    for (const unavailable of [
      'gpt-image-2.6-exact',
      'gpt-image-2.6-unknown',
    ]) {
      expect(getStaticModelConfig(unavailable)).toBeUndefined();
      expect(isGPTImage26ModelId(unavailable)).toBe(false);
      expect(isGPTImage2ModelId(unavailable)).toBe(false);
    }
  });

  it.each([buildGPTImageGenerationBody, buildTuziGPTImageRequestBody])(
    'keeps shared image controls without forwarding incompatible saved fields',
    (build) => {
      expect(build(staleRequestForModel)).toEqual({
        model,
        prompt: sentPrompt,
        size: 'auto',
        n: 1,
        ...responseParams,
        ...gifParams,
        ...imageParams,
      });
    }
  );

  it.each([
    ['auto', 'auto', undefined],
    ['1024x1024', '1024x1024', '1:1'],
    ['1024x1536', '1024x1536', '2:3'],
    ['1536x1024', '1536x1024', '3:2'],
    ['16:9', '16x9', '16:9'],
    ['9:16', '9x16', '9:16'],
    ['1:1', '1024x1024', '1:1'],
    ['2x3', '1024x1536', '2:3'],
    [' 1536X1024 ', '1536x1024', '3:2'],
    ['4096x4096', 'auto', undefined],
  ])('preserves size %s as a GIF ratio hint or the original 1k request', (size, expected, ratio) => {
    const request = {
      ...staleRequestForModel,
      size: '4096x4096',
      params: { ...staleRequest.params, size },
    };
    for (const build of [buildGPTImageGenerationBody, buildTuziGPTImageRequestBody]) {
      expect(build(request)).toEqual({
        model,
        prompt: model !== 'gpt-image-2.6-1k' && ratio
          ? `${staleRequest.prompt}\nGIF 每帧画面比例：${ratio}\n透明图\n生成 GIF 图`
          : sentPrompt,
        size: model === 'gpt-image-2.6-1k' ? expected : 'auto',
        n: 1,
        ...responseParams,
        ...gifParams,
        ...imageParams,
      });
    }
    const params = { resolution: '4k', gpt_image_26_output: 'gif' };
    expect(resolveOfficialGPTImageSize(model, size, params)).toBe(expected);
    expect(resolveOfficialGPTImageEditSize(model, size, params)).toBe(expected);
  });

  it('uses the selected top-level size when no size parameter is provided', () => {
    const request = { model, prompt: '静态图', size: '1536x1024' };
    expect(buildGPTImageGenerationBody(request).size).toBe('1536x1024');
    expect(buildTuziGPTImageRequestBody(request).size).toBe('1536x1024');
  });

  it('keeps explicit dimensions in both multipart edit paths without restoring stale output parameters', async () => {
    const request = {
      ...staleEditRequestForModel,
      referenceImages: [`data:image/gif;base64,${gif}`],
      maskImage: `data:image/gif;base64,${gif}`,
      params: { ...staleEditRequestForModel.params, size: '1024x1536', resolution: 'auto' },
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
      expect(form.get('output_format')).toBe('png');
    }
  });

  it('normalizes against the binding model and keeps references for Tuzi edits', () => {
    expect(
      buildTuziGPTImageRequestBody(
        {
          ...staleEditRequestForModel,
          model: 'gpt-image-2.5',
          referenceImages: ['https://example.com/source.png'],
        },
        model
      )
    ).toEqual({
      model,
      prompt: `${staleRequest.prompt}\n透明图`,
      size: model === 'gpt-image-2.6-1k' ? 'auto' : '4096x4096',
      n: 1,
      ...responseParams,
      ...imageParams,
      output_format: 'png',
      input_fidelity: 'high',
      image: ['https://example.com/source.png'],
    });
  });

  it('keeps references in multipart edits without inherited quality/output fields', async () => {
    const form = await buildGPTImageEditFormData({
      ...staleEditRequestForModel,
      referenceImages: [`data:image/gif;base64,${gif}`],
    });
    expect([...form.keys()].sort()).toEqual([
      'background',
      'image[]',
      'input_fidelity',
      'model',
      'moderation',
      'n',
      'output_format',
      'prompt',
      ...(model === 'gpt-image-2.6-1k' ? ['response_format'] : []),
      'size',
      'user',
    ]);
    expect(form.get('model')).toBe(model);
    expect(form.get('size')).toBe(model === 'gpt-image-2.6-1k' ? 'auto' : '4096x4096');
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
        staleRequestForModel
      );
      expect(fetcher).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
        model,
        prompt: sentPrompt,
        size: 'auto',
        n: 1,
        ...responseParams,
        ...gifParams,
        ...imageParams,
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
              request_id: 'upstream-svg-request',
            },
          }),
          { status: 400, headers: { 'x-request-id': 'gateway-hop' } }
        )
      );
      await expect(
        adapter.generateImage(
          { baseUrl: 'https://api.tu-zi.com/v1', fetcher },
          staleRequestForModel
        )
      ).rejects.toMatchObject({
        httpStatus: 400,
        message: expect.stringContaining('上游仅返回了无法访问的内部文件链接'),
        diagnostics: {
          requestId: 'upstream-svg-request',
          apiErrorCode: 'bad_request',
          httpStatus: 400,
          modelId: model,
        },
      });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  );
});
