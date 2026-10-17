const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]+/gi,
  /(?:api[-_ ]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /https?:\/\/[^\s"']+/gi,
];

export class GenerationGatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly upstreamStatus?: number
  ) {
    super(message);
  }
}

export function sanitizeDiagnostic(value: unknown): string {
  const initial = value instanceof Error ? value.message : String(value || '');
  return SECRET_PATTERNS.reduce(
    (message, pattern) => message.replace(pattern, '[redacted]'),
    initial
  )
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240);
}

export function asGatewayError(error: unknown): GenerationGatewayError {
  if (error instanceof GenerationGatewayError) return error;
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new GenerationGatewayError(
      504,
      'UPSTREAM_TIMEOUT',
      '模型服务响应超时，执行结果待核对，请勿重复提交',
      false
    );
  }
  return new GenerationGatewayError(
    502,
    'UPSTREAM_REQUEST_FAILED',
    '模型执行结果暂无法确认，请联系管理员核对',
    false
  );
}

export function upstreamError(status: number): GenerationGatewayError {
  if (status === 401 || status === 403) {
    return new GenerationGatewayError(
      502,
      'UPSTREAM_AUTH_FAILED',
      '模型供应商鉴权失败，请联系管理员',
      false,
      status
    );
  }
  if (status === 429) {
    return new GenerationGatewayError(
      503,
      'UPSTREAM_BUSY',
      '模型服务繁忙，请稍后重试',
      true,
      status
    );
  }
  if (status === 408 || status >= 500) {
    return new GenerationGatewayError(
      502,
      'UPSTREAM_UNAVAILABLE',
      '模型供应商返回异常，执行结果待核对，请勿重复提交',
      false,
      status
    );
  }
  return new GenerationGatewayError(
    422,
    'UPSTREAM_REJECTED',
    '模型供应商未接受本次生成参数',
    false,
    status
  );
}
