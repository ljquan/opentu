/**
 * 队列任务创建工具
 *
 * 提取 image/video/audio/text 生成工具中重复的 executeQueue 逻辑。
 * 统一处理：prompt 校验、retry、workflow-batch、direct-count 三分支。
 */

import { taskQueueService } from '../../../services/task-queue';
import type { MCPExecuteOptions, MCPResult, MCPTaskResult } from '../../types';
import type { TaskType } from '../../../types/task.types';
import type { GenerationParams } from '../../../types/shared/core.types';

// ============================================================================
// 类型定义
// ============================================================================

/** 所有媒体生成工具共享的基础参数 */
export interface BaseGenerationParams {
  prompt: string;
  model?: string;
  modelRef?: unknown;
  count?: number;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  globalIndex?: number;
  referenceImages?: string[];
  params?: Record<string, unknown>;
  autoInsertToCanvas?: boolean;
}

/** 队列任务创建配置 */
export interface QueueTaskConfig {
  /** 任务类型 */
  taskType: TaskType;
  /** 结果类型标识 */
  resultType: 'image' | 'video' | 'audio' | 'text';
  /** 获取当前默认模型 */
  getDefaultModel: () => string;
  /** 构建 tool-specific 的任务 payload（必须包含 prompt，不含批量参数） */
  buildTaskPayload: () => GenerationParams;
  /** 构建返回给调用方的额外 data 字段 */
  buildResultData?: () => Record<string, unknown>;
  /** 最大批量数，默认 10 */
  maxCount?: number;
  /** 错误日志前缀 */
  logPrefix?: string;
}

// ============================================================================
// 辅助函数
// ============================================================================

/** 校验 prompt 参数，返回错误结果或 null */
export function validatePrompt(prompt: unknown): MCPResult | null {
  if (!prompt || typeof prompt !== 'string') {
    return { success: false, error: '缺少必填参数 prompt', type: 'error' };
  }
  return null;
}

/** 包装 API 错误为 MCPResult */
export function wrapApiError(error: any, fallbackMessage: string): MCPResult {
  let errorMessage = error.message || fallbackMessage;
  if (error.apiErrorBody) {
    errorMessage = `${errorMessage} - ${JSON.stringify(error.apiErrorBody)}`;
  }
  return { success: false, error: errorMessage, type: 'error' };
}

/** 将 referenceImages URL 列表转换为 uploadedImages 格式 */
export function toUploadedImages(
  referenceImages?: string[]
): Array<{ type: 'url'; url: string; name: string }> | undefined {
  if (!referenceImages || referenceImages.length === 0) return undefined;
  return referenceImages.map((url, index) => ({
    type: 'url' as const,
    url,
    name: `reference-${index + 1}`,
  }));
}

// ============================================================================
// 核心函数
// ============================================================================

/**
 * 通用队列任务创建
 *
 * 统一处理三种分支：
 * 1. retry — 复用已有任务
 * 2. workflow-batch — 工作流场景，单任务 + 批量参数
 * 3. direct-count — 直接调用场景，按 count 创建多个任务
 */
export function createQueueTask(
  params: BaseGenerationParams,
  options: MCPExecuteOptions,
  config: QueueTaskConfig
): MCPTaskResult {
  const promptError = validatePrompt(params.prompt);
  if (promptError) return { ...promptError, taskId: undefined, task: undefined };

  const {
    count = 1,
    batchId: paramsBatchId,
    batchIndex: paramsBatchIndex,
    batchTotal: paramsBatchTotal,
    globalIndex: paramsGlobalIndex,
  } = params;

  try {
    const maxCount = config.maxCount ?? 10;
    const actualCount = Math.min(Math.max(1, count), maxCount);
    const batchId = paramsBatchId || (actualCount > 1 ? `batch_${Date.now()}` : options.batchId);
    const batchTotal = paramsBatchTotal || (actualCount > 1 ? actualCount : undefined);
    const globalIndex = paramsGlobalIndex || options.globalIndex;

    const createdTasks: any[] = [];
    const toolPayload = config.buildTaskPayload();

    // 分支 1: retry
    if (options.retryTaskId) {
      taskQueueService.retryTask(options.retryTaskId);
      const task = taskQueueService.getTask(options.retryTaskId);
      if (!task) {
        throw new Error(`重试任务不存在: ${options.retryTaskId}`);
      }
      createdTasks.push(task);
    }
    // 分支 2: workflow-batch
    else if (paramsBatchId && typeof paramsBatchIndex === 'number') {
      const task = taskQueueService.createTask(
        {
          ...toolPayload,
          batchId,
          batchIndex: paramsBatchIndex,
          batchTotal,
          globalIndex,
          autoInsertToCanvas: params.autoInsertToCanvas ?? true,
        },
        config.taskType
      );
      createdTasks.push(task);
    }
    // 分支 3: direct-count
    else {
      for (let i = 0; i < actualCount; i++) {
        const task = taskQueueService.createTask(
          {
            ...toolPayload,
            batchId,
            batchIndex: i + 1,
            batchTotal: actualCount,
            globalIndex: globalIndex ? globalIndex + i : i + 1,
            autoInsertToCanvas: params.autoInsertToCanvas ?? true,
          },
          config.taskType
        );
        createdTasks.push(task);
      }
    }

    const firstTask = createdTasks[0];
    const extraData = config.buildResultData?.() ?? {};

    return {
      success: true,
      data: {
        taskId: firstTask.id,
        taskIds: createdTasks.map((t: any) => t.id),
        prompt: params.prompt,
        model: params.model || config.getDefaultModel(),
        count: actualCount,
        ...extraData,
      },
      type: config.resultType,
      taskId: firstTask.id,
      task: firstTask,
    };
  } catch (error: any) {
    if (config.logPrefix) {
      console.error(`[${config.logPrefix}] Failed to create task:`, error);
    }
    return {
      success: false,
      error: error.message || '创建任务失败',
      type: 'error',
    };
  }
}
