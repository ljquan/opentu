import { describe, expect, it } from 'vitest';
import { getCompatibleParams } from '../../constants/model-config';
import type { Task } from '../../types/task.types';
import { buildSunoV2InputParams, collectSunoV2Resources, getSunoV2Params, getVisibleSunoV2Params } from '../suno-v2-params';

const resources = [{ id: 'm1', kind: 'music_id' as const, profileId: 'p' }, { id: 'm2', kind: 'music_id' as const, profileId: 'p' }];

describe('Suno input bar parameters', () => {
  it('uses action fields and removes legacy parameters and unavailable aliases', () => {
    expect(getCompatibleParams('suno/upload').map((p) => p.id)).toEqual(['audio_url', 'is_async']);
    expect(getCompatibleParams('suno_persona_unknown')).toEqual([]);
    expect(getCompatibleParams('suno_act_unknown_midi')).toEqual([]);
    expect(getCompatibleParams('suno/create-voice')).toEqual([]);
    expect(getCompatibleParams('suno/add-instrumental')).toEqual([]);
    expect(getCompatibleParams('suno/add-vocals')).toEqual([]);
    expect(getCompatibleParams('suno_music').some((p) => p.id === 'sunoAction')).toBe(true);
  });

  it('blocks unavailable voice cloning and reuses existing same-profile personas', () => {
    expect(() => buildSunoV2InputParams('suno/create-voice', { audio_url: 'https://cdn.test/voice.wav' }, '', 'p', [])).toThrow('不可用');
    const personas = [{ id: 'voice', kind: 'persona_id' as const, profileId: 'p' }];
    expect(getSunoV2Params('suno/music', personas).find((p) => p.id === 'persona_id')?.options).toEqual([{ value: 'voice', label: 'voice' }]);
    const values = { custom: 'true', instrumental: 'false', persona_id: 'voice' };
    expect(buildSunoV2InputParams('suno/music', values, '歌词', 'p', personas).sunoV2Body).toMatchObject({ persona_id: 'voice' });
    expect(() => buildSunoV2InputParams('suno/music', values, '歌词', 'other', personas)).toThrow('当前渠道');
  });
  it('changes visible fields with custom mode and maps the input prompt to the native field', () => {
    const params = getSunoV2Params('suno/music');
    expect(getVisibleSunoV2Params('suno/music', params, {}).map((p) => p.id)).not.toContain('prompt');
    expect(getVisibleSunoV2Params('suno/music', params, { custom: 'true' }).map((p) => p.id)).not.toContain('gpt_description_prompt');
    expect(buildSunoV2InputParams('suno/music', { custom: 'false', instrumental: 'false', duration: '10', prompt: 'stale lyrics' }, 'piano', 'p', []).sunoV2Body)
      .toMatchObject({ custom: false, instrumental: false, duration: 10, gpt_description_prompt: 'piano' });
    expect(buildSunoV2InputParams('suno/lyrics', {}, '写民谣歌词', 'p', []).sunoV2Body).toEqual({ prompt: '写民谣歌词', lyrics_model: 'classic' });
  });
  it('preserves zero, false and arrays through native validation', () => {
    expect(buildSunoV2InputParams('suno/extend', { music_id: 'm1', continue_at: '0' }, '', 'p', resources).sunoV2Body)
      .toMatchObject({ music_id: 'm1', continue_at: 0, custom: true });
    expect(buildSunoV2InputParams('suno/mashup', { custom: 'true', instrumental: 'false', mashup_music_id: '["m1","m2"]' }, '', 'p', resources).sunoV2Body)
      .toMatchObject({ mashup_music_id: ['m1', 'm2'], instrumental: false });
    expect(buildSunoV2InputParams('suno/download', { music_id: 'm1', formats: '["mp3","wav"]' }, '', 'p', resources).sunoV2Body)
      .toEqual({ music_id: 'm1', formats: ['mp3', 'wav'] });
  });
  it('rejects prerequisites and bad input before creating a workflow', () => {
    expect(() => buildSunoV2InputParams('suno/concat', {}, '', 'p', resources)).toThrow('必填');
    expect(() => buildSunoV2InputParams('suno/concat', { music_id: 'm1' }, '', 'other', resources)).toThrow('当前渠道');
    expect(() => buildSunoV2InputParams('suno/download', { music_id: 'm1', formats: 'wav' }, '', 'p', resources)).toThrow('列表');
    expect(() => buildSunoV2InputParams('suno/extend', { music_id: 'm1', continue_at: 'nan' }, '', 'p', resources)).toThrow('无效');
    expect(() => buildSunoV2InputParams('suno/music', { custom: 'yes' }, '', 'p', resources)).toThrow('无效');
  });
  it('offers only completed same-profile resources and deduplicates public IDs', () => {
    const task = (status: string, refs = resources) => ({ status, result: { analysisData: { sunoV2: { resources: refs } } } }) as Task;
    expect(collectSunoV2Resources([task('completed'), task('completed'), task('failed')], 'p')).toEqual(resources);
    expect(collectSunoV2Resources([task('completed')], 'other')).toEqual([]);
    expect(getSunoV2Params('suno/mashup', resources).find((p) => p.id === 'mashup_music_id')).toMatchObject({ control: 'multiselect', options: [{ value: 'm1' }, { value: 'm2' }] });
  });
});
