/**
 * 画布插入服务
 *
 * 将AI生成的内容（文本、图片、视频）插入到画布中
 */

import { PlaitBoard, Point, getRectangleByElements } from '@plait/core';
import { DrawTransforms } from '@plait/draw';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import {
  AUDIO_CARD_DEFAULT_HEIGHT,
  AUDIO_CARD_DEFAULT_WIDTH,
  insertAudioFromUrl,
  resolveAudioCardDimensions,
  type AudioCardMetadata,
} from '../../data/audio';
import { scrollToPointIfNeeded } from '../../utils/selection-utils';
import { parseMarkdownToCards } from '../../utils/markdown-to-cards';
import { insertCardsToCanvas } from '../../utils/insert-cards';
import type { MCPResult } from '../../mcp/types';
import { parseSizeToPixels } from '../../utils/size-ratio';

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
 * 布局常量
 */
const LAYOUT_CONSTANTS = {
  DEFAULT_VERTICAL_GAP: 50,
  DEFAULT_HORIZONTAL_GAP: 20,
  TEXT_DEFAULT_WIDTH: 300,
  TEXT_LINE_HEIGHT: 24,
  MEDIA_DEFAULT_SIZE: 400,
  MEDIA_MAX_SIZE: 600,
};

/**
 * Board 引用持有器
 */
let boardRef: PlaitBoard | null = null;

/**
 * 设置 Board 引用
 */
export function setCanvasBoard(board: PlaitBoard | null): void {
  boardRef = board;
}

/**
 * 获取 Board 引用
 */
export function getCanvasBoard(): PlaitBoard | null {
  return boardRef;
}

/**
 * 从保存的选中元素IDs获取起始插入位置（左对齐）
 */
function getStartPointFromSelection(board: PlaitBoard): Point | undefined {
  const appState = (board as any).appState;
  const savedElementIds = appState?.lastSelectedElementIds || [];

  if (savedElementIds.length === 0) {
    return undefined;
  }

  const elements = savedElementIds
    .map((id: string) => board.children.find((el: any) => el.id === id))
    .filter(Boolean);

  if (elements.length === 0) {
    return undefined;
  }

  try {
    const boundingRect = getRectangleByElements(board, elements, false);
    const leftX = boundingRect.x;
    const insertionY = boundingRect.y + boundingRect.height + LAYOUT_CONSTANTS.DEFAULT_VERTICAL_GAP;
    return [leftX, insertionY] as Point;
  } catch (error) {
    console.warn('[CanvasInsertion] Error calculating start point:', error);
    return undefined;
  }
}

/**
 * 获取画布底部最后一个元素的位置（左对齐）
 */
function getBottomMostPoint(board: PlaitBoard): Point {
  if (!board.children || board.children.length === 0) {
    return [100, 100] as Point;
  }

  let maxY = 0;
  let maxYLeftX = 100;

  for (const element of board.children) {
    try {
      const rect = getRectangleByElements(board, [element], false);
      const elementBottom = rect.y + rect.height;
      if (elementBottom > maxY) {
        maxY = elementBottom;
        maxYLeftX = rect.x;
      }
    } catch {
      // 忽略无法计算矩形的元素
    }
  }

  return [maxYLeftX, maxY + LAYOUT_CONSTANTS.DEFAULT_VERTICAL_GAP] as Point;
}

/**
 * 估算文本内容的尺寸
 */
function estimateTextSize(text: string): { width: number; height: number } {
  const lines = text.split('\n');
  const maxLineLength = Math.max(...lines.map(l => l.length));
  const width = Math.min(maxLineLength * 8, LAYOUT_CONSTANTS.TEXT_DEFAULT_WIDTH);
  const height = lines.length * LAYOUT_CONSTANTS.TEXT_LINE_HEIGHT;
  return { width, height };
}

/**
 * 按组分组内容项
 */
