/**
 * Backup Export Service
 * 导出数据到 ZIP 文件，支持自动分片
 */

import { workspaceStorageService } from '../workspace-storage-service';
import { workspaceService } from '../workspace-service';
import { kvStorageService } from '../kv-storage-service';
import {
  initPromptStorageCache,
  getPromptHistory,
  getVideoPromptHistory,
  getImagePromptHistory,
} from '../prompt-storage-service';
import { taskStorageReader } from '../task-storage-reader';
import { LS_KEYS_TO_MIGRATE } from '../../constants/storage-keys';
import { DrawnixExportedType } from '../../data/types';
import { collectEmbeddedMediaFromElements } from '../../data/json';
import { VERSIONS } from '../../constants';
import localforage from 'localforage';
import { ASSET_CONSTANTS } from '../../constants/ASSET_CONSTANTS';
import { unifiedCacheService } from '../unified-cache-service';
import { analytics } from '../../utils/posthog-analytics';
import { exportAllData as exportKnowledgeBaseData } from '../kb-import-export-service';
import { APP_DB_NAME, APP_DB_STORES } from '../app-database';
import { BackupPartManager } from './backup-part-manager';
import { encryptBackupJson } from './backup-crypto';
import { checksumJson } from './backup-checksum';
import { exportEnvironmentData } from './environment-backup-service';
import { readStoreRecords } from './idb-store-backup';
import {
  BACKUP_VERSION,
  BACKUP_SIGNATURE,
  BackupManifest,
  BackupWorkspaceState,
  BackupOptions,
  PromptsData,
  PresetStorageData,
  DrawnixFileData,
  ExportResult,
  ProgressCallback,
} from './types';
import {
  getExtensionFromMimeType,
  generateIdFromUrl,
  normalizeBackupAssetType,
  appendUrlHashToBackupName,
  ensureUniqueBackupName,
  buildAssetExportBaseName,
  buildFolderPathMap,
  mergePromptData,
  sanitizeFileName,
} from './backup-utils';

class BackupExportService {
  private buildAssetExportBaseName(assetId: string, createdAt?: number): string {
    return buildAssetExportBaseName(assetId, createdAt);
  }

  private shouldExportAssetByRange(
    createdAt: number | undefined,
    options: BackupOptions
  ): boolean {
    const { timeRangeStart, timeRangeEnd } = options;

    if (!timeRangeStart && !timeRangeEnd) {
      return true;
    }

    if (typeof createdAt !== 'number' || Number.isNaN(createdAt) || createdAt <= 0) {
      return false;
    }

    if (typeof timeRangeStart === 'number' && createdAt < timeRangeStart) {
      return false;
    }

    if (typeof timeRangeEnd === 'number' && createdAt > timeRangeEnd) {
      return false;
    }

    return true;
  }

