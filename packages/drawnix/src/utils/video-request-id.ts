/** Only explicit API-site IDs qualify; error text may contain an upstream ID. */
const record = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
};
const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Task-scoped response fields, never the ID of the current polling request. */
export function readVideoTaskRequestId(body: unknown): string | undefined {
  const data = record(body);
  return (
    nonEmpty(data.submission_request_id) ||
    nonEmpty(data.original_request_id) ||
    nonEmpty(data.api_request_id)
  );
}

export function readVideoSubmissionRequestId(
  response: Pick<Response, 'headers'>,
  body?: unknown
): string | undefined {
  return (
    readVideoTaskRequestId(body) ||
    nonEmpty(response.headers.get('x-oneapi-request-id')) ||
    nonEmpty(record(body).request_id)
  );
}

/** Add submission metadata without replacing the original error/HTTP type. */
export function withVideoRequestId<T extends Error>(
  error: T,
  apiRequestId: string | undefined
): T {
  if (apiRequestId) {
    const diagnosticError = error as T & {
      diagnostics?: Record<string, unknown>;
    };
    diagnosticError.diagnostics = {
      ...diagnosticError.diagnostics,
      apiRequestId,
    };
  }
  return error;
}
