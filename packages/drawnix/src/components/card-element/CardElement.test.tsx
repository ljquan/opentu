import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { CardElement } from './CardElement';
import type { PlaitCard } from '../../types/card.types';

const copyToClipboard = vi.hoisted(() => vi.fn());

vi.mock('../../utils/runtime-helpers', () => ({ copyToClipboard }));
vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));

const card: PlaitCard = {
  id: 'card-1',
  type: 'card',
  title: '转身就快乐',
  body: '歌词正文\n第二行',
  fillColor: '#4A90D9',
  points: [
    [0, 0],
    [720, 320],
  ],
};

describe('CardElement actions', () => {
  beforeEach(() => {
    copyToClipboard.mockReset();
    copyToClipboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
  });

  it('copies the full card text from the title action', async () => {
    render(<CardElement element={card} />);

    fireEvent.click(screen.getByRole('button', { name: '复制文本内容' }));

    expect(copyToClipboard).toHaveBeenCalledWith(
      '转身就快乐\n\n歌词正文\n第二行'
    );
    expect(await screen.findByRole('button', { name: '已复制' })).toBeTruthy();
  });

  it('allows selecting text inside the card body', () => {
    render(<CardElement element={card} />);

    const body = screen
      .getByText(/歌词正文/)
      .closest('[tabindex="0"]') as HTMLElement;
    expect(body?.style.userSelect).toBe('text');
  });

  it('shows copy failure and allows retrying', async () => {
    copyToClipboard.mockRejectedValueOnce(new Error('clipboard blocked'));
    render(<CardElement element={card} />);
    fireEvent.click(screen.getByRole('button', { name: '复制文本内容' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '复制失败，请重试' })
    );
    expect(await screen.findByRole('button', { name: '已复制' })).toBeTruthy();
    expect(copyToClipboard).toHaveBeenCalledTimes(2);
  });

  it('copies only the body when the title is missing', async () => {
    render(<CardElement element={{ ...card, title: undefined }} />);
    fireEvent.click(screen.getByRole('button', { name: '复制文本内容' }));
    await screen.findByRole('button', { name: '已复制' });
    expect(copyToClipboard).toHaveBeenCalledWith(card.body);
  });

  it.each([true, false])(
    'copies the selected text without reaching canvas shortcuts (meta: %s)',
    (metaKey) => {
      const onKeyDown = vi.fn();
      render(
        <div onKeyDown={onKeyDown}>
          <CardElement element={card} />
        </div>
      );
      const paragraph = screen.getByText(/歌词正文/);
      const body = paragraph.closest('[tabindex="0"]') as HTMLElement;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      window.getSelection()?.addRange(range);

      fireEvent.keyDown(body, { key: 'c', metaKey, ctrlKey: !metaKey });

      expect(copyToClipboard).toHaveBeenCalledWith(
        window.getSelection()?.toString()
      );
      expect(onKeyDown).not.toHaveBeenCalled();
    }
  );

  it('keeps copy button pointer events from dragging the canvas and copies once on click', async () => {
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <CardElement element={card} />
      </div>
    );
    const button = screen.getByRole('button', { name: '复制文本内容' });
    fireEvent.pointerDown(button);
    fireEvent.mouseDown(button);
    fireEvent.pointerUp(button);
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByRole('button', { name: '已复制' });
    expect(copyToClipboard).toHaveBeenCalledTimes(1);
  });

  it('preserves the linked knowledge base action', () => {
    const listener = vi.fn();
    window.addEventListener('kb:open', listener);
    try {
      render(<CardElement element={{ ...card, noteId: 'note-1' }} />);
      fireEvent.click(screen.getByRole('button', { name: '打开知识库笔记' }));
      expect(listener.mock.calls[0][0].detail).toEqual({ noteId: 'note-1' });
    } finally {
      window.removeEventListener('kb:open', listener);
    }
  });
});
