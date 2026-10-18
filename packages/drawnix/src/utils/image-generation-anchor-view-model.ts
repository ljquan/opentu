import { RectangleClient } from '@plait/core';
import type { WorkflowMessageData } from '../types/chat.types';
import { workflowCompletionService } from '../services/workflow-completion-service';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../types/task.types';
import type {
  ImageGenerationAnchorBatchSlot,
  ImageGenerationAnchorPhase,
  ImageGenerationAnchorViewModel,
  PlaitImageGenerationAnchor,
} from '../types/image-generation-anchor.types';
import {
  getImageGenerationBatchExpectedCount,
  getTaskResultPreviewUrls,
  resolveImageGenerationBatchDisplayProgress,
} from './image-generation-anchor-batch';
import {
  getImageTaskProgressStatusText,
  resolveImageTaskDisplayProgress,
} from './image-task-progress';

const PHASE_LABELS: Record<ImageGenerationAnchorPhase, string> = {
  submitted: '已提交',
  queued: '排队中',
  generating: '生成中',
  developing: '显影中',
  inserting: '插入中',
  completed: '已完成',
  failed: '失败',
};

const PHASE_SUBTITLES: Record<ImageGenerationAnchorPhase, string> = {
  submitted: '正在创建生成锚点',
  queued: '请求已受理，等待执行',
  generating: '图片正在生成，请稍候',
  developing: '结果已返回，正在准备显影',
  inserting: '正在放入画布',
  completed: '图片已稳定落位',
  failed: '生成失败，可从当前位置重试',
};

const BATCH_STATUS_LABELS: Record<ImageGenerationAnchorPhase, string> = {
  submitted: '等待执行',
  queued: '等待执行',
  generating: '生成中...',
  developing: '正在显影',
  inserting: '正在显现',
  completed: '',
  failed: '生成失败',
};

const RESULT_INSERTION_FAILED_LABEL = '已生成，插入失败';

const clampProgress = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, value));
};

function sortBatchTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    return left.id.localeCompare(right.id);
  });
}

function derivePlaceholderSlotStatus(
  phase: ImageGenerationAnchorPhase
): ImageGenerationAnchorBatchSlot['status'] {
  if (phase === 'failed') {
    return 'failed';
  }

  if (phase === 'completed') {
    return 'ready';
  }

  if (
    phase === 'generating' ||
    phase === 'developing' ||
    phase === 'inserting'
  ) {
    return 'generating';
  }

  return 'pending';
}

function deriveTaskBatchSlotStatus(
  task: Task,
  phase: ImageGenerationAnchorPhase
): ImageGenerationAnchorBatchSlot['status'] {
  const postProcessing = workflowCompletionService.getPostProcessingStatus(
    task.id
  );

  if (
    task.status === TaskStatus.FAILED ||
    postProcessing?.status === 'failed'
  ) {
    return 'failed';
  }

  if (task.insertedToCanvas || postProcessing?.status === 'completed') {
    return 'ready';
  }

  if (
    postProcessing?.status === 'processing' ||
    task.status === TaskStatus.COMPLETED
  ) {
    return 'generating';
  }

  if (task.status === TaskStatus.PROCESSING) {
    return task.executionPhase === TaskExecutionPhase.SUBMITTING
      ? 'pending'
      : 'generating';
  }

  if (task.status === TaskStatus.PENDING) {
    return derivePlaceholderSlotStatus(phase);
  }

  return derivePlaceholderSlotStatus(phase);
}

