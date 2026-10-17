import { createHash, timingSafeEqual } from 'node:crypto';
import { ensureSchema } from '../_lib/db';
import {
  getHeader,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/http';
import { reconcileInterruptedTasks } from '../_lib/generation/maintenance';

export default async function handler(
  request: ApiRequest,
  response: ApiResponse
) {
  response.setHeader?.('Cache-Control', 'private, no-store');
  if (request.method !== 'GET') {
    response.setHeader?.('Allow', 'GET');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    return sendJson(response, 503, { error: 'Maintenance is not configured' });
  const authorization = getHeader(request, 'authorization');
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return sendJson(response, 401, { error: 'Unauthorized' });
  }
  try {
    await ensureSchema();
    const reconciled = await reconcileInterruptedTasks();
    return sendJson(response, 200, { data: { reconciled } });
  } catch {
    console.error('[Generation maintenance] database reconciliation failed');
    return sendJson(response, 503, { error: 'Maintenance failed' });
  }
}
