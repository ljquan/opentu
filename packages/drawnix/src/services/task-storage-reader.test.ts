import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_DB_STORES, closeAppDB, getAppDB } from './app-database';
import { taskStorageReader } from './task-storage-reader';
import {
  TaskStatus,
  TaskType,
  type Task,
  type TaskResultVisibility,
} from '../types/task.types';

function createCompletedTask(
  id: string,
  type: TaskType.IMAGE | TaskType.VIDEO | TaskType.AUDIO,
  options: {
    createdAt: number;
    resultVisibility?: TaskResultVisibility;
    archived?: boolean;
  }
): Task {
  const format =
    type === TaskType.IMAGE ? 'png' : type === TaskType.VIDEO ? 'mp4' : 'mp3';

  return {
    id,
    type,
    status: TaskStatus.COMPLETED,
    params: { prompt: `prompt-${id}` },
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    completedAt: options.createdAt,
    archived: options.archived,
    result: {
      url: `/__aitu_cache__/${type}/${id}.${format}`,
      format,
      size: 128,
      resultVisibility: options.resultVisibility,
    },
  };
}

async function putTasks(tasks: Task[]): Promise<void> {
  const db = await getAppDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(APP_DB_STORES.TASKS, 'readwrite');
    const store = transaction.objectStore(APP_DB_STORES.TASKS);
    tasks.forEach((task) => store.put(task));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

describe('taskStorageReader result visibility', () => {
  it.each([TaskType.VIDEO, TaskType.AUDIO])('finds archived %s results while excluding internal and wrong-type records', async (type) => {
    const task = createCompletedTask('legacy', type, { createdAt: 1, archived: true });
    const internal = createCompletedTask('internal', type, { createdAt: 2, resultVisibility: 'internal' });
    internal.result!.url = task.result!.url;
    await putTasks([task, internal]);
    expect(await taskStorageReader.findMediaTaskIdByResultUrl(task.result!.url, type, { includeArchived: true })).toBe('legacy');
    expect(await taskStorageReader.findMediaTaskIdByResultUrl(task.result!.url, type, { includeArchived: false })).toBeNull();
    expect(await taskStorageReader.findImageTaskIdByResultUrl(task.result!.url)).toBeNull();
  });
  beforeEach(() => {
    taskStorageReader.close();
    taskStorageReader.invalidateCache();
    closeAppDB();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    taskStorageReader.close();
    taskStorageReader.invalidateCache();
    closeAppDB();
    vi.unstubAllGlobals();
  });

  it('restores the original video submission ID from storage', async () => {
    const task = createCompletedTask('video-request-id', TaskType.VIDEO, {
      createdAt: 1,
    });
    task.apiRequestId = 'site-submit-id';
    task.remoteId = 'remote-video';
    await putTasks([task]);
    taskStorageReader.close();
    expect(await taskStorageReader.getTask(task.id)).toMatchObject({
      apiRequestId: 'site-submit-id',
      remoteId: 'remote-video',
    });
  });

  it('keeps internal completed media out of asset and prompt projections', async () => {
    await putTasks([
      createCompletedTask('legacy-image', TaskType.IMAGE, {
        createdAt: 1,
        archived: true,
      }),
      createCompletedTask('user-video', TaskType.VIDEO, {
        createdAt: 2,
        resultVisibility: 'user',
      }),
      createCompletedTask('internal-image', TaskType.IMAGE, {
        createdAt: 3,
        resultVisibility: 'internal',
        archived: true,
      }),
      createCompletedTask('internal-video', TaskType.VIDEO, {
        createdAt: 4,
        resultVisibility: 'internal',
      }),
      createCompletedTask('internal-audio', TaskType.AUDIO, {
        createdAt: 5,
        resultVisibility: 'internal',
      }),
    ]);

    const assets = await taskStorageReader.getAssetTasks({
      includeArchived: true,
    });
    expect(assets.map((task) => task.id)).toEqual([
      'user-video',
      'legacy-image',
    ]);

    const promptHistory = await taskStorageReader.getPromptHistoryTaskSummaries(
      {
        includeArchived: true,
        statuses: [TaskStatus.COMPLETED],
      }
    );
    expect(promptHistory.items.map((task) => task.id)).toEqual([
      'user-video',
      'legacy-image',
    ]);

    const storedTasks = await taskStorageReader.getAllTasks({
      includeArchived: true,
    });
    expect(storedTasks).toHaveLength(5);
    expect(
      storedTasks.find((task) => task.id === 'internal-video')?.result
        ?.resultVisibility
    ).toBe('internal');

    await expect(
      taskStorageReader.getInternalResultTaskIds([
        'legacy-image',
        'internal-image',
        'internal-video',
        'missing-task',
      ])
    ).resolves.toEqual(new Set(['internal-image', 'internal-video']));

    await expect(taskStorageReader.getArchivedTasks()).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: 'legacy-image' })],
      hasMore: false,
    });
    await expect(taskStorageReader.getArchivedTaskCount()).resolves.toBe(1);

    await expect(
      taskStorageReader.findImageTaskIdByResultUrl(
        '/__aitu_cache__/image/internal-image.png'
      )
    ).resolves.toBeNull();
    await expect(
      taskStorageReader.findImageTaskIdByResultUrl(
        '/__aitu_cache__/image/legacy-image.png'
      )
    ).resolves.toBe('legacy-image');
  });

  it('hides internal failed and cancelled tasks without a result', async () => {
    await putTasks([
      {
        id: 'internal-failed-no-result',
        type: TaskType.VIDEO,
        status: TaskStatus.FAILED,
        params: {
          prompt: 'internal failed prompt',
          resultVisibility: 'internal',
        },
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: 'internal-cancelled-no-result',
        type: TaskType.VIDEO,
        status: TaskStatus.CANCELLED,
        params: {
          prompt: 'internal cancelled prompt',
          resultVisibility: 'internal',
        },
        createdAt: 11,
        updatedAt: 11,
      },
      {
        id: 'legacy-failed-no-result',
        type: TaskType.VIDEO,
        status: TaskStatus.FAILED,
        params: { prompt: 'legacy failed prompt' },
        createdAt: 12,
        updatedAt: 12,
      },
    ]);

    const promptHistory =
      await taskStorageReader.getPromptHistoryTaskSummaries({
        includeArchived: true,
        statuses: [TaskStatus.FAILED, TaskStatus.CANCELLED],
      });

    expect(promptHistory.items.map((task) => task.id)).toEqual([
      'legacy-failed-no-result',
    ]);
  });
});

