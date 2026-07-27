export interface TuziApiEndpointSource {
  name?: string;
  url: string;
  description?: string;
}

export const TUZI_API_SOURCE_URL = 'https://github.com/tuziapi/tuzi-api';
export const TUZI_API_STATUS_URL = 'https://api.tu-zi.com/api/status';
const TUZI_PUBLIC_API_BASE_URL = 'https://api.tu-zi.com/v1';
const TUZI_BUSINESS_PUBLIC_API_BASE_URL = 'https://business.tu-zi.com/v1';
const TUZI_BUSINESS_PROVIDER_PROFILE_ID = 'tuzi-business';
const MANAGED_TUZI_PROVIDER_PROFILE_IDS = new Set([
  'legacy-default',
  'tuzi-origin',
  'tuzi-mix',
  'tuzi-codex',
  TUZI_BUSINESS_PROVIDER_PROFILE_ID,
]);
const LOCAL_V1_PROXY_PATTERN = /^(?:\.\/|\/)?v1\/?$/i;
const LEGACY_RUNTIME_PROVIDER_PROFILE_ID = 'runtime';
export const TUZI_API_FALLBACK_ENDPOINTS: TuziApiEndpointSource[] = [
  {
    name: '主站点',
    url: 'https://api.tu-zi.com',
    description: '主站点',
  },
  {
    name: '备用站点1-cdn',
    url: 'https://apius.tu-zi.com',
    description: '备用站点',
  },
  {
    name: '备用站点 2-cdn',
    url: 'https://apicdn.tu-zi.com',
    description: 'cdn站',
  },
  {
    name: '美国地址（无前端）-cdn',
    url: 'https://api.sydney-ai.com',
    description: '无前端地址（代理商用）',
  },
  {
    name: '广州地址（无前端）',
    url: 'https://api.ourzhishi.top',
    description: '广州地址',
  },
  {
    name: '深圳地址（无前端）',
    url: 'https://apisz.ourzhishi.top',
    description: '深圳地址',
  },
];

let tuziApiEndpointSourceCache: TuziApiEndpointSource[] | null = null;

export function normalizeTuziApiEndpointUrl(url?: string | null): string {
  const trimmed = (url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const parsed = new URL(
      /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    return parsed.origin;
  } catch {
    return trimmed;
  }
}

const TRUSTED_TUZI_API_ORIGINS = new Set(
  TUZI_API_FALLBACK_ENDPOINTS.map((endpoint) =>
    normalizeTuziApiEndpointUrl(endpoint.url)
  )
);

export function isTrustedTuziApiBaseUrl(url?: string | null): boolean {
  return TRUSTED_TUZI_API_ORIGINS.has(normalizeTuziApiEndpointUrl(url));
}

export function isTuziCompatibleBaseUrl(url?: string | null): boolean {
  if (isTrustedTuziApiBaseUrl(url)) {
    return true;
  }

  const normalized = normalizeTuziApiEndpointUrl(url);
  if (!normalized) {
    return false;
  }

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === 'tu-zi.com' || hostname.endsWith('.tu-zi.com');
  } catch {
    return false;
  }
}

/**
 * Older settings can persist the Vite development proxy path (`/v1`) as the
 * provider base URL. That path is valid while Vite is running, but a static
 * production host has no API proxy and would send `/v1/*` back to the SPA.
 *
 * Only built-in Tuzi profiles are repaired here. Custom providers may
 * intentionally use a same-origin relative proxy and must remain untouched.
 */
