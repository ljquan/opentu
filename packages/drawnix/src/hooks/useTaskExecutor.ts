/**
 * useTaskExecutor Hook
 *
 * Automatically monitors and executes pending tasks in the background.
 * Handles task lifecycle: execution, timeout detection, retry logic.
 * All tasks are executed directly in the main thread.
 */

import { useEffect, useRef } from 'react';
import { legacyTaskQueueService } from '../services/task-queue';
import { generationAPIService } from '../services/generation-api-service';
import { characterAPIService } from '../services/character-api-service';
import { characterStorageService } from '../services/character-storage-service';
import { unifiedCacheService } from '../services/unified-cache-service';
import { Task, TaskStatus, TaskType } from '../types/task.types';
import { CharacterStatus } from '../types/character.types';
import { isResumableAsyncImageTask, isTaskTimeout } from '../utils/task-utils';
import { AI_GENERATION_CONCURRENCY_LIMIT } from '../constants/TASK_CONSTANTS';
import { classifyApiCredentialError } from '../utils/api-auth-error-event';
import {
  assertTaskInvocationRouteAvailable,
  resolveTaskInvocationRouteModel,
  shouldUseStrictTaskInvocationRoute,
} from '../services/task-invocation-route';
import { cacheRemoteUrls } from '../services/media-executor/fallback-utils';
import {
  getImageSubmissionRequestId,
  imageGenerationRecoveryService,
  isCurrentImageRecoveryAttempt,
  isImageRequestRecoveryTask,
  shouldRecoverImageSubmission,
} from '../services/image-generation-recovery-service';

