/**
 * Shared backup/restore core for both main app and sw-debug.
 * This module must stay browser-native and framework-agnostic.
 */

export const BACKUP_SIGNATURE = 'aitu-backup';
export const BACKUP_VERSION = 4;
export const MIN_SUPPORTED_BACKUP_VERSION = 2;

export function getExtensionFromMimeType(mimeType) {
  const mimeToExt = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
  };
  return mimeToExt[mimeType] || '';
}

export function getCandidateExtensions(mimeType) {
  return Array.from(new Set([
    mimeType ? getExtensionFromMimeType(mimeType) : '',
    '.jpg',
    '.png',
    '.gif',
    '.webp',
    '.svg',
    '.mp4',
    '.webm',
    '.mov',
    '.mp3',
    '.wav',
    '.ogg',
    '.m4a',
    '.aac',
    '.flac',
    '',
  ].filter((ext) => typeof ext === 'string')));
}

export function normalizeBackupAssetType(type, mimeType) {
  if (type === 'AUDIO' || type === 'audio' || mimeType?.startsWith('audio/')) {
    return 'AUDIO';
  }
  if (type === 'VIDEO' || type === 'video' || mimeType?.startsWith('video/')) {
    return 'VIDEO';
  }
  return 'IMAGE';
}

export function normalizeCacheMediaType(type, mimeType) {
  if (type === 'AUDIO' || type === 'audio' || mimeType?.startsWith('audio/')) {
    return 'audio';
  }
  if (type === 'VIDEO' || type === 'video' || mimeType?.startsWith('video/')) {
    return 'video';
  }
  return 'image';
}

export function sanitizeFileName(name) {
  return (
    String(name || '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'unnamed'
  );
}

export function generateIdFromUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }
  return `cache-${Math.abs(hash).toString(36)}`;
}

export function appendUrlHashToBackupName(baseName, url) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return baseName;
  }

  const hashSuffix = generateIdFromUrl(url).replace(/^cache-/, '');
  return hashSuffix ? `${baseName}_${hashSuffix}` : baseName;
}

export function ensureUniqueBackupName(baseName, usedNames) {
  let candidate = baseName;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    candidate = `${baseName}_${suffix}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

export function hasExportableTaskMedia(result) {
  if (!result) return false;
  if (typeof result.url === 'string' && result.url.trim().length > 0) return true;
  if (Array.isArray(result.urls) && result.urls.some((url) => typeof url === 'string' && url.trim().length > 0)) {
    return true;
  }
  if (Array.isArray(result.clips) && result.clips.some((clip) => typeof clip?.audioUrl === 'string' && clip.audioUrl.trim().length > 0)) {
    return true;
  }
  return false;
}

export function formatTimestampForFilename(timestamp) {
  const date =
    typeof timestamp === 'number' && Number.isFinite(timestamp)
      ? new Date(timestamp)
      : new Date();
  if (Number.isNaN(date.getTime())) {
    return 'unknown-time';
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${hh}${mm}${ss}`;
}

export function buildAssetExportBaseName(assetId, createdAt) {
  return `${formatTimestampForFilename(createdAt)}_${sanitizeFileName(assetId)}`;
}

