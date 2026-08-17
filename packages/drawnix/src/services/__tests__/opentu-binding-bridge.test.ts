import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeOpenTuBindingBridge,
  requestOpenTuHostRecharge,
  type OpenTuBindingBridgeDependencies,
} from '../opentu-binding-bridge';
import type {
  P256PublicJwk,
  StoredOpenTuCredential,
} from '../opentu-credential';
import {
  OpenTuApiResponseError,
  type OpenTuAccount,
} from '../opentu-api-client';

const PARENT_ORIGIN = 'http://127.0.0.1:5173';
const CHANNEL = 'abcdefghijklmnopqrstuvwxyzABCDEF';
const PUBLIC_JWK: P256PublicJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'public-x',
  y: 'public-y',
};
const PRIVATE_KEY = { type: 'private' } as CryptoKey;

function credential(
  credentialId: string,
  userId: number
): StoredOpenTuCredential {
  return {
    credentialId,
    userId,
    refreshToken: `refresh-${credentialId}`,
    publicJwk: PUBLIC_JWK,
    jkt: `jkt-${credentialId}`,
    privateKey: PRIVATE_KEY,
    updatedAt: 1,
  };
}

function account(userId: number, credentialId: string): OpenTuAccount {
  return {
    id: userId,
    username: 'alice',
    display_name: 'Alice',
    email: 'alice@example.com',
    quota: 100,
    group: 'default',
    credential_id: credentialId,
  };
}

class BindingWindow extends EventTarget {
  readonly location = {
    search:
      `?opentu_bind=1&opentu_channel=${CHANNEL}` +
      `&opentu_parent_origin=${encodeURIComponent(PARENT_ORIGIN)}` +
      '&userId=999999',
  };
  readonly posts: Array<{ payload: Record<string, unknown>; target: string }> =
    [];
  readonly parent = {
    postMessage: (payload: Record<string, unknown>, target: string) => {
      this.posts.push({ payload, target });
      this.onPost?.(payload);
    },
  };
  onPost?: (payload: Record<string, unknown>) => void;
  readonly setTimeout = globalThis.setTimeout.bind(globalThis);
  readonly clearTimeout = globalThis.clearTimeout.bind(globalThis);

  dispatchParent(
    data: Record<string, unknown>,
    options: { origin?: string; source?: unknown } = {}
  ): void {
    const event = new Event('message');
    Object.defineProperties(event, {
      data: { value: data },
      origin: { value: options.origin ?? PARENT_ORIGIN },
      source: { value: options.source ?? this.parent },
    });
    this.dispatchEvent(event);
  }
}

function hostSession(userId: number): Record<string, unknown> {
  return {
    type: 'opentu.host.session',
    version: 1,
    channel: CHANNEL,
    userId,
  };
}

function installWindow(bindingWindow: BindingWindow): void {
  vi.stubGlobal('window', bindingWindow as unknown as Window);
}

function keyGenerator() {
  return Promise.resolve({
    privateKey: PRIVATE_KEY,
    publicJwk: PUBLIC_JWK,
    jkt: 'generated-jkt',
  });
}

