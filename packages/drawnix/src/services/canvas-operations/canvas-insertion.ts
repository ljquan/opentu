/**
 * 画布插入服务
 *
 * 将AI生成的内容（文本、图片、视频）插入到画布中
 */

import {
  createBoard,
  PlaitBoard,
  Point,
  Transforms,
  type PlaitElement,
} from '@plait/core';
import { DrawTransforms } from '@plait/draw';
import {
  insertImageNodeAtPoint,
  insertImageFromUrl,
  loadImageElementForCanvas,
} from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import {
  insertAudioFromUrl,
  resolveAudioCardDimensions,
  type AudioCardMetadata,
} from '../../data/audio';
import { scrollToPointIfNeeded } from '../../utils/selection-utils';
import { parseMarkdownToCards } from '../../utils/markdown-to-cards';
import { insertCardsToCanvas } from '../../utils/insert-cards';
import type { MCPResult } from '../../mcp/types';
import type { DataURL } from '../../types';
import { parseSizeToPixels } from '../../utils/size-ratio';
import {
  getSelectedInsertionFrame,
  insertMediaIntoSelectedFrame,
} from '../../utils/frame-insertion-utils';
import { getCanvasBoard as readCanvasBoard } from './canvas-board-ref';
import {
  CANVAS_INSERTION_LAYOUT as LAYOUT_CONSTANTS,
  createBatchInsertionFlowState,
  estimateCanvasTextSize,
  getBatchInsertionFlowCenter,
  getBottomMostInsertionPoint,
  getInsertionPointFromSavedSelection,
  getViewportAwareCardWidth,
  getViewportCanvasMetrics,
  logCanvasInsertionDebug,
  precalculateGroupedGridLayout,
} from '../../utils/canvas-insertion-layout';
import {
  normalizeSvg,
  parseSvgDimensions,
  svgToDataUrl,
} from '../../utils/svg-utils';

export {
  setCanvasBoard,
  clearCanvasBoard,
  getCanvasBoard,
  getCanvasBoardBinding,
} from './canvas-board-ref';

export { parseSizeToPixels };

/**
 * 内容类型
 */
export type ContentType = 'text' | 'image' | 'video' | 'audio' | 'svg';

/**
 * 单个要插入的内容项
 */
export interface InsertionItem {
  /** 内容类型 */
  type: ContentType;
  /** 内容（文本内容或URL） */
  content: string;
  /** 标签/描述，用于显示 */
  label?: string;
  /** 是否为同组内容（相同输入产出，横向排列） */
  groupId?: string;
  /** 图片/视频尺寸（可选，用于立即插入不等待加载） */
  dimensions?: { width: number; height: number };
  /** 插入成功前确认图片能够加载（用于用户主动插入） */
  waitForImageLoad?: boolean;
  /** 额外元数据（音频卡片等） */
  metadata?: Record<string, unknown>;
}

/**
 * 画布插入参数
 */
export interface CanvasInsertionParams {
  /** 要插入的内容列表 */
  items: InsertionItem[];
  /** 当前画布实例（组件内调用时优先使用，避免依赖全局引用初始化时序） */
  board?: PlaitBoard;
  /** 起始位置 [leftX, topY]（可选，默认使用当前选中元素或画布底部，左对齐） */
  startPoint?: Point;
  /** 垂直间距（默认50px） */
  verticalGap?: number;
  /** 水平间距（默认20px） */
  horizontalGap?: number;
  /** 画板切换后阻止异步插入写入复用的 Board 实例。 */
  boardGuard?: () => boolean;
}

export interface CanvasInsertionResultItem {
  type: ContentType;
  point: Point;
  elementId?: string;
  size: {
    width: number;
    height: number;
  };
}

export interface CanvasInsertionResultData {
  insertedCount: number;
  items: CanvasInsertionResultItem[];
  firstElementId?: string;
  firstElementPosition?: Point;
  firstElementSize?: {
    width: number;
    height: number;
  };
}

export interface MediaFlowResult {
  type: 'image' | 'video' | 'audio';
  url: string;
  dimensions?: { width: number; height: number };
  metadata?: Record<string, unknown>;
}

function readStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

interface InsertedCanvasItem {
  elementIds: string[];
  size: { width: number; height: number };
}