export function mergePromptData({
  promptHistory = [],
  videoPromptHistory = [],
  imagePromptHistory = [],
  presetSettings,
  deletedPromptContents = [],
  promptHistoryOverrides = [],
  allTasks = [],
}) {
  const completedTasks = allTasks.filter((task) => task?.status === 'completed');

  const imageTaskPrompts = completedTasks
    .filter((task) => task?.type === 'image' && task?.params?.prompt)
    .map((task) => ({
      id: `task_${task.id}`,
      content: task.params.prompt.trim(),
      timestamp: task.completedAt || task.createdAt || Date.now(),
    }))
    .filter((item) => item.content && item.content.length > 0);

  const videoTaskPrompts = completedTasks
    .filter((task) => task?.type === 'video' && task?.params?.prompt)
    .map((task) => ({
      id: `task_${task.id}`,
      content: task.params.prompt.trim(),
      timestamp: task.completedAt || task.createdAt || Date.now(),
    }))
    .filter((item) => item.content && item.content.length > 0);

  const mergedImagePromptHistory = [...imagePromptHistory];
  const mergedVideoPromptHistory = [...videoPromptHistory];

  const existingImageContents = new Set(mergedImagePromptHistory.map((item) => item.content));
  for (const item of imageTaskPrompts) {
    if (!existingImageContents.has(item.content)) {
      mergedImagePromptHistory.push(item);
      existingImageContents.add(item.content);
    }
  }

  const existingVideoContents = new Set(mergedVideoPromptHistory.map((item) => item.content));
  for (const item of videoTaskPrompts) {
    if (!existingVideoContents.has(item.content)) {
      mergedVideoPromptHistory.push(item);
      existingVideoContents.add(item.content);
    }
  }

  const createPresetSettings = () => ({
    pinnedPrompts: [],
    deletedPrompts: [],
  });
  const normalizedPresetSettings = {};
  for (const type of ['image', 'video', 'audio', 'text', 'agent', 'ppt-common', 'ppt-slide']) {
    const settings = presetSettings?.[type] || {};
    normalizedPresetSettings[type] = {
      pinnedPrompts: Array.isArray(settings.pinnedPrompts) ? settings.pinnedPrompts : [],
      deletedPrompts: Array.isArray(settings.deletedPrompts) ? settings.deletedPrompts : [],
    };
  }

  return {
    promptHistory,
    videoPromptHistory: mergedVideoPromptHistory,
    imagePromptHistory: mergedImagePromptHistory,
    presetSettings: presetSettings ? normalizedPresetSettings : {
      image: createPresetSettings(),
      video: createPresetSettings(),
      audio: createPresetSettings(),
      text: createPresetSettings(),
      agent: createPresetSettings(),
      'ppt-common': createPresetSettings(),
      'ppt-slide': createPresetSettings(),
    },
    deletedPromptContents: Array.isArray(deletedPromptContents) ? deletedPromptContents : [],
    promptHistoryOverrides: Array.isArray(promptHistoryOverrides) ? promptHistoryOverrides : [],
  };
}

export function filterCompletedMediaTasks(allTasks = []) {
  return allTasks.filter(
    (task) =>
      task?.status === 'completed' &&
      (task?.type === 'image' || task?.type === 'video' || task?.type === 'audio') &&
      hasExportableTaskMedia(task?.result)
  );
}

export function validateBackupManifest(manifest, options = {}) {
  const maxVersion = options.maxVersion || BACKUP_VERSION;
  const minVersion = options.minVersion || MIN_SUPPORTED_BACKUP_VERSION;

  if (!manifest || typeof manifest !== 'object') {
    throw new Error('无效的备份文件：manifest 格式错误');
  }
  if (manifest.signature !== BACKUP_SIGNATURE) {
    throw new Error('无效的备份文件：签名不匹配');
  }
  if (
    typeof manifest.version !== 'number' ||
    manifest.version < minVersion ||
    manifest.version > maxVersion
  ) {
    throw new Error(`不支持的备份版本: ${manifest.version}`);
  }

  return manifest;
}

export function buildFolderPathMap(folders = []) {
  const pathMap = new Map();
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));

  const getPath = (folderId) => {
    if (pathMap.has(folderId)) return pathMap.get(folderId);
    const folder = folderMap.get(folderId);
    if (!folder) return '';
    const parentPath = folder.parentId ? getPath(folder.parentId) : '';
    const safeName = sanitizeFileName(folder.name);
    const fullPath = parentPath ? `${parentPath}/${safeName}` : safeName;
    pathMap.set(folderId, fullPath);
    return fullPath;
  };

  for (const folder of folders) {
    getPath(folder.id);
  }

  return pathMap;
}

export function collectFolderPathsFromBoardPaths(boardPaths = []) {
  const folderPaths = new Set();

  for (const filePath of boardPaths) {
    const relativePath = String(filePath || '').replace(/^projects\//, '');
    const parts = relativePath.split('/');
    if (parts.length > 1) {
      let currentPath = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        folderPaths.add(currentPath);
      }
    }
  }

  return Array.from(folderPaths).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    return depthA - depthB || a.localeCompare(b);
  });
}

export function getFolderDepth(folder, folderMap) {
  let depth = 0;
  let currentParentId = folder?.parentId;
  while (currentParentId) {
    depth += 1;
    currentParentId = folderMap.get(currentParentId)?.parentId || null;
  }
  return depth;
}

