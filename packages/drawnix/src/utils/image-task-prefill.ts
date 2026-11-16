import type { KnowledgeContextRef, Task } from '../types/task.types';
import type { ModelRef } from './settings-manager';
import type { AIInputPrefillEventDetail } from '../services/ai-input-ui-events';
import { resolveTaskInvocationRouteModel } from '../services/task-invocation-route';
import { SEEDREAM_55_MODEL_ID } from '../constants/model-config';

export interface ImageGenerationReferenceImage {
  url: string;
  name: string;
  maskImage?: string;
  sourceElementId?: string;
}

export interface ImageGenerationInitialData {
  prefillId: string;
  initialPrompt: string;
  initialWidth?: number;
  initialHeight?: number;
  initialResultUrl?: string;
  initialAspectRatio?: string;
  initialImages: ImageGenerationReferenceImage[];
  initialKnowledgeContextRefs?: KnowledgeContextRef[];
  initialModel?: string;
  initialModelRef?: ModelRef | null;
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
    if (
      /api.?key|authorization|password|secret|access.?token|base.?url/i.test(
        key
      )
    ) {
      return acc;
    }
    if (
      (typeof item === 'string' && item.trim()) ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    ) {
      acc[key] = String(item);
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
    ...(readString(record.maskImage)
      ? { maskImage: readString(record.maskImage) }
      : {}),
    ...(readString(record.sourceElementId)
      ? { sourceElementId: readString(record.sourceElementId) }
      : {}),
  };
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
  // These are alternate representations of the same inputs, not extra attachments.
  // Preserve order and repeated pixels: distinct canvas sources may share a URL.
  const values =
    Array.isArray(params.referenceImages) && params.referenceImages.length
      ? params.referenceImages
      : Array.isArray(params.uploadedImages) && params.uploadedImages.length
      ? params.uploadedImages
      : [params.uploadedImage || params.inputReference].filter(Boolean);
  const images = values
    .map((value, index) => normalizeReferenceImage(value, index, '参考图'))
    .filter((image): image is ImageGenerationReferenceImage => image !== null);
  if (images.length !== values.length)
    throw new Error('历史参考图记录不完整，请重新添加缺失的参考图');

  const maskImage =
    readString(params.maskImage) || readString(params.mask_image);
  if (maskImage && images.length === 1) {
    images[0] = {
      ...images[0],
      maskImage,
    };
  }

  return images;
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

  return {
    prefillId: `${task.id}-${Date.now()}`,
    initialPrompt: readString(params.prompt) || '',
    initialWidth: readFiniteNumber(params.width),
    initialHeight: readFiniteNumber(params.height),
    initialResultUrl: readString(task.result?.url),
    initialAspectRatio: readString(params.aspectRatio),
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
  const nestedParams = readStringParams(params.params);
  const size =
    readString(params.size) ||
    readString(params.aspectRatio) ||
    (readFiniteNumber(params.width) && readFiniteNumber(params.height)
      ? `${params.width}x${params.height}`
      : undefined);
  const routeModel = resolveTaskInvocationRouteModel(task);
  const modelRef = typeof routeModel === 'string' ? null : routeModel;
  const model =
    modelRef?.modelId ||
    (typeof routeModel === 'string' ? routeModel : readString(params.model));
  const restoredSize = size?.replace(':', 'x').toLowerCase() || nestedParams.size;
  // Saved tiers are lowercased by task serialization; the UI uses uppercase K.
  const prefillSize =
    model === SEEDREAM_55_MODEL_ID &&
    restoredSize &&
    /^(1|1\.5|2)k$/i.test(restoredSize)
      ? restoredSize.toUpperCase()
      : restoredSize;
  const count = readPositiveInteger(params.batchTotal);
  const knowledgeContextRefs = getImageTaskKnowledgeContextRefs(task);
  const inputParams = readStringParams(
    Object.fromEntries(
      [
        'width',
        'height',
        'quality',
        'resolution',
        'generationMode',
        'inputFidelity',
        'background',
        'outputFormat',
        'outputCompression',
        'seed',
      ].map((key) => [key, params[key]])
    )
  );
  for (const [field, parameter] of [
    ['inputFidelity', 'input_fidelity'],
    ['outputFormat', 'output_format'],
    ['outputCompression', 'output_compression'],
  ]) {
    if (inputParams[field] !== undefined) {
      inputParams[parameter] = inputParams[field];
      delete inputParams[field];
    }
  }
  const images = getImageTaskReferenceImages(task);
  if (
    !images.length &&
    (params.generationMode === 'image_edit' ||
      params.generationMode === 'image_to_image' ||
      params.maskImage ||
      (Array.isArray(params.canvasAssociations) &&
        params.canvasAssociations.some(
          (ref: { kind?: string }) => ref?.kind === 'image'
        )))
  ) {
    throw new Error(
      '原任务的参考图已缺失，无法恢复；请重新添加原参考图，或使用“以此图修改”'
    );
  }

  return {
    intent: 'restore',
    sourceTaskId: task.id,
    generationType: 'image',
    prompt: readString(params.prompt) || '',
    images,
    ...(model ? { model } : {}),
    modelRef: modelRef || readModelRef(params.modelRef),
    ...(knowledgeContextRefs.length > 0 ? { knowledgeContextRefs } : {}),
    params: {
      ...nestedParams,
      ...inputParams,
      sourceTaskId: task.id,
      ...(prefillSize ? { size: prefillSize } : {}),
    },
    ...(count ? { count } : {}),
  };
}

/** Continue editing is distinct from regenerating the original inputs. */
export function buildSeedream55ContinuePrefillData(
  task: Task,
  selected: { url: string; id: string }
): AIInputPrefillEventDetail {
  const prefill = buildImageTaskAIInputPrefillData(task);
  if (prefill.model?.toLowerCase() !== 'doubao-seedream-5-5-261028') {
    throw new Error('继续编辑入口仅适用于 Seedream 5.5 历史任务');
  }
  if (!selected.url.trim()) throw new Error('所选图片没有可用地址');
  const url = normalizeImageTaskDataUrl(selected.url);
  const images = [
    { url, name: '上一轮结果', sourceElementId: selected.id },
    ...getImageTaskReferenceImages(task)
      .filter((image) => image.url !== url)
      .map(({ url, name }) => ({ url, name })),
  ];
  // Keep overflow visible in the composer; the adapter blocks >10 references
  // before any request, so users can choose which historical reference to remove.
  const params = { ...prefill.params };
  for (const key of [
    'maskImage',
    'mask_image',
    'layer_decomposition',
    'layer_decomposition_options',
  ])
    delete params[key];
  return {
    ...prefill,
    prompt: '',
    images,
    params,
    count: 1,
    source: 'canvas-toolbar',
    requireExactModelRef: true,
  };
}

/** A result-level reroll produces one new sample, even if its source was a batch. */
export function buildImageRerollPrefillData(
  input: AIInputPrefillEventDetail
): AIInputPrefillEventDetail {
  const params = { ...input.params };
  for (const key of Object.keys(params)) {
    if (
      /(^|_)seed$/i.test(key) ||
      ['n', 'count', 'batch_size', 'batchTotal'].includes(key)
    ) {
      delete params[key];
    }
  }
  return { ...input, intent: 'restore', count: 1, params };
}
