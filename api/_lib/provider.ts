import { decryptSecret } from './crypto';
import { assertProviderUrl, BLOCKED_PROVIDER_HEADER, withProviderResponse } from './provider-transport';

export type ProviderAuthType = 'bearer' | 'header' | 'query';
export type ProviderRecord = {
  id: string;
  name: string;
  base_url: string;
  auth_type: ProviderAuthType;
  auth_header: string | null;
  auth_query: string | null;
  extra_headers: Record<string, string>;
  encrypted_api_key: string;
  enabled: boolean;
  health_status: 'unknown' | 'healthy' | 'unhealthy';
  health_message: string | null;
  last_checked_at: string | null;
};

const MAX_MODELS_RESPONSE_BYTES = 2 * 1024 * 1024;

export function normalizeBaseUrl(input: string): string {
  const parsed = new URL(input.trim());
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('供应商地址不能包含账号、密码、查询参数或片段');
  }
  assertProviderUrl(parsed);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`;
}

function authRequestUrl(provider: ProviderRecord, secret: string): string {
  const url = new URL(`${provider.base_url}/v1/models`);
  if (provider.auth_type === 'query') {
    url.searchParams.set(provider.auth_query || 'api_key', secret);
  }
  return url.toString();
}

function authHeaders(provider: ProviderRecord, secret: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  for (const [key, value] of Object.entries(provider.extra_headers || {})) {
    if (/^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(key) &&
      !BLOCKED_PROVIDER_HEADER.test(key) && typeof value === 'string' && value.length <= 500) {
      headers[key] = value;
    }
  }
  if (provider.auth_type === 'bearer') {
    headers.Authorization = `Bearer ${secret}`;
  } else if (provider.auth_type === 'header') {
    const headerName = provider.auth_header || 'X-API-Key';
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(headerName) || BLOCKED_PROVIDER_HEADER.test(headerName)) {
      throw new Error('供应商请求头名称无效');
    }
    headers[headerName] = secret;
  }
  return headers;
}

async function readLimitedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_MODELS_RESPONSE_BYTES) {
    throw new Error('供应商模型响应过大');
  }
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.byteLength;
    if (total > MAX_MODELS_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('供应商模型响应过大');
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

export type DiscoveredModel = {
  id: string;
  name: string;
  vendor: string;
  category: 'image' | 'video' | 'audio' | 'text' | 'research';
  description: string;
  tags: string[];
  accent: 'violet' | 'cyan' | 'rose' | 'green' | 'amber';
};

export async function fetchProviderModels(provider: ProviderRecord): Promise<DiscoveredModel[]> {
  const secret = decryptSecret(provider.encrypted_api_key);
  const body = await withProviderResponse(new URL(authRequestUrl(provider, secret)), {
    headers: authHeaders(provider, secret),
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  }, async (response) => {
    if (!response.ok) throw new Error(`供应商返回 HTTP ${response.status}`);
    return readLimitedBody(response);
  });
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('供应商返回的模型数据不是 JSON');
  }
  const data = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : null;
  if (!data) throw new Error('供应商模型响应缺少 data 数组');
  return data
    .map((item) => toDiscoveredModel(item))
    .filter((model): model is DiscoveredModel => Boolean(model));
}

function toDiscoveredModel(item: unknown): DiscoveredModel | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id || id.length > 180) return null;
  const category = inferCategory(record);
  const vendor = inferVendor(id, record.owned_by);
  const name = formatName(id);
  return {
    id,
    name,
    vendor,
    category,
    description: `${vendor} 提供的${categoryLabel(category)}模型，已完成供应商同步。`,
    tags: [categoryLabel(category), vendor, '已同步'],
    accent: ({ image: 'violet', video: 'cyan', audio: 'rose', text: 'green', research: 'amber' } as Record<DiscoveredModel['category'], DiscoveredModel['accent']>)[category],
  };
}

function categoryLabel(category: DiscoveredModel['category']): string {
  return { image: '生图', video: '视频', audio: '音乐', text: '文本', research: '研究' }[category];
}

function inferCategory(record: Record<string, unknown>): DiscoveredModel['category'] {
  const id = String(record.id || '').toLowerCase();
  const endpoints = JSON.stringify(record.supported_endpoint_types || '').toLowerCase();
  if (/research|deepsearch/.test(id)) return 'research';
  if (/audio|music|suno|udio/.test(`${id} ${endpoints}`)) return 'audio';
  if (/video|sora|veo|kling|seedance|runway|pika/.test(`${id} ${endpoints}`)) return 'video';
  if (/image|image-generation|dall|flux|banana|seedream|midjourney/.test(`${id} ${endpoints}`)) return 'image';
  return 'text';
}

function inferVendor(id: string, ownedBy: unknown): string {
  const owner = typeof ownedBy === 'string' && ownedBy.trim() ? ownedBy.trim() : '';
  if (owner) return owner.slice(0, 80);
  const value = id.toLowerCase();
  if (/gpt|dall|sora|^o[134]-/.test(value)) return 'OpenAI';
  if (/gemini|veo|banana/.test(value)) return 'Google';
  if (/claude/.test(value)) return 'Anthropic';
  if (/deepseek/.test(value)) return 'DeepSeek';
  if (/qwen|qwq/.test(value)) return 'Qwen';
  if (/suno/.test(value)) return 'Suno';
  if (/kling/.test(value)) return 'Kling';
  if (/seedance|seedream|doubao/.test(value)) return 'ByteDance';
  return 'OpenTu';
}

function formatName(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => (/^(gpt|glm|veo|sora|udio|qwen|flux|ai)$/i.test(part) ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(' ')
    .slice(0, 120);
}
