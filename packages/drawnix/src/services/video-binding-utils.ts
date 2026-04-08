import {
  getCompatibleParams,
  SORA_MODE_PARAM_ID,
  type ParamConfig,
} from '../constants/model-config';
import { getVideoModelConfig } from '../constants/video-model-config';
import type { VideoModelConfig } from '../types/video.types';
import type { ModelRef } from '../utils/settings-manager';
import { providerTransport } from './provider-routing/provider-transport';
import { resolveInvocationPlanFromRoute } from './provider-routing/settings-repository';
import type {
  ProviderModelBinding,
  ProviderVideoBindingMetadata,
  ResolvedProviderContext,
} from './provider-routing/types';

const FIXED_SORA_DURATION_MODEL_PATTERN = /^sora-2-(\d+)s$/i;
const DEFAULT_VIDEO_DOWNLOAD_PATH = '/videos/{taskId}/content';
const SORA_API_ALLOWED_DURATIONS = ['4', '8', '12'] as const;
const SORA_MODE_VALUES = new Set(['api', 'web']);
const KLING_ACTION_VALUES = new Set(['text2video', 'image2video']);
const KLING_CAMERA_PARAM_IDS = new Set([
  'camera_control_type',
  'camera_horizontal',
  'camera_vertical',
  'camera_pan',
  'camera_tilt',
  'camera_roll',
  'camera_zoom',
]);

function normalizeStringParams(
  params?: Record<string, unknown> | null
): Record<string, string> {
  if (!params) {
    return {};
  }

  return Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }

    const normalized = String(value).trim();
    if (normalized) {
      acc[key] = normalized;
    }
    return acc;
  }, {});
}

