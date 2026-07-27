import { afterEach, describe, expect, it } from 'vitest';
import { inferBindingsForProviderModel } from '../provider-routing';
import {
  extractVideoFailureMessage,
  formatVideoHttpError,
  getEffectiveVideoCompatibleParams,
  getEffectiveVideoModelConfig,
  resolveVideoBaseUrlStrategy,
  resolveVideoPollPath,
  resolveVideoSubmission,
  shouldDownloadVideoContent,
} from '../video-binding-utils';
import {
  clearRuntimeModelConfigs,
  ModelVendor,
  setRuntimeModelConfigs,
  type ModelConfig,
} from '../../constants/model-config';
import { getVideoModelConfig } from '../../constants/video-model-config';

afterEach(() => {
  clearRuntimeModelConfigs();
});

describe('video binding utils', () => {
  it('repairs legacy Tuzi video bindings that omitted /v1', () => {
    expect(
      resolveVideoBaseUrlStrategy(
        {
          profileId: 'provider-tuzi',
          profileName: 'Tuzi',
          providerType: 'openai-compatible',
          baseUrl: 'https://api.tu-zi.com',
          apiKey: 'test-key',
          authType: 'bearer',
        },
        '/videos'
      )
    ).toBe('ensure-v1');
  });

  it('turns an HTML video endpoint response into a concise error', () => {
    const message = formatVideoHttpError(
      'submit',
      404,
      '<!DOCTYPE html><html><head><title>Page not found</title></head></html>',
      'https://preview.example.com/v1/videos?token=hidden'
    );

    expect(message).toContain('视频 API 端点返回了网页');
    expect(message).toContain('https://preview.example.com/v1/videos');
    expect(message).not.toContain('token=hidden');
    expect(message).not.toContain('<!DOCTYPE html>');
  });

  it('prefers provider failure text returned in video_url', () => {
    expect(
      extractVideoFailureMessage({
        status: 'failed',
        video_url: '图片下载失败，请确认上传图片公网可达',
        error: { message: 'task failed' },
      })
    ).toBe('图片下载失败，请确认上传图片公网可达');
  });

  it('does not treat a playable video_url as an error message', () => {
    expect(
      extractVideoFailureMessage({
        status: 'failed',
        video_url: 'https://cdn.example.com/video.mp4',
        error: { message: 'task failed' },
      })
    ).toBe('task failed');
  });

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

  it('resolves provider poll path templates with task id and params', () => {
    expect(
      resolveVideoPollPath(
        'remote/task 1',
        {
          id: 'provider-kling:kling_video:video',
          profileId: 'provider-kling',
          modelId: 'kling_video',
          operation: 'video',
          protocol: 'kling.video',
          requestSchema: 'kling.video.json',
          responseSchema: 'kling.video.task',
          submitPath: '/kling/v1/videos/{action}',
          pollPathTemplate: '/kling/v1/videos/{action}/{taskId}',
          priority: 100,
          confidence: 'high',
          source: 'template',
        },
        { action: 'text2video' }
      )
    ).toBe('/kling/v1/videos/text2video/remote%2Ftask%201');
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

  it('aligns Omni Flash video config with Veo 3.1 request controls', () => {
    const omniFlashConfig = getEffectiveVideoModelConfig('omni-flash', null);
    const omniComponentsConfig = getEffectiveVideoModelConfig(
      'omni-flash-components',
      null
    );
    const omniFlashParams = getEffectiveVideoCompatibleParams('omni-flash');
    const omniComponentsParams = getEffectiveVideoCompatibleParams(
      'omni-flash-components'
    );

    expect(omniFlashConfig).toMatchObject({
      provider: 'veo',
      defaultDuration: '8',
      defaultSize: '1280x720',
      imageUpload: {
        maxCount: 2,
        mode: 'frames',
        labels: ['首帧', '尾帧'],
      },
    });
    expect(
      omniFlashConfig.durationOptions.map((option) => option.value)
    ).toEqual(['8']);
    expect(omniFlashConfig.sizeOptions.map((option) => option.value)).toEqual([
      '1280x720',
      '720x1280',
    ]);
    expect(omniComponentsConfig).toMatchObject({
      provider: 'veo',
      defaultDuration: '8',
      defaultSize: '1280x720',
      imageUpload: {
        maxCount: 3,
        mode: 'components',
        labels: ['参考图1', '参考图2', '参考图3'],
      },
    });
    expect(
      omniComponentsConfig.sizeOptions.map((option) => option.value)
    ).toEqual(['1280x720', '720x1280']);

    for (const params of [omniFlashParams, omniComponentsParams]) {
      expect(
        params
          .find((param) => param.id === 'duration')
          ?.options?.map((option) => option.value)
      ).toEqual(['8']);
      expect(
        params
          .find((param) => param.id === 'size')
          ?.options?.map((option) => option.value)
      ).toEqual(['1280x720', '720x1280']);
    }

    expect(getVideoModelConfig('omni-flash').imageUpload.mode).toBe('frames');
    expect(getVideoModelConfig('omni-flash-components').imageUpload.mode).toBe(
      'components'
    );

    expect(resolveVideoSubmission('omni-flash', '8', null)).toMatchObject({
      model: 'omni-flash',
      duration: '8',
      durationField: 'seconds',
    });
    expect(
      resolveVideoSubmission('omni-flash-components', '8', null)
    ).toMatchObject({
      model: 'omni-flash-components',
      duration: '8',
      durationField: 'seconds',
    });
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
