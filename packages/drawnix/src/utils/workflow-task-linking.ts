import { TaskStatus, TaskType, type Task } from '../types/task.types';

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowTaskLinkStep {
  id: string;
  mcp?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status?: StepStatus;
  options?: {
    batchId?: string;
    batchIndex?: number;
    batchTotal?: number;
    globalIndex?: number;
  };
}

export interface WorkflowTaskLinkWorkflow<TStep extends WorkflowTaskLinkStep> {
  id: string;
  generationType?: string;
  steps: TStep[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export function extractTaskIdFromStepResult(
  result: unknown
): string | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  const directTaskId = getString(result.taskId);
  if (directTaskId) {
    return directTaskId;
  }

  const dataTaskId = isRecord(result.data)
    ? getString(result.data.taskId)
    : undefined;
  if (dataTaskId) {
    return dataTaskId;
  }

  const nestedResultTaskId = isRecord(result.result)
    ? getString(result.result.taskId)
    : undefined;
  if (nestedResultTaskId) {
    return nestedResultTaskId;
  }

  const [firstTaskId] = Array.isArray(result.taskIds) ? result.taskIds : [];
  return getString(firstTaskId);
}

export function getTaskWorkflowId(task: Task): string | undefined {
  return getString(task.params.workflowId);
}

export function getTaskBatchId(task: Task): string | undefined {
  return getString(task.params.batchId);
}

export function getTaskBatchIndex(task: Task): number | undefined {
  return getNumber(task.params.batchIndex);
}

function getStepBatchId(step: WorkflowTaskLinkStep): string | undefined {
  return getString(step.options?.batchId) || getString(step.args?.batchId);
}

function getStepBatchIndex(step: WorkflowTaskLinkStep): number | undefined {
  return getNumber(step.options?.batchIndex) ?? getNumber(step.args?.batchIndex);
}

function isTaskTypeCompatibleWithStep(
  task: Task,
  step: WorkflowTaskLinkStep
): boolean {
  switch (task.type) {
    case TaskType.IMAGE:
      return (
        step.mcp === 'generate_image' ||
        step.mcp === 'generate_grid_image' ||
        step.mcp === 'generate_inspiration_board'
      );
    case TaskType.VIDEO:
      return (
        step.mcp === 'generate_video' ||
        step.mcp === 'generate_long_video' ||
        step.mcp === 'generate_ppt_explainer_video'
      );
    case TaskType.AUDIO:
      return step.mcp === 'generate_audio';
    case TaskType.CHAT:
      return step.mcp === 'generate_text' || step.mcp === 'ai_analyze';
    default:
      return true;
  }
}

function hasSameBatchSlot(task: Task, step: WorkflowTaskLinkStep): boolean {
  const taskBatchIndex = getTaskBatchIndex(task);
  const stepBatchIndex = getStepBatchIndex(step);
  if (
    typeof taskBatchIndex !== 'number' ||
    typeof stepBatchIndex !== 'number' ||
    taskBatchIndex !== stepBatchIndex
  ) {
    return false;
  }

  const taskBatchId = getTaskBatchId(task);
  const stepBatchId = getStepBatchId(step);
  return !taskBatchId || !stepBatchId || taskBatchId === stepBatchId;
}

export function findWorkflowStepByTaskId<
  TStep extends WorkflowTaskLinkStep
>(
  workflow: WorkflowTaskLinkWorkflow<TStep> | null | undefined,
  taskId: string
): TStep | undefined {
  return workflow?.steps.find(
    (step) => extractTaskIdFromStepResult(step.result) === taskId
  );
}

export function findWorkflowStepForTask<
  TStep extends WorkflowTaskLinkStep
>(
  workflow: WorkflowTaskLinkWorkflow<TStep> | null | undefined,
  task: Task
): TStep | undefined {
  const directMatch = findWorkflowStepByTaskId(workflow, task.id);
  if (directMatch) {
    return directMatch;
  }

  if (!workflow || getTaskWorkflowId(task) !== workflow.id) {
    return undefined;
  }

  const compatibleSteps = workflow.steps.filter((step) =>
    isTaskTypeCompatibleWithStep(task, step)
  );

  const batchSlotMatch = compatibleSteps.find((step) =>
    hasSameBatchSlot(task, step)
  );
  if (batchSlotMatch) {
    return batchSlotMatch;
  }

  const unboundSteps = compatibleSteps.filter(
    (step) => !extractTaskIdFromStepResult(step.result)
  );
  if (unboundSteps.length === 1) {
    return unboundSteps[0];
  }

  if (compatibleSteps.length === 1) {
    return compatibleSteps[0];
  }

  return undefined;
}

export function findTaskForWorkflowStep<TStep extends WorkflowTaskLinkStep>(
  workflow: WorkflowTaskLinkWorkflow<TStep>,
  step: TStep,
  tasks: Task[]
): Task | undefined {
  const taskId = extractTaskIdFromStepResult(step.result);
  if (taskId) {
    return tasks.find((task) => task.id === taskId);
  }

  const compatibleTasks = tasks.filter(
    (task) =>
      getTaskWorkflowId(task) === workflow.id &&
      isTaskTypeCompatibleWithStep(task, step)
  );

  const stepBatchIndex = getStepBatchIndex(step);
  const stepBatchId = getStepBatchId(step);
  if (typeof stepBatchIndex === 'number') {
    const batchSlotMatch = compatibleTasks.find((task) => {
      const taskBatchIndex = getTaskBatchIndex(task);
      const taskBatchId = getTaskBatchId(task);

      return (
        taskBatchIndex === stepBatchIndex &&
        (!stepBatchId || !taskBatchId || stepBatchId === taskBatchId)
      );
    });

    if (batchSlotMatch) {
      return batchSlotMatch;
    }
  }

  return compatibleTasks.length === 1 ? compatibleTasks[0] : undefined;
}

export function isWorkflowStepTaskCompleted<
  TStep extends WorkflowTaskLinkStep
>(
  workflow: WorkflowTaskLinkWorkflow<TStep>,
  step: TStep,
  tasks: Task[]
): boolean {
  return (
    findTaskForWorkflowStep(workflow, step, tasks)?.status ===
    TaskStatus.COMPLETED
  );
}

export function ensureTaskIdInStepResult(
  result: unknown,
  taskId: string
): Record<string, unknown> {
  if (isRecord(result)) {
    return extractTaskIdFromStepResult(result)
      ? { ...result }
      : { ...result, taskId };
  }

  return { taskId };
}
