import { randomUUID } from 'node:crypto';
import { dbQuery, dbTransaction } from '../db';
import type { SessionAccount } from '../auth';
import type { ProviderAuthType, ProviderRecord } from '../provider';
import { GenerationGatewayError } from './errors';
import { assertPublicGenerationEnabled, launchLimits } from './launch-policy';
import type {
  CreateGenerationTaskRequest,
  GenerationBillingMode,
  GenerationRoute,
  GenerationTaskRow,
  GenerationUsage,
  PublicGenerationTask,
} from './types';

const TASK_COLUMNS = `id, user_id, user_role, idempotency_key, request_hash,
  public_model_id, provider_model_record_id, provider_id, operation, status,
  input_json, parameters_json, references_json, result_json, error_code,
  error_message, error_retryable, upstream_task_id, upstream_status,
  attempt_count, next_poll_at, cancel_requested_at, started_at, completed_at,
  billing_mode, billable, created_at, updated_at`;

type RouteRow = ProviderRecord & {
  provider_model_record_id: string;
  model_id: string;
  category: GenerationRoute['category'];
  billing_mode: GenerationBillingMode;
  routing_priority: number;
};

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function routeFromRow(row: RouteRow): GenerationRoute {
  return {
    provider: {
      id: row.id,
      name: row.name,
      base_url: row.base_url,
      auth_type: row.auth_type as ProviderAuthType,
      auth_header: row.auth_header,
      auth_query: row.auth_query,
      extra_headers: jsonObject(row.extra_headers) as Record<string, string>,
      encrypted_api_key: row.encrypted_api_key,
      enabled: row.enabled,
      health_status: row.health_status,
      health_message: row.health_message,
      last_checked_at: row.last_checked_at,
    },
    providerModelRecordId: row.provider_model_record_id,
    modelId: row.model_id,
    category: row.category,
    billingMode: row.billing_mode,
    routingPriority: Number(row.routing_priority) || 100,
  };
}

export async function resolveGenerationRoute(
  request: CreateGenerationTaskRequest
): Promise<GenerationRoute> {
  const categories =
    request.operation === 'text' ? ['text', 'research'] : [request.operation];
  const result = await dbQuery<RouteRow>(
    `SELECT p.id, p.name, p.base_url, p.auth_type, p.auth_header, p.auth_query,
            p.extra_headers, p.encrypted_api_key, p.enabled, p.health_status,
            p.health_message, p.last_checked_at,
            m.id AS provider_model_record_id, m.model_id, m.category,
            m.billing_mode, m.routing_priority
     FROM opentu_provider_models m
     INNER JOIN opentu_provider_profiles p ON p.id = m.provider_id
     WHERE m.model_id = $1
       AND m.category = ANY($2::text[])
       AND m.available = TRUE
       AND m.published = TRUE
       AND m.gateway_enabled = TRUE
       AND m.billing_mode = 'free'
       AND p.enabled = TRUE
       AND p.health_status = 'healthy'
     ORDER BY m.routing_priority ASC, p.id ASC
     LIMIT 1`,
    [request.modelId, categories]
  );
  const row = result.rows[0];
  if (!row) {
    throw new GenerationGatewayError(
      404,
      'MODEL_NOT_AVAILABLE',
      '所选模型当前不可用，请重新选择'
    );
  }
  return routeFromRow(row);
}

export async function resolveStoredTaskRoute(
  task: GenerationTaskRow
): Promise<GenerationRoute> {
  if (!task.provider_model_record_id) {
    throw new GenerationGatewayError(
      409,
      'TASK_ROUTE_MISSING',
      '任务路由不可用'
    );
  }
  const result = await dbQuery<RouteRow>(
    `SELECT p.id, p.name, p.base_url, p.auth_type, p.auth_header, p.auth_query,
            p.extra_headers, p.encrypted_api_key, p.enabled, p.health_status,
            p.health_message, p.last_checked_at,
            m.id AS provider_model_record_id, m.model_id, m.category,
            m.billing_mode, m.routing_priority
     FROM opentu_provider_models m
     INNER JOIN opentu_provider_profiles p ON p.id = m.provider_id
     WHERE m.id = $1 AND p.enabled = TRUE AND p.health_status = 'healthy'
       AND m.available = TRUE AND m.published = TRUE AND m.gateway_enabled = TRUE
       AND m.billing_mode = 'free'
     LIMIT 1`,
    [task.provider_model_record_id]
  );
  const row = result.rows[0];
  if (!row) {
    throw new GenerationGatewayError(
      409,
      'TASK_ROUTE_MISSING',
      '任务路由不可用'
    );
  }
  return routeFromRow(row);
}

