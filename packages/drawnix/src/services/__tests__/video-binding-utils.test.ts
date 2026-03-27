import { describe, expect, it } from 'vitest';
import { inferBindingsForProviderModel } from '../provider-routing';
import {
  getEffectiveVideoCompatibleParams,
  getEffectiveVideoModelConfig,
  resolveVideoSubmission,
  shouldDownloadVideoContent,
} from '../video-binding-utils';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';

describe('video binding utils', () => {
  it('overrides official OpenAI sora bindings with raw Sora capabilities', () => {
    const model: ModelConfig = {
      id: 'sora-2',
      label: 'Sora 2',
      type: 'video',
      vendor: ModelVendor.SORA,
    };

    const bindings = inferBindingsForProviderModel(
      {
        id: 'openai-official',
        name: 'OpenAI Official',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      },
      model
    );

    const binding = bindings.find(
      (candidate) => candidate.protocol === 'openai.async.video'
    );

    expect(binding?.metadata?.video?.allowedDurations).toEqual(['4', '8', '12']);
    expect(binding?.metadata?.video?.defaultDuration).toBe('8');
    expect(binding?.metadata?.video?.strictDurationValidation).toBe(true);
    expect(binding?.metadata?.video?.resultMode).toBe('download-content');
    expect(binding?.metadata?.video?.downloadPathTemplate).toBe(
      '/videos/{taskId}/content'
    );
  });

  it('maps fixed-duration Sora aliases without sending seconds again', () => {
    const submission = resolveVideoSubmission('sora-2-4s', '4', null);

    expect(submission.model).toBe('sora-2-4s');
    expect(submission.duration).toBeUndefined();
    expect(submission.durationField).toBe('seconds');
  });

  it('rejects unsupported Sora durations for official OpenAI bindings', () => {
    const submissionBinding = inferBindingsForProviderModel(
      {
        id: 'openai-official',
        name: 'OpenAI Official',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      },
      {
        id: 'sora-2',
        label: 'Sora 2',
        type: 'video',
        vendor: ModelVendor.SORA,
      }
    ).find((candidate) => candidate.protocol === 'openai.async.video');

    expect(() =>
      resolveVideoSubmission('sora-2', '15', submissionBinding || null)
    ).toThrow('4/8/12');
  });

  it('applies binding durations to the effective video config', () => {
    const binding = inferBindingsForProviderModel(
      {
        id: 'openai-official',
        name: 'OpenAI Official',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      },
      {
        id: 'sora-2',
        label: 'Sora 2',
        type: 'video',
        vendor: ModelVendor.SORA,
      }
    ).find((candidate) => candidate.protocol === 'openai.async.video');

    const config = getEffectiveVideoModelConfig('sora-2', binding || null);

    expect(config.defaultDuration).toBe('8');
    expect(config.durationOptions.map((option) => option.value)).toEqual([
      '4',
      '8',
      '12',
    ]);
    expect(
      shouldDownloadVideoContent('sora-2', binding || null, {
        status: 'completed',
      })
    ).toBe(true);
  });

  it('falls back to content download for third-party sora bindings without inline urls', () => {
    const binding = inferBindingsForProviderModel(
      {
        id: 'third-party-openai',
        name: 'Third Party OpenAI',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      },
      {
        id: 'sora-2',
        label: 'Sora 2',
        type: 'video',
        vendor: ModelVendor.SORA,
      }
    ).find((candidate) => candidate.protocol === 'openai.async.video');

    expect(binding?.metadata?.video?.downloadPathTemplate).toBe(
      '/videos/{taskId}/content'
    );
    expect(
      shouldDownloadVideoContent('sora-2', binding || null, {
        status: 'completed',
      })
    ).toBe(true);
  });

  it('falls back to content download for completed sora payloads even without binding metadata', () => {
    expect(
      shouldDownloadVideoContent('sora-2', null, {
        status: 'completed',
      })
    ).toBe(true);
  });

  it('switches sora frontend durations to api mode when selected', () => {
    const config = getEffectiveVideoModelConfig('sora-2', null, {
      sora_mode: 'api',
    });

    expect(config.defaultDuration).toBe('8');
    expect(config.durationOptions.map((option) => option.value)).toEqual([
      '4',
      '8',
      '12',
    ]);

    const params = getEffectiveVideoCompatibleParams('sora-2', 'sora-2', {
      sora_mode: 'api',
    });
    const durationParam = params.find((param) => param.id === 'duration');
    expect(durationParam?.defaultValue).toBe('8');
  });

  it('keeps sora frontend durations on web mode when selected', () => {
    const config = getEffectiveVideoModelConfig('sora-2', null, {
      sora_mode: 'web',
    });

    expect(config.defaultDuration).toBe('10');
    expect(config.durationOptions.map((option) => option.value)).toEqual([
      '10',
      '15',
    ]);

    const submission = resolveVideoSubmission(
      'sora-2',
      undefined,
      null,
      {
        sora_mode: 'web',
      }
    );
    expect(submission.duration).toBe('10');
  });

  it('does not strictly reject third-party sora api-mode durations', () => {
    const submission = resolveVideoSubmission(
      'sora-2',
      '8',
      null,
      {
        sora_mode: 'api',
      }
    );

    expect(submission.duration).toBe('8');
    expect(submission.model).toBe('sora-2');
  });
});
