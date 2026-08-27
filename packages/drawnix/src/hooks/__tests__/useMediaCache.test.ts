import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaUrl } from '../useMediaCache';

const mocks = vi.hoisted(() => ({
  getCachedBlob: vi.fn<(url: string) => Promise<Blob | null>>(),
  getCachedUrl: vi.fn<(url: string) => Promise<string | null>>(),
  getCacheStatus: vi.fn(() => 'cached' as const),
  subscribe: vi.fn(() => () => undefined),
  createObjectURL: vi.fn<(blob: Blob) => string>(),
  revokeObjectURL: vi.fn<(url: string) => void>(),
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
    getCachedUrl: mocks.getCachedUrl,
    getCacheStatus: mocks.getCacheStatus,
    subscribe: mocks.subscribe,
  },
}));

describe('useMediaUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let objectUrlIndex = 0;
    mocks.createObjectURL.mockImplementation(
      () => `blob:cached-media-${++objectUrlIndex}`
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: mocks.createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: mocks.revokeObjectURL,
    });
  });

  it('把虚拟缓存地址解析为 Blob URL，并在切换和卸载时释放', async () => {
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['video'], { type: 'video/webm' })
    );

    const { result, rerender, unmount } = renderHook(
      ({ taskId, url }) => useMediaUrl(taskId, url),
      {
        initialProps: {
          taskId: 'task-1',
          url: '/__aitu_cache__/video/task-1.webm',
        },
      }
    );

    await waitFor(() => {
      expect(result.current).toMatchObject({
        url: 'blob:cached-media-1',
        isFromCache: true,
        isLoading: false,
      });
    });

    rerender({
      taskId: 'task-2',
      url: '/__aitu_cache__/video/task-2.webm',
    });

    await waitFor(() =>
      expect(result.current.url).toBe('blob:cached-media-2')
    );
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:cached-media-1');

    unmount();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:cached-media-2');
  });

  it('虚拟媒体缓存缺失时不回退请求 SPA 地址', async () => {
    mocks.getCachedBlob.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useMediaUrl('missing', '/__aitu_cache__/video/missing.mp4')
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.url).toBeNull();
    expect(mocks.getCachedUrl).not.toHaveBeenCalled();
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
  });
});
