import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareTuziManagedRoute } from '../tuzi-managed-route-gate';

const mocks = vi.hoisted(() => ({
  requestContext: vi.fn(),
  requestAuthentication: vi.fn(),
  synchronizeProviders: vi.fn(),
  resetSyncCache: vi.fn(),
  syncProviders: vi.fn(),
  isEmbedded: vi.fn(),
  selectedGroups: vi.fn(),
  localSession: vi.fn(),
  syncFailure: vi.fn(),
}));

vi.mock('../tuzi-token-auth', () => ({
  isLocalTuziSession: mocks.localSession,
  getTuziSystemUserId: () => '1',
}));

vi.mock('../tuzi-postmessage-bridge', () => ({
  requestTuziParentContext: mocks.requestContext,
  requestTuziParentAuthentication: mocks.requestAuthentication,
  isTuziBridgeConnected: mocks.isEmbedded,
  getTuziBridgeContext: vi.fn(),
}));
vi.mock('../tuzi-provider-selection', () => ({
  getTuziProviderGroupSelection: mocks.selectedGroups,
}));
vi.mock('../tuzi-managed-providers', () => ({
  isTuziManagedProviderProfileId: (profileId: unknown) =>
    typeof profileId === 'string' && profileId.startsWith('tuzi-managed-'),
  synchronizeTuziManagedProviders: mocks.synchronizeProviders,
}));
vi.mock('../tuzi-session-provider-sync', () => ({
  resetTuziSessionProviderSyncCache: mocks.resetSyncCache,
  syncTuziSessionProviders: mocks.syncProviders,
  getLocalTuziSyncFailure: mocks.syncFailure,
}));

describe('prepareTuziManagedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEmbedded.mockReturnValue(false);
    mocks.localSession.mockReturnValue(false);
    mocks.syncFailure.mockReturnValue(undefined);
    mocks.selectedGroups.mockReturnValue(['default']);
    mocks.synchronizeProviders.mockResolvedValue(undefined);
    mocks.syncProviders.mockResolvedValue(true);
    mocks.requestAuthentication.mockResolvedValue(true);
  });

  it('verifies local managed routes without requesting an iframe parent', async () => {
    mocks.localSession.mockReturnValue(true);
    await expect(prepareTuziManagedRoute({ profileId: 'tuzi-managed-default', apiKey: 'test' })).resolves.toEqual({
      context: { environment: 'tuzi-api', status: 'ready', userId: '1', groups: [{ group: 'default', displayName: 'default' }] }, managedRoute: true, requiresSetup: false,
    });
    expect(mocks.syncProviders).toHaveBeenCalledWith({ discoverModels: false });
    expect(mocks.requestContext).not.toHaveBeenCalled();
    mocks.syncProviders.mockResolvedValue(false);
    expect((await prepareTuziManagedRoute({ profileId: 'tuzi-managed-default', apiKey: 'test' })).requiresSetup).toBe(true);
  });

  it('does not contact a parent for an ordinary configured provider', async () => {
    await expect(
      prepareTuziManagedRoute({ profileId: 'custom-openai', apiKey: 'sk-key' })
    ).resolves.toEqual({
      context: null,
      managedRoute: false,
      requiresSetup: false,
    });

    expect(mocks.requestContext).not.toHaveBeenCalled();
  });

  it('reports temporary local sync failures without requiring account setup', async () => {
    mocks.localSession.mockReturnValue(true);
    mocks.syncProviders.mockResolvedValue(false);
    mocks.syncFailure.mockReturnValue(new Error('network unavailable'));
    await expect(prepareTuziManagedRoute({ profileId: 'tuzi-managed-default', apiKey: 'test' }))
      .rejects.toThrow('network unavailable');
    expect(mocks.synchronizeProviders).not.toHaveBeenCalled();
  });

  it('requests parent authentication before the first provider is configured', async () => {
    mocks.requestContext
      .mockResolvedValueOnce({
        environment: 'tuzi-api',
        status: 'unauthenticated',
        userId: '',
        groups: [],
      })
      .mockResolvedValueOnce({
        environment: 'tuzi-api',
        status: 'need_system_token',
        userId: '42',
        groups: [],
      });

    await expect(
      prepareTuziManagedRoute({ profileId: 'custom-openai', apiKey: '' })
    ).resolves.toMatchObject({
      context: { status: 'need_system_token', userId: '42' },
      managedRoute: false,
    });

    expect(mocks.requestAuthentication).toHaveBeenCalledOnce();
    expect(mocks.requestContext).toHaveBeenNthCalledWith(1, {
      refresh: false,
    });
    expect(mocks.requestContext).toHaveBeenNthCalledWith(2, { refresh: true });
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
    ).resolves.toEqual({ context, managedRoute: true, requiresSetup: true });

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
  it('keeps manual credentials independent when the embedded account has no system token', async () => {
    mocks.isEmbedded.mockReturnValue(true);
    mocks.requestContext.mockResolvedValue({
      status: 'need_system_token',
      userId: '42',
      groups: [],
    });
    await expect(
      prepareTuziManagedRoute({ profileId: 'custom-openai', apiKey: 'old-key' })
    ).resolves.toMatchObject({ requiresSetup: false });
    expect(mocks.requestContext).not.toHaveBeenCalled();
    expect(mocks.syncProviders).not.toHaveBeenCalled();
  });
  it('keeps manual credentials after an embedded connection failure', async () => {
    mocks.isEmbedded.mockReturnValue(true);
    mocks.requestContext.mockResolvedValue(null);
    await expect(
      prepareTuziManagedRoute({ profileId: 'custom-openai', apiKey: 'old-key' })
    ).resolves.toMatchObject({ requiresSetup: false });
  });
  it('does not require account group setup for a manual key', async () => {
    mocks.isEmbedded.mockReturnValue(true);
    mocks.selectedGroups.mockReturnValue(null);
    mocks.requestContext.mockResolvedValue({
      status: 'ready',
      userId: '42',
      groups: [],
    });
    await expect(
      prepareTuziManagedRoute({ profileId: 'custom-openai', apiKey: 'old-key' })
    ).resolves.toMatchObject({ requiresSetup: false });
  });
});
