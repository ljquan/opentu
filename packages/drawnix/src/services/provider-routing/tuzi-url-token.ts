const TUZI_URL_TOKEN_PARAM = 'tuzi_api_key';
const TUZI_TOKEN_PREFIX = 'sk-';

function readTokenFromParams(params: URLSearchParams): string {
  const explicitToken = params.get(TUZI_URL_TOKEN_PARAM)?.trim() || '';
  if (explicitToken.startsWith(TUZI_TOKEN_PREFIX)) {
    return explicitToken;
  }

  return '';
}

function parseUrl(href: string): URL | null {
  try {
    return new URL(href, 'http://localhost');
  } catch {
    return null;
  }
}

/**
 * Reads the temporary Tuzi integration token without persisting it.
 * The URL is intentionally the source of truth for the development bridge.
 */
export function getTuziUrlApiKeyFromHref(href: string): string {
  const url = parseUrl(href);
  if (!url) {
    return '';
  }

  const searchToken = readTokenFromParams(url.searchParams);
  if (searchToken) {
    return searchToken;
  }

  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (!hash) {
    return '';
  }

  try {
    return readTokenFromParams(new URLSearchParams(hash));
  } catch {
    return '';
  }
}

export function getTuziUrlApiKey(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return getTuziUrlApiKeyFromHref(window.location.href);
}

/**
 * URL-token mode must not use the Service Worker: SW configuration is backed
 * by IndexedDB and cannot safely read a URL-only credential.
 */
export function isTuziUrlTokenMode(href?: string): boolean {
  const resolvedHref =
    href || (typeof window !== 'undefined' ? window.location.href : '');
  return Boolean(getTuziUrlApiKeyFromHref(resolvedHref));
}
