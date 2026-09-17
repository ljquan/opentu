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
  consumeProviderGroup,
} = vi.hoisted(() => ({
  ensureManagedProviders: vi.fn(),
  synchronizeTuziManagedProviders: vi.fn(),
  discoverChangedTuziProviderModels: vi.fn(),
  getProfiles: vi.fn(),
  getSystemUserId: vi.fn(),
  consumeProviderGroup: vi.fn(),
}));

vi.mock('../tuzi-embedded-config', () => ({
  isTuziEmbeddedMode: () => true,
}));
vi.mock('../tuzi-token-auth', () => ({
  hasTuziSystemToken: () => true,
  getTuziSystemUserId: getSystemUserId,
  consumeTuziProviderGroupFromUrl: consumeProviderGroup,
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
    consumeProviderGroup.mockReturnValue('');
    getProfiles.mockReturnValue([]);
    synchronizeTuziManagedProviders.mockResolvedValue(undefined);
    discoverChangedTuziProviderModels.mockResolvedValue(undefined);
  });

  it('keeps legacy managed group selection when no saved choice exists', async () => {
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
    ensureManagedProviders.mockResolvedValue(providers);

    await expect(syncTuziSessionProviders()).resolves.toBe(true);
    expect(ensureManagedProviders).toHaveBeenCalledWith(['default', 'vip']);
    expect(synchronizeTuziManagedProviders).toHaveBeenCalledWith(providers);
    expect(discoverChangedTuziProviderModels).toHaveBeenCalledWith(
      providers,
      new Map([
        ['tuzi-managed-default', 'sk-default'],
        ['tuzi-managed-vip', 'sk-vip'],
      ])
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
    resolveProviders([]);

    await expect(Promise.all([startup, focus])).resolves.toEqual([true, true]);
    expect(ensureManagedProviders).toHaveBeenCalledTimes(1);
  });

  it('requests image model selection for the group provided by the parent URL', async () => {
    const providers = [
      { id: 'tuzi-managed-vip', group: 'vip', apiKey: 'sk-vip' },
    ];
    consumeProviderGroup.mockReturnValueOnce('vip');
    ensureManagedProviders.mockResolvedValue(providers);

    await expect(syncTuziSessionProviders()).resolves.toBe(true);

    expect(discoverChangedTuziProviderModels).toHaveBeenCalledWith(
      providers,
      new Map(),
      { selectImageModelForProviderId: 'tuzi-managed-vip' }
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
