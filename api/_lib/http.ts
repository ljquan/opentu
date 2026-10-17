export type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

export type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  end: () => void;
  setHeader?: (name: string, value: string) => void;
};

export function sendJson(
  response: ApiResponse,
  status: number,
  body: unknown
): void {
  response.status(status).json(body);
}

export function getHeader(request: ApiRequest, name: string): string {
  const value = request.headers[name] || request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export function queryValue(
  request: ApiRequest,
  name: string
): string | undefined {
  const value = request.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export function requestBody(request: ApiRequest): Record<string, unknown> {
  if (request.body && typeof request.body === 'object') {
    return request.body as Record<string, unknown>;
  }
  if (typeof request.body === 'string' && request.body.trim()) {
    const parsed = JSON.parse(request.body) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return {};
}

export function textValue(value: unknown, maxLength = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : '请求失败';
}
