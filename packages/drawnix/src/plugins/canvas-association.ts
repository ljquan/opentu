import {
  getRectangleByElements,
  PlaitBoard,
  PlaitHistoryBoard,
  PlaitNode,
  Transforms,
  type PlaitElement,
  type Point,
  type RectangleClient,
  type PlaitPlugin,
  type PlaitOperation,
} from '@plait/core';
import {
  ArrowLineMarkerType,
  ArrowLineShape,
  createArrowLineElement,
  type PlaitArrowLine,
} from '@plait/draw';
import type { CanvasAssociationRef } from '../types/shared/core.types';

export const CANVAS_ASSOCIATION_VERSION = 1 as const;

const ASSOCIATION_STROKE_COLOR = '#000000';
const ASSOCIATION_STROKE_WIDTH = 2;
const ASSOCIATION_LINE_SHAPE = ArrowLineShape.curve;
const SYSTEM_ELEMENT_TYPES = new Set(['generation-anchor', 'workzone']);
const MAX_DEFERRED_ASSOCIATION_LINKS = 256;

interface DeferredCanvasAssociationLink {
  boardId: string;
  sourceElementIds: string[];
  resultElementId: string;
  workflowId?: string;
  taskId?: string;
}

const deferredAssociationLinks = new Map<
  string,
  DeferredCanvasAssociationLink
>();

export interface CanvasAssociationMetadata {
  version: typeof CANVAS_ASSOCIATION_VERSION;
  boardId: string;
  sourceElementId: string;
  resultElementId: string;
  workflowId?: string;
  taskId?: string;
}

export interface PlaitCanvasAssociationLine extends PlaitArrowLine {
  canvasAssociation: CanvasAssociationMetadata;
  locked: true;
}

export interface CreateCanvasAssociationLinesOptions {
  boardId: string;
  sourceElementIds: string[];
  resultElementId: string;
  workflowId?: string;
  taskId?: string;
}

export interface RetargetCanvasAssociationLinesOptions
  extends CreateCanvasAssociationLinesOptions {
  previousResultElementId?: string;
}

export interface ReconcileCanvasAssociationResult {
  removed: number;
  updated: number;
}

export function deferCanvasAssociationLines(
  options: CreateCanvasAssociationLinesOptions
): void {
  const boardId = options.boardId.trim();
  const resultElementId = options.resultElementId.trim();
  const sourceElementIds = Array.from(
    new Set(options.sourceElementIds.map((elementId) => elementId.trim()))
  ).filter(Boolean);
  if (!boardId || !resultElementId || sourceElementIds.length === 0) return;

  const key = [
    boardId,
    options.workflowId?.trim() || '',
    options.taskId?.trim() || '',
    resultElementId,
  ].join(':');
  deferredAssociationLinks.delete(key);
  deferredAssociationLinks.set(key, {
    boardId,
    sourceElementIds,
    resultElementId,
    ...(options.workflowId?.trim()
      ? { workflowId: options.workflowId.trim() }
      : {}),
    ...(options.taskId?.trim() ? { taskId: options.taskId.trim() } : {}),
  });

  while (deferredAssociationLinks.size > MAX_DEFERRED_ASSOCIATION_LINKS) {
    const oldestKey = deferredAssociationLinks.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    deferredAssociationLinks.delete(oldestKey);
  }
}

export function flushDeferredCanvasAssociationLines(
  board: PlaitBoard,
  boardId: string | null | undefined
): number {
  const normalizedBoardId = boardId?.trim();
  if (!normalizedBoardId) return 0;

  const elementsById = indexCanvasElementsById(board.children);
  let flushed = 0;
  for (const [key, options] of deferredAssociationLinks) {
    if (options.boardId !== normalizedBoardId) continue;

    if (elementsById.has(options.resultElementId)) {
      createCanvasAssociationLines(board, options);
    }
    deferredAssociationLinks.delete(key);
    flushed += 1;
  }
  return flushed;
}

interface CanvasAssociationIndex {
  elementsById: Map<string, PlaitElement>;
  linesById: Map<string, PlaitCanvasAssociationLine>;
  lineIdsByEndpointId: Map<string, Set<string>>;
}

