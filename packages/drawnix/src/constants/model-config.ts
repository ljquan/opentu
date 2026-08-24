/**
 * 统一的模型配置文件
 *
 * 所有图片、视频和文本模型的配置都在这里定义
 * 被 ModelSelector、settings-dialog、ai-image-generation、ai-video-generation 等组件使用
 *
 * 参数配置用于 SmartSuggestionPanel 的 - 参数提示功能
 */

import {
  isSeedance25ModelId,
  SEEDANCE_25_MODEL_ID,
} from '../utils/seedance-model';

/**
 * 模型类型
 */
export type ModelType = 'image' | 'video' | 'text' | 'audio';

/**
 * 模型厂商
 */
export enum ModelVendor {
  GEMINI = 'GEMINI',
  FLUX = 'FLUX',
  MIDJOURNEY = 'MIDJOURNEY',
  SUNO = 'SUNO',
  GPT = 'GPT',
  GROK = 'GROK',
  QWEN = 'QWEN',
  GLM = 'GLM',
  MINIMAX = 'MINIMAX',
  MISTRAL = 'MISTRAL',
  LLAMA = 'LLAMA',
  VEO = 'VEO',
  SORA = 'SORA',
  RUNWAY = 'RUNWAY',
  PIKA = 'PIKA',
  KLING = 'KLING',
  HUNYUAN = 'HUNYUAN',
  STEPFUN = 'STEPFUN',
  DEEPSEEK = 'DEEPSEEK',
  ANTHROPIC = 'ANTHROPIC',
  GOOGLE = 'GOOGLE',
  DOUBAO = 'DOUBAO',
  HAPPYHORSE = 'HAPPYHORSE',
  OTHER = 'OTHER',
}

/**
 * 厂商显示名称
 */
export const VENDOR_NAMES: Record<ModelVendor, string> = {
  [ModelVendor.GEMINI]: 'Gemini',
  [ModelVendor.FLUX]: 'Flux',
  [ModelVendor.MIDJOURNEY]: 'Midjourney',
  [ModelVendor.SUNO]: 'Suno',
  [ModelVendor.GPT]: 'GPT',
  [ModelVendor.GROK]: 'Grok',
  [ModelVendor.QWEN]: 'Qwen',
  [ModelVendor.GLM]: 'GLM',
  [ModelVendor.MINIMAX]: 'MiniMax',
  [ModelVendor.MISTRAL]: 'Mistral',
  [ModelVendor.LLAMA]: 'Llama',
  [ModelVendor.VEO]: 'Veo',
  [ModelVendor.SORA]: 'Sora',
  [ModelVendor.RUNWAY]: 'Runway',
  [ModelVendor.PIKA]: 'Pika',
  [ModelVendor.KLING]: 'Kling',
  [ModelVendor.HUNYUAN]: 'Hunyuan',
  [ModelVendor.STEPFUN]: 'StepFun',
  [ModelVendor.DEEPSEEK]: 'DeepSeek',
  [ModelVendor.ANTHROPIC]: 'Anthropic',
  [ModelVendor.GOOGLE]: 'Google',
  [ModelVendor.DOUBAO]: '即梦',
  [ModelVendor.HAPPYHORSE]: 'HappyHorse',
  [ModelVendor.OTHER]: '其它',
};

/**
 * 参数值类型
 */
export type ParamValueType = 'enum' | 'number' | 'string';

/**
 * 参数配置接口
 */
export interface ParamConfig {
  /** 参数 ID（用于输入，如 -duration） */
  id: string;
  /** 显示标签 */
  label: string;
  /** 简短标签 */
  shortLabel?: string;
  /** 描述信息 */
  description?: string;
  /** 参数值类型 */
  valueType: ParamValueType;
  /** 可选值列表（enum 类型时使用） */
  options?: Array<{ value: string; label: string }>;
  /** 默认值 */
  defaultValue?: string;
  /** 数值最小值（number 类型时使用） */
  min?: number;
  /** 数值最大值（number 类型时使用） */
  max?: number;
  /** 数值步进（number 类型时使用） */
  step?: number;
  /** 是否要求整数（number 类型时使用） */
  integer?: boolean;
  /** 兼容的模型 ID 列表（未设置 compatibleTags 时，空数组表示所有模型都兼容） */
  compatibleModels: string[];
  /** 兼容的模型标签列表（任一命中则视为兼容，用于减少硬编码模型 ID） */
  compatibleTags?: string[];
  /** 适用的模型类型 */
  modelType: ModelType;
}

export const SORA_MODE_PARAM_ID = 'sora_mode';

/**
 * 图片模型默认参数
 */
export interface ImageModelDefaults {
  /** 默认宽高比 */
  aspectRatio: string;
  /** 默认宽度 */
  width: number;
  /** 默认高度 */
  height: number;
}

/**
 * 视频模型默认参数
 */
export interface VideoModelDefaults {
  /** 默认时长（秒） */
  duration: string;
  /** 默认尺寸 */
  size: string;
  /** 默认宽高比 */
  aspectRatio: string;
}

/**
 * 模型配置接口
 */
export interface ModelConfig {
  /** 模型 ID（用于 API 调用） */
  id: string;
  /** 完整显示名称（用于设置弹窗等） */
  label: string;
  /** 简短显示名称（用于 ModelSelector 等） */
  shortLabel?: string;
  /** 超短缩写（用于 @ 模型选择器显示，如 nbpv） */
  shortCode?: string;
  /** 描述信息 */
  description?: string;
  /** 模型类型 */
  type: ModelType;
  /** 模型厂商 */
  vendor: ModelVendor;
  /** 是否为 VIP/推荐模型 */
  isVip?: boolean;
  /** 是否支持工具调用（用于 Agent 模式） */
  supportsTools?: boolean;
  /** 图片模型默认参数 */
  imageDefaults?: ImageModelDefaults;
  /** 视频模型默认参数 */
  videoDefaults?: VideoModelDefaults;
  /** 模型标签（用于参数兼容匹配的非硬编码方式） */
  tags?: string[];
  /** 内置模型的人工推荐分，用于展示排序 */
  recommendedScore?: number;
  /** 运行时来源供应商 ID（仅动态模型选择场景使用） */
  sourceProfileId?: string | null;
  /** 运行时来源供应商名称（仅动态模型选择场景使用） */
  sourceProfileName?: string | null;
  /** 选择器中用于区分同名模型来源的唯一键 */
  selectionKey?: string;
}

const BUILT_IN_MODEL_RECOMMENDATION_SCORES: Readonly<Record<string, number>> = {
  'gpt-5.6-sol': 109,
  'gpt-5.6-terra': 108,
  'gpt-5.6-luna': 107,
  'deepseek-v4-pro': 106,
  'deepseek-v4-flash': 105,
  'deepseek-v4-flash-0731': 104,
  'gpt-5.5': 99,
  'claude-opus-4-6': 98,
  'gpt-5.4': 97,
  'gpt-5-pro': 96,
  'grok-4': 95,
  'deepseek-v3.2': 94,
  'deepseek-v3': 93,
  'grok-4.2': 92,
  'doubao-seed-1-6-thinking-250715': 91,
  'gpt-5.2': 90,
  'gpt-5.1': 89,
  'gpt-5-chat-latest': 88,
  'gemini-2.5-pro-all': 87,
  'claude-sonnet-4-5-20250929-thinking': 86,
  'gemini-3.1-pro-preview-thinking': 85,
  'claude-opus-4-5-20251101': 84,
  'gpt-5.4-mini': 83,
  'gemini-3.1-pro-preview': 82,
  'gemini-3-pro-preview-thinking': 81,
  'deepseek-v3.2-thinking': 80,
  'gemini-3-pro-preview': 79,
  'claude-sonnet-4-5-20250929': 78,
  'deepseek-r1': 77,
  'claude-sonnet-4-6': 76,

  'gemini-3-pro-image-preview-async': 98,
  'gemini-3-pro-image-preview-2k-async': 97,
  'gemini-2.5-flash-image-vip': 96,
  'gpt-image-2-vip': 96,
  'gpt-image-2': 95,
  'gemini-2.5-flash-image': 95,
  'doubao-seedream-4-0-250828': 94,
  'gemini-3.1-flash-image-preview': 93,
  'gemini-3-pro-image-preview': 92,
  'gemini-3-pro-image-preview-vip': 90,
  'gemini-3-pro-image-preview-2k-vip': 89,
  'gpt-4o-image': -999,
  'qwen-image-2.0': 86,
  'gemini-3-pro-image-preview-2k': 85,
  'gemini-3-pro-image-preview-4k-vip': 84,
  'gemini-3.1-flash-image-preview-4k': 83,
  'gemini-3.1-flash-image-preview-2k': 82,
  'gemini-3-pro-image-preview-4k-async': 45,
  'doubao-seedream-4-5-251128': 44,
  'seedream-v4': 43,
  kling_image: 42,
  'gemini-3-pro-image-preview-4k': 41,

  kling_video: 98,
  [SEEDANCE_25_MODEL_ID]: 102,
  'doubao-seedance-2-0-260128': 101,
  'doubao-seedance-2-0-fast-260128': 100,
  'doubao-seedance-2-0-mini-260615': 99,
  'seedance-1.5-pro': 97,
  'seedance-1.0-pro': 96,
  'seedance-1.0-pro-fast': 95,
  'seedance-1.0-lite': 94,
  'happyhorse-1.0-i2v': 89,
  'happyhorse-1.0-r2v': 88,
  'happyhorse-1.0-t2v': 87,
  'happyhorse-1.0-video-edit': 86,
  'veo3.1': 93,
  'omni-flash': 93,
  'omni-flash-components': 48,
  'veo3-fast-frames': 92,
  'veo3-pro': 91,
  veo3: 84,
  'veo3-fast': 83,
  'veo3.1-4k': 82,
  'sora-2': 60,
  'sora-2-pro': 59,
  'sora-2-4s': 58,
  'sora-2-8s': 57,
  'sora-2-12s': 56,
  'sora-2-15s': 55,
  'kling-video-o1': 54,
  'kling-video-o1-edit': 53,
  'veo3-pro-frames': 52,
  'veo3-frames': 51,
  'veo3.1-pro': 50,
  'veo3.1-pro-4k': 49,
  'veo3.1-components': 48,
  'veo3.1-components-4k': 47,
};

function applyBuiltInRecommendedScores(models: ModelConfig[]): ModelConfig[] {
  return models.map((model) => {
    const recommendedScore = BUILT_IN_MODEL_RECOMMENDATION_SCORES[model.id];
    if (recommendedScore === undefined) {
      return model;
    }
    return {
      ...model,
      recommendedScore,
    };
  });
}

// ============================================
// 模型颜色配置
// ============================================

/**
 * 模型类型对应的颜色
 */
export const MODEL_TYPE_COLORS = {
  image: '#E53935', // 红色
  video: '#FF9800', // 橙色
  text: '#4CAF50', // 绿色
  audio: '#1E88E5', // 蓝色
} as const;

