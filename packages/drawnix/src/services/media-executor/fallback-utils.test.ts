import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMediaFromBlob = vi.fn();
const cachedUrls = new Set<string>();
const isCached = vi.fn(async (url: string) => cachedUrls.has(url));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob,
    isCached,
  },
}));

describe('cacheRemoteUrl', () => {
  beforeEach(() => {
    cacheMediaFromBlob.mockReset();
    isCached.mockClear();
    cachedUrls.clear();
    cacheMediaFromBlob.mockImplementation(async (url: string) => {
      cachedUrls.add(url);
      return url;
    });
  });

  it('caches raw base64 image payloads as content-addressed local URLs', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(new Blob(['png-binary'], { type: 'image/png' }), {
          status: 200,
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');

    const result = await cacheRemoteUrl(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'task-raw-b64',
      'image',
      'png'
    );

    expect(result).toMatch(/^\/__aitu_cache__\/image\/content-[0-9a-f]{64}\.png$/);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^data:image\/png;base64,/)
    );
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      result,
      expect.any(Blob),
      'image',
      { taskId: 'task-raw-b64' }
    );

    vi.unstubAllGlobals();
  });

  it('reuses the same cached file for identical base64 payloads across tasks', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        new Response(new Blob(['same-binary'], { type: 'image/png' }), {
          status: 200,
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    const first = await cacheRemoteUrl(base64, 'task-a', 'image', 'png');
    const second = await cacheRemoteUrl(base64, 'task-b', 'image', 'png');

    expect(first).toBe(second);
    expect(cacheMediaFromBlob).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
