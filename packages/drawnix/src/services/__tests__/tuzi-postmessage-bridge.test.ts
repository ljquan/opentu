// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTuziSystemToken,
  verifyTuziProviders,
  getTuziBridgeMode,
  getTuziBridgeError,
  getTuziTokenManagementUrl,
  requestTuziParentAuthentication,
  requestTuziParentContext,
  resetTuziBridgeForTests,
} from '../tuzi-postmessage-bridge';
import { getTuziSystemToken } from '../tuzi-token-auth';
import { synchronizeTuziManagedProviders } from '../tuzi-managed-providers';

vi.mock('../tuzi-session-provider-sync', () => ({
  resetTuziSessionProviderSyncCache: vi.fn(),
}));
vi.mock('../tuzi-managed-providers', () => ({
  synchronizeTuziManagedProviders: vi.fn(async () => {}),
}));

const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
const originalReferrer = Object.getOwnPropertyDescriptor(document, 'referrer');

function installParent(
  reply: (request: Record<string, unknown>) => Record<string, unknown> | null,
  origin = 'https://api.tu-zi.com'
) {
  const parent = {
    postMessage(request: Record<string, unknown>) {
      const response = reply(request);
      if (!response) return;
      const event = new Event('message');
      Object.defineProperties(event, {
        source: { value: parent },
        origin: { value: origin },
        data: { value: response },
      });
      window.dispatchEvent(event);
    },
  };
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: parent,
  });
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    value: `${origin}/console/chat/2`,
  });
}

