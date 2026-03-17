/**
 * Types for SW Capabilities
 */

import type { PlaitBoard, Point } from '@plait/core';
import type { ModelRef } from '../../utils/settings-manager';

/**
 * Delegated operation types
 */
export type DelegatedOperationType =
  | 'canvas_insert'
  | 'insert_mermaid'
  | 'insert_mindmap'
  | 'insert_svg'
  | 'ai_analyze'
  | 'generate_image'
  | 'generate_video'
  | 'generate_grid_image'
  | 'generate_inspiration_board'
  | 'split_image'
  | 'insert_to_canvas'
  | 'generate_long_video';

/**
 * Delegated operation request from SW
 */
export interface DelegatedOperation {
  /** Operation type */
  operation: DelegatedOperationType;
  /** Operation arguments */
  args: Record<string, unknown>;
  /** Request ID for correlation */
  requestId?: string;
  /** Workflow ID */
  workflowId?: string;
  /** Step ID */
  stepId?: string;
}

/**
 * Result of capability execution
 */
export interface CapabilityResult {
  success: boolean;
  data?: unknown;
  error?: string;
  type?: 'image' | 'video' | 'text' | 'canvas' | 'error';
  /** Task ID (for queued operations) */
  taskId?: string;
  /** Multiple task IDs (for batch operations) */
  taskIds?: string[];
  /** Additional steps to add (for ai_analyze) */
  addSteps?: Array<{
    id: string;
    mcp: string;
    args: Record<string, unknown>;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  }>;
}

/**
 * Canvas insertion item
 */
export interface InsertionItem {
  type: 'text' | 'image' | 'video' | 'svg';
  content: string;
  label?: string;
  groupId?: string;
}

/**
 * Canvas insertion params
 */
export interface CanvasInsertParams {
  items: InsertionItem[];
  startPoint?: Point;
  verticalGap?: number;
  horizontalGap?: number;
}

/**
 * Mermaid params
 */
export interface MermaidParams {
  mermaid: string;
}

/**
 * Mindmap params
 */
export interface MindmapParams {
  markdown: string;
}

/**
 * SVG params
 */
export interface SvgParams {
  svg: string;
  width?: number;
  startPoint?: Point;
}

/**
 * Grid image params
 */
export interface GridImageParams {
  theme: string;
  rows?: number;
  cols?: number;
  layoutStyle?: string;
  imageSize?: string;
  imageQuality?: '1k' | '2k' | '4k';
  referenceImages?: string[];
  model?: string;
}

/**
 * Inspiration board params
 */
export interface InspirationBoardParams {
  theme: string;
  imageCount?: number;
  imageSize?: string;
  imageQuality?: '1k' | '2k' | '4k';
  referenceImages?: string[];
  model?: string;
}

/**
 * Split image params
 */
export interface SplitImageParams {
  imageUrl: string;
}

/**
 * Long video params
 */
export interface LongVideoParams {
  prompt: string;
  totalDuration?: number;
  segmentDuration?: number;
  model?: string;
  size?: string;
  firstFrameImage?: string;
}

/**
 * AI analyze params
 */
export interface AIAnalyzeParams {
  context: {
    userInstruction: string;
    model?: { id: string };
    selection?: {
      texts?: string[];
      images?: string[];
      videos?: string[];
    };
  };
  textModel?: string;
  modelRef?: ModelRef | null;
}

/**
 * Image generation params (delegated from SW)
 */
export interface ImageGenerationParams {
  prompt: string;
  size?: string;
  referenceImages?: string[];
  quality?: '1k' | '2k' | '4k';
  model?: string;
  count?: number;
  /** 批次 ID（批量生成时） */
  batchId?: string;
  /** 批次索引（1-based） */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引 */
  globalIndex?: number;
  /** 额外参数（如 seedream_quality 等模型特定参数） */
  params?: Record<string, unknown>;
}

/**
 * Video generation params (delegated from SW)
 */
export interface VideoGenerationParams {
  prompt: string;
  model?: string;
  seconds?: string;
  size?: string;
  referenceImages?: string[];
  count?: number;
  /** 批次 ID（批量生成时） */
  batchId?: string;
  /** 批次索引（1-based） */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引 */
  globalIndex?: number;
}

/**
 * Board holder interface
 */
export interface BoardHolder {
  getBoard(): PlaitBoard | null;
  setBoard(board: PlaitBoard | null): void;
}
