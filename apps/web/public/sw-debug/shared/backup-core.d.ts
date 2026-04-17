export const BACKUP_SIGNATURE: string;
export const BACKUP_VERSION: number;

export type PromptHistoryItem = {
  id: string;
  content: string;
  timestamp: number;
};

export type PromptData = {
  promptHistory: PromptHistoryItem[];
  videoPromptHistory: PromptHistoryItem[];
  imagePromptHistory: PromptHistoryItem[];
  presetSettings: {
    image: { pinnedPrompts: string[]; deletedPrompts: string[] };
    video: { pinnedPrompts: string[]; deletedPrompts: string[] };
  };
};

export function getExtensionFromMimeType(mimeType: string): string;
export function getCandidateExtensions(mimeType?: string | null): string[];
export function normalizeBackupAssetType(type?: string | null, mimeType?: string | null): 'IMAGE' | 'VIDEO' | 'AUDIO';
export function normalizeCacheMediaType(type?: string | null, mimeType?: string | null): 'image' | 'video' | 'audio';
export function sanitizeFileName(name: string): string;
export function generateIdFromUrl(url: string): string;
export function appendUrlHashToBackupName(baseName: string, url?: string | null): string;
export function ensureUniqueBackupName(baseName: string, usedNames: Set<string>): string;
export function hasExportableTaskMedia(result?: {
  url?: string | null;
  urls?: Array<string | null | undefined> | null;
  clips?: Array<{ audioUrl?: string | null } | null | undefined> | null;
} | null): boolean;
export function formatTimestampForFilename(timestamp?: number): string;
export function buildAssetExportBaseName(assetId: string, createdAt?: number): string;
export function mergePromptData(input: {
  promptHistory?: PromptHistoryItem[];
  videoPromptHistory?: PromptHistoryItem[];
  imagePromptHistory?: PromptHistoryItem[];
  presetSettings?: PromptData['presetSettings'];
  allTasks?: Array<any>;
}): PromptData;
export function filterCompletedMediaTasks<T = any>(allTasks?: T[]): T[];
export function buildFolderPathMap<T extends { id: string; name: string; parentId?: string | null }>(folders?: T[]): Map<string, string>;
export function collectFolderPathsFromBoardPaths(boardPaths?: string[]): string[];
export function getFolderDepth<T extends { parentId?: string | null }>(folder: T, folderMap: Map<string, T>): number;
export function sortFoldersByDepth<T extends { id: string; name: string; parentId?: string | null; order?: number }>(folders?: T[]): T[];
export function getFolderKey(name: string, parentId?: string | null): string;
export function findBinaryFile(assetsFolder: any, metaRelativePath: string, mimeType?: string | null): any;
export function exportKnowledgeBaseData(adapter: {
  getAllDirectories(): Promise<any[]>;
  getAllTags(): Promise<any[]>;
  getAllNoteMetas(): Promise<any[]>;
  getNoteContentById(id: string): Promise<string | null | undefined>;
  getAllNoteTags(): Promise<any[]>;
  getAllNoteImages?(): Promise<any[]>;
}): Promise<{
  version: number;
  exportedAt: number;
  directories: any[];
  notes: any[];
  tags: any[];
  noteTags: any[];
  images: any[];
}>;
export function importKnowledgeBaseData(data: any, adapter: {
  getAllDirectories(): Promise<any[]>;
  getDirectoryById(id: string): Promise<any | null>;
  putDirectory(id: string, value: any): Promise<any>;
  getTagById(id: string): Promise<any | null>;
  putTag(id: string, value: any): Promise<any>;
  getNoteById(id: string): Promise<any | null>;
  putNoteMeta(id: string, value: any): Promise<any>;
  putNoteContent(id: string, value: any): Promise<any>;
  getNoteTagById(id: string): Promise<any | null>;
  putNoteTag(id: string, value: any): Promise<any>;
  getNoteImageById?(id: string): Promise<any | null>;
  putNoteImage?(id: string, value: any): Promise<any>;
}): Promise<{ dirCount: number; noteCount: number; tagCount: number; imageCount: number }>;
