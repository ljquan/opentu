import {
  clearTuziBridgeCredentials,
  setTuziBridgeCredentials,
} from './tuzi-token-auth';

export const TUZI_BRIDGE_EVENT = 'opentu:tuzi-bridge-status';
export const TUZI_MESSAGE_VERSION = 1;
export const TUZI_HANDSHAKE_TIMEOUT_MS = 10_000;
const TUZI_REQUEST_TIMEOUT_MS = 30_000;
const TUZI_HANDSHAKE_RETRY_MS = 250;

export interface TuziBridgeGroup {
  group: string;
  displayName: string;
}

export interface TuziBridgeContext {
  environment: 'tuzi-api';
  status: 'ready' | 'need_system_token' | 'unauthenticated';
  userId: string;
  systemToken?: string;
  groups: TuziBridgeGroup[];
  selectedGroup?: string;
}

export interface TuziBridgeProvider {
  id: string;
  group: string;
  displayName: string;
  apiKey: string;
  status: number;
  rotatedAt: number;
}

type BridgeMode = 'unknown' | 'tuzi' | 'standalone';
type MessagePayload = Record<string, unknown>;

let mode: BridgeMode = 'unknown';
let context: TuziBridgeContext | null = null;
let parentOrigin: string | null = null;
let contextRequest: Promise<TuziBridgeContext | null> | null = null;

async function clearManagedProvidersForAccountBoundary(): Promise<void> {
  const { synchronizeTuziManagedProviders } = await import(
    './tuzi-managed-providers'
  );
  await synchronizeTuziManagedProviders([]);
}

function normalizeOrigin(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function resolveParentOrigin(): string | null {
  if (typeof window === 'undefined' || window.parent === window) return null;
  const configured = normalizeOrigin(import.meta.env.VITE_TUZI_PARENT_ORIGIN);
  const referrer = normalizeOrigin(
    typeof document === 'undefined' ? '' : document.referrer
  );
  if (configured && referrer && configured !== referrer) return null;
  return configured || referrer;
}

function randomRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tuzi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function notify(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(TUZI_BRIDGE_EVENT, { detail: { mode, context } })
  );
}

function normalizeGroups(value: unknown): TuziBridgeGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const group = String(record.group || '').trim();
    if (!group) return [];
    return [
      {
        group,
        displayName:
          String(record.displayName || record.display_name || '').trim() ||
          group,
      },
    ];
  });
}

function acceptContext(payload: MessagePayload): TuziBridgeContext | null {
  if (payload.environment !== 'tuzi-api') return null;
  const status = payload.status;
  const userId = String(payload.userId || '').trim();
  const systemToken = String(payload.systemToken || '').trim();
  if (status === 'unauthenticated') {
    if (userId || systemToken) return null;
    return {
      environment: 'tuzi-api',
      status,
      userId: '',
      groups: normalizeGroups(payload.groups),
    };
  }
  if (
    (status !== 'ready' && status !== 'need_system_token') ||
    !/^\d+$/.test(userId) ||
    (status === 'ready' && !systemToken) ||
    (status === 'need_system_token' && systemToken)
  ) {
    return null;
  }
  return {
    environment: 'tuzi-api',
    status,
    userId,
    ...(systemToken ? { systemToken } : {}),
    groups: normalizeGroups(payload.groups),
    selectedGroup: String(payload.selectedGroup || '').trim() || undefined,
  };
}

function requestParent(
  type: string,
  payload: MessagePayload,
  expectedType: string,
  timeoutMs: number,
  retryIntervalMs = 0
): Promise<MessagePayload> {
  const targetOrigin = parentOrigin || resolveParentOrigin();
  if (
    !targetOrigin ||
    typeof window === 'undefined' ||
    window.parent === window
  ) {
    return Promise.reject(new Error('TUZI_PARENT_UNAVAILABLE'));
  }
  parentOrigin = targetOrigin;
  const requestId = randomRequestId();

  return new Promise((resolve, reject) => {
    let retryTimer: number | undefined;
    const cleanup = () => {
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearInterval(retryTimer);
      window.removeEventListener('message', handleMessage);
    };
    const handleMessage = (event: MessageEvent) => {
      const response = event.data;
      if (
        event.source !== window.parent ||
        event.origin !== targetOrigin ||
        !response ||
        typeof response !== 'object' ||
        response.version !== TUZI_MESSAGE_VERSION ||
        response.requestId !== requestId
      ) {
        return;
      }
      if (
        response.type !== expectedType &&
        response.type !== 'TUZI_OPENTU_ERROR'
      ) {
        return;
      }
      cleanup();
      if (response.type === 'TUZI_OPENTU_ERROR') {
        const errorPayload = response.payload || {};
        reject(
          new Error(
            String(errorPayload.message || errorPayload.code || 'Tuzi 请求失败')
          )
        );
        return;
      }
      resolve((response.payload || {}) as MessagePayload);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('TUZI_PARENT_TIMEOUT'));
    }, timeoutMs);
    window.addEventListener('message', handleMessage);
    const send = () => {
      window.parent.postMessage(
        { version: TUZI_MESSAGE_VERSION, type, requestId, payload },
        targetOrigin
      );
    };
    if (retryIntervalMs > 0) {
      retryTimer = window.setInterval(send, retryIntervalMs);
    }
    send();
  });
}

