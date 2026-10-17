import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from '../http';
const { query, ensureSchema } = vi.hoisted(() => ({
  query: vi.fn(),
  ensureSchema: vi.fn(),
}));
vi.mock('../db', () => ({
  dbTransaction: vi.fn(async (work) => work(query)),
  ensureSchema,
}));
import handler from '../../internal/generation-maintenance';

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());
const response = (): ApiResponse => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
  end: vi.fn(),
  setHeader: vi.fn(),
});

describe('scheduled generation maintenance', () => {
  it('fails closed when the cron secret is missing', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = response();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(ensureSchema).not.toHaveBeenCalled();
  });
  it('rejects invalid authentication before accessing the database', async () => {
    vi.stubEnv('CRON_SECRET', 'a'.repeat(32));
    const res = response();
    await handler(
      { method: 'GET', headers: { authorization: 'Bearer wrong' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(query).not.toHaveBeenCalled();
  });
  it('reconciles a bounded batch and prunes only old rate buckets', async () => {
    vi.stubEnv('CRON_SECRET', 'a'.repeat(32));
    query.mockResolvedValueOnce({ rows: [{ id: 'expired' }] });
    const res = response();
    await handler(
      { method: 'GET', headers: { authorization: `Bearer ${'a'.repeat(32)}` } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: { reconciled: 1 } });
    expect(query.mock.calls[0][0]).toContain(
      'LIMIT 100 FOR UPDATE SKIP LOCKED'
    );
    expect(query.mock.calls[0][0]).toContain('UPSTREAM_OUTCOME_UNKNOWN');
    expect(query.mock.calls[1][0]).toContain('LIMIT 1000');
  });
});