// ============================================
// 图片模型配置
// ============================================

/** 图片模型通用默认参数 */
const IMAGE_DEFAULT_PARAMS: ImageModelDefaults = {
  aspectRatio: 'auto',
  width: 1024,
  height: 1024,
};

/** 2K 图片模型默认参数 */
const IMAGE_2K_DEFAULT_PARAMS: ImageModelDefaults = {
  aspectRatio: 'auto',
  width: 2048,
  height: 2048,
};

/** 4K 图片模型默认参数 */
const IMAGE_4K_DEFAULT_PARAMS: ImageModelDefaults = {
  aspectRatio: 'auto',
  width: 4096,
  height: 4096,
};

/**
 * VIP/推荐图片模型
 */
export const IMAGE_MODEL_VIP_OPTIONS: ModelConfig[] = [
  {
    id: 'gemini-3-pro-image-preview-vip',
    label: 'gemini-3-pro-image-preview-vip (nano-banana-pro-vip)',
    shortLabel: 'nano-banana-pro-vip',
    shortCode: 'nbpv',
    description: '最新 Gemini 3 Pro 图片模型（VIP）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    isVip: true,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-2k-vip',
    label: 'gemini-3-pro-image-preview-2k-vip (nano-banana-pro-2k-vip)',
    shortLabel: 'nano-banana-pro-2k-vip',
    shortCode: 'nbp2kv',
    description: '2K 高清图片模型（VIP）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    isVip: true,
    supportsTools: true,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-4k-vip',
    label: 'gemini-3-pro-image-preview-4k-vip (nano-banana-pro-4k-vip)',
    shortLabel: 'nano-banana-pro-4k-vip',
    shortCode: 'nbp4kv',
    description: '4K 超高清图片模型（VIP）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    isVip: true,
    supportsTools: true,
    imageDefaults: IMAGE_4K_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-2.5-flash-image-vip',
    label: 'gemini-2.5-flash-image-vip (nano-banana-vip)',
    shortLabel: 'nano-banana-vip',
    shortCode: 'nbv',
    description: '快速图片生成模型（VIP）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    isVip: true,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
];

/**
 * 更多图片模型
 */
export const IMAGE_MODEL_MORE_OPTIONS: ModelConfig[] = [
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'gemini-3.1-flash-image-preview (nano-banana-2)',
    shortLabel: 'nano-banana-2',
    shortCode: 'nb2',
    description: 'Gemini 3.1 Flash 图片模型',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'gemini-3.1-flash-image-preview-2k',
    label: 'gemini-3.1-flash-image-preview-2k (nano-banana-2-2k)',
    shortLabel: 'nano-banana-2-2k',
    shortCode: 'nb22k',
    description: 'Gemini 3.1 Flash 图片模型（2K）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'gemini-3.1-flash-image-preview-4k',
    label: 'gemini-3.1-flash-image-preview-4k (nano-banana-2-4k)',
    shortLabel: 'nano-banana-2-4k',
    shortCode: 'nb24k',
    description: 'Gemini 3.1 Flash 图片模型（4K）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_4K_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'mj-imagine',
    label: 'midjourney imagine',
    shortLabel: 'midjourney',
    shortCode: 'mj',
    description: 'Midjourney 异步图片生成模型（# 参数）',
    type: 'image',
    vendor: ModelVendor.MIDJOURNEY,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'gpt-image-2-vip',
    label: 'gpt-image-2-vip',
    shortCode: 'gpt2v',
    description: 'OpenAI GPT Image 2 VIP 图片生成模型',
    type: 'image',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'gpt-image-2',
    label: 'gpt-image-2',
    shortCode: 'gpt2',
    description: 'OpenAI GPT Image 2 图片生成模型',
    type: 'image',
    vendor: ModelVendor.GPT,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'bfl-flux-2-pro',
    label: 'Flux 2 Pro',
    shortLabel: 'flux-2-pro',
    shortCode: 'f2p',
    description: 'Flux 2 Pro 高质量图片生成',
    type: 'image',
    vendor: ModelVendor.FLUX,
    supportsTools: false,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'bfl-flux-2-max',
    label: 'Flux 2 Max',
    shortLabel: 'flux-2-max',
    shortCode: 'f2m',
    description: 'Flux 2 Max 最高质量图片生成',
    type: 'image',
    vendor: ModelVendor.FLUX,
    supportsTools: false,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'bfl-flux-2-flex',
    label: 'Flux 2 Flex',
    shortLabel: 'flux-2-flex',
    shortCode: 'f2f',
    description: 'Flux 2 Flex 灵活图片生成',
    type: 'image',
    vendor: ModelVendor.FLUX,
    supportsTools: false,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'gemini-3-pro-image-preview (nano-banana-pro)',
    shortLabel: 'nano-banana-pro',
    shortCode: 'nbp',
    description: 'Gemini 3 Pro 图片模型',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-2.5-flash-image',
    label: 'gemini-2.5-flash-image (nano-banana)',
    shortLabel: 'nano-banana',
    shortCode: 'nb',
    description: '快速图片生成模型',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-hd',
    label: 'gemini-3-pro-image-preview-hd (nano-banana-pro-hd)',
    shortLabel: 'nano-banana-pro-hd',
    shortCode: 'nbphd',
    description: 'HD 高清图片模型',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-2k',
    label: 'gemini-3-pro-image-preview-2k (nano-banana-pro-2k)',
    shortLabel: 'nano-banana-pro-2k',
    shortCode: 'nbp2k',
    description: '2K 高清图片模型',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-4k',
    label: 'gemini-3-pro-image-preview-4k (nano-banana-pro-4k)',
    shortLabel: 'nano-banana-pro-4k',
    shortCode: 'nbp4k',
    description: '4K 超高清图片模型',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    imageDefaults: IMAGE_4K_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-async',
    label: 'gemini-3-pro-image-preview-async (1k 异步)',
    shortLabel: 'nbp-async',
    shortCode: 'nbpa',
    description: '异步 1K 图片生成（轮询获取结果）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: false,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-2k-async',
    label: 'gemini-3-pro-image-preview-2k-async (2k 异步)',
    shortLabel: 'nbp2k-async',
    shortCode: 'nbp2ka',
    description: '异步 2K 图片生成（轮询获取结果）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: false,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
  },
  {
    id: 'gemini-3-pro-image-preview-4k-async',
    label: 'gemini-3-pro-image-preview-4k-async (4k 异步)',
    shortLabel: 'nbp4k-async',
    shortCode: 'nbp4ka',
    description: '异步 4K 图片生成（轮询获取结果）',
    type: 'image',
    vendor: ModelVendor.GEMINI,
    supportsTools: false,
    imageDefaults: IMAGE_4K_DEFAULT_PARAMS,
  },
  {
    id: 'doubao-seedream-4-0-250828',
    label: 'Seedream 4.0',
    shortLabel: 'Seedream 4.0',
    shortCode: 'sd4',
    description: '即梦 Seedream 4.0 图片生成，支持 2K/4K',
    type: 'image',
    vendor: ModelVendor.DOUBAO,
    supportsTools: false,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
    tags: ['seedream'],
  },
  {
    id: 'doubao-seedream-4-5-251128',
    label: 'Seedream 4.5',
    shortLabel: 'Seedream 4.5',
    shortCode: 'sd45',
    description: '即梦 Seedream 4.5 图片生成，支持 2K/4K',
    type: 'image',
    vendor: ModelVendor.DOUBAO,
    supportsTools: false,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
    tags: ['seedream'],
  },
  {
    id: 'doubao-seedream-5-0-260128',
    label: 'Seedream 5.0 lite',
    shortLabel: 'Seedream 5.0 lite',
    shortCode: 'sd5',
    description: '即梦 Seedream 5.0 lite 图片生成，支持 2K/3K',
    type: 'image',
    vendor: ModelVendor.DOUBAO,
    supportsTools: false,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
    tags: ['seedream'],
  },
  {
    id: 'seedream-v4',
    label: 'Seedream V4',
    shortLabel: 'Seedream V4',
    shortCode: 'sdv4',
    description: '即梦 Seedream V4 图片生成',
    type: 'image',
    vendor: ModelVendor.DOUBAO,
    supportsTools: false,
    imageDefaults: IMAGE_2K_DEFAULT_PARAMS,
    tags: ['seedream', 'new'],
  },
  {
    id: 'gpt-4o-image',
    label: 'GPT-4o Image',
    shortCode: 'g4oi',
    description: 'OpenAI 多模态图片模型',
    type: 'image',
    vendor: ModelVendor.GPT,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'qwen-image-2.0',
    label: 'Qwen Image 2.0',
    shortCode: 'qwi2',
    description: '通义千问图片生成模型',
    type: 'image',
    vendor: ModelVendor.QWEN,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'kling_image',
    label: 'Kling Image',
    shortCode: 'kimg',
    description: 'Kling 文生图模型',
    type: 'image',
    vendor: ModelVendor.KLING,
    supportsTools: false,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
];

/** 异步图片模型 ID 列表 */
export const ASYNC_IMAGE_MODEL_IDS = [
  'gemini-3-pro-image-preview-async',
  'gemini-3-pro-image-preview-2k-async',
  'gemini-3-pro-image-preview-4k-async',
  'mj-imagine',
];

export function isAsyncImageModel(modelId?: string): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return ASYNC_IMAGE_MODEL_IDS.some((id) => lower.includes(id.toLowerCase()));
}

/**
 * 所有图片模型
 */
export const IMAGE_MODELS: ModelConfig[] = applyBuiltInRecommendedScores([
  ...IMAGE_MODEL_VIP_OPTIONS,
  ...IMAGE_MODEL_MORE_OPTIONS,
]);

// ============================================
// 视频模型配置
// ============================================

/** Veo 模型默认参数（8秒） */
const VEO_DEFAULT_PARAMS: VideoModelDefaults = {
  duration: '8',
  size: '1280x720',
  aspectRatio: '16:9',
};

/** Veo 4K 模型默认参数（8秒，4K分辨率） */
const VEO_4K_DEFAULT_PARAMS: VideoModelDefaults = {
  duration: '8',
  size: '3840x2160',
  aspectRatio: '16:9',
};

/** Sora 模型默认参数（10秒） */
const SORA_DEFAULT_PARAMS: VideoModelDefaults = {
  duration: '10',
  size: '1280x720',
  aspectRatio: '16:9',
};

/** Kling 模型默认参数（5秒） */
const KLING_DEFAULT_PARAMS: VideoModelDefaults = {
  duration: '5',
  size: '1280x720',
  aspectRatio: '16:9',
};

/** Seedance 模型默认参数（5秒，720p） */
const SEEDANCE_DEFAULT_PARAMS: VideoModelDefaults = {
  duration: '5',
  size: '720p',
  aspectRatio: '16:9',
};

const SEEDANCE_25_DEFAULT_PARAMS: VideoModelDefaults = {
  duration: '8',
  size: '720p',
  aspectRatio: '16:9',
};

