import { workflowCompletionService } from '../services/workflow-completion-service';
import { taskQueueService } from '../services/task-queue-service';
import type { PostProcessingStatus } from '../types/chat.types';
import { TaskStatus } from '../types/shared/core.types';

type PostProcessingResult = NonNullable<
  ReturnType<typeof workflowCompletionService.getPostProcessingStatus>
>;

type WorkflowStepWithResult = {
  result?: unknown;
};

type WorkflowWithTaskSteps = {
  generationType?: string;
  steps?: WorkflowStepWithResult[];
  postProcessingStatus?: PostProcessingStatus;
  insertedCount?: number;
};

function collectWorkflowTaskIds(workflow: WorkflowWithTaskSteps): string[] {
  const ids = new Set<string>();

  (workflow.steps || []).forEach((step) => {
    const result = step.result as
      | { taskId?: string; taskIds?: string[] }
      | undefined;

    if (result?.taskId) {
      ids.add(result.taskId);
    }

    if (Array.isArray(result?.taskIds)) {
      result.taskIds.forEach((taskId) => {
        if (taskId) {
          ids.add(taskId);
        }
      });
    }
  });

  return Array.from(ids);
}

export function deriveRecoveredPostProcessingState(
  workflow: WorkflowWithTaskSteps
): {
  postProcessingStatus?: PostProcessingStatus;
  insertedCount?: number;
} {
  if (workflow.generationType !== 'image') {
    return {};
  }

  const taskIds = collectWorkflowTaskIds(workflow);
  if (taskIds.length === 0) {
    return {};
  }

  const serviceResults = taskIds
    .map((taskId) => workflowCompletionService.getPostProcessingStatus(taskId))
    .filter((result): result is PostProcessingResult => result !== undefined);

  const completedServiceResults = serviceResults.filter(
    (result) => result.status === 'completed'
  );
  const insertedFromService = completedServiceResults.reduce(
    (sum, result) => sum + (result.insertedCount || 0),
    0
  );

  if (serviceResults.some((result) => result.status === 'failed')) {
    return {
      postProcessingStatus: 'failed',
      insertedCount: insertedFromService || undefined,
    };
  }

  if (serviceResults.some((result) => result.status === 'processing')) {
    return {
      postProcessingStatus: 'processing',
      insertedCount: insertedFromService || undefined,
    };
  }

  if (
    serviceResults.length === taskIds.length &&
    serviceResults.every((result) => result.status === 'completed')
  ) {
    return {
      postProcessingStatus: 'completed',
      insertedCount: insertedFromService || taskIds.length,
    };
  }

  const queueTasks = taskIds
    .map((taskId) => taskQueueService.getTask(taskId))
    .filter((task): task is NonNullable<typeof task> => Boolean(task));

  if (
    queueTasks.some(
      (task) =>
        task.status === TaskStatus.FAILED ||
        task.status === TaskStatus.CANCELLED
    )
  ) {
    return {
      postProcessingStatus: 'failed',
      insertedCount: insertedFromService || undefined,
    };
  }

  if (
    queueTasks.length === taskIds.length &&
    queueTasks.every((task) => task.insertedToCanvas)
  ) {
    return {
      postProcessingStatus: 'completed',
      insertedCount: insertedFromService || queueTasks.length,
    };
  }

  return {
    insertedCount: insertedFromService || undefined,
  };
}

export function normalizeWorkflowPostProcessing<T extends WorkflowWithTaskSteps>(
  workflow: T
): T {
  const recovered = deriveRecoveredPostProcessingState(workflow);
  const nextStatus = recovered.postProcessingStatus ?? workflow.postProcessingStatus;
  const nextInsertedCount = recovered.insertedCount ?? workflow.insertedCount;

  if (
    nextStatus === workflow.postProcessingStatus &&
    nextInsertedCount === workflow.insertedCount
  ) {
    return workflow;
  }

  return {
    ...workflow,
    ...(nextStatus !== undefined
      ? { postProcessingStatus: nextStatus }
      : {}),
    ...(nextInsertedCount !== undefined
      ? { insertedCount: nextInsertedCount }
      : {}),
  };
}
