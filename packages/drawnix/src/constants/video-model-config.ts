/**
 * Video Model Configuration
 *
 * Defines supported video models and their parameter options.
 * This configuration drives the UI for video generation.
 */

import type {
  DurationOption,
  ImageUploadConfig,
  SizeOption,
  VideoModel,
  VideoModelConfig,
} from '../types/video.types';
import { getModelConfig, ModelVendor } from './model-config';
import { SEEDANCE_25_MODEL_ID } from '../utils/seedance-model';

const SEEDANCE_ASPECT_RATIO_OPTIONS = [
  { label: '横屏 16:9', aspectRatio: '16:9' },
  { label: '竖屏 9:16', aspectRatio: '9:16' },
  { label: '方形 1:1', aspectRatio: '1:1' },
] as const;

const SEEDANCE_RESOLUTION_OPTIONS = ['1080p', '720p', '480p'] as const;

const SEEDANCE_SIZE_OPTIONS: SizeOption[] = SEEDANCE_RESOLUTION_OPTIONS.flatMap(
  (resolution) =>
    SEEDANCE_ASPECT_RATIO_OPTIONS.map(({ label, aspectRatio }) => ({
      label: `${resolution} · ${label}`,
      value: `${resolution}@${aspectRatio}`,
      aspectRatio,
    }))
);

const SEEDANCE_2_DURATION_OPTIONS: DurationOption[] = Array.from(
  { length: 9 },
  (_, index) => {
    const value = String(index + 4);
    return { label: `${value}秒`, value };
  }
);

const SEEDANCE_25_DURATION_OPTIONS: DurationOption[] = Array.from(
  { length: 27 },
  (_, index) => {
    const value = String(index + 4);
    return { label: `${value}秒`, value };
  }
);

const SEEDANCE_2_SIZE_OPTIONS: SizeOption[] = ['1080p', '720p', '480p'].map(
  (resolution) => ({
    label: resolution,
    value: resolution,
    aspectRatio: 'resolution',
  })
);

const SEEDANCE_2_REFERENCE_LABELS = Array.from(
  { length: 9 },
  (_, index) => `参考图${index + 1}`
);

const SEEDANCE_25_REFERENCE_LABELS = Array.from(
  { length: 30 },
  (_, index) => `参考图${index + 1}`
);

const HAPPYHORSE_RESOLUTION_OPTIONS = ['1080P', '720P'] as const;

const HAPPYHORSE_SIZE_OPTIONS: SizeOption[] = HAPPYHORSE_RESOLUTION_OPTIONS.map(
  (resolution) => ({
    label: resolution,
    value: resolution,
    aspectRatio: 'resolution',
  })
);

const HAPPYHORSE_DURATION_OPTIONS: DurationOption[] = [
  { label: '3秒', value: '3' },
  { label: '4秒', value: '4' },
  { label: '5秒', value: '5' },
  { label: '6秒', value: '6' },
  { label: '7秒', value: '7' },
  { label: '8秒', value: '8' },
  { label: '9秒', value: '9' },
  { label: '10秒', value: '10' },
  { label: '11秒', value: '11' },
  { label: '12秒', value: '12' },
  { label: '13秒', value: '13' },
  { label: '14秒', value: '14' },
  { label: '15秒', value: '15' },
];

/**
 * Video model configurations
 * Each model has specific duration, size, and image upload options
 */