/** HappyHorse 模型默认参数（5秒，1080P） */
const HAPPYHORSE_DEFAULT_PARAMS: VideoModelDefaults = {
  duration: '5',
  size: '1080P',
  aspectRatio: '16:9',
};

/**
 * 视频模型配置
 */
const BUILT_IN_VIDEO_MODELS: ModelConfig[] = [
  {
    id: 'kling_video',
    label: 'Kling',
    shortCode: 'kling',
    description: 'Kling 标准视频能力，版本通过 model_name 选择',
    type: 'video',
    vendor: ModelVendor.KLING,
    supportsTools: true,
    videoDefaults: KLING_DEFAULT_PARAMS,
  },
  {
    id: SEEDANCE_25_MODEL_ID,
    label: 'Seedance 2.5',
    shortCode: 'sc25',
    description:
      'Seedance 2.5 音视频联合生成，支持 4-30 秒与 480p/720p/1080p 输出',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    videoDefaults: SEEDANCE_25_DEFAULT_PARAMS,
    tags: ['new', 'seedance', 'seedance-2'],
  },
  {
    id: 'doubao-seedance-2-0-260128',
    label: 'Seedance 2.0',
    shortCode: 'sc20',
    description:
      'Seedance 2.0 多模态视频生成，支持 4-12 秒与 480p/720p/1080p 输出',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    isVip: true,
    videoDefaults: SEEDANCE_DEFAULT_PARAMS,
    tags: ['new', 'seedance', 'seedance-2'],
  },
  {
    id: 'doubao-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
    shortCode: 'sc20f',
    description: 'Seedance 2.0 高速视频生成，支持 4-12 秒与 480p/720p/1080p',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    videoDefaults: SEEDANCE_DEFAULT_PARAMS,
    tags: ['new', 'seedance', 'seedance-2'],
  },
  {
    id: 'doubao-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
    shortCode: 'sc20m',
    description: 'Seedance 2.0 轻量视频生成，支持 4-12 秒与 480p/720p/1080p',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    videoDefaults: SEEDANCE_DEFAULT_PARAMS,
    tags: ['new', 'seedance', 'seedance-2'],
  },
  {
    id: 'seedance-1.5-pro',
    label: 'Seedance 1.5 Pro',
    shortCode: 'sc15p',
    description: '即梦 1.5 Pro 有声视频，支持首尾帧',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    isVip: true,
    videoDefaults: SEEDANCE_DEFAULT_PARAMS,
  },
  {
    id: 'seedance-1.0-pro',
    label: 'Seedance 1.0 Pro',
    shortCode: 'sc10p',
    description: '即梦 1.0 Pro，支持首尾帧',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    videoDefaults: SEEDANCE_DEFAULT_PARAMS,
  },
  {
    id: 'seedance-1.0-pro-fast',
    label: 'Seedance 1.0 Fast',
    shortCode: 'sc10f',
    description: '即梦 1.0 快速模式，仅首帧',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    videoDefaults: SEEDANCE_DEFAULT_PARAMS,
  },
  {
    id: 'seedance-1.0-lite',
    label: 'Seedance 1.0 Lite',
    shortCode: 'sc10l',
    description: '即梦 1.0 Lite，支持首尾帧和参考图',
    type: 'video',
    vendor: ModelVendor.DOUBAO,
    videoDefaults: SEEDANCE_DEFAULT_PARAMS,
  },
  {
    id: 'happyhorse-1.0-i2v',
    label: 'HappyHorse 1.0 I2V',
    shortCode: 'h10i',
    description: 'HappyHorse 首帧图生视频，输出比例跟随首帧',
    type: 'video',
    vendor: ModelVendor.HAPPYHORSE,
    supportsTools: true,
    videoDefaults: {
      ...HAPPYHORSE_DEFAULT_PARAMS,
      size: '1080P',
    },
    tags: ['happyhorse'],
  },
  {
    id: 'happyhorse-1.0-r2v',
    label: 'HappyHorse 1.0 R2V',
    shortCode: 'h10r',
    description: 'HappyHorse 多参考图生视频，支持 1-9 张参考图和比例控制',
    type: 'video',
    vendor: ModelVendor.HAPPYHORSE,
    supportsTools: true,
    videoDefaults: HAPPYHORSE_DEFAULT_PARAMS,
    tags: ['happyhorse'],
  },
  {
    id: 'happyhorse-1.0-t2v',
    label: 'HappyHorse 1.0 T2V',
    shortCode: 'h10t',
    description: 'HappyHorse 文生视频，支持分辨率、比例和 3-15 秒时长控制',
    type: 'video',
    vendor: ModelVendor.HAPPYHORSE,
    supportsTools: true,
    videoDefaults: HAPPYHORSE_DEFAULT_PARAMS,
    tags: ['happyhorse'],
  },
  {
    id: 'happyhorse-1.0-video-edit',
    label: 'HappyHorse 1.0 Video Edit',
    shortCode: 'h10v',
    description:
      'HappyHorse 视频参考生成视频，时长跟随输入视频，支持保留原音频',
    type: 'video',
    vendor: ModelVendor.HAPPYHORSE,
    supportsTools: true,
    videoDefaults: {
      ...HAPPYHORSE_DEFAULT_PARAMS,
      size: '1080P',
    },
    tags: ['happyhorse'],
  },
  {
    id: 'veo3.1',
    label: 'Veo 3.1',
    shortCode: 'v31',
    description: '8秒快速模式，支持首尾帧',
    type: 'video',
    vendor: ModelVendor.VEO,
    isVip: true,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'veo3',
    label: 'Veo 3',
    shortCode: 'v3',
    description: '8秒视频',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'veo3-pro',
    label: 'Veo 3 Pro',
    shortCode: 'v3p',
    description: '8秒高质量视频',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'veo3.1-pro',
    label: 'Veo 3.1 Pro',
    shortCode: 'v31p',
    description: '8秒高质量模式，支持首尾帧',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'veo3.1-components',
    label: 'Veo 3.1 Components',
    shortCode: 'v31c',
    description: '8秒模式，支持3张参考图',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'omni-flash',
    label: 'Gemini Omni Flash',
    shortCode: 'omf',
    description: '8秒快速模式，支持首尾帧',
    type: 'video',
    vendor: ModelVendor.GEMINI,
    isVip: true,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'omni-flash-components',
    label: 'Gemini Omni Flash Components',
    shortCode: 'omfc',
    description: '8秒模式，支持3张参考图',
    type: 'video',
    vendor: ModelVendor.GEMINI,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'veo3.1-4k',
    label: 'Veo 3.1 4K',
    shortCode: 'v314k',
    description: '8秒4K模式，支持首尾帧',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_4K_DEFAULT_PARAMS,
  },
  {
    id: 'veo3.1-components-4k',
    label: 'Veo 3.1 Components 4K',
    shortCode: 'v31c4k',
    description: '8秒4K模式，支持3张参考图',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_4K_DEFAULT_PARAMS,
  },
  {
    id: 'veo3.1-pro-4k',
    label: 'Veo 3.1 Pro 4K',
    shortCode: 'v31p4k',
    description: '8秒高质量4K模式，支持首尾帧',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_4K_DEFAULT_PARAMS,
  },
  {
    id: 'veo3-fast',
    label: 'Veo 3 Fast',
    shortCode: 'v3f',
    description: '8秒快速视频生成',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'veo3-frames',
    label: 'Veo 3 Frames',
    shortCode: 'v3fr',
    description: '8秒视频，支持帧控制',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'veo3-fast-frames',
    label: 'Veo 3 Fast Frames',
    shortCode: 'v3ff',
    description: '8秒快速视频，支持帧控制',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
    tags: ['new'],
  },
  {
    id: 'veo3-pro-frames',
    label: 'Veo 3 Pro Frames',
    shortCode: 'v3pf',
    description: '8秒高质量视频，支持帧控制',
    type: 'video',
    vendor: ModelVendor.VEO,
    supportsTools: true,
    videoDefaults: VEO_DEFAULT_PARAMS,
  },
  {
    id: 'kling-video-o1',
    label: 'Kling Video O1',
    shortCode: 'kvo1',
    description: 'Kling Video O1 智能视频生成',
    type: 'video',
    vendor: ModelVendor.KLING,
    supportsTools: true,
    videoDefaults: KLING_DEFAULT_PARAMS,
  },
  {
    id: 'kling-video-o1-edit',
    label: 'Kling Video O1 Edit',
    shortCode: 'kvo1e',
    description: 'Kling Video O1 视频编辑',
    type: 'video',
    vendor: ModelVendor.KLING,
    supportsTools: true,
    videoDefaults: KLING_DEFAULT_PARAMS,
  },
];

/**
 * 隐藏/非内置视频模型（不在选择器显示，但保留参数定义支持自定义接入）
 */
const HIDDEN_VIDEO_MODELS: ModelConfig[] = [
  {
    id: 'sora-2',
    label: 'Sora 2',
    shortCode: 's2',
    description: '10s/15s 默认标清，支持故事场景模式',
    type: 'video',
    vendor: ModelVendor.SORA,
    isVip: true,
    supportsTools: true,
    videoDefaults: SORA_DEFAULT_PARAMS,
  },
  {
    id: 'sora-2-4s',
    label: 'Sora 2 · 4s',
    shortCode: 's24',
    description: '4秒固定时长，模型名已包含时长',
    type: 'video',
    vendor: ModelVendor.SORA,
    isVip: true,
    supportsTools: true,
    videoDefaults: {
      duration: '4',
      size: '1280x720',
      aspectRatio: '16:9',
    },
  },
  {
    id: 'sora-2-8s',
    label: 'Sora 2 · 8s',
    shortCode: 's28',
    description: '8秒固定时长，模型名已包含时长',
    type: 'video',
    vendor: ModelVendor.SORA,
    isVip: true,
    supportsTools: true,
    videoDefaults: {
      duration: '8',
      size: '1280x720',
      aspectRatio: '16:9',
    },
  },
  {
    id: 'sora-2-12s',
    label: 'Sora 2 · 12s',
    shortCode: 's212',
    description: '12秒固定时长，模型名已包含时长',
    type: 'video',
    vendor: ModelVendor.SORA,
    isVip: true,
    supportsTools: true,
    videoDefaults: {
      duration: '12',
      size: '1280x720',
      aspectRatio: '16:9',
    },
  },
  {
    id: 'sora-2-pro',
    label: 'Sora 2 Pro',
    shortCode: 's2p',
    description: '10s/15s/25s 高清，支持故事场景模式',
    type: 'video',
    vendor: ModelVendor.SORA,
    supportsTools: true,
    videoDefaults: SORA_DEFAULT_PARAMS,
  },
  {
    id: 'sora-2-15s',
    label: 'Sora 2 · 15s',
    shortCode: 's215',
    description: '15秒固定时长，模型名已包含时长',
    type: 'video',
    vendor: ModelVendor.SORA,
    supportsTools: true,
    videoDefaults: {
      duration: '15',
      size: '1280x720',
      aspectRatio: '16:9',
    },
  },
];