function normalizeDurationValue(
  value?: string | number | null
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

function resolveSelectedKlingAction(
  params?: Record<string, unknown> | null
): 'text2video' | 'image2video' | null {
  const action = normalizeStringParams(params).klingAction2?.toLowerCase();
  if (action && KLING_ACTION_VALUES.has(action)) {
    return action as 'text2video' | 'image2video';
  }

  return null;
}

function buildDynamicEnumOptions(
  param: ParamConfig,
  allowedValues: string[]
): NonNullable<ParamConfig['options']> {
  const optionLabels = new Map(
    (param.options || []).map((option) => [option.value, option.label])
  );

  return allowedValues.map((value) => ({
    value,
    label: optionLabels.get(value) || value,
  }));
}

function isSoraModel(modelId?: string | null): boolean {
  return Boolean(modelId && modelId.toLowerCase().includes('sora'));
}

function supportsSoraFrontendMode(modelId?: string | null): boolean {
  if (!modelId) {
    return false;
  }

  const normalized = modelId.toLowerCase();
  return normalized === 'sora-2' || normalized === 'sora-2-pro';
}

function inferDefaultSoraMode(
  binding?: ProviderModelBinding | null
): 'api' | 'web' {
  const allowedDurations = binding?.metadata?.video?.allowedDurations || [];
  if (
    allowedDurations.length === SORA_API_ALLOWED_DURATIONS.length &&
    allowedDurations.every((value, index) => value === SORA_API_ALLOWED_DURATIONS[index])
  ) {
    return 'api';
  }
  return 'web';
}

function resolveSoraMode(
  modelId?: string | null,
  binding?: ProviderModelBinding | null,
  params?: Record<string, unknown> | null
): 'api' | 'web' | null {
  if (!supportsSoraFrontendMode(modelId)) {
    return null;
  }

  const selectedMode = normalizeStringParams(params)[SORA_MODE_PARAM_ID]?.toLowerCase();
  if (selectedMode && SORA_MODE_VALUES.has(selectedMode)) {
    return selectedMode as 'api' | 'web';
  }

  return inferDefaultSoraMode(binding);
}

function getExplicitSoraMode(
  params?: Record<string, unknown> | null
): 'api' | 'web' | null {
  const selectedMode = normalizeStringParams(params)[SORA_MODE_PARAM_ID]?.toLowerCase();
  if (selectedMode && SORA_MODE_VALUES.has(selectedMode)) {
    return selectedMode as 'api' | 'web';
  }

  return null;
}

function buildStaticSoraMetadata(
  modelId?: string | null
): ProviderVideoBindingMetadata | null {
  if (!isSoraModel(modelId)) {
    return null;
  }

  const config = getVideoModelConfig(modelId || 'sora-2');
  const fixedDurationMatch = (modelId || '').match(FIXED_SORA_DURATION_MODEL_PATTERN);
  const allowedDurations = config.durationOptions.map((option) => option.value);

  return {
    allowedDurations,
    defaultDuration:
      config.defaultDuration || fixedDurationMatch?.[1] || allowedDurations[0],
    durationMode: fixedDurationMatch ? 'model-alias' : 'request-param',
    durationField: 'seconds',
    durationToModelMap: fixedDurationMatch?.[1]
      ? {
          [fixedDurationMatch[1]]: modelId || 'sora-2',
        }
      : undefined,
    strictDurationValidation: Boolean(fixedDurationMatch?.[1]),
    resultMode: 'inline-url',
  };
}

function buildFrontendSoraMetadata(
  modelId?: string | null,
  binding?: ProviderModelBinding | null,
  params?: Record<string, unknown> | null
): ProviderVideoBindingMetadata | null {
  const soraMode = getExplicitSoraMode(params);
  if (!soraMode) {
    return null;
  }

  if (soraMode === 'api') {
    return {
      allowedDurations: [...SORA_API_ALLOWED_DURATIONS],
      defaultDuration: '8',
      durationMode: 'request-param',
      durationField: 'seconds',
      strictDurationValidation: false,
    };
  }

  const staticMetadata = buildStaticSoraMetadata(modelId);
  if (!staticMetadata) {
    return null;
  }

  return {
    allowedDurations: staticMetadata.allowedDurations,
    defaultDuration: staticMetadata.defaultDuration,
    durationMode: staticMetadata.durationMode,
    durationField: staticMetadata.durationField,
    durationToModelMap: staticMetadata.durationToModelMap,
    strictDurationValidation: false,
  };
}

function mergeVideoMetadata(
  baseMetadata?: ProviderVideoBindingMetadata | null,
  overrideMetadata?: ProviderVideoBindingMetadata | null
): ProviderVideoBindingMetadata | null {
  if (!baseMetadata && !overrideMetadata) {
    return null;
  }

  return {
    ...(baseMetadata || {}),
    ...(overrideMetadata || {}),
    allowedDurations:
      overrideMetadata?.allowedDurations || baseMetadata?.allowedDurations,
    durationToModelMap:
      overrideMetadata?.durationToModelMap || baseMetadata?.durationToModelMap,
    strictDurationValidation:
      overrideMetadata?.strictDurationValidation ??
      baseMetadata?.strictDurationValidation,
  };
}

function buildDurationOptions(
  baseConfig: VideoModelConfig,
  allowedDurations: string[]
) {
  const baseLabels = new Map(
    baseConfig.durationOptions.map((option) => [option.value, option.label])
  );

  return allowedDurations.map((value) => ({
    value,
    label:
      baseLabels.get(value) ||
      `${value}秒${allowedDurations.length === 1 ? '（固定）' : ''}`,
  }));
}

function getVideoExtensionFromMimeType(mimeType?: string): string {
  const normalized = mimeType?.toLowerCase() || '';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('ogg')) return 'ogv';
  return 'mp4';
}

export interface ResolvedVideoSubmission {
  model: string;
  duration?: string;
  durationField: string;
  bindingMetadata: ProviderVideoBindingMetadata | null;
}

export function getResolvedVideoBindingMetadata(
  modelId?: string | null,
  binding?: ProviderModelBinding | null,
  params?: Record<string, unknown> | null
): ProviderVideoBindingMetadata | null {
  const staticMetadata = buildStaticSoraMetadata(modelId);
  const bindingMetadata = binding?.metadata?.video || null;
  const frontendMetadata = buildFrontendSoraMetadata(modelId, binding, params);
  return mergeVideoMetadata(
    mergeVideoMetadata(staticMetadata, bindingMetadata),
    frontendMetadata
  );
}

