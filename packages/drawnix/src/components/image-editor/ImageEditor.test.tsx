import React, { createRef } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageEditor } from './ImageEditor';
import { ImageEditorCore, type ImageEditorCoreRef } from './ImageEditorCore';
import { DecodedImagePreview } from './DecodedImagePreview';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  draw: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('../../data/image', () => ({ loadImageElementForCanvas: mocks.load }));
vi.mock('../../utils/message-plugin', () => ({
  MessagePlugin: {
    error: mocks.error,
    success: mocks.success,
    loading: vi.fn(),
    close: vi.fn(),
  },
}));
vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));

const image = {
  width: 100,
  height: 80,
  naturalWidth: 100,
  naturalHeight: 80,
  src: 'blob:revoked',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(image);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: mocks.draw,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    function (this: HTMLCanvasElement) {
      return `data:image/png;base64,${this.width}x${this.height}`;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openSplit(
  onSplit = vi.fn().mockResolvedValue(undefined),
  onClose = vi.fn()
) {
  render(
    <ImageEditor
      visible
      imageUrl="/__aitu_cache__/image/source.png"
      onSplit={onSplit}
      onClose={onClose}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '拆分' }));
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: '拆分并插入画布' })
        .hasAttribute('disabled')
    ).toBe(false)
  );
  return { onSplit, onClose };
}

