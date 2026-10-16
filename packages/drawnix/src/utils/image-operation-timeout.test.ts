import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ImageOperationTimeoutError,
  withImageOperationTimeout,
} from './image-operation-timeout';

afterEach(() => vi.useRealTimers());

describe('withImageOperationTimeout', () => {
  it('aborts and rejects a stalled operation even if it ignores cancellation', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = withImageOperationTimeout(
      (value) => {
        signal = value;
        return new Promise<never>(() => undefined);
      },
      100,
      'download timed out'
    );
    const rejected = expect(result).rejects.toBeInstanceOf(
      ImageOperationTimeoutError
    );
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears timers and upstream listeners after success', async () => {
    vi.useFakeTimers();
    const upstream = new AbortController();
    let signal: AbortSignal | undefined;
    await expect(
      withImageOperationTimeout(
        async (value) => {
          signal = value;
          return 'loaded';
        },
        100,
        'timeout',
        upstream.signal
      )
    ).resolves.toBe('loaded');
    upstream.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves upstream cancellation without converting it into a timeout', async () => {
    vi.useFakeTimers();
    const upstream = new AbortController();
    const stop = new Error('cancelled by caller');
    const result = withImageOperationTimeout(
      () => new Promise<never>(() => undefined),
      100,
      'timeout',
      upstream.signal
    );
    const rejected = expect(result).rejects.toBe(stop);
    upstream.abort(stop);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start an already cancelled operation', async () => {
    const upstream = new AbortController();
    const stop = new Error('already cancelled');
    upstream.abort(stop);
    const operation = vi.fn();
    await expect(
      withImageOperationTimeout(operation, 100, 'timeout', upstream.signal)
    ).rejects.toBe(stop);
    expect(operation).not.toHaveBeenCalled();
  });

  it('cleans up after synchronous failure', async () => {
    vi.useFakeTimers();
    const error = new Error('cache unavailable');
    await expect(
      withImageOperationTimeout(
        () => {
          throw error;
        },
        100,
        'timeout'
      )
    ).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
