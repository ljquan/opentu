import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheMediaFromBlob = vi.fn();
const cacheLocalMediaByContent = vi.fn();
const getCachedBlob = vi.fn();
const getImageForAI = vi.fn();
const getCachedImageBlobWithThumbnailFallback = vi.fn();
const cachedUrls = new Set<string>();
const isCached = vi.fn(async (url: string) => cachedUrls.has(url));
const calculateBlobChecksum = vi.fn(async () => 'a'.repeat(64));
const providerSend = vi.fn();
const blobLike = expect.objectContaining({
  size: expect.any(Number),
  type: expect.any(String),
});

vi.mock('@aitu/utils', async () => {
  const actual = await vi.importActual<typeof import('@aitu/utils')>(
    '@aitu/utils'
  );
  return {
    ...actual,
    calculateBlobChecksum,
  };
});

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob,
    cacheLocalMediaByContent,
    getCachedBlob,
    getImageForAI,
    getCachedImageBlobWithThumbnailFallback,
    isCached,
  },
}));

vi.mock('../provider-routing/provider-transport', () => ({
  providerTransport: { send: providerSend },
}));

describe('materializeReferenceImagesSequentially', () => {
  beforeEach(() => {
    getImageForAI.mockReset();
  });

  it('materializes local references one at a time while preserving order and remote URLs', async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    const first = '/__aitu_cache__/image/first.png';
    const remote = 'https://cdn.example.com/reference.png';
    const second = '/asset-library/second.png';

    getImageForAI.mockImplementation(async (url: string) => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return {
        type: 'base64',
        value: `data:image/png;base64,${
          url === first ? 'RklSU1Q=' : 'U0VDT05E'
        }`,
      };
    });

    const { materializeReferenceImagesSequentially } = await import(
      './fallback-utils'
    );
    const result = await materializeReferenceImagesSequentially(
      [first, remote, second],
      { preserveUrl: (url) => /^https?:\/\//i.test(url) }
    );

    expect(maxActiveReads).toBe(1);
    expect(getImageForAI).toHaveBeenCalledTimes(2);
    expect(getImageForAI).toHaveBeenNthCalledWith(1, first);
    expect(getImageForAI).toHaveBeenNthCalledWith(2, second);
    expect(result).toEqual([
      'data:image/png;base64,RklSU1Q=',
      remote,
      'data:image/png;base64,U0VDT05E',
    ]);
  });

  it('stops before reading the next reference after abort', async () => {
    const controller = new AbortController();
    getImageForAI.mockImplementationOnce(async () => {
      controller.abort();
      return { type: 'base64', value: 'data:image/png;base64,RklSU1Q=' };
    });

    const { materializeReferenceImagesSequentially } = await import(
      './fallback-utils'
    );
    await expect(
      materializeReferenceImagesSequentially(['first', 'second'], {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(getImageForAI).toHaveBeenCalledOnce();
  });
});

describe('pollVideoStatus', () => {
  beforeEach(() => {
    providerSend.mockReset();
  });

  it('stops polling after the execution attempt is replaced', async () => {
    vi.useFakeTimers();
    try {
      providerSend.mockResolvedValue(
        new Response(JSON.stringify({ status: 'processing', progress: 25 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
      const { pollVideoStatus } = await import('./fallback-utils');
      let current = true;
      const polling = pollVideoStatus(
        'remote-old',
        {
          apiKey: 'test-key',
          baseUrl: 'https://api.example.com',
        },
        vi.fn(),
        undefined,
        () => current
      );
      const rejected = expect(polling).rejects.toMatchObject({
        name: 'AbortError',
      });

      for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
      }
      expect(providerSend).toHaveBeenCalledOnce();

      current = false;
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(providerSend).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cacheRemoteUrl', () => {
  beforeEach(() => {
    cacheMediaFromBlob.mockReset();
    getCachedBlob.mockReset().mockResolvedValue(null);
    cacheLocalMediaByContent.mockReset();
    getCachedImageBlobWithThumbnailFallback.mockReset();
    isCached.mockClear();
    calculateBlobChecksum.mockClear();
    cachedUrls.clear();
    cacheMediaFromBlob.mockImplementation(async (url: string) => {
      cachedUrls.add(url);
      return url;
    });
    cacheLocalMediaByContent.mockResolvedValue({
      url: '/__aitu_cache__/image/content-cached.png',
      contentHash: 'cached',
      reused: false,
    });
  });

  it('caches raw base64 image payloads as content-addressed local URLs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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

    expect(result).toMatch(
      /^\/__aitu_cache__\/image\/content-[0-9a-f]{64}\.png$/
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^data:image\/png;base64,/)
    );
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(result, blobLike, 'image', {
      taskId: 'task-raw-b64',
    });

    vi.unstubAllGlobals();
  });

  it('persists explicit internal visibility in cached image metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(['internal-image'], { type: 'image/png' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const result = await cacheRemoteUrl(
      'https://cdn.example.com/generated/internal.png',
      'task-internal-image',
      'image',
      'png',
      undefined,
      {
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
        resultVisibility: 'internal',
      }
    );

    expect(cacheMediaFromBlob).toHaveBeenCalledWith(result, blobLike, 'image', {
      taskId: 'task-internal-image',
      source: 'AI_GENERATED',
      resultVisibility: 'internal',
    });

    vi.unstubAllGlobals();
  });

  it('reuses the same cached file for identical base64 payloads across tasks', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
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

  it('keeps remote image URLs immediate during canvas insertion', async () => {
    const remoteUrl = 'https://cdn.example.com/generated/task-123.png?sig=abc';

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const result = await cacheRemoteUrl(
      remoteUrl,
      'insert-task',
      'image',
      'png',
      undefined,
      { materializeContentUrl: true }
    );

    expect(getCachedImageBlobWithThumbnailFallback).not.toHaveBeenCalled();
    expect(cacheLocalMediaByContent).not.toHaveBeenCalled();
    expect(result).toBe(remoteUrl);
  });

  it('materializes a preview Blob URL before it is inserted into the canvas', async () => {
    const blobUrl = 'blob:http://localhost/preview-image';
    const blob = new Blob(['preview-binary'], { type: 'image/webp' });
    getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(blob);
    cacheLocalMediaByContent.mockResolvedValueOnce({
      url: '/__aitu_cache__/image/content-preview.webp',
      contentHash: 'preview',
      reused: false,
    });

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const result = await cacheRemoteUrl(
      blobUrl,
      'insert-preview',
      'image',
      'png',
      undefined,
      { materializeContentUrl: true }
    );

    expect(getCachedImageBlobWithThumbnailFallback).toHaveBeenCalledWith(
      blobUrl
    );
    expect(cacheLocalMediaByContent).toHaveBeenCalledWith(blob, 'image', {
      taskId: 'insert-preview',
      source: 'AI_GENERATED',
    });
    expect(result).toBe('/__aitu_cache__/image/content-preview.webp');
  });

  it('recovers a missing virtual image from its cached thumbnail', async () => {
    const virtualUrl = '/__aitu_cache__/image/expired-task.png';
    const thumbnailBlob = new Blob(['thumbnail-binary'], {
      type: 'image/webp',
    });
    getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(
      thumbnailBlob
    );
    cacheLocalMediaByContent.mockResolvedValueOnce({
      url: '/__aitu_cache__/image/content-recovered.webp',
      contentHash: 'recovered',
      reused: false,
    });

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const result = await cacheRemoteUrl(
      virtualUrl,
      'insert-recovered',
      'image',
      'png',
      undefined,
      { materializeContentUrl: true }
    );

    expect(getCachedImageBlobWithThumbnailFallback).toHaveBeenCalledWith(
      virtualUrl
    );
    expect(cacheLocalMediaByContent).toHaveBeenCalledWith(
      thumbnailBlob,
      'image',
      {
        taskId: 'insert-recovered',
        source: 'AI_GENERATED',
      }
    );
    expect(result).toBe('/__aitu_cache__/image/content-recovered.webp');
  });

  it('keeps a virtual URL when materialization has no cached content', async () => {
    const remoteUrl = '/__aitu_cache__/image/expired.png';
    getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(null);

    const { cacheRemoteUrl } = await import('./fallback-utils');

    await expect(
      cacheRemoteUrl(remoteUrl, 'insert-missing', 'image', 'png', undefined, {
        materializeContentUrl: true,
      })
    ).resolves.toBe(remoteUrl);
    expect(cacheLocalMediaByContent).not.toHaveBeenCalled();
  });

  it('keeps a virtual URL when cache lookup throws during insertion', async () => {
    const remoteUrl = '/__aitu_cache__/image/cache-error.png';
    getCachedImageBlobWithThumbnailFallback.mockRejectedValueOnce(
      new Error('Cache Storage unavailable')
    );

    const { cacheRemoteUrl } = await import('./fallback-utils');

    await expect(
      cacheRemoteUrl(
        remoteUrl,
        'insert-cache-error',
        'image',
        'png',
        undefined,
        { materializeContentUrl: true }
      )
    ).resolves.toBe(remoteUrl);
  });

  it('caches remote https audio urls while keeping original URLs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(['audio-binary'], { type: 'audio/mpeg' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/audio/task-123.mp3';

    const result = await cacheRemoteUrl(
      remoteUrl,
      'task-audio',
      'audio',
      'mp3'
    );

    expect(result).toBe(remoteUrl);
    expect(fetchMock).toHaveBeenCalledWith(remoteUrl, {
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      remoteUrl,
      blobLike,
      'audio',
      {
        taskId: 'task-audio',
        source: 'AI_GENERATED',
      }
    );

    vi.unstubAllGlobals();
  });

  it('caches playback-only remote audio urls while keeping original URLs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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

    expect(result).toBe(remoteUrl);
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      remoteUrl,
      blobLike,
      'audio',
      {
        taskId: 'asset:d88312b4-5b86-4f11-b9a6-c4162ba07486',
        source: 'PLAYBACK_CACHE',
      }
    );

    vi.unstubAllGlobals();
  });

  it('caches force-remote cover images while keeping original URLs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
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

    expect(result).toBe(remoteUrl);
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      remoteUrl,
      blobLike,
      'image',
      {
        taskId: 'task-audio-cover',
        source: 'AI_GENERATED',
      }
    );

    vi.unstubAllGlobals();
  });

  it('keeps the original remote URL when cache write cannot be verified', async () => {
    cacheMediaFromBlob.mockResolvedValueOnce(
      'https://cdn.example.com/audio/cover.jpg'
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(['cover-binary'], { type: 'image/jpeg' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/audio/cover.jpg';

    const result = await cacheRemoteUrl(
      remoteUrl,
      'task-cover',
      'image',
      'jpg',
      undefined,
      { forceRemoteCache: true }
    );

    expect(result).toBe(remoteUrl);
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      remoteUrl,
      blobLike,
      'image',
      {
        taskId: 'task-cover',
        source: 'AI_GENERATED',
      }
    );

    vi.unstubAllGlobals();
  });

  it('reports a cache warning while preserving the original URL on HTTP failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 403, statusText: 'Forbidden' })
    );
    const warnings: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/generated/signed.png?sig=expired';

    const result = await cacheRemoteUrl(
      remoteUrl,
      'task-cache-warning',
      'image',
      'png',
      undefined,
      {
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
        onCacheWarning: (warning) => warnings.push(warning),
      }
    );

    expect(result).toBe(remoteUrl);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        reasonCode: 'http_error',
      })
    );

    vi.unstubAllGlobals();
  });

  it('reports a cache warning when the local cache write is not persisted', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(['image-binary'], { type: 'image/png' }), {
        status: 200,
      })
    );
    const warnings: Array<Record<string, unknown>> = [];
    cacheMediaFromBlob.mockResolvedValueOnce(
      '/__aitu_cache__/image/task-unpersisted.png'
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/generated/unpersisted.png';
    const result = await cacheRemoteUrl(
      remoteUrl,
      'task-unpersisted',
      'image',
      'png',
      undefined,
      {
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
        onCacheWarning: (warning) => warnings.push(warning),
      }
    );

    expect(result).toBe(remoteUrl);
    expect(warnings[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        reasonCode: 'cache_missing',
      })
    );

    vi.unstubAllGlobals();
  });

  it('returns a stable local URL only when explicitly requested', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(['image-binary'], { type: 'image/png' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'https://cdn.example.com/generated/image.png';

    const result = await cacheRemoteUrl(
      remoteUrl,
      'insert-123',
      'image',
      'png',
      undefined,
      { forceRemoteCache: true, returnLocalCacheUrl: true }
    );

    expect(result).toBe('/__aitu_cache__/image/insert-123.png');
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/insert-123.png',
      blobLike,
      'image',
      {
        taskId: 'insert-123',
        source: 'AI_GENERATED',
      }
    );

    vi.unstubAllGlobals();
  });

  it('重试使用新提交 ID 作为缓存键，不复用上次图片', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (url) =>
        new Response(new Blob([String(url)], { type: 'image/png' }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const first = await cacheRemoteUrl(
      'https://cdn.example.com/generated/first.png',
      'task-retry',
      'image',
      'png',
      undefined,
      {
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
        cacheKey: 'submission-first',
      }
    );
    const retried = await cacheRemoteUrl(
      'https://cdn.example.com/generated/retried.png',
      'task-retry',
      'image',
      'png',
      undefined,
      {
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
        cacheKey: 'submission-retried',
      }
    );

    expect(first).toBe('/__aitu_cache__/image/submission-first.png');
    expect(retried).toBe('/__aitu_cache__/image/submission-retried.png');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('把已缓存的远程图片迁移到任务稳定地址后再返回', async () => {
    const remoteUrl = 'https://cdn.example.com/generated/cached-image.png';
    const localUrl = '/__aitu_cache__/image/task-cached.png';
    cachedUrls.add(remoteUrl);
    getCachedBlob.mockResolvedValueOnce(
      new Blob(['cached-image'], { type: 'image/png' })
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const result = await cacheRemoteUrl(
      remoteUrl,
      'task-cached',
      'image',
      'png',
      undefined,
      { forceRemoteCache: true, returnLocalCacheUrl: true }
    );

    expect(result).toBe(localUrl);
    expect(getCachedBlob).toHaveBeenCalledWith(remoteUrl);
    expect(cacheMediaFromBlob).toHaveBeenCalledWith(
      localUrl,
      expect.any(Blob),
      'image',
      {
        taskId: 'task-cached',
        source: 'AI_GENERATED',
      }
    );
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('强制缓存多张远程图片时顺序处理，避免同时持有多个大 Blob', async () => {
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await Promise.resolve();
      activeFetches -= 1;
      return new Response(new Blob(['image-binary'], { type: 'image/png' }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrls } = await import('./fallback-utils');
    const results = await cacheRemoteUrls(
      [
        'https://cdn.example.com/generated/image-1.png',
        'https://cdn.example.com/generated/image-2.png',
      ],
      'task-images',
      'image',
      'png',
      { forceRemoteCache: true, returnLocalCacheUrl: true }
    );

    expect(maxActiveFetches).toBe(1);
    expect(results).toEqual([
      '/__aitu_cache__/image/task-images_0.png',
      '/__aitu_cache__/image/task-images_1.png',
    ]);

    vi.unstubAllGlobals();
  });

  it('passes the recovery abort signal to a remote cache fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(['image-binary'], { type: 'image/png' }), {
        status: 200,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    await cacheRemoteUrl(
      'https://cdn.example.com/generated/signal.png',
      'task-signal',
      'image',
      'png',
      undefined,
      { forceRemoteCache: true, signal: controller.signal }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example.com/generated/signal.png',
      expect.objectContaining({ signal: controller.signal })
    );
    vi.unstubAllGlobals();
  });

  it('propagates cache-fetch cancellation instead of returning the remote URL', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const cachePromise = cacheRemoteUrl(
      'https://cdn.example.com/generated/abort.png',
      'task-abort',
      'image',
      'png',
      undefined,
      { forceRemoteCache: true, signal: controller.signal }
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const stopError = new Error('recovery stopped');
    controller.abort(stopError);

    await expect(cachePromise).rejects.toBe(stopError);
    expect(cacheMediaFromBlob).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('stops sequential remote caching before the next URL after cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrls } = await import('./fallback-utils');
    const cachePromise = cacheRemoteUrls(
      [
        'https://cdn.example.com/generated/abort-1.png',
        'https://cdn.example.com/generated/abort-2.png',
      ],
      'task-abort-many',
      'image',
      'png',
      { forceRemoteCache: true, signal: controller.signal }
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort(new Error('recovery stopped'));

    await expect(cachePromise).rejects.toThrow('recovery stopped');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('keeps remote http urls unchanged as well', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const { cacheRemoteUrl } = await import('./fallback-utils');
    const remoteUrl = 'http://cdn.example.com/video/task-123.mp4';

    const result = await cacheRemoteUrl(
      remoteUrl,
      'task-video',
      'video',
      'mp4'
    );

    expect(result).toBe(remoteUrl);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cacheMediaFromBlob).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
