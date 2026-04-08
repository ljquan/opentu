/**
 * Task Storage Reader Service
 * 
 * 主线程直接读取 IndexedDB 中的任务数据，避免通过 postMessage 与 SW 通信的限制：
 * - postMessage 有 1MB 大小限制
 * - 通信可能超时或失败
 * - 需要复杂的分页和重试逻辑
 * 
 * 注意：这个模块只负责读取操作，写操作仍然通过 SW 进行以确保数据一致性
 */

import { Task, TaskStatus, TaskType, GenerationParams } from '../types/task.types';
import { BaseStorageReader } from './base-storage-reader';
import { normalizeImageDataUrl } from '@aitu/utils';

import { APP_DB_NAME, APP_DB_STORES, getAppDB } from './app-database';

// 使用主线程专用数据库
const DB_NAME = APP_DB_NAME;
const TASKS_STORE = APP_DB_STORES.TASKS;

// SW 端的任务结构（与 SWTask 保持一致）
interface SWTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  params: GenerationParams;
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
    characterUsername?: string;
    characterProfileUrl?: string;
    characterPermalink?: string;
    chatResponse?: string;
    toolCalls?: any[];
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  progress?: number;
  remoteId?: string;
  executionPhase?: string;
  savedToLibrary?: boolean;
  insertedToCanvas?: boolean;
}

/**
 * 将 SWTask 转换为 Task
 */
function convertSWTaskToTask(swTask: SWTask): Task {
  const normalizedResult =
    swTask.type === TaskType.IMAGE && swTask.result
      ? {
          ...swTask.result,
          url: normalizeImageDataUrl(swTask.result.url),
          urls: swTask.result.urls?.map((url) => normalizeImageDataUrl(url)),
          thumbnailUrl: swTask.result.thumbnailUrl
            ? normalizeImageDataUrl(swTask.result.thumbnailUrl)
            : swTask.result.thumbnailUrl,
          thumbnailUrls: swTask.result.thumbnailUrls?.map((url) =>
            normalizeImageDataUrl(url)
          ),
        }
      : swTask.result;

  return {
    id: swTask.id,
    type: swTask.type,
    status: swTask.status,
    params: swTask.params,
    createdAt: swTask.createdAt,
    updatedAt: swTask.updatedAt,
    startedAt: swTask.startedAt,
    completedAt: swTask.completedAt,
    result: normalizedResult,
    error: swTask.error,
    progress: swTask.progress,
    remoteId: swTask.remoteId,
    savedToLibrary: swTask.savedToLibrary,
    insertedToCanvas: swTask.insertedToCanvas,
  };
}

/**
 * 任务缓存结构
 */
interface TaskCache {
  all: Task[] | null;           // 全量任务缓存
  byType: Map<TaskType, Task[]>; // 按类型过滤的缓存
}

/**
 * 任务存储读取服务
 */
class TaskStorageReader extends BaseStorageReader<TaskCache> {
  protected readonly dbName = DB_NAME;
  protected readonly storeName = TASKS_STORE;
  protected readonly logPrefix = 'TaskStorageReader';

  /**
   * 使用 getAppDB() 获取数据库连接，确保 store 已创建。
   * BaseStorageReader.openIndexedDB() 不带版本号打开数据库，
   * 如果数据库不存在会创建空数据库（无 store），导致后续读取全部失败。
   */
  protected async getDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = getAppDB().then(db => {
      this.db = db;
      return db;
    }).catch(error => {
      this.dbPromise = null;
      throw error;
    });

    return this.dbPromise;
  }

  /**
   * 获取所有任务（带缓存）
   */
  async getAllTasks(options?: { status?: TaskStatus; type?: TaskType }): Promise<Task[]> {
    const hasTypeFilter = options?.type !== undefined;
    const hasStatusFilter = options?.status !== undefined;
    
    // 检查缓存
    if (this.isCacheValid() && this.cache) {
      // 无过滤条件：返回全量缓存
      if (!hasTypeFilter && !hasStatusFilter && this.cache.all) {
        return this.cache.all;
      }
      // 仅类型过滤：返回类型缓存
      if (hasTypeFilter && !hasStatusFilter) {
        const cached = this.cache.byType.get(options!.type!);
        if (cached) {
          return cached;
        }
      }
    }

    try {
      const db = await this.getDB();
      
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        return [];
      }

      const tasks = await new Promise<Task[]>((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readonly');
        const store = transaction.objectStore(TASKS_STORE);
        const request = store.getAll();

        request.onsuccess = () => {
          let rawTasks: SWTask[] = request.result || [];
          
          // 应用过滤条件
          if (hasStatusFilter) {
            rawTasks = rawTasks.filter(t => t.status === options!.status);
          }
          if (hasTypeFilter) {
            rawTasks = rawTasks.filter(t => t.type === options!.type);
          }
          
          // 按创建时间倒序排序
          rawTasks.sort((a, b) => b.createdAt - a.createdAt);

          console.warn(`[TaskStorageReader] getAllTasks: ${rawTasks.length} tasks from IndexedDB (filter: type=${options?.type}, status=${options?.status})`);
          resolve(rawTasks.map(convertSWTaskToTask));
        };

        request.onerror = () => {
          reject(new Error(`Failed to get tasks: ${request.error?.message}`));
        };
      });

      // 更新缓存
      if (!this.cache || !this.isCacheValid()) {
        this.cache = { all: null, byType: new Map() };
        this.updateCacheTimestamp();
      }
      
      if (!hasTypeFilter && !hasStatusFilter) {
        this.cache.all = tasks;
      } else if (hasTypeFilter && !hasStatusFilter) {
        this.cache.byType.set(options!.type!, tasks);
      }

      return tasks;
    } catch (error) {
      console.error('[TaskStorageReader] Error getting all tasks:', error);
      return [];
    }
  }

  /**
   * 按类型获取任务（用于弹窗任务列表）
   */
  async getTasksByType(
    type: TaskType,
    offset = 0,
    limit = 50
  ): Promise<{ tasks: Task[]; total: number; hasMore: boolean }> {
    try {
      const allTasks = await this.getAllTasks({ type });
      const total = allTasks.length;
      const paginatedTasks = allTasks.slice(offset, offset + limit);
      const hasMore = offset + limit < total;
      
      return { tasks: paginatedTasks, total, hasMore };
    } catch {
      return { tasks: [], total: 0, hasMore: false };
    }
  }

  /**
   * 获取单个任务
   */
  async getTask(taskId: string): Promise<Task | null> {
    try {
      const swTask = await this.getById<SWTask>(TASKS_STORE, taskId);
      return swTask ? convertSWTaskToTask(swTask) : null;
    } catch {
      return null;
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.dbPromise = null;
    }
  }
}

// 单例导出
export const taskStorageReader = new TaskStorageReader();
