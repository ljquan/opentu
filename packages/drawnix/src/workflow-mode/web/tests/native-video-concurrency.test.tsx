import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoPage, { buildLog } from '../src/pages/video';
import { defaultConfig, useConfigStore } from '../src/stores/use-config-store';
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTaskState } from '../src/services/api/video';

vi.mock('../src/services/document-batch-scope', () => ({ getDocumentBatchScope: () => 'owner', subscribeDocumentBatchScope: () => () => {} }));
vi.mock('../src/services/workflow-task-target', () => ({ registerWorkflowTaskTarget: vi.fn() }));
vi.mock('../../../services/media-executor/task-storage-writer', () => ({ taskStorageWriter: { getTask: vi.fn(async () => null), findWorkflowTask: vi.fn(async () => null) } }));
vi.mock('../src/services/api/video', () => ({ createVideoGenerationTask: vi.fn(), pollVideoGenerationTask: vi.fn(), storeGeneratedVideo: vi.fn(), isVideoTaskFailed: (e: Error) => e.name === 'VideoTaskFailed', videoTaskFailed: (text: string) => Object.assign(new Error(text), { name: 'VideoTaskFailed' }) }));
vi.mock('../src/services/file-storage', () => ({ resolveMediaUrl: vi.fn(async (key, url) => url || key), deleteStoredMedia: vi.fn(), uploadMediaFile: vi.fn() }));
vi.mock('../src/services/image-storage', () => ({ resolveImageUrl: vi.fn(async (_key, url) => url), ensureImagePreview: vi.fn(), subscribeImagePreviews: () => () => {}, getImagePreviewRevision: () => 0, previewUrlFor: vi.fn(), uploadImage: vi.fn() }));
vi.mock('../src/components/canvas/asset-picker-modal', () => ({ AssetPickerModal: () => null }));
vi.mock('../src/components/prompts/prompt-select-dialog', () => ({ PromptSelectDialog: () => null }));
vi.mock('../src/components/video-settings-panel', async importOriginal => ({ ...await importOriginal<object>(), VideoSettingsPanel: () => null }));
vi.mock('../src/components/model-picker', () => ({ ModelPicker: () => null }));

const store = localforage.createInstance({ name: 'infinite-canvas', storeName: 'video_generation_logs' });
const pending = new Map<string, (state: VideoGenerationTaskState) => void>();
const generateButton = () => screen.getByRole('button', { name: /开始生成/ }) as HTMLButtonElement;
const newSession = () => fireEvent.click(screen.getByRole('button', { name: /新建/ }));
async function submit(prompt: string) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
    fireEvent.click(generateButton());
    await waitFor(() => expect(pending.has(prompt)).toBe(true));
    await waitFor(() => expect(generateButton().disabled).toBe(false));
}
async function complete(prompt: string) {
    await act(async () => pending.get(prompt)!({ status: 'completed', result: { url: `https://example.test/${prompt}.mp4` } }));
    await waitFor(async () => {
        const logs: ReturnType<typeof buildLog>[] = [];
        await store.iterate<ReturnType<typeof buildLog>, void>(log => { logs.push(log); });
        expect(logs.find(log => log.prompt === prompt)?.status).toBe('success');
    });
}
beforeEach(async () => {
    vi.clearAllMocks(); pending.clear(); await store.clear();
    const style = window.getComputedStyle(document.createElement('div'));
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(style);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    useConfigStore.setState({ config: { ...defaultConfig, model: 'video', videoModel: 'video', channels: [], baseUrl: 'https://example.test', apiKey: 'test' }, isAiConfigReady: () => true });
    vi.mocked(createVideoGenerationTask).mockImplementation(async (_config, prompt) => ({ id: prompt, model: 'video', provider: 'openai' }));
    vi.mocked(pollVideoGenerationTask).mockImplementation(async (_config, task) => new Promise(resolve => pending.set(task.id, resolve)));
    vi.mocked(storeGeneratedVideo).mockImplementation(async result => ({ url: result.url!, storageKey: result.url!, width: 1280, height: 720, bytes: 10, mimeType: 'video/mp4', durationMs: 0 }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('video workbench concurrent jobs', () => {
    it('submits B before A completes and keeps B visible when A finishes last', async () => {
        const { container } = render(<App><VideoPage /></App>);
        await submit('A');
        newSession();
        await submit('B');
        expect(createVideoGenerationTask).toHaveBeenCalledTimes(2);
        await complete('B');
        await complete('A');
        expect(container.querySelector('video[controls]')?.getAttribute('src')).toBe('https://example.test/B.mp4');
        fireEvent.click(await screen.findByRole('button', { name: /A视频预览/ }));
        expect(container.querySelector('video[controls]')?.getAttribute('src')).toBe('https://example.test/A.mp4');
    });
    it('keeps a new draft empty when a background job completes', async () => {
        const { container } = render(<App><VideoPage /></App>);
        await submit('A'); newSession();
        await complete('A');
        expect(container.querySelector('video[controls]')).toBeNull();
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    });
    it('does not replace B or stop its waiting indicator when A fails', async () => {
        render(<App><VideoPage /></App>);
        await submit('A'); newSession(); await submit('B');
        await act(async () => pending.get('A')!({ status: 'failed', error: 'A rejected' }));
        await waitFor(() => expect(screen.getByRole('status').textContent).toBe('生成中'));
        expect(generateButton().disabled).toBe(false);
        await complete('B');
    });
    it('allows submission while restoring an existing pending task without resubmitting it', async () => {
        const config = useConfigStore.getState().config;
        await store.setItem('restored', { ...buildLog({ prompt: 'A', model: 'video', config, references: [], durationMs: 0, status: 'pending', task: { id: 'A', model: 'video', provider: 'openai' } }), id: 'restored', scopeId: 'owner' });
        render(<App><VideoPage /></App>);
        await waitFor(() => expect(pending.has('A')).toBe(true));
        await submit('B');
        expect(createVideoGenerationTask).toHaveBeenCalledTimes(1);
        await complete('A'); await complete('B');
    });
    it('releases submission after an error while the earlier task continues', async () => {
        render(<App><VideoPage /></App>);
        await submit('A');
        vi.mocked(createVideoGenerationTask).mockRejectedValueOnce(new Error('network interrupted'));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B' } });
        fireEvent.click(generateButton());
        await waitFor(() => expect(createVideoGenerationTask).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(generateButton().disabled).toBe(false));
        await complete('A');
        await submit('C'); await complete('C');
    });
    it('blocks double submission only while creating the task, then releases the button', async () => {
        let release!: () => void;
        vi.mocked(createVideoGenerationTask).mockImplementationOnce(async () => {
            await new Promise<void>(resolve => { release = resolve; });
            return { id: 'A', model: 'video', provider: 'openai' };
        });
        render(<App><VideoPage /></App>);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A' } });
        fireEvent.click(generateButton());
        await waitFor(() => expect(createVideoGenerationTask).toHaveBeenCalledTimes(1));
        expect(generateButton().disabled).toBe(true);
        fireEvent.click(generateButton());
        expect(createVideoGenerationTask).toHaveBeenCalledTimes(1);
        await act(async () => release());
        await waitFor(() => expect(generateButton().disabled).toBe(false));
        await complete('A');
    });
});