export async function enforceBillingBoundary(
  _account: SessionAccount,
  route: GenerationRoute,
  _canaryRequested: boolean
): Promise<{ billable: boolean; mode: GenerationBillingMode }> {
  void _canaryRequested;
  if (route.billingMode === 'free') return { billable: false, mode: 'free' };
  throw new GenerationGatewayError(
    503,
    'BILLING_UNAVAILABLE',
    '该模型的余额结算尚未启用，请联系管理员'
  );
}

export async function consumeGenerationRateLimit(
  account: SessionAccount,
  operation: string
): Promise<void> {
  const configured = Number(
    process.env.OPENTU_GENERATION_RATE_LIMIT_PER_MINUTE
  );
  const baseLimit =
    Number.isFinite(configured) && configured > 0 ? configured : 12;
  const limit = account.role >= 5 ? Math.max(baseLimit, 60) : baseLimit;
  const result = await dbQuery(
    `INSERT INTO opentu_generation_rate_limits
       (user_id, operation, bucket_start, request_count)
     VALUES ($1, $2, date_trunc('minute', NOW()), 1)
     ON CONFLICT (user_id, operation, bucket_start)
     DO UPDATE SET request_count = opentu_generation_rate_limits.request_count + 1
       WHERE opentu_generation_rate_limits.request_count < $3
     RETURNING request_count`,
    [account.id, operation, limit]
  );
  if (!result.rows[0]) {
    throw new GenerationGatewayError(
      429,
      'RATE_LIMITED',
      '生成请求过于频繁，请稍后再试',
      true
    );
  }
}

export async function findTaskByIdempotency(
  userId: string,
  idempotencyKey: string
): Promise<GenerationTaskRow | null> {
  const result = await dbQuery<GenerationTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM opentu_generation_tasks
     WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, idempotencyKey]
  );
  const task = result.rows[0];
  if (task && ['submitting', 'cancel_requested'].includes(task.status)) {
    return findOwnedTask(userId, task.id);
  }
  return task || null;
}

export async function findOwnedTask(
  userId: string,
  taskId: string
): Promise<GenerationTaskRow> {
  // An interrupted synchronous submission has an unknown upstream outcome.
  // Never resubmit it automatically: the provider may already have charged it.
  await dbQuery(
    `WITH expired AS (
      UPDATE opentu_generation_tasks
      SET status = 'failed', error_code = 'UPSTREAM_OUTCOME_UNKNOWN',
          error_message = '执行连接已中断，上游结果待核对，请勿重复提交',
          error_retryable = FALSE, completed_at = NOW(), updated_at = NOW(),
          lease_token = NULL, lease_expires_at = NULL
      WHERE id = $1 AND user_id = $2
        AND status IN ('submitting', 'cancel_requested')
        AND lease_expires_at < NOW()
      RETURNING id, attempt_count
    ) UPDATE opentu_generation_task_attempts a
      SET status = 'failed', error_code = 'UPSTREAM_OUTCOME_UNKNOWN', completed_at = NOW()
      FROM expired e WHERE a.task_id = e.id AND a.attempt_number = e.attempt_count`,
    [taskId, userId]
  );
  const result = await dbQuery<GenerationTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM opentu_generation_tasks
     WHERE id = $1 AND user_id = $2`,
    [taskId, userId]
  );
  const task = result.rows[0];
  if (!task) {
    throw new GenerationGatewayError(404, 'TASK_NOT_FOUND', '任务不存在');
  }
  return task;
}

export async function insertGenerationTask(params: {
  account: SessionAccount;
  idempotencyKey: string;
  requestHash: string;
  request: CreateGenerationTaskRequest;
  route: GenerationRoute;
  billing: { billable: boolean; mode: GenerationBillingMode };
}): Promise<{ task: GenerationTaskRow; inserted: boolean }> {
  assertPublicGenerationEnabled();
  const limits = launchLimits();
  return dbTransaction(async (query) => {
    // All task admission takes the same short database lock across serverless instances.
    await query(
      "SELECT pg_advisory_xact_lock(hashtext('opentu-generation-admission'))"
    );
    const prior = await query<GenerationTaskRow>(
      `SELECT ${TASK_COLUMNS} FROM opentu_generation_tasks WHERE user_id = $1 AND idempotency_key = $2`,
      [params.account.id, params.idempotencyKey]
    );
    if (prior.rows[0]) return { task: prior.rows[0], inserted: false };
    const counts = await query(
      `SELECT
      count(*) FILTER (WHERE status IN ('queued', 'submitting', 'running', 'cancel_requested')) AS global_active,
      count(*) FILTER (WHERE status IN ('queued', 'submitting', 'running', 'cancel_requested') AND user_id = $1) AS user_active,
      count(*) FILTER (WHERE status IN ('queued', 'submitting', 'running', 'cancel_requested') AND provider_id = $2) AS provider_active,
      count(*) FILTER (WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS global_daily,
      count(*) FILTER (WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND user_id = $1) AS user_daily
     FROM opentu_generation_tasks
     WHERE status IN ('queued', 'submitting', 'running', 'cancel_requested')
        OR created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [params.account.id, params.route.provider.id]
    );
    const count = counts.rows[0];
    if (!count)
      throw new GenerationGatewayError(
        503,
        'CAPACITY_UNAVAILABLE',
        '无法确认生成服务容量'
      );
    if (
      Number(count.global_daily) >= limits.globalDaily ||
      Number(count.user_daily) >= limits.userDaily
    ) {
      throw new GenerationGatewayError(
        429,
        'DAILY_LIMIT_REACHED',
        '今日生成额度已用完'
      );
    }
    if (
      Number(count.global_active) >= limits.globalActive ||
      Number(count.user_active) >= limits.userActive ||
      Number(count.provider_active) >= limits.providerActive
    ) {
      throw new GenerationGatewayError(
        429,
        'GENERATION_CAPACITY_REACHED',
        '生成服务繁忙，请稍后再试',
        true
      );
    }
    const id = randomUUID();
    const result = await query<GenerationTaskRow>(
      `INSERT INTO opentu_generation_tasks
       (id, user_id, user_role, idempotency_key, request_hash, public_model_id,
        provider_model_record_id, provider_id, operation, input_json,
        parameters_json, references_json, context_json, billing_mode, billable)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
        $12::jsonb, $13::jsonb, $14, $15)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING ${TASK_COLUMNS}`,
      [
        id,
        params.account.id,
        params.account.role,
        params.idempotencyKey,
        params.requestHash,
        params.request.modelId,
        params.route.providerModelRecordId,
        params.route.provider.id,
        params.request.operation,
        JSON.stringify(params.request.input),
        JSON.stringify(params.request.parameters),
        JSON.stringify(params.request.references),
        JSON.stringify(params.request.context),
        params.billing.mode,
        params.billing.billable,
      ]
    );
    if (result.rows[0]) return { task: result.rows[0], inserted: true };
    const existing = (
      await query<GenerationTaskRow>(
        `SELECT ${TASK_COLUMNS} FROM opentu_generation_tasks WHERE user_id = $1 AND idempotency_key = $2`,
        [params.account.id, params.idempotencyKey]
      )
    ).rows[0];
    if (!existing) {
      throw new GenerationGatewayError(
        409,
        'TASK_CREATE_CONFLICT',
        '任务创建冲突，请重试'
      );
    }
    return { task: existing, inserted: false };
  });
}

