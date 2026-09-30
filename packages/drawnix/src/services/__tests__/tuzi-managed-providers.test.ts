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
      {
        id: 'custom-provider',
        name: 'Custom',
        apiKey: 'keep-me',
        enabled: false,
      },
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
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'legacy-default'
      ).apiKey
    ).toBe('legacy-key');
    expect(
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'legacy-default'
      ).enabled
    ).not.toBe(false);
    expect(
      updatedProfiles
        .filter((profile: { id: string }) =>
          ['tuzi-origin', 'tuzi-mix', 'tuzi-codex', 'tuzi-business'].includes(
            profile.id
          )
        )
        .every((profile: { enabled: boolean }) => profile.enabled === true)
    ).toBe(true);
    expect(
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'custom-provider'
      ).enabled
    ).toBe(false);
  });

  it('preserves ordinary keys while clearing managed credentials', async () => {
    await synchronizeTuziManagedProviders([]);

    const updatedProfiles = update.mock.calls[0][0];
    expect(
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'legacy-default'
      ).apiKey
    ).toBe('legacy-key');
    expect(
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'legacy-default'
      ).enabled
    ).not.toBe(false);
    expect(
      updatedProfiles
        .filter((profile: { id: string }) =>
          ['tuzi-origin', 'tuzi-mix', 'tuzi-codex', 'tuzi-business'].includes(
            profile.id
          )
        )
        .every((profile: { enabled: boolean }) => profile.enabled === true)
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

  it('does not broadcast settings when managed providers are unchanged', async () => {
    const provider = {
      id: 'tuzi-managed-image',
      group: 'image',
      displayName: '图片分组',
      apiKey: 'sk-new-image',
      status: 1,
      rotatedAt: 1700000000,
    };

    await synchronizeTuziManagedProviders([provider]);
    const updatedProfiles = update.mock.calls[0][0];
    expect(
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'legacy-default'
      ).apiKey
    ).toBe('legacy-key');
    expect(
      updatedProfiles.find(
        (profile: { id: string }) => profile.id === 'legacy-default'
      ).enabled
    ).not.toBe(false);
    const updatedCatalogs = catalogUpdate.mock.calls[0][0];
    update.mockClear();
    catalogUpdate.mockClear();
    get.mockReturnValue(updatedProfiles);
    catalogGet.mockReturnValue(updatedCatalogs);

    await synchronizeTuziManagedProviders([provider]);

    expect(update).not.toHaveBeenCalled();
    expect(catalogUpdate).not.toHaveBeenCalled();
  });
});

it('adds same-group ordinary tokens independently and preserves matching manual profiles and catalogs', async () => {
  const { addTuziTokenProviders } = await import('../tuzi-managed-providers');
  const manual = {
    id: 'manual',
    name: '我的原始名称',
    baseUrl: 'http://localhost:3100',
    apiKey: 'existing',
    enabled: true,
    pricingGroup: 'default',
  };
  get.mockReturnValue([manual]);
  update.mockClear();
  catalogUpdate.mockClear();
  const provider = {
    id: 'tuzi-token-1-1',
    group: 'default',
    displayName: '服务端名称',
    apiKey: 'sk-existing',
    status: 1,
    rotatedAt: 0,
  };
  const added = await addTuziTokenProviders([
    provider,
    {
      ...provider,
      id: 'tuzi-token-1-2',
      apiKey: 'sk-other',
      displayName: '备用令牌',
    },
  ]);
  expect(added.map((p) => p.id)).toEqual(['tuzi-token-1-2']);
  expect(update).toHaveBeenCalledWith([
    manual,
    expect.objectContaining({ id: 'tuzi-token-1-2', name: '备用令牌' }),
  ]);
  expect(catalogUpdate).not.toHaveBeenCalled();
});
