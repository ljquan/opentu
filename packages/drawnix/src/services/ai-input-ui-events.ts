import type { GenerationType } from '../utils/ai-input-parser';
import type { ModelRef } from '../utils/settings-manager';
import type { KnowledgeContextRef } from '../types/task.types';

export interface AIInputFocusEventDetail {
  generationType?: GenerationType;
  skillId?: string;
  pptExplainerSource?: 'topic' | 'current_ppt';
  pptExplainerFrameIds?: string[];
  openPptExplainer?: boolean;
}

export interface AIInputPrefillImage {
  url: string;
  name: string;
  sourceElementId?: string;
  /** Version of the source on the canvas when the snapshot was recorded. */
  sourceElementUrl?: string;
  width?: number;
  height?: number;
  maskImage?: string;
}

export type AIInputPrefillSource = 'canvas-toolbar' | 'task-queue' | 'dialog';

export interface AIInputPrefillEventDetail {
  /** Restoring original inputs must not inherit the currently selected output. */
  intent?: 'restore' | 'edit';
  sourceTaskId?: string;
  boardId?: string;
  generationType: GenerationType;
  prompt: string;
  images?: AIInputPrefillImage[];
  model?: string;
  modelRef?: ModelRef | null;
  params?: Record<string, string>;
  count?: number;
  knowledgeContextRefs?: KnowledgeContextRef[];
  source?: AIInputPrefillSource;
}

export const AI_INPUT_FOCUS_EVENT = 'aitu:ai-input-focus';
export const AI_INPUT_PREFILL_EVENT = 'aitu:ai-input-prefill';
export const AI_INPUT_REROLL_EVENT = 'aitu:ai-input-reroll';

export function resolvePptExplainerFrameIds(
  orderedFrameIds: readonly string[],
  selectedFrameIds: ReadonlySet<string>
): string[] | undefined {
  const selected = orderedFrameIds.filter((frameId) =>
    selectedFrameIds.has(frameId)
  );
  return selected.length > 0 ? selected : undefined;
}

export function updatePptExplainerFrameSelection(
  selectedFrameIds: ReadonlySet<string>,
  frameId: string,
  checked: boolean
): Set<string> {
  const next = new Set(selectedFrameIds);
  if (checked) {
    next.add(frameId);
  } else {
    next.delete(frameId);
  }
  return next;
}

export function requestAIInputFocus(
  detail: AIInputFocusEventDetail = {}
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AI_INPUT_FOCUS_EVENT, { detail }));
}

export function requestAIInputPrefill(detail: AIInputPrefillEventDetail): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AI_INPUT_PREFILL_EVENT, { detail }));
}

export function requestAIInputReroll(detail: AIInputPrefillEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AI_INPUT_REROLL_EVENT, { detail }));
}


export const CANVAS_IMAGE_EDIT_EVENT = 'aitu:canvas-image-edit';
export interface CanvasImageEditDetail {
  elementId: string;
  boardId?: string;
}
export function requestCanvasImageEdit(detail: CanvasImageEditDetail): void {
  window.dispatchEvent(new CustomEvent(CANVAS_IMAGE_EDIT_EVENT, { detail }));
}
