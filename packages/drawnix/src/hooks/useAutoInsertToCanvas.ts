/**
 * useAutoInsertToCanvas Hook
 *
 * 监听任务完成事件，自动将生成的图片/视频插入到画布中
 * 支持 AI 对话产生的所有产物自动插入
 * 支持宫格图任务的自动拆分和插入
 *
 * 集成 workflowCompletionService 追踪后处理状态：
 * - 开始后处理时发送 startPostProcessing
 * - 完成插入后发送 completePostProcessing（包含插入数量和位置）
 * - 失败时发送 failPostProcessing
 */

import { useEffect, useRef } from 'react';
import type { Point } from '@plait/core';
import { getTaskQueueService } from '../services/task-queue';
import { workflowCompletionService } from '../services/workflow-completion-service';
import { Task, TaskStatus, TaskType } from '../types/task.types';
import {
  executeCanvasInsertion,
  getCanvasBoard,
  insertAIFlow,
  insertImageGroup,
  parseSizeToPixels,
  quickInsert,
} from '../services/canvas-operations';
import {
  AUDIO_CARD_DEFAULT_HEIGHT,
  AUDIO_CARD_DEFAULT_WIDTH,
} from '../data/audio';
import { getInsertionPointBelowBottommostElement } from '../utils/selection-utils';
import { WorkZoneTransforms } from '../plugins/with-workzone';
import type { PlaitWorkZone } from '../types/workzone.types';
import {
  isGridImageTask as checkGridImageTask,
  isInspirationBoardTask as checkInspirationBoardTask,
  handleSplitAndInsertTask,
  type TaskParams,
} from '../services/media-result-handler';
import { insertMediaIntoFrame } from '../utils/frame-insertion-utils';
import { formatLyricsForCanvas, isLyricsTask } from '../utils/lyrics-task-utils';

/**
 * 配置项
 */
export interface AutoInsertConfig {
  /** 是否启用自动插入 */
  enabled: boolean;
  /** 是否插入 Prompt 文本 */
  insertPrompt?: boolean;
  /** 是否将同时完成的任务水平排列 */
  groupSimilarTasks?: boolean;
  /** 同组任务的时间窗口（毫秒），在此时间窗口内完成的同 Prompt 任务会水平排列 */
  groupTimeWindow?: number;
}

const DEFAULT_CONFIG: AutoInsertConfig = {
  enabled: true,
  insertPrompt: false,
  groupSimilarTasks: true,
  groupTimeWindow: 5000, // 5秒内完成的同 Prompt 任务会分组
};

/**
 * 已插入任务的记录，防止重复插入
 */
const insertedTaskIds = new Set<string>();

/**
 * 查找与任务关联的 WorkZone
 * @param taskId 任务 ID
 * @returns WorkZone 元素或 null
 */
function findWorkZoneForTask(taskId: string): PlaitWorkZone | null {
  const board = getCanvasBoard();
  if (!board) return null;

  const allWorkZones = WorkZoneTransforms.getAllWorkZones(board);
  for (const workzone of allWorkZones) {
    // 检查 workflow 的 steps 中是否包含此任务的 taskId
    const hasTask = workzone.workflow.steps?.some(step => {
      const result = step.result as { taskId?: string } | undefined;
      return result?.taskId === taskId;
    });
    if (hasTask) {
      return workzone;
    }
  }
  return null;
}

/**
 * 更新 WorkZone 中与任务关联的步骤状态
 * @param taskId 任务 ID
 * @param status 新状态
 * @param result 任务结果（可选）
 * @param error 错误信息（可选）
 */
