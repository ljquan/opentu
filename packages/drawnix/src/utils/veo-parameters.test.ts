import { describe, expect, it } from 'vitest';
import type { ProviderVideoBindingMetadata } from '../services/provider-routing/types';
import {
  appendVeoAdvancedMetadata,
  buildVeoAdvancedParameters,
} from './veo-parameters';

const metadata: ProviderVideoBindingMetadata = {
  veoAdvancedParameters: {
    supportedParameters: [
      'negative_prompt',
      'generate_audio',
      'seed',
      'person_generation',
    ],
    seedMax: 100,
    personGenerationOptions: ['allow_adult'],
  },
};

describe('Veo advanced parameter contract', () => {
  it('writes camelCase metadata without losing false or zero', () => {
    const form = new FormData();
    appendVeoAdvancedMetadata(
      form,
      'veo3.1',
      {
        negative_prompt: ' blur ',
        generate_audio: 'false',
        seed: '0',
        person_generation: 'allow_adult',
        callback_url: 'https://example.test',
        onProgress: () => undefined,
      },
      metadata
    );
    expect(JSON.parse(String(form.get('metadata')))).toEqual({
      negativePrompt: 'blur',
      generateAudio: false,
      seed: 0,
      personGeneration: 'allow_adult',
    });
    expect(form.has('generate_audio')).toBe(false);
  });

  it('does not change default or other-model requests', () => {
    expect(buildVeoAdvancedParameters('veo3.1', {}, metadata)).toBeUndefined();
    expect(buildVeoAdvancedParameters('veo3', { seed: 0 })).toBeUndefined();
    const form = new FormData();
    appendVeoAdvancedMetadata(form, 'veo3.1');
    expect(form.has('metadata')).toBe(false);
  });

  it('allows all four controls without a channel declaration', () => {
    expect(buildVeoAdvancedParameters('veo3.1', {
      negative_prompt: ' blur ', generate_audio: false, seed: 0,
      person_generation: 'allow_adult',
    })).toEqual({
      negativePrompt: 'blur', generateAudio: false, seed: 0,
      personGeneration: 'allow_adult',
    });
  });

  it.each(['dont_allow', 'allow_adult', 'allow_all'])('accepts default person option %s', (value) => {
    expect(buildVeoAdvancedParameters('veo3.1', { person_generation: value }))
      .toEqual({ personGeneration: value });
  });

  it('rejects unknown person options without a channel declaration', () => {
    expect(() => buildVeoAdvancedParameters('veo3.1', { person_generation: 'unknown' }))
      .toThrow('人物生成');
  });

  it.each([-1, 101, 1.5, Infinity, true, 'bad'])(
    'rejects invalid seed %s',
    (seed) => {
      expect(() =>
        buildVeoAdvancedParameters('veo3.1', { seed }, metadata)
      ).toThrow('随机种子');
    }
  );

  it('rejects invalid scalar values and unsupported person values', () => {
    expect(() =>
      buildVeoAdvancedParameters('veo3.1', { generate_audio: 'yes' }, metadata)
    ).toThrow('true 或 false');
    expect(() =>
      buildVeoAdvancedParameters('veo3.1', { negative_prompt: 1 }, metadata)
    ).toThrow('字符串');
    expect(() =>
      buildVeoAdvancedParameters(
        'veo3.1',
        { person_generation: 'allow_all' },
        metadata
      )
    ).toThrow('人物生成');
  });
});
