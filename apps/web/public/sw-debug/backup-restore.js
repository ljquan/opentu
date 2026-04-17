/**
 * SW Debug Panel - Backup Restore
 * 从备份 ZIP 恢复数据到 IndexedDB + Cache Storage
 */

import { elements } from './state.js';
import {
  IDB_STORES,
  KV_KEYS,
  CACHE_NAMES,
  SW_TASK_QUEUE_DB,
  readAllFromIDB,
  readItemFromIDB,
  readKVItem,
  writeToIDB,
  writeKVItem,
  writeBatchToIDB,
} from './indexeddb.js';
import {
  BACKUP_SIGNATURE,
  waitForJSZip,
  normalizeCacheMediaType,
} from './backup.js';
import {
  findBinaryFile,
  importKnowledgeBaseData,
  buildFolderPathMap,
  collectFolderPathsFromBoardPaths,
  getFolderDepth,
  getFolderKey,
} from './shared/backup-core.js';
import { showToast } from './toast.js';

/**
 * 触发文件选择器
 */
export function triggerRestoreDialog() {
  elements.restoreBackupInput?.click();
}

/**
 * 处理文件选择后的恢复流程
 */
export async function handleRestoreFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  // 重置 input 以便再次选择同一文件
  event.target.value = '';

  try {
    await performRestore(file);
  } catch (error) {
    showToast('恢复失败: ' + error.message, 'error', 5000);
  }
}

/**
 * 执行恢复
 */
async function performRestore(file) {
  const jsZipLoaded = await waitForJSZip(5000);
  if (!jsZipLoaded) throw new Error('JSZip 库加载超时');

  const progressContainer = showRestoreProgress();
  const updateProgress = (percent, text) => {
    const bar = progressContainer.querySelector('.backup-progress-fill');
    const label = progressContainer.querySelector('.backup-progress-text');
    if (bar) bar.style.width = `${percent}%`;
    if (label) label.textContent = text;
  };

  try {
    updateProgress(5, '正在读取 ZIP 文件...');
    const zip = await JSZip.loadAsync(file);

    // 读取并验证 manifest
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('无效的备份文件：缺少 manifest.json');

    const manifest = JSON.parse(await manifestFile.async('string'));
    if (manifest.signature !== BACKUP_SIGNATURE) {
      throw new Error('无效的备份文件：签名不匹配');
    }
    // 兼容 v2（无分片字段）和 v3
    if (manifest.version < 2 || manifest.version > 3) {
      throw new Error(`不支持的备份版本: ${manifest.version}`);
    }

    const stats = { prompts: 0, projects: 0, tasks: 0, knowledgeBase: 0, assets: 0 };

    // 1. 恢复提示词
    if (manifest.includes?.prompts !== false) {
      updateProgress(15, '正在恢复提示词...');
      stats.prompts = await restorePrompts(zip);
    }

    // 2. 恢复项目
    if (manifest.includes?.projects !== false) {
      updateProgress(30, '正在恢复项目...');
      stats.projects = await restoreProjects(zip);
    }

    // 3. 恢复任务
    if (manifest.includes?.tasks !== false) {
      updateProgress(45, '正在恢复任务...');
      stats.tasks = await restoreTasks(zip);
    }

    // 4. 恢复知识库
    if (manifest.includes?.knowledgeBase !== false) {
      updateProgress(52, '正在恢复知识库...');
      stats.knowledgeBase = await restoreKnowledgeBase(zip);
    }

    // 5. 恢复素材
    if (manifest.includes?.assets !== false) {
      updateProgress(60, '正在恢复素材...');
      stats.assets = await restoreAssets(zip, (current, total) => {
        const percent = 60 + Math.round((current / total) * 30);
        updateProgress(percent, `正在恢复素材 (${current}/${total})...`);
      });
    }

    updateProgress(100, '恢复完成！');
    setTimeout(() => {
      progressContainer.remove();
      showRestoreSuccessNotification(stats, manifest);
    }, 500);

  } catch (error) {
    progressContainer.remove();
    throw error;
  }
}

/**
 * 恢复提示词（按 content 去重合并）
 */
