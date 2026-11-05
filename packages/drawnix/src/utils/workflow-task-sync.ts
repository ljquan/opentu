import type { WorkflowMessageData } from '../types/chat.types';
import { TaskStatus, type Task } from '../types/task.types';
import {
  ensureTaskIdInStepResult,
  findWorkflowStepForTask,
} from './workflow-task-linking';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTaskErrorMessage(task: Task): string | undefined {
  if (!task.error) {
    return undefined;
  }

  return task.error.message || task.error.code || '任务执行失败';
}

function getCompletedStepResult(
  currentResult: unknown,
  task: Task
): Record<string, unknown> {
  const base = isRecord(currentResult) ? { ...currentResult } : {};
  return {
    ...base,
    taskId: task.id,
    result: task.result,
  };
}

function getWorkflowStatusFromSteps(
  steps: WorkflowMessageData['steps']
): WorkflowMessageData['status'] {
  const failedSteps = steps.filter((step) => step.status === 'failed').length;
  const runningSteps = steps.filter((step) => step.status === 'running').length;
  const pendingSteps = steps.filter((step) => step.status === 'pending').length;
  const completedSteps = steps.filter(
    (step) => step.status === 'completed'
  ).length;

  if (failedSteps > 0) {
    return 'failed';
  }

  if (runningSteps > 0) {
    return 'running';
  }

  if (pendingSteps === 0 && completedSteps > 0) {
    return 'completed';
  }

  return 'pending';
}

function areAllStepsCompleted(
  steps: WorkflowMessageData['steps']
): boolean {
  return (
    steps.length > 0 && steps.every((step) => step.status === 'completed')
  );
}

/**
 * Apply a task queue update directly to a persisted Chat Drawer workflow.
 *
 * This is the drawer fallback path for task-queue retries: the retried task may
 * no longer be attached to the active WorkflowContext, but the stored workflow
 * message still has enough task metadata to update the visible bubble.
 */
export function applyTaskUpdateToWorkflowMessage(
  workflow: WorkflowMessageData,
  task: Task
): WorkflowMessageData | null {
  const targetStep = findWorkflowStepForTask(workflow, task);
  if (!targetStep) {
    return null;
  }

  const updatedSteps = workflow.steps.map((step) => {
    if (step.id !== targetStep.id) {
      return step;
    }

    switch (task.status) {
      case TaskStatus.PENDING:
      case TaskStatus.PROCESSING: {
        if (step.status === 'completed') {
          return {
            ...step,
            result: ensureTaskIdInStepResult(step.result, task.id),
          };
        }

        return {
          ...step,
          status: 'running' as const,
          result: ensureTaskIdInStepResult(step.result, task.id),
          error: undefined,
          errorDetails: undefined,
        };
      }

      case TaskStatus.COMPLETED:
        return {
          ...step,
          status: 'completed' as const,
          result: getCompletedStepResult(step.result, task),
          error: undefined,
          errorDetails: undefined,
        };

      case TaskStatus.FAILED:
        return {
          ...step,
          status: 'failed' as const,
          result: ensureTaskIdInStepResult(step.result, task.id),
          error: getTaskErrorMessage(task),
          errorDetails: {...task.error!, details: {...task.error?.details, apiRequestId: task.apiRequestId || task.error?.details?.apiRequestId, modelId: task.error?.details?.modelId || task.invocationRoute?.modelId || task.params.model, remoteId: task.error?.details?.remoteId || task.remoteId}},
        };

      case TaskStatus.CANCELLED:
        return {
          ...step,
          status: 'skipped' as const,
          result: ensureTaskIdInStepResult(step.result, task.id),
          error: getTaskErrorMessage(task),
          errorDetails: {...task.error!, details: {...task.error?.details, apiRequestId: task.apiRequestId || task.error?.details?.apiRequestId, modelId: task.error?.details?.modelId || task.invocationRoute?.modelId || task.params.model, remoteId: task.error?.details?.remoteId || task.remoteId}},
        };

      default:
        return step;
    }
  });

  const allStepsCompleted = areAllStepsCompleted(updatedSteps);
  const nextWorkflowStatus = getWorkflowStatusFromSteps(updatedSteps);
  const shouldMarkImageCompleted =
    workflow.generationType === 'image' && allStepsCompleted;
  const shouldClearImagePostProcessing =
    workflow.generationType === 'image' &&
    task.status !== TaskStatus.COMPLETED &&
    workflow.postProcessingStatus !== 'completed';

  return {
    ...workflow,
    status: nextWorkflowStatus,
    steps: updatedSteps,
    error: nextWorkflowStatus === 'failed' ? workflow.error : undefined,
    postProcessingStatus: shouldMarkImageCompleted
      ? 'completed'
      : shouldClearImagePostProcessing
      ? undefined
      : workflow.postProcessingStatus,
  };
}
