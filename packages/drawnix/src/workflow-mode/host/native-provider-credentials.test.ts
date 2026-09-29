import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfile } from '../../utils/settings-types';
import {
  mapNativeProviderCredentials,
  readNativeProviderCredentials,
} from './native-models';

const settings = vi.hoisted(() => ({
  waitForInitialization: vi.fn(),
  get: vi.fn(),
  resolveInvocationRoute: vi.fn(),
}));
vi.mock('../../utils/settings-manager', () => ({
  settingsManager: { waitForInitialization: settings.waitForInitialization },
  providerProfilesSettings: { get: settings.get },
  resolveInvocationRoute: settings.resolveInvocationRoute,
}));

const profile = (overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
  id: 'default', name: 'Default', enabled: true,
  baseUrl: 'https://provider.example/v1', apiKey: 'test-default',
  providerType: 'openai-compatible', authType: 'bearer',
  capabilities: {
    supportsModelsEndpoint: true, supportsText: true, supportsImage: true,
    supportsVideo: true, supportsAudio: true, supportsTools: false,
  },
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  settings.waitForInitialization.mockResolvedValue(undefined);
  settings.get.mockReturnValue([profile()]);
  settings.resolveInvocationRoute.mockReturnValue({ profileId: 'default' });
});

describe('channel editor credentials', () => {
  it('includes configured groups without model catalogs and keeps shared URLs independent', () => {
    const result = mapNativeProviderCredentials([
      profile(), profile({ id: 'mix', name: 'Mix', apiKey: 'test-mix' }),
      profile({ id: 'gemini', providerType: 'gemini-compatible' }),
    ], 'mix');
    expect(result.preferredProfileId).toBe('mix');
    expect(result.profiles.map(({ id, apiKey, apiFormat }) => ({ id, apiKey, apiFormat }))).toEqual([
      { id: 'default', apiKey: 'test-default', apiFormat: 'openai' },
      { id: 'mix', apiKey: 'test-mix', apiFormat: 'openai' },
      { id: 'gemini', apiKey: 'test-default', apiFormat: 'gemini' },
    ]);
  });

  it('excludes disabled, unconfigured and unsupported authentication profiles', () => {
    const profiles = [
      profile({ enabled: false }), profile({ apiKey: '  ' }),
      profile({ baseUrl: '' }), profile({ baseUrl: 'file:///tmp/provider' }),
      profile({ baseUrl: 'https://user:password@provider.example' }),
      profile({ baseUrl: 'https://provider.example?key=test' }),
      profile({ providerType: 'custom' }), profile({ authType: 'query' }),
      profile({ extraHeaders: { 'X-Account': 'required' } }),
    ];
    expect(mapNativeProviderCredentials(profiles, null).profiles).toEqual([]);
  });

  it('normalizes entered credentials without mutating the host settings', () => {
    const original = profile({ baseUrl: ' https://provider.example/v1/ ', apiKey: ' test-key ' });
    expect(mapNativeProviderCredentials([original], null).profiles[0]).toMatchObject({
      baseUrl: 'https://provider.example/v1/', apiKey: 'test-key',
    });
    expect(original.apiKey).toBe(' test-key ');
  });

  it('waits for settings decryption and reads the current profile on every opening', async () => {
    let finish!: () => void;
    settings.waitForInitialization.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const pending = readNativeProviderCredentials();
    await vi.waitFor(() => expect(settings.waitForInitialization).toHaveBeenCalledOnce());
    expect(settings.get).not.toHaveBeenCalled();
    finish();
    expect((await pending).profiles[0].apiKey).toBe('test-default');
    settings.get.mockReturnValue([profile({ apiKey: 'test-updated' })]);
    expect((await readNativeProviderCredentials()).profiles[0].apiKey).toBe('test-updated');
  });
});
