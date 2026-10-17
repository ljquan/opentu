import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLUX_3_IMAGE_ASPECT_RATIOS,
  TUZI_FLUX_3_IMAGE_RESOLUTIONS,
  getCompatibleParams,
  getModelConfig,
} from '../../constants/model-config';
import {
  buildTuziFlux3ImageRequestBody,
  tuziFlux3ImageAdapter,
} from '../model-adapters/tuzi-flux-3-image-adapter';
import { inferBindingsForProviderModel } from '../provider-routing';
import {
  clearModelAdapters,
  registerModelAdapter,
  resolveAdapterForBinding,
  resolveAdapterForModel,
  resolveAdapterForInvocation,
} from '../model-adapters/registry';
import { fluxImageAdapter } from '../model-adapters/flux-adapter';
import type { ProviderProfileSnapshot } from '../provider-routing';

const mocks = vi.hoisted(() => ({ send: vi.fn(), resolvePlan: vi.fn() }));
vi.mock('../provider-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../provider-routing')>()),
  resolveInvocationPlanFromRoute: mocks.resolvePlan,
}));
vi.mock('../model-adapters/context', () => ({
  sendAdapterRequest: mocks.send,
}));

const request = { model: 'flux-3-image', prompt: 'A teapot' };
const context = { baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test' };
const profile: ProviderProfileSnapshot = {
  id: 'tuzi',
  name: 'Tuzi',
  providerType: 'openai-compatible',
  baseUrl: context.baseUrl,
  apiKey: 'test',
  authType: 'bearer',
  preferAsyncImageEndpoint: true,
};

afterEach(() => {
  vi.clearAllMocks();
  mocks.resolvePlan.mockReset();
  clearModelAdapters();
});

describe('Tuzi Flux 3 catalog and routing', () => {
  it.each([
    ['https://api.tu-zi.com/v1', 'tuzi-flux-3-image-adapter'],
    ['https://other-provider.example/v1', 'flux-image-adapter'],
  ])('handles persisted Flux task bindings for %s', (baseUrl, adapterId) => {
    const binding = inferBindingsForProviderModel(
      profile,
      getModelConfig('flux-3-image')!
    )[0];
    mocks.resolvePlan.mockReturnValue({
      provider: { ...profile, baseUrl },
      binding: {
        ...binding,
        protocol: 'flux.task',
        requestSchema: 'flux.image.polling-json',
        submitPath: '/flux/v1/flux-3-image',
        pollPathTemplate: '/flux/v1/get_result?id={taskId}',
      },
    });
    registerModelAdapter(fluxImageAdapter);
    registerModelAdapter(tuziFlux3ImageAdapter);
    expect(resolveAdapterForInvocation('image', 'flux-3-image')?.id).toBe(adapterId);
  });
  it('exposes every official ratio and resolution exactly once', () => {
    const params = getCompatibleParams('flux-3-image');
    expect(params.filter((p) => p.id === 'size')).toHaveLength(1);
    expect(
      params.find((p) => p.id === 'size')?.options?.map((o) => o.value)
    ).toEqual(FLUX_3_IMAGE_ASPECT_RATIOS.map((r) => r.replace(':', 'x')));
    expect(
      params.find((p) => p.id === 'resolution')?.options?.map((o) => o.value)
    ).toEqual(TUZI_FLUX_3_IMAGE_RESOLUTIONS);
  });

  it('uses the dedicated binding even with discovered Flux and async endpoints', () => {
    const bindings = inferBindingsForProviderModel(
      profile,
      getModelConfig('flux-3-image')!,
      {
        flux: { path: '/flux/v1/flux-3-image', method: 'POST' },
        async: { path: '/v1/images/generations/async', method: 'POST' },
      }
    );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      requestSchema: 'tuzi.image.flux-3-generation-json',
      submitPath: '/images/generations',
      baseUrlStrategy: 'ensure-v1',
    });
    registerModelAdapter(tuziFlux3ImageAdapter);
    registerModelAdapter(fluxImageAdapter);
    expect(resolveAdapterForBinding(bindings[0], 'image')).toBe(
      tuziFlux3ImageAdapter
    );
    expect(resolveAdapterForModel('flux-3-image', 'image')).toBe(
      tuziFlux3ImageAdapter
    );
    expect(
      inferBindingsForProviderModel(
        profile,
        getModelConfig('bfl-flux-2-pro')!
      )[0].requestSchema
    ).toBe('flux.image.polling-json');
    expect(resolveAdapterForModel('bfl-flux-2-pro', 'image')).toBe(
      fluxImageAdapter
    );
  });
});

