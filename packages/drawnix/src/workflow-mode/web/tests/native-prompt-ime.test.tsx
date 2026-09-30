import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasPromptChipInput } from '../src/components/canvas/canvas-prompt-chip-input';
import { CanvasConfigComposer } from '../src/components/canvas/canvas-config-composer';
import i18n from '../src/i18n';

afterEach(cleanup);

describe.each(['prompt', 'composer'] as const)('%s Chinese input', (kind) => {
    function setup() {
        const changed = vi.fn();
        const submit = vi.fn();
        const placeholder = kind === 'prompt' ? '输入你想要生成的文本内容' : i18n.t('canvas.composer.placeholder');
        function Editor() {
            const [value, setValue] = useState('');
            const onChange = (next: string) => { changed(next); setValue(next); };
            return kind === 'prompt'
                ? <CanvasPromptChipInput value={value} references={[]} onChange={onChange} onSubmit={submit} placeholder={placeholder} />
                : <CanvasConfigComposer nodeId="test" nodes={[]} inputs={[]} value={value} onChange={onChange} onClose={() => {}} />;
        }
        const view = render(<Editor />);
        const editor = view.container.querySelector('[contenteditable="true"]') as HTMLDivElement;
        editor.focus();
        return { ...view, editor, changed, submit, placeholder, refresh: () => view.rerender(<Editor />) };
    }

    it('hides the placeholder throughout composition and commits the selected Chinese text', () => {
        const { editor, changed, submit, placeholder, refresh } = setup();
        expect(screen.queryByText(placeholder)).not.toBeNull();
        fireEvent.compositionStart(editor);
        editor.textContent = 'lian';
        fireEvent.input(editor, { isComposing: true });
        expect(screen.queryByText(placeholder)).toBeNull();
        expect(changed).not.toHaveBeenCalled();
        refresh();
        expect(editor.textContent).toBe('lian');
        // Some IMEs omit the native flag; compositionstart still owns these keys.
        expect(fireEvent.keyDown(editor, { key: 'Enter', isComposing: false })).toBe(true);
        expect(submit).not.toHaveBeenCalled();
        editor.textContent = '连';
        fireEvent.compositionEnd(editor, { data: '连' });
        expect(changed).toHaveBeenLastCalledWith('连');
        expect(editor.textContent).toBe('连');
        expect(screen.queryByText(placeholder)).toBeNull();
        if (kind === 'prompt') {
            fireEvent.keyDown(editor, { key: 'Enter' });
            expect(submit).toHaveBeenCalledOnce();
        }
    });

    it('restores the placeholder after cancellation and after deleting ordinary input', () => {
        const { editor, placeholder, changed } = setup();
        fireEvent.compositionStart(editor);
        editor.textContent = 'lian';
        fireEvent.input(editor, { isComposing: true });
        expect(screen.queryByText(placeholder)).toBeNull();
        editor.textContent = '';
        fireEvent.compositionEnd(editor, { data: '' });
        expect(screen.queryByText(placeholder)).not.toBeNull();
        editor.textContent = 'hello';
        fireEvent.input(editor);
        expect(changed).toHaveBeenLastCalledWith('hello');
        expect(screen.queryByText(placeholder)).toBeNull();
        editor.textContent = '';
        fireEvent.input(editor);
        expect(screen.queryByText(placeholder)).not.toBeNull();
    });
    it('applies an external value arriving during composition without emitting stale DOM', () => {
        const changed = vi.fn();
        const viewFor = (value: string) => kind === 'prompt'
            ? <CanvasPromptChipInput value={value} references={[]} onChange={changed} onSubmit={() => {}} />
            : <CanvasConfigComposer nodeId="test" nodes={[]} inputs={[]} value={value} onChange={changed} onClose={() => {}} />;
        const view = render(viewFor('original'));
        const editor = view.container.querySelector('[contenteditable="true"]') as HTMLDivElement;
        editor.focus();
        fireEvent.compositionStart(editor);
        editor.textContent = 'pinyin';
        view.rerender(viewFor('external replacement'));
        expect(editor.textContent).toBe('pinyin');
        editor.textContent = '拼音';
        fireEvent.compositionEnd(editor);
        expect(editor.textContent).toBe('external replacement');
        expect(changed).not.toHaveBeenCalled();
    });

});
