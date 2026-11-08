import type {
  WorkflowMessageData,
  WorkflowStepData,
} from '../types/chat.types';
import type { Task } from '../types/task.types';
import { getGenerationFailureDetails } from './generation-error-details';
import { findTaskForWorkflowStep } from './workflow-task-linking';

/** Resolve a single failed call, never borrow diagnostics from a different step. */
export function getWorkflowFailureDetails(
  workflow: WorkflowMessageData,
  tasks: Task[],
  failedStep?: WorkflowStepData
) {
  const step =
    failedStep || workflow.steps.find((item) => item.status === 'failed');
  const linkedTask = step
    ? findTaskForWorkflowStep(workflow, step, tasks)
    : undefined;
  const task = linkedTask?.status === 'failed' ? linkedTask : undefined;
  const args = step?.args || {};
  const model =
    typeof args.model === 'string'
      ? args.model
      : typeof args.modelId === 'string'
      ? args.modelId
      : typeof args.textModel === 'string'
      ? args.textModel
      : undefined;
  const fallback = step?.error || workflow.error || '执行失败';
  const details = getGenerationFailureDetails(
    {
      ...task,
      params: task?.params || { model, modelRef: args.modelRef },
      error: task?.error || step?.errorDetails,
    } as Task,
    fallback
  );
  const isVideo =
    task?.type === 'video' ||
    [
      'generate_video',
      'generate_long_video',
      'generate_ppt_explainer_video',
    ].includes(step?.mcp || '');
  // Legacy video errors may contain only upstream or polling IDs. Do not
  // present those as the API site's original submission ID.
  return isVideo
    ? {
        ...details,
        requestId: task
          ? task.apiRequestId || task.error?.details?.apiRequestId
          : step?.errorDetails?.details?.apiRequestId,
      }
    : details;
}