export function getEffectiveVideoModelConfig(
  modelId: string,
  binding?: ProviderModelBinding | null,
  params?: Record<string, unknown> | null
): VideoModelConfig {
  const baseConfig = getVideoModelConfig(modelId);
  const metadata = getResolvedVideoBindingMetadata(modelId, binding, params);

  if (!metadata?.allowedDurations?.length) {
    return baseConfig;
  }

  const allowedDurations = metadata.allowedDurations;
  const durationOptions = buildDurationOptions(baseConfig, allowedDurations);
  const defaultDuration = allowedDurations.includes(
    metadata.defaultDuration || ''
  )
    ? (metadata.defaultDuration as string)
    : allowedDurations.includes(baseConfig.defaultDuration)
      ? baseConfig.defaultDuration
      : allowedDurations[0];

  return {
    ...baseConfig,
    durationOptions,
    defaultDuration,
  };
}

export function getEffectiveVideoModelConfigForSelection(
  modelId: string,
  modelRef?: ModelRef | string | null,
  params?: Record<string, unknown> | null
): VideoModelConfig {
  const plan = resolveInvocationPlanFromRoute('video', modelRef || modelId);
  return getEffectiveVideoModelConfig(modelId, plan?.binding || null, params);
}

export function getEffectiveVideoDefaultParams(
  modelId: string,
  modelRef?: ModelRef | string | null,
  params?: Record<string, unknown> | null
): {
  duration: string;
  size: string;
} {
  const config = getEffectiveVideoModelConfigForSelection(modelId, modelRef, params);
  return {
    duration: config.defaultDuration,
    size: config.defaultSize,
  };
}

export function getEffectiveVideoCompatibleParams(
  modelId: string,
  modelRef?: ModelRef | string | null,
  params?: Record<string, unknown> | null
): ParamConfig[] {
  const compatibleParams = getCompatibleParams(modelId);
  const durationParam = compatibleParams.find((param) => param.id === 'duration');
  const plan = resolveInvocationPlanFromRoute('video', modelRef || modelId);
  const soraMode = resolveSoraMode(modelId, plan?.binding || null, params);
  const metadata = getResolvedVideoBindingMetadata(modelId, plan?.binding || null, params);
  const selectedKlingAction = resolveSelectedKlingAction(params);
  const effectiveConfig = getEffectiveVideoModelConfigForSelection(
    modelId,
    modelRef,
    params
  );

  return compatibleParams
    .filter((param) => {
      if (
        plan?.binding?.protocol === 'kling.video' &&
        selectedKlingAction === 'image2video' &&
        KLING_CAMERA_PARAM_IDS.has(param.id)
      ) {
        return false;
      }

      return true;
    })
    .map((param) => {
    if (param.id === SORA_MODE_PARAM_ID && soraMode) {
      return {
        ...param,
        defaultValue: soraMode,
      };
    }

    if (
      plan?.binding?.protocol === 'kling.video' &&
      metadata?.versionField === param.id &&
      param.valueType === 'enum'
    ) {
      const actionScopedOptions =
        (selectedKlingAction &&
          metadata.versionOptionsByAction?.[selectedKlingAction]) ||
        metadata.versionOptions ||
        [];
      const options =
        actionScopedOptions.length > 0
          ? buildDynamicEnumOptions(param, actionScopedOptions)
          : param.options;
      const defaultValue =
        actionScopedOptions.length > 0
          ? actionScopedOptions.includes(metadata.defaultVersion || '')
            ? metadata.defaultVersion
            : actionScopedOptions.includes(param.defaultValue || '')
              ? param.defaultValue
              : actionScopedOptions[0]
          : param.defaultValue;

      return {
        ...param,
        options,
        defaultValue,
      };
    }

    if (param.id === 'size') {
      return {
        ...param,
        options: effectiveConfig.sizeOptions.map((option) => ({
          value: option.value,
          label: option.label,
        })),
        defaultValue: effectiveConfig.defaultSize,
      };
    }

    if (param.id !== 'duration') {
      return param;
    }

    return {
      ...param,
      options: effectiveConfig.durationOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      defaultValue: effectiveConfig.defaultDuration,
    };
  });
}

