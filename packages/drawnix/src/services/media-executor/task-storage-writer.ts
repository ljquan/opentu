/**
 * Task Storage Writer
 *
 * 主线程直接写入 IndexedDB 中的任务数据。
 * 用于 SW 不可用时的降级模式。
 *
 * 注意：正常情况下应通过 SW 写入以确保一致性。
 * 此模块仅用于降级场景。
 */

import { normalizeImageDataUrl } from '@aitu/utils';
import { APP_DB_STORES, getAppDB } from '../app-database';
import type { TaskInvocationRouteSnapshot } from '../../types/task.types';

// 使用主线程专用数据库
const TASKS_STORE = APP_DB_STORES.TASKS;

// 使用与 SW 端一致的字符串字面量类型
type SWTaskType =
  | 'image'
  | 'video'
  | 'audio'
  | 'character'
  | 'inspiration_board'
  | 'chat';
type SWTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * SW 端的任务结构（与 SWTask 保持一致）
 * 使用字符串字面量类型以确保与 IndexedDB 存储的数据兼容
 */
export interface SWTask {
  id: string;
  type: SWTaskType;
  status: SWTaskStatus;
  params: {
    prompt: string;
    [key: string]: unknown;
  };
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: {
    url: string;
    urls?: string[];
    thumbnailUrls?: string[];
    format: string;
    size: number;
    resultKind?: 'image' | 'video' | 'audio' | 'lyrics' | 'character' | 'chat';
    width?: number;
    height?: number;
    duration?: number;
    thumbnailUrl?: string;
    previewImageUrl?: string;
    title?: string;
    lyricsText?: string;
    lyricsTitle?: string;
    lyricsTags?: string[];
    providerTaskId?: string;
    primaryClipId?: string;
    clipIds?: string[];
    clips?: Array<{
      id?: string;
      clipId?: string;
      title?: string;
      status?: string;
      audioUrl: string;
      imageUrl?: string;
      imageLargeUrl?: string;
      duration?: number | null;
      modelName?: string;
      majorModelVersion?: string;
    }>;
    chatResponse?: string;
    analysisData?: unknown;
    toolCalls?: any[];
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  progress?: number;
  remoteId?: string;
  invocationRoute?: TaskInvocationRouteSnapshot;
  executionPhase?: string;
  savedToLibrary?: boolean;
  insertedToCanvas?: boolean;
  /** 是否从远程同步（不应被恢复执行） */
  syncedFromRemote?: boolean;
  /** 是否已归档（不参与活跃加载） */
  archived?: boolean;
  /** 任务配置（可选，导入时可能没有） */
  config?: {
    apiKey: string;
    baseUrl: string;
    modelName?: string;
    textModelName?: string;
  };
}

/**
 * 任务存储写入器
 *
 * 提供直接写入 IndexedDB 的能力，用于降级模式。
 */
class TaskStorageWriter {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private writesPaused = false;

  pauseWrites(): void {
    this.writesPaused = true;
  }

  resumeWrites(): void {
    this.writesPaused = false;
  }

  /**
   * 获取数据库连接
   */
  private async getDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = getAppDB()
      .then((db) => {
        this.db = db;
        this.dbPromise = null;
        return db;
      })
      .catch((error) => {
        this.dbPromise = null;
        throw error;
      });

    return this.dbPromise;
  }

