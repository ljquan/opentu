import { useDrawnix } from '../../hooks/use-drawnix';
import { useDeviceType } from '../../hooks/useDeviceType';
import './settings-dialog.scss';
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import classNames from 'classnames';
import { Switch } from 'tdesign-react';
import { InfoCircleIcon } from 'tdesign-icons-react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { LS_KEYS } from '../../constants/storage-keys';
import { ModelDiscoveryDialog } from './model-discovery-dialog';
import { PricingFieldGroup } from './pricing-field-group';
import { useModelPriceText, useModelMeta } from '../../hooks/use-model-pricing';
import {
  getDefaultAudioModel,
  getDefaultImageModel,
  getDefaultTextModel,
  getDefaultVideoModel,
  ModelVendor,
  type ModelConfig,
  type ModelType,
} from '../../constants/model-config';
import {
  useProfilePreferredModels,
  useRuntimeModelDiscoveryState,
} from '../../hooks/use-runtime-models';
import {
  normalizeModelApiBaseUrl,
  runtimeModelDiscovery,
} from '../../utils/runtime-model-discovery';
import { compareModelsByDisplayPriority } from '../../utils/model-sort';
import {
  createModelRef,
  createRouteConfig,
  DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
  DEFAULT_INVOCATION_PRESET_ID,
  geminiSettings,
  getRouteModelId,
  getRouteProfileId,
  invocationPresetsSettings,
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  providerProfilesSettings,
  TUZI_BUSINESS_PROVIDER_PROFILE_ID,
  settingsManager,
  TUZI_MIX_PROVIDER_PROFILE_ID,
  TUZI_CODEX_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  TUZI_PROVIDER_DEFAULT_BASE_URL,
  type ImageApiCompatibility,
  type InvocationPreset,
  type ModelRef,
  type ProviderProfile,
  type RouteConfig,
} from '../../utils/settings-manager';
import type {
  ManualHttpBodyType,
  ManualHttpFormField,
  ManualHttpTemplateMetadata,
} from '../../utils/settings-types';
import {
  DISCOVERY_VENDOR_ORDER,
  getDiscoveryVendorLabel,
  getModelVendorPalette,
  ModelVendorMark,
} from '../shared/ModelVendorBrand';
import {
  ContextMenu,
  useContextMenuState,
  type ContextMenuEntry,
} from '../shared/ContextMenu';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { WinBoxWindow } from '../winbox';
import { TtsSettingsPanel } from '../project-drawer/TtsSettingsPanel';
import { TuziAccountPanel } from './TuziAccountPanel';
import { isTuziEmbeddedMode } from '../../services/tuzi-embedded-config';
import { syncTuziSessionProviders } from '../../services/tuzi-session-provider-sync';
import { hasTuziSystemToken } from '../../services/tuzi-token-auth';
import { openModelBenchmarkTool } from '../../services/model-benchmark-launcher';
import {
  analytics,
  getProviderEndpointAnalytics,
} from '../../utils/umami-analytics';
import { modelBenchmarkService } from '../../services/model-benchmark-service';
import { HoverTip } from '../shared/hover';
import { createProviderProfileDraft } from './provider-profile-draft';
import {
  normalizeEndpointApiBaseUrl,
  normalizeEndpointUrl,
  resolveEndpointSelectionUrl,
} from './provider-endpoint-utils';
import { MessagePlugin } from '../../utils/message-plugin';
import {
  isTrustedTuziApiBaseUrl,
  loadTuziApiEndpointSources,
  TUZI_API_FALLBACK_ENDPOINTS,
  type TuziApiEndpointSource,
} from '../../services/provider-routing/tuzi-api-endpoints';
import {
  canDisableProvider,
  isManagedProviderProfile,
  shouldShowProviderProfile,
} from './provider-toggle-utils';
import {
  SETTINGS_PROVIDER_NAV_EVENT,
  type ProviderNavigationIntent,
} from './provider-settings-navigation';

export { IMAGE_MODEL_GROUPED_SELECT_OPTIONS as IMAGE_MODEL_GROUPED_OPTIONS } from '../../constants/model-config';
export { VIDEO_MODEL_SELECT_OPTIONS as VIDEO_MODEL_OPTIONS } from '../../constants/model-config';

type SettingsView =
  | 'providers'
  | 'presets'
  | 'canvas'
  | 'speech'
  | 'tuzi-account';
type CompactPanelMode = 'catalog' | 'detail';
type EndpointSelectionMode = 'auto' | 'manual';
type EndpointLatency = number | 'failed' | null;
type CustomModelInterfacePreset =
  | 'custom-http'
  | 'openai-chat-completions'
  | 'openai-chat-vision'
  | 'tuzi-image-edit-json'
  | 'openai-image-generation-json'
  | 'openai-image-edit-form'
  | 'async-image-task'
  | 'openai-async-video'
  | 'kling-video'
  | 'seedance-video'
  | 'happyhorse-video'
  | 'tuzi-suno-music';
const SETTINGS_DIALOG_COMPACT_BREAKPOINT = 980;
const TUZI_PROVIDER_PROFILE_IDS = new Set([
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
  TUZI_MIX_PROVIDER_PROFILE_ID,
  TUZI_CODEX_PROVIDER_PROFILE_ID,
  TUZI_BUSINESS_PROVIDER_PROFILE_ID,
]);
let tuziApiEndpointCache: EndpointOption[] | null = null;

interface EndpointOption {
  id: string;
  url: string;
  shortLabel: string;
  name?: string;
  description?: string;
  removable?: boolean;
}

function isTuziProviderProfile(profile?: ProviderProfile | null): boolean {
  return Boolean(
    profile &&
      (TUZI_PROVIDER_PROFILE_IDS.has(profile.id) ||
        isTuziManagedProviderProfileId(profile.id) ||
        isTrustedTuziApiBaseUrl(profile.baseUrl))
  );
}

function isTuziManagedProviderProfileId(profileId?: string | null): boolean {
  return Boolean(profileId?.startsWith('tuzi-managed-'));
}

const VIEW_SECTIONS: Array<{ value: SettingsView; label: string }> = [
  { value: 'providers', label: '供应商' },
  { value: 'presets', label: '模型预设' },
  { value: 'canvas', label: '画布显示' },
  { value: 'speech', label: '语音播放' },
];

const TUZI_ACCOUNT_SECTION: { value: SettingsView; label: string } = {
  value: 'tuzi-account',
  label: 'Tuzi 账户',
};

const PROVIDER_TYPE_OPTIONS: ProviderProfile['providerType'][] = [
  'openai-compatible',
  'gemini-compatible',
  'custom',
];

const AUTH_TYPE_OPTIONS: ProviderProfile['authType'][] = [
  'bearer',
  'header',
  'query',
  'custom',
];

const IMAGE_API_COMPATIBILITY_OPTIONS: ImageApiCompatibility[] = [
  'auto',
  'openai-gpt-image',
  'tuzi-gpt-image',
  'openai-compatible-basic',
];

const ROUTE_LABELS: Record<ModelType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
};

const MODEL_GROUP_LABELS: Record<ModelType, string> = {
  image: '图片模型',
  video: '视频模型',
  audio: '音频模型',
  text: '文本模型',
};

const CUSTOM_MODEL_INTERFACE_PRESETS: Record<
  CustomModelInterfacePreset,
  {
    label: string;
    modelType: ModelType | 'any';
    protocol: string;
    requestSchema: string;
    responseSchema: string;
    submitPath: string;
    pollPathTemplate?: string;
    baseUrlStrategy?: 'preserve' | 'trim-v1';
    description: string;
    metadata?: {
      text?: {
        supportsImageInput?: boolean;
        imageInputMode?: 'openai-image_url';
        maxImageCount?: number;
      };
      audio?: {
        submitPathByAction?: Record<string, string>;
      };
    };
  }
> = {
  'custom-http': {
    label: '自定义 HTTP API',
    modelType: 'any',
    protocol: 'custom-http',
    requestSchema: 'custom-http',
    responseSchema: 'custom-http.image',
    submitPath: '/images/generations',
    description:
      '为这个模型单独配置请求地址、请求体和返回字段，不走站内固定模型识别。',
  },
  'openai-chat-completions': {
    label: 'OpenAI 文本对话调用',
    modelType: 'text',
    protocol: 'openai.chat.completions',
    requestSchema: 'openai.chat.messages',
    responseSchema: 'openai.chat.choices',
    submitPath: '/chat/completions',
    description:
      '复用站内文本模型调用：POST /chat/completions，自动传入模型、消息和提示词。',
  },
  'openai-chat-vision': {
    label: 'OpenAI 多模态文本调用',
    modelType: 'text',
    protocol: 'openai.chat.completions',
    requestSchema: 'openai.chat.messages',
    responseSchema: 'openai.chat.choices',
    submitPath: '/chat/completions',
    description: '复用站内多模态文本调用：自动传入文本和参考图片。',
    metadata: {
      text: {
        supportsImageInput: true,
        imageInputMode: 'openai-image_url',
        maxImageCount: 6,
      },
    },
  },
  'tuzi-image-edit-json': {
    label: 'Tuzi 图片生成/编辑调用',
    modelType: 'image',
    protocol: 'openai.images.edits',
    requestSchema: 'tuzi.image.gpt-edit-json',
    responseSchema: 'openai.image.data',
    submitPath: '/images/edits',
    description: '复用站内 Tuzi 图片调用：自动传入提示词、参考图、尺寸和画质。',
  },
  'openai-image-generation-json': {
    label: 'OpenAI 图片生成/编辑调用',
    modelType: 'image',
    protocol: 'openai.images.generations',
    requestSchema: 'openai.image.gpt-generation-json',
    responseSchema: 'openai.image.data',
    submitPath: '/images/generations',
    description:
      '复用站内 OpenAI 图片调用：文生图走 generations，有参考图时自动走 edits。',
  },
  'openai-image-edit-form': {
    label: 'OpenAI 图片编辑调用',
    modelType: 'image',
    protocol: 'openai.images.edits',
    requestSchema: 'openai.image.gpt-edit-form',
    responseSchema: 'openai.image.data',
    submitPath: '/images/edits',
    description:
      '复用站内 OpenAI 图片编辑调用：自动上传参考图、蒙版并传入编辑参数。',
  },
  'async-image-task': {
    label: '异步图片任务调用',
    modelType: 'image',
    protocol: 'openai.async.media',
    requestSchema: 'openai.async.image.form',
    responseSchema: 'openai.async.task',
    submitPath: '/videos',
    pollPathTemplate: '/videos/{taskId}',
    description: '复用站内异步图片任务：提交后自动查询任务状态并取回图片。',
  },
  'openai-async-video': {
    label: 'OpenAI 异步视频调用',
    modelType: 'video',
    protocol: 'openai.async.video',
    requestSchema: 'openai.video.form-input-reference',
    responseSchema: 'openai.async.task',
    submitPath: '/videos',
    pollPathTemplate: '/videos/{taskId}',
    description:
      '复用站内通用视频调用：自动传入提示词、参考图、尺寸和时长并轮询结果。',
  },
  'kling-video': {
    label: 'Kling 视频调用',
    modelType: 'video',
    protocol: 'kling.video',
    requestSchema: 'kling.video.auto-action-json',
    responseSchema: 'kling.video.task',
    submitPath: '/kling/v1/videos/{action}',
    pollPathTemplate: '/kling/v1/videos/{action}/{taskId}',
    description: '复用站内 Kling 视频调用和任务查询方式。',
  },
  'seedance-video': {
    label: 'Seedance 视频调用',
    modelType: 'video',
    protocol: 'seedance.task',
    requestSchema: 'seedance.video.form-auto',
    responseSchema: 'seedance.video.task',
    submitPath: '/videos',
    pollPathTemplate: '/videos/{taskId}',
    description: '复用站内 Seedance 视频调用和任务查询方式。',
  },
  'happyhorse-video': {
    label: 'HappyHorse 视频调用',
    modelType: 'video',
    protocol: 'happyhorse.video',
    requestSchema: 'happyhorse.video.json',
    responseSchema: 'happyhorse.video.task',
    submitPath: '/videos',
    pollPathTemplate: '/videos/{taskId}',
    description: '复用站内 HappyHorse 视频调用和任务查询方式。',
  },
  'tuzi-suno-music': {
    label: 'Suno 音乐/歌词调用',
    modelType: 'audio',
    protocol: 'tuzi.suno.music',
    requestSchema: 'tuzi.suno.music.submit',
    responseSchema: 'tuzi.suno.task',
    submitPath: '/suno/submit/music',
    pollPathTemplate: '/suno/fetch/{taskId}',
    baseUrlStrategy: 'trim-v1',
    description: '复用站内 Suno 调用：自动提交音乐或歌词任务并轮询结果。',
    metadata: {
      audio: {
        submitPathByAction: {
          music: '/suno/submit/music',
          lyrics: '/suno/submit/lyrics',
        },
      },
    },
  },
};

const DEFAULT_CUSTOM_MODEL_PRESET_BY_TYPE: Record<
  ModelType,
  CustomModelInterfacePreset
> = {
  text: 'custom-http',
  image: 'custom-http',
  video: 'custom-http',
  audio: 'custom-http',
};

interface CustomHttpDraft {
  method: NonNullable<ManualHttpTemplateMetadata['method']>;
  bodyType: ManualHttpBodyType;
  submitPath: string;
  bodyTemplate: string;
  formFieldsTemplate: string;
  headersTemplate: string;
  responsePath: string;
  pollPath: string;
  taskIdPath: string;
  statusPath: string;
  pollResultPath: string;
  errorPath: string;
}

const CUSTOM_HTTP_DEFAULTS: Record<ModelType, CustomHttpDraft> = {
  text: {
    method: 'POST',
    bodyType: 'json',
    submitPath: '/chat/completions',
    bodyTemplate: JSON.stringify(
      { model: '{{model}}', messages: '{{messages}}' },
      null,
      2
    ),
    formFieldsTemplate: '[]',
    headersTemplate: '{}',
    responsePath: 'choices.0.message.content',
    pollPath: '',
    taskIdPath: 'task_id',
    statusPath: 'status',
    pollResultPath: 'result.text',
    errorPath: 'error.message',
  },
  image: {
    method: 'POST',
    bodyType: 'json',
    submitPath: '/images/generations',
    bodyTemplate: JSON.stringify(
      {
        model: '{{model}}',
        prompt: '{{prompt}}',
        size: '{{size}}',
      },
      null,
      2
    ),
    formFieldsTemplate: JSON.stringify(
      [
        { name: 'model', value: '{{model}}' },
        { name: 'prompt', value: '{{prompt}}' },
        { name: 'image', value: '{{images}}', kind: 'file-list' },
      ],
      null,
      2
    ),
    headersTemplate: '{}',
    responsePath: 'data.*.url',
    pollPath: '',
    taskIdPath: 'task_id',
    statusPath: 'status',
    pollResultPath: 'result.url',
    errorPath: 'error.message',
  },
  video: {
    method: 'POST',
    bodyType: 'json',
    submitPath: '/videos',
    bodyTemplate: JSON.stringify(
      {
        model: '{{model}}',
        prompt: '{{prompt}}',
        image: '{{image}}',
        size: '{{size}}',
        duration: '{{duration}}',
      },
      null,
      2
    ),
    formFieldsTemplate: '[]',
    headersTemplate: '{}',
    responsePath: 'url',
    pollPath: '',
    taskIdPath: 'task_id',
    statusPath: 'status',
    pollResultPath: 'result.url',
    errorPath: 'error.message',
  },
  audio: {
    method: 'POST',
    bodyType: 'json',
    submitPath: '/audio/generations',
    bodyTemplate: JSON.stringify(
      {
        model: '{{model}}',
        prompt: '{{prompt}}',
        title: '{{params.title}}',
        tags: '{{params.tags}}',
      },
      null,
      2
    ),
    formFieldsTemplate: '[]',
    headersTemplate: '{}',
    responsePath: 'clips.*.audio_url',
    pollPath: '',
    taskIdPath: 'task_id',
    statusPath: 'status',
    pollResultPath: 'clips.*.audio_url',
    errorPath: 'error.message',
  },
};

function getCustomModelPresetOptions(
  modelType: ModelType
): CustomModelInterfacePreset[] {
  return (
    Object.keys(CUSTOM_MODEL_INTERFACE_PRESETS) as CustomModelInterfacePreset[]
  ).filter(
    (presetKey) =>
      CUSTOM_MODEL_INTERFACE_PRESETS[presetKey].modelType === 'any' ||
      CUSTOM_MODEL_INTERFACE_PRESETS[presetKey].modelType === modelType
  );
}

