/** A remote task exists. A local callback failure must never authorize another POST. */
export class SubmissionPersistenceError extends Error {
  readonly name = 'SubmissionPersistenceError';
  readonly code = 'SUBMISSION_PERSISTENCE_FAILED';
  readonly retryable = false;
  protocol?: string;
  constructor(readonly remoteId: string) {
    super('请求已受理，但本地任务标识保存失败；结果待确认，不会自动重发');
  }
}

export async function notifyTaskSubmitted(
  remoteId: string,
  onSubmitted?: (id: string) => void | Promise<void>
): Promise<void> {
  try {
    await onSubmitted?.(remoteId);
  } catch (error) {
    // Do not expose a storage error's HTTP status/cause as a provider rejection.
    if (error instanceof SubmissionPersistenceError) throw error;
    throw new SubmissionPersistenceError(remoteId);
  }
}
