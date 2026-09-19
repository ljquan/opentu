import type { KnowledgeContextRef, Task } from '../types/task.types';
import type { ModelRef } from './settings-manager';
import type { AIInputPrefillEventDetail } from '../services/ai-input-ui-events';
import { resolveTaskInvocationRouteModel } from '../services/task-invocation-route';
import { mergeImageGenerationParams, hasImageDimensions } from '../services/model-adapters/image-generation-intent';

export interface ImageGenerationReferenceImage {
  url: string;
  name: string;
  maskImage?: string;
  width?: number;
  height?: number;
}

export interface ImageGenerationInitialData {
  prefillId: string;
  initialPrompt: string;
  initialWidth?: number;
  initialHeight?: number;
  initialResultUrl?: string;
  initialAspectRatio?: string;
  initialModel?: string;
  initialModelRef?: ModelRef | null;
  initialParams?: Record<string, string>;
  initialImages: ImageGenerationReferenceImage[];
  initialKnowledgeContextRefs?: KnowledgeContextRef[];
}

function normalizeImageTaskDataUrl(value: string): string {
  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed || value;
  }

  const normalized = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized) || normalized.length < 32) {
    return trimmed;
  }

  return `data:image/png;base64,${normalized}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function readModelRef(value: unknown): ModelRef | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const profileId = record.profileId;
  const modelId = record.modelId;
  return {
    profileId: typeof profileId === 'string' ? profileId : null,
    modelId: typeof modelId === 'string' ? modelId : null,
  };
}

function readStringParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, string>
  >((acc, [key, item]) => {
    if (typeof item === 'string' && item.trim()) {
      acc[key] = item;
    }
    return acc;
  }, {});
}

function readKnowledgeContextRefs(value: unknown): KnowledgeContextRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: KnowledgeContextRef[] = [];
  const seen = new Set<string>();
  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const record = item as Record<string, unknown>;
    const noteId = readString(record.noteId);
    if (!noteId || seen.has(noteId)) {
      return;
    }

    seen.add(noteId);
    refs.push({
      noteId,
      title: readString(record.title) || '未命名笔记',
      directoryId: readString(record.directoryId),
      updatedAt: readFiniteNumber(record.updatedAt),
    });
  });
  return refs;
}

function normalizeReferenceImage(
  value: unknown,
  index: number,
  labelPrefix: string
): ImageGenerationReferenceImage | null {
  if (typeof value === 'string') {
    const url = readString(value);
    return url
      ? {
          url: normalizeImageTaskDataUrl(url),
          name: `${labelPrefix} ${index + 1}`,
        }
      : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const url = readString(record.url) || readString(record.base64);
  if (!url) {
    return null;
  }

  return {
    url: normalizeImageTaskDataUrl(url),
    name: readString(record.name) || `${labelPrefix} ${index + 1}`,
    ...(hasImageDimensions(record) ? { width: record.width, height: record.height } : {}),
  };
}

function appendReferenceImages(
  target: ImageGenerationReferenceImage[],
  seenUrls: Set<string>,
  values: unknown,
  labelPrefix: string
): void {
  if (!Array.isArray(values)) {
    return;
  }

  values.forEach((value, index) => {
    const image = normalizeReferenceImage(value, index, labelPrefix);
    if (!image) return;
    if (seenUrls.has(image.url)) {
      const existing = target.find((item) => item.url === image.url);
      if (existing && !hasImageDimensions(existing) && hasImageDimensions(image)) {
        existing.width = image.width;
        existing.height = image.height;
      }
      return;
    }

    seenUrls.add(image.url);
    target.push(image);
  });
}

export function getImageTaskKnowledgeContextRefs(
  task: Pick<Task, 'params'>
): KnowledgeContextRef[] {
  const params = task.params as Record<string, unknown>;
  const refs = readKnowledgeContextRefs(params.knowledgeContextRefs);
  if (refs.length > 0) {
    return refs;
  }

  const promptMeta = params.promptMeta;
  if (!promptMeta || typeof promptMeta !== 'object') {
    return [];
  }
  return readKnowledgeContextRefs(
    (promptMeta as Record<string, unknown>).knowledgeContextRefs
  );
}

export function getImageTaskReferenceImages(
  task: Pick<Task, 'params'>
): ImageGenerationReferenceImage[] {
  const params = task.params as Record<string, unknown>;
  const images: ImageGenerationReferenceImage[] = [];
  const seenUrls = new Set<string>();

  appendReferenceImages(images, seenUrls, params.uploadedImages, '参考图');

  const uploadedImage = normalizeReferenceImage(
    params.uploadedImage,
    images.length,
    '参考图'
  );
  if (uploadedImage && !seenUrls.has(uploadedImage.url)) {
    seenUrls.add(uploadedImage.url);
    images.push(uploadedImage);
  }

  appendReferenceImages(images, seenUrls, params.referenceImages, '参考图');

  const inputReference = normalizeReferenceImage(
    params.inputReference,
    images.length,
    '参考图'
  );
  if (inputReference && !seenUrls.has(inputReference.url)) {
    images.push(inputReference);
  }

  const maskImage =
    readString(params.maskImage) || readString(params.mask_image);
  if (maskImage && images.length === 1) {
    images[0] = {
      ...images[0],
      maskImage,
    };
  }

  const metadata = (params.params as Record<string, unknown> | undefined)?.referenceImageMetadata;
  return images.map((image) => {
    const source = Array.isArray(metadata) ? metadata.find((item) =>
      typeof item?.url === 'string' && normalizeImageTaskDataUrl(item.url) === image.url
    ) : undefined;
    return !hasImageDimensions(image) && hasImageDimensions(source)
      ? { ...image, width: source.width, height: source.height }
      : image;
  });
}

export function getImageTaskGenerationParams(task: Pick<Task, 'params' | 'invocationRoute'>): Record<string, string> {
  const params = task.params as Record<string, unknown>;
  const merged = readStringParams(mergeImageGenerationParams({
    ...params,
    params: params.params as Record<string, unknown> | undefined,
  }));
  const size = readString(params.size) || merged.size || readString(params.aspectRatio);
  if (size) merged.size = size.replace(':', 'x').toLowerCase();
  const routeModel = resolveTaskInvocationRouteModel(task);
  const model = (typeof routeModel === 'string' ? routeModel : routeModel?.modelId) || '';
  if (model.startsWith('gpt-image') && /^(1k|2k|4k)$/i.test(merged.quality || '')) {
    merged.resolution ||= merged.quality.toLowerCase();
    delete merged.quality;
  }
  if (model.includes('seedream') && merged.resolution) merged.seedream_quality = merged.resolution;
  if (model.includes('gemini') && merged.resolution) merged.quality = merged.resolution;
  return merged;
}

export function buildImageTaskPrefillInitialData(
  task: Task
): ImageGenerationInitialData {
  const params = task.params as Record<string, unknown>;
  const knowledgeContextRefs = getImageTaskKnowledgeContextRefs(task);
  const routeModel = resolveTaskInvocationRouteModel(task);
  const modelRef = typeof routeModel === 'string' ? null : routeModel;
  const model =
    modelRef?.modelId ||
    (typeof routeModel === 'string' ? routeModel : readString(params.model));
  const generationParams = getImageTaskGenerationParams(task);

  return {
    prefillId: `${task.id}-${Date.now()}`,
    initialPrompt: readString(params.prompt) || '',
    initialWidth: readFiniteNumber(params.width),
    initialHeight: readFiniteNumber(params.height),
    initialResultUrl: readString(task.result?.url),
    initialAspectRatio: generationParams.size || readString(params.aspectRatio),
    initialParams: generationParams,
    initialImages: getImageTaskReferenceImages(task),
    ...(model ? { initialModel: model } : {}),
    initialModelRef: modelRef,
    ...(knowledgeContextRefs.length > 0
      ? { initialKnowledgeContextRefs: knowledgeContextRefs }
      : {}),
  };
}

export function buildImageTaskAIInputPrefillData(
  task: Task
): AIInputPrefillEventDetail {
  const params = task.params as Record<string, unknown>;
  const routeModel = resolveTaskInvocationRouteModel(task);
  const modelRef = typeof routeModel === 'string' ? null : routeModel;
  const model =
    modelRef?.modelId ||
    (typeof routeModel === 'string' ? routeModel : readString(params.model));
  const count = readPositiveInteger(params.batchTotal);
  const knowledgeContextRefs = getImageTaskKnowledgeContextRefs(task);

  return {
    generationType: 'image',
    prompt: readString(params.prompt) || '',
    images: getImageTaskReferenceImages(task),
    ...(model ? { model } : {}),
    modelRef: modelRef || readModelRef(params.modelRef),
    ...(knowledgeContextRefs.length > 0 ? { knowledgeContextRefs } : {}),
    params: getImageTaskGenerationParams(task),
    ...(count ? { count } : {}),
  };
}
