import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasPromptChipInput } from '../src/components/canvas/canvas-prompt-chip-input';
import { CanvasConfigComposer } from '../src/components/canvas/canvas-config-composer';
import type { CanvasResourceReference } from '../src/lib/canvas/canvas-resource-references';
import type { NodeGenerationInput } from '../src/components/canvas/canvas-node-generation';

vi.mock('../src/hooks/use-stored-references', () => ({ useStoredReferences: (value: unknown) => value }));
vi.mock('../src/hooks/use-stored-inputs', () => ({ useStoredInputs: (value: unknown) => value }));
afterEach(cleanup);

describe.each(['prompt', 'config'] as const)('%s media arriving while typing', kind => {
    it('updates a resolved image inside the same token without replacing focused text or caret', () => {
        const reference = (url: string): CanvasResourceReference => ({ id: 'image', nodeId: 'image', kind: 'image', label: 'Image 1', title: 'Reference', previewUrl: url, active: true });
        const input = (url: string) => ({ nodeId: 'image', title: 'Reference', type: 'image', image: { dataUrl: url, storageKey: 'image:one' } } as NodeGenerationInput);
        const component = (url: string) => kind === 'prompt'
            ? <CanvasPromptChipInput value="Image 1 tail" references={[reference(url)]} onChange={vi.fn()} />
            : <CanvasConfigComposer nodeId="config" nodes={[]} value="@[node:image] tail" inputs={[input(url)]} onChange={vi.fn()} onClose={vi.fn()} />;
        const view = render(component('blob:loading'));
        const editor = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!;
        const chip = editor.querySelector<HTMLElement>('[data-ref-label], [data-reference-node-id]')!;
        const text = editor.lastChild!;
        const range = document.createRange(); range.setStart(text, 2); range.collapse(true);
        editor.focus(); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        view.rerender(component('blob:resolved'));
        expect(editor.querySelector('[data-ref-label], [data-reference-node-id]')).toBe(chip);
        expect(chip.querySelector('img')?.src).toBe('blob:resolved');
        expect(editor.lastChild).toBe(text);
        expect(selection.anchorNode).toBe(text); expect(selection.anchorOffset).toBe(2);
    });
});
