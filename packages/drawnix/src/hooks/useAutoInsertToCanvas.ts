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
import {
  getViewportOrigination,
  PlaitHistoryBoard,
  PlaitBoard as PlaitBoardApi,
  RectangleClient,
  Transforms,
  type PlaitBoard,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { getTaskQueueService } from '../services/task-queue';
import { taskStorageReader } from '../services/task-storage-reader';
import { workflowCompletionService } from '../services/workflow-completion-service';
import { runPptExplainerDeliveryExclusive } from '../services/ppt-explainer/cross-tab-coordinator';
import { resolveAudioResultUrls } from '../services/audio-task-result-utils';
import {
  type CanvasAssociationRef,
  isUserVisibleTaskResult,
  Task,
  TaskStatus,
  TaskType,
} from '../types/task.types';
import {
  type CanvasInsertionResultData,
  type ContentType,
  executeCanvasInsertion,
  getCanvasBoard,
  getCanvasBoardBinding,
  insertGeneratedImageFlow,
  insertAIFlow,
  insertImageGroup,
  type MediaFlowResult,
  parseSizeToPixels,
  quickInsert,
} from '../services/canvas-operations';
import {
  AUDIO_CARD_DEFAULT_HEIGHT,
  AUDIO_CARD_DEFAULT_WIDTH,
  buildAudioImageElement,
} from '../data/audio';
import {
  getInsertionPointBelowBottommostElement,
  notifyAISelectionContentRefresh,
} from '../utils/selection-utils';
import { isCardElement } from '../types/card.types';
import { isAudioNodeElement } from '../types/audio-node.types';
import { isPlaitVideo } from '../interfaces/video';
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
import {
  insertMediaIntoFrame,
  type PPTSlideImageHistoryInput,
  replacePPTSlideImage,
  setFramePPTMeta,
} from '../utils/frame-insertion-utils';
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
import { resolveImageTaskInsertionDimensions } from '../utils/task-utils';
import { getImageGenerationTaskInsertGroupKey } from '../utils/image-generation-anchor-task';
import { findImageGenerationAnchorForTaskOnBoard } from '../utils/image-generation-anchor-lookup';
import {
  canInsertCanvasAssociationsOnBoard,
  retargetCanvasAssociationLines,
} from '../plugins/canvas-association';
import { workspaceService } from '../services/workspace-service';
import { STORAGE_LIMITS } from '../constants/TASK_CONSTANTS';
import {
  calculateLayerCanvasBounds,
  getSemanticLayerElementPoints,
  getSemanticLayerMetadata,
  prepareSemanticForegroundReplacement,
  type SemanticLayerGroupMetadata,
  type SemanticForegroundReplacementResult,
} from '../services/layer-decomposition';
import { postprocessGeneratedImage } from '../services/layer-decomposition/artifact-repair';
import {
  findBoundTargetElement,
  isBoundTargetReferenceOnly,
  readBoundTargetFollowEnabled,
} from '../components/ai-input-bar/target-bound-taskbar-state';

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
  /** 持续有新结果时，待插入任务允许延后的最长时间（毫秒） */
  maxGroupWait?: number;
}

const DEFAULT_CONFIG: AutoInsertConfig = {
  enabled: true,
  insertPrompt: false,
  groupSimilarTasks: true,
  groupTimeWindow: 5000, // 5秒内完成的同 Prompt 任务会分组
  maxGroupWait: 15000,
};

const BOARD_RETRY_DELAY = 500;

function shouldInsertPromptWithResult(
  _type: ContentType,
  config: AutoInsertConfig
): boolean {
  return Boolean(config.insertPrompt);
}

const activeInsertionTaskIds = new Set<string>();
const recentlyInsertedTaskIds = new Map<string, true>();
const RECENT_INSERTED_TASK_LIMIT = STORAGE_LIMITS.MAX_RETAINED_TASKS;

function rememberInsertedTask(taskId: string): void {
  recentlyInsertedTaskIds.delete(taskId);
  recentlyInsertedTaskIds.set(taskId, true);

  while (recentlyInsertedTaskIds.size > RECENT_INSERTED_TASK_LIMIT) {
    const oldestTaskId = recentlyInsertedTaskIds.keys().next().value;
    if (typeof oldestTaskId !== 'string') break;
    recentlyInsertedTaskIds.delete(oldestTaskId);
  }
}

function isTaskInsertionTracked(taskId: string): boolean {
  if (activeInsertionTaskIds.has(taskId)) return true;
  if (!recentlyInsertedTaskIds.has(taskId)) return false;

  rememberInsertedTask(taskId);
  return true;
}

function findInsertedPptExplainerVideo(
  board: PlaitBoard,
  taskId: string
): {
  elementId: string;
  position: Point;
  size: { width: number; height: number };
} | null {
  const element = board.children.find(
    (candidate) =>
      isPlaitVideo(candidate) &&
      (candidate as typeof candidate & { generationTaskId?: unknown })
        .generationTaskId === taskId
  );
  if (!element || !isPlaitVideo(element)) return null;

  return {
    elementId: element.id,
    position: element.points[0],
    size: {
      width: Math.abs(element.points[1][0] - element.points[0][0]),
      height: Math.abs(element.points[1][1] - element.points[0][1]),
    },
  };
}

/**
 * 查找与任务关联的 WorkZone
 * @param taskId 任务 ID
 * @returns WorkZone 元素或 null
 */
function findWorkZoneForTask(
  board: PlaitBoard,
  taskId: string
): PlaitWorkZone | null {
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
  board: PlaitBoard,
  taskOrTaskId: Task | string
): PlaitImageGenerationAnchor | null {
  return findImageGenerationAnchorForTaskOnBoard(board, taskOrTaskId);
}

function linkImageGenerationAnchorToTask(
  board: PlaitBoard,
  anchor: PlaitImageGenerationAnchor,
  task: Task
): void {
  const nextTaskIds = anchor.taskIds.includes(task.id)
    ? anchor.taskIds
    : [...anchor.taskIds, task.id];

  ImageGenerationAnchorTransforms.updateAnchor(board, anchor.id, {
    taskIds: nextTaskIds,
    primaryTaskId: anchor.primaryTaskId || task.id,
  });
}

function reserveTaskInsertion(taskId: string): void {
  activeInsertionTaskIds.add(taskId);
}

function releaseTaskInsertion(taskId: string): void {
  activeInsertionTaskIds.delete(taskId);
  recentlyInsertedTaskIds.delete(taskId);
}

function finalizeTaskInsertion(
  task: Task,
  expectedBoard?: PlaitBoard | null
): boolean {
  if (!canInsertTaskCanvasAssociationsOnCurrentBoard(task, expectedBoard)) {
    releaseTaskInsertion(task.id);
    return false;
  }
  activeInsertionTaskIds.delete(task.id);
  rememberInsertedTask(task.id);
  getTaskQueueService().markAsInserted(task.id, 'auto_insert');
  return true;
}

