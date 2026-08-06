import type { Point, PlaitElement } from '@plait/core';
import { PlaitBoard, getRectangleByElements } from '@plait/core';

export const CANVAS_INSERTION_LAYOUT = {
  DEFAULT_VERTICAL_GAP: 50,
  DEFAULT_HORIZONTAL_GAP: 20,
  TEXT_DEFAULT_WIDTH: 300,
  TEXT_LINE_HEIGHT: 24,
  MEDIA_DEFAULT_SIZE: 400,
  MEDIA_MAX_SIZE: 600,
  DEFAULT_POINT: [100, 100] as Point,
};

/**
 * 计算图片合理的显示尺寸（与 buildImage 逻辑一致）
 * 将原始尺寸缩放到合理大小，避免图片过大
 */
export function calculateImageDisplayDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxSize: number = CANVAS_INSERTION_LAYOUT.MEDIA_MAX_SIZE
): { width: number; height: number } {
  if (!naturalWidth || !naturalHeight) {
    return { width: CANVAS_INSERTION_LAYOUT.MEDIA_DEFAULT_SIZE, height: CANVAS_INSERTION_LAYOUT.MEDIA_DEFAULT_SIZE };
  }

  let width = naturalWidth;
  let height = naturalHeight;

  // 使用与 buildImage 一致的缩放逻辑
  if (width > maxSize || height > maxSize) {
    const widthScale = maxSize / width;
    const heightScale = maxSize / height;
    const scale = Math.min(widthScale, heightScale);
    width = width * scale;
    height = height * scale;
  }

  return { width, height };
}

const CANVAS_INSERTION_DEBUG_FLAG = 'aitu:debug-canvas-insertion';

type InsertionAlignment = 'left' | 'center';

interface InsertionPointOptions {
  verticalGap?: number;
  align?: InsertionAlignment;
  targetWidth?: number;
  emptyPoint?: Point;
  logPrefix?: string;
}

interface TextSizeOptions {
  maxWidth?: number;
  lineHeight?: number;
}

interface FlowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FlowLayoutOptions {
  horizontalGap?: number;
  verticalGap?: number;
  rowWidth?: number;
}

export interface BatchInsertionFlowState {
  startX: number;
  startY: number;
  cursorX: number;
  cursorY: number;
  rowRightLimit: number;
  horizontalGap: number;
  verticalGap: number;
  rowMaxHeight: number;
  bounds: FlowBounds | null;
}

export interface ViewportCanvasMetrics {
  width: number;
  height: number;
  zoom: number;
}

export function shouldDebugCanvasInsertion(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage?.getItem(CANVAS_INSERTION_DEBUG_FLAG) === '1';
  } catch {
    return false;
  }
}

export function logCanvasInsertionDebug(
  label: string,
  payload?: Record<string, unknown>
): void {
  if (!shouldDebugCanvasInsertion()) {
    return;
  }

  if (payload) {
    console.info(label, payload);
    return;
  }

  console.info(label);
}

function getFallbackViewportMetric(axis: 'width' | 'height'): number {
  if (typeof window !== 'undefined') {
    return axis === 'width' ? window.innerWidth : window.innerHeight;
  }

  return axis === 'width'
    ? CANVAS_INSERTION_LAYOUT.MEDIA_DEFAULT_SIZE
    : CANVAS_INSERTION_LAYOUT.MEDIA_DEFAULT_SIZE;
}

export function getViewportCanvasMetrics(board: PlaitBoard): ViewportCanvasMetrics {
  const zoom = Math.max(Number((board as any)?.viewport?.zoom) || 1, 0.001);
  let containerRect: DOMRect | { width: number; height: number } | undefined;

  try {
    const boardContainer = PlaitBoard.getBoardContainer(board);
    containerRect = boardContainer?.getBoundingClientRect?.();
  } catch {
    containerRect = undefined;
  }

  const width = containerRect && containerRect.width > 0
    ? containerRect.width / zoom
    : getFallbackViewportMetric('width') / zoom;
  const height = containerRect && containerRect.height > 0
    ? containerRect.height / zoom
    : getFallbackViewportMetric('height') / zoom;

  return { width, height, zoom };
}

