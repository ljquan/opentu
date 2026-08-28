import { IDBFactory } from 'fake-indexeddb';
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
