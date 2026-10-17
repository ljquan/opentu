import { afterEach, describe, expect, it, vi } from 'vitest';
const { query, release } = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(),
  Pool: class {
    query = query;
    connect = async () => ({ query, release });
  },
}));
import {
  dbTransaction,
  ensureSchema,
  migrateSchema,
  resetSchemaPromiseForTests,
} from './db';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  resetSchemaPromiseForTests();
});

describe('database transactions', () => {
  it('commits all writes on one connection', async () => {
    vi.stubEnv('POSTGRES_URL', 'postgres://test-only');
    query.mockResolvedValue({ rows: [] });
    await dbTransaction(async (run) => {
      await run('write-task');
      await run('write-usage');
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'write-task',
      'write-usage',
      'COMMIT',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the connection when a later write fails', async () => {
    vi.stubEnv('POSTGRES_URL', 'postgres://test-only');
    query.mockImplementation(async (sql) => {
      if (sql === 'write-usage') throw new Error('write failed');
      return { rows: [] };
    });
    await expect(
      dbTransaction(async (run) => {
        await run('write-task');
        await run('write-usage');
      })
    ).rejects.toThrow('write failed');
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'write-task',
      'write-usage',
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('schema migration boundary', () => {
  it('only checks the migration marker in production and caches success', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('POSTGRES_URL', 'postgres://test-only');
    query.mockResolvedValue({ rows: [{ version: '20260906-free-launch-v2' }] });
    await ensureSchema();
    await ensureSchema();
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual(['20260906-free-launch-v2']);
    expect(query.mock.calls[0][0]).toMatch(
      /^SELECT version FROM opentu_schema_migrations/
    );
    expect(release).not.toHaveBeenCalled();
  });

  it('rejects an unmigrated production database and rechecks after failure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('POSTGRES_URL', 'postgres://test-only');
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ version: 'ready' }] });
    await expect(ensureSchema()).rejects.toThrow(
      'Database migration is required'
    );
    await expect(ensureSchema()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rolls back DDL and never records a version when migration fails', async () => {
    vi.stubEnv('POSTGRES_URL', 'postgres://test-only');
    query.mockImplementation(async (statement) => {
      if (statement.includes('CREATE TABLE')) throw new Error('DDL failed');
      return { rows: [] };
    });
    await expect(migrateSchema()).rejects.toThrow('DDL failed');
    const statements = query.mock.calls.map(([statement]) => statement);
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(
      statements.some((statement) =>
        statement.includes('INSERT INTO opentu_schema_migrations')
      )
    ).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
