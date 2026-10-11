import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Video } from './video';

const mocks = vi.hoisted(() => ({
  getCachedBlob:
    vi.fn<
      (
        url: string,
        options?: { allowNetwork?: boolean }
      ) => Promise<Blob | null>
    >(),
  createObjectURL: vi.fn<(blob: Blob) => string>(),
  revokeObjectURL: vi.fn<(url: string) => void>(),
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: { getCachedBlob: mocks.getCachedBlob },
}));

describe('Video', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.clearAllMocks();
    mocks.getCachedBlob.mockResolvedValue(null);
    mocks.createObjectURL.mockReturnValue('blob:cached-video');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = mocks.createObjectURL;
        static revokeObjectURL = mocks.revokeObjectURL;
      }
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not mount a video source until its cover is activated', () => {
    render(<Video videoItem={{ url: '/original.mp4', poster: '/cover.png' }} />);
    expect(document.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    const video = document.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/original.mp4');
    expect(video.getAttribute('preload')).toBe('metadata');
    fireEvent.loadedData(video);
    expect(video.play).toHaveBeenCalledOnce();
  });

  it('releases an offscreen player and can restore it without changing its source', () => {
    const { rerender } = render(<Video videoItem={{ url: '/original.mp4' }} />);
    const video = document.querySelector('video')!;
    rerender(<Video videoItem={{ url: '/original.mp4' }} visible={false} />);
    expect(video.pause).toHaveBeenCalled();
    expect(video.getAttribute('src')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
    rerender(<Video videoItem={{ url: '/original.mp4' }} visible />);
    expect(document.querySelector('video')?.getAttribute('src')).toBe('/original.mp4');
  });

  it('keeps explicitly playing video alive offscreen until playback is paused', () => {
    const { rerender } = render(<Video videoItem={{ url: '/playing.mp4' }} />);
    const video = document.querySelector('video')!;
    fireEvent.play(video);
    rerender(<Video videoItem={{ url: '/playing.mp4' }} visible={false} />);
    expect(document.querySelector('video')).toBe(video);
    expect(video.getAttribute('src')).toBe('/playing.mp4');
    fireEvent.pause(video);
    expect(document.querySelector('video')).toBeNull();
  });

  it('keeps poster activation alive while loading offscreen and releases it after pause', () => {
    const videoItem = { url: '/loading.mp4', poster: '/cover.png' };
    const { rerender } = render(<Video videoItem={videoItem} />);
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    const video = document.querySelector('video')!;
    rerender(<Video videoItem={videoItem} visible={false} />);
    expect(document.querySelector('video')).toBe(video);
    fireEvent.loadedMetadata(video);
    expect(document.querySelector('video')).toBe(video);
    fireEvent.loadedData(video);
    expect(video.play).toHaveBeenCalledOnce();
    fireEvent.play(video);
    fireEvent.pause(video);
    expect(document.querySelector('video')).toBeNull();
  });

  it('releases offscreen activation if playback is rejected or loading fails', async () => {
    const videoItem = { url: '/blocked.mp4', poster: '/cover.png' };
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('blocked'));
    const { rerender } = render(<Video videoItem={videoItem} />);
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    rerender(<Video videoItem={videoItem} visible={false} />);
    fireEvent.loadedData(document.querySelector('video')!);
    await waitFor(() => expect(document.querySelector('video')).toBeNull());
    rerender(<Video videoItem={videoItem} visible />);
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    rerender(<Video videoItem={videoItem} visible={false} />);
    fireEvent.error(document.querySelector('video')!);
    await waitFor(() => expect(document.querySelector('video')).toBeNull());
  });

  it('releases the player source when a poster-activated video is unmounted', () => {
    const { unmount } = render(<Video videoItem={{ url: '/original.mp4', poster: '/cover.png' }} />);
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }));
    const video = document.querySelector('video')!;
    unmount();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.getAttribute('src')).toBeNull();
    expect(video.load).toHaveBeenCalledOnce();
  });

  it('restores the media source after StrictMode replays effect cleanup', () => {
    const { unmount } = render(<React.StrictMode><Video videoItem={{ url: '/strict.mp4' }} /></React.StrictMode>);
    const video = document.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('/strict.mp4');
    unmount();
    expect(video.getAttribute('src')).toBeNull();
  });

  it('clears a failed state when the video URL changes', async () => {
    const { rerender } = render(
      <Video videoItem={{ url: 'https://cdn.example.com/expired.mp4' }} />
    );

    fireEvent.error(document.querySelector('video')!);
    expect(await screen.findByText('Video failed to load')).toBeTruthy();

    rerender(
      <Video videoItem={{ url: 'https://cdn.example.com/recovered.mp4' }} />
    );

    await waitFor(() => {
      expect(screen.queryByText('Video failed to load')).toBeNull();
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'https://cdn.example.com/recovered.mp4'
      );
    });
    fireEvent.loadedData(document.querySelector('video')!);
    expect(screen.queryByText('Loading video...')).toBeNull();
  });

  it('plays a virtual cached video through a Blob URL when the cache path fails', async () => {
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['video'], { type: 'video/mp4' })
    );
    render(<Video videoItem={{ url: '/__aitu_cache__/video/task-1.mp4' }} />);

    fireEvent.error(document.querySelector('video')!);

    await waitFor(() => {
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'blob:cached-video'
      );
    });
    expect(mocks.getCachedBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/video/task-1.mp4',
      { allowNetwork: false }
    );
    expect(screen.queryByText('Video failed to load')).toBeNull();
    fireEvent.loadedData(document.querySelector('video')!);
    expect(screen.queryByText('Loading video...')).toBeNull();
  });

  it('shows the error when the virtual video is absent from local cache', async () => {
    render(<Video videoItem={{ url: '/__aitu_cache__/video/missing.mp4' }} />);

    fireEvent.error(document.querySelector('video')!);

    expect(await screen.findByText('Video failed to load')).toBeTruthy();
  });

  it('ignores a cache read that completes after the video URL changed', async () => {
    let resolveCachedBlob!: (blob: Blob | null) => void;
    mocks.getCachedBlob.mockReturnValue(
      new Promise((resolve) => {
        resolveCachedBlob = resolve;
      })
    );
    const { rerender } = render(
      <Video videoItem={{ url: '/__aitu_cache__/video/old.mp4' }} />
    );
    fireEvent.error(document.querySelector('video')!);

    rerender(<Video videoItem={{ url: 'https://cdn.example.com/new.mp4' }} />);
    await act(async () => {
      resolveCachedBlob(new Blob(['old video'], { type: 'video/mp4' }));
    });

    await waitFor(() => {
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'https://cdn.example.com/new.mp4'
      );
    });
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
  });

  it('releases the fallback Blob URL when the source changes and on unmount', async () => {
    const { rerender, unmount } = render(
      <Video videoItem={{ url: '/__aitu_cache__/video/task-1.mp4' }} />
    );
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['video'], { type: 'video/mp4' })
    );
    fireEvent.error(document.querySelector('video')!);
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'blob:cached-video'
      )
    );

    rerender(<Video videoItem={{ url: 'https://cdn.example.com/next.mp4' }} />);
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:cached-video');

    rerender(<Video videoItem={{ url: '/__aitu_cache__/video/task-2.mp4' }} />);
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['video'], { type: 'video/mp4' })
    );
    fireEvent.error(document.querySelector('video')!);
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'blob:cached-video'
      )
    );
    unmount();
    expect(mocks.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it('handles a rejected cache read without leaving the player loading', async () => {
    mocks.getCachedBlob.mockRejectedValue(new Error('storage unavailable'));
    render(<Video videoItem={{ url: '/__aitu_cache__/video/error.mp4' }} />);
    fireEvent.error(document.querySelector('video')!);
    expect(await screen.findByText('Video failed to load')).toBeTruthy();
    expect(screen.queryByText('Loading video...')).toBeNull();
  });

  it('stops retrying when the cached video also fails to decode', async () => {
    mocks.getCachedBlob.mockResolvedValue(new Blob(['invalid video']));
    render(<Video videoItem={{ url: '/__aitu_cache__/video/invalid.mp4' }} />);
    fireEvent.error(document.querySelector('video')!);
    await waitFor(() =>
      expect(document.querySelector('video')?.getAttribute('src')).toBe(
        'blob:cached-video'
      )
    );
    fireEvent.error(document.querySelector('video')!);
    expect(await screen.findByText('Video failed to load')).toBeTruthy();
    expect(mocks.getCachedBlob).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate errors while a cache read is pending', async () => {
    let resolveBlob!: (blob: Blob) => void;
    mocks.getCachedBlob.mockReturnValue(
      new Promise((resolve) => {
        resolveBlob = resolve;
      })
    );
    render(<Video videoItem={{ url: '/__aitu_cache__/video/pending.mp4' }} />);
    fireEvent.error(document.querySelector('video')!);
    fireEvent.error(document.querySelector('video')!);
    expect(screen.queryByText('Video failed to load')).toBeNull();
    await act(async () => {
      resolveBlob(new Blob(['video']));
    });
    expect(document.querySelector('video')?.getAttribute('src')).toBe(
      'blob:cached-video'
    );
    expect(mocks.getCachedBlob).toHaveBeenCalledTimes(1);
  });

  it('does not create a Blob URL after unmount', async () => {
    let resolveBlob!: (blob: Blob) => void;
    mocks.getCachedBlob.mockReturnValue(
      new Promise((resolve) => {
        resolveBlob = resolve;
      })
    );
    const { unmount } = render(
      <Video videoItem={{ url: '/__aitu_cache__/video/removed.mp4' }} />
    );
    fireEvent.error(document.querySelector('video')!);
    unmount();
    await act(async () => {
      resolveBlob(new Blob(['video']));
    });
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps a loaded remote video mounted across selection changes', () => {
    const url = 'https://cdn.example.com/video.mp4?signature=preserved';
    const { rerender } = render(<Video videoItem={{ url }} />);
    const video = document.querySelector('video')!;
    fireEvent.loadedData(video);
    rerender(<Video videoItem={{ url }} isSelected />);
    expect(document.querySelector('video')).toBe(video);
    expect(video.getAttribute('src')).toBe(url);
    expect(screen.queryByText('Loading video...')).toBeNull();
    expect(mocks.getCachedBlob).not.toHaveBeenCalled();
  });
});
