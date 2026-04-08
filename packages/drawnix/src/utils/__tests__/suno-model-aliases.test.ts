import { describe, expect, it } from 'vitest';
import {
  applyForcedSunoParams,
  applySunoAliasPresentation,
  getForcedSunoParams,
  getSunoModelAlias,
} from '../suno-model-aliases';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';

describe('suno-model-aliases', () => {
  it('maps suno_lyrics to a forced lyrics action', () => {
    expect(getSunoModelAlias('suno_lyrics')).toMatchObject({
      entryModelId: 'suno_music',
      availability: 'supported',
    });
    expect(getForcedSunoParams('suno_lyrics')).toEqual({
      sunoAction: 'lyrics',
    });
    expect(
      applyForcedSunoParams('suno_lyrics', { sunoAction: 'music', mv: 'chirp-v5' })
    ).toEqual({
      sunoAction: 'lyrics',
      mv: 'chirp-v5',
    });
  });

  it('maps continuation aliases to the expected continuation source', () => {
    expect(getForcedSunoParams('suno-continue')).toEqual({
      sunoAction: 'music',
      continueSource: 'clip',
    });
    expect(getForcedSunoParams('suno-continue-uploaded')).toEqual({
      sunoAction: 'music',
      continueSource: 'upload',
    });
  });

  it('decorates runtime Suno aliases with user-facing labels and tags', () => {
    const runtimeModel: ModelConfig = {
      id: 'suno_lyrics',
      label: 'suno_lyrics',
      shortLabel: 'suno_lyrics',
      shortCode: 'sl',
      type: 'audio',
      vendor: ModelVendor.OTHER,
      description: 'Other 音频模型',
      tags: ['runtime'],
    };

    expect(applySunoAliasPresentation(runtimeModel)).toMatchObject({
      vendor: ModelVendor.SUNO,
      label: 'Suno Lyrics',
      shortLabel: 'Suno 歌词',
      description: 'Suno 歌词生成入口，默认走 lyrics 提交链路',
      tags: expect.arrayContaining(['runtime', 'suno', 'audio', 'music', 'lyrics']),
    });
  });
});