export function getDefaultVideoExtraParams(
  modelId: string,
  modelRef?: ModelRef | string | null,
  params?: Record<string, unknown> | null
): Record<string, string> {
  const compatibleParams = getEffectiveVideoCompatibleParams(modelId, modelRef, params);
  const normalizedParams = normalizeStringParams(params);

  return compatibleParams.reduce<Record<string, string>>((acc, param) => {
    if (param.id === 'duration' || param.id === 'size') {
      return acc;
    }

    const nextValue = normalizedParams[param.id] || param.defaultValue;
    if (nextValue) {
      acc[param.id] = nextValue;
    }
    return acc;
  }, {});
}

export function resolveVideoSubmission(
  modelId: string,
  requestedDuration?: string | number | null,
  binding?: ProviderModelBinding | null,
  params?: Record<string, unknown> | null
): ResolvedVideoSubmission {
  const metadata = getResolvedVideoBindingMetadata(modelId, binding, params);
  const durationField = metadata?.durationField || 'seconds';
  const duration =
    normalizeDurationValue(requestedDuration) || metadata?.defaultDuration;

  if (
    duration &&
    metadata?.allowedDurations?.length &&
    metadata.strictDurationValidation !== false &&
    !metadata.allowedDurations.includes(duration)
  ) {
    throw new Error(
      `视频时长 ${duration}s 不受支持，可选时长：${metadata.allowedDurations.join(
        '/'
      )} 秒`
    );
  }

  if (metadata?.durationMode === 'model-alias' && duration) {
    return {
      model: metadata.durationToModelMap?.[duration] || modelId,
      duration: undefined,
      durationField,
      bindingMetadata: metadata,
    };
  }

  return {
    model: modelId,
    duration,
    durationField,
    bindingMetadata: metadata,
  };
}

export function extractInlineVideoUrl(
  payload: Record<string, any> | null | undefined
): string | undefined {
  return payload?.video_url || payload?.url || payload?.output?.url;
}

export function shouldDownloadVideoContent(
  modelId?: string | null,
  binding?: ProviderModelBinding | null,
  payload?: Record<string, any> | null
): boolean {
  const metadata = getResolvedVideoBindingMetadata(modelId, binding);
  const inlineUrl = extractInlineVideoUrl(payload);
  if (metadata?.resultMode === 'download-content') {
    return true;
  }

  if (!inlineUrl && Boolean(metadata?.downloadPathTemplate)) {
    return true;
  }

  const status = String(payload?.status || payload?.state || '').toLowerCase();
  return (
    !inlineUrl &&
    isSoraModel(modelId) &&
    (status === 'completed' || status === 'succeeded')
  );
}

export function resolveVideoDownloadPath(
  videoId: string,
  modelId?: string | null,
  binding?: ProviderModelBinding | null
): string {
  const metadata = getResolvedVideoBindingMetadata(modelId, binding);
  const template = metadata?.downloadPathTemplate || DEFAULT_VIDEO_DOWNLOAD_PATH;
  return template.replace(/\{taskId\}/g, encodeURIComponent(videoId));
}

export async function downloadVideoContentToLocalUrl(params: {
  videoId: string;
  provider: ResolvedProviderContext;
  binding?: ProviderModelBinding | null;
  modelId?: string | null;
  cacheKey?: string;
}): Promise<string> {
  const response = await providerTransport.send(params.provider, {
    path: resolveVideoDownloadPath(
      params.videoId,
      params.modelId,
      params.binding
    ),
    baseUrlStrategy: params.binding?.baseUrlStrategy,
    method: 'GET',
    headers: {
      Accept: 'video/*,application/octet-stream',
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `视频内容下载失败: ${response.status}${errorText ? ` - ${errorText}` : ''}`
    );
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error('视频内容下载为空');
  }

  const format = getVideoExtensionFromMimeType(blob.type);
  const cacheKey = params.cacheKey || params.videoId;
  const localUrl = `/__aitu_cache__/video/${cacheKey}.${format}`;

  try {
    const { unifiedCacheService } = await import('./unified-cache-service');
    await unifiedCacheService.cacheMediaFromBlob(localUrl, blob, 'video', {
      taskId: cacheKey,
      model: params.modelId || undefined,
    });
    return localUrl;
  } catch {
    return URL.createObjectURL(blob);
  }
}
