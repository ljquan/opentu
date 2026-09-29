import {
  getAllBuiltInModelConfigs,
  getCompatibleParams,
  getModelConfig,
  type ParamConfig,
} from '../../constants/model-config';
import {
  getVideoModelConfig,
  VIDEO_MODEL_CONFIGS,
} from '../../constants/video-model-config';
import { getSeedance2Capabilities } from '../../utils/seedance-model';
import type { Capability, WorkflowChannel } from '../shared/model-defaults';
import type {
  NativeParameter,
  NativeReferenceInputs,
} from '../shared/native-parameters';

// Each declared field must have an explicit, reviewable final consumer.
export const PARAMETER_CONSUMERS: Record<Capability, Record<string, string>> = {
  image: {
    size: 'image adapters: request.size',
    resolution: 'image-size-quality-resolver.resolveImageResolutionTier',
    quality: 'image-size-quality-resolver / Gemini image options',
    seedream_quality: 'seedream-adapter.generateImage',
    mj_ar: 'mj-image-adapter prompt',
    mj_v: 'mj-image-adapter prompt',
    mj_style: 'mj-image-adapter prompt',
    mj_s: 'mj-image-adapter prompt',
    mj_q: 'mj-image-adapter prompt',
    mj_seed: 'mj-image-adapter prompt',
    n: 'GPT image body.n',
    background: 'GPT image body.background',
    output_format: 'GPT image body.output_format',
    output_compression: 'GPT image body.output_compression',
    response_format: 'GPT image body.response_format',
    input_fidelity: 'GPT image edit body.input_fidelity',
    moderation: 'GPT image body.moderation',
    user: 'GPT image body.user',
  },
  video: {
    duration: 'video adapters: request.duration',
    size: 'video adapters: request.size',
    sora_mode: 'video-api-service.appendVideoOutputParams',
    ratio: 'MiniMax/Seedance2/HappyHorse request body',
    generate_audio: 'Seedance2 submitBody.generate_audio',
    api_version: 'video-api-service MiniMax route',
    watermark: 'Seedance2/HappyHorse body.watermark',
    seed: 'Seedance2/HappyHorse body.seed',
    camera_fixed: 'Seedance2 body.camera_fixed',
    aspect_ratio: 'seedance-adapter.resolveVideoOptions',
    audio_setting: 'happyhorse-adapter.buildParameters',
    model_name: 'kling-adapter.resolveKlingModelName',
    klingAction2: 'kling-adapter action route',
    mode: 'kling-adapter body.mode',
    cfg_scale: 'kling-adapter body.cfg_scale',
    negative_prompt: 'kling-adapter body.negative_prompt',
    camera_control_type: 'kling-adapter.buildCameraControl',
    camera_horizontal: 'kling-adapter.buildCameraControl',
    camera_vertical: 'kling-adapter.buildCameraControl',
    camera_pan: 'kling-adapter.buildCameraControl',
    camera_tilt: 'kling-adapter.buildCameraControl',
    camera_roll: 'kling-adapter.buildCameraControl',
    camera_zoom: 'kling-adapter.buildCameraControl',
  },
  audio: {
    sunoAction: 'audio-api-service action route',
    mv: 'audio-api-service body.mv',
    title: 'audio-api-service body.title',
    tags: 'audio-api-service body.tags',
    instrumental: 'audio-api-service body.make_instrumental',
    continueSource: 'audio-api-service continuation route',
    continueClipId: 'audio-api-service body.continue_clip_id',
    continueAt: 'audio-api-service body.continue_at',
    continueTaskId: 'audio-api-service body.task_id',
    infillStartS: 'audio-api-service body.infill_start_s',
    infillEndS: 'audio-api-service body.infill_end_s',
  },
  text: {
    temperature: 'fallback-executor chat/Google sampling',
    top_p: 'fallback-executor chat/Google sampling',
    max_tokens: 'fallback-executor chat/Google output length',
  },
};

