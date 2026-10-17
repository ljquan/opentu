import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from './http';

const { query, transactionQuery, transaction, fetchModels } = vi.hoisted(
  () => ({
    query: vi.fn(),
    transactionQuery: vi.fn(),
    transaction: vi.fn(),
    fetchModels: vi.fn(),
  })
);
vi.mock('./db', () => ({
  dbQuery: query,
  dbTransaction: transaction,
  ensureSchema: vi.fn(),
}));
vi.mock('./auth', async (original) => ({
  ...(await original<typeof import('./auth')>()),
  assertSameOrigin: vi.fn(),
  requireAdmin: vi.fn(),
}));
vi.mock('./provider', async (original) => ({
  ...(await original<typeof import('./provider')>()),
  fetchProviderModels: fetchModels,
}));
import handler from '../admin/providers/[...path]';

const provider = {
  id: 'provider',
  updated_at: '2026-09-01T00:00:00.000Z',
  last_checked_at: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue({ rows: [provider] });
  transactionQuery.mockResolvedValue({ rows: [provider] });
  transaction.mockImplementation(async (work) => work(transactionQuery));
  fetchModels.mockResolvedValue([
    { id: 'model-a', name: 'A' },
    { id: 'model-a', name: 'A' },
  ]);
});

async function sync() {
  const response: ApiResponse = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
  };
  await handler(
    {
      method: 'POST',
      headers: {},
      query: { path: ['provider', 'sync-models'] },
    },
    response
  );
  return response;
}

describe('provider model sync', () => {
  it('locks the provider and batches deduplicated models in one transaction', async () => {
    const response = await sync();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(transaction).toHaveBeenCalledOnce();
    expect(transactionQuery.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(transactionQuery.mock.calls[1][0]).toContain('jsonb_to_recordset');
    expect(JSON.parse(transactionQuery.mock.calls[1][1][1])).toHaveLength(1);
    expect(transactionQuery.mock.calls[2][1]).toEqual([
      'provider',
      ['model-a'],
    ]);
    expect(
      query.mock.calls.every(([statement]) => statement.startsWith('SELECT'))
    ).toBe(true);
  });

  it('does not retire old models when a batch write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    transactionQuery
      .mockResolvedValueOnce({ rows: [provider] })
      .mockRejectedValueOnce(new Error('write failed'));
    const response = await sync();
    expect(response.status).toHaveBeenCalledWith(500);
    expect(transactionQuery).toHaveBeenCalledTimes(2);
    expect(
      query.mock.calls.every(([statement]) => statement.startsWith('SELECT'))
    ).toBe(true);
    vi.restoreAllMocks();
  });

  it('rejects a stale upstream response after the provider configuration changes', async () => {
    transactionQuery.mockResolvedValueOnce({
      rows: [{ ...provider, updated_at: '2026-09-02T00:00:00.000Z' }],
    });
    const response = await sync();
    expect(response.status).toHaveBeenCalledWith(409);
    expect(transactionQuery).toHaveBeenCalledOnce();
  });
});
