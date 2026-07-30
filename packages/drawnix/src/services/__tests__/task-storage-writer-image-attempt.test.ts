import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  taskStorageWriter,
  type SWTask,
} from '../media-executor/task-storage-writer';
import { APP_DB_NAME, APP_DB_STORES } from '../app-database';

function createImageTask(
  requestId: string,
  status: SWTask['status'] = 'processing'
): SWTask {
  return {
    id: 'image-task-1',
    type: 'image',
    status,
    params: {
      prompt: '画一只兔子',
      submissionRequestId: requestId,
      imageSubmissionAttempted: true,
    },
    createdAt: 1,
    updatedAt: 1,
    startedAt: 1,
  };
}

async function saveFromAnotherTab(task: SWTask): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(APP_DB_NAME);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(APP_DB_STORES.TASKS, 'readwrite');
    transaction.objectStore(APP_DB_STORES.TASKS).put(task);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

describe('task-storage-writer image attempt guards', () => {
  beforeEach(() => {
    taskStorageWriter.close();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    taskStorageWriter.close();
    vi.unstubAllGlobals();
  });

  it('waits for the IndexedDB transaction to commit before resolving a save', async () => {
    taskStorageWriter.close();
    const openRequest: Record<string, any> = {};
    const putRequest: Record<string, any> = {};
    const transaction: Record<string, any> = {
      error: null,
      objectStore: () => ({ put: () => putRequest }),
    };
    const database = {
      close: vi.fn(),
      transaction: () => transaction,
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        queueMicrotask(() => {
          openRequest.result = database;
          openRequest.onsuccess?.();
        });
        return openRequest;
      },
    });

    let settled = false;
    const savePromise = taskStorageWriter
      .saveTask(createImageTask('request-current'))
      .then(() => {
        settled = true;
      });

    for (let i = 0; i < 5 && !transaction.oncomplete; i += 1) {
      await Promise.resolve();
    }
    putRequest.onsuccess?.();
    await Promise.resolve();
    expect(settled).toBe(false);

    transaction.oncomplete();
    await savePromise;
    expect(settled).toBe(true);
  });

  it.each(['complete', 'fail'] as const)(
    'does not let an old tab %s after another tab starts a newer retry',
    async (terminalAction) => {
      await taskStorageWriter.saveTask(createImageTask('request-a'));

      const validatedByOldTab = await taskStorageWriter.getTask('image-task-1');
      expect(validatedByOldTab?.params.submissionRequestId).toBe('request-a');

      await saveFromAnotherTab(createImageTask('request-b'));

      const updated =
        terminalAction === 'complete'
          ? await taskStorageWriter.completeTask(
              'image-task-1',
              {
                url: 'https://example.com/old.png',
                format: 'png',
                size: 0,
              },
              'request-a'
            )
          : await taskStorageWriter.failTask(
              'image-task-1',
              { code: 'OLD_FAILURE', message: 'old failure' },
              'request-a'
            );

      expect(updated).toBe(false);
      const storedTask = await taskStorageWriter.getTask('image-task-1');
      expect(storedTask).toMatchObject({
        status: 'processing',
        params: { submissionRequestId: 'request-b' },
      });
      expect(storedTask?.result).toBeUndefined();
      expect(storedTask?.error).toBeUndefined();
    }
  );

  it.each(['cancel', 'recover', 'fail'] as const)(
    'does not let an old tab %s after a newer Request ID is stored',
    async (action) => {
      await taskStorageWriter.saveTask(createImageTask('request-a'));
      await saveFromAnotherTab(createImageTask('request-b'));

      const updated =
        action === 'cancel'
          ? await taskStorageWriter.updateStatus(
              'image-task-1',
              'cancelled',
              'request-a',
              { allowLegacyRequestId: true }
            )
          : action === 'recover'
          ? await taskStorageWriter.markImageAttemptRecovering(
              'image-task-1',
              'request-a'
            )
          : await taskStorageWriter.failTask(
              'image-task-1',
              { code: 'OLD_FAILURE', message: 'old failure' },
              'request-a',
              { allowLegacyRequestId: true }
            );

      expect(updated).toBe(false);
      expect(await taskStorageWriter.getTask('image-task-1')).toMatchObject({
        status: 'processing',
        params: {
          submissionRequestId: 'request-b',
          imageSubmissionAttempted: true,
        },
      });
    }
  );

  it('keeps the first terminal write for the same attempt', async () => {
    const completedTask = createImageTask('request-current', 'completed');
    completedTask.result = {
      url: 'https://example.com/late.png',
      format: 'png',
      size: 0,
    };
    await taskStorageWriter.saveTask(completedTask);

    expect(
      await taskStorageWriter.updateStatus(
        'image-task-1',
        'cancelled',
        'request-current'
      )
    ).toBe(false);
    expect(await taskStorageWriter.getTask('image-task-1')).toMatchObject({
      status: 'completed',
      result: { url: 'https://example.com/late.png' },
      params: { submissionRequestId: 'request-current' },
    });
  });

  it('does not recover a same-request upstream failure from an old interrupted snapshot', async () => {
    const failedTask = createImageTask('request-current', 'failed');
    failedTask.error = {
      code: 'UPSTREAM_FAILED',
      message: 'upstream rejected the request',
    };
    await taskStorageWriter.saveTask(failedTask);

    expect(
      await taskStorageWriter.markImageAttemptRecovering(
        'image-task-1',
        'request-current',
        {
          allowFailed: true,
          expectedErrorCodes: ['INTERRUPTED', 'INTERRUPTED_DURING_SUBMISSION'],
        }
      )
    ).toBe(false);
    expect(await taskStorageWriter.getTask('image-task-1')).toMatchObject({
      status: 'failed',
      error: { code: 'UPSTREAM_FAILED' },
      params: { submissionRequestId: 'request-current' },
    });
  });

  it('keeps a newer retry when another tab writes it after the old completion', async () => {
    await taskStorageWriter.saveTask(createImageTask('request-a'));
    expect(
      await taskStorageWriter.completeTask(
        'image-task-1',
        {
          url: 'https://example.com/old.png',
          format: 'png',
          size: 0,
        },
        'request-a'
      )
    ).toBe(true);

    await saveFromAnotherTab(createImageTask('request-b'));

    expect(await taskStorageWriter.getTask('image-task-1')).toMatchObject({
      status: 'processing',
      params: { submissionRequestId: 'request-b' },
    });
  });

  it('does not let an old tab mark a replaced submission as attempted', async () => {
    await taskStorageWriter.saveTask(createImageTask('request-a'));
    expect(
      (await taskStorageWriter.getTask('image-task-1'))?.params
        .submissionRequestId
    ).toBe('request-a');

    const retryTask = createImageTask('request-b');
    retryTask.params.imageSubmissionAttempted = false;
    await saveFromAnotherTab(retryTask);

    expect(
      await taskStorageWriter.markImageSubmissionAttempted(
        'image-task-1',
        'request-a'
      )
    ).toBe(false);
    expect(await taskStorageWriter.getTask('image-task-1')).toMatchObject({
      params: {
        submissionRequestId: 'request-b',
        imageSubmissionAttempted: false,
      },
    });
  });

  it('keeps the live request in submitting phase after formal submission is persisted', async () => {
    await taskStorageWriter.saveTask(createImageTask('request-current'));

    expect(
      await taskStorageWriter.markImageSubmissionAttempted(
        'image-task-1',
        'request-current'
      )
    ).toBe(true);
    expect(await taskStorageWriter.getTask('image-task-1')).toMatchObject({
      status: 'processing',
      executionPhase: 'submitting',
      params: {
        submissionRequestId: 'request-current',
        imageSubmissionAttempted: true,
      },
    });
  });

  it('does not write into cancelled or already completed attempts', async () => {
    await taskStorageWriter.saveTask(
      createImageTask('request-current', 'cancelled')
    );
    expect(
      await taskStorageWriter.completeTask(
        'image-task-1',
        {
          url: 'https://example.com/late.png',
          format: 'png',
          size: 0,
        },
        'request-current'
      )
    ).toBe(false);

    const completedTask = createImageTask('request-current', 'completed');
    completedTask.result = {
      url: 'https://example.com/current.png',
      format: 'png',
      size: 0,
    };
    await taskStorageWriter.saveTask(completedTask);
    expect(
      await taskStorageWriter.failTask(
        'image-task-1',
        { code: 'LATE_FAILURE', message: 'late' },
        'request-current'
      )
    ).toBe(false);
    const storedTask = await taskStorageWriter.getTask('image-task-1');
    expect(storedTask).toMatchObject({
      status: 'completed',
      result: { url: 'https://example.com/current.png' },
    });
    expect(storedTask?.error).toBeUndefined();
  });

  it('commits a matching processing attempt before resolving', async () => {
    await taskStorageWriter.saveTask(createImageTask('request-current'));

    expect(
      await taskStorageWriter.completeTask(
        'image-task-1',
        {
          url: 'https://example.com/current.png',
          format: 'png',
          size: 0,
        },
        'request-current'
      )
    ).toBe(true);
    expect(await taskStorageWriter.getTask('image-task-1')).toMatchObject({
      status: 'completed',
      progress: 100,
      result: { url: 'https://example.com/current.png' },
    });
  });
});
