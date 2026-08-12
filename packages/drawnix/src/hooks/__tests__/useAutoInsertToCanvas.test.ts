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
    retargetCanvasAssociationLines: vi.fn(),
    imageAnchorByTask: null as any,
    isGridImageTask: vi.fn(),
    isInspirationBoardTask: vi.fn(),
    handleSplitAndInsertTask: vi.fn(),
    splitAndInsertImages: vi.fn(),
    currentBoardId: 'board-1' as string | null,
    boundBoardId: 'board-1' as string | null,
  };
});

vi.mock('@plait/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plait/core')>();
  return {
    ...actual,
    Transforms: {
      ...actual.Transforms,
      setNode: mocks.setNode,
      removeNode: mocks.removeNode,
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
  getInsertionPointBelowBottommostElement: vi.fn(() => [100, 100]),
  notifyAISelectionContentRefresh: mocks.notifyAISelectionContentRefresh,
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
    mocks.retargetCanvasAssociationLines.mockReset();
    mocks.imageAnchorByTask = null;
    mocks.isGridImageTask.mockReset();
    mocks.isGridImageTask.mockReturnValue(false);
    mocks.isInspirationBoardTask.mockReset();
    mocks.isInspirationBoardTask.mockReturnValue(false);
    mocks.handleSplitAndInsertTask.mockReset();
    mocks.splitAndInsertImages.mockReset();
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
      { width: 512, height: 512 },
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

  it('replaces a bound video in place and preserves its geometry', async () => {
    const task = createCompletedImageTask({
      id: 'task-video-replace',
      type: TaskType.VIDEO,
      params: {
        prompt: '更新目标视频',
        size: '16:9',
        replaceElementId: 'video-target',
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

  it('replaces a bound text card in place and preserves its geometry', async () => {
    const task: Task = {
      ...createCompletedImageTask(),
      id: 'task-text-replace',
      type: TaskType.CHAT,
      params: {
        prompt: '重写文本卡片',
        replaceElementId: 'card-target',
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
