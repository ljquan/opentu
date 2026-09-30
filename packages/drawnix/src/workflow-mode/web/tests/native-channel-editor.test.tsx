import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from 'antd';
import { ChannelEditorDrawer } from '../src/components/layout/channel-editor-drawer';
import { readNativeProviderCredentials } from '../../host/native-models';
import { defaultConfig, resolveModelRequestConfig } from '../src/stores/use-config-store';
import i18n from '../src/i18n';

vi.mock('../../host/native-models', () => ({ readNativeProviderCredentials: vi.fn() }));
// These editors load CodeMirror and media APIs, outside the credential form boundary.
vi.mock('../src/components/layout/model-script-editor', () => ({ ModelScriptEditor: () => null }));
vi.mock('../src/components/layout/model-select-modal', () => ({ ModelSelectModal: () => null }));

const credentials = {
    profiles: [
        { id: 'default', name: '默认分组', baseUrl: 'https://provider.example/v1', apiKey: 'test-default', apiFormat: 'openai' as const },
        { id: 'mix', name: 'Mix 分组', baseUrl: 'https://provider.example/v1', apiKey: 'test-mix', apiFormat: 'openai' as const },
    ],
    preferredProfileId: 'mix',
};
const channel = { ...defaultConfig.channels[0], models: [] };
const input = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
function editor(props: Partial<React.ComponentProps<typeof ChannelEditorDrawer>> = {}) {
    return <ConfigProvider theme={{ token: { motion: false } }}><ChannelEditorDrawer open channel={channel} onSave={vi.fn()} onClose={vi.fn()} {...props} /></ConfigProvider>;
}

beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(readNativeProviderCredentials).mockResolvedValue(credentials);
    await i18n.changeLanguage('zh-CN');
    // This is a form-logic test. JSDOM cannot parse Ant Design's :has(:focus-visible)
    // styles combined with Tailwind's escaped class names, or measure drawer layout.
    const computedStyle = window.getComputedStyle(document.createElement('div'));
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(computedStyle);
    vi.stubGlobal('ResizeObserver', class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
    });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('OpenTu credential autofill in the channel editor', () => {
    it('fills both fields, masks the key and saves credentials usable by local requests', async () => {
        const onSave = vi.fn();
        render(editor({ onSave, channel: defaultConfig.channels[0] }));
        await waitFor(() => expect(input('API Key').value).toBe('test-mix'));
        expect(input('API Key').type).toBe('password');
        expect(input('接口地址').value).toBe('https://provider.example/v1');
        expect(onSave).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));
        const saved = onSave.mock.calls[0][0];
        const request = resolveModelRequestConfig({ ...defaultConfig, channels: [saved] }, defaultConfig.imageModel);
        expect(request).toMatchObject({ baseUrl: 'https://provider.example/v1', apiKey: 'test-mix', apiFormat: 'openai' });
        expect(defaultConfig.channels[0].apiKey).toBe('');
    });

    it('preserves a configured key and lets the user explicitly choose another group with the same URL', async () => {
        render(editor({ channel: { ...channel, apiKey: 'user-key' } }));
        await waitFor(() => expect(vi.mocked(readNativeProviderCredentials).mock.settledResults[0]?.type).toBe('fulfilled'));
        expect(input('API Key').value).toBe('user-key');
        fireEvent.mouseDown(screen.getByRole('combobox', { name: '从 OpenTu 自动填入' }));
        fireEvent.click(await screen.findByText('默认分组'));
        expect(input('API Key').value).toBe('test-default');
        expect(input('接口地址').value).toBe('https://provider.example/v1');
    });

    it('does not overwrite credentials typed while settings initialization is pending', async () => {
        let finish!: (result: typeof credentials) => void;
        vi.mocked(readNativeProviderCredentials).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        render(editor());
        fireEvent.change(input('API Key'), { target: { value: 'typed-key' } });
        fireEvent.change(input('接口地址'), { target: { value: 'https://typed.example' } });
        await act(async () => { finish(credentials); });
        expect(input('API Key').value).toBe('typed-key');
        expect(input('接口地址').value).toBe('https://typed.example');
    });

    it('discards unsaved autofill on cancel and ignores late results after closing', async () => {
        let finish!: (result: typeof credentials) => void;
        vi.mocked(readNativeProviderCredentials).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const onSave = vi.fn();
        const onClose = vi.fn();
        const view = render(editor({ onSave, onClose }));
        fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
        expect(onClose).toHaveBeenCalledOnce();
        view.rerender(editor({ open: false, channel: null, onSave, onClose }));
        await act(async () => { finish(credentials); });
        expect(screen.queryByLabelText('API Key')).toBeNull();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('keeps the form usable and hides sensitive error details after a read failure', async () => {
        vi.mocked(readNativeProviderCredentials).mockRejectedValue(new Error('test-sensitive-error'));
        render(editor({ channel: { ...channel, apiKey: 'user-key' } }));
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.queryByText(/test-sensitive-error/)).toBeNull();
        expect(input('API Key').value).toBe('user-key');
        fireEvent.change(input('API Key'), { target: { value: 'manual-key' } });
        expect(input('API Key').value).toBe('manual-key');
    });
});
