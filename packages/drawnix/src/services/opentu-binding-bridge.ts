import {
  OpenTuCredentialVault,
  generateCredentialKeyMaterial,
  type StoredOpenTuCredential,
} from './opentu-credential';
import {
  getOpenTuApiClient,
  normalizeTuziDpopOrigin,
  OpenTuApiResponseError,
  type OpenTuAccount,
  type OpenTuApiClient,
} from './opentu-api-client';

const BINDING_VERSION = 1;
const HOST_SESSION_REQUEST = 'opentu.host.session.request';
const HOST_SESSION = 'opentu.host.session';
const HOST_NAVIGATE_REQUEST = 'opentu.host.navigate.request';
const BINDING_REQUEST = 'opentu.device-bind.request';
const BINDING_GRANT = 'opentu.device-bind.grant';
const BINDING_SUCCESS = 'opentu.device-bind.success';
const BINDING_ERROR = 'opentu.device-bind.error';
const BINDING_TIMEOUT_MS = 60_000;

class OpenTuAccountMismatchError extends Error {}

interface ParentMessage {
  type: string;
  version: typeof BINDING_VERSION;
  channel: string;
}

interface HostSessionMessage extends ParentMessage {
  type: typeof HOST_SESSION;
  userId: number;
}

interface BindingGrantMessage extends ParentMessage {
  type: typeof BINDING_GRANT;
  userId: number;
  grantId: string;
  deviceCode: string;
}

type BindingClient = Pick<
  OpenTuApiClient,
  'origin' | 'bindDeviceGrant' | 'getAccount' | 'clearSessionMemory'
>;

type BindingVault = Pick<
  OpenTuCredentialVault,
  | 'activateForUser'
  | 'probeNonExportableKeyPersistence'
  | 'remove'
  | 'setUserId'
>;

export interface OpenTuBindingBridgeDependencies {
  client?: BindingClient;
  vault?: BindingVault;
  generateKeyMaterial?: typeof generateCredentialKeyMaterial;
  timeoutMs?: number;
}

export interface OpenTuBindingBridgeResult {
  handled: boolean;
  credentialId?: string;
  userId?: number;
  reused?: boolean;
}

function readBindingContext(): {
  channel: string;
  parentOrigin: string;
} | null {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get('opentu_bind') !== '1') return null;
  const channel = parameters.get('opentu_channel')?.trim() || '';
  const parentOrigin = parameters.get('opentu_parent_origin')?.trim() || '';
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(channel)) {
    throw new Error('OpenTu binding channel is invalid');
  }
  return { channel, parentOrigin: normalizeTuziDpopOrigin(parentOrigin) };
}

function isTrustedParentMessage(
  event: MessageEvent<unknown>,
  parentOrigin: string,
  channel: string,
  expectedType: string
): event is MessageEvent<ParentMessage> {
  if (event.origin !== parentOrigin || event.source !== window.parent) {
    return false;
  }
  const data = event.data as Partial<ParentMessage> | null;
  return Boolean(
    data &&
      data.type === expectedType &&
      data.version === BINDING_VERSION &&
      data.channel === channel
  );
}

function waitForParentMessage<T extends ParentMessage>(
  parentOrigin: string,
  channel: string,
  expectedType: string,
  validate: (message: Partial<T>) => message is T,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      reject(new Error(`OpenTu ${expectedType} timed out`));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent<unknown>) => {
      const data = event.data as Partial<T>;
      if (
        !isTrustedParentMessage(event, parentOrigin, channel, expectedType) ||
        !validate(data)
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      resolve(data);
    };
    window.addEventListener('message', handleMessage);
  });
}

function waitForHostSession(
  parentOrigin: string,
  channel: string,
  timeoutMs: number
): Promise<HostSessionMessage> {
  return waitForParentMessage<HostSessionMessage>(
    parentOrigin,
    channel,
    HOST_SESSION,
    (message): message is HostSessionMessage =>
      Number.isSafeInteger(message.userId) && Number(message.userId) > 0,
    timeoutMs
  );
}

function waitForGrant(
  parentOrigin: string,
  channel: string,
  timeoutMs: number
): Promise<BindingGrantMessage> {
  return waitForParentMessage<BindingGrantMessage>(
    parentOrigin,
    channel,
    BINDING_GRANT,
    (message): message is BindingGrantMessage =>
      Number.isSafeInteger(message.userId) &&
      Number(message.userId) > 0 &&
      typeof message.grantId === 'string' &&
      typeof message.deviceCode === 'string' &&
      Boolean(message.grantId && message.deviceCode),
    timeoutMs
  );
}

function postToParent(
  parentOrigin: string,
  payload: Record<string, unknown>
): void {
  window.parent.postMessage(payload, parentOrigin);
}

export function requestOpenTuHostRecharge(): boolean {
  const context = readBindingContext();
  if (!context || window.parent === window) return false;

  postToParent(context.parentOrigin, {
    type: HOST_NAVIGATE_REQUEST,
    version: BINDING_VERSION,
    channel: context.channel,
    destination: 'topup',
  });
  return true;
}