describe('taskStorageReader archived filters', () => {
  beforeEach(() => {
    taskStorageReader.close();
    taskStorageReader.invalidateCache();
    closeAppDB();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  });

  afterEach(() => {
    taskStorageReader.close();
    taskStorageReader.invalidateCache();
    closeAppDB();
    vi.unstubAllGlobals();
  });

  const archived = (id: string, createdAt: number) =>
    createCompletedTask(id, TaskType.IMAGE, { createdAt, archived: true });

  it('finds old dates directly even with more than 100 newer archived tasks', async () => {
    await putTasks([
      archived('old-1', 10),
      archived('old-2', 20),
      ...Array.from({ length: 130 }, (_, index) =>
        archived(`recent-${index}`, 1000 + index)
      ),
    ]);

    const result = await taskStorageReader.getArchivedTasks(0, 30, {
      createdAtFrom: 0,
      createdAtTo: 100,
    });

    expect(result.tasks.map((task) => task.id)).toEqual(['old-2', 'old-1']);
    expect(result.hasMore).toBe(false);
  });

  it('includes the lower date boundary and excludes the upper boundary', async () => {
    await putTasks([
      archived('before', 99),
      archived('start', 100),
      archived('last-in-range', 199),
      archived('next-day', 200),
    ]);

    const result = await taskStorageReader.getArchivedTasks(0, 30, {
      createdAtFrom: 100,
      createdAtTo: 200,
    });

    expect(result.tasks.map((task) => task.id)).toEqual([
      'last-in-range',
      'start',
    ]);
    expect(result.hasMore).toBe(false);
  });

  it.each([
    [{ createdAtFrom: 100 }, ['newest', 'start']],
    [{ createdAtTo: 100 }, ['oldest']],
  ])('supports an open date range %o', async (filters, ids) => {
    await putTasks([
      archived('oldest', 99),
      archived('start', 100),
      archived('newest', 200),
    ]);

    const result = await taskStorageReader.getArchivedTasks(0, 30, filters);
    expect(result.tasks.map((task) => task.id)).toEqual(ids);
    expect(result.hasMore).toBe(false);
  });

  it('paginates matching records rather than raw cursor rows', async () => {
    await putTasks([
      archived('match-1', 1),
      archived('noise-2', 2),
      archived('match-3', 3),
      archived('noise-4', 4),
      archived('match-5', 5),
      archived('noise-6', 6),
    ]);
    const filters = { searchText: ' MATCH ' };

    const first = await taskStorageReader.getArchivedTasks(0, 2, filters);
    expect(first.tasks.map((task) => task.id)).toEqual(['match-5', 'match-3']);
    expect(first.hasMore).toBe(true);
    const second = await taskStorageReader.getArchivedTasks(2, 2, filters);
    expect(second.tasks.map((task) => task.id)).toEqual(['match-1']);
    expect(second.hasMore).toBe(false);
    expect(await taskStorageReader.getArchivedTasks(3, 2, filters)).toEqual({
      tasks: [],
      hasMore: false,
    });
  });

  it('does not report more matches when only non-matching or hidden records remain', async () => {
    await putTasks([
      archived('match-4', 4),
      archived('match-3', 3),
      archived('unmatched', 2),
      createCompletedTask('match-internal', TaskType.IMAGE, {
        createdAt: 1,
        archived: true,
        resultVisibility: 'internal',
      }),
      createCompletedTask('match-active', TaskType.IMAGE, { createdAt: 0 }),
    ]);

    const result = await taskStorageReader.getArchivedTasks(0, 2, {
      searchText: 'prompt-match',
    });
    expect(result.tasks.map((task) => task.id)).toEqual(['match-4', 'match-3']);
    expect(result.hasMore).toBe(false);
  });

  it('combines date and keyword filters before applying the page offset', async () => {
    await putTasks([
      archived('target-old', 50),
      archived('target-start', 100),
      archived('noise', 150),
      archived('target-end', 199),
      archived('target-new', 200),
    ]);
    const result = await taskStorageReader.getArchivedTasks(1, 1, {
      createdAtFrom: 100,
      createdAtTo: 200,
      searchText: 'target',
    });

    expect(result.tasks.map((task) => task.id)).toEqual(['target-start']);
    expect(result.hasMore).toBe(false);
  });

  it('keeps unfiltered calls compatible and excludes hidden or non-archived tasks', async () => {
    await putTasks([
      archived('oldest', 10),
      archived('newest', 20),
      createCompletedTask('active', TaskType.IMAGE, { createdAt: 30 }),
      createCompletedTask('internal', TaskType.IMAGE, {
        createdAt: 40,
        archived: true,
        resultVisibility: 'internal',
      }),
    ]);

    const result = await taskStorageReader.getArchivedTasks();
    expect(result.tasks.map((task) => task.id)).toEqual(['newest', 'oldest']);
    expect(result.hasMore).toBe(false);
  });

  it.each([
    { searchText: 'missing' },
    { createdAtFrom: 1000, createdAtTo: 2000 },
    { createdAtFrom: 20, createdAtTo: 10 },
    { createdAtFrom: 10, createdAtTo: 10 },
  ])('returns no records for an unmatched or empty range %o', async (filters) => {
    await putTasks([archived('example', 10)]);
    expect(await taskStorageReader.getArchivedTasks(0, 30, filters)).toEqual({
      tasks: [],
      hasMore: false,
    });
  });
});
