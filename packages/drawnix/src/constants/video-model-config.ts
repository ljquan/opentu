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
  // Sora models
  'sora-2': {
    id: 'sora-2',
    label: 'Sora 2',
    provider: 'sora',
    description: '10s/15s 默认标清，支持故事场景模式',
    durationOptions: [
      { label: '10秒', value: '10' },
      { label: '15秒', value: '15' },
    ],
    defaultDuration: '10',
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
    storyboardMode: {
      supported: true,
      maxScenes: 15,
      minSceneDuration: 0.1,
    },
  },
  'sora-2-pro': {
    id: 'sora-2-pro',
    label: 'Sora 2 Pro',
    provider: 'sora',
    description: '10s/15s/25s 高清，支持故事场景模式',
    durationOptions: [
      { label: '10秒', value: '10' },
      { label: '15秒', value: '15' },
      { label: '25秒', value: '25' },
    ],
    defaultDuration: '10',
    sizeOptions: [
      { label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' },
      { label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' },
      { label: '高清横屏', value: '1792x1024', aspectRatio: '16:9' },
      { label: '高清竖屏', value: '1024x1792', aspectRatio: '9:16' },
    ],
    defaultSize: '1280x720',
    imageUpload: {
      maxCount: 1,
      mode: 'reference',
      labels: ['参考图'],
    },
    storyboardMode: {
      supported: true,
      maxScenes: 15,
      minSceneDuration: 0.1,
    },
  },
  'sora-2-4s': {
    id: 'sora-2-4s',
    label: 'Sora 2 · 4s',
    provider: 'sora',
    description: '4秒固定时长，模型名已包含时长，无需 seconds 参数',
    durationOptions: [{ label: '4秒（固定）', value: '4' }],
    defaultDuration: '4',
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
  'sora-2-8s': {
    id: 'sora-2-8s',
    label: 'Sora 2 · 8s',
    provider: 'sora',
    description: '8秒固定时长，模型名已包含时长，无需 seconds 参数',
    durationOptions: [{ label: '8秒（固定）', value: '8' }],
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
  'sora-2-12s': {
    id: 'sora-2-12s',
    label: 'Sora 2 · 12s',
    provider: 'sora',
    description: '12秒固定时长，模型名已包含时长，无需 seconds 参数',
    durationOptions: [{ label: '12秒（固定）', value: '12' }],
    defaultDuration: '12',
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
    sizeOptions: [
      { label: '1080p', value: '1080p', aspectRatio: '16:9' },
      { label: '720p', value: '720p', aspectRatio: '16:9' },
      { label: '480p', value: '480p', aspectRatio: '16:9' },
    ],
    defaultSize: '720p',
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
    sizeOptions: [
      { label: '1080p', value: '1080p', aspectRatio: '16:9' },
      { label: '720p', value: '720p', aspectRatio: '16:9' },
      { label: '480p', value: '480p', aspectRatio: '16:9' },
    ],
    defaultSize: '720p',
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
    sizeOptions: [
      { label: '1080p', value: '1080p', aspectRatio: '16:9' },
      { label: '720p', value: '720p', aspectRatio: '16:9' },
      { label: '480p', value: '480p', aspectRatio: '16:9' },
    ],
    defaultSize: '720p',
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
    sizeOptions: [
      { label: '1080p', value: '1080p', aspectRatio: '16:9' },
      { label: '720p', value: '720p', aspectRatio: '16:9' },
      { label: '480p', value: '480p', aspectRatio: '16:9' },
    ],
    defaultSize: '720p',
    imageUpload: {
      maxCount: 4,
      mode: 'reference',
      labels: ['首帧', '尾帧', '参考图1', '参考图2'],
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
  return 'veo3';
}

function isStandardKlingVideoModel(modelId: string): boolean {
  const lowerId = modelId.toLowerCase();
  return lowerId === 'kling_video' || /^kling-v\d(?:[-.]\d+)?$/.test(lowerId);
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
    label: runtimeConfig?.shortLabel || runtimeConfig?.label || capabilityConfig.label,
    description: isCapabilityModel
      ? runtimeConfig?.description || capabilityConfig.description
      : runtimeConfig?.description || 'Kling 标准视频版本，支持文生视频和图生视频',
  };
}

function getConfigOrDefault(model?: string | null): VideoModelConfig {
  const normalized = normalizeVideoModel(model);
  const builtInConfig = VIDEO_MODEL_CONFIGS[normalized];
  if (builtInConfig) {
    return builtInConfig;
  }

  const runtimeConfig = getModelConfig(normalized);
  if (isStandardKlingVideoModel(normalized)) {
    return buildStandardKlingVideoConfig(normalized, runtimeConfig);
  }

  const defaultSize = runtimeConfig?.videoDefaults?.size || '1280x720';
  const defaultAspectRatio = runtimeConfig?.videoDefaults?.aspectRatio || '16:9';
  const defaultDuration = runtimeConfig?.videoDefaults?.duration || '8';
  const lowerId = normalized.toLowerCase();

  const sizeOptions: SizeOption[] = [
    { label: defaultAspectRatio, value: defaultSize, aspectRatio: defaultAspectRatio },
  ];

  if (defaultSize !== '1280x720') {
    sizeOptions.push({ label: '横屏 16:9', value: '1280x720', aspectRatio: '16:9' });
  }
  if (defaultSize !== '720x1280') {
    sizeOptions.push({ label: '竖屏 9:16', value: '720x1280', aspectRatio: '9:16' });
  }

  const durationOptions: DurationOption[] = [{ label: `${defaultDuration}秒`, value: defaultDuration }];
  const imageUpload: ImageUploadConfig =
    lowerId.includes('components')
      ? { maxCount: 3, mode: 'components', labels: ['参考图1', '参考图2', '参考图3'] }
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
  return config.storyboardMode ?? {
    supported: false,
    maxScenes: 15,
    minSceneDuration: 0.1,
  };
}
