/**
 * Keeps task-queue code out of the application bootstrap while preserving the
 * full synchronous task guard inside the lazily loaded canvas runtime.
 */
export async function safeReload(): Promise<boolean> {
  const { hasActiveLLMTasks } = await import('./active-tasks');
  if (await hasActiveLLMTasks()) {
    const confirmed = window.confirm(
      '当前有正在进行的 AI 生成任务，刷新页面会中断这些任务。确定要刷新吗？'
    );
    if (!confirmed) return false;
  }
  window.location.reload();
  return true;
}
