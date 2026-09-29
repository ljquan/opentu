import { describe, expect, it } from 'vitest';
import { defaultConfig, normalizeChannelModels, type AiConfig } from '../src/stores/use-config-store';
import { getNativeParameterValues, setNativeParameterValue, nativeParameterSummary } from '../src/integration/native-parameters';

const model = 'native::MiniMax-H3';
const config: AiConfig = {
    ...defaultConfig,
    model,
    videoModel: model,
    channels: [{ id: 'native', name: 'OpenTu', opentuProfileId: null, baseUrl: '', apiKey: '', apiFormat: 'openai', models: [{
        name: 'MiniMax-H3', capability: 'video', parameters: [
            { id: 'size', label: '分辨率', valueType: 'enum', options: [{ value: '768P', label: '768P' }, { value: '2K', label: '2K' }], defaultValue: '768P' },
            { id: 'duration', label: '时长', valueType: 'number', min: 4, max: 15, integer: true, defaultValue: 5 },
            { id: 'api_version', label: '接口版本', valueType: 'enum', options: [{ value: 'v1', label: 'V1' }, { value: 'v2', label: 'V2' }], defaultValue: 'v1' },
        ],
    }] }],
};

describe('native workflow parameter state', () => {
    it('uses host defaults instead of generic video size and resolution', () => {
        expect(getNativeParameterValues(config, model, 'video')).toEqual({ size: '768P', duration: 5, api_version: 'v1' });
    });
    it('retains raw model values and isolates same-name models in different channels', () => {
        const nativeParams = setNativeParameterValue(config, model, 'video', 'size', '2K');
        const updated = { ...config, nativeParams };
        expect(getNativeParameterValues(updated, model, 'video').size).toBe('2K');
        const other = { ...updated, channels: [...config.channels, { ...config.channels[0], id: 'other' }] };
        expect(getNativeParameterValues(other, 'other::MiniMax-H3', 'video').size).toBe('768P');
        const restored = JSON.parse(JSON.stringify(updated));
        expect(getNativeParameterValues(restored, model, 'video').size).toBe('2K');
    });
    it('rejects invalid persisted values before execution instead of silently resetting them', () => {
        const nativeParams = setNativeParameterValue(config, model, 'video', 'duration', '99');
        expect(() => getNativeParameterValues({ ...config, nativeParams }, model, 'video')).toThrow();
    });
    it('stores numeric input with its actual type and accepts a valid edit', () => {
        const nativeParams = setNativeParameterValue(config, model, 'video', 'duration', '12');
        expect(getNativeParameterValues({ ...config, nativeParams }, model, 'video').duration).toBe(12);
    });
    it('keeps another model settings when updating the current model', () => {
        const other = setNativeParameterValue(config, 'native::another', 'video', 'size', '720p');
        const saved = setNativeParameterValue({ ...config, nativeParams: other }, model, 'video', 'size', '2K');
        expect(JSON.parse(saved)['video::native::another']).toEqual({ size: '720p' });
    });
    it('does not discard model parameter metadata during configuration restore', () => {
        expect(normalizeChannelModels(config.channels[0].models)[0].parameters).toEqual(config.channels[0].models[0].parameters);
    });
    it('preserves separate capabilities for the same channel model name', () => {
        const models = normalizeChannelModels([{ name: 'multi', capability: 'image' }, { name: 'multi', capability: 'text' }]);
        expect(models.map((entry) => entry.capability)).toEqual(['image', 'text']);
    });
    it('summarizes the actual native values without adding a p suffix or frames mode', () => {
        const summary = nativeParameterSummary(config, 'video');
        expect(summary).toContain('768P');
        expect(summary).toContain('V1');
        expect(summary).not.toContain('720');
        expect(summary).not.toContain('首尾帧');
    });
});
