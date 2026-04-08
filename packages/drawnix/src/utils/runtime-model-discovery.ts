import {
  type ModelConfig,
  type ModelType,
  ModelVendor,
  VENDOR_NAMES,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_AUDIO_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_TEXT_MODEL_ID,
  getModelsByType,
  getStaticModelsByType,
  getStaticModelConfig,
  setRuntimeModelConfigs,
} from '../constants/model-config';
import { normalizeApiBase } from '../services/media-api/utils';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  providerCatalogsSettings,
  invocationPresetsSettings,
  providerProfilesSettings,
  settingsManager,
  type ProviderCatalog,
  type ModelRef,
  type ProviderProfile,
} from './settings-manager';
import { applySunoAliasPresentation, isSunoLikeModelId } from './suno-model-aliases';

const LEGACY_CACHE_KEY = 'drawnix-runtime-model-discovery';

export interface RemoteModelListItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  supported_endpoint_types?: string[];
}

export interface RuntimeModelDiscoveryState {
  profileId: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  sourceBaseUrl: string;
  signature: string;
  discoveredAt: number | null;
  discoveredModels: ModelConfig[];
  selectedModelIds: string[];
  models: ModelConfig[];
  error: string | null;
}

interface LegacyPersistedRuntimeModelDiscoveryState {
  sourceBaseUrl: string;
  signature: string;
  discoveredAt: number;
  discoveredModels: ModelConfig[];
  selectedModelIds: string[];
}

function createDefaultState(profileId: string): RuntimeModelDiscoveryState {
  return {
    profileId,
    status: 'idle',
    sourceBaseUrl: '',
    signature: '',
    discoveredAt: null,
    discoveredModels: [],
    selectedModelIds: [],
    models: [],
    error: null,
  };
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(16);
}

export function normalizeModelApiBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim();
  const fallback = 'https://api.tu-zi.com/v1';
  if (!trimmed) return fallback;

  let normalized = trimmed.replace(/\/+$/, '');
  normalized = normalized.replace(/\/models$/i, '');
  if (!/\/v1$/i.test(normalized)) {
    normalized = `${normalizeApiBase(normalized)}/v1`;
  }
  return normalized;
}

function buildDiscoverySignature(baseUrl: string, apiKey: string): string {
  return `${normalizeModelApiBaseUrl(baseUrl)}::${hashString(apiKey.trim())}`;
}

function extractDiscoveryErrorMessage(
  rawText: string,
  fallbackMessage: string
): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      message?: string;
      error?:
        | string
        | {
            message?: string;
            details?: string;
          };
      detail?: string;
    };
    const nestedError =
      typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error?.message || parsed.error?.details;

    return parsed.message || nestedError || parsed.detail || fallbackMessage;
  } catch {
    const singleLineText = trimmed.replace(/\s+/g, ' ');
    return singleLineText.slice(0, 120) || fallbackMessage;
  }
}

type InferencePattern = string | RegExp;

function matchesPattern(value: string, pattern: InferencePattern): boolean {
  return typeof pattern === 'string'
    ? value.includes(pattern)
    : pattern.test(value);
}

function matchesAnyPattern(
  value: string,
  patterns: readonly InferencePattern[]
): boolean {
  return patterns.some((pattern) => matchesPattern(value, pattern));
}

function hasAnyEndpointHint(
  endpointHints: string[],
  patterns: readonly InferencePattern[]
): boolean {
  return endpointHints.some((hint) => matchesAnyPattern(hint, patterns));
}

