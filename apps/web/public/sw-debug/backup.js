/**
 * SW Debug Panel - Data Backup（支持自动分片）
 */

import { elements } from './state.js';
import {
  IDB_STORES,
  KV_KEYS,
  CACHE_NAMES,
  SW_TASK_QUEUE_DB,
  readAllFromIDB,
  readKVItem,
} from './indexeddb.js';
import { showToast } from './toast.js';
import { BackupPartManager } from './backup-part-manager.js';
import {
  BACKUP_SIGNATURE,
  BACKUP_VERSION,
  getExtensionFromMimeType,
  getCandidateExtensions,
  normalizeBackupAssetType,
  normalizeCacheMediaType,
  sanitizeFileName,
  generateIdFromUrl,
  appendUrlHashToBackupName,
  ensureUniqueBackupName,
  buildAssetExportBaseName,
  mergePromptData,
  filterCompletedMediaTasks,
  buildFolderPathMap,
  exportKnowledgeBaseData,
} from './shared/backup-core.js';
export {
  BACKUP_SIGNATURE,
  BACKUP_VERSION,
  getCandidateExtensions,
  normalizeCacheMediaType,
};

/**
 * 等待 JSZip 加载完成
 */
export function waitForJSZip(timeout = 5000) {
  return new Promise((resolve) => {
    if (typeof JSZip !== 'undefined') {
      resolve(true);
      return;
    }
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (typeof JSZip !== 'undefined') {
        clearInterval(checkInterval);
        resolve(true);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });
}

/**
 * 执行数据备份
 */
export async function performBackup() {
  const btn = elements.backupDataBtn;
  if (!btn) return;

  const originalText = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = '⏳ 加载中...';

    const jsZipLoaded = await waitForJSZip(5000);
    if (!jsZipLoaded) {
      throw new Error('JSZip 库加载超时，请检查网络连接后重试');
    }

    btn.innerHTML = '⏳ 准备中...';

    // 生成文件名前缀
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
    const baseFilename = `aitu_backup_${dateStr}_${timeStr}`;
    const backupId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const progressContainer = showBackupProgress();
    const updateProgress = (percent, text) => {
      const progressBar = progressContainer.querySelector('.backup-progress-fill');
      const progressText = progressContainer.querySelector('.backup-progress-text');
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = text;
    };

    const partManager = new BackupPartManager(baseFilename, backupId);

    const manifest = {
      signature: BACKUP_SIGNATURE,
      version: BACKUP_VERSION,
      createdAt: Date.now(),
      source: 'sw-debug-panel',
      backupId,
      includes: { prompts: true, projects: true, tasks: true, assets: true, knowledgeBase: true },
      stats: {
        promptCount: 0, videoPromptCount: 0, imagePromptCount: 0,
        folderCount: 0, boardCount: 0, assetCount: 0, taskCount: 0, kbNoteCount: 0,
      },
    };

    // 0. 任务数据
    updateProgress(5, '正在读取任务数据...');
    const allTasks = await collectTasksData();

    // 1. 提示词（非素材，放 Part1）
    updateProgress(15, '正在备份提示词...');
    const promptsData = await collectPromptsData(allTasks);
    partManager.addFile('prompts.json', promptsData);
    manifest.stats.promptCount = promptsData.promptHistory?.length || 0;
    manifest.stats.videoPromptCount = promptsData.videoPromptHistory?.length || 0;
    manifest.stats.imagePromptCount = promptsData.imagePromptHistory?.length || 0;

    // 2. 项目数据（非素材，放 Part1）
    updateProgress(25, '正在备份项目...');
    const projectStats = await collectProjectsData(partManager.currentZip);
    manifest.stats.folderCount = projectStats.folders;
    manifest.stats.boardCount = projectStats.boards;

    // 3. 任务数据（非素材，放 Part1）
    updateProgress(30, '正在导出任务数据...');
    const completedMediaTasks = filterCompletedMediaTasks(allTasks);
    if (completedMediaTasks.length > 0) {
      partManager.addFile('tasks.json', completedMediaTasks);
      manifest.stats.taskCount = completedMediaTasks.length;
    }

    // 3.5 知识库
    updateProgress(33, '正在导出知识库...');
    const knowledgeBaseData = await collectKnowledgeBaseData();
    partManager.addFile('knowledge-base.json', knowledgeBaseData);
    manifest.stats.kbNoteCount = knowledgeBaseData.notes.length;

    // 4. 素材数据（通过 partManager 自动分片）
    updateProgress(35, '正在备份素材...');
    const assetCount = await collectAssetsData(partManager, (current, total) => {
      const percent = 35 + Math.round((current / total) * 50);
      updateProgress(percent, `正在备份素材 (${current}/${total})...`);
    });
    manifest.stats.assetCount = assetCount;

    // 5. finalize 所有分片
    updateProgress(88, '正在压缩文件...');
    const result = await partManager.finalizeAll(manifest);

    // 关闭进度条，显示成功信息
    updateProgress(100, '备份完成！');
    setTimeout(() => {
      progressContainer.remove();
      const totalSize = result.files.reduce((sum, f) => sum + f.size, 0);
      const sizeInMB = (totalSize / 1024 / 1024).toFixed(2);
      showBackupSuccessNotification({
        files: result.files,
        totalParts: result.totalParts,
        size: sizeInMB,
        stats: manifest.stats,
      });
    }, 500);

    btn.innerHTML = originalText;
    btn.disabled = false;

  } catch (error) {
    const progressContainer = document.querySelector('.backup-progress-container');
    if (progressContainer) progressContainer.remove();
    showToast('备份失败: ' + error.message, 'error', 5000);
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

/**
 * 收集任务数据
 */
async function collectTasksData() {
  try {
    const tasks = await readAllFromIDB(SW_TASK_QUEUE_DB.name, SW_TASK_QUEUE_DB.stores.TASKS);
    return tasks || [];
  } catch (error) {
    console.warn('[Backup] Failed to read tasks:', error);
    return [];
  }
}

/**
 * 收集提示词数据
 */
async function collectPromptsData(allTasks = []) {
  const [promptHistory, videoPromptHistory, imagePromptHistory, presetSettings] = await Promise.all([
    readKVItem(KV_KEYS.PROMPT_HISTORY),
    readKVItem(KV_KEYS.VIDEO_PROMPT_HISTORY),
    readKVItem(KV_KEYS.IMAGE_PROMPT_HISTORY),
    readKVItem(KV_KEYS.PRESET_SETTINGS),
  ]);

  return mergePromptData({
    promptHistory: promptHistory || [],
    videoPromptHistory: videoPromptHistory || [],
    imagePromptHistory: imagePromptHistory || [],
    presetSettings: presetSettings || undefined,
    allTasks,
  });
}

/** 收集项目数据 */
async function collectProjectsData(zip) {
  const projectsFolder = zip.folder('projects');

  const [folders, boards] = await Promise.all([
    readAllFromIDB(IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.FOLDERS),
    readAllFromIDB(IDB_STORES.WORKSPACE.name, IDB_STORES.WORKSPACE.stores.BOARDS),
  ]);

  const folderList = folders || [];
  const boardList = boards || [];

  const folderPathMap = buildFolderPathMap(folderList);

  for (const folder of folderList) {
    const path = folderPathMap.get(folder.id) || folder.name;
    projectsFolder.folder(path);
  }
  projectsFolder.file('_folders.json', JSON.stringify({ folders: folderList }, null, 2));

  for (const board of boardList) {
    const folderPath = board.folderId ? folderPathMap.get(board.folderId) : null;
    const safeName = sanitizeFileName(board.name);
    const boardPath = folderPath ? `${folderPath}/${safeName}.drawnix` : `${safeName}.drawnix`;

    const drawnixData = {
      type: 'drawnix', version: 1, source: 'backup',
      elements: board.elements || [],
      viewport: board.viewport || { zoom: 1 },
      theme: board.theme,
      boardMeta: {
        id: board.id, name: board.name, folderId: board.folderId,
        order: board.order, createdAt: board.createdAt, updatedAt: board.updatedAt,
      },
    };
    projectsFolder.file(boardPath, JSON.stringify(drawnixData, null, 2));
  }

  return { folders: folderList.length, boards: boardList.length };
}

/**
 * 收集素材数据（使用 partManager 自动分片）
 * @param {BackupPartManager} partManager
 * @param {Function} onProgress
 */
async function collectAssetsData(partManager, onProgress) {
  let exportedCount = 0;
  const exportedUrls = new Set();
  const usedBaseNames = new Set();

  try {
    const cache = await caches.open(CACHE_NAMES.IMAGES);
    const assetMetaList = await readAllFromIDB(IDB_STORES.ASSETS.name, IDB_STORES.ASSETS.store);
    const unifiedCacheItems = await readAllFromIDB(IDB_STORES.UNIFIED_CACHE.name, IDB_STORES.UNIFIED_CACHE.store);
    const cacheKeys = await cache.keys();
    const virtualRequests = cacheKeys.filter(req => req.url.includes('/__aitu_cache__/'));

    const totalItems = assetMetaList.length + unifiedCacheItems.length + virtualRequests.length;
    let processedCount = 0;

    // 1. 本地素材
    for (const asset of assetMetaList) {
      try {
        if (asset.url) {
          const response = await cache.match(asset.url);
          if (response) {
            const blob = await response.blob();
            if (blob.size > 0) {
              const ext = getExtensionFromMimeType(asset.mimeType || blob.type);
              const uniqueBaseName = ensureUniqueBackupName(
                appendUrlHashToBackupName(
                  buildAssetExportBaseName(String(asset.id || 'asset'), asset.createdAt),
                  asset.url
                ),
                usedBaseNames
              );
              await partManager.addAssetBlob(
                `${uniqueBaseName}${ext}`, blob,
                `${uniqueBaseName}.meta.json`, asset
              );
              exportedUrls.add(asset.url);
              exportedCount++;
            }
          }
        }
      } catch (err) { /* 静默 */ }
      processedCount++;
      if (onProgress) onProgress(processedCount, totalItems);
    }

    // 2. unified-cache 素材
    const newCacheItems = unifiedCacheItems.filter(item => !exportedUrls.has(item.url));
    for (const item of newCacheItems) {
      try {
        const itemId = item.metadata?.taskId || generateIdFromUrl(item.url);
        const metaData = {
          id: itemId, url: item.url,
          type: normalizeBackupAssetType(item.type, item.mimeType),
          mimeType: item.mimeType, size: item.size,
          source: 'AI_GENERATED',
          createdAt: item.cachedAt, updatedAt: item.lastUsed,
          metadata: item.metadata,
        };
        const response = await cache.match(item.url);
        if (response) {
          const blob = await response.blob();
          if (blob.size > 0) {
            const ext = getExtensionFromMimeType(item.mimeType);
            const uniqueBaseName = ensureUniqueBackupName(
              appendUrlHashToBackupName(
                buildAssetExportBaseName(String(itemId), item.cachedAt),
                item.url
              ),
              usedBaseNames
            );
            await partManager.addAssetBlob(
              `${uniqueBaseName}${ext}`, blob,
              `${uniqueBaseName}.meta.json`, metaData
            );
            exportedUrls.add(item.url);
            exportedCount++;
          }
        }
      } catch (err) { /* 静默 */ }
      processedCount++;
      if (onProgress) onProgress(processedCount, totalItems);
    }
    processedCount += (unifiedCacheItems.length - newCacheItems.length);

    // 3. 虚拟路径缓存
    const pendingVirtualRequests = virtualRequests.filter(req => !exportedUrls.has(req.url));
    for (const request of pendingVirtualRequests) {
      const url = request.url;
      try {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.blob();
          if (blob.size > 0) {
            const urlParts = url.split('/');
            const filename = urlParts[urlParts.length - 1];
            const id = filename.split('.')[0] || `cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const contentType = response.headers.get('content-type') || blob.type;
            const ext = getExtensionFromMimeType(contentType);
            const type = normalizeBackupAssetType(null, contentType);
            const metadata = { id, url, type, mimeType: contentType, size: blob.size, source: 'AI_GENERATED', createdAt: Date.now() };
            const uniqueBaseName = ensureUniqueBackupName(
              appendUrlHashToBackupName(
                buildAssetExportBaseName(String(id), metadata.createdAt),
                url
              ),
              usedBaseNames
            );
            await partManager.addAssetBlob(
              `${uniqueBaseName}${ext}`, blob,
              `${uniqueBaseName}.meta.json`, metadata
            );
            exportedUrls.add(url);
            exportedCount++;
          }
        }
      } catch (err) { /* 静默 */ }
      processedCount++;
      if (onProgress) onProgress(processedCount, totalItems);
    }
  } catch (error) { /* 静默 */ }

  return exportedCount;
}

async function collectKnowledgeBaseData() {
  const noteContents = await readAllFromIDB(
    IDB_STORES.KNOWLEDGE_BASE.name,
    IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_CONTENTS
  );
  const noteContentMap = new Map(
    noteContents.map((item) => [item.noteId || item.id, item.content])
  );

  return exportKnowledgeBaseData({
    getAllDirectories: () => readAllFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.DIRECTORIES
    ),
    getAllTags: () => readAllFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.TAGS
    ),
    getAllNoteMetas: () => readAllFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTES
    ),
    getNoteContentById: async (id) => noteContentMap.get(id),
    getAllNoteTags: () => readAllFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_TAGS
    ),
    getAllNoteImages: () => readAllFromIDB(
      IDB_STORES.KNOWLEDGE_BASE.name,
      IDB_STORES.KNOWLEDGE_BASE.stores.NOTE_IMAGES
    ),
  });
}

/**
 * 显示备份进度条
 */
function showBackupProgress() {
  const container = document.createElement('div');
  container.className = 'backup-progress-container';
  container.innerHTML = `
    <div class="backup-progress-content">
      <div class="backup-progress-header">
        <span class="backup-progress-icon">📦</span>
        <span class="backup-progress-title">正在备份数据</span>
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
 * 显示备份成功通知
 */
function showBackupSuccessNotification({ files, totalParts, size, stats }) {
  const notification = document.createElement('div');
  notification.className = 'import-notification backup-notification';
  const fileInfo = totalParts > 1
    ? `${totalParts} 个分片文件`
    : files[0]?.filename || 'backup.zip';
  notification.innerHTML = `
    <div class="import-notification-content">
      <span class="icon">✅</span>
      <div class="info">
        <strong>备份成功</strong>
        <p>${fileInfo}</p>
        <p class="counts">
          文件大小: ${size} MB
          ${stats.boardCount > 0 ? `| 画板: ${stats.boardCount}` : ''}
          ${stats.folderCount > 0 ? `| 文件夹: ${stats.folderCount}` : ''}
          ${stats.assetCount > 0 ? `| 素材: ${stats.assetCount}` : ''}
          ${stats.taskCount > 0 ? `| 任务: ${stats.taskCount}` : ''}
          ${stats.imagePromptCount > 0 ? `| 图片提示词: ${stats.imagePromptCount}` : ''}
          ${stats.videoPromptCount > 0 ? `| 视频提示词: ${stats.videoPromptCount}` : ''}
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