export function isCanvasAssociationLine(
  element: PlaitElement | null | undefined
): element is PlaitCanvasAssociationLine {
  if (!element || element.type !== 'arrow-line') return false;

  const metadata = element.canvasAssociation as
    | Partial<CanvasAssociationMetadata>
    | undefined;
  return (
    metadata?.version === CANVAS_ASSOCIATION_VERSION &&
    typeof metadata.boardId === 'string' &&
    metadata.boardId.length > 0 &&
    typeof metadata.sourceElementId === 'string' &&
    metadata.sourceElementId.length > 0 &&
    typeof metadata.resultElementId === 'string' &&
    metadata.resultElementId.length > 0
  );
}

export function isCanvasAssociationCandidate(
  element: PlaitElement | null | undefined
): element is PlaitElement {
  return Boolean(
    element &&
      element.id &&
      !SYSTEM_ELEMENT_TYPES.has(element.type || '') &&
      !isCanvasAssociationLine(element)
  );
}

export function isCanvasAssociationTarget(
  element: PlaitElement | null | undefined
): element is PlaitElement {
  return Boolean(element?.id && !isCanvasAssociationLine(element));
}

export function canInsertCanvasAssociationsOnBoard(
  associations: readonly Pick<CanvasAssociationRef, 'boardId'>[],
  currentBoardId: string | null | undefined
): boolean {
  if (associations.length === 0) return true;

  const sourceBoardIds = new Set(
    associations
      .map((association) => association.boardId.trim())
      .filter(Boolean)
  );
  return (
    sourceBoardIds.size === 1 &&
    typeof currentBoardId === 'string' &&
    sourceBoardIds.has(currentBoardId.trim())
  );
}

function isFiniteRectangle(rectangle: RectangleClient): boolean {
  return (
    Number.isFinite(rectangle.x) &&
    Number.isFinite(rectangle.y) &&
    Number.isFinite(rectangle.width) &&
    Number.isFinite(rectangle.height)
  );
}

export function getCanvasAssociationEndpointPoints(
  sourceRectangle: RectangleClient,
  resultRectangle: RectangleClient
): [Point, Point] | null {
  if (
    !isFiniteRectangle(sourceRectangle) ||
    !isFiniteRectangle(resultRectangle)
  ) {
    return null;
  }

  const sourceCenter: Point = [
    sourceRectangle.x + sourceRectangle.width / 2,
    sourceRectangle.y + sourceRectangle.height / 2,
  ];
  const resultCenter: Point = [
    resultRectangle.x + resultRectangle.width / 2,
    resultRectangle.y + resultRectangle.height / 2,
  ];
  const deltaY = resultCenter[1] - sourceCenter[1];
  const resultIsToRight =
    sourceRectangle.x + sourceRectangle.width <= resultRectangle.x;
  const resultIsToLeft =
    resultRectangle.x + resultRectangle.width <= sourceRectangle.x;

  if (resultIsToRight || resultIsToLeft) {
    const sourceX = resultIsToRight
      ? sourceRectangle.x + sourceRectangle.width
      : sourceRectangle.x;
    const resultX = resultIsToRight
      ? resultRectangle.x
      : resultRectangle.x + resultRectangle.width;
    return [
      [sourceX, sourceCenter[1]],
      [resultX, resultCenter[1]],
    ];
  }

  const sourceY =
    deltaY >= 0
      ? sourceRectangle.y + sourceRectangle.height
      : sourceRectangle.y;
  const resultY =
    deltaY >= 0
      ? resultRectangle.y
      : resultRectangle.y + resultRectangle.height;
  return [
    [sourceCenter[0], sourceY],
    [resultCenter[0], resultY],
  ];
}

function resolveAssociationPoints(
  board: PlaitBoard,
  source: PlaitElement,
  result: PlaitElement
): [Point, Point] | null {
  try {
    const sourceRectangle = getRectangleByElements(board, [source], false);
    const resultRectangle = getRectangleByElements(board, [result], false);
    return getCanvasAssociationEndpointPoints(sourceRectangle, resultRectangle);
  } catch {
    return null;
  }
}

function arePointsEqual(first: Point[], second: Point[]): boolean {
  return (
    first.length === second.length &&
    first.every(
      (point, index) =>
        point[0] === second[index][0] && point[1] === second[index][1]
    )
  );
}

