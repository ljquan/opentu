import { LS_KEYS } from '../../constants/storage-keys';
import type { CanvasAssociationRef } from '../../types/shared/core.types';

export type {
  CanvasAssociationKind,
  CanvasAssociationRef,
} from '../../types/shared/core.types';

export const CANVAS_ASSOCIATION_REFERENCE_LIMIT = 20;
export const CANVAS_ASSOCIATION_LABEL_LIMIT = 64;

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export interface CanvasAssociationTrigger {
  start: number;
  end: number;
}

export interface CanvasAssociationTriggerRemoval {
  prompt: string;
  cursorPosition: number;
  removed: boolean;
}

export interface CanvasAssociationMentionInsertion {
  prompt: string;
  cursorPosition: number;
  reference: CanvasAssociationRef;
  inserted: boolean;
}

export interface CanvasAssociationPromptEdit {
  /** Range in the prompt before the textarea edit. */
  start: number;
  end: number;
}

export interface CanvasAssociationBeforeInputSnapshot {
  selectionStart: number;
  selectionEnd: number;
  inputType: string;
}

export interface CanvasAssociationInputEventSnapshot {
  selectionStart: number | null;
  selectionEnd: number | null;
  inputType: string | null | undefined;
  data: string | null | undefined;
}

export interface CanvasAssociationMentionDeletion {
  prompt: string;
  cursorPosition: number;
  references: CanvasAssociationRef[];
  removedReferenceId: string;
}

export interface CanvasAssociationHighlightSegment {
  text: string;
  referenceId?: string;
}

export interface CanvasAssociationRefAppendResult {
  references: CanvasAssociationRef[];
  added: boolean;
  duplicate: boolean;
  limitReached: boolean;
}

export type CanvasAssociationTaskLinkTiming = 'none' | 'immediate' | 'deferred';

export interface CanvasAssociationTaskLinkTimingInput {
  submissionAccepted: boolean;
  associationCount: number;
  hasTaskTarget: boolean;
  submittedBoardIsCurrent: boolean;
}

function getBrowserStorage(): (ReadableStorage & WritableStorage) | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCanvasAssociationEnabled(
  storage: ReadableStorage | null = getBrowserStorage()
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(LS_KEYS.AI_CANVAS_ASSOCIATION_ENABLED) === 'true';
  } catch {
    return false;
  }
}

export function persistCanvasAssociationEnabled(
  enabled: boolean,
  storage: WritableStorage | null = getBrowserStorage()
): boolean {
  try {
    storage?.setItem(LS_KEYS.AI_CANVAS_ASSOCIATION_ENABLED, String(enabled));
  } catch {
    // Keep the current page state when localStorage is unavailable.
  }
  return enabled;
}

export function findCanvasAssociationTrigger(
  prompt: string,
  cursorPosition: number,
  isComposing = false
): CanvasAssociationTrigger | null {
  // 是否为新输入由输入事件层判定；提示词两侧允许任意正文字符。
  if (
    isComposing ||
    !Number.isInteger(cursorPosition) ||
    cursorPosition < 1 ||
    cursorPosition > prompt.length ||
    prompt[cursorPosition - 1] !== '@'
  ) {
    return null;
  }

  return { start: cursorPosition - 1, end: cursorPosition };
}

export function shouldStartCanvasAssociationPicking(
  beforeInputType: string | null | undefined,
  changeInputType: string | null | undefined
): boolean {
  const inputType = beforeInputType || changeInputType || '';
  return inputType === 'insertText' || inputType === 'insertCompositionText';
}

export function isCanvasAssociationTriggerActive(
  prompt: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  trigger: CanvasAssociationTrigger,
  isComposing = false
): boolean {
  if (isComposing) return true;
  if (
    selectionStart === null ||
    selectionEnd === null ||
    selectionStart !== selectionEnd ||
    selectionStart !== trigger.end
  ) {
    return false;
  }

  const currentTrigger = findCanvasAssociationTrigger(prompt, selectionStart);
  return (
    currentTrigger?.start === trigger.start &&
    currentTrigger.end === trigger.end
  );
}

export function hasCanvasAssociationOverwriteContent(
  references: readonly CanvasAssociationRef[],
  trigger: CanvasAssociationTrigger | null
): boolean {
  return references.length > 0 || trigger !== null;
}