export const VIDEO_MODEL_CONFIGS: Record<string, VideoModelConfig> = {
  kling_video: {
    id: 'kling_video',
    label: 'Kling',
    provider: 'kling',
    description: 'Kling 标准视频能力，版本通过 model_name 选择',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
      { label: '方形 1:1', value: '1024x1024', aspectRatio: '1:1' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
  'kling-v1-6': {
    id: 'kling-v1-6',
    label: 'Kling V1.6',
    provider: 'kling',
    description: '5s/10s 视频，支持文生视频和图生视频',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
      { label: '方形 1:1', value: '1024x1024', aspectRatio: '1:1' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
  // Veo models
  veo3: {
    id: 'veo3',
    label: 'Veo 3',
    provider: 'veo',
    description: '8秒视频',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
  'veo3-pro': {
    id: 'veo3-pro',
    label: 'Veo 3 Pro',
    provider: 'veo',
    description: '8秒高质量视频',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
  'veo3.1': {
    id: 'veo3.1',
    label: 'Veo 3.1',
    provider: 'veo',
    description: '8秒快速模式，支持首尾帧',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },
  'veo3.1-pro': {
    id: 'veo3.1-pro',
    label: 'Veo 3.1 Pro',
    provider: 'veo',
    description: '8秒高质量模式，支持首尾帧',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },
  'veo3.1-components': {
    id: 'veo3.1-components',
    label: 'Veo 3.1 Components',
    provider: 'veo',
    description: '8秒模式，支持3张参考图',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 3,
      mode: 'components',
      labels: ['参考图1', '参考图2', '参考图3'],
    },
  },
  'omni-flash': {
    id: 'omni-flash',
    label: 'Gemini Omni Flash',
    provider: 'veo',
    description: '8秒快速模式，支持首尾帧',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },
  'omni-flash-components': {
    id: 'omni-flash-components',
    label: 'Gemini Omni Flash Components',
    provider: 'veo',
    description: '8秒模式，支持3张参考图',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 3,
      mode: 'components',
      labels: ['参考图1', '参考图2', '参考图3'],
    },
  },
  'veo3.1-4k': {
    id: 'veo3.1-4k',
    label: 'Veo 3.1 4K',
    provider: 'veo',
    description: '8秒4K模式，支持首尾帧',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '4K横屏 16:9', value: '3840x2160', aspectRatio: '16:9' },
      { label: '4K竖屏 9:16', value: '2160x3840', aspectRatio: '9:16' },
    ],
    defaultSize: '3840x2160',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },
  'veo3.1-components-4k': {
    id: 'veo3.1-components-4k',
    label: 'Veo 3.1 Components 4K',
    provider: 'veo',
    description: '8秒4K模式，支持3张参考图',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '4K横屏 16:9', value: '3840x2160', aspectRatio: '16:9' },
      { label: '4K竖屏 9:16', value: '2160x3840', aspectRatio: '9:16' },
    ],
    defaultSize: '3840x2160',
    imageUpload: {
      maxCount: 3,
      mode: 'components',
      labels: ['参考图1', '参考图2', '参考图3'],
    },
  },
  'veo3.1-pro-4k': {
    id: 'veo3.1-pro-4k',
    label: 'Veo 3.1 Pro 4K',
    provider: 'veo',
    description: '8秒高质量4K模式，支持首尾帧',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '4K横屏 16:9', value: '3840x2160', aspectRatio: '16:9' },
      { label: '4K竖屏 9:16', value: '2160x3840', aspectRatio: '9:16' },
    ],
    defaultSize: '3840x2160',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },

  // Seedance models
  [SEEDANCE_25_MODEL_ID]: {
    id: SEEDANCE_25_MODEL_ID,
    label: 'Seedance 2.5',
    provider: 'seedance',
    description: '音视频联合生成，支持 4-30 秒与 7 种画面比例',
    durationOptions: SEEDANCE_25_DURATION_OPTIONS,
    defaultDuration: '8',
    sizeOptions: [],
    defaultSize: '',
    imageUpload: {
      maxCount: 30,
      mode: 'reference',
      labels: SEEDANCE_25_REFERENCE_LABELS,
    },
  },
  'doubao-seedance-2-0-260128': {
    id: 'doubao-seedance-2-0-260128',
    label: 'Seedance 2.0',
    provider: 'seedance',
    description: '多模态视频生成，支持 4-12 秒与 480p/720p/1080p',
    durationOptions: SEEDANCE_2_DURATION_OPTIONS,
    defaultDuration: '5',
    sizeOptions: SEEDANCE_2_SIZE_OPTIONS,
    defaultSize: '720p',
    imageUpload: {
      maxCount: 9,
      mode: 'reference',
      labels: SEEDANCE_2_REFERENCE_LABELS,
    },
  },
  'doubao-seedance-2-0-fast-260128': {
    id: 'doubao-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
    provider: 'seedance',
    description: '高速多模态视频生成，支持 4-12 秒与 480p/720p/1080p',
    durationOptions: SEEDANCE_2_DURATION_OPTIONS,
    defaultDuration: '5',
    sizeOptions: SEEDANCE_2_SIZE_OPTIONS,
    defaultSize: '720p',
    imageUpload: {
      maxCount: 9,
      mode: 'reference',
      labels: SEEDANCE_2_REFERENCE_LABELS,
    },
  },
  'doubao-seedance-2-0-mini-260615': {
    id: 'doubao-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
    provider: 'seedance',
    description: '轻量多模态视频生成，支持 4-12 秒与 480p/720p/1080p',
    durationOptions: SEEDANCE_2_DURATION_OPTIONS,
    defaultDuration: '5',
    sizeOptions: SEEDANCE_2_SIZE_OPTIONS,
    defaultSize: '720p',
    imageUpload: {
      maxCount: 4,
      mode: 'reference',
      labels: ['参考图1', '参考图2', '参考图3', '参考图4'],
    },
  },
  'seedance-1.5-pro': {
    id: 'seedance-1.5-pro',
    label: 'Seedance 1.5 Pro',
    provider: 'seedance',
    description: '即梦 1.5 Pro 有声视频，支持首尾帧',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: SEEDANCE_SIZE_OPTIONS,
    defaultSize: '720p@16:9',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },
  'seedance-1.0-pro': {
    id: 'seedance-1.0-pro',
    label: 'Seedance 1.0 Pro',
    provider: 'seedance',
    description: '即梦 1.0 Pro，支持首尾帧',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: SEEDANCE_SIZE_OPTIONS,
    defaultSize: '720p@16:9',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },
  'seedance-1.0-pro-fast': {
    id: 'seedance-1.0-pro-fast',
    label: 'Seedance 1.0 Fast',
    provider: 'seedance',
    description: '即梦 1.0 快速模式，仅首帧',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: SEEDANCE_SIZE_OPTIONS,
    defaultSize: '720p@16:9',
    imageUpload: {
      maxCount: 1,
      mode: 'frames',
      labels: ['首帧'],
    },
  },
  'seedance-1.0-lite': {
    id: 'seedance-1.0-lite',
    label: 'Seedance 1.0 Lite',
    provider: 'seedance',
    description: '即梦 1.0 Lite，支持首尾帧和参考图',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: SEEDANCE_SIZE_OPTIONS,
    defaultSize: '720p@16:9',
    imageUpload: {
      maxCount: 4,
      mode: 'reference',
      labels: ['首帧', '尾帧', '参考图1', '参考图2'],
    },
  },

  // HappyHorse models
  'happyhorse-1.0-t2v': {
    id: 'happyhorse-1.0-t2v',
    label: 'HappyHorse 1.0 T2V',
    provider: 'happyhorse',
    description: 'HappyHorse 文生视频，支持分辨率、比例和 3-15 秒整数时长',
    durationOptions: HAPPYHORSE_DURATION_OPTIONS,
    defaultDuration: '5',
    sizeOptions: HAPPYHORSE_SIZE_OPTIONS,
    defaultSize: '1080P',
    imageUpload: {
      maxCount: 0,
      mode: 'reference',
      labels: [],
    },
  },
  'happyhorse-1.0-i2v': {
    id: 'happyhorse-1.0-i2v',
    label: 'HappyHorse 1.0 I2V',
    provider: 'happyhorse',
    description: 'HappyHorse 首帧图生视频，输出比例跟随首帧',
    durationOptions: HAPPYHORSE_DURATION_OPTIONS,
    defaultDuration: '5',
    sizeOptions: HAPPYHORSE_SIZE_OPTIONS,
    defaultSize: '1080P',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['首帧'],
      required: true,
    },
  },
  'happyhorse-1.0-r2v': {
    id: 'happyhorse-1.0-r2v',
    label: 'HappyHorse 1.0 R2V',
    provider: 'happyhorse',
    description: 'HappyHorse 多参考图生视频，支持 1-9 张参考图和比例控制',
    durationOptions: HAPPYHORSE_DURATION_OPTIONS,
    defaultDuration: '5',
    sizeOptions: HAPPYHORSE_SIZE_OPTIONS,
    defaultSize: '1080P',
    imageUpload: {
      maxCount: 9,
      mode: 'reference',
      required: true,
      labels: [
        '参考图1',
        '参考图2',
        '参考图3',
        '参考图4',
        '参考图5',
        '参考图6',
        '参考图7',
        '参考图8',
        '参考图9',
      ],
    },
  },
  'happyhorse-1.0-video-edit': {
    id: 'happyhorse-1.0-video-edit',
    label: 'HappyHorse 1.0 Video Edit',
    provider: 'happyhorse',
    description:
      'HappyHorse 视频参考生成视频，时长跟随输入视频，支持保留原音频',
    durationOptions: [{ label: '跟随原视频', value: '5' }],
    defaultDuration: '5',
    sizeOptions: HAPPYHORSE_SIZE_OPTIONS,
    defaultSize: '1080P',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
  'veo3-fast': {
    id: 'veo3-fast',
    label: 'Veo 3 Fast',
    provider: 'veo',
    description: '8秒快速视频生成',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
  'veo3-pro-frames': {
    id: 'veo3-pro-frames',
    label: 'Veo 3 Pro Frames',
    provider: 'veo',
    description: '8秒高质量视频，支持帧控制',
    durationOptions: [{ label: '8秒', value: '8' }],
    defaultDuration: '8',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 2,
      mode: 'frames',
      labels: ['首帧', '尾帧'],
    },
  },
  'kling-video-o1': {
    id: 'kling-video-o1',
    label: 'Kling Video O1',
    provider: 'kling',
    description: 'Kling Video O1 智能视频生成',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
      { label: '方形 1:1', value: '1024x1024', aspectRatio: '1:1' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
  'kling-video-o1-edit': {
    id: 'kling-video-o1-edit',
    label: 'Kling Video O1 Edit',
    provider: 'kling',
    description: 'Kling Video O1 视频编辑',
    durationOptions: [
      { label: '5秒', value: '5' },
      { label: '10秒', value: '10' },
    ],
    defaultDuration: '5',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
      { label: '方形 1:1', value: '1024x1024', aspectRatio: '1:1' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
  },
};

/**
 * Normalize model name to a known config key; fallback to默认模型（veo3）避免崩溃。
 */
export function normalizeVideoModel(model?: string | null): VideoModel {
  if (model) {
    return model;
  }
  return 'seedance-1.5-pro';
}

function isStandardKlingVideoModel(modelId: string): boolean {
  const lowerId = modelId.toLowerCase();
  return lowerId === 'kling_video' || /^kling-v\d(?:[-.]\d+)?$/.test(lowerId);
}

function getPhysicalSeedanceFamily(
  modelId: string
): keyof typeof VIDEO_MODEL_CONFIGS | undefined {
  const match = modelId.match(
    /^doubao-seedance-(1-5-pro|1-0-pro(?:-fast)?|1-0-lite)_(?:480p|720p|1080p)$/i
  );
  if (!match) return undefined;
  const family = match[1].toLowerCase();
  if (family === '1-5-pro') return 'seedance-1.5-pro';
  if (family === '1-0-pro-fast') return 'seedance-1.0-pro-fast';
  if (family === '1-0-lite') return 'seedance-1.0-lite';
  return 'seedance-1.0-pro';
}

function buildStandardKlingVideoConfig(
  modelId: string,
  runtimeConfig?: ReturnType<typeof getModelConfig>
): VideoModelConfig {
  const capabilityConfig = VIDEO_MODEL_CONFIGS.kling_video;
  const isCapabilityModel = modelId.toLowerCase() === 'kling_video';

  return {
    ...capabilityConfig,
    id: modelId,
    label:
      runtimeConfig?.shortLabel ||
      runtimeConfig?.label ||
      capabilityConfig.label,
    description: isCapabilityModel
      ? runtimeConfig?.description || capabilityConfig.description
      : runtimeConfig?.description ||
        'Kling 标准视频版本，支持文生视频和图生视频',
  };
}

function getConfigOrDefault(model?: string | null): VideoModelConfig {
  const normalized = normalizeVideoModel(model);
  const builtInConfig = VIDEO_MODEL_CONFIGS[normalized];
  if (builtInConfig) {
    return builtInConfig;
  }

  const runtimeConfig = getModelConfig(normalized);
  const physicalSeedanceFamily = getPhysicalSeedanceFamily(normalized);
  if (physicalSeedanceFamily) {
    const familyConfig = VIDEO_MODEL_CONFIGS[physicalSeedanceFamily];
    return {
      ...familyConfig,
      id: normalized,
      label:
        runtimeConfig?.shortLabel || runtimeConfig?.label || familyConfig.label,
      description: runtimeConfig?.description || familyConfig.description,
    };
  }
  if (isStandardKlingVideoModel(normalized)) {
    return buildStandardKlingVideoConfig(normalized, runtimeConfig);
  }

  const defaultSize = runtimeConfig?.videoDefaults?.size || '1280x720';
  const defaultAspectRatio =
    runtimeConfig?.videoDefaults?.aspectRatio || '16:9';
  const defaultDuration = runtimeConfig?.videoDefaults?.duration || '8';
  const lowerId = normalized.toLowerCase();

  const sizeOptions: SizeOption[] = [
    {
      label: defaultAspectRatio,
      value: defaultSize,
      aspectRatio: defaultAspectRatio,
    },
  ];

  if (defaultSize !== '1280x720') {
    sizeOptions.push({
      label: '横屏 16:9',
      value: '1280x720',
      aspectRatio: '16:9',
    });
  }
  if (defaultSize !== '720x1280') {
    sizeOptions.push({
      label: '竖屏 9:16',
      value: '720x1280',
      aspectRatio: '9:16',
    });
  }

  const durationOptions: DurationOption[] = [
    { label: `${defaultDuration}秒`, value: defaultDuration },
  ];
  const imageUpload: ImageUploadConfig = lowerId.includes('components')
    ? {
        maxCount: 3,
        mode: 'components',
        labels: ['参考图1', '参考图2', '参考图3'],
      }
    : lowerId.includes('frame')
    ? { maxCount: 2, mode: 'frames', labels: ['首帧', '尾帧'] }
    : { maxCount: 1, mode: 'reference', labels: ['参考图'] };

  const provider =
    runtimeConfig?.vendor === ModelVendor.SORA
      ? 'sora'
      : runtimeConfig?.vendor === ModelVendor.KLING
      ? 'kling'
      : lowerId.includes('seedance')
      ? 'seedance'
      : lowerId.includes('happyhorse')
      ? 'happyhorse'
      : 'veo';

  return {
    id: normalized,
    label: runtimeConfig?.shortLabel || runtimeConfig?.label || normalized,
    provider,
    description: runtimeConfig?.description || '运行时发现的视频模型',
    durationOptions,
    defaultDuration,
    sizeOptions,
    defaultSize,
    imageUpload,
  };
}

/**
 * Get model configuration by model ID
 */
export function getVideoModelConfig(model: VideoModel): VideoModelConfig {
  return getConfigOrDefault(model);
}

/**
 * Get all video model options for select component
 */
export function getVideoModelOptions(): { label: string; value: VideoModel }[] {
  return Object.values(VIDEO_MODEL_CONFIGS).map((config) => ({
    label: config.label,
    value: config.id,
  }));
}

/**
 * Get default parameters for a model
 */
export function getDefaultModelParams(model: VideoModel): {
  duration: string;
  size: string;
} {
  const config = getConfigOrDefault(model);
  return {
    duration: config.defaultDuration,
    size: config.defaultSize,
  };
}

function normalizeVideoAspectRatio(
  aspectRatio?: string | null
): string | undefined {
  const normalized = aspectRatio?.trim().replace(/[xX]/g, ':');
  return normalized && /^\d+:\d+$/.test(normalized) ? normalized : undefined;
}

/**
 * 获取模型下可安全使用的视频尺寸。
 * 若传入尺寸为空或不受当前模型支持，则回退到模型默认尺寸。
 */
export function getValidVideoSize(
  model: VideoModel,
  size?: string | null,
  aspectRatio?: string | null
): string {
  const config = getConfigOrDefault(model);
  if (size && config.sizeOptions.some((option) => option.value === size)) {
    return size;
  }
  const normalizedAspectRatio = normalizeVideoAspectRatio(aspectRatio);
  const legacyResolution = size && /^\d+p$/.test(size) ? size : undefined;

  if (legacyResolution) {
    const resolutionMatch = config.sizeOptions.find(
      (option) =>
        option.value.startsWith(`${legacyResolution}@`) &&
        (!normalizedAspectRatio || option.aspectRatio === normalizedAspectRatio)
    );
    if (resolutionMatch) {
      return resolutionMatch.value;
    }
  }

  if (normalizedAspectRatio) {
    const aspectRatioMatch = config.sizeOptions.find(
      (option) => option.aspectRatio === normalizedAspectRatio
    );
    if (aspectRatioMatch) {
      return aspectRatioMatch.value;
    }
  }

  return config.defaultSize;
}

/**
 * Check if model supports multiple image uploads
 */
export function supportsMultipleImages(model: VideoModel): boolean {
  const config = getConfigOrDefault(model);
  return config.imageUpload.maxCount > 1;
}

/**
 * Get image upload labels for a model
 */
export function getImageUploadLabels(model: VideoModel): string[] {
  const config = getConfigOrDefault(model);
  return config.imageUpload.labels || ['参考图'];
}

/**
 * Check if model supports storyboard mode
 */
export function supportsStoryboardMode(model: VideoModel): boolean {
  const config = getConfigOrDefault(model);
  return config.storyboardMode?.supported ?? false;
}

/**
 * Get storyboard mode configuration for a model
 */
export function getStoryboardModeConfig(model: VideoModel) {
  const config = getConfigOrDefault(model);
  return (
    config.storyboardMode ?? {
      supported: false,
      maxScenes: 15,
      minSceneDuration: 0.1,
    }
  );
}
