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

import {
  Task,
  TaskStatus,
  TaskType,
  GenerationParams,
  type TaskInvocationRouteSnapshot,
} from '../types/task.types';
import { BaseStorageReader } from './base-storage-reader';
import { normalizeImageDataUrl } from '@aitu/utils';
import { STORAGE_LIMITS } from '../constants/TASK_CONSTANTS';
import type { CacheWarning } from '../types/cache-warning.types';

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
    cacheWarning?: CacheWarning;
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
    analysisData?: unknown;
    toolCalls?: any[];
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  progress?: number;
  remoteId?: string;
  invocationRoute?: TaskInvocationRouteSnapshot;
  executionPhase?: string;
  savedToLibrary?: boolean;
  insertedToCanvas?: boolean;
  syncedFromRemote?: boolean;
  archived?: boolean;
}

export interface AssetTaskRecord {
  id: string;
  type: TaskType.IMAGE | TaskType.VIDEO | TaskType.AUDIO;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  remoteId?: string;
  archived?: boolean;
  params: {
    prompt?: string;
    model?: string;
    title?: string;
    assetMetadata?: {
      category?: 'GENERAL' | 'CHARACTER';
      characterName?: string;
      characterPrompt?: string;
    };
  };
  result?: {
    url: string;
    urls?: string[];
    format: string;
    size: number;
    duration?: number;
    previewImageUrl?: string;
    title?: string;
    providerTaskId?: string;
    primaryClipId?: string;
    clipIds?: string[];
    cacheWarning?: CacheWarning;
    clips?: Array<{
      id?: string;
      clipId?: string;
      title?: string;
      audioUrl: string;
      imageUrl?: string;
      imageLargeUrl?: string;
      duration?: number | null;
    }>;
  };
}

export interface PromptHistoryTaskSummary {
  id: string;
  type: TaskType;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  params: Pick<
    GenerationParams,
    | 'prompt'
    | 'knowledgeContextRefs'
    | 'promptMeta'
    | 'sourcePrompt'
    | 'rawInput'
    | 'workflowId'
    | 'batchIndex'
    | 'batchTotal'
    | 'model'
    | 'title'
    | 'tags'
    | 'pptSlideImage'
    | 'pptSlidePrompt'
  >;
  result?: Pick<
    NonNullable<SWTask['result']>,
    | 'url'
    | 'urls'
    | 'thumbnailUrl'
    | 'thumbnailUrls'
    | 'previewImageUrl'
    | 'title'
    | 'resultKind'
    | 'duration'
    | 'chatResponse'
    | 'lyricsText'
    | 'lyricsTitle'
    | 'lyricsTags'
    | 'clips'
  >;
  error?: SWTask['error'];
}

export interface PromptHistoryTaskPage {
  items: PromptHistoryTaskSummary[];
  nextOffset: number;
  hasMore: boolean;
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
    invocationRoute: swTask.invocationRoute,
    executionPhase: swTask.executionPhase as Task['executionPhase'],
    savedToLibrary: swTask.savedToLibrary,
    insertedToCanvas: swTask.insertedToCanvas,
    syncedFromRemote: swTask.syncedFromRemote,
    archived: swTask.archived,
  };
}

function normalizeComparableImageTaskUrl(value: string): string {
  const normalized = normalizeImageDataUrl(value);

  if (typeof window === 'undefined') {
    return normalized;
  }

  try {
    const parsed = new URL(normalized, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return parsed.toString();
    }

    parsed.searchParams.delete('_retry');
    parsed.searchParams.delete('bypass_sw');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return normalized.trim();
  }
}

function getSWTaskResultUrls(swTask: SWTask): string[] {
  const urls = new Set<string>();
  if (swTask.result?.url) {
    urls.add(swTask.result.url);
  }
  swTask.result?.urls?.forEach((url) => {
    if (url) {
      urls.add(url);
    }
  });
  return Array.from(urls);
}

function swImageTaskMatchesUrl(swTask: SWTask, targetUrl: string): boolean {
  if (swTask.type !== TaskType.IMAGE) {
    return false;
  }

  return getSWTaskResultUrls(swTask).some(
    (url) => normalizeComparableImageTaskUrl(url) === targetUrl
  );
}

