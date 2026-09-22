export const WORKFLOW_SUBMISSION_TIMEOUT_MS = 60_000;

// A blocked history write must not hold the generation form indefinitely.
export async function withWorkflowSubmissionTimeout<T>(
  submit: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('保存任务记录超时，请关闭其他同站点页面后重试');
      controller.abort(error);
      reject(error);
    }, WORKFLOW_SUBMISSION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([submit(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
