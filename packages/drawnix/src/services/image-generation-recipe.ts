import { TaskType, type Task } from '../types/task.types';
import type { AIInputPrefillEventDetail } from './ai-input-ui-events';
import { buildImageTaskAIInputPrefillData } from '../utils/image-task-prefill';
import { imageKey } from './canvas-operations/image-generation-references';

/** Stored with the result so canvas copies/backups do not depend on task retention. */
export interface ImageGenerationRecipe {
  version: 1;
  id: string;
  input: AIInputPrefillEventDetail;
}

const preparedRecipes = new WeakMap<Task, ImageGenerationRecipe>();

export function getPreparedImageRecipe(
  task: Task
): ImageGenerationRecipe | undefined {
  return preparedRecipes.get(task);
}

export function copyPreparedImageRecipe(source: Task, target: Task): void {
  const recipe = preparedRecipes.get(source);
  if (recipe) preparedRecipes.set(target, recipe);
}

export function readImageGenerationRecipe(
  element: unknown
): AIInputPrefillEventDetail | null {
  const recipe = (
    element as { imageGenerationRecipe?: ImageGenerationRecipe } | null
  )?.imageGenerationRecipe;
  if (!recipe) return null;
  if (
    recipe.version !== 1 ||
    recipe.input?.generationType !== 'image' ||
    typeof recipe.input.prompt !== 'string' ||
    !Array.isArray(recipe.input.images) ||
    recipe.input.images.some(
      (image) => typeof image?.url !== 'string' || !image.url
    )
  ) {
    throw new Error('该图片的生成记录无法读取，请从历史任务恢复输入');
  }
  return structuredClone(recipe.input);
}

export async function prepareImageGenerationRecipe(
  task: Task,
  completeTask: Task = task,
  sources: readonly {
    id: string;
    url?: unknown;
    generationReferenceKey?: unknown;
  }[] = []
): Promise<void> {
  if (task.type !== TaskType.IMAGE || preparedRecipes.has(task)) return;
  const input = buildImageTaskAIInputPrefillData(completeTask);
  const { cacheRemoteUrl } = await import('./media-executor/fallback-utils');
  const { unifiedCacheService } = await import('./unified-cache-service');
  const cacheImage = async (url: string, suffix: string) => {
    const cached = await cacheRemoteUrl(
      url,
      `recipe-${task.id}-${suffix}`,
      'image',
      'png',
      undefined,
      { forceRemoteCache: true, returnLocalCacheUrl: true }
    );
    if (
      !cached.startsWith('/__aitu_cache__/') &&
      !cached.startsWith('/asset-library/')
    ) {
      throw new Error('原参考图未能保存，生成记录暂时不可用');
    }
    const blob = await unifiedCacheService.getCachedBlob(cached, {
      allowNetwork: false,
    });
    if (!blob?.size) throw new Error('原参考图缓存缺失，无法保存完整生成记录');
    return cached;
  };
  const images = [];
  const usedSourceIds = new Set<string>();
  for (const [index, image] of (input.images || []).entries()) {
    const source = sources.find(
      (element) =>
        !usedSourceIds.has(element.id) &&
        (!image.sourceElementId || image.sourceElementId === element.id) &&
        completeTask.params.canvasAssociations?.some(
          (reference) => reference.elementId === element.id
        ) &&
        (element.url === image.url ||
          element.generationReferenceKey === imageKey(image.url))
    );
    if (source) usedSourceIds.add(source.id);
    images.push({
      ...image,
      sourceElementId: undefined,
      url: await cacheImage(image.url, String(index)),
      ...(source &&
      typeof source.url === 'string' &&
      !/^(data:|blob:)/.test(source.url)
        ? { sourceElementId: source.id, sourceElementUrl: source.url }
        : {}),
      ...(image.maskImage
        ? { maskImage: await cacheImage(image.maskImage, `${index}-mask`) }
        : {}),
    });
  }
  preparedRecipes.set(task, {
    version: 1,
    id: task.id,
    input: { ...input, images },
  });
}

export async function validateRestoredImageReferences(
  images: readonly { url?: string; maskImage?: string }[]
): Promise<void> {
  const { loadImageElementForCanvas } = await import('../data/image');
  for (const [index, image] of images.entries()) {
    try {
      if (!image.url) throw new Error('missing reference');
      await loadImageElementForCanvas(
        image.url as Parameters<typeof loadImageElementForCanvas>[0]
      );
      if (image.maskImage)
        await loadImageElementForCanvas(
          image.maskImage as Parameters<typeof loadImageElementForCanvas>[0]
        );
    } catch {
      throw new Error(
        `原参考图 ${index + 1} 或其蒙版不可用，请在“调整后生成”中替换或移除`
      );
    }
  }
}

/** Original bytes remain authoritative even if the live source was replaced or copied. */
export function resolveRecipeCanvasSources(
  input: AIInputPrefillEventDetail,
  elements: readonly { id: string; url?: unknown }[]
): AIInputPrefillEventDetail {
  return {
    ...input,
    images: input.images?.map((image) => {
      const source = elements.find(
        (element) =>
          element.id === image.sourceElementId &&
          element.url === (image.sourceElementUrl || image.url)
      );
      return { ...image, sourceElementId: source?.id };
    }),
  };
}
