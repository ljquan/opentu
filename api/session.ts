import { requireUser } from './_lib/auth';
import { sendGenerationError } from './_lib/generation/handler';
import { type ApiRequest, type ApiResponse, sendJson } from './_lib/http';

export default async function session(request: ApiRequest, response: ApiResponse) {
  response.setHeader?.('Cache-Control', 'private, no-store');
  if (request.method !== 'GET') return sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
  try {
    const account = await requireUser(request);
    sendJson(response, 200, { data: { id: account.id, username: account.username, role: account.role } });
  } catch (error) {
    sendGenerationError(response, error);
  }
}
