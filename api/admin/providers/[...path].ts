import { randomUUID } from 'node:crypto';
import { dbQuery, dbTransaction } from '../../_lib/db';
import { assertSameOrigin, requireAdmin, ResponseError } from '../../_lib/auth';
import { encryptSecret } from '../../_lib/crypto';
import {
  booleanValue,
  requestBody,
  safeErrorMessage,
  sendJson,
  textValue,
  type ApiRequest,
  type ApiResponse,
} from '../../_lib/http';
import { ensureSchema } from '../../_lib/db';
import {
  fetchProviderModels,
  normalizeBaseUrl,
  type ProviderAuthType,
  type ProviderRecord,
} from '../../_lib/provider';

type ProviderRow = ProviderRecord & { updated_at: string | Date };

function pathParts(request: ApiRequest): string[] {
  const path = request.query?.path;
  const value = Array.isArray(path) ? path.join('/') : path || '';
  return value
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function providerPublic(row: ProviderRow) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    authType: row.auth_type,
    enabled: row.enabled,
    healthStatus: row.health_status,
    healthMessage: row.health_message,
    lastCheckedAt: row.last_checked_at,
    hasApiKey: Boolean(row.encrypted_api_key),
  };
}

async function findProvider(id: string): Promise<ProviderRow> {
  const result = await dbQuery<ProviderRow>(
    'SELECT id, name, base_url, auth_type, auth_header, auth_query, extra_headers, encrypted_api_key, enabled, health_status, health_message, last_checked_at, updated_at FROM opentu_provider_profiles WHERE id = $1',
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new ResponseError(404, '供应商不存在');
  return row;
}

function authTypeValue(value: unknown): ProviderAuthType {
  const authType = textValue(value, 20);
  if (authType === 'header' || authType === 'query') return authType;
  return 'bearer';
}

function optionalHeaderName(value: unknown): string | null {
  const name = textValue(value, 80);
  if (!name) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(name)) {
    throw new ResponseError(400, '请求头或参数名称无效');
  }
  return name;
}

function extraHeadersValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, string>
  >((headers, [key, headerValue]) => {
    if (
      /^[A-Za-z0-9][A-Za-z0-9-]{0,60}$/.test(key) &&
      !/authorization|api[-_]?key|token|cookie|secret/i.test(key) &&
      typeof headerValue === 'string'
    ) {
      headers[key] = headerValue.slice(0, 500);
    }
    return headers;
  }, {});
}

async function createProvider(request: ApiRequest) {
  const body = requestBody(request);
  const name = textValue(body.name, 80);
  const baseUrl = normalizeBaseUrl(textValue(body.baseUrl, 500));
  const apiKey = textValue(body.apiKey, 4000);
  if (!name || !apiKey)
    throw new ResponseError(400, '供应商名称和 API Key 不能为空');
  const id = randomUUID();
  await dbQuery(
    `INSERT INTO opentu_provider_profiles
      (id, name, base_url, auth_type, auth_header, auth_query, extra_headers, encrypted_api_key, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      id,
      name,
      baseUrl,
      authTypeValue(body.authType),
      optionalHeaderName(body.authHeader),
      optionalHeaderName(body.authQuery),
      JSON.stringify(extraHeadersValue(body.extraHeaders)),
      encryptSecret(apiKey),
      booleanValue(body.enabled, true),
    ]
  );
  return providerPublic(await findProvider(id));
}

async function updateProvider(request: ApiRequest, id: string) {
  const body = requestBody(request);
  const current = await findProvider(id);
  const name = textValue(body.name, 80) || current.name;
  const baseUrl =
    body.baseUrl === undefined
      ? current.base_url
      : normalizeBaseUrl(textValue(body.baseUrl, 500));
  const apiKey = textValue(body.apiKey, 4000);
  const encryptedKey = apiKey
    ? encryptSecret(apiKey)
    : current.encrypted_api_key;
  await dbQuery(
    `UPDATE opentu_provider_profiles
     SET name = $2, base_url = $3, auth_type = $4, auth_header = $5,
         auth_query = $6, extra_headers = $7::jsonb, encrypted_api_key = $8,
         enabled = $9, health_status = CASE WHEN $3 <> base_url THEN 'unknown' ELSE health_status END,
         updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      name,
      baseUrl,
      authTypeValue(
        body.authType === undefined ? current.auth_type : body.authType
      ),
      body.authHeader === undefined
        ? current.auth_header
        : optionalHeaderName(body.authHeader),
      body.authQuery === undefined
        ? current.auth_query
        : optionalHeaderName(body.authQuery),
      JSON.stringify(
        body.extraHeaders === undefined
          ? current.extra_headers
          : extraHeadersValue(body.extraHeaders)
      ),
      encryptedKey,
      booleanValue(body.enabled, current.enabled),
    ]
  );
  return providerPublic(await findProvider(id));
}

