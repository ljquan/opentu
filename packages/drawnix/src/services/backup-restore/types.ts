/**
 * Backup & Restore - Type Definitions
 */

import type {
  PromptHistoryItem,
  VideoPromptHistoryItem,
  ImagePromptHistoryItem,
} from '../prompt-storage-service';
import type { PlaitTheme, PlaitElement as CorePlaitElement } from '@plait/core';
import type { EmbeddedMediaItem } from '../../data/types';

// 备份文件版本（v3 支持分片）
export const BACKUP_VERSION = 3;

// 备份文件标识
export const BACKUP_SIGNATURE = 'aitu-backup';

export interface PresetPromptSettings {
  pinnedPrompts: string[];
  deletedPrompts: string[];
}

export interface PresetStorageData {
  image: PresetPromptSettings;
  video: PresetPromptSettings;
}

export interface BackupOptions {
  includePrompts: boolean;
  includeProjects: boolean;
  includeAssets: boolean;
  includeKnowledgeBase: boolean;
  /** 导出时间范围起点（毫秒时间戳，包含） */
  timeRangeStart?: number | null;
  /** 导出时间范围终点（毫秒时间戳，包含） */
  timeRangeEnd?: number | null;
}

export interface BackupWorkspaceState {
  currentBoardId: string | null;
  currentBoardName?: string;
  viewport?: {
    zoom: number;
    origination?: [number, number];
  };
}

export interface BackupManifest {
  signature: string;
  version: number;
  createdAt: number;
  source?: string;
  includes: {
    prompts: boolean;
    projects: boolean;
    assets: boolean;
    knowledgeBase: boolean;
  };
  stats: {
    promptCount: number;
    videoPromptCount: number;
    imagePromptCount: number;
    folderCount: number;
    boardCount: number;
    assetCount: number;
    taskCount: number;
    kbNoteCount: number;
  };
  workspaceState?: BackupWorkspaceState;
  // v3 分片字段
  backupId?: string;
  partIndex?: number;
  totalParts?: number | null;
  isFinalPart?: boolean;
}

export interface PromptsData {
  promptHistory: PromptHistoryItem[];
  videoPromptHistory: VideoPromptHistoryItem[];
  imagePromptHistory: ImagePromptHistoryItem[];
  presetSettings: PresetStorageData;
}

export interface DrawnixFileData {
  type: string;
  version: number;
  source: string;
  elements: PlaitElement[];
  viewport: Viewport;
  theme?: PlaitTheme;
  embeddedMedia?: EmbeddedMediaItem[];
  boardMeta?: {
    id: string;
    name: string;
    folderId: string | null;
    order: number;
    createdAt: number;
    updatedAt: number;
  };
}

export interface Viewport {
  zoom: number;
  origination?: [number, number];
}

export interface PlaitElement {
  id?: string;
  type?: string;
  assetId?: string;
  imageAssetId?: string;
  videoAssetId?: string;
  children?: PlaitElement[];
  [key: string]: unknown;
}

export interface ImportResult {
  success: boolean;
  prompts: { imported: number; skipped: number };
  projects: { folders: number; boards: number; merged: number; skipped: number };
  assets: { imported: number; skipped: number };
  tasks: { imported: number; skipped: number };
  knowledgeBase: { directories: number; notes: number; tags: number; skipped: number };
  errors: string[];
  workspaceState?: BackupWorkspaceState;
}

export interface ExportResult {
  files: Array<{ filename: string; size: number }>;
  totalParts: number;
  stats: BackupManifest['stats'];
}

export type ProgressCallback = (progress: number, message: string) => void;

/**
 * 确保所有元素都有 id
 */
export function ensureElementIds(elements: PlaitElement[]): CorePlaitElement[] {
  return elements.map(el => {
    if (!el.id) {
      return { ...el, id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` } as CorePlaitElement;
    }
    return el as CorePlaitElement;
  });
}
