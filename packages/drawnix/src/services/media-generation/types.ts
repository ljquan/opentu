/**
 * Media Generation Service Types
 *
 * 媒体生成服务层的类型定义。
 * 这是独立于工作流的底层大模型调用服务接口。
 */

import type { ModelRef } from '../../utils/settings-manager';
import type { GenerationParams } from '../../types/shared/core.types';
import type { TaskResultVisibility } from '../../types/shared/core.types';

// Re-export core types
export { TaskStatus, TaskType } from '../../types/shared/core.types';
export type {
  Task,
  TaskResult,
  TaskError,
} from '../../types/shared/core.types';

/**
 * 图片生成选项
 */
export interface ImageGenerationOptions {
  model?: string;
  modelRef?: ModelRef | null;
  size?: string;
  resolution?: '1k' | '2k' | '4k';
  quality?: 'auto' | 'low' | 'medium' | 'high' | '1k' | '2k' | '4k';
  generationMode?: 'text_to_image' | 'image_to_image' | 'image_edit';
  referenceImages?: string[];
  maskImage?: string;
  inputFidelity?: 'high' | 'low';
  background?: 'transparent' | 'opaque' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  outputCompression?: number;
  uploadedImages?: Array<{ url?: string; base64?: string }>;
  count?: number;
  /** 透传给具体适配器的额外参数（如 seedream_quality、aspect_ratio） */
  params?: Record<string, unknown>;
  assetMetadata?: GenerationParams['assetMetadata'];
  promptMeta?: GenerationParams['promptMeta'];
  /** 控制生成结果是否投影到素材库和画布。 */
  resultVisibility?: TaskResultVisibility;
  /** 是否允许通用自动插入链路把结果加入画布。 */
  autoInsertToCanvas?: boolean;
  signal?: AbortSignal;
  /** 强制使用主线程（跳过 SW） */
  forceMainThread?: boolean;
  /** 任务创建后立即回调，用于提前持久化 taskId 到工作流步骤 */
  onTaskCreated?: (taskId: string) => void;
}

/**
 * 视频生成选项
 */
export interface VideoGenerationOptions {
  model?: string;
  modelRef?: ModelRef | null;
  duration?: number | string;
  size?: string;
  inputReference?: string;
  inputReferences?: Array<{ type: 'image' | 'video'; url: string }>;
  referenceImages?: string[];
  /** 透传给具体适配器的额外参数（如 aspect_ratio） */
  params?: Record<string, unknown>;
  promptMeta?: GenerationParams['promptMeta'];
  signal?: AbortSignal;
  forceMainThread?: boolean;
  /** 任务创建后立即回调，用于提前持久化 taskId 到工作流步骤 */
  onTaskCreated?: (taskId: string) => void;
}

/**
 * 图片生成结果
 */
export interface ImageGenerationResult {
  task: import('../../types/shared/core.types').Task;
  url?: string;
}

/**
 * 视频生成结果
 */
export interface VideoGenerationResult {
  task: import('../../types/shared/core.types').Task;
  url?: string;
}