async function testProvider(id: string) {
  const provider = await findProvider(id);
  try {
    const models = await fetchProviderModels(provider);
    await dbQuery(
      "UPDATE opentu_provider_profiles SET health_status = 'healthy', health_message = $2, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id, `连接正常，发现 ${models.length} 个模型`]
    );
    return {
      provider: providerPublic(await findProvider(id)),
      modelCount: models.length,
    };
  } catch (error) {
    await dbQuery(
      "UPDATE opentu_provider_profiles SET health_status = 'unhealthy', health_message = $2, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id, safeErrorMessage(error)]
    );
    throw new ResponseError(502, '供应商连接失败，请检查地址、鉴权和网络');
  }
}

async function syncProviderModels(id: string) {
  const provider = await findProvider(id);
  const syncStartedAt = new Date().toISOString();
  let models: Awaited<ReturnType<typeof fetchProviderModels>>;
  try {
    models = await fetchProviderModels(provider);
  } catch (error) {
    await dbQuery(
      "UPDATE opentu_provider_profiles SET health_status = 'unhealthy', health_message = $2, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1 AND (last_checked_at IS NULL OR last_checked_at <= $3::timestamptz)",
      [id, safeErrorMessage(error), syncStartedAt]
    );
    throw new ResponseError(502, '模型同步失败，请先检查供应商连接');
  }

  const uniqueModels = [
    ...new Map(models.map((model) => [model.id, model])).values(),
  ];
  await dbTransaction(async (query) => {
    const locked = await query(
      'SELECT last_checked_at, updated_at FROM opentu_provider_profiles WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!locked.rows.length) throw new ResponseError(404, '供应商不存在');
    if (
      new Date(locked.rows[0].updated_at as string).getTime() !==
      new Date(provider.updated_at).getTime()
    ) {
      throw new ResponseError(409, '供应商配置或状态已更新，请重新同步');
    }
    if (
      locked.rows[0].last_checked_at &&
      new Date(locked.rows[0].last_checked_at as string).getTime() >
        new Date(syncStartedAt).getTime()
    ) {
      throw new ResponseError(409, '供应商状态已更新，请重新同步');
    }
    await query(
      `INSERT INTO opentu_provider_models
        (id, provider_id, model_id, name, vendor, category, description, tags, accent, available, last_seen_at)
       SELECT m.record_id, $1, m.id, m.name, m.vendor, m.category, m.description, m.tags, m.accent, TRUE, NOW()
       FROM jsonb_to_recordset($2::jsonb) AS m(record_id TEXT, id TEXT, name TEXT,
         vendor TEXT, category TEXT, description TEXT, tags JSONB, accent TEXT)
       ON CONFLICT (provider_id, model_id) DO UPDATE SET
         name = EXCLUDED.name, vendor = EXCLUDED.vendor, category = EXCLUDED.category,
         description = EXCLUDED.description, tags = EXCLUDED.tags, accent = EXCLUDED.accent,
         available = TRUE, last_seen_at = NOW()`,
      [
        id,
        JSON.stringify(
          uniqueModels.map((model) => ({ ...model, record_id: randomUUID() }))
        ),
      ]
    );
    await query(
      'UPDATE opentu_provider_models SET available = FALSE WHERE provider_id = $1 AND NOT (model_id = ANY($2::text[]))',
      [id, uniqueModels.map((model) => model.id)]
    );
    await query(
      "UPDATE opentu_provider_profiles SET health_status = 'healthy', health_message = $2, last_checked_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id, `同步完成，发现 ${models.length} 个模型`]
    );
  });
  return {
    provider: providerPublic(await findProvider(id)),
    models: await listModels(id),
  };
}

async function listModels(id: string) {
  await findProvider(id);
  const result = await dbQuery(
    'SELECT id, model_id, name, vendor, category, description, tags, accent, available, published, gateway_enabled, billing_mode, routing_priority, last_seen_at FROM opentu_provider_models WHERE provider_id = $1 ORDER BY published DESC, routing_priority ASC, name ASC',
    [id]
  );
  return result.rows.map((row) => ({
    id: row.id,
    modelId: row.model_id,
    name: row.name,
    vendor: row.vendor,
    category: row.category,
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags : [],
    accent: row.accent,
    available: row.available,
    published: row.published,
    gatewayEnabled: row.gateway_enabled,
    billingMode: row.billing_mode,
    routingPriority: row.routing_priority,
    lastSeenAt: row.last_seen_at,
  }));
}

async function publishModel(
  request: ApiRequest,
  providerId: string,
  modelId: string
) {
  const body = requestBody(request);
  const billingMode = textValue(body.billingMode, 30);
  if (
    billingMode &&
    !['unconfigured', 'free', 'external'].includes(billingMode)
  ) {
    throw new ResponseError(400, '模型计费模式无效');
  }
  const priorityValue = Number(body.routingPriority);
  const routingPriority = Number.isInteger(priorityValue)
    ? Math.max(0, Math.min(10000, priorityValue))
    : null;
  const result = await dbQuery(
    `UPDATE opentu_provider_models
     SET published = CASE WHEN $3::boolean IS NULL THEN published ELSE $3 END,
         gateway_enabled = CASE WHEN $4::boolean IS NULL THEN gateway_enabled ELSE $4 END,
         billing_mode = CASE WHEN $5::text IS NULL THEN billing_mode ELSE $5 END,
         routing_priority = CASE WHEN $6::integer IS NULL THEN routing_priority ELSE $6 END
     WHERE id = $1 AND provider_id = $2
     RETURNING id, model_id, published, available, gateway_enabled, billing_mode, routing_priority`,
    [
      modelId,
      providerId,
      typeof body.published === 'boolean' ? body.published : null,
      typeof body.gatewayEnabled === 'boolean' ? body.gatewayEnabled : null,
      billingMode || null,
      routingPriority,
    ]
  );
  if (!result.rows[0]) throw new ResponseError(404, '模型不存在');
  const row = result.rows[0];
  return {
    id: row.id,
    modelId: row.model_id,
    published: row.published,
    available: row.available,
    gatewayEnabled: row.gateway_enabled,
    billingMode: row.billing_mode,
    routingPriority: row.routing_priority,
  };
}

export default async function handler(
  request: ApiRequest,
  response: ApiResponse
) {
  try {
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method || '')) {
      response.setHeader?.('Allow', 'GET, POST, PATCH, DELETE');
      return sendJson(response, 405, { error: '不支持的请求方法' });
    }
    if (request.method !== 'GET') assertSameOrigin(request);
    await requireAdmin(request);
    await ensureSchema();
    const parts = pathParts(request);

    if (parts.length === 0) {
      if (request.method === 'GET') {
        const result = await dbQuery<ProviderRow>(
          'SELECT id, name, base_url, auth_type, auth_header, auth_query, extra_headers, encrypted_api_key, enabled, health_status, health_message, last_checked_at FROM opentu_provider_profiles ORDER BY created_at DESC'
        );
        return sendJson(response, 200, {
          data: result.rows.map(providerPublic),
        });
      }
      if (request.method === 'POST')
        return sendJson(response, 201, { data: await createProvider(request) });
      throw new ResponseError(405, '集合资源不支持此方法');
    }

    const providerId = parts[0];
    if (parts[1] === 'test' && request.method === 'POST') {
      return sendJson(response, 200, { data: await testProvider(providerId) });
    }
    if (parts[1] === 'sync-models' && request.method === 'POST') {
      return sendJson(response, 200, {
        data: await syncProviderModels(providerId),
      });
    }
    if (parts[1] === 'models') {
      if (parts.length === 2 && request.method === 'GET') {
        return sendJson(response, 200, { data: await listModels(providerId) });
      }
      if (parts.length === 3 && request.method === 'PATCH') {
        return sendJson(response, 200, {
          data: await publishModel(request, providerId, parts[2]),
        });
      }
    }
    if (parts.length === 1 && request.method === 'PATCH') {
      return sendJson(response, 200, {
        data: await updateProvider(request, providerId),
      });
    }
    if (parts.length === 1 && request.method === 'DELETE') {
      await findProvider(providerId);
      await dbQuery('DELETE FROM opentu_provider_profiles WHERE id = $1', [
        providerId,
      ]);
      response.status(204).end();
      return;
    }
    throw new ResponseError(404, '管理接口不存在');
  } catch (error) {
    if (error instanceof ResponseError)
      return sendJson(response, error.status, { error: error.message });
    console.error(
      '[OpenTu provider admin]',
      error instanceof Error ? error.message : 'unknown error'
    );
    return sendJson(response, 500, { error: '供应商服务暂时不可用' });
  }
}
