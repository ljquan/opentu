import { useEffect, useRef, type MutableRefObject } from 'react';
import { RectangleClient, type PlaitBoard, type Point } from '@plait/core';
import { taskQueueService } from '../services/task-queue';
import {
  workflowCompletionService,
  type WorkflowPostProcessingStatus,
  type WorkflowPostProcessingResult,
} from '../services/workflow-completion-service';
import { ImageGenerationAnchorTransforms } from '../plugins/with-image-generation-anchor';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type PlaitImageGenerationAnchor,
} from '../types/image-generation-anchor.types';
import { TaskStatus, TaskType, type Task } from '../types/task.types';
import { getImageGenerationAnchorControllerResult } from '../utils/image-generation-anchor-controller';
import {
  getImageGenerationAnchorTaskBatchId,
  getImageGenerationAnchorTaskBatchIndex,
  getImageGenerationAnchorTaskWorkflowId,
  getTasksForImageGenerationAnchor,
  mergeImageGenerationAnchorTaskIds,
  selectPrimaryImageGenerationAnchorTask,
} from '../utils/image-generation-anchor-task';
import { parseSizeToPixels } from '../utils/size-ratio';
import { hasResolvedImageGenerationBatchCount } from '../utils/image-generation-anchor-batch';

export interface UseImageGenerationAnchorSyncOptions {
  board: PlaitBoard | null;
  enabled?: boolean;
}

const COMPLETED_REMOVAL_DELAY = 1600;
const STALE_ANCHOR_CHECK_INTERVAL = 10_000;
const STALE_ANCHOR_THRESHOLD_MS = 45_000;

function isImageTask(task: Task): boolean {
  return task.type === TaskType.IMAGE;
}

function shallowEqualIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
}

function derivePostProcessingStatus(
  anchor: PlaitImageGenerationAnchor,
  tasks: Task[]
): WorkflowPostProcessingStatus | undefined {
  if (tasks.length === 0) {
    return undefined;
  }

  const results = tasks
    .map((task) => workflowCompletionService.getPostProcessingStatus(task.id))
    .filter((result): result is NonNullable<typeof result> => Boolean(result));
  const hasFailure = results.some((result) => result.status === 'failed');
  const hasNonFailedTask = tasks.some((task) => {
    const postProcessing = workflowCompletionService.getPostProcessingStatus(
      task.id
    );

    return (
      task.status !== TaskStatus.FAILED && postProcessing?.status !== 'failed'
    );
  });

  if (hasFailure && !hasNonFailedTask) {
    return 'failed';
  }

  if (results.some((result) => result.status === 'processing')) {
    return 'processing';
  }

  const allInserted =
    hasResolvedImageGenerationBatchCount(anchor, tasks) &&
    tasks.every(
      (task) =>
        Boolean(task.insertedToCanvas) ||
        workflowCompletionService.getPostProcessingStatus(task.id)?.status ===
          'completed'
    );

  if (allInserted) {
    return 'completed';
  }

  return undefined;
}

function deriveAnchorError(
  anchor: PlaitImageGenerationAnchor,
  primaryTask: Task | null,
  tasks: Task[]
): string | undefined {
  const failedPostProcessing = tasks
    .map((task) => workflowCompletionService.getPostProcessingStatus(task.id))
    .find((result) => result?.status === 'failed');

  return (
    failedPostProcessing?.error ||
    primaryTask?.error?.message ||
    primaryTask?.error?.details?.originalError ||
    anchor.error
  );
}

function deriveAnchorPreviewImageUrl(
  anchor: PlaitImageGenerationAnchor,
  primaryTask: Task | null
): string | undefined {
  const result = primaryTask?.result as
    | {
        previewImageUrl?: string;
        url?: string;
        urls?: string[];
      }
    | undefined;

  return (
    result?.previewImageUrl ||
    result?.url ||
    result?.urls?.find((url) => typeof url === 'string' && url.length > 0) ||
    anchor.previewImageUrl
  );
}

