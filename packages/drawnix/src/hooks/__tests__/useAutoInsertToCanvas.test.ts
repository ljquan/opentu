import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAutoInsertToCanvas,
  clearInsertedTaskIds,
} from '../useAutoInsertToCanvas';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { IMAGE_GENERATION_ANCHOR_RETRY_EVENT } from '../../types/image-generation-anchor.types';

const mocks = vi.hoisted(() => {
  const taskListeners: Array<(event: any) => void> = [];
  const completionListeners: Array<(event: any) => void> = [];
  const taskState = {
    tasks: [] as any[],
  };

  return {
    board: null as any,
    taskListeners,
    completionListeners,
    taskState,
    quickInsert: vi.fn(),
    insertImageGroup: vi.fn(),
    markAsInserted: vi.fn(),
    registerTask: vi.fn(),
    startPostProcessing: vi.fn(),
    completePostProcessing: vi.fn(),
    failPostProcessing: vi.fn(),
    clearTask: vi.fn(),
    getPostProcessingStatus: vi.fn(),
    retryTask: vi.fn(),
    updateAnchor: vi.fn(),
    setNode: vi.fn(),
    notifySelectionRefresh: vi.fn(),
  };
});

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    Transforms: {
      ...actual.Transforms,
      setNode: mocks.setNode,
    },
  };
});

