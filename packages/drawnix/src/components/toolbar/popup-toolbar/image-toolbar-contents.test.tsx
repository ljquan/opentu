import {
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ImageToolbarContents,
  IMAGE_TOOLBAR_PREFERENCES_KEY,
} from './image-toolbar-contents';
import { ToolButton } from '../../tool-button';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('image shortcuts', () => {
  it('keeps a hidden tool accessible through the more menu', async () => {
    localStorage.setItem(
      IMAGE_TOOLBAR_PREFERENCES_KEY,
      JSON.stringify({ hidden: ['custom'], labels: false })
    );
    const action = vi.fn();
    render(
      <ImageToolbarContents enabled container={document.body}>
        <ToolButton
          type="icon"
          className="custom"
          visible
          aria-label="手动拆图"
          onClick={action}
        />
      </ImageToolbarContents>
    );
    expect(screen.queryByRole('button', { name: '手动拆图' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多图片工具' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '手动拆图' })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('button', { name: '手动拆图' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('leaves non-image tools available despite saved image preferences', () => {
    localStorage.setItem(
      IMAGE_TOOLBAR_PREFERENCES_KEY,
      JSON.stringify({ hidden: ['custom'], labels: true })
    );
    render(
      <ImageToolbarContents enabled={false} container={document.body}>
        <ToolButton
          type="icon"
          className="custom"
          visible
          aria-label="文本工具"
        />
      </ImageToolbarContents>
    );
    expect(screen.getByRole('button', { name: '文本工具' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '更多图片工具' })).toBeNull();
  });
});
