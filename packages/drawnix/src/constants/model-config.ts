/**
 * 统一的模型配置文件
 *
 * 所有图片、视频和文本模型的配置都在这里定义
 * 被 ModelSelector、settings-dialog、ai-image-generation、ai-video-generation 等组件使用
 *
 * 参数配置用于 SmartSuggestionPanel 的 - 参数提示功能
 */

/**
 * 模型类型
 */
export type ModelType = 'image' | 'video' | 'text';

/**
 * 模型厂商
 */
export enum ModelVendor {
  GEMINI = 'GEMINI',
  FLUX = 'FLUX',
  MIDJOURNEY = 'MIDJOURNEY',
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
  OTHER = 'OTHER',
}

/**
 * 厂商显示名称
 */
export const VENDOR_NAMES: Record<ModelVendor, string> = {
  [ModelVendor.GEMINI]: 'Gemini',
  [ModelVendor.FLUX]: 'Flux',
  [ModelVendor.MIDJOURNEY]: 'Midjourney',
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
  /** 兼容的模型 ID 列表（空数组表示所有模型都兼容） */
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
  /** 运行时来源供应商 ID（仅动态模型选择场景使用） */
  sourceProfileId?: string | null;
  /** 运行时来源供应商名称（仅动态模型选择场景使用） */
  sourceProfileName?: string | null;
  /** 选择器中用于区分同名模型来源的唯一键 */
  selectionKey?: string;
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
    id: 'gpt-image-1.5',
    label: 'gpt-image-1.5',
    shortCode: 'gpt15',
    description: 'GPT 图片生成模型',
    type: 'image',
    vendor: ModelVendor.GPT,
    supportsTools: true,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
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
    id: 'flux-kontext-pro',
    label: 'Flux Kontext Pro',
    shortLabel: 'kontext-pro',
    shortCode: 'fkp',
    description: 'Flux Kontext Pro 多参考图编辑',
    type: 'image',
    vendor: ModelVendor.FLUX,
    supportsTools: false,
    imageDefaults: IMAGE_DEFAULT_PARAMS,
  },
  {
    id: 'flux-kontext-max',
    label: 'Flux Kontext Max',
    shortLabel: 'kontext-max',
    shortCode: 'fkm',
    description: 'Flux Kontext Max 多参考图编辑（最高质量）',
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
export const IMAGE_MODELS: ModelConfig[] = [
  ...IMAGE_MODEL_VIP_OPTIONS,
  ...IMAGE_MODEL_MORE_OPTIONS,
];

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

/**
 * 视频模型配置
 */
export const VIDEO_MODELS: ModelConfig[] = [
  {
    id: 'kling-v1-6',
    label: 'Kling V1.6',
    shortCode: 'k16',
    description: '5s/10s 视频，支持文生视频和图生视频',
    type: 'video',
    vendor: ModelVendor.KLING,
    supportsTools: true,
    videoDefaults: KLING_DEFAULT_PARAMS,
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
];

// ============================================
// 文本模型配置
// ============================================

/**
 * 文本/Agent 模型配置
 */
export const TEXT_MODELS: ModelConfig[] = [
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
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    shortCode: 'g25f',
    description: 'Google 快速响应模型，适合日常任务',
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
];

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
  return ALL_MODELS.find((model) => model.id === modelId);
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
 * 默认图片模型 ID
 */
export const DEFAULT_IMAGE_MODEL_ID = 'gemini-3-pro-image-preview-vip';

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
export const DEFAULT_VIDEO_MODEL_ID = 'veo3';

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
export const DEFAULT_TEXT_MODEL_ID = 'deepseek-v3.2';

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

// ============================================
// 参数配置（用于 SmartSuggestionPanel）
// ============================================

/** Veo 系列模型 ID（标清，只支持 8 秒） */
const VEO_MODEL_IDS = [
  'veo3',
  'veo3-pro',
  'veo3.1',
  'veo3.1-pro',
  'veo3.1-components',
];

/** Veo 4K 系列模型 ID（4K分辨率，只支持 8 秒） */
const VEO_4K_MODEL_IDS = ['veo3.1-4k', 'veo3.1-components-4k', 'veo3.1-pro-4k'];

/** 所有 Veo 模型 ID（用于时长参数） */
const ALL_VEO_MODEL_IDS = [...VEO_MODEL_IDS, ...VEO_4K_MODEL_IDS];

/** Sora 2 模型（支持 10/15 秒） */
const SORA_2_MODEL_IDS = ['sora-2'];

/** Sora 2 Pro 模型（支持 10/15/25 秒和高清尺寸） */
const SORA_2_PRO_MODEL_IDS = ['sora-2-pro'];

/** Sora 2 固定时长模型（模型名已包含时长，不传 seconds） */
const SORA_2_FIXED_MODEL_IDS = ['sora-2-4s', 'sora-2-8s', 'sora-2-12s'];

/** Seedance 视频模型 ID */
const SEEDANCE_MODEL_IDS = [
  'seedance-1.5-pro',
  'seedance-1.0-pro',
  'seedance-1.0-pro-fast',
  'seedance-1.0-lite',
];

/** Seedream 图片模型 ID */
const SEEDREAM_IMAGE_MODEL_IDS = [
  'doubao-seedream-4-0-250828',
  'doubao-seedream-4-5-251128',
  'doubao-seedream-5-0-260128',
];

/** GPT 图片模型 ID（仅支持有限尺寸） */
const GPT_IMAGE_MODEL_IDS = ['gpt-image-1.5'];
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
];

/**
 * 图片参数配置
 * 根据 API 文档，size 使用宽高比格式（如 16x9），API 会自动转换为对应像素
 * 'auto' 表示不传尺寸参数，让模型自动决定
 */
export const IMAGE_PARAMS: ParamConfig[] = [
  // GPT 图片模型尺寸（仅支持有限尺寸）
  {
    id: 'size',
    label: '图片尺寸',
    shortLabel: '尺寸',
    description: '生成图片的尺寸比例',
    valueType: 'enum',
    options: [
      { value: 'auto', label: '自动' },
      { value: '1x1', label: '1:1 方形' },
      { value: '3x2', label: '3:2 横版' },
      { value: '2x3', label: '2:3 竖版' },
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
    compatibleModels: MJ_IMAGE_MODEL_IDS,
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
      { value: '7', label: 'V7' },
      { value: '6', label: 'V6' },
    ],
    defaultValue: 'default',
    compatibleModels: MJ_IMAGE_MODEL_IDS,
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
    compatibleModels: MJ_IMAGE_MODEL_IDS,
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
    compatibleModels: MJ_IMAGE_MODEL_IDS,
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
    compatibleModels: MJ_IMAGE_MODEL_IDS,
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
    compatibleModels: MJ_IMAGE_MODEL_IDS,
    modelType: 'image',
  },
];

/**
 * 所有参数配置
 */
export const ALL_PARAMS: ParamConfig[] = [...VIDEO_PARAMS, ...IMAGE_PARAMS];

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
  // 这里不再自动按 doubao 分类，避免与 seedream 重复；若需要可通过 tags 显式声明

  return ALL_PARAMS.filter((param) => {
    // 检查模型类型是否匹配
    if (param.modelType !== modelConfig.type) return false;
    // 检查是否在兼容 ID 列表（空数组表示所有模型都兼容）
    const idMatched =
      param.compatibleModels.length === 0 ||
      param.compatibleModels.includes(modelId);
    // 检查标签兼容（可选）
    const tagMatched = param.compatibleTags
      ? param.compatibleTags.some((tag) => modelTags.has(tag.toLowerCase()))
      : false;
    return idMatched || tagMatched;
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
