import {
  DEFAULT_TEXT_MODEL,
  getCompatibleParams,
  getDefaultAudioModel,
  getDefaultImageModel,
  getDefaultSizeForModel,
  getDefaultVideoModel,
  getModelConfig,
  getSizeOptionsForModel,
} from '../constants/model-config';
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  convertAspectRatioToSize,
} from '../constants/image-aspect-ratios';
import { LS_KEYS } from '../constants/storage-keys';
import {
  getDefaultModelParams,
  getVideoModelConfig,
  normalizeVideoModel,
} from '../constants/video-model-config';
import type { VideoModel } from '../types/video.types';
import type { GenerationType } from '../utils/ai-input-parser';
import { applyForcedSunoParams } from '../utils/suno-model-aliases';
import { getEffectiveVideoCompatibleParams } from './video-binding-utils';

type PersistedParams = Record<string, string>;

interface StoredValue<T> {
  value: T;
  updatedAt: number;
}

export interface AIInputPreferences {
  generationType: GenerationType;
  selectedModel: string;
  selectedParams: PersistedParams;
  selectedCount: number;
  selectedSkillId: string;
}

export interface AIImageToolPreferences {
  currentModel: string;
  currentSelectionKey?: string | null;
  extraParams: PersistedParams;
  aspectRatio: string;
}

export interface AIVideoToolPreferences {
  currentModel: VideoModel;
  currentSelectionKey?: string | null;
  extraParams: PersistedParams;
  duration: string;
  size: string;
}

interface AIInputPreferencesStored extends AIInputPreferences {
  modeVersion?: number;
  scopedPreferences?: Partial<
    Record<GenerationType, Record<string, PersistedParams>>
  >;
}

interface ScopedImageToolPreferences {
  modelId: string;
  selectionKey?: string | null;
  extraParams?: PersistedParams;
  aspectRatio?: string;
}

interface ScopedVideoToolPreferences {
  modelId: VideoModel;
  selectionKey?: string | null;
  extraParams?: PersistedParams;
  duration?: string;
  size?: string;
}

interface AIImageToolPreferencesStored extends AIImageToolPreferences {
  scopedPreferences?: Record<string, ScopedImageToolPreferences>;
}

interface AIVideoToolPreferencesStored extends AIVideoToolPreferences {
  scopedPreferences?: Record<string, ScopedVideoToolPreferences>;
}

const COUNT_OPTIONS = new Set([1, 2, 3, 4, 5, 10, 20]);

function readStoredValue<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredValue<T> | T;
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      return (parsed as StoredValue<T>).value;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

function writeStoredValue<T>(key: string, value: T): void {
  try {
    const payload: StoredValue<T> = {
      value,
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage failures in UI preference persistence.
  }
}

function asRecord(value: unknown): PersistedParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(
    value as Record<string, unknown>
  ).reduce<PersistedParams>((acc, [key, item]) => {
    if (typeof item === 'string') {
      acc[key] = item;
    }
    return acc;
  }, {});
}

function getModelPreferenceKey(
  modelId: string,
  selectionKey?: string | null
): string {
  if (typeof selectionKey === 'string' && selectionKey.trim()) {
    return selectionKey.trim();
  }

  return modelId;
}

function getEnumOptionValues(param?: {
  options?: Array<{ value: string }>;
}): Set<string> {
  return new Set(param?.options?.map((option) => option.value) || []);
}