export function sortFoldersByDepth(folders = []) {
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  return [...folders].sort((a, b) => {
    const depthA = getFolderDepth(a, folderMap);
    const depthB = getFolderDepth(b, folderMap);
    return depthA - depthB || (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name);
  });
}

export function getFolderKey(name, parentId) {
  return `${parentId || 'root'}::${name}`;
}

export function findBinaryFile(assetsFolder, metaRelativePath, mimeType) {
  const basePath = metaRelativePath.replace('.meta.json', '');
  const extensions = getCandidateExtensions(mimeType);

  for (const ext of extensions) {
    const file = assetsFolder.file(basePath + ext);
    if (file && !file.dir) return file;
  }
  return null;
}

export async function exportKnowledgeBaseData(adapter) {
  const [directories, tags, noteMetas, noteTags, images] = await Promise.all([
    adapter.getAllDirectories(),
    adapter.getAllTags(),
    adapter.getAllNoteMetas(),
    adapter.getAllNoteTags(),
    adapter.getAllNoteImages ? adapter.getAllNoteImages() : Promise.resolve([]),
  ]);

  const notes = await Promise.all(
    noteMetas.map(async (meta) => {
      const content = await adapter.getNoteContentById(meta.id);
      return {
        ...meta,
        content: content ?? meta.content ?? '',
      };
    })
  );

  return {
    version: 2,
    exportedAt: Date.now(),
    directories,
    notes,
    tags,
    noteTags,
    images,
  };
}

export async function importKnowledgeBaseData(data, adapter) {
  let dirCount = 0;
  let noteCount = 0;
  let tagCount = 0;
  let imageCount = 0;
  const directoryIdMap = new Map();

  const existingDirectories = await adapter.getAllDirectories();
  const existingDirectoriesById = new Map(existingDirectories.map((dir) => [dir.id, dir]));
  const existingDirectoriesByName = new Map(existingDirectories.map((dir) => [dir.name, dir]));

  for (const dir of data.directories || []) {
    const existingById = existingDirectoriesById.get(dir.id) ?? await adapter.getDirectoryById(dir.id);
    if (existingById) {
      directoryIdMap.set(dir.id, existingById.id);
      continue;
    }

    const existingByName = existingDirectoriesByName.get(dir.name);
    if (existingByName) {
      directoryIdMap.set(dir.id, existingByName.id);

      if ((dir.isDefault && !existingByName.isDefault) || existingByName.order !== dir.order) {
        await adapter.putDirectory(existingByName.id, {
          ...existingByName,
          isDefault: existingByName.isDefault || dir.isDefault,
          order: existingByName.order ?? dir.order,
          updatedAt: Math.max(existingByName.updatedAt, dir.updatedAt),
        });
      }
      continue;
    }

    await adapter.putDirectory(dir.id, dir);
    existingDirectoriesById.set(dir.id, dir);
    existingDirectoriesByName.set(dir.name, dir);
    directoryIdMap.set(dir.id, dir.id);
    dirCount += 1;
  }

  for (const tag of data.tags || []) {
    const existing = await adapter.getTagById(tag.id);
    if (!existing) {
      await adapter.putTag(tag.id, tag);
      tagCount += 1;
    }
  }

  for (const note of data.notes || []) {
    const existing = await adapter.getNoteById(note.id);
    if (!existing) {
      const { content, ...meta } = note;
      const directoryId = directoryIdMap.get(note.directoryId) || note.directoryId;
      await adapter.putNoteMeta(note.id, {
        ...meta,
        directoryId,
      });
      if (content) {
        await adapter.putNoteContent(note.id, {
          id: note.id,
          noteId: note.id,
          content,
        });
      }
      noteCount += 1;
    }
  }

  for (const noteTag of data.noteTags || []) {
    const existing = await adapter.getNoteTagById(noteTag.id);
    if (!existing) {
      await adapter.putNoteTag(noteTag.id, noteTag);
    }
  }

  if (Array.isArray(data.images) && adapter.getNoteImageById && adapter.putNoteImage) {
    for (const image of data.images) {
      const existing = await adapter.getNoteImageById(image.id);
      if (!existing) {
        await adapter.putNoteImage(image.id, image);
        imageCount += 1;
      }
    }
  }

  return { dirCount, noteCount, tagCount, imageCount };
}
