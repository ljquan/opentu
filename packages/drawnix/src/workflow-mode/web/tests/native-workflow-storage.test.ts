import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { taskStorageWriter, type SWTask } from '../../../services/media-executor/task-storage-writer';
const task = (): SWTask => ({ id: 'attempt', type: 'image', status: 'pending', createdAt: 1, updatedAt: 1, params: { prompt: 'test', workflow: { scopeId: 'owner', targetId: 'node', attemptId: 'attempt' } } });
beforeEach(() => { taskStorageWriter.close(); taskStorageWriter.resumeWrites(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { taskStorageWriter.close(); taskStorageWriter.resumeWrites(); vi.unstubAllGlobals(); });
describe('workflow durable submission boundary', () => {
  it('allows exactly one concurrent submitter and retains the claim after reload', async () => {
    await taskStorageWriter.prepareWorkflowTask(task());
    const claims = await Promise.all([taskStorageWriter.claimWorkflowTask('attempt', 'owner'), taskStorageWriter.claimWorkflowTask('attempt', 'owner')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    taskStorageWriter.close();
    expect(await taskStorageWriter.claimWorkflowTask('attempt', 'owner')).toBe(false);
    expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'processing', params: { imageSubmissionAttempted: true } });
  });
  it('rejects an identity collision without replacing inputs', async () => {
    await taskStorageWriter.prepareWorkflowTask(task());
    await expect(taskStorageWriter.prepareWorkflowTask({ ...task(), params: { prompt: 'overwritten' } })).rejects.toThrow();
    expect((await taskStorageWriter.getTask('attempt'))?.params.prompt).toBe('test');
  });
  it('rejects another account and never resurrects a missing task', async () => {
    await taskStorageWriter.prepareWorkflowTask(task());
    expect(await taskStorageWriter.claimWorkflowTask('attempt', 'other')).toBe(false);
    expect(await taskStorageWriter.mutateWorkflowTask('missing', 'owner', () => true)).toBe(false);
  });
  it('aborts callback errors without committing a partial mutation', async () => {
    await taskStorageWriter.prepareWorkflowTask(task());
    await expect(taskStorageWriter.mutateWorkflowTask('attempt', 'owner', value => { value.status = 'completed'; throw new Error('write failure'); })).rejects.toThrow('write failure');
    expect((await taskStorageWriter.getTask('attempt'))?.status).toBe('pending');
  });
  it('does not submit when preparation or claim storage fails', async () => {
    const post = vi.fn();
    taskStorageWriter.pauseWrites();
    await expect((async () => { await taskStorageWriter.prepareWorkflowTask(task()); if (await taskStorageWriter.claimWorkflowTask('attempt', 'owner')) post(); })()).rejects.toThrow('paused');
    expect(post).not.toHaveBeenCalled();
  });
});
