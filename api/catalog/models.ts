import { dbQuery, ensureSchema } from '../_lib/db';
import { sendJson, type ApiRequest, type ApiResponse } from '../_lib/http';
import { publicGenerationEnabled } from '../_lib/generation/launch-policy';

export default async function handler(
  request: ApiRequest,
  response: ApiResponse
) {
  if (request.method !== 'GET') {
    response.setHeader?.('Allow', 'GET');
    return sendJson(response, 405, { error: '不支持的请求方法' });
  }
  try {
    if (!publicGenerationEnabled())
      return sendJson(response, 200, { data: [] });
    await ensureSchema();
    const result = await dbQuery(
      `SELECT id, name, vendor, category, description, tags, accent, provider_name
       FROM (
         SELECT DISTINCT ON (m.model_id)
                m.model_id AS id, m.name, m.vendor, m.category, m.description,
                m.tags, m.accent, p.name AS provider_name, m.routing_priority
         FROM opentu_provider_models m
         INNER JOIN opentu_provider_profiles p ON p.id = m.provider_id
         WHERE p.enabled = TRUE AND p.health_status = 'healthy'
           AND m.available = TRUE AND m.published = TRUE AND m.gateway_enabled = TRUE
           AND m.billing_mode = 'free' AND m.category IN ('text', 'research', 'image')
         ORDER BY m.model_id, m.routing_priority ASC, p.id ASC
       ) selected_models
       ORDER BY name ASC`
    );
    return sendJson(response, 200, {
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        vendor: row.vendor || row.provider_name,
        category: row.category,
        description: row.description,
        tags: Array.isArray(row.tags) ? row.tags : [],
        accent: row.accent,
        provider: row.provider_name,
      })),
    });
  } catch (error) {
    console.error(
      '[OpenTu public catalog]',
      error instanceof Error ? error.message : 'unknown error'
    );
    return sendJson(response, 503, { error: '公开模型目录暂时不可用' });
  }
}
