import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../utils/settings-manager';
import { discoverProviderModels } from './provider-model-catalog';

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  fetchAndCache: vi.fn(),
}));

vi.mock('../utils/runtime-model-discovery', () => ({
  runtimeModelDiscovery: {
    discover: mocks.discover,
  },
}));

vi.mock('../utils/model-pricing-service', () => ({
  resolveProviderPricingConfig: (profile: ProviderProfile) => ({
    pricingUrl: 'https://api.tu-zi.com/api/pricing',
    pricingGroup: profile.pricingGroup || 'default',
    cnyPerUsd: 0.7,
  }),
  modelPricingService: {
    fetchAndCache: mocks.fetchAndCache,
  },
}));

vi.mock('../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
}));

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'tuzi-token-default',
    name: 'Tuzi default',
    apiKey: 'test-key',
    baseUrl: 'https://api.tu-zi.com/v1',
    enabled: true,
    capabilities: { supportsModelsEndpoint: true },
    ...overrides,
  } as ProviderProfile;
}

describe('provider model catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discover.mockResolvedValue([]);
    mocks.fetchAndCache.mockResolvedValue({
      profileId: 'tuzi-token-default',
      fetchedAt: Date.now(),
      groups: [],
      prices: {
        'gpt-image-2.5': {
          description: 'Configured marketplace model',
        },
      },
      modelEndpoints: {
        'gpt-image-2.5': {
          generate: { path: '/v1/images/generations' },
        },
      },
    });
  });

  it('uses the Tuzi marketplace as the authoritative model catalog', async () => {
    await discoverProviderModels(profile(), [], {
      forceMarketplaceRefresh: true,
    });

    expect(mocks.fetchAndCache).toHaveBeenCalledWith(
      'tuzi-token-default',
      'https://api.tu-zi.com/api/pricing',
      'test-key',
      'default',
      0.7,
      { force: true }
    );
    expect(mocks.discover).toHaveBeenCalledWith(
      'tuzi-token-default',
      'https://api.tu-zi.com/v1',
      'test-key',
      [],
      {
        selectAll: undefined,
        signal: undefined,
        authoritativeModels: [
          {
            id: 'gpt-image-2.5',
            description: 'Configured marketplace model',
            supported_endpoint_types: ['generate'],
          },
        ],
      }
    );
  });

  it('keeps the models endpoint behavior for non-Tuzi providers', async () => {
    await discoverProviderModels(
      profile({
        id: 'custom-provider',
        baseUrl: 'https://models.example.com/v1',
      })
    );

    expect(mocks.fetchAndCache).not.toHaveBeenCalled();
    expect(mocks.discover).toHaveBeenCalledWith(
      'custom-provider',
      'https://models.example.com/v1',
      'test-key',
      [],
      {
        selectAll: undefined,
        signal: undefined,
        authoritativeModels: undefined,
      }
    );
  });

  it('preserves marketplace category and vendor metadata', async () => {
    mocks.fetchAndCache.mockResolvedValue({
      prices: { 'custom-renderer': { description: 'Configured image' } },
      modelCatalog: {
        'custom-renderer': {
          category: '生图',
          tags: '生图,图片编辑',
          owned_by: 'Gemini',
          supported_endpoint_types: ['google.generateContent'],
        },
      },
    });

    await discoverProviderModels(profile({ pricingGroup: 'image' }));

    expect(mocks.fetchAndCache.mock.calls[0][3]).toBe('image');
    expect(mocks.discover.mock.calls[0][4].authoritativeModels).toEqual([
      {
        id: 'custom-renderer',
        description: 'Configured image',
        category: '生图',
        tags: '生图,图片编辑',
        owned_by: 'Gemini',
        supported_endpoint_types: ['google.generateContent'],
      },
    ]);
  });

  it('does not fall back to the models endpoint when the marketplace fails', async () => {
    mocks.fetchAndCache.mockRejectedValueOnce(new Error('Pricing API error: 503'));
    await expect(discoverProviderModels(profile())).rejects.toThrow('503');
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it('rejects an empty group catalog without importing unconfigured models', async () => {
    mocks.fetchAndCache.mockResolvedValueOnce({ prices: {} });
    await expect(discoverProviderModels(profile())).rejects.toThrow('暂无该分组可用模型');
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});
