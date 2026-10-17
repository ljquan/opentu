import { requireAdmin } from '../../_lib/auth';
import { dbQuery, ensureSchema } from '../../_lib/db';
import { queryValue, sendJson, type ApiRequest, type ApiResponse } from '../../_lib/http';
import {
  sendGenerationError,
  setGenerationResponseHeaders,
} from '../../_lib/generation/handler';

export default async function handler(request: ApiRequest, response: ApiResponse) {
  setGenerationResponseHeaders(response);
  if (request.method !== 'GET') {
    response.setHeader?.('Allow', 'GET');
    return sendJson(response, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: '不支持的请求方法', retryable: false },
    });
  }
  try {
    await requireAdmin(request);
    await ensureSchema();
    const requestedLimit = Number(queryValue(request, 'limit'));
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(1, Math.min(100, requestedLimit))
      : 30;
    const result = await dbQuery(
      `SELECT t.id, t.user_id, t.public_model_id, t.operation, t.status,
              t.error_code, t.error_retryable, t.attempt_count, t.started_at,
              t.completed_at, t.created_at, t.updated_at,
              p.name AS provider_name
       FROM opentu_generation_tasks t
       LEFT JOIN opentu_provider_profiles p ON p.id = t.provider_id
       ORDER BY t.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return sendJson(response, 200, {
      data: result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        modelId: row.public_model_id,
        operation: row.operation,
        status: row.status,
        provider: row.provider_name || null,
        errorCode: row.error_code || null,
        retryable: Boolean(row.error_retryable),
        attemptCount: Number(row.attempt_count) || 0,
        startedAt: row.started_at || null,
        completedAt: row.completed_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    return sendGenerationError(response, error);
  }
}