function inferVendorByKeywords(modelId: string): ModelVendor {
  const lowerId = modelId.toLowerCase();
  const openAIPattern =
    /(^|[^a-z0-9])(o1|o3|o4|o4-mini|gpt-4o|gpt-4\.1|chatgpt)([^a-z0-9]|$)/;
  if (lowerId.includes('flux')) return ModelVendor.FLUX;
  if (lowerId.startsWith('mj') || lowerId.includes('midjourney'))
    return ModelVendor.MIDJOURNEY;
  if (
    lowerId.includes('grok') ||
    lowerId.includes('xai') ||
    lowerId.includes('supergrok')
  ) {
    return ModelVendor.GROK;
  }
  if (
    lowerId.includes('qwen') ||
    lowerId.includes('qwq') ||
    lowerId.includes('qvq') ||
    lowerId.includes('wanx')
  ) {
    return ModelVendor.QWEN;
  }
  if (
    lowerId.includes('glm') ||
    lowerId.includes('zhipu') ||
    lowerId.includes('bigmodel') ||
    lowerId.includes('cogview') ||
    lowerId.includes('cogvideo')
  ) {
    return ModelVendor.GLM;
  }
  if (
    lowerId.includes('minimax') ||
    lowerId.includes('abab') ||
    lowerId.includes('hailuo') ||
    lowerId.includes('speech-02') ||
    lowerId.includes('music-01')
  ) {
    return ModelVendor.MINIMAX;
  }
  if (
    lowerId.includes('mistral') ||
    lowerId.includes('mixtral') ||
    lowerId.includes('pixtral') ||
    lowerId.includes('ministral') ||
    lowerId.includes('codestral')
  ) {
    return ModelVendor.MISTRAL;
  }
  if (
    lowerId.includes('runway') ||
    lowerId.includes('runwayml') ||
    /^gen[-_]?3/.test(lowerId) ||
    /^gen[-_]?4/.test(lowerId)
  ) {
    return ModelVendor.RUNWAY;
  }
  if (lowerId.includes('pika')) {
    return ModelVendor.PIKA;
  }
  if (
    lowerId.includes('llama') ||
    lowerId.includes('meta-llama') ||
    lowerId.includes('llama3') ||
    lowerId.includes('llama-3') ||
    lowerId.includes('llama-4')
  ) {
    return ModelVendor.LLAMA;
  }
  if (
    lowerId.includes('hunyuan') ||
    lowerId.includes('hunyuan-video') ||
    lowerId.includes('hunyuanimage') ||
    lowerId.includes('hunyuan-image')
  ) {
    return ModelVendor.HUNYUAN;
  }
  if (
    lowerId.includes('stepfun') ||
    lowerId.includes('jieyue') ||
    /^step[-_]?1/.test(lowerId) ||
    lowerId.startsWith('step-')
  ) {
    return ModelVendor.STEPFUN;
  }
  if (
    lowerId.includes('claude') ||
    lowerId.includes('sonnet') ||
    lowerId.includes('haiku') ||
    lowerId.includes('opus')
  ) {
    return ModelVendor.ANTHROPIC;
  }
  if (lowerId.includes('deepseek')) return ModelVendor.DEEPSEEK;
  if (lowerId.includes('kling')) return ModelVendor.KLING;
  if (lowerId.includes('veo')) return ModelVendor.VEO;
  if (lowerId.includes('sora')) return ModelVendor.SORA;
  if (lowerId.includes('suno') || lowerId.includes('chirp')) {
    return ModelVendor.SUNO;
  }
  if (
    lowerId.includes('seedream') ||
    lowerId.includes('seedance') ||
    lowerId.includes('doubao') ||
    lowerId.includes('jimeng')
  ) {
    return ModelVendor.DOUBAO;
  }
  if (
    lowerId.includes('gpt') ||
    lowerId.includes('openai') ||
    lowerId.includes('dall-e') ||
    lowerId.includes('whisper') ||
    lowerId.includes('codex') ||
    lowerId.includes('text-embedding') ||
    lowerId.includes('omni') ||
    lowerId.includes('tts-') ||
    lowerId.includes('babbage') ||
    lowerId.includes('davinci') ||
    lowerId.includes('computer-use') ||
    openAIPattern.test(lowerId)
  ) {
    return ModelVendor.GPT;
  }
  if (
    lowerId.includes('gemini') ||
    lowerId.includes('banana') ||
    lowerId.includes('gemma') ||
    lowerId.includes('imagen') ||
    lowerId.includes('learnlm')
  ) {
    return ModelVendor.GEMINI;
  }
  if (lowerId.includes('google')) return ModelVendor.GOOGLE;
  return ModelVendor.OTHER;
}

