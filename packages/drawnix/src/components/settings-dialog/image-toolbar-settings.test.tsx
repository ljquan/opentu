import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageToolbarSettings } from './image-toolbar-settings';
import {
  IMAGE_TOOLBAR_PREFERENCES_KEY,
  IMAGE_TOOLBAR_PREFERENCES_EVENT,
} from '../../utils/image-toolbar-preferences';
import { ImageToolbarContents } from '../toolbar/popup-toolbar/image-toolbar-contents';
import { ToolButton } from '../tool-button';
import { MessagePlugin } from 'tdesign-react';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ImageToolbarSettings', () => {
  it('offers one editing entry after merging manual split into the editor', () => {
    render(<ImageToolbarSettings />);
    expect(screen.getByRole('checkbox', { name: '编辑图片' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '手动拆图' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: '本地放大' })).toBeNull();
  });
  it('persists fixed tools and label visibility through the shared preference event', () => {
    const eventSpy = vi.spyOn(window, 'dispatchEvent');
    render(<ImageToolbarSettings />);

    const resize = screen.getByRole('checkbox', { name: '编辑图片' });
    fireEvent.click(resize);
    const labels = screen.getByLabelText('显示工具文字');
    fireEvent.click(labels);

    const saved = JSON.parse(
      localStorage.getItem(IMAGE_TOOLBAR_PREFERENCES_KEY) || '{}'
    );
    expect(saved.hidden).toContain('image-edit');
    expect(saved.labels).toBe(true);
    expect(eventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: IMAGE_TOOLBAR_PREFERENCES_EVENT })
    );
  });

  it('reads existing hidden tools when opened', () => {
    localStorage.setItem(
      IMAGE_TOOLBAR_PREFERENCES_KEY,
      JSON.stringify({ hidden: ['download'], labels: true })
    );
    render(<ImageToolbarSettings />);
    expect((screen.getByLabelText('下载') as HTMLInputElement).checked).toBe(
      false
    );
    expect(
      (screen.getByLabelText('显示工具文字') as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (screen.getByLabelText('显示参考图连线') as HTMLInputElement).checked
    ).toBe(false);
  });

  it('persists reference line visibility across reopening and other toolbar changes', () => {
    const view = render(<ImageToolbarSettings />);
    const lines = screen.getByRole('checkbox', {
      name: '显示参考图连线',
    }) as HTMLInputElement;
    expect(lines.checked).toBe(false);
    fireEvent.click(lines);
    fireEvent.click(screen.getByLabelText('显示工具文字'));
    fireEvent.click(screen.getByLabelText('下载'));
    expect(
      JSON.parse(localStorage.getItem(IMAGE_TOOLBAR_PREFERENCES_KEY) || '{}')
    ).toEqual({ hidden: ['download'], labels: true, referenceLines: true });

    view.unmount();
    render(<ImageToolbarSettings />);
    const restored = screen.getByLabelText(
      '显示参考图连线'
    ) as HTMLInputElement;
    expect(restored.checked).toBe(true);
    fireEvent.click(restored);
    expect(restored.checked).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(IMAGE_TOOLBAR_PREFERENCES_KEY) || '{}')
    ).toEqual({ hidden: ['download'], labels: true, referenceLines: false });
  });

  it.each(['编辑图片', '显示参考图连线'])(
    'keeps %s saved and reports an error if storage rejects the change',
    (name) => {
      const notify = vi
        .spyOn(MessagePlugin, 'error')
        .mockResolvedValue(undefined as never);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const dispatch = vi.spyOn(window, 'dispatchEvent');
      vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      render(<ImageToolbarSettings />);
      const checkbox = screen.getByRole('checkbox', {
        name,
      }) as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(name === '编辑图片');
      expect(notify).toHaveBeenCalledWith('图片工具栏配置保存失败，请重试');
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: IMAGE_TOOLBAR_PREFERENCES_EVENT })
      );
    }
  );

  it('updates an already mounted toolbar and keeps unpinned actions reachable', async () => {
    const action = vi.fn();
    render(
      <>
        <ImageToolbarSettings />
        <ImageToolbarContents enabled container={document.body}>
          <ToolButton
            type="icon"
            className="image-edit"
            visible
            aria-label="编辑图片"
            onClick={action}
          />
        </ImageToolbarContents>
      </>
    );
    expect(screen.getByRole('button', { name: '编辑图片' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('显示工具文字'));
    expect(screen.getByRole('button', { name: '编辑图片' }).textContent).toBe(
      '编辑图片'
    );
    expect(screen.queryByRole('button', { name: '更多图片工具' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '编辑图片' }));
    expect(screen.queryByRole('button', { name: '编辑图片' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多图片工具' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑图片' }));
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox', { name: '编辑图片' }));
    expect(screen.queryByRole('button', { name: '更多图片工具' })).toBeNull();
    expect(screen.getByRole('button', { name: '编辑图片' })).toBeTruthy();
  });
});
