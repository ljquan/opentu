import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Image as CanvasImage } from './image';
import { unifiedCacheService } from '../../services/unified-cache-service';

vi.mock('../../mcp/tools/image-generation', () => ({ generateImage: vi.fn() }));
vi.mock('../../services/ppt', () => ({ getImageRegion: vi.fn() }));
vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedImageBlobWithThumbnailFallback: vi.fn(),
    getCachedBlob: vi.fn(async () => null),
  },
}));

const props = {
  board: { viewport: { zoom: 1 } },
  imageItem: { url: '/__aitu_cache__/image/a.png', width: 100, height: 100 },
  element: { id: 'a', type: 'image', url: '/__aitu_cache__/image/a.png', points: [[0, 0], [100, 100]] },
  isFocus: false,
  isSelected: false,
} as any;

describe('canvas image automatic loading', () => {
  const readCache = vi.mocked(unifiedCacheService.getCachedImageBlobWithThumbnailFallback);
  const observe = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    readCache.mockReset().mockResolvedValue(null);
    vi.stubGlobal('IntersectionObserver', class {
      observe = observe;
      disconnect = vi.fn();
    });
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:cached-image');
      static revokeObjectURL = revokeObjectURL;
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads an unselected image from cache without any visibility callback or click', async () => {
    readCache.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    const { unmount } = render(<CanvasImage {...props} />);
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:cached-image'));
    expect(readCache).toHaveBeenCalledWith(props.imageItem.url);
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('eager');
    expect(observe).not.toHaveBeenCalled();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-image');
  });

  it('uses the original signed URL immediately when no cached image exists', async () => {
    const url = 'https://cdn.example.com/image.png?signature=original';
    render(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }} />);
    const image = document.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(url);
    expect(image.getAttribute('loading')).toBe('eager');
    await waitFor(() => expect(readCache).toHaveBeenCalledWith(url));
    expect(image.getAttribute('src')).toBe(url);
    expect(image.style.opacity).toBe('1');
  });

  it('keeps the original image available when cache reading fails', async () => {
    readCache.mockRejectedValue(new Error('cache unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<CanvasImage {...props} />);
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(document.querySelector('img')?.getAttribute('src')).toBe(props.imageItem.url);
    expect(document.querySelector('img')?.getAttribute('loading')).toBe('eager');
  });

  it('loads a changed source without requiring selection', async () => {
    const { rerender } = render(<CanvasImage {...props} />);
    const url = '/__aitu_cache__/image/b.png';
    rerender(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }} />);
    expect(document.querySelector('img')?.getAttribute('src')).toBe(url);
    await waitFor(() => expect(readCache).toHaveBeenCalledWith(url));
    expect(observe).not.toHaveBeenCalled();
  });

  it('preserves an opaque video URL and the poster stored on its element', () => {
    const url = '/media/opaque-id';
    render(<CanvasImage {...props} imageItem={{ ...props.imageItem, url }}
      element={{ ...props.element, url, isVideo: true, poster: '/cover.png' }} />);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/cover.png');
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    expect(document.querySelector('video')?.getAttribute('src')).toBe(url);
  });
});