const ADAPTER_PARAMETER_IDS: Record<string, string[]> = {
  'gemini-image-adapter': [
    'size',
    'quality',
    'resolution',
    'n',
    'response_format',
  ],
  'gpt-image-adapter': [
    'size',
    'quality',
    'resolution',
    'n',
    'background',
    'output_format',
    'output_compression',
    'response_format',
    'input_fidelity',
    'moderation',
    'user',
  ],
  'tuzi-gpt-image-adapter': [
    'size',
    'quality',
    'resolution',
    'n',
    'response_format',
  ],
  'seedream-image-adapter': ['size', 'seedream_quality'],
  'flux-image-adapter': ['size'],
  'mj-image-adapter': ['mj_ar', 'mj_v', 'mj_style', 'mj_s', 'mj_q', 'mj_seed'],
  'gemini-video-adapter': [
    'size',
    'duration',
    'sora_mode',
    'api_version',
    'ratio',
  ],
  'seedance-video-adapter': ['size', 'duration', 'aspect_ratio'],
  'seedance-2-video-adapter': [
    'size',
    'duration',
    'ratio',
    'generate_audio',
    'watermark',
    'seed',
    'camera_fixed',
  ],
  'happyhorse-video-adapter': [
    'size',
    'duration',
    'ratio',
    'watermark',
    'seed',
    'audio_setting',
  ],
  'kling-video-adapter': [
    'size',
    'duration',
    'model_name',
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
  ],
  'suno-audio-adapter': [
    'sunoAction',
    'mv',
    'title',
    'tags',
    'instrumental',
    'continueSource',
    'continueClipId',
    'continueAt',
    'continueTaskId',
    'infillStartS',
    'infillEndS',
  ],
  'fallback-text-executor': ['temperature', 'top_p', 'max_tokens'],
};

export function getNativeParameterConsumer(
  capability: Capability,
  parameterId: string,
  adapterId?: string,
  requestSchema?: string
): string | undefined {
  const consumer = PARAMETER_CONSUMERS[capability][parameterId];
  if (!adapterId) return consumer;
  if (
    adapterId === 'gemini-image-adapter' &&
    requestSchema === 'openai.async.image.form'
  )
    return parameterId === 'size'
      ? 'async-image-api-service FormData.size'
      : undefined;
  if (adapterId.startsWith('custom-http'))
    return consumer
      ? `custom HTTP template params.${parameterId} (template dependent)`
      : undefined;
  return ADAPTER_PARAMETER_IDS[adapterId]?.includes(parameterId)
    ? `${adapterId}: ${consumer}`
    : undefined;
}

export function applyNativeAdapterContract(
  parameters: NativeParameter[],
  capability: Capability,
  adapterId?: string,
  requestSchema?: string
): NativeParameter[] {
  if (!adapterId) return parameters;
  return parameters.map((parameter) => {
    if (
      adapterId === 'gemini-image-adapter' &&
      parameter.id === 'quality' &&
      parameter.options?.some((option) =>
        ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(option.value)
      )
    )
      return {
        ...parameter,
        disabledReason: '当前兼容图片接口仅支持分辨率，不支持此画质字段',
      };
    return getNativeParameterConsumer(
      capability,
      parameter.id,
      adapterId,
      requestSchema
    )
      ? parameter
      : {
          ...parameter,
          disabledReason: '当前 OpenTu 渠道适配器没有此参数的请求字段',
        };
  });
}

export function serializeNativeParameter(
  parameter: ParamConfig
): NativeParameter {
  return {
    id: parameter.id,
    label: parameter.label,
    valueType: parameter.valueType,
    ...(parameter.options
      ? {
          options: parameter.options.map(({ value, label }) => ({
            value,
            label,
          })),
        }
      : {}),
    ...(parameter.defaultValue !== undefined
      ? {
          defaultValue:
            parameter.valueType === 'number'
              ? Number(parameter.defaultValue)
              : parameter.defaultValue,
        }
      : {}),
    ...(parameter.min !== undefined ? { min: parameter.min } : {}),
    ...(parameter.max !== undefined ? { max: parameter.max } : {}),
    ...(parameter.step !== undefined ? { step: parameter.step } : {}),
    ...(parameter.integer !== undefined ? { integer: parameter.integer } : {}),
  };
}