export function getViewportAwareCardWidth(
  board: PlaitBoard,
  ratio = 0.5
): number {
  const { width } = getViewportCanvasMetrics(board);
  return Math.max(1, Math.round(width * ratio));
}

function mergeFlowBounds(
  current: FlowBounds | null,
  point: Point,
  size: { width: number; height: number }
): FlowBounds {
  const nextBounds = {
    x: point[0],
    y: point[1],
    width: size.width,
    height: size.height,
  };

  if (!current) {
    return nextBounds;
  }

  const left = Math.min(current.x, nextBounds.x);
  const top = Math.min(current.y, nextBounds.y);
  const right = Math.max(current.x + current.width, nextBounds.x + nextBounds.width);
  const bottom = Math.max(current.y + current.height, nextBounds.y + nextBounds.height);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function createBatchInsertionFlowState(
  board: PlaitBoard,
  startPoint: Point,
  options: FlowLayoutOptions = {}
): BatchInsertionFlowState {
  const { width } = getViewportCanvasMetrics(board);
  const {
    horizontalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_HORIZONTAL_GAP,
    verticalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_VERTICAL_GAP,
    rowWidth = width,
  } = options;

  return {
    startX: startPoint[0],
    startY: startPoint[1],
    cursorX: startPoint[0],
    cursorY: startPoint[1],
    rowRightLimit: startPoint[0] + Math.max(1, Math.round(rowWidth)),
    horizontalGap,
    verticalGap,
    rowMaxHeight: 0,
    bounds: null,
  };
}

export function advanceBatchInsertionFlow(
  state: BatchInsertionFlowState,
  size: { width: number; height: number }
): { point: Point; state: BatchInsertionFlowState; wrapped: boolean } {
  const wrapped =
    state.cursorX > state.startX &&
    state.cursorX + size.width > state.rowRightLimit;

  const nextState: BatchInsertionFlowState = wrapped
    ? {
        ...state,
        cursorX: state.startX,
        cursorY: state.cursorY + state.rowMaxHeight + state.verticalGap,
        rowMaxHeight: 0,
      }
    : { ...state };

  const point = [nextState.cursorX, nextState.cursorY] as Point;
  nextState.cursorX = point[0] + size.width + nextState.horizontalGap;
  nextState.rowMaxHeight = Math.max(nextState.rowMaxHeight, size.height);
  nextState.bounds = mergeFlowBounds(nextState.bounds, point, size);

  return {
    point,
    state: nextState,
    wrapped,
  };
}

/**
 * 网格布局预计算：一次性算出所有素材的插入位置
 *
 * 相比 advanceBatchInsertionFlow 的逐项流式布局，此函数会先收集所有素材的真实尺寸，
 * 再按固定列数（根据画布宽度动态计算）将素材均匀分布到各行中。
 *
 * 每一行的行高由该行最高素材决定，每一列的列宽由该列最宽素材决定。
 * 这确保了不同比例的图片在网格中都能获得合理的间距，不会出现叠加问题。
 *
 * @param startPoint   起始坐标 [x, y]
 * @param itemSizes    每个素材的预估尺寸数组
 * @param options      可选配置（画布宽度、最大列数、间距）
 * @returns            每个素材的位置数组 + 整体边界
 */
export function precalculateGridLayout(
  startPoint: Point,
  itemSizes: { width: number; height: number }[],
  options: {
    canvasWidth?: number;
    maxColumns?: number;
    horizontalGap?: number;
    verticalGap?: number;
  } = {}
): { positions: Point[]; bounds: FlowBounds } {
  const {
    canvasWidth,
    maxColumns = 5,
    horizontalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_HORIZONTAL_GAP,
    verticalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_VERTICAL_GAP,
  } = options;

  if (itemSizes.length === 0) {
    return {
      positions: [],
      bounds: { x: startPoint[0], y: startPoint[1], width: 0, height: 0 },
    };
  }

  // 根据画布宽度和平均素材宽度计算最优列数
  const avgWidth =
    itemSizes.reduce((sum, s) => sum + s.width, 0) / itemSizes.length;
  let columns: number;
  if (canvasWidth && canvasWidth > 0) {
    columns = Math.max(
      1,
      Math.min(
        maxColumns,
        Math.floor((canvasWidth + horizontalGap) / (avgWidth + horizontalGap))
      )
    );
  } else {
    columns = Math.min(maxColumns, itemSizes.length);
  }

  // 将素材按行分组
  const rowCount = Math.ceil(itemSizes.length / columns);
  const rows: { width: number; height: number }[][] = [];
  for (let i = 0; i < itemSizes.length; i += columns) {
    rows.push(itemSizes.slice(i, Math.min(i + columns, itemSizes.length)));
  }

  // 计算每列的最大宽度
  const columnWidths: number[] = Array(columns).fill(0);
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < columns; c++) {
      const idx = r * columns + c;
      if (idx < itemSizes.length) {
        columnWidths[c] = Math.max(columnWidths[c], itemSizes[idx].width);
      }
    }
  }

  // 计算每行的最大高度
  const rowHeights: number[] = rows.map((row) =>
    Math.max(...row.map((s) => s.height))
  );

  // 计算每列的 X 偏移量
  const xOffsets: number[] = [startPoint[0]];
  for (let c = 1; c < columns; c++) {
    xOffsets.push(xOffsets[c - 1] + columnWidths[c - 1] + horizontalGap);
  }

  // 计算每行的 Y 偏移量
  const yOffsets: number[] = [startPoint[1]];
  for (let r = 1; r < rowCount; r++) {
    yOffsets.push(yOffsets[r - 1] + rowHeights[r - 1] + verticalGap);
  }

  // 为每个素材生成坐标
  const positions: Point[] = [];
  for (let i = 0; i < itemSizes.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    positions.push([xOffsets[col], yOffsets[row]] as Point);
  }

  // 计算整体边界
  const totalWidth =
    columnWidths.length > 0
      ? xOffsets[columns - 1] + columnWidths[columns - 1] - startPoint[0]
      : 0;
  const totalHeight =
    rowHeights.length > 0
      ? yOffsets[rowCount - 1] + rowHeights[rowCount - 1] - startPoint[1]
      : 0;
  const bounds: FlowBounds = {
    x: startPoint[0],
    y: startPoint[1],
    width: totalWidth,
    height: totalHeight,
  };

  return { positions, bounds };
}