export async function acquireSubmissionLease(
  taskId: string,
  userId: string
): Promise<{ task: GenerationTaskRow; leaseToken: string } | null> {
  const leaseToken = randomUUID();
  const result = await dbQuery<GenerationTaskRow>(
    `UPDATE opentu_generation_tasks
     SET status = 'submitting', lease_token = $3,
         lease_expires_at = NOW() + INTERVAL '70 seconds',
         attempt_count = attempt_count + 1,
         started_at = COALESCE(started_at, NOW()), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'queued'
     RETURNING ${TASK_COLUMNS}`,
    [taskId, userId, leaseToken]
  );
  return result.rows[0] ? { task: result.rows[0], leaseToken } : null;
}

export async function startAttempt(
  task: GenerationTaskRow,
  providerId: string
): Promise<string> {
  const id = randomUUID();
  await dbQuery(
    `INSERT INTO opentu_generation_task_attempts
       (id, task_id, attempt_number, provider_id, status)
     VALUES ($1, $2, $3, $4, 'submitting')
     ON CONFLICT (task_id, attempt_number) DO NOTHING`,
    [id, task.id, task.attempt_count, providerId]
  );
  return id;
}

export async function completeTaskSuccess(params: {
  taskId: string;
  userId: string;
  leaseToken: string;
  attemptId: string;
  result: Record<string, unknown>;
  usage?: GenerationUsage;
}): Promise<GenerationTaskRow> {
  return dbTransaction(async (query) => {
    const result = await query<GenerationTaskRow>(
      `UPDATE opentu_generation_tasks
     SET status = CASE WHEN status = 'cancel_requested' THEN 'cancelled'
                       ELSE 'succeeded' END,
         result_json = CASE WHEN status = 'cancel_requested' THEN NULL
                            ELSE $4::jsonb END,
         error_code = NULL,
         error_message = NULL, error_retryable = FALSE, completed_at = NOW(),
         lease_token = NULL, lease_expires_at = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND lease_token = $3
     RETURNING ${TASK_COLUMNS}`,
      [
        params.taskId,
        params.userId,
        params.leaseToken,
        JSON.stringify(params.result),
      ]
    );
    const task = result.rows[0];
    if (!task) {
      throw new GenerationGatewayError(
        409,
        'TASK_LEASE_LOST',
        '任务执行状态已发生变化'
      );
    }
    await query(
      `UPDATE opentu_generation_task_attempts
     SET status = 'succeeded', completed_at = NOW()
     WHERE id = $1 AND task_id = $2`,
      [params.attemptId, params.taskId]
    );
    if (params.usage) {
      await query(
        `INSERT INTO opentu_generation_task_usage
         (task_id, input_tokens, output_tokens, total_tokens, generated_count,
          duration_seconds, provider_usage)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (task_id) DO UPDATE SET
         input_tokens = EXCLUDED.input_tokens,
         output_tokens = EXCLUDED.output_tokens,
         total_tokens = EXCLUDED.total_tokens,
         generated_count = EXCLUDED.generated_count,
         duration_seconds = EXCLUDED.duration_seconds,
         provider_usage = EXCLUDED.provider_usage,
         updated_at = NOW()`,
        [
          params.taskId,
          params.usage.inputTokens ?? null,
          params.usage.outputTokens ?? null,
          params.usage.totalTokens ?? null,
          params.usage.generatedCount ?? null,
          params.usage.durationSeconds ?? null,
          JSON.stringify(params.usage.provider || {}),
        ]
      );
    }
    return task;
  });
}