function groupItems(items: InsertionItem[]): InsertionItem[][] {
  const groups: Map<string, InsertionItem[]> = new Map();

  for (const item of items) {
    if (item.groupId) {
      const group = groups.get(item.groupId) || [];
      group.push(item);
      groups.set(item.groupId, group);
    }
  }

  const result: InsertionItem[][] = [];
  let currentGroupId: string | null = null;

  for (const item of items) {
    if (item.groupId) {
      if (currentGroupId !== item.groupId) {
        currentGroupId = item.groupId;
        const group = groups.get(item.groupId);
        if (group) {
          result.push(group);
        }
      }
    } else {
      result.push([item]);
      currentGroupId = null;
    }
  }

  return result;
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
  title?: string
): Promise<{ width: number; height: number }> {
  // 有 title 时，直接以 Card 方式插入（跳过 Markdown 检测）
  if (title) {
    const cardWidth = Math.round(window.innerWidth * 0.5);
    insertCardsToCanvas(board, [{ title, body: text }], point, cardWidth);
    return { width: cardWidth, height: 120 };
  }

  // 尝试解析为 Markdown Card 块
  const cardBlocks = parseMarkdownToCards(text);
  if (cardBlocks && cardBlocks.length > 0) {
    const cardWidth = Math.round(window.innerWidth * 0.5);
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
  return estimateTextSize(text);
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
  // 传入 skipImageLoad=true 和尺寸，立即插入图片不等待下载
  await insertImageFromUrl(board, imageUrl, point, false, size, true, true);
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
 * 将SVG代码转换为Data URL
 */
function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * 规范化SVG代码
 */
function normalizeSvg(svg: string): string {
  let normalized = svg.trim();
  if (!normalized.includes('xmlns=')) {
    normalized = normalized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return normalized;
}

/**
 * 解析SVG尺寸
 */
function parseSvgDimensions(svg: string): { width: number; height: number } {
  const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number);
    if (parts.length >= 4 && parts[2] && parts[3]) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const widthMatch = svg.match(/width=["'](\d+)(?:px)?["']/i);
  const heightMatch = svg.match(/height=["'](\d+)(?:px)?["']/i);
  if (widthMatch && heightMatch) {
    return { width: parseInt(widthMatch[1]), height: parseInt(heightMatch[1]) };
  }
  return { width: 400, height: 400 };
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

/**
 * 执行画布插入
 */
export async function executeCanvasInsertion(params: CanvasInsertionParams): Promise<MCPResult> {
  const board = boardRef;

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
    let startPoint = params.startPoint;
    if (!startPoint) {
      startPoint = getStartPointFromSelection(board);
    }
    if (!startPoint) {
      startPoint = getBottomMostPoint(board);
    }

    const groupedItems = groupItems(items);

    let currentY = startPoint[1];
    const leftX = startPoint[0];
    const insertedItems: CanvasInsertionResultItem[] = [];

    for (const group of groupedItems) {
      if (group.length === 1) {
        const item = group[0];
        const point: Point = [leftX, currentY];

        if (item.type === 'text') {
          const childrenCountBefore = board.children.length;
          const textSize = await insertTextToCanvas(
            board,
            item.content,
            point,
            item.label
          );
          const insertedElement = board.children[childrenCountBefore] as
            | { id?: string }
            | undefined;
          currentY += textSize.height + verticalGap;
          insertedItems.push({
            type: item.type,
            point,
            elementId: insertedElement?.id,
            size: textSize,
          });
        } else if (item.type === 'image') {
          const childrenCountBefore = board.children.length;
          const imgSize = await insertImageToCanvas(board, item.content, point, item.dimensions);
          const insertedElement = board.children[childrenCountBefore] as
            | { id?: string }
            | undefined;
          currentY += imgSize.height + verticalGap;
          insertedItems.push({
            type: item.type,
            point,
            elementId: insertedElement?.id,
            size: imgSize,
          });
        } else if (item.type === 'video') {
          const childrenCountBefore = board.children.length;
          const vidSize = await insertVideoToCanvas(board, item.content, point, item.dimensions);
          const insertedElement = board.children[childrenCountBefore] as
            | { id?: string }
            | undefined;
          currentY += vidSize.height + verticalGap;
          insertedItems.push({
            type: item.type,
            point,
            elementId: insertedElement?.id,
            size: vidSize,
          });
        } else if (item.type === 'audio') {
          const childrenCountBefore = board.children.length;
          const audioSize = await insertAudioToCanvas(
            board,
            item.content,
            point,
            item.dimensions,
            item.metadata
          );
          const insertedElement = board.children[childrenCountBefore] as
            | { id?: string }
            | undefined;
          currentY += audioSize.height + verticalGap;
          insertedItems.push({
            type: item.type,
            point,
            elementId: insertedElement?.id,
            size: audioSize,
          });
        } else if (item.type === 'svg') {
          const childrenCountBefore = board.children.length;
          const svgSize = await insertSvgToCanvas(board, item.content, point);
          const insertedElement = board.children[childrenCountBefore] as
            | { id?: string }
            | undefined;
          currentY += svgSize.height + verticalGap;
          insertedItems.push({
            type: item.type,
            point,
            elementId: insertedElement?.id,
            size: svgSize,
          });
        }
      } else {
        let currentX = leftX;
        let maxHeight = 0;

        for (const item of group) {
          const point: Point = [currentX, currentY];

          if (item.type === 'text') {
            const childrenCountBefore = board.children.length;
            const size = await insertTextToCanvas(board, item.content, point, item.label);
            const insertedElement = board.children[childrenCountBefore] as
              | { id?: string }
              | undefined;
            maxHeight = Math.max(maxHeight, size.height);
            currentX += size.width + horizontalGap;
            insertedItems.push({
              type: item.type,
              point,
              elementId: insertedElement?.id,
              size,
            });
          } else if (item.type === 'image') {
            const childrenCountBefore = board.children.length;
            const imgSize = await insertImageToCanvas(board, item.content, point, item.dimensions);
            const insertedElement = board.children[childrenCountBefore] as
              | { id?: string }
              | undefined;
            maxHeight = Math.max(maxHeight, imgSize.height);
            currentX += imgSize.width + horizontalGap;
            insertedItems.push({
              type: item.type,
              point,
              elementId: insertedElement?.id,
              size: imgSize,
            });
          } else if (item.type === 'video') {
            const childrenCountBefore = board.children.length;
            const vidSize = await insertVideoToCanvas(board, item.content, point, item.dimensions);
            const insertedElement = board.children[childrenCountBefore] as
              | { id?: string }
              | undefined;
            maxHeight = Math.max(maxHeight, vidSize.height);
            currentX += vidSize.width + horizontalGap;
            insertedItems.push({
              type: item.type,
              point,
              elementId: insertedElement?.id,
              size: vidSize,
            });
          } else if (item.type === 'audio') {
            const childrenCountBefore = board.children.length;
            const audioSize = await insertAudioToCanvas(
              board,
              item.content,
              point,
              item.dimensions,
              item.metadata
            );
            const insertedElement = board.children[childrenCountBefore] as
              | { id?: string }
              | undefined;
            maxHeight = Math.max(maxHeight, audioSize.height);
            currentX += audioSize.width + horizontalGap;
            insertedItems.push({
              type: item.type,
              point,
              elementId: insertedElement?.id,
              size: audioSize,
            });
          } else if (item.type === 'svg') {
            const childrenCountBefore = board.children.length;
            const svgSize = await insertSvgToCanvas(board, item.content, point);
            const insertedElement = board.children[childrenCountBefore] as
              | { id?: string }
              | undefined;
            maxHeight = Math.max(maxHeight, svgSize.height);
            currentX += svgSize.width + horizontalGap;
            insertedItems.push({
              type: item.type,
              point,
              elementId: insertedElement?.id,
              size: svgSize,
            });
          }
        }

        currentY += maxHeight + verticalGap;
      }
    }

    if (insertedItems.length > 0) {
      const firstItem = insertedItems[0];
      const centerPoint: Point = [
        firstItem.point[0] + LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE / 2,
        firstItem.point[1] + LAYOUT_CONSTANTS.MEDIA_DEFAULT_SIZE / 2,
      ];
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
