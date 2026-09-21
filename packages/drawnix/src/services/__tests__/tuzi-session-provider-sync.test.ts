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

vi.mock('../tuzi-embedded-config', () => ({
  isTuziEmbeddedMode: () => true,
}));
vi.mock('../tuzi-token-auth', () => ({
  hasTuziSystemToken: () => true,
  getTuziSystemUserId: getSystemUserId,
}));
vi.mock('../tuzi-provider-selection', () => ({
  getTuziProviderGroupSelection: getProviderGroupSelection,
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
}));

describe('syncTuziSessionProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTuziSessionProviderSyncCache();
    getSystemUserId.mockReturnValue('1');
    getProviderGroupSelection.mockReturnValue(['default']);
    getProfiles.mockReturnValue([]);
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
    expect(ensureManagedProviders).not.toHaveBeenCalled();
    expect(synchronizeTuziManagedProviders).toHaveBeenCalledWith([]);
    expect(discoverChangedTuziProviderModels).not.toHaveBeenCalled();
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
});
