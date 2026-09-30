import type { GenerationParams, Task } from '../types/task.types';
import { TaskExecutionPhase } from '../types/task.types';
import { assertTaskInvocationRouteAvailable } from './task-invocation-route';
import type { DocumentBatchTaskMetadata } from '../types/shared/core.types';
import { taskQueueService } from './task-queue-service';
import { imageGenerationRecoveryService } from './image-generation-recovery-service';
import {
  isDocumentBatchTaskScopeCurrent,
  registerDocumentBatchTaskGuard,
  taskStorageWriter,
} from './media-executor/task-storage-writer';

export type DocumentBatchTaskIdentity = Omit<DocumentBatchTaskMetadata, 'dispatchOwner' | 'dispatchTicket'>;
const ownerMetadata = (metadata: DocumentBatchTaskIdentity): DocumentBatchTaskMetadata =>
  ({ ...metadata, dispatchOwner: 'document-batch' });
const remoteRecoveries = new Set<string>();

/** Durable preparation and one-shot dispatch; provider protocols stay in TaskQueue. */
export const documentBatchTaskBridge = {
  prepare(taskId: string, params: GenerationParams, metadata: DocumentBatchTaskIdentity): Promise<Task> {
    return taskQueueService.prepareDocumentBatchTask(taskId, params, ownerMetadata(metadata));
  },

  start(options: {
    taskId: string;
    metadata: DocumentBatchTaskIdentity;
    claimTicket: () => boolean | string | Promise<boolean | string>;
    scopeGuard: () => boolean;
  }): Promise<'started' | 'already-started' | 'rejected'> {
    return taskQueueService.startPreparedDocumentBatchTask({
      ...options,
      metadata: ownerMetadata(options.metadata),
      claimTicket: async () => {
        const claimed = await options.claimTicket();
        // The boolean gate persists its own ticket atomically. This is only a
        // task-store projection and can never re-authorize submission.
        return claimed === true ? options.metadata.attemptId : claimed || false;
      },
    });
  },

  async getPersisted(taskId: string, scopeId?: string): Promise<Task | null> {
    const task = await taskStorageWriter.getTask(taskId);
    const metadata = task?.params.documentBatch as DocumentBatchTaskMetadata | undefined;
    if (!metadata || (scopeId && metadata.scopeId !== scopeId)) return null;
    return task as unknown as Task;
  },

  /** Rebind only a verified scope. It grants query/writeback, never POST. */
  bindScope(taskId: string, metadata: DocumentBatchTaskIdentity, scopeGuard: () => boolean): () => void {
    const remove = registerDocumentBatchTaskGuard(taskId, ownerMetadata(metadata), scopeGuard);
    return () => {
      remove();
      imageGenerationRecoveryService.stop(taskId);
    };
  },

  /** Query-only recovery using the original route; unsupported routes stay uncertain. */
  async recover(taskId: string, scopeId: string): Promise<boolean> {
    const stored = await documentBatchTaskBridge.getPersisted(taskId, scopeId);
    if (!stored || !isDocumentBatchTaskScopeCurrent(stored) ||
        stored.syncedFromRemote || stored.status !== 'processing' ||
        !stored.params.imageSubmissionAttempted ||
        taskQueueService.isTaskExecutionActive(taskId) || remoteRecoveries.has(taskId)) return false;
    const task = { ...stored, executionPhase: TaskExecutionPhase.POLLING };
    if (task.remoteId) {
      remoteRecoveries.add(taskId);
      try {
        const { resolveTaskInvocationRouteModel } = await import('./task-invocation-route');
        assertTaskInvocationRouteAvailable('image', task);
        if (!isDocumentBatchTaskScopeCurrent(task)) return false;
        await taskQueueService.restoreTasks([task]);
        const { generationAPIService } = await import('./generation-api-service');
        if (!isDocumentBatchTaskScopeCurrent(task)) return false;
        void generationAPIService.resumeAsyncImageGeneration(taskId, task.remoteId, resolveTaskInvocationRouteModel(task), task.params.submissionRequestId as string, async () => {
          if (!isDocumentBatchTaskScopeCurrent(task)) throw new Error('账号已切换，停止查询');
          assertTaskInvocationRouteAvailable('image', task);
        })
          .then(async result => {
            if (!isDocumentBatchTaskScopeCurrent(task)) return;
            if (await taskStorageWriter.completeTask(taskId, result, task.params.submissionRequestId as string)) {
              const final = await taskStorageWriter.getTask(taskId);
              if (final && isDocumentBatchTaskScopeCurrent(task)) taskQueueService.syncTaskFromStorage(taskId, final as unknown as Task);
            }
          })
          // Failed queries retain the original task; never submit another request.
          .catch(async error => {
            await taskStorageWriter.recordRecoveryError(taskId, task.params.submissionRequestId as string, '恢复查询失败，结果待确认；请检查原渠道配置，不会自动重发');
          })
          .catch(error => console.warn('[DocumentBatch] Could not persist recovery status', error))
          .finally(() => remoteRecoveries.delete(taskId));
        return true;
      } catch {
        remoteRecoveries.delete(taskId);
        await taskStorageWriter.recordRecoveryError(taskId, task.params.submissionRequestId as string, '恢复查询暂不可用，请检查原渠道配置；不会自动重发');
        return false;
      } finally {
        if (!isDocumentBatchTaskScopeCurrent(task)) remoteRecoveries.delete(taskId);
      }
    }
    await taskQueueService.restoreTasks([task]);
    const requestId = task.params.submissionRequestId as string;
    const result = imageGenerationRecoveryService.start(task, {
      assertAvailable: async () => {
        if (!isDocumentBatchTaskScopeCurrent(task)) throw new Error('账号已切换，停止查询');
        assertTaskInvocationRouteAvailable('image', task);
      },
      onSucceeded: async (result) => {
        if (!isDocumentBatchTaskScopeCurrent(task)) return;
        const updated = await taskStorageWriter.completeTask(taskId, {
          url: result.url, urls: result.urls, format: task.params.outputFormat || 'png', size: 0,
        }, requestId);
        if (updated) {
          const final = await taskStorageWriter.getTask(taskId);
          if (final) taskQueueService.syncTaskFromStorage(taskId, final as unknown as Task);
        }
      },
      onFailed: async (error) => {
        if (!isDocumentBatchTaskScopeCurrent(task)) return;
        if (error.kind !== 'upstream') {
          await taskStorageWriter.recordRecoveryError(taskId, requestId, '恢复查询暂不可用，结果待确认；不会自动重发');
          return;
        }
        const updated = await taskStorageWriter.failTask(taskId, {
          code: error.code, message: error.message,
        }, requestId);
        if (updated) {
          const final = await taskStorageWriter.getTask(taskId);
          if (final) taskQueueService.syncTaskFromStorage(taskId, final as unknown as Task);
        }
      },
    });
    if (result.status !== 'started') await taskStorageWriter.recordRecoveryError(taskId, requestId, '原渠道无法自动查询此任务，结果待确认；不会自动重发');
    return result.status === 'started';
  },
};
