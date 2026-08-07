import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';
import {
  ImageGenerationRecoveryService,
  createImageSubmissionParams,
  getImageSubmissionRequestId,
  isCurrentImageRecoveryAttempt,
} from '../image-generation-recovery-service';

function createPlan() {
  return {
    provider: {
      profileId: 'tuzi-profile',
      profileName: 'Tuzi',
      providerType: 'openai-compatible',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'secret-token',
      authType: 'bearer',
      extraHeaders: {
        'X-Request-Id': 'stale-id',
        'X-Custom': 'keep-me',
      },
    },
    modelRef: {
      profileId: 'tuzi-profile',
      modelId: 'gpt-image-2',
    },
    binding: {
      id: 'tuzi-sync-image',
      profileId: 'tuzi-profile',
      modelId: 'gpt-image-2',
      operation: 'image',
      protocol: 'openai.images.generations',
      requestSchema: 'tuzi.image.gpt-generation-json',
      responseSchema: 'openai.image.url',
      submitPath: '/images/generations',
      baseUrlStrategy: 'ensure-v1',
      priority: 100,
      confidence: 'high',
      source: 'template',
    },
  } as any;
}

function createTask(
  id: string,
  requestId = id,
  startedAt = Date.now(),
  plan = createPlan()
): Task {
  return {
    id,
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: createImageSubmissionParams(
      { prompt: '兔子', model: 'gpt-image-2' },
      requestId,
      true
    ),
    createdAt: startedAt,
    updatedAt: startedAt,
    startedAt,
    executionPhase: TaskExecutionPhase.POLLING,
    invocationRoute: {
      operation: 'image',
      providerProfileId: 'tuzi-profile',
      providerType: 'openai-compatible',
      modelId: 'gpt-image-2',
      modelRef: {
        profileId: 'tuzi-profile',
        modelId: 'gpt-image-2',
      },
      binding: {
        id: plan.binding.id,
        protocol: plan.binding.protocol,
        requestSchema: plan.binding.requestSchema,
        responseSchema: plan.binding.responseSchema,
        submitPath: plan.binding.submitPath,
        pollPathTemplate: plan.binding.pollPathTemplate,
        baseUrlStrategy: plan.binding.baseUrlStrategy,
        metadata: plan.binding.metadata,
      },
    },
  };
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

type RecoveryStartResult = ReturnType<ImageGenerationRecoveryService['start']>;

function getStartedHandle(result: RecoveryStartResult) {
  if (result.status !== 'started') {
    throw new Error(`Expected recovery to start, got ${result.reason}`);
  }
  return result.handle;
}

function expectRejectedStart(
  result: RecoveryStartResult,
  reason: Extract<RecoveryStartResult, { status: 'rejected' }>['reason']
): void {
  expect(result).toEqual({ status: 'rejected', reason });
}

describe('image generation recovery service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls the default browser fetch with the global receiver', async () => {
    const fetcher = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return Promise.resolve(
        Response.json({
          status: 'succeeded',
          data: [{ url: 'https://images.example.com/default-fetch.png' }],
        })
      );
    });
    vi.stubGlobal('fetch', fetcher);
    const onSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    service.start(createTask('task-default-fetch'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await vi.waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(1));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://images.example.com/default-fetch.png',
      }),
      expect.any(AbortSignal)
    );
  });

  it('queries the configured provider first with auth and no Request-ID header', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        status: 'succeeded',
        request_id: 'submission-1',
        data: [{ url: 'https://images.example.com/result.png' }],
      })
    );
    const onSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    service.start(createTask('task-1', 'submission-1'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await vi.waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(1));

    const [url, init] = fetcher.mock.calls[0] || [];
    expect(String(url)).toBe(
      'https://api.tu-zi.com/v1/images/generations/result?request_id=submission-1'
    );
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
    expect(headers.get('X-Custom')).toBe('keep-me');
    expect(headers.has('X-Request-Id')).toBe(false);
    expect(onSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'submission-1',
        url: 'https://images.example.com/result.png',
      }),
      expect.any(AbortSignal)
    );
  });

  it('re-resolves the same provider and model when a persisted binding ID no longer exists', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/rebound.png' }],
      })
    );
    const resolveInvocationPlan = vi.fn(
      (_operation, _modelRef, options?: { bindingId?: string }) =>
        options?.bindingId ? null : createPlan()
    );
    const onSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: resolveInvocationPlan as any,
      jitterRatio: 0,
    });

    service.start(createTask('task-stale-binding'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await vi.waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(1));

    expect(resolveInvocationPlan).toHaveBeenNthCalledWith(
      1,
      'image',
      expect.objectContaining({
        profileId: 'tuzi-profile',
        modelId: 'gpt-image-2',
      }),
      { bindingId: 'tuzi-sync-image' }
    );
    expect(resolveInvocationPlan).toHaveBeenNthCalledWith(
      2,
      'image',
      expect.objectContaining({
        profileId: 'tuzi-profile',
        modelId: 'gpt-image-2',
      })
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back across the four public query nodes after the configured provider fails', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(
        Response.json({
          status: 'succeeded',
          data: [{ url: 'https://images.example.com/fallback.webp' }],
        })
      );
    const onSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    service.start(createTask('task-2'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await vi.waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(1));

    expect(
      fetcher.mock.calls.map(([url]) => new URL(String(url)).host)
    ).toEqual([
      'api.tu-zi.com',
      'bus.tu-zi.com',
      'bus2.tu-zi.com',
      'bus3.tu-zi.com',
      'business.tu-zi.com',
    ]);
  });

  it('releases an error response body before switching nodes', async () => {
    const cancel = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            cancel,
          }),
          { status: 404 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          status: 'succeeded',
          data: [{ url: 'https://images.example.com/fallback.png' }],
        })
      );
    const onSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    service.start(createTask('task-release-body'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await vi.waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(1));

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('does not wait indefinitely for an error response body to cancel', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('unauthorized'));
            },
            cancel,
          }),
          { status: 401 }
        )
    );
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });

    service.start(createTask('task-cancel-body-hangs'), {
      onSucceeded: vi.fn(),
      onFailed,
    });
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('stops immediately on authentication failure', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ message: 'invalid token' }, { status: 401 })
    );
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });

    service.start(createTask('task-auth'), {
      onSucceeded: vi.fn(),
      onFailed,
    });
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'authentication',
        httpStatus: 401,
      }),
      expect.any(AbortSignal)
    );
  });

  it('keeps retrying the same recovered result after three terminal writeback failures', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () =>
      Response.json({
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/retry-writeback.png' }],
      })
    );
    const onSucceeded = vi
      .fn()
      .mockRejectedValueOnce(new Error('IndexedDB unavailable'))
      .mockRejectedValueOnce(new Error('IndexedDB still unavailable'))
      .mockRejectedValueOnce(new Error('IndexedDB transaction blocked'))
      .mockResolvedValueOnce(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      pollIntervalMs: 5,
      maxBackoffMs: 20,
      jitterRatio: 0,
    });

    service.start(createTask('task-writeback-retry'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await flushMicrotasks(20);
    expect(onSucceeded).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 + 10 + 20);
    await flushMicrotasks();

    expect(onSucceeded).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('cleans a pending terminal writeback retry when recovery is stopped', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () =>
      Response.json({
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/stopped-writeback.png' }],
      })
    );
    const onSucceeded = vi.fn().mockRejectedValue(new Error('IDB blocked'));
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      pollIntervalMs: 5,
      jitterRatio: 0,
    });

    const handle = getStartedHandle(
      service.start(createTask('task-stop-writeback'), {
        onSucceeded,
        onFailed: vi.fn(),
      })
    );
    await flushMicrotasks(20);
    expect(onSucceeded).toHaveBeenCalledTimes(1);

    handle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    await flushMicrotasks();

    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'success',
      {
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/deadline.png' }],
      },
    ],
    [
      'failure',
      {
        status: 'failed',
        error: { code: 'UPSTREAM_REJECTED', message: 'generation rejected' },
      },
    ],
  ])(
    'applies a queued terminal %s once when its retry reaches the recovery deadline',
    async (terminalType, payload) => {
      vi.useFakeTimers();
      const startedAt = 1_000;
      const deadline = startedAt + IMAGE_GENERATION_TIMEOUT_MS;
      let now = deadline - 5;
      const fetcher = vi.fn(async () => Response.json(payload));
      const onSucceeded = vi.fn();
      const onFailed = vi.fn();
      const terminalCallback =
        terminalType === 'success' ? onSucceeded : onFailed;
      terminalCallback
        .mockRejectedValueOnce(new Error('IDB unavailable'))
        .mockResolvedValueOnce(undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const service = new ImageGenerationRecoveryService({
        fetcher,
        resolveInvocationPlan: vi.fn(() => createPlan()),
        pollIntervalMs: 50,
        maxBackoffMs: 50,
        requestTimeoutMs: 100,
        jitterRatio: 0,
        now: () => now,
      });

      service.start(
        createTask(`task-terminal-${terminalType}`, undefined, startedAt),
        { onSucceeded, onFailed }
      );
      await flushMicrotasks(20);
      expect(terminalCallback).toHaveBeenCalledTimes(1);

      now = deadline;
      await vi.advanceTimersByTimeAsync(5);
      await flushMicrotasks(20);

      expect(terminalCallback).toHaveBeenCalledTimes(2);
      expect(
        terminalType === 'success' ? onFailed : onSucceeded
      ).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps an active terminal callback alive until its writeback watchdog', async () => {
    vi.useFakeTimers();
    const startedAt = 2_000;
    const deadline = startedAt + IMAGE_GENERATION_TIMEOUT_MS;
    let now = deadline - 5;
    let callbackSignal: AbortSignal | undefined;
    const fetcher = vi.fn(async () =>
      Response.json({
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/deadline-abort.png' }],
      })
    );
    const onSucceeded = vi.fn(
      (_result: unknown, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          callbackSignal = signal;
          signal.addEventListener('abort', () => setTimeout(resolve, 25), {
            once: true,
          });
        })
    );
    const errorLog = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      requestTimeoutMs: 100,
      now: () => now,
    });

    service.start(createTask('task-callback-deadline', undefined, startedAt), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await flushMicrotasks(20);
    expect(callbackSignal).toBeDefined();
    expect(service.hasPendingTerminalWriteback('task-callback-deadline')).toBe(
      true
    );

    now = deadline;
    await vi.advanceTimersByTimeAsync(5);
    await flushMicrotasks(20);

    expect(callbackSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(95);
    await flushMicrotasks(20);

    expect(callbackSignal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(25);
    await flushMicrotasks(20);

    expect(errorLog).not.toHaveBeenCalled();
    expect(onSucceeded).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(service.hasPendingTerminalWriteback('task-callback-deadline')).toBe(
      false
    );
  });

  it('queues more than the concurrency limit without dropping tasks', async () => {
    const pending: Array<(response: Response) => void> = [];
    let active = 0;
    let maxActive = 0;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          pending.push((response) => {
            active -= 1;
            resolve(response);
          });
        })
    );
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      concurrency: 4,
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    for (let index = 0; index < 24; index += 1) {
      service.start(createTask(`batch-${index}`), {
        onSucceeded: vi.fn(),
        onFailed,
      });
    }

    for (let batchIndex = 0; batchIndex < 6; batchIndex += 1) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
      const batch = pending.splice(0);
      expect(batch).toHaveLength(4);
      batch.forEach((resolve) =>
        resolve(
          Response.json({
            status: 'failed',
            error: { message: 'upstream failed' },
          })
        )
      );
      await flushMicrotasks();
    }

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledTimes(24));

    expect(fetcher).toHaveBeenCalledTimes(24);
    expect(onFailed).toHaveBeenCalledTimes(24);
    expect(maxActive).toBe(4);
  });

  it('keeps terminal image caching inside the recovery concurrency limit', async () => {
    let releaseFirstWriteback!: () => void;
    const firstWriteback = new Promise<void>((resolve) => {
      releaseFirstWriteback = resolve;
    });
    const fetcher = vi.fn(async () =>
      Response.json({
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/concurrency.png' }],
      })
    );
    const firstSucceeded = vi.fn(() => firstWriteback);
    const secondSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      concurrency: 1,
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });

    service.start(createTask('task-callback-concurrency-1'), {
      onSucceeded: firstSucceeded,
      onFailed: vi.fn(),
    });
    service.start(createTask('task-callback-concurrency-2'), {
      onSucceeded: secondSucceeded,
      onFailed: vi.fn(),
    });

    await vi.waitFor(() => expect(firstSucceeded).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(secondSucceeded).not.toHaveBeenCalled();

    releaseFirstWriteback();
    await vi.waitFor(() => expect(secondSucceeded).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('releases the recovery slot when a response body ignores abort', async () => {
    let requestCount = 0;
    const cancelBody = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"status":'));
            },
            cancel: cancelBody,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (requestCount === 2) {
        return Response.json({ status: 'processing_or_not_found' });
      }
      return Response.json({
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/after-timeout.png' }],
      });
    });
    const secondSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      concurrency: 1,
      requestTimeoutMs: 5,
      pollIntervalMs: 60_000,
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    service.start(createTask('task-stalled-response'), {
      onSucceeded: vi.fn(),
      onFailed: vi.fn(),
    });
    service.start(createTask('task-after-stalled-response'), {
      onSucceeded: secondSucceeded,
      onFailed: vi.fn(),
    });

    await vi.waitFor(() => expect(secondSucceeded).toHaveBeenCalledTimes(1));
    expect(cancelBody).toHaveBeenCalledTimes(1);
    service.stopAll();
  });

  it('releases the recovery slot when fetch ignores abort and discards its late response', async () => {
    let resolveStalledFetch!: (response: Response) => void;
    let stalled = true;
    const cancelLateBody = vi.fn();
    const fetcher = vi.fn<typeof fetch>((input) => {
      const requestId = new URL(String(input)).searchParams.get('request_id');
      if (requestId === 'task-stalled-fetch' && stalled) {
        stalled = false;
        return new Promise<Response>((resolve) => {
          resolveStalledFetch = resolve;
        });
      }
      if (requestId === 'task-stalled-fetch') {
        return Promise.resolve(
          Response.json({ status: 'processing_or_not_found' })
        );
      }
      return Promise.resolve(
        Response.json({
          status: 'succeeded',
          data: [{ url: 'https://images.example.com/after-stalled-fetch.png' }],
        })
      );
    });
    const secondSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      concurrency: 1,
      requestTimeoutMs: 5,
      pollIntervalMs: 60_000,
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    service.start(createTask('task-stalled-fetch'), {
      onSucceeded: vi.fn(),
      onFailed: vi.fn(),
    });
    service.start(createTask('task-after-stalled-fetch'), {
      onSucceeded: secondSucceeded,
      onFailed: vi.fn(),
    });

    await vi.waitFor(() => expect(secondSucceeded).toHaveBeenCalledTimes(1));
    resolveStalledFetch(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel: cancelLateBody,
        }),
        { status: 200 }
      )
    );
    await vi.waitFor(() => expect(cancelLateBody).toHaveBeenCalledTimes(1));
    service.stopAll();
  });

  it.each(['stop', 'stopAll'] as const)(
    'aborts an active terminal callback through %s',
    async (stopMethod) => {
      let callbackSignal: AbortSignal | undefined;
      const fetcher = vi.fn(async () =>
        Response.json({
          status: 'succeeded',
          data: [{ url: 'https://images.example.com/abort-cache.png' }],
        })
      );
      const onSucceeded = vi.fn(
        (_result: unknown, signal: AbortSignal) =>
          new Promise<void>((resolve) => {
            callbackSignal = signal;
            signal.addEventListener('abort', () => resolve(), { once: true });
          })
      );
      const service = new ImageGenerationRecoveryService({
        fetcher,
        resolveInvocationPlan: vi.fn(() => createPlan()),
      });
      const handle = getStartedHandle(
        service.start(createTask(`task-${stopMethod}-callback`), {
          onSucceeded,
          onFailed: vi.fn(),
        })
      );

      await vi.waitFor(() => expect(callbackSignal).toBeDefined());
      if (stopMethod === 'stop') {
        handle.stop();
      } else {
        service.stopAll();
      }

      expect(callbackSignal?.aborted).toBe(true);
      await flushMicrotasks();
    }
  );

  it.each([
    [
      'succeeded response for another request',
      {
        status: 'succeeded',
        request_id: 'another-submission',
        data: [{ url: 'https://images.example.com/wrong-request.png' }],
      },
    ],
    [
      'failed response for another request',
      {
        status: 'failed',
        requestId: 'another-submission',
        error: { message: 'wrong request failed' },
      },
    ],
    [
      'response with a blank echoed request ID',
      {
        status: 'failed',
        request_id: ' ',
        error: { message: 'blank request failed' },
      },
    ],
  ])('ignores a %s', async (_label, payload) => {
    const fetcher = vi.fn(async () => Response.json(payload));
    const onSucceeded = vi.fn();
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      pollIntervalMs: 60_000,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const handle = getStartedHandle(
      service.start(
        createTask('task-request-id-mismatch', 'expected-submission'),
        {
          onSucceeded,
          onFailed,
        }
      )
    );

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await flushMicrotasks();
    expect(onSucceeded).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    handle.stop();
  });

  it('does not call a terminal callback after the task is stopped', async () => {
    let resolveFetch!: (response: Response) => void;
    const cancelBody = vi.fn();
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const onSucceeded = vi.fn();
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });

    const handle = getStartedHandle(
      service.start(createTask('task-stop'), {
        onSucceeded,
        onFailed,
      })
    );
    handle.stop();
    resolveFetch(
      new Response(
        new ReadableStream({
          cancel: cancelBody,
        }),
        { status: 200 }
      )
    );
    await flushMicrotasks();

    expect(onSucceeded).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('uses a new per-submission Request ID while preserving the task ID', () => {
    const first = createTask('task-retry');
    const second = {
      ...first,
      params: createImageSubmissionParams(
        first.params,
        'submission-retry-2',
        false
      ),
    };

    expect(getImageSubmissionRequestId(first)).toBe('task-retry');
    expect(getImageSubmissionRequestId(second)).toBe('submission-retry-2');
    expect(second.id).toBe(first.id);
  });

  it('does not recover a new task that explicitly has no formal submission attempt', () => {
    const service = new ImageGenerationRecoveryService({
      fetcher: vi.fn(),
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = createTask('task-before-submit');
    task.params = createImageSubmissionParams(
      task.params,
      getImageSubmissionRequestId(task),
      false
    );

    expect(service.canRecover(task)).toBe(false);
    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'invalid-task'
    );
  });

  it.each([
    ['non-processing status', { status: TaskStatus.FAILED }],
    [
      'non-polling execution phase',
      { executionPhase: TaskExecutionPhase.SUBMITTING },
    ],
    ['async remote ID', { remoteId: 'remote-image-1' }],
    ['remote-synced task', { syncedFromRemote: true }],
  ])('defensively rejects %s at the service boundary', (_label, overrides) => {
    const fetcher = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = Object.assign(createTask(`task-${_label}`), overrides);

    expect(service.canRecover(task)).toBe(false);
    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'invalid-task'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not guess the task ID when the persisted Request ID is missing', () => {
    const service = new ImageGenerationRecoveryService({
      fetcher: vi.fn(),
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = createTask('legacy-task-without-request-id');
    delete task.params.submissionRequestId;

    expect(service.canRecover(task)).toBe(false);
    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'invalid-task'
    );
  });

  it('does not query or forward credentials for an untrusted provider route', () => {
    const fetcher = vi.fn();
    const plan = createPlan();
    plan.provider.baseUrl = 'https://third-party.example.com/v1';
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => plan),
    });
    const task = createTask('task-untrusted-provider');

    expect(service.canRecover(task)).toBe(false);
    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'route-unavailable'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an encrypted provider API key before preparing a query', () => {
    const fetcher = vi.fn();
    const plan = createPlan();
    plan.provider.apiKey = 'OPENTU_FB:c2VjcmV0';
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => plan),
    });
    const task = createTask('task-encrypted-api-key');

    expect(service.canRecover(task)).toBe(false);
    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'route-unavailable'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports an expired task separately from an unavailable route', () => {
    const now = IMAGE_GENERATION_TIMEOUT_MS + 50_000;
    const resolveInvocationPlan = vi.fn(() => createPlan());
    const fetcher = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan,
      now: () => now,
    });
    const task = createTask(
      'task-expired-before-start',
      undefined,
      now - IMAGE_GENERATION_TIMEOUT_MS
    );

    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'expired'
    );
    expect(resolveInvocationPlan).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a trusted custom binding mapped to a synchronous image endpoint', () => {
    const plan = createPlan();
    plan.binding.protocol = 'custom-http';
    plan.binding.requestSchema = 'custom-http';
    plan.binding.metadata = {
      manualHttp: {
        method: 'POST',
      },
    };
    const service = new ImageGenerationRecoveryService({
      fetcher: vi.fn(),
      resolveInvocationPlan: vi.fn(() => plan),
    });

    expect(
      service.canRecover(
        createTask('task-custom-sync', undefined, undefined, plan)
      )
    ).toBe(true);
  });

  it.each([
    [
      'third-party absolute submission URL',
      'https://images.example.com/v1/images/generations',
    ],
    [
      'non-CORS Tuzi absolute submission URL',
      'https://api.tu-zi.com/v1/images/generations',
    ],
  ])('rejects a custom binding using a %s', (_label, submitPath) => {
    const plan = createPlan();
    plan.binding.protocol = 'custom-http';
    plan.binding.requestSchema = 'custom-http';
    plan.binding.submitPath = submitPath;
    plan.binding.metadata = { manualHttp: { method: 'POST' } };
    const fetcher = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => plan),
    });
    const task = createTask(
      `task-custom-absolute-${_label}`,
      undefined,
      undefined,
      plan
    );

    expect(service.canRecover(task)).toBe(false);
    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'invalid-task'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a custom image body whose omitted method resolves to POST', () => {
    const plan = createPlan();
    plan.binding.protocol = 'custom-http';
    plan.binding.requestSchema = 'custom-http';
    plan.binding.metadata = {
      manualHttp: {
        bodyTemplate: '{"model":"{{model}}","prompt":"{{prompt}}"}',
      },
    };
    const service = new ImageGenerationRecoveryService({
      fetcher: vi.fn(),
      resolveInvocationPlan: vi.fn(() => plan),
    });

    expect(
      service.canRecover(
        createTask('task-custom-implicit-post', undefined, undefined, plan)
      )
    ).toBe(true);
  });

  it.each([
    ['custom polling', 'POST', '/custom/tasks/{taskId}'],
    ['non-POST custom submission', 'PUT', undefined],
  ])('rejects %s from synchronous recovery', (_label, method, pollPath) => {
    const fetcher = vi.fn();
    const plan = createPlan();
    plan.binding.protocol = 'custom-http';
    plan.binding.requestSchema = 'custom-http';
    plan.binding.pollPathTemplate = pollPath;
    plan.binding.metadata = {
      manualHttp: {
        method,
      },
    };
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => plan),
    });
    const task = createTask(
      `task-custom-${method}`,
      undefined,
      undefined,
      plan
    );

    expect(service.canRecover(task)).toBe(false);
    expectRejectedStart(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      }),
      'invalid-task'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['openai.async.media', '/videos'],
    [
      'google.generateContent',
      '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    ],
  ])('rejects non-synchronous recovery protocol %s', (protocol, submitPath) => {
    const plan = createPlan();
    plan.binding.protocol = protocol;
    plan.binding.submitPath = submitPath;
    const service = new ImageGenerationRecoveryService({
      fetcher: vi.fn(),
      resolveInvocationPlan: vi.fn(() => plan),
    });

    expect(
      service.canRecover(
        createTask(`task-${protocol}`, undefined, undefined, plan)
      )
    ).toBe(false);
  });

  it.each([
    [
      'custom polling binding',
      (plan: ReturnType<typeof createPlan>) => {
        plan.binding.protocol = 'custom-http';
        plan.binding.requestSchema = 'custom-http';
        plan.binding.pollPathTemplate = '/custom/tasks/{taskId}';
        plan.binding.metadata = { manualHttp: { method: 'POST' } };
      },
    ],
    [
      'custom PUT binding',
      (plan: ReturnType<typeof createPlan>) => {
        plan.binding.protocol = 'custom-http';
        plan.binding.requestSchema = 'custom-http';
        plan.binding.metadata = { manualHttp: { method: 'PUT' } };
      },
    ],
  ])(
    'does not let a stale %s fall through to a synchronous plan',
    (_label, mutatePersistedPlan) => {
      const persistedPlan = createPlan();
      mutatePersistedPlan(persistedPlan);
      const resolveInvocationPlan = vi.fn(
        (_operation, _modelRef, options?: { bindingId?: string }) =>
          options?.bindingId ? null : createPlan()
      );
      const service = new ImageGenerationRecoveryService({
        fetcher: vi.fn(),
        resolveInvocationPlan: resolveInvocationPlan as any,
      });
      const task = createTask(
        `task-stale-${_label}`,
        undefined,
        undefined,
        persistedPlan
      );

      expect(service.canRecover(task)).toBe(false);
      expect(resolveInvocationPlan).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'submit path',
      (plan: ReturnType<typeof createPlan>) => {
        plan.binding.submitPath = '/v1/images/generations';
      },
    ],
    [
      'base URL strategy',
      (plan: ReturnType<typeof createPlan>) => {
        plan.binding.baseUrlStrategy = 'preserve';
      },
    ],
  ])(
    'rejects a stale binding whose %s changed',
    (_label, mutateResolvedPlan) => {
      const changedPlan = createPlan();
      mutateResolvedPlan(changedPlan);
      const resolveInvocationPlan = vi.fn(
        (_operation, _modelRef, options?: { bindingId?: string }) =>
          options?.bindingId ? null : changedPlan
      );
      const service = new ImageGenerationRecoveryService({
        fetcher: vi.fn(),
        resolveInvocationPlan: resolveInvocationPlan as any,
      });

      expect(service.canRecover(createTask(`task-changed-${_label}`))).toBe(
        false
      );
    }
  );

  it('accepts the same recovered attempt after its current route becomes unavailable', () => {
    const task = createTask('task-terminal-writeback', 'submission-terminal');
    const startedAt = task.startedAt!;
    task.invocationRoute = undefined;

    expect(
      isCurrentImageRecoveryAttempt(task, 'submission-terminal', startedAt)
    ).toBe(true);
  });

  it('uses createdAt to identify a restored attempt without startedAt', () => {
    const task = createTask('task-created-at', 'submission-created-at');
    task.startedAt = undefined;

    expect(
      isCurrentImageRecoveryAttempt(
        task,
        'submission-created-at',
        task.createdAt
      )
    ).toBe(true);
  });

  it('rejects a recovered result from an older submission attempt', () => {
    const task = createTask('task-new-retry', 'submission-new');

    expect(
      isCurrentImageRecoveryAttempt(task, 'submission-old', task.startedAt!)
    ).toBe(false);
  });
});