export function describeNativeModel(
  modelId: string,
  capability: Capability
): Pick<WorkflowChannel['models'][number], 'parameters' | 'referenceInputs'> {
  const known = getModelConfig(modelId);
  // Later model-specific definitions override broad tag-based definitions.
  const parameters = [
    ...new Map(
      getCompatibleParams(modelId)
        .filter((parameter) => parameter.modelType === capability)
        .map((parameter) => [parameter.id, serializeNativeParameter(parameter)])
    ).values(),
  ];
  const referenceInputs: NativeReferenceInputs = {};
  if (
    capability === 'image' &&
    known?.imageDefaults &&
    !modelId.startsWith('mj') &&
    !parameters.some((parameter) => parameter.id === 'size')
  ) {
    parameters.push({
      id: 'size',
      label: '尺寸',
      valueType: 'string',
      defaultValue: `${known.imageDefaults.width}x${known.imageDefaults.height}`,
    });
  }
  if (capability === 'image' && known)
    referenceInputs.images = {
      mode: 'reference',
      ...(modelId.includes('flux') ? { maxCount: 8 } : {}),
    };
  if (capability === 'text' && known)
    referenceInputs.images = { mode: 'reference' };
  const builtInVideo =
    capability === 'video' &&
    (VIDEO_MODEL_CONFIGS[modelId] ||
      getAllBuiltInModelConfigs().some((model) => model.id === modelId));
  if (builtInVideo) {
    const config = getVideoModelConfig(modelId);
    for (const [id, options, defaultValue] of [
      ['size', config.sizeOptions, config.defaultSize],
      ['duration', config.durationOptions, config.defaultDuration],
    ] as const) {
      if (
        !parameters.some((parameter) => parameter.id === id) &&
        options.length
      )
        parameters.push({
          id,
          label: id === 'size' ? '尺寸' : '时长',
          valueType: 'enum',
          options: options.map(({ value, label }) => ({ value, label })),
          defaultValue,
        });
    }
    referenceInputs.images = {
      maxCount: config.imageUpload.maxCount,
      minCount: config.imageUpload.required ? 1 : 0,
      mode: config.imageUpload.mode,
      labels: config.imageUpload.labels,
    };
    const seedance = getSeedance2Capabilities(modelId);
    if (seedance) {
      referenceInputs.images.maxCount = Math.min(
        config.imageUpload.maxCount,
        seedance.maxReferenceImages
      );
      referenceInputs.videos = {
        maxCount: seedance.maxReferenceVideos,
        formats: ['url'],
      };
      referenceInputs.audios = {
        maxCount: seedance.maxReferenceAudios,
        formats: ['url', 'data', 'asset'],
      };
    }
    if (modelId === 'happyhorse-1.0-video-edit') {
      referenceInputs.videos = { minCount: 1, maxCount: 1, formats: ['url'] };
      const durationIndex = parameters.findIndex(
        (parameter) => parameter.id === 'duration'
      );
      if (durationIndex !== -1) parameters.splice(durationIndex, 1);
    }
  }
  return { parameters, referenceInputs };
}

export function extendAdapterParameters(
  parameters: NativeParameter[],
  adapterId?: string
): NativeParameter[] {
  const result = [...parameters];
  const add = (parameter: NativeParameter) => {
    if (!result.some((item) => item.id === parameter.id))
      result.push(parameter);
  };
  const enumeration = (
    id: string,
    label: string,
    values: string[],
    defaultValue?: string
  ): NativeParameter => ({
    id,
    label,
    valueType: 'enum',
    options: values.map((value) => ({ value, label: value })),
    ...(defaultValue ? { defaultValue } : {}),
  });
  if (
    adapterId === 'gpt-image-adapter' ||
    adapterId === 'tuzi-gpt-image-adapter'
  ) {
    add({
      id: 'n',
      label: '数量',
      valueType: 'number',
      min: 1,
      max: 10,
      integer: true,
      defaultValue: 1,
    });
    add(enumeration('response_format', '返回格式', ['url', 'b64_json']));
  }
  if (adapterId === 'gpt-image-adapter') {
    add(enumeration('background', '背景', ['auto', 'opaque', 'transparent']));
    add(enumeration('output_format', '输出格式', ['png', 'jpeg', 'webp']));
    add({
      id: 'output_compression',
      label: '压缩质量',
      valueType: 'number',
      min: 0,
      max: 100,
      integer: true,
    });
    add(enumeration('moderation', '内容审核', ['auto', 'low']));
    add(enumeration('input_fidelity', '输入保真度', ['high', 'low']));
    add({ id: 'user', label: '用户标识', valueType: 'string' });
  }
  if (adapterId === 'suno-audio-adapter') {
    add({ id: 'continueTaskId', label: '续作任务 ID', valueType: 'string' });
    add({
      id: 'infillStartS',
      label: '替换开始秒数',
      valueType: 'number',
      min: 0,
    });
    add({
      id: 'infillEndS',
      label: '替换结束秒数',
      valueType: 'number',
      min: 0,
    });
    for (const parameter of result) {
      if (parameter.id !== 'sunoAction')
        parameter.variants = [
          {
            when: { sunoAction: ['lyrics'] },
            disabledReason: '歌词生成仅接受提示词',
          },
        ];
    }
  }
  return result;
}