function parseJsonObject(
  value: string,
  fieldLabel: string
): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel}必须是 JSON 对象`);
  }
  const result: Record<string, string> = {};
  Object.entries(parsed).forEach(([key, item]) => {
    if (typeof item !== 'string') {
      throw new Error(`${fieldLabel}的值必须是字符串`);
    }
    result[key] = item;
  });
  return result;
}

function parseFormFields(value: string): ManualHttpFormField[] {
  const parsed = JSON.parse(value.trim() || '[]') as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('FormData 字段必须是 JSON 数组');
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`FormData 第 ${index + 1} 项格式错误`);
    }
    const field = item as Partial<ManualHttpFormField>;
    if (typeof field.name !== 'string' || typeof field.value !== 'string') {
      throw new Error(`FormData 第 ${index + 1} 项缺少 name 或 value`);
    }
    if (
      field.kind !== undefined &&
      field.kind !== 'text' &&
      field.kind !== 'file' &&
      field.kind !== 'file-list'
    ) {
      throw new Error(`FormData 第 ${index + 1} 项 kind 无效`);
    }
    return {
      name: field.name,
      value: field.value,
      kind: field.kind,
      filename: typeof field.filename === 'string' ? field.filename : undefined,
    };
  });
}

const ModelPriceLabel = memo(function ModelPriceLabel({
  profileId,
  modelId,
}: {
  profileId: string;
  modelId: string;
}) {
  const { summary, detail } = useModelPriceText(profileId, modelId);
  if (!summary) return null;
  return (
    <HoverTip content={detail} placement="top" disabled={detail === summary}>
      <span className="settings-dialog__model-price">{summary}</span>
    </HoverTip>
  );
});

const ModelIdWithDesc = memo(function ModelIdWithDesc({
  profileId,
  modelId,
}: {
  profileId: string;
  modelId: string;
}) {
  const meta = useModelMeta(profileId, modelId);
  if (!meta?.description) {
    return (
      <span className="settings-dialog__model-type-item-id">{modelId}</span>
    );
  }
  return (
    <HoverTip content={meta.description} placement="top">
      <span className="settings-dialog__model-type-item-id settings-dialog__model-type-item-id--has-desc">
        {modelId}
      </span>
    </HoverTip>
  );
});

function buildModelSelectionChangeMessage(
  profileName: string,
  addedCount: number,
  removedCount: number,
  nextSelectedCount: number
): string | null {
  if (addedCount === 0 && removedCount === 0) {
    return null;
  }

  if (nextSelectedCount === 0 && removedCount > 0) {
    return `已清空 ${profileName} 的已添加模型`;
  }

  if (addedCount > 0 && removedCount > 0) {
    return `已更新 ${profileName} 的模型（新增 ${addedCount} 个，移除 ${removedCount} 个）`;
  }
  if (addedCount > 0) {
    return `已为 ${profileName} 添加 ${addedCount} 个模型`;
  }
  return `已从 ${profileName} 移除 ${removedCount} 个模型`;
}

const MODEL_SUMMARY_GROUP_ORDER: ModelType[] = [
  'text',
  'image',
  'video',
  'audio',
];

const PROVIDER_TYPE_META: Record<
  ProviderProfile['providerType'],
  { label: string }
> = {
  'openai-compatible': {
    label: 'OpenAI 兼容',
  },
  'gemini-compatible': {
    label: 'Gemini 兼容',
  },
  custom: {
    label: '自定义接入',
  },
};

const AUTH_TYPE_META: Record<ProviderProfile['authType'], { label: string }> = {
  bearer: {
    label: 'Bearer Token',
  },
  header: {
    label: '自定义 Header',
  },
  query: {
    label: 'Query 参数',
  },
  custom: {
    label: '手动拼装',
  },
};

const IMAGE_API_COMPATIBILITY_META: Record<
  ImageApiCompatibility,
  { label: string }
> = {
  auto: {
    label: '自动',
  },
  'openai-gpt-image': {
    label: 'OpenAI GPT Image',
  },
  'tuzi-gpt-image': {
    label: 'Tuzi GPT 兼容',
  },
  'openai-compatible-basic': {
    label: 'OpenAI-compatible 通用兼容（兜底）',
  },
};

function normalizeImageApiCompatibilityForDisplay(
  value?: ImageApiCompatibility | string | null
): ImageApiCompatibility {
  if (
    value === 'auto' ||
    value === 'openai-gpt-image' ||
    value === 'tuzi-gpt-image' ||
    value === 'openai-compatible-basic'
  ) {
    return value;
  }

  if (value === 'tuzi-compatible') {
    return 'tuzi-gpt-image';
  }

  return 'auto';
}

function resolveAutoImageApiCompatibilityForDisplay(
  profile: Pick<ProviderProfile, 'baseUrl'>
): Exclude<ImageApiCompatibility, 'auto'> {
  const normalizedBaseUrl = profile.baseUrl.trim().toLowerCase();

  if (normalizedBaseUrl.includes('api.openai.com')) {
    return 'openai-gpt-image';
  }

  if (normalizedBaseUrl.includes('.tu-zi.com')) {
    return 'tuzi-gpt-image';
  }

  return 'openai-compatible-basic';
}

function getImageApiCompatibilityHint(
  profile: Pick<ProviderProfile, 'baseUrl' | 'imageApiCompatibility'>
): string {
  const storedCompatibility = normalizeImageApiCompatibilityForDisplay(
    profile.imageApiCompatibility
  );

  if (storedCompatibility === 'auto') {
    const resolvedCompatibility =
      resolveAutoImageApiCompatibilityForDisplay(profile);
    return `默认推荐显式选择 OpenAI GPT Image；如果保留自动模式，GPT Image 模型当前会解析为 ${IMAGE_API_COMPATIBILITY_META[resolvedCompatibility].label}。`;
  }

  if (storedCompatibility === 'openai-gpt-image') {
    return '默认推荐模式。适用于官方 GPT Image 请求格式，也便于后续继续扩展官方图生图能力。';
  }

  return `同一个图片模型在不同 API Key 或网关下可能需要不同接口格式；当前已固定为 ${IMAGE_API_COMPATIBILITY_META[storedCompatibility].label}。`;
}

const PROVIDER_AVATAR_THEMES = [
  'amber',
  'sky',
  'mint',
  'rose',
  'violet',
] as const;

type ProviderAvatarTheme = (typeof PROVIDER_AVATAR_THEMES)[number];

function getModelTypeCounts(models: ModelConfig[]): Record<ModelType, number> {
  return models.reduce(
    (counts, model) => {
      counts[model.type] += 1;
      return counts;
    },
    { image: 0, video: 0, audio: 0, text: 0 }
  );
}

function matchesProviderModelQuery(model: ModelConfig, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    model.id,
    model.label,
    model.shortLabel,
    model.shortCode,
    model.description,
    model.sourceProfileName,
    getDiscoveryVendorLabel(model.vendor),
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalized));
}

function dedupeModelsByTypeAndId(models: ModelConfig[]): ModelConfig[] {
  const seen = new Set<string>();
  const unique: ModelConfig[] = [];

  models.forEach((model) => {
    const dedupeKey = `${model.type}:${model.id}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    unique.push(model);
  });

  return unique;
}

function getConfiguredRouteCount(preset: InvocationPreset | null): number {
  if (!preset) {
    return 0;
  }

  return (['image', 'video', 'audio', 'text'] as ModelType[]).filter(
    (routeType) => Boolean(getRouteModelId(preset[routeType]))
  ).length;
}

function getProviderDraftState(
  profile: ProviderProfile,
  initialProfiles: ProviderProfile[]
): 'new' | 'dirty' | 'saved' {
  const initialProfile = initialProfiles.find((item) => item.id === profile.id);
  if (!initialProfile) {
    return 'new';
  }
  return areEqual(initialProfile, profile) ? 'saved' : 'dirty';
}

function createSettingsDraftSignature(params: {
  profiles: ProviderProfile[];
  presets: InvocationPreset[];
  activePresetId: string;
  audioModelName: string;
  imageModelName: string;
  videoModelName: string;
  textModelName: string;
  showWorkZoneCard: boolean;
}): string {
  return JSON.stringify(params);
}

function getProviderIconUrl(
  profile: Pick<ProviderProfile, 'iconUrl'>
): string | null {
  if (typeof profile.iconUrl !== 'string') {
    return null;
  }

  const trimmed = profile.iconUrl.trim();
  return trimmed || null;
}

function getProviderHomepageUrl(
  profile: Pick<ProviderProfile, 'homepageUrl' | 'baseUrl'>
): string | null {
  const homepageUrl = normalizeOpenableUrl(profile.homepageUrl);
  if (homepageUrl) {
    return homepageUrl;
  }

  try {
    const baseUrl = normalizeOpenableUrl(profile.baseUrl);
    return baseUrl ? new URL(baseUrl).origin : null;
  } catch {
    return null;
  }
}

function normalizeOpenableUrl(value?: string | null): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(
      /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    return url.toString();
  } catch {
    return null;
  }
}

function getProviderAvatarLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return '供';
  }

  const alphaNumericGroups = trimmed.match(/[A-Za-z0-9]+/g);
  if (alphaNumericGroups?.[0]) {
    return alphaNumericGroups[0][0].toUpperCase();
  }

  return Array.from(trimmed)[0]?.toUpperCase() || '供';
}

function getProviderAvatarTheme(
  profile: Pick<ProviderProfile, 'id' | 'name' | 'providerType'>
): ProviderAvatarTheme {
  const seed = Array.from(
    `${profile.id}-${profile.providerType}-${profile.name}`
  ).reduce((total, char, index) => total + char.charCodeAt(0) * (index + 1), 0);

  return PROVIDER_AVATAR_THEMES[seed % PROVIDER_AVATAR_THEMES.length];
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createProfile(index: number): ProviderProfile {
  return createProviderProfileDraft(index, createId('profile'));
}

function readPendingProviderNavigationIntent(): ProviderNavigationIntent | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const intent =
    (
      window as typeof window & {
        __aituPendingProviderNavigationIntent?: ProviderNavigationIntent;
      }
    ).__aituPendingProviderNavigationIntent || null;

  (
    window as typeof window & {
      __aituPendingProviderNavigationIntent?: ProviderNavigationIntent;
    }
  ).__aituPendingProviderNavigationIntent = undefined;

  return intent;
}

function inferAuthTypeForProviderType(
  providerType: ProviderProfile['providerType']
): ProviderProfile['authType'] {
  return 'bearer';
}

