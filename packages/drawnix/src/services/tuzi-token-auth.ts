const STORAGE_KEY = 'opentu.tuzi.systemToken.v1';
const USER_ID_STORAGE_KEY = 'opentu.tuzi.systemUserId.v1';
const MAX_TOKEN_LENGTH = 4096;
const LOCAL_SESSION_KEY = 'opentu.tuzi.localSession.v1';
const LOCAL_SESSION_TOKEN_KEY = 'opentu.tuzi.localToken.v1';
const LOCAL_SESSION_USER_KEY = 'opentu.tuzi.localUser.v1';
let bridgeSystemToken = '';
let bridgeSystemUserId = '';
let bridgeCredentialsActive = false;

function isLocalStandalonePage(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.parent === window &&
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname)
  );
}

export function isLocalTuziSession(): boolean {
  if (!isLocalStandalonePage()) return false;
  try {
    return (
      window.sessionStorage.getItem(LOCAL_SESSION_KEY) === getTuziSystemUserId() &&
      Boolean(getTuziSystemUserId() && getTuziSystemToken())
    );
  } catch {
    return false;
  }
}

export function importLocalTuziCredentials(): boolean {
  if (!isLocalStandalonePage()) return false;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return isLocalTuziSession();
  const token = normalizeToken(url.searchParams.get('token'));
  const userId = normalizeUserId(url.searchParams.get('id'));
  // Keep credentials out of subsequent navigation and request referrers.
  url.searchParams.delete('token');
  url.searchParams.delete('id');
  window.history.replaceState(window.history.state, '', url);
  if (!token || !userId) return false;
  try {
    const previousToken = window.localStorage.getItem(STORAGE_KEY);
    const previousId = window.localStorage.getItem(USER_ID_STORAGE_KEY);
    const previousSession = window.sessionStorage.getItem(LOCAL_SESSION_KEY);
    const previousSessionToken = window.sessionStorage.getItem(LOCAL_SESSION_TOKEN_KEY);
    const previousSessionUser = window.sessionStorage.getItem(LOCAL_SESSION_USER_KEY);
    try {
      window.localStorage.setItem(STORAGE_KEY, token);
      window.localStorage.setItem(USER_ID_STORAGE_KEY, userId);
      window.sessionStorage.setItem(LOCAL_SESSION_KEY, userId);
      window.sessionStorage.setItem(LOCAL_SESSION_TOKEN_KEY, token);
      window.sessionStorage.setItem(LOCAL_SESSION_USER_KEY, userId);
    } catch {
      const previous: Array<[string, string | null]> = [
        [STORAGE_KEY, previousToken],
        [USER_ID_STORAGE_KEY, previousId],
      ];
      for (const [key, value] of previous) {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      }
      if (previousSession === null) window.sessionStorage.removeItem(LOCAL_SESSION_KEY);
      else window.sessionStorage.setItem(LOCAL_SESSION_KEY, previousSession);
      for (const [key, value] of [[LOCAL_SESSION_TOKEN_KEY, previousSessionToken], [LOCAL_SESSION_USER_KEY, previousSessionUser]]) {
        if (value === null) window.sessionStorage.removeItem(key!);
        else window.sessionStorage.setItem(key!, value!);
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeToken(value: unknown): string {
  if (typeof value !== 'string') return '';
  const token = value.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : '';
}

function normalizeUserId(value: unknown): string {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id : '';
}

export function getTuziSystemUserId(): string {
  if (typeof window === 'undefined') return '';
  if (bridgeCredentialsActive) return bridgeSystemUserId;

  try {
    return normalizeUserId(window.sessionStorage.getItem(LOCAL_SESSION_USER_KEY) || window.localStorage.getItem(USER_ID_STORAGE_KEY));
  } catch {
    return '';
  }
}

export function saveTuziSystemUserId(value: unknown): boolean {
  const id = normalizeUserId(value);
  if (!id || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(USER_ID_STORAGE_KEY, id);
    if (isLocalStandalonePage() && window.sessionStorage.getItem(LOCAL_SESSION_KEY)) {
      window.sessionStorage.setItem(LOCAL_SESSION_USER_KEY, id);
      window.sessionStorage.setItem(LOCAL_SESSION_KEY, id);
    }
    return true;
  } catch {
    return false;
  }
}

export function clearTuziSystemUserId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(USER_ID_STORAGE_KEY);
    window.sessionStorage.removeItem(LOCAL_SESSION_USER_KEY);
    window.sessionStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    // localStorage is optional in embedded environments.
  }
}

export function getTuziSystemToken(): string {
  if (typeof window === 'undefined') return '';
  if (bridgeCredentialsActive) return bridgeSystemToken;

  try {
    return normalizeToken(window.sessionStorage.getItem(LOCAL_SESSION_TOKEN_KEY) || window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
}

export function saveTuziSystemToken(token: string): boolean {
  const normalized = normalizeToken(token);
  if (!normalized || typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
    if (isLocalStandalonePage() && window.sessionStorage.getItem(LOCAL_SESSION_KEY)) {
      window.sessionStorage.setItem(LOCAL_SESSION_TOKEN_KEY, normalized);
    }
    return true;
  } catch {
    return false;
  }
}

export function clearTuziSystemToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(LOCAL_SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    // localStorage is optional in embedded environments.
  }
}

export function hasTuziSystemToken(): boolean {
  return Boolean(getTuziSystemToken());
}

export function setTuziBridgeCredentials(
  userId: unknown,
  systemToken: unknown
): void {
  bridgeCredentialsActive = true;
  bridgeSystemUserId = normalizeUserId(userId);
  bridgeSystemToken = normalizeToken(systemToken);
}

export function clearTuziBridgeCredentials(): void {
  bridgeCredentialsActive = false;
  bridgeSystemUserId = '';
  bridgeSystemToken = '';
}

export function maskTuziSystemToken(token: string): string {
  const normalized = normalizeToken(token);
  if (!normalized) return '';
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}...`;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}
