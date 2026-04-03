/**
 * Workflow Related Types
 *
 * 工作流相关类型定义
 */

import type { TaskConfig } from './task';

// ============================================================================
// 基础类型
// ============================================================================

/**
 * 工作流步骤状态
 */
export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * 工作流状态
 */
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// ============================================================================
// 实体类型
// ============================================================================

/**
 * 工作流步骤选项
 */
export interface WorkflowStepOptions {
  mode?: 'async' | 'queue';
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  globalIndex?: number;
}

/**
 * 工作流步骤
 */
export interface WorkflowStep {
  id: string;
  mcp: string;
  args: Record<string, unknown>;
  description: string;
  status: WorkflowStepStatus;
  result?: unknown;
  error?: string;
  duration?: number;
  options?: WorkflowStepOptions;
}

/**
 * 工作流定义
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  steps: WorkflowStep[];
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  context?: {
    userInput?: string;
    model?: string;
    params?: {
      count?: number;
      size?: string;
      duration?: string;
    };
    referenceImages?: string[];
  };
}

// ============================================================================
// RPC 参数和响应
// ============================================================================

/**
 * 工作流提交参数
 */
export interface WorkflowSubmitParams {
  workflow: WorkflowDefinition;
  /** API 配置，随工作流提交传递 */
  config: TaskConfig;
}

/**
 * 工作流提交结果
 */
export interface WorkflowSubmitResult {
  success: boolean;
  workflowId?: string;
  error?: string;
}

/**
 * 工作流状态响应
 */
export interface WorkflowStatusResponse {
  success: boolean;
  workflow?: WorkflowDefinition;
  error?: string;
}

/**
 * 获取所有工作流响应
 */
export interface WorkflowAllResponse {
  success: boolean;
  workflows: WorkflowDefinition[];
}

/**
 * Canvas 操作响应参数
 */
export interface CanvasOperationResponse {
  requestId: string;
  success: boolean;
  error?: string;
}

/**
 * 主线程工具响应参数
 */
export interface MainThreadToolResponse {
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  /** Task ID (for queued operations like generate_image/generate_video) */
  taskId?: string;
  /** Multiple task IDs (for batch operations) */
  taskIds?: string[];
  /** Additional steps to add (for ai_analyze) */
  addSteps?: Array<{
    id: string;
    mcp: string;
    args: Record<string, unknown>;
    description: string;
    status: WorkflowStepStatus;
  }>;
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * 工作流状态变更事件
 */
export interface WorkflowStatusEvent {
  workflowId: string;
  status: WorkflowStatus;
  updatedAt: number;
}

/**
 * 工作流步骤状态事件
 */
export interface WorkflowStepStatusEvent {
  workflowId: string;
  stepId: string;
  status: WorkflowStepStatus;
  result?: unknown;
  error?: string;
  duration?: number;
}

/**
 * 工作流完成事件
 */
export interface WorkflowCompletedEvent {
  workflowId: string;
  workflow: WorkflowDefinition;
}

/**
 * 工作流失败事件
 */
export interface WorkflowFailedEvent {
  workflowId: string;
  error: string;
}

/**
 * 工作流步骤添加事件
 */
export interface WorkflowStepsAddedEvent {
  workflowId: string;
  steps: WorkflowStep[];
}

/**
 * Canvas 操作请求事件
 */
export interface CanvasOperationRequestEvent {
  requestId: string;
  operation: 'insert_image' | 'insert_video' | 'insert_audio' | 'insert_text' | 'canvas_insert';
  params: {
    url?: string;
    content?: string;
    position?: { x: number; y: number };
    items?: Array<{ type: string; url?: string; content?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
}

/**
 * 主线程工具请求事件
 */
export interface MainThreadToolRequestEvent {
  requestId: string;
  workflowId: string;
  stepId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * 工作流恢复事件
 */
export interface WorkflowRecoveredEvent {
  workflowId: string;
  workflow: WorkflowDefinition;
}