const ProviderAvatar = ({
  profile,
  size = 'regular',
}: {
  profile: Pick<ProviderProfile, 'id' | 'name' | 'providerType' | 'iconUrl'>;
  size?: 'regular' | 'large';
}) => {
  const normalizedIconUrl = getProviderIconUrl(profile);
  const [imageUrl, setImageUrl] = useState<string | null>(normalizedIconUrl);

  useEffect(() => {
    setImageUrl(normalizedIconUrl);
  }, [normalizedIconUrl]);

  const avatarTheme = getProviderAvatarTheme(profile);
  const avatarLabel = getProviderAvatarLabel(profile.name);

  return (
    <span
      className={`settings-dialog__provider-avatar settings-dialog__provider-avatar--${avatarTheme} ${
        size === 'large' ? 'settings-dialog__provider-avatar--large' : ''
      }`}
      aria-hidden="true"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${profile.name} 图标`}
          className="settings-dialog__provider-avatar-image"
          loading="lazy"
          onError={() => setImageUrl(null)}
        />
      ) : (
        <span className="settings-dialog__provider-avatar-text">
          {avatarLabel}
        </span>
      )}
    </span>
  );
};

function createPreset(
  profileId: string | null,
  defaults: { image: string; video: string; audio: string; text: string }
): InvocationPreset {
  return {
    id: createId('preset'),
    name: '新预设',
    text: createRouteConfig(createModelRef(profileId, defaults.text || null)),
    image: createRouteConfig(createModelRef(profileId, defaults.image || null)),
    video: createRouteConfig(createModelRef(profileId, defaults.video || null)),
    audio: createRouteConfig(createModelRef(profileId, defaults.audio || null)),
  };
}

function updatePresetRoute(
  preset: InvocationPreset,
  routeType: ModelType,
  patch: Partial<RouteConfig> & {
    profileId?: string | null;
    defaultModelId?: string | null;
    defaultModelRef?: ModelRef | null;
  }
): InvocationPreset {
  const currentRoute = preset[routeType];
  const nextModelRef =
    patch.defaultModelRef !== undefined
      ? patch.defaultModelRef
      : createModelRef(
          patch.profileId !== undefined
            ? patch.profileId
            : getRouteProfileId(currentRoute),
          patch.defaultModelId !== undefined
            ? patch.defaultModelId
            : getRouteModelId(currentRoute)
        );

  return {
    ...preset,
    [routeType]: createRouteConfig(nextModelRef),
  };
}

function clearPresetProfileRoute(
  preset: InvocationPreset,
  profileId: string
): InvocationPreset {
  const nextPreset = { ...preset };

  (['image', 'video', 'audio', 'text'] as ModelType[]).forEach((routeType) => {
    if (getRouteProfileId(nextPreset[routeType]) === profileId) {
      nextPreset[routeType] = createRouteConfig(null);
    }
  });

  return nextPreset;
}

function areEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildPresetRouteModels(
  routeGroups: Array<{ profile: ProviderProfile; models: ModelConfig[] }>
): ModelConfig[] {
  return routeGroups.flatMap(({ profile, models }) =>
    models.map((model) => ({
      ...model,
      sourceProfileId: profile.id,
      sourceProfileName: profile.name,
      selectionKey: model.selectionKey || `${profile.id}::${model.id}`,
    }))
  );
}

function createEndpointOption(
  endpoint:
    | string
    | {
        name?: string;
        url?: string;
        description?: string;
      },
  index: number,
  removable = false
): EndpointOption {
  const url = typeof endpoint === 'string' ? endpoint : endpoint.url || '';
  const normalizedUrl = normalizeEndpointUrl(url);
  return {
    id: `${removable ? 'custom' : 'tuzi-api'}-${index}-${normalizedUrl}`,
    url: normalizedUrl,
    shortLabel: removable
      ? '自定义'
      : typeof endpoint === 'string'
      ? index === 0
        ? '主'
        : `S${index + 1}`
      : endpoint.name || (index === 0 ? '主' : `S${index + 1}`),
    name: typeof endpoint === 'string' ? undefined : endpoint.name,
    description:
      typeof endpoint === 'string' ? undefined : endpoint.description,
    removable,
  };
}

async function loadTuziApiEndpointOptions(): Promise<EndpointOption[]> {
  if (tuziApiEndpointCache) {
    return tuziApiEndpointCache;
  }

  const sourceEndpoints = await loadTuziApiEndpointSources();
  tuziApiEndpointCache = sourceEndpoints.map((endpoint, index) =>
    createEndpointOption(endpoint, index)
  );
  return tuziApiEndpointCache;
}

async function measureEndpointLatency(url: string): Promise<EndpointLatency> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4500);

  try {
    await fetch(normalizeEndpointUrl(url), {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    });
    return Math.max(1, Math.round(performance.now() - startedAt));
  } catch {
    return 'failed';
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const SettingsDialog = ({
  container,
}: {
  container: HTMLElement | null;
}) => {
  const { appState, setAppState } = useDrawnix();
  const { confirm, confirmDialog } = useConfirmDialog({ container });
  const {
    isMobile: isMobileDevice,
    viewportWidth,
    viewportHeight,
  } = useDeviceType();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [dialogWidth, setDialogWidth] = useState(0);
  const settingsSections = useMemo(
    () =>
      isTuziEmbeddedMode()
        ? [TUZI_ACCOUNT_SECTION, ...VIEW_SECTIONS]
        : VIEW_SECTIONS,
    []
  );

  const [activeView, setActiveView] = useState<SettingsView>(() =>
    isTuziEmbeddedMode() ? 'tuzi-account' : 'providers'
  );
  const [selectedProfileId, setSelectedProfileId] = useState(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  );
  const [selectedPresetId, setSelectedPresetId] = useState(
    DEFAULT_INVOCATION_PRESET_ID
  );
  const [profilesDraft, setProfilesDraft] = useState<ProviderProfile[]>([]);
  const [presetsDraft, setPresetsDraft] = useState<InvocationPreset[]>([]);
  const [activePresetIdDraft, setActivePresetIdDraft] = useState(
    DEFAULT_INVOCATION_PRESET_ID
  );
  const [initialProfiles, setInitialProfiles] = useState<ProviderProfile[]>([]);
  const [audioModelName, setAudioModelName] = useState('');
  const [imageModelName, setImageModelName] = useState('');
  const [videoModelName, setVideoModelName] = useState('');
  const [textModelName, setTextModelName] = useState('');
  const [showWorkZoneCard, setShowWorkZoneCard] = useState(true);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [discoveryDialogOpen, setDiscoveryDialogOpen] = useState(false);
  const [customModelId, setCustomModelId] = useState('');
  const [customModelType, setCustomModelType] = useState<ModelType>('image');
  const [customModelLabel, setCustomModelLabel] = useState('');
  const [customModelDescription, setCustomModelDescription] = useState('');
  const [customModelInterfacePreset, setCustomModelInterfacePreset] =
    useState<CustomModelInterfacePreset>(
      DEFAULT_CUSTOM_MODEL_PRESET_BY_TYPE.image
    );
  const [customHttpDraft, setCustomHttpDraft] = useState<CustomHttpDraft>(
    () => ({
      ...CUSTOM_HTTP_DEFAULTS.image,
    })
  );
  const [customHttpAdvancedOpen, setCustomHttpAdvancedOpen] = useState(true);
  const [customModelError, setCustomModelError] = useState('');
  const [initialDraftSignature, setInitialDraftSignature] = useState('');
  const [isPersisting, setIsPersisting] = useState(false);
  const [compactProviderMode, setCompactProviderMode] =
    useState<CompactPanelMode>('catalog');
  const [compactPresetMode, setCompactPresetMode] =
    useState<CompactPanelMode>('catalog');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<ModelType>>(
    new Set()
  );
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [endpointSelectionMode, setEndpointSelectionMode] =
    useState<EndpointSelectionMode>('auto');
  const [selectedEndpointUrl, setSelectedEndpointUrl] = useState(() =>
    normalizeEndpointUrl(geminiSettings.get().baseUrl)
  );
  const [tuziApiEndpointOptions, setTuziApiEndpointOptions] = useState<
    EndpointOption[]
  >([]);
  const [customEndpointOptions, setCustomEndpointOptions] = useState<
    EndpointOption[]
  >([]);
  const [endpointLatencies, setEndpointLatencies] = useState<
    Record<string, EndpointLatency>
  >({});
  const [isEndpointTesting, setIsEndpointTesting] = useState(false);
  const [customEndpointUrl, setCustomEndpointUrl] = useState('');
  const [endpointAddError, setEndpointAddError] = useState('');
  const [tuziApiEndpointLoadError, setTuziApiEndpointLoadError] = useState('');

  const toggleGroupCollapse = (type: ModelType) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const selectedProfile =
    profilesDraft.find((profile) => profile.id === selectedProfileId) ||
    profilesDraft[0] ||
    null;
  const isSelectedTuziProfile = isTuziProviderProfile(selectedProfile);
  const selectedImageApiCompatibilityHint = selectedProfile
    ? getImageApiCompatibilityHint(selectedProfile)
    : '同一个图片模型在不同 API Key 或网关下可能需要不同接口格式；不确定时使用自动。';
  const selectedPreset =
    presetsDraft.find((preset) => preset.id === selectedPresetId) ||
    presetsDraft[0] ||
    null;

  const runtimeState = useRuntimeModelDiscoveryState(
    selectedProfile?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  );
  const deferredModelSearchQuery = useDeferredValue(modelSearchQuery);
  const legacyImageModels = useProfilePreferredModels(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    'image'
  );
  const legacyAudioModels = useProfilePreferredModels(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    'audio'
  );
  const legacyVideoModels = useProfilePreferredModels(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    'video'
  );
  const legacyTextModels = useProfilePreferredModels(
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    'text'
  );

  const enabledProfiles = profilesDraft.filter((profile) => profile.enabled);
  const showTuziProviders = !isTuziEmbeddedMode() || hasTuziSystemToken();
  const isCompactLayout =
    isMobileDevice || viewportWidth <= SETTINGS_DIALOG_COMPACT_BREAKPOINT;

  const isSinglePanel =
    isCompactLayout &&
    (dialogWidth > 0 ? dialogWidth < 600 : viewportWidth < 600);

  const canManageModels = !!selectedProfile && !!selectedProfile.apiKey.trim();
  const currentDraftSignature = createSettingsDraftSignature({
    profiles: profilesDraft,
    presets: presetsDraft,
    activePresetId: activePresetIdDraft,
    audioModelName,
    imageModelName,
    videoModelName,
    textModelName,
    showWorkZoneCard,
  });
  const hasPendingChanges =
    appState.openSettings && currentDraftSignature !== initialDraftSignature;

  const endpointOptions = useMemo(() => {
    const map = new Map<string, EndpointOption>();
    const push = (option: EndpointOption) => {
      const normalizedUrl = normalizeEndpointUrl(option.url);
      if (!normalizedUrl || map.has(normalizedUrl)) {
        return;
      }
      map.set(normalizedUrl, { ...option, url: normalizedUrl });
    };

    tuziApiEndpointOptions.forEach(push);
    customEndpointOptions.forEach(push);

    return Array.from(map.values());
  }, [customEndpointOptions, tuziApiEndpointOptions]);

  const bestEndpoint = useMemo(() => {
    const measured = endpointOptions
      .map((endpoint) => ({
        endpoint,
        latency: endpointLatencies[endpoint.url],
      }))
      .filter(
        (entry): entry is { endpoint: EndpointOption; latency: number } =>
          typeof entry.latency === 'number'
      )
      .sort((a, b) => a.latency - b.latency);

    return (
      measured[0]?.endpoint ||
      endpointOptions[0] || {
        id: 'fallback-tuzi-api-primary',
        url: normalizeEndpointUrl(TUZI_API_FALLBACK_ENDPOINTS[0].url),
        shortLabel: TUZI_API_FALLBACK_ENDPOINTS[0].name,
        name: TUZI_API_FALLBACK_ENDPOINTS[0].name,
        description: TUZI_API_FALLBACK_ENDPOINTS[0].description,
      }
    );
  }, [endpointLatencies, endpointOptions]);

  const activeEndpoint =
    endpointOptions.find((endpoint) => endpoint.url === selectedEndpointUrl) ||
    bestEndpoint;

  useEffect(() => {
    setIsApiKeyVisible(false);
  }, [selectedProfile?.id]);

  useEffect(() => {
    const target = dialogRef.current;

    if (!target || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width) {
        return;
      }

      setDialogWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
    });

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [appState.openSettings]);

  const handleViewChange = async (nextView: SettingsView) => {
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'view_changed',
      control: 'settings_nav',
      value: nextView,
      source: 'settings_dialog',
    });
    setActiveView(nextView);

    if (nextView === 'providers' && isTuziEmbeddedMode()) {
      const safeProfiles = cloneValue(providerProfilesSettings.get());
      setProfilesDraft(safeProfiles);
      setSelectedProfileId((currentProfileId) =>
        safeProfiles.some((profile) => profile.id === currentProfileId)
          ? currentProfileId
          : safeProfiles[0]?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      );

      void syncTuziSessionProviders({ discoverModels: false }).then(
        (synchronized) => {
          if (!synchronized) return;
          const nextProfiles = cloneValue(providerProfilesSettings.get());
          setProfilesDraft(nextProfiles);
          setInitialProfiles(nextProfiles);
          setSelectedProfileId((currentProfileId) =>
            nextProfiles.some((profile) => profile.id === currentProfileId)
              ? currentProfileId
              : nextProfiles[0]?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
          );
          syncPersistedBaseline();
        }
      );
    }

    if (!isCompactLayout) {
      return;
    }

    if (nextView === 'providers') {
      setCompactProviderMode('catalog');
    }

    if (nextView === 'presets') {
      setCompactPresetMode('catalog');
    }
  };

  const handleSelectProfile = (profileId: string) => {
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'provider_selected',
      control: 'provider_list',
      source: 'settings_dialog',
      metadata: {
        profileId,
        isManagedProfile: isManagedProviderProfile(profileId),
      },
    });
    setSelectedProfileId(profileId);

    if (isCompactLayout) {
      setCompactProviderMode('detail');
    }
  };

  const handleSelectPreset = (presetId: string) => {
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'preset_selected',
      control: 'preset_list',
      source: 'settings_dialog',
      metadata: { presetId },
    });
    setSelectedPresetId(presetId);

    if (isCompactLayout) {
      setCompactPresetMode('detail');
    }
  };

  const readPersistedWorkZoneCard = () => {
    try {
      return localStorage.getItem(LS_KEYS.WORKZONE_CARD_VISIBLE) !== 'false';
    } catch {
      return true;
    }
  };

  const syncPersistedBaseline = () => {
    const persistedProfiles = cloneValue(providerProfilesSettings.get());
    const persistedPresets = cloneValue(invocationPresetsSettings.get());
    const persistedActivePresetId =
      invocationPresetsSettings.getActivePresetId() ||
      DEFAULT_INVOCATION_PRESET_ID;
    const persistedGemini = geminiSettings.get();
    const persistedShowWorkZoneCard = readPersistedWorkZoneCard();

    setInitialProfiles(persistedProfiles);
    setInitialDraftSignature(
      createSettingsDraftSignature({
        profiles: persistedProfiles,
        presets: persistedPresets,
        activePresetId: persistedActivePresetId,
        audioModelName:
          persistedGemini.audioModelName || getDefaultAudioModel(),
        imageModelName:
          persistedGemini.imageModelName || getDefaultImageModel(),
        videoModelName:
          persistedGemini.videoModelName || getDefaultVideoModel(),
        textModelName: persistedGemini.textModelName || getDefaultTextModel(),
        showWorkZoneCard: persistedShowWorkZoneCard,
      })
    );
  };

  const handleTuziProvidersChanged = () => {
    const nextProfiles = cloneValue(providerProfilesSettings.get());
    setProfilesDraft(nextProfiles);
    setInitialProfiles(nextProfiles);
    setSelectedProfileId((currentProfileId) => {
      const currentIsVisible = nextProfiles.some(
        (profile) =>
          profile.id === currentProfileId &&
          shouldShowProviderProfile(profile.id, hasTuziSystemToken())
      );
      if (currentIsVisible) return currentProfileId;

      return (
        nextProfiles.find((profile) =>
          shouldShowProviderProfile(profile.id, hasTuziSystemToken())
        )?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      );
    });
    syncPersistedBaseline();
  };

  useEffect(() => {
    if (!appState.openSettings) {
      return;
    }

    setIsApiKeyVisible(false);
    const nextProfiles = cloneValue(providerProfilesSettings.get());
    const nextPresets = cloneValue(invocationPresetsSettings.get());
    const nextActivePresetId =
      invocationPresetsSettings.getActivePresetId() ||
      DEFAULT_INVOCATION_PRESET_ID;
    const geminiConfig = geminiSettings.get();
    let nextShowWorkZoneCard = true;
    const pendingProviderIntent = readPendingProviderNavigationIntent();
    const nextSelectedProfileId =
      pendingProviderIntent?.action === 'select' &&
      nextProfiles.some(
        (profile) => profile.id === pendingProviderIntent.profileId
      )
        ? pendingProviderIntent.profileId
        : nextProfiles.some(
            (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
          )
        ? LEGACY_DEFAULT_PROVIDER_PROFILE_ID
        : nextProfiles[0]?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID;

    setProfilesDraft(nextProfiles);
    setPresetsDraft(nextPresets);
    setInitialProfiles(nextProfiles);
    setActivePresetIdDraft(nextActivePresetId);
    setSelectedProfileId(nextSelectedProfileId);
    setSelectedPresetId((currentPresetId) =>
      nextPresets.some((preset) => preset.id === currentPresetId)
        ? currentPresetId
        : nextPresets[0]?.id || DEFAULT_INVOCATION_PRESET_ID
    );
    setAudioModelName(geminiConfig.audioModelName || getDefaultAudioModel());
    setImageModelName(geminiConfig.imageModelName || getDefaultImageModel());
    setVideoModelName(geminiConfig.videoModelName || getDefaultVideoModel());
    setTextModelName(geminiConfig.textModelName || getDefaultTextModel());

    try {
      nextShowWorkZoneCard =
        localStorage.getItem(LS_KEYS.WORKZONE_CARD_VISIBLE) !== 'false';
    } catch {
      nextShowWorkZoneCard = true;
    }
    setShowWorkZoneCard(nextShowWorkZoneCard);

    const nextActiveView: SettingsView = 'providers';
    setActiveView(nextActiveView);
    setCompactProviderMode(
      pendingProviderIntent && isCompactLayout ? 'detail' : 'catalog'
    );
    setCompactPresetMode('catalog');
    setModelSearchQuery('');
    setDiscoveryDialogOpen(false);
    setInitialDraftSignature(
      createSettingsDraftSignature({
        profiles: nextProfiles,
        presets: nextPresets,
        activePresetId: nextActivePresetId,
        audioModelName: geminiConfig.audioModelName || getDefaultAudioModel(),
        imageModelName: geminiConfig.imageModelName || getDefaultImageModel(),
        videoModelName: geminiConfig.videoModelName || getDefaultVideoModel(),
        textModelName: geminiConfig.textModelName || getDefaultTextModel(),
        showWorkZoneCard: nextShowWorkZoneCard,
      })
    );

    if (pendingProviderIntent?.action === 'create') {
      applyProviderNavigationIntent(pendingProviderIntent, nextProfiles);
    }
  }, [appState.openSettings]);

  useEffect(() => {
    if (!selectedProfileId && profilesDraft[0]) {
      setSelectedProfileId(profilesDraft[0].id);
      return;
    }

    if (
      selectedProfileId &&
      profilesDraft.length > 0 &&
      (!profilesDraft.some((profile) => profile.id === selectedProfileId) ||
        !shouldShowProviderProfile(selectedProfileId, showTuziProviders))
    ) {
      const firstVisibleProfile = profilesDraft.find((profile) =>
        shouldShowProviderProfile(profile.id, showTuziProviders)
      );
      if (firstVisibleProfile) setSelectedProfileId(firstVisibleProfile.id);
    }
  }, [profilesDraft, selectedProfileId, showTuziProviders]);

  useEffect(() => {
    if (!selectedPresetId && presetsDraft[0]) {
      setSelectedPresetId(presetsDraft[0].id);
      return;
    }

    if (
      selectedPresetId &&
      presetsDraft.length > 0 &&
      !presetsDraft.some((preset) => preset.id === selectedPresetId)
    ) {
      setSelectedPresetId(presetsDraft[0].id);
    }
  }, [presetsDraft, selectedPresetId]);

  useEffect(() => {
    setModelSearchQuery('');
  }, [selectedProfileId, activeView]);

  useEffect(() => {
    if (!appState.openSettings) {
      return;
    }

    let cancelled = false;
    loadTuziApiEndpointOptions()
      .then((options) => {
        if (cancelled) {
          return;
        }
        setTuziApiEndpointOptions(options);
        setTuziApiEndpointLoadError('');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.warn('[SettingsDialog] 加载 tuzi-api 端点失败:', error);
        setTuziApiEndpointOptions(
          TUZI_API_FALLBACK_ENDPOINTS.map((endpoint, index) =>
            createEndpointOption(endpoint, index)
          )
        );
        setTuziApiEndpointLoadError('tuzi-api 端点加载失败，已使用内置站点');
      });

    return () => {
      cancelled = true;
    };
  }, [appState.openSettings]);

  useEffect(() => {
    if (!selectedProfile) {
      return;
    }
    setSelectedEndpointUrl(
      resolveEndpointSelectionUrl(
        selectedProfile.baseUrl,
        endpointOptions.map((endpoint) => endpoint.url)
      )
    );
  }, [endpointOptions, selectedProfile?.baseUrl, selectedProfile?.id]);

  useEffect(() => {
    setEndpointSelectionMode('auto');
  }, [selectedProfile?.id]);

  const updateProfile = (
    profileId: string,
    updater: (profile: ProviderProfile) => ProviderProfile
  ) => {
    setProfilesDraft((current) =>
      current.map((profile) =>
        profile.id === profileId ? updater(profile) : profile
      )
    );
  };

  const updatePreset = (
    presetId: string,
    updater: (preset: InvocationPreset) => InvocationPreset
  ) => {
    setPresetsDraft((current) =>
      current.map((preset) =>
        preset.id === presetId ? updater(preset) : preset
      )
    );
  };

  const handleEndpointSelect = useCallback(
    (url: string, mode: EndpointSelectionMode = 'manual') => {
      if (!selectedProfile) {
        return;
      }
      const normalizedUrl = normalizeEndpointUrl(url);
      const normalizedApiBaseUrl = normalizeEndpointApiBaseUrl(normalizedUrl);
      setEndpointSelectionMode(mode);
      setSelectedEndpointUrl(normalizedUrl);
      updateProfile(selectedProfile.id, (profile) => ({
        ...profile,
        baseUrl: normalizedApiBaseUrl,
      }));
    },
    [selectedProfile?.id]
  );

  const handleEndpointAutoSelectChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        handleEndpointSelect(bestEndpoint.url, 'auto');
        return;
      }
      handleEndpointSelect(activeEndpoint.url, 'manual');
    },
    [activeEndpoint.url, bestEndpoint.url, handleEndpointSelect]
  );

  const handleAddCustomEndpoint = useCallback(() => {
    const normalizedUrl = normalizeEndpointUrl(customEndpointUrl);

    if (!/^https?:\/\/[^/]+\.[^/]+/i.test(normalizedUrl)) {
      setEndpointAddError('请输入有效的端点地址');
      return;
    }

    if (endpointOptions.some((endpoint) => endpoint.url === normalizedUrl)) {
      setEndpointAddError('端点已存在');
      return;
    }

    const nextEndpoint = createEndpointOption(
      normalizedUrl,
      customEndpointOptions.length,
      true
    );
    setCustomEndpointOptions((prev) => [...prev, nextEndpoint]);
    setCustomEndpointUrl('');
    setEndpointAddError('');
    handleEndpointSelect(nextEndpoint.url, 'manual');
  }, [
    customEndpointOptions.length,
    customEndpointUrl,
    endpointOptions,
    handleEndpointSelect,
  ]);

  const handleRemoveCustomEndpoint = useCallback(
    (endpoint: EndpointOption) => {
      if (!endpoint.removable) {
        return;
      }
      setCustomEndpointOptions((prev) =>
        prev.filter((item) => item.url !== endpoint.url)
      );
      setEndpointLatencies((prev) => {
        const next = { ...prev };
        delete next[endpoint.url];
        return next;
      });
      if (selectedEndpointUrl === endpoint.url) {
        handleEndpointSelect(bestEndpoint.url, 'auto');
      }
    },
    [bestEndpoint.url, handleEndpointSelect, selectedEndpointUrl]
  );

  const handleRunEndpointSpeedTest = useCallback(async () => {
    if (isEndpointTesting || endpointOptions.length === 0) {
      return;
    }

    setIsEndpointTesting(true);
    setEndpointLatencies((prev) => {
      const next = { ...prev };
      for (const endpoint of endpointOptions) {
        next[endpoint.url] = null;
      }
      return next;
    });

    const results = await Promise.all(
      endpointOptions.map(async (endpoint) => ({
        url: endpoint.url,
        latency: await measureEndpointLatency(endpoint.url),
      }))
    );
    setEndpointLatencies(
      results.reduce<Record<string, EndpointLatency>>((acc, result) => {
        acc[result.url] = result.latency;
        return acc;
      }, {})
    );
    setIsEndpointTesting(false);

    if (endpointSelectionMode === 'auto') {
      const fastest = results
        .filter(
          (result): result is { url: string; latency: number } =>
            typeof result.latency === 'number'
        )
        .sort((a, b) => a.latency - b.latency)[0];
      if (fastest) {
        handleEndpointSelect(fastest.url, 'auto');
      }
    }
  }, [
    endpointOptions,
    endpointSelectionMode,
    handleEndpointSelect,
    isEndpointTesting,
  ]);

  const persistPresetConfiguration = async (
    nextPresets: InvocationPreset[],
    nextActivePresetId: string
  ): Promise<boolean> => {
    try {
      const persistedGemini = geminiSettings.get();
      const effectiveActivePresetId =
        nextPresets.find((preset) => preset.id === nextActivePresetId)?.id ||
        nextPresets[0]?.id ||
        DEFAULT_INVOCATION_PRESET_ID;
      const activePreset =
        nextPresets.find((preset) => preset.id === effectiveActivePresetId) ||
        nextPresets[0] ||
        null;
      const nextAudioModelName =
        getRouteModelId(activePreset?.audio) ||
        persistedGemini.audioModelName ||
        getDefaultAudioModel();
      const nextImageModelName =
        getRouteModelId(activePreset?.image) ||
        persistedGemini.imageModelName ||
        getDefaultImageModel();
      const nextVideoModelName =
        getRouteModelId(activePreset?.video) ||
        persistedGemini.videoModelName ||
        getDefaultVideoModel();
      const nextTextModelName =
        getRouteModelId(activePreset?.text) ||
        persistedGemini.textModelName ||
        persistedGemini.chatModel ||
        getDefaultTextModel();

      await settingsManager.updateSettings({
        invocationPresets: cloneValue(nextPresets),
        activePresetId: effectiveActivePresetId,
        gemini: {
          ...persistedGemini,
          audioModelName: nextAudioModelName,
          imageModelName: nextImageModelName,
          videoModelName: nextVideoModelName,
          textModelName: nextTextModelName,
          chatModel: nextTextModelName,
        },
      });

      setPresetsDraft(nextPresets);
      setActivePresetIdDraft(effectiveActivePresetId);
      setAudioModelName(nextAudioModelName);
      setImageModelName(nextImageModelName);
      setVideoModelName(nextVideoModelName);
      setTextModelName(nextTextModelName);
      syncPersistedBaseline();

      return true;
    } catch (error) {
      console.error('Failed to persist preset configuration:', error);
      MessagePlugin.error('预设保存失败，请重试');
      return false;
    }
  };

  const activateCustomModelForCurrentPreset = async (
    profileId: string,
    modelId: string,
    modelType: ModelType
  ): Promise<boolean> => {
    const fallbackPreset =
      presetsDraft.length === 0
        ? createPreset(profileId, {
            audio: audioModelName || getDefaultAudioModel(),
            image: imageModelName || getDefaultImageModel(),
            video: videoModelName || getDefaultVideoModel(),
            text: textModelName || getDefaultTextModel(),
          })
        : null;
    const basePresets = fallbackPreset ? [fallbackPreset] : presetsDraft;
    const targetPresetId =
      basePresets.find((preset) => preset.id === activePresetIdDraft)?.id ||
      basePresets[0]?.id ||
      DEFAULT_INVOCATION_PRESET_ID;
    const nextModelRef = createModelRef(profileId, modelId);
    const nextPresets = basePresets.map((preset) =>
      preset.id === targetPresetId
        ? updatePresetRoute(preset, modelType, {
            defaultModelRef: nextModelRef,
          })
        : preset
    );

    setSelectedPresetId(targetPresetId);
    const persisted = await persistPresetConfiguration(
      nextPresets,
      targetPresetId
    );
    if (!persisted) {
      return false;
    }

    setPresetsDraft((current) =>
      current.map((preset) =>
        preset.id === targetPresetId
          ? updatePresetRoute(preset, modelType, {
              defaultModelRef: nextModelRef,
            })
          : preset
      )
    );

    return true;
  };

  const handleProviderEnabledChange = (profileId: string, enabled: boolean) => {
    if (!enabled && !canDisableProvider(profilesDraft, profileId)) {
      MessagePlugin.warning('至少需要保留一个启用的供应商');
      return;
    }

    analytics.trackUIInteraction({
      area: 'settings',
      action: 'provider_enabled_changed',
      control: 'provider_enabled_switch',
      value: enabled,
      source: 'settings_dialog',
      metadata: {
        profileId,
        isManagedProfile: isManagedProviderProfile(profileId),
      },
    });
    setProfilesDraft((current) =>
      current.map((profile) =>
        profile.id === profileId ? { ...profile, enabled } : profile
      )
    );
  };

  const handleCanvasVisibilityChange = async (checked: boolean) => {
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'workzone_card_visibility_changed',
      control: 'workzone_card_switch',
      value: checked,
      source: 'settings_dialog',
    });
    setShowWorkZoneCard(checked);

    try {
      localStorage.setItem(LS_KEYS.WORKZONE_CARD_VISIBLE, String(checked));
      window.dispatchEvent(new CustomEvent('workzone-visibility-changed'));
      syncPersistedBaseline();
    } catch (error) {
      console.error('Failed to persist canvas visibility state:', error);
      setShowWorkZoneCard(!checked);
      MessagePlugin.error('画布显示配置保存失败，请重试');
    }
  };

  const applyProviderNavigationIntent = (
    intent: ProviderNavigationIntent,
    baseProfiles?: ProviderProfile[]
  ) => {
    const sourceProfiles = baseProfiles || profilesDraft;

    setActiveView('providers');
    if (isCompactLayout) {
      setCompactProviderMode('detail');
    }

    if (intent.action === 'select') {
      const targetProfileId = sourceProfiles.some(
        (profile) => profile.id === intent.profileId
      )
        ? intent.profileId
        : sourceProfiles[sourceProfiles.length - 1]?.id ||
          LEGACY_DEFAULT_PROVIDER_PROFILE_ID;
      setSelectedProfileId(targetProfileId);
      return sourceProfiles;
    }

    const nextProfile = createProfile(sourceProfiles.length + 1);
    const nextProfiles = [...sourceProfiles, nextProfile];
    setProfilesDraft(nextProfiles);
    setSelectedProfileId(nextProfile.id);
    return nextProfiles;
  };

  const handleAddProfile = () => {
    const nextProfile = createProfile(profilesDraft.length + 1);
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'provider_added',
      control: 'add_provider',
      source: 'settings_dialog',
      metadata: { profilesCount: profilesDraft.length + 1 },
    });
    setProfilesDraft((current) => [...current, nextProfile]);
    setSelectedProfileId(nextProfile.id);
    setActiveView('providers');

    if (isCompactLayout) {
      setCompactProviderMode('detail');
    }
  };

  useEffect(() => {
    if (!appState.openSettings) {
      return;
    }

    const handleProviderNavigation = (event: Event) => {
      const detail = (event as CustomEvent<ProviderNavigationIntent>).detail;
      if (!detail) {
        return;
      }
      applyProviderNavigationIntent(detail);
    };

    window.addEventListener(
      SETTINGS_PROVIDER_NAV_EVENT,
      handleProviderNavigation as EventListener
    );

    return () => {
      window.removeEventListener(
        SETTINGS_PROVIDER_NAV_EVENT,
        handleProviderNavigation as EventListener
      );
    };
  }, [appState.openSettings, isCompactLayout, profilesDraft]);

  const handleDeleteProfile = async (profileId: string) => {
    if (isManagedProviderProfile(profileId)) {
      return;
    }

    const profile = profilesDraft.find((item) => item.id === profileId);
    const confirmed = await confirm({
      title: '确认删除供应商',
      description: `确定要删除供应商「${
        profile?.name || '未命名供应商'
      }」吗？相关预设里的路由会被清空。`,
      confirmText: '删除',
      cancelText: '取消',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    analytics.trackUIInteraction({
      area: 'settings',
      action: 'provider_deleted',
      control: 'delete_provider',
      source: 'settings_dialog',
      metadata: {
        profileId,
        profilesCount: Math.max(0, profilesDraft.length - 1),
      },
    });

    const remainingProfiles = profilesDraft.filter(
      (profile) => profile.id !== profileId
    );
    setProfilesDraft(remainingProfiles);
    setPresetsDraft((current) =>
      current.map((preset) => clearPresetProfileRoute(preset, profileId))
    );
    if (selectedProfileId === profileId) {
      setSelectedProfileId(
        remainingProfiles[0]?.id || LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      );
    }

    if (isCompactLayout) {
      setCompactProviderMode('catalog');
    }
  };

  const handleCloneProfile = useCallback(
    (profileId: string) => {
      const source = profilesDraft.find((p) => p.id === profileId);
      if (!source) return;
      const cloned: ProviderProfile = {
        ...cloneValue(source),
        id: createId('profile'),
        name: `${source.name} (副本)`,
      };
      setProfilesDraft((current) => [...current, cloned]);
      analytics.trackUIInteraction({
        area: 'settings',
        action: 'provider_cloned',
        control: 'clone_provider',
        source: 'settings_dialog',
        metadata: {
          profileId,
          clonedProfileId: cloned.id,
          profilesCount: profilesDraft.length + 1,
        },
      });
      setSelectedProfileId(cloned.id);
      setActiveView('providers');
      if (isCompactLayout) {
        setCompactProviderMode('detail');
      }
    },
    [profilesDraft, isCompactLayout]
  );

  const providerContextMenu = useContextMenuState<string>();

  const providerContextMenuItems = useCallback(
    (profileId: string): ContextMenuEntry<string>[] => {
      const items: ContextMenuEntry<string>[] = [
        {
          key: 'clone',
          label: '克隆',
          icon: <Copy size={14} />,
          onSelect: handleCloneProfile,
        },
      ];
      if (!isManagedProviderProfile(profileId)) {
        items.push(
          { key: 'divider', type: 'divider' },
          {
            key: 'delete',
            label: '删除',
            icon: <Trash2 size={14} />,
            danger: true,
            onSelect: handleDeleteProfile,
          }
        );
      }
      return items;
    },
    [handleCloneProfile]
  );

  const handleAddPreset = () => {
    const fallbackProfileId = enabledProfiles[0]?.id || null;
    const nextPreset = createPreset(fallbackProfileId, {
      audio: audioModelName || getDefaultAudioModel(),
      image: imageModelName || getDefaultImageModel(),
      video: videoModelName || getDefaultVideoModel(),
      text: textModelName || getDefaultTextModel(),
    });
    setPresetsDraft((current) => [...current, nextPreset]);
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'preset_added',
      control: 'add_preset',
      source: 'settings_dialog',
      metadata: {
        presetId: nextPreset.id,
        presetsCount: presetsDraft.length + 1,
        hasFallbackProfile: !!fallbackProfileId,
      },
    });
    setSelectedPresetId(nextPreset.id);
    setActiveView('presets');

    if (isCompactLayout) {
      setCompactPresetMode('detail');
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (presetsDraft.length <= 1) {
      return;
    }

    const preset = presetsDraft.find((item) => item.id === presetId);
    const confirmed = await confirm({
      title: '确认删除预设',
      description: `确定要删除预设「${
        preset?.name || '未命名预设'
      }」吗？此操作不可撤销。`,
      confirmText: '删除',
      cancelText: '取消',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    analytics.trackUIInteraction({
      area: 'settings',
      action: 'preset_deleted',
      control: 'delete_preset',
      source: 'settings_dialog',
      metadata: {
        presetId,
        presetsCount: Math.max(0, presetsDraft.length - 1),
      },
    });

    const remainingPresets = presetsDraft.filter(
      (preset) => preset.id !== presetId
    );
    setPresetsDraft(remainingPresets);

    if (activePresetIdDraft === presetId) {
      setActivePresetIdDraft(
        remainingPresets[0]?.id || DEFAULT_INVOCATION_PRESET_ID
      );
    }
    if (selectedPresetId === presetId) {
      setSelectedPresetId(
        remainingPresets[0]?.id || DEFAULT_INVOCATION_PRESET_ID
      );
    }

    if (isCompactLayout) {
      setCompactPresetMode('catalog');
    }
  };

  const handleRouteModelChange = (
    routeType: ModelType,
    nextModelRef: ModelRef | null
  ) => {
    if (!selectedPreset) {
      return;
    }

    const nextPresets = presetsDraft.map((preset) =>
      preset.id === selectedPreset.id
        ? updatePresetRoute(preset, routeType, {
            defaultModelRef: nextModelRef,
          })
        : preset
    );

    setPresetsDraft(nextPresets);
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'route_model_changed',
      control: 'route_model_dropdown',
      value: routeType,
      source: 'settings_dialog',
      metadata: {
        presetId: selectedPreset.id,
        routeType,
        hasModel: !!nextModelRef?.modelId,
        hasProfile: !!nextModelRef?.profileId,
      },
    });
    void persistPresetConfiguration(nextPresets, activePresetIdDraft);
  };

  const handleFetchModels = async () => {
    if (!selectedProfile) {
      MessagePlugin.warning('请先选择供应商配置');
      return;
    }

    if (hasPendingChanges) {
      const saved = await persistDrafts(false);
      if (!saved) {
        return;
      }
    }

    const trimmedApiKey = selectedProfile.apiKey.trim();
    const normalizedBaseUrl = normalizeModelApiBaseUrl(
      selectedProfile.baseUrl.trim() || TUZI_PROVIDER_DEFAULT_BASE_URL
    );

    if (!trimmedApiKey) {
      MessagePlugin.warning('请先填写 API Key');
      return;
    }

    try {
      analytics.trackUIInteraction({
        area: 'settings',
        action: 'model_discovery_started',
        control: 'fetch_models',
        source: 'settings_dialog',
        metadata: { profileId: selectedProfile.id },
      });
      await runtimeModelDiscovery.discover(
        selectedProfile.id,
        normalizedBaseUrl,
        trimmedApiKey,
        isSelectedTuziProfile
          ? tuziApiEndpointOptions.map((endpoint) => endpoint.url)
          : []
      );
      analytics.trackUIInteraction({
        area: 'settings',
        action: 'model_discovery_succeeded',
        control: 'fetch_models',
        source: 'settings_dialog',
        metadata: { profileId: selectedProfile.id },
      });
      setDiscoveryDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型同步失败';
      analytics.trackUIInteraction({
        area: 'settings',
        action: 'model_discovery_failed',
        control: 'fetch_models',
        source: 'settings_dialog',
        metadata: {
          profileId: selectedProfile.id,
          error: message,
        },
      });
      runtimeModelDiscovery.setError(selectedProfile.id, message);
      MessagePlugin.error({
        content: message,
        duration: 3600,
      });
    }
  };

  const syncLegacyDefaultModelNamesAfterSelection = (
    selectedModels: ModelConfig[]
  ) => {
    const nextImageModels = selectedModels.filter(
      (model) => model.type === 'image'
    );
    const nextVideoModels = selectedModels.filter(
      (model) => model.type === 'video'
    );
    const nextTextModels = selectedModels.filter(
      (model) => model.type === 'text'
    );
    const discoveredImageIds = runtimeState.discoveredModels
      .filter((model) => model.type === 'image')
      .map((model) => model.id);
    const discoveredVideoIds = runtimeState.discoveredModels
      .filter((model) => model.type === 'video')
      .map((model) => model.id);
    const discoveredTextIds = runtimeState.discoveredModels
      .filter((model) => model.type === 'text')
      .map((model) => model.id);

    if (
      !nextImageModels.some((model) => model.id === imageModelName) &&
      discoveredImageIds.includes(imageModelName)
    ) {
      setImageModelName(nextImageModels[0]?.id || getDefaultImageModel());
    }
    if (
      !nextVideoModels.some((model) => model.id === videoModelName) &&
      discoveredVideoIds.includes(videoModelName)
    ) {
      setVideoModelName(nextVideoModels[0]?.id || getDefaultVideoModel());
    }
    if (
      !nextTextModels.some((model) => model.id === textModelName) &&
      discoveredTextIds.includes(textModelName)
    ) {
      setTextModelName(nextTextModels[0]?.id || getDefaultTextModel());
    }
  };

  const handleApplySelectedModels = (
    selectedModelIds: string[],
    options?: {
      successMessage?: string;
    }
  ) => {
    if (!selectedProfile) {
      return;
    }

    const selectionChange = runtimeModelDiscovery.applySelection(
      selectedProfile.id,
      selectedModelIds
    );
    const selectedModels = selectionChange.models;

    if (selectedProfile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID) {
      syncLegacyDefaultModelNamesAfterSelection(selectedModels);
    }

    const successMessage =
      options?.successMessage ||
      buildModelSelectionChangeMessage(
        selectedProfile.name,
        selectionChange.addedModelIds.length,
        selectionChange.removedModelIds.length,
        selectedModels.length
      );

    if (successMessage) {
      MessagePlugin.success(successMessage);
    }
    analytics.trackUIInteraction({
      area: 'settings',
      action: 'discovered_models_applied',
      control: 'model_discovery_dialog',
      source: 'settings_dialog',
      metadata: {
        profileId: selectedProfile.id,
        selectedCount: selectedModels.length,
        addedCount: selectionChange.addedModelIds.length,
        removedCount: selectionChange.removedModelIds.length,
      },
    });
    setDiscoveryDialogOpen(false);
  };

  const handleCustomModelInterfacePresetChange = (
    value: CustomModelInterfacePreset
  ) => {
    const preset = CUSTOM_MODEL_INTERFACE_PRESETS[value];
    setCustomModelInterfacePreset(value);
    if (preset.modelType !== 'any') {
      setCustomModelType(preset.modelType);
    }
    if (value === 'custom-http') {
      setCustomHttpAdvancedOpen(true);
    }
    setCustomModelError('');
  };

  const handleCustomModelTypeChange = (value: ModelType) => {
    const presetKey = DEFAULT_CUSTOM_MODEL_PRESET_BY_TYPE[value];
    const preset = CUSTOM_MODEL_INTERFACE_PRESETS[presetKey];
    setCustomModelType(value);
    setCustomModelInterfacePreset(presetKey);
    setCustomHttpDraft({ ...CUSTOM_HTTP_DEFAULTS[value] });
    setCustomModelError('');
  };

  const updateCustomHttpDraft = <K extends keyof CustomHttpDraft>(
    key: K,
    value: CustomHttpDraft[K]
  ) => {
    setCustomHttpDraft((current) => ({ ...current, [key]: value }));
    setCustomModelError('');
  };

  const buildCustomHttpInvocation = () => {
    const submitPath = customHttpDraft.submitPath.trim();
    if (!submitPath) {
      throw new Error('请填写请求地址');
    }

    let headers: Record<string, string> | undefined;
    let formFields: ManualHttpFormField[] | undefined;
    try {
      const parsedHeaders = parseJsonObject(
        customHttpDraft.headersTemplate,
        '请求头'
      );
      headers =
        Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined;
      if (customHttpDraft.bodyType === 'form-data') {
        formFields = parseFormFields(customHttpDraft.formFieldsTemplate);
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('请求头或 FormData 字段不是有效 JSON');
      }
      throw error;
    }

    if (
      customHttpDraft.bodyType === 'json' &&
      customHttpDraft.bodyTemplate.trim()
    ) {
      try {
        JSON.parse(customHttpDraft.bodyTemplate);
      } catch {
        throw new Error('JSON 请求体模板格式错误');
      }
    }

    const pollPathTemplate = customHttpDraft.pollPath.trim() || undefined;
    const responsePath = customHttpDraft.responsePath.trim();
    const responsePaths: NonNullable<
      ManualHttpTemplateMetadata['responsePaths']
    > = {};
    if (customModelType === 'text') responsePaths.text = responsePath;
    if (customModelType === 'image') responsePaths.imageUrls = responsePath;
    if (customModelType === 'video') responsePaths.resultUrl = responsePath;
    if (customModelType === 'audio') responsePaths.audioUrls = responsePath;
    if (pollPathTemplate) {
      responsePaths.taskId = customHttpDraft.taskIdPath.trim() || 'task_id';
    }

    const pollResponsePaths = pollPathTemplate
      ? {
          status: customHttpDraft.statusPath.trim() || 'status',
          ...(customModelType === 'audio'
            ? {
                audioUrls:
                  customHttpDraft.pollResultPath.trim() ||
                  customHttpDraft.responsePath.trim(),
              }
            : {
                resultUrl:
                  customHttpDraft.pollResultPath.trim() ||
                  customHttpDraft.responsePath.trim(),
              }),
          error: customHttpDraft.errorPath.trim() || 'error.message',
        }
      : undefined;
    const manualHttp: ManualHttpTemplateMetadata = {
      method: customHttpDraft.method,
      bodyType: customHttpDraft.bodyType,
      headers,
      bodyTemplate:
        customHttpDraft.bodyType === 'json' ||
        customHttpDraft.bodyType === 'raw'
          ? customHttpDraft.bodyTemplate
          : undefined,
      formFields,
      responseKind: customModelType === 'video' ? 'task' : customModelType,
      responsePaths,
      pollResponsePaths,
    };

    return {
      protocol: 'custom-http',
      requestSchema: 'custom-http',
      responseSchema: `custom-http.${
        customModelType === 'video' ? 'task' : customModelType
      }`,
      submitPath,
      pollPathTemplate,
      metadata: { manualHttp },
    };
  };

  const buildCustomModelPresetMetadata = (
    preset: (typeof CUSTOM_MODEL_INTERFACE_PRESETS)[CustomModelInterfacePreset]
  ) => {
    const baseMetadata = (() => {
      if (customModelType === 'image') {
        return {
          image: {
            action:
              preset.protocol === 'openai.images.edits' ? 'edit' : 'generation',
          },
        };
      }

      if (customModelType === 'audio') {
        return {
          audio: {
            action: 'music',
            defaultAction: 'music',
            ...preset.metadata?.audio,
          },
        };
      }

      if (customModelType === 'video') {
        return {
          video: {
            durationMode: 'request-param',
          },
        };
      }

      if (customModelType === 'text') {
        return preset.metadata?.text
          ? {
              text: {
                ...preset.metadata.text,
                capabilitySource: 'manual',
                capabilityConfidence: 'high',
              },
            }
          : undefined;
      }

      return undefined;
    })();

    return baseMetadata;
  };

  const handleAddCustomModel = async () => {
    if (!selectedProfile) {
      MessagePlugin.warning('请先选择供应商配置');
      return;
    }

    const modelId = customModelId.trim();
    if (!modelId) {
      setCustomModelError('请填写模型 ID');
      return;
    }

    if (hasPendingChanges) {
      const saved = await persistDrafts(false);
      if (!saved) {
        return;
      }
    }

    try {
      const preset = CUSTOM_MODEL_INTERFACE_PRESETS[customModelInterfacePreset];
      const invocation =
        customModelInterfacePreset === 'custom-http'
          ? buildCustomHttpInvocation()
          : {
              protocol: preset.protocol,
              requestSchema: preset.requestSchema,
              responseSchema: preset.responseSchema,
              submitPath: preset.submitPath,
              baseUrlStrategy: preset.baseUrlStrategy,
              pollPathTemplate: preset.pollPathTemplate,
              metadata: buildCustomModelPresetMetadata(preset),
            };
      runtimeModelDiscovery.addManualModel(selectedProfile.id, {
        id: modelId,
        type: customModelType,
        label: customModelLabel,
        description: customModelDescription,
        invocation,
      });

      const activated = await activateCustomModelForCurrentPreset(
        selectedProfile.id,
        modelId,
        customModelType
      );

      setCustomModelId('');
      setCustomModelLabel('');
      setCustomModelDescription('');
      setCustomModelError('');
      MessagePlugin.success(
        activated
          ? `已添加并切换到自定义模型 ${modelId}`
          : `已添加自定义模型 ${modelId}`
      );
      analytics.trackUIInteraction({
        area: 'settings',
        action: 'custom_model_added',
        control: 'custom_model_form',
        source: 'settings_dialog',
        metadata: {
          profileId: selectedProfile.id,
          modelType: customModelType,
          interfacePreset: customModelInterfacePreset,
          submitPath: invocation.submitPath,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '自定义模型添加失败';
      setCustomModelError(message);
      MessagePlugin.error(message);
    }
  };

  const handleRemoveModel = (modelId: string) => {
    if (!selectedProfile) return;
    if (!runtimeState.selectedModelIds.includes(modelId)) {
      MessagePlugin.warning('该模型不是当前分组动态添加的模型，无法在此移除');
      return;
    }
    const selectionChange = runtimeModelDiscovery.removeModel(
      selectedProfile.id,
      modelId
    );
    const selectedModels = selectionChange.models;
    if (selectedProfile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID) {
      syncLegacyDefaultModelNamesAfterSelection(selectedModels);
    }
    const successMessage = buildModelSelectionChangeMessage(
      selectedProfile.name,
      selectionChange.addedModelIds.length,
      selectionChange.removedModelIds.length,
      selectionChange.models.length
    );
    if (successMessage) {
      MessagePlugin.success(successMessage);
    }
  };

  const closeSettingsDialog = () => {
    setAppState((prev) => ({ ...prev, openSettings: false }));
  };

  const persistDrafts = async (closeAfterSave = false): Promise<boolean> => {
    if (isPersisting) {
      return false;
    }

    setIsPersisting(true);
    try {
      const normalizedProfiles = profilesDraft.map((profile) => {
        const normalizedBaseUrl = profile.baseUrl.trim()
          ? normalizeModelApiBaseUrl(profile.baseUrl)
          : '';

        return {
          ...profile,
          name: profile.name.trim() || '未命名供应商',
          iconUrl: profile.iconUrl?.trim() || undefined,
          homepageUrl: profile.homepageUrl?.trim() || undefined,
          baseUrl: normalizedBaseUrl,
          apiKey: profile.apiKey.trim(),
        };
      });

      const profileIds = new Set(
        normalizedProfiles.map((profile) => profile.id)
      );
      const normalizedPresets = presetsDraft.map((preset) => {
        const nextPreset: InvocationPreset = {
          ...preset,
          name: preset.name.trim() || '未命名预设',
          audio: { ...preset.audio },
          image: { ...preset.image },
          video: { ...preset.video },
          text: { ...preset.text },
        };

        (['image', 'video', 'audio', 'text'] as ModelType[]).forEach(
          (routeType) => {
            const route = nextPreset[routeType];
            const routeProfileId = getRouteProfileId(route);
            const routeModelId = getRouteModelId(route);
            if (routeProfileId && !profileIds.has(routeProfileId)) {
              nextPreset[routeType] = createRouteConfig(
                createModelRef(null, routeModelId)
              );
              return;
            }

            nextPreset[routeType] = createRouteConfig(
              createModelRef(routeProfileId, routeModelId)
            );
          }
        );

        return nextPreset;
      });

      const normalizedActivePresetId =
        normalizedPresets.find((preset) => preset.id === activePresetIdDraft)
          ?.id ||
        normalizedPresets[0]?.id ||
        DEFAULT_INVOCATION_PRESET_ID;
      const activePreset =
        normalizedPresets.find(
          (preset) => preset.id === normalizedActivePresetId
        ) ||
        normalizedPresets[0] ||
        null;

      const legacyProfile =
        normalizedProfiles.find(
          (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
        ) || normalizedProfiles[0];

      const normalizedLegacyBaseUrl = normalizeModelApiBaseUrl(
        legacyProfile?.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL
      );
      const normalizedAudioModel =
        audioModelName.trim() ||
        legacyAudioModels[0]?.id ||
        getDefaultAudioModel();
      const normalizedImageModel =
        imageModelName.trim() ||
        legacyImageModels[0]?.id ||
        getDefaultImageModel();
      const normalizedVideoModel =
        videoModelName.trim() ||
        legacyVideoModels[0]?.id ||
        getDefaultVideoModel();
      const normalizedTextModel =
        textModelName.trim() ||
        legacyTextModels[0]?.id ||
        getDefaultTextModel();
      const normalizedActiveImageModel =
        getRouteModelId(activePreset?.image) || normalizedImageModel;
      const normalizedActiveVideoModel =
        getRouteModelId(activePreset?.video) || normalizedVideoModel;
      const normalizedActiveAudioModel =
        getRouteModelId(activePreset?.audio) || normalizedAudioModel;
      const normalizedActiveTextModel =
        getRouteModelId(activePreset?.text) || normalizedTextModel;

      normalizedProfiles.forEach((profile) => {
        runtimeModelDiscovery.invalidateIfConfigChanged(
          profile.id,
          profile.baseUrl || TUZI_PROVIDER_DEFAULT_BASE_URL,
          profile.apiKey || ''
        );
      });

      await settingsManager.updateSettings({
        gemini: {
          ...geminiSettings.get(),
          apiKey: legacyProfile?.apiKey || '',
          baseUrl: normalizedLegacyBaseUrl,
          audioModelName: normalizedActiveAudioModel,
          imageModelName: normalizedActiveImageModel,
          videoModelName: normalizedActiveVideoModel,
          textModelName: normalizedActiveTextModel,
        },
        providerProfiles: normalizedProfiles,
        providerCatalogs: runtimeModelDiscovery
          .getCatalogs()
          .filter((catalog) => profileIds.has(catalog.profileId)),
        invocationPresets: normalizedPresets,
        activePresetId: normalizedActivePresetId,
      });

      try {
        localStorage.setItem(
          LS_KEYS.WORKZONE_CARD_VISIBLE,
          String(showWorkZoneCard)
        );
        window.dispatchEvent(new CustomEvent('workzone-visibility-changed'));
      } catch {
        // localStorage not available
      }

      setProfilesDraft(normalizedProfiles);
      setInitialProfiles(cloneValue(normalizedProfiles));
      setPresetsDraft(normalizedPresets);
      setActivePresetIdDraft(normalizedActivePresetId);
      setAudioModelName(normalizedAudioModel);
      setImageModelName(normalizedImageModel);
      setVideoModelName(normalizedVideoModel);
      setTextModelName(normalizedTextModel);
      setInitialDraftSignature(
        createSettingsDraftSignature({
          profiles: normalizedProfiles,
          presets: normalizedPresets,
          activePresetId: normalizedActivePresetId,
          audioModelName: normalizedAudioModel,
          imageModelName: normalizedImageModel,
          videoModelName: normalizedVideoModel,
          textModelName: normalizedTextModel,
          showWorkZoneCard,
        })
      );

      if (closeAfterSave) {
        closeSettingsDialog();
      }

      analytics.trackUIInteraction({
        area: 'settings',
        action: 'settings_saved',
        control: 'save_settings',
        source: 'settings_dialog',
        metadata: {
          closeAfterSave,
          profilesCount: normalizedProfiles.length,
          presetsCount: normalizedPresets.length,
          enabledProfilesCount: normalizedProfiles.filter(
            (profile) => profile.enabled
          ).length,
        },
      });

      normalizedProfiles.forEach((profile) => {
        const endpoint = getProviderEndpointAnalytics(profile.baseUrl);
        analytics.track('provider_endpoint_configured', {
          profileId: profile.id,
          providerType: profile.providerType,
          providerOrigin: endpoint?.origin,
          providerHost: endpoint?.host,
          providerProtocol: endpoint?.protocol,
          enabled: profile.enabled,
          authType: profile.authType,
          supportsText: profile.capabilities.supportsText,
          supportsImage: profile.capabilities.supportsImage,
          supportsVideo: profile.capabilities.supportsVideo,
          supportsAudio: profile.capabilities.supportsAudio,
          supportsTools: profile.capabilities.supportsTools,
          hasApiKey: Boolean(profile.apiKey),
        });
      });

      return true;
    } catch (error) {
      console.error('Failed to persist settings drafts:', error);
      analytics.trackUIInteraction({
        area: 'settings',
        action: 'settings_save_failed',
        control: 'save_settings',
        source: 'settings_dialog',
        metadata: {
          closeAfterSave,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      MessagePlugin.error('设置保存失败，请稍后重试');
      return false;
    } finally {
      setIsPersisting(false);
    }
  };

  const handleCancel = () => {
    if (!hasPendingChanges) {
      closeSettingsDialog();
      return;
    }

    void (async () => {
      const saved = await persistDrafts(true);

      if (!saved) {
        MessagePlugin.warning('设置尚未保存，请检查后重试');
      }
    })();
  };

  const handleWindowClose = () => {
    if (discoveryDialogOpen || isPersisting) {
      return;
    }
    handleCancel();
  };

  const renderProviderRow = (profile: ProviderProfile) => {
    const isSelected = profile.id === selectedProfile?.id;

    return (
      <div
        key={profile.id}
        className={`settings-dialog__provider-row ${
          isSelected ? 'settings-dialog__provider-row--active' : ''
        } ${profile.enabled ? '' : 'settings-dialog__provider-row--disabled'}`}
        onContextMenu={(event) => {
          event.preventDefault();
          providerContextMenu.open(event, profile.id);
        }}
      >
        <button
          type="button"
          className="settings-dialog__provider-select"
          onClick={() => handleSelectProfile(profile.id)}
          aria-pressed={isSelected}
        >
          <span className="settings-dialog__provider-select-main">
            <ProviderAvatar profile={profile} />
            <span className="settings-dialog__provider-copy">
              <span className="settings-dialog__provider-name-row">
                <span className="settings-dialog__provider-name">
                  {profile.name}
                </span>
                {profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ? (
                  <span className="settings-dialog__provider-tag">默认</span>
                ) : null}
              </span>
              {isCompactLayout ? (
                <span className="settings-dialog__provider-meta">
                  <span>{PROVIDER_TYPE_META[profile.providerType].label}</span>
                  <span>{profile.enabled ? '启用' : '停用'}</span>
                </span>
              ) : null}
            </span>
          </span>
          {isCompactLayout ? (
            <ChevronRight
              size={16}
              className="settings-dialog__provider-arrow"
              aria-hidden="true"
            />
          ) : null}
        </button>

        <div className="settings-dialog__provider-switch">
          <span className="settings-dialog__provider-switch-copy">
            {profile.enabled ? '启用' : '停用'}
          </span>
          <Switch
            size="small"
            value={profile.enabled}
            onChange={(checked) =>
              void handleProviderEnabledChange(profile.id, checked as boolean)
            }
          />
        </div>
      </div>
    );
  };

  const renderProviderList = () => {
    const accountProfiles = showTuziProviders
      ? profilesDraft.filter((profile) =>
          isTuziManagedProviderProfileId(profile.id)
        )
      : [];
    const customProfiles = profilesDraft.filter(
      (profile) =>
        shouldShowProviderProfile(profile.id, showTuziProviders) &&
        !isTuziManagedProviderProfileId(profile.id)
    );

    return (
      <div className="settings-dialog__sidebar-shell settings-dialog__sidebar-shell--catalog">
        <div className="settings-dialog__provider-groups">
          <section className="settings-dialog__provider-group">
            <div className="settings-dialog__provider-group-heading">
              <span>自定义供应商</span>
              <button
                type="button"
                className="settings-dialog__sidebar-summary-action"
                onClick={handleAddProfile}
              >
                新增供应商
              </button>
            </div>
            <div className="settings-dialog__provider-group-list">
              {customProfiles.map(renderProviderRow)}
            </div>
          </section>

          {accountProfiles.length > 0 ? (
            <section className="settings-dialog__provider-group settings-dialog__provider-group--account">
              <div className="settings-dialog__provider-group-heading">
                <span>Tuzi 账户分组</span>
              </div>
              <div className="settings-dialog__provider-group-list">
                {accountProfiles.map(renderProviderRow)}
              </div>
            </section>
          ) : null}
        </div>

        <ContextMenu
          state={providerContextMenu.contextMenu}
          items={providerContextMenuItems}
          onClose={providerContextMenu.close}
          zIndex={20000}
        />
      </div>
    );
  };

  const renderPresetList = () => (
    <div className="settings-dialog__sidebar-shell">
      <div className="settings-dialog__sidebar-summary">
        <div className="settings-dialog__sidebar-summary-row">
          <span className="settings-dialog__sidebar-summary-title">
            默认模型
          </span>
          {isCompactLayout ? (
            <button
              type="button"
              className="settings-dialog__sidebar-summary-action"
              onClick={handleAddPreset}
            >
              新增预设
            </button>
          ) : null}
        </div>
        {isCompactLayout ? (
          <span className="settings-dialog__sidebar-summary-text">
            先选中一个预设，再进入详情页调整默认路由。
          </span>
        ) : null}
      </div>

      <div className="settings-dialog__sidebar-list">
        {presetsDraft.map((preset) => {
          const isSelected = preset.id === selectedPreset?.id;
          const isActive = preset.id === activePresetIdDraft;
          const configuredRouteCount = getConfiguredRouteCount(preset);

          return (
            <button
              key={preset.id}
              type="button"
              className={`settings-dialog__sidebar-item ${
                isSelected ? 'settings-dialog__sidebar-item--active' : ''
              }`}
              onClick={() => handleSelectPreset(preset.id)}
            >
              <div className="settings-dialog__sidebar-item-head">
                <div className="settings-dialog__sidebar-item-top">
                  <span>{preset.name}</span>
                  {isActive ? (
                    <span className="settings-dialog__sidebar-badge settings-dialog__sidebar-badge--accent">
                      当前
                    </span>
                  ) : null}
                </div>
                {isCompactLayout ? (
                  <ChevronRight
                    size={16}
                    className="settings-dialog__sidebar-item-arrow"
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              <div className="settings-dialog__sidebar-item-meta">
                <span>{configuredRouteCount}/3 已配置</span>
                {isCompactLayout ? (
                  <span>{isActive ? '正在生效' : '点击查看详情'}</span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {!isCompactLayout ? (
        <button
          type="button"
          className="settings-dialog__sidebar-add"
          onClick={handleAddPreset}
        >
          <span className="settings-dialog__sidebar-add-icon">+</span>
          <span>新增预设</span>
        </button>
      ) : null}
    </div>
  );

  const renderCompactCatalog = (stageKey: string, content: ReactNode) => (
    <div className="settings-dialog__workspace settings-dialog__workspace--single">
      <div className="settings-dialog__content-panel settings-dialog__content-panel--compact">
        <div key={stageKey} className="settings-dialog__mobile-stage">
          {content}
        </div>
      </div>
    </div>
  );

  const renderProviderForm = (compactMode = false) => {
    if (
      !selectedProfile ||
      !shouldShowProviderProfile(selectedProfile.id, showTuziProviders)
    ) {
      return (
        <div className="settings-dialog__empty-panel">
          {showTuziProviders
            ? '请选择一个供应商。'
            : '配置 Tuzi 系统访问令牌后才能管理 Tuzi 供应商。'}
        </div>
      );
    }

    const selectedCounts = getModelTypeCounts(runtimeState.models);
    const draftState = getProviderDraftState(selectedProfile, initialProfiles);
    const totalModels =
      selectedCounts.image + selectedCounts.video + selectedCounts.text;
    const selectedProfileHomepageUrl = getProviderHomepageUrl(selectedProfile);

    return (
      <div
        key={compactMode ? `provider-detail-${selectedProfile.id}` : undefined}
        className={`settings-dialog__content-panel settings-dialog__content-panel--providers ${
          compactMode ? 'settings-dialog__content-panel--detail' : ''
        }`}
      >
        {compactMode ? (
          <div className="settings-dialog__compact-stage-header">
            <button
              type="button"
              className="settings-dialog__compact-back"
              onClick={() => setCompactProviderMode('catalog')}
            >
              <ChevronLeft size={16} />
              <span>返回供应商目录</span>
            </button>
            <div className="settings-dialog__compact-stage-copy">
              <span className="settings-dialog__compact-stage-eyebrow">
                供应商配置
              </span>
              <p className="settings-dialog__compact-stage-text">
                进入详情后再编辑接口信息、密钥和模型同步配置。
              </p>
            </div>
          </div>
        ) : null}
        <div className="settings-dialog__section settings-dialog__section--compact">
          <div className="settings-dialog__panel-header">
            <a
              className={`settings-dialog__profile-hero ${
                selectedProfileHomepageUrl
                  ? 'settings-dialog__profile-hero--link'
                  : ''
              }`}
              href={selectedProfileHomepageUrl || undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={
                selectedProfileHomepageUrl
                  ? `打开 ${selectedProfile.name} 域名页面`
                  : undefined
              }
              onClick={(event) => {
                if (!selectedProfileHomepageUrl) {
                  event.preventDefault();
                }
              }}
            >
              <ProviderAvatar profile={selectedProfile} size="large" />
              <div>
                <h3 className="settings-dialog__section-title">
                  {selectedProfile.name}
                </h3>
                <div className="settings-dialog__inline-meta">
                  <span>
                    {PROVIDER_TYPE_META[selectedProfile.providerType].label}
                  </span>
                  <span>{selectedProfile.enabled ? '启用' : '停用'}</span>
                  <span>{totalModels} 个模型</span>
                  <span>{draftState === 'saved' ? '已保存' : '未保存'}</span>
                </div>
              </div>
            </a>
            {!isManagedProviderProfile(selectedProfile.id) ? (
              <button
                type="button"
                className="settings-dialog__danger-button"
                onClick={() => handleDeleteProfile(selectedProfile.id)}
              >
                删除
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-dialog__section">
          <div className="settings-dialog__section-header">
            <div>
              <h3 className="settings-dialog__section-title">基础配置</h3>
            </div>
          </div>

          <div className="settings-dialog__grid">
            <div className="settings-dialog__field settings-dialog__field--column">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                名称
              </label>
              <input
                type="text"
                className="settings-dialog__input"
                value={selectedProfile.name}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    name: event.target.value,
                  }))
                }
              />
            </div>

            <div className="settings-dialog__field settings-dialog__field--column">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                接口类型
              </label>
              <select
                className="settings-dialog__select"
                value={selectedProfile.providerType}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => {
                    const providerType = event.target
                      .value as ProviderProfile['providerType'];
                    const previousDefaultAuth = inferAuthTypeForProviderType(
                      profile.providerType
                    );
                    const nextDefaultAuth =
                      inferAuthTypeForProviderType(providerType);

                    return {
                      ...profile,
                      providerType,
                      authType:
                        profile.authType === previousDefaultAuth
                          ? nextDefaultAuth
                          : profile.authType,
                    };
                  })
                }
              >
                {PROVIDER_TYPE_OPTIONS.map((providerType) => (
                  <option key={providerType} value={providerType}>
                    {PROVIDER_TYPE_META[providerType].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                图片接口格式
              </label>
              <select
                className="settings-dialog__select"
                value={
                  selectedProfile.imageApiCompatibility ||
                  DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY
                }
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    imageApiCompatibility: event.target
                      .value as ImageApiCompatibility,
                  }))
                }
              >
                {IMAGE_API_COMPATIBILITY_OPTIONS.map((compatibility) => (
                  <option key={compatibility} value={compatibility}>
                    {IMAGE_API_COMPATIBILITY_META[compatibility].label}
                  </option>
                ))}
              </select>
              <span className="settings-dialog__field-hint">
                {selectedImageApiCompatibilityHint}
              </span>
            </div>

            <div
              className="settings-dialog__field settings-dialog__field--full"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <label className="settings-dialog__label" style={{ margin: 0 }}>
                图片优先使用异步接口（实验功能，建议不要开，还未上线）
              </label>
              <Switch
                size="small"
                value={selectedProfile.preferAsyncImageEndpoint ?? false}
                onChange={(checked) => {
                  const value = checked as boolean;
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    preferAsyncImageEndpoint: value,
                  }));
                }}
              />
              <span
                className="settings-dialog__field-hint"
                style={{ width: '100%' }}
              >
                开启后，支持异步接口的图片模型将优先使用 /v1/videos 异步接口生成
              </span>
            </div>

            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                图标 URL
              </label>
              <input
                type="url"
                className="settings-dialog__input"
                value={selectedProfile.iconUrl || ''}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    iconUrl: event.target.value,
                  }))
                }
                placeholder="可选，留空时自动生成默认图标"
              />
              <span className="settings-dialog__field-hint">
                支持填写远程图片地址；未填写时将根据供应商名称生成默认图标。
              </span>
            </div>

            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                API 地址
              </label>
              <input
                type="text"
                className="settings-dialog__input"
                value={selectedProfile.baseUrl}
                onChange={(event) =>
                  updateProfile(selectedProfile.id, (profile) => ({
                    ...profile,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder={TUZI_PROVIDER_DEFAULT_BASE_URL}
              />
              {isSelectedTuziProfile ? (
                <div className="settings-dialog__endpoint-panel">
                  <div className="settings-dialog__endpoint-toolbar">
                    <div className="settings-dialog__endpoint-title">
                      <div className="settings-dialog__endpoint-count">
                        {endpointOptions.length} 个端点
                      </div>
                      <div className="settings-dialog__endpoint-source">
                        来源: tuzi-api
                      </div>
                    </div>
                    <div className="settings-dialog__endpoint-actions">
                      <label className="settings-dialog__endpoint-auto">
                        <input
                          type="checkbox"
                          checked={endpointSelectionMode === 'auto'}
                          onChange={(event) =>
                            handleEndpointAutoSelectChange(event.target.checked)
                          }
                        />
                        <span>自动选择</span>
                      </label>
                      <button
                        type="button"
                        className="settings-dialog__endpoint-test-btn"
                        onClick={() => void handleRunEndpointSpeedTest()}
                        disabled={
                          isEndpointTesting || endpointOptions.length === 0
                        }
                      >
                        {isEndpointTesting ? (
                          <Loader2
                            size={14}
                            className="settings-dialog__endpoint-spin"
                          />
                        ) : (
                          <Zap size={15} />
                        )}
                        <span>测速</span>
                      </button>
                    </div>
                  </div>

                  <div className="settings-dialog__endpoint-list">
                    {endpointOptions.map((endpoint) => {
                      const selected =
                        endpoint.url === activeEndpoint.url ||
                        (endpointSelectionMode === 'auto' &&
                          endpoint.url === bestEndpoint.url);
                      const latency = endpointLatencies[endpoint.url];
                      const latencyText =
                        typeof latency === 'number'
                          ? `${latency}ms`
                          : latency === 'failed'
                          ? '失败'
                          : '—';
                      const latencyState =
                        latency === 'failed'
                          ? 'failed'
                          : typeof latency === 'number' && latency < 300
                          ? 'fast'
                          : typeof latency === 'number' && latency >= 800
                          ? 'slow'
                          : null;

                      return (
                        <div
                          key={endpoint.id}
                          role="button"
                          tabIndex={0}
                          className={classNames(
                            'settings-dialog__endpoint-row',
                            {
                              'settings-dialog__endpoint-row--selected':
                                selected,
                            }
                          )}
                          onClick={() => {
                            handleEndpointSelect(endpoint.url, 'manual');
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleEndpointSelect(endpoint.url, 'manual');
                            }
                          }}
                        >
                          <span className="settings-dialog__endpoint-row-dot" />
                          <span className="settings-dialog__endpoint-row-copy">
                            <span className="settings-dialog__endpoint-row-name">
                              {endpoint.name || endpoint.shortLabel}
                            </span>
                            <span className="settings-dialog__endpoint-row-url">
                              {endpoint.url}
                            </span>
                            {endpoint.description ? (
                              <span className="settings-dialog__endpoint-row-desc">
                                {endpoint.description}
                              </span>
                            ) : null}
                          </span>
                          <span
                            className={classNames(
                              'settings-dialog__endpoint-row-latency',
                              {
                                'settings-dialog__endpoint-row-latency--fast':
                                  latencyState === 'fast',
                                'settings-dialog__endpoint-row-latency--slow':
                                  latencyState === 'slow',
                                'settings-dialog__endpoint-row-latency--failed':
                                  latencyState === 'failed',
                              }
                            )}
                          >
                            {isEndpointTesting && latency == null ? (
                              <Loader2
                                size={14}
                                className="settings-dialog__endpoint-spin"
                              />
                            ) : (
                              latencyText
                            )}
                          </span>
                          {endpoint.removable ? (
                            <button
                              type="button"
                              className="settings-dialog__endpoint-remove"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleRemoveCustomEndpoint(endpoint);
                              }}
                            >
                              <X size={17} />
                            </button>
                          ) : (
                            <span className="settings-dialog__endpoint-remove-placeholder">
                              —
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="settings-dialog__endpoint-add">
                    <input
                      value={customEndpointUrl}
                      placeholder="https://api.example.com"
                      onChange={(event) => {
                        setCustomEndpointUrl(event.target.value);
                        setEndpointAddError('');
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleAddCustomEndpoint();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="settings-dialog__endpoint-add-btn"
                      onClick={handleAddCustomEndpoint}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  {endpointAddError ? (
                    <div className="settings-dialog__endpoint-error">
                      {endpointAddError}
                    </div>
                  ) : null}
                  {tuziApiEndpointLoadError ? (
                    <div className="settings-dialog__endpoint-error">
                      {tuziApiEndpointLoadError}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <div className="settings-dialog__label-with-tooltip settings-dialog__label-with-tooltip--left">
                <label className="settings-dialog__label settings-dialog__label--stacked">
                  API Key
                </label>
                <HoverTip
                  content={
                    <div style={{ maxWidth: 480 }}>
                      您可以从以下地址获取 API Key:
                      <br />
                      <a
                        href="https://api.tu-zi.com/token"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: '#F39C12',
                          textDecoration: 'none',
                          display: 'inline-block',
                          marginBottom: 8,
                        }}
                      >
                        api.tu-zi.com/token
                      </a>
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          paddingTop: '56.25%',
                          marginTop: 8,
                          borderRadius: 8,
                          overflow: 'hidden',
                          backgroundColor: '#000',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                        }}
                      >
                        <iframe
                          title="Bilibili tutorial video"
                          src="//player.bilibili.com/player.html?isOutside=true&aid=116171584049629&bvid=BV1k4PqzPEKz&cid=36455319822&p=1"
                          allowFullScreen={true}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 0,
                          }}
                        ></iframe>
                      </div>
                    </div>
                  }
                  placement="top"
                  theme="light"
                  showArrow={false}
                  overlayStyle={{ maxWidth: 'none' }}
                >
                  <InfoCircleIcon className="settings-dialog__tooltip-icon" />
                </HoverTip>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  width: '100%',
                  flexDirection: isCompactLayout ? 'column' : 'row',
                }}
              >
                <div
                  className="settings-dialog__secret-input-wrap"
                  style={{ flex: isCompactLayout ? 'none' : 1 }}
                >
                  <input
                    type={isApiKeyVisible ? 'text' : 'password'}
                    className="settings-dialog__input settings-dialog__secret-input"
                    value={selectedProfile.apiKey}
                    onChange={(event) =>
                      updateProfile(selectedProfile.id, (profile) => ({
                        ...profile,
                        apiKey: event.target.value,
                      }))
                    }
                    autoComplete="off"
                  />
                  <HoverTip
                    content={isApiKeyVisible ? '隐藏 API Key' : '查看 API Key'}
                    showArrow={false}
                  >
                    <button
                      type="button"
                      className="settings-dialog__secret-toggle"
                      aria-label={
                        isApiKeyVisible ? '隐藏 API Key' : '查看 API Key'
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setIsApiKeyVisible((visible) => !visible)}
                    >
                      {isApiKeyVisible ? (
                        <EyeOff size={16} />
                      ) : (
                        <Eye size={16} />
                      )}
                    </button>
                  </HoverTip>
                </div>
                <button
                  type="button"
                  className="settings-dialog__button settings-dialog__button--fetch"
                  style={{
                    whiteSpace: 'nowrap',
                    height: isCompactLayout ? '42px' : '32px',
                    width: isCompactLayout ? '100%' : 'auto',
                  }}
                  onClick={handleFetchModels}
                  disabled={
                    !canManageModels || runtimeState.status === 'loading'
                  }
                >
                  {runtimeState.status === 'loading' ? (
                    <>
                      <Loader2
                        size={15}
                        className="settings-dialog__button-spinner"
                      />
                      同步中
                    </>
                  ) : (
                    '获取模型'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        <PricingFieldGroup
          profile={selectedProfile}
          onUpdateProfile={(updater) =>
            updateProfile(selectedProfile.id, updater)
          }
        />

        {selectedProfile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ? (
          <div className="settings-dialog__section settings-dialog__section--compact">
            <div className="settings-dialog__compat-card">
              <div className="settings-dialog__compat-title">兼容默认模型</div>
              <div className="settings-dialog__compat-meta">
                <span>图片：{imageModelName || getDefaultImageModel()}</span>
                <span>视频：{videoModelName || getDefaultVideoModel()}</span>
                <span>音频：{audioModelName || getDefaultAudioModel()}</span>
                <span>文本：{textModelName || getDefaultTextModel()}</span>
              </div>
            </div>
          </div>
        ) : null}

        {renderProviderModelSummary()}
      </div>
    );
  };

  const handleLaunchModelBenchmark = useCallback(
    (payload: {
      profileId: string;
      modality: ModelType;
      modelId?: string;
      compareMode: 'cross-provider' | 'cross-model' | 'custom';
      autoRun?: boolean;
    }) => {
      if (!payload.profileId) {
        return;
      }
      openModelBenchmarkTool({
        profileId: payload.profileId,
        modelId: payload.modelId,
        modality: payload.modality,
        compareMode: payload.compareMode,
        autoRun: payload.autoRun,
      });
      analytics.trackUIInteraction({
        area: 'settings',
        action: 'model_benchmark_launched',
        control: 'model_benchmark',
        source: 'settings_dialog',
        metadata: {
          profileId: payload.profileId,
          modality: payload.modality,
          compareMode: payload.compareMode,
          hasModel: !!payload.modelId,
          autoRun: !!payload.autoRun,
        },
      });
    },
    [setAppState]
  );

  const renderProviderModelSummary = () => {
    const providerDraftState = selectedProfile
      ? getProviderDraftState(selectedProfile, initialProfiles)
      : 'saved';
    const canLaunchBenchmark =
      !!selectedProfile?.apiKey.trim() &&
      providerDraftState === 'saved' &&
      runtimeState.status !== 'loading';
    const isDefaultProvider =
      selectedProfile?.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID;
    const displayModels = dedupeModelsByTypeAndId(runtimeState.models);
    const vendorPriorityMap = new Map(
      DISCOVERY_VENDOR_ORDER.map((vendor, index) => [vendor, index])
    );
    const modelSearch = deferredModelSearchQuery.trim();
    const typeCounts = getModelTypeCounts(displayModels);
    const filteredModels = displayModels.filter((model) =>
      matchesProviderModelQuery(model, modelSearch)
    );
    const modelGroups = MODEL_SUMMARY_GROUP_ORDER.map((type) => ({
      type,
      models: filteredModels
        .filter((model) => model.type === type)
        .sort((left, right) => {
          const leftPriority =
            vendorPriorityMap.get(left.vendor) ?? Number.MAX_SAFE_INTEGER;
          const rightPriority =
            vendorPriorityMap.get(right.vendor) ?? Number.MAX_SAFE_INTEGER;

          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }

          return compareModelsByDisplayPriority(left, right);
        }),
    })).filter((group) => group.models.length > 0);
    const showSearchToolbar = canManageModels || displayModels.length > 0;
    const shouldShowEmptySearch =
      displayModels.length > 0 &&
      filteredModels.length === 0 &&
      Boolean(modelSearch);
    const shouldShowErrorState =
      runtimeState.status === 'error' && displayModels.length === 0;
    const shouldShowHintState = !canManageModels && displayModels.length === 0;

    return (
      <div className="settings-dialog__section">
        <div className="settings-dialog__section-header">
          <div>
            <h3 className="settings-dialog__section-title">模型</h3>
            <div className="settings-dialog__inline-meta">
              <span>已添加 {displayModels.length} 个</span>
              <span>图 {typeCounts.image}</span>
              <span>视 {typeCounts.video}</span>
              <span>音 {typeCounts.audio}</span>
              <span>文 {typeCounts.text}</span>
            </div>
          </div>
        </div>

        {showSearchToolbar ? (
          <div className="settings-dialog__model-toolbar">
            <label
              className={`settings-dialog__model-search ${
                displayModels.length === 0
                  ? 'settings-dialog__model-search--disabled'
                  : ''
              }`}
            >
              <Search size={15} />
              <input
                type="text"
                value={modelSearchQuery}
                onChange={(event) => setModelSearchQuery(event.target.value)}
                placeholder={
                  displayModels.length > 0
                    ? '搜索模型 ID、名称或品牌'
                    : '获取模型后可搜索'
                }
                disabled={displayModels.length === 0}
              />
              {modelSearchQuery ? (
                <button
                  type="button"
                  className="settings-dialog__model-search-clear"
                  onClick={() => setModelSearchQuery('')}
                  aria-label="清空搜索"
                >
                  <X size={14} />
                </button>
              ) : null}
            </label>
          </div>
        ) : null}

        {canManageModels ? (
          <div className="settings-dialog__custom-model-panel">
            <div className="settings-dialog__custom-model-grid">
              <label className="settings-dialog__field settings-dialog__field--column">
                <span className="settings-dialog__label settings-dialog__label--stacked">
                  模型 ID
                </span>
                <input
                  type="text"
                  className="settings-dialog__input"
                  value={customModelId}
                  onChange={(event) => {
                    setCustomModelId(event.target.value);
                    setCustomModelError('');
                  }}
                  placeholder="gpt-image-2"
                />
              </label>
              <label className="settings-dialog__field settings-dialog__field--column">
                <span className="settings-dialog__label settings-dialog__label--stacked">
                  模型类型
                </span>
                <select
                  className="settings-dialog__select"
                  value={customModelType}
                  onChange={(event) =>
                    handleCustomModelTypeChange(event.target.value as ModelType)
                  }
                >
                  {MODEL_SUMMARY_GROUP_ORDER.map((modelType) => (
                    <option key={modelType} value={modelType}>
                      {MODEL_GROUP_LABELS[modelType]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-dialog__field settings-dialog__field--column">
                <span className="settings-dialog__label settings-dialog__label--stacked">
                  调用方式
                </span>
                <select
                  className="settings-dialog__select"
                  value={customModelInterfacePreset}
                  onChange={(event) =>
                    handleCustomModelInterfacePresetChange(
                      event.target.value as CustomModelInterfacePreset
                    )
                  }
                >
                  {getCustomModelPresetOptions(customModelType).map(
                    (presetKey) => (
                      <option key={presetKey} value={presetKey}>
                        {CUSTOM_MODEL_INTERFACE_PRESETS[presetKey].label}
                      </option>
                    )
                  )}
                </select>
              </label>
              <div className="settings-dialog__custom-model-note settings-dialog__field--full">
                {
                  CUSTOM_MODEL_INTERFACE_PRESETS[customModelInterfacePreset]
                    .description
                }
                {customModelInterfacePreset === 'custom-http'
                  ? ' 提示词、参考图、尺寸和时长仍在原生成面板填写，这里只配置调用方法。'
                  : ' 模型 ID 必须填写供应商接口实际接受的值；提示词、参考图、尺寸等仍在原生成面板填写。'}
              </div>
              {customModelInterfacePreset === 'custom-http' ? (
                <>
                  <button
                    type="button"
                    className="settings-dialog__custom-model-advanced-toggle settings-dialog__field--full"
                    onClick={() =>
                      setCustomHttpAdvancedOpen((current) => !current)
                    }
                  >
                    {customHttpAdvancedOpen ? (
                      <ChevronDown size={15} />
                    ) : (
                      <ChevronRight size={15} />
                    )}
                    <span>自定义接口配置</span>
                    <span className="settings-dialog__custom-model-advanced-state">
                      {customHttpAdvancedOpen ? '已展开' : '已收起'}
                    </span>
                  </button>
                  {customHttpAdvancedOpen ? (
                    <div className="settings-dialog__custom-model-advanced">
                      <label className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
                        <span className="settings-dialog__label settings-dialog__label--stacked">
                          请求地址
                        </span>
                        <input
                          type="text"
                          className="settings-dialog__input"
                          value={customHttpDraft.submitPath}
                          onChange={(event) =>
                            updateCustomHttpDraft(
                              'submitPath',
                              event.target.value
                            )
                          }
                          placeholder="/images/generations 或完整 https:// 地址"
                        />
                      </label>
                      <label className="settings-dialog__field settings-dialog__field--column">
                        <span className="settings-dialog__label settings-dialog__label--stacked">
                          Method
                        </span>
                        <select
                          className="settings-dialog__select"
                          value={customHttpDraft.method}
                          onChange={(event) =>
                            updateCustomHttpDraft(
                              'method',
                              event.target.value as CustomHttpDraft['method']
                            )
                          }
                        >
                          {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map(
                            (method) => (
                              <option key={method} value={method}>
                                {method}
                              </option>
                            )
                          )}
                        </select>
                      </label>
                      <label className="settings-dialog__field settings-dialog__field--column">
                        <span className="settings-dialog__label settings-dialog__label--stacked">
                          请求体类型
                        </span>
                        <select
                          className="settings-dialog__select"
                          value={customHttpDraft.bodyType}
                          onChange={(event) =>
                            updateCustomHttpDraft(
                              'bodyType',
                              event.target.value as ManualHttpBodyType
                            )
                          }
                        >
                          <option value="json">JSON</option>
                          <option value="form-data">FormData</option>
                          <option value="raw">Raw Text</option>
                          <option value="none">无请求体</option>
                        </select>
                      </label>
                      {customHttpDraft.bodyType === 'json' ||
                      customHttpDraft.bodyType === 'raw' ? (
                        <label className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
                          <span className="settings-dialog__label settings-dialog__label--stacked">
                            请求体模板
                          </span>
                          <textarea
                            className="settings-dialog__textarea settings-dialog__textarea--code"
                            value={customHttpDraft.bodyTemplate}
                            onChange={(event) =>
                              updateCustomHttpDraft(
                                'bodyTemplate',
                                event.target.value
                              )
                            }
                          />
                        </label>
                      ) : null}
                      {customHttpDraft.bodyType === 'form-data' ? (
                        <label className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
                          <span className="settings-dialog__label settings-dialog__label--stacked">
                            FormData 字段
                          </span>
                          <textarea
                            className="settings-dialog__textarea settings-dialog__textarea--code"
                            value={customHttpDraft.formFieldsTemplate}
                            onChange={(event) =>
                              updateCustomHttpDraft(
                                'formFieldsTemplate',
                                event.target.value
                              )
                            }
                          />
                        </label>
                      ) : null}
                      <div className="settings-dialog__custom-model-template-tip settings-dialog__field--full">
                        可用变量：{'{{model}}'}、{'{{prompt}}'}、
                        {'{{messages}}'}、{'{{image}}'}、{'{{images}}'}、
                        {'{{size}}'}、{'{{duration}}'}、{'{{params.xxx}}'}
                        。参考图上传请使用 FormData 的 <code>file</code> 或{' '}
                        <code>file-list</code>。
                      </div>
                      <label className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
                        <span className="settings-dialog__label settings-dialog__label--stacked">
                          额外请求头 JSON
                        </span>
                        <textarea
                          className="settings-dialog__textarea settings-dialog__textarea--code settings-dialog__textarea--compact"
                          value={customHttpDraft.headersTemplate}
                          onChange={(event) =>
                            updateCustomHttpDraft(
                              'headersTemplate',
                              event.target.value
                            )
                          }
                          placeholder='{"X-Custom-Header":"value"}'
                        />
                      </label>
                      <label className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
                        <span className="settings-dialog__label settings-dialog__label--stacked">
                          {customModelType === 'text'
                            ? '文本返回字段'
                            : customModelType === 'image'
                            ? '图片 URL 返回字段'
                            : customModelType === 'video'
                            ? '视频 URL 返回字段'
                            : '音频 URL 返回字段'}
                        </span>
                        <input
                          type="text"
                          className="settings-dialog__input"
                          value={customHttpDraft.responsePath}
                          onChange={(event) =>
                            updateCustomHttpDraft(
                              'responsePath',
                              event.target.value
                            )
                          }
                          placeholder="data.*.url"
                        />
                      </label>
                      <label className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
                        <span className="settings-dialog__label settings-dialog__label--stacked">
                          轮询地址（可选）
                        </span>
                        <input
                          type="text"
                          className="settings-dialog__input"
                          value={customHttpDraft.pollPath}
                          onChange={(event) =>
                            updateCustomHttpDraft(
                              'pollPath',
                              event.target.value
                            )
                          }
                          placeholder="/tasks/{{taskId}}"
                        />
                      </label>
                      {customHttpDraft.pollPath.trim() ? (
                        <>
                          <label className="settings-dialog__field settings-dialog__field--column">
                            <span className="settings-dialog__label settings-dialog__label--stacked">
                              任务 ID 字段
                            </span>
                            <input
                              type="text"
                              className="settings-dialog__input"
                              value={customHttpDraft.taskIdPath}
                              onChange={(event) =>
                                updateCustomHttpDraft(
                                  'taskIdPath',
                                  event.target.value
                                )
                              }
                            />
                          </label>
                          <label className="settings-dialog__field settings-dialog__field--column">
                            <span className="settings-dialog__label settings-dialog__label--stacked">
                              状态字段
                            </span>
                            <input
                              type="text"
                              className="settings-dialog__input"
                              value={customHttpDraft.statusPath}
                              onChange={(event) =>
                                updateCustomHttpDraft(
                                  'statusPath',
                                  event.target.value
                                )
                              }
                            />
                          </label>
                          <label className="settings-dialog__field settings-dialog__field--column">
                            <span className="settings-dialog__label settings-dialog__label--stacked">
                              轮询结果字段
                            </span>
                            <input
                              type="text"
                              className="settings-dialog__input"
                              value={customHttpDraft.pollResultPath}
                              onChange={(event) =>
                                updateCustomHttpDraft(
                                  'pollResultPath',
                                  event.target.value
                                )
                              }
                            />
                          </label>
                          <label className="settings-dialog__field settings-dialog__field--column">
                            <span className="settings-dialog__label settings-dialog__label--stacked">
                              错误字段
                            </span>
                            <input
                              type="text"
                              className="settings-dialog__input"
                              value={customHttpDraft.errorPath}
                              onChange={(event) =>
                                updateCustomHttpDraft(
                                  'errorPath',
                                  event.target.value
                                )
                              }
                            />
                          </label>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
              <label className="settings-dialog__field settings-dialog__field--column">
                <span className="settings-dialog__label settings-dialog__label--stacked">
                  显示名称
                </span>
                <input
                  type="text"
                  className="settings-dialog__input"
                  value={customModelLabel}
                  onChange={(event) => setCustomModelLabel(event.target.value)}
                  placeholder="可选"
                />
              </label>
              <label className="settings-dialog__field settings-dialog__field--column">
                <span className="settings-dialog__label settings-dialog__label--stacked">
                  描述
                </span>
                <input
                  type="text"
                  className="settings-dialog__input"
                  value={customModelDescription}
                  onChange={(event) =>
                    setCustomModelDescription(event.target.value)
                  }
                  placeholder="可选"
                />
              </label>
              <button
                type="button"
                className="settings-dialog__button settings-dialog__custom-model-submit"
                onClick={() => void handleAddCustomModel()}
              >
                <Plus size={15} />
                <span>添加自定义模型</span>
              </button>
            </div>
            {customModelError ? (
              <div className="settings-dialog__custom-model-error">
                {customModelError}
              </div>
            ) : null}
          </div>
        ) : null}

        {modelGroups.length > 0 ? (
          <div className="settings-dialog__model-type-groups">
            {modelGroups.map(({ type, models }) => {
              const isCollapsed = collapsedGroups.has(type);

              return (
                <div key={type} className="settings-dialog__model-type-group">
                  <div
                    className="settings-dialog__model-type-header"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleGroupCollapse(type)}
                  >
                    <div className="settings-dialog__model-type-meta">
                      {isCollapsed ? (
                        <ChevronRight
                          size={16}
                          className="settings-dialog__model-type-toggle"
                        />
                      ) : (
                        <ChevronDown
                          size={16}
                          className="settings-dialog__model-type-toggle"
                        />
                      )}
                      <span className="settings-dialog__model-type-title">
                        {MODEL_GROUP_LABELS[type]}
                      </span>
                      <span className="settings-dialog__model-type-count">
                        {models.length}
                      </span>
                    </div>
                    <HoverTip
                      content={
                        canLaunchBenchmark
                          ? '测试当前供应商这一组模型'
                          : '请先保存供应商配置并确保 API Key 可用'
                      }
                      showArrow={false}
                    >
                      <button
                        type="button"
                        className="settings-dialog__model-group-test"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!selectedProfile) return;
                          handleLaunchModelBenchmark({
                            profileId: selectedProfile.id,
                            modality: type,
                            compareMode: 'cross-model',
                            autoRun: true,
                          });
                        }}
                        disabled={!canLaunchBenchmark}
                      >
                        测试本组
                      </button>
                    </HoverTip>
                  </div>
                  {!isCollapsed && (
                    <div className="settings-dialog__model-type-list">
                      {models.map((model) => {
                        const palette = getModelVendorPalette(model.vendor);
                        const canRemoveModel =
                          !isDefaultProvider ||
                          runtimeState.selectedModelIds.includes(model.id);

                        return (
                          <div
                            key={model.id}
                            className="settings-dialog__model-type-item"
                            style={
                              {
                                '--model-brand-accent': palette.accent,
                                '--model-brand-surface': palette.surface,
                                '--model-brand-border': palette.border,
                              } as CSSProperties
                            }
                          >
                            <span className="settings-dialog__model-type-item-logo">
                              <ModelVendorMark
                                vendor={model.vendor}
                                size={16}
                              />
                            </span>
                            <div className="settings-dialog__model-type-item-copy">
                              <ModelIdWithDesc
                                profileId={selectedProfile!.id}
                                modelId={model.id}
                              />
                              <span className="settings-dialog__model-type-item-vendor">
                                {getDiscoveryVendorLabel(model.vendor)}
                              </span>
                              <ModelPriceLabel
                                profileId={selectedProfile!.id}
                                modelId={model.id}
                              />
                            </div>
                            <div className="settings-dialog__model-type-item-btns">
                              {(() => {
                                const st =
                                  modelBenchmarkService.getLatestEntryStatus(
                                    selectedProfile!.id,
                                    model.id
                                  );
                                if (st === 'completed')
                                  return (
                                    <HoverTip
                                      content="上次测试成功"
                                      showArrow={false}
                                    >
                                      <span className="settings-dialog__model-tip-trigger">
                                        <span className="settings-dialog__model-status settings-dialog__model-status--ok" />
                                      </span>
                                    </HoverTip>
                                  );
                                if (st === 'failed')
                                  return (
                                    <HoverTip
                                      content="上次测试失败"
                                      showArrow={false}
                                    >
                                      <span className="settings-dialog__model-tip-trigger">
                                        <span className="settings-dialog__model-status settings-dialog__model-status--fail" />
                                      </span>
                                    </HoverTip>
                                  );
                                return null;
                              })()}
                              <HoverTip
                                content={
                                  canLaunchBenchmark
                                    ? '测试'
                                    : '请先保存供应商配置并确保 API Key 可用'
                                }
                                showArrow={false}
                              >
                                <span className="settings-dialog__model-tip-trigger">
                                  <button
                                    type="button"
                                    className="settings-dialog__model-icon-btn settings-dialog__model-icon-btn--test"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (!selectedProfile) return;
                                      handleLaunchModelBenchmark({
                                        profileId: selectedProfile.id,
                                        modality: type,
                                        modelId: model.id,
                                        compareMode: 'cross-provider',
                                        autoRun: true,
                                      });
                                    }}
                                    disabled={!canLaunchBenchmark}
                                  >
                                    <FlaskConical size={14} />
                                  </button>
                                </span>
                              </HoverTip>
                              {canRemoveModel ? (
                                <HoverTip
                                  content="移除此模型"
                                  showArrow={false}
                                >
                                  <span className="settings-dialog__model-tip-trigger">
                                    <button
                                      type="button"
                                      className="settings-dialog__model-icon-btn settings-dialog__model-icon-btn--delete"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRemoveModel(model.id);
                                      }}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </span>
                                </HoverTip>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : shouldShowEmptySearch ? (
          <div className="settings-dialog__model-empty">
            没有匹配的模型，试试搜索品牌名或更完整的模型 ID。
          </div>
        ) : shouldShowErrorState ? (
          <div className="settings-dialog__model-empty settings-dialog__model-empty--error">
            <AlertTriangle size={16} />
            <span>{runtimeState.error || '模型获取失败，请稍后重试'}</span>
          </div>
        ) : shouldShowHintState ? (
          <div className="settings-dialog__model-empty">
            填写 API Key 后即可获取模型，获取完成后可在这里检索和浏览。
          </div>
        ) : (
          <div className="settings-dialog__model-empty">还没有已添加的模型</div>
        )}
      </div>
    );
  };

  const getRouteCandidateModels = (
    routeType: ModelType,
    capabilityKey: keyof ProviderProfile['capabilities'],
    route: RouteConfig
  ): Array<{ profile: ProviderProfile; models: ModelConfig[] }> => {
    const currentProfileId = getRouteProfileId(route);
    const currentModelId = getRouteModelId(route);

    return profilesDraft
      .filter(
        (profile) =>
          profile.id === currentProfileId ||
          (profile.enabled && profile.capabilities[capabilityKey])
      )
      .map((profile) => {
        const sourceModels =
          profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
            ? routeType === 'image'
              ? legacyImageModels
              : routeType === 'video'
              ? legacyVideoModels
              : legacyTextModels
            : runtimeModelDiscovery
                .getState(profile.id)
                .models.filter((model) => model.type === routeType);

        const uniqueModels = sourceModels.filter(
          (model, index, list) =>
            list.findIndex((item) => item.id === model.id) === index
        );

        if (
          profile.id === currentProfileId &&
          currentModelId &&
          !uniqueModels.some((model) => model.id === currentModelId)
        ) {
          uniqueModels.unshift({
            id: currentModelId,
            label: currentModelId,
            shortLabel: currentModelId,
            type: routeType,
            vendor: ModelVendor.OTHER,
          });
        }

        return {
          profile,
          models: uniqueModels,
        };
      })
      .filter((group) => group.models.length > 0);
  };

  const renderPresetRouteEditor = (
    routeType: ModelType,
    route: RouteConfig,
    profileCapabilityKey: keyof ProviderProfile['capabilities']
  ) => {
    const routeGroups = getRouteCandidateModels(
      routeType,
      profileCapabilityKey,
      route
    );
    const selectedProfileId = getRouteProfileId(route);
    const selectedModelId = getRouteModelId(route);
    const selectedProfileName =
      profilesDraft.find((profile) => profile.id === selectedProfileId)?.name ||
      '未配置';
    const selectableModels = buildPresetRouteModels(routeGroups);
    const selectedSelectionKey =
      selectedProfileId && selectedModelId
        ? `${selectedProfileId}::${selectedModelId}`
        : selectedModelId || undefined;

    return (
      <div
        className={`settings-dialog__route-card settings-dialog__route-card--${routeType}`}
      >
        <div className="settings-dialog__route-card-top">
          <div className="settings-dialog__route-card-title">
            {ROUTE_LABELS[routeType]}
          </div>
        </div>
        <div className="settings-dialog__stack">
          <div className="settings-dialog__field settings-dialog__field--column">
            <label className="settings-dialog__label settings-dialog__label--stacked">
              默认模型
            </label>
            <div className="settings-dialog__route-model-picker">
              <ModelDropdown
                variant="form"
                selectedModel={selectedModelId || ''}
                selectedSelectionKey={selectedSelectionKey}
                models={selectableModels}
                providerProfilesOverride={profilesDraft}
                placement="down"
                placeholder={`搜索${ROUTE_LABELS[routeType]}模型或供应商`}
                allowCustomValue={false}
                showProviderAction={false}
                onSelect={(modelId, modelRef) => {
                  handleRouteModelChange(
                    routeType,
                    modelRef || createModelRef(null, modelId)
                  );
                }}
                disabled={selectableModels.length === 0}
              />
              {selectedModelId ? (
                <button
                  type="button"
                  className="settings-dialog__route-clear"
                  onClick={() => handleRouteModelChange(routeType, null)}
                >
                  清空
                </button>
              ) : null}
            </div>
          </div>

          <div className="settings-dialog__route-meta">
            <span>{selectedProfileName}</span>
            <span>{selectedModelId || '未选择模型'}</span>
            {routeGroups.length === 0 ? <span>暂无可选模型</span> : null}
          </div>
        </div>
      </div>
    );
  };

  const renderPresetManagement = (compactMode = false) => {
    if (!selectedPreset) {
      return (
        <div className="settings-dialog__empty-panel">
          请选择一个默认模型预设。
        </div>
      );
    }

    const configuredRouteCount = getConfiguredRouteCount(selectedPreset);
    const isActive = selectedPreset.id === activePresetIdDraft;

    return (
      <div
        key={compactMode ? `preset-detail-${selectedPreset.id}` : undefined}
        className={`settings-dialog__content-panel ${
          compactMode ? 'settings-dialog__content-panel--detail' : ''
        }`}
      >
        {compactMode ? (
          <div className="settings-dialog__compact-stage-header">
            <button
              type="button"
              className="settings-dialog__compact-back"
              onClick={() => setCompactPresetMode('catalog')}
            >
              <ChevronLeft size={16} />
              <span>返回模型预设</span>
            </button>
            <div className="settings-dialog__compact-stage-copy">
              <span className="settings-dialog__compact-stage-eyebrow">
                模型预设
              </span>
              <p className="settings-dialog__compact-stage-text">
                在这里设置图片、视频和文本模型的默认路由。
              </p>
            </div>
          </div>
        ) : null}
        <div className="settings-dialog__section">
          <div className="settings-dialog__panel-header">
            <div>
              <h3 className="settings-dialog__section-title">
                {selectedPreset.name}
              </h3>
              <div className="settings-dialog__inline-meta">
                <span>{isActive ? '当前预设' : '未激活'}</span>
                <span>{configuredRouteCount}/3 已配置</span>
              </div>
            </div>
            <div className="settings-dialog__inline-row">
              <button
                type="button"
                className="settings-dialog__ghost-button"
                onClick={() => {
                  void persistPresetConfiguration(
                    presetsDraft,
                    selectedPreset.id
                  );
                }}
              >
                设为当前预设
              </button>
              <button
                type="button"
                className="settings-dialog__danger-button"
                onClick={() => handleDeletePreset(selectedPreset.id)}
                disabled={presetsDraft.length <= 1}
              >
                删除预设
              </button>
            </div>
          </div>

          <div className="settings-dialog__grid">
            <div className="settings-dialog__field settings-dialog__field--column settings-dialog__field--full">
              <label className="settings-dialog__label settings-dialog__label--stacked">
                预设名称
              </label>
              <input
                type="text"
                className="settings-dialog__input"
                value={selectedPreset.name}
                onChange={(event) =>
                  updatePreset(selectedPreset.id, (preset) => ({
                    ...preset,
                    name: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        </div>

        <div className="settings-dialog__routes">
          {renderPresetRouteEditor(
            'image',
            selectedPreset.image,
            'supportsImage'
          )}
          {renderPresetRouteEditor(
            'video',
            selectedPreset.video,
            'supportsVideo'
          )}
          {renderPresetRouteEditor('text', selectedPreset.text, 'supportsText')}
        </div>
      </div>
    );
  };

  const renderCanvasSettings = () => (
    <div className="settings-dialog__workspace settings-dialog__workspace--single">
      <div className="settings-dialog__content-panel settings-dialog__content-panel--canvas">
        {isCompactLayout ? (
          <div className="settings-dialog__compact-stage-header">
            <div className="settings-dialog__compact-stage-copy">
              <span className="settings-dialog__compact-stage-eyebrow">
                画布显示
              </span>
              <p className="settings-dialog__compact-stage-text">
                手机上会以更集中的卡片形式展示，方便快速切换画布相关开关。
              </p>
            </div>
          </div>
        ) : null}
        <div className="settings-dialog__section settings-dialog__section--canvas-card">
          <div className="settings-dialog__section-header">
            <div>
              <h3 className="settings-dialog__section-title">画布显示配置</h3>
            </div>
          </div>

          <div className="settings-dialog__preference settings-dialog__preference--panel">
            <div className="settings-dialog__toggle-copy">
              <span className="settings-dialog__toggle-title">
                任务进度卡片
              </span>
              <span className="settings-dialog__toggle-desc">
                在画布中显示任务进度卡片，便于追踪当前生成状态。
              </span>
            </div>
            <Switch
              size="small"
              value={showWorkZoneCard}
              onChange={(checked) =>
                void handleCanvasVisibilityChange(checked as boolean)
              }
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderSettingsNav = () => {
    return (
      <aside className="settings-dialog__nav">
        <div className="settings-dialog__nav-shell">
          <div className="settings-dialog__nav-list">
            {settingsSections.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`settings-dialog__nav-item ${
                  activeView === item.value
                    ? 'settings-dialog__nav-item--active'
                    : ''
                }`}
                onClick={() => handleViewChange(item.value)}
              >
                <span className="settings-dialog__nav-item-title">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    );
  };

  const renderActiveView = () => {
    if (activeView === 'tuzi-account') {
      return (
        <TuziAccountPanel onProvidersChanged={handleTuziProvidersChanged} />
      );
    }
    if (activeView === 'canvas') {
      return renderCanvasSettings();
    }

    if (activeView === 'speech') {
      return <TtsSettingsPanel />;
    }

    if (activeView === 'presets') {
      if (isSinglePanel) {
        return compactPresetMode === 'catalog'
          ? renderCompactCatalog('presets-catalog', renderPresetList())
          : renderPresetManagement(true);
      }

      return (
        <div
          className={`settings-dialog__workspace ${
            isCompactLayout ? 'settings-dialog__workspace--show-sidebar' : ''
          }`}
        >
          <aside className="settings-dialog__sidebar">
            {renderPresetList()}
          </aside>
          {renderPresetManagement(false)}
        </div>
      );
    }

    if (isSinglePanel) {
      return compactProviderMode === 'catalog'
        ? renderCompactCatalog('providers-catalog', renderProviderList())
        : renderProviderForm(true);
    }

    return (
      <div
        className={`settings-dialog__workspace ${
          isCompactLayout ? 'settings-dialog__workspace--show-sidebar' : ''
        }`}
      >
        <aside className="settings-dialog__sidebar">
          {renderProviderList()}
        </aside>
        {renderProviderForm(false)}
      </div>
    );
  };

  return (
    <>
      <WinBoxWindow
        id="settings-dialog"
        visible={appState.openSettings}
        title="设置"
        onClose={handleWindowClose}
        width={isCompactLayout ? '100%' : '88%'}
        height={isCompactLayout ? '100%' : '88%'}
        minWidth={
          isCompactLayout
            ? Math.max(320, Math.min(viewportWidth - 16, 640))
            : 1080
        }
        minHeight={
          isCompactLayout
            ? Math.max(520, Math.min(viewportHeight - 16, 820))
            : 680
        }
        x="center"
        y="center"
        maximizable={true}
        minimizable={false}
        resizable={!isCompactLayout}
        movable={!isCompactLayout}
        modal={false}
        className="winbox-ai-generation winbox-tool-window winbox-settings-window"
        container={container}
        background="#ffffff"
      >
        <div
          ref={dialogRef}
          className={`settings-dialog ${
            isCompactLayout ? 'settings-dialog--compact' : ''
          }`}
          data-testid="settings-dialog"
        >
          <div className="settings-dialog__layout">
            {renderSettingsNav()}
            <div className="settings-dialog__main">{renderActiveView()}</div>
          </div>
        </div>
      </WinBoxWindow>
      <ModelDiscoveryDialog
        open={discoveryDialogOpen}
        container={container}
        models={runtimeState.discoveredModels}
        selectedModelIds={runtimeState.selectedModelIds}
        onClose={() => setDiscoveryDialogOpen(false)}
        onConfirm={handleApplySelectedModels}
        onTestModel={(modelId) => {
          if (!selectedProfile) return;
          const model = runtimeState.discoveredModels.find(
            (m) => m.id === modelId
          );
          handleLaunchModelBenchmark({
            profileId: selectedProfile.id,
            modelId,
            modality: model?.type || 'image',
            compareMode: 'cross-provider',
            autoRun: true,
          });
        }}
      />
      {confirmDialog}
    </>
  );
};
