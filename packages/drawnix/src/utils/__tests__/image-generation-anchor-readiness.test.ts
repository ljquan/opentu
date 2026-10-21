import { describe, expect, it } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import {
  registerCanvasImage,
  isCanvasImageReady,
  subscribeCanvasImageReadiness,
} from '../../services/canvas-image-readiness';
import { areImageGenerationResultsReady } from '../image-generation-anchor-readiness';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

function task(id: string): Task {
  return {
    id,
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: { prompt: 'test' },
    createdAt: 1,
    updatedAt: 1,
  };
}

function image(id: string, taskId: string) {
  return {
    id,
    type: 'image',
    generationTaskId: taskId,
    url: `/__aitu_cache__/image/${id}.png`,
  };
}

const anchor = { id: 'anchor-1' } as PlaitImageGenerationAnchor;

describe('canvas result readiness', () => {
  it('waits for every image of every task, ignoring unrelated images and previews', () => {
    const images = [
      image('a', 'task-1'),
      image('b', 'task-1'),
      image('c', 'task-2'),
    ];
    const board = {
      children: [...images, image('other', 'other-task')],
    } as unknown as PlaitBoard;
    const tasks = [task('task-1'), task('task-2')];
    const renders = images.map((item) =>
      registerCanvasImage(board, item.id, item.url)
    );
    expect(areImageGenerationResultsReady(board, anchor, tasks)).toBe(false);
    renders[0].setReady(true);
    renders[1].setReady(true);
    expect(areImageGenerationResultsReady(board, anchor, tasks)).toBe(false);
    renders[2].setReady(true);
    expect(areImageGenerationResultsReady(board, anchor, tasks)).toBe(true);
    renders[1].setReady(false);
    expect(areImageGenerationResultsReady(board, anchor, tasks)).toBe(false);
  });

  it('does not accept a loaded result when another task has no canvas image', () => {
    const item = image('a', 'task-1');
    const board = { children: [item] } as unknown as PlaitBoard;
    registerCanvasImage(board, item.id, item.url).setReady(true);
    expect(
      areImageGenerationResultsReady(board, anchor, [
        task('task-1'),
        task('task-2'),
      ])
    ).toBe(false);
  });

  it('isolates boards and rejects stale source acknowledgements and cleanup', () => {
    const board = {} as PlaitBoard;
    const otherBoard = {} as PlaitBoard;
    const oldRender = registerCanvasImage(board, 'a', 'old.png');
    oldRender.setReady(true);
    expect(isCanvasImageReady(otherBoard, 'a', 'old.png')).toBe(false);
    const newRender = registerCanvasImage(board, 'a', 'new.png');
    oldRender.setReady(true);
    oldRender.dispose();
    expect(isCanvasImageReady(board, 'a', 'old.png')).toBe(false);
    expect(isCanvasImageReady(board, 'a', 'new.png')).toBe(false);
    newRender.setReady(true);
    expect(isCanvasImageReady(board, 'a', 'new.png')).toBe(true);
    newRender.dispose();
    expect(isCanvasImageReady(board, 'a', 'new.png')).toBe(false);
  });

  it('notifies subscribers only until they unsubscribe', () => {
    const board = {} as PlaitBoard;
    let notifications = 0;
    const unsubscribe = subscribeCanvasImageReadiness(board, () => {
      notifications++;
    });
    const render = registerCanvasImage(board, 'a', 'a.png');
    render.setReady(true);
    expect(notifications).toBe(2);
    unsubscribe();
    render.dispose();
    expect(notifications).toBe(2);
  });
});