vi.mock('../../services/task-queue', () => {
  const taskQueueService = {
    getAllTasks: () => mocks.taskState.tasks,
    getTask: (taskId: string) =>
      mocks.taskState.tasks.find((task) => task.id === taskId),
    markAsInserted: mocks.markAsInserted,
    retryTask: mocks.retryTask,
    observeTaskUpdates: () => ({
      subscribe: (listener: (event: any) => void) => {
        mocks.taskListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = mocks.taskListeners.indexOf(listener);
            if (index >= 0) {
              mocks.taskListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  };

  return {
    getTaskQueueService: () => taskQueueService,
    taskQueueService,
  };
});

vi.mock('../../services/workflow-completion-service', () => ({
  workflowCompletionService: {
    registerTask: mocks.registerTask,
    startPostProcessing: mocks.startPostProcessing,
    completePostProcessing: mocks.completePostProcessing,
    failPostProcessing: mocks.failPostProcessing,
    clearTask: mocks.clearTask,
    getPostProcessingStatus: mocks.getPostProcessingStatus,
    isPostProcessingCompleted: vi.fn(() => true),
    observeCompletionEvents: () => ({
      subscribe: (listener: (event: any) => void) => {
        mocks.completionListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = mocks.completionListeners.indexOf(listener);
            if (index >= 0) {
              mocks.completionListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  },
}));

vi.mock('../../services/canvas-operations', () => ({
  getCanvasBoard: () => mocks.board,
  executeCanvasInsertion: vi.fn(),
  insertAIFlow: vi.fn(),
  insertImageGroup: mocks.insertImageGroup,
  parseSizeToPixels: vi.fn(() => ({ width: 512, height: 512 })),
  quickInsert: mocks.quickInsert,
}));

vi.mock('../../data/audio', () => ({
  AUDIO_CARD_DEFAULT_HEIGHT: 144,
  AUDIO_CARD_DEFAULT_WIDTH: 360,
}));

vi.mock('../../plugins/with-image-generation-anchor', () => ({
  ImageGenerationAnchorTransforms: {
    getAnchorById: vi.fn(() => null),
    getAnchorByTaskId: vi.fn(() => null),
    getAnchorByBatchSlot: vi.fn(() => null),
    getAnchorsByWorkflowId: vi.fn(() => []),
    updateAnchor: mocks.updateAnchor,
    updateGeometry: vi.fn(),
  },
}));

vi.mock('../../plugins/with-workzone', () => ({
  WorkZoneTransforms: {
    getAllWorkZones: vi.fn(() => []),
    updateWorkflow: vi.fn(),
    removeWorkZone: vi.fn(),
  },
}));

vi.mock('../../services/media-result-handler', () => ({
  isGridImageTask: vi.fn(() => false),
  isInspirationBoardTask: vi.fn(() => false),
  handleSplitAndInsertTask: vi.fn(),
}));

vi.mock('../../utils/selection-utils', () => ({
  getInsertionPointBelowBottommostElement: vi.fn(() => [100, 100]),
  notifyAISelectionContentRefresh: mocks.notifySelectionRefresh,
}));

vi.mock('../../utils/frame-insertion-utils', () => ({
  insertMediaIntoFrame: vi.fn(),
}));

function createCompletedImageTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: {
      prompt: '生成一张图',
      size: '1:1',
      autoInsertToCanvas: true,
    },
    result: {
      url: '/__aitu_cache__/image/task-1.png',
      format: 'png',
      size: 123,
    },
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
    insertedToCanvas: false,
    ...overrides,
  };
}

function emitTaskEvent(
  task: Task,
  type: 'taskUpdated' | 'taskCreated' = 'taskUpdated'
) {
  mocks.taskListeners.forEach((listener) => {
    listener({
      type,
      task,
      timestamp: Date.now(),
    });
  });
}

describe('useAutoInsertToCanvas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearInsertedTaskIds();
    mocks.board = null;
    mocks.taskListeners.length = 0;
    mocks.completionListeners.length = 0;
    mocks.taskState.tasks = [];
    mocks.quickInsert.mockReset();
    mocks.quickInsert.mockResolvedValue({
      success: true,
      data: {
        insertedCount: 1,
        items: [
          {
            type: 'image',
            point: [100, 100],
            elementId: 'image-1',
            size: { width: 512, height: 512 },
          },
        ],
        firstElementId: 'image-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 512, height: 512 },
      },
    });
    mocks.insertImageGroup.mockReset();
    mocks.insertImageGroup.mockResolvedValue({
      success: true,
      data: {
        insertedCount: 2,
        items: [
          {
            type: 'image',
            point: [100, 100],
            elementId: 'image-1',
            size: { width: 512, height: 512 },
          },
          {
            type: 'image',
            point: [632, 100],
            elementId: 'image-2',
            size: { width: 512, height: 512 },
          },
        ],
        firstElementId: 'image-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 512, height: 512 },
      },
    });
    mocks.markAsInserted.mockReset();
    mocks.registerTask.mockReset();
    mocks.startPostProcessing.mockReset();
    mocks.completePostProcessing.mockReset();
    mocks.failPostProcessing.mockReset();
    mocks.clearTask.mockReset();
    mocks.getPostProcessingStatus.mockReset();
    mocks.getPostProcessingStatus.mockReturnValue(undefined);
    mocks.retryTask.mockReset();
    mocks.updateAnchor.mockReset();
    mocks.setNode.mockReset();
    mocks.notifySelectionRefresh.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries pending completed inserts when the canvas board is not ready yet', async () => {
    const task = createCompletedImageTask();
    mocks.taskState.tasks = [task];
    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mocks.quickInsert).not.toHaveBeenCalled();

    mocks.board = { children: [] };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/task-1.png',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({
        prompt: '生成一张图',
        aiPrompt: '生成一张图',
        generationPrompt: '生成一张图',
        generationTaskId: 'task-1',
      })
    );
    expect(mocks.notifySelectionRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
  });

  it('recovers completed uninserted tasks that already exist before subscribing', async () => {
    const task = createCompletedImageTask({ id: 'task-restored' });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('binds each grouped image result to its own task metadata', async () => {
    const firstTask = createCompletedImageTask({
      id: 'task-batch-1',
      params: {
        prompt: '批量图片',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/batch-1.png',
        format: 'png',
        size: 123,
      },
    });
    const secondTask = createCompletedImageTask({
      id: 'task-batch-2',
      params: {
        prompt: '批量图片',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/batch-2.png',
        format: 'png',
        size: 123,
      },
    });
    mocks.board = {
      children: [
        {
          id: 'image-1',
          points: [
            [100, 100],
            [612, 612],
          ],
        },
        {
          id: 'image-2',
          points: [
            [632, 100],
            [1144, 612],
          ],
        },
      ],
    };
    mocks.taskState.tasks = [firstTask, secondTask];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.insertImageGroup).toHaveBeenCalledWith(
      [
        '/__aitu_cache__/image/batch-1.png',
        '/__aitu_cache__/image/batch-2.png',
      ],
      [100, 100],
      { width: 512, height: 512 }
    );
    expect(mocks.setNode).toHaveBeenNthCalledWith(
      1,
      mocks.board,
      expect.objectContaining({ generationTaskId: 'task-batch-1' }),
      [0]
    );
    expect(mocks.setNode).toHaveBeenNthCalledWith(
      2,
      mocks.board,
      expect.objectContaining({ generationTaskId: 'task-batch-2' }),
      [1]
    );
    expect(mocks.notifySelectionRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      'task-batch-1',
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      'task-batch-2',
      1,
      [632, 100],
      'image-2',
      { width: 512, height: 512 }
    );
  });

  it('replaces the bound image in place and preserves its geometry', async () => {
    const task = createCompletedImageTask({
      id: 'task-replace',
      params: {
        prompt: '夜景城市',
        size: '1:1',
        replaceElementId: 'image-target',
        targetElementId: 'image-target',
        anchorId: 'anchor-target',
        sourceTaskId: 'task-old',
      },
      result: {
        url: '/__aitu_cache__/image/replaced.png',
        format: 'png',
        size: 123,
      },
    });
    const originalElement = {
      id: 'image-target',
      type: 'image',
      url: '/__aitu_cache__/image/original.png',
      points: [
        [20, 30],
        [420, 330],
      ],
    };
    mocks.board = { children: [originalElement] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.setNode).toHaveBeenCalledWith(
      mocks.board,
      expect.objectContaining({
        url: '/__aitu_cache__/image/replaced.png',
        generationPrompt: '夜景城市',
        generationTaskId: 'task-replace',
        generationAnchorId: 'anchor-target',
      }),
      [0]
    );
    expect(mocks.setNode).toHaveBeenCalledTimes(1);
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [20, 30],
      'image-target',
      { width: 400, height: 300 }
    );
    expect(mocks.board.children).toHaveLength(1);
    expect(mocks.board.children[0]).toBe(originalElement);
  });

  it('does not insert a new image when the bound target was removed', async () => {
    const task = createCompletedImageTask({
      id: 'task-missing-target',
      params: {
        prompt: '更新目标图',
        size: '1:1',
        replaceElementId: 'missing-image',
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.setNode).not.toHaveBeenCalled();
    expect(mocks.failPostProcessing).toHaveBeenCalledWith(
      task.id,
      'Target image is no longer available'
    );
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
  });

  it('does not retry a completed task that is already marked inserted', async () => {
    const task = createCompletedImageTask({ insertedToCanvas: true });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: task.id },
        })
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
  });

  it('does not retry a completed task whose post-processing already completed', async () => {
    const task = createCompletedImageTask();
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    mocks.getPostProcessingStatus.mockReturnValue({
      taskId: task.id,
      status: 'completed',
      type: 'direct_insert',
      insertedCount: 1,
    });

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: task.id },
        })
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
  });

  it('does not clear post-processing when retry is requested for an active task', async () => {
    const task: Task = {
      ...createCompletedImageTask(),
      id: 'task-active',
      status: TaskStatus.PROCESSING,
      completedAt: undefined,
      result: undefined,
      insertedToCanvas: false,
    };
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: task.id, anchorId: 'anchor-active' },
        })
      );
    });

    expect(mocks.retryTask).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      'anchor-active',
      expect.objectContaining({
        phase: 'queued',
        subtitle: '任务仍在执行，请稍候',
      })
    );
  });

  it('regenerates a completed task when generation anchor retry follows failed post-processing', async () => {
    const task = createCompletedImageTask({
      id: 'task-post-processing-failed',
      params: {
        prompt: '重新生成一张图',
        size: '1:1',
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    mocks.getPostProcessingStatus.mockReturnValue({
      taskId: task.id,
      status: 'failed',
      type: 'direct_insert',
      error: 'Failed to fetch',
    });

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: {
            taskId: task.id,
            anchorId: 'anchor-post-processing-failed',
          },
        })
      );
    });

    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      'anchor-post-processing-failed',
      expect.objectContaining({
        phase: 'queued',
        subtitle: '正在重新触发，请稍候',
      })
    );
    expect(mocks.clearTask).toHaveBeenCalledWith(task.id);
    expect(mocks.retryTask).toHaveBeenCalledWith(task.id, {
      allowCompleted: true,
    });
    expect(mocks.quickInsert).not.toHaveBeenCalled();
  });

  it('keeps the failed state visible when retry task has been removed', async () => {
    mocks.board = { children: [] };
    mocks.taskState.tasks = [];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: 'missing-task', anchorId: 'anchor-missing' },
        })
      );
    });

    expect(mocks.retryTask).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      'anchor-missing',
      expect.objectContaining({
        phase: 'failed',
        error: '任务已丢失，无法重试',
      })
    );
  });
});