function migrateLegacyGPTImageQualityParam(
  compatibleParams: ReturnType<typeof getCompatibleParams>,
  persistedParams: PersistedParams
): PersistedParams {
  const resolutionParam = compatibleParams.find(
    (param) => param.id === 'resolution'
  );
  const qualityParam = compatibleParams.find((param) => param.id === 'quality');
  const resolutionOptions = getEnumOptionValues(resolutionParam);
  const qualityOptions = getEnumOptionValues(qualityParam);

  const hasGPTResolutionOptions =
    resolutionOptions.has('1k') &&
    resolutionOptions.has('2k') &&
    resolutionOptions.has('4k');
  const hasOfficialGPTQualityOptions =
    qualityOptions.has('auto') &&
    qualityOptions.has('low') &&
    qualityOptions.has('medium') &&
    qualityOptions.has('high');

  if (!hasGPTResolutionOptions || !hasOfficialGPTQualityOptions) {
    return persistedParams;
  }

  const nextParams = { ...persistedParams };
  const persistedResolution = nextParams.resolution;
  const persistedQuality = nextParams.quality;

  if (
    persistedQuality &&
    resolutionOptions.has(persistedQuality) &&
    !resolutionOptions.has(persistedResolution)
  ) {
    nextParams.resolution = persistedQuality;
  }

  if (persistedQuality && !qualityOptions.has(persistedQuality)) {
    delete nextParams.quality;
  }

  return nextParams;
}

function sanitizeSelectedParams(
  modelId: string,
  rawParams: unknown,
  options?: { excludeParamIds?: string[]; keepDefaultSize?: boolean }
): PersistedParams {
  const compatibleParams = getCompatibleParams(modelId);
  const excludeParamIds = new Set(options?.excludeParamIds || []);
  const persistedParams = migrateLegacyGPTImageQualityParam(
    compatibleParams,
    asRecord(rawParams)
  );
  const nextParams: PersistedParams = {};

  const sizeParam = compatibleParams.find((param) => param.id === 'size');
  if (
    sizeParam &&
    !modelId.startsWith('mj') &&
    !excludeParamIds.has('size') &&
    options?.keepDefaultSize !== false
  ) {
    const persistedSize = persistedParams.size;
    const isValidPersistedSize = sizeParam.options?.some(
      (option) => option.value === persistedSize
    );
    nextParams.size = isValidPersistedSize
      ? persistedSize
      : getDefaultSizeForModel(modelId);
  }

  compatibleParams.forEach((param) => {
    if (excludeParamIds.has(param.id) || param.id === 'size') return;

    const persistedValue = persistedParams[param.id];
    const isValidPersistedValue =
      param.valueType === 'enum'
        ? param.options?.some((option) => option.value === persistedValue)
        : typeof persistedValue === 'string' && persistedValue !== '';

    if (isValidPersistedValue && persistedValue) {
      nextParams[param.id] = persistedValue;
      return;
    }

    if (param.defaultValue) {
      nextParams[param.id] = param.defaultValue;
    }
  });

  return applyForcedSunoParams(modelId, nextParams);
}

export function sanitizeImageToolExtraParams(
  modelId: string,
  rawParams: unknown
): PersistedParams {
  return sanitizeSelectedParams(modelId, rawParams);
}

function loadAIInputImageParams(
  modelId: string,
  selectionKey?: string | null
): PersistedParams | null {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);
  const scopedParams = stored.scopedPreferences?.image?.[preferenceKey];
  if (scopedParams) {
    return asRecord(scopedParams);
  }

  if (stored.generationType === 'image' && stored.selectedModel === modelId) {
    return asRecord(stored.selectedParams);
  }

  return null;
}

function saveAIInputImageParams(
  modelId: string,
  selectionKey: string | null | undefined,
  extraParams: PersistedParams
): void {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);
  const currentParams =
    stored.generationType === 'image' && stored.selectedModel === modelId
      ? asRecord(stored.selectedParams)
      : {};
  const scopedParams = asRecord(
    stored.scopedPreferences?.image?.[preferenceKey]
  );
  const mergedParams = sanitizeSelectedParams(modelId, {
    ...currentParams,
    ...scopedParams,
    ...extraParams,
  });

  writeStoredValue<Partial<AIInputPreferencesStored>>(
    LS_KEYS.AI_INPUT_PREFERENCES,
    {
      ...stored,
      scopedPreferences: {
        ...(stored.scopedPreferences || {}),
        image: {
          ...(stored.scopedPreferences?.image || {}),
          [preferenceKey]: mergedParams,
        },
      },
    }
  );
}

