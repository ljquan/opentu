import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeSettingsPanel } from '../src/components/native-settings-panel';
import { canvasThemes } from '../src/lib/canvas-theme';
import { defaultConfig, type AiConfig } from '../src/stores/use-config-store';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div');
document.body.append(container);
let root = createRoot(container);
afterEach(() => { act(() => root.unmount()); root = createRoot(container); });

const config: AiConfig = { ...defaultConfig, model: 'native::video', channels: [{ id: 'native', name: 'Native', opentuProfileId: null, baseUrl: '', apiKey: '', apiFormat: 'openai', models: [{ name: 'video', capability: 'video', parameters: [
    { id: 'size', label: '分辨率', valueType: 'enum', options: [{ value: '768P', label: '768P' }, { value: '2K', label: '2K' }], defaultValue: '768P' },
    { id: 'duration', label: '时长', valueType: 'number', min: 4, max: 15, defaultValue: 5 },
] }] }] };

describe('native settings controls', () => {
    it('renders host choices and saves an exact enum value', () => {
        const onChange = vi.fn();
        act(() => root.render(<NativeSettingsPanel config={config} capability="video" onChange={onChange} theme={canvasThemes.light} />));
        const select = container.querySelector('select')!;
        expect(Array.from(select.options).map((option) => option.value)).toEqual(['768P', '2K']);
        act(() => { select.value = '2K'; select.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(JSON.parse(onChange.mock.calls[0][0])['video::native::video'].size).toBe('2K');
        expect(container.textContent).not.toContain('720p');
        const number = container.querySelector('input[type=number]')!;
        expect(number.getAttribute('min')).toBe('4');
        expect(number.getAttribute('max')).toBe('15');
    });
    it('shows a stale value error and provides a current-model reset', () => {
        const onChange = vi.fn();
        const nativeParams = JSON.stringify({ 'video::native::video': { size: '720p' }, 'text::other::model': { temperature: 1 } });
        act(() => root.render(<NativeSettingsPanel config={{ ...config, nativeParams }} capability="video" onChange={onChange} theme={canvasThemes.dark} />));
        expect(container.querySelector('[role=alert]')?.textContent).toContain('720p');
        act(() => (container.querySelector('button[aria-label="恢复当前模型默认参数"]') as HTMLButtonElement).click());
        expect(JSON.parse(onChange.mock.calls[0][0])).toEqual({ 'text::other::model': { temperature: 1 } });
    });
});
