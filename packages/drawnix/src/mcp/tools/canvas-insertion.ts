/**
 * 画布插入 MCP 工具
 *
 * 将AI生成的内容（文本、图片、视频）插入到画布中
 * 支持垂直和水平布局：
 * - 垂直（上→下）：一次AI对话中，上方产物作为下方产物的输入
 * - 水平（左→右）：指定数量时，相同输入的产物横向排列
 */

import type { MCPTool, MCPResult } from '../types';
import type { PlaitBoard, Point } from '@plait/core';
import {
  executeCanvasInsertion as executeSharedCanvasInsertion,
  type InsertionItem as SharedInsertionItem,
} from '../../services/canvas-operations/canvas-insertion';

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
let boardBindingVersion = 0;

/**
 * 设置 Board 引用
 */
export function setCanvasBoard(board: PlaitBoard | null): void {
  boardRef = board;
  boardBindingVersion += 1;
  // console.log('[CanvasInsertion] Board reference set:', !!board);
}

/**
 * 获取 Board 引用
 */
export function getCanvasBoard(): PlaitBoard | null {
  return boardRef;
}

async function executeCanvasInsertion(
  params: CanvasInsertionParams
): Promise<MCPResult> {
  const board = boardRef;
  const bindingVersion = boardBindingVersion;
  if (!board) {
    return {
      success: false,
      error: '画布未初始化，请先打开画布',
      type: 'error',
    };
  }

  return executeSharedCanvasInsertion({
    ...params,
    board,
    boardGuard: () =>
      boardRef === board && boardBindingVersion === bindingVersion,
    items: params.items as SharedInsertionItem[],
  });
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
              description:
                '内容类型：text（文本）、image（图片URL）、video（视频URL）、audio（音频URL）、svg（SVG代码）',
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
    items: imageUrls.map((url) => ({
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
    results.forEach((r) => {
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
