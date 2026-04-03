/**
 * Prompt Storage Service
 *
 * 管理用户历史提示词的存储
 * 使用 IndexedDB 进行持久化存储（通过 kvStorageService）
 * 支持从 LocalStorage 迁移的向下兼容
 */

import { LS_KEYS_TO_MIGRATE } from '../constants/storage-keys';
import { kvStorageService } from './kv-storage-service';
import { generateId } from '@aitu/utils';

const STORAGE_KEY = LS_KEYS_TO_MIGRATE.PROMPT_HISTORY;

// 预设提示词设置的存储 key
const PRESET_SETTINGS_KEY = LS_KEYS_TO_MIGRATE.PRESET_SETTINGS;

// 视频描述历史记录的存储 key
const VIDEO_PROMPT_HISTORY_KEY = LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY;

// 图片描述历史记录的存储 key
const IMAGE_PROMPT_HISTORY_KEY = LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY;

export interface PromptHistoryItem {
  id: string;
  content: string;
  timestamp: number;
  /** 是否在有选中元素时输入的 */
  hasSelection?: boolean;
  /** 是否置顶 */
  pinned?: boolean;
  /** 生成类型：image(直接生图)、video(直接生视频)、agent(需要Agent分析) */
  modelType?: 'image' | 'video' | 'audio' | 'agent';
}

/**
 * 生成唯一 ID
 */
function generatePromptId(): string {
  return generateId('prompt');
}

// ============================================
// 内存缓存（用于同步读取，异步更新）
// ============================================

let promptHistoryCache: PromptHistoryItem[] | null = null;
let videoPromptHistoryCache: VideoPromptHistoryItem[] | null = null;
let imagePromptHistoryCache: ImagePromptHistoryItem[] | null = null;
let presetDataCache: PresetStorageData | null = null;
let cacheInitialized = false;

/**
 * 初始化缓存（从 IndexedDB 加载数据）
 * 应在应用启动时调用
 */
export async function initPromptStorageCache(): Promise<void> {
  if (cacheInitialized) {
    return;
  }

  try {
    const [promptHistory, videoHistory, imageHistory, presetSettings] = await Promise.all([
      kvStorageService.get<PromptHistoryItem[]>(STORAGE_KEY),
      kvStorageService.get<VideoPromptHistoryItem[]>(VIDEO_PROMPT_HISTORY_KEY),
      kvStorageService.get<ImagePromptHistoryItem[]>(IMAGE_PROMPT_HISTORY_KEY),
      kvStorageService.get<PresetStorageData>(PRESET_SETTINGS_KEY),
    ]);

    promptHistoryCache = promptHistory || [];
    videoPromptHistoryCache = videoHistory || [];
    imagePromptHistoryCache = imageHistory || [];
    presetDataCache = presetSettings || {
      image: { pinnedPrompts: [], deletedPrompts: [] },
      video: { pinnedPrompts: [], deletedPrompts: [] },
    };

    cacheInitialized = true;
  } catch (error) {
    console.error('[PromptStorageService] Failed to initialize cache:', error);
    // 初始化为空数据
    promptHistoryCache = [];
    videoPromptHistoryCache = [];
    imagePromptHistoryCache = [];
    presetDataCache = {
      image: { pinnedPrompts: [], deletedPrompts: [] },
      video: { pinnedPrompts: [], deletedPrompts: [] },
    };
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
  await initPromptStorageCache();
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
    presetDataCache = presetDataCache || {
      image: { pinnedPrompts: [], deletedPrompts: [] },
      video: { pinnedPrompts: [], deletedPrompts: [] },
    };
  }
}

/**
 * 保存提示词历史到 IndexedDB（异步）
 */
function savePromptHistory(): void {
  if (promptHistoryCache === null) return;
  kvStorageService.set(STORAGE_KEY, promptHistoryCache).catch((error) => {
    console.error('[PromptStorageService] Failed to save prompt history:', error);
  });
}

/**
 * 保存图片提示词历史到 IndexedDB（异步）
 */
function saveImagePromptHistory(): void {
  if (imagePromptHistoryCache === null) return;
  kvStorageService.set(IMAGE_PROMPT_HISTORY_KEY, imagePromptHistoryCache).catch((error) => {
    console.error('[PromptStorageService] Failed to save image prompt history:', error);
  });
}

