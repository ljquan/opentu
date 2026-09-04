export const IMAGE_RECOVERY_REQUEST_ID_HEADER = 'X-Oneapi-Request-Id';

export function buildImageRecoveryUrl(
  baseUrl: string | undefined,
  requestId: string | undefined
): string | undefined {
  const normalizedRequestId = requestId?.trim();
  const normalizedBaseUrl = baseUrl?.trim();
  if (!normalizedRequestId || !normalizedBaseUrl) {
    return undefined;
  }

  try {
    const url = new URL(
      /^[a-z][a-z\d+\-.]*:\/\//i.test(normalizedBaseUrl)
        ? normalizedBaseUrl
        : `https://${normalizedBaseUrl}`
    );
    url.pathname = '/log/get-request';
    url.search = '';
    url.hash = '';
    url.searchParams.set('id', normalizedRequestId);
    return url.toString();
  } catch {
    return undefined;
  }
}

export function readImageRecoveryRequestId(
  response: Pick<Response, 'headers'>
): string | undefined {
  const value = response.headers.get(IMAGE_RECOVERY_REQUEST_ID_HEADER)?.trim();
  return value || undefined;
}

export function attachImageRecoveryRequestId(
  error: unknown,
  requestId?: string
): void {
  if (!requestId || !error || typeof error !== 'object') {
    return;
  }
  (error as { imageRecoveryRequestId?: string }).imageRecoveryRequestId =
    requestId;
}

export function getImageRecoveryRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const value = (error as { imageRecoveryRequestId?: unknown })
    .imageRecoveryRequestId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
