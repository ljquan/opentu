import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import {
  ImageGenerationRecoveryService,
  IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM,
  createImageSubmissionParams,
  getImageSubmissionRequestId,
  isAmbiguousImageSubmissionError,
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

function createTask(id: string, requestId = id, startedAt = Date.now()): Task {
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
        id: 'tuzi-sync-image',
        protocol: 'openai.images.generations',
        requestSchema: 'tuzi.image.gpt-generation-json',
      },
    },
  };
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

describe('image generation recovery service', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
      })
    );
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

  it('continues after one node reports processing and finds a later success', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: 'processing_or_not_found', data: [] })
      )
      .mockResolvedValueOnce(
        Response.json({
          status: 'succeeded',
          data: [{ url: 'https://images.example.com/later-node.png' }],
        })
      );
    const onSucceeded = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      jitterRatio: 0,
    });

    service.start(createTask('task-later-node'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await vi.waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(1));

    expect(
      fetcher.mock.calls.map(([url]) => new URL(String(url)).host)
    ).toEqual(['api.tu-zi.com', 'bus.tu-zi.com']);
    expect(onSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://images.example.com/later-node.png',
      })
    );
  });

  it('does not let fallback-node authentication failures override primary processing', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ status: 'processing_or_not_found', data: [] })
      )
      .mockResolvedValue(
        Response.json({ message: 'invalid on fallback' }, { status: 401 })
      );
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      pollIntervalMs: 60_000,
      jitterRatio: 0,
    });

    service.start(createTask('task-primary-processing'), {
      onSucceeded: vi.fn(),
      onFailed,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));

    expect(onFailed).not.toHaveBeenCalled();
    service.stopAll();
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
      })
    );
  });

  it('retries a recovered result when the first terminal writeback rejects', async () => {
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
      .mockResolvedValueOnce(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      pollIntervalMs: 5,
      jitterRatio: 0,
    });

    service.start(createTask('task-writeback-retry'), {
      onSucceeded,
      onFailed: vi.fn(),
    });
    await flushMicrotasks();
    expect(onSucceeded).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5);
    await flushMicrotasks();

    expect(onSucceeded).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
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

  it('does not call a terminal callback after the task is stopped', async () => {
    let resolveFetch!: (response: Response) => void;
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

    const handle = service.start(createTask('task-stop'), {
      onSucceeded,
      onFailed,
    });
    handle?.stop();
    resolveFetch(
      Response.json({
        status: 'succeeded',
        data: [{ url: 'https://images.example.com/late.png' }],
      })
    );
    await flushMicrotasks();

    expect(onSucceeded).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
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
    expect(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      })
    ).toBeNull();
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
    expect(
      service.start(task, {
        onSucceeded: vi.fn(),
        onFailed: vi.fn(),
      })
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies only ambiguous post-submission failures as recoverable', () => {
    expect(isAmbiguousImageSubmissionError(new Error('Failed to fetch'))).toBe(
      true
    );
    expect(
      isAmbiguousImageSubmissionError(
        Object.assign(new Error('gateway timeout'), { httpStatus: 504 })
      )
    ).toBe(true);
    expect(
      isAmbiguousImageSubmissionError(
        Object.assign(new Error('internal server error'), { httpStatus: 500 })
      )
    ).toBe(true);
    expect(
      isAmbiguousImageSubmissionError(
        Object.assign(new Error('invalid token'), { httpStatus: 401 })
      )
    ).toBe(false);
    expect(isAmbiguousImageSubmissionError(new Error('参考图格式无效'))).toBe(
      false
    );
  });

  it('fails with recovery timeout without resetting the original task budget', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const fetcher = vi.fn(async () =>
      Response.json({ status: 'processing_or_not_found', data: [] })
    );
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      pollIntervalMs: 5,
      jitterRatio: 0,
    });
    const startedAt = now - IMAGE_GENERATION_TIMEOUT_MS + 10;

    service.start(createTask('task-timeout', 'task-timeout', startedAt), {
      onSucceeded: vi.fn(),
      onFailed,
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(11);

    expect(onFailed).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RECOVERY_TIMEOUT' })
    );
  });

  it('allows a recent timeout task to enter extended read-only recovery', () => {
    const now = Date.now();
    const service = new ImageGenerationRecoveryService({
      now: () => now,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = createTask(
      'task-timeout-compensation',
      'submission-timeout-compensation',
      now - IMAGE_GENERATION_TIMEOUT_MS - 1
    );
    task.status = TaskStatus.FAILED;
    task.completedAt = now - 1_000;
    task.error = { code: 'TIMEOUT', message: '任务执行超时' };
    task.executionPhase = undefined;

    expect(service.canRecover(task)).toBe(false);
    expect(service.canRecoverTimedOut(task)).toBe(true);

    task.params[IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM] = now;
    expect(service.canRecoverTimedOut(task)).toBe(true);
  });

  it('allows an expired processing task to enter extended recovery', () => {
    const now = Date.now();
    const service = new ImageGenerationRecoveryService({
      now: () => now,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = createTask(
      'task-expired-processing',
      'submission-expired-processing',
      now - IMAGE_GENERATION_TIMEOUT_MS - 1
    );

    expect(service.canRecover(task)).toBe(false);
    expect(service.canRecoverTimedOut(task)).toBe(true);
  });

  it('does not compensate a timeout older than 24 hours', () => {
    const now = Date.now();
    const service = new ImageGenerationRecoveryService({
      now: () => now,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = createTask(
      'task-old-timeout',
      'submission-old-timeout',
      now - IMAGE_GENERATION_TIMEOUT_MS - 1
    );
    task.status = TaskStatus.FAILED;
    task.completedAt = now - 24 * 60 * 60 * 1000 - 1;
    task.error = { code: 'RECOVERY_TIMEOUT', message: '暂未查询到上游结果' };
    task.executionPhase = undefined;

    expect(service.canRecoverTimedOut(task)).toBe(false);
  });

  it('resumes an old one-shot miss while its persisted recovery window is active', () => {
    const now = Date.now();
    const service = new ImageGenerationRecoveryService({
      now: () => now,
      timeoutRecoveryWindowMs: 60_000,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = createTask(
      'task-old-one-shot',
      'submission-old-one-shot',
      now - IMAGE_GENERATION_TIMEOUT_MS - 1
    );
    task.status = TaskStatus.FAILED;
    task.completedAt = now - 1_000;
    task.error = { code: 'RECOVERY_TIMEOUT', message: '暂未查询到上游结果' };
    task.executionPhase = undefined;
    task.params[IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM] = now - 5_000;

    expect(service.canRecoverTimedOut(task)).toBe(true);
  });

  it('does not resume an expired persisted recovery window', () => {
    const now = Date.now();
    const service = new ImageGenerationRecoveryService({
      now: () => now,
      timeoutRecoveryWindowMs: 60_000,
      resolveInvocationPlan: vi.fn(() => createPlan()),
    });
    const task = createTask(
      'task-expired-recovery',
      'submission-expired-recovery',
      now - IMAGE_GENERATION_TIMEOUT_MS - 1
    );
    task.status = TaskStatus.FAILED;
    task.completedAt = now - 1_000;
    task.error = { code: 'RECOVERY_TIMEOUT', message: '暂未查询到上游结果' };
    task.executionPhase = undefined;
    task.params[IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM] = now - 60_001;

    expect(service.canRecoverTimedOut(task)).toBe(false);
  });

  it('keeps polling after an extended recovery miss and stops at its deadline', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const fetcher = vi.fn(async () =>
      Response.json({ status: 'processing_or_not_found', data: [] })
    );
    const onFailed = vi.fn();
    const service = new ImageGenerationRecoveryService({
      fetcher,
      resolveInvocationPlan: vi.fn(() => createPlan()),
      pollIntervalMs: 5,
      maxBackoffMs: 10,
      timeoutRecoveryWindowMs: 25,
      jitterRatio: 0,
    });
    const task = createTask(
      'task-extended-timeout',
      'submission-extended-timeout',
      now - IMAGE_GENERATION_TIMEOUT_MS - 1
    );
    task.params[IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM] = now;

    service.start(task, {
      onSucceeded: vi.fn(),
      onFailed,
    });
    await flushMicrotasks(20);

    const firstRoundQueryCount = fetcher.mock.calls.length;
    expect(firstRoundQueryCount).toBeGreaterThan(0);
    expect(onFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    await flushMicrotasks(20);
    expect(fetcher.mock.calls.length).toBeGreaterThan(firstRoundQueryCount);
    expect(onFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15);
    await flushMicrotasks(20);
    expect(onFailed).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RECOVERY_TIMEOUT' })
    );
  });

  it('clears the timeout compensation marker when creating a new submission attempt', () => {
    const params = createImageSubmissionParams(
      {
        prompt: '兔子',
        [IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM]: Date.now(),
      },
      'new-submission',
      false
    );

    expect(params[IMAGE_TIMEOUT_RECOVERY_ATTEMPTED_AT_PARAM]).toBeUndefined();
    expect(getImageSubmissionRequestId({ id: 'task-1', params })).toBe(
      'new-submission'
    );
  });
});
