import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Image as CanvasImage } from './image';

vi.mock('../../mcp/tools/image-generation', () => ({ generateImage: vi.fn() }));
vi.mock('../../services/ppt', () => ({ getImageRegion: vi.fn() }));
vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: { getCachedImageBlobWithThumbnailFallback: vi.fn(async () => null), getCachedBlob: vi.fn(async () => null) },
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const props = {
  board: { viewport: { zoom: 1 } },
  imageItem: { url: '/__aitu_cache__/image/a.png', width: 100, height: 100 },
  element: { id: 'a', type: 'image', url: '/__aitu_cache__/image/a.png', points: [[0, 0], [100, 100]] },
} as any;

describe('canvas image loading', () => {
  it('falls back immediately to the original when an existing preview is corrupt', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = () => 'blob:invalid-preview';
      static revokeObjectURL = vi.fn();
    });
    vi.stubGlobal('caches', { open: async (name: string) => ({ match: async () => name === 'drawnix-images'
      ? new Response('original', { headers: { 'Content-Type': 'image/png' } })
      : new Response('corrupt preview') }) });
    render(<CanvasImage {...props} />);
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:invalid-preview'));
    fireEvent.error(document.querySelector('img')!);
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe(props.imageItem.url));
  });
  it('preserves an existing video flag and poster even when its URL has no extension', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<CanvasImage {...props} imageItem={{ url: '/media/opaque-id', width: 100, height: 100 }}
      element={{ ...props.element, url: '/media/opaque-id', isVideo: true, poster: '/cover.png' }} />);
    expect(document.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/media/opaque-id');
  });
  it('keeps original source metadata for offscreen exports while deferring cache reads', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
    render(<CanvasImage {...props} />);
    const image = document.querySelector('img')!;
    expect(image.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.dataset.canvasOriginalSrc).toBe(props.imageItem.url);
  });

  it('uses eager loading in view and lazy loading offscreen while preserving the original DOM', async () => {
    let notify!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe = vi.fn(); disconnect = vi.fn();
    });
    render(<CanvasImage {...props} />);
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('loading')).toBe('eager'));
    expect(document.querySelector('img')?.getAttribute('decoding')).toBe('async');
    vi.useFakeTimers();
    act(() => notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    act(() => vi.advanceTimersByTime(2000));
    expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    vi.useRealTimers();
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('loading')).toBe('eager'));
  });
});
