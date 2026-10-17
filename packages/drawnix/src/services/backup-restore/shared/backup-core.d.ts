export function getExtensionFromMimeType(mimeType: any): any;
export function getCandidateExtensions(mimeType: any): any[];
export function normalizeBackupAssetType(type: any, mimeType: any): "AUDIO" | "VIDEO" | "IMAGE";
export function normalizeCacheMediaType(type: any, mimeType: any): "audio" | "video" | "image";
export function sanitizeFileName(name: any): string;
export function generateIdFromUrl(url: any): string;
export function appendUrlHashToBackupName(baseName: any, url: any): any;
export function ensureUniqueBackupName(baseName: any, usedNames: any): any;
export function hasExportableTaskMedia(result: any): boolean;
export function formatTimestampForFilename(timestamp: any): string;
export function buildAssetExportBaseName(assetId: any, createdAt: any): string;
export function mergePromptData({ promptHistory, videoPromptHistory, imagePromptHistory, presetSettings, deletedPromptContents, promptHistoryOverrides, allTasks, }: {
    promptHistory?: any[];
    videoPromptHistory?: any[];
    imagePromptHistory?: any[];
    presetSettings: any;
    deletedPromptContents?: any[];
    promptHistoryOverrides?: any[];
    allTasks?: any[];
}): {
    promptHistory: any[];
    videoPromptHistory: any[];
    imagePromptHistory: any[];
    presetSettings: {};
    deletedPromptContents: any[];
    promptHistoryOverrides: any[];
};
export function filterCompletedMediaTasks(allTasks?: any[]): any[];
export function validateBackupManifest(manifest: any, options?: {}): any;
export function buildFolderPathMap(folders?: any[]): Map<any, any>;
export function collectFolderPathsFromBoardPaths(boardPaths?: any[]): any[];
export function getFolderDepth(folder: any, folderMap: any): number;
export function sortFoldersByDepth(folders?: any[]): any[];
export function getFolderKey(name: any, parentId: any): string;
export function findBinaryFile(assetsFolder: any, metaRelativePath: any, mimeType: any): any;
export function exportKnowledgeBaseData(adapter: any): Promise<{
    version: number;
    exportedAt: number;
    directories: any;
    notes: any[];
    tags: any;
    noteTags: any;
    images: any;
}>;
export function importKnowledgeBaseData(data: any, adapter: any): Promise<{
    dirCount: number;
    noteCount: number;
    tagCount: number;
    imageCount: number;
}>;
/**
 * Shared backup/restore core for both main app and sw-debug.
 * This module must stay browser-native and framework-agnostic.
 */
export const BACKUP_SIGNATURE: "aitu-backup";
export const BACKUP_VERSION: 4;
export const MIN_SUPPORTED_BACKUP_VERSION: 2;
