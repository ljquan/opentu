const path = require('node:path');
require('ts-node').register({
  project: path.join(__dirname, '../api/tsconfig.json'),
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS' },
});
const { launchLimits } = require('../api/_lib/generation/launch-policy.ts');

const failures = [];
function requireValue(name) {
  const value = process.env[name];
  if (!value) failures.push(`${name} is required`);
  return value || '';
}
const databaseUrl =
  process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
if (!databaseUrl)
  failures.push('POSTGRES_URL or POSTGRES_URL_NON_POOLING is required');
else {
  try {
    const parsed = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      !parsed.password
    ) {
      failures.push(
        'Database URL must be a complete PostgreSQL connection string'
      );
    }
    const localPostgres = process.env.OPENTU_DATABASE_DRIVER === 'postgres' &&
      ['127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (!localPostgres &&
      !['require', 'verify-ca', 'verify-full'].includes(
        parsed.searchParams.get('sslmode')
      )
    ) {
      failures.push('Database URL must require TLS');
    }
  } catch {
    failures.push('Database URL is invalid');
  }
}
const key = requireValue('OPENTU_PROVIDER_ENCRYPTION_KEY');
if (
  key &&
  !/^[0-9a-f]{64}$/i.test(key) &&
  !(
    /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, 'base64').length === 32
  )
) {
  failures.push('OPENTU_PROVIDER_ENCRYPTION_KEY must encode exactly 32 bytes');
}
const cronSecret = requireValue('CRON_SECRET');
if (cronSecret && cronSecret.length < 32)
  failures.push('CRON_SECRET must contain at least 32 characters');
if (process.env.NODE_ENV !== 'production')
  failures.push('NODE_ENV must be production');
if (!['true', 'false'].includes(process.env.OPENTU_PUBLIC_GENERATION_ENABLED)) {
  failures.push(
    'OPENTU_PUBLIC_GENERATION_ENABLED must be explicitly true or false'
  );
}
if (process.env.VITE_OPENTU_SERVER_CATALOG !== 'true')
  failures.push('VITE_OPENTU_SERVER_CATALOG must be true');
if (process.env.VITE_OPENTU_MANAGED_GENERATION !== 'true')
  failures.push('VITE_OPENTU_MANAGED_GENERATION must be true in the production build');
if (process.env.OPENTU_AUTH_MODE !== 'local')
  failures.push('OPENTU_AUTH_MODE must be local for the independent account deployment');
if (process.env.OPENTU_AUTH_MODE === 'local') {
  const authSecret = requireValue('BETTER_AUTH_SECRET');
  if (authSecret && authSecret.length < 32)
    failures.push('BETTER_AUTH_SECRET must contain at least 32 characters');
  const authUrl = requireValue('BETTER_AUTH_URL');
  if (authUrl) {
    try {
      const parsed = new URL(authUrl);
      if (parsed.protocol !== 'https:') failures.push('BETTER_AUTH_URL must use HTTPS in production');
      if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) failures.push('BETTER_AUTH_URL must be an origin without credentials');
    } catch {
      failures.push('BETTER_AUTH_URL is invalid');
    }
  }
  if (!['true', 'false'].includes(process.env.OPENTU_REGISTRATION_ENABLED))
    failures.push('OPENTU_REGISTRATION_ENABLED must be explicitly true or false in local auth mode');
  if (process.env.OPENTU_TRUST_PROXY !== 'true')
    failures.push('OPENTU_TRUST_PROXY must be true behind the trusted public proxy');
}
if (process.env.TUZI_SESSION_API_BASE_URL) {
  try {
    const parsed = new URL(process.env.TUZI_SESSION_API_BASE_URL);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      failures.push('Session API must use HTTPS without URL credentials');
  } catch {
    failures.push('Session API URL is invalid');
  }
}
try {
  launchLimits();
} catch {
  failures.push('Generation admission limits are invalid');
}
if (failures.length) {
  failures.forEach((failure) =>
    console.error(`[production-config] ${failure}`)
  );
  process.exitCode = 1;
} else {
  console.log(
    '[production-config] Configuration syntax passed; no credentials were printed and no network requests were sent.'
  );
  console.log(
    '[production-config] This is not a launch approval. Verify migrations, identity isolation, provider budgets, task recovery and frontend gateway migration in staging.'
  );
}
