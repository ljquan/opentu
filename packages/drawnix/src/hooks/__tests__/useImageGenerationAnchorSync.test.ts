import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { useImageGenerationAnchorSync } from '../useImageGenerationAnchorSync';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type PlaitImageGenerationAnchor,
} from '../../types/image-generation-anchor.types';

const taskListeners: Array<(event: { task: Task }) => void> = [];
const completionListeners: Array<(event: { taskId: string }) => void> = [];
const taskState = {
  tasks: [] as Task[],
};
const completionState = {
  byTaskId: new Map<
    string,
    {
      taskId: string;
      status: 'pending' | 'processing' | 'completed' | 'failed';
      type: 'direct_insert';
      firstElementPosition?: [number, number];
      firstElementId?: string;
      firstElementSize?: { width: number; height: number };
      error?: string;
    }
  >(),
};

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    getAllTasks: () => taskState.tasks,
    observeTaskUpdates: () => ({
      subscribe: (listener: (event: { task: Task }) => void) => {
        taskListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = taskListeners.indexOf(listener);
            if (index >= 0) {
              taskListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  },
}));

vi.mock('../../services/workflow-completion-service', () => ({
  workflowCompletionService: {
    getPostProcessingStatus: (taskId: string) =>
      completionState.byTaskId.get(taskId),
    observeCompletionEvents: () => ({
      subscribe: (listener: (event: { taskId: string }) => void) => {
        completionListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = completionListeners.indexOf(listener);
            if (index >= 0) {
              completionListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  },
}));

vi.mock('../../plugins/with-image-generation-anchor', () => ({
  ImageGenerationAnchorTransforms: {
    getAnchorById: (board: PlaitBoard, anchorId: string) =>
      ((board as unknown as { children: unknown[] }).children ?? []).find(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          (anchor as { id?: string }).id === anchorId
      ) ?? null,
    getAllAnchors: (board: PlaitBoard) =>
      ((board as unknown as { children: unknown[] }).children ?? []).filter(
        (anchor) => (anchor as { type?: string }).type === 'generation-anchor'
      ),
    getAnchorByTaskId: (board: PlaitBoard, taskId: string) =>
      ((board as unknown as { children: unknown[] }).children ?? []).find(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          Array.isArray((anchor as { taskIds?: unknown }).taskIds) &&
          (anchor as { taskIds: string[] }).taskIds.includes(taskId)
      ) ?? null,
    getAnchorByWorkflowId: (board: PlaitBoard, workflowId: string) =>
      ((board as unknown as { children: unknown[] }).children ?? []).find(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          (anchor as { workflowId?: string }).workflowId === workflowId
      ) ?? null,
    getAnchorsByWorkflowId: (board: PlaitBoard, workflowId: string) =>
      ((board as unknown as { children: unknown[] }).children ?? []).filter(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          (anchor as { workflowId?: string }).workflowId === workflowId
      ),
    getAnchorByBatchSlot: (
      board: PlaitBoard,
      options: {
        workflowId?: string;
        batchId?: string;
        batchIndex?: number;
      }
    ) =>
      ((board as unknown as { children: unknown[] }).children ?? []).find(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          (anchor as { workflowId?: string }).workflowId ===
            options.workflowId &&
          (anchor as { batchId?: string }).batchId === options.batchId &&
          (anchor as { batchIndex?: number }).batchIndex === options.batchIndex
      ) ?? null,
    updateAnchor: (
      board: PlaitBoard,
      anchorId: string,
      patch: Partial<PlaitImageGenerationAnchor>
    ) => {
      const boardState = board as unknown as {
        children: unknown[];
      };
      const index = boardState.children.findIndex(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          (anchor as { id?: string }).id === anchorId
      );
      if (index >= 0) {
        boardState.children[index] = {
          ...(boardState.children[index] as Record<string, unknown>),
          ...patch,
        };
      }
    },
    removeAnchor: (board: PlaitBoard, anchorId: string) => {
      const boardState = board as unknown as {
        children: unknown[];
      };
      boardState.children = boardState.children.filter(
        (anchor) =>
          (anchor as { type?: string }).type !== 'generation-anchor' ||
          (anchor as { id?: string }).id !== anchorId
      );
    },
  },
}));

function createAnchor(
  overrides: Partial<PlaitImageGenerationAnchor> = {}
): PlaitImageGenerationAnchor {
  return {
    id: 'anchor-1',
    type: 'generation-anchor',
    points: [
      [10, 20],
      [330, 200],
    ],
    angle: 0,
    anchorType: 'ratio',
    phase: 'submitted',
    title: '图片生成',
    subtitle: '已提交，等待执行',
    progress: null,
    error: undefined,
    transitionMode: 'hold',
    createdAt: 1,
    workflowId: 'wf-1',
    taskIds: [],
    primaryTaskId: undefined,
    batchId: undefined,
    batchIndex: undefined,
    batchTotal: undefined,
    expectedInsertPosition: [10, 20],
    targetFrameId: undefined,
    targetFrameDimensions: undefined,
    requestedSize: '16x9',
    requestedCount: 1,
    zoom: 1,
    children: [],
    ...overrides,
  };
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PENDING,
    params: {
      prompt: '生成图片',
      workflowId: 'wf-1',
      size: '16x9',
    },
    createdAt: 1,
    updatedAt: 1,
    insertedToCanvas: false,
    ...overrides,
  };
}

function createImageElement(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'image-1',
    type: 'image',
    points: [
      [200, 300],
      [690, 578],
    ],
    ...overrides,
  };
}

function createBoard(
  anchor: PlaitImageGenerationAnchor,
  extraChildren: unknown[] = []
): PlaitBoard {
  return {
    children: [anchor, ...extraChildren],
  } as unknown as PlaitBoard;
}

function emitTaskUpdate(task: Task): void {
  taskListeners.forEach((listener) => listener({ task }));
}

function emitCompletion(taskId: string): void {
  completionListeners.forEach((listener) => listener({ taskId }));
}

describe('useImageGenerationAnchorSync', () => {
  beforeEach(() => {
    taskListeners.length = 0;
    completionListeners.length = 0;
    taskState.tasks = [];
    completionState.byTaskId.clear();
    vi.useRealTimers();
  });

  it('recovers task binding and queued phase on mount via workflowId', () => {
    const board = createBoard(createAnchor());
    taskState.tasks = [
      createTask({
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
      }),
    ];

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    const [anchor] = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchor.taskIds).toEqual(['task-1']);
    expect(anchor.primaryTaskId).toBe('task-1');
    expect(anchor.phase).toBe('queued');
    expect(anchor.subtitle).toBe('请求已受理，等待执行');
  });

  it('only binds a batched task to its matching independent anchor', () => {
    const board = {
      children: [
        createAnchor({
          id: 'anchor-1',
          batchId: 'wf_batch_wf-1',
          batchIndex: 1,
          batchTotal: 2,
          requestedCount: 1,
        }),
        createAnchor({
          id: 'anchor-2',
          batchId: 'wf_batch_wf-1',
          batchIndex: 2,
          batchTotal: 2,
          requestedCount: 1,
        }),
      ],
    } as unknown as PlaitBoard;
    taskState.tasks = [
      createTask({
        id: 'task-2',
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        params: {
          prompt: '生成图片',
          workflowId: 'wf-1',
          batchId: 'wf_batch_wf-1',
          batchIndex: 2,
          batchTotal: 2,
          size: '16x9',
        },
      }),
    ];

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    const anchors = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchors[0].taskIds).toEqual([]);
    expect(anchors[1].taskIds).toEqual(['task-2']);
    expect(anchors[1].primaryTaskId).toBe('task-2');
  });

  it('updates anchor to failed when post-processing fails', () => {
    const board = createBoard(createAnchor({ taskIds: ['task-1'] }));
    taskState.tasks = [
      createTask({
        status: TaskStatus.COMPLETED,
      }),
    ];
    completionState.byTaskId.set('task-1', {
      taskId: 'task-1',
      status: 'failed',
      type: 'direct_insert',
      error: '插入失败',
    });

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    const [anchor] = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchor.phase).toBe('failed');
    expect(anchor.error).toBe('插入失败');
  });

  it('does not complete a stack anchor before the requested slot count is covered', () => {
    const board = createBoard(
      createAnchor({
        anchorType: 'stack',
        taskIds: ['task-1'],
        requestedCount: 4,
        phase: 'inserting',
      })
    );
    taskState.tasks = [
      createTask({
        status: TaskStatus.COMPLETED,
        insertedToCanvas: true,
      }),
    ];
    completionState.byTaskId.set('task-1', {
      taskId: 'task-1',
      status: 'completed',
      type: 'direct_insert',
      firstElementPosition: [120, 240],
    });

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    const [anchor] = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchor.phase).not.toBe('completed');
    expect(anchor.phase).toBe('developing');
  });

  it('removes anchor after completed insertion settles', () => {
    vi.useFakeTimers();

    const board = createBoard(
      createAnchor({ taskIds: ['task-1'], phase: 'inserting' })
    );
    taskState.tasks = [
      createTask({
        status: TaskStatus.COMPLETED,
        insertedToCanvas: true,
      }),
    ];
    completionState.byTaskId.set('task-1', {
      taskId: 'task-1',
      status: 'completed',
      type: 'direct_insert',
      firstElementPosition: [120, 240],
    });

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    let anchors = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchors[0]?.phase).toBe('completed');
    expect(anchors[0]?.transitionMode).toBe('morph');

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    anchors = (board as unknown as { children: PlaitImageGenerationAnchor[] })
      .children;
    expect(anchors).toHaveLength(0);
  });

  it('reconciles on task and completion events after mount', () => {
    const board = createBoard(createAnchor(), [createImageElement()]);
    taskState.tasks = [createTask()];

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    const processingTask = createTask({
      status: TaskStatus.PROCESSING,
      executionPhase: undefined,
      updatedAt: 2,
    });
    taskState.tasks = [processingTask];

    act(() => {
      emitTaskUpdate(processingTask);
    });

    let [anchor] = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchor.phase).toBe('generating');

    const completedTask = createTask({
      status: TaskStatus.COMPLETED,
      insertedToCanvas: true,
      updatedAt: 3,
      result: {
        url: 'https://example.com/generated.png',
      },
    });
    taskState.tasks = [completedTask];
    completionState.byTaskId.set('task-1', {
      taskId: 'task-1',
      status: 'completed',
      type: 'direct_insert',
      firstElementPosition: [200, 300],
      firstElementId: 'image-1',
      firstElementSize: { width: 480, height: 270 },
    });

    act(() => {
      emitCompletion('task-1');
    });

    [anchor] = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchor.phase).toBe('completed');
    expect(anchor.expectedInsertPosition).toEqual([200, 300]);
    expect(anchor.previewImageUrl).toBe('https://example.com/generated.png');
    expect(anchor.resultElementId).toBe('image-1');
    expect(anchor.prompt).toBe('生成图片');
    expect(anchor.latestTaskId).toBe('task-1');
    expect(anchor.points).toEqual([
      [200, 300],
      [690, 578],
    ]);
  });

  it('does not restore the old target after follow-controlled insertion creates a new image', () => {
    const board = createBoard(
      createAnchor({
        taskIds: ['task-1'],
        targetElementId: 'image-target',
      }),
      [createImageElement({ id: 'image-new' })]
    );
    taskState.tasks = [
      createTask({
        status: TaskStatus.COMPLETED,
        insertedToCanvas: true,
        params: {
          prompt: '生成新图片',
          workflowId: 'wf-1',
          size: '16x9',
          replaceElementId: 'image-target',
          targetElementId: 'image-target',
          boundTargetFollowControlled: true,
        },
        result: {
          url: 'https://example.com/generated-new.png',
        },
      }),
    ];
    completionState.byTaskId.set('task-1', {
      taskId: 'task-1',
      status: 'completed',
      type: 'direct_insert',
      firstElementPosition: [200, 300],
      firstElementId: 'image-new',
      firstElementSize: { width: 480, height: 270 },
    });

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    const [anchor] = (
      board as unknown as { children: PlaitImageGenerationAnchor[] }
    ).children;
    expect(anchor.resultElementId).toBe('image-new');
    expect(anchor.targetElementId).toBeUndefined();
  });

  it('reconciles stale completed anchors before dispatching retry', () => {
    vi.useFakeTimers();

    const board = createBoard(
      createAnchor({
        taskIds: ['task-1'],
        primaryTaskId: 'task-1',
        phase: 'developing',
      }),
      [createImageElement()]
    );
    taskState.tasks = [
      createTask({
        status: TaskStatus.PROCESSING,
      }),
    ];
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    renderHook(() => useImageGenerationAnchorSync({ board, enabled: true }));

    const boardState = board as unknown as {
      children: PlaitImageGenerationAnchor[];
    };
    boardState.children[0] = {
      ...boardState.children[0],
      phase: 'developing',
    };

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    taskState.tasks = [
      createTask({
        status: TaskStatus.COMPLETED,
        insertedToCanvas: true,
        result: {
          url: 'https://example.com/generated.png',
        },
      }),
    ];
    completionState.byTaskId.set('task-1', {
      taskId: 'task-1',
      status: 'completed',
      type: 'direct_insert',
      firstElementPosition: [200, 300],
      firstElementId: 'image-1',
      firstElementSize: { width: 480, height: 278 },
    });

    act(() => {
      vi.advanceTimersByTime(50_000);
    });

    const retryEvents = dispatchSpy.mock.calls.filter(
      ([event]) => event.type === IMAGE_GENERATION_ANCHOR_RETRY_EVENT
    );
    expect(retryEvents).toHaveLength(0);
    expect(boardState.children[0]?.phase).toBe('completed');

    dispatchSpy.mockRestore();
  });
});
