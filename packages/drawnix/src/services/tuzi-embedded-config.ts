export interface TuziEmbeddedConfig {
  enabled: boolean;
  apiBaseUrl: string | null;
  parentOrigin: string | null;
}

const DEFAULT_TUZI_API_BASE_URL = 'https://api.tu-zi.com';

function parseEnabled(value: unknown): boolean {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() !== 'false'
  );
}

function normalizeHttpOrigin(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  );
}

function isLocalHostname(hostname: string): boolean {
  if (isLoopbackHostname(hostname)) return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function followLocalPageHostname(
  configuredOrigin: string | null,
  pageOrigin: string | null
): string | null {
  if (!configuredOrigin || !pageOrigin) return configuredOrigin;

  const configured = new URL(configuredOrigin);
  const page = new URL(pageOrigin);
  // A localhost dev page may still be calling a Tuzi API on a LAN host.
  if (isLoopbackHostname(page.hostname)) return configuredOrigin;
  if (
    !isLocalHostname(configured.hostname) ||
    !isLocalHostname(page.hostname)
  ) {
    return configuredOrigin;
  }

  configured.hostname = page.hostname;
  return configured.toString().replace(/\/+$/, '');
}

export function readTuziEmbeddedConfig(
  env: Record<string, unknown> = import.meta.env,
  pageOrigin: string | null = typeof window === 'undefined'
    ? null
    : window.location.origin
): TuziEmbeddedConfig {
  const requested = parseEnabled(env.VITE_TUZI_EMBEDDED_MODE);
  const configuredApiBaseUrl =
    env.VITE_TUZI_API_BASE_URL === undefined ||
    String(env.VITE_TUZI_API_BASE_URL).trim() === ''
      ? DEFAULT_TUZI_API_BASE_URL
      : env.VITE_TUZI_API_BASE_URL;
  const apiBaseUrl = followLocalPageHostname(
    normalizeHttpOrigin(configuredApiBaseUrl),
    normalizeHttpOrigin(pageOrigin)
  );
  const parentOrigin = normalizeHttpOrigin(env.VITE_TUZI_PARENT_ORIGIN);

  return {
    enabled: requested && apiBaseUrl !== null,
    apiBaseUrl,
    parentOrigin,
  };
}

export const tuziEmbeddedConfig = readTuziEmbeddedConfig();

export function isTuziEmbeddedMode(): boolean {
  return tuziEmbeddedConfig.enabled;
}
