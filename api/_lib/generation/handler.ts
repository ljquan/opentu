import { ResponseError } from '../auth';
import { sendJson, type ApiResponse } from '../http';
import {
  GenerationGatewayError,
} from './errors';

export function setGenerationResponseHeaders(response: ApiResponse): void {
  response.setHeader?.('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader?.('X-Content-Type-Options', 'nosniff');
}

export function sendGenerationError(
  response: ApiResponse,
  error: unknown
): void {
  if (error instanceof GenerationGatewayError) {
    return sendJson(response, error.status, {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    });
  }
  if (error instanceof ResponseError) {
    return sendJson(response, error.status, {
      error: {
        code:
          error.status === 401
            ? 'AUTH_REQUIRED'
            : error.status === 403
            ? 'ACCESS_DENIED'
            : 'ACCOUNT_UNAVAILABLE',
        message: error.message,
        retryable: error.status >= 500,
      },
    });
  }
  console.error('[OpenTu generation API]', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  return sendJson(response, 500, {
    error: {
      code: 'GENERATION_SERVICE_ERROR',
      message: '生成服务暂时不可用',
      retryable: true,
    },
  });
}