function assertAccountMatches(
  account: OpenTuAccount,
  userId: number,
  credentialId: string
): void {
  if (
    !Number.isSafeInteger(account.id) ||
    account.id !== userId ||
    account.credential_id !== credentialId
  ) {
    throw new OpenTuAccountMismatchError(
      'OpenTu account does not match the host session'
    );
  }
}

function postBindingSuccess(
  parentOrigin: string,
  channel: string,
  userId: number,
  credentialId: string
): void {
  postToParent(parentOrigin, {
    type: BINDING_SUCCESS,
    version: BINDING_VERSION,
    channel,
    userId,
    credentialId,
  });
}

async function tryReuseCredential(
  client: BindingClient,
  vault: BindingVault,
  userId: number
): Promise<StoredOpenTuCredential | null> {
  client.clearSessionMemory();
  const credential = await vault.activateForUser(userId);
  if (!credential) return null;

  try {
    const account = await client.getAccount();
    assertAccountMatches(account, userId, credential.credentialId);
    return credential;
  } catch (error) {
    client.clearSessionMemory();
    if (
      error instanceof OpenTuAccountMismatchError ||
      (error instanceof OpenTuApiResponseError &&
        (error.status === 401 || error.status === 403))
    ) {
      await vault.remove(credential.credentialId);
      return null;
    }
    throw error;
  }
}

/** Runs only in the explicit Tuzi parent binding iframe mode. */
export async function initializeOpenTuBindingBridge(
  dependencies: OpenTuBindingBridgeDependencies = {}
): Promise<OpenTuBindingBridgeResult> {
  const context = readBindingContext();
  if (!context) return { handled: false };
  if (window.parent === window) {
    throw new Error('OpenTu binding requires a parent window');
  }

  const client = dependencies.client || getOpenTuApiClient();
  if (!client || client.origin !== context.parentOrigin) {
    throw new Error('OpenTu binding parent is not the configured Tuzi origin');
  }

  const vault = dependencies.vault || new OpenTuCredentialVault();
  const timeoutMs = dependencies.timeoutMs ?? BINDING_TIMEOUT_MS;
  let pendingCredentialId = '';
  try {
    const sessionPromise = waitForHostSession(
      context.parentOrigin,
      context.channel,
      timeoutMs
    );
    postToParent(context.parentOrigin, {
      type: HOST_SESSION_REQUEST,
      version: BINDING_VERSION,
      channel: context.channel,
    });
    const { userId } = await sessionPromise;

    const reused = await tryReuseCredential(client, vault, userId);
    if (reused) {
      postBindingSuccess(
        context.parentOrigin,
        context.channel,
        userId,
        reused.credentialId
      );
      return {
        handled: true,
        credentialId: reused.credentialId,
        userId,
        reused: true,
      };
    }

    const probe = await vault.probeNonExportableKeyPersistence();
    if (!probe.supported) {
      throw new Error('This browser cannot persist the OpenTu device key');
    }
    const generateKeyMaterial =
      dependencies.generateKeyMaterial || generateCredentialKeyMaterial;
    const keyMaterial = await generateKeyMaterial();
    const grantPromise = waitForGrant(
      context.parentOrigin,
      context.channel,
      timeoutMs
    );
    postToParent(context.parentOrigin, {
      type: BINDING_REQUEST,
      version: BINDING_VERSION,
      channel: context.channel,
      publicJwk: keyMaterial.publicJwk,
    });
    const grant = await grantPromise;
    if (grant.userId !== userId) {
      throw new OpenTuAccountMismatchError(
        'OpenTu device grant does not match the host session'
      );
    }
    const result = await client.bindDeviceGrant({
      grantId: grant.grantId,
      deviceCode: grant.deviceCode,
      publicJwk: keyMaterial.publicJwk,
      privateKey: keyMaterial.privateKey,
    });
    if (!result.credentialId) {
      throw new Error('Tuzi did not return an OpenTu credential ID');
    }
    pendingCredentialId = result.credentialId;
    const account = await client.getAccount();
    assertAccountMatches(account, userId, result.credentialId);
    await vault.setUserId(result.credentialId, userId);
    pendingCredentialId = '';

    postBindingSuccess(
      context.parentOrigin,
      context.channel,
      userId,
      result.credentialId
    );
    return {
      handled: true,
      credentialId: result.credentialId,
      userId,
      reused: false,
    };
  } catch (error) {
    client.clearSessionMemory();
    if (pendingCredentialId) {
      try {
        await vault.remove(pendingCredentialId);
      } catch {
        // Cleanup failure must not suppress the parent-visible binding failure.
      }
    }
    postToParent(context.parentOrigin, {
      type: BINDING_ERROR,
      version: BINDING_VERSION,
      channel: context.channel,
      code: 'binding_failed',
    });
    throw error;
  }
}
