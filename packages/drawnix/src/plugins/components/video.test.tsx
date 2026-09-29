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
    vi.unstubAllGlobals();
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
