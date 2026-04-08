/**
 * 任务分页同步服务
 * 实现任务的分页存储和增量同步
 */

import { Task, TaskStatus, TaskType } from '../../types/task.types';
import { taskStorageReader } from '../task-storage-reader';
import { taskQueueService } from '../task-queue';
import { gitHubApiService } from './github-api-service';
import { cryptoService } from './crypto-service';
import { logDebug, logInfo, logWarning } from './sync-log-service';
import { yieldToMain } from '@aitu/utils';
import {
  TaskIndex,
  TaskIndexItem,
  TaskPage,
  TaskPageInfo,
  CompactTask,
  CompactTaskResult,
  CompactTaskError,
  CompactGenerationParams,
  TaskSyncChanges,
  PAGED_SYNC_CONFIG,
  PAGED_SYNC_VERSION,
  SYNC_FILES_PAGED,
} from './types';

// ====================================
// 终态判断
// ====================================

/**
 * 判断任务是否处于终态
 */
function isTerminalStatus(status: string): boolean {
  return status === TaskStatus.COMPLETED ||
         status === TaskStatus.FAILED ||
         status === TaskStatus.CANCELLED ||
         status === 'completed' ||
         status === 'failed' ||
         status === 'cancelled';
}

// ====================================
// 数据转换
// ====================================

/**
 * 将完整 Task 转换为精简的 CompactTask
 */
function compactTask(task: Task, syncVersion: number): CompactTask {
  const compactParams: CompactGenerationParams = {
    prompt: task.params.prompt || '',
    width: task.params.width,
    height: task.params.height,
    size: task.params.size,
    duration: task.params.duration,
    style: task.params.style,
    model: task.params.model,
    autoInsertToCanvas: task.params.autoInsertToCanvas,
  };

  let compactResult: CompactTaskResult | undefined;
  if (task.result) {
    compactResult = {
      url: task.result.url,
      urls: task.result.urls,
      format: task.result.format,
      size: task.result.size,
      resultKind: task.result.resultKind,
      width: task.result.width,
      height: task.result.height,
      duration: task.result.duration,
      thumbnailUrl: task.result.thumbnailUrl,
      previewImageUrl: task.result.previewImageUrl,
      title: task.result.title,
      lyricsText: task.result.lyricsText,
      lyricsTitle: task.result.lyricsTitle,
      lyricsTags: task.result.lyricsTags,
      providerTaskId: task.result.providerTaskId,
      primaryClipId: task.result.primaryClipId,
      clipIds: task.result.clipIds,
      characterUsername: task.result.characterUsername,
      characterProfileUrl: task.result.characterProfileUrl,
      characterPermalink: task.result.characterPermalink,
      // 省略 chatResponse 和 toolCalls 大字段
    };
  }

  let compactError: CompactTaskError | undefined;
  if (task.error) {
    compactError = {
      code: task.error.code,
      message: task.error.message,
      // 省略 details 大字段
    };
  }

  return {
    id: task.id,
    type: task.type,
    status: task.status,
    params: compactParams,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    result: compactResult,
    error: compactError,
    progress: task.progress,
    remoteId: task.remoteId,
    executionPhase: task.executionPhase,
    savedToLibrary: task.savedToLibrary,
    insertedToCanvas: task.insertedToCanvas,
    syncVersion,
  };
}

/**
 * 生成任务索引项
 */
function createTaskIndexItem(
  task: Task,
  syncVersion: number,
  pageId: number
): TaskIndexItem {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    syncVersion,
    pageId,
    promptPreview: task.params.prompt?.substring(0, PAGED_SYNC_CONFIG.PROMPT_PREVIEW_LENGTH),
    thumbnailUrl:
      task.result?.thumbnailUrl ||
      task.result?.previewImageUrl ||
      task.result?.url,
  };
}

/**
 * 将任务列表转换为分页格式
 */