function readTaskParamString(task: Task, key: string): string | undefined {
  const value = task.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getTaskReplaceElementId(task: Task): string | undefined {
  return readTaskParamString(task, 'replaceElementId');
}

function isTaskbarBoundTargetReplacement(task: Task): boolean {
  if (!getTaskReplaceElementId(task) || task.type === TaskType.AUDIO) {
    return false;
  }

  return task.params.boundTargetFollowControlled === true;
}

function resolveTaskForCanvasInsertion(
  task: Task,
  board: PlaitBoard
): {
  task: Task;
  replacementSuppressed: boolean;
} {
  if (!isTaskbarBoundTargetReplacement(task)) {
    return { task, replacementSuppressed: false };
  }

  const currentReplaceElementId = getTaskReplaceElementId(task);
  const replacementSuppressed =
    !readBoundTargetFollowEnabled() ||
    isBoundTargetReferenceOnly(
      findBoundTargetElement(board.children, currentReplaceElementId || '')
    );
  if (!replacementSuppressed) {
    return { task, replacementSuppressed: false };
  }

  const { replaceElementId, targetElementId, ...params } = task.params;
  return {
    task: {
      ...task,
      params,
    },
    replacementSuppressed: Boolean(replaceElementId || targetElementId),
  };
}

function getTaskAnchorId(
  task: Task,
  anchor?: PlaitImageGenerationAnchor | null
): string | undefined {
  return anchor?.id || readTaskParamString(task, 'anchorId');
}

function getTaskTargetElementId(task: Task): string | undefined {
  return (
    readTaskParamString(task, 'targetElementId') ||
    getTaskReplaceElementId(task)
  );
}

function buildTaskGenerationMetadata(
  task: Task,
  anchor?: PlaitImageGenerationAnchor | null
): Record<string, unknown> {
  const prompt = readTaskParamString(task, 'prompt');
  const generationAnchorId = getTaskAnchorId(task, anchor);
  return {
    ...(prompt ? { prompt } : {}),
    generationTaskId: task.id,
    ...(generationAnchorId ? { generationAnchorId } : {}),
  };
}

function getTaskCanvasAssociations(task: Task): CanvasAssociationRef[] {
  const associations = task.params?.canvasAssociations;
  if (!Array.isArray(associations)) return [];

  return associations.filter(
    (association): association is CanvasAssociationRef =>
      typeof association === 'object' &&
      association !== null &&
      typeof association.boardId === 'string' &&
      association.boardId.trim().length > 0 &&
      typeof association.elementId === 'string' &&
      association.elementId.trim().length > 0
  );
}

function getCurrentCanvasBoardBinding() {
  const binding = getCanvasBoardBinding();
  return binding?.boardId === workspaceService.getState().currentBoardId
    ? binding
    : null;
}

function canInsertTaskCanvasAssociationsOnCurrentBoard(
  task: Task,
  expectedBoard?: PlaitBoard | null
): boolean {
  const associations = getTaskCanvasAssociations(task);
  const binding = getCurrentCanvasBoardBinding();
  if (expectedBoard && (!binding || binding.board !== expectedBoard)) {
    return false;
  }
  const pptExplainerSourceBoardId =
    typeof task.params?.pptExplainer?.sourceBoardId === 'string'
      ? task.params.pptExplainer.sourceBoardId.trim()
      : '';
  if (
    pptExplainerSourceBoardId &&
    (!binding || binding.boardId !== pptExplainerSourceBoardId)
  ) {
    return false;
  }
  if (associations.length === 0) return true;

  return Boolean(
    binding && canInsertCanvasAssociationsOnBoard(associations, binding.boardId)
  );
}

function isCanonicalCanvasAssociationTask(task: Task): boolean {
  const batchIndex = task.params?.batchIndex;
  return typeof batchIndex !== 'number' || batchIndex === 1;
}

function linkCanvasAssociationsToResult(
  board: PlaitBoard,
  task: Task,
  resultElementId: string
): void {
  if (!isCanonicalCanvasAssociationTask(task)) return;
  if (!canInsertTaskCanvasAssociationsOnCurrentBoard(task, board)) return;

  const associations = getTaskCanvasAssociations(task);
  if (associations.length === 0) return;
  const associationBoardIds = new Set(
    associations.map((association) => association.boardId.trim())
  );
  if (associationBoardIds.size !== 1) return;
  const submissionBoardId = associationBoardIds.values().next().value;
  if (!submissionBoardId) return;

  try {
    if (workspaceService.getState().currentBoardId !== submissionBoardId) {
      return;
    }

    const sourceElementIds = associations
      .filter((association) => association.boardId.trim() === submissionBoardId)
      .map((association) => association.elementId.trim());
    if (sourceElementIds.length === 0) return;

    const temporaryTargetElementId =
      findImageGenerationAnchorForTask(board, task)?.id ||
      findWorkZoneForTask(board, task.id)?.id;

    retargetCanvasAssociationLines(board, {
      boardId: submissionBoardId,
      sourceElementIds,
      resultElementId,
      workflowId: readTaskParamString(task, 'workflowId'),
      taskId: task.id,
      ...(temporaryTargetElementId
        ? { previousResultElementId: temporaryTargetElementId }
        : {}),
    });
  } catch (error) {
    console.warn(
      `[AutoInsert] Failed to finalize canvas association lines for task ${task.id}:`,
      error
    );
  }
}

function buildImageGenerationElementPatch(
  task: Task,
  anchor?: PlaitImageGenerationAnchor | null
): Record<string, unknown> {
  const prompt = readTaskParamString(task, 'prompt');
  const generationAnchorId = getTaskAnchorId(task, anchor);
  return {
    ...(prompt ? { prompt } : {}),
    generationTaskId: task.id,
    ...(generationAnchorId ? { generationAnchorId } : {}),
  };
}

function buildTaskGenerationElementPatch(
  task: Task,
  anchor?: PlaitImageGenerationAnchor | null
): Record<string, unknown> {
  const metadata = buildTaskGenerationMetadata(task, anchor);
  const prompt =
    typeof metadata.prompt === 'string' ? metadata.prompt.trim() : '';
  return {
    ...(prompt
      ? {
          aiPrompt: prompt,
          generationPrompt: prompt,
          prompt,
        }
      : {}),
    generationTaskId: task.id,
    ...(typeof metadata.generationAnchorId === 'string'
      ? { generationAnchorId: metadata.generationAnchorId }
      : {}),
  };
}

function syncImageTargetBindingAfterInsert(
  board: PlaitBoard,
  anchor: PlaitImageGenerationAnchor | null,
  task: Task,
  insertedElementId?: string,
  previewImageUrl?: string,
  updateElement = true,
  clearTargetElementId = false
): void {
  if (insertedElementId && updateElement) {
    const elementIndex = board.children.findIndex(
      (element: { id?: string }) => element.id === insertedElementId
    );
    if (elementIndex >= 0) {
      Transforms.setNode(
        board,
        buildTaskGenerationElementPatch(task, anchor) as Partial<
          PlaitBoard['children'][number]
        >,
        [elementIndex]
      );
    }
  }

  if (!anchor) return;

  const prompt = readTaskParamString(task, 'prompt');
  const sourceTaskId = readTaskParamString(task, 'sourceTaskId');
  const targetElementId = getTaskTargetElementId(task);
  const nextTaskIds = anchor.taskIds.includes(task.id)
    ? anchor.taskIds
    : [...anchor.taskIds, task.id];
  const anchorPatch: Partial<PlaitImageGenerationAnchor> = {
    taskIds: nextTaskIds,
    primaryTaskId: anchor.primaryTaskId || task.id,
    latestTaskId: task.id,
    ...(prompt ? { prompt } : {}),
    ...(sourceTaskId ? { sourceTaskId } : {}),
    ...(clearTargetElementId
      ? { targetElementId: undefined }
      : targetElementId
      ? { targetElementId }
      : {}),
    ...(insertedElementId ? { resultElementId: insertedElementId } : {}),
    ...(previewImageUrl ? { previewImageUrl } : {}),
  };

  ImageGenerationAnchorTransforms.updateAnchor(board, anchor.id, anchorPatch);
}

function buildSlateText(content: string) {
  return {
    type: 'paragraph',
    children: [{ text: content }],
  };
}

async function replaceGeneratedTarget(
  board: PlaitBoard,
  task: Task,
  content: string | undefined,
  type: ContentType,
  mediaSize?: { width: number; height: number }
): Promise<{
  point?: Point;
  elementId?: string;
  size?: { width: number; height: number };
} | null> {
  const replaceElementId = getTaskReplaceElementId(task);
  if (!replaceElementId || !content) {
    return null;
  }

  let elementIndex = board.children.findIndex(
    (element: { id?: string }) => element.id === replaceElementId
  );
  if (elementIndex < 0) {
    return null;
  }

  const imageAnchor =
    type === 'image' ? findImageGenerationAnchorForTask(board, task) : null;
  const element = board.children[elementIndex] as PlaitElement & {
    points?: [Point, Point];
  };
  const points = element.points;
  const existingSize =
    points && points.length === 2
      ? {
          width: Math.abs(points[1][0] - points[0][0]),
          height: Math.abs(points[1][1] - points[0][1]),
        }
      : undefined;
  let replacementPoints = points;
  let replacementSize = existingSize;
  const basePatch = buildTaskGenerationElementPatch(task, imageAnchor);
  const record = element as Record<string, unknown>;
  let replacementContent = content;
  let semanticReplacementResult: SemanticForegroundReplacementResult | null =
    null;
  const semanticLayer =
    type === 'image' ? getSemanticLayerMetadata(element as PlaitElement) : null;

  if (type === 'image') {
    const taskParams = task.params as Record<string, unknown>;
    const generationMode = taskParams.generationMode;
    const maskImageUrl =
      typeof taskParams.maskImage === 'string' && taskParams.maskImage.trim()
        ? taskParams.maskImage
        : undefined;
    const isMaskedEdit =
      !!maskImageUrl &&
      (generationMode === 'image_edit' || generationMode === 'image_to_image');
    const isSemanticReplacement =
      semanticLayer?.kind === 'foreground' &&
      taskParams.semanticReplacement === true;
    const semanticBackgroundUrl =
      typeof taskParams.semanticReplacementBackgroundUrl === 'string' &&
      taskParams.semanticReplacementBackgroundUrl.trim()
        ? taskParams.semanticReplacementBackgroundUrl.trim()
        : undefined;
    const semanticReferenceUrl =
      typeof taskParams.semanticReplacementReferenceUrl === 'string' &&
      taskParams.semanticReplacementReferenceUrl.trim()
        ? taskParams.semanticReplacementReferenceUrl.trim()
        : semanticBackgroundUrl;
    if (isSemanticReplacement) {
      const expectedForegroundUrl =
        typeof taskParams.semanticReplacementForegroundUrl === 'string'
          ? taskParams.semanticReplacementForegroundUrl.trim()
          : '';
      const expectedBackgroundElementId =
        typeof taskParams.semanticReplacementBackgroundElementId === 'string'
          ? taskParams.semanticReplacementBackgroundElementId.trim()
          : '';
      const currentBackground = board.children.find(
        (candidate) => candidate.id === expectedBackgroundElementId
      );
      if (
        !expectedForegroundUrl ||
        record.url !== expectedForegroundUrl ||
        !semanticBackgroundUrl ||
        !currentBackground ||
        currentBackground.url !== semanticBackgroundUrl ||
        currentBackground.groupId !== element.groupId
      ) {
        return null;
      }
    }
    const protectedSourceUrl = isSemanticReplacement
      ? semanticReferenceUrl
      : typeof record.url === 'string'
      ? record.url
      : undefined;
    if (isMaskedEdit || semanticLayer?.kind === 'foreground') {
      try {
        replacementContent = await postprocessGeneratedImage({
          generatedImageUrl: replacementContent,
          taskId: task.id,
          ...(protectedSourceUrl
            ? { originalImageUrl: protectedSourceUrl }
            : {}),
          ...(maskImageUrl ? { maskImageUrl } : {}),
          model:
            typeof taskParams.model === 'string'
              ? taskParams.model
              : task.invocationRoute?.modelId || undefined,
          modelRef:
            task.params.modelRef || task.invocationRoute?.modelRef || undefined,
          size:
            typeof taskParams.size === 'string' ? taskParams.size : undefined,
          resolution:
            taskParams.resolution === '1k' ||
            taskParams.resolution === '2k' ||
            taskParams.resolution === '4k'
              ? taskParams.resolution
              : undefined,
          quality:
            taskParams.quality === 'auto' ||
            taskParams.quality === 'low' ||
            taskParams.quality === 'medium' ||
            taskParams.quality === 'high' ||
            taskParams.quality === '1k' ||
            taskParams.quality === '2k' ||
            taskParams.quality === '4k'
              ? taskParams.quality
              : undefined,
          prompt:
            typeof taskParams.prompt === 'string'
              ? taskParams.prompt
              : undefined,
          ...(!isSemanticReplacement && semanticLayer
            ? {
                targetName: semanticLayer.name,
                targetDescription: semanticLayer.description,
              }
            : {}),
          ...(isSemanticReplacement && semanticLayer
            ? {
                excludedTargetName: semanticLayer.name,
                excludedTargetDescription: semanticLayer.description,
              }
            : {}),
        });
      } catch (error) {
        console.warn(
          `[AutoInsert] Generated image artifact post-processing skipped for task ${task.id}:`,
          error
        );
        if (isSemanticReplacement) {
          return null;
        }
      }
    }
  }
  if (semanticLayer?.kind === 'foreground') {
    const originalUrl = typeof record.url === 'string' ? record.url : undefined;
    try {
      semanticReplacementResult = await prepareSemanticForegroundReplacement(
        replacementContent,
        task.id,
        semanticLayer,
        {
          editPrompt:
            typeof task.params.prompt === 'string'
              ? task.params.prompt
              : undefined,
        }
      );
      replacementContent = semanticReplacementResult.url;
    } catch (error) {
      console.warn(
        `[AutoInsert] Semantic foreground replacement rejected for task ${task.id}:`,
        error
      );
      return null;
    }
    const currentIndex = board.children.findIndex(
      (candidate) => candidate.id === replaceElementId
    );
    const currentElement =
      currentIndex >= 0 ? board.children[currentIndex] : undefined;
    const currentSemanticLayer = currentElement
      ? getSemanticLayerMetadata(currentElement)
      : null;
    if (
      !currentElement ||
      currentElement.url !== originalUrl ||
      currentSemanticLayer?.kind !== 'foreground' ||
      currentSemanticLayer.providerGroupId !== semanticLayer.providerGroupId ||
      currentSemanticLayer.zIndex !== semanticLayer.zIndex
    ) {
      return null;
    }
    elementIndex = currentIndex;
  }

  if (type === 'text') {
    if (isCardElement(element as any)) {
      Transforms.setNode(
        board,
        {
          ...basePatch,
          body: content,
        } as any,
        [elementIndex]
      );
    } else if (PlaitDrawElement.isText?.(element as any)) {
      Transforms.setNode(
        board,
        {
          ...basePatch,
          text: buildSlateText(content),
          autoSize: true,
        } as any,
        [elementIndex]
      );
    } else {
      return null;
    }
  } else if (type === 'audio') {
    const clip = task.result?.clips?.[0];
    const audioPatch = {
      ...basePatch,
      audioUrl: content,
      title: task.result?.title || clip?.title || task.params.title,
      duration:
        typeof clip?.duration === 'number'
          ? clip.duration || undefined
          : task.result?.duration,
      previewImageUrl:
        clip?.imageLargeUrl || clip?.imageUrl || task.result?.previewImageUrl,
      tags: typeof task.params.tags === 'string' ? task.params.tags : undefined,
      modelVersion:
        typeof task.params.mv === 'string' ? task.params.mv : undefined,
      prompt: task.params.prompt,
      providerTaskId: task.result?.providerTaskId || task.remoteId,
      clipId:
        task.result?.primaryClipId ||
        clip?.clipId ||
        clip?.id ||
        task.result?.clipIds?.[0],
      clipIds: task.result?.clipIds,
    };
    if (isAudioNodeElement(record)) {
      Transforms.setNode(board, audioPatch as any, [elementIndex]);
    } else if (record.audioUrl || record.isAudio === true) {
      const legacyAudioElement = await buildAudioImageElement(content, {
        title: audioPatch.title,
        duration: audioPatch.duration,
        previewImageUrl: audioPatch.previewImageUrl,
        tags: audioPatch.tags,
        mv: audioPatch.modelVersion,
        prompt: task.params.prompt,
        providerTaskId: audioPatch.providerTaskId,
        clipId: audioPatch.clipId,
        clipIds: audioPatch.clipIds,
        width: existingSize?.width,
        height: existingSize?.height,
      });
      Transforms.setNode(
        board,
        {
          ...legacyAudioElement,
          ...basePatch,
          id: replaceElementId,
        } as any,
        [elementIndex]
      );
    } else {
      return null;
    }
  } else if (type === 'video') {
    if (isPlaitVideo(element as any)) {
      Transforms.setNode(
        board,
        {
          ...basePatch,
          url: content,
        } as any,
        [elementIndex]
      );
    } else if (
      PlaitDrawElement.isImage(element as any) &&
      (record.isVideo === true ||
        record.videoType ||
        String(record.url || '').includes('#video'))
    ) {
      Transforms.setNode(
        board,
        {
          ...basePatch,
          url: content.includes('#') ? content : `${content}#video`,
          isVideo: true,
          videoType: record.videoType || 'video',
        } as any,
        [elementIndex]
      );
    } else {
      return null;
    }
  } else if (type === 'image') {
    let groupUpdate:
      | { index: number; metadata: Record<string, unknown> }
      | undefined;
    let semanticElementPatch: Record<string, unknown> | undefined;
    if (semanticLayer?.kind === 'foreground') {
      const groupIndex = board.children.findIndex(
        (candidate) =>
          candidate.type === 'group' &&
          candidate.id === element.groupId &&
          candidate.metadata?.semanticLayerGroup?.providerGroupId ===
            semanticLayer.providerGroupId
      );
      const group = groupIndex >= 0 ? board.children[groupIndex] : undefined;
      const groupMetadata = group?.metadata?.semanticLayerGroup as
        | SemanticLayerGroupMetadata
        | undefined;
      const manifest = groupMetadata?.manifest;
      const background = board.children.find((candidate) => {
        const metadata = getSemanticLayerMetadata(candidate);
        return (
          candidate.groupId === group?.id &&
          metadata?.kind === 'background' &&
          metadata.providerGroupId === semanticLayer.providerGroupId &&
          Array.isArray(candidate.points) &&
          candidate.points.length === 2
        );
      });
      if (
        !group ||
        !groupMetadata ||
        !manifest ||
        !background?.points ||
        !semanticReplacementResult
      ) {
        return null;
      }
      {
        const replacementLayer = semanticReplacementResult.layer;
        const nextSemanticLayer = {
          ...semanticLayer,
          name: replacementLayer.name,
          description: replacementLayer.description,
          boundingBox: {
            absolute: [...replacementLayer.boundingBox.absolute],
            normalized: [...replacementLayer.boundingBox.normalized],
          },
          ...(replacementLayer.confidence === undefined
            ? {}
            : { confidence: replacementLayer.confidence }),
        };
        const backgroundBounds = RectangleClient.getRectangleByPoints(
          background.points as [Point, Point]
        );
        const layerBounds = calculateLayerCanvasBounds(
          {
            ...replacementLayer,
            groupId: semanticLayer.providerGroupId,
            zIndex: semanticLayer.zIndex,
          },
          backgroundBounds,
          {
            width: semanticReplacementResult.width,
            height: semanticReplacementResult.height,
          }
        );
        replacementPoints = getSemanticLayerElementPoints(
          layerBounds,
          backgroundBounds,
          typeof background.angle === 'number' ? background.angle : 0
        );
        replacementSize = {
          width: layerBounds.width,
          height: layerBounds.height,
        };
        semanticElementPatch = {
          points: replacementPoints,
          metadata: {
            ...(element.metadata || {}),
            semanticLayer: nextSemanticLayer,
          },
        };
        const layers = Array.isArray(manifest.layers)
          ? manifest.layers.map((item) =>
              item.kind === 'foreground' && item.zIndex === semanticLayer.zIndex
                ? {
                    ...item,
                    url: replacementContent,
                    name: replacementLayer.name,
                    description: replacementLayer.description,
                    boundingBox: nextSemanticLayer.boundingBox,
                    ...(replacementLayer.confidence === undefined
                      ? {}
                      : { confidence: replacementLayer.confidence }),
                  }
                : item
            )
          : manifest.layers;
        groupUpdate = {
          index: groupIndex,
          metadata: {
            ...(group.metadata || {}),
            semanticLayerGroup: {
              ...groupMetadata,
              manifest: {
                ...manifest,
                layers,
              },
            },
          },
        };
      }
    }
    const applyReplacement = () => {
      Transforms.setNode(
        board,
        {
          ...basePatch,
          url: replacementContent,
          ...(semanticElementPatch || {}),
        } as any,
        [elementIndex]
      );
      if (groupUpdate) {
        Transforms.setNode(board, { metadata: groupUpdate.metadata } as any, [
          groupUpdate.index,
        ]);
      }
    };
    if (groupUpdate) {
      PlaitHistoryBoard.withNewBatch(board, applyReplacement);
    } else {
      applyReplacement();
    }
  } else {
    return null;
  }

  if (type === 'image') {
    syncImageTargetBindingAfterInsert(
      board,
      imageAnchor,
      task,
      replaceElementId,
      replacementContent,
      false
    );
  }
  notifyAISelectionContentRefresh();

  return {
    point: replacementPoints?.[0],
    elementId: replaceElementId,
    size: replacementSize || mediaSize,
  };
}

function updatePPTSlideImageAfterInsert(
  board: PlaitBoard,
  task: Task,
  insertedElementId?: string,
  imageUrl?: string,
  options: {
    targetFrameId?: string;
    replaceElementId?: string;
    prompt?: string;
    historyItems?: PPTSlideImageHistoryInput[];
    imageCreatedAt?: number;
  } = {}
): void {
  if (!insertedElementId || !imageUrl) {
    return;
  }

  const targetFrameId =
    options.targetFrameId || (task.params.targetFrameId as string | undefined);
  if (!targetFrameId) {
    return;
  }

  replacePPTSlideImage(board, targetFrameId, insertedElementId, imageUrl, {
    replaceElementId:
      options.replaceElementId ||
      (task.params.pptReplaceElementId as string | undefined),
    prompt: options.prompt || task.params.prompt,
    slidePrompt:
      typeof task.params.pptSlidePrompt === 'string'
        ? task.params.pptSlidePrompt
        : undefined,
    historyItems: options.historyItems,
    imageCreatedAt: options.imageCreatedAt || getTaskImageGeneratedAt(task),
  });
}

function getTaskImageGeneratedAt(task: Task): number {
  const createdAt = task.completedAt || task.updatedAt || task.createdAt;
  return Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now();
}

function getImageResultUrls(task: Task): string[] {
  if (task.result?.urls?.length) {
    return task.result.urls.filter((url): url is string => !!url);
  }
  return task.result?.url ? [task.result.url] : [];
}

function getTaskBatchIndex(task: Task): number {
  return typeof task.params.batchIndex === 'number'
    ? task.params.batchIndex
    : Number.MAX_SAFE_INTEGER;
}

function createPPTSlideImageHistoryItems(
  imageUrls: string[],
  prompt?: string,
  createdAt?: number
): PPTSlideImageHistoryInput[] {
  return imageUrls.map((imageUrl) => ({
    imageUrl,
    ...(prompt ? { prompt } : {}),
    ...(createdAt ? { createdAt } : {}),
  }));
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
  assertInsertionResultSucceeded(result);
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

interface CanvasInsertionBoardToken {
  board: PlaitBoard;
  boardId: string | null;
}

function captureCanvasInsertionBoardToken(
  board: PlaitBoard
): CanvasInsertionBoardToken | null {
  const binding = getCanvasBoardBinding();
  const currentBoardId = workspaceService.getState().currentBoardId;
  if (
    !binding ||
    binding.board !== board ||
    binding.boardId !== currentBoardId
  ) {
    return null;
  }
  return { board, boardId: binding.boardId };
}

function isCanvasInsertionBoardTokenCurrent(
  token: CanvasInsertionBoardToken
): boolean {
  const binding = getCanvasBoardBinding();
  return Boolean(
    binding &&
      binding.board === token.board &&
      binding.boardId === token.boardId &&
      workspaceService.getState().currentBoardId === token.boardId
  );
}

function getInsertionResultItems(
  result: unknown,
  type: ContentType
): CanvasInsertionResultData['items'] {
  assertInsertionResultSucceeded(result);
  const items = (result as { data?: CanvasInsertionResultData } | undefined)
    ?.data?.items;
  return Array.isArray(items) ? items.filter((item) => item.type === type) : [];
}

function assertInsertionResultSucceeded(result: unknown): void {
  const insertionResult = result as
    | { success?: boolean; error?: unknown }
    | undefined;
  if (insertionResult?.success === true) return;

  const message =
    typeof insertionResult?.error === 'string' && insertionResult.error.trim()
      ? insertionResult.error
      : '插入失败';
  throw new Error(message);
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
  const workzone = findWorkZoneForTask(board, task.id);
  const imageAnchor = findImageGenerationAnchorForTask(board, task);
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
    linkImageGenerationAnchorToTask(board, imageAnchor, task);
    ImageGenerationAnchorTransforms.updateAnchor(
      board,
      imageAnchor.id,
      buildImageGenerationAnchorPresentationPatch('inserting')
    );
  }

  if (!insertionPoint) {
    insertionPoint = getInsertionPointBelowBottommostElement(board);
  }

  if (!insertionPoint) {
    insertionPoint = getViewportCenterInsertionPoint(board);
  }

  return {
    insertionPoint,
    targetFrameId,
    targetFrameDimensions,
    imageAnchor,
  };
}

function getViewportCenterInsertionPoint(board: PlaitBoard): Point {
  try {
    const container = PlaitBoardApi.getBoardContainer(board);
    const rect = container.getBoundingClientRect();
    const zoom = Math.max(Number(board.viewport?.zoom) || 1, 0.001);
    const origination = getViewportOrigination(board) || [0, 0];

    return [
      origination[0] + rect.width / (2 * zoom),
      origination[1] + rect.height / (2 * zoom),
    ];
  } catch {
    return [0, 0];
  }
}

/**
 * 更新 WorkZone 中与任务关联的步骤状态
 * @param taskId 任务 ID
 * @param status 新状态
 * @param result 任务结果（可选）
 * @param error 错误信息（可选）
 */
function updateWorkflowStepForTask(
  board: PlaitBoard,
  taskId: string,
  status: 'completed' | 'failed',
  result?: { url?: string },
  error?: string
): void {
  const workzone = findWorkZoneForTask(board, taskId);
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
  const groupTimeWindow = Math.max(
    0,
    mergedConfig.groupTimeWindow ?? DEFAULT_CONFIG.groupTimeWindow ?? 0
  );
  const maxGroupWait = Math.max(
    0,
    mergedConfig.maxGroupWait ?? DEFAULT_CONFIG.maxGroupWait ?? 0
  );
  const pendingInsertsRef = useRef<Map<string, PendingInsert[]>>(new Map());
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!mergedConfig.enabled) return;

    let isActive = true;

    /**
     * 调度 flush 操作
     */
    function scheduleFlush(delay = groupTimeWindow, respectMaxWait = true) {
      let boundedDelay = Math.max(0, delay);
      if (respectMaxWait) {
        const now = Date.now();
        const pendingStartedAt = pendingStartedAtRef.current ?? now;
        pendingStartedAtRef.current = pendingStartedAt;
        const remainingMaxWait = Math.max(
          0,
          maxGroupWait - (now - pendingStartedAt)
        );
        boundedDelay = Math.min(boundedDelay, remainingMaxWait);
      }

      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushPendingInserts().catch((error) => {
          console.error('[AutoInsert] Failed to flush pending inserts:', error);
        });
      }, boundedDelay);
    }

    /**
     * 执行批量插入
     */
    async function flushPendingInserts() {
      // console.log('[AutoInsert] flushPendingInserts called');
      const pendingMap = pendingInsertsRef.current;
      if (pendingMap.size === 0) {
        pendingStartedAtRef.current = null;
        // console.log('[AutoInsert] flushPendingInserts: no pending tasks');
        return;
      }

      const binding = getCurrentCanvasBoardBinding();
      const board = binding?.board;
      if (!board || !isActive) {
        // console.log(`[AutoInsert] flushPendingInserts aborted: board=${!!board}, isActive=${isActive}`);
        if (!board && isActive) {
          pendingStartedAtRef.current = Date.now();
          scheduleFlush(BOARD_RETRY_DELAY, false);
        }
        return;
      }

      // console.log(`[AutoInsert] flushPendingInserts: ${pendingMap.size} prompt groups to insert`);

      // 复制并清空待插入列表
      const toInsert = new Map(pendingMap);
      pendingMap.clear();
      pendingStartedAtRef.current = null;

      promptGroupLoop: for (const [promptKey, bufferedInserts] of toInsert) {
        if (!isActive) {
          for (const { task } of bufferedInserts) {
            releaseTaskInsertion(task.id);
          }
          continue;
        }

        const inserts: PendingInsert[] = [];
        const deferredInserts: PendingInsert[] = [];
        for (const pendingInsert of bufferedInserts) {
          if (
            canInsertTaskCanvasAssociationsOnCurrentBoard(
              pendingInsert.task,
              board
            )
          ) {
            inserts.push(pendingInsert);
          } else {
            // Keep the completed task recoverable when its source board is inactive.
            deferredInserts.push(pendingInsert);
          }
        }
        if (inserts.length === 0) {
          if (deferredInserts.length > 0) {
            const existing = pendingMap.get(promptKey) || [];
            pendingMap.set(promptKey, [...deferredInserts, ...existing]);
            scheduleBoardRecovery();
          }
          continue;
        }
        if (deferredInserts.length > 0) {
          const existing = pendingMap.get(promptKey) || [];
          pendingMap.set(promptKey, [...deferredInserts, ...existing]);
        }

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

        const insertionBoardToken = captureCanvasInsertionBoardToken(board);
        if (!insertionBoardToken) {
          for (const { task } of inserts) {
            releaseTaskInsertion(task.id);
          }
          continue;
        }
        const abortIfCanvasChanged = (): boolean => {
          if (isCanvasInsertionBoardTokenCurrent(insertionBoardToken)) {
            return false;
          }
          for (const { task } of inserts) {
            releaseTaskInsertion(task.id);
          }
          return true;
        };

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
            const { task: queuedTask } = inserts[0];
            const {
              task,
              replacementSuppressed: boundTargetReplacementSuppressed,
            } = resolveTaskForCanvasInsertion(queuedTask, board);
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
            const requestedDimensions =
              type === 'audio'
                ? {
                    width: AUDIO_CARD_DEFAULT_WIDTH,
                    height: AUDIO_CARD_DEFAULT_HEIGHT,
                  }
                : type === 'text'
                ? undefined
                : parseSizeToPixels(task.params.size);
            const dimensions =
              type === 'image'
                ? resolveImageTaskInsertionDimensions(
                    task,
                    requestedDimensions?.width
                  )
                : requestedDimensions;
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
            // 展开多图：优先使用 urls 数组
            const allUrls =
              type === 'text'
                ? [formatLyricsForCanvas(task)]
                : type === 'audio'
                ? resolveAudioResultUrls(task.result)
                : task.result?.urls?.length
                ? task.result.urls
                : [url as string];

            if (
              getTaskReplaceElementId(task) &&
              (type === 'image' ||
                type === 'video' ||
                type === 'audio' ||
                type === 'text')
            ) {
              const replaced = await replaceGeneratedTarget(
                board,
                task,
                allUrls[0],
                type,
                dimensions
              );
              if (!replaced) {
                releaseTaskInsertion(task.id);
                workflowCompletionService.failPostProcessing(
                  task.id,
                  type === 'image'
                    ? 'Target image is no longer available'
                    : 'Target element is no longer available'
                );
                continue;
              }

              workflowCompletionService.completePostProcessing(
                task.id,
                1,
                replaced.point,
                replaced.elementId,
                replaced.size
              );
              finalizeTaskInsertion(task, board);
              continue;
            }

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
                ? scopedImageAnchor ??
                  findImageGenerationAnchorForTask(board, task)
                : null;
            const generationMetadata = buildTaskGenerationMetadata(
              task,
              imageAnchor
            );
            const metadata =
              type === 'image'
                ? buildTaskGenerationElementPatch(task, imageAnchor)
                : type === 'audio'
                ? {
                    ...audioMetadata,
                    generationTaskId: task.id,
                  }
                : generationMetadata;
            const targetImageDimensions =
              type === 'image' ? dimensions : undefined;
            let insertedPoint = resolvedInsertionPoint;
            let insertedElementId: string | undefined;
            let insertedSize =
              type === 'image' ? targetImageDimensions : dimensions;
            let didUpdatePPTSlideImage = false;

            if (
              task.params.pptSlideImage &&
              taskFrameId &&
              taskFrameDims &&
              board &&
              type === 'image' &&
              allUrls.length > 0
            ) {
              const currentImageUrl = allUrls[allUrls.length - 1];
              const frameInsert = await insertMediaIntoFrame(
                board,
                currentImageUrl,
                type,
                taskFrameId,
                taskFrameDims,
                undefined,
                undefined,
                {
                  boardGuard: () =>
                    isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                }
              );
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
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
                updatePPTSlideImageAfterInsert(
                  board,
                  task,
                  insertedElementId,
                  currentImageUrl,
                  {
                    targetFrameId: taskFrameId,
                    replaceElementId: task.params.pptReplaceElementId as
                      | string
                      | undefined,
                    historyItems: createPPTSlideImageHistoryItems(
                      allUrls.slice(0, -1),
                      task.params.prompt,
                      getTaskImageGeneratedAt(task)
                    ),
                  }
                );
                didUpdatePPTSlideImage = true;
              }
            } else if (
              taskFrameId &&
              taskFrameDims &&
              board &&
              type !== 'audio' &&
              type !== 'text' &&
              allUrls.length === 1
            ) {
              // 插入到 Frame 内部。PPT 页面图和普通媒体都保持 contain，确保图片完整展示。
              const frameInsert = await insertMediaIntoFrame(
                board,
                allUrls[0],
                type,
                taskFrameId,
                taskFrameDims,
                task.params.pptSlideImage && type === 'image'
                  ? undefined
                  : dimensions,
                undefined,
                {
                  boardGuard: () =>
                    isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                }
              );
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
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
            } else if (
              shouldInsertPromptWithResult(type, mergedConfig) &&
              type !== 'text'
            ) {
              const flowResults: MediaFlowResult[] = allUrls.map(
                (u, index) => ({
                  type,
                  url: u,
                  dimensions,
                  metadata:
                    type === 'image'
                      ? buildTaskGenerationElementPatch(task, imageAnchor)
                      : type === 'audio'
                      ? {
                          ...audioMetadata,
                          generationTaskId: task.id,
                          title:
                            task.result?.clips?.[index]?.title ||
                            (allUrls.length > 1
                              ? `${
                                  audioMetadata?.title ||
                                  task.params.title ||
                                  'Audio'
                                } ${index + 1}`
                              : audioMetadata?.title),
                          previewImageUrl:
                            task.result?.clips?.[index]?.imageLargeUrl ||
                            task.result?.clips?.[index]?.imageUrl ||
                            audioMetadata?.previewImageUrl,
                          duration:
                            typeof task.result?.clips?.[index]?.duration ===
                            'number'
                              ? task.result.clips[index]!.duration || undefined
                              : audioMetadata?.duration,
                          clipId:
                            task.result?.clips?.[index]?.clipId ||
                            task.result?.clips?.[index]?.id ||
                            task.result?.clipIds?.[index] ||
                            audioMetadata?.clipId,
                        }
                      : generationMetadata,
                })
              );
              const insertionResult =
                type === 'image'
                  ? await insertGeneratedImageFlow(
                      task.params.prompt,
                      flowResults,
                      resolvedInsertionPoint,
                      board,
                      () =>
                        isCanvasInsertionBoardTokenCurrent(insertionBoardToken)
                    )
                  : await insertAIFlow(
                      task.params.prompt,
                      flowResults,
                      resolvedInsertionPoint,
                      board,
                      () =>
                        isCanvasInsertionBoardTokenCurrent(insertionBoardToken)
                    );
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
              const insertionGeometry = getInsertionResultGeometry(
                insertionResult,
                resolvedInsertionPoint,
                type === 'image' ? targetImageDimensions : dimensions,
                [type]
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
                dimensions,
                board,
                () => isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                task.params.prompt,
                buildTaskGenerationMetadata(task, imageAnchor)
              );
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
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
                board,
                boardGuard: () =>
                  isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                items: [
                  {
                    type: 'text',
                    content: allUrls[0],
                    label: lyricsLabel,
                    metadata,
                  },
                ],
                startPoint: resolvedInsertionPoint,
              });
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
              const insertionGeometry = getInsertionResultGeometry(
                insertionResult,
                resolvedInsertionPoint,
                undefined,
                ['text']
              );
              insertedPoint = insertionGeometry.position;
              insertedElementId = insertionGeometry.elementId;
              insertedSize = insertionGeometry.size;
            } else if (type === 'audio' && allUrls.length > 1) {
              const groupId = `audio-group-${task.id}`;
              const insertionResult = await executeCanvasInsertion({
                board,
                boardGuard: () =>
                  isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                items: allUrls.map((audioUrl, index) => ({
                  type: 'audio',
                  content: audioUrl,
                  groupId,
                  dimensions,
                  metadata: {
                    ...audioMetadata,
                    generationTaskId: task.id,
                    title:
                      task.result?.clips?.[index]?.title ||
                      (allUrls.length > 1
                        ? `${
                            audioMetadata?.title || task.params.title || 'Audio'
                          } ${index + 1}`
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
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
              const insertionGeometry = getInsertionResultGeometry(
                insertionResult,
                resolvedInsertionPoint,
                dimensions,
                ['audio']
              );
              insertedPoint = insertionGeometry.position;
              insertedElementId = insertionGeometry.elementId;
              insertedSize = insertionGeometry.size;
            } else {
              if (
                type === 'image' &&
                imageAnchor &&
                !shouldInsertPromptWithResult(type, mergedConfig) &&
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
                metadata,
                board,
                () => isCanvasInsertionBoardTokenCurrent(insertionBoardToken)
              );
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
              const insertionGeometry = getInsertionResultGeometry(
                insertionResult,
                resolvedInsertionPoint,
                type === 'image' ? targetImageDimensions : dimensions,
                [type]
              );
              insertedPoint = insertionGeometry.position;
              insertedElementId = insertionGeometry.elementId;
              insertedSize = insertionGeometry.size;
            }

            if (type === 'image' && imageAnchor && insertedSize) {
              syncImageAnchorGeometry(board, imageAnchor, {
                position: insertedPoint,
                size: insertedSize,
                transitionMode:
                  imageAnchor.anchorType === 'ghost' ? 'morph' : 'hold',
              });
            }

            if (type === 'image' && !didUpdatePPTSlideImage) {
              updatePPTSlideImageAfterInsert(
                board,
                task,
                insertedElementId,
                allUrls[0],
                {
                  targetFrameId: taskFrameId,
                  replaceElementId: task.params.pptReplaceElementId as
                    | string
                    | undefined,
                }
              );
            }

            if (type === 'image') {
              syncImageTargetBindingAfterInsert(
                board,
                imageAnchor,
                task,
                insertedElementId,
                allUrls[0],
                true,
                boundTargetReplacementSuppressed
              );
              notifyAISelectionContentRefresh();
            }

            if (
              !isCanvasInsertionBoardTokenCurrent(insertionBoardToken) ||
              !canInsertTaskCanvasAssociationsOnCurrentBoard(task, board)
            ) {
              releaseTaskInsertion(task.id);
              continue;
            }

            workflowCompletionService.completePostProcessing(
              task.id,
              allUrls.length,
              insertedPoint,
              insertedElementId,
              insertedSize
            );
            finalizeTaskInsertion(task, board);
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
                      task,
                      url: resultUrl,
                      metadata: {
                        ...taskBaseMetadata,
                        generationTaskId: task.id,
                        title:
                          task.result?.clips?.[index]?.title ||
                          (taskUrls.length > 1
                            ? `${
                                taskBaseMetadata.title ||
                                task.params.title ||
                                'Audio'
                              } ${index + 1}`
                            : taskBaseMetadata.title),
                        previewImageUrl:
                          task.result?.clips?.[index]?.imageLargeUrl ||
                          task.result?.clips?.[index]?.imageUrl ||
                          taskBaseMetadata.previewImageUrl,
                        duration:
                          typeof task.result?.clips?.[index]?.duration ===
                          'number'
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
            const imageGroupItems =
              firstInsertTask.type === TaskType.IMAGE && !isLyricsAudioTask
                ? inserts.flatMap(({ task }) => {
                    const taskAnchor = findImageGenerationAnchorForTask(
                      board,
                      task
                    );
                    const taskMetadata = buildTaskGenerationMetadata(
                      task,
                      taskAnchor
                    );
                    return getImageResultUrls(task).map((resultUrl) => ({
                      task,
                      url: resultUrl,
                      anchor: taskAnchor,
                      metadata: taskMetadata,
                      dimensions: resolveImageTaskInsertionDimensions(
                        task,
                        parseSizeToPixels(task.params.size).width
                      ),
                    }));
                  })
                : [];
            const videoGroupItems =
              firstInsertTask.type === TaskType.VIDEO
                ? inserts.flatMap(({ task }) => {
                    const taskUrls = task.result?.urls?.length
                      ? task.result.urls
                      : task.result?.url
                      ? [task.result.url]
                      : [];
                    const metadata = buildTaskGenerationMetadata(task, null);
                    return taskUrls.map((resultUrl) => ({
                      task,
                      url: resultUrl,
                      metadata,
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
            const requestedDimensions =
              type === 'audio'
                ? {
                    width: AUDIO_CARD_DEFAULT_WIDTH,
                    height: AUDIO_CARD_DEFAULT_HEIGHT,
                  }
                : type === 'text'
                ? undefined
                : parseSizeToPixels(firstInsertTask.params.size);
            const dimensions =
              type === 'image'
                ? resolveImageTaskInsertionDimensions(
                    firstInsertTask,
                    requestedDimensions?.width
                  )
                : requestedDimensions;
            const groupImageAnchor =
              type === 'image'
                ? scopedImageAnchor ??
                  findImageGenerationAnchorForTask(board, firstInsertTask)
                : null;
            const groupImageDimensions =
              type === 'image' ? dimensions : undefined;
            let insertedPoint = resolvedInsertionPoint;
            let insertedElementId: string | undefined;
            let insertedSize = groupImageDimensions;
            let insertedResultItems: CanvasInsertionResultData['items'] = [];

            // console.log(`[AutoInsert] Inserting group of ${urls.length} ${type}s`);

            if (
              firstInsertTask.params.pptSlideImage &&
              targetFrameId &&
              targetFrameDimensions &&
              type === 'image'
            ) {
              const sortedInserts = inserts
                .map((insert, sourceIndex) => ({ insert, sourceIndex }))
                .sort((left, right) => {
                  const indexDiff =
                    getTaskBatchIndex(left.insert.task) -
                    getTaskBatchIndex(right.insert.task);
                  return indexDiff || left.sourceIndex - right.sourceIndex;
                })
                .map(({ insert }) => insert);
              const historyItems = sortedInserts.flatMap(({ task }) =>
                createPPTSlideImageHistoryItems(
                  getImageResultUrls(task),
                  task.params.prompt,
                  getTaskImageGeneratedAt(task)
                )
              );
              const currentHistoryItem = historyItems[historyItems.length - 1];
              const currentHistorySourceTask =
                sortedInserts[sortedInserts.length - 1]?.task ||
                firstInsertTask;
              const currentHistoryAnchor = findImageGenerationAnchorForTask(
                board,
                currentHistorySourceTask
              );

              if (!currentHistoryItem) {
                for (const { task } of inserts) {
                  releaseTaskInsertion(task.id);
                  workflowCompletionService.failPostProcessing(
                    task.id,
                    'No result URL'
                  );
                }
                continue;
              }

              const frameInsert = await insertMediaIntoFrame(
                board,
                currentHistoryItem.imageUrl,
                type,
                targetFrameId,
                targetFrameDimensions,
                undefined,
                undefined,
                {
                  boardGuard: () =>
                    isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                }
              );

              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }

              if (frameInsert) {
                insertedPoint = frameInsert.point;
                insertedElementId = frameInsert.elementId;
                insertedSize = frameInsert.size;
                updatePPTSlideImageAfterInsert(
                  board,
                  firstInsertTask,
                  insertedElementId,
                  currentHistoryItem.imageUrl,
                  {
                    targetFrameId,
                    replaceElementId: firstInsertTask.params
                      .pptReplaceElementId as string | undefined,
                    prompt: currentHistoryItem.prompt,
                    imageCreatedAt: currentHistoryItem.createdAt,
                    historyItems: historyItems.slice(0, -1),
                  }
                );
                syncImageTargetBindingAfterInsert(
                  board,
                  currentHistoryAnchor,
                  currentHistorySourceTask,
                  insertedElementId,
                  currentHistoryItem.imageUrl
                );
              }
            } else if (
              shouldInsertPromptWithResult(type, mergedConfig) &&
              type !== 'text'
            ) {
              const flowResults: MediaFlowResult[] = urls.map(
                (resultUrl, index) => ({
                  type,
                  url: resultUrl,
                  dimensions:
                    type === 'image'
                      ? imageGroupItems[index]?.dimensions ?? dimensions
                      : dimensions,
                  metadata:
                    type === 'image'
                      ? imageGroupItems[index]?.metadata
                      : type === 'audio'
                      ? {
                          ...audioGroupItems[index]?.metadata,
                        }
                      : videoGroupItems[index]?.metadata,
                })
              );
              const insertionResult =
                type === 'image'
                  ? await insertGeneratedImageFlow(
                      firstInsertTask.params.prompt,
                      flowResults,
                      resolvedInsertionPoint,
                      board,
                      () =>
                        isCanvasInsertionBoardTokenCurrent(insertionBoardToken)
                    )
                  : await insertAIFlow(
                      firstInsertTask.params.prompt,
                      flowResults,
                      resolvedInsertionPoint,
                      board,
                      () =>
                        isCanvasInsertionBoardTokenCurrent(insertionBoardToken)
                    );
              if (abortIfCanvasChanged()) {
                continue promptGroupLoop;
              }
              insertedResultItems = getInsertionResultItems(
                insertionResult,
                type
              );
              const insertionGeometry = getInsertionResultGeometry(
                insertionResult,
                resolvedInsertionPoint,
                type === 'image' ? groupImageDimensions : dimensions,
                [type]
              );
              insertedPoint = insertionGeometry.position;
              insertedElementId = insertionGeometry.elementId;
              insertedSize = insertionGeometry.size;
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
                  imageGroupItems.map((item) => item.dimensions),
                  board,
                  () => isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                  firstInsertTask.params.prompt
                );
                if (abortIfCanvasChanged()) {
                  continue promptGroupLoop;
                }
                insertedResultItems = getInsertionResultItems(
                  insertionResult,
                  'image'
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
                  board,
                  boardGuard: () =>
                    isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
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
                    metadata: {
                      prompt: task.params.prompt,
                      generationTaskId: task.id,
                    },
                  })),
                  startPoint: resolvedInsertionPoint,
                });
                if (abortIfCanvasChanged()) {
                  continue promptGroupLoop;
                }
                insertedResultItems = getInsertionResultItems(
                  insertionResult,
                  'text'
                );
                const insertionGeometry = getInsertionResultGeometry(
                  insertionResult,
                  resolvedInsertionPoint,
                  undefined,
                  ['text']
                );
                insertedPoint = insertionGeometry.position;
                insertedElementId = insertionGeometry.elementId;
                insertedSize = insertionGeometry.size;
              } else if (type === 'audio') {
                const groupId = `audio-group-${firstInsertTask.id}`;
                const insertionResult = await executeCanvasInsertion({
                  board,
                  boardGuard: () =>
                    isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
                  items: audioGroupItems.map((item) => ({
                    type: 'audio',
                    content: item.url,
                    groupId,
                    dimensions,
                    metadata: item.metadata,
                  })),
                  startPoint: resolvedInsertionPoint,
                });
                if (abortIfCanvasChanged()) {
                  continue promptGroupLoop;
                }
                insertedResultItems = getInsertionResultItems(
                  insertionResult,
                  'audio'
                );
                const insertionGeometry = getInsertionResultGeometry(
                  insertionResult,
                  resolvedInsertionPoint,
                  dimensions,
                  ['audio']
                );
                insertedPoint = insertionGeometry.position;
                insertedElementId = insertionGeometry.elementId;
                insertedSize = insertionGeometry.size;
              } else {
                for (const item of videoGroupItems) {
                  const insertionResult = await quickInsert(
                    'video',
                    item.url,
                    resolvedInsertionPoint,
                    dimensions,
                    item.metadata,
                    board,
                    () =>
                      isCanvasInsertionBoardTokenCurrent(insertionBoardToken)
                  );
                  if (abortIfCanvasChanged()) {
                    continue promptGroupLoop;
                  }
                  insertedResultItems.push(
                    ...getInsertionResultItems(insertionResult, 'video')
                  );
                  const insertionGeometry = getInsertionResultGeometry(
                    insertionResult,
                    resolvedInsertionPoint,
                    dimensions,
                    ['video']
                  );
                  if (!insertedElementId) {
                    insertedPoint = insertionGeometry.position;
                    insertedElementId = insertionGeometry.elementId;
                    insertedSize = insertionGeometry.size;
                  }
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

            const insertedItemByTaskId = new Map<
              string,
              CanvasInsertionResultData['items'][number]
            >();
            if (type === 'image') {
              imageGroupItems.forEach((item, index) => {
                const insertedItem = insertedResultItems[index];
                if (!insertedItem?.elementId) return;
                syncImageTargetBindingAfterInsert(
                  board,
                  item.anchor,
                  item.task,
                  insertedItem.elementId,
                  item.url
                );
                if (!insertedItemByTaskId.has(item.task.id)) {
                  insertedItemByTaskId.set(item.task.id, insertedItem);
                }
              });
              notifyAISelectionContentRefresh();
            } else if (type === 'text') {
              inserts.forEach(({ task }, index) => {
                const insertedItem = insertedResultItems[index];
                if (insertedItem?.elementId) {
                  insertedItemByTaskId.set(task.id, insertedItem);
                }
              });
            } else {
              const sourceItems =
                type === 'audio' ? audioGroupItems : videoGroupItems;
              sourceItems.forEach((item, index) => {
                const insertedItem = insertedResultItems[index];
                if (
                  insertedItem?.elementId &&
                  !insertedItemByTaskId.has(item.task.id)
                ) {
                  insertedItemByTaskId.set(item.task.id, insertedItem);
                }
              });
            }

            for (const { task } of inserts) {
              if (
                !isCanvasInsertionBoardTokenCurrent(insertionBoardToken) ||
                !canInsertTaskCanvasAssociationsOnCurrentBoard(task, board)
              ) {
                releaseTaskInsertion(task.id);
                continue;
              }
              const insertedItem = insertedItemByTaskId.get(task.id);
              const isFirstTask = task.id === firstInsertTask.id;
              const fallbackElementId =
                type === 'image' || isFirstTask ? insertedElementId : undefined;
              const fallbackSize =
                type === 'image' || isFirstTask ? insertedSize : undefined;
              workflowCompletionService.completePostProcessing(
                task.id,
                1,
                insertedItem?.point || insertedPoint,
                insertedItem?.elementId || fallbackElementId,
                insertedItem?.size || fallbackSize
              );
              finalizeTaskInsertion(task, board);
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
    }

    /**
     * 处理宫格图/灵感图任务：使用统一的媒体结果处理服务
     */
    const handleSplitTask = async (task: Task, board: PlaitBoard) => {
      const url = task.result?.url;
      if (!url) {
        console.error('[AutoInsert] Split task has no result URL');
        releaseTaskInsertion(task.id);
        workflowCompletionService.failPostProcessing(task.id, 'No result URL');
        // 更新步骤状态为失败
        updateWorkflowStepForTask(
          board,
          task.id,
          'failed',
          undefined,
          'No result URL'
        );
        return;
      }

      const params = task.params as TaskParams;
      const insertionBoardToken = captureCanvasInsertionBoardToken(board);
      if (!insertionBoardToken) {
        releaseTaskInsertion(task.id);
        return;
      }
      try {
        const result = await handleSplitAndInsertTask(task.id, url, params, {
          scrollToResult: true,
          board,
          boardGuard: () =>
            isCanvasInsertionBoardTokenCurrent(insertionBoardToken),
        });

        if (!isCanvasInsertionBoardTokenCurrent(insertionBoardToken)) {
          releaseTaskInsertion(task.id);
          return;
        }

        // 拆分完成后更新步骤状态
        // Note: 成功时 SW 已通过 workflow:stepStatus 事件标记为 completed
        // 只有失败时才需要本地更新（拆分是客户端操作，SW 不知道拆分结果）
        if (result.success) {
          finalizeTaskInsertion(task, board);
          return;
        }

        releaseTaskInsertion(task.id);
        updateWorkflowStepForTask(
          board,
          task.id,
          'failed',
          undefined,
          result.error || '拆分失败'
        );
      } catch (error) {
        const errorMessage = String(error);
        releaseTaskInsertion(task.id);
        workflowCompletionService.failPostProcessing(task.id, errorMessage);
        updateWorkflowStepForTask(
          board,
          task.id,
          'failed',
          undefined,
          errorMessage
        );
      }
    };

    /**
     * 处理任务完成事件
     */
    let boardRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleBoardRecovery = (delay = BOARD_RETRY_DELAY): void => {
      if (boardRecoveryTimer) {
        clearTimeout(boardRecoveryTimer);
      }
      boardRecoveryTimer = setTimeout(() => {
        boardRecoveryTimer = null;
        if (isActive) {
          recoverCompletedAutoInsertTasks();
        }
      }, delay);
    };

    const handlePptExplainerInsertion = (
      task: Task,
      board: PlaitBoard,
      boardId: string
    ): void => {
      void runPptExplainerDeliveryExclusive(
        boardId,
        task.id,
        async (signal) => {
          const storedTask = await taskStorageReader.getTask(task.id);
          const insertionTask = storedTask || task;
          if (
            signal.aborted ||
            insertionTask.status !== TaskStatus.COMPLETED ||
            !insertionTask.params.pptExplainer ||
            !isUserVisibleTaskResult(insertionTask.result)
          ) {
            return;
          }

          const currentBinding = getCurrentCanvasBoardBinding();
          if (
            !currentBinding ||
            currentBinding.board !== board ||
            currentBinding.boardId !== boardId ||
            !canInsertTaskCanvasAssociationsOnCurrentBoard(insertionTask, board)
          ) {
            return;
          }

          const existingVideo = findInsertedPptExplainerVideo(
            board,
            insertionTask.id
          );
          if (insertionTask.insertedToCanvas) {
            rememberInsertedTask(insertionTask.id);
            if (existingVideo) {
              workflowCompletionService.completePostProcessing(
                insertionTask.id,
                1,
                existingVideo.position,
                existingVideo.elementId,
                existingVideo.size
              );
            }
            return;
          }
          if (existingVideo) {
            workflowCompletionService.completePostProcessing(
              insertionTask.id,
              1,
              existingVideo.position,
              existingVideo.elementId,
              existingVideo.size
            );
            if (finalizeTaskInsertion(insertionTask, board)) {
              await getTaskQueueService().waitForTaskPersistence?.(
                insertionTask.id
              );
            }
            return;
          }

          const resultUrl = insertionTask.result?.url;
          const insertionPoint = resolvePendingInsertContext(
            board,
            insertionTask
          ).insertionPoint;
          const insertionBoardToken = captureCanvasInsertionBoardToken(board);
          if (!resultUrl || !insertionPoint || !insertionBoardToken) return;

          reserveTaskInsertion(insertionTask.id);
          workflowCompletionService.registerTask(insertionTask.id);
          workflowCompletionService.startPostProcessing(
            insertionTask.id,
            'direct_insert'
          );

          const dimensions = parseSizeToPixels(insertionTask.params.size);
          const insertionResult = await quickInsert(
            'video',
            resultUrl,
            insertionPoint,
            dimensions,
            buildTaskGenerationMetadata(insertionTask),
            board,
            () =>
              !signal.aborted &&
              isCanvasInsertionBoardTokenCurrent(insertionBoardToken)
          );
          if (
            signal.aborted ||
            !isCanvasInsertionBoardTokenCurrent(insertionBoardToken) ||
            !canInsertTaskCanvasAssociationsOnCurrentBoard(insertionTask, board)
          ) {
            releaseTaskInsertion(insertionTask.id);
            return;
          }

          const insertionGeometry = getInsertionResultGeometry(
            insertionResult,
            insertionPoint,
            dimensions,
            ['video']
          );
          workflowCompletionService.completePostProcessing(
            insertionTask.id,
            1,
            insertionGeometry.position,
            insertionGeometry.elementId,
            insertionGeometry.size
          );
          if (!finalizeTaskInsertion(insertionTask, board)) {
            throw new Error('画板已切换，PPT 讲解视频交付待重试');
          }
          await getTaskQueueService().waitForTaskPersistence?.(
            insertionTask.id
          );
        }
      )
        .then((result) => {
          if (!result.acquired && isActive) scheduleBoardRecovery();
        })
        .catch((error) => {
          releaseTaskInsertion(task.id);
          workflowCompletionService.failPostProcessing(task.id, String(error));
          if (isActive) scheduleBoardRecovery();
        });
    };

    const handleTaskCompleted = (task: Task) => {
      if (!isUserVisibleTaskResult(task.result)) {
        return;
      }

      const binding = getCurrentCanvasBoardBinding();
      if (!binding) {
        scheduleBoardRecovery();
        return;
      }
      if (!canInsertTaskCanvasAssociationsOnCurrentBoard(task, binding.board)) {
        return;
      }
      const board = binding.board;

      // WorkZone 关联任务默认应该走自动插入与清理链路，
      // 兼容历史音频任务未显式写入 autoInsertToCanvas 的情况。
      const linkedWorkzone = findWorkZoneForTask(board, task.id);
      const linkedImageAnchor = findImageGenerationAnchorForTask(board, task);
      const shouldAutoInsert =
        task.params.autoInsertToCanvas ||
        !!getTaskReplaceElementId(task) ||
        !!linkedWorkzone ||
        !!linkedImageAnchor;

      if (!shouldAutoInsert) {
        return;
      }

      // 检查是否已经插入过（内存中的记录）
      if (isTaskInsertionTracked(task.id)) {
        // console.log(`[AutoInsert] Task ${task.id} skipped: already tracked in memory`);
        return;
      }

      // 检查是否已经插入过（持久化的标记）
      if (task.insertedToCanvas) {
        // console.log(`[AutoInsert] Task ${task.id} skipped: insertedToCanvas flag is true (persisted)`);
        rememberInsertedTask(task.id);
        return;
      }

      const postProcessingStatus =
        workflowCompletionService.getPostProcessingStatus(task.id)?.status;
      if (postProcessingStatus === 'completed') {
        rememberInsertedTask(task.id);
        return;
      }

      if (postProcessingStatus === 'processing') {
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

      if (task.type === TaskType.VIDEO && task.params.pptExplainer) {
        if (!binding.boardId) return;
        handlePptExplainerInsertion(task, board, binding.boardId);
        return;
      }

      // console.log(`[AutoInsert] Task ${task.id} passed all checks, will be inserted`);

      // 先占位，防止并发重复插入；成功后再持久化 inserted 标记。
      reserveTaskInsertion(task.id);

      const params = task.params as TaskParams;

      // 检查是否为灵感图任务（需要在宫格图之前检查）
      if (task.type === TaskType.CHAT) {
        const { task: insertionTask } = resolveTaskForCanvasInsertion(
          task,
          board
        );
        const insertionBoardToken = captureCanvasInsertionBoardToken(board);
        const promptLabel =
          (insertionTask.params.prompt || '').slice(0, 20) || undefined;
        Promise.resolve()
          .then(async () => {
            if (!insertionBoardToken) {
              throw new Error('画板已切换，取消本次插入');
            }
            const currentInsertionBoardToken = insertionBoardToken;
            if (getTaskReplaceElementId(insertionTask)) {
              const replaced = await replaceGeneratedTarget(
                board,
                insertionTask,
                insertionTask.result?.chatResponse || '',
                'text'
              );
              if (!replaced) {
                throw new Error('Target element is no longer available');
              }
              return {
                position: replaced.point || [0, 0],
                elementId: replaced.elementId,
                size: replaced.size,
              };
            }

            const insertionResult = await executeCanvasInsertion({
              board,
              boardGuard: () =>
                isCanvasInsertionBoardTokenCurrent(currentInsertionBoardToken),
              items: [
                {
                  type: 'text',
                  content: insertionTask.result?.chatResponse || '',
                  label: promptLabel,
                  metadata: {
                    prompt: insertionTask.params.prompt,
                    generationTaskId: insertionTask.id,
                  },
                },
              ],
            });
            return getInsertionResultGeometry(
              insertionResult,
              [0, 0],
              undefined,
              ['text']
            );
          })
          .then((insertionGeometry) => {
            if (
              !insertionBoardToken ||
              !isCanvasInsertionBoardTokenCurrent(insertionBoardToken) ||
              !canInsertTaskCanvasAssociationsOnCurrentBoard(task, board)
            ) {
              releaseTaskInsertion(task.id);
              return;
            }
            workflowCompletionService.completePostProcessing(
              task.id,
              1,
              insertionGeometry.position,
              insertionGeometry.elementId,
              insertionGeometry.size
            );
            finalizeTaskInsertion(task, board);
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
        handleSplitTask(task, board);
        return;
      }

      // 检查是否为宫格图任务
      if (checkGridImageTask(params)) {
        // console.log(`[AutoInsert] Task ${task.id} is grid image task, handling split`);
        // 对于需要拆分的任务，先不更新步骤状态，等拆分完成后再更新
        handleSplitTask(task, board);
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
        flushPendingInserts().catch((error) => {
          console.error('[AutoInsert] Failed to flush pending inserts:', error);
        });
      }
    };

    const recoverCompletedAutoInsertTasks = () => {
      if (!getCurrentCanvasBoardBinding()) {
        scheduleBoardRecovery();
        return;
      }
      getTaskQueueService()
        .getAllTasks()
        .forEach((task) => {
          if (task.status === TaskStatus.COMPLETED) {
            handleTaskCompleted(task);
          }
        });
    };

    /**
     * 处理任务失败事件
     * Note: 步骤状态更新现在由 SW 统一通过 workflow:stepStatus 事件处理
     * 不再需要在这里调用 updateWorkflowStepForTask
     */
    const handleTaskFailed = (task: Task) => {
      // image anchor 的失败态由 useImageGenerationAnchorSync 统一推导。
      if (task.params?.pptSlideImage && task.params?.targetFrameId) {
        const board = getCanvasBoard();
        if (board) {
          setFramePPTMeta(board, task.params.targetFrameId as string, {
            slideImageStatus: 'failed',
            imageStatus: 'failed',
          });
        }
      }
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
          } else if (
            event.task.status === TaskStatus.FAILED ||
            event.task.status === TaskStatus.CANCELLED
          ) {
            handleTaskFailed(event.task);
          }
        } else if (event.type === 'taskFailed') {
          handleTaskFailed(event.task);
        } else if (event.type === 'taskSynced') {
          if (event.task.status === TaskStatus.COMPLETED) {
            handleTaskCompleted(event.task);
          }
        } else if (event.type === 'taskCreated') {
          recoverCompletedAutoInsertTasks();
        }
      });

    recoverCompletedAutoInsertTasks();

    const workspaceSub = workspaceService.observeEvents().subscribe((event) => {
      if (!isActive || event.type !== 'boardSwitched') return;

      scheduleBoardRecovery(0);
      if (pendingInsertsRef.current.size > 0) {
        scheduleFlush(0);
      }
    });

    // 订阅后处理完成事件，以便在所有任务插入完成后删除 WorkZone
    const completionSub = workflowCompletionService
      .observeCompletionEvents()
      .subscribe((event) => {
        if (
          event.type === 'postProcessingCompleted' &&
          event.result.firstElementId
        ) {
          const task = taskQueueService.getTask(event.taskId);
          const board = getCanvasBoard();
          if (task && board) {
            linkCanvasAssociationsToResult(
              board,
              task,
              event.result.firstElementId
            );
          }
        }

        if (
          event.type === 'postProcessingCompleted' ||
          event.type === 'postProcessingFailed'
        ) {
          const board = getCanvasBoard();
          if (!board) return;

          const workzone = findWorkZoneForTask(board, event.taskId);
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
      const event = rawEvent as CustomEvent<{
        taskId?: string;
        anchorId?: string;
      }>;
      const taskId = event.detail?.taskId;
      const anchorId = event.detail?.anchorId;
      const updateRetryAnchor = (
        state: Parameters<
          typeof buildImageGenerationAnchorPresentationPatch
        >[0],
        options?: Parameters<
          typeof buildImageGenerationAnchorPresentationPatch
        >[1]
      ) => {
        if (!anchorId) {
          return;
        }
        const board = getCanvasBoard();
        if (!board) {
          return;
        }
        ImageGenerationAnchorTransforms.updateAnchor(
          board,
          anchorId,
          buildImageGenerationAnchorPresentationPatch(state, options)
        );
      };

      if (!taskId) {
        updateRetryAnchor('failed', { error: '任务未绑定，无法重试' });
        return;
      }

      const retryTask = getTaskQueueService().getTask(taskId);
      if (!retryTask) {
        updateRetryAnchor('failed', { error: '任务已丢失，无法重试' });
        return;
      }

      const postProcessingStatus =
        workflowCompletionService.getPostProcessingStatus(taskId)?.status;

      if (retryTask.status === TaskStatus.COMPLETED) {
        if (
          retryTask.insertedToCanvas ||
          postProcessingStatus === 'completed'
        ) {
          rememberInsertedTask(taskId);
          updateRetryAnchor('completed');
          return;
        }

        if (
          isTaskInsertionTracked(taskId) ||
          postProcessingStatus === 'processing'
        ) {
          return;
        }
      }

      if (
        retryTask.status === TaskStatus.PENDING ||
        retryTask.status === TaskStatus.PROCESSING
      ) {
        updateRetryAnchor('accepted', { subtitle: '任务仍在执行，请稍候' });
        return;
      }

      const shouldRegenerateCompletedTask =
        retryTask.status === TaskStatus.COMPLETED &&
        postProcessingStatus === 'failed';

      if (
        retryTask.status === TaskStatus.FAILED ||
        retryTask.status === TaskStatus.CANCELLED ||
        shouldRegenerateCompletedTask
      ) {
        updateRetryAnchor('retrying');
        releaseTaskInsertion(taskId);
        workflowCompletionService.clearTask(taskId);
        getTaskQueueService().retryTask(
          taskId,
          shouldRegenerateCompletedTask ? { allowCompleted: true } : undefined
        );
        return;
      }

      if (retryTask.status === TaskStatus.COMPLETED) {
        releaseTaskInsertion(taskId);
        workflowCompletionService.clearTask(taskId);
        handleTaskCompleted(retryTask);
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
      workspaceSub.unsubscribe();
      completionSub.unsubscribe();
      window.removeEventListener(
        IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
        handleAnchorRetry as EventListener
      );
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (boardRecoveryTimer) {
        clearTimeout(boardRecoveryTimer);
        boardRecoveryTimer = null;
      }
      // 释放所有未处理的待插入任务，防止它们永久卡在 insertedTaskIds 中
      const pendingMap = pendingInsertsRef.current;
      for (const [, inserts] of pendingMap) {
        for (const { task } of inserts) {
          releaseTaskInsertion(task.id);
        }
      }
      pendingMap.clear();
    };
  }, [
    mergedConfig.enabled,
    mergedConfig.insertPrompt,
    mergedConfig.groupSimilarTasks,
    groupTimeWindow,
    maxGroupWait,
  ]);
}

/**
 * 清除已插入任务的记录（用于测试或重置）
 */
export function clearInsertedTaskIds(): void {
  activeInsertionTaskIds.clear();
  recentlyInsertedTaskIds.clear();
}

export default useAutoInsertToCanvas;
