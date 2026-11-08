import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCompatibleParams,
  getStaticModelConfig,
} from '../../constants/model-config';
import {
  SEEDREAM_FLASH_MODEL_ID,
  SEEDREAM_FLASH_PATH,
  SEEDREAM_FLASH_REQUEST_SCHEMA,
} from '../../constants/seedream-flash';
import {
  inferBindingsForProviderModel,
  InvocationPlanner,
  providerTransport,
} from '../provider-routing';
import {
  clearModelAdapters,
  registerModelAdapter,
  resolveAdapterForBinding,
  resolveAdapterForModel,
} from '../model-adapters/registry';
import { seedreamImageAdapter } from '../model-adapters/seedream-adapter';
import {
  buildSeedreamFlashRequestBody,
  hasSeedreamFlashPngAlpha,
  seedreamFlashImageAdapter,
} from '../model-adapters/seedream-flash-adapter';
import type { ImageGenerationRequest } from '../model-adapters/types';

const mocks = vi.hoisted(() => ({ getCachedBlob: vi.fn() }));
vi.mock('../unified-cache-service', () => ({ unifiedCacheService: mocks }));

const alphaBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DQAAAEgQGALFXOsAAAAABJRU5ErkJggg==';
const opaqueBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const alphaPng = `data:image/png;base64,${alphaBase64}`;
const opaquePng = `data:image/png;base64,${opaqueBase64}`;
const bytes = (encoded: string) =>
  Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
const request: ImageGenerationRequest = {
  model: SEEDREAM_FLASH_MODEL_ID,
  prompt: 'A blue cup',
};
const profile = {
  id: 'flash-provider',
  name: 'Dedicated service',
  providerType: 'openai-compatible' as const,
  baseUrl: 'https://dedicated.example.test/v1',
  apiKey: 'test-only-key',
  authType: 'bearer' as const,
  preferAsyncImageEndpoint: true,
};
const success = (
  item: Record<string, unknown> = {
    url: 'https://cdn.example.test/result.png',
    size: '832x1248',
  }
) =>
  new Response(JSON.stringify({ data: [item] }), {
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearModelAdapters();
});

describe('Seedream Flash exact catalog and routing', () => {
  it('exposes only the Flash controls and keeps neighboring contracts', () => {
    expect(getStaticModelConfig(SEEDREAM_FLASH_MODEL_ID)?.label).toBe(
      'Seedream 5.0 Flash'
    );
    const params = getCompatibleParams(SEEDREAM_FLASH_MODEL_ID);
    expect(params.map((param) => param.id)).toEqual([
      'size',
      'output_format',
      'background',
      'watermark',
      'optimize_prompt_mode',
    ]);
    expect(params[0].options?.map((option) => option.value)).toEqual([
      '1K',
      '1.5K',
      '2K',
    ]);
    expect(
      getCompatibleParams('seedream-5.0')
        .find((param) => param.id === 'seedream_quality')
        ?.options?.map((option) => option.value)
    ).toEqual(['2k', '3k']);
    expect(
      getStaticModelConfig(`${SEEDREAM_FLASH_MODEL_ID}-unknown`)
    ).toBeUndefined();
  });

  it('ignores asynchronous discovery hints and resolves Flash before legacy tags', () => {
    const bindings = inferBindingsForProviderModel(
      profile,
      getStaticModelConfig(SEEDREAM_FLASH_MODEL_ID)!,
      {
        async: { path: '/v1/videos', method: 'POST', scenario: 'async-image' },
        legacy: { path: '/v1/images/generations', method: 'POST' },
      }
    );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      requestSchema: SEEDREAM_FLASH_REQUEST_SCHEMA,
      submitPath: SEEDREAM_FLASH_PATH,
      baseUrlStrategy: 'trim-v1',
    });
    registerModelAdapter(seedreamImageAdapter);
    registerModelAdapter(seedreamFlashImageAdapter);
    expect(resolveAdapterForBinding(bindings[0], 'image')).toBe(
      seedreamFlashImageAdapter
    );
    expect(resolveAdapterForModel(SEEDREAM_FLASH_MODEL_ID, 'image')).toBe(
      seedreamFlashImageAdapter
    );
    expect(resolveAdapterForModel('seedream-5.0', 'image')).toBe(
      seedreamImageAdapter
    );
  });

  it.each([
    'openai.images.generations',
    'openai.async.media',
    'openai.images.edits',
  ])(
    'corrects persisted %s bindings before asynchronous execution can be selected',
    (protocol) => {
      const original = {
        ...inferBindingsForProviderModel(
          profile,
          getStaticModelConfig(SEEDREAM_FLASH_MODEL_ID)!
        )[0],
        protocol,
        requestSchema: 'openai.async.image.form',
        submitPath: '/videos',
        pollPathTemplate: '/videos/{taskId}',
      };
      const planner = new InvocationPlanner({
        getProviderProfile: () => profile,
        getModelBindings: () => [original],
      });
      const plan = planner.plan({
        operation: 'image',
        modelRef: { profileId: profile.id, modelId: SEEDREAM_FLASH_MODEL_ID },
        bindingId: original.id,
      });
      expect(plan.binding).toMatchObject({
        id: original.id,
        protocol: 'openai.images.generations',
        requestSchema: SEEDREAM_FLASH_REQUEST_SCHEMA,
        submitPath: SEEDREAM_FLASH_PATH,
      });
      expect(plan.binding.pollPathTemplate).toBeUndefined();
      expect(original.submitPath).toBe('/videos');
      expect(plan.provider.baseUrl).toBe(profile.baseUrl);
    }
  );
});