/**
 * 保存视频提示词历史到 IndexedDB（异步）
 */
function saveVideoPromptHistory(): void {
  if (videoPromptHistoryCache === null) return;
  kvStorageService.set(VIDEO_PROMPT_HISTORY_KEY, videoPromptHistoryCache).catch((error) => {
    console.error('[PromptStorageService] Failed to save video prompt history:', error);
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
 * @param modelType 生成类型：image、video 或 agent
 */
export function addPromptHistory(
  content: string,
  hasSelection?: boolean,
  modelType?: 'image' | 'video' | 'audio' | 'agent'
): void {
  if (!content || !content.trim()) return;

  const trimmedContent = content.trim();
  ensureCacheInitialized();

  let history = promptHistoryCache || [];

  // 检查是否已存在相同内容
  const existingIndex = history.findIndex((item) => item.content === trimmedContent);

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
}

/**
 * 删除指定历史提示词
 */
export function removePromptHistory(id: string): void {
  ensureCacheInitialized();
  promptHistoryCache = (promptHistoryCache || []).filter((item) => item.id !== id);
  savePromptHistory();
}

/**
 * 清空所有历史提示词
 */
export function clearPromptHistory(): void {
  promptHistoryCache = [];
  savePromptHistory();
}

/**
 * 合并远程提示词历史（用于云端同步）
 * 只添加本地不存在的记录，保留本地的置顶状态
 */
export function mergePromptHistory(remoteHistory: PromptHistoryItem[]): number {
  ensureCacheInitialized();
  const localHistory = promptHistoryCache || [];
  const localContents = new Set(localHistory.map(item => item.content));
  
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
  savePromptHistory();

  return item.pinned;
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

  let history = videoPromptHistoryCache || [];

  // 检查是否已存在相同内容
  const existingIndex = history.findIndex((item) => item.content === trimmedContent);

  if (existingIndex >= 0) {
    // 已存在：更新时间戳并移到最前面
    const existingItem = history[existingIndex];
    existingItem.timestamp = Date.now();
    history.splice(existingIndex, 1);
    history.unshift(existingItem);
    videoPromptHistoryCache = history;
    saveVideoPromptHistory();
    return;
  }

  // 新记录插入头部
  const newItem: VideoPromptHistoryItem = {
    id: `video_prompt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    content: trimmedContent,
    timestamp: Date.now(),
  };
  history.unshift(newItem);

  // 不再限制最大数量，使用 IndexedDB 可存储无限条记录

  videoPromptHistoryCache = history;
  saveVideoPromptHistory();
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
}

/**
 * 获取视频描述历史记录的提示词列表（仅内容）
 */
export function getVideoPromptHistoryContents(): string[] {
  return getVideoPromptHistory().map((item) => item.content);
}

/**
 * 合并远程视频提示词历史（用于云端同步）
 */
export function mergeVideoPromptHistory(remoteHistory: VideoPromptHistoryItem[]): number {
  ensureCacheInitialized();
  const localHistory = videoPromptHistoryCache || [];
  const localContents = new Set(localHistory.map(item => item.content));
  
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

  let history = imagePromptHistoryCache || [];

  // 检查是否已存在相同内容
  const existingIndex = history.findIndex((item) => item.content === trimmedContent);

  if (existingIndex >= 0) {
    // 已存在：更新时间戳并移到最前面
    const existingItem = history[existingIndex];
    existingItem.timestamp = Date.now();
    history.splice(existingIndex, 1);
    history.unshift(existingItem);
    imagePromptHistoryCache = history;
    saveImagePromptHistory();
    return;
  }

  // 新记录插入头部
  const newItem: ImagePromptHistoryItem = {
    id: `image_prompt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    content: trimmedContent,
    timestamp: Date.now(),
  };
  history.unshift(newItem);

  imagePromptHistoryCache = history;
  saveImagePromptHistory();
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
}

/**
 * 获取图片描述历史记录的提示词列表（仅内容）
 */
export function getImagePromptHistoryContents(): string[] {
  return getImagePromptHistory().map((item) => item.content);
}

/**
 * 合并远程图片提示词历史（用于云端同步）
 */
export function mergeImagePromptHistory(remoteHistory: ImagePromptHistoryItem[]): number {
  ensureCacheInitialized();
  const localHistory = imagePromptHistoryCache || [];
  const localContents = new Set(localHistory.map(item => item.content));
  
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
  }

  return addedCount;
}

// ============================================
// 预设提示词设置功能（用于 AI 图片/视频生成弹窗）
// ============================================

export interface PresetPromptSettings {
  /** 置顶的提示词列表（按置顶顺序排列） */
  pinnedPrompts: string[];
  /** 已删除的提示词列表 */
  deletedPrompts: string[];
}

export type PromptType = 'image' | 'video';

interface PresetStorageData {
  image: PresetPromptSettings;
  video: PresetPromptSettings;
}

const defaultPresetSettings: PresetPromptSettings = {
  pinnedPrompts: [],
  deletedPrompts: [],
};

function loadPresetData(): PresetStorageData {
  ensureCacheInitialized();
  return (
    presetDataCache || {
      image: { ...defaultPresetSettings },
      video: { ...defaultPresetSettings },
    }
  );
}

/**
 * 获取指定类型的预设提示词设置
 */
function getPresetSettings(type: PromptType): PresetPromptSettings {
  const data = loadPresetData();
  return data[type] || { ...defaultPresetSettings };
}

/**
 * 置顶预设提示词
 */
function pinPresetPrompt(type: PromptType, prompt: string): void {
  const data = loadPresetData();
  const settings = data[type];

  // 如果已经置顶，先移除
  const index = settings.pinnedPrompts.indexOf(prompt);
  if (index > -1) {
    settings.pinnedPrompts.splice(index, 1);
  }

  // 添加到置顶列表最前面
  settings.pinnedPrompts.unshift(prompt);

  // 如果在删除列表中，移除
  const deletedIndex = settings.deletedPrompts.indexOf(prompt);
  if (deletedIndex > -1) {
    settings.deletedPrompts.splice(deletedIndex, 1);
  }

  presetDataCache = data;
  savePresetData();
}

/**
 * 取消置顶预设提示词
 */
function unpinPresetPrompt(type: PromptType, prompt: string): void {
  const data = loadPresetData();
  const settings = data[type];

  const index = settings.pinnedPrompts.indexOf(prompt);
  if (index > -1) {
    settings.pinnedPrompts.splice(index, 1);
    presetDataCache = data;
    savePresetData();
  }
}

/**
 * 检查预设提示词是否已置顶
 */
function isPresetPinned(type: PromptType, prompt: string): boolean {
  const settings = getPresetSettings(type);
  return settings.pinnedPrompts.includes(prompt);
}

/**
 * 删除预设提示词（从显示列表中隐藏）
 */
function deletePresetPrompt(type: PromptType, prompt: string): void {
  const data = loadPresetData();
  const settings = data[type];

  // 从置顶列表移除
  const pinnedIndex = settings.pinnedPrompts.indexOf(prompt);
  if (pinnedIndex > -1) {
    settings.pinnedPrompts.splice(pinnedIndex, 1);
  }

  // 添加到删除列表
  if (!settings.deletedPrompts.includes(prompt)) {
    settings.deletedPrompts.push(prompt);
  }

  presetDataCache = data;
  savePresetData();
}

/**
 * 对预设提示词列表进行排序（置顶的在前，已删除的过滤掉）
 */
function sortPresetPrompts(type: PromptType, prompts: string[]): string[] {
  const settings = getPresetSettings(type);

  // 过滤掉已删除的
  const filtered = prompts.filter((p) => !settings.deletedPrompts.includes(p));

  // 分离置顶和非置顶
  const pinned: string[] = [];
  const unpinned: string[] = [];

  for (const prompt of filtered) {
    if (settings.pinnedPrompts.includes(prompt)) {
      pinned.push(prompt);
    } else {
      unpinned.push(prompt);
    }
  }

  // 按置顶顺序排序
  pinned.sort((a, b) => {
    return settings.pinnedPrompts.indexOf(a) - settings.pinnedPrompts.indexOf(b);
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

  // 历史记录功能（用于 AI 输入框）
  getHistory: getPromptHistory,
  addHistory: addPromptHistory,
  removeHistory: removePromptHistory,
  clearHistory: clearPromptHistory,
  togglePin: togglePinPrompt,

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
};
