import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../api/_lib/standalone-server';
import { dbQuery, closeDatabase } from '../api/_lib/db';
import { generationRequestHash } from '../api/_lib/generation/input';

async function main() {
  const runId = randomUUID();
  const owner = `smoke-owner-${runId}`;
  const other = `smoke-other-${runId}`;
  const taskId = randomUUID();
  const key = `smoke-${runId}`;
  const input = { modelId: 'smoke-model', operation: 'text' as const, input: { prompt: 'Synthetic integration test' }, parameters: { maxTokens: 2048 }, references: [], context: {} };
  const identity = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const id = req.headers.cookie === 'smoke=owner' ? owner : req.headers.cookie === 'smoke=other' ? other : '';
    if (!id) res.statusCode = 401;
    res.end(JSON.stringify(id ? { data: { id, role: 1, username: 'smoke', quota: 0 } } : {}));
  });
  const api = createApiServer();
  try {
    await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
    process.env.TUZI_SESSION_API_BASE_URL = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
    // Applies only to this isolated smoke process, never the deployed service.
    process.env.OPENTU_PUBLIC_GENERATION_ENABLED = 'true';
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    await dbQuery(`INSERT INTO opentu_generation_tasks
      (id, user_id, user_role, idempotency_key, request_hash, public_model_id, operation, status, result_json)
      VALUES ($1,$2,1,$3,$4,'smoke-model','text','succeeded','{"text":"fixture"}')`, [taskId, owner, key, generationRequestHash(input)]);
    const call = (path: string, cookie: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...init.headers } });
    assert.equal((await call('/api/session', 'smoke=owner')).status, 200);
    assert.equal((await call('/api/session', 'expired')).status, 401);
    assert.equal((await call(`/api/generation/tasks/${taskId}`, 'smoke=owner')).status, 200);
    assert.equal((await call(`/api/generation/tasks/${taskId}`, 'smoke=other')).status, 404);
    assert.equal((await call(`/api/generation/tasks/${taskId}/cancel`, 'smoke=other', { method: 'POST' })).status, 404);
    const reused = await call('/api/generation/tasks', 'smoke=owner', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) });
    assert.equal(reused.status, 200);
    assert.equal((await reused.json()).data.id, taskId);
    assert.equal((await call('/api/generation/tasks', 'smoke=owner', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ ...input, input: { prompt: 'different request' } }) })).status, 409);
    await dbQuery("UPDATE opentu_generation_tasks SET status='queued', result_json=NULL WHERE id=$1 AND user_id=$2", [taskId, owner]);
    const cancelled = await call(`/api/generation/tasks/${taskId}/cancel`, 'smoke=owner', { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).data.status, 'cancelled');
    assert.equal((await call('/api/admin/providers', 'smoke=owner')).status, 403);
    console.log('PASS: real PostgreSQL + HTTP session/expiry/ownership/cancellation/idempotency/admin boundaries. Identity mocked; no model provider called.');
  } finally {
    await dbQuery('DELETE FROM opentu_generation_tasks WHERE id=$1 AND user_id=$2', [taskId, owner]);
    await Promise.all([new Promise<void>((resolve) => api.close(() => resolve())), new Promise<void>((resolve) => identity.close(() => resolve()))]);
    await closeDatabase();
  }
}
main().catch((error) => { console.error('Smoke check failed:', error instanceof Error ? error.name : 'UnknownError', error instanceof assert.AssertionError ? { actual: error.actual, expected: error.expected, stack: error.stack } : ''); process.exitCode = 1; });
