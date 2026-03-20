import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('settings-repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses the saved legacy provider type and auth type in snapshots', async () => {
    vi.doMock('../../utils/settings-manager', () => ({
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      TUZI_DEFAULT_PROVIDER_NAME: '兔子 AI',
      TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
      createModelRef: (profileId?: string | null, modelId?: string | null) => ({
        profileId: profileId ?? null,
        modelId: modelId ?? null,
      }),
      geminiSettings: {
        get: () => ({
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          textModelName: 'text-model',
          imageModelName: 'image-model',
          videoModelName: 'video-model',
        }),
      },
      providerProfilesSettings: {
        get: () => [
          {
            id: 'legacy-default',
            name: '兔子 AI',
            providerType: 'custom',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'query',
            enabled: true,
            capabilities: {
              supportsModelsEndpoint: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: true,
              supportsTools: true,
            },
          },
        ],
      },
      providerCatalogsSettings: {
        get: () => [],
      },
      resolveInvocationRoute: () => {
        throw new Error('resolveInvocationRoute should not be called');
      },
    }));

    const { listSettingsProviderProfiles } = await import(
      '../provider-routing/settings-repository'
    );

    const profiles = listSettingsProviderProfiles();

    expect(profiles[0]).toMatchObject({
      id: 'legacy-default',
      name: '兔子 AI',
      providerType: 'custom',
      authType: 'query',
    });
  });
});
