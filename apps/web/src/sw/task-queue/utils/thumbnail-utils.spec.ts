import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sw-runtime-bridge', () => ({
  getSwRuntimeBridge: () => ({}),
}));

// eslint-disable-next-line import/first
import { clearThumbnailCache, generateImageThumbnail } from './thumbnail-utils';

describe('thumbnail cache clear barrier', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prevents an in-flight thumbnail from writing after the cache is cleared', async () => {
    let resolveThumbnail: ((blob: Blob) => void) | undefined;
    const thumbnailPromise = new Promise<Blob>((resolve) => {
      resolveThumbnail = resolve;
    });
    const convertToBlob = vi.fn(() => thumbnailPromise);
    const put = vi.fn(async () => undefined);
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({
        match: vi.fn(async () => undefined),
        put,
      })),
      delete: deleteCache,
    });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 100,
        height: 100,
        close: vi.fn(),
      }))
    );
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return { drawImage: vi.fn() };
        }

        convertToBlob() {
          return convertToBlob();
        }
      }
    );

    const generation = generateImageThumbnail(
      new Blob(['image'], { type: 'image/png' }),
      'https://example.com/image.png',
      ['small']
    );
    await vi.waitFor(() => {
      expect(convertToBlob).toHaveBeenCalledTimes(1);
    });

    const clearing = clearThumbnailCache();
    await Promise.resolve();
    expect(deleteCache).not.toHaveBeenCalled();

    resolveThumbnail?.(new Blob(['thumbnail'], { type: 'image/jpeg' }));
    await Promise.all([generation, clearing]);

    expect(deleteCache).toHaveBeenCalledWith('drawnix-images-thumb');
    expect(put).not.toHaveBeenCalled();
  });
});