  /**
   * 保存任务
   */
  async saveTask(task: SWTask): Promise<void> {
    if (this.writesPaused) {
      return;
    }

    const db = await this.getDB();
    if (this.writesPaused) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TASKS_STORE, 'readwrite');
      const store = transaction.objectStore(TASKS_STORE);
      const request = store.put(task);

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || request.error);
      transaction.onabort = () =>
        reject(
          transaction.error || new Error('Task storage transaction aborted')
        );
    });
  }

  private async updateTask(
    taskId: string,
    update: (task: SWTask) => void,
    expectedRequestId?: string,
    options: {
      allowPending?: boolean;
      allowFailed?: boolean;
      expectedErrorCodes?: readonly string[];
      allowLegacyRequestId?: boolean;
      expectedStartedAt?: number;
      shouldUpdate?: () => boolean;
    } = {}
  ): Promise<boolean> {
    if (!taskId || this.writesPaused) {
      return false;
    }

    const db = await this.getDB();
    if (this.writesPaused) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TASKS_STORE, 'readwrite');
      const store = transaction.objectStore(TASKS_STORE);
      const request = store.get(taskId);
      let updated = false;
      let updateError: unknown;

      request.onsuccess = () => {
        if (this.writesPaused) {
          return;
        }

        const task = request.result as SWTask | undefined;
        if (!task) {
          return;
        }
        if (
          (options.expectedStartedAt !== undefined &&
            (task.startedAt ?? task.createdAt) !== options.expectedStartedAt) ||
          (options.shouldUpdate && !options.shouldUpdate())
        ) {
          return;
        }
        if (
          expectedRequestId &&
          (task.type !== 'image' ||
            (task.status !== 'processing' &&
              (!options.allowPending || task.status !== 'pending') &&
              (!options.allowFailed ||
                task.status !== 'failed' ||
                !options.expectedErrorCodes?.includes(
                  task.error?.code || ''
                ))) ||
            (task.params.submissionRequestId !== expectedRequestId &&
              (!options.allowLegacyRequestId ||
                task.params.submissionRequestId !== undefined ||
                task.id !== expectedRequestId)))
        ) {
          return;
        }

        try {
          update(task);
          store.put(task);
          updated = true;
        } catch (error) {
          updateError = error;
          transaction.abort();
        }
      };

      transaction.oncomplete = () => resolve(updated);
      transaction.onerror = () =>
        reject(
          updateError ||
            transaction.error ||
            request.error ||
            new Error('Task storage transaction failed')
        );
      transaction.onabort = () =>
        reject(
          updateError ||
            transaction.error ||
            new Error('Task storage transaction aborted')
        );
    });
  }

  /**
   * 获取任务
   */
  async getTask(taskId: string): Promise<SWTask | null> {
    if (!taskId) {
      return null;
    }

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TASKS_STORE, 'readonly');
      const store = transaction.objectStore(TASKS_STORE);
      const request = store.get(taskId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * 创建新任务
   */
  async createTask(
    taskId: string,
    type: SWTaskType,
    params: SWTask['params'],
    invocationRoute?: TaskInvocationRouteSnapshot
  ): Promise<SWTask> {
    const now = Date.now();
    const task: SWTask = {
      id: taskId,
      type,
      status: 'pending',
      params,
      invocationRoute,
      createdAt: now,
      updatedAt: now,
    };
    await this.saveTask(task);
    return task;
  }

  /**
   * 更新任务状态
   */
  async updateStatus(
    taskId: string,
    status: SWTaskStatus,
    expectedRequestId?: string,
    options: {
      allowLegacyRequestId?: boolean;
      shouldUpdate?: () => boolean;
    } = {}
  ): Promise<boolean> {
    return this.updateTask(
      taskId,
      (task) => {
        task.status = status;
        task.updatedAt = Date.now();
        if (status === 'processing' && !task.startedAt) {
          task.startedAt = Date.now();
        }
      },
      expectedRequestId,
      { allowPending: true, ...options }
    );
  }

  async markImageSubmissionAttempted(
    taskId: string,
    expectedRequestId: string,
    invocationRoute?: TaskInvocationRouteSnapshot
  ): Promise<boolean> {
    return this.updateTask(
      taskId,
      (task) => {
        task.status = 'processing';
        task.params.imageSubmissionAttempted = true;
        task.executionPhase = 'submitting';
        if (invocationRoute) {
          task.invocationRoute = invocationRoute;
        }
        task.updatedAt = Date.now();
      },
      expectedRequestId,
      { allowPending: true }
    );
  }

  /**
   * 更新任务进度
   */
  async updateProgress(
    taskId: string,
    progress: number,
    phase?: string,
    expectedRequestId?: string,
    options: { shouldUpdate?: () => boolean } = {}
  ): Promise<boolean> {
    return this.updateTask(
      taskId,
      (task) => {
        task.progress = progress;
        task.updatedAt = Date.now();
        if (phase) {
          task.executionPhase = phase;
        }
      },
      expectedRequestId,
      { allowPending: true, ...options }
    );
  }

  /**
   * 将已正式提交但响应丢失的图片任务切换为 Request ID 恢复轮询。
   */
  async markImageAttemptRecovering(
    taskId: string,
    expectedRequestId: string,
    options: {
      expectedStartedAt?: number;
      shouldUpdate?: () => boolean;
    } = {}
  ): Promise<boolean> {
    return this.updateTask(
      taskId,
      (task) => {
        task.status = 'processing';
        task.error = undefined;
        task.completedAt = undefined;
        task.executionPhase = 'polling';
        task.progress = undefined;
        task.updatedAt = Date.now();
      },
      expectedRequestId,
      options
    );
  }

  /**
   * 完成任务
   */
  async completeTask(
    taskId: string,
    result: SWTask['result'],
    expectedRequestId?: string,
    options: { shouldUpdate?: () => boolean } = {}
  ): Promise<boolean> {
    return this.updateTask(
      taskId,
      (task) => {
        const normalizedResult =
          task.type === 'image' && result
            ? {
                ...result,
                url: normalizeImageDataUrl(result.url),
                urls: result.urls?.map((url) => normalizeImageDataUrl(url)),
                thumbnailUrl: result.thumbnailUrl
                  ? normalizeImageDataUrl(result.thumbnailUrl)
                  : result.thumbnailUrl,
                thumbnailUrls: result.thumbnailUrls?.map((url) =>
                  normalizeImageDataUrl(url)
                ),
              }
            : result;

        task.status = 'completed';
        task.result = normalizedResult;
        task.error = undefined;
        task.completedAt = Date.now();
        task.updatedAt = Date.now();
        task.progress = 100;
        task.executionPhase = undefined;
      },
      expectedRequestId,
      options
    );
  }

  /**
   * 任务失败
   */
  async failTask(
    taskId: string,
    error: SWTask['error'],
    expectedRequestId?: string,
    options: {
      allowPending?: boolean;
      allowLegacyRequestId?: boolean;
      clearStartedAt?: boolean;
      expectedStartedAt?: number;
      shouldUpdate?: () => boolean;
    } = {}
  ): Promise<boolean> {
    return this.updateTask(
      taskId,
      (task) => {
        task.status = 'failed';
        task.error = error;
        const now = Date.now();
        task.completedAt = now;
        task.updatedAt = now;
        task.progress = undefined;
        task.executionPhase = undefined;
        if (options.clearStartedAt) {
          task.startedAt = undefined;
        }
      },
      expectedRequestId,
      options
    );
  }

  /**
   * 更新任务的 remoteId（用于异步任务恢复）
   */
  async updateRemoteId(
    taskId: string,
    remoteId: string,
    invocationRoute?: TaskInvocationRouteSnapshot,
    expectedRequestId?: string,
    options: { shouldUpdate?: () => boolean } = {}
  ): Promise<boolean> {
    return this.updateTask(
      taskId,
      (task) => {
        task.remoteId = remoteId;
        if (invocationRoute) {
          task.invocationRoute = invocationRoute;
        }
        task.updatedAt = Date.now();
        task.executionPhase = 'polling';
      },
      expectedRequestId,
      options
    );
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<void> {
    if (!taskId || this.writesPaused) {
      return;
    }

    const db = await this.getDB();
    if (this.writesPaused) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TASKS_STORE, 'readwrite');
      const store = transaction.objectStore(TASKS_STORE);
      const request = store.delete(taskId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * 批量导入任务（用于云同步恢复）
   * 只导入不存在的任务，已存在的跳过
   *
   * @returns 成功导入的任务数量
   */
  async importTasks(
    tasks: SWTask[],
    options: { replaceExisting?: boolean; batchSize?: number } = {}
  ): Promise<{ imported: number; skipped: number }> {
    if (tasks.length === 0) {
      return { imported: 0, skipped: 0 };
    }
    if (this.writesPaused) {
      return { imported: 0, skipped: tasks.length };
    }

    const db = await this.getDB();
    const batchSize = Math.max(1, options.batchSize ?? 200);
    let totalImported = 0;
    let totalSkipped = 0;

    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      if (this.writesPaused) {
        totalSkipped += tasks.length - i;
        break;
      }

      const result = await new Promise<{ imported: number; skipped: number }>(
        (resolve, reject) => {
          const transaction = db.transaction(TASKS_STORE, 'readwrite');
          const store = transaction.objectStore(TASKS_STORE);

          let imported = 0;
          let skipped = 0;
          let completed = 0;

          // 处理每个任务
          for (const task of batch) {
            if (options.replaceExisting) {
              const putRequest = store.put(task);
              putRequest.onsuccess = () => {
                imported++;
                completed++;
                if (completed === batch.length) {
                  resolve({ imported, skipped });
                }
              };
              putRequest.onerror = () => {
                // 单个任务失败不影响其他任务
                skipped++;
                completed++;
                if (completed === batch.length) {
                  resolve({ imported, skipped });
                }
              };
              continue;
            }

            // 先检查是否存在
            const getRequest = store.get(task.id);

            getRequest.onsuccess = () => {
              if (this.writesPaused || getRequest.result) {
                // 任务已存在，跳过
                skipped++;
                completed++;
                if (completed === batch.length) {
                  resolve({ imported, skipped });
                }
              } else {
                // 任务不存在，插入
                const putRequest = store.put(task);
                putRequest.onsuccess = () => {
                  imported++;
                  completed++;
                  if (completed === batch.length) {
                    resolve({ imported, skipped });
                  }
                };
                putRequest.onerror = () => {
                  // 单个任务失败不影响其他任务
                  skipped++;
                  completed++;
                  if (completed === batch.length) {
                    resolve({ imported, skipped });
                  }
                };
              }
            };

            getRequest.onerror = () => {
              skipped++;
              completed++;
              if (completed === batch.length) {
                resolve({ imported, skipped });
              }
            };
          }

          transaction.onerror = () => reject(transaction.error);
        }
      );
      totalImported += result.imported;
      totalSkipped += result.skipped;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return { imported: totalImported, skipped: totalSkipped };
  }

  /**
   * 清空任务表（用于完整覆盖恢复）
   */
  async clearAllTasks(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TASKS_STORE, 'readwrite');
      const store = transaction.objectStore(TASKS_STORE);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * 归档任务（标记 archived=true，不删除数据）
   */
  async archiveTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      task.archived = true;
      task.updatedAt = Date.now();
      await this.saveTask(task);
    }
  }

  /**
   * 批量归档任务
   */
  async archiveTasks(taskIds: string[]): Promise<void> {
    if (taskIds.length === 0 || this.writesPaused) return;
    const db = await this.getDB();
    if (this.writesPaused) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(TASKS_STORE, 'readwrite');
      const store = tx.objectStore(TASKS_STORE);
      const now = Date.now();
      let processed = 0;
      for (const id of taskIds) {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          if (this.writesPaused) {
            processed++;
            return;
          }

          const task = getReq.result;
          if (task) {
            task.archived = true;
            task.updatedAt = now;
            store.put(task);
          }
          processed++;
          if (processed === taskIds.length) {
            // tx.oncomplete will resolve
          }
        };
        getReq.onerror = () => {
          processed++;
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * 标记任务已插入画布
   */
  async markInserted(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      task.insertedToCanvas = true;
      task.updatedAt = Date.now();
      await this.saveTask(task);
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.dbPromise = null;
  }
}

/**
 * 任务存储写入器单例
 */
export const taskStorageWriter = new TaskStorageWriter();