function updateWorkflowStepForTask(
  taskId: string,
  status: 'completed' | 'failed',
  result?: { url?: string },
  error?: string
): void {
  const board = getCanvasBoard();
  if (!board) return;

  const workzone = findWorkZoneForTask(taskId);
  if (!workzone) return;

  // 找到包含此 taskId 的步骤并更新状态
  const updatedSteps = workzone.workflow.steps?.map(step => {
    const stepResult = step.result as { taskId?: string } | undefined;
    if (stepResult?.taskId === taskId) {
      const existingResult = typeof step.result === 'object' && step.result !== null ? step.result : {};
      return {
        ...step,
        status,
        result: result ? {
          ...existingResult,
          url: result.url,
          success: status === 'completed',
        } : step.result,
        error: error,
      };
    }
    return step;
  });

  if (updatedSteps) {
    WorkZoneTransforms.updateWorkflow(board, workzone.id, {
      steps: updatedSteps,
    });

    // 检查是否所有步骤都已完成或失败
    const allStepsFinished = updatedSteps.every(
      step => step.status === 'completed' || step.status === 'failed' || step.status === 'skipped'
    );

    if (allStepsFinished) {
      // 检查是否所有步骤都已完成或失败
      const hasQueuedTasks = updatedSteps.some(step => {
        const stepResult = step.result as { taskId?: string } | undefined;
        return !!stepResult?.taskId;
      });

      // 如果有队列任务（图片/视频生成），检查后处理是否完成
      if (hasQueuedTasks) {
        const allPostProcessingFinished = updatedSteps.every(step => {
          const stepResult = step.result as { taskId?: string } | undefined;
          if (stepResult?.taskId) {
            return workflowCompletionService.isPostProcessingCompleted(stepResult.taskId);
          }
          return true;
        });

        if (!allPostProcessingFinished) {
          return;
        }
      }

      // 延迟删除 WorkZone，让用户有时间看到完成状态
      setTimeout(() => {
        WorkZoneTransforms.removeWorkZone(board, workzone.id);
        
        // 触发事件通知 AI 输入框生成完成
        window.dispatchEvent(new CustomEvent('ai-generation-complete', {
          detail: { type: 'image', success: true, workzoneId: workzone.id }
        }));
      }, 1500);
    }
  }
}

/**
 * 待插入任务的缓冲区，用于分组
 */
interface PendingInsert {
  task: Task;
  completedAt: number;
}

/**
 * 自动插入到画布的 Hook
 */
