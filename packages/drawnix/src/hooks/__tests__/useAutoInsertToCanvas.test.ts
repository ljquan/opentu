import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAutoInsertToCanvas,
  clearInsertedTaskIds,
} from '../useAutoInsertToCanvas';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { IMAGE_GENERATION_ANCHOR_RETRY_EVENT } from '../../types/image-generation-anchor.types';
import { STORAGE_LIMITS } from '../../constants/TASK_CONSTANTS';

const mocks = vi.hoisted(() => {
  const taskListeners: Array<(event: any) => void> = [];
  const completionListeners: Array<(event: any) => void> = [];
  const workspaceListeners: Array<(event: any) => void> = [];
  const taskState = {
    tasks: [] as any[],
  };

  return {
    board: null as any,
    taskListeners,
    completionListeners,
    workspaceListeners,
    taskState,
    quickInsert: vi.fn(),
    executeCanvasInsertion: vi.fn(),
    insertGeneratedImageFlow: vi.fn(),
    insertAIFlow: vi.fn(),
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
    removeNode: vi.fn(),
    notifyAISelectionContentRefresh: vi.fn(),
    prepareSemanticForegroundReplacement: vi.fn(),
    postprocessGeneratedImage: vi.fn(),
    retargetCanvasAssociationLines: vi.fn(),
    imageAnchorByTask: null as any,
    isGridImageTask: vi.fn(),
    isInspirationBoardTask: vi.fn(),
    handleSplitAndInsertTask: vi.fn(),
    splitAndInsertImages: vi.fn(),
    currentBoardId: 'board-1' as string | null,
    boundBoardId: 'board-1' as string | null,
    boundTargetFollowEnabled: true,
    readBoundTargetFollowEnabled: vi.fn(),
    getInsertionPointBelowBottommostElement: vi.fn(() => [100, 100]),
  };
});

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    PlaitHistoryBoard: {
      ...actual.PlaitHistoryBoard,
      withNewBatch: (_board: any, callback: () => void) => callback(),
    },
    Transforms: {
      ...actual.Transforms,
      setNode: mocks.setNode,
      removeNode: mocks.removeNode,
    },
  };
});

vi.mock('../../services/layer-decomposition', () => ({
  calculateLayerCanvasBounds: () => ({
    x: 30,
    y: 40,
    width: 200,
    height: 250,
  }),
  getSemanticLayerElementPoints: (bounds: any) => [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
  ],
  getSemanticLayerMetadata: (element: any) =>
    element?.metadata?.semanticLayer || null,
  prepareSemanticForegroundReplacement:
    mocks.prepareSemanticForegroundReplacement,
}));

vi.mock('../../services/layer-decomposition/artifact-repair', () => ({
  postprocessGeneratedImage: mocks.postprocessGeneratedImage,
}));

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
  getCanvasBoardBinding: () =>
    mocks.board ? { board: mocks.board, boardId: mocks.boundBoardId } : null,
  executeCanvasInsertion: mocks.executeCanvasInsertion,
  insertGeneratedImageFlow: mocks.insertGeneratedImageFlow,
  insertAIFlow: mocks.insertAIFlow,
  insertImageGroup: mocks.insertImageGroup,
  parseSizeToPixels: vi.fn(() => ({ width: 512, height: 512 })),
  quickInsert: mocks.quickInsert,
}));

vi.mock('../../plugins/canvas-association', () => ({
  canInsertCanvasAssociationsOnBoard: (
    associations: Array<{ boardId: string }>,
    currentBoardId: string | null
  ) => {
    if (associations.length === 0) return true;
    const boardIds = new Set(
      associations.map((association) => association.boardId.trim())
    );
    return boardIds.size === 1 && boardIds.has(currentBoardId || '');
  },
  retargetCanvasAssociationLines: mocks.retargetCanvasAssociationLines,
}));

