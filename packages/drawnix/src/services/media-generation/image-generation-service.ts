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
import { createTaskInvocationRouteSnapshot } from '../task-invocation-route';
import {
  createImageSubmissionParams,
  getImageSubmissionRequestId,
} from '../image-generation-recovery-service';

function buildStoredImageAdapterParams(
  options: ImageGenerationOptions
): Record<string, unknown> | undefined {
  const adapterParams: Record<string, unknown> = {
    ...(options.params || {}),
  };

  if (
    options.resolution !== undefined &&
    adapterParams.resolution === undefined
  ) {
    adapterParams.resolution = options.resolution;
  }

  if (options.quality !== undefined && adapterParams.quality === undefined) {
    adapterParams.quality = options.quality;
  }

  if (
    typeof options.count === 'number' &&
    Number.isFinite(options.count) &&
    adapterParams.n === undefined
  ) {
    adapterParams.n = options.count;
  }

  return Object.keys(adapterParams).length > 0 ? adapterParams : undefined;
}

function buildStoredImageTaskParams(
  prompt: string,
  options: ImageGenerationOptions
) {
  return {
    prompt,
    model: options.model,
    modelRef: options.modelRef || null,
    size: options.size,
    resolution: options.resolution,
    quality: options.quality,
    generationMode: options.generationMode,
    referenceImages:
      options.referenceImages && options.referenceImages.length > 0
        ? options.referenceImages
        : undefined,
    maskImage: options.maskImage,
    inputFidelity: options.inputFidelity,
    background: options.background,
    outputFormat: options.outputFormat,
    outputCompression: options.outputCompression,
    uploadedImages:
      options.uploadedImages && options.uploadedImages.length > 0
        ? options.uploadedImages
        : undefined,
    count: options.count,
    assetMetadata: options.assetMetadata,
    promptMeta: options.promptMeta,
    resultVisibility: options.resultVisibility,
    autoInsertToCanvas: options.autoInsertToCanvas,
    params: buildStoredImageAdapterParams(options),
  };
}

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
  const submissionRequestId = taskId;
  const persistedTaskParams = createImageSubmissionParams(
    buildStoredImageTaskParams(sanitizedParams.prompt, options),
    submissionRequestId
  );
  const invocationRoute = createTaskInvocationRouteSnapshot(
    'image',
    options.modelRef || options.model || null
  );
  await taskStorageWriter.createTask(
    taskId,
    'image',
    persistedTaskParams,
    invocationRoute
  );

  // 注册到 TaskQueueService 内存 Map，确保任务队列 UI 和重试功能可用
  taskQueueService.trackExternalTask({
    id: taskId,
    type: TaskType.IMAGE,
    status: QueueTaskStatus.PROCESSING,
    params: persistedTaskParams,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    invocationRoute,
    executionPhase: TaskExecutionPhase.SUBMITTING,
  });

  // 通知调用方 taskId，以便提前持久化到工作流步骤
  options.onTaskCreated?.(taskId);

  // 构建 executor 参数
  const executorParams: ImageGenerationParams = {
    taskId,
    requestId: submissionRequestId,
    prompt: sanitizedParams.prompt,
    model: options.model,
    modelRef: options.modelRef || null,
    size: options.size,
    resolution: options.resolution,
    generationMode: options.generationMode,
    quality: options.quality,
    referenceImages: options.referenceImages,
    maskImage: options.maskImage,
    inputFidelity: options.inputFidelity,
    background: options.background,
    outputFormat: options.outputFormat,
    outputCompression: options.outputCompression,
    uploadedImages: options.uploadedImages,
    count: options.count,
    assetMetadata: options.assetMetadata,
    resultVisibility: options.resultVisibility,
    params: options.params,
  };

  // 调用 executor 执行
  const executor = options.forceMainThread
    ? executorFactory.getFallbackExecutor()
    : await executorFactory.getExecutor();

  const isCurrentAttempt = () => {
    const current = taskQueueService.getTask(taskId);
    return Boolean(
      current &&
        current.status === QueueTaskStatus.PROCESSING &&
        getImageSubmissionRequestId(current) === submissionRequestId &&
        (current.startedAt || current.createdAt) === now
    );
  };

  try {
    await executor.generateImage(executorParams, {
      signal: options.signal,
      isCurrentAttempt,
      onSubmissionAttempt: (actualInvocationRoute) =>
        taskQueueService.markImageSubmissionAttempted(
          taskId,
          submissionRequestId,
          actualInvocationRoute
        ),
    });
  } catch (error) {
    const current = taskQueueService.getTask(taskId);
    if (!current || !isCurrentAttempt()) {
      throw error;
    }

    const storedTask = await taskStorageWriter.getTask(taskId);
    if (storedTask && isCurrentAttempt()) {
      taskQueueService.syncTaskFromStorage(
        taskId,
        storedTask as Partial<typeof current>
      );
    }
    throw error;
  }

  // 等待任务完成（轮询 IndexedDB）
  const result = await waitForTaskCompletion(taskId, {
    signal: options.signal,
    onProgress: (updatedTask) => {
      if (isCurrentAttempt()) {
        taskQueueService.syncTaskFromStorage(taskId, updatedTask);
      }
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
