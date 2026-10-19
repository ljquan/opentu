// @vitest-environment jsdom
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
import { RetryImage } from './retry-image';
import { unifiedCacheService } from '../services/unified-cache-service';

vi.mock('@aitu/utils', () => ({
  normalizeImageDataUrl: (value: string) => value,
}));

vi.mock('../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: vi.fn(),
    getCachedImageBlobWithThumbnailFallback: vi.fn(),
  },
}));

describe('RetryImage', () => {
  beforeEach(() => {
    vi.mocked(unifiedCacheService.getCachedImageBlobWithThumbnailFallback)
      .mockReset()
      .mockResolvedValue(null);
  });
  it('defers virtual media cache reads offscreen even if the Service Worker is unavailable', async () => {
    const readCache = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    );
    readCache.mockClear().mockResolvedValue(null);
    const { rerender } = render(
      <RetryImage
        src="/__aitu_cache__/image/offscreen.png"
        alt="offscreen"
        eager={false}
        deferCacheRead
        showSkeleton={false}
      />
    );
    expect(readCache).not.toHaveBeenCalled();
    rerender(
      <RetryImage
        src="/__aitu_cache__/image/offscreen.png"
        alt="offscreen"
        eager
        deferCacheRead={false}
        showSkeleton={false}
      />
    );
    await waitFor(() => expect(readCache).toHaveBeenCalledOnce());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('关闭 skeleton 时加载中的图片保持可见', () => {
    render(
      <RetryImage
        src="https://example.com/preview.png"
        alt="结果预览"
        showSkeleton={false}
      />
    );

    expect(screen.getByAltText('结果预览')).toHaveProperty(
      'style.opacity',
      '1'
    );
  });

  it('exhausted retries can recover through the canvas fallback without leaving the image hidden', () => {
    const loaded = vi.fn();
    const sourceChanged = vi.fn();
    render(
      <RetryImage
        src="/__aitu_cache__/image/recovery.png"
        alt="recoverable"
        maxRetries={0}
        skipCacheFallback
        showSkeleton={false}
        onSourceChange={sourceChanged}
        onError={(event) => {
          event.currentTarget.style.visibility = 'hidden';
          event.currentTarget.src = 'blob:canvas-recovery';
        }}
        onLoad={(event) => {
          event.currentTarget.style.visibility = '';
          loaded();
        }}
      />
    );
    const image = screen.getByAltText('recoverable');
    fireEvent.error(image);
    expect(image.style.visibility).toBe('hidden');
    fireEvent.load(image);
    expect(image.style.visibility).toBe('');
    expect(sourceChanged).toHaveBeenLastCalledWith('blob:canvas-recovery');
    expect(loaded).toHaveBeenCalledOnce();
    fireEvent.load(image);
    expect(loaded).toHaveBeenCalledOnce();
  });

  it('still ignores late load events from the failed source when no fallback was adopted', () => {
    const loaded = vi.fn();
    render(
      <RetryImage
        src="https://example.com/failed.png"
        alt="failed"
        maxRetries={0}
        skipCacheFallback
        showSkeleton={false}
        onLoad={loaded}
      />
    );
    const image = screen.getByAltText('failed');
    fireEvent.error(image);
    fireEvent.load(image);
    expect(loaded).not.toHaveBeenCalled();
  });

  it('does not accept a timed-out request as a successful late recovery', async () => {
    vi.useFakeTimers();
    const loaded = vi.fn();
    render(
      <RetryImage
        src="https://example.com/timeout.png"
        alt="timeout"
        eager
        skipCacheFallback
        loadTimeoutMs={10}
        onLoad={loaded}
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(10));
    fireEvent.load(screen.getByAltText('timeout'));
    expect(loaded).not.toHaveBeenCalled();
  });

  it('开启 skeleton 时图片加载完成后再淡入', () => {
    render(<RetryImage src="https://example.com/preview.png" alt="结果预览" />);

    const image = screen.getByAltText('结果预览');
    expect(image).toHaveProperty('style.opacity', '0');

    fireEvent.load(image);

    expect(image).toHaveProperty('style.opacity', '1');
  });

  it('局域网完整虚拟 URL 可从缓存转为 Blob，并在卸载时释放', async () => {
    const source = 'http://192.168.1.20:7200/asset-library/content-local.png';
    const getCachedImageBlobWithThumbnailFallback = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    );
    getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(
      new Blob(['local-image-data'], { type: 'image/png' })
    );
    const createObjectURL = vi.fn(() => 'blob:local-image');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { unmount } = render(
      <RetryImage src={source} alt="本地参考图" showSkeleton={false} />
    );

    const image = screen.getByAltText('本地参考图');
    await waitFor(() => {
      expect(getCachedImageBlobWithThumbnailFallback).toHaveBeenCalledWith(
        source
      );
      expect(image.getAttribute('src')).toBe('blob:local-image');
    });

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-image');
  });

  it('换源时立即显示新地址，旧缓存请求不能覆盖新图片', async () => {
    const oldSource = 'http://192.168.1.20:7200/asset-library/old.png';
    const newSource = 'http://192.168.1.20:7200/asset-library/new.png';
    let resolveOldBlob: ((blob: Blob) => void) | undefined;
    const oldBlobPromise = new Promise<Blob>((resolve) => {
      resolveOldBlob = resolve;
    });
    const getCachedImageBlobWithThumbnailFallback = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    );
    getCachedImageBlobWithThumbnailFallback.mockImplementation((url) => {
      if (url === oldSource) {
        return oldBlobPromise;
      }
      return Promise.resolve(new Blob(['new-image'], { type: 'image/png' }));
    });
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:new-image')
      .mockReturnValueOnce('blob:old-image');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { rerender } = render(
      <RetryImage src={oldSource} alt="切换中的图片" showSkeleton={false} />
    );
    const image = screen.getByAltText('切换中的图片');

    rerender(
      <RetryImage src={newSource} alt="切换中的图片" showSkeleton={false} />
    );
    expect(image.getAttribute('src')).toBe(newSource);
    await waitFor(() => {
      expect(image.getAttribute('src')).toBe('blob:new-image');
    });

    resolveOldBlob?.(new Blob(['old-image'], { type: 'image/png' }));
    await waitFor(() => {
      expect(image.getAttribute('src')).toBe('blob:new-image');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-image');
    });
  });

  it('旧源的重试定时器不能覆盖新图片', async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <RetryImage
        src="https://example.com/old.png"
        alt="重试中的图片"
        initialRetryDelay={1000}
        bypassSWAfterRetries={99}
        showSkeleton={false}
      />
    );
    const image = screen.getByAltText('重试中的图片');
    fireEvent.error(image);

    rerender(
      <RetryImage
        src="https://example.com/new.png"
        alt="重试中的图片"
        initialRetryDelay={1000}
        bypassSWAfterRetries={99}
        showSkeleton={false}
      />
    );
    expect(image.getAttribute('src')).toBe('https://example.com/new.png');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(image.getAttribute('src')).toBe('https://example.com/new.png');
  });

  it('远程签名 URL 加载失败时从 Cache Storage 转为 Blob', async () => {
    const getCachedImageBlobWithThumbnailFallback = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    );
    getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(
      new Blob(['remote-image-data'], { type: 'image/png' })
    );
    const createObjectURL = vi.fn(() => 'blob:cached-remote-image');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });

    render(
      <RetryImage
        src="https://cdn.example.com/rabbit.png?x-signature=expired"
        alt="远程白板图片"
        showSkeleton={false}
        bypassSWAfterRetries={1}
      />
    );

    const image = screen.getByAltText('远程白板图片');
    fireEvent.error(image);

    await waitFor(() => {
      expect(getCachedImageBlobWithThumbnailFallback).toHaveBeenCalledWith(
        'https://cdn.example.com/rabbit.png?x-signature=expired'
      );
      expect(image.getAttribute('src')).toBe('blob:cached-remote-image');
    });
  });

  it('缓存回退不会改写外部签名 URL的查询参数', async () => {
    const signedUrl =
      'https://cdn.example.com/rabbit.png?X-Amz-Signature=signature';
    const getCachedImageBlobWithThumbnailFallback = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    );
    getCachedImageBlobWithThumbnailFallback.mockResolvedValue(null);

    vi.useFakeTimers();
    render(
      <RetryImage
        src={signedUrl}
        alt="签名图片"
        showSkeleton={false}
        initialRetryDelay={10}
        bypassSWAfterRetries={1}
      />
    );

    const image = screen.getByAltText('签名图片');
    fireEvent.error(image);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    expect(image.getAttribute('src')?.startsWith(`${signedUrl}#retry=`)).toBe(
      true
    );
    vi.useRealTimers();
  });

  it('白板模式挂载时优先使用 Cache Storage 中的远程图片', async () => {
    const getCachedImageBlobWithThumbnailFallback = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    );
    getCachedImageBlobWithThumbnailFallback.mockResolvedValueOnce(
      new Blob(['canvas-image-data'], { type: 'image/png' })
    );
    const createObjectURL = vi.fn(() => 'blob:canvas-cached-image');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    const onSourceChange = vi.fn();

    render(
      <RetryImage
        src="https://cdn.example.com/rabbit.png?signature=old"
        alt="白板缓存图片"
        showSkeleton={false}
        preferCachedBlob
        onSourceChange={onSourceChange}
      />
    );

    const image = screen.getByAltText('白板缓存图片');
    await waitFor(() => {
      expect(image.getAttribute('src')).toBe('blob:canvas-cached-image');
      expect(onSourceChange).toHaveBeenLastCalledWith(
        'blob:canvas-cached-image'
      );
    });
  });

  it('eager 预览无任何加载事件时结束骨架，回调变动不延长总期限', async () => {
    vi.useFakeTimers();
    const failure = vi.fn();
    const { rerender } = render(
      <RetryImage
        src="https://cdn.example.com/pending.png"
        alt="pending"
        eager
        loadTimeoutMs={1000}
        onLoadFailure={vi.fn()}
        fallback={<span>预览暂不可用</span>}
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(600));
    rerender(
      <RetryImage
        src="https://cdn.example.com/pending.png"
        alt="pending"
        eager
        loadTimeoutMs={1000}
        onLoadFailure={failure}
        fallback={<span>预览暂不可用</span>}
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(screen.getByText('预览暂不可用')).toBeTruthy();
    expect(screen.queryByAltText('pending')).toBeNull();
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0][0].name).toBe('ImageOperationTimeoutError');
  });

  it('已经显示成功的图片不会被迟到的缓存读取替换', async () => {
    let resolveBlob!: (value: Blob) => void;
    vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    ).mockReturnValue(
      new Promise((resolve) => {
        resolveBlob = resolve;
      })
    );
    const createObjectURL = vi.fn(() => 'blob:late-cache');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    render(
      <RetryImage
        src="https://cdn.example.com/loaded.png"
        alt="loaded"
        preferCachedBlob
      />
    );
    const image = screen.getByAltText('loaded');
    fireEvent.load(image);
    await act(async () => {
      resolveBlob(new Blob(['cached']));
    });
    expect(image.getAttribute('src')).toBe(
      'https://cdn.example.com/loaded.png'
    );
    expect(image.style.opacity).toBe('1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:late-cache');
  });

  it('成功后清理已安排的重试，不再覆盖图片', async () => {
    vi.useFakeTimers();
    render(
      <RetryImage
        src="https://cdn.example.com/retry.png"
        alt="retry"
        initialRetryDelay={100}
      />
    );
    const image = screen.getByAltText('retry');
    await act(async () => {
      fireEvent.error(image);
    });
    fireEvent.load(image);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(image.getAttribute('src')).toBe('https://cdn.example.com/retry.png');
    expect(image.style.opacity).toBe('1');
  });

  it('预览超时后忽略迟到的缓存结果并释放 Blob URL', async () => {
    vi.useFakeTimers();
    let resolveBlob!: (value: Blob) => void;
    vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    ).mockReturnValue(
      new Promise((resolve) => {
        resolveBlob = resolve;
      })
    );
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:too-late',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    render(
      <RetryImage
        src="https://cdn.example.com/late.png"
        alt="late"
        preferCachedBlob
        eager
        loadTimeoutMs={1000}
        fallback={<span>预览暂不可用</span>}
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await act(async () => {
      resolveBlob(new Blob(['late']));
    });
    expect(screen.getByText('预览暂不可用')).toBeTruthy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:too-late');
  });

  it('缓存 Blob 损坏时改读原地址，不反复解码同一个坏 Blob', async () => {
    vi.useFakeTimers();
    const source = 'https://cdn.example.com/image.png?signature=keep';
    const readCache = vi
      .mocked(unifiedCacheService.getCachedImageBlobWithThumbnailFallback)
      .mockResolvedValue(new Blob(['broken']));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:broken',
    });
    render(
      <RetryImage
        src={source}
        alt="cached"
        preferCachedBlob
        initialRetryDelay={10}
      />
    );
    await act(async () => undefined);
    const image = screen.getByAltText('cached');
    expect(image.getAttribute('src')).toBe('blob:broken');
    fireEvent.error(image);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(image.getAttribute('src')).toMatch(
      /^https:\/\/cdn\.example\.com\/image\.png\?signature=keep#retry=/
    );
    fireEvent.load(image);
    expect(image.style.opacity).toBe('1');
    expect(readCache).toHaveBeenCalledOnce();
  });

  it('屏外 lazy 图片不会在浏览器开始请求之前被判超时', async () => {
    vi.useFakeTimers();
    const failure = vi.fn();
    render(
      <RetryImage
        src="https://cdn.example.com/offscreen.png"
        alt="lazy"
        eager={false}
        loadTimeoutMs={1000}
        onLoadFailure={failure}
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(failure).not.toHaveBeenCalled();
    expect(screen.getByAltText('lazy')).toBeTruthy();
  });
});
