import { randomUUID, randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../api/_lib/standalone-server';
import { closeDatabase, dbQuery } from '../api/_lib/db';
import { closeLocalAuth } from '../api/_lib/local-auth';

async function main() {
  process.env.OPENTU_AUTH_MODE = 'local';
  process.env.OPENTU_TRUST_PROXY = 'true';
  const api = createApiServer();
  const marker = randomUUID();
  const email = `smoke-${marker}@example.invalid`;
  const secondEmail = `smoke-other-${marker}@example.invalid`;
  const password = randomBytes(20).toString('hex');
  const replacement = randomBytes(20).toString('hex');
  const taskId = randomUUID();
  const ids: string[] = [];
  try {
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    process.env.BETTER_AUTH_URL = base;
    const origin = base;
    const call = (path: string, body?: unknown, cookie = '', from = origin) => fetch(base + path, {
      method: body ? 'POST' : 'GET', headers: { Host: new URL(origin).host, 'Content-Type': 'application/json', Origin: from, Cookie: cookie, 'X-Real-IP': '192.0.2.199' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const cookieOf = (res: Response) => res.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
    let registered = await call('/api/auth/sign-up/email', { email, password, name: 'Smoke Owner', appRole: 9 });
    if (!registered.ok) {
      assert.equal(registered.status, 400, 'privileged signup rejection');
      registered = await call('/api/auth/sign-up/email', { email, password, name: 'Smoke Owner' });
    }
    assert.equal(registered.status, 200, 'registration');
    assert.match(registered.headers.getSetCookie().join(';'), /httponly/i, 'HttpOnly session');
    const firstCookie = cookieOf(registered);
    const registeredPayload = await registered.json();
    ids.push(registeredPayload.user.id);
    const session = await call('/api/session', undefined, firstCookie);
    assert.equal(session.status, 200, 'new session');
    assert.equal((await session.json()).data.role, 0, 'privilege injection rejected');
    const hash = await dbQuery('SELECT password FROM opentu_auth_account WHERE "userId"=$1', [ids[0]]);
    assert.ok(hash.rows[0].password && hash.rows[0].password !== password, 'password not stored in plaintext');
    const second = await call('/api/auth/sign-up/email', { email: secondEmail, password, name: 'Smoke Other' });
    assert.equal(second.status, 200, 'second registration');
    const secondCookie = cookieOf(second);
    ids.push((await second.json()).user.id);
    assert.equal((await call('/api/admin/providers', undefined, firstCookie)).status, 403, 'ordinary admin denial');
    await dbQuery(`INSERT INTO opentu_generation_tasks (id,user_id,idempotency_key,request_hash,public_model_id,operation,status) VALUES ($1,$2,$3,'fixture','fixture','text','queued')`, [taskId, ids[0], marker]);
    assert.equal((await call(`/api/generation/tasks/${taskId}`, undefined, secondCookie)).status, 404, 'foreign task read');
    assert.equal((await call(`/api/generation/tasks/${taskId}/cancel`, {}, secondCookie)).status, 404, 'foreign task cancel');
    assert.equal((await call(`/api/generation/tasks/${taskId}`, undefined, firstCookie)).status, 200, 'owner task read');
    assert.equal((await call('/api/auth/sign-out', {}, firstCookie, 'https://attacker.invalid')).status, 403, 'cross-origin logout');
    assert.equal((await call('/api/auth/sign-out', {}, firstCookie)).status, 200, 'logout');
    assert.equal((await call('/api/session', undefined, firstCookie)).status, 401, 'revoked cookie');
    const login = await call('/api/auth/sign-in/email', { email, password });
    assert.equal(login.status, 200, 'login');
    const cookie = cookieOf(login);
    const parallel = await call('/api/auth/sign-in/email', { email, password });
    assert.equal(parallel.status, 200, 'parallel session');
    const changed = await call('/api/auth/change-password', { currentPassword: password, newPassword: replacement, revokeOtherSessions: true }, cookie);
    assert.equal(changed.status, 200, 'change password');
    assert.equal((await call('/api/session', undefined, cookieOf(parallel))).status, 401, 'other session revoked');
    assert.equal((await call('/api/auth/sign-in/email', { email, password })).status, 401, 'old password rejected');
    assert.equal((await call('/api/auth/sign-in/email', { email, password: replacement })).status, 200, 'new password accepted');
    await dbQuery('UPDATE opentu_auth_session SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE "userId"=$1', [ids[1]]);
    assert.equal((await call('/api/session', undefined, secondCookie)).status, 401, 'expired cookie');
    await dbQuery('UPDATE opentu_auth_user SET disabled=TRUE WHERE id=$1', [ids[0]]);
    assert.equal((await call('/api/session', undefined, cookieOf(changed) || cookie)).status, 403, 'disabled account');
    let limited = false;
    for (let i = 0; i < 7; i++) { if ((await call('/api/auth/sign-in/email', { email, password: 'wrong-password-123' })).status === 429) { limited = true; break; } }
    assert.ok(limited, 'sign-in rate limit');
    console.log('PASS: real registration, login, password hash, session, logout, password change, session revocation, expiry, disabled account, CSRF, privilege and task isolation, rate limit. No provider called.');
  } finally {
    await dbQuery('DELETE FROM opentu_generation_tasks WHERE id=$1 AND user_id=ANY($2::text[])', [taskId, ids]);
    await dbQuery('DELETE FROM opentu_auth_user WHERE email=ANY($1::text[])', [[email, secondEmail]]);
    await dbQuery('DELETE FROM opentu_auth_rate_limit WHERE key LIKE $1', ['%192.0.2.199%']);
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await Promise.all([closeLocalAuth(), closeDatabase()]);
  }
}
main().catch((error) => {
  const reason = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  console.error('Account smoke failed:', reason);
  process.exitCode = 1;
});
