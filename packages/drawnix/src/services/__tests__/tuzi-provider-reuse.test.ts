// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { TuziSessionApiClient } from '../tuzi-session-api';
import { synchronizeTuziManagedProviders } from '../tuzi-managed-providers';
import {
  getTuziProviderIssues,
  getReusedTuziProviders,
  resetTuziProviderVerification,
  getPreviouslyReusedGroups,
} from '../tuzi-provider-reuse-state';

const state = vi.hoisted(() => ({
  user: '1',
  token: 'system-token',
  profiles: [] as any[],
  catalogs: [] as any[],
  verify: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock('../tuzi-embedded-config', () => ({
  isTuziEmbeddedMode: () => true,
  tuziEmbeddedConfig: { enabled: true, apiBaseUrl: 'https://api.tu-zi.com' },
}));
vi.mock('../tuzi-token-auth', () => ({
  getTuziSystemUserId: () => state.user,
  getTuziSystemToken: () => state.token,
}));
vi.mock('../tuzi-postmessage-bridge', () => ({
  isTuziBridgeConnected: () => true,
  getTuziBridgeContext: () => ({
    status: 'ready',
    userId: state.user,
    systemToken: state.token,
  }),
  verifyTuziProviders: state.verify,
  ensureTuziProviders: state.ensure,
}));
vi.mock('../../utils/settings-manager', () => ({
  providerProfilesSettings: {
    get: () => state.profiles,
    update: vi.fn(async (profiles) => {
      state.profiles = profiles;
    }),
  },
  providerCatalogsSettings: {
    get: () => state.catalogs,
    update: vi.fn(async (catalogs) => {
      state.catalogs = catalogs;
    }),
  },
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_BUSINESS_PROVIDER_PROFILE_ID: 'tuzi-business',
  TUZI_CODEX_PROVIDER_PROFILE_ID: 'tuzi-codex',
  TUZI_MIX_PROVIDER_PROFILE_ID: 'tuzi-mix',
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID: 'tuzi-origin',
  TUZI_PROVIDER_ICON_URL: '/tuzi.png',
}));
function profile(id: string, name = id, baseUrl = 'https://api.tu-zi.com/v1') {
  return {
    id,
    name,
    baseUrl,
    apiKey: `sk-${id}`,
    enabled: true,
    authType: 'bearer',
    providerType: 'openai-compatible',
    pricingGroup: 'stale-label',
    extraHeaders: { 'X-Custom': 'preserved' },
  };
}
function result(id: string, extra: object = {}) {
  return {
    id,
    token_id: id === 'first' ? 10 : 11,
    token_name: `${id} token`,
    groups: ['default'],
    usable: true,
    model_limits_enabled: false,
    ip_restricted: false,
    quota_limited: false,
    count_limited: false,
    expires_at: -1,
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetTuziProviderVerification();
  state.user = '1';
  state.token = 'system-token';
  state.profiles = [
    profile('first', '绘图供应商'),
    profile('second', '聊天供应商'),
  ];
  state.catalogs = [
    {
      profileId: 'first',
      selectedModelIds: ['my-model'],
      manualBindings: [{ id: 'custom' }],
    },
  ];
  state.verify.mockResolvedValue([result('first'), result('second')]);
  state.ensure.mockResolvedValue([]);
});
describe('verified ordinary Tuzi providers', () => {
  it('keeps manual settings and account reads usable with an old parent and missing verification API', async () => {
    state.verify.mockRejectedValue(new Error('TUZI_PARENT_TIMEOUT'));
    const original = structuredClone(state.profiles);
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/providers/verify')
              ? { success: false, message: 'not found' }
              : { success: true, data: { id: 1, username: 'legacy' } }
          ),
          { status: url.includes('/providers/verify') ? 404 : 200 }
        )
    );
    const client = new TuziSessionApiClient(undefined, fetcher as typeof fetch);
    await expect(client.verifyExistingProviders()).resolves.toEqual([]);
    expect(state.profiles).toEqual(original);
    expect(getReusedTuziProviders(state.profiles)).toEqual([]);
    await expect(client.getAccount()).resolves.toMatchObject({
      id: 1,
      username: 'legacy',
    });
    expect(state.ensure).not.toHaveBeenCalled();
  });

  it('does not suppress authentication failures in the legacy fallback', async () => {
    state.verify.mockRejectedValue(new Error('TUZI_PARENT_TIMEOUT'));
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ success: false, message: 'unauthorized' }),
          { status: 401 }
        )
    );
    const client = new TuziSessionApiClient(undefined, fetcher as typeof fetch);
    await expect(client.verifyExistingProviders()).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('reuses multiple providers in the same group without changing names, keys or model configuration', async () => {
    const originalProfiles = structuredClone(state.profiles);
    const originalCatalogs = structuredClone(state.catalogs);
    const providers = await new TuziSessionApiClient().ensureManagedProviders([
      'default',
    ]);
    expect(providers.map((item) => item.id)).toEqual(['first', 'second']);
    expect(providers.map((item) => item.displayName)).toEqual([
      '绘图供应商',
      '聊天供应商',
    ]);
    expect(state.ensure).not.toHaveBeenCalled();
    expect(state.verify).toHaveBeenCalledWith([
      { id: 'first', fingerprint: bytesToHex(sha256('first')) },
      { id: 'second', fingerprint: bytesToHex(sha256('second')) },
    ]);
    expect(JSON.stringify(state.verify.mock.calls)).not.toContain('sk-first');
    await synchronizeTuziManagedProviders(providers);
    expect(state.profiles).toEqual(originalProfiles);
    expect(state.catalogs).toEqual(originalCatalogs);
  });
  it('keeps valid profiles and explains an expired profile; read-only association creates nothing', async () => {
    state.verify.mockResolvedValue([
      result('first'),
      result('second', { usable: false, reason: 'expired' }),
    ]);
    const providers = await new TuziSessionApiClient().ensureManagedProviders(
      []
    );
    expect(providers.map((item) => item.id)).toEqual(['first']);
    expect(getTuziProviderIssues(state.profiles)).toEqual([
      { id: 'second', name: '聊天供应商', reason: '令牌已过期' },
    ]);
    expect(state.ensure).not.toHaveBeenCalled();
    expect(getPreviouslyReusedGroups()).toEqual(['default']);
  });
  it('creates only an explicitly selected group not covered by an existing credential', async () => {
    await new TuziSessionApiClient().ensureManagedProviders(['default', 'vip']);
    expect(state.ensure).toHaveBeenCalledExactlyOnceWith(['vip']);
  });
  it('does not silently replace an exhausted ordinary token on background sync', async () => {
    state.verify.mockResolvedValue([
      result('first', { usable: false, reason: 'quota_exhausted' }),
      result('second', { usable: false, reason: 'expired' }),
    ]);
    await new TuziSessionApiClient().ensureManagedProviders(['default']);
    expect(state.ensure).not.toHaveBeenCalled();
    await new TuziSessionApiClient().ensureManagedProviders(['default'], true);
    expect(state.ensure).toHaveBeenCalledExactlyOnceWith(['default']);
  });
  it('never submits keys from another API host and keeps token restrictions', async () => {
    state.profiles.push(
      profile('external', 'External', 'https://other.example/v1')
    );
    state.verify.mockResolvedValue([
      result('first', {
        model_limits_enabled: true,
        models: ['my-model'],
        ip_restricted: true,
        quota_limited: true,
      }),
      result('second'),
    ]);
    const providers =
      await new TuziSessionApiClient().verifyExistingProviders();
    expect(state.verify.mock.calls[0][0]).toHaveLength(2);
    expect(providers[0].restrictions).toEqual([
      '模型限制',
      'IP 限制',
      '额度限制',
    ]);
  });
  it('discards a response after an account switch and does not authorize old keys', async () => {
    let resolve!: (value: any) => void;
    state.verify.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = new TuziSessionApiClient().verifyExistingProviders();
    state.user = '2';
    state.token = 'new-system-token';
    resolve([result('first'), result('second')]);
    await expect(pending).rejects.toThrow('账户已变化');
    expect(getReusedTuziProviders(state.profiles)).toEqual([]);
  });
  it('requires new verification after a key is edited', async () => {
    await new TuziSessionApiClient().verifyExistingProviders();
    state.profiles[0] = { ...state.profiles[0], apiKey: 'sk-changed' };
    expect(
      getReusedTuziProviders(state.profiles).map((item) => item.id)
    ).toEqual(['second']);
  });
});