function indexCanvasElementsById(
  elements: readonly PlaitElement[]
): Map<string, PlaitElement> {
  const elementsById = new Map<string, PlaitElement>();
  const pendingElements = [...elements];

  while (pendingElements.length > 0) {
    const element = pendingElements.pop();
    if (!element) continue;

    if (typeof element.id === 'string' && element.id) {
      elementsById.set(element.id, element);
    }

    const children = (element as { children?: unknown }).children;
    if (!Array.isArray(children)) continue;

    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        pendingElements.push(child as PlaitElement);
      }
    }
  }

  return elementsById;
}

function visitElementTree(
  element: PlaitElement,
  visitor: (element: PlaitElement) => void
): void {
  const pending = [element];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    visitor(current);
    const children = (current as { children?: unknown }).children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        pending.push(child as PlaitElement);
      }
    }
  }
}

function addLineToIndex(
  index: CanvasAssociationIndex,
  line: PlaitCanvasAssociationLine
): void {
  index.linesById.set(line.id, line);
  const metadata = line.canvasAssociation;
  for (const endpointId of [
    metadata.sourceElementId,
    metadata.resultElementId,
  ]) {
    let lineIds = index.lineIdsByEndpointId.get(endpointId);
    if (!lineIds) {
      lineIds = new Set();
      index.lineIdsByEndpointId.set(endpointId, lineIds);
    }
    lineIds.add(line.id);
  }
}

function removeLineFromIndex(
  index: CanvasAssociationIndex,
  line: PlaitCanvasAssociationLine
): void {
  index.linesById.delete(line.id);
  for (const endpointId of [
    line.canvasAssociation.sourceElementId,
    line.canvasAssociation.resultElementId,
  ]) {
    const lineIds = index.lineIdsByEndpointId.get(endpointId);
    lineIds?.delete(line.id);
    if (lineIds?.size === 0) index.lineIdsByEndpointId.delete(endpointId);
  }
}

function createCanvasAssociationIndex(
  children: readonly PlaitElement[]
): CanvasAssociationIndex {
  const index: CanvasAssociationIndex = {
    elementsById: new Map(),
    linesById: new Map(),
    lineIdsByEndpointId: new Map(),
  };
  for (const child of children) {
    visitElementTree(child, (element) => {
      if (element.id) index.elementsById.set(element.id, element);
      if (isCanvasAssociationLine(element)) addLineToIndex(index, element);
    });
  }
  return index;
}

function removeElementTreeFromIndex(
  index: CanvasAssociationIndex,
  element: PlaitElement,
  affectedElementIds: Set<string>,
  affectedLineIds: Set<string>
): void {
  visitElementTree(element, (current) => {
    if (current.id) {
      affectedElementIds.add(current.id);
      index.elementsById.delete(current.id);
    }
    if (isCanvasAssociationLine(current)) {
      affectedLineIds.add(current.id);
      removeLineFromIndex(index, current);
    }
  });
}

function addElementTreeToIndex(
  index: CanvasAssociationIndex,
  element: PlaitElement,
  affectedElementIds: Set<string>,
  affectedLineIds: Set<string>
): void {
  visitElementTree(element, (current) => {
    if (current.id) {
      affectedElementIds.add(current.id);
      index.elementsById.set(current.id, current);
    }
    if (isCanvasAssociationLine(current)) {
      affectedLineIds.add(current.id);
      addLineToIndex(index, current);
    }
  });
}

function getNodeAfterOperation(
  board: PlaitBoard,
  operation: PlaitOperation
): PlaitElement | null {
  try {
    if (operation.type === 'move_node') {
      return PlaitNode.get(board, operation.newPath);
    }
    if (operation.type === 'insert_node' || operation.type === 'set_node') {
      return PlaitNode.get(board, operation.path);
    }
  } catch {
    // A later operation in the same batch may already have removed this node.
  }
  return null;
}