describe('OpenTu binding host identity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reuses a matching user credential only after authoritative account verification', async () => {
    const bindingWindow = new BindingWindow();
    installWindow(bindingWindow);
    const existing = credential('credential-existing', 42);
    const activateForUser = vi.fn(async () => existing);
    const getAccount = vi.fn(async () => account(42, existing.credentialId));
    const bindDeviceGrant = vi.fn();
    const probe = vi.fn();
    bindingWindow.onPost = (message) => {
      if (message.type !== 'opentu.host.session.request') return;
      queueMicrotask(() => {
        bindingWindow.dispatchParent(hostSession(9), {
          origin: 'https://attacker.example',
        });
        bindingWindow.dispatchParent({ ...hostSession(9), channel: 'wrong' });
        bindingWindow.dispatchParent(hostSession(-1));
        bindingWindow.dispatchParent(hostSession(42));
      });
    };

    const result = await initializeOpenTuBindingBridge({
      client: {
        origin: PARENT_ORIGIN,
        clearSessionMemory: vi.fn(),
        getAccount,
        bindDeviceGrant,
      },
      vault: {
        activateForUser,
        probeNonExportableKeyPersistence: probe,
        remove: vi.fn(),
        setUserId: vi.fn(),
      },
      generateKeyMaterial: keyGenerator,
      timeoutMs: 100,
    });

    expect(activateForUser).toHaveBeenCalledWith(42);
    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(bindDeviceGrant).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(result).toEqual({
      handled: true,
      credentialId: existing.credentialId,
      userId: 42,
      reused: true,
    });
    expect(bindingWindow.posts.at(-1)?.payload).toMatchObject({
      type: 'opentu.device-bind.success',
      userId: 42,
      credentialId: existing.credentialId,
    });
  });

  it('removes a mismatched candidate, clears memory, and binds a verified credential', async () => {
    const bindingWindow = new BindingWindow();
    installWindow(bindingWindow);
    const existing = credential('credential-old', 42);
    const remove = vi.fn(async () => undefined);
    const setUserId = vi.fn(async () => credential('credential-new', 42));
    const clearSessionMemory = vi.fn();
    const getAccount = vi
      .fn()
      .mockResolvedValueOnce(account(42, 'credential-other'))
      .mockResolvedValueOnce(account(42, 'credential-new'));
    bindingWindow.onPost = (message) => {
      if (message.type === 'opentu.host.session.request') {
        queueMicrotask(() => bindingWindow.dispatchParent(hostSession(42)));
      }
      if (message.type === 'opentu.device-bind.request') {
        queueMicrotask(() => {
          bindingWindow.dispatchParent({
            type: 'opentu.device-bind.grant',
            version: 1,
            channel: CHANNEL,
            userId: 0,
            grantId: 'grant-invalid-user',
            deviceCode: 'device-code-invalid-user',
          });
          bindingWindow.dispatchParent({
            type: 'opentu.device-bind.grant',
            version: 1,
            channel: CHANNEL,
            userId: 42,
            grantId: 'grant-1',
            deviceCode: 'device-code-1',
          });
        });
      }
    };

    const dependencies: OpenTuBindingBridgeDependencies = {
      client: {
        origin: PARENT_ORIGIN,
        clearSessionMemory,
        getAccount,
        bindDeviceGrant: vi.fn(async () => ({
          accessToken: 'access-new',
          accessTokenExpiresAt: 2_000,
          refreshToken: 'refresh-new',
          credentialId: 'credential-new',
        })),
      },
      vault: {
        activateForUser: vi.fn(async () => existing),
        probeNonExportableKeyPersistence: vi.fn(async () => ({
          supported: true,
        })),
        remove,
        setUserId,
      },
      generateKeyMaterial: keyGenerator,
      timeoutMs: 100,
    };
    const result = await initializeOpenTuBindingBridge(dependencies);

    expect(remove).toHaveBeenCalledWith(existing.credentialId);
    expect(clearSessionMemory).toHaveBeenCalledTimes(2);
    expect(setUserId).toHaveBeenCalledWith('credential-new', 42);
    expect(result).toMatchObject({
      credentialId: 'credential-new',
      userId: 42,
      reused: false,
    });
  });

  it('deletes a newly exchanged credential when account identity does not match', async () => {
    const bindingWindow = new BindingWindow();
    installWindow(bindingWindow);
    const remove = vi.fn(async () => undefined);
    bindingWindow.onPost = (message) => {
      if (message.type === 'opentu.host.session.request') {
        queueMicrotask(() => bindingWindow.dispatchParent(hostSession(42)));
      }
      if (message.type === 'opentu.device-bind.request') {
        queueMicrotask(() => {
          bindingWindow.dispatchParent({
            type: 'opentu.device-bind.grant',
            version: 1,
            channel: CHANNEL,
            userId: 0,
            grantId: 'grant-invalid-user',
            deviceCode: 'device-code-invalid-user',
          });
          bindingWindow.dispatchParent({
            type: 'opentu.device-bind.grant',
            version: 1,
            channel: CHANNEL,
            userId: 42,
            grantId: 'grant-1',
            deviceCode: 'device-code-1',
          });
        });
      }
    };

    await expect(
      initializeOpenTuBindingBridge({
        client: {
          origin: PARENT_ORIGIN,
          clearSessionMemory: vi.fn(),
          getAccount: vi.fn(async () => account(99, 'credential-new')),
          bindDeviceGrant: vi.fn(async () => ({
            accessToken: 'access-new',
            accessTokenExpiresAt: 2_000,
            refreshToken: 'refresh-new',
            credentialId: 'credential-new',
          })),
        },
        vault: {
          activateForUser: vi.fn(async () => null),
          probeNonExportableKeyPersistence: vi.fn(async () => ({
            supported: true,
          })),
          remove,
          setUserId: vi.fn(),
        },
        generateKeyMaterial: keyGenerator,
        timeoutMs: 100,
      })
    ).rejects.toThrow('does not match');

    expect(remove).toHaveBeenCalledWith('credential-new');
    expect(
      bindingWindow.posts.some(
        ({ payload }) => payload.type === 'opentu.device-bind.success'
      )
    ).toBe(false);
    expect(bindingWindow.posts.at(-1)?.payload).toMatchObject({
      type: 'opentu.device-bind.error',
      code: 'binding_failed',
    });
  });

  it('preserves a reusable credential when account verification is temporarily unavailable', async () => {
    const bindingWindow = new BindingWindow();
    installWindow(bindingWindow);
    const existing = credential('credential-existing', 42);
    const remove = vi.fn(async () => undefined);
    const probe = vi.fn();
    bindingWindow.onPost = (message) => {
      if (message.type === 'opentu.host.session.request') {
        queueMicrotask(() => bindingWindow.dispatchParent(hostSession(42)));
      }
    };

    await expect(
      initializeOpenTuBindingBridge({
        client: {
          origin: PARENT_ORIGIN,
          clearSessionMemory: vi.fn(),
          getAccount: vi.fn(async () => {
            throw new OpenTuApiResponseError(
              'OpenTu account request failed',
              503
            );
          }),
          bindDeviceGrant: vi.fn(),
        },
        vault: {
          activateForUser: vi.fn(async () => existing),
          probeNonExportableKeyPersistence: probe,
          remove,
          setUserId: vi.fn(),
        },
        timeoutMs: 100,
      })
    ).rejects.toMatchObject({ status: 503 });

    expect(remove).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(bindingWindow.posts.at(-1)?.payload).toMatchObject({
      type: 'opentu.device-bind.error',
    });
  });

  it('rejects a grant for a different host user before exchanging it', async () => {
    const bindingWindow = new BindingWindow();
    installWindow(bindingWindow);
    const bindDeviceGrant = vi.fn();
    bindingWindow.onPost = (message) => {
      if (message.type === 'opentu.host.session.request') {
        queueMicrotask(() => bindingWindow.dispatchParent(hostSession(42)));
      }
      if (message.type === 'opentu.device-bind.request') {
        queueMicrotask(() => {
          bindingWindow.dispatchParent({
            type: 'opentu.device-bind.grant',
            version: 1,
            channel: CHANNEL,
            userId: 43,
            grantId: 'grant-other-user',
            deviceCode: 'device-code-other-user',
          });
        });
      }
    };

    await expect(
      initializeOpenTuBindingBridge({
        client: {
          origin: PARENT_ORIGIN,
          clearSessionMemory: vi.fn(),
          getAccount: vi.fn(),
          bindDeviceGrant,
        },
        vault: {
          activateForUser: vi.fn(async () => null),
          probeNonExportableKeyPersistence: vi.fn(async () => ({
            supported: true,
          })),
          remove: vi.fn(),
          setUserId: vi.fn(),
        },
        generateKeyMaterial: keyGenerator,
        timeoutMs: 100,
      })
    ).rejects.toThrow('does not match the host session');

    expect(bindDeviceGrant).not.toHaveBeenCalled();
    expect(bindingWindow.posts.at(-1)?.payload).toMatchObject({
      type: 'opentu.device-bind.error',
      code: 'binding_failed',
    });
  });
});

describe('OpenTu host navigation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a versioned, channel-bound top-up command to the configured parent', () => {
    const bindingWindow = new BindingWindow();
    installWindow(bindingWindow);

    expect(requestOpenTuHostRecharge()).toBe(true);
    expect(bindingWindow.posts.at(-1)).toEqual({
      payload: {
        type: 'opentu.host.navigate.request',
        version: 1,
        channel: CHANNEL,
        destination: 'topup',
      },
      target: PARENT_ORIGIN,
    });
  });
});
