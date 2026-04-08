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
import { ASPECT_RATIO_OPTIONS, DEFAULT_ASPECT_RATIO } from '../constants/image-aspect-ratios';
import { LS_KEYS } from '../constants/storage-keys';
import { getDefaultModelParams, getVideoModelConfig, normalizeVideoModel } from '../constants/video-model-config';
import type { VideoModel } from '../types/video.types';
import type { GenerationType } from '../utils/ai-input-parser';
import { applyForcedSunoParams } from '../utils/suno-model-aliases';

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
}

export interface AIImageToolPreferences {
  currentModel: string;
  extraParams: PersistedParams;
  aspectRatio: string;
}

export interface AIVideoToolPreferences {
  currentModel: VideoModel;
  extraParams: PersistedParams;
  duration: string;
  size: string;
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

  return Object.entries(value as Record<string, unknown>).reduce<PersistedParams>((acc, [key, item]) => {
    if (typeof item === 'string') {
      acc[key] = item;
    }
    return acc;
  }, {});
}

function sanitizeSelectedParams(
  modelId: string,
  rawParams: unknown,
  options?: { excludeParamIds?: string[]; keepDefaultSize?: boolean }
): PersistedParams {
  const compatibleParams = getCompatibleParams(modelId);
  const excludeParamIds = new Set(options?.excludeParamIds || []);
  const persistedParams = asRecord(rawParams);
  const nextParams: PersistedParams = {};

  const sizeParam = compatibleParams.find(param => param.id === 'size');
  if (
    sizeParam &&
    !modelId.startsWith('mj') &&
    !excludeParamIds.has('size') &&
    options?.keepDefaultSize !== false
  ) {
    const persistedSize = persistedParams.size;
    const isValidPersistedSize = sizeParam.options?.some(option => option.value === persistedSize);
    nextParams.size = isValidPersistedSize ? persistedSize : getDefaultSizeForModel(modelId);
  }

  compatibleParams.forEach(param => {
    if (excludeParamIds.has(param.id) || param.id === 'size') return;

    const persistedValue = persistedParams[param.id];
    const isValidPersistedValue = param.options?.some(option => option.value === persistedValue);

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

function getDefaultModelForGenerationType(type: GenerationType): string {
  if (type === 'video') return getDefaultVideoModel();
  if (type === 'audio') return getDefaultAudioModel();
  if (type === 'text') return DEFAULT_TEXT_MODEL;
  return getDefaultImageModel();
}

function isValidGenerationType(value: unknown): value is GenerationType {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'text'
  );
}

function getSupportedAspectRatios(modelId: string): Set<string> {
  const sizeOptions = getSizeOptionsForModel(modelId);
  if (sizeOptions.length === 0) {
    return new Set(ASPECT_RATIO_OPTIONS.map(option => option.value));
  }

  const supported = new Set<string>();
  const knownAspectRatios = new Map(
    ASPECT_RATIO_OPTIONS.map(option => [option.value.replace(':', 'x'), option.value])
  );

  sizeOptions.forEach(option => {
    if (option.value === 'auto') {
      supported.add('auto');
      return;
    }
    const aspectRatio = knownAspectRatios.get(option.value);
    if (aspectRatio) {
      supported.add(aspectRatio);
    }
  });

  return supported.size > 0 ? supported : new Set(ASPECT_RATIO_OPTIONS.map(option => option.value));
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

export function loadAIInputPreferences(): AIInputPreferences {
  const stored = readStoredValue<Partial<AIInputPreferences>>(LS_KEYS.AI_INPUT_PREFERENCES) || {};
  const generationType = isValidGenerationType(stored.generationType) ? stored.generationType : 'image';

  const fallbackModel = getDefaultModelForGenerationType(generationType);
  const persistedModel = typeof stored.selectedModel === 'string' ? stored.selectedModel : '';
  const persistedModelConfig = persistedModel ? getModelConfig(persistedModel) : null;
  const selectedModel = persistedModelConfig?.type === generationType ? persistedModel : fallbackModel;

  const selectedParams = generationType === 'text'
    ? {}
    : sanitizeSelectedParams(selectedModel, stored.selectedParams);

  const selectedCount =
    generationType === 'text'
      ? 1
      : typeof stored.selectedCount === 'number' && COUNT_OPTIONS.has(stored.selectedCount)
        ? stored.selectedCount
        : 1;

  return {
    generationType,
    selectedModel,
    selectedParams,
    selectedCount,
  };
}

export function saveAIInputPreferences(preferences: AIInputPreferences): void {
  writeStoredValue(LS_KEYS.AI_INPUT_PREFERENCES, preferences);
}

export function loadAIImageToolPreferences(fallbackModel: string): AIImageToolPreferences {
  const stored = readStoredValue<Partial<AIImageToolPreferences>>(LS_KEYS.AI_IMAGE_TOOL_PREFERENCES) || {};
  const persistedModel = typeof stored.currentModel === 'string' ? stored.currentModel : '';
  const persistedModelConfig = persistedModel ? getModelConfig(persistedModel) : null;
  const currentModel = persistedModelConfig?.type === 'image' ? persistedModel : fallbackModel;

  return {
    currentModel,
    extraParams: sanitizeSelectedParams(currentModel, stored.extraParams, {
      excludeParamIds: currentModel.startsWith('mj') ? [] : ['size'],
      keepDefaultSize: false,
    }),
    aspectRatio: sanitizeAspectRatio(currentModel, stored.aspectRatio),
  };
}

export function saveAIImageToolPreferences(preferences: AIImageToolPreferences): void {
  writeStoredValue(LS_KEYS.AI_IMAGE_TOOL_PREFERENCES, preferences);
}

export function loadAIVideoToolPreferences(
  fallbackModel: VideoModel
): AIVideoToolPreferences {
  const stored = readStoredValue<Partial<AIVideoToolPreferences>>(LS_KEYS.AI_VIDEO_TOOL_PREFERENCES) || {};
  const currentModel = normalizeVideoModel(stored.currentModel || fallbackModel);
  const modelConfig = getVideoModelConfig(currentModel);
  const defaultParams = getDefaultModelParams(currentModel);

  const duration = typeof stored.duration === 'string' &&
    modelConfig.durationOptions.some(option => option.value === stored.duration)
    ? stored.duration
    : defaultParams.duration;

  const size = typeof stored.size === 'string' &&
    modelConfig.sizeOptions.some(option => option.value === stored.size)
    ? stored.size
    : defaultParams.size;

  return {
    currentModel,
    extraParams: sanitizeSelectedParams(currentModel, stored.extraParams, {
      excludeParamIds: ['size', 'duration'],
      keepDefaultSize: false,
    }),
    duration,
    size,
  };
}

export function saveAIVideoToolPreferences(preferences: AIVideoToolPreferences): void {
  writeStoredValue(LS_KEYS.AI_VIDEO_TOOL_PREFERENCES, preferences);
}