export async function completeTaskFailure(params: {
  taskId: string;
  userId: string;
  leaseToken: string;
  attemptId: string;
  code: string;
  message: string;
  retryable: boolean;
  upstreamStatus?: number;
}): Promise<GenerationTaskRow> {
  const task = await dbTransaction(async (query) => {
    const result = await query<GenerationTaskRow>(
      `UPDATE opentu_generation_tasks
     SET status = CASE WHEN status = 'cancel_requested' THEN 'cancelled'
                       ELSE 'failed' END,
         error_code = CASE WHEN status = 'cancel_requested' THEN NULL ELSE $4 END,
         error_message = CASE WHEN status = 'cancel_requested' THEN NULL ELSE $5 END,
         error_retryable = CASE WHEN status = 'cancel_requested' THEN FALSE ELSE $6 END,
         completed_at = NOW(), lease_token = NULL,
         lease_expires_at = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND lease_token = $3
     RETURNING ${TASK_COLUMNS}`,
      [
        params.taskId,
        params.userId,
        params.leaseToken,
        params.code,
        params.message,
        params.retryable,
      ]
    );
    if (result.rows[0]) {
      await query(
        `UPDATE opentu_generation_task_attempts
       SET status = 'failed', upstream_status = $2, error_code = $3,
           completed_at = NOW()
       WHERE id = $1 AND task_id = $4`,
        [
          params.attemptId,
          params.upstreamStatus ?? null,
          params.code,
          params.taskId,
        ]
      );
    }
    return result.rows[0];
  });
  return task || findOwnedTask(params.userId, params.taskId);
}

export async function cancelOwnedTask(
  userId: string,
  taskId: string
): Promise<GenerationTaskRow> {
  const result = await dbQuery<GenerationTaskRow>(
    `UPDATE opentu_generation_tasks
     SET status = CASE WHEN status = 'queued' THEN 'cancelled'
                       WHEN status IN ('submitting', 'running') THEN 'cancel_requested'
                       ELSE status END,
         cancel_requested_at = CASE WHEN status IN ('queued', 'submitting', 'running')
                                    THEN COALESCE(cancel_requested_at, NOW())
                                    ELSE cancel_requested_at END,
         completed_at = CASE WHEN status = 'queued' THEN NOW() ELSE completed_at END,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING ${TASK_COLUMNS}`,
    [taskId, userId]
  );
  const task = result.rows[0];
  if (!task) {
    throw new GenerationGatewayError(404, 'TASK_NOT_FOUND', '任务不存在');
  }
  return task;
}

function dateValue(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function publicTask(task: GenerationTaskRow): PublicGenerationTask {
  return {
    id: task.id,
    modelId: task.public_model_id,
    operation: task.operation,
    status: task.status,
    result: task.result_json || null,
    error: task.error_code
      ? {
          code: task.error_code,
          message: task.error_message || '任务失败',
          retryable: Boolean(task.error_retryable),
        }
      : null,
    attemptCount: Number(task.attempt_count) || 0,
    nextPollAt: dateValue(task.next_poll_at),
    cancelRequestedAt: dateValue(task.cancel_requested_at),
    startedAt: dateValue(task.started_at),
    completedAt: dateValue(task.completed_at),
    createdAt: dateValue(task.created_at) || '',
    updatedAt: dateValue(task.updated_at) || '',
  };
}