  /**
   * 导出数据到 ZIP 文件（内部自动下载分片）
   */
  async exportToZip(
    options: BackupOptions,
    onProgress?: ProgressCallback
  ): Promise<ExportResult> {
    const startTime = Date.now();
    const mode = options.mode || 'incremental';
    const includeEnvironment = options.includeEnvironment || mode === 'complete';
    const includeTasks = true;
    const warnings: string[] = [];

    if (options.includeSecrets && !includeEnvironment) {
      throw new Error('包含敏感配置时必须同时包含环境数据');
    }
    if (options.includeSecrets && !options.encryptionPassword?.trim()) {
      throw new Error('包含敏感配置时必须输入备份密码');
    }

    analytics.track('backup_export_start', {
      mode,
      includePrompts: options.includePrompts,
      includeProjects: options.includeProjects,
      includeAssets: options.includeAssets,
      includeEnvironment,
      includeSecrets: !!options.includeSecrets,
    });

    onProgress?.(5, '正在准备数据...');

    // 生成备份文件名和 backupId
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
    const baseFilename = `aitu_backup_${dateStr}_${timeStr}`;
    const backupId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const partManager = new BackupPartManager(baseFilename, backupId);

    // 获取当前工作区状态
    const currentBoard = workspaceService.getCurrentBoard();
    const workspaceState: BackupWorkspaceState = {
      currentBoardId: currentBoard?.id || null,
      currentBoardName: currentBoard?.name,
      viewport: currentBoard?.viewport,
    };

    const manifest: BackupManifest = {
      signature: BACKUP_SIGNATURE,
      version: BACKUP_VERSION,
      schemaVersion: BACKUP_VERSION,
      backupMode: mode,
      createdAt: Date.now(),
      includes: {
        prompts: options.includePrompts,
        projects: options.includeProjects,
        assets: options.includeAssets,
        tasks: includeTasks,
        knowledgeBase: options.includeKnowledgeBase,
        environment: includeEnvironment,
      },
      encryption: {
        enabled: !!options.includeSecrets,
        algorithm: options.includeSecrets ? 'AES-GCM' : undefined,
        kdf: options.includeSecrets ? 'PBKDF2-SHA256' : undefined,
        secretsFile: options.includeSecrets ? 'environment/secrets.enc.json' : undefined,
      },
      stats: {
        promptCount: 0, videoPromptCount: 0, imagePromptCount: 0,
        folderCount: 0, boardCount: 0, assetCount: 0, taskCount: 0, kbNoteCount: 0,
      },
      domainStats: {},
      workspaceState,
    };

    const allTasksForBackup = includeTasks || options.includePrompts
      ? await this.collectTasksForBackup()
      : [];

    // 导出提示词（非素材，放入 Part1）
    if (options.includePrompts) {
      onProgress?.(10, '正在导出提示词...');
      const promptsData = await this.collectPromptData(allTasksForBackup);
      partManager.addFile('prompts.json', promptsData);
      manifest.stats.promptCount = promptsData.promptHistory.length;
      manifest.stats.videoPromptCount = promptsData.videoPromptHistory.length;
      manifest.stats.imagePromptCount = promptsData.imagePromptHistory.length;
      manifest.domainStats!.prompts = {
        count:
          promptsData.promptHistory.length +
          promptsData.videoPromptHistory.length +
          promptsData.imagePromptHistory.length,
        checksum: await checksumJson(promptsData),
      };
    }

    if (includeEnvironment) {
      onProgress?.(20, '正在导出环境配置...');
      const envResult = await exportEnvironmentData(!!options.includeSecrets);
      partManager.addFile('environment/data.json', envResult.data);
      if (envResult.secrets) {
        const encryptedSecrets = await encryptBackupJson(
          envResult.secrets,
          options.encryptionPassword || ''
        );
        partManager.addFile('environment/secrets.enc.json', encryptedSecrets);
      }
      manifest.stats.workflowCount = envResult.data.appDb.workflows.length;
      manifest.stats.environmentItemCount = envResult.stats.count;
      manifest.stats.chatSessionCount =
        envResult.data.localForage.chatSessions.length;
      manifest.stats.audioPlaylistCount =
        envResult.data.localForage.audioPlaylists.length;
      manifest.stats.characterCount =
        envResult.data.localForage.characters.length;
      manifest.domainStats!.environment = envResult.stats;
    }

    // 导出知识库（非素材，放入 Part1）
    if (options.includeKnowledgeBase) {
      onProgress?.(30, '正在导出知识库...');
      try {
        const kbData = await exportKnowledgeBaseData();
        partManager.addFile('knowledge-base.json', kbData);
        manifest.stats.kbNoteCount = kbData.notes.length;
        manifest.domainStats!.knowledgeBase = {
          count: kbData.notes.length,
          checksum: await checksumJson(kbData),
        };
      } catch (error) {
        console.error('Failed to export knowledge base:', error);
        warnings.push('知识库导出失败，已跳过');
      }
    }

    // 导出项目（非素材，放入 Part1）
    if (options.includeProjects) {
      onProgress?.(40, '正在导出项目...');
      await this.exportProjects(partManager, manifest, !options.includeAssets, onProgress);
    }

    // 导出素材（通过 partManager.addAssetBlob 自动分片）
    if (options.includeAssets) {
      onProgress?.(50, '正在导出素材...');
      await this.exportAssets(partManager, manifest, options, onProgress);
    }

    if (includeTasks) {
      onProgress?.(84, '正在导出任务数据...');
      if (allTasksForBackup.length > 0) {
        partManager.addFile('tasks.json', allTasksForBackup);
        manifest.stats.taskCount = allTasksForBackup.length;
        manifest.domainStats!.tasks = {
          count: allTasksForBackup.length,
          checksum: await checksumJson(allTasksForBackup),
        };
      }
    }

    onProgress?.(85, '正在压缩文件...');

    // 完成所有分片
    const result = await partManager.finalizeAll(manifest);

    onProgress?.(100, '导出完成');

    analytics.track('backup_export_success', {
      duration: Date.now() - startTime,
      totalParts: result.totalParts,
      promptCount: manifest.stats.promptCount + manifest.stats.videoPromptCount + manifest.stats.imagePromptCount,
      projectCount: manifest.stats.boardCount,
      assetCount: manifest.stats.assetCount,
      taskCount: manifest.stats.taskCount,
    });

    return {
      ...result,
      domainStats: manifest.domainStats,
      warnings,
    };
  }

