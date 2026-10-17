import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

let pool: Pool | undefined;
let auth: ReturnType<typeof createAuth> | undefined;

export function localAuthEnabled() { return process.env.OPENTU_AUTH_MODE === 'local'; }

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET || '';
  if (secret.length < 32) throw new Error('Independent account secret is not configured');
  const base = new URL(process.env.BETTER_AUTH_URL || '');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(loopback && base.protocol === 'http:')) throw new Error('Account origin must use HTTPS');
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid account origin');
  pool = new Pool({ connectionString: process.env.POSTGRES_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  return betterAuth({
    appName: 'FoxVue', baseURL: base.origin, basePath: '/api/auth', secret,
    database: pool,
    trustedOrigins: [base.origin],
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      disableSignUp: process.env.OPENTU_REGISTRATION_ENABLED !== 'true',
      autoSignIn: true,
    },
    user: { modelName: 'opentu_auth_user', additionalFields: {
      appRole: { type: 'number', defaultValue: 0, input: false },
      disabled: { type: 'boolean', defaultValue: false, input: false },
    } },
    session: { modelName: 'opentu_auth_session', expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    account: { modelName: 'opentu_auth_account' },
    verification: { modelName: 'opentu_auth_verification' },
    rateLimit: { enabled: true, storage: 'database', modelName: 'opentu_auth_rate_limit', window: 60, max: 60, customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/change-password': { window: 60, max: 3 },
    } },
    advanced: { useSecureCookies: base.protocol === 'https:', cookiePrefix: 'opentu', defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' }, ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
  });
}
export function getLocalAuth() { return auth ||= createAuth(); }
export async function closeLocalAuth() { await pool?.end(); pool = undefined; auth = undefined; }
