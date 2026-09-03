const STORAGE_KEY = 'opentu.tuzi.systemToken.v1';
const USER_ID_STORAGE_KEY = 'opentu.tuzi.systemUserId.v1';
const MAX_TOKEN_LENGTH = 4096;

function normalizeToken(value: unknown): string {
  if (typeof value !== 'string') return '';
  const token = value.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : '';
}

function normalizeUserId(value: unknown): string {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id : '';
}

function getUrlParam(url: URL, names: string[]): string {
  for (const name of names) {
    const value = url.searchParams.get(name);
    if (value) return value;
  }
  return '';
}

function getRawUrlParam(href: string, names: string[]): string {
  const query = href.includes('?')
    ? href.slice(href.indexOf('?') + 1).split('#', 1)[0]
    : '';
  for (const pair of query.split('&')) {
    const separator = pair.indexOf('=');
    const rawName = separator === -1 ? pair : pair.slice(0, separator);
    let name: string;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, ' '));
    } catch {
      continue;
    }
    if (!names.includes(name)) continue;

    const rawValue = separator === -1 ? '' : pair.slice(separator + 1);
    try {
      // Keep literal '+' characters because system tokens commonly contain them.
      return decodeURIComponent(rawValue);
    } catch {
      return '';
    }
  }
  return '';
}

function parseHref(href: string): URL | null {
  try {
    return new URL(href, 'http://localhost');
  } catch {
    return null;
  }
}

export function getTuziSystemUserIdFromHref(href: string): string {
  const url = parseHref(href);
  return url ? normalizeUserId(getUrlParam(url, ['id', 'tuzi_user_id'])) : '';
}

export function getTuziSystemUserId(): string {
  if (typeof window === 'undefined') return '';
  const fromUrl = getTuziSystemUserIdFromHref(window.location.href);
  if (fromUrl) return fromUrl;

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

export function getTuziSystemTokenFromHref(href: string): string {
  const url = parseHref(href);
  return url
    ? normalizeToken(
        getRawUrlParam(href, [
          'token',
          'key',
          'tuzi_token',
          'tuzi_api_token',
        ]) || getUrlParam(url, ['token', 'key', 'tuzi_token', 'tuzi_api_token'])
      )
    : '';
}

export function getTuziSystemToken(): string {
  if (typeof window === 'undefined') return '';
  const fromUrl = getTuziSystemTokenFromHref(window.location.href);
  if (fromUrl) return fromUrl;

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

export function maskTuziSystemToken(token: string): string {
  const normalized = normalizeToken(token);
  if (!normalized) return '';
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}...`;
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

export function removeTuziSystemTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of [
    'id',
    'token',
    'tuzi_user_id',
    'key',
    'tuzi_token',
    'tuzi_api_token',
  ]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  try {
    window.history.replaceState(
      window.history.state,
      document.title,
      url.toString()
    );
  } catch {
    // URL cleanup is best effort.
  }
}

export function initializeTuziSystemTokenFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const userId = getTuziSystemUserIdFromHref(window.location.href);
  const token = getTuziSystemTokenFromHref(window.location.href);
  if (userId) saveTuziSystemUserId(userId);
  if (token) saveTuziSystemToken(token);
  if (userId || token) removeTuziSystemTokenFromUrl();
  return token;
}

if (typeof window !== 'undefined') {
  initializeTuziSystemTokenFromUrl();
}