export function removeCanvasAssociationTrigger(
  prompt: string,
  trigger: CanvasAssociationTrigger
): CanvasAssociationTriggerRemoval {
  const isValidRange =
    Number.isInteger(trigger.start) &&
    Number.isInteger(trigger.end) &&
    trigger.start >= 0 &&
    trigger.end === trigger.start + 1 &&
    trigger.end <= prompt.length &&
    prompt.slice(trigger.start, trigger.end) === '@';

  if (!isValidRange) {
    return {
      prompt,
      cursorPosition: Math.min(
        prompt.length,
        Math.max(0, Number.isFinite(trigger.end) ? trigger.end : prompt.length)
      ),
      removed: false,
    };
  }

  return {
    prompt: `${prompt.slice(0, trigger.start)}${prompt.slice(trigger.end)}`,
    cursorPosition: trigger.start,
    removed: true,
  };
}

export function normalizeCanvasAssociationLabel(
  label: string,
  fallback = '画布元素'
): string {
  const normalized = label.replace(/\s+/g, ' ').trim() || fallback;
  return normalized.slice(0, CANVAS_ASSOCIATION_LABEL_LIMIT);
}

export function getCanvasAssociationMentionText(
  reference: Pick<CanvasAssociationRef, 'label'>
): string {
  return `@${normalizeCanvasAssociationLabel(reference.label)}`;
}

export function replaceCanvasAssociationTriggerWithMention(
  prompt: string,
  trigger: CanvasAssociationTrigger,
  reference: CanvasAssociationRef
): CanvasAssociationMentionInsertion {
  const isValidTrigger =
    Number.isInteger(trigger.start) &&
    Number.isInteger(trigger.end) &&
    trigger.start >= 0 &&
    trigger.end === trigger.start + 1 &&
    trigger.end <= prompt.length &&
    prompt.slice(trigger.start, trigger.end) === '@';
  if (!isValidTrigger) {
    return {
      prompt,
      cursorPosition: Math.min(
        prompt.length,
        Math.max(0, Number.isFinite(trigger.end) ? trigger.end : prompt.length)
      ),
      reference: { ...reference },
      inserted: false,
    };
  }

  const label = normalizeCanvasAssociationLabel(reference.label);
  const mentionText = getCanvasAssociationMentionText({ label });
  const mentionStart = trigger.start;
  const mentionEnd = mentionStart + mentionText.length;

  return {
    prompt: `${prompt.slice(0, trigger.start)}${mentionText}${prompt.slice(
      trigger.end
    )}`,
    cursorPosition: mentionEnd,
    reference: {
      ...reference,
      label,
      mentionStart,
      mentionEnd,
    },
    inserted: true,
  };
}

function hasTrustedMentionRange(
  prompt: string,
  reference: CanvasAssociationRef
): reference is CanvasAssociationRef & {
  mentionStart: number;
  mentionEnd: number;
} {
  const { mentionStart, mentionEnd } = reference;
  return Boolean(
    Number.isInteger(mentionStart) &&
      Number.isInteger(mentionEnd) &&
      (mentionStart as number) >= 0 &&
      (mentionEnd as number) > (mentionStart as number) &&
      (mentionEnd as number) <= prompt.length &&
      prompt.slice(mentionStart, mentionEnd) ===
        getCanvasAssociationMentionText(reference)
  );
}

function isValidPromptEdit(
  previousPrompt: string,
  nextPrompt: string,
  edit: CanvasAssociationPromptEdit
): boolean {
  if (
    !Number.isInteger(edit.start) ||
    !Number.isInteger(edit.end) ||
    edit.start < 0 ||
    edit.end < edit.start ||
    edit.end > previousPrompt.length
  ) {
    return false;
  }

  const insertedLength =
    nextPrompt.length - (previousPrompt.length - (edit.end - edit.start));
  if (insertedLength < 0) return false;

  return (
    previousPrompt.slice(0, edit.start) === nextPrompt.slice(0, edit.start) &&
    previousPrompt.slice(edit.end) ===
      nextPrompt.slice(edit.start + insertedLength)
  );
}

