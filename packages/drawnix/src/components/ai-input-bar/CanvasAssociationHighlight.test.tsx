import React, { createRef } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaitElement } from '@plait/core';
import type { CanvasAssociationRef } from '../../types/shared/core.types';
import {
  CanvasAssociationHighlight,
  getAssociationPreviewUrl,
} from './CanvasAssociationHighlight';

vi.mock('../retry-image', () => ({
  RetryImage: ({ src, alt }: { src: string; alt: string }) => (
    <img src={src} alt={alt} />
  ),
}));

const reference: CanvasAssociationRef = {
  referenceId: 'reference-a',
  boardId: 'board-a',
  elementId: 'image-a',
  kind: 'image',
  label: '图片1',
  mentionStart: 2,
  mentionEnd: 6,
};
const elements: PlaitElement[] = [
  { id: 'image-a', type: 'image', url: '/first.png' },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderHighlight(
  overrides: {
    prompt?: string;
    references?: CanvasAssociationRef[];
    boardId?: string;
    elements?: PlaitElement[];
    disabled?: boolean;
  } = {}
) {
  const inputRef = createRef<HTMLTextAreaElement>();
  const prompt = overrides.prompt ?? '参考@图片1和手打@图片1';
  const result = render(
    <>
      <CanvasAssociationHighlight
        prompt={prompt}
        references={[reference]}
        boardId="board-a"
        elements={elements}
        inputRef={inputRef}
        {...overrides}
      />
      <textarea ref={inputRef} defaultValue={prompt} aria-label="提示词" />
    </>
  );
  return { ...result, input: inputRef.current as HTMLTextAreaElement };
}

describe('canvas mention display', () => {
  it('decorates only the trusted occurrence without replacing the raw prompt', () => {
    const { input, container } = renderHighlight();
    expect(screen.getAllByRole('button', { name: '图片1' })).toHaveLength(1);
    expect(
      container.querySelector('.canvas-association-highlight')?.textContent
    ).toContain('和手打@图片1');
    expect(input.value).toBe('参考@图片1和手打@图片1');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      '/first.png'
    );
  });

  it('selects the full original token for native copying and replacement', () => {
    const { input, container } = renderHighlight();
    fireEvent.click(screen.getByRole('button', { name: '图片1' }));
    expect(document.activeElement).toBe(input);
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe(
      '@图片1'
    );
    expect(
      container.querySelector(
        '.canvas-association-highlight__mention--selected'
      )
    ).not.toBeNull();
  });

  it.each(['hover', 'focus'])(
    'opens a preview on %s without changing the prompt',
    async (mode) => {
      vi.useFakeTimers();
      const { input } = renderHighlight();
      const chip = screen.getByRole('button', { name: '图片1' });
      if (mode === 'focus') chip.focus();
      else {
        input.focus();
        fireEvent.mouseEnter(chip);
      }
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByAltText('图片1').getAttribute('src')).toBe(
        '/first.png'
      );
      expect(input.value).toBe('参考@图片1和手打@图片1');
      expect(document.activeElement).toBe(mode === 'focus' ? chip : input);
      if (mode === 'focus') fireEvent.blur(chip);
      else fireEvent.mouseLeave(chip);
      await act(async () => {
        vi.advanceTimersByTime(120);
      });
      expect(screen.queryByAltText('图片1')).toBeNull();
    }
  );

  it('allows Escape to close a keyboard preview', async () => {
    vi.useFakeTimers();
    renderHighlight();
    const chip = screen.getByRole('button', { name: '图片1' });
    chip.focus();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByAltText('图片1')).not.toBeNull();
    fireEvent.keyDown(chip, { key: 'Escape' });
    expect(screen.queryByAltText('图片1')).toBeNull();
  });

  it('keeps unavailable references selectable with a type icon and no preview', () => {
    const { container } = renderHighlight({ elements: [] });
    const chip = screen.getByRole('button', { name: '图片1' });
    expect(chip.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    fireEvent.focus(chip);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables selection and previews during submission', () => {
    const { input } = renderHighlight({ disabled: true });
    const chip = screen.getByRole('button', {
      name: '图片1',
    }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(document.activeElement).not.toBe(input);
    expect(screen.queryByAltText('图片1')).toBeNull();
  });
});

describe('canvas mention preview ownership', () => {
  it('resolves by the referenced ID, including nested image elements', () => {
    expect(
      getAssociationPreviewUrl(reference, 'board-a', [
        {
          id: 'group',
          children: [{ id: 'other', url: '/wrong.png' }, ...elements],
        },
      ])
    ).toBe('/first.png');
    expect(
      getAssociationPreviewUrl(reference, 'board-a', [
        {
          id: 'image-a',
          image: { url: ' /embedded.png ' },
        },
      ])
    ).toBe('/embedded.png');
  });

  it('does not load another board, a missing image, or a non-image reference', () => {
    expect(
      getAssociationPreviewUrl(reference, 'board-b', elements)
    ).toBeUndefined();
    expect(getAssociationPreviewUrl(reference, 'board-a', [])).toBeUndefined();
    expect(
      getAssociationPreviewUrl(
        { ...reference, kind: 'video' },
        'board-a',
        elements
      )
    ).toBeUndefined();
    expect(
      getAssociationPreviewUrl(reference, 'board-a', [
        { id: 'image-a', url: ' ' },
      ])
    ).toBeUndefined();
  });
});
