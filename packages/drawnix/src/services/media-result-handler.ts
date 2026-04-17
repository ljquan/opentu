/**
 * 媒体结果处理服务
 *
 * 统一处理图片/视频生成任务完成后的结果处理逻辑，包括：
 * - 任务完成后自动插入画布
 * - 工作流步骤状态更新
 * - 批量任务分组处理
 *
 * 这个服务抽象了 useAutoInsertToCanvas 和 workflow-executor 中的共同逻辑
 */

import type { Point } from '@plait/core';
import type { Task, TaskType } from '../types/task.types';
import { TaskStatus } from '../types/task.types';
import {
  executeCanvasInsertion,
  getCanvasBoard,
  quickInsert,
  insertImageGroup,
  insertAIFlow,
  parseSizeToPixels,
} from './canvas-operations';
import {
  AUDIO_CARD_DEFAULT_HEIGHT,
  AUDIO_CARD_DEFAULT_WIDTH,
} from '../data/audio';
import { resolveAudioResultUrls } from './audio-task-result-utils';
import { getInsertionPointBelowBottommostElement } from '../utils/selection-utils';
import { splitAndInsertImages } from '../utils/image-splitter';
import { workflowCompletionService } from './workflow-completion-service';

/**
 * 媒体类型
 */
export type MediaType = 'image' | 'video' | 'audio';

/**
 * 媒体结果
 */
export interface MediaResult {
  url: string;
  urls?: string[];
  format?: string;
  width?: number;
  height?: number;
  duration?: number;
  previewImageUrl?: string;
  title?: string;
  providerTaskId?: string;
  primaryClipId?: string;
  clipIds?: string[];
  clips?: Array<{
    id?: string;
    audioUrl?: string;
    clipId?: string;
    title?: string;
    imageUrl?: string;
    imageLargeUrl?: string;
    duration?: number | null;
  }>;
}

/**
 * 插入配置
 */
export interface InsertConfig {
  /** 是否插入 Prompt 文本 */
  insertPrompt?: boolean;
  /** 插入位置 */
  insertionPoint?: Point;
  /** 是否滚动到结果位置 */
  scrollToResult?: boolean;
}

/**
 * 任务参数（用于判断任务类型）
 */
export interface TaskParams {
  prompt: string;
  size?: string;
  gridImageRows?: number;
  gridImageCols?: number;
  isInspirationBoard?: boolean;
  inspirationBoardLayoutStyle?: string;
  batchId?: string;
  autoInsertToCanvas?: boolean;
  [key: string]: unknown;
}

/**
 * 检查是否为宫格图任务
 */
export function isGridImageTask(params: TaskParams): boolean {
  return !!(params.gridImageRows && params.gridImageCols);
}

/**
 * 检查是否为灵感图任务
 */
export function isInspirationBoardTask(params: TaskParams): boolean {
  return !!(params.isInspirationBoard && params.inspirationBoardLayoutStyle === 'inspiration-board');
}

/**
 * 获取默认插入位置
 */
export function getDefaultInsertionPoint(offset: number = 800): Point | undefined {
  const board = getCanvasBoard();
  if (!board) return undefined;
  return getInsertionPointBelowBottommostElement(board, offset);
}

/**
 * 处理宫格图/灵感图任务：智能检测分割线并拆分插入
 */
export async function handleSplitAndInsertTask(
  taskId: string,
  url: string,
  params: TaskParams,
  config: InsertConfig = {}
): Promise<{ success: boolean; count: number; error?: string }> {
  const board = getCanvasBoard();
  if (!board) {
    return { success: false, count: 0, error: 'Board not available' };
  }

  // 注册任务并开始后处理
  workflowCompletionService.registerTask(taskId, params.batchId);
  workflowCompletionService.startPostProcessing(taskId, 'split_and_insert');

  try {
    const result = await splitAndInsertImages(board, url, {
      scrollToResult: config.scrollToResult ?? true,
    });

    const insertionPoint = config.insertionPoint || getDefaultInsertionPoint();

    if (result.success) {
      // console.log(`[MediaResultHandler] Split success, calling completePostProcessing for task ${taskId}`);
      workflowCompletionService.completePostProcessing(
        taskId,
        result.count,
        insertionPoint
      );
      return { success: true, count: result.count };
    } else {
      // 拆分失败，回退到直接插入原图
      console.warn(`[MediaResultHandler] Split failed: ${result.error}, falling back to direct insert`);

      const insertResult = await insertImageGroup([url], insertionPoint);
      if (insertResult.success) {
        // console.log(`[MediaResultHandler] Fallback insert success, calling completePostProcessing for task ${taskId}`);
        workflowCompletionService.completePostProcessing(taskId, 1, insertionPoint);
        return { success: true, count: 1 };
      } else {
        workflowCompletionService.failPostProcessing(taskId, result.error || 'Split and insert failed');
        return { success: false, count: 0, error: result.error };
      }
    }
  } catch (error) {
    const errorMsg = String(error);
    console.error('[MediaResultHandler] Split and insert error:', error);
    workflowCompletionService.failPostProcessing(taskId, errorMsg);
    return { success: false, count: 0, error: errorMsg };
  }
}

