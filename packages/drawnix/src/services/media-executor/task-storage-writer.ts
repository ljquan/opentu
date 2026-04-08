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
import { APP_DB_NAME, APP_DB_STORES } from '../app-database';

// 使用主线程专用数据库
const DB_NAME = APP_DB_NAME;
const TASKS_STORE = APP_DB_STORES.TASKS;

// 使用与 SW 端一致的字符串字面量类型
type SWTaskType =
  | 'image'
  | 'video'
  | 'audio'
  | 'character'
  | 'inspiration_board'
  | 'chat';
type SWTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

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
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  progress?: number;
  remoteId?: string;
  executionPhase?: string;
  savedToLibrary?: boolean;
  insertedToCanvas?: boolean;
  /** 是否从远程同步（不应被恢复执行） */
  syncedFromRemote?: boolean;
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

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);

      request.onerror = () => {
        this.dbPromise = null;
        reject(new Error('Failed to open database'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.dbPromise = null;
        resolve(this.db);
      };

      request.onupgradeneeded = () => {
        // 如果数据库不存在，创建必要的 object store
        const db = request.result;
        if (!db.objectStoreNames.contains(TASKS_STORE)) {
          const store = db.createObjectStore(TASKS_STORE, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * 保存任务
   */
  async saveTask(task: SWTask): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TASKS_STORE, 'readwrite');
      const store = transaction.objectStore(TASKS_STORE);
      const request = store.put(task);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * 获取任务
   */
  async getTask(taskId: string): Promise<SWTask | null> {
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
    params: SWTask['params']
  ): Promise<SWTask> {
    const now = Date.now();
    const task: SWTask = {
      id: taskId,
      type,
      status: 'pending',
      params,
      createdAt: now,
      updatedAt: now,
    };
    await this.saveTask(task);
    return task;
  }

  /**
   * 更新任务状态
   */
  async updateStatus(taskId: string, status: SWTaskStatus): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      if (status === 'processing' && !task.startedAt) {
        task.startedAt = Date.now();
      }
      await this.saveTask(task);
    }
  }

  /**
   * 更新任务进度
   */
  async updateProgress(
    taskId: string,
    progress: number,
    phase?: string
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      task.progress = progress;
      task.updatedAt = Date.now();
      if (phase) {
        task.executionPhase = phase;
      }
      await this.saveTask(task);
    }
  }

  /**
   * 完成任务
   */
  async completeTask(taskId: string, result: SWTask['result']): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
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
      task.completedAt = Date.now();
      task.updatedAt = Date.now();
      task.progress = 100;
      await this.saveTask(task);
    }
  }

  /**
   * 任务失败
   */
  async failTask(taskId: string, error: SWTask['error']): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      task.status = 'failed';
      task.error = error;
      task.updatedAt = Date.now();
      await this.saveTask(task);
    }
  }

  /**
   * 更新任务的 remoteId（用于异步任务恢复）
   */
  async updateRemoteId(taskId: string, remoteId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (task) {
      task.remoteId = remoteId;
      task.updatedAt = Date.now();
      task.executionPhase = 'polling';
      await this.saveTask(task);
    }
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId: string): Promise<void> {
    const db = await this.getDB();
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
  async importTasks(tasks: SWTask[]): Promise<{ imported: number; skipped: number }> {
    if (tasks.length === 0) {
      return { imported: 0, skipped: 0 };
    }

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TASKS_STORE, 'readwrite');
      const store = transaction.objectStore(TASKS_STORE);
      
      let imported = 0;
      let skipped = 0;
      let completed = 0;
      
      // 处理每个任务
      for (const task of tasks) {
        // 先检查是否存在
        const getRequest = store.get(task.id);
        
        getRequest.onsuccess = () => {
          if (getRequest.result) {
            // 任务已存在，跳过
            skipped++;
            completed++;
            if (completed === tasks.length) {
              resolve({ imported, skipped });
            }
          } else {
            // 任务不存在，插入
            const putRequest = store.put(task);
            putRequest.onsuccess = () => {
              imported++;
              completed++;
              if (completed === tasks.length) {
                resolve({ imported, skipped });
              }
            };
            putRequest.onerror = () => {
              // 单个任务失败不影响其他任务
              skipped++;
              completed++;
              if (completed === tasks.length) {
                resolve({ imported, skipped });
              }
            };
          }
        };
        
        getRequest.onerror = () => {
          skipped++;
          completed++;
          if (completed === tasks.length) {
            resolve({ imported, skipped });
          }
        };
      }

      transaction.onerror = () => reject(transaction.error);
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
  }
}

/**
 * 任务存储写入器单例
 */
export const taskStorageWriter = new TaskStorageWriter();