export function convertTasksToPagedFormat(
  tasks: Task[],
  existingSyncVersions?: Map<string, number>
): { index: TaskIndex; pages: TaskPage[] } {
  const now = Date.now();
  const pages: TaskPage[] = [];
  const items: TaskIndexItem[] = [];
  const pageInfos: TaskPageInfo[] = [];

  // 按创建时间排序
  const sortedTasks = [...tasks].sort((a, b) => a.createdAt - b.createdAt);

  let currentPage: CompactTask[] = [];
  let currentPageId = 0;
  let currentPageSize = 0;

  for (const task of sortedTasks) {
    // 获取或生成 syncVersion
    const existingVersion = existingSyncVersions?.get(task.id);
    const syncVersion = existingVersion ?? 1;

    const compact = compactTask(task, syncVersion);
    const compactSize = JSON.stringify(compact).length;

    // 检查是否需要新建分页
    const shouldCreateNewPage =
      currentPage.length >= PAGED_SYNC_CONFIG.MAX_TASKS_PER_PAGE ||
      (currentPageSize + compactSize > PAGED_SYNC_CONFIG.MAX_PAGE_SIZE && currentPage.length > 0);

    if (shouldCreateNewPage) {
      // 保存当前分页
      pages.push({
        pageId: currentPageId,
        updatedAt: now,
        tasks: currentPage,
      });

      pageInfos.push({
        pageId: currentPageId,
        filename: SYNC_FILES_PAGED.taskPageFile(currentPageId),
        itemCount: currentPage.length,
        totalSize: currentPageSize,
        updatedAt: now,
      });

      // 创建新分页
      currentPageId++;
      currentPage = [];
      currentPageSize = 0;
    }

    currentPage.push(compact);
    currentPageSize += compactSize;

    // 添加索引项
    items.push(createTaskIndexItem(task, syncVersion, currentPageId));
  }

  // 保存最后一个分页
  if (currentPage.length > 0) {
    pages.push({
      pageId: currentPageId,
      updatedAt: now,
      tasks: currentPage,
    });

    pageInfos.push({
      pageId: currentPageId,
      filename: SYNC_FILES_PAGED.taskPageFile(currentPageId),
      itemCount: currentPage.length,
      totalSize: currentPageSize,
      updatedAt: now,
    });
  }

  const index: TaskIndex = {
    version: PAGED_SYNC_VERSION,
    updatedAt: now,
    pages: pageInfos,
    items,
  };

  return { index, pages };
}

// ====================================
// 增量同步
// ====================================

/**
 * 比较本地和远程索引，确定需要同步的变更
 */
export function compareTaskIndexes(
  localIndex: TaskIndex,
  remoteIndex: TaskIndex | null
): TaskSyncChanges {
  const toUpload: string[] = [];
  const toDownload: string[] = [];
  const skipped: string[] = [];
  const pagesToUpload = new Set<number>();
  const pagesToDownload = new Set<number>();

  // 创建远程索引 Map
  const remoteItemMap = new Map<string, TaskIndexItem>();
  if (remoteIndex) {
    for (const item of remoteIndex.items) {
      remoteItemMap.set(item.id, item);
    }
  }

  // 检查本地任务
  for (const localItem of localIndex.items) {
    const remoteItem = remoteItemMap.get(localItem.id);

    if (!remoteItem) {
      // 远程不存在，需要上传
      toUpload.push(localItem.id);
      pagesToUpload.add(localItem.pageId);
    } else if (isTerminalStatus(localItem.status) && localItem.syncVersion === remoteItem.syncVersion) {
      // 终态且 syncVersion 相同，跳过
      skipped.push(localItem.id);
    } else if (localItem.updatedAt > remoteItem.updatedAt) {
      // 本地更新，需要上传
      toUpload.push(localItem.id);
      pagesToUpload.add(localItem.pageId);
    } else if (localItem.updatedAt < remoteItem.updatedAt) {
      // 远程更新，需要下载
      toDownload.push(localItem.id);
      pagesToDownload.add(remoteItem.pageId);
    } else {
      // 时间相同，跳过
      skipped.push(localItem.id);
    }

    // 从远程 Map 中移除已处理的
    remoteItemMap.delete(localItem.id);
  }

  // 远程独有的任务需要下载
  for (const [id, item] of remoteItemMap) {
    toDownload.push(id);
    pagesToDownload.add(item.pageId);
  }

  return {
    toUpload,
    toDownload,
    pagesToUpload: Array.from(pagesToUpload),
    pagesToDownload: Array.from(pagesToDownload),
    skipped,
  };
}

/**
 * 判断是否需要同步特定任务
 */
export function shouldSyncTask(
  local: TaskIndexItem,
  remote: TaskIndexItem | null
): boolean {
  // 远程不存在，需要上传
  if (!remote) return true;

  // 终态且 syncVersion 相同，跳过
  if (isTerminalStatus(local.status) && local.syncVersion === remote.syncVersion) {
    return false;
  }

  // updatedAt 更新，需要同步
  return local.updatedAt > remote.updatedAt;
}

