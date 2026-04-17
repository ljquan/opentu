import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMediaFromBlob = vi.fn();
const cachedUrls = new Set<string>();
const isCached = vi.fn(async (url: string) => cachedUrls.has(url));
const calculateBlobChecksum = vi.fn(async () => 'a'.repeat(64));

vi.mock('@aitu/utils', async () => {
  const actual = await vi.importActual<typeof import('@aitu/utils')>('@aitu/utils');
  return {
    ...actual,
    calculateBlobChecksum,
  };
});

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
    calculateBlobChecksum.mockClear();
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

  it('keeps remote https image urls unchanged without rewriting them to local cache paths', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/generated/task-123.png?sig=abc';

    const result = await cacheRemoteUrl(remoteUrl, 'task-http', 'image', 'png');

    expect(result).toBe(remoteUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cacheMediaFromBlob).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('caches remote https audio urls into stable local paths', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(new Blob(['audio-binary'], { type: 'audio/mpeg' }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/audio/task-123.mp3';

    const result = await cacheRemoteUrl(remoteUrl, 'task-audio', 'audio', 'mp3');

    expect(result).toBe('/__aitu_generated__/audio/task-audio.mp3');
    expect(fetchMock).toHaveBeenCalledWith(remoteUrl, {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_generated__/audio/task-audio.mp3',
      expect.any(Blob),
      'audio',
      {
        taskId: 'task-audio',
        source: 'AI_GENERATED',
      }
    );

    vi.unstubAllGlobals();
  });

  it('caches playback-only remote audio urls into hidden local cache paths', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(new Blob(['audio-binary'], { type: 'audio/mpeg' }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/audio/task-456.mp3';

    const result = await cacheRemoteUrl(
      remoteUrl,
      'asset:d88312b4-5b86-4f11-b9a6-c4162ba07486',
      'audio',
      'mp3',
      undefined,
      { source: 'PLAYBACK_CACHE' }
    );

    expect(result).toBe('/__aitu_cache__/audio/asset-d88312b4-5b86-4f11-b9a6-c4162ba07486.mp3');
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/audio/asset-d88312b4-5b86-4f11-b9a6-c4162ba07486.mp3',
      expect.any(Blob),
      'audio',
      {
        taskId: 'asset:d88312b4-5b86-4f11-b9a6-c4162ba07486',
        source: 'PLAYBACK_CACHE',
      }
    );

    vi.unstubAllGlobals();
  });

  it('caches force-remote cover images into image cache paths instead of audio paths', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(new Blob(['cover-binary'], { type: 'image/jpeg' }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/audio/cover.jpg';

    const result = await cacheRemoteUrl(
      remoteUrl,
      'task-audio-cover',
      'image',
      'jpg',
      1,
      { forceRemoteCache: true }
    );

    expect(result).toBe('/__aitu_cache__/image/task-audio-cover_1.jpg');
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/task-audio-cover_1.jpg',
      expect.any(Blob),
      'image',
      {
        taskId: 'task-audio-cover',
        source: 'AI_GENERATED',
      }
    );

    vi.unstubAllGlobals();
  });

  it('keeps remote http urls unchanged as well', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'http://cdn.example.com/video/task-123.mp4';

    const result = await cacheRemoteUrl(remoteUrl, 'task-video', 'video', 'mp4');

    expect(result).toBe(remoteUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cacheMediaFromBlob).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
