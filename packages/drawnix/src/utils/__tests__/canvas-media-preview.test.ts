import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  bindImageTaskToCanvasInsertion,
  createCanvasMediaDimensionResolver,
  type CanvasMediaTaskLookup,
} from '../canvas-media-preview';

const mocks = vi.hoisted(() => ({
  setNode: vi.fn(),
}));

vi.mock('@plait/core', () => ({
  Transforms: {
    setNode: mocks.setNode,
  },
}));

function createImageTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: { prompt: 'draw a rabbit' },
    result: {
      url: 'https://example.com/rabbit.png',
      format: 'png',
      size: 0,
      width: 1023,
      height: 1537,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function getTaskResultUrl(task: Task): string {
  const url = task.result?.url;
  if (!url) throw new Error('Expected the test image task to include a URL');
  return url;
}

function createLookup(overrides: Partial<CanvasMediaTaskLookup> = {}) {
  return {
    getTask: vi.fn<CanvasMediaTaskLookup['getTask']>(() => undefined),
    getCompleteTask: vi.fn<CanvasMediaTaskLookup['getCompleteTask']>(
      async () => undefined
    ),
    findImageTaskByResultUrl: vi.fn<
      CanvasMediaTaskLookup['findImageTaskByResultUrl']
    >(async () => undefined),
    ...overrides,
  };
}

describe('canvas media preview dimensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the bound in-memory task after its image URL is cached locally', async () => {
    const task = createImageTask();
    const lookup = createLookup({ getTask: vi.fn(() => task) });
    const resolveDimensions = createCanvasMediaDimensionResolver(lookup);

    await expect(
      resolveDimensions({
        type: 'image',
        url: '/__aitu_cache__/image/cached-rabbit.png',
        generationTaskId: task.id,
      })
    ).resolves.toEqual({ width: 1023, height: 1537 });
    expect(lookup.getCompleteTask).not.toHaveBeenCalled();
    expect(lookup.findImageTaskByResultUrl).not.toHaveBeenCalled();
  });

  it('loads a persisted task when the task is absent from memory', async () => {
    const task = createImageTask();
    const lookup = createLookup({
      getCompleteTask: vi.fn(async () => task),
    });
    const resolveDimensions = createCanvasMediaDimensionResolver(lookup);

    await expect(
      resolveDimensions({
        type: 'image',
        url: getTaskResultUrl(task),
        generationTaskId: task.id,
      })
    ).resolves.toEqual({ width: 1023, height: 1537 });
    expect(lookup.findImageTaskByResultUrl).not.toHaveBeenCalled();
  });

  it('uses persisted dimensions when the in-memory task is incomplete', async () => {
    const persistedTask = createImageTask();
    const lookup = createLookup({
      getTask: vi.fn(() =>
        createImageTask({
          status: TaskStatus.PROCESSING,
          result: undefined,
        })
      ),
      getCompleteTask: vi.fn(async () => persistedTask),
    });
    const resolveDimensions = createCanvasMediaDimensionResolver(lookup);

    await expect(
      resolveDimensions({
        type: 'image',
        url: getTaskResultUrl(persistedTask),
        generationTaskId: persistedTask.id,
      })
    ).resolves.toEqual({ width: 1023, height: 1537 });
    expect(lookup.getCompleteTask).toHaveBeenCalledWith(persistedTask.id);
  });

  it('falls back to a historical URL match for an unbound canvas image', async () => {
    const task = createImageTask();
    const lookup = createLookup({
      findImageTaskByResultUrl: vi.fn(async () => task),
    });
    const resolveDimensions = createCanvasMediaDimensionResolver(lookup);

    await expect(
      resolveDimensions({ type: 'image', url: getTaskResultUrl(task) })
    ).resolves.toBeNull();
    expect(lookup.findImageTaskByResultUrl).not.toHaveBeenCalled();

    await expect(
      resolveDimensions(
        { type: 'image', url: getTaskResultUrl(task) },
        { allowUrlFallback: true }
      )
    ).resolves.toEqual({ width: 1023, height: 1537 });
    expect(lookup.findImageTaskByResultUrl).toHaveBeenCalledWith(
      getTaskResultUrl(task)
    );
  });

  it('deduplicates repeated lookups for the same canvas item', async () => {
    const task = createImageTask();
    const lookup = createLookup({ getTask: vi.fn(() => task) });
    const resolveDimensions = createCanvasMediaDimensionResolver(lookup);
    const first = resolveDimensions({
      type: 'image',
      url: getTaskResultUrl(task),
      generationTaskId: task.id,
    });
    const second = resolveDimensions({
      type: 'image',
      url: getTaskResultUrl(task),
      generationTaskId: task.id,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { width: 1023, height: 1537 },
      { width: 1023, height: 1537 },
    ]);
    expect(lookup.getTask).toHaveBeenCalledTimes(1);
  });

  it('treats an explicit task ID as authoritative over a rewritten canvas URL', async () => {
    const task = createImageTask();
    const lookup = createLookup({
      getTask: vi.fn(() => task),
    });
    const resolveDimensions = createCanvasMediaDimensionResolver(lookup);

    await expect(
      resolveDimensions(
        {
          type: 'image',
          url: '/asset-library/cached-rabbit.png',
          generationTaskId: task.id,
        },
        { allowUrlFallback: true }
      )
    ).resolves.toEqual({ width: 1023, height: 1537 });
    expect(lookup.getCompleteTask).not.toHaveBeenCalled();
    expect(lookup.findImageTaskByResultUrl).not.toHaveBeenCalled();
  });

  it('returns no dimensions for invalid, non-image, or failed lookups', async () => {
    const invalidTask = createImageTask({
      result: {
        url: 'https://example.com/invalid.png',
        format: 'png',
        size: 0,
        width: 0,
        height: 1537,
      },
    });
    const invalidLookup = createLookup({
      getTask: vi.fn(() => invalidTask),
    });
    const invalidResolver = createCanvasMediaDimensionResolver(invalidLookup);

    await expect(
      invalidResolver({
        type: 'image',
        url: getTaskResultUrl(invalidTask),
        generationTaskId: invalidTask.id,
      })
    ).resolves.toBeNull();

    const failedLookup = createLookup({
      findImageTaskByResultUrl: vi.fn(async () => {
        throw new Error('IndexedDB unavailable');
      }),
    });
    const failedResolver = createCanvasMediaDimensionResolver(failedLookup);
    await expect(
      failedResolver(
        { type: 'image', url: 'https://example.com/missing.png' },
        { allowUrlFallback: true }
      )
    ).resolves.toBeNull();

    const videoResolver = createCanvasMediaDimensionResolver(failedLookup);
    await expect(
      videoResolver({ type: 'video', url: 'https://example.com/video.mp4' })
    ).resolves.toBeNull();
    expect(failedLookup.getTask).not.toHaveBeenCalled();
  });
});

