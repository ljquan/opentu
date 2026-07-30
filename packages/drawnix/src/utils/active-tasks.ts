/**
 * 活跃 LLM 任务检测工具
 *
 * 用于 beforeunload 拦截和 location.reload() 保护，
 * 防止用户在 AI 任务执行期间意外关闭或刷新页面。
 */

import { taskQueueService } from '../services/task-queue';
import { TaskExecutionPhase, TaskStatus, TaskType } from '../types/task.types';

type WorkflowSubmissionServiceLike = {
  getRunningWorkflows: () => Array<unknown>;
};

let cachedWorkflowSubmissionService: WorkflowSubmissionServiceLike | null =
  null;

/**
 * 检查持久化任务是否需要在页面启动时唤醒延迟运行时。
 *
 * 只读取任务状态和少量恢复标记，不加载媒体大字段；没有待恢复任务时仍保持
 * 工具运行时按需加载。
 */
export async function hasPersistedRecoverableTasks(): Promise<boolean> {
  const [{ migrateFromLegacyDB }, { taskStorageReader }] = await Promise.all([
    import('../services/app-database'),
    import('../services/task-storage-reader'),
  ]);
  await migrateFromLegacyDB();

  const processingTasks = await taskStorageReader.getAllTasks({
    status: TaskStatus.PROCESSING,
  });

  return processingTasks.some(
    (task) =>
      task.type === TaskType.IMAGE &&
      !task.remoteId &&
      !task.syncedFromRemote &&
      task.params.imageSubmissionAttempted === true &&
      typeof task.params.submissionRequestId === 'string' &&
      task.params.submissionRequestId.trim().length > 0 &&
      task.invocationRoute?.operation === 'image' &&
      Boolean(task.invocationRoute.providerProfileId) &&
      Boolean(
        task.invocationRoute.modelRef?.modelId || task.invocationRoute.modelId
      ) &&
      (task.executionPhase === TaskExecutionPhase.SUBMITTING ||
        task.executionPhase === TaskExecutionPhase.DOWNLOADING ||
        task.executionPhase === TaskExecutionPhase.POLLING)
  );
}

/**
 * 检查是否有活跃的 LLM 任务（正在执行的任务或工作流）
 */
export async function hasActiveLLMTasks(): Promise<boolean> {
  const tasks = taskQueueService.getAllTasks();
  const hasActiveTasks = tasks.some(
    (t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.PROCESSING
  );
  if (hasActiveTasks) return true;

  const { workflowSubmissionService } = await import(
    '../services/workflow-submission-service'
  );
  cachedWorkflowSubmissionService = workflowSubmissionService;
  const runningWorkflows = workflowSubmissionService.getRunningWorkflows();
  return runningWorkflows.length > 0;
}

export function hasActiveLLMTasksSync(): boolean {
  const tasks = taskQueueService.getAllTasks();
  const hasActiveTasks = tasks.some(
    (t) => t.status === TaskStatus.PENDING || t.status === TaskStatus.PROCESSING
  );
  if (hasActiveTasks) return true;

  return (
    (cachedWorkflowSubmissionService?.getRunningWorkflows().length || 0) > 0
  );
}

/**
 * 安全刷新页面：如果有活跃任务，提示用户确认
 * @returns 是否执行了刷新
 */
export async function safeReload(): Promise<boolean> {
  if (await hasActiveLLMTasks()) {
    const confirmed = window.confirm(
      '当前有正在进行的 AI 生成任务，刷新页面会中断这些任务。确定要刷新吗？'
    );
    if (!confirmed) return false;
  }
  window.location.reload();
  return true;
}
