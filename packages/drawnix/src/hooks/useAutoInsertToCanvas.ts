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
import { resolveAudioResultUrls } from '../services/audio-task-result-utils';
import { Task, TaskStatus, TaskType } from '../types/task.types';
import {
  type CanvasInsertionResultData,
  type ContentType,
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
import { ImageGenerationAnchorTransforms } from '../plugins/with-image-generation-anchor';
import { WorkZoneTransforms } from '../plugins/with-workzone';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type PlaitImageGenerationAnchor,
} from '../types/image-generation-anchor.types';
import type { PlaitWorkZone } from '../types/workzone.types';
import {
  isGridImageTask as checkGridImageTask,
  isInspirationBoardTask as checkInspirationBoardTask,
  handleSplitAndInsertTask,
  type TaskParams,
} from '../services/media-result-handler';
import { insertMediaIntoFrame } from '../utils/frame-insertion-utils';
import { buildImageGenerationAnchorPresentationPatch } from '../utils/image-generation-anchor-state';
import {
  getAnchorCurrentPosition,
  isSamePoint,
  resolveImageAnchorInsertionPoint,
} from '../utils/image-generation-anchor-insertion';
import {
  formatLyricsForCanvas,
  getLyricsTitle,
  isLyricsTask,
} from '../utils/lyrics-task-utils';
import {
  getImageGenerationTaskInsertGroupKey,
} from '../utils/image-generation-anchor-task';
import { findImageGenerationAnchorForTaskOnBoard } from '../utils/image-generation-anchor-lookup';

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
    const hasTask = workzone.workflow.steps?.some((step) => {
      const result = step.result as { taskId?: string } | undefined;
      return result?.taskId === taskId;
    });
    if (hasTask) {
      return workzone;
    }
  }
  return null;
}

function findImageGenerationAnchorForTask(
  taskOrTaskId: Task | string
): PlaitImageGenerationAnchor | null {
  const board = getCanvasBoard();
  if (!board) return null;
  return findImageGenerationAnchorForTaskOnBoard(board, taskOrTaskId);
}

function linkImageGenerationAnchorToTask(
  anchor: PlaitImageGenerationAnchor,
  task: Task
): void {
  const board = getCanvasBoard();
  if (!board) return;

  const nextTaskIds = anchor.taskIds.includes(task.id)
    ? anchor.taskIds
    : [...anchor.taskIds, task.id];

  ImageGenerationAnchorTransforms.updateAnchor(board, anchor.id, {
    taskIds: nextTaskIds,
    primaryTaskId: anchor.primaryTaskId || task.id,
  });
}

function reserveTaskInsertion(taskId: string): void {
  insertedTaskIds.add(taskId);
}

function releaseTaskInsertion(taskId: string): void {
  insertedTaskIds.delete(taskId);
}

function finalizeTaskInsertion(taskId: string): void {
  insertedTaskIds.add(taskId);
  getTaskQueueService().markAsInserted(taskId);
}

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

function isDimensions(
  value: unknown
): value is { width: number; height: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { width?: unknown }).width === 'number' &&
    typeof (value as { height?: unknown }).height === 'number'
  );
}

function getTaskImageDimensions(
  task: Task,
  fallback?: { width: number; height: number }
): { width: number; height: number } | undefined {
  if (fallback) {
    return fallback;
  }

  const result = task.result as { width?: number; height?: number } | undefined;

  if (
    typeof result?.width === 'number' &&
    typeof result?.height === 'number' &&
    result.width > 0 &&
    result.height > 0
  ) {
    return {
      width: result.width,
      height: result.height,
    };
  }

  return parseSizeToPixels(task.params.size);
}

function resolveAnchorInsertionPreviewSize(
  anchor: PlaitImageGenerationAnchor | null,
  size?: { width: number; height: number }
): { width: number; height: number } | undefined {
  if (!anchor || anchor.anchorType !== 'stack') {
    return size;
  }

  return undefined;
}

