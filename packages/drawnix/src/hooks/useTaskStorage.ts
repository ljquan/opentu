/**
 * useTaskStorage Hook
 *
 * Manages task queue initialization and state restoration from IndexedDB.
 * Handles data migration from legacy databases and restores interrupted tasks.
 *
 * 注意：任务持久化由 taskQueueService.persistTask() 统一写入 aitu-app 数据库，
 * 此 hook 只负责启动时的数据加载和恢复，不再额外订阅写入。
 */

import { useEffect, useState } from 'react';
import {
  taskQueueService,
  legacyTaskQueueService,
} from '../services/task-queue';
import { taskStorageReader } from '../services/task-storage-reader';
import { TaskType, TaskStatus, TaskExecutionPhase } from '../types/task.types';
import { isResumableAsyncImageTask } from '../utils/task-utils';
import {
  getImageSubmissionRequestId,
  IMAGE_SUBMISSION_REQUEST_ID_PARAM,
  isImageRequestRecoveryCandidate,
} from '../services/image-generation-recovery-service';
import { settingsManager } from '../utils/settings-manager';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../constants/TASK_CONSTANTS';

// Global flag to prevent multiple initializations (persists across HMR)
let initializationStarted = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Wait for browser idle time to execute heavy operations
 * Falls back to setTimeout if requestIdleCallback is not available
 */
function waitForIdle(timeout = 100): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      (window as Window).requestIdleCallback(() => resolve(), { timeout });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Hook for task queue initialization and restoration
 *
 * Responsibilities:
 * - Migrate data from legacy databases (sw-task-queue → aitu-app)
 * - Load tasks from IndexedDB on mount
 * - Restore interrupted tasks
 *
 * @returns boolean - Whether task storage is initialized and ready
 */
