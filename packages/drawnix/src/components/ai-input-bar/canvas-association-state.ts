import { LS_KEYS } from '../../constants/storage-keys';
import type {
  CanvasAssociationKind,
  CanvasAssociationRef,
} from '../../types/shared/core.types';

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

export interface CanvasAssociationReconcileOptions {
  allowUniqueMentionRecovery?: boolean;
  /** Text reported by the trusted InputEvent for this edit, when available. */
  recoveryInputData?: string | null;
}

export interface CanvasAssociationBeforeInputSnapshot {
  selectionStart: number;
  selectionEnd: number;
  inputType: string;
  data?: string | null;
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

export function isCanvasAssociationInputTypeTrusted(
  inputType: string | null | undefined
): boolean {
  return (
    inputType === 'insertText' ||
    inputType === 'insertCompositionText' ||
    inputType === 'insertFromComposition'
  );
}

export function hasCanvasAssociationUntrustedInputType(
  ...inputTypes: Array<string | null | undefined>
): boolean {
  return inputTypes.some(
    (inputType) =>
      typeof inputType === 'string' &&
      inputType.length > 0 &&
      !isCanvasAssociationInputTypeTrusted(inputType)
  );
}

export function shouldRecoverCanvasAssociationMentions(
  beforeInputType: string | null | undefined,
  changeInputType: string | null | undefined,
  beforeInputData: string | null | undefined,
  hasExplicitUntrustedInput = false
): boolean {
  if (
    hasExplicitUntrustedInput ||
    hasCanvasAssociationUntrustedInputType(beforeInputType, changeInputType)
  ) {
    return false;
  }
  if (
    [beforeInputType, changeInputType].some(isCanvasAssociationInputTypeTrusted)
  ) {
    return true;
  }
  return (
    (!beforeInputType || beforeInputType.length === 0) &&
    (!changeInputType || changeInputType.length === 0) &&
    typeof beforeInputData === 'string' &&
    beforeInputData.length > 0
  );
}

export function shouldAllowCanvasAssociationCompositionTrigger(
  compositionInsertedAtSign: boolean,
  compositionHasUntrustedEdit: boolean,
  compositionData: string | null | undefined
): boolean {
  return (
    !compositionHasUntrustedEdit &&
    (compositionInsertedAtSign || compositionData?.includes('@') === true)
  );
}

export function shouldStartCanvasAssociationPicking(
  beforeInputType: string | null | undefined,
  changeInputType: string | null | undefined,
  beforeInputData?: string | null,
  hasExplicitUntrustedInput = false
): boolean {
  if (hasExplicitUntrustedInput) return false;
  return (
    !hasCanvasAssociationUntrustedInputType(beforeInputType, changeInputType) &&
    ([beforeInputType, changeInputType].some(
      isCanvasAssociationInputTypeTrusted
    ) ||
      ((!beforeInputType || beforeInputType.length === 0) &&
        (!changeInputType || changeInputType.length === 0) &&
        beforeInputData?.includes('@') === true))
  );
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

const CANVAS_ASSOCIATION_KIND_LABELS: Record<CanvasAssociationKind, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  text: '文本',
  graphics: '图形',
  frame: '画框',
  card: '卡片',
  other: '画布元素',
};

/** Allocate a stable, per-kind label without rewriting existing mentions. */
export function getNextCanvasAssociationLabel(
  kind: CanvasAssociationKind,
  references: readonly Pick<CanvasAssociationRef, 'kind' | 'label'>[]
): string {
  const baseLabel = CANVAS_ASSOCIATION_KIND_LABELS[kind];
  const usedNumbers = new Set<number>();
  let sameKindCount = 0;
  let maxNumber = 0;

  for (const reference of references) {
    if (reference.kind !== kind) continue;
    sameKindCount += 1;
    const label = normalizeCanvasAssociationLabel(reference.label);
    if (!label.startsWith(baseLabel)) continue;
    const suffix = label.slice(baseLabel.length);
    if (!/^[1-9]\d*$/.test(suffix)) continue;
    const parsed = Number(suffix);
    if (!Number.isSafeInteger(parsed)) continue;
    usedNumbers.add(parsed);
    maxNumber = Math.max(maxNumber, parsed);
  }

  let nextNumber = Math.max(sameKindCount, maxNumber) + 1;
  if (!Number.isSafeInteger(nextNumber)) {
    nextNumber = 1;
    while (usedNumbers.has(nextNumber)) nextNumber += 1;
  }
  return `${baseLabel}${nextNumber}`;
}

export function getCanvasAssociationMentionText(
  reference: Pick<CanvasAssociationRef, 'label'>
): string {
  return `@${normalizeCanvasAssociationLabel(reference.label)}`;
}

function findUniqueCanvasAssociationMentionStart(
  prompt: string,
  mentionText: string
): number {
  const needsNumericBoundary = /\d$/.test(mentionText);
  let foundStart = -1;
  let searchStart = 0;

  while (searchStart <= prompt.length - mentionText.length) {
    const matchStart = prompt.indexOf(mentionText, searchStart);
    if (matchStart < 0) break;
    const nextCharacter = prompt[matchStart + mentionText.length];
    const isNumberPrefix =
      needsNumericBoundary && nextCharacter >= '0' && nextCharacter <= '9';
    if (!isNumberPrefix) {
      if (foundStart >= 0) return -1;
      foundStart = matchStart;
    }
    searchStart = matchStart + 1;
  }

  return foundStart;
}

function containsCanvasAssociationMention(
  prompt: string,
  mentionText: string
): boolean {
  const needsNumericBoundary = /\d$/.test(mentionText);
  let searchStart = 0;

  while (searchStart <= prompt.length - mentionText.length) {
    const matchStart = prompt.indexOf(mentionText, searchStart);
    if (matchStart < 0) return false;
    const nextCharacter = prompt[matchStart + mentionText.length];
    const isNumberPrefix =
      needsNumericBoundary && nextCharacter >= '0' && nextCharacter <= '9';
    if (!isNumberPrefix) return true;
    searchStart = matchStart + 1;
  }

  return false;
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
  const mentionText = getCanvasAssociationMentionText(reference);
  const nextCharacter = prompt[mentionEnd as number];
  const hasNumericBoundary =
    !/\d$/.test(mentionText) ||
    nextCharacter === undefined ||
    nextCharacter < '0' ||
    nextCharacter > '9';
  return Boolean(
    Number.isInteger(mentionStart) &&
      Number.isInteger(mentionEnd) &&
      (mentionStart as number) >= 0 &&
      (mentionEnd as number) > (mentionStart as number) &&
      (mentionEnd as number) <= prompt.length &&
      prompt.slice(mentionStart, mentionEnd) === mentionText &&
      hasNumericBoundary
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
    snapshot &&
    Number.isInteger(snapshot.selectionStart) &&
    snapshot.selectionStart === snapshot.selectionEnd &&
    snapshot.selectionEnd === nextPrompt.length &&
    nextPrompt.length > previousPrompt.length &&
    nextPrompt.startsWith(previousPrompt)
  ) {
    return { start: previousPrompt.length, end: previousPrompt.length };
  }
  if (
    !snapshot ||
    !isCanvasAssociationInputTypeTrusted(snapshot.inputType) ||
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

export function isCanvasAssociationPickingSessionCurrent(
  pickingAtPointer: boolean,
  pickingNow: boolean,
  pointerEpoch: number,
  currentEpoch: number,
  pointerBoardId: string | null | undefined,
  currentBoardId: string | null | undefined,
  sameBoard: boolean
): boolean {
  // Non-association pointerups keep the existing delayed selection refresh.
  if (!pickingAtPointer) return true;
  return (
    pickingNow &&
    pointerEpoch === currentEpoch &&
    pointerBoardId === currentBoardId &&
    sameBoard
  );
}

export interface CanvasAssociationPointerOwnership {
  forcedPointer: string;
  previousBoardPointer: string;
  previousAppStatePointer?: string | null;
}

/** Restore only while the board and toolbar state still belong to the picker. */
export function shouldRestoreCanvasAssociationPointer(
  ownership: CanvasAssociationPointerOwnership,
  currentBoardPointer: string | null | undefined,
  currentAppStatePointer: string | null | undefined
): boolean {
  return (
    currentBoardPointer === ownership.forcedPointer &&
    currentAppStatePointer === ownership.previousAppStatePointer
  );
}

function recoverUniqueCanvasAssociationRefs(
  previousPrompt: string,
  nextPrompt: string,
  references: readonly CanvasAssociationRef[],
  recoveryInputData?: string | null
): CanvasAssociationRef[] {
  const trustedReferences = references
    .filter((reference) => hasTrustedMentionRange(previousPrompt, reference))
    .sort(
      (left, right) =>
        (left.mentionStart as number) - (right.mentionStart as number)
    );
  const recovered: CanvasAssociationRef[] = [];
  let nextCursor = 0;

  for (const reference of trustedReferences) {
    const mentionText = getCanvasAssociationMentionText(reference);
    // Replacing a selection with text that contains the same visible token
    // must not transfer the old canvas identity to the newly typed token.
    if (
      recoveryInputData &&
      containsCanvasAssociationMention(recoveryInputData, mentionText)
    ) {
      continue;
    }
    const previousStart = findUniqueCanvasAssociationMentionStart(
      previousPrompt,
      mentionText
    );
    if (previousStart !== reference.mentionStart) continue;

    const nextStart = findUniqueCanvasAssociationMentionStart(
      nextPrompt,
      mentionText
    );
    if (nextStart < nextCursor) continue;
    const nextReference = {
      ...reference,
      mentionStart: nextStart,
      mentionEnd: nextStart + mentionText.length,
    };
    if (!hasTrustedMentionRange(nextPrompt, nextReference)) continue;
    recovered.push(nextReference);
    nextCursor = nextReference.mentionEnd;
  }
  return recovered;
}

function resolveCanvasAssociationRecoveryEdit(
  previousPrompt: string,
  nextPrompt: string,
  reportedEdit: CanvasAssociationPromptEdit,
  recoveryInputData: string | null | undefined
): CanvasAssociationPromptEdit | null {
  if (!recoveryInputData) return null;

  let commonPrefixLength = 0;
  const prefixLimit = Math.min(previousPrompt.length, nextPrompt.length);
  while (
    commonPrefixLength < prefixLimit &&
    previousPrompt[commonPrefixLength] === nextPrompt[commonPrefixLength]
  ) {
    commonPrefixLength += 1;
  }

  let commonSuffixLength = 0;
  while (
    commonSuffixLength < previousPrompt.length - commonPrefixLength &&
    commonSuffixLength < nextPrompt.length - commonPrefixLength &&
    previousPrompt[previousPrompt.length - commonSuffixLength - 1] ===
      nextPrompt[nextPrompt.length - commonSuffixLength - 1]
  ) {
    commonSuffixLength += 1;
  }

  const minimalEdit = {
    start: commonPrefixLength,
    end: previousPrompt.length - commonSuffixLength,
  };
  const minimalInsertedText = nextPrompt.slice(
    commonPrefixLength,
    nextPrompt.length - commonSuffixLength
  );
  const reportedIsBroader =
    reportedEdit.start <= minimalEdit.start &&
    reportedEdit.end >= minimalEdit.end &&
    (reportedEdit.start !== minimalEdit.start ||
      reportedEdit.end !== minimalEdit.end);

  return reportedIsBroader && minimalInsertedText === recoveryInputData
    ? minimalEdit
    : null;
}

/**
 * Reconciles trusted mention ranges after one textarea edit. Plain text that
 * merely looks like a mention never gains an element identity.
 */
export function reconcileCanvasAssociationRefsForPromptEdit(
  previousPrompt: string,
  nextPrompt: string,
  references: readonly CanvasAssociationRef[],
  edit: CanvasAssociationPromptEdit | null = null,
  options: CanvasAssociationReconcileOptions = {}
): CanvasAssociationRef[] {
  if (references.length === 0) return [];
  if (previousPrompt === nextPrompt) {
    return references
      .filter((reference) => hasTrustedMentionRange(previousPrompt, reference))
      .map((reference) => ({ ...reference }));
  }
  if (!edit || !isValidPromptEdit(previousPrompt, nextPrompt, edit)) {
    // A uniquely numbered token can be recovered even when a browser omits
    // beforeinput details (notably during some IME sequences). Ambiguous or
    // duplicated visible text still loses identity instead of being guessed.
    return options.allowUniqueMentionRecovery
      ? recoverUniqueCanvasAssociationRefs(
          previousPrompt,
          nextPrompt,
          references,
          options.recoveryInputData
        )
      : [];
  }

  const effectiveEdit =
    options.allowUniqueMentionRecovery &&
    resolveCanvasAssociationRecoveryEdit(
      previousPrompt,
      nextPrompt,
      edit,
      options.recoveryInputData
    );
  const appliedEdit = effectiveEdit || edit;
  const insertedLength =
    nextPrompt.length -
    (previousPrompt.length - (appliedEdit.end - appliedEdit.start));
  const delta = insertedLength - (appliedEdit.end - appliedEdit.start);
  const reconciled: CanvasAssociationRef[] = [];

  for (const reference of references) {
    if (!hasTrustedMentionRange(previousPrompt, reference)) continue;

    let mentionStart = reference.mentionStart;
    let mentionEnd = reference.mentionEnd;
    if (appliedEdit.end <= mentionStart) {
      mentionStart += delta;
      mentionEnd += delta;
    } else if (appliedEdit.start < mentionEnd) {
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
