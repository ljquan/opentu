import { describe, expect, it } from 'vitest';
import { buildSunoV2InputParams, getSunoV2Params, getVisibleSunoV2Params } from '../suno-v2-params';
import type { SunoV2Resource } from '../suno-v2';

const resources: SunoV2Resource[] = [
  { id: 'music', kind: 'music_id', profileId: 'p' },
  { id: 'voice', kind: 'persona_id', profileId: 'p' },
  { id: 'trained', kind: 'model_id', profileId: 'p' },
];
const body = (model: string, values: Record<string, string>, prompt = '') => buildSunoV2InputParams(model, values, prompt, 'p', resources).sunoV2Body;
const urls = (count: number) => Array.from({ length: count }, (_, i) => `https://cdn.test/${i}.mp3`);

describe('Suno action-specific boundaries', () => {
  it.each([['create-model', 6, 24], ['inspo', 1, 4]] as const)('%s converts URL lines and enforces its own list limits', (action, min, max) => {
    const model = `suno/${action}`;
    for (const count of [min, max]) {
      expect(body(model, { name: 'My model', audio_urls: urls(count).join('\n') }).audio_urls).toEqual(urls(count));
    }
    for (const count of [min - 1, max + 1]) {
      expect(() => body(model, { name: 'My model', audio_urls: JSON.stringify(urls(count)) })).toThrow('列表');
    }
    expect(() => body(model, { name: 'My model', audio_urls: JSON.stringify([...urls(min - 1), 'file:///private.mp3']) })).toThrow('HTTP');
  });
  it('keeps trained models visible and sends them in inspiration mode', () => {
    const values = { custom: 'false', model_id: 'trained' };
    expect(getVisibleSunoV2Params('suno/music', getSunoV2Params('suno/music', resources), values).map((p) => p.id)).toContain('model_id');
    expect(body('suno/music', values, 'soft piano')).toMatchObject({ custom: false, model_id: 'trained', gpt_description_prompt: 'soft piano' });
    expect(() => body('suno/music', { custom: 'true', model_id: 'trained', persona_id: 'voice' }, '歌词')).toThrow('不能同时');
  });
  it('validates paired persona segment times without losing a zero start', () => {
    expect(body('suno/persona', { music_id: 'music', name: 'Voice', vocal_start_s: '0', vocal_end_s: '29.9' }))
      .toMatchObject({ vocal_start_s: 0, vocal_end_s: 29.9 });
    for (const range of [{ vocal_start_s: '0' }, { vocal_end_s: '10' }, { vocal_start_s: '0', vocal_end_s: '30' }, { vocal_start_s: '10', vocal_end_s: '5' }]) {
      expect(() => body('suno/persona', { music_id: 'music', name: 'Voice', ...range })).toThrow('人声起点');
    }
  });
  it('validates speed and BPM while preserving their distinct number/string contracts', () => {
    expect(body('suno/adjust-speed', { music_id: 'music', title: 'Faster', speed_multiplier: '1.25', keep_pitch: 'false' }))
      .toMatchObject({ speed_multiplier: 1.25, keep_pitch: false });
    expect(() => body('suno/adjust-speed', { music_id: 'music', title: 'Bad', speed_multiplier: '0' })).toThrow('速度倍率');
    expect(body('suno/sounds', { bpm: '120' }, '雨滴')).toMatchObject({ sound: '雨滴', bpm: '120' });
    expect(() => body('suno/sounds', { bpm: '301' }, '雨滴')).toThrow('节拍');
    expect(body('suno/upsample-tags', {}, 'piano')).toEqual({ tags: 'piano' });
    expect(() => body('suno/download', { music_id: 'music', formats: '[]' })).toThrow('格式');
  });
});