function inferImageFormat(url: string): string {
  const pathname = url.split(/[?#]/, 1)[0] || '';
  const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return !extension || extension === 'bin' ? 'png' : extension;
}

/**
 * 从 API 错误体中提取原始错误消息
 */
function extractApiErrorMessage(apiErrorBody: string): string | null {
  if (!apiErrorBody) return null;

  try {
    const parsed = JSON.parse(apiErrorBody);
    // 尝试常见的错误消息字段
    if (parsed.error?.message) return parsed.error.message;
    if (parsed.message) return parsed.message;
    if (parsed.error && typeof parsed.error === 'string') return parsed.error;
    if (parsed.detail) return parsed.detail;
    if (parsed.msg) return parsed.msg;
  } catch {
    // 如果不是 JSON，直接返回原始内容
    return apiErrorBody;
  }
  return null;
}

/**
 * Converts error to user-friendly message
 * 优先保留原始 API 错误信息，便于用户理解和反馈
 */
function getFriendlyErrorMessage(error: any): string {
  const message = error?.message || String(error);
  const apiErrorBody = error?.apiErrorBody || '';
  const httpStatus = error?.httpStatus;
  const credentialErrorKind = classifyApiCredentialError(error);

  // 首先尝试从 API 错误体中提取原始错误消息
  const apiErrorMessage = extractApiErrorMessage(apiErrorBody);

  // 检查 API 错误体中的特定错误类型
  const combinedText = `${message} ${apiErrorBody}`;
  if (
    combinedText.includes('insufficient_user_quota') ||
    combinedText.includes('预扣费额度失败')
  ) {
    return '账户额度不足，请充值后重试';
  }

  // 检查 Google Gemini 内容政策违规
  if (
    message.includes('PROHIBITED_CONTENT') ||
    message.includes('has been blocked by Google Gemini')
  ) {
    return message; // 直接返回原始错误信息，保留详细说明
  }

  // 检查 AI 模型拒绝生成的情况（返回文本而非图片）
  if (
    message.includes('cannot') ||
    message.includes('I cannot') ||
    message.includes("I can't")
  ) {
    return 'AI 拒绝生成此内容';
  }
  if (message.includes('unable to') || message.includes('not able to')) {
    return 'AI 无法处理此请求';
  }

  // HTTP 请求超时（AbortSignal.timeout）
  if (message.includes('signal') && message.includes('timed out')) {
    return '请求超时，服务器响应过慢，正在自动重试';
  }

  // 任务超时
  if (message.includes('TIMEOUT') || message.includes('超时')) {
    return '生成超时，请稍后重试';
  }

  // 网络错误
  if (
    message.includes('network') ||
    message.includes('Network') ||
    message.includes('fetch') ||
    message.includes('Failed to fetch')
  ) {
    return '网络连接失败，请检查网络后重试';
  }

  // 限流
  if (
    message.includes('rate limit') ||
    message.includes('429') ||
    httpStatus === 429
  ) {
    return '请求过于频繁，请稍后重试';
  }

  if (credentialErrorKind === 'invalid') {
    return 'API Key 无效或已过期，请重新配置';
  }

  if (credentialErrorKind === 'missing') {
    return '缺少 API Key，请先在设置中配置';
  }

  // 认证错误
  if (message.includes('401') || httpStatus === 401) {
    return '接口返回 401，请检查鉴权方式、账号权限或服务端策略';
  }

  // 权限错误（非额度问题）
  if (
    (message.includes('403') || httpStatus === 403) &&
    !apiErrorBody.includes('quota')
  ) {
    return 'API 访问被拒绝，请检查配置';
  }

  // 服务器错误 - 如果有原始 API 错误消息，附加显示
  if (message.includes('500') || httpStatus === 500) {
    return apiErrorMessage
      ? `AI 服务器内部错误: ${apiErrorMessage}`
      : 'AI 服务器内部错误，正在自动重试';
  }
  if (message.includes('502') || httpStatus === 502) {
    return apiErrorMessage
      ? `AI 服务暂时不可用: ${apiErrorMessage}`
      : 'AI 服务暂时不可用（502），正在自动重试';
  }
  if (message.includes('503') || httpStatus === 503) {
    return apiErrorMessage
      ? `AI 服务繁忙: ${apiErrorMessage}`
      : 'AI 服务繁忙（503），正在自动重试';
  }
  if (message.includes('504') || httpStatus === 504) {
    return apiErrorMessage
      ? `AI 服务响应超时: ${apiErrorMessage}`
      : 'AI 服务响应超时（504），正在自动重试';
  }

  // 如果有原始 API 错误消息，优先返回
  if (apiErrorMessage) {
    return apiErrorMessage;
  }

  // 返回原始错误消息（不再截断）
  return message;
}

/**
 * Hook for automatic task execution
 *
 * Responsibilities:
 * - Monitor pending tasks and start execution
 * - Handle task timeout detection
 * - Implement retry logic with exponential backoff
 * - Update task status based on results
 *
 * All tasks are executed in the main thread.
 *
 * @example
 * function App() {
 *   useTaskExecutor(); // Tasks will execute automatically
 *   return <YourComponents />;
 * }
 */
// 最大并发任务数，防止页面加载时大量任务同时执行导致 OOM
const MAX_CONCURRENT_TASKS = AI_GENERATION_CONCURRENCY_LIMIT;
// 页面加载后延迟执行积压任务，避免与页面初始化竞争资源
const STARTUP_DELAY_MS = 2000;

export function useTaskExecutor(): void {
  const executingTasksRef = useRef<Set<string>>(new Set());
  const pendingQueueRef = useRef<Task[]>([]);
  const timeoutCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isActive = true;

    const startImageRequestRecovery = (task: Task) => {
      if (!isImageRequestRecoveryTask(task)) {
        imageGenerationRecoveryService.stop(task.id);
        return;
      }

      const requestId = getImageSubmissionRequestId(task);
      const startedAt = task.startedAt || task.createdAt;
      imageGenerationRecoveryService.start(task, {
        onSucceeded: async (result) => {
          if (!isActive) return;
          let current = legacyTaskQueueService.getTask(task.id);
          if (!isCurrentImageRecoveryAttempt(current, requestId, startedAt)) {
            return;
          }

          const format = inferImageFormat(result.url);
          let resolvedUrls = result.urls;
          try {
            resolvedUrls = await cacheRemoteUrls(
              result.urls,
              task.id,
              'image',
              format,
              task.params.assetMetadata
                ? { extraMetadata: { ...task.params.assetMetadata } }
                : undefined
            );
          } catch (error) {
            console.warn(
              `[TaskExecutor] Failed to cache recovered image task ${task.id}, using remote URL:`,
              error
            );
          }

          current = legacyTaskQueueService.getTask(task.id);
          if (!isCurrentImageRecoveryAttempt(current, requestId, startedAt)) {
            return;
          }

          const completed = await legacyTaskQueueService.completeImageAttempt(
            task.id,
            requestId,
            {
              url: resolvedUrls[0] || result.url,
              urls: resolvedUrls.length > 1 ? resolvedUrls : undefined,
              format,
              size: 0,
              resultKind: 'image',
            }
          );
          if (!completed) {
            current = legacyTaskQueueService.getTask(task.id);
            if (isCurrentImageRecoveryAttempt(current, requestId, startedAt)) {
              throw new Error('恢复图片结果写入失败，稍后重试');
            }
            return;
          }
          if (!isActive) {
            return;
          }

          current = legacyTaskQueueService.getTask(task.id);
          if (
            !current ||
            current.status !== TaskStatus.COMPLETED ||
            getImageSubmissionRequestId(current) !== requestId
          ) {
            return;
          }

          try {
            await unifiedCacheService.registerImageMetadata(
              resolvedUrls[0] || result.url,
              {
                taskId: task.id,
                model: task.params.model,
                prompt: task.params.prompt,
                params: task.params,
              }
            );
          } catch (error) {
            console.error(
              `[TaskExecutor] Failed to register metadata for recovered image task ${task.id}:`,
              error
            );
          }
        },
        onFailed: async (error) => {
          if (!isActive) return;
          const current = legacyTaskQueueService.getTask(task.id);
          if (!isCurrentImageRecoveryAttempt(current, requestId, startedAt)) {
            return;
          }
          const failed = await legacyTaskQueueService.failImageAttempt(
            task.id,
            requestId,
            {
              code: error.code,
              message: error.message,
              details: {
                originalError: error.message,
                timestamp: Date.now(),
              },
            }
          );
          if (!failed) {
            const latest = legacyTaskQueueService.getTask(task.id);
            if (isCurrentImageRecoveryAttempt(latest, requestId, startedAt)) {
              throw new Error('恢复失败状态写入失败，稍后重试');
            }
          }
        },
      });
    };

    // All tasks execute in main thread

    // 尝试从等待队列中执行下一个任务（并发控制）
    // 注意：引用了 executeTask，但 executeTask 也是 const，
    // 由于 tryExecuteNext 只在异步回调中被调用，此时 executeTask 已定义
    const tryExecuteNext = () => {
      if (!isActive) return;
      while (
        pendingQueueRef.current.length > 0 &&
        executingTasksRef.current.size < MAX_CONCURRENT_TASKS
      ) {
        const next = pendingQueueRef.current.shift();
        if (next && !executingTasksRef.current.has(next.id)) {
          executeTask(next);
        }
      }
    };

    // 任务完成后释放并发槽位，触发队列中下一个任务
    const onTaskFinished = (taskId: string) => {
      executingTasksRef.current.delete(taskId);
      tryExecuteNext();
    };

    const resumeAudioTask = async (task: Task) => {
      const taskId = task.id;
      const remoteId = task.remoteId!;

      if (executingTasksRef.current.has(taskId)) {
        return;
      }

      executingTasksRef.current.add(taskId);

      try {
        if (shouldUseStrictTaskInvocationRoute(task)) {
          assertTaskInvocationRouteAvailable('audio', task);
        }
        const result = await generationAPIService.resumeAudioGeneration(
          taskId,
          remoteId,
          resolveTaskInvocationRouteModel(task)
        );

        if (!isActive) return;

        legacyTaskQueueService.updateTaskStatus(taskId, TaskStatus.COMPLETED, {
          result,
        });
      } catch (error: any) {
        if (!isActive) return;

        const errorCode = error.httpStatus
          ? `HTTP_${error.httpStatus}`
          : error.name || 'ERROR';
        const errorMessage = getFriendlyErrorMessage(error);
        const originalErrorInfo =
          error.fullResponse ||
          error.apiErrorBody ||
          error.message ||
          String(error);

        legacyTaskQueueService.updateTaskStatus(taskId, TaskStatus.FAILED, {
          error: {
            code: errorCode,
            message: errorMessage,
            details: {
              originalError: originalErrorInfo,
              timestamp: Date.now(),
            },
          },
        });
      } finally {
        onTaskFinished(taskId);
      }
    };

    // Function to resume an async image task that has a remoteId
    const resumeAsyncImageTask = async (task: Task) => {
      const taskId = task.id;
      const remoteId = task.remoteId!;
      const requestId = getImageSubmissionRequestId(task);

      if (executingTasksRef.current.has(taskId)) {
        return;
      }

      executingTasksRef.current.add(taskId);

      try {
        if (shouldUseStrictTaskInvocationRoute(task)) {
          assertTaskInvocationRouteAvailable('image', task);
        }
        const result = await generationAPIService.resumeAsyncImageGeneration(
          taskId,
          remoteId,
          resolveTaskInvocationRouteModel(task),
          requestId
        );

        if (!isActive) return;

        const completed = await legacyTaskQueueService.completeImageAttempt(
          taskId,
          requestId,
          result
        );
        if (!completed || !isActive) return;

        const currentTask = legacyTaskQueueService.getTask(taskId);
        if (
          !currentTask ||
          currentTask.status !== TaskStatus.COMPLETED ||
          getImageSubmissionRequestId(currentTask) !== requestId
        ) {
          return;
        }

        if (result.url) {
          try {
            await unifiedCacheService.registerImageMetadata(result.url, {
              taskId: task.id,
              model: task.params.model,
              prompt: task.params.prompt,
              params: task.params,
            });
          } catch (error) {
            console.error(
              `[TaskExecutor] Failed to register metadata for resumed async image task ${taskId}:`,
              error
            );
          }
        }
      } catch (error: any) {
        if (!isActive) return;

        const errorCode = error.httpStatus
          ? `HTTP_${error.httpStatus}`
          : error.name || 'ERROR';
        const errorMessage = getFriendlyErrorMessage(error);
        const originalErrorInfo =
          error.fullResponse ||
          error.apiErrorBody ||
          error.message ||
          String(error);

        await legacyTaskQueueService.failImageAttempt(taskId, requestId, {
          code: errorCode,
          message: errorMessage,
          details: {
            originalError: originalErrorInfo,
            timestamp: Date.now(),
          },
        });
      } finally {
        onTaskFinished(taskId);
      }
    };

    // Function to execute a character task
    const executeCharacterTask = async (task: Task) => {
      const taskId = task.id;

      // Prevent duplicate execution
      if (executingTasksRef.current.has(taskId)) {
        return;
      }

      executingTasksRef.current.add(taskId);

      try {
        // Update status to processing
        legacyTaskQueueService.updateTaskStatus(taskId, TaskStatus.PROCESSING);

        const { sourceVideoTaskId, characterTimestamps, model, prompt } =
          task.params;

        if (!sourceVideoTaskId) {
          throw new Error('缺少源视频任务ID');
        }

        // Create character via API with polling
        const result = await characterAPIService.createCharacterWithPolling(
          {
            videoTaskId: sourceVideoTaskId,
            characterTimestamps,
            localTaskId: task.params.sourceLocalTaskId,
            sourcePrompt: prompt,
            sourceModel: model,
          },
          {
            onStatusChange: (_status: CharacterStatus) => undefined,
          }
        );

        if (!isActive) return;

        // Save character to storage
        await characterStorageService.saveCharacter({
          id: result.characterId,
          username: result.username,
          profilePictureUrl: result.profile_picture_url,
          permalink: result.permalink,
          sourceTaskId: task.params.sourceLocalTaskId || '',
          sourceVideoId: sourceVideoTaskId,
          sourcePrompt: prompt,
          characterTimestamps,
          status: 'completed' as CharacterStatus,
          createdAt: task.createdAt,
          completedAt: Date.now(),
        });

        // Mark task as completed with character info
        legacyTaskQueueService.updateTaskStatus(taskId, TaskStatus.COMPLETED, {
          result: {
            url: result.profile_picture_url,
            format: 'character',
            size: 0,
            characterUsername: result.username,
            characterProfileUrl: result.profile_picture_url,
            characterPermalink: result.permalink,
          },
          remoteId: result.characterId,
        });
      } catch (error: any) {
        if (!isActive) return;

        console.error(`[TaskExecutor] Character task ${taskId} failed:`, error);

        const updatedTask = legacyTaskQueueService.getTask(taskId);
        if (!updatedTask) return;

        const errorCode = error.httpStatus
          ? `HTTP_${error.httpStatus}`
          : error.name || 'ERROR';
        const errorMessage = getFriendlyErrorMessage(error);
        const originalErrorInfo =
          error.fullResponse ||
          error.apiErrorBody ||
          error.message ||
          String(error);
        const errorDetails = {
          originalError: originalErrorInfo,
          timestamp: Date.now(),
        };

        // Check if we should retry - disabled, mark as failed directly
        legacyTaskQueueService.updateTaskStatus(taskId, TaskStatus.FAILED, {
          error: {
            code: errorCode,
            message: errorMessage,
            details: errorDetails,
          },
        });
      } finally {
        onTaskFinished(taskId);
      }
    };

    // Function to execute a single task
    const executeTask = async (task: Task) => {
      const taskId = task.id;
      const submissionRequestId =
        task.type === TaskType.IMAGE
          ? getImageSubmissionRequestId(task)
          : undefined;
      const submissionStartedAt = task.startedAt || task.createdAt;
      const isCurrentSubmissionAttempt = () => {
        if (!submissionRequestId) return true;
        const currentTask = legacyTaskQueueService.getTask(taskId);
        return Boolean(
          currentTask &&
            currentTask.status === TaskStatus.PROCESSING &&
            getImageSubmissionRequestId(currentTask) === submissionRequestId &&
            (currentTask.startedAt || currentTask.createdAt) ===
              submissionStartedAt
        );
      };

      if (isImageRequestRecoveryTask(task)) {
        startImageRequestRecovery(task);
        return;
      }

      // Check if this is a character task
      if (task.type === TaskType.CHARACTER) {
        return executeCharacterTask(task);
      }

      // Check if this is a resumable async image task
      if (
        task.status === TaskStatus.PROCESSING &&
        isResumableAsyncImageTask(task)
      ) {
        return resumeAsyncImageTask(task);
      }

      // Skip resumable video tasks — handled by FallbackMediaExecutor.resumePendingTasks()
      if (
        task.type === TaskType.VIDEO &&
        task.remoteId &&
        task.status === TaskStatus.PROCESSING
      ) {
        return;
      }

      if (
        task.type === TaskType.AUDIO &&
        task.remoteId &&
        task.status === TaskStatus.PROCESSING
      ) {
        return resumeAudioTask(task);
      }

      // Prevent duplicate execution
      if (executingTasksRef.current.has(taskId)) {
        return;
      }

      executingTasksRef.current.add(taskId);

      try {
        // Update status to processing
        if (submissionRequestId) {
          const activated = await legacyTaskQueueService.activateImageAttempt(
            taskId,
            submissionRequestId
          );
          if (!activated) return;
        } else {
          legacyTaskQueueService.updateTaskStatus(
            taskId,
            TaskStatus.PROCESSING
          );
        }

        // Execute the generation
        const result = await generationAPIService.generate(
          taskId,
          task.params,
          task.type
        );

        if (!isActive || !isCurrentSubmissionAttempt()) return;

        let completed = true;
        if (submissionRequestId) {
          completed = await legacyTaskQueueService.completeImageAttempt(
            taskId,
            submissionRequestId,
            result
          );
        } else {
          legacyTaskQueueService.updateTaskStatus(
            taskId,
            TaskStatus.COMPLETED,
            { result }
          );
        }
        if (!completed || !isActive) return;
        if (submissionRequestId) {
          const currentTask = legacyTaskQueueService.getTask(taskId);
          if (
            !currentTask ||
            currentTask.status !== TaskStatus.COMPLETED ||
            getImageSubmissionRequestId(currentTask) !== submissionRequestId
          ) {
            return;
          }
        }

        // Register image/video metadata in unified cache
        if (result.url) {
          try {
            await unifiedCacheService.registerImageMetadata(result.url, {
              taskId: task.id,
              model: task.params.model,
              prompt: task.params.prompt,
              params: task.params,
            });
          } catch (error) {
            console.error(
              `[TaskExecutor] Failed to register metadata for task ${taskId}:`,
              error
            );
          }
        }
      } catch (error: any) {
        if (!isActive || !isCurrentSubmissionAttempt()) return;

        console.error(`[TaskExecutor] Task ${taskId} failed:`, error);

        const updatedTask = legacyTaskQueueService.getTask(taskId);
        if (!updatedTask) return;

        if (shouldRecoverImageSubmission(updatedTask, error)) {
          if (submissionRequestId) {
            await legacyTaskQueueService.markImageAttemptRecovering(
              taskId,
              submissionRequestId
            );
          }
          return;
        }

        // Extract error details - 优先使用 API 返回的详细错误信息
        const errorCode = error.httpStatus
          ? `HTTP_${error.httpStatus}`
          : error.name || 'ERROR';
        const errorMessage = getFriendlyErrorMessage(error);
        // 如果有完整响应，使用它；否则使用 API 错误体或错误消息
        const originalErrorInfo =
          error.fullResponse ||
          error.apiErrorBody ||
          error.message ||
          String(error);
        const errorDetails = {
          originalError: originalErrorInfo,
          timestamp: Date.now(),
        };

        const taskError = {
          code: errorCode,
          message: errorMessage,
          details: errorDetails,
        };
        if (submissionRequestId) {
          await legacyTaskQueueService.failImageAttempt(
            taskId,
            submissionRequestId,
            taskError
          );
        } else {
          // Check if we should retry - disabled, mark as failed directly
          legacyTaskQueueService.updateTaskStatus(taskId, TaskStatus.FAILED, {
            error: taskError,
          });
        }
      } finally {
        onTaskFinished(taskId);
      }
    };

    // 将任务加入执行队列（带并发控制）
    const enqueueTask = (task: Task) => {
      if (executingTasksRef.current.has(task.id)) return;
      // 避免重复入队
      if (pendingQueueRef.current.some((t) => t.id === task.id)) return;

      if (executingTasksRef.current.size < MAX_CONCURRENT_TASKS) {
        executeTask(task);
      } else {
        pendingQueueRef.current.push(task);
      }
    };

    // Function to check for pending tasks and resumable video tasks
    const processPendingTasks = () => {
      if (!isActive) return;

      const tasks = legacyTaskQueueService.getAllTasks();

      // Process pending tasks
      const pendingTasks = tasks.filter(
        (task) => task.status === TaskStatus.PENDING
      );

      // Process resumable tasks (processing with remoteId) — video tasks excluded, handled by FallbackMediaExecutor
      const resumableTasks = tasks.filter(
        (task) =>
          task.status === TaskStatus.PROCESSING &&
          isResumableAsyncImageTask(task)
      );
      const resumableAudioTasks = tasks.filter(
        (task) =>
          task.type === TaskType.AUDIO &&
          task.remoteId &&
          task.status === TaskStatus.PROCESSING
      );
      const recoverableImageRequestTasks = tasks.filter(
        isImageRequestRecoveryTask
      );

      console.warn(
        `[TaskExecutor] processPendingTasks: ${tasks.length} total, ${pendingTasks.length} pending, ${resumableTasks.length} resumable-image, ${resumableAudioTasks.length} resumable-audio, ${executingTasksRef.current.size} executing`
      );

      pendingTasks.forEach((task) => {
        enqueueTask(task);
      });
      resumableTasks.forEach((task) => {
        enqueueTask(task);
      });
      resumableAudioTasks.forEach((task) => {
        enqueueTask(task);
      });
      recoverableImageRequestTasks.forEach(startImageRequestRecovery);
    };

    // Function to check for timed out tasks
    const checkTimeouts = () => {
      if (!isActive) return;

      const tasks = legacyTaskQueueService.getAllTasks();
      const processingTasks = tasks.filter(
        (task) => task.status === TaskStatus.PROCESSING
      );

      processingTasks.forEach((task) => {
        if (isImageRequestRecoveryTask(task)) {
          return;
        }
        if (isTaskTimeout(task)) {
          console.warn(`[TaskExecutor] Task ${task.id} timed out`);

          // Cancel the API request
          generationAPIService.cancelRequest(task.id);

          const timeoutDetails = {
            originalError: `Task ${task.id} timed out after processing`,
            timestamp: Date.now(),
          };

          // Check if we should retry - disabled, mark as failed directly
          const timeoutError = {
            code: 'TIMEOUT',
            message: '任务执行超时',
            details: timeoutDetails,
          };
          if (task.type === TaskType.IMAGE) {
            const requestId = getImageSubmissionRequestId(task);
            void legacyTaskQueueService
              .failImageAttempt(task.id, requestId, timeoutError, {
                allowLegacyRequestId: true,
              })
              .catch((error) => {
                console.error(
                  '[TaskExecutor] Failed to persist image timeout:',
                  error
                );
              });
          } else {
            legacyTaskQueueService.updateTaskStatus(
              task.id,
              TaskStatus.FAILED,
              { error: timeoutError }
            );
          }
        }
      });
    };

    // Subscribe to task updates to catch new pending tasks and resumable video tasks
    const subscription = legacyTaskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (!isActive) return;

        if (event.type === 'taskDeleted') {
          imageGenerationRecoveryService.stop(event.task.id);
          generationAPIService.cancelRequest(event.task.id);
          return;
        }

        if (event.type === 'taskCreated' || event.type === 'taskUpdated') {
          const task = event.task;

          if (isImageRequestRecoveryTask(task)) {
            startImageRequestRecovery(task);
            return;
          }
          imageGenerationRecoveryService.stop(task.id);

          // Execute pending tasks
          if (task.status === TaskStatus.PENDING) {
            enqueueTask(task);
          }
          // Resume async image tasks that have remoteId and are in processing state (video tasks excluded, handled by FallbackMediaExecutor)
          else if (
            !executingTasksRef.current.has(task.id) &&
            task.remoteId &&
            task.status === TaskStatus.PROCESSING &&
            isResumableAsyncImageTask(task)
          ) {
            enqueueTask(task);
          } else if (
            !executingTasksRef.current.has(task.id) &&
            task.remoteId &&
            task.type === TaskType.AUDIO &&
            task.status === TaskStatus.PROCESSING
          ) {
            enqueueTask(task);
          }
        }
      });

    // Process existing pending tasks on mount (delayed to avoid competing with page initialization)
    // The subscription above will catch tasks created/restored after this point
    const startupTimer = setTimeout(processPendingTasks, STARTUP_DELAY_MS);

    // Set up timeout checker (every 10 seconds)
    timeoutCheckIntervalRef.current = setInterval(checkTimeouts, 10000);

    // Cleanup
    return () => {
      isActive = false;
      subscription.unsubscribe();
      clearTimeout(startupTimer);
      pendingQueueRef.current = [];

      if (timeoutCheckIntervalRef.current) {
        clearInterval(timeoutCheckIntervalRef.current);
      }

      // Cancel all ongoing requests
      executingTasksRef.current.forEach((taskId) => {
        generationAPIService.cancelRequest(taskId);
      });
      executingTasksRef.current.clear();
      imageGenerationRecoveryService.stopAll();
    };
  }, []);
}
