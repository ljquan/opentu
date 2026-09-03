import {
  type ModelConfig,
  type ModelType,
  ModelVendor,
  VENDOR_NAMES,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_AUDIO_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  DEFAULT_TEXT_MODEL_ID,
  getStaticModelsByType,
  getStaticModelConfig,
  isDefaultModelHidden,
  setRuntimeModelConfigs,
} from '../constants/model-config';
import { normalizeModelApiBaseUrl } from './provider-base-url';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  providerCatalogsSettings,
  invocationPresetsSettings,
  providerProfilesSettings,
  settingsManager,
  type ProviderCatalog,
  type ProviderCatalogManualBinding,
  type ModelRef,
  type ProviderProfile,
} from './settings-manager';
import {
  applySunoAliasPresentation,
  isSunoLikeModelId,
} from './suno-model-aliases';
import { sortModelsByDisplayPriority } from './model-sort';
import { isTuziEmbeddedMode } from '../services/tuzi-embedded-config';
import { hasTuziSystemToken } from '../services/tuzi-token-auth';

const LEGACY_CACHE_KEY = 'drawnix-runtime-model-discovery';

export interface RemoteModelListItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  category?: string;
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
  manualBindings: ProviderCatalogManualBinding[];
  models: ModelConfig[];
  error: string | null;
}

export interface RuntimeModelSelectionChange {
  models: ModelConfig[];
  addedModelIds: string[];
  removedModelIds: string[];
}

export interface ManualRuntimeModelInvocationInput {
  protocol: string;
  requestSchema: string;
  submitPath: string;
  responseSchema?: string;
  baseUrlStrategy?: ProviderCatalogManualBinding['baseUrlStrategy'];
  pollPathTemplate?: string;
  priority?: number;
  confidence?: ProviderCatalogManualBinding['confidence'];
  metadata?: Record<string, unknown>;
}

