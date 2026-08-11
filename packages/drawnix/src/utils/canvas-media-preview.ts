import { Transforms, type PlaitBoard } from '@plait/core';
import type { MediaItem } from '../components/shared/media-preview/types';
import type { CanvasInsertionResultData } from '../services/canvas-operations';
import type { MCPResult } from '../mcp/types';
import type { Task } from '../types/task.types';
import { getImageTaskResultDimensions } from './task-utils';
import { isAssetLibraryUrl } from './virtual-media-url';

export interface CanvasPreviewMediaItem extends MediaItem {
  generationTaskId?: string;
}

export interface CanvasMediaTaskLookup {
  getTask(taskId: string): Task | undefined;
  getCompleteTask(taskId: string): Promise<Task | undefined>;
  findImageTaskByResultUrl(imageUrl: string): Promise<Task | undefined>;
}

export interface CanvasMediaDimensions {
  width: number;
  height: number;
}

export interface CanvasMediaDimensionResolveOptions {
  allowUrlFallback?: boolean;
}

async function resolveCanvasMediaItemDimensions(
  item: CanvasPreviewMediaItem,
  lookup: CanvasMediaTaskLookup,
  options: CanvasMediaDimensionResolveOptions
): Promise<CanvasMediaDimensions | null> {
  if (item.type !== 'image') return null;

  const taskId = item.generationTaskId?.trim();
  if (taskId) {
    try {
      const memoryTask = lookup.getTask(taskId);
      if (memoryTask) {
        const dimensions = getImageTaskResultDimensions(memoryTask);
        if (dimensions) return dimensions;
      }
    } catch {
      // Fall through to persisted task lookup.
    }

    try {
      const storedTask = await lookup.getCompleteTask(taskId);
      if (storedTask) {
        return getImageTaskResultDimensions(storedTask);
      }
    } catch {
      // Fall through to the URL lookup for legacy canvas elements.
    }
  }

  if (
    options.allowUrlFallback !== true ||
    !item.url ||
    isAssetLibraryUrl(item.url)
  ) {
    return null;
  }

  try {
    const task = await lookup.findImageTaskByResultUrl(item.url);
    return task ? getImageTaskResultDimensions(task) : null;
  } catch {
    return null;
  }
}

export function createCanvasMediaDimensionResolver(
  lookup: CanvasMediaTaskLookup
): (
  item: CanvasPreviewMediaItem,
  options?: CanvasMediaDimensionResolveOptions
) => Promise<CanvasMediaDimensions | null> {
  const pendingBySource = new Map<
    string,
    Promise<CanvasMediaDimensions | null>
  >();

  return (item, options = {}) => {
    if (item.type !== 'image') return Promise.resolve(null);

    const taskId = item.generationTaskId?.trim();
    const sourceKey = `${taskId ? `task:${taskId}` : 'url'}:${
      item.url
    }:fallback:${options.allowUrlFallback === true ? 'yes' : 'no'}`;
    const pending = pendingBySource.get(sourceKey);
    if (pending) return pending;

    const resolution = resolveCanvasMediaItemDimensions(item, lookup, options);
    pendingBySource.set(sourceKey, resolution);
    return resolution;
  };
}

export function bindImageTaskToCanvasInsertion(
  board: PlaitBoard,
  insertionResult: MCPResult,
  taskId: string
): number {
  const normalizedTaskId = taskId.trim();
  if (!insertionResult.success || !normalizedTaskId) return 0;

  const data = insertionResult.data as CanvasInsertionResultData | undefined;
  if (!Array.isArray(data?.items)) return 0;

  const boundElementIds = new Set<string>();
  for (const item of data.items) {
    const elementId =
      item.type === 'image' ? item.elementId?.trim() : undefined;
    if (!elementId || boundElementIds.has(elementId)) continue;

    const elementIndex = board.children.findIndex(
      (element: { id?: string }) => element.id === elementId
    );
    if (elementIndex < 0) continue;

    Transforms.setNode(
      board,
      { generationTaskId: normalizedTaskId } as Partial<
        PlaitBoard['children'][number]
      >,
      [elementIndex]
    );
    boundElementIds.add(elementId);
  }

  return boundElementIds.size;
}