function buildGenerationMetadataPatch(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  const prompt = readStringMetadata(metadata, 'prompt');
  const explicitGenerationPrompt =
    readStringMetadata(metadata, 'generationPrompt') ||
    readStringMetadata(metadata, 'aiPrompt');
  const generationTaskId = readStringMetadata(metadata, 'generationTaskId');
  const generationAnchorId = readStringMetadata(metadata, 'generationAnchorId');
  const generationPrompt =
    explicitGenerationPrompt ||
    (generationTaskId || generationAnchorId ? prompt : undefined);
  const patch: Record<string, unknown> = {};

  if (prompt) {
    patch.prompt = prompt;
  }
  if (generationPrompt) {
    patch.aiPrompt = generationPrompt;
    patch.generationPrompt = generationPrompt;
  }
  if (generationTaskId) {
    patch.generationTaskId = generationTaskId;
  }
  if (generationAnchorId) {
    patch.generationAnchorId = generationAnchorId;
  }

  return patch;
}

function attachGenerationMetadataToInsertedElements(
  board: PlaitBoard,
  elementIds: readonly string[],
  metadata: Record<string, unknown> | undefined
): void {
  const patch = buildGenerationMetadataPatch(metadata);
  if (Object.keys(patch).length === 0) {
    return;
  }

  for (const elementId of elementIds) {
    const index = board.children.findIndex(
      (element) => element.id === elementId
    );
    if (index < 0) continue;
    Transforms.setNode(
      board,
      patch as Partial<PlaitBoard['children'][number]>,
      [index]
    );
  }
}

/**
 * 插入单个文本项到画布
 * - 有 title 时 → 直接以 Card 方式插入
 * - 包含 Markdown 特征 → 解析为 Card 插入
 * - 普通文本 → 直接插入文本元素
 */
async function insertTextToCanvas(
  board: PlaitBoard,
  text: string,
  point: Point,
  title?: string,
  cardWidth: number = getViewportAwareCardWidth(board),
  boardGuard?: () => boolean
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  if (boardGuard && !boardGuard()) {
    throw new Error('画板已切换，取消本次插入');
  }
  // 有 title 时，直接以 Card 方式插入（跳过 Markdown 检测）
  if (title) {
    const insertedIds = insertCardsToCanvas(
      board,
      [{ title, body: text }],
      point,
      cardWidth,
      true
    );
    return {
      elementId: insertedIds[0],
      size: { width: cardWidth, height: 120 },
    };
  }

  // 尝试解析为 Markdown Card 块
  const cardBlocks = parseMarkdownToCards(text);
  if (cardBlocks && cardBlocks.length > 0) {
    const insertedIds = insertCardsToCanvas(
      board,
      cardBlocks,
      point,
      cardWidth,
      true
    );
    const cols = Math.min(cardBlocks.length, 3);
    const rows = Math.ceil(cardBlocks.length / 3);
    return {
      elementId: insertedIds[0],
      size: {
        width: cols * (cardWidth + 20) - 20,
        height: rows * (120 + 20) - 20,
      },
    };
  }

  // 普通文本 → 直接插入
  const childrenCountBefore = board.children.length;
  DrawTransforms.insertText(board, point, text);
  const insertedElement = board.children[childrenCountBefore] as
    | { id?: string }
    | undefined;
  return {
    elementId: insertedElement?.id,
    size: estimateCanvasTextSize(text),
  };
}

function estimateTextInsertionSize(
  board: PlaitBoard,
  text: string,
  title?: string
): { width: number; height: number } {
  const cardWidth = getViewportAwareCardWidth(board);

  if (title) {
    return { width: cardWidth, height: 120 };
  }

  const cardBlocks = parseMarkdownToCards(text);
  if (cardBlocks && cardBlocks.length > 0) {
    const cols = Math.min(cardBlocks.length, 3);
    const rows = Math.ceil(cardBlocks.length / 3);
    return {
      width: cols * (cardWidth + 20) - 20,
      height: rows * (120 + 20) - 20,
    };
  }

  return estimateCanvasTextSize(text);
}