function inferVendor(model: RemoteModelListItem): ModelVendor {
  const owner = (model.owned_by || '').trim().toLowerCase();
  const keywordVendor = inferVendorByKeywords(model.id);
  if (owner === 'openai' || owner.includes('openai')) return ModelVendor.GPT;
  if (owner === 'xai' || owner.includes('x.ai') || owner.includes('grok')) {
    return ModelVendor.GROK;
  }
  if (
    owner === 'qwen' ||
    owner.includes('alibaba') ||
    owner.includes('dashscope') ||
    owner.includes('tongyi')
  ) {
    return ModelVendor.QWEN;
  }
  if (
    owner === 'zhipu' ||
    owner.includes('zhipu') ||
    owner.includes('bigmodel') ||
    owner.includes('glm')
  ) {
    return ModelVendor.GLM;
  }
  if (
    owner === 'minimax' ||
    owner.includes('minimax') ||
    owner.includes('abab') ||
    owner.includes('hailuo')
  ) {
    return ModelVendor.MINIMAX;
  }
  if (owner === 'mistral' || owner.includes('mistral')) {
    return ModelVendor.MISTRAL;
  }
  if (
    owner === 'runway' ||
    owner.includes('runway') ||
    owner.includes('runwayml')
  ) {
    return ModelVendor.RUNWAY;
  }
  if (owner === 'pika' || owner.includes('pika')) {
    return ModelVendor.PIKA;
  }
  if (owner === 'meta' || owner.includes('meta') || owner.includes('llama')) {
    return ModelVendor.LLAMA;
  }
  if (
    owner === 'hunyuan' ||
    owner.includes('hunyuan') ||
    owner.includes('tencent')
  ) {
    return ModelVendor.HUNYUAN;
  }
  if (
    owner === 'stepfun' ||
    owner.includes('stepfun') ||
    owner.includes('jieyue')
  ) {
    return ModelVendor.STEPFUN;
  }
  if (owner === 'deepseek' || owner.includes('deepseek'))
    return ModelVendor.DEEPSEEK;
  if (
    owner === 'anthropic' ||
    owner === 'claude' ||
    owner.includes('anthropic') ||
    owner.includes('claude')
  ) {
    return ModelVendor.ANTHROPIC;
  }
  if (
    owner === 'volcengine' ||
    owner === 'doubao-video' ||
    owner === 'doubao' ||
    owner.includes('volc') ||
    owner.includes('doubao')
  ) {
    return ModelVendor.DOUBAO;
  }
  if (owner === 'suno' || owner.includes('suno') || owner.includes('chirp')) {
    return ModelVendor.SUNO;
  }
  if (owner === 'google' || owner.includes('google')) {
    return keywordVendor !== ModelVendor.OTHER
      ? keywordVendor
      : ModelVendor.GOOGLE;
  }
  if (
    owner === 'vertex-ai' ||
    owner.includes('vertex') ||
    owner.includes('gemini')
  ) {
    return keywordVendor !== ModelVendor.OTHER
      ? keywordVendor
      : ModelVendor.GOOGLE;
  }
  if (owner === 'custom') {
    return keywordVendor;
  }
  return keywordVendor;
}

