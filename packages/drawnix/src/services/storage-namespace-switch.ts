import { closeAppDB, migrateFromLegacyDB } from './app-database';
import { taskStorageWriter } from './media-executor/task-storage-writer';
import {
  activateStorageNamespace,
  createStorageNamespace,
  getActiveStorageNamespace,
  type StorageNamespace,
} from './storage-context';
import { taskQueueService } from './task-queue-service';
import { taskStorageReader } from './task-storage-reader';
import { workflowStorageReader } from './workflow-storage-reader';
import { workflowStorageWriter } from './workflow-engine/workflow-storage-writer';
import { workspaceService } from './workspace-service';
import { workspaceStorageService } from './workspace-storage-service';
import { configIndexedDBWriter } from '../utils/config-indexeddb-writer';
import { clearManagedProviderProfileOverlay } from './managed-provider-profile-runtime';

let switchQueue: Promise<void> = Promise.resolve();

async function performSwitch(target: StorageNamespace): Promise<void> {
  if (target.key === getActiveStorageNamespace().key) return;

  workspaceStorageService.suspendWrites();
  workflowStorageWriter.pauseWrites();
  configIndexedDBWriter.pauseWrites();
  // Raw managed keys belong to the old credential. Remove them from runtime
  // immediately; the target account will restore only its own IDB snapshot.
  clearManagedProviderProfileOverlay();
  await Promise.all([
    workspaceStorageService.flushPendingWrites(),
    configIndexedDBWriter.flushPendingWrites(),
    taskQueueService.prepareForStorageNamespaceSwitch(),
  ]);

  try {
    taskStorageReader.close();
    workflowStorageReader.close();
    taskStorageWriter.close();
    closeAppDB();
    await workspaceStorageService.close();

    activateStorageNamespace(target);
    await Promise.all([
      migrateFromLegacyDB(),
      workspaceStorageService.initialize(),
    ]);

    if (workspaceService.isInitialized()) {
      await workspaceService.reload();
    }
    const targetTasks = await taskStorageReader.getAllTasks();
    await taskQueueService.restoreTasks(targetTasks);
  } finally {
    taskStorageWriter.resumeWrites();
    workflowStorageWriter.resumeWrites();
    configIndexedDBWriter.resumeWrites();
    workspaceStorageService.resumeWrites();
  }
}

/**
 * Serializes account storage changes so old handles and pending writes cannot
 * cross into the next credential's namespace. credentialId is an opaque,
 * non-secret identifier and is never sent to the Service Worker.
 */
export function switchStorageNamespace(
  credentialId?: string | null
): Promise<void> {
  const target = createStorageNamespace(credentialId);
  const operation = switchQueue.then(() => performSwitch(target));
  switchQueue = operation.catch(() => undefined);
  return operation;
}
