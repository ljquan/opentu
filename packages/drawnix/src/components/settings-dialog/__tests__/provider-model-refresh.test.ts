import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../../../utils/settings-manager';

const discovery = vi.hoisted(() => ({
  discover: vi.fn(),
  applySelection: vi.fn(),
  setError: vi.fn(),
}));
vi.mock('../../../utils/settings-manager', () => ({
  TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.example.com/v1',
}));
vi.mock('../../../utils/runtime-model-discovery', () => ({
  runtimeModelDiscovery: discovery,
  normalizeModelApiBaseUrl: (url: string) => url.trim().replace(/\/$/, ''),
}));
import {
  getCredentialChangedProfiles,
  refreshChangedProviderModels,
} from '../provider-model-refresh';

const profile = (overrides: Partial<ProviderProfile> = {}): ProviderProfile =>
  ({
    id: 'default',
    name: 'Default',
    apiKey: 'old-key',
    baseUrl: 'https://api.example.com/v1',
    capabilities: { supportsModelsEndpoint: true },
    ...overrides,
  } as ProviderProfile);

describe('provider model refresh after saving credentials', () => {
  beforeEach(() => vi.resetAllMocks());

  it('refreshes changed keys and endpoints but ignores names and whitespace', () => {
    const original = profile();
    expect(
      getCredentialChangedProfiles([profile({ apiKey: 'new-key' })], [original])
    ).toHaveLength(1);
    expect(
      getCredentialChangedProfiles(
        [profile({ baseUrl: 'https://other.example/v1' })],
        [original]
      )
    ).toHaveLength(1);
    expect(
      getCredentialChangedProfiles(
        [
          profile({
            name: 'Renamed',
            apiKey: ' old-key ',
            baseUrl: `${original.baseUrl}/`,
          }),
        ],
        [original]
      )
    ).toEqual([]);
  });

  it('uses the new key and applies only models from the new response', async () => {
    discovery.discover.mockResolvedValue([{ id: 'new-model' }]);
    expect(
      await refreshChangedProviderModels([profile({ apiKey: ' new-key ' })])
    ).toEqual([]);
    expect(discovery.discover).toHaveBeenCalledWith(
      'default',
      'https://api.example.com/v1',
      'new-key'
    );
    expect(discovery.applySelection).toHaveBeenCalledWith('default', [
      'new-model',
    ]);
  });

  it('does not query cleared keys or providers without model discovery', async () => {
    await refreshChangedProviderModels([
      profile({ apiKey: '' }),
      profile({
        capabilities: {
          supportsModelsEndpoint: false,
        } as ProviderProfile['capabilities'],
      }),
    ]);
    expect(discovery.discover).not.toHaveBeenCalled();
  });

  it('reports failure without leaking responses or affecting other providers', async () => {
    discovery.discover
      .mockRejectedValueOnce(new Error('secret response'))
      .mockResolvedValueOnce([{ id: 'valid' }]);
    expect(
      await refreshChangedProviderModels([
        profile(),
        profile({ id: 'other', name: 'Other' }),
      ])
    ).toEqual(['Default']);
    expect(discovery.setError).toHaveBeenCalledWith(
      'default',
      '模型刷新失败，请重新获取模型'
    );
    expect(discovery.applySelection).toHaveBeenCalledTimes(1);
    expect(discovery.applySelection).toHaveBeenCalledWith('other', ['valid']);
  });
});
