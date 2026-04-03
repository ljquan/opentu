import { afterEach, describe, expect, it } from 'vitest';
import { inferBindingsForProviderModel } from '../provider-routing';
import {
  getEffectiveVideoCompatibleParams,
  getEffectiveVideoModelConfig,
  resolveVideoSubmission,
  shouldDownloadVideoContent,
} from '../video-binding-utils';
import {
  clearRuntimeModelConfigs,
  ModelVendor,
  setRuntimeModelConfigs,
  type ModelConfig,
} from '../../constants/model-config';

afterEach(() => {
  clearRuntimeModelConfigs();
});

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

  it('uses Kling capability defaults and exposes model_name for runtime models', () => {
    setRuntimeModelConfigs([
      {
        id: 'kling_video',
        label: 'Kling',
        shortLabel: 'Kling',
        type: 'video',
        vendor: ModelVendor.KLING,
        videoDefaults: {
          duration: '5',
          size: '1280x720',
          aspectRatio: '16:9',
        },
      },
    ]);

    const binding = inferBindingsForProviderModel(
      {
        id: 'provider-kling',
        name: 'Kling Provider',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      },
      {
        id: 'kling_video',
        label: 'Kling',
        type: 'video',
        vendor: ModelVendor.KLING,
      }
    ).find((candidate) => candidate.protocol === 'kling.video');

    const config = getEffectiveVideoModelConfig('kling_video', binding || null);

    expect(config.defaultDuration).toBe('5');
    expect(config.durationOptions.map((option) => option.value)).toEqual([
      '5',
      '10',
    ]);
    expect(config.sizeOptions.map((option) => option.aspectRatio)).toEqual([
      '16:9',
      '9:16',
      '1:1',
    ]);

    const params = getEffectiveVideoCompatibleParams('kling_video');
    const durationParam = params.find((param) => param.id === 'duration');
    const sizeParam = params.find((param) => param.id === 'size');
    const modelNameParam = params.find((param) => param.id === 'model_name');
    const cfgScaleParam = params.find((param) => param.id === 'cfg_scale');
    const cameraHorizontalParam = params.find(
      (param) => param.id === 'camera_horizontal'
    );

    expect(durationParam?.defaultValue).toBe('5');
    expect(durationParam?.options?.map((option) => option.value)).toEqual([
      '5',
      '10',
    ]);
    expect(sizeParam?.defaultValue).toBe('1280x720');
    expect(sizeParam?.options?.map((option) => option.value)).toEqual([
      '1280x720',
      '720x1280',
      '1024x1024',
    ]);
    expect(modelNameParam?.defaultValue).toBe('kling-v1-6');
    expect(modelNameParam?.options?.map((option) => option.value)).toEqual([
      'kling-v3',
      'kling-v2-6',
      'kling-v2-1',
      'kling-v1-6',
      'kling-v1-5',
    ]);
    expect(cfgScaleParam).toMatchObject({
      min: 0,
      max: 1,
      step: 0.01,
    });
    expect(cameraHorizontalParam).toMatchObject({
      min: -10,
      max: 10,
      step: 1,
      integer: true,
    });

    expect(params.map((param) => param.id)).toEqual(
      expect.arrayContaining([
        'duration',
        'size',
        'klingAction2',
        'mode',
        'cfg_scale',
        'negative_prompt',
        'camera_control_type',
        'camera_horizontal',
        'camera_vertical',
        'camera_pan',
        'camera_tilt',
        'camera_roll',
        'camera_zoom',
      ])
    );
  });

  it('reuses Kling defaults for standard Kling version aliases', () => {
    const config = getEffectiveVideoModelConfig('kling-v3', null);

    expect(config.defaultDuration).toBe('5');
    expect(config.durationOptions.map((option) => option.value)).toEqual([
      '5',
      '10',
    ]);
    expect(config.defaultSize).toBe('1280x720');
  });
});
