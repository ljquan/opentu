import { dbTransaction } from '../db';

export async function reconcileInterruptedTasks(): Promise<number> {
  return dbTransaction(async (query) => {
    const expired = await query(
      `WITH candidates AS (
        SELECT id FROM opentu_generation_tasks
        WHERE (status IN ('submitting', 'cancel_requested') AND lease_expires_at < NOW())
           OR (status = 'queued' AND created_at < NOW() - INTERVAL '15 minutes')
        ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
      ), expired AS (
        UPDATE opentu_generation_tasks t
        SET status = 'failed',
            error_code = CASE WHEN t.status = 'queued' THEN 'QUEUE_EXPIRED' ELSE 'UPSTREAM_OUTCOME_UNKNOWN' END,
            error_message = CASE WHEN t.status = 'queued' THEN '任务排队已过期' ELSE '执行连接已中断，上游结果待核对，请勿重复提交' END,
            error_retryable = FALSE, lease_token = NULL, lease_expires_at = NULL,
            completed_at = NOW(), updated_at = NOW()
        FROM candidates c WHERE t.id = c.id RETURNING t.id, t.attempt_count, t.error_code
      ), attempts AS (
        UPDATE opentu_generation_task_attempts a
        SET status = 'failed', error_code = e.error_code, completed_at = NOW()
        FROM expired e WHERE a.task_id = e.id AND a.attempt_number = e.attempt_count
        RETURNING a.id
      ) SELECT id FROM expired`
    );
    await query(
      `DELETE FROM opentu_generation_rate_limits WHERE ctid IN (
        SELECT ctid FROM opentu_generation_rate_limits
        WHERE bucket_start < NOW() - INTERVAL '2 days'
        ORDER BY bucket_start LIMIT 1000
      )`
    );
    return expired.rows.length;
  });
}
