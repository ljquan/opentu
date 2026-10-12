import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvasImagePreview } from './use-canvas-image-preview';

const readOriginal = vi.fn();
const readThumbnail = vi.fn();
const createUrl = vi.fn(() => 'blob:preview');
const revokeUrl = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  readOriginal.mockResolvedValue(
    new Response('original', { headers: { 'Content-Type': 'image/png' } })
  );
  readThumbnail.mockImplementation(
    async () =>
      new Response('small', { headers: { 'Content-Type': 'image/webp' } })
  );
  vi.stubGlobal('caches', {
    open: vi.fn(async (name: string) => ({
      match: name === 'drawnix-images' ? readOriginal : readThumbnail,
    })),
  });
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = revokeUrl;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('canvas cached previews', () => {
  it('bounds simultaneous thumbnail reads and merges a repeated source request', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    readThumbnail.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const first = renderHook(() =>
      useCanvasImagePreview('/asset-library/one', true)
    );
    const duplicate = renderHook(() =>
      useCanvasImagePreview('/asset-library/one', true)
    );
    const second = renderHook(() =>
      useCanvasImagePreview('/asset-library/two', true)
    );
    const third = renderHook(() =>
      useCanvasImagePreview('/asset-library/three', true)
    );
    await waitFor(() => expect(readThumbnail).toHaveBeenCalledTimes(2));
    await act(async () => resolvers[0](new Response('one')));
    await waitFor(() => expect(readThumbnail).toHaveBeenCalledTimes(3));
    await act(async () => {
      resolvers[1](new Response('two'));
      resolvers[2](new Response('three'));
    });
    await waitFor(() =>
      expect([
        first.result.current.pending,
        duplicate.result.current.pending,
        second.result.current.pending,
        third.result.current.pending,
      ]).toEqual([false, false, false, false])
    );
  });
  it('reads an existing preview without reading the original body or modifying source data', async () => {
    const original = new Response('original', {
      headers: { 'Content-Type': 'image/png' },
    });
    const readBody = vi.spyOn(original, 'blob');
    readOriginal.mockResolvedValue(original);
    const { result, unmount } = renderHook(() =>
      useCanvasImagePreview('/__aitu_cache__/image/a.png', true)
    );
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.url).toBe('blob:preview'));
    expect(readBody).not.toHaveBeenCalled();
    expect(readThumbnail).toHaveBeenCalledWith(
      expect.stringContaining('_thumb=large')
    );
    unmount();
    expect(revokeUrl).toHaveBeenCalledWith('blob:preview');
  });

  it.each(['image/gif', 'image/svg+xml', 'image/webp'])(
    'leaves %s originals intact without flattening them',
    async (type) => {
      readOriginal.mockResolvedValue(
        new Response('original', { headers: { 'Content-Type': type } })
      );
      const { result } = renderHook(() =>
        useCanvasImagePreview('/asset-library/animated', true)
      );
      await waitFor(() => expect(result.current.pending).toBe(false));
      expect(result.current.url).toBeUndefined();
      expect(readThumbnail).not.toHaveBeenCalled();
    }
  );

  it('falls back to the original when the preview is missing or storage fails', async () => {
    readThumbnail.mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ source }) => useCanvasImagePreview(source, true),
      { initialProps: { source: '/asset-library/missing' } }
    );
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.url).toBeUndefined();
    readOriginal.mockRejectedValue(new Error('storage unavailable'));
    rerender({ source: '/asset-library/failed' });
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.url).toBeUndefined();
  });

  it('never alters a signed external URL or probes its media', async () => {
    const { result } = renderHook(() =>
      useCanvasImagePreview('https://cdn.test/a.png?signature=abc', true)
    );
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(readOriginal).not.toHaveBeenCalled();
    expect(readThumbnail).not.toHaveBeenCalled();
  });

  it('does not create a URL for a pending read released offscreen', async () => {
    let resolve!: (response: Response) => void;
    readThumbnail.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      })
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => useCanvasImagePreview('/asset-library/pending', enabled),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(readThumbnail).toHaveBeenCalled());
    rerender({ enabled: false });
    await act(async () => resolve(new Response('preview')));
    expect(result.current.url).toBeUndefined();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('does not reuse a revoked preview after visibility changes', async () => {
    createUrl
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const { result, rerender } = renderHook(
      ({ enabled }) => useCanvasImagePreview('/asset-library/reopen', enabled),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.url).toBe('blob:first'));
    rerender({ enabled: false });
    expect(revokeUrl).toHaveBeenCalledWith('blob:first');
    rerender({ enabled: true });
    expect(result.current.url).toBeUndefined();
    await waitFor(() => expect(result.current.url).toBe('blob:second'));
  });
});
