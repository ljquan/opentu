import { isGPTImage26ModelId } from '../constants/model-config';
import type { Task } from '../types/task.types';

// Preserve the generated-result policy when the shared service supports it.
export const GPT_IMAGE_26_COLUMN_INSERTION_OPTIONS = {
  imageLayout: 'task-columns' as const,
  imageInsertionPolicy: 'generated-result' as const,
};

/** Reserve a full pair before the channel's output count is known. */
export function reservesGPTImage26ResultColumns(
  modelId?: string,
  output?: unknown
): boolean {
  return isGPTImage26ModelId(modelId) && output !== 'svg';
}

/** A single channel request may return an animation and its source sheet. */
export function usesGPTImage26ResultColumns(
  task: Pick<Task, 'params' | 'result'>
): boolean {
  return (
    isGPTImage26ModelId(task.params.modelRef?.modelId || task.params.model) &&
    (task.result?.urls?.filter(Boolean).length ?? 0) > 1
  );
}

/** Order positions, keeping the original result array and cache mapping intact. */
export function getGPTImage26ResultColumnOrder(
  task: Pick<Task, 'params' | 'result'>,
  url: string
): number | undefined {
  if (!usesGPTImage26ResultColumns(task)) return undefined;
  return /^data:image\/gif[;,]/i.test(url) ||
    /\.gif(?:[?#]|$)/i.test(url) ||
    (url === task.result?.url && task.result?.format === 'gif')
    ? 0
    : 1;
}
