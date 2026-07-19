import { normalizeModelApiBaseUrl } from '../../utils/provider-base-url';

export function normalizeEndpointUrl(url?: string | null): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return normalizeModelApiBaseUrl('');
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');

  try {
    const parsed = new URL(
      /^[a-z][a-z\d+\-.]*:\/\//i.test(withoutTrailingSlash)
        ? withoutTrailingSlash
        : `https://${withoutTrailingSlash}`
    );
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
  } catch {
    return withoutTrailingSlash || normalizeModelApiBaseUrl('');
  }
}

export function normalizeEndpointApiBaseUrl(url?: string | null): string {
  return normalizeModelApiBaseUrl(normalizeEndpointUrl(url));
}

export function resolveEndpointSelectionUrl(
  baseUrl: string,
  endpointUrls: readonly string[]
): string {
  const normalizedApiBaseUrl = normalizeEndpointApiBaseUrl(baseUrl);
  const matchingEndpoint = endpointUrls.find(
    (endpointUrl) =>
      normalizeEndpointApiBaseUrl(endpointUrl) === normalizedApiBaseUrl
  );

  return normalizeEndpointUrl(matchingEndpoint || baseUrl);
}