function updateCanvasAssociationIndex(
  board: PlaitBoard,
  index: CanvasAssociationIndex,
  operations: readonly PlaitOperation[],
  affectedElementIds: Set<string>,
  affectedLineIds: Set<string>,
  managedLineOperationIds: Set<string>
): void {
  for (const operation of operations) {
    const operationNode =
      operation.type === 'remove_node'
        ? (operation.node as PlaitElement)
        : getNodeAfterOperation(board, operation);
    const lineIds =
      operationNode?.id && managedLineOperationIds.delete(operationNode.id)
        ? new Set<string>()
        : affectedLineIds;
    if (operation.type === 'remove_node') {
      removeElementTreeFromIndex(
        index,
        operationNode as PlaitElement,
        affectedElementIds,
        lineIds
      );
      continue;
    }
    if (
      operation.type !== 'insert_node' &&
      operation.type !== 'set_node' &&
      operation.type !== 'move_node'
    ) {
      continue;
    }

    const node = operationNode;
    if (!node) continue;
    const previous = node.id ? index.elementsById.get(node.id) : undefined;
    if (previous) {
      removeElementTreeFromIndex(index, previous, affectedElementIds, lineIds);
    }
    addElementTreeToIndex(index, node, affectedElementIds, lineIds);
  }
}

function findExistingAssociationLine(
  board: PlaitBoard,
  boardId: string,
  sourceElementId: string,
  resultElementId: string
): PlaitCanvasAssociationLine | undefined {
  return board.children.find((element) => {
    if (!isCanvasAssociationLine(element)) return false;
    const metadata = element.canvasAssociation;
    return (
      metadata.boardId === boardId &&
      metadata.sourceElementId === sourceElementId &&
      metadata.resultElementId === resultElementId
    );
  }) as PlaitCanvasAssociationLine | undefined;
}

function findRetargetableAssociationLine(
  board: PlaitBoard,
  elementsById: ReadonlyMap<string, PlaitElement>,
  options: {
    boardId: string;
    sourceElementId: string;
    workflowId?: string;
    previousResultElementId?: string;
  }
): PlaitCanvasAssociationLine | undefined {
  const workflowId = options.workflowId?.trim();
  const previousResultElementId = options.previousResultElementId?.trim();

  return board.children.find((element) => {
    if (!isCanvasAssociationLine(element)) return false;
    const metadata = element.canvasAssociation;
    if (
      metadata.boardId !== options.boardId ||
      metadata.sourceElementId !== options.sourceElementId ||
      (workflowId && metadata.workflowId !== workflowId)
    ) {
      return false;
    }

    if (
      !workflowId &&
      !previousResultElementId &&
      metadata.workflowId?.trim()
    ) {
      return false;
    }

    if (previousResultElementId) {
      return metadata.resultElementId === previousResultElementId;
    }

    const currentTarget = elementsById.get(metadata.resultElementId);
    return Boolean(
      currentTarget && SYSTEM_ELEMENT_TYPES.has(currentTarget.type || '')
    );
  }) as PlaitCanvasAssociationLine | undefined;
}

function buildAssociationMetadata(
  current: CanvasAssociationMetadata | undefined,
  options: {
    boardId: string;
    sourceElementId: string;
    resultElementId: string;
    workflowId?: string;
    taskId?: string;
  }
): CanvasAssociationMetadata {
  const workflowId = options.workflowId?.trim();
  const taskId = options.taskId?.trim();
  return {
    version: CANVAS_ASSOCIATION_VERSION,
    boardId: options.boardId,
    sourceElementId: options.sourceElementId,
    resultElementId: options.resultElementId,
    ...(workflowId || current?.workflowId
      ? { workflowId: workflowId || current?.workflowId }
      : {}),
    ...(taskId || current?.taskId ? { taskId: taskId || current?.taskId } : {}),
  };
}

function areAssociationMetadataEqual(
  left: CanvasAssociationMetadata,
  right: CanvasAssociationMetadata
): boolean {
  return (
    left.version === right.version &&
    left.boardId === right.boardId &&
    left.sourceElementId === right.sourceElementId &&
    left.resultElementId === right.resultElementId &&
    left.workflowId === right.workflowId &&
    left.taskId === right.taskId
  );
}

