import type {
  PreparedProviderTransportRequest,
  ProviderBaseUrlStrategy,
  ProviderTransportRequest,
  ResolvedProviderContext,
} from './types';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function applyBaseUrlStrategy(
  baseUrl: string,
  strategy: ProviderBaseUrlStrategy = 'preserve'
): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl);

  switch (strategy) {
    case 'trim-v1':
      return normalizedBaseUrl.replace(/\/v1$/i, '');
    case 'preserve':
    default:
      return normalizedBaseUrl;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedBase = trimTrailingSlashes(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function buildQueryString(
  query?: Record<string, string | number | boolean | null | undefined>
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || key.trim() === '') {
      continue;
    }
    params.set(key, String(value));
  }

  const result = params.toString();
  return result ? `?${result}` : '';
}

function mergeHeaders(
  baseHeaders?: Record<string, string>,
  overrideHeaders?: Record<string, string>
): Record<string, string> {
  return {
    ...(baseHeaders || {}),
    ...(overrideHeaders || {}),
  };
}

function applyAuthHeaders(
  context: ResolvedProviderContext,
  headers: Record<string, string>
): Record<string, string> {
  if (!context.apiKey) {
    return headers;
  }

  switch (context.authType) {
    case 'bearer':
      return { ...headers, Authorization: `Bearer ${context.apiKey}` };
    case 'header':
      if (
        headers.Authorization ||
        headers.authorization ||
        headers['X-API-Key'] ||
        headers['x-api-key']
      ) {
        return headers;
      }
      return { ...headers, 'X-API-Key': context.apiKey };
    case 'custom':
    case 'query':
    default:
      return headers;
  }
}

function applyAuthQuery(
  context: ResolvedProviderContext,
  query: Record<string, string | number | boolean | null | undefined>
): Record<string, string | number | boolean | null | undefined> {
  if (!context.apiKey || context.authType !== 'query') {
    return query;
  }

  if (query.api_key !== undefined || query.key !== undefined) {
    return query;
  }

  const authQueryKey =
    context.providerType === 'gemini-compatible' ? 'key' : 'api_key';

  return {
    ...query,
    [authQueryKey]: context.apiKey,
  };
}

export class ProviderTransport {
  prepareRequest(
    context: ResolvedProviderContext,
    request: ProviderTransportRequest
  ): PreparedProviderTransportRequest {
    const mergedHeaders = mergeHeaders(context.extraHeaders, request.headers);
    const authenticatedHeaders = applyAuthHeaders(context, mergedHeaders);
    const query = applyAuthQuery(context, request.query || {});
    const resolvedBaseUrl = applyBaseUrlStrategy(
      context.baseUrl,
      request.baseUrlStrategy
    );
    const url = `${joinUrl(resolvedBaseUrl, request.path)}${buildQueryString(
      query
    )}`;

    return {
      url,
      headers: authenticatedHeaders,
      init: {
        method: request.method || 'GET',
        headers: authenticatedHeaders,
        body: request.body,
        signal: request.signal,
        credentials: request.credentials,
      },
    };
  }

  async send(
    context: ResolvedProviderContext,
    request: ProviderTransportRequest
  ): Promise<Response> {
    const prepared = this.prepareRequest(context, request);
    const fetcher = request.fetcher || fetch;
    return fetcher(prepared.url, prepared.init);
  }
}

export const providerTransport = new ProviderTransport();
