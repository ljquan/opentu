import { decryptSecret } from '../crypto';
import type { ProviderRecord } from '../provider';
import { GenerationGatewayError, upstreamError } from './errors';
import { BLOCKED_PROVIDER_HEADER as BLOCKED_HEADER, withProviderResponse } from '../provider-transport';

function providerUrl(provider: ProviderRecord, path: string, secret: string): URL {
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes('..')) {
    throw new GenerationGatewayError(500, 'INVALID_BINDING', '模型路由配置无效');
  }
  const base = new URL(provider.base_url);
  const url = new URL(`${base.pathname.replace(/\/+$/, '')}${path}`, base.origin);
  if (url.origin !== base.origin) {
    throw new GenerationGatewayError(500, 'INVALID_BINDING', '模型路由配置无效');
  }
  if (provider.auth_type === 'query') {
    url.searchParams.set(provider.auth_query || 'api_key', secret);
  }
  return url;
}

function providerHeaders(
  provider: ProviderRecord,
  secret: string,
  contentType?: string
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  for (const [key, value] of Object.entries(provider.extra_headers || {})) {
    if (
      /^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(key) &&
      !BLOCKED_HEADER.test(key) &&
      typeof value === 'string' &&
      value.length <= 500
    ) {
      headers[key] = value;
    }
  }
  if (contentType) headers['Content-Type'] = contentType;
  if (provider.auth_type === 'bearer') {
    headers.Authorization = `Bearer ${secret}`;
  } else if (provider.auth_type === 'header') {
    const name = provider.auth_header || 'X-API-Key';
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(name) || BLOCKED_HEADER.test(name)) {
      throw new GenerationGatewayError(500, 'INVALID_BINDING', '供应商鉴权配置无效');
    }
    headers[name] = secret;
  }
  return headers;
}

async function readLimitedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('json')) {
    throw new GenerationGatewayError(
      502,
      'INVALID_UPSTREAM_RESPONSE',
      '模型供应商返回了无效数据'
    );
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new GenerationGatewayError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', '模型结果数据过大');
  }
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new GenerationGatewayError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', '模型结果数据过大');
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(output));
  } catch {
    throw new GenerationGatewayError(
      502,
      'INVALID_UPSTREAM_RESPONSE',
      '模型供应商返回了无效数据'
    );
  }
}

export async function requestProviderJson(
  provider: ProviderRecord,
  options: {
    path: '/v1/chat/completions' | '/v1/images/generations' | '/v1/images/edits';
    body: BodyInit;
    contentType?: string;
    timeoutMs: number;
    maxResponseBytes: number;
    idempotencyKey?: string;
    fetcher?: typeof fetch;
  }
): Promise<unknown> {
  const secret = decryptSecret(provider.encrypted_api_key);
  const url = providerUrl(provider, options.path, secret);
  try {
    return await withProviderResponse(url, {
      method: 'POST',
      headers: {
        ...providerHeaders(provider, secret, options.contentType),
        ...(options.idempotencyKey
          ? { 'Idempotency-Key': options.idempotencyKey }
          : {}),
      },
      body: options.body,
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs),
    }, async (response) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw upstreamError(response.status);
      }
      return readLimitedJson(response, options.maxResponseBytes);
    }, options.fetcher);
  } catch (error) {
    if (error instanceof GenerationGatewayError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new GenerationGatewayError(
        504,
        'UPSTREAM_TIMEOUT',
        '模型服务响应超时，执行结果待核对，请勿重复提交',
        false
      );
    }
    throw new GenerationGatewayError(
      502,
      'UPSTREAM_REQUEST_FAILED',
      '模型连接中断，执行结果待核对，请勿重复提交',
      false
    );
  }
}