/**
 * Converts the selection captured by `beforeinput` into the exact range that
 * was replaced in the previous textarea value. Collapsed backward/forward
 * deletions need expanding because textarea keeps the selection collapsed
 * until the browser applies the edit.
 */
export function resolveCanvasAssociationPromptEdit(
  previousPrompt: string,
  nextPrompt: string,
  snapshot: CanvasAssociationBeforeInputSnapshot | null
): CanvasAssociationPromptEdit | null {
  if (!snapshot || snapshot.inputType.startsWith('history')) return null;

  let start = snapshot.selectionStart;
  let end = snapshot.selectionEnd;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > previousPrompt.length
  ) {
    return null;
  }

  const removedLength = previousPrompt.length - nextPrompt.length;
  if (start === end && removedLength > 0) {
    if (!snapshot.inputType.startsWith('delete')) return null;
    if (snapshot.inputType.endsWith('Backward')) {
      start = Math.max(0, start - removedLength);
    } else if (snapshot.inputType.endsWith('Forward')) {
      end = Math.min(previousPrompt.length, end + removedLength);
    } else {
      return null;
    }
  }

  const edit = { start, end };
  return isValidPromptEdit(previousPrompt, nextPrompt, edit) ? edit : null;
}

/**
 * Falls back to the post-edit InputEvent only for direct text insertion. The
 * inserted data and collapsed caret make the replaced old-value range exact;
 * paste, drop, history, and programmatic changes intentionally stay unknown.
 */
export function resolveCanvasAssociationPromptEditFromInputEvent(
  previousPrompt: string,
  nextPrompt: string,
  snapshot: CanvasAssociationInputEventSnapshot | null
): CanvasAssociationPromptEdit | null {
  if (
    !snapshot ||
    (snapshot.inputType !== 'insertText' &&
      snapshot.inputType !== 'insertCompositionText') ||
    typeof snapshot.data !== 'string' ||
    snapshot.data.length === 0 ||
    !Number.isInteger(snapshot.selectionStart) ||
    snapshot.selectionStart !== snapshot.selectionEnd
  ) {
    return null;
  }

  const insertionEnd = snapshot.selectionStart as number;
  const insertionStart = insertionEnd - snapshot.data.length;
  if (
    insertionStart < 0 ||
    insertionEnd > nextPrompt.length ||
    nextPrompt.slice(insertionStart, insertionEnd) !== snapshot.data
  ) {
    return null;
  }

  const replacedLength =
    previousPrompt.length + snapshot.data.length - nextPrompt.length;
  if (replacedLength < 0) return null;

  const edit = {
    start: insertionStart,
    end: insertionStart + replacedLength,
  };
  return isValidPromptEdit(previousPrompt, nextPrompt, edit) ? edit : null;
}

/**
 * Returns whether a trusted text/composition edit inserted an at-sign. The
 * caller still checks the final caret, so an inserted `@` followed by more
 * composed text does not start picking.
 */
export function hasInsertedCanvasAssociationAtSign(
  previousPrompt: string,
  nextPrompt: string,
  edit: CanvasAssociationPromptEdit | null
): boolean {
  if (!edit || !isValidPromptEdit(previousPrompt, nextPrompt, edit)) {
    return false;
  }

  const insertedLength =
    nextPrompt.length - (previousPrompt.length - (edit.end - edit.start));
  return (
    insertedLength > 0 &&
    nextPrompt.slice(edit.start, edit.start + insertedLength).includes('@')
  );
}

/**
 * Reconciles trusted mention ranges after one textarea edit. Plain text that
 * merely looks like a mention never gains an element identity.
 */
