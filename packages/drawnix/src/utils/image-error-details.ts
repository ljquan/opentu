import type { Task, TaskError } from '../types/shared/core.types';

/** Provider metadata only: never store headers, credentials or image payloads. */
export interface ImageErrorDiagnostics {
  /** Original video submission ID returned by the API site, not its upstream. */
  apiRequestId?: string;
  requestId?: string;
  apiErrorCode?: string;
  httpStatus?: number;
  modelId?: string;
  remoteId?: string;
}

type DiagnosticError = Error & {
  diagnostics?: ImageErrorDiagnostics;
  httpStatus?: number;
  apiErrorBody?: string;
  fullResponse?: string;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : undefined;

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const REQUEST_ID_PATTERN = String.raw`\brequest[\s_-]*id\s*[:=]\s*([\w.:-]+)`;

function embeddedRequestId(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value.match(new RegExp(REQUEST_ID_PATTERN, 'i'))?.[1]
    : undefined;
}

export function extractImageErrorDiagnostics(
  value: unknown
): ImageErrorDiagnostics {
  const parsed = parse(value);
  const body = object(parsed);
  const error = object(body.error);
  const data = object(body.data);
  return {
    requestId:
      embeddedRequestId(error.message) ||
      embeddedRequestId(body.message) ||
      embeddedRequestId(body.error) ||
      text(body.request_id ?? body.requestId) ||
      text(error.request_id ?? error.requestId) ||
      text(data.request_id ?? data.requestId) ||
      embeddedRequestId(value),
    apiErrorCode: text(error.code) || text(body.code),
    remoteId:
      text(body.task_id ?? body.taskId) ||
      text(error.task_id ?? error.taskId) ||
      text(data.task_id ?? data.taskId),
  };
}

function defined(diagnostics: ImageErrorDiagnostics): ImageErrorDiagnostics {
  return Object.fromEntries(
    Object.entries(diagnostics).filter(([, value]) => value !== undefined)
  );
}

export function createImageApiError(
  body: unknown,
  response: Pick<Response, 'status' | 'headers'>,
  fallback: string,
  context: Pick<ImageErrorDiagnostics, 'modelId' | 'remoteId'> = {}
): DiagnosticError {
  const parsed = parse(body);
  const record = object(parsed);
  const errorBody = object(record.error);
  const message =
    text(errorBody.message) ||
    text(record.error) ||
    text(record.message) ||
    (typeof parsed === 'string' && !/^<!doctype|^<html/i.test(parsed.trim())
      ? parsed.trim()
      : '') ||
    fallback;
  const extracted = extractImageErrorDiagnostics(body);
  const error: DiagnosticError = new Error(message);
  error.httpStatus = response.status;
  error.diagnostics = defined({
    ...extracted,
    requestId:
      // The provider's error message can identify the upstream request,
      // while x-request-id identifies a different gateway hop.
      extracted.requestId ||
      response.headers?.get('x-oneapi-request-id') ||
      response.headers?.get('x-request-id') ||
      response.headers?.get('request-id') ||
      undefined,
    httpStatus: response.status,
    ...defined(context),
  });
  return error;
}

export async function readImageApiError(
  response: Response,
  fallback: string,
  context: Pick<ImageErrorDiagnostics, 'modelId' | 'remoteId'> = {},
  readBody: (response: Response) => Promise<string> = (response) =>
    response.text()
): Promise<DiagnosticError> {
  // Read once so non-JSON responses remain available too.
  const body = await readBody(response).catch(() => '');
  let endpoint = '';
  try {
    const url = new URL(response.url);
    endpoint = `${url.hostname}${url.pathname}`;
  } catch {
    // Synthetic responses may not carry an endpoint.
  }
  return createImageApiError(
    body,
    response,
    `${fallback}: ${response.status}${endpoint ? ` (${endpoint})` : ''}`,
    context
  );
}

export function toImageTaskError(
  value: unknown,
  code: string,
  modelId?: string
) {
  const error = value as DiagnosticError;
  const message = error?.message || String(value);
  const originalError = error?.fullResponse || error?.apiErrorBody || message;
  const diagnostics = {
    ...defined(extractImageErrorDiagnostics(message)),
    ...defined(extractImageErrorDiagnostics(originalError)),
    ...defined({ modelId, httpStatus: error?.httpStatus }),
    ...defined(error?.diagnostics || {}),
  };
  diagnostics.requestId =
    embeddedRequestId(message) ||
    embeddedRequestId(originalError) ||
    diagnostics.requestId;
  return {
    code,
    message,
    details: { originalError, timestamp: Date.now(), ...diagnostics },
  } satisfies TaskError;
}

export function getImageFailureDetails(task?: Task | null, fallbackError = '') {
  const error = task?.error;
  const diagnostics = {
    ...defined(extractImageErrorDiagnostics(fallbackError)),
    ...defined(extractImageErrorDiagnostics(error?.message)),
    ...defined(extractImageErrorDiagnostics(error?.details?.originalError)),
    ...defined(error?.details || {}),
  };
  // Also repair display of previously saved tasks with a gateway header ID.
  const requestId =
    embeddedRequestId(error?.message) ||
    embeddedRequestId(error?.details?.originalError) ||
    embeddedRequestId(fallbackError) ||
    diagnostics.requestId;
  let message = error?.message || fallbackError;
  if (requestId) {
    message = message.replace(
      new RegExp(`\\s*[（(]${REQUEST_ID_PATTERN}\\s*[)）]`, 'gi'),
      (match, id) => (id === requestId ? '' : match)
    );
    // Remove explicit trailing IDs from provider/gateway hops, but keep prose.
    message = message.replace(
      new RegExp(
        `(?:\\s*[（(]${REQUEST_ID_PATTERN}\\s*[)）]|(?:\\s+|^)${REQUEST_ID_PATTERN})+\\s*$`,
        'i'
      ),
      ''
    );
  }
  const status =
    diagnostics.httpStatus ||
    Number(error?.code?.match(/^HTTP_(\d{3})$/)?.[1]) ||
    undefined;
  if (status) {
    message = message.replace(new RegExp(`^HTTP\\s+${status}\\s*[:：-]\\s*`, 'i'), '');
  }
  const prefix = [status ? `HTTP ${status}` : '', diagnostics.apiErrorCode]
    .filter(Boolean)
    .join(' · ');
  return {
    requestId,
    modelId:
      diagnostics.modelId ||
      task?.invocationRoute?.modelId ||
      task?.params?.model ||
      task?.params?.modelRef?.modelId ||
      undefined,
    remoteId: diagnostics.remoteId || task?.remoteId,
    error: prefix ? `[${prefix}] ${message}` : message,
  };
}
