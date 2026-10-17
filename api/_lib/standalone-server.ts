import { createServer, type IncomingMessage } from 'node:http';
import { type ApiRequest, type ApiResponse } from './http';
import { dbQuery, ensureSchema } from './db';
import catalog from '../catalog/models';
import createTask from '../generation/tasks';
import taskPath from '../generation/tasks/[...path]';
import providers from '../admin/providers/[...path]';
import adminTasks from '../admin/generation/tasks';
import maintenance from '../internal/generation-maintenance';
import session from '../session';
import sessionStatus from '../session-status';
import { getLocalAuth, localAuthEnabled } from './local-auth';
import { isIP } from 'node:net';

type Handler = (request: ApiRequest, response: ApiResponse) => unknown;
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export function resolveHandler(path: string): { handler: Handler; path?: string[] } | null {
  const exact: Record<string, Handler> = {
    '/api/session': session,
    '/api/session-status': sessionStatus,
    '/api/catalog/models': catalog,
    '/api/generation/tasks': createTask,
    '/api/admin/providers': providers,
    '/api/admin/generation/tasks': adminTasks,
    '/api/internal/generation-maintenance': maintenance,
  };
  if (Object.hasOwn(exact, path)) return { handler: exact[path] };
  for (const [prefix, handler] of [['/api/generation/tasks/', taskPath], ['/api/admin/providers/', providers]] as const) {
    if (path.startsWith(prefix)) return { handler, path: path.slice(prefix.length).split('/') };
  }
  return null;
}
async function readBody(request: IncomingMessage, maxBytes = 4 * 1024 * 1024): Promise<unknown> {
  if (Number(request.headers['content-length']) > maxBytes) throw new HttpError(413, 'INPUT_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'INPUT_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  if (!size) return undefined;
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'UNSUPPORTED_CONTENT_TYPE');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'INVALID_JSON'); }
}
export function createApiServer() {
  const server = createServer(async (incoming, outgoing) => {
    outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
    outgoing.setHeader('Cache-Control', 'private, no-store');
    outgoing.setHeader('X-Content-Type-Options', 'nosniff');
    const response: ApiResponse = {
      status(code) { outgoing.statusCode = code; return response; },
      json(body) { outgoing.end(JSON.stringify(body)); },
      end() { outgoing.end(); },
      setHeader(name, value) { outgoing.setHeader(name, value); },
    };
    try {
      const url = new URL(incoming.url || '/', 'http://localhost');
      if (url.pathname.startsWith('/api/auth/')) {
        if (!localAuthEnabled()) throw new HttpError(503, 'LOCAL_AUTH_NOT_CONFIGURED');
        const authMethods: Record<string, string> = {
          '/api/auth/sign-up/email': 'POST', '/api/auth/sign-in/email': 'POST',
          '/api/auth/sign-out': 'POST', '/api/auth/change-password': 'POST',
          '/api/auth/get-session': 'GET',
        };
        if (!Object.hasOwn(authMethods, url.pathname)) throw new HttpError(404, 'ENDPOINT_NOT_FOUND');
        if (incoming.method !== authMethods[url.pathname]) throw new HttpError(405, 'METHOD_NOT_ALLOWED');
        const origin = process.env.BETTER_AUTH_URL || '';
        if (incoming.method === 'POST' && incoming.headers.origin !== new URL(origin).origin) throw new HttpError(403, 'INVALID_ORIGIN');
        const body = await readBody(incoming, 16 * 1024);
        const authHeaders = new Headers({ 'Content-Type': 'application/json' });
        for (const name of ['cookie', 'origin', 'sec-fetch-site']) {
          const value = incoming.headers[name];
          if (typeof value === 'string') authHeaders.set(name, value);
        }
        const proxyIP = incoming.headers['x-real-ip'];
        const ip = process.env.OPENTU_TRUST_PROXY === 'true' && typeof proxyIP === 'string' && isIP(proxyIP) ? proxyIP : incoming.socket.remoteAddress || '127.0.0.1';
        authHeaders.set('x-real-ip', ip);
        const authResponse = await getLocalAuth().handler(new Request(new URL(url.pathname + url.search, origin), {
          method: incoming.method, headers: authHeaders,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }));
        outgoing.statusCode = authResponse.status;
        for (const [key, value] of authResponse.headers) if (key !== 'set-cookie') outgoing.setHeader(key, value);
        const cookies = authResponse.headers.getSetCookie();
        if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
        outgoing.setHeader('Cache-Control', 'private, no-store');
        outgoing.end(await authResponse.text());
        return;
      }
      if (url.pathname === '/api/health' && incoming.method === 'GET') {
        try { await ensureSchema(); await dbQuery('SELECT 1'); response.json({ data: { ready: true } }); }
        catch { response.status(503).json({ error: { code: 'DATABASE_NOT_READY' } }); }
        return;
      }
      const route = resolveHandler(url.pathname);
      if (!route) throw new HttpError(404, 'ENDPOINT_NOT_FOUND');
      const query: ApiRequest['query'] = Object.fromEntries(url.searchParams);
      // Route parameters always take precedence over attacker-supplied query keys.
      delete query.path;
      if (route.path) query.path = route.path;
      const headers = { ...incoming.headers };
      delete headers['x-forwarded-host'];
      delete headers['x-forwarded-proto'];
      await route.handler({ method: incoming.method, headers, query, body: await readBody(incoming) }, response);
    } catch (error) {
      if (!outgoing.headersSent && !outgoing.destroyed) {
        response.status(error instanceof HttpError ? error.status : 500).json({ error: { code: error instanceof HttpError ? error.code : 'INTERNAL_ERROR' } });
      } else if (!outgoing.writableEnded) outgoing.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}
