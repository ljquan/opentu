import { describe, expect, it } from 'vitest';
import { defaultConfig, resolveModelForCapability, useConfigStore } from '../src/stores/use-config-store';

describe('node model defaults', () => {
    const empty = { ...defaultConfig, imageModel: '', videoModel: '', textModel: '', audioModel: '' };
    for (const capability of ['image', 'video', 'text', 'audio'] as const) {
        it(`does not invent a ${capability} model when the preference is empty`, () => {
            expect(resolveModelForCapability(empty, undefined, capability)).toBe('');
        });
    }
    it('follows current preferences for nodes without an explicit model', () => {
        expect(resolveModelForCapability(defaultConfig, undefined, 'video')).toBe(defaultConfig.videoModel);
        expect(resolveModelForCapability(empty, undefined, 'video')).toBe('');
    });
    it('preserves an explicitly selected node model', () => {
        expect(resolveModelForCapability(empty, defaultConfig.videoModel, 'video')).toBe(defaultConfig.videoModel);
    });
    it('ignores a stale or wrong-capability model without inventing a replacement', () => {
        expect(resolveModelForCapability(empty, 'missing::video', 'video')).toBe('');
        expect(resolveModelForCapability(empty, defaultConfig.imageModel, 'video')).toBe('');
    });
    it('does not replace an explicitly removed model with a configured paid default', () => {
        expect(resolveModelForCapability(defaultConfig, 'removed::video', 'video')).toBe('');
    });
    it('preserves empty preferences after restoring saved configuration', () => {
        const merge = useConfigStore.persist.getOptions().merge!;
        const restored = merge({ config: empty }, useConfigStore.getState());
        expect([restored.config.imageModel, restored.config.videoModel, restored.config.textModel, restored.config.audioModel]).toEqual(['', '', '', '']);
    });
});
