const STORAGE_KEY = 'opentu.tuzi.systemToken.v1';
const USER_ID_STORAGE_KEY = 'opentu.tuzi.systemUserId.v1';
const MAX_TOKEN_LENGTH = 4096;
let bridgeSystemToken = '';
let bridgeSystemUserId = '';
let bridgeCredentialsActive = false;

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
    return normalizeUserId(window.localStorage.getItem(USER_ID_STORAGE_KEY));
  } catch {
    return '';
  }
}

export function saveTuziSystemUserId(value: unknown): boolean {
  const id = normalizeUserId(value);
  if (!id || typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(USER_ID_STORAGE_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export function clearTuziSystemUserId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(USER_ID_STORAGE_KEY);
  } catch {
    // localStorage is optional in embedded environments.
  }
}

export function getTuziSystemToken(): string {
  if (typeof window === 'undefined') return '';
  if (bridgeCredentialsActive) return bridgeSystemToken;

  try {
    return normalizeToken(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
}

export function saveTuziSystemToken(token: string): boolean {
  const normalized = normalizeToken(token);
  if (!normalized || typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

export function clearTuziSystemToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
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
