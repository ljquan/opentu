import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAWNIX_SETTINGS_KEY } from '../../constants/storage';

describe('settings-manager', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('preserves saved provider type and auth type for managed providers', async () => {
    vi.doMock('../crypto-utils', () => ({
      CryptoUtils: {
        testCrypto: async () => false,
        isEncrypted: () => false,
        decrypt: async (value: string) => value,
        encrypt: async (value: string) => value,
      },
    }));

    vi.doMock('../config-indexeddb-writer', () => ({
      configIndexedDBWriter: {
        saveConfig: async () => {},
      },
    }));

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: '兔子 AI',
            providerType: 'custom',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'query',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'tuzi-origin',
            name: '兔子 原价',
            providerType: 'gemini-compatible',
            baseUrl: 'https://example.com/custom-endpoint',
            apiKey: 'origin-key',
            authType: 'header',
            enabled: true,
            capabilities: {},
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const profiles = providerProfilesSettings.get();
    const legacyProfile = profiles.find(
      (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );
    const tuziOriginProfile = profiles.find(
      (profile) => profile.id === TUZI_ORIGINAL_PROVIDER_PROFILE_ID
    );

    expect(legacyProfile).toMatchObject({
      providerType: 'custom',
      authType: 'query',
    });
    expect(tuziOriginProfile).toMatchObject({
      providerType: 'gemini-compatible',
      authType: 'header',
    });
  });
});
