import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderCatalog,
  ProviderProfile,
} from '../utils/settings-manager';

const mocks = vi.hoisted(() => ({
  fetchAndCache: vi.fn(),
  resolvePricingConfig: vi.fn(),
  catalogs: [] as ProviderCatalog[],
}));

vi.mock('../utils/model-pricing-service', () => ({
  resolveProviderPricingConfig: mocks.resolvePricingConfig,
  modelPricingService: { fetchAndCache: mocks.fetchAndCache },
}));
vi.mock('../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
  providerCatalogsSettings: {
    get: () => mocks.catalogs,
    update: vi.fn(async (catalogs: ProviderCatalog[]) => {
      mocks.catalogs = catalogs;
    }),
    addListener: vi.fn(),
  },
  providerProfilesSettings: { get: () => [], addListener: vi.fn() },
  invocationPresetsSettings: { addListener: vi.fn() },
  settingsManager: { getSetting: () => [], addListener: vi.fn() },
}));
vi.mock('./tuzi-embedded-config', () => ({ isTuziEmbeddedMode: () => false }));

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'tuzi-token-default',
    name: 'Tuzi default',
    apiKey: 'key-a',
    baseUrl: 'https://api.tu-zi.com/v1',
    enabled: true,
    capabilities: { supportsModelsEndpoint: true },
    ...overrides,
  } as ProviderProfile;
}
const response = (...ids: string[]) =>
  Response.json({ data: ids.map((id) => ({ id })) });

async function setup() {
  const { discoverProviderModels } = await import('./provider-model-catalog');
  const { runtimeModelDiscovery } = await import(
    '../utils/runtime-model-discovery'
  );
  return { discoverProviderModels, runtimeModelDiscovery };
}

