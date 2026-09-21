import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareTuziManagedRoute } from '../tuzi-managed-route-gate';

const mocks = vi.hoisted(() => ({
  requestContext: vi.fn(),
  synchronizeProviders: vi.fn(),
  resetSyncCache: vi.fn(),
  syncProviders: vi.fn(),
}));

vi.mock('../tuzi-postmessage-bridge', () => ({
  requestTuziParentContext: mocks.requestContext,
}));
vi.mock('../tuzi-managed-providers', () => ({
  isTuziManagedProviderProfileId: (profileId: unknown) =>
    typeof profileId === 'string' && profileId.startsWith('tuzi-managed-'),
  synchronizeTuziManagedProviders: mocks.synchronizeProviders,
}));
vi.mock('../tuzi-session-provider-sync', () => ({
  resetTuziSessionProviderSyncCache: mocks.resetSyncCache,
  syncTuziSessionProviders: mocks.syncProviders,
}));

describe('prepareTuziManagedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.synchronizeProviders.mockResolvedValue(undefined);
    mocks.syncProviders.mockResolvedValue(true);
  });

  it('does not contact a parent for an ordinary configured provider', async () => {
    await expect(
      prepareTuziManagedRoute({ profileId: 'custom-openai', apiKey: 'sk-key' })
    ).resolves.toEqual({ context: null, managedRoute: false });

    expect(mocks.requestContext).not.toHaveBeenCalled();
  });

  it('clears a stale managed key when the current user needs a token', async () => {
    const context = {
      environment: 'tuzi-api',
      status: 'need_system_token',
      userId: '42',
      groups: [],
    };
    mocks.requestContext.mockResolvedValue(context);

    await expect(
      prepareTuziManagedRoute({
        profileId: 'tuzi-managed-vip',
        apiKey: 'stale-key',
      })
    ).resolves.toEqual({ context, managedRoute: true });

    expect(mocks.requestContext).toHaveBeenCalledWith({ refresh: true });
    expect(mocks.resetSyncCache).toHaveBeenCalledOnce();
    expect(mocks.synchronizeProviders).toHaveBeenCalledWith([]);
    expect(mocks.syncProviders).not.toHaveBeenCalled();
  });

  it('refreshes managed providers after the parent confirms the account', async () => {
    const context = {
      environment: 'tuzi-api',
      status: 'ready',
      userId: '42',
      systemToken: 'system-token',
      groups: [],
    };
    mocks.requestContext.mockResolvedValue(context);

    await prepareTuziManagedRoute({
      profileId: 'tuzi-managed-vip',
      apiKey: 'previous-key',
    });

    expect(mocks.syncProviders).toHaveBeenCalledWith({
      discoverModels: false,
    });
    expect(mocks.synchronizeProviders).not.toHaveBeenCalled();
  });
});