async function restorePrompts(zip) {
  const promptsFile = zip.file('prompts.json');
  if (!promptsFile) return 0;

  const data = JSON.parse(await promptsFile.async('string'));
  let count = 0;

  // 合并各类提示词历史
  const mergePromptList = async (kvKey, incoming) => {
    if (!incoming || incoming.length === 0) return 0;
    const existing = (await readKVItem(kvKey)) || [];
    const existingContents = new Set(existing.map(p => p.content));
    const newItems = incoming.filter(p => p.content && !existingContents.has(p.content));
    if (newItems.length > 0) {
      await writeKVItem(kvKey, [...existing, ...newItems]);
    }
    return newItems.length;
  };

  count += await mergePromptList(KV_KEYS.PROMPT_HISTORY, data.promptHistory);
  count += await mergePromptList(KV_KEYS.VIDEO_PROMPT_HISTORY, data.videoPromptHistory);
  count += await mergePromptList(KV_KEYS.IMAGE_PROMPT_HISTORY, data.imagePromptHistory);

  // 恢复预设设置（如果本地没有则写入）
  if (data.presetSettings) {
    const existing = await readKVItem(KV_KEYS.PRESET_SETTINGS);
    if (!existing) {
      await writeKVItem(KV_KEYS.PRESET_SETTINGS, data.presetSettings);
    }
  }

  return count;
}

/**
 * 恢复项目（文件夹 + 画板，按 ID upsert）
 */
