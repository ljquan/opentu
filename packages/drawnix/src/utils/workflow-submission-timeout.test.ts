import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  withWorkflowSubmissionTimeout,
  WORKFLOW_SUBMISSION_TIMEOUT_MS,
} from './workflow-submission-timeout';

describe('workflow submission timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('preserves successful submission and clears the deadline', async () => {
    await expect(
      withWorkflowSubmissionTimeout(async () => 'saved')
    ).resolves.toBe('saved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates storage errors and clears the deadline', async () => {
    const error = new Error('QuotaExceededError');
    await expect(
      withWorkflowSubmissionTimeout(async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a blocked write and prevents late work after cancellation', async () => {
    let finishWrite!: () => void;
    let signal!: AbortSignal;
    const updateSession = vi.fn();
    const write = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const submission = withWorkflowSubmissionTimeout(async (currentSignal) => {
      signal = currentSignal;
      await write;
      signal.throwIfAborted();
      updateSession();
    });
    const failed = expect(submission).rejects.toThrow('保存任务记录超时');
    await vi.advanceTimersByTimeAsync(WORKFLOW_SUBMISSION_TIMEOUT_MS);
    await failed;
    expect(signal.aborted).toBe(true);
    finishWrite();
    await vi.advanceTimersByTimeAsync(1);
    expect(updateSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