export async function requestTuziParentContext(options?: {
  refresh?: boolean;
}): Promise<TuziBridgeContext | null> {
  if (!options?.refresh && mode === 'tuzi') return context;
  if (!options?.refresh && mode === 'standalone') return null;
  if (contextRequest) return contextRequest;

  contextRequest = requestParent(
    'TUZI_OPENTU_READY',
    {},
    'TUZI_OPENTU_CONTEXT',
    TUZI_HANDSHAKE_TIMEOUT_MS,
    TUZI_HANDSHAKE_RETRY_MS
  )
    .then(async (payload) => {
      const nextContext = acceptContext(payload);
      if (!nextContext) throw new Error('TUZI_PARENT_INVALID_CONTEXT');
      const previousUserId = context?.userId || '';
      if (
        previousUserId !== nextContext.userId ||
        nextContext.status !== 'ready'
      ) {
        await clearManagedProvidersForAccountBoundary();
      }
      context = nextContext;
      mode = 'tuzi';
      setTuziBridgeCredentials(
        nextContext.userId,
        nextContext.systemToken || ''
      );
      notify();
      return nextContext;
    })
    .catch(() => {
      mode = 'standalone';
      context = null;
      clearTuziBridgeCredentials();
      notify();
      return null;
    })
    .finally(() => {
      contextRequest = null;
    });
  return contextRequest;
}

export async function requestTuziParentAuthentication(): Promise<boolean> {
  if (mode !== 'tuzi' || context?.status !== 'unauthenticated') {
    return context?.status === 'ready' || context?.status === 'need_system_token';
  }
  try {
    await requestParent(
      'TUZI_AUTH_REQUIRED',
      {},
      'TUZI_AUTH_COMPLETED',
      TUZI_REQUEST_TIMEOUT_MS * 4,
    );
    const nextContext = await requestTuziParentContext({ refresh: true });
    return (
      nextContext?.status === 'ready' ||
      nextContext?.status === 'need_system_token'
    );
  } catch {
    return false;
  }
}

export async function createTuziSystemToken(): Promise<TuziBridgeContext> {
  if (mode !== 'tuzi' || context?.status !== 'need_system_token') {
    throw new Error('当前不是可创建系统令牌的 Tuzi 环境');
  }
  const payload = await requestParent(
    'TUZI_CREATE_SYSTEM_TOKEN',
    {},
    'TUZI_SYSTEM_TOKEN_CREATED',
    TUZI_REQUEST_TIMEOUT_MS
  );
  const nextContext = acceptContext({ ...payload, status: 'ready' });
  if (!nextContext) throw new Error('系统令牌创建响应无效');
  context = nextContext;
  setTuziBridgeCredentials(nextContext.userId, nextContext.systemToken || '');
  notify();
  return nextContext;
}

export async function ensureTuziProviders(
  groups: readonly string[]
): Promise<TuziBridgeProvider[]> {
  if (mode !== 'tuzi') throw new Error('当前不是 Tuzi 嵌入环境');
  const payload = await requestParent(
    'TUZI_ENSURE_PROVIDERS',
    {
      groups: [...new Set(groups.map((group) => group.trim()).filter(Boolean))],
    },
    'TUZI_PROVIDERS_READY',
    TUZI_REQUEST_TIMEOUT_MS
  );
  if (payload.environment !== 'tuzi-api' || !Array.isArray(payload.providers)) {
    throw new Error('Provider 创建响应无效');
  }
  return payload.providers.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const provider = item as Record<string, unknown>;
    const id = String(provider.id || '').trim();
    const group = String(provider.group || '').trim();
    const apiKey = String(provider.apiKey || provider.api_key || '').trim();
    if (!id || !group || !apiKey) return [];
    return [
      {
        id,
        group,
        apiKey,
        displayName:
          String(provider.displayName || provider.display_name || '').trim() ||
          group,
        status: Number(provider.status) || 0,
        rotatedAt: Number(provider.rotatedAt || provider.rotated_at) || 0,
      },
    ];
  });
}

export function isTuziBridgeConnected(): boolean {
  return mode === 'tuzi';
}

export function getTuziBridgeContext(): TuziBridgeContext | null {
  return context;
}

export function getTuziBridgeMode(): BridgeMode {
  return mode;
}

export function resetTuziBridgeForTests(): void {
  mode = 'unknown';
  context = null;
  parentOrigin = null;
  contextRequest = null;
  clearTuziBridgeCredentials();
}