// ====================================
// 任务分页同步服务
// ====================================

class TaskSyncService {
  /**
   * 收集本地已完成的任务
   */
  async collectLocalTasks(): Promise<Task[]> {
    const allTasks = await taskStorageReader.getAllTasks();
    return allTasks.filter(
      task => task.status === TaskStatus.COMPLETED &&
        (task.type === TaskType.IMAGE || task.type === TaskType.VIDEO)
    );
  }

  /**
   * 构建本地任务索引
   */
  async buildLocalIndex(
    existingSyncVersions?: Map<string, number>
  ): Promise<{ index: TaskIndex; pages: TaskPage[] }> {
    const tasks = await this.collectLocalTasks();
    return convertTasksToPagedFormat(tasks, existingSyncVersions);
  }

  /**
   * 下载远程任务索引
   */
  async downloadRemoteIndex(
    gistId: string,
    customPassword?: string
  ): Promise<TaskIndex | null> {
    try {
      const content = await gitHubApiService.getGistFileContent(
        SYNC_FILES_PAGED.TASK_INDEX
      );

      if (!content) {
        logDebug('TaskSyncService: Remote task index not found');
        return null;
      }

      const decrypted = await cryptoService.decryptOrPassthrough(
        content,
        gistId,
        customPassword
      );

      return JSON.parse(decrypted) as TaskIndex;
    } catch (error: any) {
      logWarning('TaskSyncService: Failed to download remote task index', error);
      return null;
    }
  }

  /**
   * 下载远程任务分页
   */
  async downloadRemotePage(
    pageId: number,
    gistId: string,
    customPassword?: string
  ): Promise<TaskPage | null> {
    try {
      const filename = SYNC_FILES_PAGED.taskPageFile(pageId);
      const content = await gitHubApiService.getGistFileContent(filename);

      if (!content) {
        logWarning(`TaskSyncService: Remote task page ${pageId} not found`);
        return null;
      }

      const decrypted = await cryptoService.decryptOrPassthrough(
        content,
        gistId,
        customPassword
      );

      return JSON.parse(decrypted) as TaskPage;
    } catch (error: any) {
      logWarning(`TaskSyncService: Failed to download task page ${pageId}`, error);
      return null;
    }
  }

  /**
   * 上传任务索引和分页
   */
  async uploadTaskData(
    index: TaskIndex,
    pages: TaskPage[],
    pagesToUpload: number[],
    gistId: string,
    customPassword?: string
  ): Promise<void> {
    const files: Record<string, string> = {};

    // 加密并序列化索引
    const indexJson = JSON.stringify(index, null, 2);
    files[SYNC_FILES_PAGED.TASK_INDEX] = await cryptoService.encrypt(indexJson, gistId, customPassword);

    // 加密并序列化需要上传的分页
    let uploadedPageCount = 0;
    for (const pageId of pagesToUpload) {
      const page = pages.find(p => p.pageId === pageId);
      if (page) {
        const pageJson = JSON.stringify(page, null, 2);
        const filename = SYNC_FILES_PAGED.taskPageFile(pageId);
        files[filename] = await cryptoService.encrypt(pageJson, gistId, customPassword);
      }
      // 每处理 3 个分页让出主线程
      uploadedPageCount++;
      if (uploadedPageCount % 3 === 0) {
        await yieldToMain();
      }
    }

    logDebug('TaskSyncService: Uploading task data', {
      indexItems: index.items.length,
      pagesToUpload: pagesToUpload.length,
    });

    await gitHubApiService.updateGistFiles(files);

    logInfo('TaskSyncService: Task data uploaded successfully');
  }