function inferModelType(model: RemoteModelListItem): ModelType {
  const endpointHints = (model.supported_endpoint_types || [])
    .map((item) => item.toLowerCase())
    .filter(Boolean);
  const lowerId = model.id.toLowerCase();
  const vendor = inferVendor(model);
  const hasVideoIdSignal = (...extraPatterns: InferencePattern[]) =>
    matchesAnyPattern(lowerId, [
      /(^|[^a-z0-9])t2v([^a-z0-9]|$)/,
      /(^|[^a-z0-9])i2v([^a-z0-9]|$)/,
      'video',
      ...extraPatterns,
    ]);
  const hasImageIdSignal = (...extraPatterns: InferencePattern[]) =>
    matchesAnyPattern(lowerId, [
      /(^|[^a-z0-9])t2i([^a-z0-9]|$)/,
      /(^|[^a-z0-9])i2i([^a-z0-9]|$)/,
      'image',
      ...extraPatterns,
    ]);
  const hasAudioIdSignal = (...extraPatterns: InferencePattern[]) =>
    matchesAnyPattern(lowerId, [
      'audio',
      'music',
      'suno',
      'chirp',
      'lyrics',
      'midi',
      'stems',
      ...extraPatterns,
    ]);

  const hasId = (...patterns: InferencePattern[]) =>
    matchesAnyPattern(lowerId, patterns);
  const hasHint = (...patterns: InferencePattern[]) =>
    hasAnyEndpointHint(endpointHints, patterns);

  if (
    hasHint(
      'audio',
      'music',
      'audio_generation',
      'music-generation',
      'lyrics',
      'stems',
      'midi'
    )
  ) {
    return 'audio';
  }

  if (
    hasHint(
      'video',
      'videos',
      'video_generation',
      'video-generation',
      'videos.generate',
      'video/generations',
      'text-to-video',
      'image-to-video',
      't2v',
      'i2v',
      'video-edit',
      'video_edit'
    )
  ) {
    return 'video';
  }

  if (
    hasHint(
      'image',
      'images',
      'image_generation',
      'image-generation',
      'images.generate',
      'image/generations',
      'image-edit',
      'image_edit',
      'images.edit',
      'text-to-image',
      'image-to-image',
      't2i',
      'i2i'
    )
  ) {
    return 'image';
  }

  switch (vendor) {
    case ModelVendor.FLUX:
    case ModelVendor.MIDJOURNEY:
      return 'image';
    case ModelVendor.SORA:
    case ModelVendor.VEO:
      return 'video';
    case ModelVendor.RUNWAY:
      if (
        hasImageIdSignal(
          'frame',
          'keyframe',
          'reference-image',
          'image-to-video'
        )
      ) {
        return 'image';
      }
      return 'video';
    case ModelVendor.PIKA:
      if (
        hasImageIdSignal(
          'pikadditions',
          'pikaswaps',
          'pikascenes',
          'reference-image'
        )
      ) {
        return 'image';
      }
      return 'video';
    case ModelVendor.KLING:
      if (
        hasImageIdSignal(
          'kling_image',
          'kling-image',
          'img',
          'picture',
          'photo',
          'poster',
          'design'
        )
      ) {
        return 'image';
      }
      if (hasVideoIdSignal('kling_video', 'kling-video', 'motion', 'animate')) {
        return 'video';
      }
      return 'video';
    case ModelVendor.GLM:
      if (hasId('cogvideo')) return 'video';
      if (hasId('cogview')) return 'image';
      break;
    case ModelVendor.MINIMAX:
      if (
        hasId(
          'hailuo',
          /(^|[^a-z0-9])video[-_]?0\d/,
          'video-01',
          'video-02',
          'minimax-video',
          'abab-video'
        )
      ) {
        return 'video';
      }
      if (
        hasId(
          'image-01',
          'image-02',
          'minimax-image',
          'abab-image',
          'visual-generation'
        )
      ) {
        return 'image';
      }
      break;
    case ModelVendor.DOUBAO:
      if (hasId('seedance')) return 'video';
      if (hasId('seedream', 'jimeng')) return 'image';
      break;
    case ModelVendor.HUNYUAN:
      if (
        hasVideoIdSignal('hunyuan-video', 'tencent-video', 'video-generation')
      ) {
        return 'video';
      }
      if (hasImageIdSignal('hunyuan-image', 'hunyuanimage', 'vision')) {
        return 'image';
      }
      break;
    case ModelVendor.QWEN:
      if (
        hasId(
          'wanx',
          /(^|[^a-z0-9])wan([0-9.-]|$)/,
          /(^|[^a-z0-9])wan2([^a-z0-9]|$)/
        ) &&
        hasVideoIdSignal('wan-video', 'wanx-video', 'animate', 'motion')
      ) {
        return 'video';
      }
      if (
        hasId(
          'wanx',
          /(^|[^a-z0-9])wan([0-9.-]|$)/,
          /(^|[^a-z0-9])wan2([^a-z0-9]|$)/
        ) &&
        hasImageIdSignal('wanx-image', 'wan-image', 'poster', 'illustration')
      ) {
        return 'image';
      }
      if (hasId('wanx')) return 'image';
      if (
        hasId(/(^|[^a-z0-9])wan([0-9.-]|$)/, /(^|[^a-z0-9])wan2([^a-z0-9]|$)/)
      ) {
        return 'video';
      }
      break;
    case ModelVendor.GEMINI:
    case ModelVendor.GOOGLE:
      if (hasId('veo')) return 'video';
      if (hasId('imagen', 'gpt-image')) return 'image';
      break;
    case ModelVendor.SUNO:
      return 'audio';
    case ModelVendor.OTHER:
      if (hasAudioIdSignal()) {
        return 'audio';
      }
      break;
    default:
      break;
  }

  const isVideo =
    hasId('sora-2') ||
    lowerId.includes('veo') ||
    lowerId.includes('sora') ||
    lowerId.includes('runway') ||
    lowerId.includes('gen-3') ||
    lowerId.includes('gen3') ||
    lowerId.includes('gen-4') ||
    lowerId.includes('gen4') ||
    lowerId.includes('pika') ||
    lowerId.includes('kling') ||
    lowerId.includes('hunyuan-video') ||
    lowerId.includes('cogvideo') ||
    lowerId.includes('seedance') ||
    lowerId.includes('t2v') ||
    lowerId.includes('i2v') ||
    lowerId.includes('video');
  if (isVideo) return 'video';

  const isImage =
    hasHint('banana') ||
    lowerId.includes('image') ||
    lowerId.includes('banana') ||
    lowerId.includes('flux') ||
    lowerId.startsWith('mj') ||
    lowerId.includes('midjourney') ||
    lowerId.includes('cogview') ||
    lowerId.includes('hunyuan-image') ||
    lowerId.includes('hunyuanimage') ||
    lowerId.includes('seedream') ||
    lowerId.includes('jimeng') ||
    lowerId.includes('imagen') ||
    lowerId.includes('gpt-image');
  if (isImage) return 'image';

  const isAudio =
    lowerId.includes('suno') ||
    lowerId.includes('chirp') ||
    lowerId.includes('music') ||
    lowerId.includes('lyrics') ||
    lowerId.includes('midi') ||
    lowerId.includes('stems') ||
    lowerId.includes('remix') ||
    lowerId.includes('infill');
  if (isAudio) return 'audio';

  return 'text';
}

function buildShortCode(modelId: string, type: ModelType): string {
  const compact = modelId
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => part[0]?.toLowerCase() || '')
    .join('');
  if (compact) return compact.slice(0, 6);
  if (type === 'audio') return 'aud';
  if (type === 'video') return 'vid';
  if (type === 'text') return 'txt';
  return 'img';
}

