export function isUsableImageFetchResponse(
  response: Pick<Response, 'ok' | 'type'> | null | undefined
): boolean {
  return Boolean(response && (response.ok || response.type === 'opaque'));
}
