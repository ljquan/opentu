import type { PlaitBoard } from '@plait/core';
import { describe, expect, it, vi } from 'vitest';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { findImageGenerationAnchorForTaskOnBoard } from '../image-generation-anchor-lookup';

vi.mock('../../plugins/with-image-generation-anchor', () => ({
  ImageGenerationAnchorTransforms: {
    getAnchorById: (board: PlaitBoard, anchorId: string) =>
      ((board as unknown as { children: unknown[] }).children ?? []).find(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          (anchor as { id?: string }).id === anchorId
      ) ?? null,
    getAnchorByTaskId: (board: PlaitBoard, taskId: string) =>
      ((board as unknown as { children: unknown[] }).children ?? []).find(
        (anchor) =>
          (anchor as { type?: string }).type === 'generation-anchor' &&
          Array.isArray((anchor as { taskIds?: unknown }).taskIds) &&
          (anchor as { taskIds: string[] }).taskIds.includes(taskId)
      ) ?? null,
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
    getAllAnchors: (board: PlaitBoard) =>
      ((board as unknown as { children: unknown[] }).children ?? []).filter(
        (anchor) => (anchor as { type?: string }).type === 'generation-anchor'
      ),
  },
}));

function createAnchor(
  overrides: Partial<PlaitImageGenerationAnchor> = {}
): PlaitImageGenerationAnchor {
  return {
    id: 'anchor-1',
    type: 'generation-anchor',
    points: [
      [0, 0],
      [320, 180],
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
    expectedInsertPosition: [0, 0],
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

function createBoard(children: unknown[]): PlaitBoard {
  return {
    children,
  } as unknown as PlaitBoard;
}

describe('image-generation-anchor-lookup', () => {
  it('prefers an explicit anchor id from task params', () => {
    const board = createBoard([
      createAnchor({ id: 'anchor-explicit', workflowId: 'wf-other' }),
      createAnchor({ id: 'anchor-workflow' }),
    ]);
    const task = createTask({
      params: {
        prompt: '生成图片',
        workflowId: 'wf-1',
        anchorId: 'anchor-explicit',
        size: '16x9',
      },
    });

    expect(findImageGenerationAnchorForTaskOnBoard(board, task)?.id).toBe(
      'anchor-explicit'
    );
  });

  it('prefers an exact batch-slot anchor when available', () => {
    const board = createBoard([
      createAnchor({
        id: 'anchor-slot-2',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      }),
      createAnchor({ id: 'anchor-legacy' }),
    ]);

    const task = createTask({
      params: {
        prompt: '生成图片',
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
        size: '16x9',
      },
    });

    expect(findImageGenerationAnchorForTaskOnBoard(board, task)?.id).toBe(
      'anchor-slot-2'
    );
  });

  it('falls back to the workflow anchor when legacy boards do not have slot anchors', () => {
    const board = createBoard([createAnchor({ id: 'anchor-legacy' })]);
    const task = createTask({
      params: {
        prompt: '生成图片',
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
        size: '16x9',
      },
    });

    expect(findImageGenerationAnchorForTaskOnBoard(board, task)?.id).toBe(
      'anchor-legacy'
    );
  });

  it('prefers legacy workflow anchors over unrelated slot anchors during fallback', () => {
    const board = createBoard([
      createAnchor({
        id: 'anchor-slot-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 1,
        batchTotal: 4,
      }),
      createAnchor({
        id: 'anchor-legacy',
      }),
    ]);
    const task = createTask({
      params: {
        prompt: '生成图片',
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 3,
        batchTotal: 4,
        size: '16x9',
      },
    });

    expect(findImageGenerationAnchorForTaskOnBoard(board, task)?.id).toBe(
      'anchor-legacy'
    );
  });

  it('finds independent slot anchors for legacy tasks that only keep batch metadata', () => {
    const board = createBoard([
      createAnchor({
        id: 'anchor-slot-2',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      }),
    ]);
    const task = createTask({
      params: {
        prompt: '生成图片',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
        size: '16x9',
      },
    });

    expect(findImageGenerationAnchorForTaskOnBoard(board, task)?.id).toBe(
      'anchor-slot-2'
    );
  });

  it('ignores stack anchors when legacy batch fallback looks for independent slots', () => {
    const board = createBoard([
      createAnchor({
        id: 'anchor-stack',
        anchorType: 'stack',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      }),
      createAnchor({
        id: 'anchor-slot-2',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      }),
    ]);
    const task = createTask({
      params: {
        prompt: '生成图片',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
        size: '16x9',
      },
    });

    expect(findImageGenerationAnchorForTaskOnBoard(board, task)?.id).toBe(
      'anchor-slot-2'
    );
  });

  it('still prioritizes an explicit taskId binding over workflow metadata', () => {
    const board = createBoard([
      createAnchor({
        id: 'anchor-by-task',
        taskIds: ['task-1'],
      }),
      createAnchor({
        id: 'anchor-slot-2',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      }),
    ]);
    const task = createTask({
      params: {
        prompt: '生成图片',
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
        size: '16x9',
      },
    });

    expect(findImageGenerationAnchorForTaskOnBoard(board, task)?.id).toBe(
      'anchor-by-task'
    );
  });
});
