/**
 * Task Related Types
 *
 * 任务相关类型定义，包括任务状态、类型、参数和事件
 */

import type { CacheWarning } from '../../../types/cache-warning.types';
import type {
  TaskInvocationRouteSnapshot,
  TaskResultVisibility,
} from '../../../types/task.types';

// ============================================================================
// 基础类型
// ============================================================================

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * 任务类型
 */
export type TaskType = 'image' | 'video' | 'character' | 'inspiration_board' | 'chat';

/**
 * 任务执行阶段
 */
export type TaskExecutionPhase = 'submitting' | 'polling' | 'downloading';

// ============================================================================
// 实体类型
// ============================================================================

/**
 * 生成参数
 */
export interface GenerationParams {
  prompt: string;
  width?: number;
  height?: number;
  size?: string;
  duration?: number;
  style?: string;
  model?: string;
  seed?: number;
  batchId?: string;
  aspectRatio?: string;
  autoInsertToCanvas?: boolean;
  [key: string]: unknown;
}

/**
 * 任务结果
 */
export interface TaskResult {
  url: string;
  format: string;
  size: number;
  resultVisibility?: TaskResultVisibility;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
  cacheWarning?: CacheWarning;
}

/**
 * 任务错误
 */
export interface TaskError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * SW 任务
 */
export interface SWTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  params: GenerationParams;
  /** 任务执行配置 */
  config: TaskConfig;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: TaskResult;
  error?: TaskError;
  progress?: number;
  remoteId?: string;
  invocationRoute?: TaskInvocationRouteSnapshot;
  executionPhase?: TaskExecutionPhase;
  imageRecovery?: import('../../../types/task.types').ImageRecoveryInfo;
  insertedToCanvas?: boolean;
}

// ============================================================================
// RPC 参数和响应
// ============================================================================

/**
 * 任务执行配置
 * 每次任务创建时由应用层传递，SW 不维护配置状态
 */
export interface TaskConfig {
  apiKey: string;
  baseUrl: string;
  modelName?: string;
  textModelName?: string;
}

/**
 * 任务创建请求参数
 */
export interface TaskCreateParams {
  taskId: string;
  taskType: TaskType;
  params: GenerationParams;
  /** 任务执行配置，每次创建任务时传递 */
  config: TaskConfig;
}

/**
 * 任务创建响应
 */
export interface TaskCreateResult {
  success: boolean;
  task?: SWTask;
  existingTaskId?: string;
  reason?: 'duplicate' | 'not_initialized' | string;
}

/**
 * 分页任务列表请求
 */
export interface TaskListPaginatedParams {
  offset: number;
  limit: number;
  status?: TaskStatus;
  type?: TaskType;
  sortOrder?: 'asc' | 'desc';
}

/**
 * 分页任务列表响应
 */
export interface TaskListPaginatedResult {
  success: boolean;
  tasks: SWTask[];
  total: number;
  offset: number;
  hasMore: boolean;
}

/**
 * 任务操作参数
 */
export interface TaskOperationParams {
  taskId: string;
}

/**
 * 任务操作响应
 */
export interface TaskOperationResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * 任务状态变更事件
 */
export interface TaskStatusEvent {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  phase?: TaskExecutionPhase;
  updatedAt: number;
}

/**
 * 任务完成事件
 */
export interface TaskCompletedEvent {
  taskId: string;
  result: TaskResult;
  completedAt: number;
  remoteId?: string;
}

/**
 * 任务失败事件
 */
export interface TaskFailedEvent {
  taskId: string;
  error: TaskError;
}

/**
 * 任务创建事件（广播给其他客户端）
 */
export interface TaskCreatedEvent {
  task: SWTask;
  sourceClientId?: string;
}
