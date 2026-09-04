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
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
