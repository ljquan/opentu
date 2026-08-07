/**
 * Backup Import Service
 * 从 ZIP 文件导入数据，兼容 v2/v3/v4 manifest
 */

import type JSZip from 'jszip';
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
import { taskQueueService } from '../task-queue';
import { Task } from '../../types/task.types';
import type { Folder, Board } from '../../types/workspace.types';
import { LS_KEYS_TO_MIGRATE } from '../../constants/storage-keys';
import localforage from 'localforage';
import { ASSET_CONSTANTS } from '../../constants/ASSET_CONSTANTS';
import { unifiedCacheService } from '../unified-cache-service';
import { assetStorageService } from '../asset-storage-service';
import { analytics } from '../../utils/posthog-analytics';
import { importAllData as importKnowledgeBaseData } from '../kb-import-export-service';
import { _getStoreInstances } from '../knowledge-base-service';
import { taskStorageWriter, type SWTask } from '../media-executor/task-storage-writer';
import { decryptBackupJson } from './backup-crypto';
import {
  EnvironmentBackupData,
  EnvironmentSecretsData,
  importEnvironmentData,
} from './environment-backup-service';
import {
  BackupManifest,
  BackupProjectFoldersData,
  PromptsData,
  PresetStorageData,
  DrawnixFileData,
  ImportOptions,
  ImportResult,
  ProgressCallback,
  ensureElementIds,
} from './types';
import { restoreEmbeddedMedia } from '../../data/blob';
import {
  getCandidateExtensions,
  generateId,
  normalizeCacheMediaType,
  buildFolderPathMap,
  collectFolderPathsFromBoardPaths,
  getFolderDepth,
  getFolderKey,
  validateBackupManifest,
} from './backup-utils';
import { PROMPT_TYPES, type PromptHistoryOverride, type PromptType } from '../prompt-storage-service';

class BackupImportService {
  async importFromZip(
    file: File,
    onProgress?: ProgressCallback,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    const startTime = Date.now();
    const importMode = options.mode || 'merge';

    analytics.track('backup_import_start', {
      fileSize: file.size,
      fileName: file.name,
      mode: importMode,
    });
    const result: ImportResult = {
      success: false,
      mode: importMode,
      prompts: { imported: 0, skipped: 0 },
      projects: { folders: 0, boards: 0, merged: 0, skipped: 0 },
      assets: { imported: 0, skipped: 0 },
      tasks: { imported: 0, skipped: 0 },
      knowledgeBase: { directories: 0, notes: 0, tags: 0, skipped: 0 },
      environment: { imported: 0, skipped: 0 },
      domains: {},
      warnings: [],
      errors: [],
    };

    try {
      onProgress?.(5, '正在读取文件...');
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);

      onProgress?.(10, '正在验证文件格式...');
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        throw new Error('无效的备份文件：未找到 manifest.json');
      }

      const manifestContent = await manifestFile.async('string');
      const manifest = validateBackupManifest(
        JSON.parse(manifestContent)
      ) as BackupManifest;

      const shouldImport = (domain: string) =>
        !options.selectedDomains?.length || options.selectedDomains.includes(domain);

      let environmentSecrets: EnvironmentSecretsData | null = null;
      if (manifest.includes.environment && shouldImport('environment')) {
        onProgress?.(15, '正在导入环境配置...');
        const envFile = zip.file('environment/data.json');
        const envData = envFile
          ? (JSON.parse(await envFile.async('string')) as EnvironmentBackupData)
          : null;
        const secretsFile = zip.file('environment/secrets.enc.json');
        if (secretsFile) {
          if (options.encryptionPassword?.trim()) {
            const encrypted = JSON.parse(await secretsFile.async('string'));
            environmentSecrets = await decryptBackupJson<EnvironmentSecretsData>(
              encrypted,
              options.encryptionPassword
            );
          } else {
            result.warnings.push('备份包含敏感配置，但未输入密码，敏感配置已跳过');
          }
        } else if (manifest.encryption?.enabled) {
          result.warnings.push('manifest 标记包含敏感配置，但未找到敏感配置文件');
        }

        const envResult = await importEnvironmentData(envData, {
          mode: importMode,
          secrets: environmentSecrets,
        });
        result.environment = {
          imported: envResult.imported,
          skipped: envResult.skipped,
        };
        result.warnings.push(...envResult.warnings);
        result.domains!.environment = result.environment;
      }