function convertSWTaskToAssetTask(swTask: SWTask): AssetTaskRecord | null {
  if (
    (swTask.type !== TaskType.IMAGE &&
      swTask.type !== TaskType.VIDEO &&
      swTask.type !== TaskType.AUDIO) ||
    !swTask.result?.url
  ) {
    return null;
  }

  const normalizedResult =
    swTask.type === TaskType.IMAGE
      ? {
          ...swTask.result,
          url: normalizeImageDataUrl(swTask.result.url),
          urls: swTask.result.urls?.map((url) => normalizeImageDataUrl(url)),
          previewImageUrl: swTask.result.previewImageUrl
            ? normalizeImageDataUrl(swTask.result.previewImageUrl)
            : swTask.result.previewImageUrl,
        }
      : swTask.result;

  return {
    id: swTask.id,
    type: swTask.type,
    createdAt: swTask.createdAt,
    updatedAt: swTask.updatedAt,
    completedAt: swTask.completedAt,
    remoteId: swTask.remoteId,
    archived: swTask.archived,
    params: {
      prompt: swTask.params?.prompt,
      model: swTask.params?.model,
      title: swTask.params?.title,
      assetMetadata: swTask.params?.assetMetadata as
        | AssetTaskRecord['params']['assetMetadata']
        | undefined,
    },
    result: normalizedResult
      ? {
          url: normalizedResult.url,
          urls: normalizedResult.urls,
          format: normalizedResult.format,
          size: normalizedResult.size,
          duration: normalizedResult.duration,
          previewImageUrl: normalizedResult.previewImageUrl,
          title: normalizedResult.title,
          providerTaskId: normalizedResult.providerTaskId,
          primaryClipId: normalizedResult.primaryClipId,
          clipIds: normalizedResult.clipIds,
          cacheWarning: normalizedResult.cacheWarning,
          clips: normalizedResult.clips?.map((clip) => ({
            id: clip.id,
            clipId: clip.clipId,
            title: clip.title,
            audioUrl: clip.audioUrl,
            imageUrl: clip.imageUrl,
            imageLargeUrl: clip.imageLargeUrl,
            duration: clip.duration,
          })),
        }
      : undefined,
  };
}

function hasPromptHistoryPrompt(swTask: SWTask): boolean {
  return Boolean(
    swTask.params?.prompt?.trim() ||
      (typeof swTask.params?.sourcePrompt === 'string' &&
        swTask.params.sourcePrompt.trim()) ||
      (typeof swTask.params?.rawInput === 'string' &&
        swTask.params.rawInput.trim()) ||
      swTask.params?.promptMeta?.initialPrompt?.trim() ||
      swTask.params?.promptMeta?.sentPrompt?.trim()
  );
}

function convertSWTaskToPromptHistorySummary(
  swTask: SWTask
): PromptHistoryTaskSummary | null {
  if (!hasPromptHistoryPrompt(swTask)) {
    return null;
  }

  const result = swTask.result
    ? {
        url: swTask.result.url,
        urls: swTask.result.urls,
        thumbnailUrl: swTask.result.thumbnailUrl,
        thumbnailUrls: swTask.result.thumbnailUrls,
        previewImageUrl: swTask.result.previewImageUrl,
        title: swTask.result.title,
        resultKind: swTask.result.resultKind,
        duration: swTask.result.duration,
        chatResponse: swTask.result.chatResponse
          ? swTask.result.chatResponse.slice(0, 500)
          : undefined,
        lyricsText: swTask.result.lyricsText
          ? swTask.result.lyricsText.slice(0, 500)
          : undefined,
        lyricsTitle: swTask.result.lyricsTitle,
        lyricsTags: swTask.result.lyricsTags,
        clips: swTask.result.clips?.slice(0, 3).map((clip) => ({
          id: clip.id,
          clipId: clip.clipId,
          title: clip.title,
          status: clip.status,
          audioUrl: clip.audioUrl,
          imageUrl: clip.imageUrl,
          imageLargeUrl: clip.imageLargeUrl,
          duration: clip.duration,
          modelName: clip.modelName,
          majorModelVersion: clip.majorModelVersion,
        })),
      }
    : undefined;

  return {
    id: swTask.id,
    type: swTask.type,
    status: swTask.status,
    createdAt: swTask.createdAt,
    updatedAt: swTask.updatedAt,
    completedAt: swTask.completedAt,
    params: {
      prompt: swTask.params?.prompt,
      knowledgeContextRefs: swTask.params?.knowledgeContextRefs,
      promptMeta: swTask.params?.promptMeta,
      sourcePrompt: swTask.params?.sourcePrompt,
      rawInput: swTask.params?.rawInput,
      workflowId: swTask.params?.workflowId,
      batchIndex: swTask.params?.batchIndex,
      batchTotal: swTask.params?.batchTotal,
      model: swTask.params?.model,
      title: swTask.params?.title,
      tags: swTask.params?.tags,
      pptSlideImage: swTask.params?.pptSlideImage,
      pptSlidePrompt: swTask.params?.pptSlidePrompt,
    },
    result,
    error: swTask.error,
  };
}

/**
 * 任务缓存结构
 */
interface TaskCache {
  byType: Map<TaskType, Task[]>; // 按类型过滤的缓存
}

