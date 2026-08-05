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

export interface BoundTargetTaskbarDraft<
  TUploadedContent = unknown,
  TKnowledgeContext = unknown
> {
  prompt: string;
  uploadedContent: TUploadedContent[];
  knowledgeContextRefs: TKnowledgeContext[];
}

export interface BoundTargetTaskbarDraftEntry<TDraft> {
  draft: TDraft;
  baseline: TDraft;
}

function areShallowArraysEqual<T>(left: T[], right: T[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function cloneBoundTargetTaskbarDraft<TDraft extends BoundTargetTaskbarDraft>(
  draft: TDraft
): TDraft {
  return {
    ...draft,
    uploadedContent: [...draft.uploadedContent],
    knowledgeContextRefs: [...draft.knowledgeContextRefs],
  };
}

export function areBoundTargetTaskbarDraftsEqual<TUploaded, TKnowledge>(
  left: BoundTargetTaskbarDraft<TUploaded, TKnowledge>,
  right: BoundTargetTaskbarDraft<TUploaded, TKnowledge>
): boolean {
  return (
    left.prompt === right.prompt &&
    areShallowArraysEqual(left.uploadedContent, right.uploadedContent) &&
    areShallowArraysEqual(left.knowledgeContextRefs, right.knowledgeContextRefs)
  );
}

export function storeBoundTargetTaskbarDraft<
  TDraft extends BoundTargetTaskbarDraft
>(
  drafts: Map<string, BoundTargetTaskbarDraftEntry<TDraft>>,
  elementId: string,
  draft: TDraft,
  baseline: TDraft
): void {
  if (areBoundTargetTaskbarDraftsEqual(draft, baseline)) {
    drafts.delete(elementId);
    return;
  }
  drafts.set(elementId, {
    draft: cloneBoundTargetTaskbarDraft(draft),
    baseline: cloneBoundTargetTaskbarDraft(baseline),
  });
}

export function pruneStaleBoundTargetTaskbarDrafts<TDraft>(
  drafts: Map<string, TDraft>,
  existingElementIds: ReadonlySet<string>
): void {
  for (const elementId of drafts.keys()) {
    if (!existingElementIds.has(elementId)) {
      drafts.delete(elementId);
    }
  }
}

export function collectBoundTargetElementIds(
  elements: readonly unknown[]
): Set<string> {
  const elementIds = new Set<string>();
  const pending = [...elements];

  while (pending.length > 0) {
    const element = pending.pop();
    if (!element || typeof element !== 'object') continue;

    const record = element as { id?: unknown; children?: unknown };
    if (typeof record.id === 'string' && record.id) {
      elementIds.add(record.id);
    }
    if (Array.isArray(record.children)) {
      pending.push(...record.children);
    }
  }

  return elementIds;
}

export function resolveBoundTargetTaskbarDraft<
  TDraft extends BoundTargetTaskbarDraft
>(
  drafts: ReadonlyMap<string, BoundTargetTaskbarDraftEntry<TDraft>>,
  elementId: string,
  fallback: TDraft
): BoundTargetTaskbarDraftEntry<TDraft> {
  const stored = drafts.get(elementId);
  if (!stored) {
    return {
      draft: cloneBoundTargetTaskbarDraft(fallback),
      baseline: cloneBoundTargetTaskbarDraft(fallback),
    };
  }
  const baseline = {
    ...stored.baseline,
    prompt: fallback.prompt,
  };
  const draft = {
    ...stored.draft,
    prompt:
      stored.draft.prompt === stored.baseline.prompt
        ? fallback.prompt
        : stored.draft.prompt,
  };
  return {
    draft: cloneBoundTargetTaskbarDraft(draft),
    baseline: cloneBoundTargetTaskbarDraft(baseline),
  };
}

export function resolveTaskbarDraftAfterSubmission<
  TDraft extends BoundTargetTaskbarDraft
>(
  currentDraft: TDraft,
  submittedDraft: TDraft,
  clearedDraft: TDraft,
  clearSubmittedInput: boolean
): BoundTargetTaskbarDraftEntry<TDraft> & { hasNewerInput: boolean } {
  const hasNewerInput = !areBoundTargetTaskbarDraftsEqual(
    currentDraft,
    submittedDraft
  );
  return {
    draft: cloneBoundTargetTaskbarDraft(
      clearSubmittedInput && !hasNewerInput ? clearedDraft : currentDraft
    ),
    baseline: cloneBoundTargetTaskbarDraft(
      clearSubmittedInput && !hasNewerInput ? clearedDraft : submittedDraft
    ),
    hasNewerInput,
  };
}

export function shouldUseBoundTargetForSubmission(
  generationType: string
): boolean {
  return generationType === 'image';
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