export function createCanvasAssociationLines(
  board: PlaitBoard,
  options: CreateCanvasAssociationLinesOptions
): PlaitCanvasAssociationLine[] {
  const boardId = options.boardId.trim();
  const resultElementId = options.resultElementId.trim();
  if (!boardId || !resultElementId) return [];

  const elementsById = indexCanvasElementsById(board.children);
  const result = elementsById.get(resultElementId);
  if (!isCanvasAssociationTarget(result)) return [];

  const lines: PlaitCanvasAssociationLine[] = [];
  const uniqueSourceIds = new Set(
    options.sourceElementIds.map((elementId) => elementId.trim())
  );

  for (const sourceElementId of uniqueSourceIds) {
    if (!sourceElementId || sourceElementId === resultElementId) continue;

    const source = elementsById.get(sourceElementId);
    if (!isCanvasAssociationCandidate(source)) continue;

    const existing = findExistingAssociationLine(
      board,
      boardId,
      sourceElementId,
      resultElementId
    );
    if (existing) {
      lines.push(existing);
      continue;
    }

    const points = resolveAssociationPoints(board, source, result);
    if (!points) continue;

    const line = createArrowLineElement(
      ASSOCIATION_LINE_SHAPE,
      points,
      { marker: ArrowLineMarkerType.none },
      { marker: ArrowLineMarkerType.none },
      [],
      {
        strokeColor: ASSOCIATION_STROKE_COLOR,
        strokeWidth: ASSOCIATION_STROKE_WIDTH,
      }
    ) as PlaitCanvasAssociationLine;
    line.locked = true;
    line.canvasAssociation = {
      version: CANVAS_ASSOCIATION_VERSION,
      boardId,
      sourceElementId,
      resultElementId,
      ...(options.workflowId?.trim()
        ? { workflowId: options.workflowId.trim() }
        : {}),
      ...(options.taskId?.trim() ? { taskId: options.taskId.trim() } : {}),
    };

    Transforms.insertNode(board, line, [board.children.length]);
    lines.push(line);
  }

  return lines;
}

export function retargetCanvasAssociationLines(
  board: PlaitBoard,
  options: RetargetCanvasAssociationLinesOptions
): PlaitCanvasAssociationLine[] {
  const boardId = options.boardId.trim();
  const resultElementId = options.resultElementId.trim();
  if (!boardId || !resultElementId) return [];

  const elementsById = indexCanvasElementsById(board.children);
  const result = elementsById.get(resultElementId);
  if (!isCanvasAssociationTarget(result)) return [];

  const lines: PlaitCanvasAssociationLine[] = [];
  const uniqueSourceIds = new Set(
    options.sourceElementIds.map((elementId) => elementId.trim())
  );

  for (const sourceElementId of uniqueSourceIds) {
    if (!sourceElementId) continue;

    const source = elementsById.get(sourceElementId);
    if (!isCanvasAssociationCandidate(source)) continue;

    const existing = findExistingAssociationLine(
      board,
      boardId,
      sourceElementId,
      resultElementId
    );
    const retargetable = findRetargetableAssociationLine(board, elementsById, {
      boardId,
      sourceElementId,
      workflowId: options.workflowId,
      previousResultElementId: options.previousResultElementId,
    });

    if (sourceElementId === resultElementId) {
      if (retargetable) {
        const index = board.children.findIndex(
          (element) => element.id === retargetable.id
        );
        if (index >= 0) Transforms.removeNode(board, [index]);
      }
      continue;
    }

    if (existing) {
      const existingIndex = board.children.findIndex(
        (element) => element.id === existing.id
      );
      const nextMetadata = buildAssociationMetadata(
        existing.canvasAssociation,
        {
          boardId,
          sourceElementId,
          resultElementId,
          workflowId: options.workflowId,
          taskId: options.taskId,
        }
      );
      if (
        existingIndex >= 0 &&
        !areAssociationMetadataEqual(existing.canvasAssociation, nextMetadata)
      ) {
        Transforms.setNode(
          board,
          {
            canvasAssociation: nextMetadata,
          } as Partial<PlaitCanvasAssociationLine>,
          [existingIndex]
        );
      }
      if (retargetable && retargetable.id !== existing.id) {
        const staleIndex = board.children.findIndex(
          (element) => element.id === retargetable.id
        );
        if (staleIndex >= 0) Transforms.removeNode(board, [staleIndex]);
      }
      const updatedExisting = board.children.find(
        (element) => element.id === existing.id
      );
      if (isCanvasAssociationLine(updatedExisting)) {
        lines.push(updatedExisting);
      }
      continue;
    }

    if (!retargetable) {
      lines.push(
        ...createCanvasAssociationLines(board, {
          boardId,
          sourceElementIds: [sourceElementId],
          resultElementId,
          workflowId: options.workflowId,
          taskId: options.taskId,
        })
      );
      continue;
    }

    const points = resolveAssociationPoints(board, source, result);
    if (!points) continue;
    const retargetableIndex = board.children.findIndex(
      (element) => element.id === retargetable.id
    );
    if (retargetableIndex < 0) continue;

    Transforms.setNode(
      board,
      {
        points,
        shape: ASSOCIATION_LINE_SHAPE,
        canvasAssociation: buildAssociationMetadata(
          retargetable.canvasAssociation,
          {
            boardId,
            sourceElementId,
            resultElementId,
            workflowId: options.workflowId,
            taskId: options.taskId,
          }
        ),
      } as Partial<PlaitCanvasAssociationLine>,
      [retargetableIndex]
    );
    lines.push(board.children[retargetableIndex] as PlaitCanvasAssociationLine);
  }

  return lines;
}

