/**
 * Image Generation Service
 *
 * 独立的图片生成服务，不依赖工作流概念。
 * 薄代理层：参数构建 → 调用 executor → 等待完成 → 返回结果。
 * 任务状态管理和 IndexedDB 持久化由 executor 层负责。
 */

import type { ImageGenerationOptions, ImageGenerationResult } from './types';
import { TaskStatus } from './types';
import { generateTaskId } from '../../utils/task-utils';
import {
  validateGenerationParams,
  sanitizeGenerationParams,
} from '../../utils/validation-utils';
import { taskStorageWriter } from '../media-executor/task-storage-writer';
import { executorFactory, waitForTaskCompletion } from '../media-executor';
import {
  hasInvocationRouteCredentials,
  settingsManager,
} from '../../utils/settings-manager';
import { TaskType } from '../../types/shared/core.types';
import type { ImageGenerationParams } from '../media-executor/types';
import { taskQueueService } from '../task-queue-service';
import {
  TaskStatus as QueueTaskStatus,
  TaskExecutionPhase,
} from '../../types/task.types';

/**
 * 生成图片
 *
 * @param prompt 生成提示词
 * @param options 生成选项
 * @returns 包含任务对象的结果
 */
export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<ImageGenerationResult> {
  // 参数验证
  const params = { prompt, ...options };
  const validation = validateGenerationParams(params, TaskType.IMAGE);
  if (!validation.valid) {
    throw new Error(validation.errors.join(', '));
  }
  const sanitizedParams = sanitizeGenerationParams(params);

  // 确保 API Key 已解密
  await settingsManager.waitForInitialization();
  if (
    !hasInvocationRouteCredentials('image', options.modelRef || options.model)
  ) {
    throw new Error('未配置 API Key，请在设置中配置');
  }

  // 创建任务记录
  const taskId = generateTaskId();
  const now = Date.now();
  await taskStorageWriter.createTask(taskId, 'image', {
    prompt: sanitizedParams.prompt,
    model: options.model,
    modelRef: options.modelRef || null,
    size: options.size,
  });

  // 注册到 TaskQueueService 内存 Map，确保任务队列 UI 和重试功能可用
  taskQueueService.trackExternalTask({
    id: taskId,
    type: TaskType.IMAGE,
    status: QueueTaskStatus.PROCESSING,
    params: {
      prompt: sanitizedParams.prompt,
      model: options.model,
      modelRef: options.modelRef || null,
      size: options.size,
    },
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    executionPhase: TaskExecutionPhase.SUBMITTING,
  });

  // 通知调用方 taskId，以便提前持久化到工作流步骤
  options.onTaskCreated?.(taskId);

  // 构建 executor 参数
  const executorParams: ImageGenerationParams = {
    taskId,
    prompt: sanitizedParams.prompt,
    model: options.model,
    modelRef: options.modelRef || null,
    size: options.size,
    quality: options.quality,
    referenceImages: options.referenceImages,
    uploadedImages: options.uploadedImages,
    count: options.count,
    params: options.params,
  };

  // 调用 executor 执行
  const executor = options.forceMainThread
    ? executorFactory.getFallbackExecutor()
    : await executorFactory.getExecutor();

  await executor.generateImage(executorParams, { signal: options.signal });

  // 等待任务完成（轮询 IndexedDB）
  const result = await waitForTaskCompletion(taskId, {
    signal: options.signal,
    onProgress: (updatedTask) => {
      taskQueueService.syncTaskFromStorage(taskId, updatedTask);
    },
  });

  if (!result.success || !result.task) {
    const errorTask = result.task || {
      id: taskId,
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: { prompt },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: {
        code: 'GENERATION_ERROR',
        message: result.error || '图片生成失败',
      },
    };
    return { task: errorTask };
  }

  return { task: result.task, url: result.task.result?.url };
}