function sanitizeVideoToolParams(
  modelId: string,
  rawParams: unknown
): PersistedParams {
  const persistedParams = asRecord(rawParams);
  if (
    modelId.startsWith('doubao-seedance-2-0-') &&
    persistedParams.size?.includes('@')
  ) {
    const [resolution, ratio] = persistedParams.size.split('@');
    persistedParams.size = resolution;
    if (ratio && !persistedParams.ratio) {
      persistedParams.ratio = ratio;
    }
  }
  const compatibleParams = getEffectiveVideoCompatibleParams(
    modelId,
    modelId,
    persistedParams
  );

  return compatibleParams.reduce<PersistedParams>((acc, param) => {
    const persistedValue = persistedParams[param.id];
    const isValidPersistedValue =
      param.valueType === 'enum'
        ? param.options?.some((option) => option.value === persistedValue)
        : typeof persistedValue === 'string' && persistedValue !== '';

    if (isValidPersistedValue && persistedValue) {
      acc[param.id] = persistedValue;
      return acc;
    }

    if (param.defaultValue) {
      acc[param.id] = param.defaultValue;
    }
    return acc;
  }, {});
}

function mergeVideoToolParams(
  extraParams: unknown,
  duration?: unknown,
  size?: unknown
): PersistedParams {
  return {
    ...asRecord(extraParams),
    ...(typeof duration === 'string' && duration.trim()
      ? { duration: duration.trim() }
      : {}),
    ...(typeof size === 'string' && size.trim() ? { size: size.trim() } : {}),
  };
}

function splitVideoToolParams(
  modelId: string,
  params: PersistedParams
): Pick<AIVideoToolPreferences, 'extraParams' | 'duration' | 'size'> {
  const defaultParams = getDefaultModelParams(normalizeVideoModel(modelId));
  const { duration, size, ...extraParams } = params;
  return {
    extraParams,
    duration: duration || defaultParams.duration,
    size: size || defaultParams.size,
  };
}

function loadAIInputVideoParams(
  modelId: string,
  selectionKey?: string | null
): PersistedParams | null {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);
  const scopedParams = stored.scopedPreferences?.video?.[preferenceKey];
  if (scopedParams) {
    return asRecord(scopedParams);
  }

  if (stored.generationType === 'video' && stored.selectedModel === modelId) {
    return asRecord(stored.selectedParams);
  }

  return null;
}

function saveAIInputVideoParams(
  modelId: string,
  selectionKey: string | null | undefined,
  selectedParams: PersistedParams
): void {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);
  const currentParams =
    stored.generationType === 'video' && stored.selectedModel === modelId
      ? asRecord(stored.selectedParams)
      : {};
  const scopedParams = asRecord(
    stored.scopedPreferences?.video?.[preferenceKey]
  );
  const mergedParams = sanitizeVideoToolParams(modelId, {
    ...currentParams,
    ...scopedParams,
    ...selectedParams,
  });

  writeStoredValue<Partial<AIInputPreferencesStored>>(
    LS_KEYS.AI_INPUT_PREFERENCES,
    {
      ...stored,
      scopedPreferences: {
        ...(stored.scopedPreferences || {}),
        video: {
          ...(stored.scopedPreferences?.video || {}),
          [preferenceKey]: mergedParams,
        },
      },
    }
  );
}

function getDefaultModelForGenerationType(type: GenerationType): string {
  if (type === 'video') return getDefaultVideoModel();
  if (type === 'audio') return getDefaultAudioModel();
  if (type === 'text' || type === 'agent') return DEFAULT_TEXT_MODEL;
  return getDefaultImageModel();
}

function isValidGenerationType(value: unknown): value is GenerationType {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'text' ||
    value === 'agent'
  );
}

function getSupportedAspectRatios(modelId: string): Set<string> {
  const sizeOptions = getSizeOptionsForModel(modelId);
  if (sizeOptions.length === 0) {
    return new Set(ASPECT_RATIO_OPTIONS.map((option) => option.value));
  }

  const supported = new Set<string>();
  const knownAspectRatios = new Map(
    ASPECT_RATIO_OPTIONS.map((option) => [
      option.value.replace(':', 'x'),
      option.value,
    ])
  );

  sizeOptions.forEach((option) => {
    if (option.value === 'auto') {
      supported.add('auto');
      return;
    }
    const aspectRatio = knownAspectRatios.get(option.value);
    if (aspectRatio) {
      supported.add(aspectRatio);
    }
  });

  return supported.size > 0
    ? supported
    : new Set(ASPECT_RATIO_OPTIONS.map((option) => option.value));
}