export const VIDEO_MODELS: ModelConfig[] = applyBuiltInRecommendedScores([
  ...BUILT_IN_VIDEO_MODELS,
]);

// ============================================
// 文本模型配置
// ============================================

/**
 * 文本/Agent 模型配置
 */
const BUILT_IN_TEXT_MODELS: ModelConfig[] = applyBuiltInRecommendedScores([
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    shortCode: 'g56s',
    description: 'GPT-5.6 通用推理、代码与智能体路由',
    type: 'text',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    shortCode: 'g56t',
    description: 'GPT-5.6 通用推理、代码与复杂任务路由',
    type: 'text',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    shortCode: 'g56l',
    description: 'GPT-5.6 高响应文本与代码路由',
    type: 'text',
    vendor: ModelVendor.GPT,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    shortCode: 'dsv4p',
    description: 'DeepSeek V4 通用对话、代码与工具调用路由',
    type: 'text',
    vendor: ModelVendor.DEEPSEEK,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    shortCode: 'dsv4f',
    description: 'DeepSeek V4 低延迟文本与代码路由',
    type: 'text',
    vendor: ModelVendor.DEEPSEEK,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash 0731',
    shortCode: 'dsv4f7',
    description: 'DeepSeek V4 Flash 0731 高速路由',
    type: 'text',
    vendor: ModelVendor.DEEPSEEK,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'deepseek-v3.2',
    label: 'DeepSeek V3.2',
    shortCode: 'ds32',
    description: 'DeepSeek 最新大语言模型，性价比高',
    type: 'text',
    vendor: ModelVendor.DEEPSEEK,
    supportsTools: true,
  },
  {
    id: 'deepseek-v3.2-thinking',
    label: 'DeepSeek V3.2 Thinking',
    shortCode: 'ds32t',
    description: 'DeepSeek V3.2 推理增强版',
    type: 'text',
    vendor: ModelVendor.DEEPSEEK,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'deepseek-v3',
    label: 'DeepSeek V3',
    shortCode: 'ds3',
    description: 'DeepSeek 通用模型',
    type: 'text',
    vendor: ModelVendor.DEEPSEEK,
    supportsTools: true,
  },
  {
    id: 'deepseek-r1',
    label: 'DeepSeek R1',
    shortCode: 'dsr1',
    description: 'DeepSeek 推理模型',
    type: 'text',
    vendor: ModelVendor.DEEPSEEK,
    supportsTools: true,
  },
  {
    id: 'claude-opus-4-5-20251101',
    label: 'Claude Opus 4.5',
    shortCode: 'op45',
    description: 'Anthropic 旗舰模型，推理能力最强',
    type: 'text',
    vendor: ModelVendor.ANTHROPIC,
    isVip: true,
    supportsTools: true,
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    shortCode: 'op46',
    description: 'Anthropic 最新旗舰模型',
    type: 'text',
    vendor: ModelVendor.ANTHROPIC,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Claude Sonnet 4.5',
    shortCode: 'sn45',
    description: 'Anthropic 均衡模型，性能与速度兼顾',
    type: 'text',
    vendor: ModelVendor.ANTHROPIC,
    isVip: true,
    supportsTools: true,
  },
  {
    id: 'claude-sonnet-4-5-20250929-thinking',
    label: 'Claude Sonnet 4.5 Thinking',
    shortCode: 'sn45t',
    description: 'Anthropic 推理增强版',
    type: 'text',
    vendor: ModelVendor.ANTHROPIC,
    isVip: true,
    supportsTools: true,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    shortCode: 'sn46',
    description: 'Anthropic 最新均衡模型',
    type: 'text',
    vendor: ModelVendor.ANTHROPIC,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gemini-2.5-pro-all',
    label: 'Gemini 2.5 Pro All',
    shortCode: 'g25pa',
    description: 'Google 全功能专业版模型',
    type: 'text',
    vendor: ModelVendor.GOOGLE,
    supportsTools: true,
  },
  {
    id: 'gemini-3-pro-preview',
    label: 'Gemini 3 Pro Preview',
    shortCode: 'g3pp',
    description: 'Google 最新预览模型，能力强大',
    type: 'text',
    vendor: ModelVendor.GOOGLE,
    isVip: true,
    supportsTools: true,
  },
  {
    id: 'gemini-3-pro-preview-thinking',
    label: 'Gemini 3 Pro Preview Thinking',
    shortCode: 'g3ppt',
    description: 'Google 预览推理增强版',
    type: 'text',
    vendor: ModelVendor.GOOGLE,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    shortCode: 'g55',
    description: 'OpenAI 最新旗舰文本模型',
    type: 'text',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    shortCode: 'g54',
    description: 'OpenAI 最新旗舰模型',
    type: 'text',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
  },
  {
    id: 'gpt-5.1',
    label: 'GPT-5.1',
    shortCode: 'g51',
    description: 'OpenAI 旗舰模型',
    type: 'text',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    shortCode: 'g54m',
    description: 'OpenAI 轻量高性价比模型',
    type: 'text',
    vendor: ModelVendor.GPT,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5-pro',
    label: 'GPT-5 Pro',
    shortCode: 'g5p',
    description: 'OpenAI 高能力 Pro 模型',
    type: 'text',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5-chat-latest',
    label: 'GPT-5 Chat Latest',
    shortCode: 'g5cl',
    description: 'OpenAI GPT-5 最新聊天别名',
    type: 'text',
    vendor: ModelVendor.GPT,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gpt-5.2',
    label: 'GPT-5.2',
    shortCode: 'g52',
    description: 'OpenAI 新一代旗舰模型',
    type: 'text',
    vendor: ModelVendor.GPT,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'grok-4',
    label: 'Grok 4',
    shortCode: 'gk4',
    description: 'xAI 最新旗舰模型',
    type: 'text',
    vendor: ModelVendor.GROK,
    isVip: true,
    supportsTools: true,
  },
  {
    id: 'grok-4.2',
    label: 'Grok 4.2',
    shortCode: 'gk42',
    description: 'xAI 最新 Grok 模型',
    type: 'text',
    vendor: ModelVendor.GROK,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    shortCode: 'g31pp',
    description: 'Google Gemini 3.1 Pro 最新预览版',
    type: 'text',
    vendor: ModelVendor.GOOGLE,
    isVip: true,
    supportsTools: true,
  },
  {
    id: 'gemini-3.1-pro-preview-thinking',
    label: 'Gemini 3.1 Pro Preview Thinking',
    shortCode: 'g31pt',
    description: 'Google Gemini 3.1 Pro 推理增强版',
    type: 'text',
    vendor: ModelVendor.GOOGLE,
    isVip: true,
    supportsTools: true,
    tags: ['new'],
  },
  {
    id: 'doubao-seed-1-6-thinking-250715',
    label: '豆包 Seed 1.6 Thinking',
    shortCode: 'dbt',
    description: '豆包最新思考模型',
    type: 'text',
    vendor: ModelVendor.DOUBAO,
    supportsTools: true,
  },
]);

export const DEFAULT_HIDDEN_MODEL_IDS = new Set([
  'gpt-5',
  'gpt-5-all',
  'gpt-5-chat-latest',
  'gpt-5-gizmo*',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-pro',
  'gpt-5-pro-all',
  'gpt-5-pro-async',
  'gpt-5-thinking-all',
  'gpt-5.1',
  'gpt-5.1-all',
  'gpt-5.1-thinking',
  'gpt-5.1-thinking-all',
  'gpt-5.2',
  'gpt-5.2-all',
  'gpt-5.4',
  'gpt-5.4-mini',
]);

export function isDefaultModelHidden(modelId: string): boolean {
  return DEFAULT_HIDDEN_MODEL_IDS.has(modelId.toLowerCase());
}

export const TEXT_MODELS: ModelConfig[] = BUILT_IN_TEXT_MODELS.filter(
  (model) => !isDefaultModelHidden(model.id)
);

/**
 * 音频模型
 *
 * 注意：Suno 实际执行使用 submit/fetch 规则与 mv 字段，
 * 这里保留的是可供路由与默认预设选择的逻辑音频入口。
 */
export const AUDIO_MODELS: ModelConfig[] = applyBuiltInRecommendedScores([
  {
    id: 'suno_music',
    label: 'Suno Music',
    shortLabel: 'Suno 音乐',
    shortCode: 'suno',
    description: 'Suno 音乐生成入口（通过 mv 决定实际版本）',
    type: 'audio',
    vendor: ModelVendor.SUNO,
    tags: ['audio', 'music', 'suno'],
  },
]);

// ============================================
// 所有模型
// ============================================

/**
 * 图片和视频模型（用于 ModelSelector）
 */
export const IMAGE_VIDEO_MODELS: ModelConfig[] = [
  ...IMAGE_MODELS,
  ...VIDEO_MODELS,
];

/**
 * 所有支持的模型
 */
export const ALL_MODELS: ModelConfig[] = [
  ...IMAGE_MODELS,
  ...VIDEO_MODELS,
  ...TEXT_MODELS,
  ...AUDIO_MODELS,
];

let runtimeModels: ModelConfig[] = [];

function mergeModels(
  staticModels: ModelConfig[],
  discoveredModels: ModelConfig[]
): ModelConfig[] {
  const merged = [...discoveredModels];
  const seen = new Set(discoveredModels.map((model) => model.id));
  for (const model of staticModels) {
    if (!seen.has(model.id)) {
      merged.push(model);
    }
  }
  return merged;
}

export function setRuntimeModelConfigs(models: ModelConfig[]): void {
  runtimeModels = Array.isArray(models) ? [...models] : [];
}

export function clearRuntimeModelConfigs(): void {
  runtimeModels = [];
}

export function getRuntimeModelConfigs(type?: ModelType): ModelConfig[] {
  return type
    ? runtimeModels.filter((model) => model.type === type)
    : [...runtimeModels];
}

export function getStaticModelsByType(type: ModelType): ModelConfig[] {
  return ALL_MODELS.filter((model) => model.type === type);
}

export function getStaticModelConfig(modelId: string): ModelConfig | undefined {
  return (
    ALL_MODELS.find((model) => model.id === modelId) ||
    BUILT_IN_TEXT_MODELS.find((model) => model.id === modelId) ||
    HIDDEN_VIDEO_MODELS.find((model) => model.id === modelId)
  );
}

// ============================================
// 辅助函数
// ============================================

/**
 * 根据类型获取模型列表
 */
export function getModelsByType(type: ModelType): ModelConfig[] {
  return mergeModels(getStaticModelsByType(type), getRuntimeModelConfigs(type));
}

/**
 * 获取模型配置
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return (
    runtimeModels.find((model) => model.id === modelId) ||
    getStaticModelConfig(modelId)
  );
}

/**
 * 获取模型类型
 */
