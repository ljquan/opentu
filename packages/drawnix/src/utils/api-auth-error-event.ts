/**
 * API 认证错误事件
 * 仅在确认是凭证无效时通知主线程打开设置对话框
 */

export const API_AUTH_ERROR_EVENT = 'api-auth-error';

export type ApiCredentialErrorKind = 'invalid' | 'missing';

export interface ApiAuthErrorDetail {
  message: string;
  source?: string; // 错误来源，如 'chat', 'workflow' 等
  reason?: ApiCredentialErrorKind;
}

interface ErrorSignalSnapshot {
  combinedText: string;
}

const INVALID_CREDENTIAL_PATTERNS: RegExp[] = [
  /invalid api[- ]?key/i,
  /incorrect api[- ]?key/i,
  /provided api[- ]?key .*invalid/i,
  /invalid access token/i,
  /invalid auth(?:entication)? token/i,
  /invalid bearer token/i,
  /invalid credentials?/i,
  /authentication credentials? (?:is|are|was|were)? ?invalid/i,
  /authorization (?:token|header).*(?:invalid|expired|malformed)/i,
  /bearer token.*(?:invalid|expired|malformed)/i,
  /expired api[- ]?key/i,
  /expired access token/i,
  /expired bearer token/i,
  /revoked api[- ]?key/i,
  /revoked access token/i,
  /revoked bearer token/i,
  /api[- ]?key.*(?:expired|revoked|invalid)/i,
  /access token.*(?:expired|revoked|invalid)/i,
  /bearer token.*(?:expired|revoked|invalid)/i,
];

const MISSING_CREDENTIAL_PATTERNS: RegExp[] = [
  /missing api[- ]?key/i,
  /api[- ]?key is required/i,
  /api[- ]?key required/i,
  /no api[- ]?key/i,
  /no (?:access |auth(?:entication)? |bearer )?token provided/i,
  /missing (?:access |auth(?:entication)? |bearer )?token/i,
  /(?:access |auth(?:entication)? |bearer )?token is required/i,
  /authorization header is missing/i,
  /missing authorization/i,
  /missing authentication/i,
  /missing bearer token/i,
  /authentication required/i,
  /must be authenticated/i,
  /unauthenticated/i,
  /provide (?:an )?api[- ]?key/i,
];

function extractTextFromApiBody(apiErrorBody: string): string[] {
  if (!apiErrorBody) {
    return [];
  }

  try {
    const parsed = JSON.parse(apiErrorBody);
    const values = [
      parsed.error?.message,
      parsed.error?.code,
      parsed.error_description,
      parsed.message,
      parsed.detail,
      parsed.msg,
      parsed.code,
      parsed.type,
    ];
    return values.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== ''
    );
  } catch {
    return [apiErrorBody];
  }
}

function collectErrorSignals(error: unknown): ErrorSignalSnapshot {
  if (typeof error === 'string') {
    return {
      combinedText: error,
    };
  }

  if (!error || typeof error !== 'object') {
    return {
      combinedText: String(error || ''),
    };
  }

  const candidate = error as Record<string, unknown>;
  const texts = new Set<string>();
  const directTexts = [
    candidate.message,
    candidate.detail,
    candidate.msg,
    candidate.code,
    typeof candidate.error === 'string' ? candidate.error : undefined,
    (candidate.error as Record<string, unknown> | undefined)?.message,
    (candidate.error as Record<string, unknown> | undefined)?.code,
    (candidate.diagnostics as Record<string, unknown> | undefined)?.apiErrorCode,
    (candidate.details as Record<string, unknown> | undefined)?.apiErrorCode,
  ];

  for (const value of directTexts) {
    if (typeof value === 'string' && value.trim() !== '') {
      texts.add(value);
    }
  }

  if (typeof candidate.apiErrorBody === 'string') {
    for (const value of extractTextFromApiBody(candidate.apiErrorBody)) {
      if (value.trim() !== '') {
        texts.add(value);
      }
    }
  }

  return {
    combinedText: Array.from(texts).join(' | '),
  };
}

export function classifyApiCredentialError(
  error: unknown
): ApiCredentialErrorKind | null {
  const { combinedText } = collectErrorSignals(error);
  if (!combinedText) {
    return null;
  }

  if (INVALID_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    return 'invalid';
  }

  if (MISSING_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    return 'missing';
  }

  return null;
}

/**
 * 检查错误是否属于“应自动打开设置”的凭证错误
 * 只在凭证明确无效/过期/撤销/缺失时返回 true，避免把泛化 401 误判成 key 错误
 */
export function isAuthError(error: unknown): boolean {
  return classifyApiCredentialError(error) !== null;
}

/**
 * 触发 API 认证错误事件
 */
export function dispatchApiAuthError(detail: ApiAuthErrorDetail): void {
  window.dispatchEvent(new CustomEvent(API_AUTH_ERROR_EVENT, { detail }));
}