describe('bindImageTaskToCanvasInsertion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists one task association for each inserted image element', () => {
    const board = {
      children: [{ id: 'image-a' }, { id: 'video-a' }, { id: 'image-b' }],
    } as unknown as PlaitBoard;

    const boundCount = bindImageTaskToCanvasInsertion(
      board,
      {
        success: true,
        data: {
          insertedCount: 4,
          items: [
            {
              type: 'image',
              point: [0, 0],
              elementId: 'image-a',
              size: { width: 400, height: 600 },
            },
            {
              type: 'video',
              point: [420, 0],
              elementId: 'video-a',
              size: { width: 400, height: 225 },
            },
            {
              type: 'image',
              point: [840, 0],
              elementId: 'image-b',
              size: { width: 400, height: 600 },
            },
            {
              type: 'image',
              point: [0, 620],
              elementId: 'image-a',
              size: { width: 400, height: 600 },
            },
          ],
        },
      },
      ' task-1 '
    );

    expect(boundCount).toBe(2);
    expect(mocks.setNode).toHaveBeenNthCalledWith(
      1,
      board,
      { generationTaskId: 'task-1' },
      [0]
    );
    expect(mocks.setNode).toHaveBeenNthCalledWith(
      2,
      board,
      { generationTaskId: 'task-1' },
      [2]
    );
  });

  it('does not mutate the board for failed or incomplete insertion data', () => {
    const board = { children: [{ id: 'image-a' }] } as unknown as PlaitBoard;

    expect(
      bindImageTaskToCanvasInsertion(board, { success: false }, 'task-1')
    ).toBe(0);
    expect(
      bindImageTaskToCanvasInsertion(
        board,
        { success: true, data: { items: [] } },
        ''
      )
    ).toBe(0);
    expect(mocks.setNode).not.toHaveBeenCalled();
  });
});