      if (manifest.includes.prompts && shouldImport('prompts')) {
        onProgress?.(20, '正在导入提示词...');
        const promptsFile = zip.file('prompts.json');
        if (promptsFile) {
          const promptsContent = await promptsFile.async('string');
          const promptsData: PromptsData = JSON.parse(promptsContent);
          if (importMode === 'replace') {
            await this.clearPromptData();
          }
          result.prompts = await this.importPromptData(promptsData, importMode);
          result.domains!.prompts = result.prompts;
        }
      }

      if (manifest.includes.assets && shouldImport('assets')) {
        onProgress?.(35, '正在导入素材...');
        if (importMode === 'replace') {
          await this.clearAssets();
        }
        result.assets = await this.importAssets(zip, onProgress, 35, 20);
        result.domains!.assets = result.assets;
      }

      if (manifest.includes.projects && shouldImport('projects')) {
        onProgress?.(60, '正在导入项目...');
        if (importMode === 'replace') {
          await workspaceStorageService.clearAll();
        }
        result.projects = await this.importProjects(zip, onProgress, importMode, 60, 10);
        result.domains!.projects = {
          imported: result.projects.folders + result.projects.boards + result.projects.merged,
          skipped: result.projects.skipped,
        };
      }

      if (manifest.includes.knowledgeBase && shouldImport('knowledgeBase')) {
        onProgress?.(70, '正在导入知识库...');
        if (importMode === 'replace') {
          await this.clearKnowledgeBase();
        }
        const kbResult = await this.importKnowledgeBase(zip);
        result.knowledgeBase = kbResult;
        result.domains!.knowledgeBase = {
          imported: kbResult.directories + kbResult.notes + kbResult.tags,
          skipped: kbResult.skipped,
        };
        if (kbResult.errors && kbResult.errors.length > 0) {
          result.errors.push(...kbResult.errors);
        }
      }