/**
 * 处理单个媒体任务的插入
 */
export async function handleSingleMediaInsert(
  taskId: string,
  type: MediaType,
  url: string,
  params: TaskParams,
  result?: MediaResult,
  config: InsertConfig = {}
): Promise<{ success: boolean; error?: string }> {
  const board = getCanvasBoard();
  if (!board) {
    return { success: false, error: 'Board not available' };
  }

  // 注册任务并开始后处理
  workflowCompletionService.registerTask(taskId, params.batchId);
  workflowCompletionService.startPostProcessing(taskId, 'direct_insert');

  try {
    const insertionPoint = config.insertionPoint || getDefaultInsertionPoint();
    const dimensions =
      type === 'audio'
        ? {
            width: AUDIO_CARD_DEFAULT_WIDTH,
            height: AUDIO_CARD_DEFAULT_HEIGHT,
          }
        : parseSizeToPixels(params.size);
    const metadata =
      type === 'audio'
        ? {
            title: result?.title || params.title,
            duration:
              typeof result?.clips?.[0]?.duration === 'number'
                ? result.clips[0]!.duration || undefined
                : result?.duration,
            previewImageUrl:
              result?.clips?.[0]?.imageLargeUrl ||
              result?.clips?.[0]?.imageUrl ||
              result?.previewImageUrl,
            tags: typeof params.tags === 'string' ? params.tags : undefined,
            mv: typeof params.mv === 'string' ? params.mv : undefined,
            prompt: params.prompt,
            providerTaskId: result?.providerTaskId,
            clipId:
              result?.primaryClipId ||
              result?.clips?.[0]?.clipId ||
              result?.clips?.[0]?.id ||
              result?.clipIds?.[0],
            clipIds: result?.clipIds,
          }
        : undefined;

    if (config.insertPrompt) {
      await insertAIFlow(
        params.prompt,
        [{ type, url, dimensions, metadata }],
        insertionPoint
      );
    } else {
      await quickInsert(type, url, insertionPoint, dimensions, metadata);
    }

    workflowCompletionService.completePostProcessing(taskId, 1, insertionPoint);
    return { success: true };
  } catch (error) {
    const errorMsg = String(error);
    console.error('[MediaResultHandler] Single media insert error:', error);
    workflowCompletionService.failPostProcessing(taskId, errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * 处理多个同组媒体任务的插入（水平排列）
 */
export async function handleGroupMediaInsert(
  tasks: Array<{ taskId: string; type: MediaType; url: string; params: TaskParams }>,
  config: InsertConfig = {}
): Promise<{ success: boolean; error?: string }> {
  const board = getCanvasBoard();
  if (!board) {
    return { success: false, error: 'Board not available' };
  }

  if (tasks.length === 0) {
    return { success: false, error: 'No tasks to insert' };
  }

  // 注册所有任务
  for (const task of tasks) {
    workflowCompletionService.registerTask(task.taskId, task.params.batchId);
    workflowCompletionService.startPostProcessing(task.taskId, 'group_insert');
  }

  try {
    const insertionPoint = config.insertionPoint || getDefaultInsertionPoint();
    const firstTask = tasks[0];
    const dimensions = parseSizeToPixels(firstTask.params.size);

    const urls = tasks.map(t => t.url);

    if (config.insertPrompt) {
      await insertAIFlow(
        firstTask.params.prompt,
        urls.map(url => ({ type: firstTask.type, url, dimensions })),
        insertionPoint
      );
    } else {
      if (firstTask.type === 'image') {
        await insertImageGroup(urls, insertionPoint, dimensions);
      } else {
        // 视频逐个插入
        for (const url of urls) {
          await quickInsert('video', url, insertionPoint, dimensions);
        }
      }
    }

    // 标记所有任务完成
    for (const task of tasks) {
      workflowCompletionService.completePostProcessing(task.taskId, 1, insertionPoint);
    }

    return { success: true };
  } catch (error) {
    const errorMsg = String(error);
    console.error('[MediaResultHandler] Group media insert error:', error);

    // 标记所有任务失败
    for (const task of tasks) {
      workflowCompletionService.failPostProcessing(task.taskId, errorMsg);
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * 根据任务类型自动处理媒体结果
 * 这是主入口函数，会根据任务参数自动选择合适的处理方式
 */
export async function handleMediaResult(
  taskId: string,
  type: MediaType,
  result: MediaResult,
  params: TaskParams,
  config: InsertConfig = {}
): Promise<{ success: boolean; count: number; error?: string }> {
  const primaryUrl = result.url || result.urls?.[0];
  if (!primaryUrl) {
    return { success: false, count: 0, error: 'No result URL' };
  }
  const resultUrls =
    type === 'audio'
      ? resolveAudioResultUrls(result)
      : result.urls?.length
      ? result.urls
      : [primaryUrl];

  // 检查是否需要自动插入
  if (!params.autoInsertToCanvas) {
    return { success: true, count: 0 };
  }

  // 灵感图任务（优先检查）
  if (isInspirationBoardTask(params)) {
    return handleSplitAndInsertTask(taskId, primaryUrl, params, config);
  }

  // 宫格图任务
  if (isGridImageTask(params)) {
    return handleSplitAndInsertTask(taskId, primaryUrl, params, config);
  }

  // 多图直接插入（图片/音频）
  if ((type === 'image' || type === 'audio') && resultUrls.length > 1) {
    const board = getCanvasBoard();
    if (!board) {
      return { success: false, count: 0, error: 'Board not available' };
    }
    workflowCompletionService.registerTask(taskId, params.batchId);
    workflowCompletionService.startPostProcessing(taskId, 'direct_insert');
    try {
      const insertionPoint = config.insertionPoint || getDefaultInsertionPoint();
      const dimensions =
        type === 'audio'
          ? {
              width: AUDIO_CARD_DEFAULT_WIDTH,
              height: AUDIO_CARD_DEFAULT_HEIGHT,
            }
          : parseSizeToPixels(params.size);

      if (type === 'audio') {
        await executeCanvasInsertion({
          items: resultUrls.map((audioUrl, index) => ({
            type: 'audio',
            content: audioUrl,
            groupId: `audio-group-${taskId}`,
            dimensions,
            metadata: {
              title:
                result.clips?.[index]?.title ||
                (result.title || params.title
                  ? `${result.title || params.title} ${index + 1}`
                  : `Audio ${index + 1}`),
              duration:
                typeof result.clips?.[index]?.duration === 'number'
                  ? result.clips[index]!.duration || undefined
                  : result.duration,
              previewImageUrl:
                result.clips?.[index]?.imageLargeUrl ||
                result.clips?.[index]?.imageUrl ||
                result.previewImageUrl,
              tags: typeof params.tags === 'string' ? params.tags : undefined,
              mv: typeof params.mv === 'string' ? params.mv : undefined,
              prompt: params.prompt,
              providerTaskId: result.providerTaskId,
              clipId:
                result.clips?.[index]?.clipId ||
                result.clips?.[index]?.id ||
                result.clipIds?.[index],
              clipIds: result.clipIds,
            },
          })),
          startPoint: insertionPoint,
        });
      } else {
        await insertImageGroup(resultUrls, insertionPoint, dimensions);
      }
      workflowCompletionService.completePostProcessing(taskId, resultUrls.length, insertionPoint);
      return { success: true, count: resultUrls.length };
    } catch (error) {
      const errorMsg = String(error);
      workflowCompletionService.failPostProcessing(taskId, errorMsg);
      return { success: false, count: 0, error: errorMsg };
    }
  }

  // 普通单个媒体任务
  const insertResult = await handleSingleMediaInsert(
    taskId,
    type,
    primaryUrl,
    params,
    result,
    config
  );
  return {
    success: insertResult.success,
    count: insertResult.success ? 1 : 0,
    error: insertResult.error,
  };
}

/**
 * 创建画布插入请求项（用于工作流执行器）
 * 这个函数用于将媒体结果转换为画布插入请求格式
 */
export function createCanvasInsertItems(
  type: MediaType,
  result: MediaResult
): Array<{ type: string; url: string }> {
  if (result.urls && result.urls.length > 1) {
    return result.urls.map(url => ({ type, url }));
  }
  return [{ type, url: result.url }];
}