describe('provider model catalog authenticated discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.catalogs = [];
    mocks.resolvePricingConfig.mockImplementation((value: ProviderProfile) => ({
      pricingUrl: 'https://api.tu-zi.com/api/pricing',
      pricingGroup: value.pricingGroup || 'default', cnyPerUsd: 0.7,
    }));
    mocks.fetchAndCache.mockResolvedValue({
      prices: {
        'model-a': { description: 'Marketplace image' },
        'model-b': {},
        'public-only': {},
        'suno/cover': {},
      },
      modelCatalog: { 'model-a': { category: '生图', owned_by: 'Gemini' } },
      modelEndpoints: {
        'suno/cover': { native: { path: '/suno/v2/cover', method: 'POST' } },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses each Key response despite the same public pricing and preserves unpriced models', async () => {
    const fetcher = vi.fn(async (_url, init) =>
      init.headers.Authorization === 'Bearer key-a'
        ? response('model-a', 'unpriced-a')
        : response('model-b')
    );
    vi.stubGlobal('fetch', fetcher);
    const { discoverProviderModels, runtimeModelDiscovery } = await setup();
    const first = await discoverProviderModels(profile(), [], {
      selectAll: true,
      forceMarketplaceRefresh: true,
    });
    const second = await discoverProviderModels(
      profile({ apiKey: 'key-b' }),
      [],
      { selectAll: true }
    );
    expect(first.map((model) => model.id)).toEqual(['model-a', 'unpriced-a']);
    expect(first[0]).toMatchObject({
      type: 'image',
      vendor: 'GOOGLE',
      description: 'Marketplace image',
    });
    expect(second.map((model) => model.id)).toEqual(['model-b']);
    expect(runtimeModelDiscovery.getState(profile().id)).toMatchObject({
      status: 'ready',
      discoverySource: 'models-endpoint',
      selectedModelIds: ['model-b'],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toContain(
      '/__opentu_tuzi_session__/v1/models'
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: 'Bearer key-b' },
      cache: 'no-store',
    });
    expect(mocks.fetchAndCache).toHaveBeenCalledWith(
      profile().id,
      'https://api.tu-zi.com/api/pricing',
      'key-a',
      'default',
      0.7,
      { force: true }
    );
    expect(
      runtimeModelDiscovery.getPinnedSelectableModel('text', 'public-only', {
        profileId: profile().id,
        modelId: 'public-only',
      })
    ).toBeNull();
  });

  it.each(['failure', 'empty'] as const)(
    'keeps authenticated models when pricing is %s',
    async (mode) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response('unpriced'))
      );
      if (mode === 'failure')
        mocks.fetchAndCache.mockRejectedValue(new Error('Pricing 503'));
      else mocks.fetchAndCache.mockResolvedValue({ prices: {} });
      const { discoverProviderModels } = await setup();
      expect(
        (await discoverProviderModels(profile())).map((model) => model.id)
      ).toEqual(['unpriced']);
    }
  );

  it('rejects an invalid Key before loading prices and never retains old automatic results', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response('model-a'))
      .mockResolvedValueOnce(
        Response.json({ error: { message: 'Invalid key-b' } }, { status: 401 })
      );
    vi.stubGlobal('fetch', fetcher);
    const { discoverProviderModels, runtimeModelDiscovery } = await setup();
    await discoverProviderModels(profile(), [], { selectAll: true });
    mocks.fetchAndCache.mockClear();
    await expect(
      discoverProviderModels(profile({ apiKey: 'key-b' }))
    ).rejects.toThrow('Invalid [REDACTED]');
    expect(mocks.fetchAndCache).not.toHaveBeenCalled();
    expect(runtimeModelDiscovery.getDiscoveredModels(profile().id)).toEqual([]);
  });

  it('keeps results scoped to each provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) =>
        init.headers.Authorization === 'Bearer key-a'
          ? response('model-a')
          : response('model-b')
      )
    );
    const { discoverProviderModels, runtimeModelDiscovery } = await setup();
    await Promise.all([
      discoverProviderModels(profile(), [], { selectAll: true }),
      discoverProviderModels(
        profile({ id: 'tuzi-token-other', apiKey: 'key-b' }),
        [],
        { selectAll: true }
      ),
    ]);
    expect(runtimeModelDiscovery.getSelectedModelIds(profile().id)).toEqual([
      'model-a',
    ]);
    expect(
      runtimeModelDiscovery.getSelectedModelIds('tuzi-token-other')
    ).toEqual(['model-b']);
  });

  it('keeps custom provider discovery independent of Tuzi pricing', async () => {
    const fetcher = vi.fn(async () => response('custom-model'));
    vi.stubGlobal('fetch', fetcher);
    const { discoverProviderModels } = await setup();
    await discoverProviderModels(
      profile({ id: 'custom', baseUrl: 'https://models.example.com/v1' })
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://models.example.com/v1/models'
    );
    expect(mocks.fetchAndCache).not.toHaveBeenCalled();
  });

  it.each(['late success', 'late failure'] as const)(
    'ignores an old Key request with %s',
    async (mode) => {
      let settleOld!: (value: Response) => void;
      const fetcher = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              settleOld = resolve;
            })
        )
        .mockResolvedValueOnce(response('model-b'));
      vi.stubGlobal('fetch', fetcher);
      const { discoverProviderModels, runtimeModelDiscovery } = await setup();
      const oldRequest = discoverProviderModels(profile(), [], {
        selectAll: true,
      });
      const oldRejected = expect(oldRequest).rejects.toMatchObject({
        name: 'AbortError',
      });
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      await discoverProviderModels(profile({ apiKey: 'key-b' }), [], {
        selectAll: true,
      });
      settleOld(
        mode === 'late success'
          ? response('model-a')
          : new Response('Invalid old Key', { status: 401 })
      );
      await oldRejected;
      expect(runtimeModelDiscovery.getState(profile().id)).toMatchObject({
        status: 'ready',
        selectedModelIds: ['model-b'],
        error: null,
      });
    }
  );

  it('deduplicates concurrent requests for the same Key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('model-a'))
    );
    const { discoverProviderModels } = await setup();
    await Promise.all([
      discoverProviderModels(profile()),
      discoverProviderModels(profile()),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetchAndCache).toHaveBeenCalledTimes(1);
  });

  it('invalidates old public catalogs while preserving manual models, selections and bindings', async () => {
    mocks.catalogs = [
      {
        profileId: profile().id,
        discoverySource: 'marketplace',
        discoveredAt: Date.now(),
        discoveredModels: [
          { id: 'public-only', label: 'public', type: 'text', vendor: 'OTHER' },
          {
            id: 'manual-model',
            label: 'manual',
            type: 'image',
            vendor: 'OTHER',
            tags: ['manual'],
          },
        ],
        selectedModelIds: ['public-only', 'manual-model'],
        manualBindings: [],
      },
    ] as ProviderCatalog[];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('model-a'))
    );
    const { discoverProviderModels, runtimeModelDiscovery } = await setup();
    expect(
      runtimeModelDiscovery
        .getDiscoveredModels(profile().id)
        .map((model) => model.id)
    ).toEqual(['manual-model']);
    expect(runtimeModelDiscovery.getSelectedModelIds(profile().id)).toEqual([
      'manual-model',
    ]);
    await discoverProviderModels(profile());
    const before = runtimeModelDiscovery.getState(profile().id);
    runtimeModelDiscovery.addManualModel(profile().id, {
      id: 'manual-route',
      type: 'image',
      invocation: {
        protocol: 'openai',
        requestSchema: 'openai.images.generations',
        submitPath: '/v1/images/generations',
        responseSchema: 'openai.images',
      },
    });
    expect(before.discoveredModels.map((model) => model.id)).toEqual([
      'model-a',
      'manual-model',
    ]);
    const bindings = runtimeModelDiscovery.getState(
      profile().id
    ).manualBindings;
    expect(bindings.length).toBeGreaterThan(0);
    runtimeModelDiscovery.invalidateIfConfigChanged(
      profile().id,
      profile().baseUrl,
      'key-b'
    );
    expect(
      runtimeModelDiscovery
        .getDiscoveredModels(profile().id)
        .map((model) => model.id)
    ).toEqual(['manual-model', 'manual-route']);
    expect(runtimeModelDiscovery.getSelectedModelIds(profile().id)).toEqual([
      'manual-model',
      'manual-route',
    ]);
    expect(runtimeModelDiscovery.getState(profile().id).manualBindings).toEqual(
      bindings
    );
    await discoverProviderModels(profile({ apiKey: 'key-b' }));
    expect(runtimeModelDiscovery.getSelectedModelIds(profile().id)).toEqual([
      'manual-model',
      'manual-route',
    ]);
  });

  it('does not let stale refresh errors or returned IDs change the newer Key selection', async () => {
    let settleOld!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            settleOld = resolve;
          })
      )
      .mockResolvedValueOnce(response('model-b'));
    vi.stubGlobal('fetch', fetcher);
    const { runtimeModelDiscovery } = await setup();
    const { refreshChangedProviderModels } = await import(
      '../components/settings-dialog/provider-model-refresh'
    );
    const oldRequest = refreshChangedProviderModels([profile()]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await refreshChangedProviderModels([profile({ apiKey: 'key-b' })]);
    settleOld(new Response('Invalid old Key', { status: 401 }));
    expect(await oldRequest).toEqual([]);
    expect(runtimeModelDiscovery.getState(profile().id)).toMatchObject({
      status: 'ready',
      selectedModelIds: ['model-b'],
      error: null,
    });
  });

  it('protects signal-bound requests from late old success', async () => {
    let settleOld!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            settleOld = resolve;
          })
      )
      .mockResolvedValueOnce(response('model-b'));
    vi.stubGlobal('fetch', fetcher);
    const { discoverProviderModels, runtimeModelDiscovery } = await setup();
    const oldRequest = discoverProviderModels(profile(), [], {
      signal: new AbortController().signal,
    });
    const oldRejected = expect(oldRequest).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await discoverProviderModels(profile({ apiKey: 'key-b' }), [], {
      selectAll: true,
    });
    settleOld(response('model-a'));
    await oldRejected;
    expect(runtimeModelDiscovery.getSelectedModelIds(profile().id)).toEqual([
      'model-b',
    ]);
  });

  it.each(['not JSON', 'null', '{"data":[]}', '{"data":{}}'])(
    'rejects malformed or empty model responses: %s',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body))
      );
      const { discoverProviderModels } = await setup();
      await expect(discoverProviderModels(profile())).rejects.toThrow(
        /模型列表/
      );
    }
  );

  it('does not replace the new list when old pricing metadata returns late', async () => {
    let settleMetadata!: (value: { prices: Record<string, object> }) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) =>
        init.headers.Authorization === 'Bearer key-a'
          ? response('model-a')
          : response('model-b')
      )
    );
    mocks.fetchAndCache.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleMetadata = resolve;
        })
    );
    const { discoverProviderModels, runtimeModelDiscovery } = await setup();
    const oldRequest = discoverProviderModels(profile(), [], {
      selectAll: true,
    });
    const oldRejected = expect(oldRequest).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.waitFor(() =>
      expect(mocks.fetchAndCache).toHaveBeenCalledTimes(1)
    );
    await discoverProviderModels(profile({ apiKey: 'key-b' }), [], {
      selectAll: true,
    });
    settleMetadata({ prices: { 'model-a': {} } });
    await oldRejected;
    expect(runtimeModelDiscovery.getSelectedModelIds(profile().id)).toEqual([
      'model-b',
    ]);
  });

  it('ends the loading state when the active request is cancelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('model-a'))
    );
    const { discoverProviderModels, runtimeModelDiscovery } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      discoverProviderModels(profile(), [], { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(runtimeModelDiscovery.getState(profile().id).status).toBe('idle');
    expect(mocks.fetchAndCache).not.toHaveBeenCalled();
  });
  it('continues authenticated discovery without pricing configuration', async () => {
    mocks.resolvePricingConfig.mockReturnValueOnce(null);
    vi.stubGlobal('fetch', vi.fn(async () => response('key-only-model')));
    const { discoverProviderModels } = await setup();
    expect((await discoverProviderModels(profile())).map((model) => model.id)).toEqual(['key-only-model']);
    expect(mocks.fetchAndCache).not.toHaveBeenCalled();
  });

  it('prefers authenticated metadata over conflicting marketplace metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{
      id: 'model-a', category: 'text', description: 'Key response',
    }] })));
    const { discoverProviderModels } = await setup();
    expect((await discoverProviderModels(profile()))[0]).toMatchObject({
      type: 'text', description: 'Key response',
    });
  });

});
