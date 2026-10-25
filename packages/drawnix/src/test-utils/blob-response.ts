/**
 * Keep mocked fetch bodies in the jsdom Blob realm used by FileReader/FormData.
 * Node's Response.blob() returns a different Blob class in Node 20.
 */
export function createBlobResponse(blob: Blob, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  if (blob.type && !headers.has('content-type')) {
    headers.set('content-type', blob.type);
  }
  return Object.assign(new Response(null, { ...init, headers }), {
    blob: async () => blob,
    clone: () => createBlobResponse(blob, init),
  });
}