describe('Tuzi postMessage bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetTuziBridgeForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalParent) Object.defineProperty(window, 'parent', originalParent);
    if (originalReferrer) {
      Object.defineProperty(document, 'referrer', originalReferrer);
    }
  });

  it('accepts a validated Tuzi context and keeps its token in memory', async () => {
    installParent((request) => ({
      version: 1,
      type: 'TUZI_OPENTU_CONTEXT',
      requestId: request.requestId,
      payload: {
        environment: 'tuzi-api',
        status: 'ready',
        userId: '40832',
        systemToken: 'system-token',
        groups: [{ group: 'default', displayName: '默认分组' }],
      },
    }));

    const context = await requestTuziParentContext();

    expect(context?.status).toBe('ready');
    expect(getTuziBridgeMode()).toBe('tuzi');
    expect(getTuziSystemToken()).toBe('system-token');
    expect(
      window.localStorage.getItem('opentu.tuzi.systemToken.v1')
    ).toBeNull();
    expect(
      window.localStorage.getItem('opentu.tuzi.systemUserId.v1')
    ).toBeNull();
  });

  it('preserves managed profiles across reloads but clears them on an account switch', async () => {
    let userId = '40832';
    installParent((request) => ({
      version: 1,
      type: 'TUZI_OPENTU_CONTEXT',
      requestId: request.requestId,
      payload: {
        environment: 'tuzi-api',
        status: 'ready',
        userId,
        systemToken: 'system-token',
        groups: [],
      },
    }));
    await requestTuziParentContext();
    vi.mocked(synchronizeTuziManagedProviders).mockClear();
    resetTuziBridgeForTests();
    await requestTuziParentContext();
    expect(synchronizeTuziManagedProviders).not.toHaveBeenCalled();
    userId = '50001';
    resetTuziBridgeForTests();
    await requestTuziParentContext();
    expect(synchronizeTuziManagedProviders).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('bounds unsupported verification on the old parent bridge', async () => {
    installParent((request) =>
      request.type === 'TUZI_OPENTU_READY'
        ? {
            version: 1,
            type: 'TUZI_OPENTU_CONTEXT',
            requestId: request.requestId,
            payload: {
              environment: 'tuzi-api',
              status: 'ready',
              userId: '40832',
              systemToken: 'system-token',
              groups: [],
            },
          }
        : null
    );
    await requestTuziParentContext();
    const pending = expect(verifyTuziProviders([])).rejects.toThrow(
      'TUZI_PARENT_TIMEOUT'
    );
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
  });

  it('keeps a validated parent business error in Tuzi mode even on first contact', async () => {
    window.localStorage.setItem('opentu.tuzi.systemToken.v1', 'stale-token');
    installParent((request) => ({
      version: 1,
      type: 'TUZI_OPENTU_ERROR',
      requestId: request.requestId,
      payload: { message: 'Temporarily unavailable' },
    }));
    expect(await requestTuziParentContext()).toBeNull();
    expect(getTuziBridgeMode()).toBe('tuzi');
    expect(getTuziBridgeError()).toBeTruthy();
    expect(getTuziSystemToken()).toBe('');
  });

  it('opens ordinary token management on the verified LAN parent', async () => {
    installParent(
      (request) => ({
        version: 1,
        type: 'TUZI_OPENTU_CONTEXT',
        requestId: request.requestId,
        payload: {
          environment: 'tuzi-api',
          status: 'need_system_token',
          userId: '42',
        },
      }),
      'http://192.168.50.207:3200'
    );
    await requestTuziParentContext();
    expect(getTuziTokenManagementUrl()).toBe(
      'http://192.168.50.207:3200/console/token'
    );
  });

  it('rejects verification returned for a different account', async () => {
    installParent((request) => ({
      version: 1,
      requestId: request.requestId,
      type:
        request.type === 'TUZI_OPENTU_READY'
          ? 'TUZI_OPENTU_CONTEXT'
          : 'TUZI_PROVIDERS_VERIFIED',
      payload:
        request.type === 'TUZI_OPENTU_READY'
          ? {
              environment: 'tuzi-api',
              status: 'ready',
              userId: '40832',
              systemToken: 'system-token',
              groups: [],
            }
          : { environment: 'tuzi-api', userId: '999', providers: [] },
    }));
    await requestTuziParentContext();
    await expect(
      verifyTuziProviders([{ id: 'provider', fingerprint: 'a'.repeat(64) }])
    ).rejects.toThrow('账户已变化');
  });

  it('creates a system token only after an explicit missing-token context', async () => {
    window.localStorage.setItem('opentu.tuzi.systemToken.v1', 'stale-token');
    installParent((request) => {
      if (request.type === 'TUZI_OPENTU_READY') {
        return {
          version: 1,
          type: 'TUZI_OPENTU_CONTEXT',
          requestId: request.requestId,
          payload: {
            environment: 'tuzi-api',
            status: 'need_system_token',
            userId: '40832',
            groups: [{ group: 'default', displayName: '默认分组' }],
          },
        };
      }
      return {
        version: 1,
        type: 'TUZI_SYSTEM_TOKEN_CREATED',
        requestId: request.requestId,
        payload: {
          environment: 'tuzi-api',
          userId: '40832',
          systemToken: 'created-token',
          groups: [{ group: 'default', displayName: '默认分组' }],
        },
      };
    });

    expect((await requestTuziParentContext())?.status).toBe(
      'need_system_token'
    );
    expect(getTuziSystemToken()).toBe('');
    expect((await createTuziSystemToken()).systemToken).toBe('created-token');
    expect(window.localStorage.getItem('opentu.tuzi.systemToken.v1')).toBe(
      'stale-token'
    );
    expect(
      window.localStorage.getItem('opentu.tuzi.systemUserId.v1')
    ).toBeNull();
  });

  it('requests Tuzi authentication only after an unauthenticated context', async () => {
    let authenticated = false;
    installParent((request) => {
      if (request.type === 'TUZI_AUTH_REQUIRED') {
        authenticated = true;
        return {
          version: 1,
          type: 'TUZI_AUTH_COMPLETED',
          requestId: request.requestId,
          payload: { environment: 'tuzi-api' },
        };
      }
      return {
        version: 1,
        type: 'TUZI_OPENTU_CONTEXT',
        requestId: request.requestId,
        payload: authenticated
          ? {
              environment: 'tuzi-api',
              status: 'need_system_token',
              userId: '50001',
              groups: [{ group: 'default', displayName: '默认分组' }],
            }
          : {
              environment: 'tuzi-api',
              status: 'unauthenticated',
              userId: '',
              groups: [],
            },
      };
    });

    await expect(requestTuziParentContext()).resolves.toMatchObject({
      status: 'unauthenticated',
      userId: '',
    });
    await expect(requestTuziParentAuthentication()).resolves.toBe(true);
    expect(getTuziSystemToken()).toBe('');
    await expect(requestTuziParentContext()).resolves.toMatchObject({
      status: 'need_system_token',
      userId: '50001',
    });
  });

  it('retries the read-only handshake when the parent listener mounts late', async () => {
    let readyRequests = 0;
    installParent((request) => {
      readyRequests += 1;
      if (readyRequests === 1) return null;
      return {
        version: 1,
        type: 'TUZI_OPENTU_CONTEXT',
        requestId: request.requestId,
        payload: {
          environment: 'tuzi-api',
          status: 'need_system_token',
          userId: '40832',
          groups: [{ group: 'default', displayName: '默认分组' }],
        },
      };
    });

    const contextPromise = requestTuziParentContext();
    expect(readyRequests).toBe(1);

    await vi.advanceTimersByTimeAsync(250);

    await expect(contextPromise).resolves.toMatchObject({
      status: 'need_system_token',
      userId: '40832',
    });
    expect(readyRequests).toBe(2);
    expect(getTuziBridgeMode()).toBe('tuzi');
  });

  it('refreshes a cached Tuzi context before a managed request is reused', async () => {
    let userId = '40832';
    installParent((request) => ({
      version: 1,
      type: 'TUZI_OPENTU_CONTEXT',
      requestId: request.requestId,
      payload: {
        environment: 'tuzi-api',
        status: userId === '40832' ? 'ready' : 'need_system_token',
        userId,
        ...(userId === '40832' ? { systemToken: 'first-token' } : {}),
        groups: [],
      },
    }));

    await expect(requestTuziParentContext()).resolves.toMatchObject({
      userId: '40832',
      status: 'ready',
    });
    userId = '50001';
    await expect(
      requestTuziParentContext({ refresh: true })
    ).resolves.toMatchObject({ userId: '50001', status: 'need_system_token' });
    expect(getTuziSystemToken()).toBe('');
  });

  it('falls back to standalone after ten seconds without a valid response', async () => {
    installParent(() => null);
    const contextPromise = requestTuziParentContext();

    await vi.advanceTimersByTimeAsync(10_000);

    await expect(contextPromise).resolves.toBeNull();
    expect(getTuziBridgeMode()).toBe('standalone');
    expect(window.localStorage.length).toBe(0);
  });
  it.each(['error', 'timeout'])(
    'keeps verified Tuzi mode when refreshing fails: %s',
    async (failure) => {
      let fail = false;
      installParent((request) => {
        if (fail && failure === 'timeout') return null;
        return {
          version: 1,
          type: fail ? 'TUZI_OPENTU_ERROR' : 'TUZI_OPENTU_CONTEXT',
          requestId: request.requestId,
          payload: fail
            ? { code: 'REQUEST_FAILED' }
            : {
                environment: 'tuzi-api',
                status: 'ready',
                userId: '40832',
                systemToken: 'system-token',
                groups: [],
              },
        };
      });
      await requestTuziParentContext();
      expect(getTuziTokenManagementUrl()).toBe(
        'https://api.tu-zi.com/console/token'
      );
      window.localStorage.setItem(
        'opentu.tuzi.systemToken.v1',
        'stale-local-token'
      );
      fail = true;
      const pending = requestTuziParentContext({ refresh: true });
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toBeNull();
      expect(getTuziBridgeMode()).toBe('tuzi');
      expect(getTuziBridgeError()).toBeTruthy();
      expect(getTuziSystemToken()).toBe('');
      fail = false;
      await expect(requestTuziParentContext()).resolves.toMatchObject({
        status: 'ready',
      });
      expect(getTuziBridgeError()).toBeNull();
    }
  );
});
