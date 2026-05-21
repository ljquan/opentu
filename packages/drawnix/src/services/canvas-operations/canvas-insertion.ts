/**
 * 画布插入服务
 *
 * 将AI生成的内容（文本、图片、视频）插入到画布中
 */

import { PlaitBoard, Point } from '@plait/core';
import { DrawTransforms } from '@plait/draw';
import { insertImageFromUrl } from '../../data/image';
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
import { parseSizeToPixels } from '../../utils/size-ratio';
import { insertMediaIntoSelectedFrame } from '../../utils/frame-insertion-utils';
import { getCanvasBoard as readCanvasBoard } from './canvas-board-ref';
import {
  CANVAS_INSERTION_LAYOUT as LAYOUT_CONSTANTS,
  advanceBatchInsertionFlow,
  createBatchInsertionFlowState,
  estimateCanvasTextSize,
  getBatchInsertionFlowCenter,
  getBottomMostInsertionPoint,
  getInsertionPointFromSavedSelection,
  getViewportAwareCardWidth,
  getViewportCanvasMetrics,
  logCanvasInsertionDebug,
} from '../../utils/canvas-insertion-layout';
import {
  normalizeSvg,
  parseSvgDimensions,
  svgToDataUrl,
} from '../../utils/svg-utils';

export { setCanvasBoard, getCanvasBoard } from './canvas-board-ref';

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
  /** 额外元数据（音频卡片等） */
  metadata?: Record<string, unknown>;
}

/**
 * 画布插入参数
 */