async function restoreProjects(zip) {
  const projectsFolder = zip.folder('projects');
  if (!projectsFolder) return 0;

  let count = 0;
  const boards = [];

  // 遍历 projects/ 下的所有 .drawnix 文件
  const drawnixFiles = [];
  projectsFolder.forEach((relativePath, file) => {
    if (file.name.endsWith('.drawnix') && !file.dir) {
      drawnixFiles.push(file);
    }
  });

  for (const file of drawnixFiles) {
    try {
      const content = JSON.parse(await file.async('string'));
      if (content.boardMeta) {
        const meta = content.boardMeta;
        boards.push({
          id: meta.id,
          name: meta.name,
          folderId: meta.folderId,
          order: meta.order,
          elements: content.elements || [],
          viewport: content.viewport || { zoom: 1 },
          theme: content.theme,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      }
    } catch (err) {
      console.debug('[Restore] Failed to parse board file:', file.name, err);
    }
  }

  const existingFolders = await readAllFromIDB(
    IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.FOLDERS
  );
  const folderRestore = await restoreProjectFolders(zip, existingFolders || [], drawnixFiles.map(file => file.name));

  // 写入画板（upsert）
  if (boards.length > 0) {
    const existingBoards = await readAllFromIDB(
      IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.BOARDS
    );
    const existingBoardMap = new Map((existingBoards || []).map(b => [b.id, b]));

    for (let i = 0; i < boards.length; i++) {
      const board = boards[i];
      const existing = existingBoardMap.get(board.id);
      // 如果已存在且本地更新时间更新，跳过
      if (existing && existing.updatedAt >= (board.updatedAt || 0)) continue;
      try {
        const filePath = drawnixFiles[i]?.name || '';
        const relativePath = filePath.replace(/^projects\//, '');
        const parts = relativePath.split('/');
        const folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
        const folderId = folderPath
          ? folderRestore.pathToId.get(folderPath)
            || (board.folderId ? folderRestore.importedToLocalId.get(board.folderId) : null)
            || board.folderId
            || null
          : null;
        await writeToIDB(IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.BOARDS, {
          ...board,
          folderId,
        });
        count++;
      } catch (err) {
        console.debug('[Restore] Failed to write board:', board.id, err);
      }
    }
  }

  return count;
}

/**
 * 恢复任务（按 ID upsert）
 */
async function restoreTasks(zip) {
  const tasksFile = zip.file('tasks.json');
  if (!tasksFile) return 0;

  const tasks = JSON.parse(await tasksFile.async('string'));
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;

  const existingTasks = await readAllFromIDB(SW_TASK_QUEUE_DB.name, SW_TASK_QUEUE_DB.stores.TASKS);
  const existingIds = new Set((existingTasks || []).map(t => t.id));

  const newTasks = tasks.filter(t => !existingIds.has(t.id));
  if (newTasks.length > 0) {
    // 标记为远程同步，避免 SW 重新执行
    const markedTasks = newTasks.map(t => ({ ...t, syncedFromRemote: true }));
    await writeBatchToIDB(SW_TASK_QUEUE_DB.name, SW_TASK_QUEUE_DB.stores.TASKS, markedTasks);
  }

  return newTasks.length;
}

/**
 * 恢复素材（元数据到 IndexedDB + 二进制到 Cache Storage）
 */
async function restoreAssets(zip, onProgress) {
  const assetsFolder = zip.folder('assets');
  if (!assetsFolder) return 0;

  let count = 0;
  const cache = await caches.open(CACHE_NAMES.IMAGES);

  // 收集所有 .meta.json 文件
  const metaFiles = [];
  assetsFolder.forEach((relativePath, file) => {
    if (file.name.endsWith('.meta.json') && !file.dir) {
      metaFiles.push({ relativePath, file });
    }
  });

  const totalItems = metaFiles.length;
  let processedCount = 0;

  for (const { relativePath, file } of metaFiles) {
    try {
      const meta = JSON.parse(await file.async('string'));
      const assetId = meta.id;
      if (!assetId) { processedCount++; continue; }

      // 查找对应的二进制文件
      const binaryFile = findBinaryFile(assetsFolder, relativePath, meta.mimeType);

      if (binaryFile) {
        const blob = await binaryFile.async('blob');
        if (blob.size > 0 && meta.url) {
          // 写入 Cache Storage（为每个 URL 创建独立 Response）
          const contentType = meta.mimeType || blob.type || 'application/octet-stream';
          const response = new Response(blob, {
            headers: { 'Content-Type': contentType },
          });
          await cache.put(meta.url, response);
        }
      }

      // 写入元数据到对应的 IndexedDB
      if (meta.source === 'AI_GENERATED') {
        // AI 生成的素材 → unified-cache
        const cacheItem = {
          url: meta.url,
          type: normalizeCacheMediaType(meta.type, meta.mimeType),
          mimeType: meta.mimeType,
          size: meta.size,
          cachedAt: meta.createdAt,
          lastUsed: meta.updatedAt || meta.createdAt,
          metadata: meta.metadata,
        };
        await writeToIDB(IDB_STORES.UNIFIED_CACHE.name, IDB_STORES.UNIFIED_CACHE.store, cacheItem);
      } else {
        // 本地素材 → aitu-assets
        await writeToIDB(IDB_STORES.ASSETS.name, IDB_STORES.ASSETS.store, meta);
      }

      count++;
    } catch (err) {
      console.debug('[Restore] Failed to restore asset:', relativePath, err);
    }

    processedCount++;
    if (onProgress) onProgress(processedCount, totalItems);
  }

  return count;
}

/**
 * 恢复知识库
 */
async function restoreKnowledgeBase(zip) {
  const kbFile = zip.file('knowledge-base.json');
  if (!kbFile) return 0;

  const data = JSON.parse(await kbFile.async('string'));
  const result = await importKnowledgeBaseData(data, {
    getAllDirectories: () => readAllFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.DIRECTORIES
    ),
    getDirectoryById: (id) => readItemFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.DIRECTORIES,
      id
    ),
    putDirectory: (_id, value) => writeToIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.DIRECTORIES,
      value
    ),
    getTagById: (id) => readItemFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.TAGS,
      id
    ),
    putTag: (_id, value) => writeToIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.TAGS,
      value
    ),
    getNoteById: async (id) => {
      const meta = await readItemFromIDB(
        IDB_STORES.KNOWLEDGE_BASE.name,
        IDB_STORES.KNOWLEDGE_BASE.stores.NOTES,
        id
      );
      if (!meta) return null;
      const contentRecord = await readItemFromIDB(
        IDB_STORES.KNOWLEDGE_BASE.name,
        IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_CONTENTS,
        id
      );
      return {
        ...meta,
        content: contentRecord?.content ?? '',
      };
    },
    putNoteMeta: (_id, value) => writeToIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTES,
      value
    ),
    putNoteContent: (_id, value) => writeToIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_CONTENTS,
      value
    ),
    getNoteTagById: (id) => readItemFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_TAGS,
      id
    ),
    putNoteTag: (_id, value) => writeToIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_TAGS,
      value
    ),
    getNoteImageById: (id) => readItemFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_IMAGES,
      id
    ),
    putNoteImage: (_id, value) => writeToIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_IMAGES,
      value
    ),
  });

  return result.noteCount;
}