function buildFallbackConfig(model: RemoteModelListItem): ModelConfig {
  const type = inferModelType(model);
  const vendor = inferVendor(model);
  const vendorLabel = VENDOR_NAMES[vendor];
  const lowerId = model.id.toLowerCase();
  const supportsTools =
    type === 'text' &&
    (model.supported_endpoint_types || []).some((item) =>
      item.toLowerCase().includes('openai-chat')
    );

  if (model.id.toLowerCase() === 'kling_video') {
    return {
      id: model.id,
      label: 'Kling',
      shortLabel: 'Kling',
      shortCode: buildShortCode(model.id, 'video'),
      description: 'Kling 标准视频能力，版本通过 model_name 选择',
      type: 'video',
      vendor: ModelVendor.KLING,
      supportsTools: false,
      tags: ['runtime', 'kling'],
      videoDefaults: { duration: '5', size: '1280x720', aspectRatio: '16:9' },
    };
  }

  const fallbackConfig: ModelConfig = {
    id: model.id,
    label: model.id,
    shortLabel: model.id,
    shortCode: buildShortCode(model.id, type),
    description: `${vendorLabel} ${
      type === 'image'
        ? '图片模型'
        : type === 'video'
        ? '视频模型'
        : type === 'audio'
        ? '音频模型'
        : '文本模型'
    }`,
    type,
    vendor,
    supportsTools,
    tags:
      type === 'audio' && isSunoLikeModelId(lowerId)
        ? ['runtime', 'suno', 'audio', 'music']
        : ['runtime'],
    imageDefaults:
      type === 'image'
        ? { aspectRatio: 'auto', width: 1024, height: 1024 }
        : undefined,
    videoDefaults:
      type === 'video'
        ? { duration: '8', size: '1280x720', aspectRatio: '16:9' }
        : undefined,
  };

  return type === 'audio'
    ? applySunoAliasPresentation(fallbackConfig)
    : fallbackConfig;
}

function adaptRuntimeModel(model: RemoteModelListItem): ModelConfig | null {
  if (!model?.id || typeof model.id !== 'string') {
    return null;
  }

  const staticConfig = getStaticModelConfig(model.id);
  if (staticConfig) {
    return {
      ...staticConfig,
      tags: staticConfig.tags ? [...staticConfig.tags] : undefined,
    };
  }

  return buildFallbackConfig(model);
}

function normalizeSelectedModelIds(
  discoveredModels: ModelConfig[],
  modelIds: string[]
): string[] {
  const knownIds = new Set(discoveredModels.map((model) => model.id));
  return Array.from(
    new Set(modelIds.filter((modelId) => knownIds.has(modelId)))
  );
}

function buildSelectedModels(
  discoveredModels: ModelConfig[],
  selectedModelIds: string[]
): ModelConfig[] {
  return discoveredModels.filter((model) =>
    selectedModelIds.includes(model.id)
  );
}

function mergeModels(
  staticModels: ModelConfig[],
  runtimeModels: ModelConfig[]
): ModelConfig[] {
  const merged = [...runtimeModels];
  const seen = new Set(runtimeModels.map((model) => model.id));
  for (const model of staticModels) {
    if (!seen.has(model.id)) {
      merged.push(model);
    }
  }
  return merged;
}

function ensureRuntimeTag(tags?: string[]): string[] {
  const nextTags = Array.isArray(tags) ? [...tags] : [];
  if (!nextTags.includes('runtime')) {
    nextTags.push('runtime');
  }
  return nextTags;
}

function buildSelectionKey(
  profileId: string | null | undefined,
  modelId: string
): string {
  return profileId ? `${profileId}::${modelId}` : modelId;
}

function getProfileById(profileId: string): ProviderProfile | null {
  return (
    providerProfilesSettings
      .get()
      .find((profile) => profile.id === profileId) || null
  );
}

function isProfileEnabled(profileId: string): boolean {
  if (profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID) {
    return true;
  }

  return getProfileById(profileId)?.enabled !== false;
}

function attachRuntimeSource(
  profileId: string,
  model: ModelConfig
): ModelConfig {
  const profileName = getProfileById(profileId)?.name || null;
  return {
    ...model,
    tags: ensureRuntimeTag(model.tags),
    sourceProfileId: profileId,
    sourceProfileName: profileName,
    selectionKey: buildSelectionKey(profileId, model.id),
  };
}

function decorateRuntimeModels(
  profileId: string,
  models: ModelConfig[]
): ModelConfig[] {
  return models.map((model) => attachRuntimeSource(profileId, model));
}

function decorateStaticModels(models: ModelConfig[]): ModelConfig[] {
  return models.map((model) => ({
    ...model,
    selectionKey: model.selectionKey || buildSelectionKey(null, model.id),
  }));
}

