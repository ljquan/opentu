/**
 * Backup & Restore - Shared Utilities
 */

export type BackupAssetType = 'IMAGE' | 'VIDEO' | 'AUDIO';
export type BackupCacheMediaType = 'image' | 'video' | 'audio';

export {
  getExtensionFromMimeType,
  getCandidateExtensions,
  normalizeBackupAssetType,
  normalizeCacheMediaType,
  sanitizeFileName,
  generateIdFromUrl,
  appendUrlHashToBackupName,
  ensureUniqueBackupName,
  hasExportableTaskMedia,
  formatTimestampForFilename,
  buildAssetExportBaseName,
  mergePromptData,
  filterCompletedMediaTasks,
  buildFolderPathMap,
  collectFolderPathsFromBoardPaths,
  getFolderDepth,
  sortFoldersByDepth,
  getFolderKey,
  findBinaryFile,
  validateBackupManifest,
  exportKnowledgeBaseData,
  importKnowledgeBaseData,
  BACKUP_SIGNATURE,
  BACKUP_VERSION,
} from '../../../../../apps/web/public/sw-debug/shared/backup-core.js';

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}
