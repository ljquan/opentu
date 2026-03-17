/**
 * Workflow Engine Types
 *
 * 主线程工作流引擎的类型定义。
 */

import type { ModelRef } from '../../utils/settings-manager';

// ============================================================================
// 工作流步骤
// ============================================================================

/**
 * 步骤状态
 * - pending: 等待执行
 * - running: 正在执行
 * - completed: 执行完成
 * - failed: 执行失败
 * - skipped: 跳过
 * - pending_main_thread: 等待主线程执行（需要访问 Canvas/DOM 的工具）
 */
export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'pending_main_thread';

export interface WorkflowStepOptions {
  /** 执行模式 */
  mode?: 'async' | 'queue';
  /** 批次 ID */
  batchId?: string;
  /** 批次索引 */
  batchIndex?: number;
  /** 批次总数 */
  batchTotal?: number;
  /** 全局索引 */
  globalIndex?: number;
}

export interface WorkflowStep {
  /** 步骤 ID */
  id: string;
  /** MCP 工具名称 */
  mcp: string;
  /** 工具参数 */
  args: Record<string, unknown>;
  /** 步骤描述 */
  description: string;
  /** 步骤状态 */
  status: WorkflowStepStatus;
  /** 步骤结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 执行时长（毫秒） */
  duration?: number;
  /** 依赖的步骤 ID 列表 */
  dependsOn?: string[];
  /** 执行选项 */
  options?: WorkflowStepOptions;
}

// ============================================================================
// 工作流定义
// ============================================================================

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkflowContext {
  /** 用户输入 */
  userInput?: string;
  /** 模型名称 */
  model?: string;
  /** 模型来源引用 */
  modelRef?: ModelRef | null;
  /** 生成参数 */
  params?: {
    count?: number;
    size?: string;
    duration?: string;
  };
  /** 参考图片 */
  referenceImages?: string[];
}

export interface Workflow {
  /** 工作流 ID */
  id: string;
  /** 工作流名称 */
  name: string;
  /** 工作流步骤 */
  steps: WorkflowStep[];
  /** 工作流状态 */
  status: WorkflowStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 错误信息 */
  error?: string;
  /** 上下文信息 */
  context?: WorkflowContext;
}

// ============================================================================
// 工作流事件
// ============================================================================

export interface WorkflowStatusEvent {
  type: 'status';
  workflowId: string;
  status: WorkflowStatus;
}

export interface WorkflowStepEvent {
  type: 'step';
  workflowId: string;
  stepId: string;
  status: WorkflowStepStatus;
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface WorkflowCompletedEvent {
  type: 'completed';
  workflowId: string;
  workflow: Workflow;
}

export interface WorkflowFailedEvent {
  type: 'failed';
  workflowId: string;
  error: string;
}

export interface WorkflowStepsAddedEvent {
  type: 'steps_added';
  workflowId: string;
  steps: WorkflowStep[];
}

export type WorkflowEvent =
  | WorkflowStatusEvent
  | WorkflowStepEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | WorkflowStepsAddedEvent;

// ============================================================================
// 主线程工具执行结果
// ============================================================================

export interface MainThreadToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// 工作流引擎选项
// ============================================================================

export interface WorkflowEngineOptions {
  /** 步骤超时时间（毫秒），默认 10 分钟 */
  stepTimeout?: number;
  /** 是否在步骤失败时继续执行其他步骤 */
  continueOnError?: boolean;
  /** 事件回调 */
  onEvent?: (event: WorkflowEvent) => void;
  /**
   * 强制使用主线程降级执行器（不依赖 SW）
   * 用于 workflow 提交超时后的降级路径，确保立即调用 API 而不受 SW/IndexedDB 影响
   */
  forceFallbackExecutor?: boolean;
  /**
   * 主线程工具执行回调
   * 用于执行需要访问 Board/Canvas 的工具（如 insert_mermaid, insert_mindmap）
   */
  executeMainThreadTool?: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<MainThreadToolResult>;
}
