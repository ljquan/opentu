// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
  type TaskInvocationBindingSnapshot,
} from '../../types/task.types';

const mocks = vi.hoisted(() => ({
  storedTasks: [] as Task[],
  restoreTasks: vi.fn(),
  updateTaskStatus: vi.fn(),
  markImageAttemptRecovering: vi.fn(),
  failImageAttempt: vi.fn(),
  isTaskExecutionActive: vi.fn(() => false),
  taskExecutionToken: Symbol('restored-task-execution') as symbol,
  getTaskExecutionToken: vi.fn(),
  waitForInitialization: vi.fn(async () => undefined),
  resolveInvocationPlanFromRoute: vi.fn(),
  prepareRequest: vi.fn(),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    restoreTasks: mocks.restoreTasks,
    isTaskExecutionActive: mocks.isTaskExecutionActive,
    getTaskExecutionToken: mocks.getTaskExecutionToken,
  },
  legacyTaskQueueService: {
    updateTaskStatus: mocks.updateTaskStatus,
    markImageAttemptRecovering: mocks.markImageAttemptRecovering,
    failImageAttempt: mocks.failImageAttempt,
  },
}));

vi.mock('../../services/task-storage-reader', () => ({
  taskStorageReader: {
    getAllTasks: vi.fn(async () => mocks.storedTasks),
  },
}));

vi.mock('../../services/app-database', () => ({
  migrateFromLegacyDB: vi.fn(async () => undefined),
}));

vi.mock('../../utils/task-utils', () => ({
  isResumableAsyncImageTask: vi.fn(() => false),
}));

vi.mock('../../utils/settings-manager', () => ({
  settingsManager: {
    waitForInitialization: mocks.waitForInitialization,
  },
  createModelRef: (profileId?: string | null, modelId?: string | null) =>
    profileId || modelId
      ? {
          profileId: profileId || null,
          modelId: modelId || null,
        }
      : null,
}));

vi.mock('../../services/provider-routing', () => ({
  resolveInvocationPlanFromRoute: mocks.resolveInvocationPlanFromRoute,
  providerTransport: {
    prepareRequest: mocks.prepareRequest,
  },
}));

function createBinding(
  overrides: Partial<TaskInvocationBindingSnapshot> = {}
): TaskInvocationBindingSnapshot {
  return {
    id: 'tuzi-sync-image',
    protocol: 'openai.images.generations',
    submitPath: '/images/generations',
    baseUrlStrategy: 'ensure-v1',
    ...overrides,
  };
}

