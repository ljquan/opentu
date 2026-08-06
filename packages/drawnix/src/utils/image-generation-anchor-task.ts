import type { PlaitImageGenerationAnchor } from '../types/image-generation-anchor.types';
import { TaskStatus, TaskType, type Task } from '../types/task.types';
import { isLyricsTask } from './lyrics-task-utils';

export function getImageGenerationAnchorTaskWorkflowId(
  task: Task
): string | undefined {
  return typeof task.params.workflowId === 'string'
    ? task.params.workflowId
    : undefined;
}

export function getImageGenerationAnchorTaskBatchId(
  task: Task
): string | undefined {
  return typeof task.params.batchId === 'string'
    ? task.params.batchId
    : undefined;
}

export function getImageGenerationAnchorTaskBatchIndex(
  task: Task
): number | undefined {
  return typeof task.params.batchIndex === 'number'
    ? task.params.batchIndex
    : undefined;
}

export function hasExplicitBatchBinding(
  anchor: Pick<
    PlaitImageGenerationAnchor,
    'anchorType' | 'batchId' | 'batchIndex'
  >
): boolean {
  if (anchor.anchorType === 'stack') {
    return false;
  }

  return Boolean(anchor.batchId) && typeof anchor.batchIndex === 'number';
}

export function isIndependentBatchImageGenerationAnchor(
  anchor: Pick<
    PlaitImageGenerationAnchor,
    'anchorType' | 'batchId' | 'batchIndex'
  >
): boolean {
  return hasExplicitBatchBinding(anchor);
}

export function getImageGenerationTaskInsertGroupKey(
  task: Task,
  anchor?: Pick<
    PlaitImageGenerationAnchor,
    'id' | 'anchorType' | 'batchId' | 'batchIndex'
  > | null
): string {
  const workflowId = getImageGenerationAnchorTaskWorkflowId(task);
  const batchId = getImageGenerationAnchorTaskBatchId(task);
  const batchIndex = getImageGenerationAnchorTaskBatchIndex(task);
  const fallbackGroupKey =
    workflowId || task.params.prompt || `task:${task.id}`;

  if (typeof task.params.replaceElementId === 'string') {
    return `replace-image:${task.params.replaceElementId}:${task.id}`;
  }

  if (task.type !== TaskType.IMAGE) {
    const taskGroupType =
      task.type === TaskType.AUDIO && isLyricsTask(task) ? 'lyrics' : task.type;
    return `${taskGroupType}:${fallbackGroupKey}`;
  }

  if (
    task.params.pptSlideImage &&
    typeof task.params.targetFrameId === 'string'
  ) {
    return `ppt-slide:${task.params.targetFrameId}:${batchId || task.id}`;
  }

  const hasIndependentAnchor = anchor
    ? isIndependentBatchImageGenerationAnchor(anchor)
    : false;
  const shouldUseIndependentSlotKey =
    Boolean(workflowId) &&
    typeof batchId === 'string' &&
    typeof batchIndex === 'number' &&
    (anchor ? hasIndependentAnchor : true);

  if (shouldUseIndependentSlotKey) {
    return `slot:${workflowId}:${batchId}:${batchIndex}`;
  }

  if (hasIndependentAnchor && anchor) {
    return `anchor-slot:${anchor.id}`;
  }

  return fallbackGroupKey;
}

function isImageTask(task: Task): boolean {
  return task.type === TaskType.IMAGE;
}

export function doesTaskBelongToImageGenerationAnchor(
  anchor: PlaitImageGenerationAnchor,
  task: Task
): boolean {
  if (!isImageTask(task)) {
    return false;
  }

  const taskIdSet = new Set<string>(anchor.taskIds);
  if (anchor.primaryTaskId) {
    taskIdSet.add(anchor.primaryTaskId);
  }

  if (taskIdSet.has(task.id)) {
    return true;
  }

  if (
    typeof task.params.anchorId === 'string' &&
    task.params.anchorId === anchor.id
  ) {
    return true;
  }

  const taskWorkflowId = getImageGenerationAnchorTaskWorkflowId(task);
  const taskBatchId = getImageGenerationAnchorTaskBatchId(task);
  const taskBatchIndex = getImageGenerationAnchorTaskBatchIndex(task);
  const hasAnchorExplicitBatchBinding = hasExplicitBatchBinding(anchor);

  if (hasAnchorExplicitBatchBinding) {
    if (anchor.batchId && anchor.batchId !== taskBatchId) {
      return false;
    }

    if (typeof anchor.batchIndex === 'number') {
      if (anchor.batchIndex !== taskBatchIndex) {
        return false;
      }
    }

    if (taskWorkflowId && anchor.workflowId !== taskWorkflowId) {
      return false;
    }

    return Boolean(taskBatchId) || taskWorkflowId === anchor.workflowId;
  }

  return taskWorkflowId === anchor.workflowId;
}

export function getTasksForImageGenerationAnchor(
  anchor: PlaitImageGenerationAnchor,
  allTasks: Task[]
): Task[] {
  return allTasks.filter((task) =>
    doesTaskBelongToImageGenerationAnchor(anchor, task)
  );
}

export function mergeImageGenerationAnchorTaskIds(
  anchor: PlaitImageGenerationAnchor,
  tasks: Task[]
): string[] {
  const ids = new Set(anchor.taskIds);

  tasks.forEach((task) => {
    ids.add(task.id);
  });

  return Array.from(ids);
}

export function selectPrimaryImageGenerationAnchorTask(
  anchor: PlaitImageGenerationAnchor,
  tasks: Task[]
): Task | null {
  if (anchor.primaryTaskId) {
    const primaryTask = tasks.find((task) => task.id === anchor.primaryTaskId);
    if (primaryTask) {
      return primaryTask;
    }
  }

  const activeTask = tasks
    .filter(
      (task) =>
        task.status === TaskStatus.PENDING ||
        task.status === TaskStatus.PROCESSING
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

  if (activeTask) {
    return activeTask;
  }

  return (
    tasks.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  );
}