function syncImageAnchorGeometry(
  board: ReturnType<typeof getCanvasBoard>,
  anchor: PlaitImageGenerationAnchor | null,
  options: {
    position?: Point;
    size?: { width: number; height: number };
    transitionMode?: PlaitImageGenerationAnchor['transitionMode'];
  }
): void {
  if (!board || !anchor) {
    return;
  }

  const patch: Partial<PlaitImageGenerationAnchor> = {};

  if (options.position) {
    patch.expectedInsertPosition = options.position;
  }

  if (
    options.transitionMode &&
    options.transitionMode !== anchor.transitionMode
  ) {
    patch.transitionMode = options.transitionMode;
  }

  if (Object.keys(patch).length > 0) {
    ImageGenerationAnchorTransforms.updateAnchor(board, anchor.id, patch);
  }

  if (options.position || options.size) {
    ImageGenerationAnchorTransforms.updateGeometry(board, anchor.id, {
      position: options.position,
      size: options.size,
    });
  }
}

function getInsertionResultPoint(result: unknown, fallback: Point): Point {
  const data = (
    result as { data?: { firstElementPosition?: unknown } } | undefined
  )?.data;
  return isPoint(data?.firstElementPosition)
    ? data.firstElementPosition
    : fallback;
}

function getInsertionResultGeometry(
  result: unknown,
  fallbackPosition: Point,
  fallbackSize?: { width: number; height: number },
  preferredTypes?: ContentType[]
): {
  elementId?: string;
  position: Point;
  size?: { width: number; height: number };
} {
  const data = (result as { data?: CanvasInsertionResultData } | undefined)
    ?.data;
  const preferredItem =
    data?.items.find((item) => preferredTypes?.includes(item.type)) ??
    data?.items[0];

  const position = isPoint(preferredItem?.point)
    ? preferredItem.point
    : isPoint(data?.firstElementPosition)
    ? data.firstElementPosition
    : fallbackPosition;

  const size = isDimensions(preferredItem?.size)
    ? preferredItem.size
    : isDimensions(data?.firstElementSize)
    ? data.firstElementSize
    : fallbackSize;

  return {
    elementId: preferredItem?.elementId ?? data?.firstElementId,
    position,
    size,
  };
}

