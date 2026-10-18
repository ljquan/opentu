import { describe, expect, it } from 'vitest';

import {
  isAppManagedImageDownload,
  isUsableImageFetchResponse,
} from './image-fetch-response';

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

describe('isAppManagedImageDownload', () => {
  const download: Parameters<typeof isAppManagedImageDownload>[0] = {
    method: 'GET',
    destination: '',
    mode: 'cors',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: new Headers({ Accept: 'image/*' }),
  };

  it('lets explicit original-image downloads use their own cache and cancellation', () => {
    expect(isAppManagedImageDownload(download)).toBe(true);
  });

  it.each([
    { destination: 'image' },
    { destination: 'video' },
    { method: 'POST' },
    { mode: 'no-cors' },
    { cache: 'default' },
    { credentials: 'include' },
    { referrerPolicy: '' },
    { headers: new Headers({ Accept: 'application/json' }) },
    { headers: new Headers() },
  ] as const)('retains SW handling for other requests: %o', (override) => {
    expect(isAppManagedImageDownload({ ...download, ...override })).toBe(false);
  });

  it('matches the browser Request produced by the media downloader without changing signed URLs', () => {
    const url = 'https://cdn.example.com/image.png?signature=a%2Fb&expires=123';
    const request = new Request(url, {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'image/*' },
    });
    expect(isAppManagedImageDownload(request)).toBe(true);
    expect(request.url).toBe(url);
  });
});