export function reconcileCanvasAssociationLines(
  board: PlaitBoard
): ReconcileCanvasAssociationResult {
  const associationLineEntries = board.children
    .map((element, index) => ({ element, index }))
    .filter(
      (
        entry
      ): entry is { element: PlaitCanvasAssociationLine; index: number } =>
        isCanvasAssociationLine(entry.element)
    );
  if (associationLineEntries.length === 0) {
    return { removed: 0, updated: 0 };
  }

  const elementsById = indexCanvasElementsById(board.children);
  const removeIndexes: number[] = [];
  const updates: Array<{
    index: number;
    points: [Point, Point];
    restoreManagedState: boolean;
    restoreManagedStyle: boolean;
    restoreManagedShape: boolean;
  }> = [];

  associationLineEntries.forEach(({ element, index }) => {
    const { sourceElementId, resultElementId } = element.canvasAssociation;
    const source = elementsById.get(sourceElementId);
    const result = elementsById.get(resultElementId);
    if (
      !isCanvasAssociationCandidate(source) ||
      !isCanvasAssociationTarget(result)
    ) {
      removeIndexes.push(index);
      return;
    }

    const points = resolveAssociationPoints(board, source, result);
    if (!points) {
      removeIndexes.push(index);
      return;
    }

    const restoreManagedState =
      element.locked !== true ||
      Boolean(element.source.boundId || element.source.connection) ||
      Boolean(element.target.boundId || element.target.connection);
    const restoreManagedStyle =
      element.strokeColor !== ASSOCIATION_STROKE_COLOR ||
      element.strokeWidth !== ASSOCIATION_STROKE_WIDTH;
    const restoreManagedShape = element.shape !== ASSOCIATION_LINE_SHAPE;
    if (
      !arePointsEqual(element.points, points) ||
      restoreManagedState ||
      restoreManagedStyle ||
      restoreManagedShape
    ) {
      updates.push({
        index,
        points,
        restoreManagedState,
        restoreManagedStyle,
        restoreManagedShape,
      });
    }
  });

  for (const update of updates) {
    const patch: Partial<PlaitCanvasAssociationLine> = {
      points: update.points,
    };
    if (update.restoreManagedState) {
      patch.locked = true;
      patch.source = { marker: ArrowLineMarkerType.none };
      patch.target = { marker: ArrowLineMarkerType.none };
    }
    if (update.restoreManagedStyle) {
      patch.strokeColor = ASSOCIATION_STROKE_COLOR;
      patch.strokeWidth = ASSOCIATION_STROKE_WIDTH;
    }
    if (update.restoreManagedShape) {
      patch.shape = ASSOCIATION_LINE_SHAPE;
    }
    Transforms.setNode(board, patch, [update.index]);
  }

  for (const index of removeIndexes.sort((a, b) => b - a)) {
    Transforms.removeNode(board, [index]);
  }

  return { removed: removeIndexes.length, updated: updates.length };
}

