import { saveTuziProviderGroupSelection } from './tuzi-provider-selection';

const STORAGE_KEY = 'opentu.tuzi.systemToken.v1';
const USER_ID_STORAGE_KEY = 'opentu.tuzi.systemUserId.v1';
const AUTH_FRAGMENT_PARAM = 'opentu_auth';
const MAX_TOKEN_LENGTH = 4096;
const MAX_GROUP_LENGTH = 128;
const MAX_RESTORED_HASH_LENGTH = 2048;
let tuziCredentialsProvidedByUrl = false;
let tuziProviderGroupProvidedByUrl = '';

type TuziAuthFragment = {
  id?: unknown;
  token?: unknown;
  group?: unknown;
  hash?: unknown;
};

function normalizeToken(value: unknown): string {
  if (typeof value !== 'string') return '';
  const token = value.replace(/[\s\u200B-\u200D\uFEFF]/g, '');
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : '';
}

function normalizeUserId(value: unknown): string {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id : '';
}

function normalizeGroup(value: unknown): string {
  if (typeof value !== 'string') return '';
  const group = value.trim();
  return group.length > 0 && group.length <= MAX_GROUP_LENGTH ? group : '';
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

function getAuthFragment(url: URL): TuziAuthFragment | null {
  if (!url.hash) return null;
  const rawPayload = new URLSearchParams(url.hash.slice(1)).get(
    AUTH_FRAGMENT_PARAM
  );
  if (!rawPayload) return null;
  try {
    const payload = JSON.parse(rawPayload);
    return payload && typeof payload === 'object'
      ? (payload as TuziAuthFragment)
      : null;
  } catch {
    return null;
  }
}

export function getTuziSystemUserIdFromHref(href: string): string {
  const url = parseHref(href);
  if (!url) return '';
  const fragmentValue = normalizeUserId(getAuthFragment(url)?.id);
  return fragmentValue || normalizeUserId(getUrlParam(url, ['id', 'tuzi_user_id']));
}

export function getTuziProviderGroupFromHref(href: string): string {
  const url = parseHref(href);
  if (!url) return '';
  const fragmentValue = normalizeGroup(getAuthFragment(url)?.group);
  return fragmentValue || normalizeGroup(getUrlParam(url, ['group', 'tuzi_group']));
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
  if (!url) return '';
  const fragmentValue = normalizeToken(getAuthFragment(url)?.token);
  return (
    fragmentValue ||
    normalizeToken(
      getRawUrlParam(href, [
        'token',
        'key',
        'tuzi_token',
        'tuzi_api_token',
      ]) || getUrlParam(url, ['token', 'key', 'tuzi_token', 'tuzi_api_token'])
    )
  );
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
    'group',
    'tuzi_group',
  ]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  const fragmentParams = new URLSearchParams(url.hash.slice(1));
  if (fragmentParams.has(AUTH_FRAGMENT_PARAM)) {
    const restoredHash = getAuthFragment(url)?.hash;
    if (
      typeof restoredHash === 'string' &&
      restoredHash.length <= MAX_RESTORED_HASH_LENGTH
    ) {
      url.hash = restoredHash ? `#${restoredHash}` : '';
    } else {
      fragmentParams.delete(AUTH_FRAGMENT_PARAM);
      const remainingFragment = fragmentParams.toString();
      url.hash = remainingFragment ? `#${remainingFragment}` : '';
    }
    changed = true;
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
  const group = getTuziProviderGroupFromHref(window.location.href);
  if (userId || token) {
    tuziCredentialsProvidedByUrl = true;
  }
  if (userId) saveTuziSystemUserId(userId);
  if (token) saveTuziSystemToken(token);
  if (userId && token && group) {
    saveTuziProviderGroupSelection(userId, [group]);
    tuziProviderGroupProvidedByUrl = group;
  }
  if (userId || token || group) removeTuziSystemTokenFromUrl();
  return token;
}

export function wasTuziCredentialsProvidedByUrl(): boolean {
  return tuziCredentialsProvidedByUrl;
}

export function consumeTuziProviderGroupFromUrl(): string {
  const group = tuziProviderGroupProvidedByUrl;
  tuziProviderGroupProvidedByUrl = '';
  return group;
}

if (typeof window !== 'undefined') {
  initializeTuziSystemTokenFromUrl();
}
