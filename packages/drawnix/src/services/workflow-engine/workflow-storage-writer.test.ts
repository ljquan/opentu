import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAppDB } from '../app-database';
import type { Workflow } from './types';
import { workflowStorageWriter } from './workflow-storage-writer';

function createWorkflow(status: Workflow['status'] = 'pending'): Workflow {
  return {
    id: 'workflow-1',
    name: 'test workflow',
    steps: [],
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('workflow-storage-writer clear barrier', () => {
  beforeEach(() => {
    closeAppDB();
    workflowStorageWriter.resumeWrites();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    closeAppDB();
    workflowStorageWriter.resumeWrites();
    vi.unstubAllGlobals();
  });

  it('blocks late saves while still allowing the workflow store to be cleared', async () => {
    await workflowStorageWriter.saveWorkflow(createWorkflow());
    workflowStorageWriter.pauseWrites();
    await workflowStorageWriter.saveWorkflow(createWorkflow('completed'));

    expect(await workflowStorageWriter.getWorkflow('workflow-1')).toMatchObject(
      {
        status: 'pending',
      }
    );

    await workflowStorageWriter.clearAllWorkflows();
    expect(await workflowStorageWriter.getWorkflow('workflow-1')).toBeNull();
  });
});