describe('combined image editor', () => {
  it('offers resize only to callers with canvas insertion support', async () => {
    const { rerender } = render(<ImageEditorCore imageUrl="source.png" />);
    await screen.findByRole('img', { name: 'Crop' });
    expect(
      screen.queryByRole('button', { name: '缩放', exact: true })
    ).toBeNull();
    rerender(<ImageEditorCore imageUrl="source.png" onResize={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    expect(screen.getByLabelText('目标长边（像素）')).toBeTruthy();
    expect(screen.getByRole('img', { name: '缩放原图预览' }).tagName).toBe(
      'CANVAS'
    );
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('preserves resize parameters and other edits when switching tools', async () => {
    const ref = createRef<ImageEditorCoreRef>();
    const resize = vi.fn().mockResolvedValue({ width: 400, height: 320 });
    render(
      <ImageEditorCore
        ref={ref}
        imageUrl="source.png"
        onResize={resize}
        onSplit={vi.fn()}
      />
    );
    await screen.findByRole('img', { name: 'Crop' });
    const editor = ref.current;
    if (!editor) throw new Error('Editor did not mount');
    const state = {
      ...editor.getState(),
      cropArea: { x: 10, y: 10, width: 40, height: 30 },
      rotation: 90,
      filterType: 'sepia' as const,
    };
    act(() => editor.setState(state));
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    fireEvent.change(screen.getByLabelText('目标长边（像素）'), {
      target: { value: '400' },
    });
    fireEvent.change(screen.getByLabelText('插值方式'), {
      target: { value: 'nearest' },
    });
    for (const name of ['裁剪', '拆分', '滤镜', '缩放'])
      fireEvent.click(screen.getByRole('button', { name, exact: true }));
    expect(
      (screen.getByLabelText('目标长边（像素）') as HTMLInputElement).value
    ).toBe('400');
    expect(ref.current?.getState()).toEqual(state);
    fireEvent.click(screen.getByRole('button', { name: '缩放并插入画布' }));
    await waitFor(() => expect(resize).toHaveBeenCalledOnce());
    expect(resize.mock.calls[0][0]).toEqual({
      image,
      target: 400,
      algorithm: 'nearest',
    });
    expect(mocks.success).toHaveBeenCalledWith(
      expect.stringContaining('400 × 320'),
      4000
    );
  });

  it('rejects unchanged or invalid dimensions before calling the resize operation', async () => {
    const resize = vi.fn();
    render(<ImageEditorCore imageUrl="source.png" onResize={resize} />);
    await screen.findByRole('img', { name: 'Crop' });
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    for (const value of ['100', '0', '']) {
      fireEvent.change(screen.getByLabelText('目标长边（像素）'), {
        target: { value },
      });
      expect(
        screen
          .getByRole('button', { name: '缩放并插入画布' })
          .hasAttribute('disabled')
      ).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: '缩放并插入画布' }));
    }
    expect(resize).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('目标长边（像素）'), {
      target: { value: '400' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: '缩放并插入画布' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('allows a smaller long edge and submits the original for proportional downscaling', async () => {
    const resize = vi.fn().mockResolvedValue({ width: 50, height: 40 });
    render(<ImageEditorCore imageUrl="source.png" onResize={resize} />);
    await screen.findByRole('img', { name: 'Crop' });
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    fireEvent.change(screen.getByLabelText('目标长边（像素）'), {
      target: { value: '50' },
    });
    expect(screen.getByLabelText('缩放前后尺寸').textContent).toContain(
      '50 × 40'
    );
    const confirm = screen.getByRole('button', { name: '缩放并插入画布' });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(resize).toHaveBeenCalledOnce());
    expect(resize.mock.calls[0][0]).toEqual({
      image,
      target: 50,
      algorithm: 'high',
    });
    expect(mocks.success).toHaveBeenCalledWith(
      expect.stringContaining('缩放完成：50 × 40'),
      4000
    );
  });

  it('keeps scale presets and manual pixel input in sync across tool switches', async () => {
    render(<ImageEditorCore imageUrl="source.png" onResize={vi.fn()} />);
    await screen.findByRole('img', { name: 'Crop' });
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    const factor = screen.getByLabelText('缩放倍数') as HTMLSelectElement;
    for (const [value, pixels, output] of [
      ['0.25', '25', '25 × 20'],
      ['0.5', '50', '50 × 40'],
      ['2', '200', '200 × 160'],
      ['4', '400', '400 × 320'],
    ]) {
      fireEvent.change(factor, { target: { value } });
      expect(
        (screen.getByLabelText('目标长边（像素）') as HTMLInputElement).value
      ).toBe(pixels);
      expect(screen.getByLabelText('缩放前后尺寸').textContent).toContain(
        output
      );
    }
    fireEvent.change(screen.getByLabelText('目标长边（像素）'), {
      target: { value: '73' },
    });
    expect(factor.value).toBe('custom');
    fireEvent.change(screen.getByLabelText('目标长边（像素）'), {
      target: { value: '50' },
    });
    expect(factor.value).toBe('0.5');
    fireEvent.click(screen.getByRole('button', { name: '裁剪', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    expect((screen.getByLabelText('缩放倍数') as HTMLSelectElement).value).toBe(
      '0.5'
    );
    fireEvent.change(screen.getByLabelText('缩放倍数'), {
      target: { value: '1' },
    });
    expect(screen.getByRole('alert').textContent).toContain(
      '目标尺寸与原图一致'
    );
    expect(
      screen
        .getByRole('button', { name: '缩放并插入画布' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('rounds preset pixels for an odd-sized image and disables presets while processing', async () => {
    mocks.load.mockResolvedValue({ ...image, width: 101, naturalWidth: 101 });
    const resize = vi.fn().mockReturnValue(new Promise(() => undefined));
    render(<ImageEditorCore imageUrl="source.png" onResize={resize} />);
    await screen.findByRole('img', { name: 'Crop' });
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    fireEvent.change(screen.getByLabelText('缩放倍数'), {
      target: { value: '0.5' },
    });
    expect(
      (screen.getByLabelText('目标长边（像素）') as HTMLInputElement).value
    ).toBe('51');
    expect((screen.getByLabelText('缩放倍数') as HTMLSelectElement).value).toBe(
      '0.5'
    );
    fireEvent.click(screen.getByRole('button', { name: '缩放并插入画布' }));
    expect(screen.getByLabelText('缩放倍数').hasAttribute('disabled')).toBe(
      true
    );
  });

  it('blocks all mode changes and closing while resize is pending, then permits retry after failure', async () => {
    let fail!: (error: Error) => void;
    const resize = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          })
      )
      .mockResolvedValue({ width: 2048, height: 1638 });
    const close = vi.fn();
    render(
      <ImageEditor
        visible
        imageUrl="source.png"
        onResize={resize}
        onSplit={vi.fn()}
        onClose={close}
      />
    );
    await screen.findByRole('img', { name: 'Crop' });
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '缩放并插入画布' }));
    fireEvent.click(screen.getByRole('button', { name: '缩放并插入画布' }));
    for (const name of ['裁剪', '拆分', '滤镜', '关闭图片编辑器'])
      expect(
        screen
          .getByRole('button', { name, exact: true })
          .hasAttribute('disabled')
      ).toBe(true);
    const backdrop = document.querySelector('.image-editor__backdrop');
    if (!backdrop) throw new Error('Missing backdrop');
    fireEvent.click(backdrop);
    expect(close).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledOnce();
    await act(async () => fail(new Error('缓存写入失败')));
    expect(screen.getByRole('alert').textContent).toBe('缓存写入失败');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '缩放并插入画布' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('aborts resize on unmount and ignores a late result', async () => {
    let finish!: (output: { width: number; height: number }) => void;
    const resize = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const close = vi.fn();
    const { unmount } = render(
      <ImageEditorCore
        imageUrl="source.png"
        onResize={resize}
        onClose={close}
      />
    );
    await screen.findByRole('img', { name: 'Crop' });
    fireEvent.click(screen.getByRole('button', { name: '缩放', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '缩放并插入画布' }));
    const signal = resize.mock.calls[0][2] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ width: 2048, height: 1638 }));
    expect(close).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('draws crop and filter previews from the decoded original instead of reloading its URL', async () => {
    const { container } = render(
      <ImageEditorCore imageUrl="/__aitu_cache__/image/source.png" />
    );
    const crop = await screen.findByRole('img', { name: 'Crop' });
    expect(crop.tagName).toBe('CANVAS');
    expect(mocks.draw).toHaveBeenCalledWith(image, 0, 0, 100, 80);
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('blob:revoked');
    expect(
      container.querySelector('.crop-canvas__crop-image canvas')
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '滤镜' }));
    expect(screen.getByRole('img', { name: 'Preview' }).tagName).toBe('CANVAS');
    expect(
      container.querySelectorAll('.filter-panel__preset-preview canvas').length
    ).toBeGreaterThan(0);
    expect(
      container
        .querySelector('.image-editor-core__filter-preview')
        ?.getAttribute('style')
    ).not.toContain('none scale');
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('compares the decoded original both before and after confirming a crop', async () => {
    const { container } = render(<ImageEditorCore imageUrl="cached.png" />);
    await screen.findByRole('img', { name: 'Crop' });
    const compare = container.querySelector(
      '.image-editor-core__actions button:nth-of-type(3)'
    );
    if (!compare) throw new Error('Missing compare button');
    fireEvent.mouseDown(compare);
    expect(screen.getByRole('img', { name: 'Original' }).tagName).toBe(
      'CANVAS'
    );
    fireEvent.mouseUp(compare);
    fireEvent.click(screen.getByRole('button', { name: '应用裁剪' }));
    fireEvent.mouseDown(compare);
    expect(screen.getByRole('img', { name: 'Original' }).tagName).toBe(
      'CANVAS'
    );
    expect(container.querySelector('img')).toBeNull();
    fireEvent.mouseUp(compare);
  });

  it('bounds preview buffers and clears them on unmount without changing source pixels', () => {
    const largeImage = {
      ...image,
      width: 8000,
      height: 4000,
      naturalWidth: 8000,
      naturalHeight: 4000,
    };
    const { unmount } = render(
      <DecodedImagePreview
        image={largeImage as HTMLImageElement}
        label="large"
      />
    );
    const canvas = screen.getByRole('img', {
      name: 'large',
    }) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([2048, 1024]);
    expect(canvas.style.width).toBe('8000px');
    expect(largeImage.naturalWidth).toBe(8000);
    unmount();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('shows loading and failure in crop mode instead of leaving an empty canvas', async () => {
    let reject!: (error: Error) => void;
    mocks.load.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      })
    );
    render(<ImageEditorCore imageUrl="missing.png" onSave={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('正在加载');
    expect(
      screen.getByRole('button', { name: '保存图片' }).hasAttribute('disabled')
    ).toBe(true);
    await act(async () => reject(new Error('missing image')));
    expect(screen.getByRole('alert').textContent).toContain('图片加载失败');
    expect(screen.queryByRole('img', { name: 'Crop' })).toBeNull();
  });

  it('discards a late image after changing source and after unmount', async () => {
    let resolveOld!: (value: typeof image) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((done) => {
        resolveOld = done;
      })
    );
    const nextImage = {
      ...image,
      src: 'blob:next',
      width: 240,
      naturalWidth: 240,
    };
    mocks.load.mockResolvedValueOnce(nextImage);
    const { rerender, unmount } = render(
      <ImageEditorCore imageUrl="old.png" />
    );
    rerender(<ImageEditorCore imageUrl="next.png" />);
    await screen.findByRole('img', { name: 'Crop' });
    mocks.draw.mockClear();
    await act(async () => resolveOld(image));
    expect(mocks.draw).not.toHaveBeenCalledWith(image, 0, 0, 100, 80);
    expect(
      (screen.getByRole('img', { name: 'Crop' }) as HTMLCanvasElement).width
    ).toBe(240);
    let resolveUnmounted!: (value: typeof image) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((done) => {
        resolveUnmounted = done;
      })
    );
    rerender(<ImageEditorCore imageUrl="last.png" />);
    unmount();
    mocks.draw.mockClear();
    await act(async () => resolveUnmounted(image));
    expect(mocks.draw).not.toHaveBeenCalled();
  });

  it('still saves a single cropped image through the original save flow', async () => {
    const onSave = vi.fn();
    const ref = createRef<ImageEditorCoreRef>();
    render(
      <ImageEditorCore
        ref={ref}
        imageUrl="source.png"
        onSave={onSave}
        onSplit={vi.fn()}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    const editor = ref.current;
    if (!editor) throw new Error('Editor did not mount');
    act(() =>
      editor.setState({
        ...editor.getState(),
        cropArea: { x: 10, y: 10, width: 40, height: 30 },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: '保存图片' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith(
      'data:image/png;base64,40x30'
    );
    expect(mocks.draw).toHaveBeenCalledWith(
      image,
      10,
      10,
      40,
      30,
      -20,
      -15,
      40,
      30
    );
  });

  it('splits decoded original pixels in one batch from the existing editor window', async () => {
    const { onSplit, onClose } = await openSplit();
    expect(mocks.load).toHaveBeenCalledWith('/__aitu_cache__/image/source.png');
    expect(screen.getByRole('img', { name: '原图与分割线预览' }).tagName).toBe(
      'CANVAS'
    );
    fireEvent.change(screen.getByLabelText('横向分割线（%）'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('纵向分割线（%）'), {
      target: { value: '25,75' },
    });
    expect(screen.getByRole('status').textContent).toContain('3 张图片');
    fireEvent.click(screen.getByRole('button', { name: '拆分并插入画布' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSplit).toHaveBeenCalledExactlyOnceWith([
      'data:image/png;base64,25x80',
      'data:image/png;base64,50x80',
      'data:image/png;base64,25x80',
    ]);
    expect(mocks.draw).toHaveBeenCalledWith(image, 25, 0, 50, 80, 0, 0, 50, 80);
  });

  it('blocks invalid cuts and allows correction without leaving the editor', async () => {
    const { onSplit } = await openSplit();
    fireEvent.change(screen.getByLabelText('横向分割线（%）'), {
      target: { value: '100' },
    });
    expect(screen.getByRole('alert').textContent).toContain('0 到 100');
    expect(
      screen
        .getByRole('button', { name: '拆分并插入画布' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(onSplit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('横向分割线（%）'), {
      target: { value: '50' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: '拆分并插入画布' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('prevents duplicate submissions and retains the editor after insertion fails', async () => {
    let reject!: (error: Error) => void;
    const onSplit = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, rejectPromise) => {
            reject = rejectPromise;
          })
      )
      .mockResolvedValue(undefined);
    const onClose = vi.fn();
    await openSplit(onSplit, onClose);
    const save = screen.getByRole('button', { name: '拆分并插入画布' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: '裁剪' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: '关闭图片编辑器' })
        .hasAttribute('disabled')
    ).toBe(true);
    await act(async () => reject(new Error('图片插入失败')));
    expect(screen.getByRole('alert').textContent).toBe('图片插入失败');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('preserves crop, rotation and filter state when switching between tools', async () => {
    const ref = createRef<ImageEditorCoreRef>();
    render(
      <ImageEditorCore ref={ref} imageUrl="source.png" onSplit={vi.fn()} />
    );
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    const editor = ref.current;
    if (!editor) throw new Error('Editor did not mount');
    const state = {
      ...editor.getState(),
      cropArea: { x: 10, y: 10, width: 40, height: 30 },
      rotation: 90,
      filterType: 'sepia' as const,
    };
    act(() => editor.setState(state));
    fireEvent.click(screen.getByRole('button', { name: '拆分' }));
    fireEvent.click(screen.getByRole('button', { name: '滤镜' }));
    fireEvent.click(screen.getByRole('button', { name: '裁剪' }));
    expect(ref.current?.getState()).toEqual(state);
  });

  it('keeps split unavailable for editor callers without batch insertion support', async () => {
    render(<ImageEditor visible imageUrl="source.png" onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '拆分' })).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('splits the whole original into four equal regions by default', async () => {
    const { onSplit, onClose } = await openSplit();
    mocks.draw.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '拆分并插入画布' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSplit.mock.calls[0][0]).toHaveLength(4);
    expect(mocks.draw.mock.calls.map((call) => call.slice(1, 5))).toEqual([
      [0, 0, 50, 40],
      [50, 0, 50, 40],
      [0, 40, 50, 40],
      [50, 40, 50, 40],
    ]);
  });

  it('shows loading failures and keeps split submission disabled', async () => {
    mocks.load.mockRejectedValue(new Error('missing image'));
    render(
      <ImageEditor
        visible
        imageUrl="missing.png"
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '拆分' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '图片加载失败'
    );
    expect(
      screen
        .getByRole('button', { name: '拆分并插入画布' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('retains the editor and avoids inserting a batch if image encoding fails', async () => {
    const { onSplit, onClose } = await openSplit();
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      () => {
        throw new Error('图片编码失败');
      }
    );
    fireEvent.click(screen.getByRole('button', { name: '拆分并插入画布' }));
    expect(screen.getByRole('alert').textContent).toBe('图片编码失败');
    expect(onSplit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