vi.mock('../../services/workspace-service', () => ({
  workspaceService: {
    getState: () => ({ currentBoardId: mocks.currentBoardId }),
    observeEvents: () => ({
      subscribe: (listener: (event: any) => void) => {
        mocks.workspaceListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = mocks.workspaceListeners.indexOf(listener);
            if (index >= 0) {
              mocks.workspaceListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  },
}));

vi.mock('../../data/audio', () => ({
  AUDIO_CARD_DEFAULT_HEIGHT: 144,
  AUDIO_CARD_DEFAULT_WIDTH: 360,
  buildAudioImageElement: vi.fn(),
}));

vi.mock('../../plugins/with-image-generation-anchor', () => ({
  ImageGenerationAnchorTransforms: {
    getAnchorById: vi.fn(() => null),
    getAnchorByTaskId: vi.fn(() => mocks.imageAnchorByTask),
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
  isGridImageTask: mocks.isGridImageTask,
  isInspirationBoardTask: mocks.isInspirationBoardTask,
  handleSplitAndInsertTask: mocks.handleSplitAndInsertTask,
}));

vi.mock('../../utils/image-splitter', () => ({
  splitAndInsertImages: mocks.splitAndInsertImages,
}));

vi.mock('../../utils/selection-utils', () => ({
  getInsertionPointBelowBottommostElement:
    mocks.getInsertionPointBelowBottommostElement,
  notifyAISelectionContentRefresh: mocks.notifyAISelectionContentRefresh,
}));

vi.mock(
  '../../components/ai-input-bar/target-bound-taskbar-state',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../../components/ai-input-bar/target-bound-taskbar-state')
    >();
    return {
      ...actual,
      readBoundTargetFollowEnabled: mocks.readBoundTargetFollowEnabled,
    };
  }
);

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

function emitCompletionEvent(
  taskId: string,
  options: {
    type?: 'postProcessingCompleted' | 'postProcessingFailed';
    resultType?: 'direct_insert' | 'split_and_insert';
    insertedCount?: number;
    firstElementId?: string;
  } = {}
) {
  const type = options.type || 'postProcessingCompleted';
  mocks.completionListeners.forEach((listener) => {
    listener({
      type,
      taskId,
      result: {
        taskId,
        status: type === 'postProcessingCompleted' ? 'completed' : 'failed',
        type: options.resultType || 'direct_insert',
        insertedCount: options.insertedCount,
        firstElementId: options.firstElementId,
      },
      timestamp: Date.now(),
    });
  });
}

function emitBoardSwitched() {
  mocks.workspaceListeners.forEach((listener) => {
    listener({
      type: 'boardSwitched',
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
    mocks.workspaceListeners.length = 0;
    mocks.taskState.tasks = [];
    mocks.currentBoardId = 'board-1';
    mocks.boundBoardId = 'board-1';
    mocks.boundTargetFollowEnabled = true;
    mocks.readBoundTargetFollowEnabled.mockReset();
    mocks.readBoundTargetFollowEnabled.mockImplementation(
      () => mocks.boundTargetFollowEnabled
    );
    mocks.getInsertionPointBelowBottommostElement.mockReset();
    mocks.getInsertionPointBelowBottommostElement.mockReturnValue([100, 100]);
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
    mocks.executeCanvasInsertion.mockReset();
    mocks.executeCanvasInsertion.mockResolvedValue({
      success: true,
      data: {
        insertedCount: 1,
        items: [
          {
            type: 'text',
            point: [100, 100],
            elementId: 'text-1',
            size: { width: 320, height: 120 },
          },
        ],
        firstElementId: 'text-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 320, height: 120 },
      },
    });
    mocks.insertAIFlow.mockReset();
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
    mocks.insertGeneratedImageFlow.mockReset();
    mocks.insertGeneratedImageFlow.mockResolvedValue({
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
    mocks.insertAIFlow.mockReset();
    mocks.insertAIFlow.mockResolvedValue({
      success: true,
      data: {
        insertedCount: 2,
        items: [
          { type: 'text', point: [100, 100], elementId: 'prompt-1' },
          { type: 'video', point: [100, 220], elementId: 'media-1' },
        ],
        firstElementId: 'prompt-1',
        firstElementPosition: [100, 100],
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
    mocks.removeNode.mockReset();
    mocks.notifyAISelectionContentRefresh.mockReset();
    mocks.prepareSemanticForegroundReplacement.mockReset();
    mocks.prepareSemanticForegroundReplacement.mockResolvedValue({
      url: '/__aitu_cache__/image/transparent-foreground.png',
      width: 1000,
      height: 1000,
      layer: {
        groupId: 'replacement-group',
        url: '/__aitu_cache__/image/transparent-foreground.png',
        zIndex: 1,
        name: '兔子',
        description: '新主体兔子',
        confidence: 0.97,
        boundingBox: {
          absolute: [30, 40, 230, 290],
          normalized: [30, 40, 230, 290],
        },
      },
    });
    mocks.postprocessGeneratedImage.mockReset();
    mocks.postprocessGeneratedImage.mockImplementation(
      async ({ generatedImageUrl }: { generatedImageUrl: string }) =>
        generatedImageUrl
    );
    mocks.retargetCanvasAssociationLines.mockReset();
    mocks.imageAnchorByTask = null;
    mocks.isGridImageTask.mockReset();
    mocks.isGridImageTask.mockReturnValue(false);
    mocks.isInspirationBoardTask.mockReset();
    mocks.isInspirationBoardTask.mockReturnValue(false);
    mocks.handleSplitAndInsertTask.mockReset();
    mocks.splitAndInsertImages.mockReset();
  });

  it('does not insert an internal completed result into the canvas', async () => {
    const task = createCompletedImageTask({
      result: {
        url: '/__aitu_cache__/image/internal.png',
        format: 'png',
        size: 123,
        resultVisibility: 'internal',
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: false,
      })
    );
    emitTaskEvent(task);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.executeCanvasInsertion).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
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
        maxGroupWait: 0,
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
      }),
      mocks.board,
      expect.any(Function)
    );
    expect(mocks.insertGeneratedImageFlow).not.toHaveBeenCalled();
    expect(mocks.notifyAISelectionContentRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
  });

  it('uses returned image dimensions instead of the requested square size', async () => {
    const task = createCompletedImageTask({
      params: {
        prompt: '竖版海报',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/portrait.png',
        format: 'png',
        size: 123,
        width: 1024,
        height: 1536,
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

    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/portrait.png',
      [100, 100],
      { width: 400, height: 600 },
      expect.any(Object),
      mocks.board,
      expect.any(Function)
    );
  });

  it('falls back to a valid insertion point on an empty canvas', async () => {
    const task = createCompletedImageTask();
    mocks.board = { children: [], viewport: { zoom: 1 } };
    mocks.taskState.tasks = [task];
    mocks.getInsertionPointBelowBottommostElement.mockReturnValue(undefined);

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

    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/task-1.png',
      [0, 0],
      { width: 512, height: 512 },
      expect.any(Object),
      mocks.board,
      expect.any(Function)
    );
    expect(mocks.failPostProcessing).not.toHaveBeenCalledWith(
      task.id,
      'No insertion point available'
    );
  });

  it('flushes a busy group when the maximum wait is reached', async () => {
    const tasks = Array.from({ length: 4 }, (_, index) =>
      createCompletedImageTask({
        id: `task-busy-${index + 1}`,
        params: {
          prompt: '持续到达的批量图片',
          size: '1:1',
          autoInsertToCanvas: true,
        },
        result: {
          url: `/__aitu_cache__/image/busy-${index + 1}.png`,
          format: 'png',
          size: 123,
        },
      })
    );
    mocks.board = { children: [] };

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 100,
        maxGroupWait: 250,
      })
    );

    act(() => {
      emitTaskEvent(tasks[0]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    act(() => {
      emitTaskEvent(tasks[1]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    act(() => {
      emitTaskEvent(tasks[2]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80);
    });
    act(() => {
      emitTaskEvent(tasks[3]);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9);
    });
    expect(mocks.insertImageGroup).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.insertImageGroup).toHaveBeenCalledTimes(1);
  });
  it('defers associated results until their source board becomes active', async () => {
    const task = createCompletedImageTask({
      id: 'task-cross-board',
      params: {
        prompt: '跨画板联想',
        autoInsertToCanvas: true,
        canvasAssociations: [
          {
            referenceId: 'ref-1',
            boardId: 'board-1',
            elementId: 'source-1',
            kind: 'image',
            label: '来源图片',
          },
        ],
      },
    });
    mocks.board = { children: [] };
    mocks.currentBoardId = 'board-2';
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
    expect(mocks.markAsInserted).not.toHaveBeenCalled();

    mocks.currentBoardId = 'board-1';
    act(() => {
      emitBoardSwitched();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('defers PPT explainer video until its source board becomes active', async () => {
    const task = createCompletedImageTask({
      id: 'ppt-explainer-cross-board',
      type: TaskType.VIDEO,
      params: {
        prompt: 'PPT 讲解视频',
        autoInsertToCanvas: true,
        pptExplainer: {
          schemaVersion: 1,
          sourceBoardId: 'board-1',
        },
      },
      result: {
        url: '/__aitu_cache__/video/ppt-explainer.mp4',
        format: 'mp4',
        size: 123,
        resultKind: 'video',
        resultVisibility: 'user',
      },
    });
    mocks.board = { children: [] };
    mocks.currentBoardId = 'board-2';
    mocks.boundBoardId = 'board-2';
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: false,
      })
    );
    emitTaskEvent(task);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();

    mocks.currentBoardId = 'board-1';
    mocks.boundBoardId = 'board-1';
    act(() => emitBoardSwitched());
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');

    emitTaskEvent(task);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
  });

  it('inserts one PPT explainer video for concurrent completion handlers', async () => {
    const task = createCompletedImageTask({
      id: 'ppt-explainer-concurrent-delivery',
      type: TaskType.VIDEO,
      params: {
        prompt: 'PPT 讲解视频',
        autoInsertToCanvas: true,
        pptExplainer: {
          schemaVersion: 1,
          sourceBoardId: 'board-1',
        },
      },
      result: {
        url: '/__aitu_cache__/video/ppt-explainer-concurrent.mp4',
        format: 'mp4',
        size: 123,
        resultKind: 'video',
        resultVisibility: 'user',
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({ enabled: true, groupSimilarTasks: false })
    );
    renderHook(() =>
      useAutoInsertToCanvas({ enabled: true, groupSimilarTasks: false })
    );
    emitTaskEvent(task);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('repairs PPT explainer delivery state without inserting a duplicate video', async () => {
    const task = createCompletedImageTask({
      id: 'ppt-explainer-existing-video',
      type: TaskType.VIDEO,
      params: {
        prompt: 'PPT 讲解视频',
        autoInsertToCanvas: true,
        pptExplainer: {
          schemaVersion: 1,
          sourceBoardId: 'board-1',
        },
      },
      result: {
        url: '/__aitu_cache__/video/ppt-explainer-existing.mp4',
        format: 'mp4',
        size: 123,
        resultKind: 'video',
        resultVisibility: 'user',
      },
    });
    mocks.board = {
      children: [
        {
          id: 'video-existing',
          type: 'video',
          angle: 0,
          points: [
            [20, 30],
            [420, 255],
          ],
          width: 400,
          height: 225,
          url: task.result?.url,
          generationTaskId: task.id,
        },
      ],
    };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: false,
      })
    );
    emitTaskEvent(task);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [20, 30],
      'video-existing',
      { width: 400, height: 225 }
    );
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('rechecks the source board before flushing a buffered result', async () => {
    const task = createCompletedImageTask({
      id: 'task-buffered-cross-board',
      params: {
        prompt: '缓冲中的跨画板联想',
        autoInsertToCanvas: true,
        canvasAssociations: [
          {
            referenceId: 'ref-buffered',
            boardId: 'board-1',
            elementId: 'source-buffered',
            kind: 'image',
            label: '来源图片',
          },
        ],
      },
    });
    mocks.board = { children: [] };
    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    mocks.taskState.tasks = [task];
    act(() => {
      emitTaskEvent(task);
    });
    mocks.currentBoardId = 'board-2';
    act(() => {
      emitBoardSwitched();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();

    mocks.currentBoardId = 'board-1';
    act(() => {
      emitBoardSwitched();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('does not insert while the board id and canvas instance binding disagree', async () => {
    const task = createCompletedImageTask({
      id: 'task-binding-race',
      params: {
        prompt: '画板绑定竞态',
        autoInsertToCanvas: true,
        canvasAssociations: [
          {
            referenceId: 'ref-binding-race',
            boardId: 'board-1',
            elementId: 'source-binding-race',
            kind: 'image',
            label: '来源图片',
          },
        ],
      },
    });
    mocks.board = { children: [] };
    mocks.currentBoardId = 'board-1';
    mocks.boundBoardId = 'board-2';
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
    expect(mocks.markAsInserted).not.toHaveBeenCalled();

    mocks.boundBoardId = 'board-1';
    act(() => emitBoardSwitched());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('does not delete reused-board content when the binding changes after insertion', async () => {
    const task = createCompletedImageTask({
      id: 'task-binding-changed-during-insert',
      params: {
        prompt: '插入期间切板',
        autoInsertToCanvas: true,
        canvasAssociations: [
          {
            referenceId: 'ref-binding-changed',
            boardId: 'board-1',
            elementId: 'source-binding-changed',
            kind: 'image',
            label: '来源图片',
          },
        ],
      },
    });
    let finishInsert!: () => void;
    mocks.quickInsert.mockImplementationOnce(
      (
        _type: string,
        _content: string,
        _point: unknown,
        _dimensions: unknown,
        _metadata: unknown,
        insertionBoard: { children: unknown[] },
        _boardGuard: () => boolean
      ) =>
        new Promise((resolve) => {
          finishInsert = () => {
            resolve({
              success: true,
              data: {
                insertedCount: 1,
                items: [
                  {
                    type: 'image',
                    point: [100, 100],
                    elementId: 'image-race',
                    size: { width: 512, height: 512 },
                  },
                ],
                firstElementId: 'image-race',
                firstElementPosition: [100, 100],
                firstElementSize: { width: 512, height: 512 },
              },
            });
          };
          insertionBoard.children.push({ id: 'image-race', type: 'image' });
        })
    );
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
    mocks.currentBoardId = 'board-2';
    mocks.boundBoardId = 'board-2';
    const reusedBoardElement = {
      id: 'image-race',
      type: 'shape',
      boardId: 'board-2',
    };
    mocks.board.children = [reusedBoardElement];
    await act(async () => {
      finishInsert();
      await Promise.resolve();
    });

    expect(mocks.markAsInserted).not.toHaveBeenCalled();
    expect(mocks.removeNode).not.toHaveBeenCalled();
    expect(mocks.board.children).toEqual([reusedBoardElement]);
  });

  it.each([
    {
      taskType: TaskType.VIDEO,
      contentType: 'video',
      elementId: 'video-1',
      size: { width: 512, height: 512 },
    },
    {
      taskType: TaskType.AUDIO,
      contentType: 'audio',
      elementId: 'audio-1',
      size: { width: 360, height: 144 },
    },
  ])(
    'passes the real $contentType element ID to post-processing',
    async ({ taskType, contentType, elementId, size }) => {
      const task = createCompletedImageTask({
        id: `task-${contentType}`,
        type: taskType,
        result: {
          url: `/result/${contentType}`,
          format: contentType,
          size: 123,
        },
      });
      mocks.board = { children: [] };
      mocks.taskState.tasks = [task];
      mocks.quickInsert.mockResolvedValueOnce({
        success: true,
        data: {
          insertedCount: 1,
          items: [
            {
              type: contentType,
              point: [120, 140],
              elementId,
              size,
            },
          ],
          firstElementId: elementId,
          firstElementPosition: [120, 140],
          firstElementSize: size,
        },
      });

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

      expect(mocks.completePostProcessing).toHaveBeenCalledWith(
        task.id,
        1,
        [120, 140],
        elementId,
        size
      );
    }
  );

  it('selects the generated media instead of the prompt card from insertAIFlow', async () => {
    const task = createCompletedImageTask({
      id: 'task-video-flow',
      type: TaskType.VIDEO,
      result: {
        url: '/result/video-flow.mp4',
        format: 'mp4',
        size: 123,
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    mocks.insertAIFlow.mockResolvedValueOnce({
      success: true,
      data: {
        insertedCount: 2,
        items: [
          {
            type: 'text',
            point: [100, 100],
            elementId: 'prompt-card-1',
            size: { width: 320, height: 120 },
          },
          {
            type: 'video',
            point: [100, 260],
            elementId: 'video-result-1',
            size: { width: 512, height: 512 },
          },
        ],
        firstElementId: 'prompt-card-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 320, height: 120 },
      },
    });

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        insertPrompt: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 260],
      'video-result-1',
      { width: 512, height: 512 }
    );
  });

  it('passes the real text result ID for lyrics and chat insertions', async () => {
    const lyricsTask = createCompletedImageTask({
      id: 'task-lyrics',
      type: TaskType.AUDIO,
      result: {
        url: '',
        resultKind: 'lyrics',
        format: 'lyrics',
        size: 0,
        lyricsText: '第一句歌词',
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [lyricsTask];

    const firstHook = renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      lyricsTask.id,
      1,
      [100, 100],
      'text-1',
      { width: 320, height: 120 }
    );
    firstHook.unmount();

    mocks.completePostProcessing.mockClear();
    mocks.taskState.tasks = [
      createCompletedImageTask({
        id: 'task-chat',
        type: TaskType.CHAT,
        result: {
          url: '',
          format: 'text',
          size: 4,
          chatResponse: '聊天结果',
        },
      }),
    ];
    renderHook(() => useAutoInsertToCanvas({ enabled: true }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      'task-chat',
      1,
      [100, 100],
      'text-1',
      { width: 320, height: 120 }
    );
  });

  it('retargets association lines to the canonical result on the submission board', () => {
    const task = createCompletedImageTask({
      id: 'task-associated',
      insertedToCanvas: true,
      params: {
        prompt: '引用生成',
        workflowId: 'workflow-1',
        batchIndex: 1,
        canvasAssociations: [
          {
            referenceId: 'ref-1',
            boardId: 'board-1',
            elementId: 'source-1',
            kind: 'image',
            label: '图片 1',
          },
          {
            referenceId: 'ref-2',
            boardId: 'board-1',
            elementId: 'source-2',
            kind: 'text',
            label: '文本 2',
          },
        ],
      },
    });
    mocks.board = { children: [] };
    mocks.imageAnchorByTask = { id: 'anchor-1' };
    mocks.taskState.tasks = [task];
    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    act(() => {
      emitCompletionEvent(task.id, { firstElementId: 'result-1' });
    });

    expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledWith(
      mocks.board,
      {
        boardId: 'board-1',
        sourceElementIds: ['source-1', 'source-2'],
        resultElementId: 'result-1',
        workflowId: 'workflow-1',
        taskId: task.id,
        previousResultElementId: 'anchor-1',
      }
    );
  });

  it('skips association lines for later batch results, missing refs, and another active board', () => {
    const task = createCompletedImageTask({
      id: 'task-skipped-association',
      insertedToCanvas: true,
      params: {
        prompt: '引用生成',
        batchIndex: 2,
        canvasAssociations: [
          {
            referenceId: 'ref-1',
            boardId: 'board-1',
            elementId: 'source-1',
            kind: 'image',
            label: '图片 1',
          },
        ],
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    act(() => {
      emitCompletionEvent(task.id, { firstElementId: 'result-later' });
    });
    expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalled();

    task.params.batchIndex = 1;
    mocks.currentBoardId = 'board-2';
    act(() => {
      emitCompletionEvent(task.id, { firstElementId: 'result-other-board' });
    });
    expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalled();

    mocks.currentBoardId = 'board-1';
    task.params.canvasAssociations = [
      {
        referenceId: 'ref-1',
        boardId: 'board-1',
        elementId: 'source-1',
        kind: 'image',
        label: '图片 1',
      },
      {
        referenceId: 'ref-2',
        boardId: 'board-2',
        elementId: 'source-2',
        kind: 'text',
        label: '文本 2',
      },
    ];
    act(() => {
      emitCompletionEvent(task.id, { firstElementId: 'result-mixed-boards' });
    });
    expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalled();

    task.params.canvasAssociations = [];
    act(() => {
      emitCompletionEvent(task.id, { firstElementId: 'result-no-refs' });
    });
    expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalled();
  });

  it('skips association lines for a zero-based batch index', () => {
    const task = createCompletedImageTask({
      id: 'task-zero-batch',
      insertedToCanvas: true,
      params: {
        prompt: '零批次引用生成',
        batchIndex: 0,
        canvasAssociations: [
          {
            referenceId: 'ref-1',
            boardId: 'board-1',
            elementId: 'source-1',
            kind: 'image',
            label: '图片 1',
          },
        ],
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    act(() => {
      emitCompletionEvent(task.id, { firstElementId: 'result-zero-batch' });
    });

    expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalled();
  });

  it('isolates association line failures from completion handling', () => {
    const task = createCompletedImageTask({
      id: 'task-association-error',
      insertedToCanvas: true,
      params: {
        prompt: '引用生成',
        canvasAssociations: [
          {
            referenceId: 'ref-1',
            boardId: 'board-1',
            elementId: 'source-1',
            kind: 'image',
            label: '图片 1',
          },
        ],
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    mocks.retargetCanvasAssociationLines.mockImplementationOnce(() => {
      throw new Error('line failed');
    });
    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    expect(() => {
      act(() => {
        emitCompletionEvent(task.id, { firstElementId: 'result-1' });
      });
    }).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(task.id),
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it.each([
    {
      label: 'grid split',
      params: { gridImageRows: 2, gridImageCols: 2 },
      insertedCount: 2,
      insertedChildren: [
        { id: 'split-1', type: 'image' },
        { id: 'split-2', type: 'image' },
      ],
      resultElementId: 'split-1',
      isGrid: true,
    },
    {
      label: 'inspiration fallback',
      params: {
        isInspirationBoard: true,
        inspirationBoardLayoutStyle: 'inspiration-board',
      },
      insertedCount: 1,
      insertedChildren: [{ id: 'fallback-1', type: 'image' }],
      resultElementId: 'fallback-1',
      isGrid: false,
    },
  ])(
    'creates association lines for the explicit result ID after $label',
    async ({
      params,
      insertedCount,
      insertedChildren,
      resultElementId,
      isGrid,
    }) => {
      const task = createCompletedImageTask({
        id: `task-${resultElementId}`,
        params: {
          prompt: '拆分引用生成',
          autoInsertToCanvas: true,
          ...params,
          canvasAssociations: [
            {
              referenceId: 'ref-1',
              boardId: 'board-1',
              elementId: 'source-1',
              kind: 'image',
              label: '图片 1',
            },
          ],
        },
      });
      mocks.board = {
        children: [{ id: 'source-1', type: 'image' }],
      };
      mocks.isGridImageTask.mockReturnValue(isGrid);
      mocks.isInspirationBoardTask.mockReturnValue(!isGrid);
      mocks.handleSplitAndInsertTask.mockImplementationOnce(
        async (taskId: string) => {
          await Promise.resolve();
          mocks.board.children.push(...insertedChildren, {
            id: 'concurrent-unrelated-image',
            type: 'image',
          });
          emitCompletionEvent(taskId, {
            resultType: 'split_and_insert',
            insertedCount,
            firstElementId: resultElementId,
          });
          return {
            success: true,
            count: insertedCount,
            firstElementId: resultElementId,
          };
        }
      );
      renderHook(() => useAutoInsertToCanvas({ enabled: true }));

      mocks.taskState.tasks = [task];
      await act(async () => {
        emitTaskEvent(task);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(mocks.handleSplitAndInsertTask).toHaveBeenCalledWith(
        task.id,
        task.result?.url,
        task.params,
        {
          scrollToResult: true,
          board: mocks.board,
          boardGuard: expect.any(Function),
        }
      );
      expect(mocks.retargetCanvasAssociationLines).toHaveBeenCalledWith(
        mocks.board,
        {
          boardId: 'board-1',
          sourceElementIds: ['source-1'],
          resultElementId,
          workflowId: undefined,
          taskId: task.id,
        }
      );
      expect(mocks.retargetCanvasAssociationLines).not.toHaveBeenCalledWith(
        mocks.board,
        expect.objectContaining({
          resultElementId: 'concurrent-unrelated-image',
        })
      );
      expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
    }
  );

  it('propagates the first split image ID through post-processing', async () => {
    const mediaResultHandler = await vi.importActual<
      typeof import('../../services/media-result-handler')
    >('../../services/media-result-handler');
    mocks.board = { children: [] };
    mocks.splitAndInsertImages.mockResolvedValueOnce({
      success: true,
      count: 2,
      firstElementId: 'split-first',
      firstElementPosition: [200, 300],
      firstElementSize: { width: 320, height: 240 },
    });

    const result = await mediaResultHandler.handleSplitAndInsertTask(
      'task-split-result',
      '/result/grid.png',
      {
        prompt: '宫格图',
        gridImageRows: 2,
        gridImageCols: 2,
      }
    );

    expect(result).toEqual({
      success: true,
      count: 2,
      firstElementId: 'split-first',
    });
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      'task-split-result',
      2,
      [200, 300],
      'split-first',
      { width: 320, height: 240 }
    );
  });

  it('propagates the fallback image ID when splitting fails', async () => {
    const mediaResultHandler = await vi.importActual<
      typeof import('../../services/media-result-handler')
    >('../../services/media-result-handler');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.board = { children: [] };
    mocks.splitAndInsertImages.mockResolvedValueOnce({
      success: false,
      count: 0,
      error: 'no split regions',
    });
    mocks.executeCanvasInsertion.mockResolvedValueOnce({
      success: true,
      data: {
        insertedCount: 1,
        items: [
          {
            type: 'image',
            point: [100, 100],
            elementId: 'fallback-first',
            size: { width: 512, height: 512 },
          },
        ],
        firstElementId: 'fallback-first',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 512, height: 512 },
      },
    });

    const result = await mediaResultHandler.handleSplitAndInsertTask(
      'task-fallback-result',
      '/result/inspiration.png',
      {
        prompt: '灵感图',
        isInspirationBoard: true,
        inspirationBoardLayoutStyle: 'inspiration-board',
      }
    );

    expect(result).toEqual({
      success: true,
      count: 1,
      firstElementId: 'fallback-first',
    });
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      'task-fallback-result',
      1,
      [100, 100],
      'fallback-first',
      { width: 512, height: 512 }
    );
    warn.mockRestore();
  });

  it('does not fall back to direct insertion after the split board changes', async () => {
    const mediaResultHandler = await vi.importActual<
      typeof import('../../services/media-result-handler')
    >('../../services/media-result-handler');
    mocks.board = { children: [] };
    mocks.splitAndInsertImages.mockResolvedValueOnce({
      success: false,
      count: 0,
      error: '画板已切换，取消本次插入',
    });

    const result = await mediaResultHandler.handleSplitAndInsertTask(
      'task-split-board-changed',
      '/result/grid.png',
      { prompt: '宫格图', gridImageRows: 2, gridImageCols: 2 },
      {
        board: mocks.board,
        boardGuard: () => false,
      }
    );

    expect(result).toMatchObject({ success: false, count: 0 });
    expect(mocks.executeCanvasInsertion).not.toHaveBeenCalled();
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
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/task-1.png',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({
        prompt: '生成一张图',
        aiPrompt: '生成一张图',
        generationPrompt: '生成一张图',
        generationTaskId: 'task-restored',
      }),
      mocks.board,
      expect.any(Function)
    );
    expect(mocks.insertGeneratedImageFlow).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('preserves generation metadata when inserting a video result', async () => {
    const task = createCompletedImageTask({
      id: 'task-video',
      type: TaskType.VIDEO,
      params: {
        prompt: '海边延时摄影',
        size: '16:9',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/video/task-video.mp4',
        format: 'mp4',
        size: 456,
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

    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'video',
      '/__aitu_cache__/video/task-video.mp4',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({
        prompt: '海边延时摄影',
        generationTaskId: 'task-video',
      }),
      mocks.board,
      expect.any(Function)
    );
  });

  it('preserves generation metadata when inserting an audio result', async () => {
    const task = createCompletedImageTask({
      id: 'task-audio',
      type: TaskType.AUDIO,
      params: {
        prompt: '安静的钢琴背景音乐',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/audio/task-audio.mp3',
        format: 'mp3',
        size: 456,
        title: '钢琴背景音乐',
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

    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'audio',
      '/__aitu_cache__/audio/task-audio.mp3',
      [100, 100],
      { width: 360, height: 144 },
      expect.objectContaining({
        prompt: '安静的钢琴背景音乐',
        generationTaskId: 'task-audio',
      }),
      mocks.board,
      expect.any(Function)
    );
  });

  it.each([
    {
      type: TaskType.VIDEO,
      id: 'task-video-flow',
      prompt: '雨夜延时视频',
      url: '/__aitu_cache__/video/task-video-flow.mp4',
      format: 'mp4',
    },
    {
      type: TaskType.AUDIO,
      id: 'task-audio-flow',
      prompt: '雨声环境音乐',
      url: '/__aitu_cache__/audio/task-audio-flow.mp3',
      format: 'mp3',
    },
  ])(
    'preserves generation metadata for $type results when inserting the prompt flow',
    async ({ type, id, prompt, url, format }) => {
      const task = createCompletedImageTask({
        id,
        type,
        params: {
          prompt,
          size: '16:9',
          autoInsertToCanvas: true,
        },
        result: { url, format, size: 456 },
      });
      mocks.board = { children: [] };
      mocks.taskState.tasks = [task];

      renderHook(() =>
        useAutoInsertToCanvas({
          enabled: true,
          insertPrompt: true,
          groupSimilarTasks: true,
          groupTimeWindow: 10,
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(mocks.insertAIFlow).toHaveBeenCalledWith(
        prompt,
        [
          expect.objectContaining({
            type: type === TaskType.VIDEO ? 'video' : 'audio',
            url,
            metadata: expect.objectContaining({
              prompt,
              generationTaskId: id,
            }),
          }),
        ],
        [100, 100],
        mocks.board,
        expect.any(Function)
      );
    }
  );

  it('binds every result from one multi-image task to that task', async () => {
    const task = createCompletedImageTask({
      id: 'task-multi-image',
      params: {
        prompt: '同一任务多图',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/multi-1.png',
        urls: [
          '/__aitu_cache__/image/multi-1.png',
          '/__aitu_cache__/image/multi-2.png',
        ],
        format: 'png',
        size: 123,
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

    expect(mocks.insertImageGroup).toHaveBeenCalledWith(
      task.result?.urls,
      [100, 100],
      { width: 512, height: 512 },
      mocks.board,
      expect.any(Function),
      '同一任务多图',
      expect.objectContaining({
        prompt: '同一任务多图',
        generationTaskId: 'task-multi-image',
      })
    );
  });

  it('binds every result from one multi-audio task to that task', async () => {
    const task = createCompletedImageTask({
      id: 'task-multi-audio',
      type: TaskType.AUDIO,
      params: {
        prompt: '两段环境音乐',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/audio/multi-1.mp3',
        urls: [
          '/__aitu_cache__/audio/multi-1.mp3',
          '/__aitu_cache__/audio/multi-2.mp3',
        ],
        format: 'mp3',
        size: 456,
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

    expect(mocks.executeCanvasInsertion).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({
              prompt: '两段环境音乐',
              generationTaskId: 'task-multi-audio',
            }),
          }),
        ]),
        startPoint: [100, 100],
        board: mocks.board,
        boardGuard: expect.any(Function),
      })
    );
    expect(mocks.executeCanvasInsertion.mock.calls[0][0].items).toHaveLength(2);
  });

  it('preserves generation metadata when inserting a text result', async () => {
    const task = createCompletedImageTask({
      id: 'task-text',
      type: TaskType.CHAT,
      params: {
        prompt: '总结会议纪要',
        autoInsertToCanvas: true,
      },
      result: {
        url: '',
        format: 'text',
        size: 0,
        chatResponse: '会议结论',
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.executeCanvasInsertion).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            type: 'text',
            metadata: {
              prompt: '总结会议纪要',
              generationTaskId: 'task-text',
            },
          }),
        ],
        board: mocks.board,
        boardGuard: expect.any(Function),
      })
    );
  });

  it('releases a text task reservation when canvas insertion fails', async () => {
    const task = createCompletedImageTask({
      id: 'task-text-retry',
      type: TaskType.CHAT,
      params: {
        prompt: '总结失败后重试',
        autoInsertToCanvas: true,
      },
      result: {
        url: '',
        format: 'text',
        size: 0,
        chatResponse: '重试后应插入的文本',
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    mocks.executeCanvasInsertion.mockResolvedValueOnce({
      success: false,
      error: '文本写入失败',
    });

    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.completePostProcessing).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
    expect(mocks.failPostProcessing).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining('文本写入失败')
    );

    act(() => {
      emitTaskEvent(task);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.executeCanvasInsertion).toHaveBeenCalledTimes(2);
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'text-1',
      { width: 320, height: 120 }
    );
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
        width: 1536,
        height: 1024,
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
        width: 1024,
        height: 1536,
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
    mocks.insertImageGroup.mockResolvedValueOnce({
      success: true,
      data: {
        insertedCount: 2,
        items: [
          {
            type: 'image',
            point: [100, 100],
            elementId: 'image-1',
            size: { width: 512, height: 341 },
          },
          {
            type: 'image',
            point: [632, 100],
            elementId: 'image-2',
            size: { width: 400, height: 600 },
          },
        ],
        firstElementId: 'image-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 512, height: 341 },
      },
    });

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
      [
        { width: 512, height: 341 },
        { width: 400, height: 600 },
      ],
      mocks.board,
      expect.any(Function),
      '批量图片'
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
    expect(mocks.notifyAISelectionContentRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      'task-batch-1',
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 341 }
    );
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      'task-batch-2',
      1,
      [632, 100],
      'image-2',
      { width: 400, height: 600 }
    );
  });

  it('binds grouped video results to their own task metadata', async () => {
    const tasks = [
      createCompletedImageTask({
        id: 'task-video-batch-1',
        type: TaskType.VIDEO,
        params: {
          prompt: '批量视频',
          size: '16:9',
          autoInsertToCanvas: true,
        },
        result: {
          url: '/__aitu_cache__/video/batch-1.mp4',
          format: 'mp4',
          size: 456,
        },
      }),
      createCompletedImageTask({
        id: 'task-video-batch-2',
        type: TaskType.VIDEO,
        params: {
          prompt: '批量视频',
          size: '16:9',
          autoInsertToCanvas: true,
        },
        result: {
          url: '/__aitu_cache__/video/batch-2.mp4',
          format: 'mp4',
          size: 456,
        },
      }),
    ];
    mocks.board = { children: [] };
    mocks.taskState.tasks = tasks;

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

    expect(mocks.quickInsert).toHaveBeenNthCalledWith(
      1,
      'video',
      '/__aitu_cache__/video/batch-1.mp4',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({ generationTaskId: 'task-video-batch-1' }),
      mocks.board,
      expect.any(Function)
    );
    expect(mocks.quickInsert).toHaveBeenNthCalledWith(
      2,
      'video',
      '/__aitu_cache__/video/batch-2.mp4',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({ generationTaskId: 'task-video-batch-2' }),
      mocks.board,
      expect.any(Function)
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
        sourcePrompt: '白天城市',
        boundTargetFollowControlled: true,
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
    expect(mocks.notifyAISelectionContentRefresh).toHaveBeenCalledTimes(1);
  });

  it('post-processes a masked bound edit before replacing the target', async () => {
    const task = createCompletedImageTask({
      id: 'task-masked-repair',
      params: {
        prompt: '修复耳朵',
        model: 'gpt-image-2',
        generationMode: 'image_edit',
        maskImage: '/__aitu_cache__/image/mask.png',
        referenceImages: ['/__aitu_cache__/image/original.png'],
        replaceElementId: 'image-target',
        targetElementId: 'image-target',
      },
      result: {
        url: '/__aitu_cache__/image/generated.png',
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
    mocks.postprocessGeneratedImage.mockResolvedValue(
      '/__aitu_cache__/image/generated-repaired.png'
    );
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

    expect(mocks.postprocessGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedImageUrl: '/__aitu_cache__/image/generated.png',
        originalImageUrl: '/__aitu_cache__/image/original.png',
        maskImageUrl: '/__aitu_cache__/image/mask.png',
        model: 'gpt-image-2',
      })
    );
    expect(mocks.setNode).toHaveBeenCalledWith(
      mocks.board,
      expect.objectContaining({
        url: '/__aitu_cache__/image/generated-repaired.png',
      }),
      [0]
    );
  });

  it('二次抠图后只替换语义前景并同步组 manifest', async () => {
    const task = createCompletedImageTask({
      id: 'task-semantic-replace',
      params: {
        prompt: '把人物改成蓝色',
        size: '1:1',
        generationMode: 'image_edit',
        maskImage: '/__aitu_cache__/image/semantic-mask.png',
        semanticReplacement: true,
        semanticReplacementBackgroundUrl:
          '/__aitu_cache__/image/background.png',
        semanticReplacementBackgroundElementId: 'semantic-background',
        semanticReplacementForegroundUrl:
          '/__aitu_cache__/image/old-foreground.png',
        replaceElementId: 'foreground-target',
        targetElementId: 'foreground-target',
      },
      result: {
        url: '/__aitu_cache__/image/generated-full-canvas.png',
        format: 'png',
        size: 123,
      },
    });
    const foregroundMetadata = {
      schemaVersion: 1,
      providerGroupId: 'semantic-group',
      kind: 'foreground',
      zIndex: 1,
      name: '人物',
      description: '主体人物',
      boundingBox: {
        absolute: [20, 30, 220, 280],
        normalized: [100, 100, 800, 900],
      },
    };
    const background = {
      id: 'semantic-background',
      type: 'image',
      url: '/__aitu_cache__/image/background.png',
      groupId: 'semantic-group',
      points: [
        [0, 0],
        [1000, 1000],
      ],
      metadata: {
        semanticLayer: {
          ...foregroundMetadata,
          kind: 'background',
          zIndex: 0,
          name: '背景',
        },
      },
    };
    const foreground = {
      id: 'foreground-target',
      type: 'image',
      url: '/__aitu_cache__/image/old-foreground.png',
      groupId: 'semantic-group',
      points: [
        [20, 30],
        [220, 280],
      ],
      metadata: { semanticLayer: foregroundMetadata },
    };
    const sibling = {
      id: 'foreground-sibling',
      type: 'image',
      url: '/__aitu_cache__/image/sibling.png',
      groupId: 'semantic-group',
      metadata: {
        semanticLayer: { ...foregroundMetadata, zIndex: 2, name: '装饰' },
      },
    };
    const group = {
      id: 'semantic-group',
      type: 'group',
      metadata: {
        semanticLayerGroup: {
          schemaVersion: 1,
          providerGroupId: 'semantic-group',
          manifest: {
            schemaVersion: 1,
            groupId: 'semantic-group',
            layers: [
              {
                kind: 'background',
                zIndex: 0,
                url: background.url,
                name: '背景',
              },
              {
                kind: 'foreground',
                zIndex: 1,
                url: foreground.url,
                name: '人物',
              },
              {
                kind: 'foreground',
                zIndex: 2,
                url: sibling.url,
                name: '装饰',
              },
            ],
          },
        },
      },
    };
    mocks.board = { children: [background, foreground, sibling, group] };
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

    expect(mocks.prepareSemanticForegroundReplacement).toHaveBeenCalledWith(
      '/__aitu_cache__/image/generated-full-canvas.png',
      task.id,
      foregroundMetadata,
      { editPrompt: '把人物改成蓝色' }
    );
    expect(mocks.postprocessGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        originalImageUrl: '/__aitu_cache__/image/background.png',
        maskImageUrl: '/__aitu_cache__/image/semantic-mask.png',
        excludedTargetName: '人物',
      })
    );
    expect(mocks.setNode).toHaveBeenNthCalledWith(
      1,
      mocks.board,
      expect.objectContaining({
        url: '/__aitu_cache__/image/transparent-foreground.png',
        points: [
          [30, 40],
          [230, 290],
        ],
        metadata: expect.objectContaining({
          semanticLayer: expect.objectContaining({
            name: '兔子',
            description: '新主体兔子',
          }),
        }),
      }),
      [1]
    );
    expect(mocks.setNode).toHaveBeenNthCalledWith(
      2,
      mocks.board,
      expect.objectContaining({
        metadata: expect.objectContaining({
          semanticLayerGroup: expect.objectContaining({
            manifest: expect.objectContaining({
              layers: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'foreground',
                  zIndex: 1,
                  url: '/__aitu_cache__/image/transparent-foreground.png',
                  name: '兔子',
                }),
                expect.objectContaining({
                  kind: 'foreground',
                  zIndex: 2,
                  url: sibling.url,
                }),
              ]),
            }),
          }),
        }),
      }),
      [3]
    );
    expect(mocks.setNode).toHaveBeenCalledTimes(2);
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [30, 40],
      'foreground-target',
      { width: 200, height: 250 }
    );
  });

  it('旧主体残留复检失败时保持语义图层不变', async () => {
    const task = createCompletedImageTask({
      id: 'task-semantic-residual',
      params: {
        prompt: '把猫替换成兔子',
        generationMode: 'image_edit',
        maskImage: '/__aitu_cache__/image/semantic-mask.png',
        semanticReplacement: true,
        semanticReplacementBackgroundUrl:
          '/__aitu_cache__/image/background.png',
        semanticReplacementBackgroundElementId: 'semantic-background',
        semanticReplacementForegroundUrl: '/__aitu_cache__/image/old-cat.png',
        replaceElementId: 'foreground-target',
        targetElementId: 'foreground-target',
      },
      result: {
        url: '/__aitu_cache__/image/rabbit-with-cat-tail.png',
        format: 'png',
        size: 123,
      },
    });
    const semanticLayer = {
      schemaVersion: 1,
      providerGroupId: 'semantic-group',
      kind: 'foreground',
      zIndex: 1,
      name: '猫',
      description: '原主体猫',
      boundingBox: {
        absolute: [20, 30, 220, 280],
        normalized: [100, 100, 800, 900],
      },
    };
    const background = {
      id: 'semantic-background',
      type: 'image',
      url: '/__aitu_cache__/image/background.png',
      groupId: 'semantic-group',
    };
    const foreground = {
      id: 'foreground-target',
      type: 'image',
      url: '/__aitu_cache__/image/old-cat.png',
      groupId: 'semantic-group',
      points: [
        [20, 30],
        [220, 280],
      ],
      metadata: { semanticLayer },
    };
    mocks.postprocessGeneratedImage.mockRejectedValue(
      new Error('修复后仍检测到旧主体残留，已取消本次替换')
    );
    mocks.board = { children: [background, foreground] };
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

    expect(mocks.postprocessGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedImageUrl: '/__aitu_cache__/image/rabbit-with-cat-tail.png',
        excludedTargetName: '猫',
      })
    );
    expect(mocks.prepareSemanticForegroundReplacement).not.toHaveBeenCalled();
    expect(mocks.setNode).not.toHaveBeenCalled();
    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(foreground.url).toBe('/__aitu_cache__/image/old-cat.png');
    expect(background.url).toBe('/__aitu_cache__/image/background.png');
  });

  it('inserts a new image when taskbar follow was disabled after submission', async () => {
    const processingTask = createCompletedImageTask({
      id: 'task-unfollowed-before-insert',
      status: TaskStatus.PROCESSING,
      params: {
        prompt: '夜景城市',
        size: '1:1',
        replaceElementId: 'image-target',
        targetElementId: 'image-target',
        anchorId: 'anchor-target',
        sourceTaskId: 'task-old',
        sourcePrompt: '白天城市',
        referenceImages: ['/__aitu_cache__/image/original.png'],
        boundTargetFollowControlled: true,
      },
      result: undefined,
      completedAt: undefined,
    });
    const completedTask = createCompletedImageTask({
      ...processingTask,
      status: TaskStatus.COMPLETED,
      result: {
        url: '/__aitu_cache__/image/new-reference-result.png',
        format: 'png',
        size: 123,
      },
      completedAt: 3,
    });
    const originalElement = {
      id: 'image-target',
      type: 'image',
      url: '/__aitu_cache__/image/original.png',
      points: [
        [20, 30],
        [420, 330],
      ],
      aiTaskbarReferenceOnly: false,
    };
    const anchor = {
      id: 'anchor-target',
      type: 'generation-anchor',
      anchorType: 'ghost',
      points: [
        [470, 30],
        [638, 102],
      ],
      expectedInsertPosition: [470, 30],
      transitionMode: 'hold',
      taskIds: [completedTask.id],
      workflowId: 'workflow-target',
      zoom: 1,
    };
    mocks.imageAnchorByTask = anchor;
    mocks.board = { children: [originalElement, anchor] };
    mocks.taskState.tasks = [processingTask];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.readBoundTargetFollowEnabled).not.toHaveBeenCalled();

    mocks.boundTargetFollowEnabled = false;
    mocks.taskState.tasks = [completedTask];
    act(() => {
      emitTaskEvent(completedTask);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.readBoundTargetFollowEnabled).toHaveBeenCalled();
    expect(mocks.setNode).not.toHaveBeenCalledWith(
      mocks.board,
      expect.objectContaining({
        url: '/__aitu_cache__/image/new-reference-result.png',
      }),
      [0]
    );
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/new-reference-result.png',
      [470, 30],
      { width: 512, height: 512 },
      expect.objectContaining({
        generationPrompt: '夜景城市',
        generationTaskId: completedTask.id,
      }),
      mocks.board,
      expect.any(Function)
    );
    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      anchor.id,
      expect.objectContaining({
        targetElementId: undefined,
        resultElementId: 'image-1',
      })
    );
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      completedTask.id,
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
    expect(mocks.board.children[0]).toBe(originalElement);
    expect(originalElement.url).toBe('/__aitu_cache__/image/original.png');
    expect(completedTask.params.referenceImages).toEqual([
      '/__aitu_cache__/image/original.png',
    ]);
    expect(completedTask.params.replaceElementId).toBe('image-target');
    expect(completedTask.params.targetElementId).toBe('image-target');
    expect(mocks.failPostProcessing).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).toHaveBeenCalledWith(
      completedTask.id,
      'auto_insert'
    );
  });

  it('inserts a new image when the target was permanently changed to reference-only after submission', async () => {
    const processingTask = createCompletedImageTask({
      id: 'task-reference-only-before-insert',
      status: TaskStatus.PROCESSING,
      params: {
        prompt: '保留原图并生成新图',
        size: '1:1',
        replaceElementId: 'image-target',
        targetElementId: 'image-target',
        anchorId: 'anchor-target',
        sourceTaskId: 'task-old',
        sourcePrompt: '原始提示词',
        referenceImages: ['/__aitu_cache__/image/original.png'],
        boundTargetFollowControlled: true,
      },
      result: undefined,
      completedAt: undefined,
    });
    const completedTask = createCompletedImageTask({
      ...processingTask,
      status: TaskStatus.COMPLETED,
      result: {
        url: '/__aitu_cache__/image/reference-only-result.png',
        format: 'png',
        size: 123,
      },
      completedAt: 3,
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
    const anchor = {
      id: 'anchor-target',
      type: 'generation-anchor',
      anchorType: 'ghost',
      points: [
        [470, 30],
        [638, 102],
      ],
      expectedInsertPosition: [470, 30],
      transitionMode: 'hold',
      taskIds: [completedTask.id],
      workflowId: 'workflow-target',
      zoom: 1,
    };
    mocks.imageAnchorByTask = anchor;
    mocks.board = { children: [originalElement, anchor] };
    mocks.taskState.tasks = [processingTask];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    originalElement.aiTaskbarReferenceOnly = true;
    mocks.taskState.tasks = [completedTask];
    act(() => {
      emitTaskEvent(completedTask);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.boundTargetFollowEnabled).toBe(true);
    expect(mocks.readBoundTargetFollowEnabled).toHaveBeenCalled();
    expect(mocks.setNode).not.toHaveBeenCalledWith(
      mocks.board,
      expect.objectContaining({
        url: '/__aitu_cache__/image/reference-only-result.png',
      }),
      [0]
    );
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/reference-only-result.png',
      [470, 30],
      { width: 512, height: 512 },
      expect.objectContaining({
        generationPrompt: '保留原图并生成新图',
        generationTaskId: completedTask.id,
      }),
      mocks.board,
      expect.any(Function)
    );
    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      anchor.id,
      expect.objectContaining({
        targetElementId: undefined,
        resultElementId: 'image-1',
      })
    );
    expect(originalElement.url).toBe('/__aitu_cache__/image/original.png');
    expect(originalElement.aiTaskbarReferenceOnly).toBe(true);
    expect(completedTask.params.referenceImages).toEqual([
      '/__aitu_cache__/image/original.png',
    ]);
    expect(completedTask.params.replaceElementId).toBe('image-target');
    expect(completedTask.params.targetElementId).toBe('image-target');
    expect(mocks.failPostProcessing).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).toHaveBeenCalledWith(
      completedTask.id,
      'auto_insert'
    );
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

  it('keeps explicit non-taskbar image replacement when follow is disabled', async () => {
    const task = createCompletedImageTask({
      id: 'task-explicit-image-replace',
      params: {
        prompt: '替换 PPT 页面图片',
        size: '1:1',
        replaceElementId: 'image-target',
      },
      result: {
        url: '/__aitu_cache__/image/explicit-replaced.png',
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
    mocks.boundTargetFollowEnabled = false;
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
        url: '/__aitu_cache__/image/explicit-replaced.png',
      }),
      [0]
    );
  });

  it('replaces a bound video in place and preserves its geometry', async () => {
    const task = createCompletedImageTask({
      id: 'task-video-replace',
      type: TaskType.VIDEO,
      params: {
        prompt: '更新目标视频',
        size: '16:9',
        replaceElementId: 'video-target',
        sourcePrompt: '原视频提示词',
        boundTargetFollowControlled: true,
      },
      result: {
        url: '/__aitu_cache__/video/replaced.mp4',
        format: 'mp4',
        size: 456,
      },
    });
    const originalElement = {
      id: 'video-target',
      type: 'image',
      url: '/__aitu_cache__/video/original.mp4#video',
      isVideo: true,
      videoType: 'video',
      points: [
        [40, 50],
        [440, 275],
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

    expect(mocks.setNode).toHaveBeenCalledWith(
      mocks.board,
      expect.objectContaining({
        url: '/__aitu_cache__/video/replaced.mp4#video',
        generationPrompt: '更新目标视频',
        generationTaskId: 'task-video-replace',
      }),
      [0]
    );
    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [40, 50],
      'video-target',
      { width: 400, height: 225 }
    );
    expect(mocks.notifyAISelectionContentRefresh).toHaveBeenCalledTimes(1);
  });

  it('inserts a new video when taskbar follow was disabled after submission', async () => {
    const task = createCompletedImageTask({
      id: 'task-video-unfollowed-before-insert',
      type: TaskType.VIDEO,
      params: {
        prompt: '更新目标视频',
        size: '16:9',
        replaceElementId: 'video-target',
        sourcePrompt: '原视频提示词',
        boundTargetFollowControlled: true,
      },
      result: {
        url: '/__aitu_cache__/video/new-reference-result.mp4',
        format: 'mp4',
        size: 456,
      },
    });
    const originalElement = {
      id: 'video-target',
      type: 'image',
      url: '/__aitu_cache__/video/original.mp4#video',
      isVideo: true,
      videoType: 'video',
      points: [
        [40, 50],
        [440, 275],
      ],
    };
    mocks.boundTargetFollowEnabled = false;
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

    expect(mocks.setNode).not.toHaveBeenCalled();
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'video',
      '/__aitu_cache__/video/new-reference-result.mp4',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({
        prompt: '更新目标视频',
        generationTaskId: task.id,
      }),
      mocks.board,
      expect.any(Function)
    );
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
    expect(mocks.board.children[0]).toBe(originalElement);
  });

  it('replaces a bound text card in place and preserves its geometry', async () => {
    const task: Task = {
      ...createCompletedImageTask(),
      id: 'task-text-replace',
      type: TaskType.CHAT,
      params: {
        prompt: '重写文本卡片',
        replaceElementId: 'card-target',
        sourcePrompt: '原文本提示词',
        boundTargetFollowControlled: true,
      },
      result: {
        url: '',
        format: 'text',
        size: 0,
        chatResponse: '这是更新后的正文',
      },
    };
    const originalElement = {
      id: 'card-target',
      type: 'card',
      title: '原标题',
      body: '原正文',
      fillColor: '#ffffff',
      points: [
        [30, 40],
        [390, 240],
      ],
    };
    mocks.board = { children: [originalElement] };
    mocks.taskState.tasks = [task];

    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.setNode).toHaveBeenCalledWith(
      mocks.board,
      expect.objectContaining({
        body: '这是更新后的正文',
        generationPrompt: '重写文本卡片',
        generationTaskId: 'task-text-replace',
      }),
      [0]
    );
    expect(mocks.setNode).toHaveBeenCalledTimes(1);
    expect(mocks.executeCanvasInsertion).not.toHaveBeenCalled();
    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [30, 40],
      'card-target',
      { width: 360, height: 200 }
    );
    expect(mocks.notifyAISelectionContentRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.board.children).toHaveLength(1);
    expect(mocks.board.children[0]).toBe(originalElement);
  });

  it('inserts new text when taskbar follow was disabled after submission', async () => {
    const task: Task = {
      ...createCompletedImageTask(),
      id: 'task-text-unfollowed-before-insert',
      type: TaskType.CHAT,
      params: {
        prompt: '重写文本卡片',
        replaceElementId: 'card-target',
        sourcePrompt: '原文本提示词',
        boundTargetFollowControlled: true,
      },
      result: {
        url: '',
        format: 'text',
        size: 0,
        chatResponse: '这是新的独立文本',
      },
    };
    const originalElement = {
      id: 'card-target',
      type: 'card',
      title: '原标题',
      body: '原正文',
      fillColor: '#ffffff',
      points: [
        [30, 40],
        [390, 240],
      ],
    };
    mocks.boundTargetFollowEnabled = false;
    mocks.board = { children: [originalElement] };
    mocks.taskState.tasks = [task];

    renderHook(() => useAutoInsertToCanvas({ enabled: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.setNode).not.toHaveBeenCalled();
    expect(mocks.executeCanvasInsertion).toHaveBeenCalledWith(
      expect.objectContaining({
        board: mocks.board,
        items: [
          expect.objectContaining({
            type: 'text',
            content: '这是新的独立文本',
            metadata: {
              prompt: '重写文本卡片',
              generationTaskId: task.id,
            },
          }),
        ],
      })
    );
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'text-1',
      { width: 320, height: 120 }
    );
    expect(mocks.board.children[0]).toBe(originalElement);
  });

  it('replaces a bound native audio node in place and preserves its geometry', async () => {
    const task: Task = {
      ...createCompletedImageTask(),
      id: 'task-audio-replace',
      type: TaskType.AUDIO,
      params: {
        prompt: '生成新的背景音乐',
        title: '新音乐',
        mv: 'chirp-v4',
        replaceElementId: 'audio-target',
        sourcePrompt: '原背景音乐',
      },
      result: {
        url: '/__aitu_cache__/audio/replaced.mp3',
        format: 'mp3',
        size: 456,
        title: '新音乐',
        duration: 187,
        previewImageUrl: '/__aitu_cache__/audio/cover.png',
      },
    };
    const originalElement = {
      id: 'audio-target',
      type: 'audio',
      audioUrl: '/__aitu_cache__/audio/original.mp3',
      title: '原音乐',
      createdAt: 1,
      points: [
        [50, 60],
        [390, 188],
      ],
    };
    mocks.boundTargetFollowEnabled = false;
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

    expect(mocks.setNode).toHaveBeenCalledWith(
      mocks.board,
      expect.objectContaining({
        audioUrl: '/__aitu_cache__/audio/replaced.mp3',
        title: '新音乐',
        duration: 187,
        previewImageUrl: '/__aitu_cache__/audio/cover.png',
        generationPrompt: '生成新的背景音乐',
        generationTaskId: 'task-audio-replace',
      }),
      [0]
    );
    expect(mocks.setNode).toHaveBeenCalledTimes(1);
    expect(mocks.executeCanvasInsertion).not.toHaveBeenCalled();
    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [50, 60],
      'audio-target',
      { width: 340, height: 128 }
    );
    expect(mocks.notifyAISelectionContentRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.board.children).toHaveLength(1);
    expect(mocks.board.children[0]).toBe(originalElement);
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
    expect(mocks.insertGeneratedImageFlow).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
  });

  it('bounds completed task tracking and evicts the least recently used task', async () => {
    const insertedTasks = Array.from(
      { length: STORAGE_LIMITS.MAX_RETAINED_TASKS + 1 },
      (_, index) =>
        createCompletedImageTask({
          id: `task-inserted-${index}`,
          insertedToCanvas: true,
        })
    );
    mocks.board = { children: [] };
    mocks.taskState.tasks = insertedTasks;

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    const oldestTask = {
      ...insertedTasks[0],
      insertedToCanvas: false,
    };
    act(() => {
      emitTaskEvent(oldestTask);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(
      oldestTask.id,
      'auto_insert'
    );

    const newestTask = {
      ...insertedTasks[insertedTasks.length - 1],
      insertedToCanvas: false,
    };
    act(() => {
      emitTaskEvent(newestTask);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).not.toHaveBeenCalledWith(
      newestTask.id,
      'auto_insert'
    );
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
    expect(mocks.insertGeneratedImageFlow).not.toHaveBeenCalled();
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
    expect(mocks.insertGeneratedImageFlow).not.toHaveBeenCalled();
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