function estimateInsertionItemSize(
  board: PlaitBoard,
  item: InsertionItem
): { width: number; height: number } {
  if (item.type === 'text') {
    return estimateTextInsertionSize(board, item.content, item.label);
  }

  if (item.type === 'video') {
    return (
      item.dimensions || {
        width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE,
        height: Math.round(LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE * (9 / 16)),
      }
    );
  }

  if (item.type === 'audio') {
    return resolveAudioCardDimensions({
      ...(item.metadata as AudioCardMetadata | undefined),
      width: item.dimensions?.width,
      height: item.dimensions?.height,
    });
  }

  if (item.type === 'svg') {
    const dimensions = parseSvgDimensions(normalizeSvg(item.content));
    const targetWidth = Math.min(
      dimensions.width,
      LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE
    );
    const aspectRatio = dimensions.height / dimensions.width;
    return { width: targetWidth, height: targetWidth * aspectRatio };
  }

  return (
    item.dimensions || {
      width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE,
      height: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE,
    }
  );
}

/**
 * 插入单个图片到画布
 * 使用传入尺寸或默认尺寸；用户主动插入时可先验证图片能够加载
 */
async function insertImageToCanvas(
  board: PlaitBoard,
  imageUrl: string,
  point: Point,
  dimensions?: { width: number; height: number },
  waitForImageLoad = false,
  boardGuard?: () => boolean,
  insertWithoutBoardHost = false
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  const size = dimensions || {
    width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE,
    height: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE,
  };
  logCanvasInsertionDebug('[CanvasInsertion][Service] image insert with size', {
    point,
    size,
    lockReferenceDimensions: Boolean(dimensions),
    skipImageLoad: !waitForImageLoad,
  });
  // 图片在写入画布前必须验证可读，避免任务成功但画布留下空节点。
  // skipSelect=true: 自动插入时不选中新图片，避免覆盖用户当前选中状态
  // 提供尺寸时锁定布局，避免批量图片异步放大后互相重叠
  const elementId = await insertImageFromUrl(
    board,
    imageUrl,
    point,
    false,
    size,
    true,
    !waitForImageLoad,
    Boolean(dimensions),
    true,
    boardGuard,
    insertWithoutBoardHost
  );
  return { elementId, size };
}

/**
 * 插入单个视频到画布
 * 不再等待视频元数据下载，直接使用默认尺寸或预估尺寸立即插入
 */
async function insertVideoToCanvas(
  board: PlaitBoard,
  videoUrl: string,
  point: Point,
  dimensions?: { width: number; height: number },
  boardGuard?: () => boolean,
  insertWithoutBoardHost = false
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  // 如果提供了尺寸，直接使用
  if (dimensions) {
    const elementId = await insertVideoFromUrl(
      board,
      videoUrl,
      point,
      false,
      dimensions,
      true,
      true,
      undefined,
      boardGuard,
      insertWithoutBoardHost
    );
    return { elementId, size: dimensions };
  }

  // 否则使用默认 16:9 尺寸立即插入
  const defaultSize = {
    width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE,
    height: Math.round(LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE * (9 / 16)),
  };
  const elementId = await insertVideoFromUrl(
    board,
    videoUrl,
    point,
    false,
    defaultSize,
    true,
    true,
    undefined,
    boardGuard,
    insertWithoutBoardHost
  );

  // 异步获取真实尺寸并在以后更新（可选），目前为了响应速度，直接返回默认尺寸
  return { elementId, size: defaultSize };
}

async function insertAudioToCanvas(
  board: PlaitBoard,
  audioUrl: string,
  point: Point,
  dimensions?: { width: number; height: number },
  metadata?: Record<string, unknown>,
  boardGuard?: () => boolean
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  const size = resolveAudioCardDimensions({
    ...(metadata as AudioCardMetadata | undefined),
    width: dimensions?.width,
    height: dimensions?.height,
  });
  const insertedAudio: unknown = await insertAudioFromUrl(
    board,
    audioUrl,
    {
      ...(metadata as AudioCardMetadata | undefined),
      width: size.width,
      height: size.height,
    },
    point,
    false,
    true,
    boardGuard
  );
  const elementId =
    typeof insertedAudio === 'string'
      ? insertedAudio
      : typeof insertedAudio === 'object' &&
        insertedAudio !== null &&
        typeof (insertedAudio as { id?: unknown }).id === 'string'
      ? (insertedAudio as { id: string }).id
      : undefined;
  return { elementId, size };
}

