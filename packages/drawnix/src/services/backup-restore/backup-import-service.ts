/**
 * Backup Import Service
 * 从 ZIP 文件导入数据（增量去重），兼容 v2/v3 manifest
 */

import JSZip from 'jszip';
import { workspaceStorageService } from '../workspace-storage-service';
import { workspaceService } from '../workspace-service';
import { kvStorageService } from '../kv-storage-service';
import {
  initPromptStorageCache,
  resetPromptStorageCache,
  getPromptHistory,
  getVideoPromptHistory,
  getImagePromptHistory,
} from '../prompt-storage-service';
import { taskStorageReader } from '../task-storage-reader';
import { taskQueueService } from '../task-queue';
import { Task } from '../../types/task.types';
import type { Folder, Board } from '../../types/workspace.types';
import { LS_KEYS_TO_MIGRATE } from '../../constants/storage-keys';
import localforage from 'localforage';
import { ASSET_CONSTANTS } from '../../constants/ASSET_CONSTANTS';
import { unifiedCacheService } from '../unified-cache-service';
import { analytics } from '../../utils/posthog-analytics';
import { knowledgeBaseService } from '../knowledge-base-service';
import {
  BACKUP_SIGNATURE,
  BackupManifest,
  PromptsData,
  PresetStorageData,
  DrawnixFileData,
  ImportResult,
  ProgressCallback,
  ensureElementIds,
} from './types';
import { restoreEmbeddedMedia } from '../../data/blob';
import { getExtensionFromMimeType, generateId } from './backup-utils';