function resolvePendingInsertContext(
  board: NonNullable<ReturnType<typeof getCanvasBoard>>,
  task: Task
): {
  insertionPoint?: Point;
  targetFrameId?: string;
  targetFrameDimensions?: { width: number; height: number };
  imageAnchor: PlaitImageGenerationAnchor | null;
} {
  const workzone = findWorkZoneForTask(task.id);
  const imageAnchor = findImageGenerationAnchorForTask(task);
  let insertionPoint = resolveImageAnchorInsertionPoint({
    anchor: imageAnchor,
    workzoneExpectedInsertPosition: workzone?.expectedInsertPosition,
  });
  let targetFrameId: string | undefined;
  let targetFrameDimensions: { width: number; height: number } | undefined;

  const anchorCurrentPosition = getAnchorCurrentPosition(imageAnchor);
  if (
    imageAnchor &&
    anchorCurrentPosition &&
    !isSamePoint(imageAnchor.expectedInsertPosition, anchorCurrentPosition)
  ) {
    ImageGenerationAnchorTransforms.updateAnchor(board, imageAnchor.id, {
      expectedInsertPosition: anchorCurrentPosition,
    });
  }

  if (workzone?.targetFrameId && workzone?.targetFrameDimensions) {
    targetFrameId = workzone.targetFrameId;
    targetFrameDimensions = workzone.targetFrameDimensions;
  }

  if (
    !targetFrameId &&
    imageAnchor?.targetFrameId &&
    imageAnchor?.targetFrameDimensions
  ) {
    targetFrameId = imageAnchor.targetFrameId;
    targetFrameDimensions = imageAnchor.targetFrameDimensions;
  }

  if (!targetFrameId && task.params?.targetFrameId) {
    targetFrameId = task.params.targetFrameId as string;
    targetFrameDimensions = task.params.targetFrameDimensions as
      | { width: number; height: number }
      | undefined;
  }

  if (imageAnchor) {
    linkImageGenerationAnchorToTask(imageAnchor, task);
    ImageGenerationAnchorTransforms.updateAnchor(
      board,
      imageAnchor.id,
      buildImageGenerationAnchorPresentationPatch('inserting')
    );
  }

  if (!insertionPoint) {
    insertionPoint = getInsertionPointBelowBottommostElement(board);
  }

  return {
    insertionPoint,
    targetFrameId,
    targetFrameDimensions,
    imageAnchor,
  };
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
  const updatedSteps = workzone.workflow.steps?.map((step) => {
    const stepResult = step.result as { taskId?: string } | undefined;
    if (stepResult?.taskId === taskId) {
      const existingResult =
        typeof step.result === 'object' && step.result !== null
          ? step.result
          : {};
      return {
        ...step,
        status,
        result: result
          ? {
              ...existingResult,
              url: result.url,
              success: status === 'completed',
            }
          : step.result,
        error: error,
      };
    }
    return step;
  });

  if (updatedSteps) {
    WorkZoneTransforms.updateWorkflow(board, workzone.id, {
      steps: updatedSteps,
    });
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
export function useAutoInsertToCanvas(
  config: Partial<AutoInsertConfig> = {}
): void {
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

      for (const [promptKey, inserts] of toInsert) {
        if (!isActive) break;

        // console.log(`[AutoInsert] Processing prompt group "${promptKey.substring(0, 30)}..." with ${inserts.length} tasks`);

        const firstInsertTask = inserts[0]?.task;
        if (!firstInsertTask) {
          continue;
        }

        const {
          insertionPoint: resolvedInsertionPoint,
          targetFrameId,
          targetFrameDimensions,
          imageAnchor: scopedImageAnchor,
        } = resolvePendingInsertContext(board, firstInsertTask);

        if (!resolvedInsertionPoint) {
          for (const { task } of inserts) {
            releaseTaskInsertion(task.id);
            workflowCompletionService.failPostProcessing(
              task.id,
              'No insertion point available'
            );
          }
          continue;
        }

        // 注册所有任务
        for (const { task } of inserts) {
          const batchId = (task.params as Record<string, unknown>).batchId as
            | string
            | undefined;
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
            const hasResultUrl = typeof url === 'string' && url.length > 0;
            const hasResultUrls =
              Array.isArray(task.result?.urls) && task.result.urls.length > 0;

            if (!hasResultUrl && !hasResultUrls && !isLyricsAudioTask) {
              // console.log(`[AutoInsert] Task ${task.id} has no result URL, skipping`);
              releaseTaskInsertion(task.id);
              workflowCompletionService.failPostProcessing(
                task.id,
                'No result URL'
              );
              continue;
            }

            const type = isLyricsAudioTask
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
            const audioMetadata =
              type === 'audio'
                ? {
                    title: task.result?.title || task.params.title,
                    duration:
                      typeof task.result?.clips?.[0]?.duration === 'number'
                        ? task.result.clips[0]!.duration || undefined
                        : task.result?.duration,
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
                      task.result?.primaryClipId ||
                      task.result?.clips?.[0]?.clipId ||
                      task.result?.clips?.[0]?.id ||
                      task.result?.clipIds?.[0],
                    clipIds: task.result?.clipIds,
                  }
                : undefined;
            const metadata = type === 'audio' ? audioMetadata : undefined;
            // 展开多图：优先使用 urls 数组
            const allUrls =
              type === 'text'
                ? [formatLyricsForCanvas(task)]
                : type === 'audio'
                ? resolveAudioResultUrls(task.result)
                : task.result?.urls?.length
                ? task.result.urls
                : [url as string];

            // 检查是否需要插入到 Frame 内部
            const taskFrameId =
              targetFrameId ||
              (task.params.targetFrameId as string | undefined);
            const taskFrameDims =
              targetFrameDimensions ||
              (task.params.targetFrameDimensions as
                | { width: number; height: number }
                | undefined);
            const imageAnchor =
              type === 'image'
                ? scopedImageAnchor ?? findImageGenerationAnchorForTask(task)
                : null;
            const targetImageDimensions =
              type === 'image'
                ? getTaskImageDimensions(task, dimensions)
                : undefined;
            let insertedPoint = resolvedInsertionPoint;
            let insertedElementId: string | undefined;
            let insertedSize = targetImageDimensions;

            if (
              taskFrameId &&
              taskFrameDims &&
              board &&
              type !== 'audio' &&
              type !== 'text' &&
              allUrls.length === 1
            ) {
              // 插入到 Frame 内部，contain 模式等比缩放
              const frameInsert = await insertMediaIntoFrame(
                board,
                allUrls[0],
                type,
                taskFrameId,
                taskFrameDims,
                dimensions
              );
              if (frameInsert) {
                insertedPoint = frameInsert.point;
                insertedElementId = frameInsert.elementId;
                insertedSize = frameInsert.size;
                syncImageAnchorGeometry(board, imageAnchor, {
                  position: frameInsert.point,
                  size: frameInsert.size,
                  transitionMode:
                    imageAnchor?.anchorType === 'ghost' ? 'morph' : 'hold',
                });
              }
            } else if (mergedConfig.insertPrompt && type !== 'text') {
              const insertionResult = await insertAIFlow(
                task.params.prompt,
                allUrls.map((u, index) => ({
                  type,
                  url: u,
                  dimensions,
                  metadata:
                    type === 'audio'
                      ? {
                          ...audioMetadata,
                          title:
                            task.result?.clips?.[index]?.title ||
                            (allUrls.length > 1
                              ? `${audioMetadata?.title || task.params.title || 'Audio'} ${index + 1}`
                              : audioMetadata?.title),
                          previewImageUrl:
                            task.result?.clips?.[index]?.imageLargeUrl ||
                            task.result?.clips?.[index]?.imageUrl ||
                            audioMetadata?.previewImageUrl,
                          duration:
                            typeof task.result?.clips?.[index]?.duration === 'number'
                              ? task.result.clips[index]!.duration || undefined
                              : audioMetadata?.duration,
                          clipId:
                            task.result?.clips?.[index]?.clipId ||
                            task.result?.clips?.[index]?.id ||
                            task.result?.clipIds?.[index] ||
                            audioMetadata?.clipId,
                        }
                      : undefined,
                })),
                resolvedInsertionPoint
              );
              const insertionGeometry = getInsertionResultGeometry(
                insertionResult,
                resolvedInsertionPoint,
                targetImageDimensions,
                ['image']
              );
              insertedPoint = insertionGeometry.position;
              insertedElementId = insertionGeometry.elementId;
              insertedSize = insertionGeometry.size;
            } else if (type === 'image' && allUrls.length > 1) {
              if (imageAnchor) {
                syncImageAnchorGeometry(board, imageAnchor, {
                  position: resolvedInsertionPoint,
                  size: resolveAnchorInsertionPreviewSize(
                    imageAnchor,
                    targetImageDimensions
                  ),
                  transitionMode: 'morph',
                });
              }
              const insertionResult = await insertImageGroup(
                allUrls,
                resolvedInsertionPoint,
                dimensions
              );
              const insertionGeometry = getInsertionResultGeometry(
                insertionResult,
                resolvedInsertionPoint,
                targetImageDimensions,
                ['image']
              );
              insertedPoint = insertionGeometry.position;
              insertedElementId = insertionGeometry.elementId;
              insertedSize = insertionGeometry.size;
            } else if (type === 'text') {
              const lyricsLabel =
                getLyricsTitle(
                  task.result,
                  task.params.title || task.params.prompt
                ) ||
                (task.params.prompt || '').slice(0, 20) ||
                undefined;
              const insertionResult = await executeCanvasInsertion({
                items: [
                  { type: 'text', content: allUrls[0], label: lyricsLabel },
                ],
                startPoint: resolvedInsertionPoint,
              });
              insertedPoint = getInsertionResultPoint(
                insertionResult,
                resolvedInsertionPoint
              );
            } else if (type === 'audio' && allUrls.length > 1) {
              const groupId = `audio-group-${task.id}`;
              const insertionResult = await executeCanvasInsertion({
                items: allUrls.map((audioUrl, index) => ({
                  type: 'audio',
                  content: audioUrl,
                  groupId,
                  dimensions,
                  metadata: {
                    ...audioMetadata,
                    title:
                      task.result?.clips?.[index]?.title ||
                      (allUrls.length > 1
                        ? `${audioMetadata?.title || task.params.title || 'Audio'} ${index + 1}`
                        : audioMetadata?.title),
                    previewImageUrl:
                      task.result?.clips?.[index]?.imageLargeUrl ||
                      task.result?.clips?.[index]?.imageUrl ||
                      audioMetadata?.previewImageUrl,
                    duration:
                      typeof task.result?.clips?.[index]?.duration === 'number'
                        ? task.result.clips[index]!.duration || undefined
                        : audioMetadata?.duration,
                    clipId:
                      task.result?.clips?.[index]?.clipId ||
                      task.result?.clips?.[index]?.id ||
                      task.result?.clipIds?.[index] ||
                      audioMetadata?.clipId,
                  },
                })),
                startPoint: resolvedInsertionPoint,
              });
              insertedPoint = getInsertionResultPoint(
                insertionResult,
                resolvedInsertionPoint
              );
            } else {
              if (
                type === 'image' &&
                imageAnchor &&
                !mergedConfig.insertPrompt &&
                targetImageDimensions
              ) {
                syncImageAnchorGeometry(board, imageAnchor, {
                  position: resolvedInsertionPoint,
                  size: targetImageDimensions,
                  transitionMode:
                    imageAnchor.anchorType === 'ghost' ? 'morph' : 'hold',
                });
              }

              const insertionResult = await quickInsert(
                type,
                allUrls[0],
                resolvedInsertionPoint,
                dimensions,
                metadata
              );
              if (type === 'image') {
                const insertionGeometry = getInsertionResultGeometry(
                  insertionResult,
                  resolvedInsertionPoint,
                  targetImageDimensions,
                  ['image']
                );
                insertedPoint = insertionGeometry.position;
                insertedElementId = insertionGeometry.elementId;
                insertedSize = insertionGeometry.size;
              } else {
                insertedPoint = getInsertionResultPoint(
                  insertionResult,
                  resolvedInsertionPoint
                );
              }
            }

            if (type === 'image' && imageAnchor && insertedSize) {
              syncImageAnchorGeometry(board, imageAnchor, {
                position: insertedPoint,
                size: insertedSize,
                transitionMode:
                  imageAnchor.anchorType === 'ghost' ? 'morph' : 'hold',
              });
            }

            workflowCompletionService.completePostProcessing(
              task.id,
              allUrls.length,
              insertedPoint,
              type === 'image' ? insertedElementId : undefined,
              type === 'image' ? insertedSize : undefined
            );
            finalizeTaskInsertion(task.id);
          } else {
            // 多个同 Prompt 任务，水平排列（展开每个任务的多图）
            const isLyricsAudioTask = isLyricsTask(firstInsertTask);
            const urls = isLyricsAudioTask
              ? inserts.map(({ task }) => formatLyricsForCanvas(task))
              : inserts
                  .flatMap(({ task }) =>
                    firstInsertTask.type === TaskType.AUDIO
                      ? resolveAudioResultUrls(task.result)
                      : task.result?.urls?.length
                      ? task.result.urls
                      : [task.result?.url]
                  )
                  .filter((url): url is string => !!url);
            const audioGroupItems =
              firstInsertTask.type === TaskType.AUDIO
                ? inserts.flatMap(({ task }) => {
                    const taskUrls = resolveAudioResultUrls(task.result);
                    const taskBaseMetadata = {
                      title: task.result?.title || task.params.title,
                      duration:
                        typeof task.result?.clips?.[0]?.duration === 'number'
                          ? task.result.clips[0]!.duration || undefined
                          : task.result?.duration,
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
                      clipIds: task.result?.clipIds,
                    };

                    return taskUrls.map((resultUrl, index) => ({
                      url: resultUrl,
                      metadata: {
                        ...taskBaseMetadata,
                        title:
                          task.result?.clips?.[index]?.title ||
                          (taskUrls.length > 1
                            ? `${taskBaseMetadata.title || task.params.title || 'Audio'} ${index + 1}`
                            : taskBaseMetadata.title),
                        previewImageUrl:
                          task.result?.clips?.[index]?.imageLargeUrl ||
                          task.result?.clips?.[index]?.imageUrl ||
                          taskBaseMetadata.previewImageUrl,
                        duration:
                          typeof task.result?.clips?.[index]?.duration === 'number'
                            ? task.result.clips[index]!.duration || undefined
                            : taskBaseMetadata.duration,
                        clipId:
                          task.result?.clips?.[index]?.clipId ||
                          task.result?.clips?.[index]?.id ||
                          task.result?.clipIds?.[index],
                      },
                    }));
                  })
                : [];

            if (urls.length === 0) {
              // console.log(`[AutoInsert] No valid URLs in group, skipping`);
              for (const { task } of inserts) {
                releaseTaskInsertion(task.id);
                workflowCompletionService.failPostProcessing(
                  task.id,
                  'No result URL'
                );
              }
              continue;
            }

            const type = isLyricsAudioTask
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
            const groupImageAnchor =
              type === 'image'
                ? scopedImageAnchor ??
                  findImageGenerationAnchorForTask(firstInsertTask)
                : null;
            const groupImageDimensions =
              type === 'image'
                ? getTaskImageDimensions(firstInsertTask, dimensions)
                : undefined;
            let insertedPoint = resolvedInsertionPoint;
            let insertedElementId: string | undefined;
            let insertedSize = groupImageDimensions;

            // console.log(`[AutoInsert] Inserting group of ${urls.length} ${type}s`);

            if (mergedConfig.insertPrompt && type !== 'text') {
              const insertionResult = await insertAIFlow(
                firstInsertTask.params.prompt,
                urls.map((resultUrl, index) => ({
                  type,
                  url: resultUrl,
                  dimensions,
                  metadata:
                    type === 'audio'
                      ? {
                          ...audioGroupItems[index]?.metadata,
                        }
                      : undefined,
                })),
                resolvedInsertionPoint
              );
              if (type === 'image') {
                const insertionGeometry = getInsertionResultGeometry(
                  insertionResult,
                  resolvedInsertionPoint,
                  groupImageDimensions,
                  ['image']
                );
                insertedPoint = insertionGeometry.position;
                insertedElementId = insertionGeometry.elementId;
                insertedSize = insertionGeometry.size;
              } else {
                insertedPoint = getInsertionResultPoint(
                  insertionResult,
                  resolvedInsertionPoint
                );
              }
            } else {
              if (type === 'image') {
                if (groupImageAnchor) {
                  syncImageAnchorGeometry(board, groupImageAnchor, {
                    position: resolvedInsertionPoint,
                    size: resolveAnchorInsertionPreviewSize(
                      groupImageAnchor,
                      groupImageDimensions
                    ),
                    transitionMode: 'morph',
                  });
                }

                const insertionResult = await insertImageGroup(
                  urls,
                  resolvedInsertionPoint,
                  dimensions
                );
                const insertionGeometry = getInsertionResultGeometry(
                  insertionResult,
                  resolvedInsertionPoint,
                  groupImageDimensions,
                  ['image']
                );
                insertedPoint = insertionGeometry.position;
                insertedElementId = insertionGeometry.elementId;
                insertedSize = insertionGeometry.size;
              } else if (type === 'text') {
                const insertionResult = await executeCanvasInsertion({
                  items: inserts.map(({ task }) => ({
                    type: 'text',
                    content: formatLyricsForCanvas(task),
                    label:
                      getLyricsTitle(
                        task.result,
                        task.params.title || task.params.prompt
                      ) ||
                      (task.params.prompt || '').slice(0, 20) ||
                      undefined,
                    groupId: `lyrics-group-${firstInsertTask.id}`,
                  })),
                  startPoint: resolvedInsertionPoint,
                });
                insertedPoint = getInsertionResultPoint(
                  insertionResult,
                  resolvedInsertionPoint
                );
              } else if (type === 'audio') {
                const groupId = `audio-group-${firstInsertTask.id}`;
                const insertionResult = await executeCanvasInsertion({
                  items: audioGroupItems.map((item) => ({
                    type: 'audio',
                    content: item.url,
                    groupId,
                    dimensions,
                    metadata: item.metadata,
                  })),
                  startPoint: resolvedInsertionPoint,
                });
                insertedPoint = getInsertionResultPoint(
                  insertionResult,
                  resolvedInsertionPoint
                );
              } else {
                for (const url of urls) {
                  const insertionResult = await quickInsert(
                    'video',
                    url,
                    resolvedInsertionPoint,
                    dimensions
                  );
                  insertedPoint = getInsertionResultPoint(
                    insertionResult,
                    resolvedInsertionPoint
                  );
                }
              }
            }

            // console.log(`[AutoInsert] Successfully inserted group of ${urls.length} ${type}s`);

            // 标记所有任务完成
            if (type === 'image' && groupImageAnchor && insertedSize) {
              syncImageAnchorGeometry(board, groupImageAnchor, {
                position: insertedPoint,
                size: insertedSize,
                transitionMode: 'morph',
              });
            }

            for (const { task } of inserts) {
              workflowCompletionService.completePostProcessing(
                task.id,
                1,
                insertedPoint,
                type === 'image' ? insertedElementId : undefined,
                type === 'image' ? insertedSize : undefined
              );
              finalizeTaskInsertion(task.id);
            }
          }
        } catch (error) {
          console.error(
            `[AutoInsert] Failed to insert for prompt ${promptKey}:`,
            error
          );
          for (const { task } of inserts) {
            releaseTaskInsertion(task.id);
            workflowCompletionService.failPostProcessing(
              task.id,
              String(error)
            );
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
        releaseTaskInsertion(task.id);
        workflowCompletionService.failPostProcessing(task.id, 'No result URL');
        // 更新步骤状态为失败
        updateWorkflowStepForTask(
          task.id,
          'failed',
          undefined,
          'No result URL'
        );
        return;
      }

      const params = task.params as TaskParams;
      try {
        const result = await handleSplitAndInsertTask(task.id, url, params, {
          scrollToResult: true,
        });

        // 拆分完成后更新步骤状态
        // Note: 成功时 SW 已通过 workflow:stepStatus 事件标记为 completed
        // 只有失败时才需要本地更新（拆分是客户端操作，SW 不知道拆分结果）
        if (result.success) {
          finalizeTaskInsertion(task.id);
          return;
        }

        releaseTaskInsertion(task.id);
        updateWorkflowStepForTask(
          task.id,
          'failed',
          undefined,
          result.error || '拆分失败'
        );
      } catch (error) {
        const errorMessage = String(error);
        releaseTaskInsertion(task.id);
        workflowCompletionService.failPostProcessing(task.id, errorMessage);
        updateWorkflowStepForTask(task.id, 'failed', undefined, errorMessage);
      }
    };

    /**
     * 处理任务完成事件
     */
    const handleTaskCompleted = (task: Task) => {
      // WorkZone 关联任务默认应该走自动插入与清理链路，
      // 兼容历史音频任务未显式写入 autoInsertToCanvas 的情况。
      const linkedWorkzone = findWorkZoneForTask(task.id);
      const linkedImageAnchor = findImageGenerationAnchorForTask(task);
      const shouldAutoInsert =
        task.params.autoInsertToCanvas ||
        !!linkedWorkzone ||
        !!linkedImageAnchor;

      if (!shouldAutoInsert) {
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

      // 只处理图片、视频、音频和文本任务
      if (
        task.type !== TaskType.IMAGE &&
        task.type !== TaskType.VIDEO &&
        task.type !== TaskType.AUDIO &&
        task.type !== TaskType.CHAT
      ) {
        return;
      }

      // 检查是否有结果 URL
      if (
        !task.result?.url &&
        !task.result?.urls?.length &&
        !isLyricsTask(task) &&
        !task.result?.chatResponse
      ) {
        return;
      }

      // console.log(`[AutoInsert] Task ${task.id} passed all checks, will be inserted`);

      // 先占位，防止并发重复插入；成功后再持久化 inserted 标记。
      reserveTaskInsertion(task.id);

      const params = task.params as TaskParams;

      // 检查是否为灵感图任务（需要在宫格图之前检查）
      if (task.type === TaskType.CHAT) {
        const promptLabel =
          (task.params.prompt || '').slice(0, 20) || undefined;
        executeCanvasInsertion({
          items: [
            {
              type: 'text',
              content: task.result?.chatResponse || '',
              label: promptLabel,
            },
          ],
        })
          .then(() => {
            workflowCompletionService.completePostProcessing(task.id, 1);
            finalizeTaskInsertion(task.id);
          })
          .catch((error) => {
            releaseTaskInsertion(task.id);
            workflowCompletionService.failPostProcessing(
              task.id,
              String(error)
            );
          });
        return;
      }

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

      const promptKey = getImageGenerationTaskInsertGroupKey(
        task,
        linkedImageAnchor
      );
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
      // image anchor 的失败态由 useImageGenerationAnchorSync 统一推导。
    };

    // 订阅任务更新事件
    const taskQueueService = getTaskQueueService();
    // console.log('[AutoInsert] Subscribing to task updates');
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
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
    const completionSub = workflowCompletionService
      .observeCompletionEvents()
      .subscribe((event) => {
        if (
          event.type === 'postProcessingCompleted' ||
          event.type === 'postProcessingFailed'
        ) {
          const board = getCanvasBoard();
          if (!board) return;

          const workzone = findWorkZoneForTask(event.taskId);
          if (workzone) {
            // 重新检查该 WorkZone 的所有步骤
            const allStepsFinished = workzone.workflow.steps?.every(
              (step) =>
                step.status === 'completed' ||
                step.status === 'failed' ||
                step.status === 'skipped'
            );

            if (allStepsFinished) {
              const allPostProcessingFinished = workzone.workflow.steps?.every(
                (step) => {
                  const stepResult = step.result as
                    | { taskId?: string }
                    | undefined;
                  if (stepResult?.taskId) {
                    return workflowCompletionService.isPostProcessingCompleted(
                      stepResult.taskId
                    );
                  }
                  return true;
                }
              );

              if (allPostProcessingFinished) {
                setTimeout(() => {
                  WorkZoneTransforms.removeWorkZone(board, workzone.id);
                }, 1500);
              }
            }
          }
        }
      });

    const handleAnchorRetry = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<{ taskId?: string }>;
      const taskId = event.detail?.taskId;
      if (!taskId) {
        return;
      }

      releaseTaskInsertion(taskId);
      workflowCompletionService.clearTask(taskId);

      const retryTask = getTaskQueueService().getTask(taskId);
      if (!retryTask) {
        return;
      }

      if (
        retryTask.status === TaskStatus.FAILED ||
        retryTask.status === TaskStatus.CANCELLED
      ) {
        getTaskQueueService().retryTask(taskId);
        return;
      }

      if (retryTask.status === TaskStatus.COMPLETED) {
        handleTaskCompleted({
          ...retryTask,
          insertedToCanvas: false,
        });
      }
    };

    window.addEventListener(
      IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
      handleAnchorRetry as EventListener
    );

    // 清理函数
    return () => {
      isActive = false;
      subscription.unsubscribe();
      completionSub.unsubscribe();
      window.removeEventListener(
        IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
        handleAnchorRetry as EventListener
      );
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    };
  }, [
    mergedConfig.enabled,
    mergedConfig.insertPrompt,
    mergedConfig.groupSimilarTasks,
    mergedConfig.groupTimeWindow,
  ]);
}

/**
 * 清除已插入任务的记录（用于测试或重置）
 */
export function clearInsertedTaskIds(): void {
  insertedTaskIds.clear();
}

export default useAutoInsertToCanvas;