/** 活跃任务最大加载数量（与 STORAGE_LIMITS.MAX_RETAINED_TASKS 对齐） */
const MAX_ACTIVE_LOAD = STORAGE_LIMITS.MAX_RETAINED_TASKS * 2; // 200

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
   * 获取活跃任务（排除已归档，带 limit，使用 cursor 按 createdAt 倒序）
   */
  async getAllTasks(options?: { status?: TaskStatus; type?: TaskType; limit?: number; includeArchived?: boolean }): Promise<Task[]> {
    const hasTypeFilter = options?.type !== undefined;
    const hasStatusFilter = options?.status !== undefined;
    const includeArchived = options?.includeArchived ?? false;
    const limit = options?.limit ?? MAX_ACTIVE_LOAD;

    // 检查缓存（仅类型过滤）
    if (this.isCacheValid() && this.cache) {
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
        const index = store.index('createdAt');
        const results: Task[] = [];
        const cursorReq = index.openCursor(null, 'prev'); // 按 createdAt 倒序

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || results.length >= limit) {
            resolve(results);
            return;
          }
          const task = cursor.value as SWTask;
          if (!includeArchived && task.archived) {
            cursor.continue();
            return;
          }
          // 应用过滤条件
          if (hasStatusFilter && task.status !== options!.status) {
            cursor.continue();
            return;
          }
          if (hasTypeFilter && task.type !== options!.type) {
            cursor.continue();
            return;
          }
          results.push(convertSWTaskToTask(task));
          cursor.continue();
        };

        cursorReq.onerror = () => {
          reject(new Error(`Failed to get tasks: ${cursorReq.error?.message}`));
        };
      });

      // 更新缓存
      if (!this.cache || !this.isCacheValid()) {
        this.cache = { byType: new Map() };
        this.updateCacheTimestamp();
      }

      if (hasTypeFilter && !hasStatusFilter) {
        this.cache.byType.set(options!.type!, tasks);
      }

      return tasks;
    } catch (error) {
      console.error('[TaskStorageReader] Error getting all tasks:', error);
      return [];
    }
  }

  /**
   * 为素材库读取轻量任务记录，避免把聊天/分析等大字段整体拉入内存。
   */
  async getAssetTasks(options?: { limit?: number; includeArchived?: boolean }): Promise<AssetTaskRecord[]> {
    const includeArchived = options?.includeArchived ?? false;
    const limit = options?.limit ?? MAX_ACTIVE_LOAD;

    try {
      const db = await this.getDB();

      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        return [];
      }

      return await new Promise<AssetTaskRecord[]>((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readonly');
        const store = transaction.objectStore(TASKS_STORE);
        const index = store.index('createdAt');
        const results: AssetTaskRecord[] = [];
        const cursorReq = index.openCursor(null, 'prev');

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || results.length >= limit) {
            resolve(results);
            return;
          }

          const task = cursor.value as SWTask;
          if (!includeArchived && task.archived) {
            cursor.continue();
            return;
          }
          if (task.status !== TaskStatus.COMPLETED) {
            cursor.continue();
            return;
          }

          const assetTask = convertSWTaskToAssetTask(task);
          if (!assetTask) {
            cursor.continue();
            return;
          }

          results.push(assetTask);
          cursor.continue();
        };

        cursorReq.onerror = () => {
          reject(new Error(`Failed to get asset tasks: ${cursorReq.error?.message}`));
        };
      });
    } catch (error) {
      console.error('[TaskStorageReader] Error getting asset tasks:', error);
      return [];
    }
  }

  /**
   * 分页读取提示词历史所需的轻量任务摘要，避免把大字段暴露给 UI。
   */
  async getPromptHistoryTaskSummaries(options?: {
    offset?: number;
    limit?: number;
    includeArchived?: boolean;
    types?: TaskType[];
    statuses?: TaskStatus[];
  }): Promise<PromptHistoryTaskPage> {
    const includeArchived = options?.includeArchived ?? false;
    const limit = Math.min(Math.max(options?.limit ?? 40, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);
    const typeFilter = options?.types?.length ? new Set(options.types) : null;
    const statusFilter = options?.statuses?.length
      ? new Set(options.statuses)
      : new Set([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]);

    try {
      const db = await this.getDB();

      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        return { items: [], nextOffset: offset, hasMore: false };
      }

      return await new Promise<PromptHistoryTaskPage>((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readonly');
        const store = transaction.objectStore(TASKS_STORE);
        const index = store.index('createdAt');
        const items: PromptHistoryTaskSummary[] = [];
        let matched = 0;
        let hasMore = false;
        const cursorReq = index.openCursor(null, 'prev');

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve({ items, nextOffset: matched, hasMore });
            return;
          }

          const task = cursor.value as SWTask;
          if (!includeArchived && task.archived) {
            cursor.continue();
            return;
          }
          if (typeFilter && !typeFilter.has(task.type)) {
            cursor.continue();
            return;
          }
          if (statusFilter && !statusFilter.has(task.status)) {
            cursor.continue();
            return;
          }

          const summary = convertSWTaskToPromptHistorySummary(task);
          if (!summary) {
            cursor.continue();
            return;
          }

          if (matched < offset) {
            matched++;
            cursor.continue();
            return;
          }

          if (items.length >= limit) {
            hasMore = true;
            resolve({ items, nextOffset: matched, hasMore });
            return;
          }

          items.push(summary);
          matched++;
          cursor.continue();
        };

        cursorReq.onerror = () => {
          reject(
            new Error(
              `Failed to get prompt history tasks: ${cursorReq.error?.message}`
            )
          );
        };
      });
    } catch (error) {
      console.error('[TaskStorageReader] Error getting prompt history tasks:', error);
      return { items: [], nextOffset: offset, hasMore: false };
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
   * 获取已归档任务（用于历史任务面板，cursor 分页）
   */
  async getArchivedTasks(
    offset = 0,
    limit = 50
  ): Promise<{ tasks: Task[]; hasMore: boolean }> {
    try {
      const db = await this.getDB();
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        return { tasks: [], hasMore: false };
      }

      return new Promise((resolve, reject) => {
        const tx = db.transaction(TASKS_STORE, 'readonly');
        const store = tx.objectStore(TASKS_STORE);
        const index = store.index('createdAt');
        const results: Task[] = [];
        let skipped = 0;
        const cursorReq = index.openCursor(null, 'prev');

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || results.length >= limit) {
            resolve({ tasks: results, hasMore: !!cursor });
            return;
          }
          const task = cursor.value as SWTask;
          if (!task.archived) {
            cursor.continue();
            return;
          }
          if (skipped < offset) {
            skipped++;
            cursor.continue();
            return;
          }
          results.push(convertSWTaskToTask(task));
          cursor.continue();
        };

        cursorReq.onerror = () => reject(cursorReq.error);
      });
    } catch {
      return { tasks: [], hasMore: false };
    }
  }

  /**
   * 获取已归档任务总数（用于历史标签数量展示）
   */
  async getArchivedTaskCount(): Promise<number> {
    try {
      const db = await this.getDB();
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        return 0;
      }

      return new Promise((resolve, reject) => {
        const tx = db.transaction(TASKS_STORE, 'readonly');
        const store = tx.objectStore(TASKS_STORE);
        const index = store.index('createdAt');
        let count = 0;
        const cursorReq = index.openCursor();

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve(count);
            return;
          }

          const task = cursor.value as SWTask;
          if (task.archived) {
            count++;
          }
          cursor.continue();
        };

        cursorReq.onerror = () => reject(cursorReq.error);
      });
    } catch {
      return 0;
    }
  }

  /**
   * 获取单个任务（包括已归档的）
   */
  async getTask(taskId: string): Promise<Task | null> {
    try {
      const swTask = await this.getById<SWTask>(TASKS_STORE, taskId);
      return swTask ? convertSWTaskToTask(swTask) : null;
    } catch {
      return null;
    }
  }

  async findImageTaskIdByResultUrl(
    imageUrl: string,
    options?: { includeArchived?: boolean; limit?: number }
  ): Promise<string | null> {
    const includeArchived = options?.includeArchived ?? true;
    const limit = options?.limit ?? STORAGE_LIMITS.MAX_RETAINED_TASKS * 10;
    const targetUrl = normalizeComparableImageTaskUrl(imageUrl);

    try {
      const db = await this.getDB();
      if (!db.objectStoreNames.contains(TASKS_STORE)) {
        return null;
      }

      return await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(TASKS_STORE, 'readonly');
        const store = tx.objectStore(TASKS_STORE);
        const index = store.index('createdAt');
        let scannedImageTasks = 0;
        const cursorReq = index.openCursor(null, 'prev');

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || scannedImageTasks >= limit) {
            resolve(null);
            return;
          }

          const task = cursor.value as SWTask;
          if (!includeArchived && task.archived) {
            cursor.continue();
            return;
          }
          if (task.type !== TaskType.IMAGE) {
            cursor.continue();
            return;
          }

          scannedImageTasks++;
          if (swImageTaskMatchesUrl(task, targetUrl)) {
            resolve(task.id);
            return;
          }

          cursor.continue();
        };

        cursorReq.onerror = () => {
          reject(
            new Error(
              `Failed to find image task by result URL: ${cursorReq.error?.message}`
            )
          );
        };
      });
    } catch (error) {
      console.error('[TaskStorageReader] Error finding image task:', error);
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