describe('Tuzi Flux 3 request contract', () => {
  it.each(FLUX_3_IMAGE_ASPECT_RATIOS)('serializes %s aspect ratio', (ratio) => {
    expect(
      buildTuziFlux3ImageRequestBody({
        ...request,
        size: ratio.replace(':', 'x'),
      }).aspect_ratio
    ).toBe(ratio);
  });
  it.each(TUZI_FLUX_3_IMAGE_RESOLUTIONS)(
    'serializes %s resolution',
    (resolution) => {
      expect(
        buildTuziFlux3ImageRequestBody({ ...request, params: { resolution } })
      ).toMatchObject({
        resolution,
        generationConfig: {
          imageConfig: { imageSize: resolution.toUpperCase() },
        },
      });
    }
  );
  it('accepts saved exact pixel ratios and strips unrelated GPT options', () => {
    const body = buildTuziFlux3ImageRequestBody({
      ...request,
      size: '1536x1024',
      params: {
        quality: 'high',
        background: 'transparent',
        grounding: false,
        safety_tolerance: 0,
      },
    });
    expect(body).toMatchObject({
      aspect_ratio: '3:2',
      grounding: false,
      safety_tolerance: 0,
    });
    expect(body).not.toHaveProperty('quality');
    expect(body).not.toHaveProperty('background');
  });
  it.each([
    { resolution: '8k' },
    { resolution: '768sq' },
    { resolution: '1.5k' },
    { resolution: false },
    { size: 'square' },
    { n: 0 },
    { n: 11 },
    { n: 1.5 },
    { response_format: 'png' },
    { grounding: 'false' },
    { safety_tolerance: -1 },
    { safety_tolerance: 5 },
  ])('rejects invalid controls before sending: %j', async (params) => {
    await expect(
      tuziFlux3ImageAdapter.generateImage(context, { ...request, params })
    ).rejects.toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects too many references and masks rather than truncating them', () => {
    expect(() =>
      buildTuziFlux3ImageRequestBody({
        ...request,
        referenceImages: Array(11).fill('https://example.test/ref.png'),
      })
    ).toThrow('10');
    expect(() =>
      buildTuziFlux3ImageRequestBody({ ...request, maskImage: 'mask' })
    ).toThrow('蒙版');
  });
  it('uses the live-tested image field and keeps all ten references', () => {
    const referenceImages = Array(10).fill('data:image/png;base64,source');
    expect(
      buildTuziFlux3ImageRequestBody({ ...request, referenceImages })
    ).toHaveProperty('image', referenceImages);
    expect(
      buildTuziFlux3ImageRequestBody({ ...request, referenceImages })
    ).not.toHaveProperty('images');
  });
});

describe('Tuzi Flux 3 response contract', () => {
  it('submits through shared transport and preserves all URL and base64 outputs', async () => {
    const data = {
      data: [
        { url: 'https://example.test/out.png', width: 1024, height: 1024 },
        { b64_json: 'aGVsbG8=' },
      ],
    };
    mocks.send.mockResolvedValue(
      new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const result = await tuziFlux3ImageAdapter.generateImage(context, request);
    expect(mocks.send).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        path: '/images/generations',
        baseUrlStrategy: 'ensure-v1',
        method: 'POST',
      })
    );
    expect(result).toMatchObject({
      url: data.data[0].url,
      width: 1024,
      height: 1024,
      urls: [data.data[0].url, 'data:image/png;base64,aGVsbG8='],
    });
  });
  it.each([
    ['<!DOCTYPE html><html>website</html>', 'text/html', 'HTML'],
    ['not json', 'text/plain', 'JSON'],
    ['{"id":"task"}', 'application/json', '图片数据'],
    ['null', 'application/json', '图片数据'],
    ['{"data":[null,{}, {"url":42,"b64_json":true}]}', 'application/json', '图片数据'],
  ])('diagnoses malformed success responses', async (body, type, message) => {
    mocks.send.mockResolvedValue(
      new Response(body, { headers: { 'Content-Type': type } })
    );
    await expect(
      tuziFlux3ImageAdapter.generateImage(context, request)
    ).rejects.toThrow(message);
  });
  it('skips unusable entries and preserves valid outputs and provider data', async () => {
    const data = {
      output_format: 'jpeg',
      data: [
        null,
        {},
        { url: 42 },
        { url: 'https://example.test/out.jpg', b64_json: true, width: 1024, height: 1024 },
        { b64_json: 'aGVsbG8=' },
      ],
    };
    mocks.send.mockResolvedValue(Response.json(data));
    const result = await tuziFlux3ImageAdapter.generateImage(context, request);
    expect(result.urls).toEqual([
      'https://example.test/out.jpg',
      'data:image/jpeg;base64,aGVsbG8=',
    ]);
    expect(result.raw).toEqual(data);
  });
  it('preserves HTTP status for provider error handling', async () => {
    mocks.send.mockResolvedValue(
      new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 })
    );
    await expect(
      tuziFlux3ImageAdapter.generateImage(context, request)
    ).rejects.toMatchObject({ message: 'Quota exceeded', httpStatus: 429 });
  });
  it.each([
    [413, 'Request Entity Too Large'],
    [502, JSON.stringify({ error: { message: 'Upstream error: HTTP 413: FUNCTION_PAYLOAD_TOO_LARGE' } })],
  ])('explains upstream payload limits for HTTP %s', async (status, body) => {
    mocks.send.mockResolvedValue(new Response(body, { status }));
    await expect(
      tuziFlux3ImageAdapter.generateImage(context, request)
    ).rejects.toMatchObject({
      message: 'Flux 3 参考图片请求超过上游大小限制，请压缩图片或减少参考图后重试',
      httpStatus: status,
      upstreamHttpStatus: 413,
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('diagnoses HTML from the screenshot task endpoint without polling', async () => {
    mocks.send.mockResolvedValue(
      new Response('<html>web</html>', {
        headers: { 'Content-Type': 'text/html' },
      })
    );
    await expect(
      fluxImageAdapter.generateImage(context, request)
    ).rejects.toThrow('HTML');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
