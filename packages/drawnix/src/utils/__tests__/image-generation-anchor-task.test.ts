import { describe, expect, it } from 'vitest';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  doesTaskBelongToImageGenerationAnchor,
  getImageGenerationTaskInsertGroupKey,
  isIndependentBatchImageGenerationAnchor,
} from '../image-generation-anchor-task';

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

describe('image-generation-anchor-task', () => {
  it('matches a single anchor by workflow id when no batch metadata exists', () => {
    expect(
      doesTaskBelongToImageGenerationAnchor(createAnchor(), createTask())
    ).toBe(true);
  });

  it('matches a task to its explicit anchor id', () => {
    expect(
      doesTaskBelongToImageGenerationAnchor(
        createAnchor({ id: 'anchor-explicit', workflowId: 'wf-other' }),
        createTask({
          params: {
            prompt: '生成图片',
            workflowId: 'wf-1',
            anchorId: 'anchor-explicit',
            size: '16x9',
          },
        })
      )
    ).toBe(true);
  });

  it('isolates image replacement tasks from normal prompt grouping', () => {
    const task = createTask({
      id: 'task-replace',
      params: {
        prompt: '更新目标图',
        workflowId: 'wf-1',
        replaceElementId: 'image-1',
      },
    });

    expect(getImageGenerationTaskInsertGroupKey(task)).toBe(
      'replace-image:image-1:task-replace'
    );
  });

  it('matches a batched independent anchor only when batch slot matches', () => {
    const anchor = createAnchor({
      batchId: 'wf_batch_wf-1',
      batchIndex: 2,
      batchTotal: 4,
    });

    expect(
      doesTaskBelongToImageGenerationAnchor(
        anchor,
        createTask({
          params: {
            prompt: '生成图片',
            workflowId: 'wf-1',
            batchId: 'wf_batch_wf-1',
            batchIndex: 2,
            batchTotal: 4,
            size: '16x9',
          },
        })
      )
    ).toBe(true);

    expect(
      doesTaskBelongToImageGenerationAnchor(
        anchor,
        createTask({
          id: 'task-2',
          params: {
            prompt: '生成图片',
            workflowId: 'wf-1',
            batchId: 'wf_batch_wf-1',
            batchIndex: 1,
            batchTotal: 4,
            size: '16x9',
          },
        })
      )
    ).toBe(false);
  });

  it('matches independent anchors by batch slot even when legacy tasks miss workflowId', () => {
    const anchor = createAnchor({
      batchId: 'wf_batch_wf-1',
      batchIndex: 2,
      batchTotal: 4,
    });

    expect(
      doesTaskBelongToImageGenerationAnchor(
        anchor,
        createTask({
          params: {
            prompt: '生成图片',
            batchId: 'wf_batch_wf-1',
            batchIndex: 2,
            batchTotal: 4,
            size: '16x9',
          },
        })
      )
    ).toBe(true);
  });

  it('detects independent batch anchors and uses slot-level insert group keys', () => {
    const anchor = createAnchor({
      batchId: 'wf_batch_wf-1',
      batchIndex: 2,
      batchTotal: 4,
    });
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

    expect(isIndependentBatchImageGenerationAnchor(anchor)).toBe(true);
    expect(getImageGenerationTaskInsertGroupKey(task, anchor)).toBe(
      'slot:wf-1:wf_batch_wf-1:2'
    );
  });

  it('keeps workflow-level insert grouping for legacy single anchors', () => {
    const anchor = createAnchor();
    const task = createTask();

    expect(isIndependentBatchImageGenerationAnchor(anchor)).toBe(false);
    expect(getImageGenerationTaskInsertGroupKey(task, anchor)).toBe('wf-1');
  });

  it('keeps workflow-level grouping for legacy stack anchors', () => {
    const anchor = createAnchor({
      anchorType: 'stack',
      batchId: 'wf_batch_wf-1',
      batchIndex: 2,
      batchTotal: 4,
    });
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

    expect(isIndependentBatchImageGenerationAnchor(anchor)).toBe(false);
    expect(getImageGenerationTaskInsertGroupKey(task, anchor)).toBe('wf-1');
  });

  it('matches legacy stack anchors by workflow instead of slot', () => {
    const anchor = createAnchor({
      anchorType: 'stack',
      batchId: 'wf_batch_wf-1',
      batchIndex: 2,
      batchTotal: 4,
    });

    expect(
      doesTaskBelongToImageGenerationAnchor(
        anchor,
        createTask({
          params: {
            prompt: '生成图片',
            workflowId: 'wf-1',
            batchId: 'wf_batch_wf-1',
            batchIndex: 1,
            batchTotal: 4,
            size: '16x9',
          },
        })
      )
    ).toBe(true);
  });

  it('falls back to anchor-level grouping for independent anchors when workflow metadata is missing', () => {
    const anchor = createAnchor({
      id: 'anchor-slot-2',
      batchId: 'wf_batch_wf-1',
      batchIndex: 2,
      batchTotal: 4,
    });
    const task = createTask({
      params: {
        prompt: '生成图片',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
        size: '16x9',
      },
    });

    expect(getImageGenerationTaskInsertGroupKey(task, anchor)).toBe(
      'anchor-slot:anchor-slot-2'
    );
  });

  it('uses slot-level grouping for independent batch image tasks without anchor context', () => {
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

    expect(getImageGenerationTaskInsertGroupKey(task)).toBe(
      'slot:wf-1:wf_batch_wf-1:3'
    );
  });

  it('uses per-frame grouping for PPT slide image tasks', () => {
    const task = createTask({
      id: 'task-ppt-1',
      params: {
        prompt: '生成 PPT 页面',
        pptSlideImage: true,
        targetFrameId: 'frame-1',
        size: '16x9',
      },
    });

    expect(getImageGenerationTaskInsertGroupKey(task)).toBe(
      'ppt-slide:frame-1:task-ppt-1'
    );
  });

  it('groups PPT slide batch image tasks by frame and batch', () => {
    const task = createTask({
      id: 'task-ppt-1',
      params: {
        prompt: '生成 PPT 页面',
        pptSlideImage: true,
        targetFrameId: 'frame-1',
        batchId: 'batch-1',
        batchIndex: 2,
        batchTotal: 3,
        size: '16x9',
      },
    });

    expect(getImageGenerationTaskInsertGroupKey(task)).toBe(
      'ppt-slide:frame-1:batch-1'
    );
  });

  it('prefixes non-image tasks to avoid cross-media regrouping', () => {
    const task = createTask({
      type: TaskType.VIDEO,
      params: {
        prompt: '生成视频',
        workflowId: 'wf-2',
        size: '16x9',
      },
    });

    expect(getImageGenerationTaskInsertGroupKey(task)).toBe('video:wf-2');
  });

  it('separates lyrics tasks from regular audio groups', () => {
    const task = createTask({
      type: TaskType.AUDIO,
      params: {
        prompt: '写一段歌词',
        workflowId: 'wf-lyrics',
      },
      result: {
        url: 'https://example.com/lyrics.txt',
        format: 'lyrics',
        size: 128,
        resultKind: 'lyrics',
        lyricsText: '春风轻轻吹过山野',
      },
    });

    expect(getImageGenerationTaskInsertGroupKey(task)).toBe('lyrics:wf-lyrics');
  });
});
