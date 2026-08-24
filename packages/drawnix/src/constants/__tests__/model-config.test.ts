import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRuntimeModelConfigs,
  getCompatibleParams,
  getStaticModelsByType,
  getSizeOptionsForModel,
  getStaticModelConfig,
  ModelVendor,
  setRuntimeModelConfigs,
} from '../model-config';

describe('model-config image size options', () => {
  afterEach(() => {
    clearRuntimeModelConfigs();
  });

  it('为 gpt-image-2 系列暴露扩展比例', () => {
    const expected = [
      'auto',
      '1x1',
      '2x3',
      '3x2',
      '3x4',
      '4x3',
      '4x5',
      '5x4',
      '9x16',
      '16x9',
      '21x9',
    ];

    expect(
      getSizeOptionsForModel('gpt-image-2').map((option) => option.value)
    ).toEqual(expected);
    expect(
      getSizeOptionsForModel('gpt-image-2-vip').map((option) => option.value)
    ).toEqual(expected);
  });

  it('为 gpt-image-2 暴露分辨率和官方画质参数', () => {
    const params = getCompatibleParams('gpt-image-2');
    const qualityParams = params.filter((param) => param.id === 'quality');

    expect(
      params
        .find((param) => param.id === 'resolution')
        ?.options?.map((option) => option.value)
    ).toEqual(['1k', '2k', '4k']);
    expect(qualityParams).toHaveLength(1);
    expect(qualityParams[0]?.options?.map((option) => option.value)).toEqual([
      'auto',
      'low',
      'medium',
      'high',
    ]);
  });

  it('不再内置已下架的 GPT Image 旧模型', () => {
    expect(getStaticModelConfig('gpt-image-1')).toBeUndefined();
    expect(getStaticModelConfig('gpt-image-1.5')).toBeUndefined();
    expect(getCompatibleParams('gpt-image-1')).toEqual([]);
    expect(getCompatibleParams('gpt-image-1.5')).toEqual([]);
  });

  it('保留 Gemini preview 的旧 quality 档位参数', () => {
    const params = getCompatibleParams('gemini-3-pro-image-preview');
    const qualityParams = params.filter((param) => param.id === 'quality');

    expect(qualityParams).toHaveLength(1);
    expect(qualityParams[0]?.options?.map((option) => option.value)).toEqual([
      '1k',
      '2k',
      '4k',
    ]);
  });

  it('为 Midjourney 暴露 V8 和 V8.1 版本参数', () => {
    const params = getCompatibleParams('mj-imagine');
    const versionParam = params.find((param) => param.id === 'mj_v');

    expect(versionParam?.options?.map((option) => option.value)).toEqual([
      'default',
      '8.1',
      '8',
      '7',
      '6',
    ]);
  });

  it('为 Midjourney 参数使用标签兼容而不是固定模型 ID', () => {
    const params = getCompatibleParams('mj-imagine');

    ['mj_ar', 'mj_v', 'mj_style', 'mj_s', 'mj_q', 'mj_seed'].forEach(
      (paramId) => {
        expect(
          params.find((param) => param.id === paramId)?.compatibleModels
        ).toEqual([]);
        expect(
          params.find((param) => param.id === paramId)?.compatibleTags
        ).toEqual(['mj', 'midjourney']);
      }
    );
  });

  it('只为 Midjourney 模型暴露 Midjourney 参数', () => {
    setRuntimeModelConfigs([
      {
        id: 'mj_fast_background_eraser',
        label: 'mj_fast_background_eraser',
        type: 'image',
        vendor: ModelVendor.MIDJOURNEY,
        tags: ['runtime', 'mj'],
      },
    ]);

    const mjRuntimeParamIds = getCompatibleParams(
      'mj_fast_background_eraser'
    ).map((param) => param.id);
    const gptParamIds = getCompatibleParams('gpt-image-2').map(
      (param) => param.id
    );

    expect(mjRuntimeParamIds).toContain('mj_ar');
    expect(mjRuntimeParamIds).toContain('mj_v');
    expect(gptParamIds).not.toContain('mj_ar');
    expect(gptParamIds).not.toContain('mj_v');
  });

  it('按模型暴露 HappyHorse 参数控制', () => {
    const t2vParams = getCompatibleParams('happyhorse-1.0-t2v');
    const i2vParams = getCompatibleParams('happyhorse-1.0-i2v');
    const r2vParams = getCompatibleParams('happyhorse-1.0-r2v');
    const editParams = getCompatibleParams('happyhorse-1.0-video-edit');

    expect(getSizeOptionsForModel('happyhorse-1.0-r2v')[0]?.value).toBe(
      '1080P'
    );
    expect(
      r2vParams
        .find((param) => param.id === 'duration')
        ?.options?.map((option) => option.value)
    ).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
    ]);
    expect(
      r2vParams
        .find((param) => param.id === 'ratio')
        ?.options?.map((option) => option.value)
    ).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4']);
    expect(i2vParams.some((param) => param.id === 'ratio')).toBe(false);
    expect(editParams.some((param) => param.id === 'duration')).toBe(false);
    expect(editParams.some((param) => param.id === 'ratio')).toBe(false);
    expect(editParams.some((param) => param.id === 'audio_setting')).toBe(true);
    expect(t2vParams.some((param) => param.id === 'ratio')).toBe(true);
    expect(r2vParams.find((param) => param.id === 'seed')).toMatchObject({
      valueType: 'number',
      min: 0,
      max: 2147483647,
    });
    expect(
      r2vParams
        .find((param) => param.id === 'watermark')
        ?.options?.map((option) => option.value)
    ).toEqual(['true', 'false']);
    expect(
      r2vParams.find((param) => param.id === 'watermark')?.defaultValue
    ).toBe('false');
    expect(getStaticModelConfig('happyhorse-1.0-t2v')?.vendor).toBe(
      ModelVendor.HAPPYHORSE
    );
  });

  it('为 Omni Flash 系列按 Veo 3.1 暴露视频参数', () => {
    const omniFlashParams = getCompatibleParams('omni-flash');
    const omniComponentsParams = getCompatibleParams('omni-flash-components');

    expect(getStaticModelConfig('omni-flash')).toMatchObject({
      label: 'Gemini Omni Flash',
      type: 'video',
      vendor: ModelVendor.GEMINI,
      videoDefaults: {
        duration: '8',
        size: '1280x720',
        aspectRatio: '16:9',
      },
    });
    expect(getStaticModelConfig('omni-flash-components')).toMatchObject({
      label: 'Gemini Omni Flash Components',
      type: 'video',
      vendor: ModelVendor.GEMINI,
      videoDefaults: {
        duration: '8',
        size: '1280x720',
        aspectRatio: '16:9',
      },
    });

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
  });

  it('默认目录新增九个模型并隐藏旧 GPT 入口但保留解析', () => {
    const textIds = getStaticModelsByType('text').map((model) => model.id);
    const videoIds = getStaticModelsByType('video').map((model) => model.id);

    expect(textIds.slice(0, 6)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-0731',
    ]);
    expect(videoIds).toEqual(
      expect.arrayContaining([
        'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2-0-mini-260615',
        'doubao-seedance-2-5-260628',
      ])
    );
    expect(textIds).not.toContain('gpt-5.4');
    expect(textIds).not.toContain('gpt-5.2');
    expect(textIds).not.toContain('gpt-5.1');
    expect(textIds).not.toContain('gpt-5-pro');
    expect(getStaticModelConfig('gpt-5.4')).toMatchObject({
      id: 'gpt-5.4',
      type: 'text',
    });
    expect(getStaticModelConfig('gpt-5.1')).toMatchObject({
      id: 'gpt-5.1',
      type: 'text',
    });
  });

  it.each([
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-0-mini-260615',
  ])('Seedance 2.0 参数与官方 JSON 契约一致：%s', (modelId) => {
    const params = getCompatibleParams(modelId);
    const options = (paramId: string) =>
      params
        .find((param) => param.id === paramId)
        ?.options?.map((option) => option.value);

    expect(options('duration')).toEqual([
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
    expect(options('size')).toEqual(['1080p', '720p', '480p']);
    expect(options('ratio')).toEqual([
      '16:9',
      '4:3',
      '1:1',
      '3:4',
      '9:16',
      '21:9',
      'adaptive',
    ]);
    expect(params.map((param) => param.id)).toEqual(
      expect.arrayContaining([
        'generate_audio',
        'watermark',
        'seed',
        'camera_fixed',
      ])
    );
  });

  it('Seedance 2.5 exposes its own duration and ratio boundaries', () => {
    const params = getCompatibleParams('doubao-seedance-2-5-260628');
    const options = (paramId: string) =>
      params
        .find((param) => param.id === paramId)
        ?.options?.map((option) => option.value);

    expect(options('duration')).toHaveLength(27);
    expect(options('duration')?.[0]).toBe('4');
    expect(options('duration')?.[26]).toBe('30');
    expect(options('ratio')).toEqual(['16:9', '9:16', '1:1']);
    expect(options('size')).toBeUndefined();
    expect(params.map((param) => param.id)).not.toEqual(
      expect.arrayContaining(['seed', 'camera_fixed'])
    );
  });
});
