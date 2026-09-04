import { beforeEach, describe, expect, it, vi } from 'vitest';
import { synchronizeTuziManagedProviders } from '../tuzi-managed-providers';

const { update, get } = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
}));
const { catalogUpdate, catalogGet } = vi.hoisted(() => ({
  catalogUpdate: vi.fn(),
  catalogGet: vi.fn(),
}));

vi.mock('../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID: 'tuzi-origin',
  TUZI_MIX_PROVIDER_PROFILE_ID: 'tuzi-mix',
  TUZI_CODEX_PROVIDER_PROFILE_ID: 'tuzi-codex',
  TUZI_BUSINESS_PROVIDER_PROFILE_ID: 'tuzi-business',
  TUZI_PROVIDER_ICON_URL: '/logo-tuzi.png',
  providerCatalogsSettings: { get: catalogGet, update: catalogUpdate },
  providerProfilesSettings: { get, update },
}));

vi.mock('../tuzi-embedded-config', () => ({
  tuziEmbeddedConfig: {
    enabled: true,
    apiBaseUrl: 'http://localhost:3100',
    parentOrigin: 'http://localhost:5173',
  },
}));

describe('synchronizeTuziManagedProviders', () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue(undefined);
    catalogUpdate.mockReset().mockResolvedValue(undefined);
    catalogGet
      .mockReset()
      .mockReturnValue([
        { profileId: 'tuzi-managed-old' },
        { profileId: 'custom-provider' },
      ]);
    get.mockReset().mockReturnValue([
      {
        id: 'legacy-default',
        name: 'default 分组',
        iconUrl: '/logo-tuzi.png',
        homepageUrl: 'https://api.tu-zi.com/',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'legacy-key',
        authType: 'bearer',
        imageApiCompatibility: 'tuzi-gpt-image',
        preferAsyncImageEndpoint: true,
        enabled: true,
        capabilities: {
          supportsModelsEndpoint: true,
          supportsText: true,
          supportsImage: true,
          supportsVideo: true,
          supportsAudio: true,
          supportsTools: true,
        },
      },
      { id: 'tuzi-origin', name: '原价分组', enabled: true },
      { id: 'tuzi-mix', name: 'gemini-mix 分组', enabled: true },
      { id: 'tuzi-codex', name: 'codex 分组', enabled: true },
      { id: 'tuzi-business', name: 'Business', enabled: true },
      { id: 'custom-provider', name: 'Custom', apiKey: 'keep-me' },
      { id: 'tuzi-managed-old', name: 'Old managed', apiKey: 'old' },
      { id: 'tuzi-managed-image', name: 'Old image', apiKey: 'old-image' },
    ]);
  });

  it('preserves custom profiles, updates authorized profiles and removes stale managed profiles', async () => {
    await synchronizeTuziManagedProviders([
      {
        id: 'tuzi-managed-image',
        group: 'image',
        displayName: '图片分组',
        apiKey: 'sk-new-image',
        status: 1,
        rotatedAt: 1700000000,
      },
    ]);

    expect(update).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'custom-provider', apiKey: 'keep-me' }),
        expect.objectContaining({
          id: 'tuzi-managed-image',
          apiKey: 'sk-new-image',
          baseUrl: 'http://localhost:3100/v1',
          iconUrl: '/logo-tuzi.png',
          imageApiCompatibility: 'tuzi-gpt-image',
          providerType: 'openai-compatible',
          pricingGroup: 'image',
          pricingUrl: 'http://localhost:3100/api/pricing',
        }),
      ])
    );
    const updatedProfiles = update.mock.calls[0][0];
    expect(
      updatedProfiles
        .filter((profile: { id: string }) =>
          [
            'legacy-default',
            'tuzi-origin',
            'tuzi-mix',
            'tuzi-codex',
            'tuzi-business',
          ].includes(profile.id)
        )
        .every((profile: { enabled: boolean }) => profile.enabled === false)
    ).toBe(true);
    expect(
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'custom-provider'
      ).enabled
    ).not.toBe(false);
  });

  it('disables built-in Tuzi profiles when credentials are cleared', async () => {
    await synchronizeTuziManagedProviders([]);

    const updatedProfiles = update.mock.calls[0][0];
    expect(
      updatedProfiles
        .filter((profile: { id: string }) =>
          [
            'legacy-default',
            'tuzi-origin',
            'tuzi-mix',
            'tuzi-codex',
            'tuzi-business',
          ].includes(profile.id)
        )
        .every((profile: { enabled: boolean }) => profile.enabled === false)
    ).toBe(true);
    expect(
      updatedProfiles.some(
        (profile: { id: string }) => profile.id === 'tuzi-managed-old'
      )
    ).toBe(false);
    expect(catalogUpdate).toHaveBeenCalledWith([
      { profileId: 'custom-provider' },
    ]);
  });
});