      if ((manifest.includes.tasks ?? manifest.includes.assets) && shouldImport('tasks')) {
        onProgress?.(85, '正在导入任务数据...');
        if (importMode === 'replace') {
          await taskStorageWriter.clearAllTasks();
        }
        result.tasks = await this.importTasks(zip, importMode, result.errors);
        result.domains!.tasks = result.tasks;
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
        mode: importMode,
        promptCount: result.prompts.imported,
        projectCount: result.projects.boards,
        assetCount: result.assets.imported,
        taskCount: result.tasks.imported,
        kbNoteCount: result.knowledgeBase.notes,
        skippedCount:
          result.prompts.skipped + result.projects.skipped +
          result.assets.skipped + result.tasks.skipped + result.knowledgeBase.skipped,
        warningCount: result.warnings.length,
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
      const r = await importKnowledgeBaseData(data);
      return { directories: r.dirCount, notes: r.noteCount, tags: r.tagCount, skipped: 0, errors: [] };
    } catch (error) {
      console.error('Failed to import knowledge base:', error);
      return {
        directories: 0, notes: 0, tags: 0, skipped: 0,
        errors: [`Knowledge base import failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  private async clearPromptData(): Promise<void> {
    await Promise.all([
      kvStorageService.set(LS_KEYS_TO_MIGRATE.PROMPT_HISTORY, []),
      kvStorageService.set(LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY, []),
      kvStorageService.set(LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY, []),
      kvStorageService.set(
        LS_KEYS_TO_MIGRATE.PRESET_SETTINGS,
        createEmptyPresetStorageData()
      ),
      kvStorageService.set(LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS, []),
      kvStorageService.set(LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES, []),
    ]);
    await resetPromptStorageCache();
  }

  private async clearAssets(): Promise<void> {
    try {
      await assetStorageService.initialize();
      await assetStorageService.clearAll();
    } catch (error) {
      console.warn('[BackupRestore] Failed to clear asset library:', error);
    }
    await unifiedCacheService.clearAllCache();
  }

  private async clearKnowledgeBase(): Promise<void> {
    const stores = _getStoreInstances();
    await Promise.all([
      stores.directoriesStore.clear(),
      stores.notesStore.clear(),
      stores.tagsStore.clear(),
      stores.noteTagsStore.clear(),
      stores.noteContentsStore.clear(),
      stores.noteImagesStore.clear(),
    ]);
  }

  private async importPromptData(
    data: PromptsData,
    mode: 'merge' | 'replace'
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    const inputPromptHistory = data.promptHistory || [];
    const inputVideoPromptHistory = data.videoPromptHistory || [];
    const inputImagePromptHistory = data.imagePromptHistory || [];
    const inputDeletedContents = Array.isArray(data.deletedPromptContents)
      ? data.deletedPromptContents
      : [];
    const inputOverrides = Array.isArray(data.promptHistoryOverrides)
      ? data.promptHistoryOverrides
      : [];

    await initPromptStorageCache();

    if (mode === 'replace') {
      await kvStorageService.set(LS_KEYS_TO_MIGRATE.PROMPT_HISTORY, inputPromptHistory);
      await kvStorageService.set(LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY, inputVideoPromptHistory);
      await kvStorageService.set(LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY, inputImagePromptHistory);
      await kvStorageService.set(
        LS_KEYS_TO_MIGRATE.PRESET_SETTINGS,
        normalizePresetStorageData(data.presetSettings)
      );
      await kvStorageService.set(
        LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS,
        normalizeStringArray(inputDeletedContents)
      );
      await kvStorageService.set(
        LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES,
        mergePromptHistoryOverrides([], inputOverrides)
      );
      await resetPromptStorageCache();
      return {
        imported:
          inputPromptHistory.length +
          inputVideoPromptHistory.length +
          inputImagePromptHistory.length,
        skipped: 0,
      };
    }

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
    const mergedPreset = mergePresetStorageData(existingPreset, data.presetSettings);
    await kvStorageService.set(LS_KEYS_TO_MIGRATE.PRESET_SETTINGS, mergedPreset);

    const existingDeleted = await kvStorageService.get<string[]>(
      LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS
    );
    await kvStorageService.set(
      LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS,
      [...new Set([...normalizeStringArray(existingDeleted), ...normalizeStringArray(inputDeletedContents)])]
    );

    const existingOverrides = await kvStorageService.get<PromptHistoryOverride[]>(
      LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES
    );
    await kvStorageService.set(
      LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES,
      mergePromptHistoryOverrides(existingOverrides, inputOverrides)
    );

    await resetPromptStorageCache();
    return { imported, skipped };
  }
  private async importProjects(
    zip: JSZip,
    onProgress?: ProgressCallback,
    mode: 'merge' | 'replace' = 'merge',
    progressStart = 40,
    progressSpan = 15
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

    const folderIdMap = await this.restoreProjectFolders(zip, existingFolders, drawnixFiles);
    foldersImported = folderIdMap.created;
    skipped += folderIdMap.skipped;

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
            ? folderIdMap.pathToId.get(folderPath) || (boardMeta?.folderId ? folderIdMap.importedToLocalId.get(boardMeta.folderId) : null) || boardMeta?.folderId || null
            : null;

          const fileName = parts[parts.length - 1] || 'unnamed.drawnix';
          const boardName = boardMeta?.name || fileName.replace('.drawnix', '');

          if (mode === 'merge' && boardMeta?.id && existingBoardIds.has(boardMeta.id)) {
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
        const progress = progressStart + Math.round(((i + 1) / drawnixFiles.length) * progressSpan);
        onProgress(progress, `正在导入画板 (${i + 1}/${drawnixFiles.length})...`);
      }
    }

    return { folders: foldersImported, boards: boardsImported, merged: boardsMerged, skipped };
  }
  private async importAssets(
    zip: JSZip,
    onProgress?: ProgressCallback,
    progressStart = 60,
    progressSpan = 35
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

        let blobData: Blob | null = null;

        for (const ext of getCandidateExtensions(metadata.mimeType)) {
          const blobFile = zip.file(`assets/${assetFileStem}${ext}`);
          if (blobFile) { blobData = await blobFile.async('blob'); break; }
        }

        if (blobData) {
          const cacheType = normalizeCacheMediaType(metadata.type, metadata.mimeType);
          await unifiedCacheService.cacheMediaFromBlob(
            metadata.url,
            blobData,
            cacheType,
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
        const progress = progressStart + Math.round(((i + 1) / metaFiles.length) * progressSpan);
        onProgress(progress, `正在导入素材 (${i + 1}/${metaFiles.length})...`);
      }
    }

    return { imported, skipped };
  }

  private async restoreProjectFolders(
    zip: JSZip,
    existingFolders: Folder[],
    drawnixFiles: string[]
  ): Promise<{
    pathToId: Map<string, string>;
    importedToLocalId: Map<string, string>;
    created: number;
    skipped: number;
  }> {
    const importedToLocalId = new Map<string, string>();
    const pathToId = new Map<string, string>();
    let created = 0;
    let skipped = 0;

    const foldersFile = zip.file('projects/_folders.json');
    const folderKeyMap = new Map(existingFolders.map(folder => [getFolderKey(folder.name, folder.parentId), folder]));

    if (foldersFile) {
      const parsed = JSON.parse(await foldersFile.async('string')) as BackupProjectFoldersData | Folder[];
      const importedFolders = Array.isArray(parsed) ? parsed : parsed?.folders || [];
      const importedFolderMap = new Map(importedFolders.map(folder => [folder.id, folder]));
      const sortedFolders = [...importedFolders].sort((a, b) => {
        const depthA = getFolderDepth(a, importedFolderMap);
        const depthB = getFolderDepth(b, importedFolderMap);
        return depthA - depthB || a.order - b.order || a.name.localeCompare(b.name);
      });

      for (const folder of sortedFolders) {
        const mappedParentId = folder.parentId ? importedToLocalId.get(folder.parentId) || null : null;
        const existingById = existingFolders.find(item => item.id === folder.id);
        if (existingById) {
          importedToLocalId.set(folder.id, existingById.id);
          continue;
        }

        const existingByKey = folderKeyMap.get(getFolderKey(folder.name, mappedParentId));
        if (existingByKey) {
          importedToLocalId.set(folder.id, existingByKey.id);
          skipped++;
          continue;
        }

        const nextFolder: Folder = {
          ...folder,
          parentId: mappedParentId,
        };
        await workspaceStorageService.saveFolder(nextFolder);
        existingFolders.push(nextFolder);
        folderKeyMap.set(getFolderKey(nextFolder.name, nextFolder.parentId), nextFolder);
        importedToLocalId.set(folder.id, nextFolder.id);
        created++;
      }

      const allFolders = await workspaceStorageService.loadAllFolders();
      const pathMap = buildFolderPathMap(allFolders);
      for (const [folderId, path] of pathMap.entries()) {
        pathToId.set(path, folderId);
      }
    }

    const fallbackPaths = collectFolderPathsFromBoardPaths(drawnixFiles);
    for (const folderPath of fallbackPaths) {
      if (pathToId.has(folderPath)) {
        continue;
      }
      const parts = folderPath.split('/');
      const folderName = parts[parts.length - 1];
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      const parentId = parentPath ? pathToId.get(parentPath) || null : null;
      const key = getFolderKey(folderName, parentId);
      const existingFolder = folderKeyMap.get(key);
      if (existingFolder) {
        pathToId.set(folderPath, existingFolder.id);
        continue;
      }

      const folder: Folder = {
        id: generateId(),
        name: folderName,
        parentId,
        order: existingFolders.length,
        isExpanded: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await workspaceStorageService.saveFolder(folder);
      existingFolders.push(folder);
      folderKeyMap.set(key, folder);
      pathToId.set(folderPath, folder.id);
      created++;
    }

    return { pathToId, importedToLocalId, created, skipped };
  }

  private async importTasks(
    zip: JSZip,
    mode: 'merge' | 'replace',
    errors: string[]
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    const tasksFile = zip.file('tasks.json');
    if (!tasksFile) return { imported: 0, skipped: 0 };

    try {
      const tasksContent = await tasksFile.async('string');
      const parsed: unknown = JSON.parse(tasksContent);
      const tasks = Array.isArray(parsed)
        ? parsed.map(item => normalizeTaskRecord(item)).filter((item): item is Task => !!item)
        : [];
      if (tasks.length === 0) return { imported: 0, skipped: Array.isArray(parsed) ? parsed.length : 0 };

      if (mode === 'replace') {
        const writeResult = await taskStorageWriter.importTasks(
          tasks as unknown as SWTask[],
          { replaceExisting: true }
        );
        imported = writeResult.imported;
        skipped += writeResult.skipped;
        await taskQueueService.restoreTasks(tasks, {
          allowDeletedTaskRestore: true,
        });
        return { imported, skipped };
      }

      const writeResult = await taskStorageWriter.importTasks(
        tasks as unknown as SWTask[]
      );
      imported = writeResult.imported;
      skipped += writeResult.skipped;
      await taskQueueService.restoreTasks(tasks, {
        allowDeletedTaskRestore: true,
        deletedTasksOnly: imported === 0,
      });
    } catch (error) {
      console.warn('[BackupRestore] Failed to import tasks:', error);
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`任务数据导入失败：${message}`);
    }

    return { imported, skipped };
  }
}

export const backupImportService = new BackupImportService();

function createEmptyPresetStorageData(): PresetStorageData {
  return Object.fromEntries(
    PROMPT_TYPES.map(type => [type, { pinnedPrompts: [], deletedPrompts: [] }])
  ) as unknown as PresetStorageData;
}

function normalizePresetStorageData(
  input?: Partial<Record<PromptType, { pinnedPrompts?: unknown; deletedPrompts?: unknown }>> | null
): PresetStorageData {
  const normalized = createEmptyPresetStorageData();
  if (!input || typeof input !== 'object') {
    return normalized;
  }
  for (const type of PROMPT_TYPES) {
    const settings = input[type];
    normalized[type] = {
      pinnedPrompts: normalizeStringArray(settings?.pinnedPrompts),
      deletedPrompts: normalizeStringArray(settings?.deletedPrompts),
    };
  }
  return normalized;
}

function mergePresetStorageData(
  existing?: Partial<Record<PromptType, { pinnedPrompts?: unknown; deletedPrompts?: unknown }>> | null,
  incoming?: Partial<Record<PromptType, { pinnedPrompts?: unknown; deletedPrompts?: unknown }>> | null
): PresetStorageData {
  const left = normalizePresetStorageData(existing);
  const right = normalizePresetStorageData(incoming);
  const merged = createEmptyPresetStorageData();
  for (const type of PROMPT_TYPES) {
    merged[type] = {
      pinnedPrompts: [...new Set([...left[type].pinnedPrompts, ...right[type].pinnedPrompts])],
      deletedPrompts: [...new Set([...left[type].deletedPrompts, ...right[type].deletedPrompts])],
    };
  }
  return merged;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function mergePromptHistoryOverrides(
  existing?: PromptHistoryOverride[] | null,
  incoming?: PromptHistoryOverride[] | null
): PromptHistoryOverride[] {
  const map = new Map<string, PromptHistoryOverride>();
  for (const override of [...(existing || []), ...(incoming || [])]) {
    if (!override || typeof override.sourceContent !== 'string') {
      continue;
    }
    const key = override.sourceContent.trim();
    if (!key) {
      continue;
    }
    const current = map.get(key);
    if (!current || (override.updatedAt || 0) >= (current.updatedAt || 0)) {
      map.set(key, override);
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function normalizeTaskRecord(value: unknown): Task | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const task = value as Partial<Task>;
  if (
    typeof task.id !== 'string' ||
    typeof task.type !== 'string' ||
    typeof task.status !== 'string' ||
    typeof task.createdAt !== 'number' ||
    typeof task.updatedAt !== 'number'
  ) {
    return null;
  }
  return {
    ...task,
    params:
      task.params && typeof task.params === 'object'
        ? task.params
        : ({ prompt: '' } as Task['params']),
  } as Task;
}