describe('Seedream Flash request validation', () => {
  it('uses explicit defaults and isolates unsupported parameters', () => {
    expect(
      buildSeedreamFlashRequestBody({
        ...request,
        params: { n: 1, seed: 7, quality: '4k', unknown: null },
      })
    ).toEqual({
      model: SEEDREAM_FLASH_MODEL_ID,
      prompt: request.prompt,
      size: '1K',
      response_format: 'url',
      output_format: 'png',
      background: 'opaque',
      watermark: false,
    });
  });
  it('serializes UI strings as native booleans and the documented optimization object', () => {
    expect(
      buildSeedreamFlashRequestBody({
        ...request,
        size: '1.5k',
        params: { watermark: 'false', optimize_prompt_mode: 'standard' },
      })
    ).toMatchObject({
      size: '1.5K',
      watermark: false,
      optimize_prompt_options: { mode: 'standard' },
    });
  });
  it.each(['1280x720', '3840x240', '240x3840', '1634x2830', '2K'])(
    'accepts valid boundary/tier size %s',
    (size) =>
      expect(buildSeedreamFlashRequestBody({ ...request, size }).size).toBe(
        size
      )
  );
  it.each([
    'auto',
    '3K',
    '4K',
    '960x959',
    '1634x2831',
    '3841x240',
    '0x2048',
    '1280X720',
    '1x1',
  ])('rejects invalid size %s', (size) =>
    expect(() => buildSeedreamFlashRequestBody({ ...request, size })).toThrow(
      '尺寸'
    )
  );
  it.each([
    { prompt: '  ' },
    { maskImage: alphaPng },
    { params: { stream: true } },
    { params: { layer_decomposition: true } },
    { params: { watermark: null } },
    { params: { optimize_prompt_options: { mode: 'fast' } } },
    {
      params: { optimize_prompt_options: { mode: 'standard', unknown: true } },
    },
    { outputFormat: 'webp' },
    { params: { output_format: null } },
    { referenceImages: ['javascript:alert(1)'] },
    { referenceImages: ['data:image/png;base64,broken'] },
    {
      referenceImages: Array(11).fill('https://cdn.example.test/reference.png'),
    },
  ] as Partial<ImageGenerationRequest>[])(
    'rejects an invalid parameter combination %#',
    (extra) =>
      expect(() =>
        buildSeedreamFlashRequestBody({ ...request, ...extra })
      ).toThrow()
  );
  it('supports all ten references and omits an empty internal reference list', () => {
    const refs = Array(10).fill('https://cdn.example.test/reference.png');
    expect(
      buildSeedreamFlashRequestBody({ ...request, referenceImages: refs }).image
    ).toEqual(refs);
    expect(
      buildSeedreamFlashRequestBody({ ...request, referenceImages: [] })
    ).not.toHaveProperty('image');
  });
  it('requires PNG alpha rather than a PNG signature or filename', () => {
    expect(hasSeedreamFlashPngAlpha(bytes(alphaBase64))).toBe(true);
    expect(hasSeedreamFlashPngAlpha(bytes(opaqueBase64))).toBe(false);
    expect(hasSeedreamFlashPngAlpha(bytes(alphaBase64).subarray(0, 33))).toBe(
      false
    );
    expect(
      buildSeedreamFlashRequestBody({
        ...request,
        background: 'transparent',
        referenceImages: [alphaPng],
      }).image
    ).toBe(alphaPng);
    for (const extra of [
      { referenceImages: [] },
      { referenceImages: [alphaPng, alphaPng] },
      { referenceImages: [opaquePng] },
      { referenceImages: [alphaPng], outputFormat: 'jpeg' as const },
    ])
      expect(() =>
        buildSeedreamFlashRequestBody({
          ...request,
          background: 'transparent',
          ...extra,
        })
      ).toThrow();
  });
});