  /**
   * 下载 ZIP 文件（供外部单独使用）
   */
  downloadZip(blob: Blob, filename?: string): void {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
    const defaultFilename = `aitu_backup_${dateStr}_${timeStr}.zip`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || defaultFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  /**
   * 收集提示词数据
   */
  private async collectPromptData(allTasks: unknown[] = []): Promise<PromptsData> {
    await initPromptStorageCache();

    const promptHistory = getPromptHistory();
    const videoPromptHistory = getVideoPromptHistory();
    const imagePromptHistory = getImagePromptHistory();

    const presetSettings = await kvStorageService.get<PresetStorageData>(
      LS_KEYS_TO_MIGRATE.PRESET_SETTINGS
    );
    const deletedPromptContents = await kvStorageService.get<string[]>(
      LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS
    );
    const promptHistoryOverrides = await kvStorageService.get<
      PromptsData['promptHistoryOverrides']
    >(LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES);

    return mergePromptData({
      promptHistory,
      videoPromptHistory,
      imagePromptHistory,
      presetSettings: presetSettings || undefined,
      deletedPromptContents: deletedPromptContents || [],
      promptHistoryOverrides: promptHistoryOverrides || [],
      allTasks,
    });
  }

  private async collectTasksForBackup(): Promise<unknown[]> {
    try {
      const records = await readStoreRecords<Record<string, unknown>>(
        APP_DB_NAME,
        APP_DB_STORES.TASKS
      );
      return records
        .map(record => this.sanitizeTaskForBackup(record.value))
        .filter((task): task is Record<string, unknown> => !!task);
    } catch (error) {
      console.warn('[BackupRestore] Failed to collect tasks:', error);
      return [];
    }
  }

  private sanitizeTaskForBackup(task: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!task || typeof task !== 'object' || typeof task.id !== 'string') {
      return null;
    }
    const { config, ...rest } = task;
    return rest;
  }
  /**
   * 导出项目数据（写入 partManager）
   */
  private async exportProjects(
    partManager: BackupPartManager,
    manifest: BackupManifest,
    includeEmbeddedMedia: boolean,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const [folders, boards] = await Promise.all([
      workspaceStorageService.loadAllFolders(),
      workspaceStorageService.loadAllBoards(),
    ]);

    const folderPathMap = buildFolderPathMap(folders);

    // 创建文件夹结构（空文件夹通过 manifest 记录即可）
    manifest.stats.folderCount = folders.length;
    partManager.addFile('projects/_folders.json', { folders });

    for (let i = 0; i < boards.length; i++) {
      const board = boards[i];
      const folderPath = board.folderId ? folderPathMap.get(board.folderId) : null;
      const safeName = sanitizeFileName(board.name);
      const boardPath = folderPath
        ? `projects/${folderPath}/${safeName}.drawnix`
        : `projects/${safeName}.drawnix`;

      const embeddedMedia = includeEmbeddedMedia
        ? await collectEmbeddedMediaFromElements(board.elements || [])
        : undefined;

      const drawnixData: DrawnixFileData = {
        type: DrawnixExportedType.drawnix,
        version: VERSIONS.drawnix,
        source: 'backup',
        elements: board.elements || [],
        viewport: board.viewport || { zoom: 1 },
        theme: board.theme,
        embeddedMedia,
        boardMeta: {
          id: board.id,
          name: board.name,
          folderId: board.folderId,
          order: board.order,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
        },
      };

      partManager.addFile(boardPath, drawnixData);

      if (onProgress && boards.length > 0) {
        const progress = 25 + Math.round(((i + 1) / boards.length) * 20);
        onProgress(progress, `正在导出画板 (${i + 1}/${boards.length})...`);
      }
    }
    manifest.stats.boardCount = boards.length;
  }
  /**
   * 获取图片的实际生成时间（从任务完成时间获取）
   */
  private async getActualCreationTime(item: import('../unified-cache-service').CachedMedia): Promise<number | undefined> {
    try {
      // 如果缓存元数据中有任务ID，尝试从任务获取完成时间
      if (item.metadata?.taskId) {
        const task = await taskStorageReader.getTask(item.metadata.taskId);
        if (task?.completedAt) {
          return task.completedAt;
        }
        if (task?.createdAt) {
          return task.createdAt;
        }
      }
      
      // 如果没有任务ID或任务不存在，尝试从URL中提取时间信息
      // 例如：URL可能包含时间戳参数
      const url = new URL(item.url);
      const timestampParam = url.searchParams.get('t') || url.searchParams.get('timestamp');
      if (timestampParam) {
        const timestamp = parseInt(timestampParam, 10);
        if (!Number.isNaN(timestamp) && timestamp > 0) {
          return timestamp;
        }
      }
      
      // 最后回退到缓存时间
      return item.cachedAt;
    } catch (error) {
      console.warn(`[BackupRestore] Failed to get actual creation time for ${item.url}:`, error);
      return item.cachedAt;
    }
  }

