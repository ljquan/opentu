import { ModelVendor, type ModelConfig } from '../constants/model-config';

export type SunoAliasAvailability = 'supported' | 'advanced';

export interface SunoModelAliasDefinition {
  modelId: string;
  entryModelId: string;
  label: string;
  shortLabel?: string;
  description: string;
  tags?: string[];
  forcedParams?: Record<string, string>;
  availability: SunoAliasAvailability;
}

const SHARED_SUNO_TAGS = ['suno', 'audio', 'music'];

const SUNO_MODEL_ALIASES: Record<string, SunoModelAliasDefinition> = {
  suno_music: {
    modelId: 'suno_music',
    entryModelId: 'suno_music',
    label: 'Suno Music',
    shortLabel: 'Suno 音乐',
    description: 'Suno 音乐生成入口',
    tags: SHARED_SUNO_TAGS,
    availability: 'supported',
  },
  suno_lyrics: {
    modelId: 'suno_lyrics',
    entryModelId: 'suno_music',
    label: 'Suno Lyrics',
    shortLabel: 'Suno 歌词',
    description: 'Suno 歌词生成入口，默认走 lyrics 提交链路',
    tags: [...SHARED_SUNO_TAGS, 'lyrics'],
    forcedParams: {
      sunoAction: 'lyrics',
    },
    availability: 'supported',
  },
  'suno-continue': {
    modelId: 'suno-continue',
    entryModelId: 'suno_music',
    label: 'Suno Continue',
    shortLabel: 'Suno 续写',
    description: 'Suno 已有 clip 续写入口',
    tags: [...SHARED_SUNO_TAGS, 'continuation'],
    forcedParams: {
      sunoAction: 'music',
      continueSource: 'clip',
    },
    availability: 'supported',
  },
  'suno-continue-uploaded': {
    modelId: 'suno-continue-uploaded',
    entryModelId: 'suno_music',
    label: 'Suno Continue Uploaded',
    shortLabel: 'Suno 上传续写',
    description: 'Suno 上传音频续写入口',
    tags: [...SHARED_SUNO_TAGS, 'continuation', 'upload'],
    forcedParams: {
      sunoAction: 'music',
      continueSource: 'upload',
    },
    availability: 'supported',
  },
  suno_concat: {
    modelId: 'suno_concat',
    entryModelId: 'suno_music',
    label: 'Suno Concat',
    shortLabel: 'Suno 拼接',
    description: 'Suno 高级拼接能力，当前未接入主生成流程',
    tags: [...SHARED_SUNO_TAGS, 'advanced'],
    availability: 'advanced',
  },
  suno_uploads: {
    modelId: 'suno_uploads',
    entryModelId: 'suno_music',
    label: 'Suno Uploads',
    shortLabel: 'Suno 上传',
    description: 'Suno 上传类能力，当前未接入主生成流程',
    tags: [...SHARED_SUNO_TAGS, 'advanced', 'upload'],
    availability: 'advanced',
  },
  'suno-all-stems': {
    modelId: 'suno-all-stems',
    entryModelId: 'suno_music',
    label: 'Suno All Stems',
    shortLabel: 'Suno Stems',
    description: 'Suno stems 导出能力，当前未接入主生成流程',
    tags: [...SHARED_SUNO_TAGS, 'advanced', 'stems'],
    availability: 'advanced',
  },
  suno_persona_create: {
    modelId: 'suno_persona_create',
    entryModelId: 'suno_music',
    label: 'Suno Persona Create',
    shortLabel: 'Suno Persona',
    description: 'Suno persona 创建能力，当前未接入主生成流程',
    tags: [...SHARED_SUNO_TAGS, 'advanced', 'persona'],
    availability: 'advanced',
  },
  suno_act_tags: {
    modelId: 'suno_act_tags',
    entryModelId: 'suno_music',
    label: 'Suno Act Tags',
    shortLabel: 'Suno 标签',
    description: 'Suno 标签类能力，当前未接入主生成流程',
    tags: [...SHARED_SUNO_TAGS, 'advanced', 'analysis'],
    availability: 'advanced',
  },
  suno_act_timing: {
    modelId: 'suno_act_timing',
    entryModelId: 'suno_music',
    label: 'Suno Act Timing',
    shortLabel: 'Suno Timing',
    description: 'Suno 时间点分析能力，当前未接入主生成流程',
    tags: [...SHARED_SUNO_TAGS, 'advanced', 'analysis'],
    availability: 'advanced',
  },
  suno_act_wav: {
    modelId: 'suno_act_wav',
    entryModelId: 'suno_music',
    label: 'Suno Act WAV',
    shortLabel: 'Suno WAV',
    description: 'Suno WAV 处理能力，当前未接入主生成流程',
    tags: [...SHARED_SUNO_TAGS, 'advanced', 'analysis'],
    availability: 'advanced',
  },
};

function normalizeModelId(modelId?: string | null): string {
  return typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
}

export function isSunoLikeModelId(modelId?: string | null): boolean {
  const normalized = normalizeModelId(modelId);
  return normalized.includes('suno') || normalized.includes('chirp');
}

export function getSunoModelAlias(
  modelId?: string | null
): SunoModelAliasDefinition | null {
  const normalized = normalizeModelId(modelId);
  return SUNO_MODEL_ALIASES[normalized] || null;
}

export function getForcedSunoParams(
  modelId?: string | null
): Record<string, string> {
  const forcedParams = getSunoModelAlias(modelId)?.forcedParams;
  return forcedParams ? { ...forcedParams } : {};
}

export function applyForcedSunoParams(
  modelId: string,
  params: Record<string, string>
): Record<string, string> {
  const forcedParams = getForcedSunoParams(modelId);
  if (Object.keys(forcedParams).length === 0) {
    return params;
  }
  return {
    ...params,
    ...forcedParams,
  };
}

export function applySunoAliasPresentation(model: ModelConfig): ModelConfig {
  const alias = getSunoModelAlias(model.id);
  const shouldAddSharedTags =
    isSunoLikeModelId(model.id) || !!alias?.tags?.some(Boolean);
  if (!alias && !shouldAddSharedTags) {
    return model;
  }

  const nextTags = Array.from(
    new Set([
      ...(model.tags || []),
      ...(shouldAddSharedTags ? SHARED_SUNO_TAGS : []),
      ...(alias?.tags || []),
    ])
  );

  return {
    ...model,
    vendor: ModelVendor.SUNO,
    label: alias?.label || model.label,
    shortLabel: alias?.shortLabel || model.shortLabel,
    description: alias?.description || model.description,
    tags: nextTags,
  };
}
