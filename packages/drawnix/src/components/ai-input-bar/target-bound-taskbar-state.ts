import { LS_KEYS } from '../../constants/storage-keys';

export const BOUND_TARGET_DISMISS_HINT_LIMIT = 5;

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface BoundTargetGenerationMetadata {
  elementId: string;
  prompt: string;
  generationTaskId?: string;
  generationAnchorId?: string;
}

function getBrowserStorage(): WritableStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readBoundTargetDismissHintCount(
  storage: ReadableStorage | null = getBrowserStorage()
): number {
  if (!storage) return 0;
  try {
    const count = Number.parseInt(
      storage.getItem(LS_KEYS.AI_BOUND_TARGET_DISMISS_HINT_COUNT) || '0',
      10
    );
    if (!Number.isFinite(count)) return 0;
    return Math.min(
      BOUND_TARGET_DISMISS_HINT_LIMIT,
      Math.max(0, Math.trunc(count))
    );
  } catch {
    return 0;
  }
}

export function recordBoundTargetDismiss(
  currentCount: number,
  storage: WritableStorage | null = getBrowserStorage()
): number {
  const nextCount = Math.min(
    BOUND_TARGET_DISMISS_HINT_LIMIT,
    Math.max(currentCount, readBoundTargetDismissHintCount(storage)) + 1
  );
  try {
    storage?.setItem(
      LS_KEYS.AI_BOUND_TARGET_DISMISS_HINT_COUNT,
      String(nextCount)
    );
  } catch {
    // localStorage 被禁用时，调用方仍保留当前页面内的计数。
  }
  return nextCount;
}

export function resolveBoundTargetSuppression(
  targetElementId: string | null,
  suppressedElementId: string | null
): {
  suppressTarget: boolean;
  nextSuppressedElementId: string | null;
} {
  if (!targetElementId) {
    return { suppressTarget: false, nextSuppressedElementId: null };
  }
  if (targetElementId === suppressedElementId) {
    return {
      suppressTarget: true,
      nextSuppressedElementId: suppressedElementId,
    };
  }
  return { suppressTarget: false, nextSuppressedElementId: null };
}

export function buildBoundTargetGenerationParams(
  target: BoundTargetGenerationMetadata | null
): Record<string, string | undefined> | null {
  if (!target) return null;
  return {
    generationMode: 'image_to_image',
    replaceElementId: target.elementId,
    targetElementId: target.elementId,
    anchorId: target.generationAnchorId,
    sourceTaskId: target.generationTaskId,
    sourcePrompt: target.prompt,
  };
}