/**
 * 插入单个SVG到画布
 */
async function insertSvgToCanvas(
  board: PlaitBoard,
  svgCode: string,
  point: Point,
  boardGuard?: () => boolean,
  insertWithoutBoardHost = false
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  const normalized = normalizeSvg(svgCode);
  const dimensions = parseSvgDimensions(normalized);

  const targetWidth = Math.min(
    dimensions.width,
    LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE
  );
  const aspectRatio = dimensions.height / dimensions.width;
  const targetHeight = targetWidth * aspectRatio;

  const dataUrl = svgToDataUrl(normalized);
  const imageItem = {
    url: dataUrl,
    width: targetWidth,
    height: targetHeight,
  };

  if (boardGuard && !boardGuard()) {
    throw new Error('画板已切换，取消本次插入');
  }

  const childrenCountBefore = board.children.length;
  let insertedElement;
  if (insertWithoutBoardHost) {
    insertedElement = insertImageNodeAtPoint(board, imageItem, point);
  } else {
    DrawTransforms.insertImage(board, imageItem, point);
    insertedElement = board.children[childrenCountBefore];
  }
  return {
    elementId: insertedElement?.id,
    size: { width: targetWidth, height: targetHeight },
  };
}

async function insertItemToCanvas(
  board: PlaitBoard,
  item: InsertionItem,
  point: Point,
  boardGuard?: () => boolean,
  cardWidth?: number,
  insertWithoutBoardHost = false
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  if (item.type === 'text') {
    return insertTextToCanvas(
      board,
      item.content,
      point,
      item.label,
      cardWidth,
      boardGuard
    );
  }

  if (item.type === 'image') {
    return insertImageToCanvas(
      board,
      item.content,
      point,
      item.dimensions,
      item.waitForImageLoad,
      boardGuard,
      insertWithoutBoardHost
    );
  }

  if (item.type === 'video') {
    return insertVideoToCanvas(
      board,
      item.content,
      point,
      item.dimensions,
      boardGuard,
      insertWithoutBoardHost
    );
  }

  if (item.type === 'audio') {
    return insertAudioToCanvas(
      board,
      item.content,
      point,
      item.dimensions,
      item.metadata,
      boardGuard
    );
  }

  if (item.type === 'svg') {
    return insertSvgToCanvas(
      board,
      item.content,
      point,
      boardGuard,
      insertWithoutBoardHost
    );
  }

  return { size: estimateInsertionItemSize(board, item) };
}

interface StagedCanvasInsertion {
  elements: PlaitElement[];
  items: CanvasInsertionResultItem[];
}

async function stageCanvasInsertion(
  sourceBoard: PlaitBoard,
  items: InsertionItem[],
  positions: Point[],
  boardGuard?: () => boolean
): Promise<StagedCanvasInsertion> {
  const stagingBoard = createBoard([]);
  const cardWidth = getViewportAwareCardWidth(sourceBoard);
  const stagedItems: CanvasInsertionResultItem[] = [];

  for (const [index, item] of items.entries()) {
    if (boardGuard && !boardGuard()) {
      throw new Error('画板已切换，取消本次插入');
    }

    const point = positions[index];
    const childrenCountBefore = stagingBoard.children.length;
    const stagedItem =
      (item.type === 'image' || item.type === 'video') && !item.dimensions
        ? {
            ...item,
            dimensions: estimateInsertionItemSize(sourceBoard, item),
          }
        : item;
    const inserted = await insertItemToCanvas(
      stagingBoard,
      stagedItem,
      point,
      boardGuard,
      cardWidth,
      true
    );
    if (boardGuard && !boardGuard()) {
      throw new Error('画板已切换，取消本次插入');
    }

    const insertedElements = stagingBoard.children.slice(childrenCountBefore);
    attachGenerationMetadataToInsertedElements(
      stagingBoard,
      insertedElements.map((element) => element.id),
      item.metadata
    );
    const firstInsertedElement = insertedElements[0];
    stagedItems.push({
      type: item.type,
      point,
      elementId: firstInsertedElement?.id || inserted.elementId,
      size: inserted.size,
    });
  }

  return {
    elements: [...stagingBoard.children],
    items: stagedItems,
  };
}