function sanitizeAspectRatio(modelId: string, aspectRatio: unknown): string {
  if (typeof aspectRatio !== 'string') {
    return DEFAULT_ASPECT_RATIO;
  }

  const supportedAspectRatios = getSupportedAspectRatios(modelId);
  if (supportedAspectRatios.has(aspectRatio)) {
    return aspectRatio;
  }

  if (supportedAspectRatios.has('auto')) {
    return 'auto';
  }

  return DEFAULT_ASPECT_RATIO;
}

function sizeParamToAspectRatio(size: unknown): string | undefined {
  if (typeof size !== 'string' || !size.trim()) {
    return undefined;
  }

  if (size === 'auto') {
    return DEFAULT_ASPECT_RATIO;
  }

  const normalized = size.trim().replace(/[xX]/g, ':');
  return ASPECT_RATIO_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : undefined;
}

function getSupportedImageToolSizeFromAspectRatio(
  modelId: string,
  aspectRatio: unknown
): string | undefined {
  const sanitizedAspectRatio = sanitizeAspectRatio(modelId, aspectRatio);
  const size = convertAspectRatioToSize(sanitizedAspectRatio);
  if (!size) {
    return undefined;
  }

  return getSizeOptionsForModel(modelId).some((option) => option.value === size)
    ? size
    : undefined;
}

function mergeImageToolAspectRatioParams(
  modelId: string,
  rawParams: unknown,
  aspectRatio: unknown
): PersistedParams {
  const params = asRecord(rawParams);
  if (params.size) {
    return params;
  }

  const size = getSupportedImageToolSizeFromAspectRatio(modelId, aspectRatio);
  return size ? { ...params, size } : params;
}

export function loadAIInputPreferences(): AIInputPreferences {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  const rawGenerationType = stored.generationType;
  const isLegacyMode = stored.modeVersion !== 2;
  const generationType =
    isLegacyMode && rawGenerationType === 'text'
      ? 'agent'
      : isValidGenerationType(rawGenerationType)
      ? rawGenerationType
      : 'image';

  const fallbackModel = getDefaultModelForGenerationType(generationType);
  const persistedModel =
    typeof stored.selectedModel === 'string' ? stored.selectedModel : '';
  const persistedModelConfig = persistedModel
    ? getModelConfig(persistedModel)
    : null;
  const selectedModel =
    persistedModelConfig &&
    (persistedModelConfig.type === generationType ||
      ((generationType === 'text' || generationType === 'agent') &&
        persistedModelConfig.type === 'text'))
      ? persistedModel
      : fallbackModel;

  const selectedParams =
    generationType === 'agent'
      ? {}
      : sanitizeSelectedParams(selectedModel, stored.selectedParams);

  const selectedCount =
    generationType === 'agent' || generationType === 'text'
      ? 1
      : typeof stored.selectedCount === 'number' &&
        COUNT_OPTIONS.has(stored.selectedCount)
      ? stored.selectedCount
      : 1;

  return {
    generationType,
    selectedModel,
    selectedParams,
    selectedCount,
    selectedSkillId:
      typeof stored.selectedSkillId === 'string' &&
      stored.selectedSkillId.trim()
        ? stored.selectedSkillId.trim()
        : 'auto',
  };
}

export function saveAIInputPreferences(preferences: AIInputPreferences): void {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  writeStoredValue<AIInputPreferencesStored>(LS_KEYS.AI_INPUT_PREFERENCES, {
    ...stored,
    ...preferences,
    modeVersion: 2,
    selectedParams:
      preferences.generationType === 'agent' ? {} : preferences.selectedParams,
    selectedCount:
      preferences.generationType === 'agent' ||
      preferences.generationType === 'text'
        ? 1
        : preferences.selectedCount,
  } satisfies AIInputPreferencesStored);
}

