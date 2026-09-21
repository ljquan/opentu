// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTuziSystemToken,
  getTuziBridgeMode,
  requestTuziParentContext,
  resetTuziBridgeForTests,
} from '../tuzi-postmessage-bridge';
import { getTuziSystemToken } from '../tuzi-token-auth';

const originalParent = Object.getOwnPropertyDescriptor(window, 'parent');
const originalReferrer = Object.getOwnPropertyDescriptor(document, 'referrer');

function installParent(
  reply: (request: Record<string, unknown>) => Record<string, unknown> | null
) {
  const parent = {
    postMessage(request: Record<string, unknown>) {
      const response = reply(request);
      if (!response) return;
      const event = new Event('message');
      Object.defineProperties(event, {
        source: { value: parent },
        origin: { value: 'https://api.tu-zi.com' },
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
    value: 'https://api.tu-zi.com/console/chat/2',
  });
}

describe('Tuzi postMessage bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