class BackupImportService {
  async importFromZip(
    file: File,
    onProgress?: ProgressCallback
  ): Promise<ImportResult> {
    const startTime = Date.now();

    analytics.track('backup_import_start', {
      fileSize: file.size,
      fileName: file.name,
    });
    const result: ImportResult = {
      success: false,
      prompts: { imported: 0, skipped: 0 },
      projects: { folders: 0, boards: 0, merged: 0, skipped: 0 },
      assets: { imported: 0, skipped: 0 },
      tasks: { imported: 0, skipped: 0 },
      knowledgeBase: { directories: 0, notes: 0, tags: 0, skipped: 0 },
      errors: [],
    };

    try {
      onProgress?.(5, '正在读取文件...');
      const zip = await JSZip.loadAsync(file);

      onProgress?.(10, '正在验证文件格式...');
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        throw new Error('无效的备份文件：未找到 manifest.json');
      }

      const manifestContent = await manifestFile.async('string');
      const manifest: BackupManifest = JSON.parse(manifestContent);

      if (manifest.signature !== BACKUP_SIGNATURE) {
        throw new Error('无效的备份文件：签名不匹配');
      }
      // v2 和 v3 manifest 都支持，v3 有分片字段但导入逻辑不变（每个分片独立导入）

      if (manifest.includes.prompts) {
        onProgress?.(20, '正在导入提示词...');
        const promptsFile = zip.file('prompts.json');
        if (promptsFile) {
          const promptsContent = await promptsFile.async('string');
          const promptsData: PromptsData = JSON.parse(promptsContent);
          result.prompts = await this.importPromptData(promptsData);
        }
      }

      if (manifest.includes.knowledgeBase) {
        onProgress?.(30, '正在导入知识库...');
        const kbResult = await this.importKnowledgeBase(zip);
        result.knowledgeBase = kbResult;
        if (kbResult.errors && kbResult.errors.length > 0) {
          result.errors.push(...kbResult.errors);
        }
      }

      if (manifest.includes.projects) {
        onProgress?.(40, '正在导入项目...');
        result.projects = await this.importProjects(zip, onProgress);
      }

      if (manifest.includes.assets) {
        onProgress?.(60, '正在导入素材...');
        result.assets = await this.importAssets(zip, onProgress);
        onProgress?.(85, '正在导入任务数据...');
        result.tasks = await this.importTasks(zip);
      }

      if (result.projects.folders > 0 || result.projects.boards > 0 || result.projects.merged > 0) {
        await workspaceService.reload();
      }

      if (manifest.workspaceState) {
        result.workspaceState = manifest.workspaceState;
      }

      result.success = result.errors.length === 0;
      onProgress?.(100, '导入完成');

      analytics.track('backup_import_success', {
        duration: Date.now() - startTime,
        promptCount: result.prompts.imported,
        projectCount: result.projects.boards,
        assetCount: result.assets.imported,
        taskCount: result.tasks.imported,
        kbNoteCount: result.knowledgeBase.notes,
        skippedCount:
          result.prompts.skipped + result.projects.skipped +
          result.assets.skipped + result.tasks.skipped + result.knowledgeBase.skipped,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);
      analytics.track('backup_import_failed', {
        duration: Date.now() - startTime,
        error: errorMessage,
      });
    }

    return result;
  }
  private async importKnowledgeBase(zip: JSZip): Promise<{
    directories: number; notes: number; tags: number; skipped: number; errors: string[];
  }> {
    const kbFile = zip.file('knowledge-base.json');
    if (!kbFile) {
      return { directories: 0, notes: 0, tags: 0, skipped: 0, errors: [] };
    }
    try {
      const content = await kbFile.async('string');
      const data = JSON.parse(content);
      const r = await knowledgeBaseService.importAllData(data);
      return { directories: r.dirCount, notes: r.noteCount, tags: r.tagCount, skipped: 0, errors: [] };
    } catch (error) {
      console.error('Failed to import knowledge base:', error);
      return {
        directories: 0, notes: 0, tags: 0, skipped: 0,
        errors: [`Knowledge base import failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  private async importPromptData(data: PromptsData): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    const inputPromptHistory = data.promptHistory || [];
    const inputVideoPromptHistory = data.videoPromptHistory || [];
    const inputImagePromptHistory = data.imagePromptHistory || [];

    await initPromptStorageCache();
    const existingPrompts = getPromptHistory();
    const existingVideoPrompts = getVideoPromptHistory();
    const existingImagePrompts = getImagePromptHistory();

    const existingPromptIds = new Set(existingPrompts.map(p => p.id));
    const existingPromptContents = new Set(existingPrompts.map(p => p.content));
    const newPrompts = inputPromptHistory.filter(p => {
      if (existingPromptIds.has(p.id) || existingPromptContents.has(p.content)) { skipped++; return false; }
      imported++;
      return true;
    });

    const existingVideoIds = new Set(existingVideoPrompts.map(p => p.id));
    const existingVideoContents = new Set(existingVideoPrompts.map(p => p.content));
    const newVideoPrompts = inputVideoPromptHistory.filter(p => {
      if (existingVideoIds.has(p.id) || existingVideoContents.has(p.content)) { skipped++; return false; }
      imported++;
      return true;
    });

    const existingImageIds = new Set(existingImagePrompts.map(p => p.id));
    const existingImageContents = new Set(existingImagePrompts.map(p => p.content));
    const newImagePrompts = inputImagePromptHistory.filter(p => {
      if (existingImageIds.has(p.id) || existingImageContents.has(p.content)) { skipped++; return false; }
      imported++;
      return true;
    });
    await kvStorageService.set(LS_KEYS_TO_MIGRATE.PROMPT_HISTORY, [...existingPrompts, ...newPrompts]);
    await kvStorageService.set(LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY, [...existingVideoPrompts, ...newVideoPrompts]);
    await kvStorageService.set(LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY, [...existingImagePrompts, ...newImagePrompts]);

    const existingPreset = await kvStorageService.get<PresetStorageData>(LS_KEYS_TO_MIGRATE.PRESET_SETTINGS);
    if (existingPreset && data.presetSettings) {
      const mergedPreset: PresetStorageData = {
        image: {
          pinnedPrompts: [...new Set([...existingPreset.image.pinnedPrompts, ...data.presetSettings.image.pinnedPrompts])],
          deletedPrompts: [...new Set([...existingPreset.image.deletedPrompts, ...data.presetSettings.image.deletedPrompts])],
        },
        video: {
          pinnedPrompts: [...new Set([...existingPreset.video.pinnedPrompts, ...data.presetSettings.video.pinnedPrompts])],
          deletedPrompts: [...new Set([...existingPreset.video.deletedPrompts, ...data.presetSettings.video.deletedPrompts])],
        },
      };
      await kvStorageService.set(LS_KEYS_TO_MIGRATE.PRESET_SETTINGS, mergedPreset);
    } else if (data.presetSettings) {
      await kvStorageService.set(LS_KEYS_TO_MIGRATE.PRESET_SETTINGS, data.presetSettings);
    }

    await resetPromptStorageCache();
    return { imported, skipped };
  }
  private async importProjects(
    zip: JSZip,
    onProgress?: ProgressCallback
  ): Promise<{ folders: number; boards: number; merged: number; skipped: number }> {
    let foldersImported = 0;
    let boardsImported = 0;
    let boardsMerged = 0;
    let skipped = 0;

    const existingFolders = await workspaceStorageService.loadAllFolders();
    const existingBoards = await workspaceStorageService.loadAllBoards();
    const existingBoardIds = new Set(existingBoards.map(b => b.id));

    const drawnixFiles = Object.keys(zip.files).filter(
      name => name.startsWith('projects/') && name.endsWith('.drawnix') && !name.includes('/_')
    );

    if (drawnixFiles.length === 0) {
      return { folders: 0, boards: 0, merged: 0, skipped: 0 };
    }

    // 从目录结构推断文件夹
    const folderPaths = new Set<string>();
    const folderIdMap = new Map<string, string>();

    for (const filePath of drawnixFiles) {
      const relativePath = filePath.replace(/^projects\//, '');
      const parts = relativePath.split('/');
      if (parts.length > 1) {
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
          folderPaths.add(currentPath);
        }
      }
    }

    const sortedPaths = Array.from(folderPaths).sort((a, b) => {
      const depthA = a.split('/').length;
      const depthB = b.split('/').length;
      return depthA - depthB || a.localeCompare(b);
    });

    for (let i = 0; i < sortedPaths.length; i++) {
      const folderPath = sortedPaths[i];
      const parts = folderPath.split('/');
      const folderName = parts[parts.length - 1];
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      const parentId = parentPath ? folderIdMap.get(parentPath) || null : null;

      const folderId = generateId();
      folderIdMap.set(folderPath, folderId);

      const existingFolder = existingFolders.find(f => f.name === folderName && f.parentId === parentId);
      if (existingFolder) {
        folderIdMap.set(folderPath, existingFolder.id);
        skipped++;
        continue;
      }

      const folder: Folder = {
        id: folderId, name: folderName, parentId, order: i,
        isExpanded: true, createdAt: Date.now(), updatedAt: Date.now(),
      };
      await workspaceStorageService.saveFolder(folder);
      foldersImported++;
    }
    // 导入画板
    for (let i = 0; i < drawnixFiles.length; i++) {
      const filePath = drawnixFiles[i];
      try {
        const drawnixFile = zip.file(filePath);
        if (drawnixFile) {
          const drawnixContent = await drawnixFile.async('string');
          const drawnixData: DrawnixFileData = JSON.parse(drawnixContent);
          await restoreEmbeddedMedia(drawnixData.embeddedMedia);
          const boardMeta = drawnixData.boardMeta;

          const relativePath = filePath.replace(/^projects\//, '');
          const parts = relativePath.split('/');
          const folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
          const folderId = folderPath
            ? folderIdMap.get(folderPath) || boardMeta?.folderId || null
            : null;

          const fileName = parts[parts.length - 1] || 'unnamed.drawnix';
          const boardName = boardMeta?.name || fileName.replace('.drawnix', '');

          if (boardMeta?.id && existingBoardIds.has(boardMeta.id)) {
            const existingBoard = existingBoards.find(b => b.id === boardMeta.id);
            if (existingBoard) {
              const existingElementIds = new Set(
                (existingBoard.elements || []).map(el => el.id).filter((id): id is string => !!id)
              );
              const newElements = (drawnixData.elements || []).filter(el =>
                el.id ? !existingElementIds.has(el.id) : true
              );
              const mergedBoard: Board = {
                ...existingBoard,
                elements: [...(existingBoard.elements || []), ...ensureElementIds(newElements)],
                viewport: drawnixData.viewport || existingBoard.viewport,
                theme: drawnixData.theme || existingBoard.theme,
                updatedAt: Date.now(),
              };
              await workspaceStorageService.saveBoard(mergedBoard);
              boardsMerged++;
              continue;
            }
          }

          const board: Board = {
            id: boardMeta?.id || generateId(),
            name: boardName, folderId, order: boardMeta?.order ?? i,
            elements: ensureElementIds(drawnixData.elements || []),
            viewport: drawnixData.viewport, theme: drawnixData.theme,
            createdAt: boardMeta?.createdAt || Date.now(),
            updatedAt: boardMeta?.updatedAt || Date.now(),
          };
          await workspaceStorageService.saveBoard(board);
          boardsImported++;
        }
      } catch (error) {
        console.warn(`[BackupRestore] Failed to import board ${filePath}:`, error);
      }

      if (onProgress && drawnixFiles.length > 0) {
        const progress = 40 + Math.round(((i + 1) / drawnixFiles.length) * 15);
        onProgress(progress, `正在导入画板 (${i + 1}/${drawnixFiles.length})...`);
      }
    }

    return { folders: foldersImported, boards: boardsImported, merged: boardsMerged, skipped };
  }
  private async importAssets(
    zip: JSZip,
    onProgress?: ProgressCallback
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    const metaFiles = Object.keys(zip.files).filter(
      name => name.startsWith('assets/') && name.endsWith('.meta.json')
    );
    if (metaFiles.length === 0) return { imported: 0, skipped: 0 };

    const store = localforage.createInstance({
      name: ASSET_CONSTANTS.STORAGE_NAME,
      storeName: ASSET_CONSTANTS.STORE_NAME,
    });

    const existingKeys = await store.keys();
    const existingIds = new Set(existingKeys);
    const existingCacheUrls = new Set(await unifiedCacheService.getAllCachedUrls());

    for (let i = 0; i < metaFiles.length; i++) {
      const metaPath = metaFiles[i];
      const assetFileStem = metaPath.replace('assets/', '').replace('.meta.json', '');
      let assetIdForLog = assetFileStem;

      try {
        const metaFile = zip.file(metaPath);
        if (!metaFile) { skipped++; continue; }

        const metaContent = await metaFile.async('string');
        const metadata = JSON.parse(metaContent);
        const assetId = metadata?.id || assetFileStem;
        assetIdForLog = assetId;
        const isAIGenerated = metadata.source === 'AI_GENERATED';

        if (isAIGenerated) {
          if (existingCacheUrls.has(metadata.url)) { skipped++; continue; }
        } else {
          if (existingIds.has(assetId)) { skipped++; continue; }
        }

        const possibleExtensions = ['.jpg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mov', '.svg'];
        let blobData: Blob | null = null;

        for (const ext of possibleExtensions) {
          const blobFile = zip.file(`assets/${assetFileStem}${ext}`);
          if (blobFile) { blobData = await blobFile.async('blob'); break; }
        }

        if (!blobData && metadata.mimeType) {
          const ext = getExtensionFromMimeType(metadata.mimeType);
          if (ext) {
            const blobFile = zip.file(`assets/${assetFileStem}${ext}`);
            if (blobFile) blobData = await blobFile.async('blob');
          }
        }

        if (blobData) {
          const cacheType = metadata.type === 'VIDEO' ? 'video' : 'image';
          await unifiedCacheService.cacheMediaFromBlob(
            metadata.url,
            blobData,
            cacheType as 'image' | 'video',
            {
              metadata: {
                taskId: metadata.metadata?.taskId || assetId,
                prompt: metadata.metadata?.prompt,
                model: metadata.metadata?.model,
              },
              cachedAt: metadata.createdAt,
              lastUsed: metadata.updatedAt || metadata.createdAt,
            }
          );
          if (!isAIGenerated) await store.setItem(assetId, metadata);
          imported++;
        } else {
          console.warn(`[BackupRestore] No media file found for asset ${assetId}, skipping`);
          skipped++;
        }
      } catch (error) {
        console.warn(`[BackupRestore] Failed to import asset ${assetIdForLog}:`, error);
        skipped++;
      }

      if (onProgress && metaFiles.length > 0) {
        const progress = 60 + Math.round(((i + 1) / metaFiles.length) * 35);
        onProgress(progress, `正在导入素材 (${i + 1}/${metaFiles.length})...`);
      }
    }

    return { imported, skipped };
  }

  private async importTasks(zip: JSZip): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    const tasksFile = zip.file('tasks.json');
    if (!tasksFile) return { imported: 0, skipped: 0 };

    try {
      const tasksContent = await tasksFile.async('string');
      const tasks: Task[] = JSON.parse(tasksContent);
      if (!Array.isArray(tasks) || tasks.length === 0) return { imported: 0, skipped: 0 };

      const existingTasks = await taskStorageReader.getAllTasks();
      const existingTaskIds = new Set(existingTasks.map(t => t.id));

      const tasksToImport = tasks.filter(task => {
        if (existingTaskIds.has(task.id)) { skipped++; return false; }
        return true;
      });

      if (tasksToImport.length > 0) {
        await taskQueueService.restoreTasks(tasksToImport);
        imported = tasksToImport.length;
      }
    } catch (error) {
      console.warn('[BackupRestore] Failed to import tasks:', error);
    }

    return { imported, skipped };
  }
}

export const backupImportService = new BackupImportService();
