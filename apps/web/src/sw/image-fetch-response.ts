export function isUsableImageFetchResponse(
  response: Pick<Response, 'ok' | 'type'> | null | undefined
): boolean {
  return Boolean(response && (response.ok || response.type === 'opaque'));
}

export function isAppManagedImageDownload(
  request: Pick<
    Request,
    | 'method'
    | 'destination'
    | 'mode'
    | 'cache'
    | 'credentials'
    | 'referrerPolicy'
    | 'headers'
  >
): boolean {
  return (
    request.method === 'GET' &&
    request.destination === '' &&
    request.mode === 'cors' &&
    request.cache === 'no-store' &&
    request.credentials === 'omit' &&
    request.referrerPolicy === 'no-referrer' &&
    request.headers.get('accept')?.toLowerCase().startsWith('image/') === true
  );
}
