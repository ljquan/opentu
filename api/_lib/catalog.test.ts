import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from './http';
const { query, schema } = vi.hoisted(() => ({
  query: vi.fn(),
  schema: vi.fn(),
}));
vi.mock('./db', () => ({ dbQuery: query, ensureSchema: schema }));
import handler from '../catalog/models';

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());
const response = (): ApiResponse => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn(),
  end: vi.fn(),
});

describe('free launch public catalog', () => {
  it('returns no invokable models when paused without querying the database', async () => {
    vi.stubEnv('OPENTU_PUBLIC_GENERATION_ENABLED', 'false');
    const res = response();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
    expect(schema).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it('filters billing and supported operations before choosing route priority', async () => {
    vi.stubEnv('OPENTU_PUBLIC_GENERATION_ENABLED', 'true');
    const res = response();
    await handler({ method: 'GET', headers: {} }, res);
    const statement = query.mock.calls[0][0] as string;
    expect(statement).toContain("m.billing_mode = 'free'");
    expect(statement).toContain("m.category IN ('text', 'research', 'image')");
    expect(statement.indexOf("m.billing_mode = 'free'")).toBeLessThan(
      statement.indexOf('ORDER BY m.model_id')
    );
  });
});