function createPinnedRuntimeModel(
  profileId: string,
  modelId: string,
  type: ModelType
): ModelConfig {
  const profileName = getProfileById(profileId)?.name || '供应商模型';
  const vendor = inferVendorByKeywords(modelId);
  return attachRuntimeSource(profileId, {
    id: modelId,
    label: modelId,
    shortLabel: modelId,
    shortCode: buildShortCode(modelId, type),
    description: `${profileName} · ${modelId}`,
    type,
    vendor,
  });
}

function createStateFromCatalog(
  catalog: ProviderCatalog
): RuntimeModelDiscoveryState {
  const discoveredModels = decorateRuntimeModels(
    catalog.profileId,
    Array.isArray(catalog.discoveredModels) ? catalog.discoveredModels : []
  );
  const selectedModelIds = normalizeSelectedModelIds(
    discoveredModels,
    Array.isArray(catalog.selectedModelIds) ? catalog.selectedModelIds : []
  );
  const models = buildSelectedModels(discoveredModels, selectedModelIds);

  return {
    profileId: catalog.profileId,
    status: catalog.error
      ? 'error'
      : discoveredModels.length > 0
      ? 'ready'
      : 'idle',
    sourceBaseUrl: catalog.sourceBaseUrl || '',
    signature: catalog.signature || '',
    discoveredAt: Number.isFinite(catalog.discoveredAt)
      ? catalog.discoveredAt
      : null,
    discoveredModels,
    selectedModelIds,
    models,
    error: catalog.error || null,
  };
}

function toCatalog(state: RuntimeModelDiscoveryState): ProviderCatalog {
  return {
    profileId: state.profileId,
    discoveredAt: state.discoveredAt,
    discoveredModels: state.discoveredModels,
    selectedModelIds: state.selectedModelIds,
    sourceBaseUrl: state.sourceBaseUrl || undefined,
    signature: state.signature || undefined,
    error: state.error,
  };
}

function loadLegacyPersistedState(): RuntimeModelDiscoveryState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LegacyPersistedRuntimeModelDiscoveryState;
    if (!parsed || !Array.isArray(parsed.discoveredModels)) return null;

    const discoveredModels = decorateRuntimeModels(
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      parsed.discoveredModels
    );
    const selectedModelIds = normalizeSelectedModelIds(
      discoveredModels,
      Array.isArray(parsed.selectedModelIds) ? parsed.selectedModelIds : []
    );

    return {
      profileId: LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      status: 'ready',
      sourceBaseUrl: parsed.sourceBaseUrl || '',
      signature: parsed.signature || '',
      discoveredAt: Number.isFinite(parsed.discoveredAt)
        ? parsed.discoveredAt
        : Date.now(),
      discoveredModels,
      selectedModelIds,
      models: buildSelectedModels(discoveredModels, selectedModelIds),
      error: null,
    };
  } catch {
    return null;
  }
}

function removeLegacyPersistedState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    // ignore cache cleanup errors
  }
}

class RuntimeModelDiscoveryStore {
  private catalogStates = new Map<string, RuntimeModelDiscoveryState>();
  private listeners = new Set<() => void>();

  constructor() {
    this.catalogStates = this.loadCatalogStatesFromSettings();
    this.migrateLegacyCacheIfNeeded();
    this.syncRuntimeModelConfigs();

    providerCatalogsSettings.addListener(this.handleCatalogSettingsChange);
    invocationPresetsSettings.addListener(this.handlePresetSettingsChange);
    settingsManager.addListener(
      'activePresetId',
      this.handleActivePresetIdChange
    );
  }

  private loadCatalogStatesFromSettings(): Map<
    string,
    RuntimeModelDiscoveryState
  > {
    const states = new Map<string, RuntimeModelDiscoveryState>();
    for (const catalog of providerCatalogsSettings.get()) {
      states.set(catalog.profileId, createStateFromCatalog(catalog));
    }
    if (!states.has(LEGACY_DEFAULT_PROVIDER_PROFILE_ID)) {
      states.set(
        LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
        createDefaultState(LEGACY_DEFAULT_PROVIDER_PROFILE_ID)
      );
    }
    return states;
  }