export function reconcileCanvasAssociationRefsForPromptEdit(
  previousPrompt: string,
  nextPrompt: string,
  references: readonly CanvasAssociationRef[],
  edit: CanvasAssociationPromptEdit | null = null
): CanvasAssociationRef[] {
  if (references.length === 0) return [];
  if (previousPrompt === nextPrompt) {
    return references
      .filter((reference) => hasTrustedMentionRange(previousPrompt, reference))
      .map((reference) => ({ ...reference }));
  }
  // Without a trustworthy pre-edit selection, repeated equal labels make it
  // impossible to know which visible token was edited. Dropping identity is
  // safer than silently associating the text with the wrong canvas element.
  if (!edit || !isValidPromptEdit(previousPrompt, nextPrompt, edit)) return [];

  const insertedLength =
    nextPrompt.length - (previousPrompt.length - (edit.end - edit.start));
  const delta = insertedLength - (edit.end - edit.start);
  const reconciled: CanvasAssociationRef[] = [];

  for (const reference of references) {
    if (!hasTrustedMentionRange(previousPrompt, reference)) continue;

    let mentionStart = reference.mentionStart;
    let mentionEnd = reference.mentionEnd;
    if (edit.end <= mentionStart) {
      mentionStart += delta;
      mentionEnd += delta;
    } else if (edit.start < mentionEnd) {
      // The edit intersects the mention. Keep the readable text, but remove
      // its trusted canvas identity.
      continue;
    }

    const nextReference = { ...reference, mentionStart, mentionEnd };
    if (hasTrustedMentionRange(nextPrompt, nextReference)) {
      reconciled.push(nextReference);
    }
  }

  return reconciled;
}

/**
 * Deletes a trusted mention atomically when Backspace/Delete is pressed at its
 * outer boundary. Non-collapsed selections continue through native textarea
 * editing and are reconciled with the captured `beforeinput` range.
 */
export function removeCanvasAssociationMentionAtBoundary(
  prompt: string,
  references: readonly CanvasAssociationRef[],
  selectionStart: number,
  selectionEnd: number,
  direction: 'backward' | 'forward'
): CanvasAssociationMentionDeletion | null {
  if (
    selectionStart !== selectionEnd ||
    !Number.isInteger(selectionStart) ||
    selectionStart < 0 ||
    selectionStart > prompt.length
  ) {
    return null;
  }

  const reference = references.find(
    (item) =>
      hasTrustedMentionRange(prompt, item) &&
      (direction === 'backward'
        ? item.mentionEnd === selectionStart
        : item.mentionStart === selectionStart)
  );
  if (
    !reference ||
    reference.mentionStart === undefined ||
    reference.mentionEnd === undefined
  ) {
    return null;
  }

  const nextPrompt = `${prompt.slice(0, reference.mentionStart)}${prompt.slice(
    reference.mentionEnd
  )}`;
  return {
    prompt: nextPrompt,
    cursorPosition: reference.mentionStart,
    references: reconcileCanvasAssociationRefsForPromptEdit(
      prompt,
      nextPrompt,
      references,
      { start: reference.mentionStart, end: reference.mentionEnd }
    ),
    removedReferenceId: reference.referenceId,
  };
}

export function buildCanvasAssociationHighlightSegments(
  prompt: string,
  references: readonly CanvasAssociationRef[]
): CanvasAssociationHighlightSegment[] {
  const trustedReferences = references
    .filter(
      (
        reference
      ): reference is CanvasAssociationRef & {
        mentionStart: number;
        mentionEnd: number;
      } => hasTrustedMentionRange(prompt, reference)
    )
    .sort((left, right) => left.mentionStart - right.mentionStart);
  const segments: CanvasAssociationHighlightSegment[] = [];
  let cursor = 0;

  for (const reference of trustedReferences) {
    if (reference.mentionStart < cursor) continue;
    if (reference.mentionStart > cursor) {
      segments.push({ text: prompt.slice(cursor, reference.mentionStart) });
    }
    segments.push({
      text: prompt.slice(reference.mentionStart, reference.mentionEnd),
      referenceId: reference.referenceId,
    });
    cursor = reference.mentionEnd;
  }

  if (cursor < prompt.length || segments.length === 0) {
    segments.push({ text: prompt.slice(cursor) });
  }
  return segments;
}

export function getCanvasAssociationRefKey(
  reference: Pick<CanvasAssociationRef, 'boardId' | 'elementId'>
): string {
  return JSON.stringify([reference.boardId, reference.elementId]);
}

export function areCanvasAssociationRefsEqual(
  left: readonly CanvasAssociationRef[],
  right: readonly CanvasAssociationRef[]
): boolean {
  return (
    left.length === right.length &&
    left.every((reference, index) => {
      const other = right[index];
      if (!other) return false;
      return (
        reference.referenceId === other.referenceId &&
        reference.boardId === other.boardId &&
        reference.elementId === other.elementId &&
        reference.kind === other.kind &&
        reference.label === other.label &&
        reference.mentionStart === other.mentionStart &&
        reference.mentionEnd === other.mentionEnd
      );
    })
  );
}

