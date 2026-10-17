import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db', () => ({
  dbQuery: vi.fn(),
  dbTransaction: vi.fn(async (work) => work(query)),
}));
import { completeTaskFailure, completeTaskSuccess, insertGenerationTask } from './repository';
import type { GenerationRoute } from './types';
import { dbTransaction } from '../db';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENTU_PUBLIC_GENERATION_ENABLED', 'true');
  query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe('transactional task admission', () => {
  const params = {
    account: { id: 'user', role: 10, username: 'user', quota: 100 },
    idempotencyKey: 'same-key', requestHash: 'hash',
    request: { modelId: 'model', operation: 'text' as const, input: { prompt: 'hello' }, parameters: {}, references: [], context: {} },
    route: { provider: { id: 'provider' }, modelId: 'model', providerModelRecordId: 'binding' } as GenerationRoute,
    billing: { billable: false, mode: 'free' as const },
  };
  const counts = { global_active: '0', user_active: '0', provider_active: '0', global_daily: '0', user_daily: '0' };
  it.each([
    ['global_active', '4', 'GENERATION_CAPACITY_REACHED'],
    ['user_active', '1', 'GENERATION_CAPACITY_REACHED'],
    ['provider_active', '2', 'GENERATION_CAPACITY_REACHED'],
    ['global_daily', '100', 'DAILY_LIMIT_REACHED'],
    ['user_daily', '10', 'DAILY_LIMIT_REACHED'],
  ])('rejects admission at %s limit even for administrators', async (field, count, code) => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...counts, [field]: count }] });
    await expect(insertGenerationTask(params)).rejects.toMatchObject({ code });
    expect(query.mock.calls.some(([statement]) => statement.includes('INSERT INTO opentu_generation_tasks'))).toBe(false);
  });
  it('returns an idempotent duplicate without consuming another admission', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'existing' }] });
    expect(await insertGenerationTask(params)).toEqual({ task: { id: 'existing' }, inserted: false });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('holds the shared lock through the capacity check and insert', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [counts] }).mockResolvedValueOnce({ rows: [{ id: 'new' }] });
    expect((await insertGenerationTask(params)).inserted).toBe(true);
    expect(dbTransaction).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[2][0]).toContain("AT TIME ZONE 'UTC'");
    expect(query.mock.calls[3][0]).toContain('INSERT INTO opentu_generation_tasks');
  });
});

describe('task completion transaction', () => {
  it('keeps task, attempt and usage writes in one transaction', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'task', status: 'succeeded' }],
    });
    await completeTaskSuccess({
      taskId: 'task',
      userId: 'user',
      leaseToken: 'lease',
      attemptId: 'attempt',
      result: { text: 'done' },
      usage: { totalTokens: 12 },
    });
    expect(dbTransaction).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][1]).toEqual([
      'task',
      'user',
      'lease',
      '{"text":"done"}',
    ]);
    expect(query.mock.calls[2][0]).toContain('opentu_generation_task_usage');
  });

  it('does not modify an attempt when the completion lease was lost', async () => {
    await expect(
      completeTaskSuccess({
        taskId: 'task',
        userId: 'user',
        leaseToken: 'old',
        attemptId: 'attempt',
        result: {},
      })
    ).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('scopes failure updates to the owner and current lease before touching attempts', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'task', status: 'failed' }] });
    await completeTaskFailure({
      taskId: 'task',
      userId: 'owner',
      leaseToken: 'lease',
      attemptId: 'attempt',
      code: 'UPSTREAM_BUSY',
      message: 'busy',
      retryable: true,
    });
    expect(query.mock.calls[0][0]).toContain(
      'user_id = $2 AND lease_token = $3'
    );
    expect(query.mock.calls[1][0]).toContain('task_id = $4');
  });
});