function commitStagedCanvasInsertion(
  board: PlaitBoard,
  staged: StagedCanvasInsertion,
  boardGuard?: () => boolean
): void {
  if (boardGuard && !boardGuard()) {
    throw new Error('画板已切换，取消本次插入');
  }

  const committedElementIds: string[] = [];
  try {
    for (const element of staged.elements) {
      const committedElement = structuredClone(element) as PlaitElement;
      if (typeof board.apply === 'function') {
        Transforms.insertNode(board, committedElement, [board.children.length]);
      } else {
        board.children.push(committedElement);
      }
      committedElementIds.push(committedElement.id);
    }
    staged.elements.length = 0;
  } catch (error) {
    for (const elementId of committedElementIds.reverse()) {
      const index = board.children.findIndex(
        (element) => element.id === elementId
      );
      if (index < 0) continue;
      if (typeof board.apply === 'function') {
        Transforms.removeNode(board, [index]);
      } else {
        board.children.splice(index, 1);
      }
    }
    throw error;
  }
}

/**
 * 执行画布插入
 */
export async function executeCanvasInsertion(
  params: CanvasInsertionParams
): Promise<MCPResult> {
  const board = params.board || readCanvasBoard();

  if (!board) {
    return {
      success: false,
      error: '画布未初始化，请先打开画布',
      type: 'error',
    };
  }

  const {
    items,
    verticalGap = LAYOUT_CONSTANTS.DEFAULT_VERTICAL_GAP,
    horizontalGap = LAYOUT_CONSTANTS.DEFAULT_HORIZONTAL_GAP,
  } = params;

  if (!items || items.length === 0) {
    return {
      success: false,
      error: '没有要插入的内容',
      type: 'error',
    };
  }

  try {
    if (params.boardGuard && !params.boardGuard()) {
      throw new Error('画板已切换，取消本次插入');
    }
    if (!params.startPoint && items.length === 1) {
      const item = items[0];
      if (item.type === 'image' || item.type === 'video') {
        if (
          item.type === 'image' &&
          item.waitForImageLoad &&
          getSelectedInsertionFrame(board)
        ) {
          await loadImageElementForCanvas(item.content as DataURL);
        }
        const inserted = await insertMediaIntoSelectedFrame(
          board,
          item.content,
          item.type,
          item.dimensions,
          { boardGuard: params.boardGuard, metadata: item.metadata }
        );
        if (inserted) {
          return {
            success: true,
            data: {
              insertedCount: 1,
              items: [
                {
                  type: item.type,
                  point: inserted.point,
                  elementId: inserted.elementId,
                  size: inserted.size,
                },
              ],
              firstElementId: inserted.elementId,
              firstElementPosition: inserted.point,
              firstElementSize: inserted.size,
            },
            type: 'text',
          };
        }
      }
    }

    const viewportMetrics = getViewportCanvasMetrics(board);

    let startPoint = params.startPoint;
    if (!startPoint) {
      startPoint = getInsertionPointFromSavedSelection(board, {
        verticalGap,
        logPrefix: 'CanvasInsertion',
      });
    }
    if (!startPoint) {
      startPoint =
        getBottomMostInsertionPoint(board, {
          verticalGap,
          emptyPoint: LAYOUT_CONSTANTS.DEFAULT_POINT,
        }) || LAYOUT_CONSTANTS.DEFAULT_POINT;
    }

    logCanvasInsertionDebug('[CanvasInsertion][Service] batch begin', {
      itemsCount: items.length,
      inputStartPoint: params.startPoint || null,
      resolvedStartPoint: startPoint,
      viewport: viewportMetrics,
      verticalGap,
      horizontalGap,
    });

    const flowState = createBatchInsertionFlowState(board, startPoint, {
      horizontalGap,
      verticalGap,
    });
    logCanvasInsertionDebug('[CanvasInsertion][Service] flow initialized', {
      startX: flowState.startX,
      startY: flowState.startY,
      rowRightLimit: flowState.rowRightLimit,
      zoom: viewportMetrics.zoom,
    });

    // 预计算所有素材的尺寸
    const estimatedSizes = items.map((item) =>
      estimateInsertionItemSize(board, item)
    );

    // 使用分组网格预计算位置：无 groupId 的项纵向推进，同组结果横向排列。
    const gridLayout = precalculateGroupedGridLayout(
      startPoint,
      items,
      estimatedSizes,
      {
        canvasWidth: viewportMetrics.width,
        horizontalGap,
        verticalGap,
      }
    );
    flowState.bounds = gridLayout.bounds;

    if (items.length === 1) {
      const item = items[0];
      const point = gridLayout.positions[0];
      const existingElementIds =
        item.type === 'text'
          ? new Set(board.children.map((element) => element.id))
          : null;
      const inserted = await insertItemToCanvas(
        board,
        item,
        point,
        params.boardGuard,
        getViewportAwareCardWidth(board)
      );
      if (params.boardGuard && !params.boardGuard()) {
        throw new Error('画板已切换，取消本次插入');
      }
      attachGenerationMetadataToInsertedElements(
        board,
        item.type === 'text' && existingElementIds
          ? board.children
              .filter((element) => !existingElementIds.has(element.id))
              .map((element) => element.id)
          : inserted.elementId
          ? [inserted.elementId]
          : [],
        item.metadata
      );

      requestAnimationFrame(() => {
        if (!params.boardGuard || params.boardGuard()) {
          scrollToPointIfNeeded(board, point);
        }
      });

      return {
        success: true,
        data: {
          insertedCount: 1,
          items: [
            {
              type: item.type,
              point,
              elementId: inserted.elementId,
              size: inserted.size,
            },
          ],
          firstElementId: inserted.elementId,
          firstElementPosition: point,
          firstElementSize: inserted.size,
        },
        type: 'text',
      };
    }

    for (const [index, item] of items.entries()) {
      logCanvasInsertionDebug('[CanvasInsertion][Service] item layout', {
        index,
        type: item.type,
        groupId: item.groupId || null,
        estimatedSize: estimatedSizes[index],
        point: gridLayout.positions[index],
      });
    }

    const staged = await stageCanvasInsertion(
      board,
      items,
      gridLayout.positions,
      params.boardGuard
    );
    commitStagedCanvasInsertion(board, staged, params.boardGuard);
    const insertedItems = staged.items;

    if (insertedItems.length > 0) {
      const centerPoint =
        getBatchInsertionFlowCenter(flowState) ||
        ([insertedItems[0].point[0], insertedItems[0].point[1]] as Point);
      logCanvasInsertionDebug('[CanvasInsertion][Service] batch complete', {
        insertedCount: insertedItems.length,
        centerPoint,
        bounds: flowState.bounds,
      });
      requestAnimationFrame(() => {
        if (!params.boardGuard || params.boardGuard()) {
          scrollToPointIfNeeded(board, centerPoint);
        }
      });
    }

    return {
      success: true,
      data: {
        insertedCount: insertedItems.length,
        items: insertedItems,
        firstElementId:
          insertedItems.length > 0 ? insertedItems[0].elementId : undefined,
        firstElementPosition:
          insertedItems.length > 0 ? insertedItems[0].point : undefined,
        firstElementSize:
          insertedItems.length > 0 ? insertedItems[0].size : undefined,
      },
      type: 'text',
    };
  } catch (error: unknown) {
    console.error('[CanvasInsertion] Failed to insert content:', error);
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : typeof error === 'string' && error.trim()
        ? error
        : '未知错误';
    return {
      success: false,
      error: `插入失败: ${message}`,
      type: 'error',
    };
  }
}

