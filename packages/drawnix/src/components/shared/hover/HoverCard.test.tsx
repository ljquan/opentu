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
import { HoverCard } from './HoverCard';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HoverCard focus behavior', () => {
  it('preserves focus transfer by default for existing callers', async () => {
    render(
      <HoverCard content={<button type="button">预览操作</button>}>
        <button type="button">触发预览</button>
      </HoverCard>
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: '触发预览' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: '预览操作' })
      );
    });
  });

  it('keeps the editor focused when a passive preview opts out', async () => {
    vi.useFakeTimers();
    render(
      <>
        <textarea aria-label="编辑器" />
        <HoverCard autoFocus={false} content={<span>图片预览</span>}>
          <button type="button">触发预览</button>
        </HoverCard>
      </>
    );
    const editor = screen.getByRole('textbox', { name: '编辑器' });
    editor.focus();
    fireEvent.mouseEnter(screen.getByRole('button', { name: '触发预览' }));
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByText('图片预览')).not.toBeNull();
    expect(document.activeElement).toBe(editor);
  });
});
