import { describe, expect, it } from 'vitest';
import {
  assertSunoV2Action,
  buildSunoV2Body,
  getSunoV2Action,
  getSunoV2Fields,
  normalizeSunoV2Response,
  extractSunoV2Result,
  SUNO_V2_ACTIONS,
} from '../suno-v2';

describe('suno v2 protocol', () => {
  it('maps supported actions to native paths and exposes schema fields', () => {
    expect(getSunoV2Action('suno/music')).toMatchObject({
      action: 'music',
      supported: true,
    });
    expect(getSunoV2Fields('suno/music').map((field) => field.name)).toEqual(
      expect.arrayContaining(['custom', 'instrumental', 'prompt'])
    );
  });

  it('rejects unknown actions instead of inventing a contract', () => {
    expect(() => assertSunoV2Action('suno/not-a-real-action')).toThrow('不可用');
    expect(SUNO_V2_ACTIONS.filter((action) => action.supported)).toHaveLength(24);
  });

  it('blocks new voice cloning but preserves historical persona results without audio', () => {
    const params = { model: 'suno/create-voice', prompt: '', params: { sunoV2Body: { audio_url: 'https://cdn.test/voice.wav' } } };
    expect(() => buildSunoV2Body(params, 'p')).toThrow('不可用');
    const response = normalizeSunoV2Response({ code: 'success', data: {
      task_id: 'voice-task', action: 'create-voice', status: 'SUCCESS', persona_id: 'public-persona',
    } }, '', 'p');
    expect(extractSunoV2Result(response)).toMatchObject({
      url: '', format: 'json', providerTaskId: 'voice-task',
      analysisData: { sunoV2: { action: 'create-voice', resources: [{ id: 'public-persona', kind: 'persona_id', profileId: 'p' }] } },
    });
  });

  it.each([{}, { music_id: 'wrong-kind' }, { persona_id: '' }])('rejects voice success without a valid persona: %j', (data) => {
    expect(() => normalizeSunoV2Response({ code: 'success', data: {
      task_id: 'voice-task', action: 'create-voice', status: 'SUCCESS', ...data,
    } }, '', 'p')).toThrow('有效结果');
  });

  it('keeps explicit false values and validates resource ownership', () => {
    expect(buildSunoV2Body({
      model: 'suno/music',
      prompt: 'rainy piano',
      params: { sunoV2Body: { custom: false, instrumental: false, gpt_description_prompt: 'rainy piano' } },
    }, 'profile-a')).toEqual({
      custom: false,
      instrumental: false,
      gpt_description_prompt: 'rainy piano',
    });

    expect(() => buildSunoV2Body({
      model: 'suno/extend',
      prompt: '',
      params: {
        sunoV2Body: { custom: true, music_id: 'music-a', continue_at: 30 },
        sunoV2Resources: [{ id: 'music-a', kind: 'music_id', profileId: 'profile-b' }],
      },
    }, 'profile-a')).toThrow('当前渠道');
  });

  it('normalizes a successful music task and preserves public resource IDs', () => {
    const result = normalizeSunoV2Response({
      code: 'success',
      task_id: 'task-1',
      action: 'music',
      status: 'SUCCESS',
      data: {
        musics: [{ music_id: 'music-1', title: 'Rain', audio_url: 'https://cdn.test/rain.mp3' }],
      },
    }, 'fallback', 'profile-a');

    expect(result).toMatchObject({ taskId: 'task-1', status: 'completed' });
    expect(result.sunoV2?.resources).toContainEqual(expect.objectContaining({
      id: 'music-1', kind: 'music_id', profileId: 'profile-a',
    }));
    expect(result.clips[0]).toMatchObject({ clip_id: 'music-1', audio_url: 'https://cdn.test/rain.mp3' });
  });

  it('fails a successful task with no expected result instead of waiting forever', () => {
    expect(() => normalizeSunoV2Response({
      code: 'success', task_id: 'task-2', action: 'lyrics', status: 'SUCCESS', data: { lyrics: [] },
    }, 'fallback', 'profile-a')).toThrow('有效结果');
  });

  it.each(SUNO_V2_ACTIONS.filter((action) => action.supported))('validates the required schema for $action', (action) => {
    expect(() => buildSunoV2Body({ model: action.model, prompt: '', params: { sunoV2Body: {} } }, 'p'))
      .toThrow('必填');
  });

  it('rejects missing resources, duplicates, invalid ranges, formats and legacy clip IDs', () => {
    const build = (model: string, sunoV2Body: Record<string, unknown>, sunoV2Resources: unknown[] = []) =>
      buildSunoV2Body({ model, prompt: '', params: { sunoV2Body, sunoV2Resources } }, 'p');
    expect(() => build('suno/concat', { music_id: 'legacy-clip' })).toThrow('当前渠道');
    expect(() => build('suno/replace-section', { music_id: 'm', infill_start_s: 20, infill_end_s: 10 })).toThrow('开始时间');
    expect(() => build('suno/download', { music_id: 'm', formats: ['exe'] })).toThrow('格式');
    expect(() => build('suno/mashup', { custom: true, instrumental: false, mashup_music_id: ['m', 'm'] },
      [{ id: 'm', kind: 'music_id', profileId: 'p' }])).toThrow('不同歌曲');
    expect(() => build('suno/lyrics', { prompt: '   ' })).toThrow('无效');
    expect(() => build('suno/music', { custom: true, instrumental: false, style_weight: 2 })).toThrow();
    expect(() => build('suno/upload', { audio_url: 'file:///private/audio.mp3' })).toThrow('HTTP');
  });

  it('preserves resource-only uploads, all lyrics and export files', () => {
    const response = (action: string, data: Record<string, unknown>) => normalizeSunoV2Response({
      code: 'success', data: { task_id: 'task', action, status: 'SUCCESS', data },
    }, '', 'p');
    expect(extractSunoV2Result(response('upload', { result: { music_id: 'public-music' } })))
      .toMatchObject({ url: '', format: 'json', analysisData: { sunoV2: { resources: [{ id: 'public-music' }] } } });
    expect(response('lyrics', { lyrics: [{ text: 'first', tags: 'pop, piano' }, { text: 'second' }] }).sunoV2?.lyrics)
      .toEqual([{ text: 'first', title: undefined, tags: ['pop', 'piano'] }, { text: 'second', title: undefined, tags: undefined }]);
    expect(extractSunoV2Result(response('download', { result: { files: [
      { format: 'wav', file_url: 'https://cdn.test/a.wav' }, { format: 'mp3', file_url: 'https://cdn.test/a.mp3' },
    ] } }))?.urls).toEqual(['https://cdn.test/a.wav', 'https://cdn.test/a.mp3']);
    expect(response('music', { musics: [{ id: 'ordinary-id', audio_url: 'https://cdn.test/a.mp3' }] }).sunoV2?.resources).toEqual([]);
  });

  it.each(['SUBMITTED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE'])('maps task status %s', (status) => {
    const response = normalizeSunoV2Response({ task_id: 't', status, action: 'upload', result: { music_id: 'm' } }, '', 'p');
    expect(response.status).toBe(status === 'SUCCESS' ? 'completed' : status === 'FAILURE' ? 'failed' : 'processing');
  });
});