function getStaleAnchorRetryTaskId(
  anchor: PlaitImageGenerationAnchor,
  tasks: Task[]
): string | undefined {
  const relatedTasks = getTasksForImageGenerationAnchor(anchor, tasks);
  const primaryTask = selectPrimaryImageGenerationAnchorTask(
    anchor,
    relatedTasks
  );
  const primaryTaskId =
    anchor.primaryTaskId || primaryTask?.id || anchor.taskIds[0];

  if (!primaryTaskId) {
    return undefined;
  }

  const hasInserted =
    relatedTasks.length > 0 &&
    hasResolvedImageGenerationBatchCount(anchor, relatedTasks) &&
    relatedTasks.every(
      (task) =>
        Boolean(task.insertedToCanvas) ||
        workflowCompletionService.getPostProcessingStatus(task.id)?.status ===
          'completed'
    );

  if (hasInserted) {
    return undefined;
  }

  return primaryTaskId;
}

function isSamePoint(left?: Point, right?: Point): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left[0] === right[0] && left[1] === right[1];
}

function hasElementPoints(value: unknown): value is { points: [Point, Point] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { points?: unknown }).points) &&
    (value as { points: unknown[] }).points.length === 2
  );
}

function getActualInsertedElementGeometry(
  board: PlaitBoard,
  anchor: PlaitImageGenerationAnchor,
  postProcessingResult?: WorkflowPostProcessingResult
): { position: Point; size: { width: number; height: number } } | undefined {
  const resultElementId =
    postProcessingResult?.firstElementId || anchor.resultElementId;
  if (!resultElementId) {
    return undefined;
  }

  const element = board.children.find(
    (child) => (child as { id?: string }).id === resultElementId
  );

  if (!hasElementPoints(element)) {
    return undefined;
  }

  const rect = RectangleClient.getRectangleByPoints(element.points);
  return {
    position: element.points[0],
    size: {
      width: rect.width,
      height: rect.height,
    },
  };
}