export function useTaskStorage(): boolean {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let subscriptionActive = true;

    // Initialize storage and load tasks (deferred to browser idle time)
    const initializeStorage = async () => {
      // Wait for browser idle time to avoid blocking page load
      await waitForIdle(50);
      console.warn('[useTaskStorage] Idle callback fired, starting init');

      try {
        // 数据迁移：从旧 sw-task-queue 数据库迁移到 aitu-app（一次性）
        // 必须在 taskStorageReader.getAllTasks() 之前完成，
        // 否则读取 aitu-app 时数据还在 sw-task-queue 中，导致首次打开为空
        const { migrateFromLegacyDB } = await import(
          '../services/app-database'
        );
        await migrateFromLegacyDB();

        // Load tasks from IndexedDB (aitu-app)
        const storedTasks = await taskStorageReader.getAllTasks();
        console.warn(
          `[useTaskStorage] Loaded ${storedTasks.length} tasks from IndexedDB`
        );

        const deferredImageRecoveryTasks: Array<{
          taskId: string;
          requestId: string;
          startedAt: number;
          deadline: number;
          executionToken?: symbol;
        }> = [];

        if (storedTasks.length > 0) {
          const tasksForMemory = storedTasks.map((task) => {
            if (
              task.status !== TaskStatus.PROCESSING ||
              task.type !== TaskType.IMAGE ||
              task.remoteId ||
              taskQueueService.isTaskExecutionActive(task.id) ||
              (task.executionPhase !== TaskExecutionPhase.SUBMITTING &&
                task.executionPhase !== TaskExecutionPhase.DOWNLOADING &&
                task.executionPhase !== TaskExecutionPhase.POLLING)
            ) {
              return task;
            }

            const recoveryTask = {
              ...task,
              executionPhase: TaskExecutionPhase.POLLING,
            };
            if (!isImageRequestRecoveryCandidate(recoveryTask)) {
              return task;
            }

            const startedAt = task.startedAt ?? task.createdAt;
            deferredImageRecoveryTasks.push({
              taskId: task.id,
              requestId: getImageSubmissionRequestId(recoveryTask),
              startedAt,
              deadline: startedAt + IMAGE_GENERATION_TIMEOUT_MS,
            });

            return {
              ...task,
              executionPhase: TaskExecutionPhase.SUBMITTING,
            };
          });

          await taskQueueService.restoreTasks(tasksForMemory);
          for (const deferredTask of deferredImageRecoveryTasks) {
            deferredTask.executionToken =
              taskQueueService.getTaskExecutionToken(deferredTask.taskId);
          }
          console.warn(
            `[useTaskStorage] Restored ${storedTasks.length} tasks to memory`
          );

          // Handle interrupted processing tasks based on task type and remoteId
          const processingTasks = storedTasks.filter(
            (task) =>
              task.status === 'processing' &&
              !taskQueueService.isTaskExecutionActive(task.id)
          );

          if (processingTasks.length > 0) {
            console.warn(
              `[useTaskStorage] Found ${processingTasks.length} interrupted processing tasks`
            );

            for (const task of processingTasks) {
              const isAsyncImageResumable = isResumableAsyncImageTask(task);

              const imageRecoveryTask =
                task.type === TaskType.IMAGE &&
                !task.remoteId &&
                (task.executionPhase === TaskExecutionPhase.SUBMITTING ||
                  task.executionPhase === TaskExecutionPhase.DOWNLOADING ||
                  task.executionPhase === TaskExecutionPhase.POLLING)
                  ? {
                      ...task,
                      executionPhase: TaskExecutionPhase.POLLING,
                    }
                  : null;
              const isImageRecoveryTask = Boolean(
                imageRecoveryTask &&
                  isImageRequestRecoveryCandidate(imageRecoveryTask)
              );
              const isVideoResumable =
                task.type === TaskType.VIDEO && !!task.remoteId;
              const isAudioResumable =
                task.type === TaskType.AUDIO && !!task.remoteId;

              console.warn(
                `[useTaskStorage]   task=${task.id} type=${task.type} phase=${
                  task.executionPhase || 'unknown'
                } remoteId=${task.remoteId || 'none'} → ${
                  isVideoResumable ||
                  isAudioResumable ||
                  isAsyncImageResumable ||
                  isImageRecoveryTask
                    ? 'KEEP'
                    : 'MARK_FAILED'
                }`
              );

              // Video或异步图片任务且有 remoteId：允许后续恢复轮询
              if (
                isVideoResumable ||
                isAudioResumable ||
                isAsyncImageResumable ||
                isImageRecoveryTask
              ) {
                // 保持处理中，等待对应恢复器接管。
              } else {
                // 其他任务视为中断失败
                let errorMessage = '任务被中断（页面刷新）';
                let errorCode = 'INTERRUPTED';

                if (
                  task.type === TaskType.VIDEO &&
                  task.executionPhase === TaskExecutionPhase.SUBMITTING
                ) {
                  errorMessage = '任务在提交过程中被中断，可能已在后台执行';
                  errorCode = 'INTERRUPTED_DURING_SUBMISSION';
                }

                const interruptedError = {
                  code: errorCode,
                  message: errorMessage,
                  details: {
                    originalError: `Task interrupted by page refresh before completion (phase: ${
                      task.executionPhase || 'unknown'
                    })`,
                    timestamp: Date.now(),
                  },
                };
                if (task.type === TaskType.IMAGE) {
                  const persistedRequestId =
                    task.params[IMAGE_SUBMISSION_REQUEST_ID_PARAM];
                  if (typeof persistedRequestId === 'string') {
                    try {
                      await legacyTaskQueueService.failImageAttempt(
                        task.id,
                        persistedRequestId,
                        interruptedError,
                        { clearStartedAt: true }
                      );
                    } catch (error) {
                      console.error(
                        `[useTaskStorage] Failed to persist interrupted image task ${task.id}:`,
                        error
                      );
                    }
                  } else {
                    legacyTaskQueueService.updateTaskStatus(
                      task.id,
                      TaskStatus.FAILED,
                      {
                        startedAt: undefined,
                        executionPhase: undefined,
                        error: interruptedError,
                      }
                    );
                  }
                } else {
                  legacyTaskQueueService.updateTaskStatus(
                    task.id,
                    TaskStatus.FAILED,
                    {
                      startedAt: undefined,
                      executionPhase: undefined,
                      error: interruptedError,
                    }
                  );
                }
              }
            }
          }

          // Check for failed remote tasks that can be recovered
          // 视频任务有 remoteId 说明已提交到服务端，刷新后应始终尝试重新轮询
          const failedRemoteTasks = storedTasks.filter(
            (task) =>
              task.status === 'failed' &&
              task.remoteId &&
              (task.type === TaskType.VIDEO ||
                task.type === TaskType.AUDIO ||
                isResumableAsyncImageTask(task))
          );

          // 无条件打印汇总，便于定位
          const failedVideoCount = storedTasks.filter(
            (t) => t.status === 'failed' && t.type === TaskType.VIDEO
          ).length;
          const failedVideoWithRemoteId = storedTasks.filter(
            (t) =>
              t.status === 'failed' && t.type === TaskType.VIDEO && t.remoteId
          ).length;
          const failedAudioCount = storedTasks.filter(
            (t) => t.status === 'failed' && t.type === TaskType.AUDIO
          ).length;
          const failedAudioWithRemoteId = storedTasks.filter(
            (t) =>
              t.status === 'failed' && t.type === TaskType.AUDIO && t.remoteId
          ).length;
          console.warn(
            `[useTaskStorage] Recovery check: ${processingTasks.length} processing, ${failedVideoCount} failed video (${failedVideoWithRemoteId} with remoteId), ${failedAudioCount} failed audio (${failedAudioWithRemoteId} with remoteId), ${failedRemoteTasks.length} recoverable`
          );

          if (failedRemoteTasks.length > 0) {
            // 白名单：只恢复因页面刷新/客户端中断导致的失败，真正的业务失败不恢复
            const RECOVERABLE_ERROR_CODES = new Set([
              'INTERRUPTED',
              'INTERRUPTED_DURING_SUBMISSION',
              'RESUME_FAILED',
            ]);

            failedRemoteTasks.forEach((task) => {
              const errorCode = task.error?.code || '';
              if (!RECOVERABLE_ERROR_CODES.has(errorCode)) {
                console.warn(
                  `[useTaskStorage] Skip recovery for task ${
                    task.id
                  }: terminal failure (${errorCode || 'no error code'})`
                );
                return;
              }

              console.warn(
                `[useTaskStorage] Recovering interrupted task ${task.id} (error: ${errorCode}, remoteId: ${task.remoteId})`
              );

              legacyTaskQueueService.updateTaskStatus(
                task.id,
                TaskStatus.PROCESSING,
                {
                  error: undefined,
                  executionPhase: TaskExecutionPhase.POLLING,
                }
              );
            });
          }
        }

        if (deferredImageRecoveryTasks.length > 0) {
          // 图片恢复资格依赖已解密的供应商凭据；不要让设置初始化阻塞其他任务恢复。
          const pendingTasks = deferredImageRecoveryTasks.sort(
            (left, right) => left.deadline - right.deadline
          );
          let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

          const failDeferredTasks = async (
            tasks: typeof pendingTasks,
            reason: 'timeout' | 'settings-unavailable'
          ) => {
            const timedOut = reason === 'timeout';
            for (const {
              taskId,
              requestId,
              startedAt,
              executionToken,
            } of tasks) {
              if (!executionToken) continue;
              try {
                await legacyTaskQueueService.failImageAttempt(
                  taskId,
                  requestId,
                  {
                    code: timedOut
                      ? 'RECOVERY_TIMEOUT'
                      : 'RECOVERY_ROUTE_UNAVAILABLE',
                    message: timedOut
                      ? '图片结果恢复超时'
                      : '设置初始化失败，无法继续恢复图片结果',
                    details: {
                      originalError: timedOut
                        ? 'Image recovery deadline expired while waiting for settings'
                        : 'Settings initialization failed before image recovery',
                      timestamp: Date.now(),
                    },
                  },
                  { executionGuard: { startedAt, executionToken } }
                );
              } catch (error) {
                console.error(
                  `[useTaskStorage] Failed to persist deferred image recovery failure for task ${taskId}:`,
                  error
                );
              }
            }
          };

          const scheduleNextDeadline = () => {
            if (pendingTasks.length === 0) return;
            const delay = Math.max(0, pendingTasks[0].deadline - Date.now());
            deadlineTimer = setTimeout(() => {
              const now = Date.now();
              const expiredTasks = [] as typeof pendingTasks;
              while (
                pendingTasks.length > 0 &&
                pendingTasks[0].deadline <= now
              ) {
                expiredTasks.push(pendingTasks.shift()!);
              }

              if (expiredTasks.length === 0) {
                scheduleNextDeadline();
                return;
              }
              void failDeferredTasks(expiredTasks, 'timeout').finally(
                scheduleNextDeadline
              );
            }, delay);
          };

          scheduleNextDeadline();
          void settingsManager.waitForInitialization().then(
            async () => {
              if (deadlineTimer) clearTimeout(deadlineTimer);
              const tasks = pendingTasks.splice(0);
              for (const {
                taskId,
                requestId,
                startedAt,
                executionToken,
              } of tasks) {
                if (!executionToken) continue;
                try {
                  await legacyTaskQueueService.markImageAttemptRecovering(
                    taskId,
                    requestId,
                    { startedAt, executionToken }
                  );
                } catch (error) {
                  console.error(
                    `[useTaskStorage] Failed to persist image recovery state for task ${taskId}:`,
                    error
                  );
                }
              }
            },
            async (error) => {
              if (deadlineTimer) clearTimeout(deadlineTimer);
              const tasks = pendingTasks.splice(0);
              console.error(
                '[useTaskStorage] Failed to initialize settings for image recovery:',
                error
              );
              await failDeferredTasks(tasks, 'settings-unavailable');
            }
          );
        }
      } catch (error) {
        console.error('[useTaskStorage] Failed to initialize storage:', error);
      }
    };

    if (!initializationPromise) {
      initializationPromise = (async () => {
        if (initializationStarted) return;
        initializationStarted = true;
        await initializeStorage();
      })();
    }

    initializationPromise.then(() => {
      if (subscriptionActive) {
        setIsReady(true);
      }
    });

    return () => {
      subscriptionActive = false;
    };
  }, []);

  return isReady;
}