export function resolveManagedTuziBaseUrl(
  profileId: string,
  baseUrl: string,
  allowLocalDevProxy: boolean,
  runtimeOrigin: string | undefined = globalThis.location?.origin
): string {
  const normalizedBaseUrl = baseUrl.trim();
  const isEmptyLegacyRuntimeBase =
    profileId === LEGACY_RUNTIME_PROVIDER_PROFILE_ID && !normalizedBaseUrl;
  if (isEmptyLegacyRuntimeBase) {
    return TUZI_PUBLIC_API_BASE_URL;
  }

  let isSameOriginV1Proxy = false;
  if (runtimeOrigin && /^https?:\/\//i.test(normalizedBaseUrl)) {
    try {
      const parsedBaseUrl = new URL(normalizedBaseUrl);
      const parsedRuntimeOrigin = new URL(runtimeOrigin);
      isSameOriginV1Proxy =
        parsedBaseUrl.origin === parsedRuntimeOrigin.origin &&
        LOCAL_V1_PROXY_PATTERN.test(parsedBaseUrl.pathname);
    } catch {
      isSameOriginV1Proxy = false;
    }
  }
  const isPersistedV1Proxy =
    LOCAL_V1_PROXY_PATTERN.test(normalizedBaseUrl) || isSameOriginV1Proxy;
  const isLegacyRuntimeProxy =
    profileId === LEGACY_RUNTIME_PROVIDER_PROFILE_ID &&
    isPersistedV1Proxy;
  if (
    allowLocalDevProxy ||
    (!MANAGED_TUZI_PROVIDER_PROFILE_IDS.has(profileId) &&
      !isLegacyRuntimeProxy) ||
    !isPersistedV1Proxy
  ) {
    return normalizedBaseUrl;
  }

  return profileId === TUZI_BUSINESS_PROVIDER_PROFILE_ID
    ? TUZI_BUSINESS_PUBLIC_API_BASE_URL
    : TUZI_PUBLIC_API_BASE_URL;
}

function normalizeJsonLikeString(value: string): string {
  return value
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, text: string) =>
      JSON.stringify(text.replace(/\\'/g, "'"))
    )
    .replace(/,\s*([}\]])/g, '$1');
}

export function parseTuziApiAddressList(
  value: unknown
): TuziApiEndpointSource[] {
  if (!value) {
    return [];
  }

  const parsed =
    typeof value === 'string'
      ? JSON.parse(normalizeJsonLikeString(value))
      : value;

  if (!Array.isArray(parsed)) {
    return [];
  }

  const allowedUrls = new Set(
    TUZI_API_FALLBACK_ENDPOINTS.map((endpoint) =>
      normalizeTuziApiEndpointUrl(endpoint.url)
    )
  );
  const fallbackByUrl = new Map(
    TUZI_API_FALLBACK_ENDPOINTS.map((endpoint) => [
      normalizeTuziApiEndpointUrl(endpoint.url),
      endpoint,
    ])
  );

  const endpoints: Array<TuziApiEndpointSource | null> = parsed.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const url = String((item as { url?: unknown }).url || '').trim();
    const normalizedUrl = normalizeTuziApiEndpointUrl(url);
    if (!allowedUrls.has(normalizedUrl)) {
      return null;
    }

    const fallbackEndpoint = fallbackByUrl.get(normalizedUrl);
    return {
      name:
        String((item as { name?: unknown }).name || '').trim() ||
        fallbackEndpoint?.name,
      url: normalizedUrl,
      description:
        String((item as { description?: unknown }).description || '').trim() ||
        fallbackEndpoint?.description,
    };
  });
  return endpoints.filter((item): item is TuziApiEndpointSource =>
    Boolean(item)
  );
}

export async function loadTuziApiEndpointSources(): Promise<
  TuziApiEndpointSource[]
> {
  if (tuziApiEndpointSourceCache) {
    return tuziApiEndpointSourceCache;
  }

  const response = await fetch(TUZI_API_STATUS_URL, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load tuzi-api endpoints: ${response.status}`);
  }

  const payload = await response.json();
  const endpoints = parseTuziApiAddressList(
    payload?.data?.api_address_list || payload?.api_address_list
  );
  tuziApiEndpointSourceCache =
    endpoints.length > 0 ? endpoints : TUZI_API_FALLBACK_ENDPOINTS;
  return tuziApiEndpointSourceCache;
}

export async function loadTuziApiEndpointBaseUrls(): Promise<string[]> {
  let endpoints: TuziApiEndpointSource[];
  try {
    endpoints = await loadTuziApiEndpointSources();
  } catch {
    endpoints = TUZI_API_FALLBACK_ENDPOINTS;
  }
  return endpoints.map((endpoint) => normalizeTuziApiEndpointUrl(endpoint.url));
}
