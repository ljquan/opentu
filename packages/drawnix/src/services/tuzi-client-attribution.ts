import { isTuziRequestRecoveryBaseUrl } from './provider-routing/tuzi-api-endpoints';

declare const __OPENTU_DESKTOP_CHANNEL_PROOF__: string;

/** Client-reported analytics only; never identity or billing authority. */
export function readTuziClientChannel(
  origin = typeof window === 'undefined' ? '' : window.location.origin
): 0 | 1 | 2 | 3 {
  if (import.meta.env.VITE_OPENTU_DESKTOP === 'true') {
    const proof =
      typeof __OPENTU_DESKTOP_CHANNEL_PROOF__ === 'string'
        ? __OPENTU_DESKTOP_CHANNEL_PROOF__
        : '';
    return proof === 'opentu-desktop-client-channel:3' ? 3 : 0;
  }
  try {
    const url = new URL(origin);
    if (url.origin === 'https://opentu.ai') return 1;
    if (url.origin === 'https://pr.opentu.ai') return 2;
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      return 2;
  } catch {
    /* Unknown/native origins remain unattributed. */
  }
  return 0;
}

/** Preserve every other query byte; replace all existing ch occurrences. */
export function withTuziClientChannel(
  url: string,
  ch = readTuziClientChannel()
): string {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return url;
  }
  if (
    !['https:', 'http:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    !isTuziRequestRecoveryBaseUrl(target.origin)
  )
    return url;
  const hashIndex = url.indexOf('#');
  const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
  const head = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const queryIndex = head.indexOf('?');
  const path = queryIndex < 0 ? head : head.slice(0, queryIndex);
  const parts =
    queryIndex < 0
      ? []
      : head
          .slice(queryIndex + 1)
          .split('&')
          .filter((part) => {
            try {
              return (
                decodeURIComponent(
                  part.split('=', 1)[0].replace(/\+/g, ' ')
                ) !== 'ch'
              );
            } catch {
              return true;
            }
          });
  parts.push(`ch=${ch === 1 || ch === 2 || ch === 3 ? ch : 0}`);
  return `${path}?${parts.join('&')}${hash}`;
}

async function readRequestBody(request: Request): Promise<Blob | undefined> {
  request.signal.throwIfAborted();
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  const cancel = () => {
    void reader.cancel(request.signal.reason).catch(() => undefined);
  };
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      request.signal.throwIfAborted();
      if (done) break;
      chunks.push(value);
    }
    return new Blob(chunks);
  } finally {
    request.signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Retain Request semantics when attribution or a local proxy rewrites a URL. */
export async function fetchWithRewrittenUrl(
  input: RequestInfo | URL,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const original =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
  if (url === original) return fetch(input, init);
  if (!(typeof Request !== 'undefined' && input instanceof Request)) {
    return fetch(url, init);
  }
  const request = new Request(input, init);
  // Passing a Request as RequestInit exposes its body as a ReadableStream.
  // Chrome then requires HTTP/2 for uploads, even for an ordinary JSON or
  // multipart body. Buffer only this Request-object path, retaining the exact
  // bytes and original multipart boundary; ordinary FormData stays untouched.
  const attributedRequest = new Request(url, request);
  const body = await readRequestBody(request);
  return fetch(attributedRequest, body === undefined ? undefined : { body });
}

/** Change only the URL, retaining Request bodies, headers and abort signals. */
export const fetchWithTuziClientChannel: typeof fetch = (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
  return fetchWithRewrittenUrl(input, withTuziClientChannel(url), init);
};
