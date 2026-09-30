import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App, ConfigProvider } from 'antd';
import { TuziChannelEditor } from '../src/components/layout/tuzi-channel-editor';
import { createModelChannel } from '../src/stores/use-config-store';
import { fetchTuziModels } from '../src/services/tuzi-model-discovery';

vi.mock('../src/services/tuzi-model-discovery', () => ({ fetchTuziModels: vi.fn() }));
beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
    const style = window.getComputedStyle(document.createElement('div'));
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(style);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const channel = createModelChannel({ providerKind: 'tuzi-fixed', models: [{ name: 'old-model', capability: 'image' }] });
const editor = (onSave = vi.fn(), onClose = vi.fn()) => <ConfigProvider theme={{ token: { motion: false } }}><App><TuziChannelEditor channel={channel} onSave={onSave} onClose={onClose} /></App></ConfigProvider>;

it('does not fetch on open; explicit acquisition remains a draft until save', async () => {
    vi.mocked(fetchTuziModels).mockResolvedValue([{ name: 'new-model', capability: 'video' }]);
    const save = vi.fn(); render(editor(save));
    expect(fetchTuziModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '获取热门 200' }));
    await screen.findByText('new-model');
    expect(fetchTuziModels).toHaveBeenCalledWith('hot', expect.any(AbortSignal));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
    expect(save.mock.calls[0][0].models[0].name).toBe('new-model');
});

it('preserves models on failure and discards drafts on cancel', async () => {
    vi.mocked(fetchTuziModels).mockRejectedValue(new Error('offline'));
    const save = vi.fn(), close = vi.fn(); render(editor(save, close));
    fireEvent.click(screen.getByRole('button', { name: '获取全部模型' }));
    await screen.findByText('offline；原列表已保留');
    await waitFor(() => expect(screen.getByRole('button', { name: '获取全部模型' })).not.toHaveProperty('disabled', true));
    expect(screen.getByText('old-model')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(close).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
});
