import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPricingSourceSignature,
  derivePricingUrl,
  getPricingRequestUrl,
  formatModelPrice,
  getPricingCacheTtlMs,
  isPricingCacheEligibleForWarmup,
  MODEL_PRICING_CACHE_TTL_MS,
  TUZI_PRICING_CACHE_TTL_MS,
  modelPricingService,
} from '../model-pricing-service';
import { providerPricingCacheSettings } from '../settings-manager';
import type {
  NewApiPricingApiResponse,
  PricingApiResponse,
  ProviderPricingCache,
  TuziPricingApiResponse,
} from '../model-pricing-types';

describe('model-pricing-service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function fetchCache(
    response: PricingApiResponse,
    groupName: string,
    cnyPerUsd: number
  ): Promise<ProviderPricingCache> {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response,
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(providerPricingCacheSettings, 'update').mockResolvedValue();

    return modelPricingService.fetchAndCache(
      `test-${groupName}-${Date.now()}`,
      `https://example.com/api/pricing?case=${groupName}-${Date.now()}`,
      'test-key',
      groupName,
      cnyPerUsd,
      { force: true }
    );
  }

  it('times out a stalled shared request and allows a fresh retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(providerPricingCacheSettings, 'update').mockResolvedValue();
    const args = [
      'timeout-fetch', 'https://example.com/timeout-fetch/api/pricing',
      'test-key', 'default', 1,
    ] as const;
    const first = modelPricingService.fetchAndCache(...args, { force: true });
    const second = modelPricingService.fetchAndCache(...args, { force: true });
    const rejected = Promise.all([
      expect(first).rejects.toThrow('模型广场请求超时'),
      expect(second).rejects.toThrow('模型广场请求超时'),
    ]);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(modelPricingService.fetchAndCache(...args, { force: true })).resolves.toMatchObject({ prices: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds JSON reads and prevents late timed-out responses from replacing fresh cache', async () => {
    vi.useFakeTimers();
    let finishBody!: (value: PricingApiResponse) => void;
    const fresh: PricingApiResponse = {
      success: true,
      data: [{ model_name: 'fresh-model', quota_type: 1 }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => new Promise((resolve) => { finishBody = resolve; }) })
      .mockResolvedValue({ ok: true, json: async () => fresh });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(providerPricingCacheSettings, 'update').mockResolvedValue();
    const url = 'https://example.com/timeout-body/api/pricing';
    const loading = modelPricingService.fetchAndCache('timeout-body', url, 'test-key', 'default', 1, { force: true });
    const rejected = expect(loading).rejects.toThrow('模型广场请求超时');
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    const retry = await modelPricingService.fetchAndCache('timeout-body', url, 'test-key', 'default', 1, { force: true });
    expect(retry.prices['fresh-model']).toBeDefined();

    finishBody({ success: true, data: [] });
    await Promise.resolve();
    const shared = await modelPricingService.fetchAndCache('timeout-body-other', url, 'test-key', 'default', 1);
    expect(shared.prices['fresh-model']).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves HTTP errors and clears the timeout after failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(modelPricingService.fetchAndCache(
      'pricing-http-error', 'https://example.com/http-error/api/pricing',
      'test-key', 'default', 1, { force: true }
    )).rejects.toThrow('Pricing API error: 503');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves native Suno transport metadata even without a path', async () => {
    const cache = await fetchCache({ success: true, data: [{ model_name: 'suno/music', quota_type: 1,
      model_price: 0.08, enable_groups: ['default'], endpoints: { 'suno-v2': { transport: 'task', async: true } } }],
    }, 'default', 1);
    expect(cache.modelEndpoints?.['suno/music']?.['suno-v2']).toEqual({ transport: 'task', async: true });
  });

  it('对 Tuzi 价格接口使用每日缓存', () => {
    expect(getPricingCacheTtlMs('https://api.tu-zi.com/api/pricing')).toBe(
      TUZI_PRICING_CACHE_TTL_MS
    );
    expect(
      getPricingCacheTtlMs('https://api.tu-zi.com/api/pricing?group=default')
    ).toBe(TUZI_PRICING_CACHE_TTL_MS);
    expect(getPricingCacheTtlMs('https://business.tu-zi.com/api/pricing')).toBe(
      TUZI_PRICING_CACHE_TTL_MS
    );
  });

  it('对非 Tuzi 价格接口保持默认短缓存', () => {
    expect(getPricingCacheTtlMs('https://example.com/api/pricing')).toBe(
      MODEL_PRICING_CACHE_TTL_MS
    );
  });

  it('从带 /v1 的模型 Base URL 推导独立的价格地址', () => {
    expect(derivePricingUrl('https://api.tu-zi.com/v1')).toBe(
      'https://api.tu-zi.com/api/pricing'
    );
  });

  it('uses the existing same-origin proxy for main Tuzi marketplace requests', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:7201' } });
    expect(getPricingRequestUrl('https://api.tu-zi.com/api/pricing?group=default'))
      .toBe('http://localhost:7201/__opentu_tuzi_session__/api/pricing?group=default');
    expect(getPricingRequestUrl('https://api.tu-zi.com/api/pricing'))
      .toBe('http://localhost:7201/__opentu_tuzi_session__/api/pricing');
    expect(getPricingRequestUrl('https://business.tu-zi.com/api/pricing'))
      .toBe('https://business.tu-zi.com/api/pricing');
  });

  it('reads the public Tuzi catalog through the proxy without generation keys or cookies', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:7201' } });
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => ({
      ok: true,
      json: async () => init.headers.Authorization
        ? { success: false, message: 'Unauthorized, invalid access token' }
        : { success: true, data: [{ model_name: 'gpt-6-sol', quota_type: 0 }] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(providerPricingCacheSettings, 'update').mockResolvedValue();
    const url = 'https://api.tu-zi.com/api/pricing?case=public-auth';
    const caches = await Promise.all([
      modelPricingService.fetchAndCache('public-main-a', url, 'generation-key-a', 'default', 0.7, { force: true }),
      modelPricingService.fetchAndCache('public-main-b', url, 'generation-key-b', 'default', 0.7, { force: true }),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]).toEqual([
      'http://localhost:7201/__opentu_tuzi_session__/api/pricing?case=public-auth',
      expect.objectContaining({ headers: { Accept: 'application/json' }, credentials: 'omit' }),
    ]);
    expect(caches.every((cache) => cache.prices['gpt-6-sol'])).toBe(true);
  });

  it.each([
    'https://business.tu-zi.com/api/pricing',
    'https://gateway.example.com/api/pricing',
    'https://api.tu-zi.com.evil.example/api/pricing',
    'https://api.tu-zi.com/api/private-pricing',
  ])('preserves provider authentication for %s', async (url) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(providerPricingCacheSettings, 'update').mockResolvedValue();
    await modelPricingService.fetchAndCache(url, url, 'test-provider-key', 'default', 1, { force: true });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-provider-key');
    expect(fetchMock.mock.calls[0][1].credentials).not.toBe('omit');
  });

  it.each([
    { success: false, message: 'Unauthorized, invalid access token' },
    { success: false, error: { message: 'Unauthorized, invalid access token' }, data: [] },
  ])('reports API rejection before schema validation and never caches it', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }));
    const persist = vi.spyOn(providerPricingCacheSettings, 'update').mockResolvedValue();
    const profile = `rejected-${Date.now()}-${'error' in response}`;
    await expect(modelPricingService.fetchAndCache(
      profile, `https://example.com/api/pricing?case=${profile}`, 'test-key', 'default', 1, { force: true }
    )).rejects.toThrow('Unauthorized, invalid access token');
    expect(persist).not.toHaveBeenCalled();
    expect(modelPricingService.getCache(profile)).toBeNull();
  });

  it('redacts a key echoed by a rejected pricing response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: false, message: 'Invalid token test-echo-key' }),
    }));
    await expect(modelPricingService.fetchAndCache(
      'redacted-error', 'https://example.com/api/pricing?case=redacted',
      'test-echo-key', 'default', 1, { force: true }
    )).rejects.toThrow('Invalid token [已隐藏]');
  });

  it.each([null, { success: false }, { unexpected: 'payload' }])(
    'rejects invalid or unsuccessful payloads without exposing a runtime type error', async (response) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response }));
      await expect(modelPricingService.fetchAndCache(
        'invalid-response', `https://example.com/api/pricing?case=${JSON.stringify(response)}`,
        'test-key', 'default', 1, { force: true }
      )).rejects.toThrow(/Invalid pricing API response|价格接口请求失败/);
    }
  );

  it('preserves group-filtered marketplace metadata for discovery', async () => {
    const cache = await fetchCache({
      success: true,
      group_ratio: { default: 1, vip: 1 },
      vendors: [{ id: 3, name: 'Gemini' }],
      data: [
        {
          model_name: 'configured-renderer', tags: '生图', vendor_id: 3,
          quota_type: 1, enable_groups: ['default'],
          supported_endpoint_types: ['google.generateContent'],
        },
        {
          model_name: 'vip-only', tags: '生图', quota_type: 1,
          enable_groups: ['vip'],
        },
      ],
    }, 'default', 0.7);

    expect(Object.keys(cache.prices)).toEqual(['configured-renderer']);
    expect(cache.modelCatalog).toEqual({
      'configured-renderer': {
        category: undefined, tags: '生图', owned_by: 'Gemini',
        supported_endpoint_types: ['google.generateContent'],
      },
    });
  });

  it('keeps actual categories separate from marketplace capability tags in both formats', async () => {
    const newApi = await fetchCache({
      success: true,
      data: [
        { model_name: 'gpt-6-astra', quota_type: 1, tags: '文本,图像,推理' },
        { model_name: 'categorized-image', quota_type: 1, category: 'image', tags: '文本' },
      ],
    }, 'default', 1);
    expect(newApi.modelCatalog?.['gpt-6-astra']).toMatchObject({ tags: '文本,图像,推理' });
    expect(newApi.modelCatalog?.['gpt-6-astra']?.category).toBeUndefined();
    expect(newApi.modelCatalog?.['categorized-image']).toMatchObject({ category: 'image', tags: '文本' });

    const legacy = await fetchCache({
      success: true,
      data: {
        group_info: { default: { GroupRatio: 1, DisplayName: 'Default' } },
        model_info: [{
          model_name: 'legacy-vision', tags: '图像', enable_groups: ['default'],
          price_info: { default: { default: {
            quota_type: 1, model_ratio: 1, model_completion_ratio: 1,
            model_price: 1, model_cache_ratio: 1, model_create_cache_ratio: 1,
          } } },
        }],
      },
    }, 'default', 1);
    expect(legacy.modelCatalog?.['legacy-vision']?.tags).toBe('图像');
    expect(legacy.modelCatalog?.['legacy-vision']?.category).toBeUndefined();
  });

  it('仅允许手动成功或旧版已缓存签名参与自动更新', () => {
    const sourceSignature = buildPricingSourceSignature(
      'https://api.tu-zi.com/api/pricing',
      'default',
      0.7
    );

    const manualReadyCache: ProviderPricingCache = {
      profileId: 'p1',
      fetchedAt: Date.now(),
      sourceSignature,
      autoRefreshSourceSignature: sourceSignature,
      groups: [],
      prices: {},
    };
    expect(
      isPricingCacheEligibleForWarmup(manualReadyCache, sourceSignature)
    ).toBe(true);

    const explicitlyDisabledCache: ProviderPricingCache = {
      ...manualReadyCache,
      autoRefreshSourceSignature: null,
    };
    expect(
      isPricingCacheEligibleForWarmup(explicitlyDisabledCache, sourceSignature)
    ).toBe(false);

    const legacyCache: ProviderPricingCache = {
      ...manualReadyCache,
      autoRefreshSourceSignature: undefined,
    };
    expect(isPricingCacheEligibleForWarmup(legacyCache, sourceSignature)).toBe(
      true
    );

    expect(isPricingCacheEligibleForWarmup(null, sourceSignature)).toBe(false);
  });

  it('保持兼容 tuzi-api 嵌套价格结构', async () => {
    const response: TuziPricingApiResponse = {
      success: true,
      data: {
        group_info: {
          default: { GroupRatio: 1, DisplayName: '默认分组' },
          codex: { GroupRatio: 1.5, DisplayName: 'Codex 分组' },
        },
        model_info: [
          {
            model_name: 'gpt-test',
            description: '测试模型',
            tags: '',
            enable_groups: ['default', 'codex'],
            price_info: {
              codex: {
                default: {
                  quota_type: 1,
                  model_ratio: 2,
                  model_completion_ratio: 3,
                  model_price: 0,
                  model_cache_ratio: 0,
                  model_create_cache_ratio: 0,
                },
              },
            },
            endpoints: {
              chat: {
                path: '/v1/chat/completions',
                method: 'POST',
                docs: 'https://example.com/docs',
              },
            },
          },
        ],
      },
    };

    const cache = await fetchCache(response, 'codex', 0.7);

    expect(cache.groups).toEqual([
      { name: 'default', displayName: '默认分组', ratio: 1 },
      { name: 'codex', displayName: 'Codex 分组', ratio: 1.5 },
    ]);
    expect(cache.prices['gpt-test']).toMatchObject({
      billingType: 'token',
      inputCnyMtok: 4.2,
      outputCnyMtok: 12.6,
      description: '测试模型',
      docsUrl: 'https://example.com/docs',
    });
    expect(cache.modelEndpoints?.['gpt-test']?.chat.path).toBe(
      '/v1/chat/completions'
    );
  });

  it('自动识别并适配 new-api 扁平价格结构', async () => {
    const response: NewApiPricingApiResponse = {
      success: true,
      data: [
        {
          model_name: 'gpt-ratio',
          description: '倍率计费模型',
          quota_type: 0,
          model_ratio: 1.25,
          completion_ratio: 2,
          model_price: 0,
          enable_groups: ['default', 'vip'],
          supported_endpoint_types: ['openai'],
        },
        {
          model_name: 'task-price',
          description: '固定价格模型',
          quota_type: 1,
          model_ratio: 0,
          completion_ratio: 0,
          model_price: 0.08,
          enable_groups: ['vip'],
          supported_endpoint_types: ['image-generation', 'openai-video'],
          endpoints: {
            'openai-video': {
              label: 'Async Image Generation',
              path: '/v1/videos',
              method: 'post',
              description: '异步图片任务接口',
              scenario: 'async-image',
            },
          },
        },
        {
          model_name: 'hidden-model',
          quota_type: 0,
          model_ratio: 9,
          completion_ratio: 9,
          model_price: 0,
          enable_groups: ['default'],
          supported_endpoint_types: ['openai'],
        },
      ],
      group_ratio: {
        default: 1,
        vip: 0.8,
      },
      usable_group: {
        default: '默认分组',
        vip: 'VIP 分组',
      },
      supported_endpoint: {
        openai: { path: '/v1/chat/completions', method: 'post' },
        'image-generation': '/v1/images/generations',
      },
    };

    const cache = await fetchCache(response, 'vip', 7);

    expect(cache.groups).toEqual([
      { name: 'default', displayName: '默认分组', ratio: 1 },
      { name: 'vip', displayName: 'VIP 分组', ratio: 0.8 },
    ]);
    expect(cache.prices['gpt-ratio']).toMatchObject({
      billingType: 'token',
      inputCnyMtok: 14,
      outputCnyMtok: 28,
      description: '倍率计费模型',
    });
    expect(formatModelPrice(cache.prices['gpt-ratio'])).toBe(
      '输入 ¥14.00 · 补全 ¥28.00 / 1M Tokens'
    );
    expect(cache.prices['task-price']).toMatchObject({
      billingType: 'flat',
      flatCny: 0.448,
      description: '固定价格模型',
    });
    expect(cache.prices['hidden-model']).toBeUndefined();
    expect(cache.modelEndpoints?.['gpt-ratio']?.openai).toEqual({
      path: '/v1/chat/completions',
      method: 'POST',
    });
    expect(cache.modelEndpoints?.['task-price']?.['image-generation']).toEqual({
      path: '/v1/images/generations',
      method: 'POST',
    });
    expect(cache.modelEndpoints?.['task-price']?.['openai-video']).toEqual({
      label: 'Async Image Generation',
      path: '/v1/videos',
      method: 'POST',
      description: '异步图片任务接口',
      scenario: 'async-image',
    });
  });

  it('new-api 当前分组不存在时使用接口返回的可用分组', async () => {
    const response: NewApiPricingApiResponse = {
      success: true,
      data: [
        {
          model_name: 'business-model',
          quota_type: 0,
          model_ratio: 2,
          completion_ratio: 1.5,
          model_price: 0,
          enable_groups: ['business'],
        },
        {
          model_name: 'codex-model',
          quota_type: 0,
          model_ratio: 3,
          completion_ratio: 2,
          model_price: 0,
          enable_groups: ['codex'],
        },
      ],
      group_ratio: {
        business: 0.5,
        codex: 0.25,
      },
      usable_group: {
        business: '商务分组',
        codex: 'Codex 分组',
      },
    };

    const cache = await fetchCache(response, 'default', 7);

    expect(cache.groups).toEqual([
      { name: 'business', displayName: '商务分组', ratio: 0.5 },
      { name: 'codex', displayName: 'Codex 分组', ratio: 0.25 },
    ]);
    expect(cache.prices['business-model']).toMatchObject({
      billingType: 'token',
      inputCnyMtok: 14,
      outputCnyMtok: 21,
    });
    expect(cache.prices['codex-model']).toMatchObject({
      billingType: 'token',
      inputCnyMtok: 10.5,
      outputCnyMtok: 21,
    });
  });

  it('new-api tiered_expr 动态计费优先展示分层秒价', async () => {
    const response: NewApiPricingApiResponse = {
      success: true,
      data: [
        {
          model_name: 'happyhorse-1.0-video-edit',
          quota_type: 1,
          model_price: 99,
          model_ratio: 0,
          completion_ratio: 0,
          billing_mode: 'tiered_expr',
          billing_expr:
            'v2:param("parameters.resolution") == "720P" ? tier("720P", sec * 1.142857142857) : tier("1080P", sec * 2.285714285714)',
          enable_groups: ['default'],
        },
      ],
      group_ratio: {
        default: 1,
      },
      usable_group: {
        default: 'default分组',
      },
    };

    const cache = await fetchCache(response, 'default', 0.7);

    expect(cache.prices['happyhorse-1.0-video-edit']).toMatchObject({
      billingType: 'tiered',
      flatCny: null,
      tieredCny: [
        { label: '720P', perSecondCny: 0.8 },
        { label: '1080P', perSecondCny: 1.6 },
      ],
    });
    expect(formatModelPrice(cache.prices['happyhorse-1.0-video-edit'])).toBe(
      '720P ¥0.80/秒 · 1080P ¥1.60/秒'
    );
  });

  it('new-api token 模型展示缓存与音频价格明细', async () => {
    const response: NewApiPricingApiResponse = {
      success: true,
      data: [
        {
          model_name: 'gpt-5.4',
          quota_type: 1,
          model_ratio: 1.25,
          completion_ratio: 6,
          cache_ratio: 1,
          create_cache_ratio: 1.25,
          audio_ratio: 1,
          audio_completion_ratio: 0,
          model_price: 0,
          enable_groups: ['coding'],
          supported_endpoint_types: ['OpenAI-Chat'],
          endpoints: {
            'OpenAI-Chat': {
              path: '/v1/chat/completions',
              method: 'POST',
              docs: 'https://tuzi-api.apifox.cn/343647063e0',
            },
          },
        },
      ],
      group_ratio: {
        coding: 1,
      },
      usable_group: {
        coding: 'Coding分组',
      },
    };

    const cache = await fetchCache(response, 'coding', 0.7);

    expect(cache.prices['gpt-5.4']).toMatchObject({
      billingType: 'token',
      inputCnyMtok: 1.75,
      outputCnyMtok: 10.5,
      cacheReadCnyMtok: 1.75,
      cacheCreateCnyMtok: 2.1875,
      audioInputCnyMtok: 1.75,
      audioOutputCnyMtok: 0,
      docsUrl: 'https://tuzi-api.apifox.cn/343647063e0',
    });
    expect(formatModelPrice(cache.prices['gpt-5.4'])).toBe(
      '输入 ¥1.75 · 补全 ¥10.50 · 缓存读取 ¥1.75 · 缓存创建 ¥2.19 · 音频输入 ¥1.75 · 音频补全 ¥0.00 / 1M Tokens'
    );
  });

  it('business pricing 按当前分组覆盖模型倍率', async () => {
    const response: NewApiPricingApiResponse = {
      success: true,
      data: [
        {
          model_name: 'claude-sonnet-4-5',
          quota_type: 1,
          model_ratio: 1,
          completion_ratio: 2,
          cache_ratio: 0.2,
          create_cache_ratio: 1,
          model_price: 0,
          enable_groups: ['Claude'],
        },
      ],
      group_ratio: {
        Claude: 1,
      },
      usable_group: {
        Claude: 'Claude 分组',
      },
      group_model_pricing: {
        Claude: {
          model_ratio: {
            'claude-sonnet-4-5': 1.5,
          },
          model_completion_ratio: {
            'claude-sonnet-4-5': 5,
          },
          model_cache_ratio: {
            'claude-sonnet-4-5': 0.1,
          },
          model_create_cache_ratio: {
            'claude-sonnet-4-5': 1.25,
          },
        },
      },
    };

    const cache = await fetchCache(response, 'Claude', 0.7);

    expect(cache.groups).toEqual([
      { name: 'Claude', displayName: 'Claude 分组', ratio: 1 },
    ]);
    expect(cache.prices['claude-sonnet-4-5']).toMatchObject({
      billingType: 'token',
      inputCnyMtok: 2.1,
      outputCnyMtok: 10.5,
      cacheReadCnyMtok: 0.21,
      cacheCreateCnyMtok: 2.625,
    });
  });
});
