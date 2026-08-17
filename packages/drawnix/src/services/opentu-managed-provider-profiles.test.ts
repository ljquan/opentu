import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateStorageNamespace,
  createStorageNamespace,
} from './storage-context';
import {
  getManagedProviderProfileId,
  reconcileManagedProviderGroups,
  updateManagedProviderGroup,
} from './opentu-managed-provider-profiles';

const state = vi.hoisted(() => ({
  snapshot: null as null | { credentialId: string; profiles: unknown[] },
  runtimeProfiles: [] as unknown[],
}));

vi.mock('../utils/config-indexeddb-writer', () => ({
  configIndexedDBWriter: {
    getManagedProviderProfiles: vi.fn(async () => state.snapshot),
    saveManagedProviderProfiles: vi.fn(async (snapshot) => {
      state.snapshot = snapshot;
    }),
  },
}));

vi.mock('../utils/settings-manager', () => ({
  DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai-gpt-image',
  TUZI_CODEX_PROVIDER_PROFILE_ID: 'tuzi-codex',
  TUZI_MIX_PROVIDER_PROFILE_ID: 'tuzi-mix',
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID: 'tuzi-origin',
  TUZI_PROVIDER_ICON_URL: '/logo-tuzi.png',
  setManagedProviderProfiles: vi.fn((profiles) => {
    state.runtimeProfiles = profiles;
  }),
}));

const group = (name: string, apiKey = `key-${name}`) => ({
  group: name,
  display_name: `${name} group`,
  api_key: apiKey,
  base_url: 'https://api.tu-zi.com/v1',
});

describe('managed provider profiles', () => {
  beforeEach(() => {
    state.snapshot = null;
    state.runtimeProfiles = [];
    activateStorageNamespace(createStorageNamespace('credential-1'));
  });

  it('uses only the explicit legacy-compatible group mappings', () => {
    expect(getManagedProviderProfileId('default')).toBe('tuzi-origin');
    expect(getManagedProviderProfileId('gemini-mix')).toBe('tuzi-mix');
    expect(getManagedProviderProfileId('codex')).toBe('tuzi-codex');
    expect(getManagedProviderProfileId('Business')).toMatch(
      /^tuzi-managed-business-/
    );
    expect(getManagedProviderProfileId('Business')).not.toBe('tuzi-business');
  });

  it('reconciles groups and disables a group no longer returned', async () => {
    await reconcileManagedProviderGroups(
      [group('default'), group('Business')],
      'credential-1'
    );
    await reconcileManagedProviderGroups([group('default')], 'credential-1');

    const profiles = state.snapshot?.profiles as Array<{
      managedGroup: string;
      enabled: boolean;
    }>;
    expect(
      profiles.find((profile) => profile.managedGroup === 'default')
    ).toMatchObject({ enabled: true });
    expect(
      profiles.find((profile) => profile.managedGroup === 'Business')
    ).toMatchObject({ enabled: false });
  });

  it('rotates only the selected group', async () => {
    await reconcileManagedProviderGroups(
      [group('default', 'old-default'), group('codex', 'old-codex')],
      'credential-1'
    );
    await updateManagedProviderGroup(
      group('default', 'new-default'),
      'credential-1'
    );

    const profiles = state.runtimeProfiles as Array<{
      managedGroup: string;
      apiKey: string;
    }>;
    expect(
      profiles.find((profile) => profile.managedGroup === 'default')?.apiKey
    ).toBe('new-default');
    expect(
      profiles.find((profile) => profile.managedGroup === 'codex')?.apiKey
    ).toBe('old-codex');
  });

  it('rejects a response for a credential that is no longer active', async () => {
    activateStorageNamespace(createStorageNamespace('credential-2'));
    await expect(
      reconcileManagedProviderGroups([group('default')], 'credential-1')
    ).rejects.toThrow('does not match active credential');
    expect(state.snapshot).toBeNull();
  });
});