function readTaskParamString(
  task: Task | null,
  key: string
): string | undefined {
  const value = task?.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getAnchorResultDimensions(
  anchor: PlaitImageGenerationAnchor,
  primaryTask: Task | null,
  postProcessingResult?: WorkflowPostProcessingResult
): { width: number; height: number } | undefined {
  if (anchor.anchorType === 'stack') {
    return undefined;
  }

  if (
    typeof postProcessingResult?.firstElementSize?.width === 'number' &&
    typeof postProcessingResult?.firstElementSize?.height === 'number' &&
    postProcessingResult.firstElementSize.width > 0 &&
    postProcessingResult.firstElementSize.height > 0
  ) {
    return {
      width: postProcessingResult.firstElementSize.width,
      height: postProcessingResult.firstElementSize.height,
    };
  }

  const taskResult = primaryTask?.result as
    | { width?: number; height?: number }
    | undefined;

  if (
    typeof taskResult?.width === 'number' &&
    typeof taskResult?.height === 'number' &&
    taskResult.width > 0 &&
    taskResult.height > 0
  ) {
    return {
      width: taskResult.width,
      height: taskResult.height,
    };
  }

  return (
    anchor.targetFrameDimensions || parseSizeToPixels(anchor.requestedSize)
  );
}

function buildAnchorGeometryPatch(
  anchor: PlaitImageGenerationAnchor,
  position: Point | undefined,
  size?: { width: number; height: number }
): Partial<PlaitImageGenerationAnchor> {
  const patch: Partial<PlaitImageGenerationAnchor> = {};

  if (position && !isSamePoint(anchor.expectedInsertPosition, position)) {
    patch.expectedInsertPosition = position;
  }

  if (position && size) {
    const nextPoints: PlaitImageGenerationAnchor['points'] = [
      position,
      [position[0] + size.width, position[1] + size.height],
    ];

    const [anchorStart, anchorEnd] = anchor.points;
    const samePoints =
      isSamePoint(anchorStart, nextPoints[0]) &&
      isSamePoint(anchorEnd, nextPoints[1]);

    if (!samePoints) {
      patch.points = nextPoints;
    }
  }

  return patch;
}

function scheduleCompletedRemoval(
  board: PlaitBoard,
  anchorId: string,
  timersRef: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>
): void {
  if (timersRef.current.has(anchorId)) {
    return;
  }

  const timer = setTimeout(() => {
    timersRef.current.delete(anchorId);
    const latestAnchor = ImageGenerationAnchorTransforms.getAnchorById(
      board,
      anchorId
    );
    if (!latestAnchor || latestAnchor.phase !== 'completed') {
      return;
    }

    ImageGenerationAnchorTransforms.removeAnchor(board, anchorId);
  }, COMPLETED_REMOVAL_DELAY);

  timersRef.current.set(anchorId, timer);
}

function cancelScheduledRemoval(
  anchorId: string,
  timersRef: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>
): void {
  const timer = timersRef.current.get(anchorId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  timersRef.current.delete(anchorId);
}

export function useImageGenerationAnchorSync({
  board,
  enabled = true,
}: UseImageGenerationAnchorSyncOptions): void {
  const removalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  useEffect(() => {
    if (!board || !enabled) {
      return;
    }

    const removalTimers = removalTimersRef.current;

    const reconcileAnchor = (anchorId: string) => {
      const anchor = ImageGenerationAnchorTransforms.getAnchorById(
        board,
        anchorId
      );
      if (!anchor) {
        cancelScheduledRemoval(anchorId, removalTimersRef);
        return;
      }

      const allTasks = taskQueueService.getAllTasks();
      const relatedTasks = getTasksForImageGenerationAnchor(anchor, allTasks);
      const primaryTask = selectPrimaryImageGenerationAnchorTask(
        anchor,
        relatedTasks
      );
      const mergedTaskIds = mergeImageGenerationAnchorTaskIds(
        anchor,
        relatedTasks
      );
      const primaryTaskId = anchor.primaryTaskId || primaryTask?.id;
      const postProcessingStatus = derivePostProcessingStatus(
        anchor,
        relatedTasks
      );
      const primaryPostProcessingResult =
        (primaryTaskId
          ? workflowCompletionService.getPostProcessingStatus(primaryTaskId)
          : undefined) ||
        relatedTasks
          .map((task) =>
            workflowCompletionService.getPostProcessingStatus(task.id)
          )
          .find((result): result is WorkflowPostProcessingResult =>
            Boolean(result)
          );
      const hasInserted =
        relatedTasks.length > 0 &&
        hasResolvedImageGenerationBatchCount(anchor, relatedTasks) &&
        relatedTasks.every(
          (task) =>
            Boolean(task.insertedToCanvas) ||
            workflowCompletionService.getPostProcessingStatus(task.id)
              ?.status === 'completed'
        );
      const nextError = deriveAnchorError(anchor, primaryTask, relatedTasks);
      const nextPreviewImageUrl = deriveAnchorPreviewImageUrl(
        anchor,
        primaryTask
      );
      const actualInsertedGeometry = getActualInsertedElementGeometry(
        board,
        anchor,
        primaryPostProcessingResult
      );

      const controllerResult = getImageGenerationAnchorControllerResult({
        anchor: {
          ...anchor,
          taskIds: mergedTaskIds,
          primaryTaskId,
          error: nextError,
        },
        task: primaryTask ?? undefined,
        tasks: relatedTasks,
        postProcessingStatus,
        isInserting:
          anchor.phase === 'inserting' && postProcessingStatus === 'processing',
        hasInserted,
      });
      const { viewModel, nextPatch } = controllerResult;

      const patch: Partial<PlaitImageGenerationAnchor> = {};

      if (!shallowEqualIds(anchor.taskIds, mergedTaskIds)) {
        patch.taskIds = mergedTaskIds;
      }

      if (primaryTaskId && primaryTaskId !== anchor.primaryTaskId) {
        patch.primaryTaskId = primaryTaskId;
      }

      if (anchor.phase !== nextPatch.phase) {
        patch.phase = nextPatch.phase;
      }

      if ((anchor.progress ?? null) !== (nextPatch.progress ?? null)) {
        patch.progress = nextPatch.progress;
      }

      if ((anchor.subtitle ?? '') !== (nextPatch.subtitle ?? '')) {
        patch.subtitle = nextPatch.subtitle;
      }

      if ((anchor.error ?? undefined) !== (nextPatch.error ?? undefined)) {
        patch.error = nextPatch.error;
      }

      if ((anchor.previewImageUrl ?? '') !== (nextPreviewImageUrl ?? '')) {
        patch.previewImageUrl = nextPreviewImageUrl;
      }

      const nextResultElementId =
        primaryPostProcessingResult?.firstElementId || anchor.resultElementId;
      if (
        nextResultElementId &&
        nextResultElementId !== anchor.resultElementId
      ) {
        patch.resultElementId = nextResultElementId;
      }

      const nextPrompt = readTaskParamString(primaryTask, 'prompt');
      if (nextPrompt && nextPrompt !== anchor.prompt) {
        patch.prompt = nextPrompt;
      }

      const nextLatestTaskId = primaryTask?.id;
      if (nextLatestTaskId && nextLatestTaskId !== anchor.latestTaskId) {
        patch.latestTaskId = nextLatestTaskId;
      }

      const nextSourceTaskId =
        readTaskParamString(primaryTask, 'sourceTaskId') || anchor.sourceTaskId;
      if (nextSourceTaskId && nextSourceTaskId !== anchor.sourceTaskId) {
        patch.sourceTaskId = nextSourceTaskId;
      }

      const taskTargetElementId =
        readTaskParamString(primaryTask, 'targetElementId') ||
        readTaskParamString(primaryTask, 'replaceElementId');
      const replacementWasSuppressed =
        primaryTask?.params.boundTargetFollowControlled === true &&
        Boolean(
          taskTargetElementId &&
            nextResultElementId &&
            taskTargetElementId !== nextResultElementId
        );
      const nextTargetElementId = replacementWasSuppressed
        ? undefined
        : taskTargetElementId || anchor.targetElementId;
      if (replacementWasSuppressed) {
        if (anchor.targetElementId !== undefined) {
          patch.targetElementId = undefined;
        }
      } else if (
        nextTargetElementId &&
        nextTargetElementId !== anchor.targetElementId
      ) {
        patch.targetElementId = nextTargetElementId;
      }

      const geometryPatch = buildAnchorGeometryPatch(
        anchor,
        actualInsertedGeometry?.position ??
          primaryPostProcessingResult?.firstElementPosition,
        actualInsertedGeometry?.size ??
          getAnchorResultDimensions(
            anchor,
            primaryTask,
            primaryPostProcessingResult
          )
      );

      Object.assign(patch, geometryPatch);

      if (
        primaryPostProcessingResult?.firstElementPosition &&
        anchor.transitionMode !==
          (anchor.anchorType === 'frame' ? 'hold' : 'morph')
      ) {
        patch.transitionMode = anchor.anchorType === 'frame' ? 'hold' : 'morph';
      }

      if (Object.keys(patch).length > 0) {
        ImageGenerationAnchorTransforms.updateAnchor(board, anchor.id, patch);
      }

      if (viewModel.phase === 'completed' && hasInserted) {
        scheduleCompletedRemoval(board, anchor.id, removalTimersRef);
      } else {
        cancelScheduledRemoval(anchor.id, removalTimersRef);
      }
    };

    const reconcileAllAnchors = () => {
      ImageGenerationAnchorTransforms.getAllAnchors(board).forEach((anchor) => {
        reconcileAnchor(anchor.id);
      });
    };

    const reconcileTaskRelatedAnchors = (task: Task) => {
      const candidateAnchorIds = new Set<string>();

      const byTaskId = ImageGenerationAnchorTransforms.getAnchorByTaskId(
        board,
        task.id
      );
      if (byTaskId) {
        candidateAnchorIds.add(byTaskId.id);
      }

      const workflowId = getImageGenerationAnchorTaskWorkflowId(task);
      const batchId = getImageGenerationAnchorTaskBatchId(task);
      const batchIndex = getImageGenerationAnchorTaskBatchIndex(task);
      let hasExplicitBatchMatch = false;
      if (workflowId && batchId && typeof batchIndex === 'number') {
        const byBatchSlot =
          ImageGenerationAnchorTransforms.getAnchorByBatchSlot(board, {
            workflowId,
            batchId,
            batchIndex,
          });
        if (byBatchSlot) {
          candidateAnchorIds.add(byBatchSlot.id);
          hasExplicitBatchMatch = true;
        }
      }

      if (workflowId && !hasExplicitBatchMatch) {
        ImageGenerationAnchorTransforms.getAnchorsByWorkflowId(
          board,
          workflowId
        ).forEach((anchor) => {
          candidateAnchorIds.add(anchor.id);
        });
      }

      if (candidateAnchorIds.size === 0) {
        reconcileAllAnchors();
        return;
      }

      candidateAnchorIds.forEach((anchorId) => reconcileAnchor(anchorId));
    };

    reconcileAllAnchors();

    const taskSubscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (!isImageTask(event.task)) {
          return;
        }

        reconcileTaskRelatedAnchors(event.task);
      });

    const completionSubscription = workflowCompletionService
      .observeCompletionEvents()
      .subscribe((event) => {
        const byTaskId = ImageGenerationAnchorTransforms.getAnchorByTaskId(
          board,
          event.taskId
        );

        if (byTaskId) {
          reconcileAnchor(byTaskId.id);
          return;
        }

        reconcileAllAnchors();
      });

    const stalePhaseTimestamps = new Map<string, number>();
    const staleCheckTimer = setInterval(() => {
      const anchors = ImageGenerationAnchorTransforms.getAllAnchors(board);
      const now = Date.now();
      for (const anchor of anchors) {
        if (anchor.phase === 'developing' || anchor.phase === 'inserting') {
          const entered = stalePhaseTimestamps.get(anchor.id);
          if (!entered) {
            stalePhaseTimestamps.set(anchor.id, now);
          } else if (now - entered > STALE_ANCHOR_THRESHOLD_MS) {
            stalePhaseTimestamps.delete(anchor.id);
            reconcileAnchor(anchor.id);

            const latestAnchor = ImageGenerationAnchorTransforms.getAnchorById(
              board,
              anchor.id
            );
            if (
              !latestAnchor ||
              (latestAnchor.phase !== 'developing' &&
                latestAnchor.phase !== 'inserting')
            ) {
              continue;
            }

            const primaryTaskId = getStaleAnchorRetryTaskId(
              latestAnchor,
              taskQueueService.getAllTasks()
            );
            if (primaryTaskId) {
              window.dispatchEvent(
                new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
                  detail: { taskId: primaryTaskId },
                })
              );
            }
          }
        } else {
          stalePhaseTimestamps.delete(anchor.id);
        }
      }
    }, STALE_ANCHOR_CHECK_INTERVAL);

    return () => {
      taskSubscription.unsubscribe();
      completionSubscription.unsubscribe();
      clearInterval(staleCheckTimer);
      removalTimers.forEach((timer) => clearTimeout(timer));
      removalTimers.clear();
    };
  }, [board, enabled]);
}