export interface CanvasInsertionParams {
  /** 要插入的内容列表 */
  items: InsertionItem[];
  /** 起始位置 [leftX, topY]（可选，默认使用当前选中元素或画布底部，左对齐） */
  startPoint?: Point;
  /** 垂直间距（默认50px） */
  verticalGap?: number;
  /** 水平间距（默认20px） */
  horizontalGap?: number;
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
  cardWidth: number = getViewportAwareCardWidth(board)
): Promise<{ width: number; height: number }> {
  // 有 title 时，直接以 Card 方式插入（跳过 Markdown 检测）
  if (title) {
    insertCardsToCanvas(board, [{ title, body: text }], point, cardWidth);
    return { width: cardWidth, height: 120 };
  }

  // 尝试解析为 Markdown Card 块
  const cardBlocks = parseMarkdownToCards(text);
  if (cardBlocks && cardBlocks.length > 0) {
    insertCardsToCanvas(board, cardBlocks, point, cardWidth);
    const cols = Math.min(cardBlocks.length, 3);
    const rows = Math.ceil(cardBlocks.length / 3);
    return {
      width: cols * (cardWidth + 20) - 20,
      height: rows * (120 + 20) - 20,
    };
  }

  // 普通文本 → 直接插入
  DrawTransforms.insertText(board, point, text);
  return estimateCanvasTextSize(text);
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
 * 使用传入的尺寸或默认尺寸立即插入，不等待图片下载完成
 */
async function insertImageToCanvas(
  board: PlaitBoard,
  imageUrl: string,
  point: Point,
  dimensions?: { width: number; height: number }
): Promise<{ width: number; height: number }> {
  const size = dimensions || { width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE, height: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE };
  logCanvasInsertionDebug('[CanvasInsertion][Service] image insert fixed size', {
    point,
    size,
    lockReferenceDimensions: true,
    skipImageLoad: true,
  });
  // 批量插入需要固定参考尺寸，避免图片加载后按原始比例回写导致间距抖动。
  // 传入 skipImageLoad=true 和尺寸，立即插入图片不等待下载
  // skipSelect=true: 自动插入时不选中新图片，避免覆盖用户当前选中状态
  await insertImageFromUrl(board, imageUrl, point, false, size, true, true, true, true);
  return size;
}

/**
 * 插入单个视频到画布
 * 不再等待视频元数据下载，直接使用默认尺寸或预估尺寸立即插入
 */
async function insertVideoToCanvas(
  board: PlaitBoard,
  videoUrl: string,
  point: Point,
  dimensions?: { width: number; height: number }
): Promise<{ width: number; height: number }> {
  // 如果提供了尺寸，直接使用
  if (dimensions) {
    await insertVideoFromUrl(board, videoUrl, point, false, dimensions, true, true);
    return dimensions;
  }

  // 否则使用默认 16:9 尺寸立即插入
  const defaultSize = { width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE, height: Math.round(LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE * (9 / 16)) };
  await insertVideoFromUrl(board, videoUrl, point, false, defaultSize, true, true);
  
  // 异步获取真实尺寸并在以后更新（可选），目前为了响应速度，直接返回默认尺寸
  return defaultSize;
}

async function insertAudioToCanvas(
  board: PlaitBoard,
  audioUrl: string,
  point: Point,
  dimensions?: { width: number; height: number },
  metadata?: Record<string, unknown>
): Promise<{ width: number; height: number }> {
  const size = resolveAudioCardDimensions({
    ...(metadata as AudioCardMetadata | undefined),
    width: dimensions?.width,
    height: dimensions?.height,
  });
  await insertAudioFromUrl(
    board,
    audioUrl,
    {
      ...(metadata as AudioCardMetadata | undefined),
      width: size.width,
      height: size.height,
    },
    point,
    false,
    true
  );
  return size;
}

/**
 * 插入单个SVG到画布
 */
async function insertSvgToCanvas(
  board: PlaitBoard,
  svgCode: string,
  point: Point
): Promise<{ width: number; height: number }> {
  const normalized = normalizeSvg(svgCode);
  const dimensions = parseSvgDimensions(normalized);

  const targetWidth = Math.min(dimensions.width, LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE);
  const aspectRatio = dimensions.height / dimensions.width;
  const targetHeight = targetWidth * aspectRatio;

  const dataUrl = svgToDataUrl(normalized);
  const imageItem = {
    url: dataUrl,
    width: targetWidth,
    height: targetHeight,
  };

  DrawTransforms.insertImage(board, imageItem, point);
  return { width: targetWidth, height: targetHeight };
}

async function insertItemToCanvas(
  board: PlaitBoard,
  item: InsertionItem,
  point: Point
): Promise<{ elementId?: string; size: { width: number; height: number } }> {
  const childrenCountBefore = board.children.length;
  let size: { width: number; height: number } | undefined;

  if (item.type === 'text') {
    size = await insertTextToCanvas(board, item.content, point, item.label);
  } else if (item.type === 'image') {
    size = await insertImageToCanvas(
      board,
      item.content,
      point,
      item.dimensions
    );
  } else if (item.type === 'video') {
    size = await insertVideoToCanvas(
      board,
      item.content,
      point,
      item.dimensions
    );
  } else if (item.type === 'audio') {
    size = await insertAudioToCanvas(
      board,
      item.content,
      point,
      item.dimensions,
      item.metadata
    );
  } else if (item.type === 'svg') {
    size = await insertSvgToCanvas(board, item.content, point);
  }

  const insertedElement = board.children[childrenCountBefore] as
    | { id?: string }
    | undefined;

  return {
    elementId: insertedElement?.id,
    size: size || estimateInsertionItemSize(board, item),
  };
}

/**
 * 执行画布插入
 */
export async function executeCanvasInsertion(params: CanvasInsertionParams): Promise<MCPResult> {
  const board = readCanvasBoard();

  if (!board) {
    return {
      success: false,
      error: '画布未初始化，请先打开画布',
      type: 'error',
    };
  }

  const { items, verticalGap = LAYOUT_CONSTANTS.DEFAULT_VERTICAL_GAP, horizontalGap = LAYOUT_CONSTANTS.DEFAULT_HORIZONTAL_GAP } = params;

  if (!items || items.length === 0) {
    return {
      success: false,
      error: '没有要插入的内容',
      type: 'error',
    };
  }

  try {
    if (!params.startPoint && items.length === 1) {
      const item = items[0];
      if (item.type === 'image' || item.type === 'video') {
        const inserted = await insertMediaIntoSelectedFrame(
          board,
          item.content,
          item.type,
          item.dimensions
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

    let flowState = createBatchInsertionFlowState(board, startPoint, {
      horizontalGap,
      verticalGap,
    });
    logCanvasInsertionDebug('[CanvasInsertion][Service] flow initialized', {
      startX: flowState.startX,
      startY: flowState.startY,
      rowRightLimit: flowState.rowRightLimit,
      zoom: viewportMetrics.zoom,
    });
    const insertedItems: CanvasInsertionResultItem[] = [];

    for (const [index, item] of items.entries()) {
      const estimatedSize = estimateInsertionItemSize(board, item);
      const layout = advanceBatchInsertionFlow(
        flowState,
        estimatedSize
      );
      flowState = layout.state;

      logCanvasInsertionDebug('[CanvasInsertion][Service] item layout', {
        index,
        type: item.type,
        groupId: item.groupId || null,
        estimatedSize,
        point: layout.point,
        wrapped: layout.wrapped,
        cursorX: flowState.cursorX,
        cursorY: flowState.cursorY,
        rowMaxHeight: flowState.rowMaxHeight,
        bounds: flowState.bounds,
      });

      const inserted = await insertItemToCanvas(board, item, layout.point);
      insertedItems.push({
        type: item.type,
        point: layout.point,
        elementId: inserted.elementId,
        size: inserted.size,
      });
    }

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
        scrollToPointIfNeeded(board, centerPoint);
      });
    }

    return {
      success: true,
      data: {
        insertedCount: insertedItems.length,
        items: insertedItems,
        firstElementId:
          insertedItems.length > 0 ? insertedItems[0].elementId : undefined,
        firstElementPosition: insertedItems.length > 0 ? insertedItems[0].point : undefined,
        firstElementSize: insertedItems.length > 0 ? insertedItems[0].size : undefined,
      },
      type: 'text',
    };
  } catch (error: any) {
    console.error('[CanvasInsertion] Failed to insert content:', error);
    return {
      success: false,
      error: `插入失败: ${error.message || '未知错误'}`,
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
  metadata?: Record<string, unknown>
): Promise<MCPResult> {
  return executeCanvasInsertion({
    items: [{ type, content, dimensions, metadata }],
    startPoint: point,
  });
}

/**
 * 便捷函数：插入一组图片（水平排列）
 */
export async function insertImageGroup(
  imageUrls: string[],
  point?: Point,
  dimensions?: { width: number; height: number }
): Promise<MCPResult> {
  const groupId = `img-group-${Date.now()}`;
  return executeCanvasInsertion({
    items: imageUrls.map(url => ({
      type: 'image' as ContentType,
      content: url,
      groupId,
      dimensions,
    })),
    startPoint: point,
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
  point?: Point
): Promise<MCPResult> {
  const items: InsertionItem[] = [
    { type: 'text', content: prompt, label: 'Prompt' },
  ];

  if (results.length === 1) {
    items.push({
      type: results[0].type,
      content: results[0].url,
      dimensions: results[0].dimensions,
      metadata: results[0].metadata,
    });
  } else {
    const groupId = `result-group-${Date.now()}`;
    results.forEach(r => {
      items.push({
        type: r.type,
        content: r.url,
        groupId,
        dimensions: r.dimensions,
        metadata: r.metadata,
      });
    });
  }

  return executeCanvasInsertion({
    items,
    startPoint: point,
  });
}