function createImageTask(
  status: TaskStatus,
  attempted?: boolean,
  requestId?: string,
  binding = createBinding(),
  taskId = 'image-task-1'
): Task {
  return {
    id: taskId,
    type: TaskType.IMAGE,
    status,
    params: {
      prompt: '画一只兔子',
      model: 'gpt-image-2',
      ...(requestId === undefined ? {} : { submissionRequestId: requestId }),
      ...(attempted === undefined
        ? {}
        : { imageSubmissionAttempted: attempted }),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    executionPhase: TaskExecutionPhase.SUBMITTING,
    invocationRoute: {
      operation: 'image',
      providerProfileId: 'tuzi-profile',
      modelId: 'gpt-image-2',
      binding,
    },
  };
}

function createPptExplainerTask(
  stage:
    | 'preparing'
    | 'snapshotting'
    | 'scripting'
    | 'submitting'
    | 'polling'
    | 'finalizing',
  remoteId?: string
): Task {
  return {
    id: `ppt-explainer-${stage}`,
    type: TaskType.VIDEO,
    status: TaskStatus.PROCESSING,
    params: {
      prompt: 'PPT 讲解视频',
      pptExplainer: {
        schemaVersion: 1,
        stage,
        remoteId,
      },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    remoteId,
    executionPhase: remoteId
      ? TaskExecutionPhase.POLLING
      : TaskExecutionPhase.SUBMITTING,
  };
}

describe('useTaskStorage image request recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.restoreTasks.mockReset();
    mocks.updateTaskStatus.mockReset();
    mocks.markImageAttemptRecovering.mockReset().mockResolvedValue(true);
    mocks.failImageAttempt.mockReset().mockResolvedValue(true);
    mocks.isTaskExecutionActive.mockReset().mockReturnValue(false);
    mocks.taskExecutionToken = Symbol('restored-task-execution');
    mocks.getTaskExecutionToken
      .mockReset()
      .mockImplementation(() => mocks.taskExecutionToken);
    mocks.waitForInitialization.mockReset().mockResolvedValue(undefined);
    mocks.resolveInvocationPlanFromRoute.mockReset();
    mocks.prepareRequest.mockReset();
    mocks.storedTasks = [];
  });

  it('does not treat an in-page active request as a refreshed task', async () => {
    mocks.isTaskExecutionActive.mockReturnValue(true);
    mocks.storedTasks = [
      createImageTask(TaskStatus.PROCESSING, true, 'submission-live'),
    ];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('restores unrelated task state while image recovery waits for decrypted settings', async () => {
    let finishInitialization!: () => void;
    mocks.waitForInitialization.mockReturnValue(
      new Promise<void>((resolve) => {
        finishInitialization = resolve;
      })
    );
    mocks.storedTasks = [
      createImageTask(TaskStatus.PROCESSING, true, 'submission-after-init'),
    ];
    const originalStartedAt = mocks.storedTasks[0].startedAt;
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() =>
      expect(mocks.waitForInitialization).toHaveBeenCalledTimes(1)
    );
    expect(result.current).toBe(true);
    expect(mocks.restoreTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'image-task-1',
        startedAt: originalStartedAt,
        executionPhase: TaskExecutionPhase.SUBMITTING,
      }),
    ]);
    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();

    finishInitialization();
    await waitFor(() =>
      expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
        'image-task-1',
        'submission-after-init',
        {
          startedAt: originalStartedAt,
          executionToken: mocks.taskExecutionToken,
        }
      )
    );
  });

  it('keeps a persisted polling task hidden until settings are decrypted', async () => {
    let finishInitialization!: () => void;
    mocks.waitForInitialization.mockReturnValue(
      new Promise<void>((resolve) => {
        finishInitialization = resolve;
      })
    );
    const pollingTask = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-polling'
    );
    pollingTask.executionPhase = TaskExecutionPhase.POLLING;
    mocks.storedTasks = [pollingTask];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() =>
      expect(mocks.waitForInitialization).toHaveBeenCalledTimes(1)
    );
    expect(result.current).toBe(true);
    expect(mocks.restoreTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'image-task-1',
        startedAt: pollingTask.startedAt,
        executionPhase: TaskExecutionPhase.SUBMITTING,
      }),
    ]);
    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();

    finishInitialization();
    await waitFor(() =>
      expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
        'image-task-1',
        'submission-polling',
        {
          startedAt: pollingTask.startedAt,
          executionToken: mocks.taskExecutionToken,
        }
      )
    );
  });

  it('fails an expired recovery task even when settings initialization never settles', async () => {
    mocks.waitForInitialization.mockReturnValue(new Promise<void>(() => {}));
    const expiredTask = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-settings-stuck'
    );
    expiredTask.startedAt = Date.now() - 16 * 60_000;
    mocks.storedTasks = [expiredTask];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));
    await waitFor(() =>
      expect(mocks.failImageAttempt).toHaveBeenCalledWith(
        'image-task-1',
        'submission-settings-stuck',
        expect.objectContaining({ code: 'RECOVERY_TIMEOUT' }),
        {
          executionGuard: {
            startedAt: expiredTask.startedAt,
            executionToken: mocks.taskExecutionToken,
          },
        }
      )
    );
    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
  });

  it('fails a deferred recovery task when settings initialization rejects', async () => {
    let rejectInitialization!: (error: Error) => void;
    mocks.waitForInitialization.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectInitialization = reject;
      })
    );
    const task = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-settings-rejected'
    );
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));
    rejectInitialization(new Error('settings unavailable'));

    await waitFor(() =>
      expect(mocks.failImageAttempt).toHaveBeenCalledWith(
        task.id,
        'submission-settings-rejected',
        expect.objectContaining({ code: 'RECOVERY_ROUTE_UNAVAILABLE' }),
        {
          executionGuard: {
            startedAt: task.startedAt,
            executionToken: mocks.taskExecutionToken,
          },
        }
      )
    );
    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
  });

  it('does not recover a refreshed task that never submitted its POST', async () => {
    mocks.storedTasks = [createImageTask(TaskStatus.PROCESSING, false)];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      'image-task-1',
      TaskStatus.FAILED,
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INTERRUPTED' }),
      })
    );
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'snapshotting', 'scripting', 'submitting'] as const)(
    'keeps a refreshed PPT explainer in the dedicated %s recovery path before remote submission',
    async (stage) => {
      const task = createPptExplainerTask(stage);
      mocks.storedTasks = [task];
      const { useTaskStorage } = await import('../useTaskStorage');
      const { result } = renderHook(() => useTaskStorage());

      await waitFor(() => expect(result.current).toBe(true));

      expect(mocks.restoreTasks).toHaveBeenCalledWith([task]);
      expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
      expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    }
  );

  it.each(['polling', 'finalizing'] as const)(
    'keeps a refreshed PPT explainer with remoteId in the dedicated %s recovery path',
    async (stage) => {
      const task = createPptExplainerTask(stage, 'ppt-remote-1');
      mocks.storedTasks = [task];
      const { useTaskStorage } = await import('../useTaskStorage');
      const { result } = renderHook(() => useTaskStorage());

      await waitFor(() => expect(result.current).toBe(true));

      expect(mocks.restoreTasks).toHaveBeenCalledWith([task]);
      expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
      expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    }
  );

  it('continues restoring later tasks after individual persistence failures', async () => {
    const asyncBinding = createBinding({
      protocol: 'openai.async.media',
      submitPath: '/videos',
    });
    mocks.storedTasks = [
      createImageTask(
        TaskStatus.PROCESSING,
        true,
        'submission-recovery-fails',
        createBinding(),
        'image-task-recovery-fails'
      ),
      createImageTask(
        TaskStatus.PROCESSING,
        true,
        'submission-failure-fails',
        asyncBinding,
        'image-task-failure-fails'
      ),
      createImageTask(
        TaskStatus.PROCESSING,
        true,
        'submission-later',
        createBinding(),
        'image-task-later'
      ),
    ];
    mocks.markImageAttemptRecovering.mockImplementation(async (taskId) => {
      if (taskId === 'image-task-recovery-fails') {
        throw new Error('recovery persistence unavailable');
      }
      return true;
    });
    mocks.failImageAttempt.mockRejectedValueOnce(
      new Error('failure persistence unavailable')
    );

    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-recovery-fails',
      'submission-recovery-fails',
      expect.objectContaining({ executionToken: mocks.taskExecutionToken })
    );
    expect(mocks.failImageAttempt).toHaveBeenCalledWith(
      'image-task-failure-fails',
      'submission-failure-fails',
      expect.objectContaining({ code: 'INTERRUPTED' }),
      { clearStartedAt: true }
    );
    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-later',
      'submission-later',
      expect.objectContaining({ executionToken: mocks.taskExecutionToken })
    );
  });

  it.each([
    ['generation', createBinding(), 'submission-generation'],
    [
      'edit',
      createBinding({
        id: 'tuzi-sync-edit',
        protocol: 'openai.images.edits',
        submitPath: '/images/edits',
      }),
      'submission-edit',
    ],
    [
      'custom HTTP implicit POST',
      createBinding({
        id: 'tuzi-custom-image',
        protocol: 'custom-http',
        metadata: {
          manualHttp: {
            bodyType: 'json',
            bodyTemplate: '{"prompt":"{{prompt}}"}',
          },
        },
      }),
      'submission-custom',
    ],
  ])(
    'resumes a persisted synchronous %s request',
    async (_label, binding, requestId) => {
      mocks.storedTasks = [
        createImageTask(TaskStatus.PROCESSING, true, requestId, binding),
      ];
      const { useTaskStorage } = await import('../useTaskStorage');
      const { result } = renderHook(() => useTaskStorage());

      await waitFor(() => expect(result.current).toBe(true));

      expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
        'image-task-1',
        requestId,
        expect.objectContaining({ executionToken: mocks.taskExecutionToken })
      );
      expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'async image endpoint',
      createBinding({
        protocol: 'openai.async.media',
        submitPath: '/videos',
      }),
    ],
    [
      'Gemini generateContent',
      createBinding({
        protocol: 'google.generateContent',
        submitPath: '/v1beta/models/gemini-3-pro-image-preview:generateContent',
      }),
    ],
    [
      'custom polling endpoint',
      createBinding({
        protocol: 'custom-http',
        pollPathTemplate: '/tasks/{taskId}',
        metadata: {
          manualHttp: { method: 'POST', bodyTemplate: '{}' },
        },
      }),
    ],
    [
      'custom PUT endpoint',
      createBinding({
        protocol: 'custom-http',
        metadata: {
          manualHttp: { method: 'PUT', bodyTemplate: '{}' },
        },
      }),
    ],
  ])('rejects a refreshed %s task', async (_label, binding) => {
    mocks.storedTasks = [
      createImageTask(
        TaskStatus.PROCESSING,
        true,
        'submission-rejected',
        binding
      ),
    ];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).toHaveBeenCalledWith(
      'image-task-1',
      'submission-rejected',
      expect.objectContaining({ code: 'INTERRUPTED' }),
      { clearStartedAt: true }
    );
  });

  it('keeps an expired synchronous candidate for the executor to time out', async () => {
    const expiredTask = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-expired'
    );
    expiredTask.startedAt = Date.now() - 16 * 60_000;
    mocks.storedTasks = [expiredTask];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).toHaveBeenCalledWith(
      'image-task-1',
      'submission-expired',
      expect.objectContaining({ executionToken: mocks.taskExecutionToken })
    );
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
  });

  it('does not guess the task ID for legacy image submissions', async () => {
    mocks.storedTasks = [createImageTask(TaskStatus.PROCESSING, true)];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      'image-task-1',
      TaskStatus.FAILED,
      expect.any(Object)
    );
  });

  it('does not recover a task without a persisted submission phase', async () => {
    const task = createImageTask(
      TaskStatus.PROCESSING,
      true,
      'submission-without-phase'
    );
    task.executionPhase = undefined;
    mocks.storedTasks = [task];
    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await waitFor(() => expect(result.current).toBe(true));

    expect(mocks.markImageAttemptRecovering).not.toHaveBeenCalled();
    expect(mocks.failImageAttempt).toHaveBeenCalledWith(
      'image-task-1',
      'submission-without-phase',
      expect.objectContaining({ code: 'INTERRUPTED' }),
      { clearStartedAt: true }
    );
  });
});