export function loadAIImageToolPreferences(
  fallbackModel: string
): AIImageToolPreferences {
  const stored =
    readStoredValue<Partial<AIImageToolPreferencesStored>>(
      LS_KEYS.AI_IMAGE_TOOL_PREFERENCES
    ) || {};
  const persistedModel =
    typeof stored.currentModel === 'string' ? stored.currentModel : '';
  const persistedModelConfig = persistedModel
    ? getModelConfig(persistedModel)
    : null;
  const currentModel =
    persistedModelConfig?.type === 'image' ? persistedModel : fallbackModel;
  const currentSelectionKey =
    typeof stored.currentSelectionKey === 'string' &&
    stored.currentSelectionKey.trim()
      ? stored.currentSelectionKey.trim()
      : null;
  const rawExtraParams = mergeImageToolAspectRatioParams(
    currentModel,
    loadAIInputImageParams(currentModel, currentSelectionKey) ||
      stored.extraParams,
    stored.aspectRatio
  );
  const extraParams = sanitizeImageToolExtraParams(
    currentModel,
    rawExtraParams
  );

  return {
    currentModel,
    currentSelectionKey,
    extraParams,
    aspectRatio: sanitizeAspectRatio(
      currentModel,
      sizeParamToAspectRatio(extraParams.size) || stored.aspectRatio
    ),
  };
}