export function getModelType(modelId: string): ModelType | undefined {
  return getModelConfig(modelId)?.type;
}

/**
 * 获取模型 ID 列表
 */
export function getModelIds(type?: ModelType): string[] {
  const models = type
    ? getModelsByType(type)
    : mergeModels(ALL_MODELS, getRuntimeModelConfigs());
  return models.map((model) => model.id);
}

/**
 * 检查模型是否支持工具调用
 */
export function supportsTools(modelId: string): boolean {
  return getModelConfig(modelId)?.supportsTools ?? false;
}

/**
 * 获取图片模型默认参数
 */
export function getImageModelDefaults(modelId: string): ImageModelDefaults {
  const config = getModelConfig(modelId);
  return config?.imageDefaults ?? IMAGE_DEFAULT_PARAMS;
}

/**
 * 获取视频模型默认参数
 */
export function getVideoModelDefaults(modelId: string): VideoModelDefaults {
  const config = getModelConfig(modelId);
  return config?.videoDefaults ?? VEO_DEFAULT_PARAMS;
}

/**
 * 获取模型颜色
 */
export function getModelTypeColor(type: ModelType): string {
  return MODEL_TYPE_COLORS[type];
}

/**
 * 按厂商分组模型列表
 */
export function getModelsByVendor(
  models: ModelConfig[]
): Map<ModelVendor, ModelConfig[]> {
  const map = new Map<ModelVendor, ModelConfig[]>();
  for (const model of models) {
    const list = map.get(model.vendor);
    if (list) {
      list.push(model);
    } else {
      map.set(model.vendor, [model]);
    }
  }
  return map;
}

/**
 * 按首次出现顺序返回厂商列表
 */
export function getVendorOrder(models: ModelConfig[]): ModelVendor[] {
  const seen = new Set<ModelVendor>();
  const order: ModelVendor[] = [];
  for (const model of models) {
    if (!seen.has(model.vendor)) {
      seen.add(model.vendor);
      order.push(model.vendor);
    }
  }
  return order;
}

// ============================================
// 兼容旧格式的导出（用于 Select 组件）
// ============================================

/**
 * 图片模型选项（用于 Select 组件）
 */
export const IMAGE_MODEL_SELECT_OPTIONS = IMAGE_MODELS.map((model) => ({
  label: model.label,
  value: model.id,
}));

/**
 * 图片模型分组选项（用于 Select 组件）
 */
export const IMAGE_MODEL_GROUPED_SELECT_OPTIONS = [
  {
    group: '推荐',
    children: IMAGE_MODEL_VIP_OPTIONS.map((model) => ({
      label: model.label,
      value: model.id,
    })),
  },
  {
    group: '更多',
    children: IMAGE_MODEL_MORE_OPTIONS.map((model) => ({
      label: model.label,
      value: model.id,
    })),
  },
];

/**
 * 视频模型选项（用于 Select 组件）
 */
export const VIDEO_MODEL_SELECT_OPTIONS = VIDEO_MODELS.map((model) => ({
  label: model.label,
  value: model.id,
}));

/**
 * 文本模型选项（用于 Select 组件）
 */
export const TEXT_MODEL_SELECT_OPTIONS = TEXT_MODELS.map((model) => ({
  label: model.label,
  value: model.id,
}));

/**
 * 音频模型选项（用于 Select 组件）
 */
export const AUDIO_MODEL_SELECT_OPTIONS = AUDIO_MODELS.map((model) => ({
  label: model.label,
  value: model.id,
}));

/**
 * 默认图片模型 ID
 */
export const DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2';

/**
 * 获取默认图片模型 ID（优先使用环境变量）
 */
export function getDefaultImageModel(): string {
  const envModel = import.meta.env.VITE_DEFAULT_IMAGE_MODEL;
  if (envModel && getModelConfig(envModel)?.type === 'image') {
    return envModel;
  }
  return DEFAULT_IMAGE_MODEL_ID;
}

/**
 * 默认视频模型 ID
 */
export const DEFAULT_VIDEO_MODEL_ID = 'seedance-1.5-pro';

/**
 * 获取默认视频模型 ID（目前固定为 veo3）
 */
export function getDefaultVideoModel(): string {
  return DEFAULT_VIDEO_MODEL_ID;
}

/**
 * 默认视频模型（兼容旧代码）
 * @deprecated 请使用 getDefaultVideoModel()
 */
export const DEFAULT_VIDEO_MODEL = DEFAULT_VIDEO_MODEL_ID;

/**
 * 默认文本模型 ID
 */
export const DEFAULT_TEXT_MODEL_ID = 'gpt-5.5';

/**
 * 获取默认文本模型 ID
 */
export function getDefaultTextModel(): string {
  return DEFAULT_TEXT_MODEL_ID;
}

/**
 * 默认文本模型（兼容旧代码）
 */
export const DEFAULT_TEXT_MODEL = DEFAULT_TEXT_MODEL_ID;

/**
 * 默认音频模型 ID
 */
export const DEFAULT_AUDIO_MODEL_ID = 'suno_music';

/**
 * 获取默认音频模型 ID
 */
export function getDefaultAudioModel(): string {
  return DEFAULT_AUDIO_MODEL_ID;
}

// ============================================
// 参数配置（用于 SmartSuggestionPanel）
// ============================================

/** Veo 系列模型 ID（标清，只支持 8 秒） */
const VEO_MODEL_IDS = [
  'veo3',
  'veo3-pro',
  'veo3-fast',
  'veo3-pro-frames',
  'veo3.1',
  'veo3.1-pro',
  'veo3.1-components',
  'omni-flash',
  'omni-flash-components',
];

/** Veo 4K 系列模型 ID（4K分辨率，只支持 8 秒） */
const VEO_4K_MODEL_IDS = ['veo3.1-4k', 'veo3.1-components-4k', 'veo3.1-pro-4k'];

/** All Veo模型 ID（用于时长参数） */
const ALL_VEO_MODEL_IDS = [...VEO_MODEL_IDS, ...VEO_4K_MODEL_IDS];

/** Sora 2 模型（支持 10/15 秒） */
const SORA_2_MODEL_IDS = ['sora-2'];

/** Sora 2 Pro 模型（支持 10/15/25 秒和高清尺寸） */
const SORA_2_PRO_MODEL_IDS = ['sora-2-pro'];

/** Sora 2 固定时长模型（模型名已包含时长，不传 seconds） */
const SORA_2_FIXED_MODEL_IDS = [
  'sora-2-4s',
  'sora-2-8s',
  'sora-2-12s',
  'sora-2-15s',
];

/** Seedance 视频模型 ID */
const SEEDANCE_MODEL_IDS = [
  'seedance-1.5-pro',
  'seedance-1.0-pro',
  'seedance-1.0-pro-fast',
  'seedance-1.0-lite',
];

const SEEDANCE_20_MODEL_IDS = [
  'doubao-seedance-2-0-260128',
  'doubao-seedance-2-0-fast-260128',
  'doubao-seedance-2-0-mini-260615',
];

const SEEDANCE_2_MODEL_IDS = [
  ...SEEDANCE_20_MODEL_IDS,
  SEEDANCE_25_MODEL_ID,
];

const SEEDANCE_25_DURATION_OPTIONS = Array.from(
  { length: 27 },
  (_, index) => {
    const value = String(index + 4);
    return { value, label: `${value}秒` };
  }
);

const SEEDANCE_25_RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
];

/** HappyHorse 视频模型 ID */
const HAPPYHORSE_MODEL_IDS = [
  'happyhorse-1.0-i2v',
  'happyhorse-1.0-r2v',
  'happyhorse-1.0-t2v',
  'happyhorse-1.0-video-edit',
];

const HAPPYHORSE_RATIO_MODEL_IDS = ['happyhorse-1.0-r2v', 'happyhorse-1.0-t2v'];

/** Seedream 图片模型 ID */
const SEEDREAM_IMAGE_MODEL_IDS = [
  'doubao-seedream-4-0-250828',
  'doubao-seedream-4-5-251128',
  'doubao-seedream-5-0-260128',
];

/** GPT Image 2 模型 ID（支持扩展比例） */
const GPT_IMAGE_2_MODEL_IDS = ['gpt-image-2-vip', 'gpt-image-2'];

/** 所有 GPT 图片模型 ID */
const GPT_IMAGE_MODEL_IDS = [...GPT_IMAGE_2_MODEL_IDS];
const MJ_IMAGE_MODEL_IDS = ['mj-imagine'];
const GEMINI_31_FLASH_IMAGE_MODEL_IDS = ['gemini-3.1-flash-image-preview'];

/** Gemini 图片模型 ID（支持完整尺寸） */
const GEMINI_IMAGE_MODEL_IDS = IMAGE_MODELS.filter(
  (m) =>
    !GPT_IMAGE_MODEL_IDS.includes(m.id) &&
    !SEEDREAM_IMAGE_MODEL_IDS.includes(m.id) &&
    !MJ_IMAGE_MODEL_IDS.includes(m.id)
).map((m) => m.id);
const GEMINI_IMAGE_MODEL_IDS_EXCLUDING_FLASH31 = GEMINI_IMAGE_MODEL_IDS.filter(
  (id) => !GEMINI_31_FLASH_IMAGE_MODEL_IDS.includes(id)
);

/** 所有图片模型 ID */
const ALL_IMAGE_MODEL_IDS = IMAGE_MODELS.map((m) => m.id);

/**
 * 视频参数配置
 * 根据 video-model-config.ts 中各模型的实际参数配置
 */