/**
 * 便捷函数：快速插入单个内容
 */
export async function quickInsert(
  type: ContentType,
  content: string,
  point?: Point,
  dimensions?: { width: number; height: number },
  metadata?: Record<string, unknown>,
  board?: PlaitBoard,
  boardGuard?: () => boolean
): Promise<MCPResult> {
  return executeCanvasInsertion({
    board,
    items: [
      {
        type,
        content,
        dimensions,
        metadata,
        waitForImageLoad: type === 'image',
      },
    ],
    startPoint: point,
    boardGuard,
  });
}

/**
 * 便捷函数：插入一组图片（水平排列）
 */
export async function insertImageGroup(
  imageUrls: string[],
  point?: Point,
  dimensions?:
    | { width: number; height: number }
    | Array<{ width: number; height: number }>,
  board?: PlaitBoard,
  boardGuard?: () => boolean,
  prompt?: string,
  metadata?: Record<string, unknown>
): Promise<MCPResult> {
  const groupId = `img-group-${Date.now()}`;
  const promptMetadata = {
    ...metadata,
    ...(prompt?.trim()
      ? { prompt: prompt.trim(), generationPrompt: prompt.trim() }
      : {}),
  };
  return executeCanvasInsertion({
    board,
    items: imageUrls.map((url, index) => ({
      type: 'image' as ContentType,
      content: url,
      groupId,
      dimensions: Array.isArray(dimensions) ? dimensions[index] : dimensions,
      waitForImageLoad: true,
      metadata:
        Object.keys(promptMetadata).length > 0 ? promptMetadata : undefined,
    })),
    startPoint: point,
    boardGuard,
  });
}