function buildBatchPreview(
  anchor: PlaitImageGenerationAnchor,
  phase: ImageGenerationAnchorPhase,
  tasks: Task[],
  fallbackProgress: number | null,
  failureStage?: ImageGenerationAnchorViewModel['failureStage']
): ImageGenerationAnchorViewModel['batchPreview'] {
  if (anchor.anchorType !== 'stack') {
    return undefined;
  }

  const slots: ImageGenerationAnchorBatchSlot[] = [];
  const sortedTasks = sortBatchTasks(tasks);

  sortedTasks.forEach((task) => {
    const slotStatus = deriveTaskBatchSlotStatus(task, phase);
    const previewUrls = getTaskResultPreviewUrls(task);
    const failureDetails =
      slotStatus === 'failed' && task.status === TaskStatus.COMPLETED
        ? { failureStage: 'post-processing' as const }
        : {};

    if (previewUrls.length > 0) {
      previewUrls.forEach((previewUrl, index) => {
        slots.push({
          id: `${task.id}-${index}`,
          taskId: task.id,
          status: slotStatus,
          ...failureDetails,
          previewImageUrl: previewUrl,
          error:
            slotStatus === 'failed'
              ? task.error?.message ||
                task.error?.details?.originalError ||
                workflowCompletionService.getPostProcessingStatus(task.id)
                  ?.error
              : undefined,
        });
      });
      return;
    }

    slots.push({
      id: task.id,
      taskId: task.id,
      status: slotStatus,
      ...failureDetails,
      error:
        slotStatus === 'failed'
          ? task.error?.message ||
            task.error?.details?.originalError ||
            workflowCompletionService.getPostProcessingStatus(task.id)?.error
          : undefined,
    });
  });

  const totalCount = Math.max(
    getImageGenerationBatchExpectedCount(anchor),
    slots.length
  );
  const placeholderStatus = derivePlaceholderSlotStatus(phase);

  while (slots.length < totalCount) {
    const slotIndex = slots.length;
    slots.push({
      id: `placeholder-${slotIndex}`,
      status: placeholderStatus,
    });
  }

  const visibleSlotCount = Math.max(2, Math.min(totalCount, 4));
  const overflowCount = Math.max(totalCount - visibleSlotCount, 0);
  const visibleSlots = slots.slice(0, visibleSlotCount);
  const readySlotCount = slots.filter((slot) => slot.status === 'ready').length;
  const generatingSlotCount = slots.filter(
    (slot) => slot.status === 'generating'
  ).length;
  const pendingSlotCount = slots.filter(
    (slot) => slot.status === 'pending'
  ).length;
  const failedSlotCount = slots.filter(
    (slot) => slot.status === 'failed'
  ).length;
  const progress = resolveImageGenerationBatchDisplayProgress(
    anchor,
    tasks,
    fallbackProgress
  );
  const settledCount = readySlotCount + failedSlotCount;
  const hasPreviewImage = visibleSlots.some((slot) =>
    Boolean(slot.previewImageUrl)
  );
  const statusText =
    phase !== 'completed' && readySlotCount > 0 && readySlotCount < totalCount
      ? `${readySlotCount}/${totalCount} 已完成`
      : phase !== 'failed' && settledCount > 0 && settledCount < totalCount
      ? `${settledCount}/${totalCount} 已处理`
      : progress != null &&
        (phase === 'submitted' || phase === 'queued' || phase === 'generating')
      ? getImageTaskProgressStatusText(progress)
      : failureStage === 'post-processing'
      ? RESULT_INSERTION_FAILED_LABEL
      : BATCH_STATUS_LABELS[phase];

  return {
    totalCount,
    visibleSlotCount,
    overflowCount,
    readySlotCount,
    generatingSlotCount,
    pendingSlotCount,
    failedSlotCount,
    hasPreviewImage,
    progress,
    statusText,
    slots: visibleSlots,
  };
}

export interface BuildImageGenerationAnchorViewModelOptions {
  anchor: PlaitImageGenerationAnchor;
  task?: Task | null;
  tasks?: Task[];
  workflow?: WorkflowMessageData | null;
  postProcessingStatus?: WorkflowMessageData['postProcessingStatus'];
  isInserting?: boolean;
  hasInserted?: boolean;
  taskDisplayProgress?: number | null;
}

export function deriveImageGenerationAnchorPhase(
  options: BuildImageGenerationAnchorViewModelOptions
): ImageGenerationAnchorPhase {
  const {
    anchor,
    task,
    tasks = [],
    workflow,
    postProcessingStatus,
    isInserting,
    hasInserted,
  } = options;
  const relatedTasks = tasks.length > 0 ? tasks : task ? [task] : [];
  const hasBatchFailure =
    anchor.anchorType === 'stack' &&
    relatedTasks.some((relatedTask) => {
      const relatedPostProcessing =
        workflowCompletionService.getPostProcessingStatus(relatedTask.id);

      return (
        relatedTask.status === TaskStatus.FAILED ||
        relatedPostProcessing?.status === 'failed'
      );
    });
  const hasBatchNonFailed =
    anchor.anchorType === 'stack' &&
    relatedTasks.some((relatedTask) => {
      const relatedPostProcessing =
        workflowCompletionService.getPostProcessingStatus(relatedTask.id);

      return (
        relatedTask.status !== TaskStatus.FAILED &&
        relatedPostProcessing?.status !== 'failed'
      );
    });
  const shouldSuppressFailedPhase = hasBatchFailure && hasBatchNonFailed;

  if (
    !shouldSuppressFailedPhase &&
    (task?.status === TaskStatus.FAILED || workflow?.status === 'failed')
  ) {
    return 'failed';
  }

  if (
    !shouldSuppressFailedPhase &&
    (postProcessingStatus === 'failed' ||
      workflow?.postProcessingStatus === 'failed')
  ) {
    return 'failed';
  }

  if (hasInserted || workflow?.postProcessingStatus === 'completed') {
    return 'completed';
  }

  if (isInserting) {
    return 'inserting';
  }

  if (
    postProcessingStatus === 'processing' ||
    workflow?.postProcessingStatus === 'processing'
  ) {
    return 'developing';
  }

  if (
    task?.status === TaskStatus.COMPLETED ||
    workflow?.status === 'completed'
  ) {
    return 'developing';
  }

  if (task?.status === TaskStatus.PROCESSING) {
    if (task.executionPhase === TaskExecutionPhase.SUBMITTING) {
      return 'queued';
    }

    return 'generating';
  }

  if (task?.status === TaskStatus.PENDING || workflow?.status === 'pending') {
    return 'submitted';
  }

  return anchor.phase;
}