export function useAutoInsertToCanvas(config: Partial<AutoInsertConfig> = {}): void {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const pendingInsertsRef = useRef<Map<string, PendingInsert[]>>(new Map());
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!mergedConfig.enabled) return;

    let isActive = true;

    /**
     * 执行批量插入
     */
    const flushPendingInserts = async () => {
      // console.log('[AutoInsert] flushPendingInserts called');
      const board = getCanvasBoard();
      if (!board || !isActive) {
        // console.log(`[AutoInsert] flushPendingInserts aborted: board=${!!board}, isActive=${isActive}`);
        return;
      }

      const pendingMap = pendingInsertsRef.current;
      if (pendingMap.size === 0) {
        // console.log('[AutoInsert] flushPendingInserts: no pending tasks');
        return;
      }

      // console.log(`[AutoInsert] flushPendingInserts: ${pendingMap.size} prompt groups to insert`);

      // 复制并清空待插入列表
      const toInsert = new Map(pendingMap);
      pendingMap.clear();

      // 尝试查找与第一个任务关联的 WorkZone，获取预期插入位置和 Frame 上下文
      const firstTask = Array.from(toInsert.values())[0]?.[0]?.task;
      let insertionPoint: Point | undefined;
      let targetFrameId: string | undefined;
      let targetFrameDimensions: { width: number; height: number } | undefined;

      if (firstTask) {
        const workzone = findWorkZoneForTask(firstTask.id);
        if (workzone?.expectedInsertPosition) {
          insertionPoint = workzone.expectedInsertPosition;
        }
        // 获取 Frame 上下文
        if (workzone?.targetFrameId && workzone?.targetFrameDimensions) {
          targetFrameId = workzone.targetFrameId;
          targetFrameDimensions = workzone.targetFrameDimensions;
        }
      }

      // 也检查 task.params 中的 Frame 上下文（TTD Dialog 路径）
      if (!targetFrameId && firstTask?.params?.targetFrameId) {
        targetFrameId = firstTask.params.targetFrameId as string;
        targetFrameDimensions = firstTask.params.targetFrameDimensions as { width: number; height: number } | undefined;
      }

      // 如果没有找到 WorkZone 或没有预期位置，回退到原来的逻辑
      if (!insertionPoint) {
        insertionPoint = getInsertionPointBelowBottommostElement(board);
      }

      // console.log(`[AutoInsert] Insertion point:`, insertionPoint);

      for (const [promptKey, inserts] of toInsert) {
        if (!isActive) break;

        // console.log(`[AutoInsert] Processing prompt group "${promptKey.substring(0, 30)}..." with ${inserts.length} tasks`);

        // 注册所有任务
        for (const { task } of inserts) {
          const batchId = (task.params as Record<string, unknown>).batchId as string | undefined;
          workflowCompletionService.registerTask(task.id, batchId);
          workflowCompletionService.startPostProcessing(
            task.id,
            inserts.length === 1 ? 'direct_insert' : 'group_insert'
          );
        }

        try {
          if (inserts.length === 1) {
            // 单个任务，直接插入
            const { task } = inserts[0];
            const isLyricsAudioTask = isLyricsTask(task);
            const url = task.result?.url;
            if (!url && !isLyricsAudioTask) {
              // console.log(`[AutoInsert] Task ${task.id} has no result URL, skipping`);
              workflowCompletionService.failPostProcessing(task.id, 'No result URL');
              continue;
            }

            const type =
              isLyricsAudioTask
                ? 'text'
                : task.type === TaskType.VIDEO
                ? 'video'
                : task.type === TaskType.AUDIO
                ? 'audio'
                : 'image';
            const dimensions =
              type === 'audio'
                ? {
                    width: AUDIO_CARD_DEFAULT_WIDTH,
                    height: AUDIO_CARD_DEFAULT_HEIGHT,
                  }
                : type === 'text'
                ? undefined
                : parseSizeToPixels(task.params.size);
            const metadata =
              type === 'audio'
                ? {
                    title: task.result?.title || task.params.title,
                    duration: task.result?.duration,
                    previewImageUrl: task.result?.previewImageUrl,
                    tags:
                      typeof task.params.tags === 'string'
                        ? task.params.tags
                        : undefined,
                    mv:
                      typeof task.params.mv === 'string'
                        ? task.params.mv
                        : undefined,
                    prompt: task.params.prompt,
                    providerTaskId:
                      task.result?.providerTaskId || task.remoteId,
                    clipId:
                      task.result?.primaryClipId || task.result?.clipIds?.[0],
                    clipIds: task.result?.clipIds,
                  }
                : undefined;
            // 展开多图：优先使用 urls 数组
            const allUrls =
              type === 'text'
                ? [formatLyricsForCanvas(task)]
                : task.result?.urls?.length
                ? task.result.urls
                : [url as string];

            // 检查是否需要插入到 Frame 内部
            const taskFrameId = targetFrameId || (task.params.targetFrameId as string | undefined);
            const taskFrameDims = targetFrameDimensions || (task.params.targetFrameDimensions as { width: number; height: number } | undefined);

            if (taskFrameId && taskFrameDims && board && type !== 'audio' && type !== 'text') {
              // 插入到 Frame 内部，contain 模式等比缩放
              await insertMediaIntoFrame(board, allUrls[0], type, taskFrameId, taskFrameDims, dimensions);
            } else if (mergedConfig.insertPrompt && type !== 'text') {
              await insertAIFlow(
                task.params.prompt,
                allUrls.map((u, index) => ({
                  type,
                  url: u,
                  dimensions,
                  metadata:
                    type === 'audio'
                      ? {
                          ...metadata,
                          title:
                            task.result?.clips?.[index]?.title ||
                            (allUrls.length > 1
                              ? `${metadata?.title || task.params.title || 'Audio'} ${index + 1}`
                              : metadata?.title),
                          clipId:
                            task.result?.clips?.[index]?.clipId ||
                            task.result?.clipIds?.[index] ||
                            metadata?.clipId,
                        }
                      : undefined,
                })),
                insertionPoint
              );
            } else if (type === 'image' && allUrls.length > 1) {
              await insertImageGroup(allUrls, insertionPoint, dimensions);
            } else if (type === 'text') {
              await quickInsert('text', allUrls[0], insertionPoint);
            } else if (type === 'audio' && allUrls.length > 1) {
              const groupId = `audio-group-${task.id}`;
              await executeCanvasInsertion({
                items: allUrls.map((audioUrl, index) => ({
                  type: 'audio',
                  content: audioUrl,
                  groupId,
                  dimensions,
                  metadata: {
                    ...metadata,
                    title:
                      task.result?.clips?.[index]?.title ||
                      (allUrls.length > 1
                        ? `${metadata?.title || task.params.title || 'Audio'} ${index + 1}`
                        : metadata?.title),
                    clipId:
                      task.result?.clips?.[index]?.clipId ||
                      task.result?.clipIds?.[index] ||
                      metadata?.clipId,
                  },
                })),
                startPoint: insertionPoint,
              });
            } else {
              await quickInsert(type, allUrls[0], insertionPoint, dimensions, metadata);
            }

            workflowCompletionService.completePostProcessing(task.id, allUrls.length, insertionPoint);
          } else {
            // 多个同 Prompt 任务，水平排列（展开每个任务的多图）
            const firstInsertTask = inserts[0].task;
            const isLyricsAudioTask = isLyricsTask(firstInsertTask);
            const urls = isLyricsAudioTask
              ? inserts.map(({ task }) => formatLyricsForCanvas(task))
              : inserts
                  .flatMap(({ task }) =>
                    task.result?.urls?.length ? task.result.urls : [task.result?.url]
                  )
                  .filter((url): url is string => !!url);

            if (urls.length === 0) {
              // console.log(`[AutoInsert] No valid URLs in group, skipping`);
              for (const { task } of inserts) {
                workflowCompletionService.failPostProcessing(task.id, 'No result URL');
              }
              continue;
            }

            const type =
              isLyricsAudioTask
                ? 'text'
                : firstInsertTask.type === TaskType.VIDEO
                ? 'video'
                : firstInsertTask.type === TaskType.AUDIO
                ? 'audio'
                : 'image';
            const dimensions =
              type === 'audio'
                ? {
                    width: AUDIO_CARD_DEFAULT_WIDTH,
                    height: AUDIO_CARD_DEFAULT_HEIGHT,
                  }
                : type === 'text'
                ? undefined
                : parseSizeToPixels(firstInsertTask.params.size);
            const baseMetadata =
              type === 'audio'
                ? {
                    title:
                      firstInsertTask.result?.title || firstInsertTask.params.title,
                    duration: firstInsertTask.result?.duration,
                    previewImageUrl: firstInsertTask.result?.previewImageUrl,
                    tags:
                      typeof firstInsertTask.params.tags === 'string'
                        ? firstInsertTask.params.tags
                        : undefined,
                    mv:
                      typeof firstInsertTask.params.mv === 'string'
                        ? firstInsertTask.params.mv
                        : undefined,
                    prompt: firstInsertTask.params.prompt,
                    providerTaskId:
                      firstInsertTask.result?.providerTaskId ||
                      firstInsertTask.remoteId,
                    clipIds: firstInsertTask.result?.clipIds,
                  }
                : undefined;

            // console.log(`[AutoInsert] Inserting group of ${urls.length} ${type}s`);

            if (mergedConfig.insertPrompt && type !== 'text') {
              await insertAIFlow(
                firstInsertTask.params.prompt,
                urls.map((resultUrl, index) => ({
                  type,
                  url: resultUrl,
                  dimensions,
                  metadata:
                    type === 'audio'
                      ? {
                          ...baseMetadata,
                          title:
                            firstInsertTask.result?.clips?.[index]?.title ||
                            (urls.length > 1
                              ? `${baseMetadata?.title || firstInsertTask.params.title || 'Audio'} ${index + 1}`
                              : baseMetadata?.title),
                          clipId:
                            firstInsertTask.result?.clips?.[index]?.clipId ||
                            firstInsertTask.result?.clipIds?.[index],
                        }
                      : undefined,
                })),
                insertionPoint
              );
            } else {
              if (type === 'image') {
                await insertImageGroup(urls, insertionPoint, dimensions);
              } else if (type === 'text') {
                await executeCanvasInsertion({
                  items: inserts.map(({ task }) => ({
                    type: 'text',
                    content: formatLyricsForCanvas(task),
                    groupId: `lyrics-group-${firstInsertTask.id}`,
                  })),
                  startPoint: insertionPoint,
                });
              } else if (type === 'audio') {
                const groupId = `audio-group-${firstInsertTask.id}`;
                await executeCanvasInsertion({
                  items: urls.map((resultUrl, index) => ({
                    type: 'audio',
                    content: resultUrl,
                    groupId,
                    dimensions,
                      metadata: {
                        ...baseMetadata,
                        title:
                          firstInsertTask.result?.clips?.[index]?.title ||
                          (urls.length > 1
                            ? `${baseMetadata?.title || firstInsertTask.params.title || 'Audio'} ${index + 1}`
                            : baseMetadata?.title),
                        clipId:
                          firstInsertTask.result?.clips?.[index]?.clipId ||
                          firstInsertTask.result?.clipIds?.[index],
                      },
                    })),
                  startPoint: insertionPoint,
                });
              } else {
                for (const url of urls) {
                  await quickInsert('video', url, insertionPoint, dimensions);
                }
              }
            }

            // console.log(`[AutoInsert] Successfully inserted group of ${urls.length} ${type}s`);

            // 标记所有任务完成
            for (const { task } of inserts) {
              workflowCompletionService.completePostProcessing(task.id, 1, insertionPoint);
            }
          }
        } catch (error) {
          console.error(`[AutoInsert] Failed to insert for prompt ${promptKey}:`, error);
          for (const { task } of inserts) {
            workflowCompletionService.failPostProcessing(task.id, String(error));
          }
        }
      }
    };

    /**
     * 调度 flush 操作
     */
    const scheduleFlush = () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = setTimeout(() => {
        flushPendingInserts();
      }, mergedConfig.groupTimeWindow);
    };

    /**
     * 处理宫格图/灵感图任务：使用统一的媒体结果处理服务
     */
    const handleSplitTask = async (task: Task) => {
      const url = task.result?.url;
      if (!url) {
        console.error('[AutoInsert] Split task has no result URL');
        workflowCompletionService.failPostProcessing(task.id, 'No result URL');
        // 更新步骤状态为失败
        updateWorkflowStepForTask(task.id, 'failed', undefined, 'No result URL');
        return;
      }

      const params = task.params as TaskParams;
      const result = await handleSplitAndInsertTask(task.id, url, params, { scrollToResult: true });
      
      // 拆分完成后更新步骤状态
      // Note: 成功时 SW 已通过 workflow:stepStatus 事件标记为 completed
      // 只有失败时才需要本地更新（拆分是客户端操作，SW 不知道拆分结果）
      if (!result.success) {
        updateWorkflowStepForTask(task.id, 'failed', undefined, result.error || '拆分失败');
      }
    };

    /**
     * 处理任务完成事件
     */
    const handleTaskCompleted = (task: Task) => {
      // 检查任务是否配置了自动插入画布
      if (!task.params.autoInsertToCanvas) {
        return;
      }

      // 检查是否已经插入过（内存中的记录）
      if (insertedTaskIds.has(task.id)) {
        // console.log(`[AutoInsert] Task ${task.id} skipped: already in insertedTaskIds (memory)`);
        return;
      }

      // 检查是否已经插入过（持久化的标记）
      if (task.insertedToCanvas) {
        // console.log(`[AutoInsert] Task ${task.id} skipped: insertedToCanvas flag is true (persisted)`);
        insertedTaskIds.add(task.id);
        return;
      }

      // 只处理图片、视频和音频任务
      if (
        task.type !== TaskType.IMAGE &&
        task.type !== TaskType.VIDEO &&
        task.type !== TaskType.AUDIO
      ) {
        // console.log(`[AutoInsert] Task ${task.id} skipped: type is ${task.type}, not IMAGE or VIDEO`);
        return;
      }

      // 检查是否有结果 URL
      if (!task.result?.url && !isLyricsTask(task)) {
        return;
      }

      // console.log(`[AutoInsert] Task ${task.id} passed all checks, will be inserted`);

      // 标记为已处理（内存）
      insertedTaskIds.add(task.id);

      // 标记为已插入（持久化到 SW）
      const taskQueueService = getTaskQueueService();
      taskQueueService.markAsInserted(task.id);

      const params = task.params as TaskParams;

      // 检查是否为灵感图任务（需要在宫格图之前检查）
      if (checkInspirationBoardTask(params)) {
        // console.log(`[AutoInsert] Task ${task.id} is inspiration board task, handling split`);
        // 对于需要拆分的任务，先不更新步骤状态，等拆分完成后再更新
        handleSplitTask(task);
        return;
      }

      // 检查是否为宫格图任务
      if (checkGridImageTask(params)) {
        // console.log(`[AutoInsert] Task ${task.id} is grid image task, handling split`);
        // 对于需要拆分的任务，先不更新步骤状态，等拆分完成后再更新
        handleSplitTask(task);
        return;
      }

      // Note: 步骤状态更新现在由 SW 统一通过 workflow:stepStatus 事件处理
      // 不再需要在这里调用 updateWorkflowStepForTask

      // 获取 Prompt 作为分组 key
      const promptKey = task.params.prompt || 'unknown';
      // console.log(`[AutoInsert] Task ${task.id} added to pending inserts with promptKey: ${promptKey.substring(0, 30)}`);

      // 添加到待插入列表
      const pendingList = pendingInsertsRef.current.get(promptKey) || [];
      pendingList.push({ task, completedAt: Date.now() });
      pendingInsertsRef.current.set(promptKey, pendingList);

      // 调度 flush
      if (mergedConfig.groupSimilarTasks) {
        // console.log(`[AutoInsert] Scheduling flush in ${mergedConfig.groupTimeWindow}ms`);
        scheduleFlush();
      } else {
        // console.log(`[AutoInsert] Flushing immediately`);
        flushPendingInserts();
      }
    };

    /**
     * 处理任务失败事件
     * Note: 步骤状态更新现在由 SW 统一通过 workflow:stepStatus 事件处理
     * 不再需要在这里调用 updateWorkflowStepForTask
     */
    const handleTaskFailed = (_task: Task) => {
      // 任务失败的步骤状态更新由 SW 的 workflow:stepStatus 事件处理
      // 这里不再需要手动更新 WorkZone
    };

    // 订阅任务更新事件
    const taskQueueService = getTaskQueueService();
    // console.log('[AutoInsert] Subscribing to task updates');
    const subscription = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (!isActive) {
        // console.log('[AutoInsert] Received event but hook is inactive, ignoring');
        return;
      }

      // console.log(`[AutoInsert] Received event: ${event.type}, task: ${event.task.id}, status: ${event.task.status}`);

      if (event.type === 'taskUpdated' || event.type === 'taskCompleted') {
        if (event.task.status === TaskStatus.COMPLETED) {
          handleTaskCompleted(event.task);
        } else if (event.task.status === TaskStatus.FAILED) {
          handleTaskFailed(event.task);
        }
      } else if (event.type === 'taskFailed') {
        handleTaskFailed(event.task);
      } else if (event.type === 'taskSynced') {
        if (event.task.status === TaskStatus.COMPLETED) {
          handleTaskCompleted(event.task);
        }
      }
    });

    // 订阅后处理完成事件，以便在所有任务插入完成后删除 WorkZone
    const completionSub = workflowCompletionService.observeCompletionEvents().subscribe(event => {
      if (event.type === 'postProcessingCompleted' || event.type === 'postProcessingFailed') {
        const board = getCanvasBoard();
        if (!board) return;

        const workzone = findWorkZoneForTask(event.taskId);
        if (workzone) {
          // 重新检查该 WorkZone 的所有步骤
          const allStepsFinished = workzone.workflow.steps?.every(
            step => step.status === 'completed' || step.status === 'failed' || step.status === 'skipped'
          );

          if (allStepsFinished) {
            const allPostProcessingFinished = workzone.workflow.steps?.every(step => {
              const stepResult = step.result as { taskId?: string } | undefined;
              if (stepResult?.taskId) {
                return workflowCompletionService.isPostProcessingCompleted(stepResult.taskId);
              }
              return true;
            });

            if (allPostProcessingFinished) {
              setTimeout(() => {
                WorkZoneTransforms.removeWorkZone(board, workzone.id);
                window.dispatchEvent(new CustomEvent('ai-generation-complete', {
                  detail: { type: 'image', success: true, workzoneId: workzone.id }
                }));
              }, 1500);
            }
          }
        }
      }
    });

    // 清理函数
    return () => {
      isActive = false;
      subscription.unsubscribe();
      completionSub.unsubscribe();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, [mergedConfig.enabled, mergedConfig.insertPrompt, mergedConfig.groupSimilarTasks, mergedConfig.groupTimeWindow]);
}

/**
 * 清除已插入任务的记录（用于测试或重置）
 */
export function clearInsertedTaskIds(): void {
  insertedTaskIds.clear();
}

export default useAutoInsertToCanvas;
