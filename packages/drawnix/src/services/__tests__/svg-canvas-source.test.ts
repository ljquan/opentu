import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSvgCanvasSource } from '../svg-canvas-source';

const mocks = vi.hoisted(() => ({
  getCachedBlob: vi.fn(),
  thumbnail: vi.fn(),
}));
vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
    getCachedImageBlobWithThumbnailFallback: mocks.thumbnail,
  },
}));
const markup =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle r="10"/></svg>';
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('SVG original source reading', () => {
  it('reads actual cached XML and never requests a static thumbnail or generation', async () => {
    mocks.getCachedBlob.mockResolvedValue(
      new Blob([markup], { type: 'image/svg+xml' })
    );
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(
      (await readSvgCanvasSource('/__aitu_cache__/image/a.svg')).canConvert
    ).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.thumbnail).not.toHaveBeenCalled();
    expect(mocks.getCachedBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/a.svg',
      { allowNetwork: false }
    );
  });
  it('reports missing local original bytes instead of presenting a PNG as editable SVG', async () => {
    mocks.getCachedBlob.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      readSvgCanvasSource('/__aitu_cache__/image/missing.svg')
    ).rejects.toThrow('原文件缓存缺失');
    expect(fetch).not.toHaveBeenCalled();
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['not SVG'], { type: 'image/png' })
    );
    await expect(
      readSvgCanvasSource('/__aitu_cache__/image/a.svg')
    ).rejects.toThrow('格式无效');
  });
  it('reads a remote original with omitted credentials and rejects oversized or failed responses', async () => {
    mocks.getCachedBlob.mockResolvedValue(null);
    const fetcher = vi.fn().mockResolvedValue(new Response(markup));
    vi.stubGlobal('fetch', fetcher);
    expect(
      (await readSvgCanvasSource('https://example.com/a.svg')).vectorCount
    ).toBe(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    fetcher.mockResolvedValueOnce(new Response('failure', { status: 404 }));
    await expect(
      readSvgCanvasSource('https://example.com/a.svg')
    ).rejects.toThrow('404');
    fetcher.mockResolvedValueOnce(
      new Response('', {
        headers: { 'content-length': String(3 * 1024 * 1024) },
      })
    );
    await expect(
      readSvgCanvasSource('https://example.com/a.svg')
    ).rejects.toThrow('2 MB');
  });
  it('stops aborted reads before parsing or fetching', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readSvgCanvasSource('https://example.com/a.svg', controller.signal)
    ).rejects.toThrow();
    expect(mocks.getCachedBlob).not.toHaveBeenCalled();
  });
});
