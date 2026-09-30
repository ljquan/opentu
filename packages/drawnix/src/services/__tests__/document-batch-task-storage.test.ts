import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDocumentBatchTaskScopeCurrent, registerDocumentBatchTaskGuard, taskStorageWriter } from '../media-executor/task-storage-writer';
import type { DocumentBatchTaskMetadata } from '../../types/task.types';
const metadata: DocumentBatchTaskMetadata = {
  scopeId: 'workspace-a', batchId: 'batch-a', workItemId: 'item-a',
  attemptId: 'attempt-a', epoch: 1, dispatchOwner: 'document-batch',
};
const cleanups: Array<() => void> = [];
beforeEach(() => {
  taskStorageWriter.close(); taskStorageWriter.resumeWrites();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  taskStorageWriter.close(); taskStorageWriter.resumeWrites(); vi.unstubAllGlobals();
});
const prepare = (meta = metadata) => taskStorageWriter.prepareDocumentBatchTask(
  'task-a', { prompt: 'a cat', autoInsertToCanvas: true }, meta,
  { operation: 'image', providerProfileId: 'provider-a', modelId: 'image-a' }
);
describe('document batch durable task boundary', () => {
  it('creates only one pending task and preserves the original immutable payload', async () => {
    const [first, second] = await Promise.all([prepare(),
      taskStorageWriter.prepareDocumentBatchTask('task-a', { prompt: 'changed' }, metadata)]);
    expect(first.params.prompt).toBe('a cat'); expect(second.params.prompt).toBe('a cat');
    expect(await taskStorageWriter.getTask('task-a')).toMatchObject({
      status: 'pending', params: { autoInsertToCanvas: false, submissionRequestId: 'task-a' },
    });
  });
  it.each(['scopeId', 'batchId', 'workItemId', 'attemptId', 'epoch'] as const)(
    'rejects identity collision on %s without overwriting the old record', async (field) => {
      await prepare();
      await expect(prepare({ ...metadata, [field]: field === 'epoch' ? 2 : 'different' })).rejects.toThrow('identity conflict');
      expect((await taskStorageWriter.getTask('task-a'))?.params.documentBatch).toEqual(metadata);
    }
  );
  it('commits exactly one attempted claim under concurrent starts', async () => {
    await prepare();
    const results = await Promise.all([
      taskStorageWriter.claimDocumentBatchTask('task-a', metadata, 'ticket-1'),
      taskStorageWriter.claimDocumentBatchTask('task-a', metadata, 'ticket-2'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await taskStorageWriter.getTask('task-a')).toMatchObject({
      status: 'processing', params: { imageSubmissionAttempted: true, documentBatch: { dispatchTicket: 'ticket-1' } },
    });
    expect(await prepare()).toMatchObject({ status: 'processing' });
  });
  it('never claims another attempt and rejects writes after scope/epoch revocation', async () => {
    await prepare();
    expect(await taskStorageWriter.claimDocumentBatchTask('task-a', { ...metadata, epoch: 2 }, 't')).toBeNull();
    await taskStorageWriter.claimDocumentBatchTask('task-a', metadata, 't');
    let current = true;
    cleanups.push(registerDocumentBatchTaskGuard('task-a', metadata, () => current));
    const result = { url: '/local.png', format: 'png', size: 1 };
    current = false;
    expect(await taskStorageWriter.completeTask('task-a', result, 'task-a')).toBe(false);
    expect((await taskStorageWriter.getTask('task-a'))?.status).toBe('processing');
    current = true;
    expect(await taskStorageWriter.completeTask('task-a', result, 'task-a')).toBe(true);
  });
  it('defaults to no query/write authorization until the current scope binds', async () => {
    const task = await prepare();
    expect(isDocumentBatchTaskScopeCurrent(task)).toBe(false);
    const unbind = registerDocumentBatchTaskGuard('task-a', metadata, () => true);
    expect(isDocumentBatchTaskScopeCurrent(task)).toBe(true); unbind();
    expect(isDocumentBatchTaskScopeCurrent(task)).toBe(false);
  });
  it('fails closed when a local data clear has paused writes', async () => {
    await prepare(); taskStorageWriter.pauseWrites();
    await expect(taskStorageWriter.prepareDocumentBatchTask('task-b', { prompt: 'b' }, metadata)).rejects.toThrow('paused');
    expect(await taskStorageWriter.claimDocumentBatchTask('task-a', metadata, 'ticket')).toBeNull();
  });
});
