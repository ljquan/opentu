// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const swChannelMocks = vi.hoisted(() => ({
  isInitialized: vi.fn(() => true),
  publish: vi.fn(),
  clearAllCache: vi.fn(async () => ({ success: true })),
}));

vi.mock('./sw-channel/client', () => ({
  swChannelClient: {
    isInitialized: swChannelMocks.isInitialized,
    setEventHandlers: vi.fn(),
    publish: swChannelMocks.publish,
    clearAllCache: swChannelMocks.clearAllCache,
  },
}));

// eslint-disable-next-line import/first
import {
  UNIFIED_BLOB_STORE_NAME,
  UNIFIED_DB_NAME,
  unifiedCacheService,
} from './unified-cache-service';

const nativeStructuredClone = globalThis.structuredClone;

beforeAll(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', undefined);
  vi.stubGlobal(
    'structuredClone',
    (value: unknown, options?: StructuredSerializeOptions) => {
      if (value instanceof Blob) {
        return value.slice(0, value.size, value.type);
      }
      return nativeStructuredClone(value, options);
    }
  );
});

function deleteStoredBlob(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(UNIFIED_DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(UNIFIED_BLOB_STORE_NAME, 'readwrite');
      transaction.objectStore(UNIFIED_BLOB_STORE_NAME).delete(url);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

function readBlobAsText(blob: Blob | null): Promise<string | null> {
  if (!blob) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  swChannelMocks.isInitialized.mockReset().mockReturnValue(true);
  swChannelMocks.publish.mockReset();
  swChannelMocks.clearAllCache.mockReset().mockResolvedValue({ success: true });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('UnifiedCacheService insecure LAN fallback', () => {
  it('persists and reads asset-library media when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    const blob = new Blob(['local-image'], { type: 'image/png' });
    const assetUrl = '/asset-library/content-local-test.png';

    const cached = await unifiedCacheService.cacheMediaFromBlob(
      assetUrl,
      blob,
      'image',
      { contentHash: 'local-test' }
    );
    const restored = await unifiedCacheService.getCachedBlob(
      `http://192.168.50.225:7200${assetUrl}`
    );
    const storedMedia = (await unifiedCacheService.getAllCachedMedia()).find(
      (item) => item.url === assetUrl
    );

    expect(cached).toBe(assetUrl);
    expect(restored?.type).toBe('image/png');
    expect(await readBlobAsText(restored)).toBe('local-image');
    expect(storedMedia?.contentHash).toBe('local-test');
  });

  it('falls back when Cache Storage exists but rejects access', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('caches', {
      open: vi.fn().mockRejectedValue(new Error('SecurityError')),
    });
    const blob = new Blob(['rejected-cache'], { type: 'image/png' });
    const assetUrl = '/asset-library/content-rejected-cache.png';

    await unifiedCacheService.cacheMediaFromBlob(assetUrl, blob, 'image', {
      contentHash: 'rejected-cache',
    });
    const restored = await unifiedCacheService.getCachedBlob(assetUrl);

    expect(await readBlobAsText(restored)).toBe('rejected-cache');
  });

  it('repairs legacy metadata when the persisted Blob is missing', async () => {
    vi.stubGlobal('caches', undefined);
    const blob = new Blob(['repair-local-image'], { type: 'image/png' });
    const first = await unifiedCacheService.cacheLocalMediaByContent(
      blob,
      'image'
    );

    await deleteStoredBlob(first.url);
    expect(await unifiedCacheService.getCachedBlob(first.url)).toBeNull();

    const repaired = await unifiedCacheService.cacheLocalMediaByContent(
      blob,
      'image'
    );
    const restored = await unifiedCacheService.getCachedBlob(repaired.url);

    expect(repaired.url).toBe(first.url);
    expect(repaired.reused).toBe(false);
    expect(await readBlobAsText(restored)).toBe('repair-local-image');
  });
});

describe('UnifiedCacheService clear all cache', () => {
  it('deletes page image and thumbnail caches before notifying the worker', async () => {
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal('caches', { delete: deleteCache });

    await unifiedCacheService.clearAllCache();

    expect(deleteCache).toHaveBeenCalledWith('drawnix-images');
    expect(deleteCache).toHaveBeenCalledWith('drawnix-images-thumb');
    expect(swChannelMocks.clearAllCache).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight media write before deleting caches', async () => {
    const originalFetch = globalThis.fetch;
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const put = vi.fn(async () => undefined);
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => fetchPromise)
    );
    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({ put })),
      delete: deleteCache,
    });

    try {
      const caching = unifiedCacheService.cacheImage(
        'https://example.com/in-flight.png'
      );
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      const clearing = unifiedCacheService.clearAllCache();
      await Promise.resolve();
      expect(deleteCache).not.toHaveBeenCalled();

      resolveFetch?.(
        new Response(new Blob(['image'], { type: 'image/png' }), {
          status: 200,
        })
      );
      await Promise.all([caching, clearing]);

      expect(put).toHaveBeenCalledTimes(1);
      expect(put.mock.invocationCallOrder[0]).toBeLessThan(
        deleteCache.mock.invocationCallOrder[0]
      );
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('propagates a worker cache-clear RPC failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('caches', { delete: vi.fn(async () => true) });
    swChannelMocks.clearAllCache.mockResolvedValueOnce({
      success: false,
      error: 'worker clear failed',
    });

    await expect(unifiedCacheService.clearAllCache()).rejects.toThrow(
      'worker clear failed'
    );
  });

  it('does not treat a one-way message as success while the worker channel initializes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('caches', { delete: vi.fn(async () => true) });
    const postMessage = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: { postMessage } },
    });
    swChannelMocks.isInitialized.mockReturnValue(false);

    await expect(unifiedCacheService.clearAllCache()).rejects.toThrow(
      '缓存服务尚未就绪，请稍后重试'
    );
    expect(postMessage).not.toHaveBeenCalled();
  });
});
