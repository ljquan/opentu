import { assertSameOrigin, requireUser } from '../../_lib/auth';
import { ensureSchema } from '../../_lib/db';
import { sendJson, type ApiRequest, type ApiResponse } from '../../_lib/http';
import { GenerationGatewayError } from '../../_lib/generation/errors';
import {
  sendGenerationError,
  setGenerationResponseHeaders,
} from '../../_lib/generation/handler';
import {
  cancelOwnedTask,
  findOwnedTask,
  publicTask,
} from '../../_lib/generation/repository';

function pathParts(request: ApiRequest): string[] {
  const path = request.query?.path;
  const value = Array.isArray(path) ? path.join('/') : path || '';
  return value
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function taskIdValue(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(value)) {
    throw new GenerationGatewayError(404, 'TASK_NOT_FOUND', '任务不存在');
  }
  return value;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  setGenerationResponseHeaders(response);
  if (!['GET', 'POST'].includes(request.method || '')) {
    response.setHeader?.('Allow', 'GET, POST');
    return sendJson(response, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: '不支持的请求方法', retryable: false },
    });
  }
  try {
    if (request.method === 'POST') assertSameOrigin(request);
    const account = await requireUser(request);
    await ensureSchema();
    const parts = pathParts(request);
    const taskId = taskIdValue(parts[0]);
    if (parts.length === 1 && request.method === 'GET') {
      return sendJson(response, 200, {
        data: publicTask(await findOwnedTask(account.id, taskId)),
      });
    }
    if (parts.length === 2 && parts[1] === 'cancel' && request.method === 'POST') {
      return sendJson(response, 200, {
        data: publicTask(await cancelOwnedTask(account.id, taskId)),
      });
    }
    throw new GenerationGatewayError(404, 'ENDPOINT_NOT_FOUND', '生成接口不存在');
  } catch (error) {
    return sendGenerationError(response, error);
  }
}