export function buildImageGenerationAnchorViewModel(
  options: BuildImageGenerationAnchorViewModelOptions
): ImageGenerationAnchorViewModel {
  const { anchor, task, tasks = [], taskDisplayProgress, workflow } = options;
  const phase = deriveImageGenerationAnchorPhase(options);
  const relatedTasks = tasks.length > 0 ? tasks : task ? [task] : [];
  const failedAfterGeneration =
    phase === 'failed' &&
    !relatedTasks.some(
      (relatedTask) =>
        relatedTask.status === TaskStatus.FAILED ||
        relatedTask.status === TaskStatus.CANCELLED
    ) &&
    (relatedTasks.some(
      (relatedTask) => relatedTask.status === TaskStatus.COMPLETED
    ) ||
      workflow?.status === 'completed' ||
      options.postProcessingStatus === 'failed' ||
      workflow?.postProcessingStatus === 'failed');
  const failureStage: ImageGenerationAnchorViewModel['failureStage'] =
    phase === 'failed'
      ? failedAfterGeneration
        ? 'post-processing'
        : 'generation'
      : undefined;
  const rectangle = RectangleClient.getRectangleByPoints(anchor.points);
  const fallbackProgress = clampProgress(task?.progress ?? anchor.progress);
  const batchPreview = buildBatchPreview(
    anchor,
    phase,
    tasks,
    fallbackProgress,
    failureStage
  );
  const resolvedProgress =
    task?.type === TaskType.IMAGE &&
    task.status === TaskStatus.PROCESSING &&
    (phase === 'queued' || phase === 'generating')
      ? resolveImageTaskDisplayProgress({
          startedAt: task.startedAt,
          fallbackProgress,
        })
      : fallbackProgress;
  const progress = clampProgress(
    anchor.anchorType === 'stack'
      ? batchPreview?.progress ?? taskDisplayProgress ?? resolvedProgress
      : taskDisplayProgress ?? resolvedProgress
  );
  const subtitle =
    failedAfterGeneration
      ? '图片已生成，加载或插入失败，可重试插入已有结果'
      : anchor.subtitle && anchor.phase === phase
      ? anchor.subtitle
      : PHASE_SUBTITLES[phase];

  const tone: ImageGenerationAnchorViewModel['tone'] =
    phase === 'failed'
      ? 'danger'
      : phase === 'completed'
      ? 'success'
      : phase === 'queued' || phase === 'developing'
      ? 'warning'
      : 'default';

  const progressMode: ImageGenerationAnchorViewModel['progressMode'] =
    phase === 'queued' || phase === 'generating'
      ? progress != null
        ? 'determinate'
        : 'indeterminate'
      : phase === 'submitted'
      ? 'indeterminate'
      : 'hidden';

  const primaryAction =
    phase === 'failed'
      ? {
          type: 'retry' as const,
          label: failedAfterGeneration ? '重试插入' : '重试',
        }
      : { type: 'details' as const, label: '详情' };

  const secondaryAction =
    phase === 'failed'
      ? { type: 'dismiss' as const, label: '关闭' }
      : undefined;

  return {
    id: anchor.id,
    anchorType: anchor.anchorType,
    phase,
    title: anchor.title || workflow?.name || '图片生成',
    subtitle,
    previewImageUrl: anchor.previewImageUrl,
    batchPreview,
    progress,
    progressMode,
    phaseLabel: failedAfterGeneration
      ? RESULT_INSERTION_FAILED_LABEL
      : PHASE_LABELS[phase],
    failureStage,
    tone,
    geometry: {
      position: anchor.points[0],
      width: rectangle.width,
      height: rectangle.height,
    },
    transitionMode: anchor.transitionMode,
    primaryAction,
    secondaryAction,
    error: anchor.error || workflow?.error,
    isTerminal: phase === 'completed' || phase === 'failed',
  };
}