function reconcileAffectedCanvasAssociationLines(
  board: PlaitBoard,
  index: CanvasAssociationIndex,
  affectedElementIds: ReadonlySet<string>,
  directlyAffectedLineIds: ReadonlySet<string>,
  managedLineOperationIds: Set<string>
): ReconcileCanvasAssociationResult {
  const affectedLineIds = new Set(directlyAffectedLineIds);
  for (const elementId of affectedElementIds) {
    const lineIds = index.lineIdsByEndpointId.get(elementId);
    if (!lineIds) continue;
    for (const lineId of lineIds) affectedLineIds.add(lineId);
  }
  if (affectedLineIds.size === 0) return { removed: 0, updated: 0 };

  const removeEntries: Array<{
    index: number;
    line: PlaitCanvasAssociationLine;
  }> = [];
  const updates: Array<{
    index: number;
    points: [Point, Point];
    restoreManagedState: boolean;
    restoreManagedStyle: boolean;
    restoreManagedShape: boolean;
  }> = [];

  for (const lineId of affectedLineIds) {
    const indexedLine = index.linesById.get(lineId);
    if (!indexedLine) continue;
    const lineIndex = board.children.findIndex((item) => item.id === lineId);
    if (lineIndex < 0) {
      removeLineFromIndex(index, indexedLine);
      continue;
    }
    const line = board.children[lineIndex];
    if (!isCanvasAssociationLine(line)) {
      removeLineFromIndex(index, indexedLine);
      continue;
    }

    const { sourceElementId, resultElementId } = line.canvasAssociation;
    const source = index.elementsById.get(sourceElementId);
    const result = index.elementsById.get(resultElementId);
    if (
      !isCanvasAssociationCandidate(source) ||
      !isCanvasAssociationTarget(result)
    ) {
      removeEntries.push({ index: lineIndex, line });
      continue;
    }

    const points = resolveAssociationPoints(board, source, result);
    if (!points) {
      removeEntries.push({ index: lineIndex, line });
      continue;
    }
    const restoreManagedState =
      line.locked !== true ||
      Boolean(line.source.boundId || line.source.connection) ||
      Boolean(line.target.boundId || line.target.connection);
    const restoreManagedStyle =
      line.strokeColor !== ASSOCIATION_STROKE_COLOR ||
      line.strokeWidth !== ASSOCIATION_STROKE_WIDTH;
    const restoreManagedShape = line.shape !== ASSOCIATION_LINE_SHAPE;
    if (
      !arePointsEqual(line.points, points) ||
      restoreManagedState ||
      restoreManagedStyle ||
      restoreManagedShape
    ) {
      updates.push({
        index: lineIndex,
        points,
        restoreManagedState,
        restoreManagedStyle,
        restoreManagedShape,
      });
    }
  }

  for (const update of updates) {
    const patch: Partial<PlaitCanvasAssociationLine> = {
      points: update.points,
    };
    if (update.restoreManagedState) {
      patch.locked = true;
      patch.source = { marker: ArrowLineMarkerType.none };
      patch.target = { marker: ArrowLineMarkerType.none };
    }
    if (update.restoreManagedStyle) {
      patch.strokeColor = ASSOCIATION_STROKE_COLOR;
      patch.strokeWidth = ASSOCIATION_STROKE_WIDTH;
    }
    if (update.restoreManagedShape) {
      patch.shape = ASSOCIATION_LINE_SHAPE;
    }
    const lineId = board.children[update.index]?.id;
    if (lineId) managedLineOperationIds.add(lineId);
    Transforms.setNode(board, patch, [update.index]);
  }
  for (const entry of removeEntries.sort((a, b) => b.index - a.index)) {
    removeLineFromIndex(index, entry.line);
    managedLineOperationIds.add(entry.line.id);
    Transforms.removeNode(board, [entry.index]);
  }

  return { removed: removeEntries.length, updated: updates.length };
}