  /**
   * 导出素材数据（通过 partManager.addAssetBlob 自动分片）
   */
  private async exportAssets(
    partManager: BackupPartManager,
    manifest: BackupManifest,
    options: BackupOptions,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const exportedUrls = new Set<string>();
    const usedBaseNames = new Set<string>();
    let exportedCount = 0;

    // 1. 导出本地素材库
    const store = localforage.createInstance({
      name: ASSET_CONSTANTS.STORAGE_NAME,
      storeName: ASSET_CONSTANTS.STORE_NAME,
    });

    const assetKeys = await store.keys();
    const totalItems = assetKeys.length;

    for (let i = 0; i < assetKeys.length; i++) {
      try {
        const stored = await store.getItem<import('../../types/asset.types').StoredAsset>(assetKeys[i]);
        if (stored && this.shouldExportAssetByRange(stored.createdAt, options)) {
          const blobData = await unifiedCacheService.getCachedBlob(stored.url);
          if (blobData) {
            const baseName = appendUrlHashToBackupName(
              this.buildAssetExportBaseName(stored.id, stored.createdAt),
              stored.url
            );
            await this.addAssetToPart(partManager, usedBaseNames, {
              baseName,
              blobData,
              metaData: stored as unknown as Record<string, unknown>,
              createdAt: stored.createdAt,
            });
            exportedCount++;
            exportedUrls.add(stored.url);
          }
        }
      } catch (error) {
        console.warn(`[BackupRestore] Failed to load asset ${assetKeys[i]}:`, error);
      }

      if (onProgress && totalItems > 0) {
        const progress = 50 + Math.round(((i + 1) / totalItems) * 15);
        onProgress(progress, `正在导出本地素材 (${i + 1}/${totalItems})...`);
      }
    }

    // 2. 导出 unified-cache 中的缓存媒体
    const cachedMedia = await unifiedCacheService.getAllCacheMetadata();
    const cacheItems = cachedMedia.filter(item => !exportedUrls.has(item.url));
    const cacheTotal = cacheItems.length;

    for (let i = 0; i < cacheItems.length; i++) {
      const item = cacheItems[i];
      try {
        // 获取实际生成时间
        const actualCreationTime = await this.getActualCreationTime(item);
        
        if (!this.shouldExportAssetByRange(actualCreationTime, options)) {
          continue;
        }
        const itemId = item.metadata?.taskId || generateIdFromUrl(item.url);
        const exportCreatedAt = actualCreationTime || item.cachedAt;
        const metaData = {
          id: itemId,
          url: item.url,
          type: normalizeBackupAssetType(item.type, item.mimeType),
          mimeType: item.mimeType,
          size: item.size,
          source: 'AI_GENERATED',
          createdAt: exportCreatedAt,
          updatedAt: item.lastUsed,
          metadata: item.metadata,
        };

        const blobData = await unifiedCacheService.getCachedBlob(item.url);
        if (blobData) {
          const baseName = appendUrlHashToBackupName(
            this.buildAssetExportBaseName(itemId, exportCreatedAt),
            item.url
          );
          await this.addAssetToPart(partManager, usedBaseNames, {
            baseName,
            blobData,
            metaData,
            createdAt: exportCreatedAt,
          });
          exportedCount++;
          exportedUrls.add(item.url);
        }
      } catch (error) {
        console.warn(`[BackupRestore] Failed to export cached media ${item.url}:`, error);
      }

      if (onProgress && cacheTotal > 0) {
        const progress = 65 + Math.round(((i + 1) / cacheTotal) * 10);
        onProgress(progress, `正在导出缓存媒体 (${i + 1}/${cacheTotal})...`);
      }
    }

    manifest.stats.assetCount = exportedCount;
    manifest.domainStats!.assets = { count: exportedCount };
  }

  private async addAssetToPart(
    partManager: BackupPartManager,
    usedBaseNames: Set<string>,
    asset: {
      baseName: string;
      blobData: Blob;
      metaData: Record<string, unknown>;
      createdAt?: number;
    }
  ): Promise<void> {
    const mimeType =
      typeof asset.metaData?.mimeType === 'string'
        ? asset.metaData.mimeType
        : asset.blobData.type;
    const ext = getExtensionFromMimeType(mimeType);
    const uniqueBaseName = ensureUniqueBackupName(asset.baseName, usedBaseNames);

    await partManager.addAssetBlob(
      `${uniqueBaseName}${ext}`,
      asset.blobData,
      `${uniqueBaseName}.meta.json`,
      asset.metaData,
      asset.createdAt
    );
  }
}

export const backupExportService = new BackupExportService();
