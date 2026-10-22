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
import { SelectedContentPreview } from './SelectedContentPreview';
import { unifiedCacheService } from '../../services/unified-cache-service';

vi.mock('@aitu/utils', () => ({
  normalizeImageDataUrl: (value: string) => value,
}));
vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: { getCachedImageBlobWithThumbnailFallback: vi.fn() },
}));
vi.mock('./hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));

const items = [
  { type: 'image' as const, url: '/asset-library/first.png', name: '图片一' },
  { type: 'image' as const, url: '/asset-library/second.png', name: '图片二' },
];
const readCache = vi.mocked(
  unifiedCacheService.getCachedImageBlobWithThumbnailFallback
);

beforeEach(() => {
  vi.useFakeTimers();
  readCache.mockReset().mockResolvedValue(null);
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview');
      static revokeObjectURL = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('selected content image previews', () => {
  it('两图独立加载，失败后重试只恢复对应图片且不提交表单', async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <SelectedContentPreview items={items} />
      </form>
    );
    await act(async () => undefined);
    expect(
      screen.getByRole('status', { name: '正在加载图片：图片一' })
    ).toBeTruthy();
    expect(screen.getByAltText('图片一').style.visibility).toBe('hidden');
    const second = screen.getByAltText('图片二');
    fireEvent.load(second);
    expect(second.style.visibility).toBe('visible');
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    const retry = screen.getByRole('button', {
      name: '图片预览加载失败，点击重试：图片一',
    });
    expect(screen.queryByAltText('图片一')).toBeNull();
    readCache.mockResolvedValue(new Blob(['ready']));
    await act(async () => {
      fireEvent.click(retry);
    });
    const first = screen.getByAltText('图片一');
    expect(first.getAttribute('src')).toBe('blob:preview');
    fireEvent.load(first);
    expect(first.style.visibility).toBe('visible');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByAltText('图片二')).toBe(second);
    expect(submit).not.toHaveBeenCalled();
  });

  it('替换选中图片后立即清除旧失败状态，不采用迟到的旧缓存', async () => {
    let resolveOld!: (blob: Blob) => void;
    readCache.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      })
    );
    const { rerender } = render(<SelectedContentPreview items={[items[0]]} />);
    rerender(<SelectedContentPreview items={[items[1]]} />);
    await act(async () => {
      resolveOld(new Blob(['old']));
    });
    expect(screen.getByAltText('图片二').getAttribute('src')).toBe(
      items[1].url
    );
    expect(screen.queryByAltText('图片一')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(
      screen.getByRole('button', { name: /点击重试：图片二/ })
    ).toBeTruthy();
    rerender(<SelectedContentPreview items={[items[0]]} />);
    expect(screen.queryByRole('button', { name: /点击重试/ })).toBeNull();
    expect(
      screen.getByRole('status', { name: /正在加载图片：图片一/ })
    ).toBeTruthy();
  });

  it('蒙版与原图独立加载，悬停预览不新增无法点击的重试按钮', async () => {
    render(
      <SelectedContentPreview
        items={[{ ...items[0], maskImage: 'data:image/png;base64,bad' }]}
        language="en"
      />
    );
    await act(async () => undefined);
    fireEvent.load(screen.getByAltText('图片一'));
    fireEvent.error(screen.getByAltText('图片一 mask'));
    expect(
      screen.getByRole('button', {
        name: 'Image preview failed. Retry: 图片一 mask',
      })
    ).toBeTruthy();
    expect(screen.getByAltText('图片一').style.visibility).toBe('visible');
    const item = screen
      .getByAltText('图片一')
      .closest('.selected-content-preview__item');
    if (!item) throw new Error('Missing preview item');
    fireEvent.mouseEnter(item);
    fireEvent.error(screen.getByAltText('Preview mask'));
    expect(
      screen.queryByRole('button', { name: /Retry: Preview mask/ })
    ).toBeNull();
    expect(
      screen.getByRole('img', { name: /Retry from the thumbnail/ })
    ).toBeTruthy();
  });
});
