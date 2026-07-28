import type {
  PreparedProviderTransportRequest,
  ProviderBaseUrlStrategy,
  ProviderTransportRequest,
  ResolvedProviderContext,
} from './types';
import {
  isTrustedTuziApiBaseUrl,
  loadTuziApiEndpointBaseUrls,
  normalizeTuziApiEndpointUrl,
  TUZI_API_REQUEST_ID_CORS_ENDPOINTS,
} from './tuzi-api-endpoints';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/** 本地开发仅把主 API 站改写到既有 Vite 同源代理。 */
const DEV_PROXY_HOSTS: readonly string[] = ['api.tu-zi.com'];
const LOCAL_DEV_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1'];

function isLocalDevRuntime(): boolean {
  const hostname = globalThis.location?.hostname;
  return typeof hostname === 'string' && LOCAL_DEV_HOSTS.includes(hostname);
}

function rewriteBaseUrlForDevProxy(baseUrl: string): string {
  try {
    // 必须直接读取 Vite 的内置环境常量。通过类型断言间接访问
    // `import.meta.env` 会让生产构建错误地把 DEV 折叠为 true，进而把
    // https://api.tu-zi.com/v1 改写成当前站点下的 /v1。
    const isDev =
      import.meta.env.DEV &&
      import.meta.env.MODE !== 'test' &&
      isLocalDevRuntime();
    if (!isDev) return baseUrl;
    if (!/^https?:\/\//i.test(baseUrl)) return baseUrl;

    const parsed = new URL(baseUrl);
    if (!DEV_PROXY_HOSTS.includes(parsed.host)) return baseUrl;
    // 只保留 pathname（如 /v1），改写为同源相对路径
    return parsed.pathname.replace(/\/+$/, '');
  } catch {
    return baseUrl;
  }
}

function applyBaseUrlStrategy(
  baseUrl: string,
  strategy: ProviderBaseUrlStrategy = 'preserve'
): string {
  const rewritten = rewriteBaseUrlForDevProxy(baseUrl);
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

const REQUEST_ID_CORS_ORIGINS = TUZI_API_REQUEST_ID_CORS_ENDPOINTS.map(
  (endpoint) => normalizeTuziApiEndpointUrl(endpoint.url)
);

function shouldRouteTuziRequestThroughCorsEndpoint(
  context: ResolvedProviderContext,
  request: Pick<ProviderTransportRequest, 'path' | 'method' | 'requestId'>
): boolean {
  if (!request.requestId || !globalThis.location) {
    return false;
  }
  if (
    import.meta.env.DEV &&
    import.meta.env.MODE !== 'test' &&
    isLocalDevRuntime()
  ) {
    return false;
  }
  if (
    (request.method || 'GET').toUpperCase() === 'GET' ||
    /^https?:\/\//i.test(request.path) ||
    !isTrustedTuziApiBaseUrl(context.baseUrl)
  ) {
    return false;
  }

  const currentOrigin = normalizeTuziApiEndpointUrl(context.baseUrl);
  return !REQUEST_ID_CORS_ORIGINS.includes(currentOrigin);
}

function routeTuziRequestThroughCorsEndpoint(
  context: ResolvedProviderContext,
  request: Pick<ProviderTransportRequest, 'path' | 'method' | 'requestId'>
): ResolvedProviderContext {
  if (!shouldRouteTuziRequestThroughCorsEndpoint(context, request)) {
    return context;
  }

  const pathSuffix = getBaseUrlPathSuffix(context.baseUrl);
  return {
    ...context,
    baseUrl: `${REQUEST_ID_CORS_ORIGINS[0]}${pathSuffix}`,
  };
}

async function getTuziFallbackBaseUrls(
  baseUrl: string,
  requestIdCorsOnly = false
): Promise<string[]> {
  if (!isTrustedTuziApiBaseUrl(baseUrl)) {
    return [];
  }

  const currentOrigin = normalizeTuziApiEndpointUrl(baseUrl);
  const currentPathSuffix = getBaseUrlPathSuffix(baseUrl);
  const tuziOrigins = requestIdCorsOnly
    ? REQUEST_ID_CORS_ORIGINS
    : await loadTuziApiEndpointBaseUrls();

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

/**
 * X-Request-Id 只在可信 Tuzi 的非 GET 提交请求中启用。
 * OpenTu 无论部署在本地、局域网还是公网都直连 Tuzi API；跨域预检
 * 由所有对外 Tuzi API 节点统一放行 X-Request-Id。
 */
export function canAttachProviderRequestIdHeader(
  context: ResolvedProviderContext,
  request: Pick<ProviderTransportRequest, 'path' | 'method' | 'baseUrlStrategy'>
): boolean {
  return (
    (request.method || 'GET').toUpperCase() !== 'GET' &&
    isTrustedTuziRequestTarget(context, request)
  );
}

export class ProviderTransport {
  prepareRequest(
    context: ResolvedProviderContext,
    request: ProviderTransportRequest
  ): PreparedProviderTransportRequest {
    const resolvedBaseUrl = applyBaseUrlStrategy(
      context.baseUrl,
      request.baseUrlStrategy
    );
    const url = `${joinUrl(resolvedBaseUrl, request.path)}${buildQueryString(
      applyAuthQuery(context, request.query || {})
    )}`;
    const mergedHeaders = mergeHeaders(context.extraHeaders, request.headers);
    const authenticatedHeaders = applyAuthHeaders(context, mergedHeaders);
    const isTrustedTarget = isTrustedTuziRequestTarget(context, request);
    const finalHeaders = applyRequestIdHeader(
      authenticatedHeaders,
      request.requestId,
      canAttachProviderRequestIdHeader(context, request),
      isTrustedTarget
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
    const effectiveContext = routeTuziRequestThroughCorsEndpoint(
      context,
      request
    );
    const requestIdCorsOnly = Boolean(
      globalThis.location &&
        request.requestId &&
        canAttachProviderRequestIdHeader(effectiveContext, request) &&
        (effectiveContext.baseUrl !== context.baseUrl ||
          REQUEST_ID_CORS_ORIGINS.includes(
            normalizeTuziApiEndpointUrl(effectiveContext.baseUrl)
          ))
    );
    const timeoutControl = createTimeoutSignal(
      request.signal,
      request.timeoutMs
    );
    const prepared = this.prepareRequest(effectiveContext, {
      ...request,
      signal: timeoutControl.signal,
    });
    const fetcher = request.fetcher || fetch;
    try {
      const response = await fetcher(prepared.url, prepared.init);
      if (!shouldRetryTuziResponse(effectiveContext, request, response)) {
        return response;
      }

      const fallbackBaseUrls = await getTuziFallbackBaseUrls(
        effectiveContext.baseUrl,
        requestIdCorsOnly
      );
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        const fallbackPrepared = this.prepareRequest(
          { ...effectiveContext, baseUrl: fallbackBaseUrl },
          { ...request, signal: timeoutControl.signal }
        );
        try {
          const fallbackResponse = await fetcher(
            fallbackPrepared.url,
            fallbackPrepared.init
          );
          if (
            !shouldRetryTuziResponse(
              effectiveContext,
              request,
              fallbackResponse
            )
          ) {
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
        const fallbackBaseUrls = await getTuziFallbackBaseUrls(
          effectiveContext.baseUrl,
          requestIdCorsOnly
        );

        for (const fallbackBaseUrl of fallbackBaseUrls) {
          const fallbackPrepared = this.prepareRequest(
            { ...effectiveContext, baseUrl: fallbackBaseUrl },
            { ...request, signal: timeoutControl.signal }
          );
          try {
            return await fetcher(fallbackPrepared.url, fallbackPrepared.init);
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
