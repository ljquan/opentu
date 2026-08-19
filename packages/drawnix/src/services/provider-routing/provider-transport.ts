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

function discardResponseBody(response: Response): void {
  if (!response.body || response.bodyUsed) {
    return;
  }

  try {
    void response.body.cancel().catch(() => undefined);
  } catch {
    // Response body cleanup must not replace the request's actual outcome.
  }
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
    discardResponseBody(response);
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

function isAmbiguousNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const cause = (error as Error & { cause?: unknown }).cause;
  const causeError = cause instanceof Error ? cause : undefined;
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code?: unknown }).code || '')
      : '';
  const details = [
    error.name,
    error.message,
    causeError?.name,
    causeError?.message,
    causeCode,
  ]
    .filter(Boolean)
    .join(' ');

  return /Failed to fetch|fetch failed|Load failed|Network\s?Error|network (?:connection was lost|changed)|connection (?:reset|closed|terminated)|socket hang up|remoteprotocolerror|\b(?:ECONNRESET|ENETRESET|EPIPE|ERR_NETWORK|ERR_HTTP2_PROTOCOL_ERROR|ERR_QUIC_PROTOCOL_ERROR)\b|\bterminated\b/i.test(
    details
  );
}

export const IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE =
  'IMAGE_SUBMISSION_OUTCOME_UNKNOWN';
const MAX_PROVIDER_SUCCESS_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_PROVIDER_ERROR_RESPONSE_BYTES = 1 * 1024 * 1024;
const INITIAL_RESPONSE_BUFFER_BYTES = 64 * 1024;
const MAX_INITIAL_RESPONSE_BUFFER_BYTES = 1 * 1024 * 1024;

class ImageSubmissionOutcomeUnknownError extends Error {
  readonly code = IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE;

  constructor(cause: unknown) {
    super('图片请求连接中断，正在确认生成结果');
    this.name = 'ImageSubmissionOutcomeUnknownError';
    (this as Error & { cause?: unknown }).cause = cause;
  }
}

class ProviderResponseTooLargeError extends Error {
  readonly code = 'PROVIDER_RESPONSE_TOO_LARGE';

  constructor(maxBytes: number) {
    super(`供应商响应超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 限制`);
    this.name = 'ProviderResponseTooLargeError';
  }
}

export function isImageSubmissionOutcomeUnknownError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as { code?: unknown }).code ===
        IMAGE_SUBMISSION_OUTCOME_UNKNOWN_CODE
  );
}

interface ProviderResponseReadContext {
  signal?: AbortSignal;
  upstreamSignal?: AbortSignal;
  timeoutMs?: number;
  didTimeout: () => boolean;
  cleanup: () => void;
  allowImageSubmissionOutcomeUnknown: boolean;
}

const providerResponseReads = new WeakMap<
  Response,
  ProviderResponseReadContext
>();

function createRequestTimeoutError(timeoutMs?: number): Error {
  const timeoutMinutes = Math.floor((timeoutMs || 0) / 60000);
  const timeoutError = new Error(`请求超时（>${timeoutMinutes} 分钟）`);
  timeoutError.name = 'TimeoutError';
  return timeoutError;
}

function createRequestAbortError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) {
    return signal.reason;
  }
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';
  return abortError;
}

function getProviderResponseByteLimit(response: Response): number {
  return response.ok
    ? MAX_PROVIDER_SUCCESS_RESPONSE_BYTES
    : MAX_PROVIDER_ERROR_RESPONSE_BYTES;
}