  private migrateLegacyCacheIfNeeded(): void {
    const legacyState = loadLegacyPersistedState();
    if (!legacyState) {
      return;
    }

    const currentState = this.catalogStates.get(
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );
    const hasCatalogData =
      !!currentState &&
      (currentState.discoveredModels.length > 0 ||
        currentState.selectedModelIds.length > 0);

    if (hasCatalogData) {
      removeLegacyPersistedState();
      return;
    }

    this.catalogStates.set(LEGACY_DEFAULT_PROVIDER_PROFILE_ID, legacyState);
    void this.persistCatalogs();
    removeLegacyPersistedState();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private handleCatalogSettingsChange = (catalogs: ProviderCatalog[]): void => {
    const nextStates = new Map<string, RuntimeModelDiscoveryState>();
    for (const catalog of catalogs) {
      nextStates.set(catalog.profileId, createStateFromCatalog(catalog));
    }
    if (!nextStates.has(LEGACY_DEFAULT_PROVIDER_PROFILE_ID)) {
      nextStates.set(
        LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
        createDefaultState(LEGACY_DEFAULT_PROVIDER_PROFILE_ID)
      );
    }
    this.catalogStates = nextStates;
    this.syncRuntimeModelConfigs();
    this.emit();
  };

  private handlePresetSettingsChange = (): void => {
    this.syncRuntimeModelConfigs();
    this.emit();
  };

  private handleActivePresetIdChange = (): void => {
    this.syncRuntimeModelConfigs();
    this.emit();
  };

  private async persistCatalogs(): Promise<void> {
    const catalogs = Array.from(this.catalogStates.values()).map(toCatalog);
    await providerCatalogsSettings.update(catalogs);
  }

  private setCatalogState(
    profileId: string,
    state: RuntimeModelDiscoveryState,
    persist = true
  ): void {
    this.catalogStates.set(profileId, {
      ...state,
      profileId,
      selectedModelIds: normalizeSelectedModelIds(
        state.discoveredModels,
        state.selectedModelIds
      ),
      models: buildSelectedModels(
        state.discoveredModels,
        normalizeSelectedModelIds(
          state.discoveredModels,
          state.selectedModelIds
        )
      ),
    });

    this.syncRuntimeModelConfigs();
    if (persist) {
      void this.persistCatalogs();
    }
    this.emit();
  }

  private getCatalogState(profileId: string): RuntimeModelDiscoveryState {
    return this.catalogStates.get(profileId) || createDefaultState(profileId);
  }

  private resolveRuntimeModels(): ModelConfig[] {
    const seen = new Set<string>();
    const models: ModelConfig[] = [];

    for (const catalogState of this.catalogStates.values()) {
      for (const model of catalogState.models) {
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(model);
      }
    }

    return models;
  }

  private syncRuntimeModelConfigs(): void {
    setRuntimeModelConfigs(this.resolveRuntimeModels());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  ): RuntimeModelDiscoveryState {
    return this.getCatalogState(profileId);
  }

  getCatalogs(profileIds?: string[]): ProviderCatalog[] {
    const profileIdSet = profileIds ? new Set(profileIds) : null;

    return Array.from(this.catalogStates.values())
      .filter((state) => !profileIdSet || profileIdSet.has(state.profileId))
      .map((state) => toCatalog(state));
  }

  getDiscoveredModels(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    type?: ModelType
  ): ModelConfig[] {
    const state = this.getCatalogState(profileId);
    return type
      ? state.discoveredModels.filter((model) => model.type === type)
      : state.discoveredModels;
  }

  getSelectedModelIds(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  ): string[] {
    return [...this.getCatalogState(profileId).selectedModelIds];
  }

  getPreferredModels(type: ModelType): ModelConfig[] {
    return getModelsByType(type);
  }

  getSelectableModels(type: ModelType): ModelConfig[] {
    const runtimeModels: ModelConfig[] = [];
    for (const state of this.catalogStates.values()) {
      if (!isProfileEnabled(state.profileId)) {
        continue;
      }
      runtimeModels.push(
        ...state.models.filter((model) => model.type === type)
      );
    }

    return [
      ...runtimeModels,
      ...decorateStaticModels(getStaticModelsByType(type)),
    ];
  }

  getPinnedSelectableModel(
    type: ModelType,
    modelId?: string | null,
    modelRef?: ModelRef | null
  ): ModelConfig | null {
    if (!modelId) {
      return null;
    }

    const profileId = modelRef?.profileId || null;
    const expectedSelectionKey = buildSelectionKey(profileId, modelId);

    if (profileId) {
      const state = this.catalogStates.get(profileId);
      const directMatch =
        state?.models.find(
          (model) =>
            model.type === type &&
            (model.selectionKey || buildSelectionKey(profileId, model.id)) ===
              expectedSelectionKey
        ) ||
        state?.discoveredModels.find(
          (model) =>
            model.type === type &&
            (model.selectionKey || buildSelectionKey(profileId, model.id)) ===
              expectedSelectionKey
        );

      if (directMatch) {
        return directMatch;
      }

      return createPinnedRuntimeModel(profileId, modelId, type);
    }

    const staticMatch = getStaticModelConfig(modelId);
    if (staticMatch && staticMatch.type === type) {
      return decorateStaticModels([staticMatch])[0];
    }

    for (const state of this.catalogStates.values()) {
      const fallbackMatch =
        state.models.find(
          (model) => model.type === type && model.id === modelId
        ) ||
        state.discoveredModels.find(
          (model) => model.type === type && model.id === modelId
        );

      if (fallbackMatch) {
        return fallbackMatch;
      }
    }

    return null;
  }

  getProfilePreferredModels(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    type: ModelType
  ): ModelConfig[] {
    const state = this.getCatalogState(profileId);
    const runtimeModels = state.models.filter((model) => model.type === type);
    return mergeModels(getStaticModelsByType(type), runtimeModels);
  }

  invalidateIfConfigChanged(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    baseUrl: string,
    apiKey: string
  ): void {
    const state = this.getCatalogState(profileId);
    const signature = buildDiscoverySignature(baseUrl, apiKey);
    if (!state.signature || state.signature === signature) {
      return;
    }
    this.clear(profileId);
  }

  applySelection(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    modelIds: string[]
  ): ModelConfig[] {
    const state = this.getCatalogState(profileId);
    const selectedModelIds = normalizeSelectedModelIds(
      state.discoveredModels,
      modelIds
    );
    const models = buildSelectedModels(
      state.discoveredModels,
      selectedModelIds
    );

    this.setCatalogState(profileId, {
      ...state,
      status: state.discoveredModels.length > 0 ? 'ready' : state.status,
      selectedModelIds,
      models,
      error: null,
    });

    return models;
  }

  clear(profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID): void {
    this.setCatalogState(profileId, createDefaultState(profileId));
    if (profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID) {
      removeLegacyPersistedState();
    }
  }

  async discover(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    baseUrl: string,
    apiKey: string
  ): Promise<ModelConfig[]> {
    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      throw new Error('缺少 API Key');
    }

    const state = this.getCatalogState(profileId);
    const normalizedBaseUrl = normalizeModelApiBaseUrl(baseUrl);
    const signature = buildDiscoverySignature(normalizedBaseUrl, trimmedApiKey);

    this.setCatalogState(
      profileId,
      {
        ...state,
        status: 'loading',
        sourceBaseUrl: normalizedBaseUrl,
        signature,
        error: null,
      },
      false
    );

    const response = await fetch(`${normalizedBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${trimmedApiKey}`,
      },
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(
        extractDiscoveryErrorMessage(
          rawText,
          `获取模型列表失败: HTTP ${response.status}`
        )
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error('模型列表接口未返回有效 JSON');
    }

    const data = (parsed as { data?: unknown }).data;
    if (!Array.isArray(data)) {
      throw new Error('模型列表接口缺少 data 数组');
    }

    const adaptedModels: ModelConfig[] = [];
    const seen = new Set<string>();
    for (const item of data) {
      const adapted = adaptRuntimeModel(item as RemoteModelListItem);
      if (!adapted || seen.has(adapted.id)) {
        continue;
      }
      seen.add(adapted.id);
      adaptedModels.push(attachRuntimeSource(profileId, adapted));
    }

    if (adaptedModels.length === 0) {
      throw new Error('模型列表为空');
    }

    const selectedModelIds =
      state.signature === signature
        ? normalizeSelectedModelIds(adaptedModels, state.selectedModelIds)
        : [];
    const models = buildSelectedModels(adaptedModels, selectedModelIds);

    this.setCatalogState(profileId, {
      profileId,
      status: 'ready',
      sourceBaseUrl: normalizedBaseUrl,
      signature,
      discoveredAt: Date.now(),
      discoveredModels: adaptedModels,
      selectedModelIds,
      models,
      error: null,
    });

    return adaptedModels;
  }

