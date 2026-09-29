import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetTuziSessionProviderSyncCache,
  syncTuziSessionProviders,
} from '../tuzi-session-provider-sync';

const {
  ensureManagedProviders,
  synchronizeTuziManagedProviders,
  discoverChangedTuziProviderModels,
  getProfiles,
  getSystemUserId,
  getProviderGroupSelection,
} = vi.hoisted(() => ({
  ensureManagedProviders: vi.fn(),
  synchronizeTuziManagedProviders: vi.fn(),
  discoverChangedTuziProviderModels: vi.fn(),
  getProfiles: vi.fn(),
  getSystemUserId: vi.fn(),
  getProviderGroupSelection: vi.fn(),
}));

vi.mock('../tuzi-provider-reuse-state', () => ({
  getPreviouslyReusedGroups: () => [],
  resetTuziProviderVerification: vi.fn(),
}));
vi.mock('../tuzi-embedded-config', () => ({
  isTuziEmbeddedMode: () => true,
}));
vi.mock('../tuzi-token-auth', () => ({
  hasTuziSystemToken: () => true,
  getTuziSystemToken: () => 'test-system',
  getTuziSystemUserId: getSystemUserId,
}));
vi.mock('../tuzi-provider-selection', () => ({
  getTuziProviderGroupSelection: getProviderGroupSelection,
  saveTuziProviderGroupSelection: vi.fn(),
}));
vi.mock('../tuzi-session-api', () => ({
  TuziSessionApiError: class TuziSessionApiError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
  TuziSessionApiClient: vi.fn(() => ({ ensureManagedProviders })),
}));
vi.mock('../tuzi-managed-providers', () => ({
  synchronizeTuziManagedProviders,
}));
vi.mock('../tuzi-managed-provider-models', () => ({
  discoverChangedTuziProviderModels,
}));
vi.mock('../../utils/settings-manager', () => ({
  providerProfilesSettings: { get: getProfiles },
  settingsManager: { waitForInitialization: () => Promise.resolve() },
}));

