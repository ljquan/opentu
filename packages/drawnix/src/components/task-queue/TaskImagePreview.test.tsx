// @vitest-environment jsdom
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskImagePreview,
  TASK_IMAGE_PREVIEW_TIMEOUT_MS,
} from './TaskImagePreview';
import { unifiedCacheService } from '../../services/unified-cache-service';

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: { getCachedImageBlobWithThumbnailFallback: vi.fn() },
}));
vi.mock('@aitu/utils', () => ({
  normalizeImageDataUrl: (value: string) => value,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(unifiedCacheService.getCachedImageBlobWithThumbnailFallback)
    .mockReset()
    .mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskImagePreview', () => {
  it('offers a preview-only retry for a stalled completed result', async () => {
    const source = 'https://cdn.example.com/generated.png?signature=unchanged';
    const openDetails = vi.fn();
    render(
      <div onClick={openDetails}>
        <TaskImagePreview src={source} isCached={false} />
      </div>
    );
    expect(screen.getByAltText('Generated').getAttribute('loading')).toBe(
      'eager'
    );
    await act(() => vi.advanceTimersByTimeAsync(TASK_IMAGE_PREVIEW_TIMEOUT_MS));
    expect(screen.getByText('预览暂不可用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载预览' }));
    await act(async () => undefined);
    expect(openDetails).not.toHaveBeenCalled();
    const image = screen.getByAltText('Generated');
    expect(image.getAttribute('src')).toBe(source);
    fireEvent.load(image);
    expect(image.style.opacity).toBe('1');
    expect(screen.queryByText('预览暂不可用')).toBeNull();
  });

  it('does not fall back to Cache Storage after a manual remote retry fails', async () => {
    const source = 'https://cdn.example.com/unavailable.png';
    const readCache = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    );
    render(<TaskImagePreview src={source} isCached={false} />);

    await act(() => vi.advanceTimersByTimeAsync(TASK_IMAGE_PREVIEW_TIMEOUT_MS));
    fireEvent.click(screen.getByRole('button', { name: '重新加载预览' }));
    fireEvent.error(screen.getByAltText('Generated'));
    await act(async () => undefined);

    expect(readCache).not.toHaveBeenCalled();
  });

  it('bypasses a stalled cached Blob when manually reloading a preview', async () => {
    const source = 'https://cdn.example.com/cached.png?signature=unchanged';
    const readCache = vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    ).mockResolvedValue(new Blob(['stalled cache'], { type: 'image/png' }));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:stalled-cache',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    render(<TaskImagePreview src={source} isCached />);
    await act(async () => undefined);
    expect(screen.getByAltText('Generated').getAttribute('src')).toBe(
      'blob:stalled-cache'
    );

    await act(() => vi.advanceTimersByTimeAsync(TASK_IMAGE_PREVIEW_TIMEOUT_MS));
    fireEvent.click(screen.getByRole('button', { name: '重新加载预览' }));
    await act(async () => undefined);

    expect(readCache).toHaveBeenCalledOnce();
    const image = screen.getByAltText('Generated');
    expect(image.getAttribute('src')).toBe(source);
    fireEvent.load(image);
    expect(screen.queryByText('预览暂不可用')).toBeNull();
  });

  it('retries a failed virtual thumbnail with the original media URL', async () => {
    const thumbnail =
      'http://localhost/__aitu_cache__/image/123.png?thumbnail=small';
    const original = 'http://localhost/__aitu_cache__/image/123.png';
    render(
      <TaskImagePreview
        src={thumbnail}
        originalSrc={original}
        isCached={false}
      />
    );

    await act(() => vi.advanceTimersByTimeAsync(TASK_IMAGE_PREVIEW_TIMEOUT_MS));
    fireEvent.click(screen.getByRole('button', { name: '重新加载预览' }));

    expect(screen.getByAltText('Generated').getAttribute('src')).toBe(original);
  });

  it('recovers automatically when the result becomes cached after a preview failure', async () => {
    const source = 'https://cdn.example.com/cache-later.png';
    const { rerender } = render(
      <TaskImagePreview src={source} isCached={false} />
    );
    await act(() => vi.advanceTimersByTimeAsync(TASK_IMAGE_PREVIEW_TIMEOUT_MS));
    vi.mocked(
      unifiedCacheService.getCachedImageBlobWithThumbnailFallback
    ).mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:available',
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    rerender(<TaskImagePreview src={source} isCached />);
    await act(async () => undefined);
    const image = screen.getByAltText('Generated');
    expect(image.getAttribute('src')).toBe('blob:available');
    fireEvent.load(image);
    expect(image.style.opacity).toBe('1');
  });
});
