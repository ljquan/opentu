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

export type BoundGenerationTargetType = 'image' | 'video' | 'text' | 'audio';

export function readBoundTargetGenerationPrompt(
  element: unknown,
  targetType: BoundGenerationTargetType
): string {
  const record = element as Record<string, unknown> | null;
  const promptKeys =
    targetType === 'image' || targetType === 'audio'
      ? ['generationPrompt', 'aiPrompt', 'prompt']
      : ['generationPrompt', 'aiPrompt'];
  for (const key of promptKeys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

export function shouldBindGenerationTarget(
  targetType: BoundGenerationTargetType,
  prompt: string
): boolean {
  return targetType === 'image' || Boolean(prompt.trim());
}

export type BoundTargetPromptSuggestionAction = 'reuse' | 'dismiss' | 'none';

export interface BoundTargetPromptSuggestionInput {
  suggestion: string | null;
  currentPrompt: string;
  key: string;
  code?: string;
  isComposing?: boolean;
  hasModifier?: boolean;
  menuOpen?: boolean;
}

export function normalizeBoundTargetPromptSuggestion(
  prompt: string | null | undefined
): string | null {
  const normalizedPrompt = prompt?.trim() || '';
  return normalizedPrompt || null;
}

export function resolveBoundTargetPromptSuggestion(
  prompt: string | null | undefined,
  elementId: string,
  dismissedElementId: string | null
): string | null {
  if (elementId === dismissedElementId) return null;
  return normalizeBoundTargetPromptSuggestion(prompt);
}

export function shouldReleaseBoundTargetPromptDismissal(
  targetElementId: string,
  completedTaskId: string,
  dismissedElementId: string | null,
  dismissedGenerationTaskId: string | null
): boolean {
  return (
    targetElementId === dismissedElementId &&
    completedTaskId !== dismissedGenerationTaskId
  );
}

export function resolveBoundTargetPromptSuggestionAction({
  suggestion,
  currentPrompt,
  key,
  code,
  isComposing = false,
  hasModifier = false,
  menuOpen = false,
}: BoundTargetPromptSuggestionInput): BoundTargetPromptSuggestionAction {
  if (!suggestion || isComposing || menuOpen) return 'none';

  if (
    currentPrompt.length === 0 &&
    !hasModifier &&
    (key === 'Enter' || key === ' ' || key === 'Spacebar' || code === 'Space')
  ) {
    return 'reuse';
  }

  return 'dismiss';
}

export function formatBoundTargetPromptSuggestion(
  suggestion: string,
  language: 'zh' | 'en'
): string {
  return language === 'zh'
    ? `按空格或回车复用提示词：${suggestion}`
    : `Press Space or Enter to reuse: ${suggestion}`;
}

export type BoundImageTargetMode = 'follow' | 'reference';

/**
 * 图片、视频和文本目标支持在任务栏上切换是否跟随目标位置。
 * 音频暂时保持原有的目标定位行为。
 */
export function supportsBoundTargetFollowControls(
  targetType: BoundGenerationTargetType
): boolean {
  return (
    targetType === 'image' || targetType === 'video' || targetType === 'text'
  );
}

export function createBoundImageTargetStateKey(
  target: {
    elementId: string;
    type?: BoundGenerationTargetType;
    url: string;
    prompt: string;
    generationTaskId?: string;
    generationAnchorId?: string;
    referenceOnly: boolean;
  },
  mode: BoundImageTargetMode
): string {
  return JSON.stringify([
    target.elementId,
    target.type || 'image',
    target.url,
    target.prompt,
    target.generationTaskId || '',
    target.generationAnchorId || '',
    target.referenceOnly,
    mode,
  ]);
}

export function pinBoundTargetReferenceContent<
  T extends { type?: string; url?: string; text?: string }
>(content: T[], target: T | null, mode: BoundImageTargetMode): T[] {
  if (mode !== 'reference' || !target) return content;

  const matchesTarget = target.url
    ? (item: T) => item.url === target.url
    : target.text
    ? (item: T) => item.type === target.type && item.text === target.text
    : (item: T) => item === target;
  return [target, ...content.filter((item) => !matchesTarget(item))];
}

export function isBoundTargetReferenceOnly(element: unknown): boolean {
  const record = element as Record<string, unknown> | null;
  return record?.aiTaskbarReferenceOnly === true;
}

export function findBoundTargetElement(
  elements: readonly unknown[],
  elementId: string
): Record<string, unknown> | null {
  const pending = [...elements];

  while (pending.length > 0) {
    const element = pending.pop();
    if (!element || typeof element !== 'object') continue;

    const record = element as Record<string, unknown>;
    if (record.id === elementId) return record;
    if (Array.isArray(record.children)) {
      pending.push(...record.children);
    }
  }

  return null;
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

export function readBoundTargetFollowEnabled(
  storage: ReadableStorage | null = getBrowserStorage()
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(LS_KEYS.AI_BOUND_TARGET_FOLLOW_ENABLED) !== 'false';
  } catch {
    return true;
  }
}

export function persistBoundTargetFollowEnabled(
  enabled: boolean,
  storage: WritableStorage | null = getBrowserStorage()
): boolean {
  try {
    storage?.setItem(LS_KEYS.AI_BOUND_TARGET_FOLLOW_ENABLED, String(enabled));
  } catch {
    // localStorage 被禁用时，调用方仍保留当前页面内的偏好。
  }
  return enabled;
}

export function resolveBoundTargetForPosition<
  T extends { type?: BoundGenerationTargetType }
>(target: T | null, followEnabled: boolean): T | null {
  if (
    !followEnabled &&
    (!target?.type || supportsBoundTargetFollowControls(target.type))
  ) {
    return null;
  }
  return target;
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
  generationType: string,
  mode: BoundImageTargetMode = 'follow'
): boolean {
  return (
    mode === 'follow' &&
    ['image', 'video', 'audio', 'text'].includes(generationType)
  );
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