export function precalculateGroupedGridLayout<T extends { groupId?: string }>(
  startPoint: Point,
  items: T[],
  itemSizes: { width: number; height: number }[],
  options: {
    canvasWidth?: number;
    maxColumns?: number;
    horizontalGap?: number;
    verticalGap?: number;
  } = {}
): { positions: Point[]; bounds: FlowBounds } {
  const {
    horizontalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_HORIZONTAL_GAP,
    verticalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_VERTICAL_GAP,
  } = options;

  if (items.length === 0) {
    return {
      positions: [],
      bounds: { x: startPoint[0], y: startPoint[1], width: 0, height: 0 },
    };
  }

  const groups = groupInsertionItems(items);
  const positions: Point[] = Array(items.length);
  let cursorY = startPoint[1];
  let bounds: FlowBounds | null = null;
  let offset = 0;

  for (const group of groups) {
    const groupSizes = itemSizes.slice(offset, offset + group.length);
    const groupLayout = precalculateGridLayout(
      [startPoint[0], cursorY],
      groupSizes,
      options
    );

    groupLayout.positions.forEach((point, index) => {
      positions[offset + index] = point;
      bounds = mergeFlowBounds(bounds, point, groupSizes[index]);
    });

    cursorY =
      groupLayout.bounds.y + groupLayout.bounds.height + verticalGap;
    offset += group.length;
  }

  return {
    positions,
    bounds:
      bounds || {
        x: startPoint[0],
        y: startPoint[1],
        width: 0,
        height: 0,
      },
  };
}

export function getBatchInsertionFlowCenter(
  state: Pick<BatchInsertionFlowState, 'bounds'>
): Point | undefined {
  if (!state.bounds) {
    return undefined;
  }

  return [
    state.bounds.x + state.bounds.width / 2,
    state.bounds.y + state.bounds.height / 2,
  ] as Point;
}

function resolveAlignedX(
  rect: { x: number; width: number },
  align: InsertionAlignment,
  targetWidth?: number
): number {
  if (align === 'center') {
    const centerX = rect.x + rect.width / 2;
    return typeof targetWidth === 'number' ? centerX - targetWidth / 2 : centerX;
  }

  return rect.x;
}