  /**
   * 执行完整的任务同步
   */
  async syncTasks(
    gistId: string,
    customPassword?: string,
    remoteFiles?: Record<string, string>
  ): Promise<{
    uploaded: number;
    downloaded: number;
    skipped: number;
  }> {
    logDebug('TaskSyncService: Starting task sync');

    // 构建本地索引
    const { index: localIndex, pages: localPages } = await this.buildLocalIndex();
    // 让出主线程，避免 UI 阻塞
    await yieldToMain();

    // 下载远程索引
    const remoteIndex = await this.downloadRemoteIndex(gistId, customPassword);

    // 比较变更
    const changes = compareTaskIndexes(localIndex, remoteIndex);

    logDebug('TaskSyncService: Changes detected', {
      toUpload: changes.toUpload.length,
      toDownload: changes.toDownload.length,
      skipped: changes.skipped.length,
      pagesToUpload: changes.pagesToUpload.length,
      pagesToDownload: changes.pagesToDownload.length,
    });

    // 下载需要的分页
    let downloaded = 0;
    let downloadedPageCount = 0;
    for (const pageId of changes.pagesToDownload) {
      const page = await this.downloadRemotePage(pageId, gistId, customPassword);
      if (page) {
        // 恢复下载的任务到本地
        const tasksToRestore = page.tasks.map(compact => this.compactToTask(compact));
        await taskQueueService.restoreTasks(tasksToRestore);
        downloaded += page.tasks.length;
      }
      // 每处理 2 个分页让出主线程
      downloadedPageCount++;
      if (downloadedPageCount % 2 === 0) {
        await yieldToMain();
      }
    }

    // 上传本地变更
    if (changes.pagesToUpload.length > 0 || !remoteIndex) {
      await this.uploadTaskData(
        localIndex,
        localPages,
        changes.pagesToUpload.length > 0 ? changes.pagesToUpload : localPages.map(p => p.pageId),
        gistId,
        customPassword
      );
    }

    logInfo('TaskSyncService: Task sync completed', {
      uploaded: changes.toUpload.length,
      downloaded,
      skipped: changes.skipped.length,
    });

    return {
      uploaded: changes.toUpload.length,
      downloaded,
      skipped: changes.skipped.length,
    };
  }

  /**
   * 将 CompactTask 还原为 Task（用于恢复下载的任务）
   * 标记 syncedFromRemote = true，避免在 SW 重启时被错误地恢复执行
   */
  private compactToTask(compact: CompactTask): Task {
    return {
      id: compact.id,
      type: compact.type as TaskType,
      status: compact.status as TaskStatus,
      params: {
        prompt: compact.params.prompt,
        width: compact.params.width,
        height: compact.params.height,
        size: compact.params.size,
        duration: compact.params.duration,
        style: compact.params.style,
        model: compact.params.model,
        autoInsertToCanvas: compact.params.autoInsertToCanvas,
      },
      createdAt: compact.createdAt,
      updatedAt: compact.updatedAt,
      startedAt: compact.startedAt,
      completedAt: compact.completedAt,
      result: compact.result ? {
        url: compact.result.url || '',
        urls: compact.result.urls,
        format: compact.result.format || '',
        size: compact.result.size || 0,
        resultKind: compact.result.resultKind,
        width: compact.result.width,
        height: compact.result.height,
        duration: compact.result.duration,
        thumbnailUrl: compact.result.thumbnailUrl,
        previewImageUrl: compact.result.previewImageUrl,
        title: compact.result.title,
        lyricsText: compact.result.lyricsText,
        lyricsTitle: compact.result.lyricsTitle,
        lyricsTags: compact.result.lyricsTags,
        providerTaskId: compact.result.providerTaskId,
        primaryClipId: compact.result.primaryClipId,
        clipIds: compact.result.clipIds,
        characterUsername: compact.result.characterUsername,
        characterProfileUrl: compact.result.characterProfileUrl,
        characterPermalink: compact.result.characterPermalink,
      } : undefined,
      error: compact.error ? {
        code: compact.error.code,
        message: compact.error.message,
      } : undefined,
      progress: compact.progress,
      remoteId: compact.remoteId,
      executionPhase: compact.executionPhase as any,
      savedToLibrary: compact.savedToLibrary,
      insertedToCanvas: compact.insertedToCanvas,
      // 标记为远程同步的任务，不会被恢复执行
      syncedFromRemote: true,
    };
  }

  /**
   * 获取本地任务的 syncVersion Map
   * 用于增量更新时保持版本号
   */
  async getLocalSyncVersions(): Promise<Map<string, number>> {
    // 从本地存储获取已有的 syncVersion
    // 这里可以扩展为从 IndexedDB 读取
    return new Map();
  }

  /**
   * 更新任务的 syncVersion
   * 当任务内容变更时调用
   */
  incrementSyncVersion(
    currentVersions: Map<string, number>,
    taskId: string
  ): number {
    const current = currentVersions.get(taskId) || 0;
    const newVersion = current + 1;
    currentVersions.set(taskId, newVersion);
    return newVersion;
  }
}

/** 任务分页同步服务单例 */
export const taskSyncService = new TaskSyncService();