function getDeclaredContentLength(response: Response): number | undefined {
  const value = response.headers.get('content-length')?.trim();
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function createResponseTooLargeError(response: Response): Error {
  return new ProviderResponseTooLargeError(
    getProviderResponseByteLimit(response)
  );
}

async function readProviderResponseBody(response: Response): Promise<string> {
  const bodyAlreadyUsed = response.bodyUsed;
  const context = providerResponseReads.get(response);
  if (context) {
    providerResponseReads.delete(response);
  }

  try {
    const maxBytes = getProviderResponseByteLimit(response);
    const declaredContentLength = getDeclaredContentLength(response);
    if (
      declaredContentLength !== undefined &&
      declaredContentLength > maxBytes
    ) {
      discardResponseBody(response);
      throw createResponseTooLargeError(response);
    }

    let result: string;
    if (!response.body || bodyAlreadyUsed) {
      result = await response.text();
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const readStream = (async () => {
        let bodyBytes = new Uint8Array(0);
        let totalBytes = 0;
        try {
          let readResult = await reader.read();
          while (!readResult.done) {
            const chunk = readResult.value;
            const nextTotalBytes = totalBytes + chunk.byteLength;
            if (nextTotalBytes > maxBytes) {
              const error = createResponseTooLargeError(response);
              void reader.cancel(error).catch(() => undefined);
              throw error;
            }

            if (nextTotalBytes > bodyBytes.byteLength) {
              const initialCapacity = Math.min(
                Math.max(
                  declaredContentLength ?? INITIAL_RESPONSE_BUFFER_BYTES,
                  INITIAL_RESPONSE_BUFFER_BYTES
                ),
                MAX_INITIAL_RESPONSE_BUFFER_BYTES
              );
              const nextCapacity = Math.min(
                maxBytes,
                Math.max(
                  nextTotalBytes,
                  bodyBytes.byteLength > 0
                    ? bodyBytes.byteLength * 2
                    : initialCapacity
                )
              );
              const expanded = new Uint8Array(nextCapacity);
              expanded.set(bodyBytes.subarray(0, totalBytes));
              bodyBytes = expanded;
            }
            bodyBytes.set(chunk, totalBytes);
            totalBytes = nextTotalBytes;
            readResult = await reader.read();
          }
          return decoder.decode(bodyBytes.subarray(0, totalBytes));
        } finally {
          reader.releaseLock();
        }
      })();
      void readStream.catch(() => undefined);

      if (!context?.signal) {
        result = await readStream;
      } else {
        const signal = context.signal;
        let abortTimer: ReturnType<typeof setTimeout> | undefined;
        let removeAbortListener: () => void = () => undefined;
        const aborted = new Promise<never>((_, reject) => {
          const abort = () => {
            const reason =
              signal.reason !== undefined
                ? signal.reason
                : createRequestAbortError(signal);
            abortTimer = setTimeout(() => {
              try {
                void reader.cancel(reason).catch(() => undefined);
              } catch {
                // A concurrently failed stream can already be unlocked here.
              }
              reject(reason);
            }, 0);
          };

          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener('abort', abort, { once: true });
          removeAbortListener = () =>
            signal.removeEventListener('abort', abort);
        });

        try {
          result = await Promise.race([readStream, aborted]);
        } finally {
          if (abortTimer !== undefined) {
            clearTimeout(abortTimer);
          }
          removeAbortListener();
        }
      }
    }
    if (context?.didTimeout()) {
      throw createRequestTimeoutError(context.timeoutMs);
    }
    if (context?.upstreamSignal?.aborted) {
      throw createRequestAbortError(context.upstreamSignal);
    }
    return result;
  } catch (error) {
    if (!context || bodyAlreadyUsed) {
      throw error;
    }
    if (context.didTimeout()) {
      throw createRequestTimeoutError(context.timeoutMs);
    }
    if (context.upstreamSignal?.aborted) {
      throw error;
    }
    if (error instanceof ProviderResponseTooLargeError) {
      throw error;
    }
    if (isImageSubmissionOutcomeUnknownError(error)) {
      throw error;
    }
    if (!context.allowImageSubmissionOutcomeUnknown) {
      throw error;
    }
    throw new ImageSubmissionOutcomeUnknownError(error);
  } finally {
    context?.cleanup();
  }
}

/**
 * 通过有界 reader 读取非流式响应。可信同步图片的 2xx 响应流中断会
 * 归类为提交结果未知；reader 正常结束后的 JSON 解析错误保持协议错误。
 */
export async function readProviderResponseJson<T = unknown>(
  response: Response
): Promise<T> {
  const text = await readProviderResponseText(response);
  return JSON.parse(text) as T;
}

/** 正常 EOF 后不根据文本内容猜测响应流是否中断。 */
export async function readProviderResponseText(
  response: Response
): Promise<string> {
  return readProviderResponseBody(response);
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
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  };

  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason);
    cleanup();
  };

  if (upstreamSignal?.aborted) {
    controller.abort(upstreamSignal.reason);
    return {
      signal: controller.signal,
      didTimeout: () => false,
      cleanup,
    };
  } else if (upstreamSignal) {
    upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
  }

  timeoutId = setTimeout(() => {
    didTimeout = true;
    const error = new Error(`Request timeout after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    controller.abort(error);
    cleanup();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup,
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

function isReadOnlyRequestMethod(method?: string): boolean {
  const normalizedMethod = (method || 'GET').toUpperCase();
  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
}

function isPostRequestMethod(method?: string): boolean {
  return (method || 'GET').toUpperCase() === 'POST';
}

function getAbsoluteHttpOrigin(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function shouldInheritProviderCredentials(
  context: ResolvedProviderContext,
  requestUrl: string
): boolean {
  if (!/^https?:\/\//i.test(requestUrl)) {
    return true;
  }

  if (
    isTrustedTuziApiBaseUrl(context.baseUrl) &&
    isTrustedTuziApiBaseUrl(requestUrl)
  ) {
    return true;
  }

  const profileOrigin = getAbsoluteHttpOrigin(context.baseUrl);
  const requestOrigin = getAbsoluteHttpOrigin(requestUrl);
  return Boolean(profileOrigin && requestOrigin === profileOrigin);
}

function isTuziRequestIdSubmission(
  context: ResolvedProviderContext,
  request: ProviderTransportRequest
): boolean {
  return Boolean(
    request.requestId &&
      isPostRequestMethod(request.method) &&
      isTrustedTuziRequestTarget(context, request)
  );
}

function isRecoverableTuziImageRequestIdSubmission(
  context: ResolvedProviderContext,
  request: ProviderTransportRequest,
  prepared: PreparedProviderTransportRequest
): boolean {
  const requestPath = request.path.split(/[?#]/, 1)[0] || '';
  const attachedRequestId = Object.entries(prepared.headers).find(
    ([name]) => name.toLowerCase() === 'x-request-id'
  )?.[1];
  return (
    request.allowImageSubmissionOutcomeRecovery !== false &&
    isTuziRequestIdSubmission(context, request) &&
    attachedRequestId === request.requestId &&
    isPostRequestMethod(request.method) &&
    /\/images\/(?:generations|edits)\/?$/i.test(requestPath)
  );
}

function allowsNetworkFallback(request: ProviderTransportRequest): boolean {
  return isReadOnlyRequestMethod(request.method);
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
    isPostRequestMethod(request.method) &&
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
    const requestUrl = joinUrl(resolvedBaseUrl, request.path);
    const credentialContext = shouldInheritProviderCredentials(
      context,
      requestUrl
    )
      ? routedContext
      : { ...routedContext, apiKey: '', extraHeaders: undefined };
    const url = `${requestUrl}${buildQueryString(
      applyAuthQuery(credentialContext, request.query || {})
    )}`;
    const mergedHeaders = mergeHeaders(
      credentialContext.extraHeaders,
      request.headers
    );
    const authenticatedHeaders = applyAuthHeaders(
      credentialContext,
      mergedHeaders
    );
    const finalHeaders = applyRequestIdHeader(
      authenticatedHeaders,
      request.requestId,
      canAttachProviderRequestIdHeader(routedContext, request),
      Boolean(request.requestId) || isReadOnlyRequestMethod(request.method)
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
    const recoverableImageSubmission =
      isRecoverableTuziImageRequestIdSubmission(context, request, prepared);
    const fetcher = request.fetcher || fetch;
    let responseCleanupDeferred = false;
    const returnResponse = (
      response: Response,
      allowImageSubmissionOutcomeUnknown = false
    ): Response => {
      if (
        !request.controlledResponseBody &&
        !allowImageSubmissionOutcomeUnknown
      ) {
        return response;
      }
      providerResponseReads.set(response, {
        signal: timeoutControl.signal,
        upstreamSignal: request.signal,
        timeoutMs: request.timeoutMs,
        didTimeout: timeoutControl.didTimeout,
        cleanup: timeoutControl.cleanup,
        allowImageSubmissionOutcomeUnknown,
      });
      responseCleanupDeferred = true;
      return response;
    };
    try {
      const response = assertValidTuziSameOriginProxyResponse(
        prepared.url,
        await fetcher(prepared.url, prepared.init)
      );
      if (!shouldRetryTuziResponse(context, request, response)) {
        return returnResponse(
          response,
          recoverableImageSubmission && response.ok
        );
      }

      // 带 Request ID 的正式提交固定到一个确定节点，避免跨节点重复生成和计费。
      const fallbackBaseUrls = requestIdSubmission
        ? []
        : await getTuziFallbackBaseUrls(context.baseUrl);
      let retryResponse = response;
      for (const fallbackBaseUrl of fallbackBaseUrls) {
        try {
          const fallbackPrepared = this.prepareRequest(
            { ...context, baseUrl: fallbackBaseUrl },
            { ...request, signal: timeoutControl.signal }
          );
          const fallbackResponse = assertValidTuziSameOriginProxyResponse(
            fallbackPrepared.url,
            await fetcher(fallbackPrepared.url, fallbackPrepared.init)
          );
          if (!shouldRetryTuziResponse(context, request, fallbackResponse)) {
            discardResponseBody(retryResponse);
            return returnResponse(fallbackResponse);
          }
          discardResponseBody(retryResponse);
          retryResponse = fallbackResponse;
        } catch (fallbackError) {
          if (
            timeoutControl.didTimeout() ||
            !isAmbiguousNetworkError(fallbackError) ||
            !allowsNetworkFallback(request)
          ) {
            discardResponseBody(retryResponse);
            throw fallbackError;
          }
        }
      }

      return returnResponse(retryResponse);
    } catch (error) {
      if (timeoutControl.didTimeout()) {
        throw createRequestTimeoutError(request.timeoutMs);
      }
      if (
        recoverableImageSubmission &&
        !request.signal?.aborted &&
        isAmbiguousNetworkError(error)
      ) {
        throw new ImageSubmissionOutcomeUnknownError(error);
      }
      if (isAmbiguousNetworkError(error) && allowsNetworkFallback(request)) {
        const fallbackBaseUrls = requestIdSubmission
          ? []
          : await getTuziFallbackBaseUrls(context.baseUrl);

        for (const fallbackBaseUrl of fallbackBaseUrls) {
          const fallbackPrepared = this.prepareRequest(
            { ...context, baseUrl: fallbackBaseUrl },
            { ...request, signal: timeoutControl.signal }
          );
          try {
            return returnResponse(
              assertValidTuziSameOriginProxyResponse(
                fallbackPrepared.url,
                await fetcher(fallbackPrepared.url, fallbackPrepared.init)
              )
            );
          } catch (fallbackError) {
            if (
              timeoutControl.didTimeout() ||
              !isAmbiguousNetworkError(fallbackError)
            ) {
              throw fallbackError;
            }
          }
        }
      }
      throw error;
    } finally {
      if (!responseCleanupDeferred) {
        timeoutControl.cleanup();
      }
    }
  }
}

export const providerTransport = new ProviderTransport();