export function shouldClearSubmittedCanvasAssociations(
  workflowFailed: boolean,
  createdTaskCount: number
): boolean {
  return !workflowFailed || createdTaskCount > 0;
}

/**
 * Do not mutate a detached board after an asynchronous handoff. Accepted
 * workflows can retain a lightweight request that is applied when their
 * submission board becomes active again.
 */
export function resolveCanvasAssociationTaskLinkTiming({
  submissionAccepted,
  associationCount,
  hasTaskTarget,
  submittedBoardIsCurrent,
}: CanvasAssociationTaskLinkTimingInput): CanvasAssociationTaskLinkTiming {
  if (!submissionAccepted || associationCount <= 0 || !hasTaskTarget) {
    return 'none';
  }
  return submittedBoardIsCurrent ? 'immediate' : 'deferred';
}

function normalizeCanvasAssociationRef(
  reference: CanvasAssociationRef
): CanvasAssociationRef {
  const boardId = reference.boardId.trim();
  const elementId = reference.elementId.trim();
  const label = normalizeCanvasAssociationLabel(reference.label);
  const mentionStart = reference.mentionStart;
  const mentionEnd = reference.mentionEnd;
  const hasMentionRange =
    Number.isInteger(mentionStart) &&
    Number.isInteger(mentionEnd) &&
    (mentionStart as number) >= 0 &&
    (mentionEnd as number) ===
      (mentionStart as number) +
        getCanvasAssociationMentionText({ label }).length;

  const normalized: CanvasAssociationRef = {
    ...reference,
    referenceId:
      reference.referenceId.trim() ||
      getCanvasAssociationRefKey({ boardId, elementId }),
    boardId,
    elementId,
    label,
  };
  if (hasMentionRange) {
    normalized.mentionStart = mentionStart;
    normalized.mentionEnd = mentionEnd;
  } else {
    delete normalized.mentionStart;
    delete normalized.mentionEnd;
  }
  return normalized;
}

export function appendCanvasAssociationRef(
  references: readonly CanvasAssociationRef[],
  reference: CanvasAssociationRef,
  limit = CANVAS_ASSOCIATION_REFERENCE_LIMIT
): CanvasAssociationRefAppendResult {
  const normalized = normalizeCanvasAssociationRef(reference);
  const normalizedLimit = Math.max(0, Math.trunc(limit));
  const referenceKey = getCanvasAssociationRefKey(normalized);
  const duplicate = references.some(
    (item) => getCanvasAssociationRefKey(item) === referenceKey
  );

  if (duplicate) {
    return {
      references: [...references],
      added: false,
      duplicate: true,
      limitReached: false,
    };
  }

  if (
    !normalized.boardId ||
    !normalized.elementId ||
    references.length >= normalizedLimit
  ) {
    return {
      references: [...references],
      added: false,
      duplicate: false,
      limitReached: references.length >= normalizedLimit,
    };
  }

  return {
    references: [...references, normalized],
    added: true,
    duplicate: false,
    limitReached: false,
  };
}

export function removeCanvasAssociationRef(
  references: readonly CanvasAssociationRef[],
  referenceId: string
): CanvasAssociationRef[] {
  return references.filter((item) => item.referenceId !== referenceId);
}

export function snapshotCanvasAssociationRefs(
  references: readonly CanvasAssociationRef[],
  limit = CANVAS_ASSOCIATION_REFERENCE_LIMIT
): CanvasAssociationRef[] {
  const snapshot: CanvasAssociationRef[] = [];
  const keys = new Set<string>();
  const normalizedLimit = Math.max(0, Math.trunc(limit));

  for (const reference of references) {
    if (snapshot.length >= normalizedLimit) break;
    const normalized = normalizeCanvasAssociationRef(reference);
    if (!normalized.boardId || !normalized.elementId) continue;

    const key = getCanvasAssociationRefKey(normalized);
    if (keys.has(key)) continue;
    keys.add(key);
    snapshot.push(normalized);
  }

  return snapshot;
}
