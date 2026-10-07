import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImagePage from '../src/pages/image';
import { defaultConfig, useConfigStore } from '../src/stores/use-config-store';
import { requestEdit, requestGeneration } from '../src/services/api/image';
import { uploadImage } from '../src/services/image-storage';

vi.mock('../src/services/document-batch-scope', () => ({ getDocumentBatchScope: () => 'owner', subscribeDocumentBatchScope: () => () => {} }));
vi.mock('../src/services/workflow-task-target', () => ({ registerWorkflowTaskTarget: vi.fn() }));
vi.mock('../../../services/media-executor/task-storage-writer', () => ({ taskStorageWriter: { getTask: vi.fn(async () => null), findWorkflowTask: vi.fn(async () => null) } }));
vi.mock('../src/services/api/image', () => ({ requestEdit: vi.fn(), requestGeneration: vi.fn() }));
vi.mock('../src/services/image-storage', () => ({ resolveImageUrl: vi.fn(async (_key, url) => url), ensureImagePreview: vi.fn(), subscribeImagePreviews: () => () => {}, getImagePreviewRevision: () => 0, previewUrlFor: vi.fn(), uploadImage: vi.fn(), deleteStoredImages: vi.fn() }));
vi.mock('../src/components/canvas/asset-picker-modal', () => ({ AssetPickerModal: () => null }));
vi.mock('../src/components/prompts/prompt-select-dialog', () => ({ PromptSelectDialog: () => null }));
vi.mock('../src/components/image-settings-panel', () => ({ ImageSettingsPanel: () => null }));
vi.mock('../src/components/model-picker', () => ({ ModelPicker: () => null }));

const store = localforage.createInstance({ name: 'infinite-canvas', storeName: 'image_generation_logs' });
beforeEach(async () => {
    vi.clearAllMocks(); await store.clear();
    const style = window.getComputedStyle(document.createElement('div'));
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(style);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    useConfigStore.setState({ config: { ...defaultConfig, model: 'image', imageModel: 'image', channels: [], baseUrl: 'https://example.test', apiKey: 'test' }, isAiConfigReady: () => true });
    vi.mocked(requestEdit).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('image reference import', () => {
    it('blocks generation until every concurrent upload completes, then sends all references', async () => {
        const uploads: Array<() => void> = [];
        vi.mocked(uploadImage).mockImplementation(async () => {
            const index = uploads.length;
            await new Promise<void>(resolve => uploads.push(resolve));
            return { url: `blob:reference-${index}`, storageKey: `image:${index}`, width: 10, height: 10, bytes: 10, mimeType: 'image/png' };
        });
        const { container } = render(<App><ImagePage /></App>);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '生成一张你认为最好看的动漫海报' } });
        const generate = screen.getByRole('button', { name: /开始生成/ }) as HTMLButtonElement;
        const input = container.querySelector('input[type=file]')!;
        fireEvent.change(input, { target: { files: [new File(['a'], 'a.png', { type: 'image/png' })] } });
        fireEvent.change(input, { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } });
        expect(generate.disabled).toBe(true);
        fireEvent.click(generate);
        expect(requestGeneration).not.toHaveBeenCalled();
        expect(requestEdit).not.toHaveBeenCalled();
        await act(async () => uploads[1]());
        expect(generate.disabled).toBe(true);
        await act(async () => uploads[0]());
        await waitFor(() => expect(generate.disabled).toBe(false));
        fireEvent.click(generate);
        await waitFor(() => expect(requestEdit).toHaveBeenCalledTimes(1));
        expect(vi.mocked(requestEdit).mock.calls[0][2].map(reference => reference.name)).toEqual(['b.png', 'a.png']);
        expect(requestGeneration).not.toHaveBeenCalled();
        await waitFor(() => expect(generate.disabled).toBe(false));
    });
});
