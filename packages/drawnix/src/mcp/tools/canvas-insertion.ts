/**
 * 画布插入 MCP 工具
 *
 * 将AI生成的内容（文本、图片、视频）插入到画布中
 * 支持垂直和水平布局：
 * - 垂直（上→下）：一次AI对话中，上方产物作为下方产物的输入
 * - 水平（左→右）：指定数量时，相同输入的产物横向排列
 */

import type { MCPTool, MCPResult } from '../types';
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
import { insertMediaIntoSelectedFrame } from '../../utils/frame-insertion-utils';
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

/**
 * Board 引用持有器
 * 由于 MCP 工具是无状态的，需要外部设置 board 引用
 */
let boardRef: PlaitBoard | null = null;

/**
 * 设置 Board 引用
 */
export function setCanvasBoard(board: PlaitBoard | null): void {
  boardRef = board;
  // console.log('[CanvasInsertion] Board reference set:', !!board);
}

/**
 * 获取 Board 引用
 */
export function getCanvasBoard(): PlaitBoard | null {
  return boardRef;
}

/**
 * 插入单个文本项到画布
 * - 包含 Markdown 特征的文本 → 解析为 Card 标签贴插入
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
    // 有 Markdown 特征 → 插入为 Card 标签贴，宽度为屏幕宽度的 50%
    insertCardsToCanvas(board, cardBlocks, point, cardWidth);
    // 返回估算的总尺寸（3列布局）
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
 */
async function insertImageToCanvas(
  board: PlaitBoard,
  imageUrl: string,
  point: Point,
  dimensions?: { width: number; height: number }
): Promise<{ width: number; height: number }> {
  const size = dimensions || { width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE, height: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE };
  logCanvasInsertionDebug('[CanvasInsertion][MCP] image insert fixed size', {
    point,
    size,
    lockReferenceDimensions: true,
    skipImageLoad: true,
  });
  // console.log(`[CanvasInsertion] insertImageToCanvas: url=${imageUrl.substring(0, 80)}, point=`, point, 'size=', size);
  // skipScroll: true - 由 executeCanvasInsertion 统一处理滚动
  // skipImageLoad: true - 使用传入的尺寸，不等待图片加载
  // skipSelect=true: 自动插入时不选中新图片，避免覆盖用户当前选中状态
  try {
    await insertImageFromUrl(board, imageUrl, point, false, size, true, true, true, true);
    // console.log(`[CanvasInsertion] insertImageFromUrl completed successfully`);
  } catch (error) {
    console.error(`[CanvasInsertion] insertImageFromUrl failed:`, error);
    throw error;
  }
  return size;
}

/**
 * 插入单个视频到画布
 */
async function insertVideoToCanvas(
  board: PlaitBoard,
  videoUrl: string,
  point: Point,
  dimensions?: { width: number; height: number }
): Promise<{ width: number; height: number }> {
  // 如果提供了尺寸，直接使用，不等待视频元数据下载
  if (dimensions) {
    await insertVideoFromUrl(board, videoUrl, point, false, dimensions, true, true);
    return dimensions;
  }

  // 否则使用默认 16:9 尺寸立即插入
  const defaultSize = { width: LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE, height: Math.round(LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE * (9 / 16)) };
  await insertVideoFromUrl(board, videoUrl, point, false, defaultSize, true, true);
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

  // 计算目标尺寸，保持宽高比
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
): Promise<{ width: number; height: number }> {
  if (item.type === 'text') {
    return insertTextToCanvas(board, item.content, point, item.label);
  }

  if (item.type === 'image') {
    return insertImageToCanvas(board, item.content, point, item.dimensions);
  }

  if (item.type === 'video') {
    return insertVideoToCanvas(board, item.content, point, item.dimensions);
  }

  if (item.type === 'audio') {
    return insertAudioToCanvas(
      board,
      item.content,
      point,
      item.dimensions,
      item.metadata
    );
  }

  if (item.type === 'svg') {
    return insertSvgToCanvas(board, item.content, point);
  }

  return estimateInsertionItemSize(board, item);
}

/**
 * 执行画布插入
 */
