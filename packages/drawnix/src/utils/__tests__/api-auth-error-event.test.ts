import { describe, expect, it } from 'vitest';
import {
  classifyApiCredentialError,
  isAuthError,
} from '../api-auth-error-event';

describe('api-auth-error-event', () => {
  it('应识别明确的无效 API Key 错误', () => {
    const error = new Error('HTTP 401: Invalid API key provided');
    (error as any).httpStatus = 401;

    expect(classifyApiCredentialError(error)).toBe('invalid');
    expect(isAuthError(error)).toBe(true);
  });

  it('应识别响应体中的 token 过期错误', () => {
    const error = new Error('HTTP 401');
    (error as any).httpStatus = 401;
    (error as any).apiErrorBody = JSON.stringify({
      error: {
        message: 'Access token expired',
      },
    });

    expect(classifyApiCredentialError(error)).toBe('invalid');
    expect(isAuthError(error)).toBe(true);
  });

  it('应识别缺少凭证并自动打开设置', () => {
    const error = new Error('HTTP 401: API key is required');
    (error as any).httpStatus = 401;

    expect(classifyApiCredentialError(error)).toBe('missing');
    expect(isAuthError(error)).toBe(true);
  });

  it('应识别 PAI 返回的 No token provided', () => {
    const error = new Error('HTTP 401');
    (error as any).httpStatus = 401;
    (error as any).apiErrorBody = JSON.stringify({
      error: {
        code: '',
        message:
          'No token provided (request id: 20260427153350105490223i5mx7ZLL)',
        type: 'rix_api_error',
      },
    });

    expect(classifyApiCredentialError(error)).toBe('missing');
    expect(isAuthError(error)).toBe(true);
  });

  it('不应把泛化 unauthorized 误判为 key 错误', () => {
    const error = new Error('HTTP 401: Unauthorized');
    (error as any).httpStatus = 401;

    expect(classifyApiCredentialError(error)).toBeNull();
    expect(isAuthError(error)).toBe(false);
  });

  it('不应把额度错误误判为 key 错误', () => {
    const error = new Error('HTTP 401');
    (error as any).httpStatus = 401;
    (error as any).apiErrorBody = JSON.stringify({
      error: {
        message: 'insufficient_user_quota',
      },
    });

    expect(classifyApiCredentialError(error)).toBeNull();
    expect(isAuthError(error)).toBe(false);
  });

  it('不应把泛化 token 错误误判为 key 错误', () => {
    const error = new Error('Upload token invalid');

    expect(classifyApiCredentialError(error)).toBeNull();
    expect(isAuthError(error)).toBe(false);
  });
});

describe('structured diagnostic compatibility', () => {
  it.each([
    ['unauthenticated', 'missing'],
    ['invalid credentials', 'invalid'],
    ['permission_denied', null],
    ['insufficient_user_quota', null],
  ])(
    'classifies %s identically in old and new API errors',
    async (code, expected) => {
      const body = { error: { message: 'Access denied', code } };
      const legacy = Object.assign(new Error(body.error.message), {
        apiErrorBody: JSON.stringify(body.error),
        httpStatus: 401,
      });
      const { createGenerationApiError, toGenerationTaskError } = await import(
        '../generation-error-details'
      );
      const current = createGenerationApiError(
        body,
        new Response(null, { status: 401 }),
        'Failed'
      );
      expect(classifyApiCredentialError(legacy)).toBe(expected);
      expect(classifyApiCredentialError(current)).toBe(expected);
      expect(
        classifyApiCredentialError(toGenerationTaskError(current, 'API_ERROR'))
      ).toBe(expected);
    }
  );

  it.each([401, 403])(
    'does not treat HTTP %s or unrelated metadata as credential evidence',
    (httpStatus) => {
      const error = Object.assign(new Error('Access denied'), {
        httpStatus,
        diagnostics: {
          requestId: 'unauthenticated',
          modelId: 'invalid credentials',
        },
      });
      expect(classifyApiCredentialError(error)).toBeNull();
    }
  );
});
