export const IMAGE_DOWNLOAD_TIMEOUT_MS = 30_000;
export const IMAGE_CACHE_TIMEOUT_MS = 20_000;
export const IMAGE_DECODE_TIMEOUT_MS = 15_000;
export const IMAGE_ELEMENT_LOAD_TIMEOUT_MS = 30_000;

export class ImageOperationTimeoutError extends Error {
  constructor(
    message: string,
    readonly phase: 'cache' | 'download' | 'load' = 'load'
  ) {
    super(message);
    this.name = 'ImageOperationTimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Bound image I/O, including promises that do not implement cancellation. */
export async function withImageOperationTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
  upstreamSignal?: AbortSignal,
  phase: ImageOperationTimeoutError['phase'] = 'load'
): Promise<T> {
  upstreamSignal?.throwIfAborted();
  const controller = new AbortController();
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new ImageOperationTimeoutError(message, phase));
  }, timeoutMs);

  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', onAbort);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
}