async function executeCanvasInsertion(params: CanvasInsertionParams): Promise<MCPResult> {
  const board = boardRef;

  // console.log('[CanvasInsertion] executeCanvasInsertion called, board:', !!board, 'params:', {
  //   itemsCount: params.items?.length,
  //   startPoint: params.startPoint,
  // });

  if (!board) {
    console.error('[CanvasInsertion] Board is null!');
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
              items: [{ type: item.type, point: inserted.point }],
              firstElementPosition: inserted.point,
              firstElementSize: inserted.size,
            },
            type: 'text',
          };
        }
      }
    }

    const viewportMetrics = getViewportCanvasMetrics(board);

    // 确定起始位置
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

    logCanvasInsertionDebug('[CanvasInsertion][MCP] batch begin', {
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
    logCanvasInsertionDebug('[CanvasInsertion][MCP] flow initialized', {
      startX: flowState.startX,
      startY: flowState.startY,
      rowRightLimit: flowState.rowRightLimit,
      zoom: viewportMetrics.zoom,
    });
    const insertedItems: { type: ContentType; point: Point }[] = [];

    for (const [index, item] of items.entries()) {
      const estimatedSize = estimateInsertionItemSize(board, item);
      const layout = advanceBatchInsertionFlow(
        flowState,
        estimatedSize
      );
      flowState = layout.state;
      logCanvasInsertionDebug('[CanvasInsertion][MCP] item layout', {
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
      await insertItemToCanvas(board, item, layout.point);
      insertedItems.push({ type: item.type, point: layout.point });
    }

    // console.log('[CanvasInsertion] Successfully inserted', insertedItems.length, 'items');

    // 插入完成后，滚动到整批内容中心位置
    if (insertedItems.length > 0) {
      const centerPoint =
        getBatchInsertionFlowCenter(flowState) ||
        ([insertedItems[0].point[0], insertedItems[0].point[1]] as Point);
      logCanvasInsertionDebug('[CanvasInsertion][MCP] batch complete', {
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
        // 返回第一个元素的位置，供上层使用
        firstElementPosition: insertedItems.length > 0 ? insertedItems[0].point : undefined,
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
 * 画布插入 MCP 工具定义
 */
export const canvasInsertionTool: MCPTool = {
  name: 'insert_to_canvas',
  description: `将内容插入到画布工具。用于将AI生成的文本、图片、视频等内容插入到画布中。

使用场景：
- AI对话产生的Prompt需要显示在画布上
- AI生成的图片需要插入到画布
- AI生成的视频需要插入到画布
- 一次对话中多个产物需要按布局排列

布局规则：
- 垂直布局（默认）：内容从上到下依次排列，表示流程/依赖关系
- 水平布局：同组内容（相同groupId）从左到右排列，表示并列关系

不适用场景：
- 仅生成内容但不需要显示在画布上`,

  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: '要插入的内容列表',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: '内容类型：text（文本）、image（图片URL）、video（视频URL）、audio（音频URL）、svg（SVG代码）',
              enum: ['text', 'image', 'video', 'audio', 'svg'],
            },
            content: {
              type: 'string',
              description: '内容：文本内容或媒体URL',
            },
            label: {
              type: 'string',
              description: '标签/描述（可选）',
            },
            groupId: {
              type: 'string',
              description: '分组ID，相同groupId的内容会水平排列（可选）',
            },
            metadata: {
              type: 'object',
              description: '可选元数据（音频卡片标题、封面、时长等）',
            },
          },
          required: ['type', 'content'],
        },
      },
      verticalGap: {
        type: 'number',
        description: '垂直间距（像素），默认50',
        default: 50,
      },
      horizontalGap: {
        type: 'number',
        description: '水平间距（像素），默认20',
        default: 20,
      },
    },
    required: ['items'],
  },

  execute: async (params: Record<string, unknown>): Promise<MCPResult> => {
    return executeCanvasInsertion(params as unknown as CanvasInsertionParams);
  },
};

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
  point?: Point
): Promise<MCPResult> {
  const groupId = `img-group-${Date.now()}`;
  return executeCanvasInsertion({
    items: imageUrls.map(url => ({
      type: 'image' as ContentType,
      content: url,
      groupId,
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
    // 多个结果，水平排列
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