export const VIDEO_PARAMS: ParamConfig[] = [
  // Veo 系列时长参数（只有 8 秒，包括标清和 4K）
  {
    id: 'duration',
    label: '视频时长',
    shortLabel: '时长',
    description: '生成视频的时长（秒）',
    valueType: 'enum',
    options: [{ value: '8', label: '8秒' }],
    defaultValue: '8',
    compatibleModels: ALL_VEO_MODEL_IDS,
    modelType: 'video',
  },
  // Sora 2 时长参数（10/15 秒）
  {
    id: 'duration',
    label: '视频时长',
    shortLabel: '时长',
    description: '生成视频的时长（秒）',
    valueType: 'enum',
    options: [
      { value: '10', label: '10秒' },
      { value: '15', label: '15秒' },
    ],
    defaultValue: '10',
    compatibleModels: SORA_2_MODEL_IDS,
    modelType: 'video',
  },
  // Sora 2 Pro 时长参数（10/15/25 秒）
  {
    id: 'duration',
    label: '视频时长',
    shortLabel: '时长',
    description: '生成视频的时长（秒）',
    valueType: 'enum',
    options: [
      { value: '10', label: '10秒' },
      { value: '15', label: '15秒' },
      { value: '25', label: '25秒' },
    ],
    defaultValue: '10',
    compatibleModels: SORA_2_PRO_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: SORA_MODE_PARAM_ID,
    label: '调用方式',
    shortLabel: '方式',
    description: '切换 Sora 的前端时长方案',
    valueType: 'enum',
    options: [
      { value: 'web', label: '网页' },
      { value: 'api', label: 'API' },
    ],
    defaultValue: 'web',
    compatibleModels: [...SORA_2_MODEL_IDS, ...SORA_2_PRO_MODEL_IDS],
    modelType: 'video',
  },
  // Veo 标清和 Sora 2 尺寸参数（720p）
  {
    id: 'size',
    label: '视频尺寸',
    shortLabel: '尺寸',
    description: '生成视频的分辨率',
    valueType: 'enum',
    options: [
      { value: '1280x720', label: '横屏 16:9 (1280x720)' },
      { value: '720x1280', label: '竖屏 9:16 (720x1280)' },
    ],
    defaultValue: '1280x720',
    compatibleModels: [
      ...VEO_MODEL_IDS,
      ...SORA_2_MODEL_IDS,
      ...SORA_2_FIXED_MODEL_IDS,
    ],
    modelType: 'video',
  },
  // Veo 4K 尺寸参数（4K 分辨率）
  {
    id: 'size',
    label: '视频尺寸',
    shortLabel: '尺寸',
    description: '生成视频的分辨率',
    valueType: 'enum',
    options: [
      { value: '3840x2160', label: '4K横屏 16:9 (3840x2160)' },
      { value: '2160x3840', label: '4K竖屏 9:16 (2160x3840)' },
    ],
    defaultValue: '3840x2160',
    compatibleModels: VEO_4K_MODEL_IDS,
    modelType: 'video',
  },
  // Sora 2 Pro 尺寸参数（含高清）
  {
    id: 'size',
    label: '视频尺寸',
    shortLabel: '尺寸',
    description: '生成视频的分辨率',
    valueType: 'enum',
    options: [
      { value: '1280x720', label: '横屏 16:9 (1280x720)' },
      { value: '720x1280', label: '竖屏 9:16 (720x1280)' },
      { value: '1792x1024', label: '高清横屏 (1792x1024)' },
      { value: '1024x1792', label: '高清竖屏 (1024x1792)' },
    ],
    defaultValue: '1280x720',
    compatibleModels: SORA_2_PRO_MODEL_IDS,
    modelType: 'video',
  },
  // Seedance 时长参数（5/10 秒）
  {
    id: 'duration',
    label: '视频时长',
    shortLabel: '时长',
    description: '生成视频的时长（秒）',
    valueType: 'enum',
    options: [
      { value: '5', label: '5秒' },
      { value: '10', label: '10秒' },
    ],
    defaultValue: '5',
    compatibleModels: SEEDANCE_MODEL_IDS,
    modelType: 'video',
  },
  // Seedance 2.0 时长参数（官方 JSON 接口：4-12 秒）
  {
    id: 'duration',
    label: '视频时长',
    shortLabel: '时长',
    description: '生成视频的时长（秒）',
    valueType: 'enum',
    options: Array.from({ length: 9 }, (_, index) => {
      const value = String(index + 4);
      return { value, label: `${value}秒` };
    }),
    defaultValue: '5',
    compatibleModels: SEEDANCE_2_MODEL_IDS,
    modelType: 'video',
  },
  // Seedance 分辨率参数（480p/720p/1080p）
  {
    id: 'size',
    label: '视频分辨率',
    shortLabel: '分辨率',
    description: '生成视频的分辨率',
    valueType: 'enum',
    options: [
      { value: '1080p', label: '1080p' },
      { value: '720p', label: '720p' },
      { value: '480p', label: '480p' },
    ],
    defaultValue: '720p',
    compatibleModels: SEEDANCE_MODEL_IDS,
    modelType: 'video',
  },
  // Seedance 2.0 官方 JSON 接口将分辨率与比例作为独立字段。
  {
    id: 'size',
    label: '视频分辨率',
    shortLabel: '分辨率',
    description: 'Seedance 2.0 resolution',
    valueType: 'enum',
    options: [
      { value: '1080p', label: '1080p' },
      { value: '720p', label: '720p' },
      { value: '480p', label: '480p' },
    ],
    defaultValue: '720p',
    compatibleModels: SEEDANCE_2_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'ratio',
    label: '视频比例',
    shortLabel: '比例',
    description: 'Seedance 2.0 ratio',
    valueType: 'enum',
    options: [
      { value: '16:9', label: '16:9 横屏' },
      { value: '4:3', label: '4:3 横屏' },
      { value: '1:1', label: '1:1 方形' },
      { value: '3:4', label: '3:4 竖屏' },
      { value: '9:16', label: '9:16 竖屏' },
      { value: '21:9', label: '21:9 超宽' },
      { value: 'adaptive', label: '自适应' },
    ],
    defaultValue: '16:9',
    compatibleModels: SEEDANCE_2_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'generate_audio',
    label: '生成音频',
    shortLabel: '音频',
    description: '是否为 Seedance 2.0 生成同步音频',
    valueType: 'enum',
    options: [
      { value: 'true', label: '开启' },
      { value: 'false', label: '关闭' },
    ],
    defaultValue: 'true',
    compatibleModels: SEEDANCE_2_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'watermark',
    label: '水印',
    shortLabel: '水印',
    description: '是否添加 Seedance 2.0 水印',
    valueType: 'enum',
    options: [
      { value: 'true', label: '开启' },
      { value: 'false', label: '关闭' },
    ],
    defaultValue: 'false',
    compatibleModels: SEEDANCE_2_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'seed',
    label: '随机种子',
    shortLabel: 'Seed',
    description: 'Seedance 2.0 seed，留空则由上游决定',
    valueType: 'number',
    step: 1,
    integer: true,
    compatibleModels: SEEDANCE_20_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'camera_fixed',
    label: '固定镜头',
    shortLabel: '镜头',
    description: 'Seedance 2.0 camera_fixed',
    valueType: 'enum',
    options: [
      { value: 'true', label: '开启' },
      { value: 'false', label: '关闭' },
    ],
    compatibleModels: SEEDANCE_20_MODEL_IDS,
    modelType: 'video',
  },
  // Seedance 宽高比参数
  {
    id: 'aspect_ratio',
    label: '视频比例',
    shortLabel: '比例',
    description: '生成视频的宽高比',
    valueType: 'enum',
    options: [
      { value: '16:9', label: '16:9 横屏' },
      { value: '9:16', label: '9:16 竖屏' },
      { value: '1:1', label: '1:1 方形' },
      { value: '4:3', label: '4:3 横屏' },
      { value: '3:4', label: '3:4 竖屏' },
      { value: '21:9', label: '21:9 超宽' },
      { value: 'keep_ratio', label: '保持上传比例' },
      { value: 'adaptive', label: '自适应' },
    ],
    defaultValue: '16:9',
    compatibleModels: SEEDANCE_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'duration',
    label: '视频时长',
    shortLabel: '时长',
    description:
      'HappyHorse 视频时长（3-15 秒整数；Video Edit 跟随输入视频，不支持此参数）',
    valueType: 'enum',
    options: [
      { value: '3', label: '3秒' },
      { value: '4', label: '4秒' },
      { value: '5', label: '5秒' },
      { value: '6', label: '6秒' },
      { value: '7', label: '7秒' },
      { value: '8', label: '8秒' },
      { value: '9', label: '9秒' },
      { value: '10', label: '10秒' },
      { value: '11', label: '11秒' },
      { value: '12', label: '12秒' },
      { value: '13', label: '13秒' },
      { value: '14', label: '14秒' },
      { value: '15', label: '15秒' },
    ],
    defaultValue: '5',
    compatibleModels: [
      'happyhorse-1.0-i2v',
      'happyhorse-1.0-r2v',
      'happyhorse-1.0-t2v',
    ],
    modelType: 'video',
  },
  {
    id: 'size',
    label: '视频分辨率',
    shortLabel: '分辨率',
    description: 'HappyHorse parameters.resolution，支持 720P / 1080P',
    valueType: 'enum',
    options: [
      { value: '1080P', label: '1080P' },
      { value: '720P', label: '720P' },
    ],
    defaultValue: '1080P',
    compatibleModels: HAPPYHORSE_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'ratio',
    label: '视频比例',
    shortLabel: '比例',
    description: 'HappyHorse 输出宽高比；I2V 跟随首帧，Video Edit 不支持',
    valueType: 'enum',
    options: [
      { value: '16:9', label: '16:9 横屏' },
      { value: '9:16', label: '9:16 竖屏' },
      { value: '1:1', label: '1:1 方形' },
      { value: '4:3', label: '4:3 横屏' },
      { value: '3:4', label: '3:4 竖屏' },
    ],
    defaultValue: '16:9',
    compatibleModels: HAPPYHORSE_RATIO_MODEL_IDS,
    modelType: 'video',
  },
  {
    id: 'watermark',
    label: '水印',
    shortLabel: '水印',
    description: '是否添加 Happy Horse 水印；项目默认关闭',
    valueType: 'enum',
    options: [
      { value: 'true', label: '开启' },
      { value: 'false', label: '关闭' },
    ],
    defaultValue: 'false',
    compatibleModels: HAPPYHORSE_MODEL_IDS,
    compatibleTags: ['happyhorse'],
    modelType: 'video',
  },
  {
    id: 'seed',
    label: '随机种子',
    shortLabel: 'Seed',
    description: '0 到 2147483647 的整数，留空则由接口随机生成',
    valueType: 'number',
    min: 0,
    max: 2147483647,
    step: 1,
    integer: true,
    compatibleModels: HAPPYHORSE_MODEL_IDS,
    compatibleTags: ['happyhorse'],
    modelType: 'video',
  },
  {
    id: 'audio_setting',
    label: '声音控制',
    shortLabel: '声音',
    description: '仅 Video Edit 支持；origin 表示保留原视频音频',
    valueType: 'enum',
    options: [
      { value: 'auto', label: '自动' },
      { value: 'origin', label: '保留原音频' },
    ],
    defaultValue: 'auto',
    compatibleModels: ['happyhorse-1.0-video-edit'],
    modelType: 'video',
  },
  {
    id: 'duration',
    label: '视频时长',
    shortLabel: '时长',
    description: '生成视频的时长（秒）',
    valueType: 'enum',
    options: [
      { value: '5', label: '5秒' },
      { value: '10', label: '10秒' },
    ],
    defaultValue: '5',
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'size',
    label: '视频尺寸',
    shortLabel: '尺寸',
    description: '生成视频的画面比例',
    valueType: 'enum',
    options: [
      { value: '1280x720', label: '横屏 16:9 (1280x720)' },
      { value: '720x1280', label: '竖屏 9:16 (720x1280)' },
      { value: '1024x1024', label: '方形 1:1 (1024x1024)' },
    ],
    defaultValue: '1280x720',
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'model_name',
    label: 'Kling 版本',
    shortLabel: '版本',
    description: 'Kling 标准视频能力的执行版本',
    valueType: 'enum',
    options: [
      { value: 'kling-v3', label: 'V3' },
      { value: 'kling-v2-6', label: 'V2.6' },
      { value: 'kling-v2-1', label: 'V2.1' },
      { value: 'kling-v1-6', label: 'V1.6' },
      { value: 'kling-v1-5', label: 'V1.5' },
    ],
    defaultValue: 'kling-v1-6',
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'klingAction2',
    label: 'Kling 模式',
    shortLabel: '模式',
    description: '显式指定文生视频或图生视频；留空则自动判断',
    valueType: 'enum',
    options: [
      { value: 'text2video', label: '文生视频' },
      { value: 'image2video', label: '图生视频' },
    ],
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'mode',
    label: '生成模式',
    shortLabel: '表现',
    description: 'Kling 生成模式',
    valueType: 'enum',
    options: [
      { value: 'std', label: 'std 高性能' },
      { value: 'pro', label: 'pro 高表现' },
    ],
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'cfg_scale',
    label: '自由度',
    shortLabel: 'CFG',
    description: '取值范围 0 到 1，值越大相关性越强',
    valueType: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'negative_prompt',
    label: '负向提示词',
    shortLabel: '负向',
    description: '可选，补充不希望出现的内容',
    valueType: 'string',
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'camera_control_type',
    label: '运镜协议',
    shortLabel: '协议',
    description: 'camera_control.type，常用值如 simple',
    valueType: 'string',
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'camera_horizontal',
    label: '水平运镜',
    shortLabel: '水平',
    description: '取值范围 -10 到 10，且必须为整数',
    valueType: 'number',
    min: -10,
    max: 10,
    step: 1,
    integer: true,
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'camera_vertical',
    label: '垂直运镜',
    shortLabel: '垂直',
    description: '取值范围 -10 到 10，且必须为整数',
    valueType: 'number',
    min: -10,
    max: 10,
    step: 1,
    integer: true,
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'camera_pan',
    label: '水平摇镜',
    shortLabel: 'Pan',
    description: '取值范围 -10 到 10，且必须为整数',
    valueType: 'number',
    min: -10,
    max: 10,
    step: 1,
    integer: true,
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'camera_tilt',
    label: '垂直摇镜',
    shortLabel: 'Tilt',
    description: '取值范围 -10 到 10，且必须为整数',
    valueType: 'number',
    min: -10,
    max: 10,
    step: 1,
    integer: true,
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'camera_roll',
    label: '旋转运镜',
    shortLabel: 'Roll',
    description: '取值范围 -10 到 10，且必须为整数',
    valueType: 'number',
    min: -10,
    max: 10,
    step: 1,
    integer: true,
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
  {
    id: 'camera_zoom',
    label: '变焦',
    shortLabel: 'Zoom',
    description: '取值范围 -10 到 10，且必须为整数',
    valueType: 'number',
    min: -10,
    max: 10,
    step: 1,
    integer: true,
    compatibleModels: ['kling_video'],
    modelType: 'video',
  },
];

/**
 * 音频参数配置
 */
export const AUDIO_PARAMS: ParamConfig[] = [
  {
    id: 'sunoAction',
    label: 'Suno 动作',
    shortLabel: '动作',
    description: '选择生成音乐还是歌词',
    valueType: 'enum',
    options: [
      { value: 'lyrics', label: '生成歌词' },
      { value: 'music', label: '生成音乐' },
    ],
    defaultValue: 'lyrics',
    compatibleModels: ['suno_music'],
    compatibleTags: ['suno', 'audio', 'music'],
    modelType: 'audio',
  },
  {
    id: 'mv',
    label: 'Suno 版本',
    shortLabel: '版本',
    description: 'Suno 音乐生成版本',
    valueType: 'enum',
    options: [
      { value: 'chirp-v5-5', label: 'v5.5' },
      { value: 'chirp-v5', label: 'v5.0' },
      { value: 'chirp-v4-5', label: 'v4.5' },
      { value: 'chirp-v4', label: 'v4.0' },
      { value: 'chirp-v3-0', label: 'v3.0' },
      { value: 'chirp-v3-5', label: 'v3.5' },
    ],
    defaultValue: 'chirp-v5-5',
    compatibleModels: ['suno_music'],
    compatibleTags: ['suno', 'audio', 'music'],
    modelType: 'audio',
  },
  {
    id: 'title',
    label: '歌曲标题',
    shortLabel: '标题',
    description: '可选，设置歌曲标题',
    valueType: 'string',
    compatibleModels: ['suno_music'],
    compatibleTags: ['suno', 'audio', 'music'],
    modelType: 'audio',
  },
  {
    id: 'tags',
    label: '风格标签',
    shortLabel: '风格',
    description: '可选，使用逗号分隔多个风格标签',
    valueType: 'string',
    compatibleModels: ['suno_music'],
    compatibleTags: ['suno', 'audio', 'music'],
    modelType: 'audio',
  },
  {
    id: 'continueSource',
    label: '续写来源',
    shortLabel: '续写',
    description: '选择普通续写还是基于上传音频续写',
    valueType: 'enum',
    options: [
      { value: 'clip', label: '已有 clip' },
      { value: 'upload', label: '上传音频' },
    ],
    compatibleModels: ['suno_music'],
    compatibleTags: ['suno', 'audio', 'music'],
    modelType: 'audio',
  },
  {
    id: 'continueClipId',
    label: '续写 Clip ID',
    shortLabel: 'Clip',
    description: '续写已有歌曲时填写 clip ID',
    valueType: 'string',
    compatibleModels: ['suno_music'],
    compatibleTags: ['suno', 'audio', 'music'],
    modelType: 'audio',
  },
  {
    id: 'continueAt',
    label: '续写起点秒数',
    shortLabel: '起点',
    description: '从第几秒开始续写',
    valueType: 'number',
    compatibleModels: ['suno_music'],
    compatibleTags: ['suno', 'audio', 'music'],
    modelType: 'audio',
  },
];

/**
 * 图片参数配置
 * 根据 API 文档，size 使用宽高比格式（如 16x9），API 会自动转换为对应像素
 * 'auto' 表示不传尺寸参数，让模型自动决定
 */
export const IMAGE_PARAMS: ParamConfig[] = [
  // GPT Image 2 模型尺寸
  {
    id: 'size',
    label: '图片尺寸',
    shortLabel: '尺寸',
    description: '生成图片的尺寸比例',
    valueType: 'enum',
    options: [
      { value: 'auto', label: '自动' },
      { value: '1x1', label: '1:1 方形' },
      { value: '2x3', label: '2:3 竖版' },
      { value: '3x2', label: '3:2 横版' },
      { value: '3x4', label: '3:4 竖版' },
      { value: '4x3', label: '4:3 横版' },
      { value: '4x5', label: '4:5 竖版' },
      { value: '5x4', label: '5:4 横版' },
      { value: '9x16', label: '9:16 竖版' },
      { value: '16x9', label: '16:9 横版' },
      { value: '21x9', label: '21:9 超宽' },
    ],
    defaultValue: 'auto',
    compatibleModels: GPT_IMAGE_2_MODEL_IDS,
    modelType: 'image',
  },
  // GPT Image 2 分辨率档位（由 adapter 结合宽高比映射为官方像素 size）
  {
    id: 'resolution',
    label: '图片分辨率',
    shortLabel: '分辨率',
    description: '选择 1K / 2K / 4K 输出档位',
    valueType: 'enum',
    options: [
      { value: '1k', label: '1K' },
      { value: '2k', label: '2K' },
      { value: '4k', label: '4K' },
    ],
    defaultValue: '1k',
    compatibleModels: GPT_IMAGE_2_MODEL_IDS,
    modelType: 'image',
  },
  // GPT Image 官方画质参数
  {
    id: 'quality',
    label: '画质',
    shortLabel: '画质',
    description: '选择 GPT Image 官方画质',
    valueType: 'enum',
    options: [
      { value: 'auto', label: '自动' },
      { value: 'low', label: '快速' },
      { value: 'medium', label: '标准' },
      { value: 'high', label: '高清' },
    ],
    defaultValue: 'auto',
    compatibleModels: GPT_IMAGE_MODEL_IDS,
    modelType: 'image',
  },
  // Gemini 图片模型尺寸（支持完整尺寸）
  {
    id: 'size',
    label: '图片尺寸',
    shortLabel: '尺寸',
    description: '生成图片的尺寸比例',
    valueType: 'enum',
    options: [
      { value: 'auto', label: '自动' },
      { value: '1x1', label: '1:1 方形' },
      { value: '16x9', label: '16:9 横版' },
      { value: '9x16', label: '9:16 竖版' },
      { value: '3x2', label: '3:2 横版' },
      { value: '2x3', label: '2:3 竖版' },
      { value: '4x3', label: '4:3 横版' },
      { value: '3x4', label: '3:4 竖版' },
      { value: '5x4', label: '5:4 横版' },
      { value: '4x5', label: '4:5 竖版' },
      { value: '21x9', label: '21:9 超宽' },
    ],
    defaultValue: 'auto',
    compatibleModels: GEMINI_IMAGE_MODEL_IDS_EXCLUDING_FLASH31,
    modelType: 'image',
  },
  // Gemini 3.1 Flash 图片模型尺寸（支持扩展极端宽高比）
  {
    id: 'size',
    label: '图片尺寸',
    shortLabel: '尺寸',
    description: '生成图片的尺寸比例',
    valueType: 'enum',
    options: [
      { value: 'auto', label: '自动' },
      { value: '1x1', label: '1:1 方形' },
      { value: '1x4', label: '1:4 超长竖版' },
      { value: '4x1', label: '4:1 超长横版' },
      { value: '1x8', label: '1:8 极长竖版' },
      { value: '8x1', label: '8:1 极长横版' },
      { value: '16x9', label: '16:9 横版' },
      { value: '9x16', label: '9:16 竖版' },
      { value: '3x2', label: '3:2 横版' },
      { value: '2x3', label: '2:3 竖版' },
      { value: '4x3', label: '4:3 横版' },
      { value: '3x4', label: '3:4 竖版' },
      { value: '5x4', label: '5:4 横版' },
      { value: '4x5', label: '4:5 竖版' },
      { value: '21x9', label: '21:9 超宽' },
    ],
    defaultValue: 'auto',
    compatibleModels: GEMINI_31_FLASH_IMAGE_MODEL_IDS,
    modelType: 'image',
  },
  // Seedream 图片模型尺寸（支持 8 种宽高比，label 显示具体像素）
  // 实际像素由 adapter 根据 quality(2K/4K) + 宽高比 计算
  {
    id: 'size',
    label: '图片尺寸',
    shortLabel: '尺寸',
    description: '生成图片的尺寸比例',
    valueType: 'enum',
    options: [
      { value: '1x1', label: '1:1 方形 (2048×2048)' },
      { value: '16x9', label: '16:9 横版 (2720×1536)' },
      { value: '9x16', label: '9:16 竖版 (1536×2720)' },
      { value: '3x2', label: '3:2 横版 (2496×1664)' },
      { value: '2x3', label: '2:3 竖版 (1664×2496)' },
      { value: '4x3', label: '4:3 横版 (2368×1776)' },
      { value: '3x4', label: '3:4 竖版 (1776×2368)' },
      { value: '21x9', label: '21:9 超宽 (2688×1152)' },
    ],
    defaultValue: '1x1',
    compatibleModels: SEEDREAM_IMAGE_MODEL_IDS,
    compatibleTags: ['seedream'],
    modelType: 'image',
  },
  // Seedream 4.0/4.5 图片质量（2K/4K）
  {
    id: 'seedream_quality',
    label: '图片质量',
    shortLabel: '质量',
    description: '2K 或 4K 分辨率',
    valueType: 'enum',
    options: [
      { value: '2k', label: '2K' },
      { value: '4k', label: '4K' },
    ],
    defaultValue: '2k',
    compatibleModels: [
      'doubao-seedream-4-0-250828',
      'doubao-seedream-4-5-251128',
    ],
    modelType: 'image',
  },
  // Seedream 5.0 lite 图片质量（2K/3K）
  {
    id: 'seedream_quality',
    label: '图片质量',
    shortLabel: '质量',
    description: '2K 或 3K 分辨率',
    valueType: 'enum',
    options: [
      { value: '2k', label: '2K' },
      { value: '3k', label: '3K' },
    ],
    defaultValue: '2k',
    compatibleModels: ['doubao-seedream-5-0-260128'],
    modelType: 'image',
  },
  // nano-banana-2 图片质量（1K/2K/4K）- 适用于 gemini-3-pro-image-preview 和 gemini-3.1-flash-image-preview
  {
    id: 'quality',
    label: '图片质量',
    shortLabel: '质量',
    description: '选择图像生成质量（1K/2K/4K）',
    valueType: 'enum',
    options: [
      { value: '1k', label: '1K' },
      { value: '2k', label: '2K' },
      { value: '4k', label: '4K' },
    ],
    defaultValue: '1k',
    compatibleModels: [
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
    ],
    modelType: 'image',
  },
  {
    id: 'mj_ar',
    label: 'MJ 画幅',
    shortLabel: '画幅',
    description: 'Midjourney 长宽比参数 (--ar)',
    valueType: 'enum',
    options: [
      { value: 'default', label: '默认' },
      { value: '1:1', label: '1:1 方形' },
      { value: '16:9', label: '16:9 横版' },
      { value: '9:16', label: '9:16 竖版' },
      { value: '3:2', label: '3:2 横版' },
      { value: '2:3', label: '2:3 竖版' },
      { value: '4:3', label: '4:3 横版' },
      { value: '3:4', label: '3:4 竖版' },
      { value: '5:4', label: '5:4 横版' },
      { value: '4:5', label: '4:5 竖版' },
      { value: '21:9', label: '21:9 超宽' },
    ],
    defaultValue: 'default',
    compatibleModels: [],
    compatibleTags: ['mj', 'midjourney'],
    modelType: 'image',
  },
  {
    id: 'mj_v',
    label: 'MJ 版本',
    shortLabel: '版本',
    description: 'Midjourney 版本参数 (--v)',
    valueType: 'enum',
    options: [
      { value: 'default', label: '默认 (V7)' },
      { value: '8.1', label: 'V8.1' },
      { value: '8', label: 'V8' },
      { value: '7', label: 'V7' },
      { value: '6', label: 'V6' },
    ],
    defaultValue: 'default',
    compatibleModels: [],
    compatibleTags: ['mj', 'midjourney'],
    modelType: 'image',
  },
  {
    id: 'mj_style',
    label: 'MJ 风格',
    shortLabel: '风格',
    description: 'Midjourney 风格参数 (--style)',
    valueType: 'enum',
    options: [
      { value: 'default', label: '默认' },
      { value: 'raw', label: 'raw (Legacy)' },
    ],
    defaultValue: 'default',
    compatibleModels: [],
    compatibleTags: ['mj', 'midjourney'],
    modelType: 'image',
  },
  {
    id: 'mj_s',
    label: 'MJ 风格化',
    shortLabel: '风格化',
    description: 'Midjourney 风格化强度 (--s)',
    valueType: 'enum',
    options: [
      { value: 'default', label: '默认 (100)' },
      { value: '50', label: '50' },
      { value: '100', label: '100' },
      { value: '200', label: '200' },
      { value: '400', label: '400' },
      { value: '800', label: '800' },
      { value: '1000', label: '1000' },
    ],
    defaultValue: 'default',
    compatibleModels: [],
    compatibleTags: ['mj', 'midjourney'],
    modelType: 'image',
  },
  {
    id: 'mj_q',
    label: 'MJ 质量',
    shortLabel: '质量',
    description: 'Midjourney 质量档位 (--q)',
    valueType: 'enum',
    options: [
      { value: 'default', label: '默认 (1)' },
      { value: '1', label: '1x' },
      { value: '2', label: '2x' },
      { value: '4', label: '4x' },
    ],
    defaultValue: 'default',
    compatibleModels: [],
    compatibleTags: ['mj', 'midjourney'],
    modelType: 'image',
  },
  {
    id: 'mj_seed',
    label: 'MJ 种子',
    shortLabel: '种子',
    description: 'Midjourney 随机种子 (--seed)',
    valueType: 'enum',
    options: [
      { value: 'default', label: '默认 (随机)' },
      { value: '0', label: '0' },
      { value: '42', label: '42' },
      { value: '2024', label: '2024' },
      { value: '7777', label: '7777' },
      { value: '9999', label: '9999' },
    ],
    defaultValue: 'default',
    compatibleModels: [],
    compatibleTags: ['mj', 'midjourney'],
    modelType: 'image',
  },
];

/**
 * 所有参数配置
 */
export const ALL_PARAMS: ParamConfig[] = [
  ...VIDEO_PARAMS,
  ...IMAGE_PARAMS,
  ...AUDIO_PARAMS,
  {
    id: 'temperature',
    label: 'Temperature',
    shortLabel: '温度',
    description: '控制文本生成的发散程度',
    valueType: 'number',
    defaultValue: '0.7',
    min: 0,
    max: 2,
    step: 0.1,
    compatibleModels: [],
    modelType: 'text',
  },
  {
    id: 'top_p',
    label: 'Top P',
    shortLabel: '采样',
    description: '控制 nucleus sampling 范围',
    valueType: 'number',
    defaultValue: '1',
    min: 0,
    max: 1,
    step: 0.05,
    compatibleModels: [],
    modelType: 'text',
  },
  {
    id: 'max_tokens',
    label: 'Max Tokens',
    shortLabel: '长度',
    description: '限制文本输出长度',
    valueType: 'number',
    defaultValue: '4096',
    min: 1,
    max: 32768,
    step: 1,
    integer: true,
    compatibleModels: [],
    modelType: 'text',
  },
];

/**
 * 根据模型类型获取参数列表
 */
export function getParamsByModelType(modelType: ModelType): ParamConfig[] {
  return ALL_PARAMS.filter((param) => param.modelType === modelType);
}

/**
 * 根据模型 ID 获取兼容的参数列表
 */
export function getCompatibleParams(modelId: string): ParamConfig[] {
  const modelConfig = getModelConfig(modelId);
  if (!modelConfig) return [];

  // 构建模型标签集合：显式标签 + 类型 + 厂商 + 基于 ID 的启发式
  const modelTags = new Set<string>();
  (modelConfig.tags || []).forEach((t) => modelTags.add(t.toLowerCase()));
  if (modelConfig.type) modelTags.add(modelConfig.type.toLowerCase());
  if (modelConfig.vendor) modelTags.add(modelConfig.vendor.toLowerCase());
  const idLower = modelConfig.id.toLowerCase();
  if (idLower.includes('seedream')) modelTags.add('seedream');
  if (idLower.startsWith('mj') || idLower.includes('midjourney'))
    modelTags.add('mj');
  if (idLower.includes('gemini')) modelTags.add('gemini');
  if (idLower.includes('gpt')) modelTags.add('gpt');
  if (idLower.includes('flux')) modelTags.add('flux');
  if (idLower.includes('veo')) modelTags.add('veo');
  if (idLower.includes('sora')) modelTags.add('sora');
  if (idLower.includes('seedance')) modelTags.add('seedance');
  if (idLower.includes('happyhorse')) modelTags.add('happyhorse');
  if (idLower.includes('suno') || idLower.includes('chirp')) {
    modelTags.add('suno');
    modelTags.add('audio');
    modelTags.add('music');
  }
  // 这里不再自动按 doubao 分类，避免与 seedream 重复；若需要可通过 tags 显式声明

  const compatibleParams = ALL_PARAMS.filter((param) => {
    // 检查模型类型是否匹配
    if (param.modelType !== modelConfig.type) return false;
    // 检查标签兼容（可选）
    const tagMatched = param.compatibleTags
      ? param.compatibleTags.some((tag) => modelTags.has(tag.toLowerCase()))
      : false;
    // 检查是否在兼容 ID 列表（无标签限制时，空数组表示所有模型都兼容）
    const idMatched =
      param.compatibleModels.includes(modelId) ||
      (param.compatibleModels.length === 0 && !param.compatibleTags?.length);
    return idMatched || tagMatched;
  });

  if (!isSeedance25ModelId(modelId)) {
    return compatibleParams;
  }

  return compatibleParams.map((param) => {
    if (param.id === 'duration') {
      return {
        ...param,
        options: SEEDANCE_25_DURATION_OPTIONS,
        defaultValue: '8',
      };
    }
    if (param.id === 'ratio') {
      return {
        ...param,
        options: SEEDANCE_25_RATIO_OPTIONS,
        defaultValue: '16:9',
      };
    }
    return param;
  });
}

/**
 * 获取参数配置
 */
export function getParamConfig(paramId: string): ParamConfig | undefined {
  return ALL_PARAMS.find((param) => param.id === paramId);
}

/**
 * 获取参数 ID 列表
 */
export function getParamIds(modelType?: ModelType): string[] {
  const params = modelType ? getParamsByModelType(modelType) : ALL_PARAMS;
  return params.map((param) => param.id);
}

/**
 * 获取模型支持的尺寸选项
 * @param modelId 模型 ID
 * @returns 尺寸选项列表，包含 value 和 label
 */
export function getSizeOptionsForModel(
  modelId: string
): Array<{ value: string; label: string }> {
  const params = getCompatibleParams(modelId);
  const sizeParam = params.find((p) => p.id === 'size');
  return sizeParam?.options || [];
}

/**
 * 获取模型的默认尺寸
 * @param modelId 模型 ID
 * @returns 默认尺寸值
 */
export function getDefaultSizeForModel(modelId: string): string {
  const params = getCompatibleParams(modelId);
  const sizeParam = params.find((p) => p.id === 'size');
  return sizeParam?.defaultValue || 'auto';
}
