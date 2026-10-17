import { assertSameOrigin, requireUser } from '../_lib/auth';
import { ensureSchema } from '../_lib/db';
import { getHeader, requestBody, sendJson, type ApiRequest, type ApiResponse } from '../_lib/http';
import { setGenerationResponseHeaders, sendGenerationError } from '../_lib/generation/handler';
import { GenerationGatewayError } from '../_lib/generation/errors';
import { parseCreateRequest, validateIdempotencyKey } from '../_lib/generation/input';
import { createGenerationTask } from '../_lib/generation/service';

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export default async function handler(request: ApiRequest, response: ApiResponse) {
  setGenerationResponseHeaders(response);
  if (request.method !== 'POST') {
    response.setHeader?.('Allow', 'POST');
    return sendJson(response, 405, {
      error: { code: 'METHOD_NOT_ALLOWED', message: '不支持的请求方法', retryable: false },
    });
  }
  try {
    assertSameOrigin(request);
    const contentType = getHeader(request, 'content-type').toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
      throw new GenerationGatewayError(
        415,
        'UNSUPPORTED_CONTENT_TYPE',
        '生成任务必须使用 JSON 请求'
      );
    }
    const contentLength = Number(getHeader(request, 'content-length') || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      throw new GenerationGatewayError(413, 'INPUT_TOO_LARGE', '请求体过大');
    }
    const account = await requireUser(request);
    await ensureSchema();
    let body: Record<string, unknown>;
    try {
      body = requestBody(request);
    } catch {
      throw new GenerationGatewayError(400, 'INVALID_JSON', '请求体不是有效的 JSON');
    }
    const generationRequest = parseCreateRequest(body);
    const idempotencyKey = validateIdempotencyKey(
      getHeader(request, 'idempotency-key')
    );
    const result = await createGenerationTask({
      account,
      idempotencyKey,
      request: generationRequest,
      canaryRequested: getHeader(request, 'x-opentu-canary') === '1',
    });
    return sendJson(response, result.created ? 201 : 200, { data: result.task });
  } catch (error) {
    return sendGenerationError(response, error);
  }
}
