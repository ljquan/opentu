const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run(overrides = {}) {
  return spawnSync(process.execPath, [path.join(__dirname, 'check-production-config.cjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      POSTGRES_URL: 'postgres://test:synthetic-password@db.invalid/test?sslmode=require',
      POSTGRES_URL_NON_POOLING: '',
      OPENTU_PROVIDER_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
      CRON_SECRET: 'synthetic-cron-secret-for-tests-only',
      OPENTU_PUBLIC_GENERATION_ENABLED: 'false',
      VITE_OPENTU_SERVER_CATALOG: 'true',
      VITE_OPENTU_MANAGED_GENERATION: 'true',
      OPENTU_AUTH_MODE: 'local',
      OPENTU_TRUST_PROXY: 'true',
      BETTER_AUTH_SECRET: 'synthetic-auth-secret-long-enough-for-tests',
      BETTER_AUTH_URL: 'https://accounts.invalid',
      OPENTU_REGISTRATION_ENABLED: 'false',
      TUZI_SESSION_API_BASE_URL: 'https://accounts.invalid',
      OPENTU_GENERATION_GLOBAL_CONCURRENCY: '4',
      OPENTU_GENERATION_PROVIDER_CONCURRENCY: '2',
      OPENTU_GENERATION_USER_CONCURRENCY: '1',
      OPENTU_GENERATION_GLOBAL_DAILY_LIMIT: '100',
      OPENTU_GENERATION_USER_DAILY_LIMIT: '10',
      ...overrides,
    },
  });
}

test('validates syntax offline without printing credentials', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Configuration syntax passed/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-password|synthetic-cron-secret/);
});

test('rejects missing dependencies and unsafe limits without exposing values', () => {
  const result = run({ POSTGRES_URL: '', CRON_SECRET: '', OPENTU_GENERATION_GLOBAL_CONCURRENCY: '0' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /POSTGRES_URL/);
  assert.match(result.stderr, /CRON_SECRET/);
  assert.match(result.stderr, /limits are invalid/);
});

test('rejects plaintext database transport', () => {
  const result = run({ POSTGRES_URL: 'postgres://test:synthetic-password@db.invalid/test' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require TLS/);
  assert.doesNotMatch(result.stderr, /synthetic-password/);
});

test('requires the production frontend to use managed generation', () => {
  const result = run({ VITE_OPENTU_MANAGED_GENERATION: 'false' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /VITE_OPENTU_MANAGED_GENERATION/);
});

test('requires independent auth and trusted proxy identity', () => {
  for (const overrides of [
    { OPENTU_AUTH_MODE: '' },
    { OPENTU_AUTH_MODE: 'remote' },
    { OPENTU_TRUST_PROXY: 'false' },
  ]) {
    const result = run(overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /OPENTU_AUTH_MODE|OPENTU_TRUST_PROXY/);
  }
});

test('requires secure independent auth configuration without leaking secrets', () => {
  const valid = {
    OPENTU_AUTH_MODE: 'local',
    BETTER_AUTH_SECRET: 'synthetic-auth-secret-long-enough-for-tests',
    BETTER_AUTH_URL: 'https://accounts.invalid',
    OPENTU_REGISTRATION_ENABLED: 'false',
  };
  assert.equal(run(valid).status, 0);
  for (const overrides of [
    { BETTER_AUTH_SECRET: 'short-secret' },
    { BETTER_AUTH_URL: 'http://localhost:7310' },
    { BETTER_AUTH_URL: 'https://user:password@accounts.invalid' },
    { BETTER_AUTH_URL: 'https://accounts.invalid/path' },
    { OPENTU_REGISTRATION_ENABLED: '' },
  ]) {
    const result = run({ ...valid, ...overrides });
    assert.equal(result.status, 1, result.stdout);
    assert.doesNotMatch(result.stderr, /synthetic-auth-secret|short-secret|user:password/);
  }
});