/**
 * 便捷函数：插入图片生成结果，提示词作为图片元数据跟随展示
 */
export async function insertGeneratedImageFlow(
  prompt: string | undefined,
  results: MediaFlowResult[],
  point?: Point,
  board?: PlaitBoard,
  boardGuard?: () => boolean
): Promise<MCPResult> {
  const normalizedPrompt = prompt?.trim() || '';
  const imageResults = results.filter((result) => result.type === 'image');
  const imageItems: InsertionItem[] = [];

  if (imageResults.length === 1) {
    const [result] = imageResults;
    imageItems.push({
      type: 'image',
      content: result.url,
      dimensions: result.dimensions,
      waitForImageLoad: true,
      metadata: {
        ...result.metadata,
        ...(normalizedPrompt
          ? { prompt: normalizedPrompt, generationPrompt: normalizedPrompt }
          : {}),
      },
    });
  } else if (imageResults.length > 1) {
    const groupId = `generated-image-group-${Date.now()}`;
    imageResults.forEach((result) => {
      imageItems.push({
        type: 'image',
        content: result.url,
        groupId,
        dimensions: result.dimensions,
        waitForImageLoad: true,
        metadata: {
          ...result.metadata,
          ...(normalizedPrompt
            ? { prompt: normalizedPrompt, generationPrompt: normalizedPrompt }
            : {}),
        },
      });
    });
  }

  if (imageItems.length === 0) {
    return executeCanvasInsertion({
      board,
      items: normalizedPrompt
        ? [{ type: 'text', content: normalizedPrompt, label: 'Prompt' }]
        : [],
      startPoint: point,
      boardGuard,
    });
  }

  return executeCanvasInsertion({
    board,
    items: imageItems,
    startPoint: point,
    boardGuard,
  });
}

/**
 * 便捷函数：插入AI对话流程（Prompt → 结果）
 */
export async function insertAIFlow(
  prompt: string,
  results: Array<{
    type: 'image' | 'video' | 'audio';
    url: string;
    dimensions?: { width: number; height: number };
    metadata?: Record<string, unknown>;
  }>,
  point?: Point,
  board?: PlaitBoard,
  boardGuard?: () => boolean
): Promise<MCPResult> {
  const normalizedPrompt = prompt.trim();
  const items: InsertionItem[] = [
    { type: 'text', content: prompt, label: 'Prompt' },
  ];

  if (results.length === 1) {
    items.push({
      type: results[0].type,
      content: results[0].url,
      dimensions: results[0].dimensions,
      waitForImageLoad: results[0].type === 'image',
      metadata: {
        ...results[0].metadata,
        ...(normalizedPrompt
          ? { prompt: normalizedPrompt, generationPrompt: normalizedPrompt }
          : {}),
      },
    });
  } else {
    const groupId = `result-group-${Date.now()}`;
    results.forEach((r) => {
      items.push({
        type: r.type,
        content: r.url,
        groupId,
        dimensions: r.dimensions,
        waitForImageLoad: r.type === 'image',
        metadata: {
          ...r.metadata,
          ...(normalizedPrompt
            ? { prompt: normalizedPrompt, generationPrompt: normalizedPrompt }
            : {}),
        },
      });
    });
  }

  return executeCanvasInsertion({
    board,
    items,
    startPoint: point,
    boardGuard,
  });
}