export interface ManualRuntimeModelInput {
  id: string;
  type: ModelType;
  label?: string;
  description?: string;
  invocation?: ManualRuntimeModelInvocationInput;
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
    manualBindings: [],
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

export { normalizeModelApiBaseUrl } from './provider-base-url';

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

async function fetchRemoteModelList(
  baseUrl: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

  return rawText;
}

function buildModelDiscoveryBaseUrls(
  primaryBaseUrl: string,
  fallbackBaseUrls: string[] = []
): string[] {
  const urls = new Map<string, string>();

  [primaryBaseUrl, ...fallbackBaseUrls].forEach((url) => {
    const normalized = normalizeModelApiBaseUrl(url);
    if (normalized && !urls.has(normalized)) {
      urls.set(normalized, normalized);
    }
  });

  return Array.from(urls.values());
}

async function fetchRemoteModelListWithFallback(
  primaryBaseUrl: string,
  apiKey: string,
  fallbackBaseUrls: string[] = []
): Promise<string> {
  const baseUrls = buildModelDiscoveryBaseUrls(
    primaryBaseUrl,
    fallbackBaseUrls
  );
  let lastFetchError: unknown = null;

  for (let index = 0; index < baseUrls.length; index += 1) {
    try {
      return await fetchRemoteModelList(baseUrls[index], apiKey);
    } catch (error) {
      if (error instanceof Error && !/failed to fetch/i.test(error.message)) {
        throw error;
      }
      lastFetchError = error;
    }
  }

  const message =
    lastFetchError instanceof Error
      ? lastFetchError.message
      : 'Failed to fetch';
  throw new Error(`获取模型列表失败: ${message}`);
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

function inferModelTypeFromCategory(category?: unknown): ModelType | null {
  const normalized =
    typeof category === 'string' ? category.trim().toLowerCase() : '';
  if (!normalized) return null;

  if (
    matchesAnyPattern(normalized, [
      '视频',
      'video',
      'videos',
      'movie',
      'film',
      'video_generation',
      'video-generation',
      'text-to-video',
      'image-to-video',
      't2v',
      'i2v',
    ])
  ) {
    return 'video';
  }

  if (
    matchesAnyPattern(normalized, [
      '生图',
      '图片',
      '图像',
      '绘图',
      'image',
      'images',
      'img',
      'picture',
      'photo',
      'image_generation',
      'image-generation',
      'text-to-image',
      'image-to-image',
      't2i',
      'i2i',
    ])
  ) {
    return 'image';
  }

  if (
    matchesAnyPattern(normalized, [
      '音频',
      '音乐',
      '语音',
      'audio',
      'music',
      'voice',
      'speech',
      'suno',
    ])
  ) {
    return 'audio';
  }

  if (
    matchesAnyPattern(normalized, [
      '文本',
      '文字',
      '对话',
      '聊天',
      '语言',
      '研究',
      '推理',
      '代码',
      'text',
      'chat',
      'llm',
      'language',
      'research',
      'reasoning',
      'coder',
      'code',
    ])
  ) {
    return 'text';
  }

  return null;
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
  if (lowerId.includes('happyhorse')) return ModelVendor.HAPPYHORSE;
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
    lowerId.includes('tts-') ||
    lowerId.includes('babbage') ||
    lowerId.includes('davinci') ||
    lowerId.includes('computer-use') ||
    openAIPattern.test(lowerId)
  ) {
    return ModelVendor.GPT;
  }
  if (
    lowerId === 'omni-flash' ||
    lowerId === 'omni-flash-components' ||
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
  if (owner === 'happyhorse' || owner.includes('happyhorse')) {
    return ModelVendor.HAPPYHORSE;
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
  const categoryType = inferModelTypeFromCategory(model.category);
  if (categoryType) {
    return categoryType;
  }

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

  if (hasImageIdSignal()) {
    return 'image';
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

  switch (vendor) {
    case ModelVendor.FLUX:
    case ModelVendor.MIDJOURNEY:
      return 'image';
    case ModelVendor.SORA:
    case ModelVendor.VEO:
    case ModelVendor.HAPPYHORSE:
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

function isModelType(value: unknown): value is ModelType {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'text' ||
    value === 'audio'
  );
}

function getModelTypeLabel(type: ModelType): string {
  if (type === 'image') return '图片模型';
  if (type === 'video') return '视频模型';
  if (type === 'audio') return '音频模型';
  return '文本模型';
}

function buildManualBindingId(
  profileId: string,
  modelId: string,
  type: ModelType,
  requestSchema: string
): string {
  return [profileId, modelId, type, 'manual', requestSchema || 'custom'].join(
    ':'
  );
}

function createManualModelConfig(input: ManualRuntimeModelInput): ModelConfig {
  const modelId = input.id.trim();
  const label = input.label?.trim() || modelId;
  const description = input.description?.trim();

  return {
    id: modelId,
    label,
    shortLabel: label,
    shortCode: buildShortCode(modelId, input.type),
    description:
      description ||
      `${
        input.type === 'image'
          ? '自定义图片模型'
          : input.type === 'video'
          ? '自定义视频模型'
          : input.type === 'audio'
          ? '自定义音频模型'
          : '自定义文本模型'
      } · ${modelId}`,
    type: input.type,
    vendor: inferVendorByKeywords(modelId),
    supportsTools: input.type === 'text' ? true : undefined,
    tags: ['runtime', 'manual'],
    imageDefaults:
      input.type === 'image'
        ? { aspectRatio: 'auto', width: 1024, height: 1024 }
        : undefined,
    videoDefaults:
      input.type === 'video'
        ? { duration: '8', size: '1280x720', aspectRatio: '16:9' }
        : undefined,
  };
}

function createManualBinding(
  profileId: string,
  model: ModelConfig,
  invocation?: ManualRuntimeModelInvocationInput
): ProviderCatalogManualBinding | null {
  if (!invocation) {
    return null;
  }

  const protocol = invocation.protocol.trim();
  const requestSchema = invocation.requestSchema.trim();
  const submitPath = invocation.submitPath.trim();
  const responseSchema =
    invocation.responseSchema?.trim() ||
    (model.type === 'text'
      ? 'openai.chat.choices'
      : model.type === 'video'
      ? 'openai.async.task'
      : model.type === 'audio'
      ? 'tuzi.suno.music.task'
      : 'openai.image.data');

  if (!protocol || !requestSchema || !submitPath) {
    throw new Error('请填写完整的接口协议、请求格式和提交路径');
  }

  const pollPathTemplate = invocation.pollPathTemplate?.trim();
  const priority =
    typeof invocation.priority === 'number' &&
    Number.isFinite(invocation.priority)
      ? invocation.priority
      : 900;
  const confidence =
    invocation.confidence === 'medium' || invocation.confidence === 'low'
      ? invocation.confidence
      : 'high';

  return {
    id: buildManualBindingId(profileId, model.id, model.type, requestSchema),
    modelId: model.id,
    operation: model.type,
    protocol,
    requestSchema,
    responseSchema,
    submitPath,
    baseUrlStrategy: invocation.baseUrlStrategy,
    pollPathTemplate: pollPathTemplate || undefined,
    priority,
    confidence,
    source: 'manual',
    metadata: invocation.metadata,
  };
}

function upsertModelByIdAndType(
  models: ModelConfig[],
  nextModel: ModelConfig
): ModelConfig[] {
  const nextModels = [...models];
  const existingIndex = nextModels.findIndex(
    (model) => model.id === nextModel.id && model.type === nextModel.type
  );

  if (existingIndex >= 0) {
    nextModels[existingIndex] = {
      ...nextModels[existingIndex],
      ...nextModel,
      tags: Array.from(
        new Set([
          ...(nextModels[existingIndex].tags || []),
          ...(nextModel.tags || []),
        ])
      ),
    };
    return nextModels;
  }

  return [...nextModels, nextModel];
}

function removeManualBindingsForModel(
  bindings: ProviderCatalogManualBinding[],
  modelId: string
): ProviderCatalogManualBinding[] {
  return bindings.filter((binding) => binding.modelId !== modelId);
}

function mergeDiscoveredWithManualModels(
  discoveredModels: ModelConfig[],
  existingModels: ModelConfig[]
): ModelConfig[] {
  const merged = [...discoveredModels];

  for (const model of existingModels) {
    if (!(model.tags || []).includes('manual')) {
      continue;
    }
    if (
      merged.some(
        (candidate) =>
          candidate.id === model.id && candidate.type === model.type
      )
    ) {
      continue;
    }
    merged.push(model);
  }

  return merged;
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

function cloneModelConfig(model: ModelConfig): ModelConfig {
  return {
    ...model,
    tags: model.tags ? [...model.tags] : undefined,
    imageDefaults: model.imageDefaults ? { ...model.imageDefaults } : undefined,
    videoDefaults: model.videoDefaults ? { ...model.videoDefaults } : undefined,
  };
}

function adaptRuntimeModel(model: RemoteModelListItem): ModelConfig | null {
  if (!model?.id || typeof model.id !== 'string') {
    return null;
  }

  const staticConfig = getStaticModelConfig(model.id);
  if (staticConfig) {
    const clonedConfig = cloneModelConfig(staticConfig);
    const categoryType = inferModelTypeFromCategory(model.category);
    if (!categoryType || categoryType === staticConfig.type) {
      return clonedConfig;
    }

    return {
      ...clonedConfig,
      type: categoryType,
      imageDefaults:
        categoryType === 'image'
          ? staticConfig.imageDefaults || {
              aspectRatio: 'auto',
              width: 1024,
              height: 1024,
            }
          : undefined,
      videoDefaults:
        categoryType === 'video'
          ? staticConfig.videoDefaults || {
              duration: '8',
              size: '1280x720',
              aspectRatio: '16:9',
            }
          : undefined,
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
    return !isTuziEmbeddedMode() || hasTuziSystemToken();
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

function refreshPersistedModelConfig(model: ModelConfig): ModelConfig {
  const staticConfig = getStaticModelConfig(model.id);
  if (staticConfig) {
    return cloneModelConfig(staticConfig);
  }

  const lowerId = model.id.toLowerCase();
  const lowerTags = (model.tags || []).map((tag) => tag.toLowerCase());
  if (lowerId.includes('happyhorse') || lowerTags.includes('happyhorse')) {
    return {
      ...model,
      type: 'video',
      vendor: ModelVendor.HAPPYHORSE,
      tags: Array.from(new Set([...(model.tags || []), 'happyhorse'])),
    };
  }

  return model;
}

function decorateRuntimeModels(
  profileId: string,
  models: ModelConfig[]
): ModelConfig[] {
  return models.map((model) =>
    attachRuntimeSource(profileId, refreshPersistedModelConfig(model))
  );
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
    manualBindings: Array.isArray(catalog.manualBindings)
      ? catalog.manualBindings
      : [],
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
    manualBindings: state.manualBindings,
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
      manualBindings: [],
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
  private revision = 0;

  constructor() {
    this.catalogStates = this.loadCatalogStatesFromSettings();
    this.migrateLegacyCacheIfNeeded();
    this.syncRuntimeModelConfigs();

    providerCatalogsSettings.addListener(this.handleCatalogSettingsChange);
    providerProfilesSettings.addListener(this.handleProfileSettingsChange);
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
    this.revision += 1;
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

  private handleProfileSettingsChange = (): void => {
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
      manualBindings: Array.isArray(state.manualBindings)
        ? state.manualBindings
        : [],
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

  getRevision(): number {
    return this.revision;
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
    return this.getSelectableModels(type);
  }

  getSelectableModels(type: ModelType): ModelConfig[] {
    return sortModelsByDisplayPriority([
      ...this.getConfiguredSelectableModels(type),
      ...decorateStaticModels(getStaticModelsByType(type)),
    ]);
  }

  getConfiguredSelectableModels(type: ModelType): ModelConfig[] {
    const runtimeModels: ModelConfig[] = [];
    for (const state of this.catalogStates.values()) {
      if (!isProfileEnabled(state.profileId)) {
        continue;
      }
      runtimeModels.push(
        ...state.models.filter(
          (model) =>
            model.type === type &&
            !(
              state.profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID &&
              isDefaultModelHidden(model.id)
            )
        )
      );
    }
    return sortModelsByDisplayPriority(runtimeModels);
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

      const conflictingTypeMatch =
        state?.models.find(
          (model) =>
            (model.selectionKey || buildSelectionKey(profileId, model.id)) ===
            expectedSelectionKey
        ) ||
        state?.discoveredModels.find(
          (model) =>
            (model.selectionKey || buildSelectionKey(profileId, model.id)) ===
            expectedSelectionKey
        );

      if (conflictingTypeMatch) {
        return null;
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
    const runtimeModels = state.models.filter(
      (model) =>
        model.type === type &&
        !(
          profileId === LEGACY_DEFAULT_PROVIDER_PROFILE_ID &&
          isDefaultModelHidden(model.id)
        )
    );
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
  ): RuntimeModelSelectionChange {
    const state = this.getCatalogState(profileId);
    const previousSelectedModelIds = normalizeSelectedModelIds(
      state.discoveredModels,
      state.selectedModelIds
    );
    const selectedModelIds = normalizeSelectedModelIds(
      state.discoveredModels,
      modelIds
    );
    const previousSelectedSet = new Set(previousSelectedModelIds);
    const nextSelectedSet = new Set(selectedModelIds);
    const models = buildSelectedModels(
      state.discoveredModels,
      selectedModelIds
    );
    const addedModelIds = selectedModelIds.filter(
      (modelId) => !previousSelectedSet.has(modelId)
    );
    const removedModelIds = previousSelectedModelIds.filter(
      (modelId) => !nextSelectedSet.has(modelId)
    );

    this.setCatalogState(profileId, {
      ...state,
      status: state.discoveredModels.length > 0 ? 'ready' : state.status,
      selectedModelIds,
      models,
      error: null,
    });

    return {
      models,
      addedModelIds,
      removedModelIds,
    };
  }

  removeModel(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    modelId: string
  ): RuntimeModelSelectionChange {
    const state = this.getCatalogState(profileId);
    const targetModel = state.discoveredModels.find(
      (model) => model.id === modelId
    );
    const isManualModel = (targetModel?.tags || []).includes('manual');
    const previousSelectedModelIds = normalizeSelectedModelIds(
      state.discoveredModels,
      state.selectedModelIds
    );
    const selectedModelIds = previousSelectedModelIds.filter(
      (id) => id !== modelId
    );
    const discoveredModels = isManualModel
      ? state.discoveredModels.filter((model) => model.id !== modelId)
      : state.discoveredModels;
    const models = buildSelectedModels(discoveredModels, selectedModelIds);
    const wasSelected = previousSelectedModelIds.includes(modelId);

    this.setCatalogState(profileId, {
      ...state,
      status: discoveredModels.length > 0 ? 'ready' : 'idle',
      discoveredModels,
      selectedModelIds,
      manualBindings: removeManualBindingsForModel(
        state.manualBindings,
        modelId
      ),
      models,
      error: null,
    });

    return {
      models,
      addedModelIds: [],
      removedModelIds: wasSelected ? [modelId] : [],
    };
  }

  addManualModel(
    profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    input: ManualRuntimeModelInput
  ): ModelConfig {
    const modelId = input.id.trim();
    if (!modelId) {
      throw new Error('请填写模型 ID');
    }
    if (!isModelType(input.type)) {
      throw new Error('请选择模型类型');
    }

    const state = this.getCatalogState(profileId);
    const conflictingModel = state.discoveredModels.find(
      (model) => model.id === modelId && model.type !== input.type
    );
    if (conflictingModel) {
      throw new Error(
        `同一供应商下模型 ID 已作为${getModelTypeLabel(
          conflictingModel.type
        )}存在，请换一个模型 ID 或先移除原模型`
      );
    }

    const manualModel = attachRuntimeSource(
      profileId,
      createManualModelConfig({ ...input, id: modelId })
    );
    const discoveredModels = upsertModelByIdAndType(
      state.discoveredModels,
      manualModel
    );
    const selectedModelIds = normalizeSelectedModelIds(discoveredModels, [
      ...state.selectedModelIds,
      modelId,
    ]);
    const manualBinding = createManualBinding(
      profileId,
      manualModel,
      input.invocation
    );
    const manualBindings = manualBinding
      ? [
          ...removeManualBindingsForModel(state.manualBindings, modelId),
          manualBinding,
        ]
      : state.manualBindings;

    this.setCatalogState(profileId, {
      ...state,
      status: 'ready',
      discoveredAt: state.discoveredAt || Date.now(),
      discoveredModels,
      selectedModelIds,
      manualBindings,
      models: buildSelectedModels(discoveredModels, selectedModelIds),
      error: null,
    });

    return manualModel;
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
    apiKey: string,
    fallbackBaseUrls: string[] = []
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

    const rawText = await fetchRemoteModelListWithFallback(
      normalizedBaseUrl,
      trimmedApiKey,
      fallbackBaseUrls
    );

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

    const discoveredModels = mergeDiscoveredWithManualModels(
      adaptedModels,
      state.discoveredModels
    );
    const manualModelIds = new Set(
      discoveredModels
        .filter((model) => (model.tags || []).includes('manual'))
        .map((model) => model.id)
    );
    const selectedModelIds =
      state.signature === signature
        ? normalizeSelectedModelIds(discoveredModels, state.selectedModelIds)
        : normalizeSelectedModelIds(
            discoveredModels,
            state.selectedModelIds.filter((modelId) =>
              manualModelIds.has(modelId)
            )
          );
    const models = buildSelectedModels(discoveredModels, selectedModelIds);

    this.setCatalogState(profileId, {
      profileId,
      status: 'ready',
      sourceBaseUrl: normalizedBaseUrl,
      signature,
      discoveredAt: Date.now(),
      discoveredModels,
      selectedModelIds,
      manualBindings: state.manualBindings,
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

export function getConfiguredSelectableModels(type: ModelType): ModelConfig[] {
  return runtimeModelDiscovery.getConfiguredSelectableModels(type);
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

export function addManualRuntimeModel(
  profileId: string,
  input: ManualRuntimeModelInput
): ModelConfig {
  return runtimeModelDiscovery.addManualModel(profileId, input);
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
