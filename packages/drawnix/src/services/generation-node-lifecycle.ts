import { createCanvasAssociationLines } from '../plugins/canvas-association';
import {
  addSelectedElement,
  clearSelectedElement,
  idCreator,
  PlaitBoard,
  PlaitElement,
  PlaitHistoryBoard,
  Point,
  RectangleClient,
  Transforms,
} from '@plait/core';
import {
  GenerationNodeData,
  GenerationNodeElement,
  isGenerationNode,
  notifyGenerationNodeChange,
  remapGenerationNode,
} from './generation-node';
import type { AIInputPrefillEventDetail } from './ai-input-ui-events';
import { resolveImageGenerationAnchorAvailablePosition } from '../utils/image-generation-anchor-placement';

/** Canvas-only input snapshot, never interpreted as a new task on load. */
export interface GenerationOrigin {
  version: 1;
  draft: GenerationNodeElement;
}

export function readGenerationOrigin(
  element: PlaitElement | undefined
): GenerationOrigin | undefined {
  const origin = element?.generationOrigin;
  return origin?.version === 1 && isGenerationNode(origin.draft)
    ? origin
    : undefined;
}

export function isGenerationProgress(element: PlaitElement): boolean {
  return (
    (element.type === 'generation-anchor' || element.type === 'workzone') &&
    !!readGenerationOrigin(element)
  );
}

export function getGenerationSlotPositions(
  board: PlaitBoard,
  draft: GenerationNodeElement,
  size: { width: number; height: number },
  count: number
): Point[] {
  const rect = RectangleClient.getRectangleByPoints(draft.points);
  const positions: Point[] = [[rect.x, rect.y]];
  const reserved = [{ x: rect.x, y: rect.y, ...size }];
  for (let index = 1; index < count; index++) {
    const point = resolveImageGenerationAnchorAvailablePosition(
      board,
      [rect.x + index * (size.width + 40), rect.y],
      size,
      {
        ignoreElementIds: [draft.id],
        ignoreTypes: ['arrow-line'],
        extraOccupiedRects: reserved,
      }
    );
    positions.push(point);
    reserved.push({ x: point[0], y: point[1], ...size });
  }
  return positions;
}

/** Adopt newly created transient progress as one reversible canvas replacement. */
export function consumeGenerationDraft(
  board: PlaitBoard,
  draftId: string,
  data: GenerationNodeData,
  progressIds: string[],
  boardId: string
): void {
  const draft = board.children.find((element) => element.id === draftId);
  if (!isGenerationNode(draft))
    throw new Error('生成框已提交或删除，请重新选择');
  const progress = progressIds.map((id) =>
    board.children.find((element) => element.id === id)
  );
  if (!progress.length || progress.some((element) => !element))
    throw new Error('未能创建生成进度框');
  const snapshot = structuredClone({
    ...draft,
    generationNode: {
      ...data,
    },
  });
  // These elements were just inserted without history in this synchronous turn.
  PlaitHistoryBoard.withoutSaving(board, () => {
    // Retire derived input lines before recording paths for the replacement.
    for (let index = board.children.length - 1; index >= 0; index--) {
      if (board.children[index].generationInput?.nodeId === draftId)
        Transforms.removeNode(board, [index]);
    }
    for (const element of [...progress].reverse()) {
      Transforms.removeNode(board, [
        board.children.findIndex((item) => item.id === element!.id),
      ]);
    }
  });
  PlaitHistoryBoard.withNewBatch(board, () => {
    Transforms.removeNode(board, [
      board.children.findIndex((element) => element.id === draftId),
    ]);
    for (const element of progress) {
      const savedDraft = structuredClone(snapshot);
      if (progress.length > 1) savedDraft.generationNode.count = 1;
      Transforms.insertNode(
        board,
        {
          ...element!,
          generationOrigin: {
            version: 1,
            draft: savedDraft,
          } satisfies GenerationOrigin,
        },
        [board.children.length]
      );
      createCanvasAssociationLines(board, {
        boardId,
        sourceElementIds: data.references.flatMap((ref) =>
          ref.sourceElementId ? [ref.sourceElementId] : []
        ),
        resultElementId: element!.id,
        workflowId: element!.workflowId || element!.workflow?.id,
      });
    }
  });
  clearSelectedElement(board);
  notifyGenerationNodeChange(board);
}

/** Preserve failure inputs at the moved slot position; do not restart its task. */
export function restoreGenerationDraft(
  board: PlaitBoard,
  progressId: string
): GenerationNodeElement | undefined {
  const progress = board.children.find((element) => element.id === progressId);
  const origin = readGenerationOrigin(progress);
  if (!progress || !origin || !isGenerationProgress(progress)) return;
  const draft = draftFromGenerationProgress(progress);
  draft.generationNode.references = draft.generationNode.references.map(
    (ref) => ({
      ...ref,
      sourceElementId: board.children.some(
        (source) => source.id === ref.sourceElementId && source.url === ref.url
      )
        ? ref.sourceElementId
        : undefined,
    })
  );
  PlaitHistoryBoard.withNewBatch(board, () => {
    Transforms.removeNode(board, [
      board.children.findIndex((element) => element.id === progressId),
    ]);
    Transforms.insertNode(board, draft, [board.children.length]);
  });
  clearSelectedElement(board);
  addSelectedElement(board, draft);
  notifyGenerationNodeChange(board, draft.id);
  return draft;
}

export function draftFromGenerationProgress(
  progress: PlaitElement
): GenerationNodeElement {
  const origin = readGenerationOrigin(progress)!;
  const draft = structuredClone(origin.draft);
  const sourceRect = RectangleClient.getRectangleByPoints(draft.points);
  const position = RectangleClient.getRectangleByPoints(progress.points!);
  draft.id = idCreator();
  draft.points = [
    [position.x, position.y],
    [position.x + sourceRect.width, position.y + sourceRect.height],
  ];
  draft.angle = 0;
  return draft;
}

export function remapGenerationOrigin(
  origin: GenerationOrigin,
  ids: Map<string, string>
): GenerationOrigin {
  return {
    version: 1,
    draft: {
      ...structuredClone(origin.draft),
      id: idCreator(),
      generationNode: remapGenerationNode(origin.draft.generationNode, ids),
    },
  };
}

// History replay must remain reversible: completion timers must not immediately
// delete a restored progress card and clear the redo stack again.
const historyRestoredProgress = new WeakMap<PlaitBoard, Set<string>>();
export function markGenerationProgressHistoryRestore(
  board: PlaitBoard,
  id: string,
  completed = true
): void {
  let ids = historyRestoredProgress.get(board);
  if (!ids) {
    ids = new Set();
    historyRestoredProgress.set(board, ids);
  }
  if (completed) ids.add(id);
  else ids.delete(id);
}
export function wasGenerationProgressRestored(
  board: PlaitBoard,
  id: string
): boolean {
  return historyRestoredProgress.get(board)?.has(id) ?? false;
}

export function generationOriginInput(
  element: PlaitElement
): AIInputPrefillEventDetail | undefined {
  const data = readGenerationOrigin(element)?.draft.generationNode;
  if (!data) return;
  return {
    intent: 'restore',
    generationType: data.generationType,
    prompt: data.prompt,
    model: data.model,
    modelRef: data.modelRef,
    params: structuredClone(data.params),
    count: data.count,
    images: structuredClone(data.references),
  };
}