  setError(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    error: string
  ): void {
    const state = this.getCatalogState(profileId);
    this.setCatalogState(profileId, {
      ...state,
      status: 'error',
      error,
    });
  }
}

export const runtimeModelDiscovery = new RuntimeModelDiscoveryStore();

export function getPreferredModels(type: ModelType): ModelConfig[] {
  return runtimeModelDiscovery.getPreferredModels(type);
}

export function getSelectableModels(type: ModelType): ModelConfig[] {
  return runtimeModelDiscovery.getSelectableModels(type);
}

export function getPinnedSelectableModel(
  type: ModelType,
  modelId?: string | null,
  modelRef?: ModelRef | null
): ModelConfig | null {
  return runtimeModelDiscovery.getPinnedSelectableModel(
    type,
    modelId,
    modelRef
  );
}

export function getProfilePreferredModels(
  profileId: string,
  type: ModelType
): ModelConfig[] {
  return runtimeModelDiscovery.getProfilePreferredModels(profileId, type);
}

export function getFallbackDefaultModelId(type: ModelType): string {
  const preferred = runtimeModelDiscovery.getPreferredModels(type);
  if (preferred.length > 0) {
    return preferred[0].id;
  }
  if (type === 'audio') return DEFAULT_AUDIO_MODEL_ID;
  if (type === 'video') return DEFAULT_VIDEO_MODEL_ID;
  if (type === 'text') return DEFAULT_TEXT_MODEL_ID;
  return DEFAULT_IMAGE_MODEL_ID;
}
