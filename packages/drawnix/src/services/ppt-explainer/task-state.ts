import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
  type TaskError,
  type TaskInvocationRouteSnapshot,
  type TaskResult,
} from '../../types/task.types';
import { generateTaskId } from '../../utils/task-utils';
import {
  taskStorageWriter,
  type SWTask,
} from '../media-executor/task-storage-writer';
import { taskQueueService } from '../task-queue';
import type { PptExplainerProviderRouteSnapshot } from './provider-contract';
import type { PptExplainerTaskState } from './types';
import {
  assertPersistablePptExplainerState,
  readPptExplainerState,
} from './validation';

const rootTaskPersistenceTails = new Map<string, Promise<void>>();

function toTaskInvocationRoute(
  route: PptExplainerProviderRouteSnapshot
): TaskInvocationRouteSnapshot {
  return {
    operation: 'video',
    modelRef: { ...route.modelRef },
    providerProfileId: route.providerProfileId,
    modelId: route.modelRef.modelId,
    binding: {
      id: route.binding.id,
      protocol: route.binding.protocol,
      requestSchema: route.binding.requestSchema,
      responseSchema: route.binding.responseSchema,
      submitPath: route.binding.submitPath,
      pollPathTemplate: route.binding.pollPathTemplate,
      baseUrlStrategy: route.binding.baseUrlStrategy,
      metadata: {
        pptExplainer: route.binding.pptExplainer,
      },
    },
  };
}

async function persistTaskNow(
  task: Task,
  options: { skipIfStale?: boolean } = {}
): Promise<void> {
  const previous = rootTaskPersistenceTails.get(task.id) || Promise.resolve();
  const persistence = previous
    .catch(() => undefined)
    .then(async () => {
      if (options.skipIfStale) {
        const current = taskQueueService.getTask(task.id);
        if (!current || current !== task) return;
      }
      await taskStorageWriter.saveTask(task as unknown as SWTask);
    });
  rootTaskPersistenceTails.set(task.id, persistence);
  try {
    await persistence;
  } finally {
    if (rootTaskPersistenceTails.get(task.id) === persistence) {
      rootTaskPersistenceTails.delete(task.id);
    }
  }
}

export async function createPptExplainerRootTask(
  state: PptExplainerTaskState,
  options: { track?: boolean } = {}
): Promise<Task> {
  assertPersistablePptExplainerState(state);
  const now = Date.now();
  const task: Task = {
    id: generateTaskId(),
    type: TaskType.VIDEO,
    status: TaskStatus.PENDING,
    params: {
      prompt: state.topic?.trim() || 'PPT 讲解视频',
      model: state.models.videoModel,
      modelRef: state.models.videoModelRef,
      autoInsertToCanvas: true,
      pptExplainer: state,
      promptMeta: {
        initialPrompt: state.topic?.trim() || 'PPT 讲解视频',
        sentPrompt: state.topic?.trim() || 'PPT 讲解视频',
        title: state.topic?.trim() || 'PPT 讲解视频',
        category: 'agent',
        tags: ['PPT讲解视频'],
        skillId: 'generate_ppt_explainer_video',
        skillName: 'PPT讲解视频',
      },
    },
    createdAt: now,
    updatedAt: now,
    progress: 0,
    ...(state.originalRoute
      ? { invocationRoute: toTaskInvocationRoute(state.originalRoute) }
      : {}),
  };
  await persistTaskNow(task);
  if (options.track !== false) {
    taskQueueService.trackExternalTask(task);
  }
  return task;
}

/**
 * Persist preparation checkpoints before the task is exposed to the executor.
 * A restored task is registered by the normal storage hydration path.
 */
export async function persistDetachedPptExplainerRootTask(
  task: Task,
  update: PptExplainerTaskUpdate
): Promise<Task> {
  assertPersistablePptExplainerState(update.state);
  const next: Task = {
    ...task,
    status: update.status ?? task.status,
    params: {
      ...task.params,
      pptExplainer: update.state,
    },
    progress:
      update.progress === undefined
        ? task.progress
        : Math.max(0, Math.min(100, update.progress)),
    remoteId: update.remoteId ?? task.remoteId,
    result: update.result ?? task.result,
    error: update.error,
    executionPhase: update.executionPhase,
    updatedAt: Date.now(),
  };
  await persistTaskNow(next);
  return next;
}

export function trackPptExplainerRootTask(task: Task): void {
  taskQueueService.trackExternalTask(task);
}

export interface PptExplainerTaskUpdate {
  state: PptExplainerTaskState;
  status?: TaskStatus;
  progress?: number;
  remoteId?: string;
  result?: TaskResult;
  error?: TaskError;
  executionPhase?: TaskExecutionPhase;
}

export async function updatePptExplainerRootTask(
  taskId: string,
  update: PptExplainerTaskUpdate,
  options: {
    expectedExecutionAttempt?: number;
    allowTerminal?: boolean;
  } = {}
): Promise<Task | null> {
  const current = taskQueueService.getTask(taskId);
  const currentState = current ? readPptExplainerState(current) : null;
  if (!current || !currentState) return null;
  if (
    options.expectedExecutionAttempt !== undefined &&
    currentState.executionAttempt !== options.expectedExecutionAttempt
  ) {
    return null;
  }
  if (
    !options.allowTerminal &&
    (current.status === TaskStatus.FAILED ||
      current.status === TaskStatus.CANCELLED ||
      current.status === TaskStatus.COMPLETED)
  ) {
    return null;
  }

  assertPersistablePptExplainerState(update.state);
  const nextStatus = update.status ?? current.status;
  taskQueueService.updateTaskStatus(taskId, nextStatus, {
    params: {
      ...current.params,
      pptExplainer: update.state,
    },
    progress:
      update.progress === undefined
        ? current.progress
        : Math.max(0, Math.min(100, update.progress)),
    remoteId: update.remoteId ?? current.remoteId,
    result: update.result ?? current.result,
    error: update.error,
    executionPhase: update.executionPhase,
  });
  const updated = taskQueueService.getTask(taskId);
  if (!updated) return null;
  await persistTaskNow(updated, { skipIfStale: true });
  return updated;
}

export async function confirmPptExplainerOutline(
  taskId: string,
  acceptedSource?: {
    frameIds: string[];
    frameRevisions: Record<string, string>;
  }
): Promise<Task> {
  const task = taskQueueService.getTask(taskId);
  const state = task ? readPptExplainerState(task) : null;
  if (!task || !state) throw new Error('PPT 讲解任务不存在');
  if (task.status !== TaskStatus.PENDING || state.stage !== 'review_pending') {
    throw new Error('当前任务不在大纲确认阶段');
  }
  const updated = await updatePptExplainerRootTask(
    taskId,
    {
      state: {
        ...state,
        reviewAcceptedAt: Date.now(),
        stage: 'snapshotting',
        ...(acceptedSource
          ? {
              outlineFrameIds: [...acceptedSource.frameIds],
              sourceFrameRevisions: { ...acceptedSource.frameRevisions },
            }
          : {}),
      },
      status: TaskStatus.PENDING,
      progress: 10,
    },
    { allowTerminal: false }
  );
  if (!updated) throw new Error('大纲确认状态保存失败');
  return updated;
}

export function getPptExplainerTaskState(
  taskId: string
): PptExplainerTaskState | null {
  const task = taskQueueService.getTask(taskId);
  return task ? readPptExplainerState(task) : null;
}