function getSavedSelectionElements(board: PlaitBoard): PlaitElement[] {
  const appState = (board as any).appState;
  const savedElementIds: string[] = Array.isArray(appState?.lastSelectedElementIds)
    ? appState.lastSelectedElementIds
    : [];

  if (savedElementIds.length === 0 || !Array.isArray(board.children)) {
    return [];
  }

  const selectedIds = new Set(savedElementIds);
  const elementsById = new Map<string, PlaitElement>();

  for (const element of board.children as PlaitElement[]) {
    if (selectedIds.has(element.id)) {
      elementsById.set(element.id, element);
    }
  }

  return savedElementIds
    .map((id: string) => elementsById.get(id))
    .filter((element): element is PlaitElement => Boolean(element));
}

export function getInsertionPointFromSavedSelection(
  board: PlaitBoard,
  options: InsertionPointOptions = {}
): Point | undefined {
  const elements = getSavedSelectionElements(board);
  if (elements.length === 0) {
    return undefined;
  }

  const {
    verticalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_VERTICAL_GAP,
    align = 'left',
    targetWidth,
    logPrefix = 'CanvasInsertion',
  } = options;

  try {
    const rect = getRectangleByElements(board, elements, false);
    return [
      resolveAlignedX(rect, align, targetWidth),
      rect.y + rect.height + verticalGap,
    ] as Point;
  } catch (error) {
    console.warn(`[${logPrefix}] Error calculating insertion point:`, error);
    return undefined;
  }
}

export function getBottomMostInsertionPoint(
  board: PlaitBoard,
  options: InsertionPointOptions = {}
): Point | undefined {
  const {
    verticalGap = CANVAS_INSERTION_LAYOUT.DEFAULT_VERTICAL_GAP,
    align = 'left',
    targetWidth,
    emptyPoint,
  } = options;

  if (!Array.isArray(board.children) || board.children.length === 0) {
    return emptyPoint;
  }

  let bottomRect: { x: number; y: number; width: number; height: number } | null =
    null;
  let maxBottomY = 0;

  for (const element of board.children as PlaitElement[]) {
    try {
      const rect = getRectangleByElements(board, [element], false);
      const bottomY = rect.y + rect.height;
      if (bottomY > maxBottomY) {
        maxBottomY = bottomY;
        bottomRect = rect;
      }
    } catch {
      // Ignore elements without a usable rectangle.
    }
  }

  if (!bottomRect) {
    const fallbackX = emptyPoint?.[0] ?? CANVAS_INSERTION_LAYOUT.DEFAULT_POINT[0];
    return [fallbackX, verticalGap] as Point;
  }

  return [
    resolveAlignedX(bottomRect, align, targetWidth),
    bottomRect.y + bottomRect.height + verticalGap,
  ] as Point;
}

export function estimateCanvasTextSize(
  text: string,
  options: TextSizeOptions = {}
): { width: number; height: number } {
  const {
    maxWidth = CANVAS_INSERTION_LAYOUT.TEXT_DEFAULT_WIDTH,
    lineHeight = CANVAS_INSERTION_LAYOUT.TEXT_LINE_HEIGHT,
  } = options;
  const lines = text.split('\n');
  const maxLineLength = Math.max(...lines.map((line) => line.length));

  return {
    width: Math.min(maxLineLength * 8, maxWidth),
    height: lines.length * lineHeight,
  };
}

export function groupInsertionItems<T extends { groupId?: string }>(
  items: T[]
): T[][] {
  const result: T[][] = [];
  let currentGroup: T[] = [];
  let currentGroupId: string | undefined;

  const flush = () => {
    if (currentGroup.length > 0) {
      result.push(currentGroup);
      currentGroup = [];
    }
  };

  for (const item of items) {
    if (!item.groupId) {
      flush();
      result.push([item]);
      currentGroupId = undefined;
      continue;
    }

    if (currentGroupId === item.groupId) {
      currentGroup.push(item);
    } else {
      flush();
      currentGroupId = item.groupId;
      currentGroup = [item];
    }
  }

  flush();

  return result;
}