export const withCanvasAssociation: PlaitPlugin = (board) => {
  const { afterChange } = board;
  let applyingOperationDepth = 0;
  let reconciling = false;
  let appliedOperationShouldSave = false;
  const originalApply = board.apply;
  board.apply = ((operation: PlaitOperation) => {
    applyingOperationDepth += 1;
    if (!reconciling) {
      appliedOperationShouldSave ||=
        PlaitHistoryBoard.isSaving(board) !== false;
    }
    try {
      return originalApply(operation);
    } finally {
      applyingOperationDepth -= 1;
    }
  }) as typeof board.apply;

  // 清理加载快照里已经失效的孤线，不把初始化修复写入 Undo 历史。
  PlaitHistoryBoard.withoutSaving(board, () => {
    reconcileCanvasAssociationLines(board);
  });
  let index = createCanvasAssociationIndex(board.children);
  const pendingElementIds = new Set<string>();
  const pendingLineIds = new Set<string>();
  const managedLineOperationIds = new Set<string>();
  let reconcileScheduled = false;
  let childrenReplacedSinceChange = false;
  let pendingReconcileShouldSave = false;

  const rebuildIndexAfterChildrenReplacement = (): void => {
    index = createCanvasAssociationIndex(board.children);
    pendingElementIds.clear();
    pendingLineIds.clear();
    managedLineOperationIds.clear();
    pendingReconcileShouldSave = false;
    for (const lineId of index.linesById.keys()) {
      pendingLineIds.add(lineId);
    }
    childrenReplacedSinceChange = false;
  };

  const reconcileChildrenReplacement = (): void => {
    reconciling = true;
    try {
      PlaitHistoryBoard.withoutSaving(board, () => {
        reconcileCanvasAssociationLines(board);
      });
    } finally {
      reconciling = false;
    }
    rebuildIndexAfterChildrenReplacement();
  };

  // Wrapper board reuse replaces children directly and renders immediately
  // without afterChange, so reconcile the loaded snapshot synchronously.
  let currentChildren = board.children;
  Object.defineProperty(board, 'children', {
    configurable: true,
    enumerable: true,
    get: () => currentChildren,
    set: (nextChildren: PlaitElement[]) => {
      const isSnapshotReplacement = applyingOperationDepth === 0;
      if (isSnapshotReplacement) {
        childrenReplacedSinceChange = true;
      }
      currentChildren = nextChildren;
      if (isSnapshotReplacement) {
        reconcileChildrenReplacement();
      }
    },
  });

  board.afterChange = () => {
    const childrenWereReplaced = childrenReplacedSinceChange;
    const sourceOperationShouldSave = appliedOperationShouldSave;
    appliedOperationShouldSave = false;
    if (childrenReplacedSinceChange) {
      rebuildIndexAfterChildrenReplacement();
    } else {
      updateCanvasAssociationIndex(
        board,
        index,
        board.operations,
        pendingElementIds,
        pendingLineIds,
        managedLineOperationIds
      );
    }
    afterChange();
    if (pendingElementIds.size > 0 || pendingLineIds.size > 0) {
      pendingReconcileShouldSave ||=
        !childrenWereReplaced && sourceOperationShouldSave;
    }
    if (
      reconcileScheduled ||
      reconciling ||
      (pendingElementIds.size === 0 && pendingLineIds.size === 0)
    ) {
      return;
    }

    reconcileScheduled = true;
    queueMicrotask(() => {
      reconcileScheduled = false;
      if (reconciling || !PlaitBoard.isAlive(board)) return;

      if (childrenReplacedSinceChange) {
        rebuildIndexAfterChildrenReplacement();
      }

      const affectedElementIds = new Set(pendingElementIds);
      const affectedLineIds = new Set(pendingLineIds);
      pendingElementIds.clear();
      pendingLineIds.clear();
      const shouldSave = pendingReconcileShouldSave;
      pendingReconcileShouldSave = false;

      reconciling = true;
      try {
        const reconcile = () => {
          reconcileAffectedCanvasAssociationLines(
            board,
            index,
            affectedElementIds,
            affectedLineIds,
            managedLineOperationIds
          );
        };
        if (shouldSave) {
          PlaitHistoryBoard.withMerging(board, reconcile);
        } else {
          PlaitHistoryBoard.withoutSaving(board, reconcile);
        }
      } finally {
        reconciling = false;
      }
    });
  };

  return board;
};
