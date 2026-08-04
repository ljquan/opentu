/**
 * Prompt Storage Service
 *
 * 管理用户历史提示词的存储
 * 使用 IndexedDB 进行持久化存储（通过 kvStorageService）
 * 支持从 LocalStorage 迁移的向下兼容
 */

import { LS_KEYS_TO_MIGRATE } from '../constants/storage-keys';
import { kvStorageService } from './kv-storage-service';

const STORAGE_KEY = LS_KEYS_TO_MIGRATE.PROMPT_HISTORY;

// 预设提示词设置的存储 key
const PRESET_SETTINGS_KEY = LS_KEYS_TO_MIGRATE.PRESET_SETTINGS;
const PROMPT_DELETED_CONTENTS_KEY = LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS;
const PROMPT_HISTORY_OVERRIDES_KEY =
  LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES;

// 视频描述历史记录的存储 key
const VIDEO_PROMPT_HISTORY_KEY = LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY;

// 图片描述历史记录的存储 key
const IMAGE_PROMPT_HISTORY_KEY = LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY;

export const PROMPT_TYPES = [
  'image',
  'video',
  'audio',
  'text',
  'agent',
  'ppt-common',
  'ppt-slide',
] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export interface PromptHistoryItem {
  id: string;
  content: string;
  timestamp: number;
  /** 是否在有选中元素时输入的 */
  hasSelection?: boolean;
  /** 是否置顶 */
  pinned?: boolean;
  /** 生成类型：image/video/audio/text/agent/ppt-common/ppt-slide */
  modelType?: PromptType;
}

export interface PresetPromptSettings {
  /** 置顶的提示词列表（按置顶顺序排列） */
  pinnedPrompts: string[];
  /** 已删除的提示词列表 */
  deletedPrompts: string[];
}

export interface PromptHistoryOverride {
  /** 原始任务/历史提示词内容 */
  sourceContent: string;
  /** 用户编辑后的有效提示词内容 */
  content: string;
  title?: string;
  tags?: string[];
  modelType?: PromptType;
  updatedAt: number;
  /** @deprecated 兼容旧覆盖数据 */
  sourceSentPrompt?: string;
  /** @deprecated 兼容旧覆盖数据 */
  sentPrompt?: string;
}

export interface PromptMetadata {
  sourceContent: string;
  content: string;
  title?: string;
  tags?: string[];
  modelType?: PromptType;
}

export type PromptStorageChangeType =
  | 'history'
  | 'metadata'
  | 'pin'
  | 'delete'
  | 'reset';

export interface PromptStorageChangeEvent {
  version: number;
  types: PromptStorageChangeType[];
}

export type PromptStorageChangeListener = (
  event: PromptStorageChangeEvent
) => void;

interface PresetStorageData {
  image: PresetPromptSettings;
  video: PresetPromptSettings;
  audio: PresetPromptSettings;
  text: PresetPromptSettings;
  agent: PresetPromptSettings;
  'ppt-common': PresetPromptSettings;
  'ppt-slide': PresetPromptSettings;
}

function createDefaultPresetSettings(): PresetPromptSettings {
  return {
    pinnedPrompts: [],
    deletedPrompts: [],
  };
}

function createEmptyPresetStorageData(): PresetStorageData {
  return {
    image: createDefaultPresetSettings(),
    video: createDefaultPresetSettings(),
    audio: createDefaultPresetSettings(),
    text: createDefaultPresetSettings(),
    agent: createDefaultPresetSettings(),
    'ppt-common': createDefaultPresetSettings(),
    'ppt-slide': createDefaultPresetSettings(),
  };
}

function normalizePresetStorageData(
  data?: Partial<Record<PromptType, PresetPromptSettings>> | null
): PresetStorageData {
  const normalized = createEmptyPresetStorageData();

  if (!data || typeof data !== 'object') {
    return normalized;
  }

  for (const type of PROMPT_TYPES) {
    const settings = data[type];
    normalized[type] = {
      pinnedPrompts: Array.isArray(settings?.pinnedPrompts)
        ? settings.pinnedPrompts
        : [],
      deletedPrompts: Array.isArray(settings?.deletedPrompts)
        ? settings.deletedPrompts
        : [],
    };
  }

  return normalized;
}

function normalizePromptHistoryOverride(
  override: Partial<PromptHistoryOverride>
): PromptHistoryOverride | null {
  const sourceContent = (
    override.sourceContent ||
    override.sourceSentPrompt ||
    ''
  ).trim();
  const content = (
    override.content ||
    override.sentPrompt ||
    sourceContent
  ).trim();

  if (!sourceContent || !content) {
    return null;
  }

  return {
    sourceContent,
    content: content.slice(0, 2000),
    title: override.title?.trim().slice(0, 80) || undefined,
    tags: normalizeHistoryOverrideTags(override.tags),
    modelType: override.modelType,
    updatedAt:
      typeof override.updatedAt === 'number' ? override.updatedAt : Date.now(),
  };
}