describe('Seedream Flash transport and results', () => {
  it('rejects undecodable transparent PNG data before any paid submission', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(
      new Error('Invalid PNG pixels')
    );
    const fetcher = vi.fn();
    await expect(
      seedreamFlashImageAdapter.generateImage(
        { baseUrl: profile.baseUrl, fetcher },
        {
          ...request,
          background: 'transparent',
          referenceImages: [alphaPng],
        }
      )
    ).rejects.toThrow('无法解码');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'https://dedicated.example.test',
    'https://dedicated.example.test/v1/',
  ])('sends one authenticated v3 submission using %s', async (baseUrl) => {
    const fetcher = vi.fn().mockResolvedValue(success());
    const result = await seedreamFlashImageAdapter.generateImage(
      { baseUrl, apiKey: 'test-only-key', fetcher, operation: 'image' },
      request
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://dedicated.example.test/api/v3/images/generations'
    );
    const init = fetcher.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer test-only-key');
    expect(JSON.parse(init.body).watermark).toBe(false);
    expect(result).toMatchObject({
      width: 832,
      height: 1248,
      format: 'png',
      raw: { data: [{ size: '832x1248' }] },
    });
  });
  it('reads cached alpha PNG bytes without compression', async () => {
    mocks.getCachedBlob.mockResolvedValue(
      new Blob([bytes(alphaBase64)], { type: 'image/png' })
    );
    const fetcher = vi.fn().mockResolvedValue(success());
    await seedreamFlashImageAdapter.generateImage(
      { baseUrl: profile.baseUrl, fetcher },
      {
        ...request,
        background: 'transparent',
        referenceImages: ['/__aitu_cache__/image/alpha.png'],
      }
    );
    expect(mocks.getCachedBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/alpha.png'
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body).image).toBe(alphaPng);
  });
  it('validates a remote transparent image without sending provider credentials to its host', async () => {
    const remoteBlob = new Blob([bytes(alphaBase64)], { type: 'image/png' });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, blob: async () => remoteBlob })
      .mockResolvedValueOnce(success());
    await seedreamFlashImageAdapter.generateImage(
      { baseUrl: profile.baseUrl, apiKey: 'test-only-key', fetcher },
      {
        ...request,
        background: 'transparent',
        referenceImages: ['https://cdn.example.test/alpha.png'],
      }
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers');
    expect(JSON.parse(fetcher.mock.calls[1][1].body).image).toBe(alphaPng);
  });
  it('fails without paid submission when remote transparency cannot be verified', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      seedreamFlashImageAdapter.generateImage(
        { baseUrl: profile.baseUrl, fetcher },
        {
          ...request,
          background: 'transparent',
          referenceImages: ['https://cdn.example.test/alpha.png'],
        }
      )
    ).rejects.toThrow('重新导入');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('method', 'POST');
  });
  it('uses per-image JPEG metadata when decoding Base64', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      success({
        b64_json: '/9j/2Q==',
        output_format: 'jpeg',
        size: '1536x1536',
      })
    );
    const result = await seedreamFlashImageAdapter.generateImage(
      { baseUrl: profile.baseUrl, fetcher },
      { ...request, params: { response_format: 'b64_json' } }
    );
    expect(result).toMatchObject({
      url: 'data:image/jpeg;base64,/9j/2Q==',
      format: 'jpeg',
      width: 1536,
      height: 1536,
    });
  });
  it.each([
    { data: [] },
    { data: [{ b64_json: alphaBase64 }] },
    { data: [{ url: 'javascript:alert(1)' }] },
    { data: [{ url: 'https://cdn.test/layer.png', z_index: 0 }] },
    { error: { message: 'model rejected request' } },
    null,
  ])('rejects invalid successful responses %#', async (payload) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(
      seedreamFlashImageAdapter.generateImage(
        { baseUrl: profile.baseUrl, fetcher },
        request
      )
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains HTTP error details and never retries', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'permission denied' } }),
          { status: 403 }
        )
      );
    await expect(
      seedreamFlashImageAdapter.generateImage(
        { baseUrl: profile.baseUrl, fetcher },
        request
      )
    ).rejects.toMatchObject({ message: 'permission denied', httpStatus: 403 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry an uncertain submission or start v1 recovery', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      seedreamFlashImageAdapter.generateImage(
        {
          baseUrl: profile.baseUrl,
          fetcher,
          operation: 'image',
          requestId: 'flash-test',
        },
        request
      )
    ).rejects.toThrow('避免重复提交和扣费');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('Seedream Flash local same-origin response delivery', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('window', { location: new URL('http://localhost:7201') });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['http://127.0.0.1:7201', 'http://[::1]:7201'])(
    'also uses the loopback proxy at %s',
    async (origin) => {
      vi.stubGlobal('window', { location: new URL(origin) });
      const fetcher = vi.fn().mockResolvedValue(success());
      await seedreamFlashImageAdapter.generateImage(
        { baseUrl: 'https://api.tu-zi.com/v1', fetcher },
        request
      );
      expect(new URL(fetcher.mock.calls[0][0]).origin).toBe(origin);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('does not rewrite other API paths or read-only requests', () => {
    const context = {
      ...profile,
      profileId: profile.id,
      profileName: profile.name,
      baseUrl: 'https://api.tu-zi.com',
    };
    for (const [path, method] of [
      ['/v1/images/generations', 'POST'],
      [SEEDREAM_FLASH_PATH, 'GET'],
    ]) {
      const prepared = providerTransport.prepareRequest(context, {
        path,
        method,
      });
      expect(new URL(prepared.url).origin).toBe('https://api.tu-zi.com');
      expect(new URL(prepared.url).pathname).toBe(path);
    }
  });

  it('checks credential ownership before rewriting the transport destination', () => {
    const prepared = providerTransport.prepareRequest(
      {
        ...profile,
        profileId: profile.id,
        profileName: profile.name,
        extraHeaders: { 'X-Provider-Secret': 'custom-secret' },
      },
      { path: `https://api.tu-zi.com${SEEDREAM_FLASH_PATH}`, method: 'POST' }
    );
    expect(prepared.url).toContain(
      '/__opentu_tuzi_proxy__/api/api/v3/images/generations'
    );
    expect(prepared.headers).not.toHaveProperty('Authorization');
    expect(prepared.headers).not.toHaveProperty('X-Provider-Secret');
  });

  it('keeps server-side requests direct when no browser origin exists', () => {
    vi.stubGlobal('window', undefined);
    const prepared = providerTransport.prepareRequest(
      {
        ...profile,
        profileId: profile.id,
        profileName: profile.name,
        baseUrl: 'https://api.tu-zi.com',
      },
      { path: SEEDREAM_FLASH_PATH, method: 'POST' }
    );
    expect(prepared.url).toBe(`https://api.tu-zi.com${SEEDREAM_FLASH_PATH}?ch=0`);
  });

  it.each(['https://api.tu-zi.com', 'https://api.tu-zi.com/v1/'])(
    'reads a generated URL through the fixed local proxy for %s',
    async (baseUrl) => {
      const fetcher = vi.fn().mockResolvedValue(success());
      const onResponse = vi.fn();
      const onSubmissionAttempt = vi.fn();
      const result = await seedreamFlashImageAdapter.generateImage(
        {
          baseUrl,
          apiKey: 'test-only-key',
          operation: 'image',
          requestId: 'flash-local',
          provider: {
            ...profile,
            baseUrl,
            profileId: profile.id,
            profileName: profile.name,
          },
          fetcher,
          onResponse,
          onSubmissionAttempt,
        },
        request
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe(
        'http://localhost:7201/__opentu_tuzi_proxy__/api/api/v3/images/generations?ch=2'
      );
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        headers: {
          Authorization: 'Bearer test-only-key',
          'Content-Type': 'application/json',
        },
      });
      expect(init.headers).not.toHaveProperty('X-Request-Id');
      expect(JSON.parse(init.body)).toEqual(
        buildSeedreamFlashRequestBody(request)
      );
      expect(onResponse).toHaveBeenCalledTimes(1);
      expect(onSubmissionAttempt).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        url: 'https://cdn.example.test/result.png',
        width: 832,
        height: 1248,
      });
    }
  );

  it('reads inline image bytes through the same proxy', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        success({ b64_json: alphaBase64, output_format: 'png', size: '1x1' })
      );
    const result = await seedreamFlashImageAdapter.generateImage(
      {
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-only-key',
        fetcher,
        operation: 'image',
      },
      { ...request, params: { response_format: 'b64_json' } }
    );
    expect(fetcher.mock.calls[0][0]).toContain(
      '/__opentu_tuzi_proxy__/api/api/v3/images/generations'
    );
    expect(result).toMatchObject({
      url: alphaPng,
      width: 1,
      height: 1,
      format: 'png',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves a readable provider failure without submitting again', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'permission denied' } }),
          { status: 403 }
        )
      );
    await expect(
      seedreamFlashImageAdapter.generateImage(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: 'test-only-key',
          fetcher,
          operation: 'image',
        },
        request
      )
    ).rejects.toMatchObject({ message: 'permission denied', httpStatus: 403 });
    expect(fetcher.mock.calls[0][0]).toContain(
      '/__opentu_tuzi_proxy__/api/api/v3/images/generations'
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to a direct paid POST after a proxy connection failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      seedreamFlashImageAdapter.generateImage(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          fetcher,
          operation: 'image',
        },
        request
      )
    ).rejects.toThrow('避免重复提交和扣费');
    expect(fetcher.mock.calls[0][0]).toContain(
      '/__opentu_tuzi_proxy__/api/api/v3/images/generations'
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      baseUrl: 'https://dedicated.example.test/v1',
      origin: 'http://localhost:7201',
      dev: true,
    },
    {
      baseUrl: 'https://bus.tu-zi.com/v1',
      origin: 'http://localhost:7201',
      dev: true,
    },
    {
      baseUrl: 'https://api.tu-zi.com.evil.test/v1',
      origin: 'http://localhost:7201',
      dev: true,
    },
    {
      baseUrl: 'https://api.tu-zi.com:444/v1',
      origin: 'http://localhost:7201',
      dev: true,
    },
    {
      baseUrl: 'http://api.tu-zi.com/v1',
      origin: 'http://localhost:7201',
      dev: true,
    },
    {
      baseUrl: 'https://api.tu-zi.com/v1',
      origin: 'https://opentu.ai',
      dev: true,
    },
    {
      baseUrl: 'https://api.tu-zi.com/v1',
      origin: 'http://localhost:7201',
      dev: false,
    },
  ])(
    'keeps the configured destination for $baseUrl at $origin with dev=$dev',
    async ({ baseUrl, origin, dev }) => {
      vi.stubEnv('DEV', dev);
      vi.stubGlobal('window', { location: new URL(origin) });
      const fetcher = vi.fn().mockResolvedValue(success());
      await seedreamFlashImageAdapter.generateImage(
        { baseUrl, apiKey: 'test-only-key', fetcher },
        request
      );
      const target = new URL(fetcher.mock.calls[0][0]);
      expect(target.origin).toBe(new URL(baseUrl).origin);
      expect(target.pathname).toBe(SEEDREAM_FLASH_PATH);
      expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
        'Bearer test-only-key'
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
});
