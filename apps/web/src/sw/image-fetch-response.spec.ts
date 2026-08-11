import { describe, expect, it } from 'vitest';

import { isUsableImageFetchResponse } from './image-fetch-response';

describe('isUsableImageFetchResponse', () => {
  it('accepts successful CORS responses', () => {
    expect(isUsableImageFetchResponse({ ok: true, type: 'cors' })).toBe(true);
  });

  it('accepts opaque no-cors responses', () => {
    expect(isUsableImageFetchResponse({ ok: false, type: 'opaque' })).toBe(
      true
    );
  });

  it.each([403, 404, 500])(
    'rejects an HTTP %s response so another fetch mode can be tried',
    (status) => {
      const response = new Response(null, { status });

      expect(isUsableImageFetchResponse(response)).toBe(false);
    }
  );

  it('rejects missing responses', () => {
    expect(isUsableImageFetchResponse(undefined)).toBe(false);
    expect(isUsableImageFetchResponse(null)).toBe(false);
  });
});