function normalizePromptHistoryOverrides(
  overrides?: Partial<PromptHistoryOverride>[] | null
): PromptHistoryOverride[] {
  if (!Array.isArray(overrides)) {
    return [];
  }

  const map = new Map<string, PromptHistoryOverride>();
  overrides.forEach((override) => {
    const normalized = normalizePromptHistoryOverride(override);
    if (!normalized) {
      return;
    }
    const existing = map.get(normalized.sourceContent);
    if (!existing || normalized.updatedAt >= existing.updatedAt) {
      map.set(normalized.sourceContent, normalized);
    }
  });
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 生成唯一 ID
 */
function generatePromptId(): string {
  return `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================
// 内存缓存（用于同步读取，异步更新）
// ============================================

let promptHistoryCache: PromptHistoryItem[] | null = null;
let videoPromptHistoryCache: VideoPromptHistoryItem[] | null = null;
let imagePromptHistoryCache: ImagePromptHistoryItem[] | null = null;
let presetDataCache: PresetStorageData | null = null;
let deletedPromptContentsCache: string[] | null = null;
let promptHistoryOverridesCache: PromptHistoryOverride[] | null = null;
let cacheInitialized = false;
let promptStorageVersion = 0;
let promptStorageChangeScheduled = false;
const promptStorageChangeTypes = new Set<PromptStorageChangeType>();
const promptStorageChangeListeners = new Set<PromptStorageChangeListener>();

function emitPromptStorageChange(type: PromptStorageChangeType): void {
  promptStorageChangeTypes.add(type);
  if (promptStorageChangeScheduled) {
    return;
  }

  promptStorageChangeScheduled = true;
  queueMicrotask(() => {
    promptStorageChangeScheduled = false;
    if (promptStorageChangeTypes.size === 0) {
      return;
    }

    promptStorageVersion += 1;
    const event: PromptStorageChangeEvent = {
      version: promptStorageVersion,
      types: Array.from(promptStorageChangeTypes),
    };
    promptStorageChangeTypes.clear();

    promptStorageChangeListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(
          '[PromptStorageService] Prompt storage change listener failed:',
          error
        );
      }
    });
  });
}

export function subscribePromptStorageChanges(
  listener: PromptStorageChangeListener
): () => void {
  promptStorageChangeListeners.add(listener);
  return () => {
    promptStorageChangeListeners.delete(listener);
  };
}

export function getPromptStorageVersion(): number {
  return promptStorageVersion;
}

/**
 * 初始化缓存（从 IndexedDB 加载数据）
 * 应在应用启动时调用
 */
export async function initPromptStorageCache(): Promise<void> {
  if (cacheInitialized) {
    return;
  }

  try {
    const [
      promptHistory,
      videoHistory,
      imageHistory,
      presetSettings,
      deletedPromptContents,
      promptHistoryOverrides,
    ] = await Promise.all([
      kvStorageService.get<PromptHistoryItem[]>(STORAGE_KEY),
      kvStorageService.get<VideoPromptHistoryItem[]>(VIDEO_PROMPT_HISTORY_KEY),
      kvStorageService.get<ImagePromptHistoryItem[]>(IMAGE_PROMPT_HISTORY_KEY),
      kvStorageService.get<PresetStorageData>(PRESET_SETTINGS_KEY),
      kvStorageService.get<string[]>(PROMPT_DELETED_CONTENTS_KEY),
      kvStorageService.get<PromptHistoryOverride[]>(
        PROMPT_HISTORY_OVERRIDES_KEY
      ),
    ]);

    promptHistoryCache = promptHistory || [];
    videoPromptHistoryCache = videoHistory || [];
    imagePromptHistoryCache = imageHistory || [];
    presetDataCache = normalizePresetStorageData(presetSettings);
    deletedPromptContentsCache = Array.isArray(deletedPromptContents)
      ? deletedPromptContents
      : [];
    promptHistoryOverridesCache = normalizePromptHistoryOverrides(
      promptHistoryOverrides
    );

    cacheInitialized = true;
  } catch (error) {
    console.error('[PromptStorageService] Failed to initialize cache:', error);
    // 初始化为空数据
    promptHistoryCache = [];
    videoPromptHistoryCache = [];
    imagePromptHistoryCache = [];
    presetDataCache = createEmptyPresetStorageData();
    deletedPromptContentsCache = [];
    promptHistoryOverridesCache = [];
    cacheInitialized = true;
  }
}

/**
 * 重置缓存（强制从 IndexedDB 重新加载数据）
 * 用于数据导入后刷新内存缓存
 */
export async function resetPromptStorageCache(): Promise<void> {
  cacheInitialized = false;
  promptHistoryCache = null;
  videoPromptHistoryCache = null;
  imagePromptHistoryCache = null;
  presetDataCache = null;
  deletedPromptContentsCache = null;
  promptHistoryOverridesCache = null;
  await initPromptStorageCache();
  emitPromptStorageChange('reset');
}

/**
 * 检查缓存是否已初始化
 */
export function isPromptCacheInitialized(): boolean {
  return cacheInitialized;
}

/**
 * 等待缓存初始化完成
 * 如果已初始化则立即返回，否则等待初始化
 */
export async function waitForPromptCacheInit(): Promise<void> {
  if (cacheInitialized) return;
  await initPromptStorageCache();
}

/**
 * 确保缓存已初始化
 */
function ensureCacheInitialized(): void {
  if (!cacheInitialized) {
    // 如果缓存未初始化，使用空数据
    promptHistoryCache = promptHistoryCache || [];
    videoPromptHistoryCache = videoPromptHistoryCache || [];
    imagePromptHistoryCache = imagePromptHistoryCache || [];
    presetDataCache = normalizePresetStorageData(presetDataCache);
    deletedPromptContentsCache = deletedPromptContentsCache || [];
    promptHistoryOverridesCache = promptHistoryOverridesCache || [];
  }
}

/**
 * 保存提示词历史到 IndexedDB（异步）
 */
function savePromptHistory(): void {
  if (promptHistoryCache === null) return;
  kvStorageService.set(STORAGE_KEY, promptHistoryCache).catch((error) => {
    console.error(
      '[PromptStorageService] Failed to save prompt history:',
      error
    );
  });
}

/**
 * 保存图片提示词历史到 IndexedDB（异步）
 */
function saveImagePromptHistory(): void {
  if (imagePromptHistoryCache === null) return;
  kvStorageService
    .set(IMAGE_PROMPT_HISTORY_KEY, imagePromptHistoryCache)
    .catch((error) => {
      console.error(
        '[PromptStorageService] Failed to save image prompt history:',
        error
      );
    });
}

/**
 * 保存视频提示词历史到 IndexedDB（异步）
 */
function saveVideoPromptHistory(): void {
  if (videoPromptHistoryCache === null) return;
  kvStorageService
    .set(VIDEO_PROMPT_HISTORY_KEY, videoPromptHistoryCache)
    .catch((error) => {
      console.error(
        '[PromptStorageService] Failed to save video prompt history:',
        error
      );
    });
}

/**
 * 保存预设数据到 IndexedDB（异步）
 */
function savePresetData(): void {
  if (presetDataCache === null) return;
  kvStorageService.set(PRESET_SETTINGS_KEY, presetDataCache).catch((error) => {
    console.error('[PromptStorageService] Failed to save preset data:', error);
  });
}

function saveDeletedPromptContents(): void {
  if (deletedPromptContentsCache === null) return;
  kvStorageService
    .set(PROMPT_DELETED_CONTENTS_KEY, deletedPromptContentsCache)
    .catch((error) => {
      console.error(
        '[PromptStorageService] Failed to save deleted prompt contents:',
        error
      );
    });
}

function savePromptHistoryOverrides(): void {
  if (promptHistoryOverridesCache === null) return;
  kvStorageService
    .set(PROMPT_HISTORY_OVERRIDES_KEY, promptHistoryOverridesCache)
    .catch((error) => {
      console.error(
        '[PromptStorageService] Failed to save prompt history overrides:',
        error
      );
    });
}

// ============================================
// 提示词历史记录功能
// ============================================

/**
 * 获取所有历史提示词
 * 返回排序后的列表：置顶的在前面，非置顶的按时间倒序
 */
export function getPromptHistory(): PromptHistoryItem[] {
  ensureCacheInitialized();
  const history = promptHistoryCache || [];
  // 排序：置顶的在前，非置顶的按时间倒序
  return [...history].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.timestamp - a.timestamp;
  });
}

/**
 * 添加历史提示词
 * 自动去重，新记录插入头部，限制最大数量
 * 注意：如果相同内容已被置顶，只更新时间戳，不会创建新记录
 * @param content 提示词内容
 * @param hasSelection 是否在有选中元素时输入的
 * @param modelType 生成类型：image、video、audio、text 或 agent
 */
export function addPromptHistory(
  content: string,
  hasSelection?: boolean,
  modelType?: PromptType
): void {
  if (!content || !content.trim()) return;

  const trimmedContent = content.trim();
  ensureCacheInitialized();
  deletedPromptContentsCache = (deletedPromptContentsCache || []).filter(
    (item) => item !== trimmedContent
  );

  let history = promptHistoryCache || [];

  // 检查是否已存在相同内容
  const existingIndex = history.findIndex(
    (item) => item.content === trimmedContent
  );

  if (existingIndex >= 0) {
    const existingItem = history[existingIndex];
    if (existingItem.pinned) {
      // 已置顶的提示词：更新时间戳和 modelType，保持置顶状态
      existingItem.timestamp = Date.now();
      if (modelType) {
        existingItem.modelType = modelType;
      }
      promptHistoryCache = history;
      savePromptHistory();
      emitPromptStorageChange('history');
      return;
    }
    // 未置顶的：移除旧记录，后面会添加新的
    history = history.filter((item) => item.content !== trimmedContent);
  }

  // 新记录插入头部
  const newItem: PromptHistoryItem = {
    id: generatePromptId(),
    content: trimmedContent,
    timestamp: Date.now(),
    hasSelection,
    modelType,
  };
  history.unshift(newItem);

  // 不再限制最大数量，使用 IndexedDB 可存储无限条记录

  promptHistoryCache = history;
  savePromptHistory();
  saveDeletedPromptContents();
  emitPromptStorageChange('history');
}

/**
 * 删除指定历史提示词
 */
export function removePromptHistory(id: string): void {
  ensureCacheInitialized();
  const history = promptHistoryCache || [];
  const item = history.find((entry) => entry.id === id);
  if (item && !(deletedPromptContentsCache || []).includes(item.content)) {
    deletedPromptContentsCache = [
      ...(deletedPromptContentsCache || []),
      item.content,
    ];
    saveDeletedPromptContents();
  }
  promptHistoryCache = history.filter((entry) => entry.id !== id);
  savePromptHistory();
  emitPromptStorageChange('delete');
}

/**
 * 清空所有历史提示词
 */
export function clearPromptHistory(): void {
  promptHistoryCache = [];
  savePromptHistory();
  emitPromptStorageChange('delete');
}

/**
 * 清空文本、视频和图片提示词历史，保留预设、隐藏记录和用户编辑偏好。
 */
export async function clearGenerationPromptHistory(): Promise<void> {
  promptHistoryCache = [];
  videoPromptHistoryCache = [];
  imagePromptHistoryCache = [];
  await Promise.all([
    kvStorageService.remove(STORAGE_KEY),
    kvStorageService.remove(VIDEO_PROMPT_HISTORY_KEY),
    kvStorageService.remove(IMAGE_PROMPT_HISTORY_KEY),
  ]);
  emitPromptStorageChange('delete');
}

/**
 * 合并远程提示词历史（用于云端同步）
 * 只添加本地不存在的记录，保留本地的置顶状态
 */
export function mergePromptHistory(remoteHistory: PromptHistoryItem[]): number {
  ensureCacheInitialized();
  const localHistory = promptHistoryCache || [];
  const localContents = new Set(localHistory.map((item) => item.content));

  let addedCount = 0;
  for (const remoteItem of remoteHistory) {
    if (!localContents.has(remoteItem.content)) {
      localHistory.push(remoteItem);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    promptHistoryCache = localHistory;
    savePromptHistory();
    emitPromptStorageChange('history');
  }

  return addedCount;
}

/**
 * 切换提示词置顶状态
 * @param id 提示词 ID
 * @returns 切换后的置顶状态
 */
export function togglePinPrompt(id: string): boolean {
  ensureCacheInitialized();
  const history = promptHistoryCache || [];
  const item = history.find((item) => item.id === id);

  if (!item) return false;

  // 切换置顶状态
  item.pinned = !item.pinned;
  syncPresetPinnedForContent(item.content, item.pinned, item.modelType);
  savePromptHistory();
  emitPromptStorageChange('pin');

  return item.pinned;
}

export function isPromptContentPinned(content: string): boolean {
  ensureCacheInitialized();
  const trimmedContent = content.trim();
  return (promptHistoryCache || []).some(
    (item) => item.content === trimmedContent && item.pinned
  );
}

function syncPresetPinnedForContent(
  content: string,
  pinned: boolean,
  modelType?: PromptType
): void {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return;
  }

  const data = normalizePresetStorageData(presetDataCache);
  let changed = false;

  if (pinned && modelType) {
    const settings = data[modelType];
    const existingIndex = settings.pinnedPrompts.indexOf(trimmedContent);
    if (existingIndex >= 0) {
      settings.pinnedPrompts.splice(existingIndex, 1);
    }
    settings.pinnedPrompts.unshift(trimmedContent);
    settings.deletedPrompts = settings.deletedPrompts.filter(
      (prompt) => prompt !== trimmedContent
    );
    changed = true;
  }

  if (!pinned) {
    for (const type of PROMPT_TYPES) {
      const settings = data[type];
      const nextPinnedPrompts = settings.pinnedPrompts.filter(
        (prompt) => prompt !== trimmedContent
      );
      if (nextPinnedPrompts.length !== settings.pinnedPrompts.length) {
        settings.pinnedPrompts = nextPinnedPrompts;
        changed = true;
      }
    }
  }

  if (changed) {
    presetDataCache = data;
    savePresetData();
  }
}

export function setPromptContentPinned(
  content: string,
  pinned: boolean,
  modelType?: PromptType
): boolean {
  if (!content.trim()) return false;
  ensureCacheInitialized();

  const trimmedContent = content.trim();
  const history = promptHistoryCache || [];
  let item = history.find((entry) => entry.content === trimmedContent);

  if (!item) {
    if (!pinned) {
      syncPresetPinnedForContent(trimmedContent, false, modelType);
      emitPromptStorageChange('pin');
      return false;
    }
    item = {
      id: generatePromptId(),
      content: trimmedContent,
      timestamp: Date.now(),
      modelType,
    };
    history.unshift(item);
  }

  item.pinned = pinned;
  item.timestamp = Date.now();
  if (modelType) {
    item.modelType = modelType;
  }

  if (pinned) {
    deletedPromptContentsCache = (deletedPromptContentsCache || []).filter(
      (entry) => entry !== trimmedContent
    );
    saveDeletedPromptContents();
  }

  syncPresetPinnedForContent(trimmedContent, pinned, modelType);
  promptHistoryCache = history;
  savePromptHistory();
  emitPromptStorageChange('pin');
  return pinned;
}

export function isPromptContentDeleted(content: string): boolean {
  ensureCacheInitialized();
  return (deletedPromptContentsCache || []).includes(content.trim());
}

export function deletePromptContents(contents: string[]): void {
  ensureCacheInitialized();
  const normalized = contents.map((content) => content.trim()).filter(Boolean);
  if (normalized.length === 0) return;

  const deleteSet = new Set(normalized);
  const existingDeleted = new Set(deletedPromptContentsCache || []);
  normalized.forEach((content) => existingDeleted.add(content));
  deletedPromptContentsCache = Array.from(existingDeleted);
  promptHistoryCache = (promptHistoryCache || []).filter(
    (item) => !deleteSet.has(item.content)
  );
  deletePromptContentOverrides(normalized);
  savePromptHistory();
  saveDeletedPromptContents();
  emitPromptStorageChange('delete');
}

function normalizeHistoryOverrideTags(tags?: string[]): string[] | undefined {
  if (!Array.isArray(tags)) {
    return undefined;
  }

  const result: string[] = [];
  const seen = new Set<string>();
  tags.forEach((tag) => {
    const normalized = tag.trim().slice(0, 60);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

export function getPromptHistoryOverride(
  sourceSentPrompt: string
): PromptHistoryOverride | undefined {
  ensureCacheInitialized();
  const source = sourceSentPrompt.trim();
  if (!source) {
    return undefined;
  }
  return (promptHistoryOverridesCache || []).find(
    (item) =>
      item.sourceContent === source ||
      item.sourceSentPrompt === source ||
      item.content === source ||
      item.sentPrompt === source
  );
}

export function resolvePromptContent(content: string): string {
  const source = content.trim();
  if (!source) {
    return '';
  }
  const override = getPromptHistoryOverride(source);
  return (override?.content || override?.sentPrompt || source).trim();
}

export function resolvePromptMetadata(content: string): PromptMetadata {
  const source = content.trim();
  const override = source ? getPromptHistoryOverride(source) : undefined;
  const resolvedContent = (
    override?.content ||
    override?.sentPrompt ||
    source
  ).trim();

  return {
    sourceContent:
      override?.sourceContent || override?.sourceSentPrompt || source,
    content: resolvedContent,
    title: override?.title,
    tags: override?.tags,
    modelType: override?.modelType,
  };
}

export function deletePromptContentOverrides(sourceContents: string[]): void {
  ensureCacheInitialized();
  const deleteSet = new Set(
    sourceContents.map((content) => content.trim()).filter(Boolean)
  );
  if (deleteSet.size === 0) {
    return;
  }

  const beforeLength = (promptHistoryOverridesCache || []).length;
  promptHistoryOverridesCache = (promptHistoryOverridesCache || []).filter(
    (override) =>
      !deleteSet.has(override.sourceContent) &&
      !(override.sourceSentPrompt && deleteSet.has(override.sourceSentPrompt))
  );
  if ((promptHistoryOverridesCache || []).length !== beforeLength) {
    savePromptHistoryOverrides();
    emitPromptStorageChange('metadata');
  }
}

export function setPromptHistoryOverride(
  sourceSentPrompt: string,
  override: {
    title?: string;
    sentPrompt?: string;
    tags?: string[];
    modelType?: PromptType;
  }
): PromptHistoryOverride | undefined {
  ensureCacheInitialized();
  const source = sourceSentPrompt.trim();
  if (!source) {
    return undefined;
  }

  const overrides = promptHistoryOverridesCache || [];
  const index = overrides.findIndex(
    (item) => item.sourceContent === source || item.sourceSentPrompt === source
  );
  const existing = index >= 0 ? overrides[index] : undefined;
  const content = (
    override.sentPrompt ||
    existing?.content ||
    existing?.sentPrompt ||
    source
  ).trim();
  if (!content) {
    return undefined;
  }

  const nextOverride: PromptHistoryOverride = {
    sourceContent: source,
    content: content.slice(0, 2000),
    title: override.title?.trim().slice(0, 80) || undefined,
    tags: normalizeHistoryOverrideTags(override.tags),
    modelType: override.modelType,
    updatedAt: Date.now(),
  };

  if (index >= 0) {
    overrides[index] = nextOverride;
  } else {
    overrides.unshift(nextOverride);
  }

  promptHistoryOverridesCache = overrides;
  savePromptHistoryOverrides();
  emitPromptStorageChange('metadata');
  return nextOverride;
}

export function setPromptContentEdited(
  sourceContents: string[],
  nextContent: string,
  modelType?: PromptType
): boolean {
  ensureCacheInitialized();
  const normalizedSources = Array.from(
    new Set(sourceContents.map((content) => content.trim()).filter(Boolean))
  );
  const normalizedNextContent = nextContent.trim();
  if (normalizedSources.length === 0 || !normalizedNextContent) {
    return false;
  }

  const shouldPinNext = normalizedSources.some(
    (source) =>
      isPromptContentPinned(source) ||
      isPromptContentPinned(resolvePromptContent(source))
  );

  for (const source of normalizedSources) {
    setPromptHistoryOverride(source, {
      sentPrompt: normalizedNextContent,
      modelType,
    });
    setPromptContentPinned(source, false, modelType);
  }

  if (shouldPinNext) {
    setPromptContentPinned(normalizedNextContent, true, modelType);
  }

  deletedPromptContentsCache = (deletedPromptContentsCache || []).filter(
    (content) => content !== normalizedNextContent
  );
  saveDeletedPromptContents();
  emitPromptStorageChange('metadata');
  return true;
}

// ============================================
// 视频描述历史记录功能（用于 AI 视频生成弹窗）
// ============================================

export interface VideoPromptHistoryItem {
  id: string;
  content: string;
  timestamp: number;
}

/**
 * 获取视频描述历史记录
 * 返回按时间倒序排列的列表
 */
export function getVideoPromptHistory(): VideoPromptHistoryItem[] {
  ensureCacheInitialized();
  const history = videoPromptHistoryCache || [];
  return [...history].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 添加视频描述到历史记录
 * 自动去重，新记录插入头部，限制最大数量
 */
export function addVideoPromptHistory(content: string): void {
  if (!content || !content.trim()) return;

  const trimmedContent = content.trim();
  ensureCacheInitialized();

  const history = videoPromptHistoryCache || [];

  // 检查是否已存在相同内容
  const existingIndex = history.findIndex(
    (item) => item.content === trimmedContent
  );

  if (existingIndex >= 0) {
    // 已存在：更新时间戳并移到最前面
    const existingItem = history[existingIndex];
    existingItem.timestamp = Date.now();
    history.splice(existingIndex, 1);
    history.unshift(existingItem);
    videoPromptHistoryCache = history;
    saveVideoPromptHistory();
    emitPromptStorageChange('history');
    return;
  }

  // 新记录插入头部
  const newItem: VideoPromptHistoryItem = {
    id: `video_prompt_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`,
    content: trimmedContent,
    timestamp: Date.now(),
  };
  history.unshift(newItem);

  // 不再限制最大数量，使用 IndexedDB 可存储无限条记录

  videoPromptHistoryCache = history;
  saveVideoPromptHistory();
  emitPromptStorageChange('history');
}

/**
 * 删除指定视频描述历史记录
 */
export function removeVideoPromptHistory(id: string): void {
  ensureCacheInitialized();
  videoPromptHistoryCache = (videoPromptHistoryCache || []).filter(
    (item) => item.id !== id
  );
  saveVideoPromptHistory();
  emitPromptStorageChange('delete');
}

/**
 * 获取视频描述历史记录的提示词列表（仅内容）
 */
export function getVideoPromptHistoryContents(): string[] {
  return getVideoPromptHistory()
    .map((item) => resolvePromptContent(item.content))
    .filter(Boolean);
}

/**
 * 合并远程视频提示词历史（用于云端同步）
 */
export function mergeVideoPromptHistory(
  remoteHistory: VideoPromptHistoryItem[]
): number {
  ensureCacheInitialized();
  const localHistory = videoPromptHistoryCache || [];
  const localContents = new Set(localHistory.map((item) => item.content));

  let addedCount = 0;
  for (const remoteItem of remoteHistory) {
    if (!localContents.has(remoteItem.content)) {
      localHistory.push(remoteItem);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    videoPromptHistoryCache = localHistory;
    saveVideoPromptHistory();
    emitPromptStorageChange('history');
  }

  return addedCount;
}

// ============================================
// 图片描述历史记录功能（用于 AI 图片生成弹窗）
// ============================================

export interface ImagePromptHistoryItem {
  id: string;
  content: string;
  timestamp: number;
}

/**
 * 获取图片描述历史记录
 * 返回按时间倒序排列的列表
 */
export function getImagePromptHistory(): ImagePromptHistoryItem[] {
  ensureCacheInitialized();
  const history = imagePromptHistoryCache || [];
  return [...history].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 添加图片描述到历史记录
 * 自动去重，新记录插入头部
 */
export function addImagePromptHistory(content: string): void {
  if (!content || !content.trim()) return;

  const trimmedContent = content.trim();
  ensureCacheInitialized();

  const history = imagePromptHistoryCache || [];

  // 检查是否已存在相同内容
  const existingIndex = history.findIndex(
    (item) => item.content === trimmedContent
  );

  if (existingIndex >= 0) {
    // 已存在：更新时间戳并移到最前面
    const existingItem = history[existingIndex];
    existingItem.timestamp = Date.now();
    history.splice(existingIndex, 1);
    history.unshift(existingItem);
    imagePromptHistoryCache = history;
    saveImagePromptHistory();
    emitPromptStorageChange('history');
    return;
  }

  // 新记录插入头部
  const newItem: ImagePromptHistoryItem = {
    id: `image_prompt_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`,
    content: trimmedContent,
    timestamp: Date.now(),
  };
  history.unshift(newItem);

  imagePromptHistoryCache = history;
  saveImagePromptHistory();
  emitPromptStorageChange('history');
}

/**
 * 删除指定图片描述历史记录
 */
export function removeImagePromptHistory(id: string): void {
  ensureCacheInitialized();
  imagePromptHistoryCache = (imagePromptHistoryCache || []).filter(
    (item) => item.id !== id
  );
  saveImagePromptHistory();
  emitPromptStorageChange('delete');
}

/**
 * 获取图片描述历史记录的提示词列表（仅内容）
 */
export function getImagePromptHistoryContents(): string[] {
  return getImagePromptHistory()
    .map((item) => resolvePromptContent(item.content))
    .filter(Boolean);
}

/**
 * 合并远程图片提示词历史（用于云端同步）
 */
export function mergeImagePromptHistory(
  remoteHistory: ImagePromptHistoryItem[]
): number {
  ensureCacheInitialized();
  const localHistory = imagePromptHistoryCache || [];
  const localContents = new Set(localHistory.map((item) => item.content));

  let addedCount = 0;
  for (const remoteItem of remoteHistory) {
    if (!localContents.has(remoteItem.content)) {
      localHistory.push(remoteItem);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    imagePromptHistoryCache = localHistory;
    saveImagePromptHistory();
    emitPromptStorageChange('history');
  }

  return addedCount;
}

// ============================================
// 预设提示词设置功能
// ============================================

function loadPresetData(): PresetStorageData {
  ensureCacheInitialized();
  return normalizePresetStorageData(presetDataCache);
}

/**
 * 获取指定类型的预设提示词设置
 */
function getPresetSettings(type: PromptType): PresetPromptSettings {
  const data = loadPresetData();
  return data[type] || createDefaultPresetSettings();
}

/**
 * 置顶预设提示词
 */
function pinPresetPrompt(type: PromptType, prompt: string): void {
  const data = loadPresetData();
  const settings = data[type];
  const content = resolvePromptContent(prompt);
  if (!content) {
    return;
  }

  // 如果已经置顶，先移除
  const index = settings.pinnedPrompts.indexOf(content);
  if (index > -1) {
    settings.pinnedPrompts.splice(index, 1);
  }

  // 添加到置顶列表最前面
  settings.pinnedPrompts.unshift(content);

  // 如果在删除列表中，移除
  const deletedIndex = settings.deletedPrompts.indexOf(content);
  if (deletedIndex > -1) {
    settings.deletedPrompts.splice(deletedIndex, 1);
  }

  presetDataCache = data;
  setPromptContentPinned(content, true, type);
  savePresetData();
}

/**
 * 取消置顶预设提示词
 */
function unpinPresetPrompt(type: PromptType, prompt: string): void {
  const data = loadPresetData();
  const settings = data[type];
  const content = resolvePromptContent(prompt);

  const index = settings.pinnedPrompts.indexOf(content);
  if (index > -1) {
    settings.pinnedPrompts.splice(index, 1);
    presetDataCache = data;
    savePresetData();
  }
  setPromptContentPinned(content, false, type);
}

/**
 * 检查预设提示词是否已置顶
 */
function isPresetPinned(_type: PromptType, prompt: string): boolean {
  const content = resolvePromptContent(prompt);
  return isPromptContentPinned(content);
}

/**
 * 删除预设提示词（从显示列表中隐藏）
 */
function deletePresetPrompt(type: PromptType, prompt: string): void {
  const data = loadPresetData();
  const settings = data[type];
  const content = resolvePromptContent(prompt);

  // 从置顶列表移除
  const pinnedIndex = settings.pinnedPrompts.indexOf(content);
  if (pinnedIndex > -1) {
    settings.pinnedPrompts.splice(pinnedIndex, 1);
  }

  // 添加到删除列表
  if (!settings.deletedPrompts.includes(content)) {
    settings.deletedPrompts.push(content);
  }

  presetDataCache = data;
  savePresetData();
  emitPromptStorageChange('delete');
}

/**
 * 对预设提示词列表进行排序（置顶的在前，已删除的过滤掉）
 */
function sortPresetPrompts(type: PromptType, prompts: string[]): string[] {
  const settings = getPresetSettings(type);

  // 过滤掉已删除的
  const filtered = prompts.filter((p) => {
    const content = resolvePromptContent(p);
    return (
      content &&
      !settings.deletedPrompts.includes(content) &&
      !isPromptContentDeleted(content)
    );
  });

  // 分离置顶和非置顶
  const pinned: string[] = [];
  const unpinned: string[] = [];

  for (const prompt of filtered) {
    if (isPresetPinned(type, prompt)) {
      pinned.push(prompt);
    } else {
      unpinned.push(prompt);
    }
  }

  // 按置顶顺序排序
  pinned.sort((a, b) => {
    const left = resolvePromptContent(a);
    const right = resolvePromptContent(b);
    const leftTypeIndex = settings.pinnedPrompts.indexOf(left);
    const rightTypeIndex = settings.pinnedPrompts.indexOf(right);
    if (leftTypeIndex >= 0 && rightTypeIndex >= 0) {
      return leftTypeIndex - rightTypeIndex;
    }
    if (leftTypeIndex >= 0) return -1;
    if (rightTypeIndex >= 0) return 1;
    const leftItem = (promptHistoryCache || []).find(
      (item) => item.content === left
    );
    const rightItem = (promptHistoryCache || []).find(
      (item) => item.content === right
    );
    return (rightItem?.timestamp || 0) - (leftItem?.timestamp || 0);
  });

  return [...pinned, ...unpinned];
}

/**
 * 导出 prompt storage service 对象
 */
export const promptStorageService = {
  // 初始化
  initCache: initPromptStorageCache,
  resetCache: resetPromptStorageCache,
  isInitialized: isPromptCacheInitialized,
  waitForInit: waitForPromptCacheInit,
  subscribeChanges: subscribePromptStorageChanges,
  getVersion: getPromptStorageVersion,

  // 历史记录功能（用于 AI 输入框）
  getHistory: getPromptHistory,
  addHistory: addPromptHistory,
  removeHistory: removePromptHistory,
  clearHistory: clearPromptHistory,
  clearGenerationHistory: clearGenerationPromptHistory,
  togglePin: togglePinPrompt,
  isContentPinned: isPromptContentPinned,
  setContentPinned: setPromptContentPinned,
  isContentDeleted: isPromptContentDeleted,
  deleteContents: deletePromptContents,
  getHistoryOverride: getPromptHistoryOverride,
  setHistoryOverride: setPromptHistoryOverride,
  resolveContent: resolvePromptContent,
  resolveMetadata: resolvePromptMetadata,
  resolvePromptMetadata,
  setContentEdited: setPromptContentEdited,
  deleteContentOverrides: deletePromptContentOverrides,

  // 预设提示词设置功能（用于 AI 图片/视频生成弹窗）
  getPresetSettings,
  pinPrompt: pinPresetPrompt,
  unpinPrompt: unpinPresetPrompt,
  isPinned: isPresetPinned,
  deletePrompt: deletePresetPrompt,
  sortPrompts: sortPresetPrompts,

  // 视频描述历史记录功能
  getVideoPromptHistory,
  addVideoPromptHistory,
  removeVideoPromptHistory,
  getVideoPromptHistoryContents,

  // 图片描述历史记录功能
  getImagePromptHistory,
  addImagePromptHistory,
  removeImagePromptHistory,
  getImagePromptHistoryContents,
};
