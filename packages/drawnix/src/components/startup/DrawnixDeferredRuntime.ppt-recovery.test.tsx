// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskStatus,
  TaskType,
  type Task,
  type TaskEvent,
} from '../../types/task.types';

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  taskListener: undefined as ((event: TaskEvent) => void) | undefined,
  resumePendingTasks: vi.fn(async () => undefined),
  cancelPendingTask: vi.fn(),
  cancelAllPendingTaskRecoveries: vi.fn(),
  observeTaskUpdates: vi.fn(),
}));

vi.mock('../../hooks/useTaskStorage', () => ({
  useTaskStorage: () => true,
}));
vi.mock('../../hooks/useTaskExecutor', () => ({
  useTaskExecutor: vi.fn(),
}));
vi.mock('../../hooks/useAutoInsertToCanvas', () => ({
  useAutoInsertToCanvas: vi.fn(),
}));
vi.mock('../../hooks/useImageGenerationAnchorSync', () => ({
  useImageGenerationAnchorSync: vi.fn(),
}));
vi.mock('../../hooks/useBeforeUnload', () => ({
  useBeforeUnload: vi.fn(),
}));
vi.mock('../../hooks/use-provider-profiles', () => ({
  useProviderProfiles: () => [],
}));
vi.mock('../../services/asset-integration-service', () => ({
  initializeAssetIntegration: vi.fn(() => () => undefined),
}));
vi.mock('../../services/font-manager-service', () => ({
  fontManagerService: { preloadBoardFonts: vi.fn(async () => undefined) },
}));
vi.mock('../../utils/model-pricing-service', () => ({
  modelPricingService: { warmupProfiles: vi.fn() },
}));
vi.mock('../../hooks/useWorkflowSubmission', () => ({
  workflowRecoveryPromise: Promise.resolve(),
}));
vi.mock('../../services/media-executor/fallback-executor', () => ({
  fallbackMediaExecutor: {
    resumePendingTasks: mocks.resumePendingTasks,
    cancelPendingTask: mocks.cancelPendingTask,
    cancelAllPendingTaskRecoveries: mocks.cancelAllPendingTaskRecoveries,
  },
}));
vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    getAllTasks: () => mocks.tasks,
    observeTaskUpdates: mocks.observeTaskUpdates,
    updateTaskStatus: vi.fn(),
    getTaskExecutionToken: vi.fn(() => Symbol('task-token')),
    isTaskExecutionTokenCurrent: vi.fn(() => true),
  },
}));

function createVideoTask(
  id: string,
  options: { pptExplainer?: boolean; remoteId?: string } = {}
): Task {
  return {
    id,
    type: TaskType.VIDEO,
    status: TaskStatus.PROCESSING,
    params: {
      prompt: id,
      ...(options.pptExplainer
        ? { pptExplainer: { schemaVersion: 1, stage: 'polling' } }
        : {}),
    },
    createdAt: 1,
    updatedAt: 1,
    remoteId: options.remoteId,
  };
}

describe('DrawnixDeferredRuntime PPT recovery routing', () => {
  beforeEach(() => {
    mocks.tasks = [
      createVideoTask('ppt-without-remote', { pptExplainer: true }),
      createVideoTask('ppt-with-remote', {
        pptExplainer: true,
        remoteId: 'ppt-remote',
      }),
      createVideoTask('generic-with-remote', { remoteId: 'generic-remote' }),
    ];
    mocks.taskListener = undefined;
    mocks.resumePendingTasks.mockClear();
    mocks.cancelPendingTask.mockClear();
    mocks.cancelAllPendingTaskRecoveries.mockClear();
    mocks.observeTaskUpdates.mockReset().mockImplementation(() => ({
      subscribe: (listener: (event: TaskEvent) => void) => {
        mocks.taskListener = listener;
        return { unsubscribe: vi.fn() };
      },
    }));
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (callback: () => void) => {
        queueMicrotask(callback);
        return 1;
      },
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps both PPT stages out of generic recovery on startup and updates', async () => {
    const { DrawnixDeferredRuntime } = await import('./DrawnixDeferredRuntime');
    render(<DrawnixDeferredRuntime board={null} value={[]} />);

    await waitFor(() =>
      expect(mocks.resumePendingTasks).toHaveBeenCalledTimes(1)
    );
    expect(mocks.resumePendingTasks.mock.calls[0]?.[1]).toEqual([
      mocks.tasks[2],
    ]);

    const pptWithoutRemote = mocks.tasks[0];
    const pptWithRemote = mocks.tasks[1];
    const genericWithRemote = mocks.tasks[2];
    act(() => {
      mocks.taskListener?.({
        type: 'taskCreated',
        task: pptWithoutRemote,
        timestamp: Date.now(),
      });
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: pptWithRemote,
        timestamp: Date.now(),
      });
      mocks.taskListener?.({
        type: 'taskDeleted',
        task: pptWithRemote,
        timestamp: Date.now(),
      });
    });

    await waitFor(() =>
      expect(mocks.resumePendingTasks).toHaveBeenCalledTimes(1)
    );
    expect(mocks.cancelPendingTask).not.toHaveBeenCalled();

    act(() => {
      mocks.taskListener?.({
        type: 'taskUpdated',
        task: genericWithRemote,
        timestamp: Date.now(),
      });
    });
    await waitFor(() =>
      expect(mocks.resumePendingTasks).toHaveBeenCalledTimes(2)
    );
    expect(mocks.resumePendingTasks.mock.calls[1]?.[1]).toEqual([
      genericWithRemote,
    ]);
  });
});
