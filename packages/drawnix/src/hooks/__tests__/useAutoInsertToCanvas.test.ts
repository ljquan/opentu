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
    executeCanvasInsertion: vi.fn(),
    insertGeneratedImageFlow: vi.fn(),
    insertAIFlow: vi.fn(),
    notifyAISelectionContentRefresh: vi.fn(),
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
  executeCanvasInsertion: mocks.executeCanvasInsertion,
  insertGeneratedImageFlow: mocks.insertGeneratedImageFlow,
  insertAIFlow: mocks.insertAIFlow,
  insertImageGroup: mocks.insertImageGroup,
  parseSizeToPixels: vi.fn(() => ({ width: 512, height: 512 })),
  quickInsert: mocks.quickInsert,
}));

vi.mock('../../data/audio', () => ({
  AUDIO_CARD_DEFAULT_HEIGHT: 144,
  AUDIO_CARD_DEFAULT_WIDTH: 360,
  buildAudioImageElement: vi.fn(),
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
    mocks.executeCanvasInsertion.mockReset();
    mocks.executeCanvasInsertion.mockResolvedValue({
      success: true,
      data: { insertedCount: 1, items: [] },
    });
    mocks.notifyAISelectionContentRefresh.mockReset();
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
      })
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
      })
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
      })
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
      })
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
        [100, 100]
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

    expect(mocks.executeCanvasInsertion).toHaveBeenCalledWith({
      items: expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            prompt: '两段环境音乐',
            generationTaskId: 'task-multi-audio',
          }),
        }),
      ]),
      startPoint: [100, 100],
    });
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

    expect(mocks.executeCanvasInsertion).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          type: 'text',
          metadata: {
            prompt: '总结会议纪要',
            generationTaskId: 'task-text',
          },
        }),
      ],
    });
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
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(task.id, 1);
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
      expect.objectContaining({ generationTaskId: 'task-video-batch-1' })
    );
    expect(mocks.quickInsert).toHaveBeenNthCalledWith(
      2,
      'video',
      '/__aitu_cache__/video/batch-2.mp4',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({ generationTaskId: 'task-video-batch-2' })
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
