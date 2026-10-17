import { getHeader, type ApiRequest } from './http';
import { getLocalAuth, localAuthEnabled } from './local-auth';

export type SessionAccount = {
  id: string;
  role: number;
  username: string;
  quota: number | null;
};

function sessionApiBaseUrl(): string {
  return (process.env.TUZI_SESSION_API_BASE_URL || 'https://api.tu-zi.com').replace(
    /\/+$/,
    ''
  );
}

export async function requireUser(request: ApiRequest): Promise<SessionAccount> {
  const cookie = getHeader(request, 'cookie');
  if (!cookie) {
    throw new ResponseError(401, '请先登录');
  }
  if (localAuthEnabled()) {
    let session;
    try { session = await getLocalAuth().api.getSession({ headers: new Headers({ cookie }) }); }
    catch { throw new ResponseError(503, '账户服务暂时不可用'); }
    if (!session) throw new ResponseError(401, '登录已过期，请重新登录');
    if (session.user.disabled) throw new ResponseError(403, '当前账户不可用');
    return { id: session.user.id, role: session.user.appRole, username: session.user.name, quota: null };
  }

  let response: Response;
  try {
    response = await fetch(`${sessionApiBaseUrl()}/api/user/self`, {
      headers: { Accept: 'application/json', Cookie: cookie },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ResponseError(503, '账户服务暂时不可用');
  }
  if (response.status === 401) {
    throw new ResponseError(401, '登录已过期，请重新登录');
  }
  if (response.status === 403) {
    throw new ResponseError(403, '当前账户不可用');
  }
  if (!response.ok) {
    throw new ResponseError(503, '无法验证账户身份');
  }
  const payload = (await response.json()) as {
    data?: Record<string, unknown>;
  } & Record<string, unknown>;
  const account = payload.data || payload;
  const rawId = account?.id;
  const id =
    typeof rawId === 'string' || typeof rawId === 'number'
      ? String(rawId)
      : '';
  if (!id) {
    throw new ResponseError(503, '账户服务返回了无效身份');
  }
  const quotaValue = Number(account.quota);
  return {
    id,
    role: Number(account.role) || 0,
    username:
      typeof account.username === 'string' ? account.username.slice(0, 120) : '',
    quota: Number.isFinite(quotaValue) ? quotaValue : null,
  };
}

export async function requireAdmin(
  request: ApiRequest
): Promise<SessionAccount> {
  const account = await requireUser(request);
  if (account.role < 5) {
    throw new ResponseError(403, '当前账户没有管理员权限');
  }
  return account;
}

export function assertSameOrigin(request: ApiRequest): void {
  const origin = getHeader(request, 'origin');
  const fetchSite = getHeader(request, 'sec-fetch-site').toLowerCase();
  if (!origin) {
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      throw new ResponseError(403, '跨站请求已被拒绝');
    }
    return;
  }
  const forwardedHost = getHeader(request, 'x-forwarded-host');
  const host = forwardedHost || getHeader(request, 'host');
  try {
    const parsedOrigin = new URL(origin);
    const configuredOrigin = localAuthEnabled()
      ? new URL(process.env.BETTER_AUTH_URL || '').origin
      : null;
    if (
      parsedOrigin.host !== host ||
      (configuredOrigin && parsedOrigin.origin !== configuredOrigin) ||
      (process.env.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:')
    ) {
      throw new ResponseError(403, '跨站请求已被拒绝');
    }
  } catch (error) {
    if (error instanceof ResponseError) throw error;
    throw new ResponseError(403, '无效的请求来源');
  }
}

export class ResponseError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}
