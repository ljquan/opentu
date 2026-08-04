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

export interface BoundTargetPromptReuseInput {
  key: string;
  currentPrompt: string;
  suggestion: string | null;
  isComposing?: boolean;
  hasModifier?: boolean;
  menuOpen?: boolean;
}

export function normalizeBoundTargetPromptSuggestion(
  prompt: string | null | undefined
): string | null {
  const normalizedPrompt = prompt?.trim() || '';
  return normalizedPrompt ? normalizedPrompt : null;
}

export function resolveBoundTargetPromptSuggestion(
  prompt: string | null | undefined,
  elementId: string,
  dismissedElementId: string | null
): string | null {
  if (elementId === dismissedElementId) return null;
  return normalizeBoundTargetPromptSuggestion(prompt);
}

export function shouldReuseBoundTargetPrompt({
  key,
  currentPrompt,
  suggestion,
  isComposing = false,
  hasModifier = false,
  menuOpen = false,
}: BoundTargetPromptReuseInput): boolean {
  if (!suggestion || currentPrompt.length > 0 || isComposing || hasModifier) {
    return false;
  }
  if (menuOpen) return false;
  return key === ' ' || key === 'Spacebar' || key === 'Enter';
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
  target: BoundTargetGenerationMetadata | null,
  count = 1
): Record<string, string | undefined> | null {
  if (!target || count > 1) return null;
  return {
    generationMode: 'image_to_image',
    replaceElementId: target.elementId,
    targetElementId: target.elementId,
    anchorId: target.generationAnchorId,
    sourceTaskId: target.generationTaskId,
    sourcePrompt: target.prompt,
  };
}