export function saveAIImageToolPreferences(
  preferences: AIImageToolPreferences
): void {
  const stored =
    readStoredValue<Partial<AIImageToolPreferencesStored>>(
      LS_KEYS.AI_IMAGE_TOOL_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(
    preferences.currentModel,
    preferences.currentSelectionKey
  );
  const extraParams = sanitizeImageToolExtraParams(
    preferences.currentModel,
    mergeImageToolAspectRatioParams(
      preferences.currentModel,
      preferences.extraParams,
      preferences.aspectRatio
    )
  );

  writeStoredValue<Partial<AIImageToolPreferencesStored>>(
    LS_KEYS.AI_IMAGE_TOOL_PREFERENCES,
    {
      ...stored,
      ...preferences,
      extraParams,
      scopedPreferences: {
        ...(stored.scopedPreferences || {}),
        [preferenceKey]: {
          modelId: preferences.currentModel,
          selectionKey: preferences.currentSelectionKey || null,
          extraParams,
          aspectRatio: preferences.aspectRatio,
        },
      },
    } satisfies AIImageToolPreferencesStored
  );
  saveAIInputImageParams(
    preferences.currentModel,
    preferences.currentSelectionKey,
    extraParams
  );
}

export function loadAIVideoToolPreferences(
  fallbackModel: VideoModel
): AIVideoToolPreferences {
  const stored =
    readStoredValue<Partial<AIVideoToolPreferencesStored>>(
      LS_KEYS.AI_VIDEO_TOOL_PREFERENCES
    ) || {};
  const currentModel = normalizeVideoModel(
    stored.currentModel || fallbackModel
  );
  const currentSelectionKey =
    typeof stored.currentSelectionKey === 'string' &&
    stored.currentSelectionKey.trim()
      ? stored.currentSelectionKey.trim()
      : null;
  const selectedParams = sanitizeVideoToolParams(
    currentModel,
    loadAIInputVideoParams(currentModel, currentSelectionKey) ||
      mergeVideoToolParams(stored.extraParams, stored.duration, stored.size)
  );
  const splitParams = splitVideoToolParams(currentModel, selectedParams);

  return {
    currentModel,
    currentSelectionKey,
    ...splitParams,
  };
}

export function saveAIVideoToolPreferences(
  preferences: AIVideoToolPreferences
): void {
  const stored =
    readStoredValue<Partial<AIVideoToolPreferencesStored>>(
      LS_KEYS.AI_VIDEO_TOOL_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(
    preferences.currentModel,
    preferences.currentSelectionKey
  );
  const selectedParams = sanitizeVideoToolParams(
    preferences.currentModel,
    mergeVideoToolParams(
      preferences.extraParams,
      preferences.duration,
      preferences.size
    )
  );
  const splitParams = splitVideoToolParams(
    preferences.currentModel,
    selectedParams
  );

  writeStoredValue<Partial<AIVideoToolPreferencesStored>>(
    LS_KEYS.AI_VIDEO_TOOL_PREFERENCES,
    {
      ...stored,
      ...preferences,
      ...splitParams,
      scopedPreferences: {
        ...(stored.scopedPreferences || {}),
        [preferenceKey]: {
          modelId: preferences.currentModel,
          selectionKey: preferences.currentSelectionKey || null,
          ...splitParams,
        },
      },
    } satisfies AIVideoToolPreferencesStored
  );
  saveAIInputVideoParams(
    preferences.currentModel,
    preferences.currentSelectionKey,
    selectedParams
  );
}

export function loadScopedAIInputModelParams(
  generationType: GenerationType,
  modelId: string,
  selectionKey?: string | null,
  fallbackParams?: PersistedParams
): PersistedParams {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);
  const scopedParams =
    stored.scopedPreferences?.[generationType]?.[preferenceKey];
  return asRecord(scopedParams ?? fallbackParams);
}

export function saveScopedAIInputModelParams(
  generationType: GenerationType,
  modelId: string,
  selectedParams: PersistedParams,
  selectionKey?: string | null
): void {
  const stored =
    readStoredValue<Partial<AIInputPreferencesStored>>(
      LS_KEYS.AI_INPUT_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);

  writeStoredValue<Partial<AIInputPreferencesStored>>(
    LS_KEYS.AI_INPUT_PREFERENCES,
    {
      ...stored,
      scopedPreferences: {
        ...(stored.scopedPreferences || {}),
        [generationType]: {
          ...(stored.scopedPreferences?.[generationType] || {}),
          [preferenceKey]: asRecord(selectedParams),
        },
      },
    }
  );
}

export function loadScopedAIImageToolPreferences(
  modelId: string,
  selectionKey?: string | null
): Pick<AIImageToolPreferences, 'extraParams' | 'aspectRatio'> {
  const stored =
    readStoredValue<Partial<AIImageToolPreferencesStored>>(
      LS_KEYS.AI_IMAGE_TOOL_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);
  const scoped = stored.scopedPreferences?.[preferenceKey];
  const inputParams = loadAIInputImageParams(modelId, selectionKey);
  const storedAspectRatio = scoped?.aspectRatio ?? stored.aspectRatio;
  const rawExtraParams = mergeImageToolAspectRatioParams(
    modelId,
    inputParams ?? scoped?.extraParams ?? stored.extraParams,
    storedAspectRatio
  );
  const extraParams = sanitizeImageToolExtraParams(modelId, rawExtraParams);

  return {
    extraParams,
    aspectRatio: sanitizeAspectRatio(
      modelId,
      sizeParamToAspectRatio(extraParams.size) || storedAspectRatio
    ),
  };
}

export function loadScopedAIVideoToolPreferences(
  modelId: VideoModel,
  selectionKey?: string | null
): Pick<AIVideoToolPreferences, 'extraParams' | 'duration' | 'size'> {
  const stored =
    readStoredValue<Partial<AIVideoToolPreferencesStored>>(
      LS_KEYS.AI_VIDEO_TOOL_PREFERENCES
    ) || {};
  const preferenceKey = getModelPreferenceKey(modelId, selectionKey);
  const scoped = stored.scopedPreferences?.[preferenceKey];
  const normalizedModel = normalizeVideoModel(modelId);
  const inputParams = loadAIInputVideoParams(normalizedModel, selectionKey);
  const selectedParams = sanitizeVideoToolParams(
    normalizedModel,
    inputParams ??
      mergeVideoToolParams(
        scoped?.extraParams ?? stored.extraParams,
        scoped?.duration ?? stored.duration,
        scoped?.size ?? stored.size
      )
  );

  return splitVideoToolParams(normalizedModel, selectedParams);
}
