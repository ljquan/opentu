import type {
  PreparedProviderTransportRequest,
  ProviderBaseUrlStrategy,
  ProviderTransportRequest,
  ResolvedProviderContext,
} from './types';
import {
  isTrustedTuziApiBaseUrl,
  isTuziRequestIdCorsBaseUrl,
  loadTuziApiEndpointBaseUrls,
  normalizeTuziApiEndpointUrl,
  TUZI_API_REQUEST_ID_CORS_ENDPOINTS,
} from './tuzi-api-endpoints';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * 固定代理目标，避免开放站点成为任意地址转发器。
 * 路由名需与 Vite、Vercel、Netlify 及 Nginx 配置保持一致。
 */
const TUZI_SAME_ORIGIN_PROXY_ROUTES: Readonly<Record<string, string>> = {
  'api.tu-zi.com': 'api',
  'apius.tu-zi.com': 'apius',
  'apicdn.tu-zi.com': 'apicdn',
  'api.sydney-ai.com': 'sydney',
  'api.ourzhishi.top': 'ourzhishi',
  'apisz.ourzhishi.top': 'ourzhishi-sz',
};
const TUZI_SAME_ORIGIN_PROXY_PREFIX = '/__opentu_tuzi_proxy__';
const LOCAL_DEV_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1'];

