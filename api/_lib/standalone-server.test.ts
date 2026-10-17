import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
vi.mock('./db', () => ({ ensureSchema: vi.fn().mockResolvedValue(undefined), dbQuery: vi.fn() }));
import { createApiServer } from './standalone-server';
import { ensureSchema } from './db';
const server = createApiServer();
let base = '';
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
describe('standalone HTTP boundary', () => {
  it('checks database readiness and never returns frontend HTML for an unknown API', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    vi.mocked(ensureSchema).mockRejectedValueOnce(new Error('private database address'));
    const unhealthy = await fetch(`${base}/api/health`);
    expect(unhealthy.status).toBe(503);
    expect(await unhealthy.text()).not.toContain('private database');
    expect((await fetch(`${base}/api/unknown`)).status).toBe(404);
  });
  it('rejects an anonymous session without caching it', async () => {
    const result = await fetch(`${base}/api/session`);
    expect(result.status).toBe(401);
    expect(result.headers.get('cache-control')).toContain('no-store');
  });
  it('reports an anonymous browser session without a failed resource request', async () => {
    const result = await fetch(`${base}/api/session-status`);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(await result.json()).toEqual({ data: null });
  });
  it('does not allow forwarded-host spoofing to bypass origin checks', async () => {
    const result = await fetch(`${base}/api/generation/tasks`, {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'X-Forwarded-Host': 'attacker.example', 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(result.status).toBe(403);
  });
  it('rejects malformed JSON before handler execution', async () => {
    const result = await fetch(`${base}/api/generation/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });
  });
});