describe('syncTuziSessionProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTuziSessionProviderSyncCache();
    getSystemUserId.mockReturnValue('1');
    getProviderGroupSelection.mockReturnValue(['default']);
    getProfiles.mockReturnValue([]);
    ensureManagedProviders.mockResolvedValue([]);
    synchronizeTuziManagedProviders.mockResolvedValue(undefined);
    discoverChangedTuziProviderModels.mockResolvedValue(undefined);
  });

  it("does not reuse another account's managed groups when no choice exists", async () => {
    const providers = [
      { id: 'tuzi-managed-default', group: 'default', apiKey: 'sk-default' },
      { id: 'tuzi-managed-vip', group: 'vip', apiKey: 'sk-vip' },
    ];
    getProfiles.mockReturnValue(
      providers.map((provider) => ({
        ...provider,
        name: provider.group,
        pricingGroup: provider.group,
      }))
    );
    getProviderGroupSelection.mockReturnValue(null);
    await expect(syncTuziSessionProviders()).resolves.toBe(true);
    expect(ensureManagedProviders).toHaveBeenCalledWith([]);
    expect(synchronizeTuziManagedProviders).toHaveBeenCalledWith([]);
    expect(discoverChangedTuziProviderModels).toHaveBeenCalledWith(
      [],
      expect.any(Map)
    );
  });

  it('deduplicates overlapping startup and focus synchronization', async () => {
    let resolveProviders: (providers: unknown[]) => void = () => undefined;
    ensureManagedProviders.mockReturnValue(
      new Promise((resolve) => {
        resolveProviders = resolve;
      })
    );

    const startup = syncTuziSessionProviders();
    const focus = syncTuziSessionProviders();
    await Promise.resolve();
    resolveProviders([]);

    await expect(Promise.all([startup, focus])).resolves.toEqual([true, true]);
    expect(ensureManagedProviders).toHaveBeenCalledTimes(1);
  });

  it('does not reuse the successful-sync cache across user accounts', async () => {
    ensureManagedProviders.mockResolvedValue([]);

    await expect(syncTuziSessionProviders()).resolves.toBe(true);
    getSystemUserId.mockReturnValue('2');
    getProviderGroupSelection.mockReturnValue(['vip']);
    await expect(syncTuziSessionProviders()).resolves.toBe(true);

    expect(ensureManagedProviders).toHaveBeenNthCalledWith(1, ['default']);
    expect(ensureManagedProviders).toHaveBeenNthCalledWith(2, ['vip']);
  });

  it('restores models even when an earlier credential-only sync is cached', async () => {
    await expect(
      syncTuziSessionProviders({ discoverModels: false })
    ).resolves.toBe(true);
    expect(discoverChangedTuziProviderModels).not.toHaveBeenCalled();
    await expect(syncTuziSessionProviders()).resolves.toBe(true);
    expect(discoverChangedTuziProviderModels).toHaveBeenCalledTimes(1);
  });

  it('restores models after an overlapping credential-only sync finishes', async () => {
    let resolveProviders!: (providers: unknown[]) => void;
    ensureManagedProviders.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProviders = resolve;
      })
    );
    const credentials = syncTuziSessionProviders({ discoverModels: false });
    const restoration = syncTuziSessionProviders();
    await Promise.resolve();
    resolveProviders([]);
    await expect(Promise.all([credentials, restoration])).resolves.toEqual([
      true,
      true,
    ]);
    expect(discoverChangedTuziProviderModels).toHaveBeenCalledTimes(1);
  });

  it('discovers models without reading a group from URL credentials', async () => {
    const providers = [
      { id: 'tuzi-managed-vip', group: 'vip', apiKey: 'sk-vip' },
    ];
    getProviderGroupSelection.mockReturnValue(['vip']);
    ensureManagedProviders.mockResolvedValue(providers);

    await expect(syncTuziSessionProviders()).resolves.toBe(true);

    expect(discoverChangedTuziProviderModels).toHaveBeenCalledWith(
      providers,
      new Map()
    );
  });

  it('removes managed providers when the Tuzi Session has expired', async () => {
    const { TuziSessionApiError } = await import('../tuzi-session-api');
    ensureManagedProviders.mockRejectedValue(
      new TuziSessionApiError('SESSION_EXPIRED', '登录已过期')
    );

    await expect(syncTuziSessionProviders()).resolves.toBe(false);

    expect(synchronizeTuziManagedProviders).toHaveBeenCalledWith([]);
  });
  it('keeps saved groups on a temporary network failure and retries', async () => {
    ensureManagedProviders.mockRejectedValueOnce(new Error('Network timeout'));
    await expect(syncTuziSessionProviders()).resolves.toBe(false);
    expect(synchronizeTuziManagedProviders).not.toHaveBeenCalled();
    await expect(syncTuziSessionProviders()).resolves.toBe(true);
    expect(ensureManagedProviders).toHaveBeenCalledTimes(2);
  });
  it('does not apply an old response after adding a group invalidates the sync', async () => {
    let resolveProviders!: (providers: unknown[]) => void;
    ensureManagedProviders.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProviders = resolve;
      })
    );
    const old = syncTuziSessionProviders();
    await Promise.resolve();
    getProviderGroupSelection.mockReturnValue(['default', 'image']);
    resetTuziSessionProviderSyncCache();
    const fresh = syncTuziSessionProviders();
    resolveProviders([]);
    await expect(old).resolves.toBe(false);
    await expect(fresh).resolves.toBe(true);
    expect(ensureManagedProviders).toHaveBeenLastCalledWith([
      'default',
      'image',
    ]);
  });
  it('discards a provider response from the previous account', async () => {
    let resolveProviders!: (providers: unknown[]) => void;
    ensureManagedProviders.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProviders = resolve;
      })
    );
    const pending = syncTuziSessionProviders({ discoverModels: false });
    await Promise.resolve();
    getSystemUserId.mockReturnValue('2');
    resetTuziSessionProviderSyncCache();
    resolveProviders([
      {
        id: 'tuzi-managed-default',
        group: 'default',
        apiKey: 'old-account-key',
      },
    ]);
    await expect(pending).resolves.toBe(false);
    expect(synchronizeTuziManagedProviders).not.toHaveBeenCalled();
  });
});