async function restoreProjectFolders(zip, existingFolders, drawnixFilePaths) {
  const importedToLocalId = new Map();
  const pathToId = new Map();
  const folderKeyMap = new Map(existingFolders.map(folder => [getFolderKey(folder.name, folder.parentId), folder]));
  const foldersFile = zip.file('projects/_folders.json');

  if (foldersFile) {
    const parsed = JSON.parse(await foldersFile.async('string'));
    const importedFolders = Array.isArray(parsed) ? parsed : parsed?.folders || [];
    const folderMap = new Map(importedFolders.map(folder => [folder.id, folder]));
    const sortedFolders = [...importedFolders].sort((a, b) => {
      const depthA = getFolderDepth(a, folderMap);
      const depthB = getFolderDepth(b, folderMap);
      return depthA - depthB || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name);
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
        continue;
      }

      const nextFolder = {
        ...folder,
        parentId: mappedParentId,
      };
      await writeToIDB(IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.FOLDERS, nextFolder);
      existingFolders.push(nextFolder);
      folderKeyMap.set(getFolderKey(nextFolder.name, nextFolder.parentId), nextFolder);
      importedToLocalId.set(folder.id, nextFolder.id);
    }

    const allFolders = await readAllFromIDB(IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.FOLDERS);
    const fullPathMap = buildFolderPathMap(allFolders || []);
    for (const [folderId, folderPath] of fullPathMap.entries()) {
      pathToId.set(folderPath, folderId);
    }
  }

  const fallbackPaths = collectFolderPathsFromBoardPaths(drawnixFilePaths);
  for (const folderPath of fallbackPaths) {
    if (pathToId.has(folderPath)) continue;
    const parts = folderPath.split('/');
    const folderName = parts[parts.length - 1];
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
    const parentId = parentPath ? pathToId.get(parentPath) || null : null;
    const existingFolder = folderKeyMap.get(getFolderKey(folderName, parentId));
    if (existingFolder) {
      pathToId.set(folderPath, existingFolder.id);
      continue;
    }

    const folder = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      name: folderName,
      parentId,
      order: existingFolders.length,
      isExpanded: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await writeToIDB(IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.FOLDERS, folder);
    existingFolders.push(folder);
    folderKeyMap.set(getFolderKey(folder.name, folder.parentId), folder);
    pathToId.set(folderPath, folder.id);
  }

  return { importedToLocalId, pathToId };
}
/**
 * 显示恢复进度条
 */
function showRestoreProgress() {
  const container = document.createElement('div');
  container.className = 'backup-progress-container';
  container.innerHTML = `
    <div class="backup-progress-content">
      <div class="backup-progress-header">
        <span class="backup-progress-icon">📥</span>
        <span class="backup-progress-title">正在恢复数据</span>
      </div>
      <div class="backup-progress-bar">
        <div class="backup-progress-fill" style="width: 0%"></div>
      </div>
      <div class="backup-progress-text">准备中...</div>
    </div>
  `;
  document.body.appendChild(container);
  return container;
}

/**
 * 显示恢复成功通知
 */
function showRestoreSuccessNotification(stats, manifest) {
  const partInfo = manifest.partIndex
    ? ` (分片 ${manifest.partIndex}${manifest.totalParts ? '/' + manifest.totalParts : ''})`
    : '';
  const notification = document.createElement('div');
  notification.className = 'import-notification restore-notification';
  notification.innerHTML = `
    <div class="import-notification-content">
      <span class="icon">✅</span>
      <div class="info">
        <strong>恢复成功${partInfo}</strong>
        <p class="counts">
          ${stats.prompts > 0 ? `新增提示词: ${stats.prompts}` : ''}
          ${stats.projects > 0 ? `${stats.prompts > 0 ? ' | ' : ''}画板: ${stats.projects}` : ''}
          ${stats.tasks > 0 ? `${(stats.prompts + stats.projects) > 0 ? ' | ' : ''}任务: ${stats.tasks}` : ''}
          ${stats.knowledgeBase > 0 ? `${(stats.prompts + stats.projects + stats.tasks) > 0 ? ' | ' : ''}知识库笔记: ${stats.knowledgeBase}` : ''}
          ${stats.assets > 0 ? `${(stats.prompts + stats.projects + stats.tasks + stats.knowledgeBase) > 0 ? ' | ' : ''}素材: ${stats.assets}` : ''}
          ${(stats.prompts + stats.projects + stats.tasks + stats.knowledgeBase + stats.assets) === 0 ? '所有数据已是最新，无需更新' : ''}
        </p>
      </div>
      <button class="close" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
  `;

  document.body.appendChild(notification);
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}