export function isLocalDevHostname(hostname?: string): boolean {
  if (!hostname) return false;
  return (
    LOCAL_DEV_HOSTS.includes(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

export function supportsTuziSameOriginProxyHostname(
  hostname: string | undefined,
  isDev: boolean,
  explicitlyEnabled = false
): boolean {
  if (!hostname) return false;
  if (explicitlyEnabled) return true;
  if (isDev && isLocalDevHostname(hostname)) return true;
  return (
    hostname === 'opentu.ai' ||
    hostname.endsWith('.opentu.ai') ||
    hostname.endsWith('.vercel.app') ||
    hostname.endsWith('.netlify.app')
  );
}

export function rewriteTuziBaseUrlForSameOriginProxy(
  baseUrl: string,
  hostname: string | undefined,
  isDev: boolean,
  explicitlyEnabled = false
): string {
  try {
    const enabled = supportsTuziSameOriginProxyHostname(
      hostname,
      isDev,
      explicitlyEnabled
    );
    if (!enabled) return baseUrl;
    if (!/^https?:\/\//i.test(baseUrl)) return baseUrl;

    const parsed = new URL(baseUrl);
    const route = TUZI_SAME_ORIGIN_PROXY_ROUTES[parsed.host];
    if (!route) return baseUrl;
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${TUZI_SAME_ORIGIN_PROXY_PREFIX}/${route}${pathname}`.replace(
      /\/+$/,
      ''
    );
  } catch {
    return baseUrl;
  }
}

function rewriteBaseUrlForSameOriginProxy(baseUrl: string): string {
  return rewriteTuziBaseUrlForSameOriginProxy(
    baseUrl,
    globalThis.location?.hostname,
    import.meta.env.DEV && import.meta.env.MODE !== 'test',
    import.meta.env.VITE_TUZI_SAME_ORIGIN_PROXY === '1'
  );
}

function assertValidTuziSameOriginProxyResponse(
  requestUrl: string,
  response: Response
): Response {
  if (!requestUrl.startsWith(`${TUZI_SAME_ORIGIN_PROXY_PREFIX}/`)) {
    return response;
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (contentType.includes('text/html')) {
    throw new Error(
      'Tuzi 同源代理未生效：接口返回了网页内容，请检查部署代理配置'
    );
  }
  return response;
}

function applyBaseUrlStrategy(
  baseUrl: string,
  strategy: ProviderBaseUrlStrategy = 'preserve'
): string {
  const rewritten = rewriteBaseUrlForSameOriginProxy(baseUrl);
  const normalizedBaseUrl = trimTrailingSlashes(rewritten);

  switch (strategy) {
    case 'trim-v1':
      return normalizedBaseUrl.replace(/\/v1$/i, '');
    case 'ensure-v1':
      return /\/v1$/i.test(normalizedBaseUrl)
        ? normalizedBaseUrl
        : `${normalizedBaseUrl}/v1`;
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
  let normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // Endpoint discovery and manually persisted bindings can include the API
  // version even when the provider base URL already ends with it. Collapse
  // only the shared version segment at the join boundary so a valid
  // /v1/images/generations request never becomes /v1/v1/images/generations.
  const baseVersionMatch = normalizedBase.match(/\/(v\d+(?:beta\d*)?)$/i);
  const pathVersionMatch = normalizedPath.match(
    /^\/(v\d+(?:beta\d*)?)(?:\/|$)/i
  );
  if (
    baseVersionMatch &&
    pathVersionMatch &&
    baseVersionMatch[1].toLowerCase() === pathVersionMatch[1].toLowerCase()
  ) {
    normalizedPath = normalizedPath.slice(pathVersionMatch[1].length + 1);
  }

  return `${normalizedBase}${normalizedPath}`;
}

function getBaseUrlPathSuffix(baseUrl: string): string {
  try {
    const parsed = new URL(trimTrailingSlashes(baseUrl));
    return parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /Failed to fetch|Load failed|NetworkError/i.test(error.message);
}

function shouldRetryTuziResponse(
  context: ResolvedProviderContext,
  request: ProviderTransportRequest,
  response: Response
): boolean {
  return (
    response.status === 404 &&
    isTrustedTuziApiBaseUrl(context.baseUrl) &&
    !/^https?:\/\//i.test(request.path) &&
    (request.method || 'GET').toUpperCase() === 'POST' &&
    /\/images\/(?:generations|edits)\/?$/i.test(request.path)
  );
}

async function getTuziFallbackBaseUrls(baseUrl: string): Promise<string[]> {
  if (!isTrustedTuziApiBaseUrl(baseUrl)) {
    return [];
  }

  const currentOrigin = normalizeTuziApiEndpointUrl(baseUrl);
  const currentPathSuffix = getBaseUrlPathSuffix(baseUrl);
  const tuziOrigins = await loadTuziApiEndpointBaseUrls();

  if (!tuziOrigins.includes(currentOrigin)) {
    return [];
  }

  return tuziOrigins
    .filter((origin) => origin !== currentOrigin)
    .map((origin) => `${origin}${currentPathSuffix}`);
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

function createTimeoutSignal(
  upstreamSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): {
  signal: AbortSignal | undefined;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  if (!timeoutMs || timeoutMs <= 0) {
    return {
      signal: upstreamSignal,
      didTimeout: () => false,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let didTimeout = false;

  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal?.aborted) {
    controller.abort(upstreamSignal.reason);
  } else if (upstreamSignal) {
    upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    const error = new Error(`Request timeout after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup: () => {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    },
  };
}

function applyRequestIdHeader(
  headers: Record<string, string>,
  requestId: string | undefined,
  enabled: boolean,
  removeExisting: boolean
): Record<string, string> {
  if ((!requestId || !enabled) && !removeExisting) {
    return headers;
  }

  const nextHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => name.toLowerCase() !== 'x-request-id'
    )
  );
  if (requestId && enabled) {
    nextHeaders['X-Request-Id'] = requestId;
  }
  return nextHeaders;
}

function isTrustedTuziRequestTarget(
  context: ResolvedProviderContext,
  request: Pick<ProviderTransportRequest, 'path' | 'baseUrlStrategy'>
): boolean {
  if (!isTrustedTuziApiBaseUrl(context.baseUrl)) {
    return false;
  }

  const resolvedBaseUrl = applyBaseUrlStrategy(
    context.baseUrl,
    request.baseUrlStrategy
  );
  const requestUrl = joinUrl(resolvedBaseUrl, request.path);

  return (
    !/^https?:\/\//i.test(requestUrl) || isTrustedTuziApiBaseUrl(requestUrl)
  );
}

function isTuziRequestIdSubmission(
  context: ResolvedProviderContext,
  request: ProviderTransportRequest
): boolean {
  return Boolean(
    request.requestId &&
      (request.method || 'GET').toUpperCase() !== 'GET' &&
      isTrustedTuziRequestTarget(context, request)
  );
}

function routeTuziRequestIdSubmission(
  context: ResolvedProviderContext,
  request: ProviderTransportRequest
): ResolvedProviderContext {
  const resolvedBaseUrl = applyBaseUrlStrategy(
    context.baseUrl,
    request.baseUrlStrategy
  );
  if (
    !isTuziRequestIdSubmission(context, request) ||
    !/^https?:\/\//i.test(resolvedBaseUrl) ||
    isTuziRequestIdCorsBaseUrl(context.baseUrl)
  ) {
    return context;
  }

  const corsOrigin = TUZI_API_REQUEST_ID_CORS_ENDPOINTS[0]?.url;
  if (!corsOrigin) {
    return context;
  }

  return {
    ...context,
    baseUrl: `${normalizeTuziApiEndpointUrl(corsOrigin)}${getBaseUrlPathSuffix(
      context.baseUrl
    )}`,
  };
}

/**
 * X-Request-Id 只在明确放行该请求头的可信 Tuzi 节点上启用。
 */
export function canAttachProviderRequestIdHeader(
  context: ResolvedProviderContext,
  request: Pick<ProviderTransportRequest, 'path' | 'method' | 'baseUrlStrategy'>
): boolean {
  const resolvedBaseUrl = applyBaseUrlStrategy(
    context.baseUrl,
    request.baseUrlStrategy
  );
  const requestUrl = joinUrl(resolvedBaseUrl, request.path);
  return (
    (request.method || 'GET').toUpperCase() !== 'GET' &&
    isTrustedTuziRequestTarget(context, request) &&
    (!/^https?:\/\//i.test(requestUrl) ||
      isTuziRequestIdCorsBaseUrl(requestUrl))
  );
}

export class ProviderTransport {
  prepareRequest(
    context: ResolvedProviderContext,
    request: ProviderTransportRequest
  ): PreparedProviderTransportRequest {
    const routedContext = routeTuziRequestIdSubmission(context, request);
    const resolvedBaseUrl = applyBaseUrlStrategy(
      routedContext.baseUrl,
      request.baseUrlStrategy
    );
    const url = `${joinUrl(resolvedBaseUrl, request.path)}${buildQueryString(
      applyAuthQuery(routedContext, request.query || {})
    )}`;
    const mergedHeaders = mergeHeaders(
      routedContext.extraHeaders,
      request.headers
    );
    const authenticatedHeaders = applyAuthHeaders(routedContext, mergedHeaders);
    const finalHeaders = applyRequestIdHeader(
      authenticatedHeaders,
      request.requestId,
      canAttachProviderRequestIdHeader(routedContext, request),
      Boolean(request.requestId)
    );

    return {
      url,
      headers: finalHeaders,
      init: {
        method: request.method || 'GET',
        headers: finalHeaders,
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
    const requestIdSubmission = isTuziRequestIdSubmission(context, request);
    const timeoutControl = createTimeoutSignal(
      request.signal,
      request.timeoutMs
    );
    const prepared = this.prepareRequest(context, {
      ...request,
      signal: timeoutControl.signal,
    });
    const fetcher = request.fetcher || fetch;
    try {
      const response = assertValidTuziSameOriginProxyResponse(
        prepared.url,
        await fetcher(prepared.url, prepared.init)
      );
      if (!shouldRetryTuziResponse(context, request, response)) {
        return response;
      }

      // 带 Request ID 的正式提交固定到一个确定节点，避免跨节点重复生成和计费。
      const fallbackBaseUrls = requestIdSubmission
        ? []
        : await getTuziFallbackBaseUrls(context.baseUrl);
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        const fallbackPrepared = this.prepareRequest(
          { ...context, baseUrl: fallbackBaseUrl },
          { ...request, signal: timeoutControl.signal }
        );
        try {
          const fallbackResponse = assertValidTuziSameOriginProxyResponse(
            fallbackPrepared.url,
            await fetcher(fallbackPrepared.url, fallbackPrepared.init)
          );
          if (!shouldRetryTuziResponse(context, request, fallbackResponse)) {
            return fallbackResponse;
          }
        } catch (fallbackError) {
          if (
            timeoutControl.didTimeout() ||
            !isFetchNetworkError(fallbackError)
          ) {
            throw fallbackError;
          }
        }
      }

      return response;
    } catch (error) {
      if (timeoutControl.didTimeout()) {
        const timeoutMinutes = Math.floor((request.timeoutMs || 0) / 60000);
        const timeoutError = new Error(`请求超时（>${timeoutMinutes} 分钟）`);
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      if (isFetchNetworkError(error)) {
        const fallbackBaseUrls = requestIdSubmission
          ? []
          : await getTuziFallbackBaseUrls(context.baseUrl);

        for (const fallbackBaseUrl of fallbackBaseUrls) {
          const fallbackPrepared = this.prepareRequest(
            { ...context, baseUrl: fallbackBaseUrl },
            { ...request, signal: timeoutControl.signal }
          );
          try {
            return assertValidTuziSameOriginProxyResponse(
              fallbackPrepared.url,
              await fetcher(fallbackPrepared.url, fallbackPrepared.init)
            );
          } catch (fallbackError) {
            if (
              timeoutControl.didTimeout() ||
              !isFetchNetworkError(fallbackError)
            ) {
              throw fallbackError;
            }
          }
        }
      }
      throw error;
    } finally {
      timeoutControl.cleanup();
    }
  }
}

export const providerTransport = new ProviderTransport();
