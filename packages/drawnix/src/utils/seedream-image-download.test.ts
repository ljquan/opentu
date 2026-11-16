import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchImageForCache,
  resolveSeedreamImageDownloadUrl,
  SEEDREAM_IMAGE_ORIGIN,
} from './seedream-image-download';

afterEach(() => vi.unstubAllGlobals());

describe('Seedream image downloads', () => {
  it('preserves signed path and query encoding through the fixed same-origin route', () => {
    const suffix =
      'key/Image/a%2Fb.png?X-Tos-Credential=id%2Fdate&X-Tos-Signature=A%2Bb%3D&v=1&v=2';
    expect(
      resolveSeedreamImageDownloadUrl(
        `${SEEDREAM_IMAGE_ORIGIN}/doubao-seedream-5-5/${suffix}`
      )
    ).toBe(`/__opentu_seedream_images__/${suffix}`);
  });

  it.each([
    'http://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-5-5/a.png',
    'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com:8443/doubao-seedream-5-5/a.png',
    'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com.evil.test/doubao-seedream-5-5/a.png',
    'https://user:secret@ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-5-5/a.png',
    `${SEEDREAM_IMAGE_ORIGIN}/other-model/a.png`,
    `${SEEDREAM_IMAGE_ORIGIN}/doubao-seedream-5-5/../other/a.png`,
    'https://cdn.example.com/image.png',
    '/asset-library/a.png',
    '/__aitu_cache__/image/a.png',
    'data:image/png;base64,abc',
    'invalid',
  ])('does not rewrite unrelated or untrusted URL %s', (url) => {
    expect(resolveSeedreamImageDownloadUrl(url)).toBe(url);
  });

  it('omits credentials and forwards cancellation/options without modifying the source URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await fetchImageForCache(
      `${SEEDREAM_IMAGE_ORIGIN}/doubao-seedream-5-5/a.png?sig=a%2Fb`,
      {
        signal,
        cache: 'no-store',
        credentials: 'include',
        headers: {
          Accept: 'image/*',
          Authorization: 'test-key',
          Cookie: 'test-session',
        },
      }
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/__opentu_seedream_images__/a.png?sig=a%2Fb',
      {
        signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: new Headers({ Accept: 'image/*' }),
      }
    );
  });

  it('rejects an HTML SPA fallback instead of treating it as a cached image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>app</html>', {
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );
    await expect(
      fetchImageForCache(`${SEEDREAM_IMAGE_ORIGIN}/doubao-seedream-5-5/a.png`)
    ).rejects.toThrow('无效内容');
  });
});
