/**
 * GitHub Gist 同步服务类型定义
 */

import type { Folder, BoardMetadata, Board } from '../../types/workspace.types';
import type { PromptHistoryItem, VideoPromptHistoryItem, ImagePromptHistoryItem } from '../prompt-storage-service';
import type { Task } from '../../types/task.types';
import type { KBExportData } from '../kb-import-export-service';

// ====================================
// 同步状态
// ====================================

/** 同步状态枚举 */
export type SyncStatus =
  | 'not_configured'    // 未配置 Token
  | 'synced'            // 已同步
  | 'local_changes'     // 本地有变更待上传
  | 'remote_changes'    // 远程有变更待下载
  | 'syncing'           // 同步中
  | 'conflict'          // 有冲突
  | 'error';            // 错误

/** 媒体同步状态 */
export type MediaSyncStatus =
  | 'not_synced'        // 未同步
  | 'synced'            // 已同步
  | 'syncing'           // 同步中
  | 'too_large'         // 文件过大
  | 'error';            // 错误

/** 媒体资源来源 */
export type MediaSource = 'local' | 'external';

/** 媒体资源优先级 */
export type MediaPriority = 
  | 'current_board_local_image'    // 当前画布-本地图片
  | 'current_board_local_video'    // 当前画布-本地视频
  | 'current_board_url_image'      // 当前画布-URL图片
  | 'current_board_url_video'      // 当前画布-URL视频
  | 'other_local_image'            // 其他-本地图片
  | 'other_local_video'            // 其他-本地视频
  | 'other_url_image'              // 其他-URL图片
  | 'other_url_video';             // 其他-URL视频

/** 媒体资源项 */
export interface MediaItem {
  /** 媒体 URL（唯一标识） */
  url: string;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 资源来源 */
  source: MediaSource;
  /** 原始外部 URL（仅 external 类型有效） */
  originalUrl?: string;
  /** 所属画板 ID 列表 */
  boardIds: string[];
  /** 是否在当前画布中使用 */
  isCurrentBoard: boolean;
  /** 同步优先级 */
  priority: MediaPriority;
  /** MIME 类型 */
  mimeType?: string;
  /** 文件大小（字节） */
  size?: number;
}

/** 收集到的媒体资源 */
export interface CollectedMedia {
  /** 所有媒体项 */
  items: MediaItem[];
  /** 当前画布中的媒体项（按优先级排序） */
  currentBoardItems: MediaItem[];
  /** 其他画布中的媒体项 */
  otherItems: MediaItem[];
  /** 统计信息 */
  stats: {
    total: number;
    currentBoard: number;
    localImages: number;
    localVideos: number;
    urlImages: number;
    urlVideos: number;
  };
}

/** 媒体同步进度回调 */
export type MediaSyncProgressCallback = (
  current: number, 
  total: number, 
  url: string,
  status: 'uploading' | 'downloading' | 'caching'
) => void;

// ====================================
// Gist 文件结构
// ====================================

/** 同步清单 - manifest.json */
export interface SyncManifest {
  /** 同步格式版本 */
  version: number;
  /** 应用版本 */
  appVersion: string;
  /** 首次同步时间 */
  createdAt: number;
  /** 最后同步时间 */
  updatedAt: number;
  /** 当前设备标识 */
  deviceId: string;
  /** 所有同步过的设备 */
  devices: Record<string, DeviceInfo>;
  /** 画板索引 */
  boards: Record<string, BoardSyncInfo>;
  /** 已删除的提示词记录 */
  deletedPrompts?: PromptTombstone[];
  /** 已删除的任务记录 */
  deletedTasks?: TaskTombstone[];
}

/** 提示词删除记录 (Tombstone) */
export interface PromptTombstone {
  /** 提示词唯一标识（使用 createdAt 时间戳字符串） */
  id: string;
  /** 提示词类型 */
  type: 'prompt' | 'videoPrompt' | 'imagePrompt';
  /** 提示词内容（用于显示） */
  content?: string;
  /** 删除时间戳 */
  deletedAt: number;
  /** 删除操作的设备 ID */
  deletedBy: string;
}

/** 任务删除记录 (Tombstone) */
export interface TaskTombstone {
  /** 任务 ID */
  taskId: string;
  /** 任务名称（用于显示） */
  name?: string;
  /** 删除时间戳 */
  deletedAt: number;
  /** 删除操作的设备 ID */
  deletedBy: string;
}

/** 设备信息 */
export interface DeviceInfo {
  /** 设备名称 */
  name: string;
  /** 最后同步时间 */
  lastSyncTime: number;
}

/** 画板同步信息 */
export interface BoardSyncInfo {
  /** 画板名称 */
  name: string;
  /** 更新时间 */
  updatedAt: number;
  /** 内容校验和 */
  checksum: string;
  /** 删除时间戳（软删除标记） */
  deletedAt?: number;
  /** 删除操作的设备 ID */
  deletedBy?: string;
}

/** 工作区数据 - workspace.json */
export interface WorkspaceData {
  /** 文件夹列表 */
  folders: Folder[];
  /** 画板元数据（不含 elements） */
  boardMetadata: BoardMetadata[];
  /** 当前打开的画板 ID */
  currentBoardId: string | null;
  /** 展开的文件夹 ID 列表 */
  expandedFolders: string[];
}

/** 画板数据 - board_{id}.json */
export interface BoardData extends Board {
  // 继承 Board 的所有字段
}

/** 提示词数据 - prompts.json */
export interface PromptsData {
  /** 通用提示词历史 */
  promptHistory: PromptHistoryItem[];
  /** 视频提示词历史 */
  videoPromptHistory: VideoPromptHistoryItem[];
  /** 图片提示词历史 */
  imagePromptHistory: ImagePromptHistoryItem[];
}

/** 任务数据 - tasks.json (旧格式，用于向后兼容) */
export interface TasksData {
  /** 已完成的任务列表 */
  completedTasks: Task[];
}

/** 知识库数据 - knowledge-base.json */
export type KnowledgeBaseData = KBExportData;

// ====================================
// 任务分页同步类型 (新格式)
// ====================================

/** 分页同步版本号 */
export const PAGED_SYNC_VERSION = 1;

/** 分页同步配置 */
export const PAGED_SYNC_CONFIG = {
  /** 每页最多任务数 */
  MAX_TASKS_PER_PAGE: 50,
  /** 每页最大大小（5MB） */
  MAX_PAGE_SIZE: 5 * 1024 * 1024,
  /** 每页最多工作流数 */
  MAX_WORKFLOWS_PER_PAGE: 20,
  /** 提示词预览截断长度 */
  PROMPT_PREVIEW_LENGTH: 100,
} as const;

/** 任务索引 - task-index.json */
export interface TaskIndex {
  /** 版本号 */
  version: number;
  /** 更新时间 */
  updatedAt: number;
  /** 分页信息 */
  pages: TaskPageInfo[];
  /** 任务索引项（轻量元数据） */
  items: TaskIndexItem[];
}

/** 任务分页信息 */
export interface TaskPageInfo {
  /** 分页 ID */
  pageId: number;
  /** 文件名 */
  filename: string;
  /** 任务数量 */
  itemCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 任务索引项（轻量元数据，用于增量同步判断） */
export interface TaskIndexItem {
  /** 任务 ID */
  id: string;
  /** 任务类型 */
  type: string;
  /** 任务状态 */
  status: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 同步版本号（内容变更时递增，用于增量同步） */
  syncVersion: number;
  /** 所在分页 ID */
  pageId: number;
  /** 提示词预览（截断） */
  promptPreview?: string;
  /** 结果缩略图 URL */
  thumbnailUrl?: string;
}

/** 任务详情分页 - tasks_p{n}.json */
export interface TaskPage {
  /** 分页 ID */
  pageId: number;
  /** 更新时间 */
  updatedAt: number;
  /** 精简的任务列表 */
  tasks: CompactTask[];
}

/** 精简的任务结构（省略大字段） */
export interface CompactTask {
  /** 任务 ID */
  id: string;
  /** 任务类型 */
  type: string;
  /** 任务状态 */
  status: string;
  /** 生成参数（省略大字段） */
  params: CompactGenerationParams;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 精简的结果 */
  result?: CompactTaskResult;
  /** 精简的错误信息 */
  error?: CompactTaskError;
  /** 进度 */
  progress?: number;
  /** 远程任务 ID */
  remoteId?: string;
  /** 执行阶段 */
  executionPhase?: string;
  /** 是否已保存到媒体库 */
  savedToLibrary?: boolean;
  /** 是否已插入画布 */
  insertedToCanvas?: boolean;
  /** 同步版本号 */
  syncVersion: number;
}

/** 精简的生成参数（省略大字段） */
export interface CompactGenerationParams {
  /** 提示词（可能被截断） */
  prompt: string;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  /** 尺寸 */
  size?: string;
  /** 时长 */
  duration?: number;
  /** 风格 */
  style?: string;
  /** 模型 */
  model?: string;
  /** 是否自动插入画布 */
  autoInsertToCanvas?: boolean;
  /** 其他非大字段参数 */
  [key: string]: unknown;
}

/** 精简的任务结果（省略大字段：chatResponse, toolCalls） */
export interface CompactTaskResult {
  /** 结果 URL */
  url?: string;
  /** 多结果 URL */
  urls?: string[];
  /** 格式 */
  format?: string;
  /** 大小 */
  size?: number;
  /** 结果类型 */
  resultKind?: 'image' | 'video' | 'audio' | 'lyrics' | 'character' | 'chat';
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  /** 时长 */
  duration?: number;
  /** 缩略图 URL */
  thumbnailUrl?: string;
  /** 音频封面图 URL */
  previewImageUrl?: string;
  /** 音频标题 */
  title?: string;
  /** 歌词正文 */
  lyricsText?: string;
  /** 歌词标题 */
  lyricsTitle?: string;
  /** 歌词标签 */
  lyricsTags?: string[];
  /** Provider task ID */
  providerTaskId?: string;
  /** 主音频 clip ID */
  primaryClipId?: string;
  /** 有序 clip ID 列表 */
  clipIds?: string[];
  /** 角色用户名 */
  characterUsername?: string;
  /** 角色头像 URL */
  characterProfileUrl?: string;
  /** 角色永久链接 */
  characterPermalink?: string;
  /** 注意：省略 chatResponse 和 toolCalls 大字段 */
}

/** 精简的任务错误（省略 details.apiResponse） */
export interface CompactTaskError {
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 注意：省略 details 大字段 */
}

// ====================================
// 工作流分页同步类型
// ====================================

/** 工作流状态类型 */
export type WorkflowSyncStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 工作流索引 - workflow-index.json */
export interface WorkflowIndex {
  /** 版本号 */
  version: number;
  /** 更新时间 */
  updatedAt: number;
  /** 分页信息 */
  pages: WorkflowPageInfo[];
  /** 工作流索引项（轻量元数据） */
  items: WorkflowIndexItem[];
}

/** 工作流分页信息 */
export interface WorkflowPageInfo {
  /** 分页 ID */
  pageId: number;
  /** 文件名 */
  filename: string;
  /** 工作流数量 */
  itemCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 更新时间 */
  updatedAt: number;
}

/** 工作流索引项（轻量元数据） */
export interface WorkflowIndexItem {
  /** 工作流 ID */
  id: string;
  /** 工作流状态 */
  status: WorkflowSyncStatus;
  /** 步骤数量 */
  stepCount: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 同步版本号 */
  syncVersion: number;
  /** 所在分页 ID */
  pageId: number;
  /** 用户输入预览 */
  userInputPreview?: string;
}

/** 工作流详情分页 - workflows_p{n}.json */
export interface WorkflowPage {
  /** 分页 ID */
  pageId: number;
  /** 更新时间 */
  updatedAt: number;
  /** 精简的工作流列表 */
  workflows: CompactWorkflow[];
}

/** 精简的工作流结构 */
export interface CompactWorkflow {
  /** 工作流 ID */
  id: string;
  /** 精简的步骤列表 */
  steps: CompactWorkflowStep[];
  /** 工作流状态 */
  status: WorkflowSyncStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 错误信息 */
  error?: string;
  /** 精简的上下文 */
  context?: CompactWorkflowContext;
  /** 发起画板 ID */
  initiatorBoardId?: string;
  /** 同步版本号 */
  syncVersion: number;
}

/** 精简的工作流步骤 */
export interface CompactWorkflowStep {
  /** 步骤 ID */
  id: string;
  /** MCP 工具名 */
  mcp: string;
  /** 描述 */
  description: string;
  /** 步骤状态 */
  status: string;
  /** 精简的结果 */
  result?: CompactWorkflowStepResult;
  /** 错误信息 */
  error?: string;
  /** 执行时长 */
  duration?: number;
  /** 依赖步骤 */
  dependsOn?: string[];
  /** 注意：省略 args 大字段 */
}

/** 精简的工作流步骤结果 */
export interface CompactWorkflowStepResult {
  /** 是否成功 */
  success: boolean;
  /** 结果类型 */
  type: 'image' | 'video' | 'text' | 'canvas' | 'error';
  /** 精简的数据 */
  data?: {
    /** URL */
    url?: string;
    /** 任务 ID */
    taskId?: string;
    /** 多个任务 ID */
    taskIds?: string[];
    /** 注意：省略 content 等大字段 */
  };
  /** 错误信息 */
  error?: string;
}

/** 精简的工作流上下文 */
export interface CompactWorkflowContext {
  /** 用户输入（可能被截断） */
  userInput?: string;
  /** 模型 */
  model?: string;
  /** 参数 */
  params?: {
    count?: number;
    size?: string;
    duration?: string;
  };
  /** 文本模型 */
  textModel?: string;
  /** 注意：省略 selection, referenceImages 等大字段 */
}

// ====================================
// 分页同步辅助类型
// ====================================

/** 任务同步变更 */
export interface TaskSyncChanges {
  /** 需要上传的任务 ID */
  toUpload: string[];
  /** 需要下载的任务 ID */
  toDownload: string[];
  /** 需要上传的分页 ID */
  pagesToUpload: number[];
  /** 需要下载的分页 ID */
  pagesToDownload: number[];
  /** 跳过的任务 ID（终态且未变更） */
  skipped: string[];
}

/** 工作流同步变更 */
export interface WorkflowSyncChanges {
  /** 需要上传的工作流 ID */
  toUpload: string[];
  /** 需要下载的工作流 ID */
  toDownload: string[];
  /** 需要上传的分页 ID */
  pagesToUpload: number[];
  /** 需要下载的分页 ID */
  pagesToDownload: number[];
  /** 跳过的工作流 ID */
  skipped: string[];
}

/** 分页同步结果 */
export interface PagedSyncResult {
  /** 是否成功 */
  success: boolean;
  /** 上传的任务数 */
  tasksUploaded: number;
  /** 下载的任务数 */
  tasksDownloaded: number;
  /** 上传的工作流数 */
  workflowsUploaded: number;
  /** 下载的工作流数 */
  workflowsDownloaded: number;
  /** 跳过的任务数（终态未变更） */
  tasksSkipped: number;
  /** 跳过的工作流数 */
  workflowsSkipped: number;
  /** 错误信息 */
  error?: string;
}

/** 任务同步格式类型（只支持分页格式） */
export type TaskSyncFormat = 'paged' | 'none';

/** 检测任务同步格式 */
export function detectTaskSyncFormat(files: Record<string, string>): TaskSyncFormat {
  if (files[SYNC_FILES_PAGED.TASK_INDEX]) return 'paged';
  return 'none';
}

/** 同步的媒体文件 - media_{base64url}.json（基于 URL） */
export interface SyncedMediaFile {
  /** 媒体 URL（主键） */
  url: string;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 资源来源 */
  source: MediaSource;
  /** MIME 类型 */
  mimeType: string;
  /** 原始文件大小 */
  size: number;
  /** Base64 编码的媒体数据 */
  base64Data: string;
  /** 同步时间 */
  syncedAt: number;
  /** 同步来源设备 */
  syncedFromDevice: string;
  /** 原始外部 URL（仅 external 类型有效，用于恢复时重新下载） */
  originalUrl?: string;
}

// ====================================
// 同步操作结果
// ====================================

/** 同步结果 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean;
  /** 上传的项目数量 */
  uploaded: {
    boards: number;
    prompts: number;
    tasks: number;
    media: number;
    knowledgeBase: number;
  };
  /** 下载的项目数量 */
  downloaded: {
    boards: number;
    prompts: number;
    tasks: number;
    media: number;
    knowledgeBase: number;
  };
  /** 删除的项目数量（本地删除，远程标记 tombstone） */
  deleted?: {
    boards: number;
    prompts: number;
    tasks: number;
    media: number;
  };
  /** 冲突项 */
  conflicts: ConflictItem[];
  /** 安全警告（需要用户确认） */
  safetyWarnings?: SyncWarning[];
  /** 被安全保护跳过的项目 */
  skippedItems?: SkippedItem[];
  /** 错误信息 */
  error?: string;
  /** 是否需要输入密码（解密失败时） */
  needsPassword?: boolean;
  /** 同步耗时（毫秒） */
  duration: number;
  /** 远程当前画板 ID */
  remoteCurrentBoardId?: string | null;
}

/** 冲突项 */
export interface ConflictItem {
  /** 冲突类型 */
  type: 'board' | 'prompt' | 'task';
  /** 项目 ID */
  id: string;
  /** 项目名称 */
  name: string;
  /** 本地版本时间 */
  localUpdatedAt: number;
  /** 远程版本时间 */
  remoteUpdatedAt: number;
  /** 是否已自动合并 */
  merged?: boolean;
  /** 合并信息 */
  mergeInfo?: {
    /** 从本地添加的元素数 */
    addedFromLocal: number;
    /** 从远程添加的元素数 */
    addedFromRemote: number;
    /** 冲突的元素数（使用本地版本） */
    conflictingElements: number;
  };
}

/** 冲突解决策略 */
export type ConflictResolution = 
  | 'use_local'     // 使用本地版本
  | 'use_remote'    // 使用远程版本
  | 'use_newer'     // 使用更新时间更晚的版本（默认）
  | 'keep_both';    // 保留两个版本（创建副本）

/** 单个媒体项同步结果 */
export interface MediaItemSyncResult {
  /** 是否成功 */
  success: boolean;
  /** 媒体 URL */
  url: string;
  /** 错误信息 */
  error?: string;
  /** 文件大小 */
  size?: number;
}

/** 批量媒体同步结果 */
export interface BatchMediaItemSyncResult {
  /** 成功数量 */
  succeeded: number;
  /** 失败数量 */
  failed: number;
  /** 跳过数量（文件过大、已同步、CORS 限制等） */
  skipped: number;
  /** 详细结果 */
  results: MediaItemSyncResult[];
  /** 总大小（字节） */
  totalSize: number;
  /** 耗时（毫秒） */
  duration: number;
}

// ====================================
// 变更检测
// ====================================

/** 变更集 */
export interface ChangeSet {
  /** 新增的画板 */
  addedBoards: string[];
  /** 修改的画板 */
  modifiedBoards: string[];
  /** 删除的画板 */
  deletedBoards: string[];
  /** 提示词是否有变更 */
  promptsChanged: boolean;
  /** 任务是否有变更 */
  tasksChanged: boolean;
  /** 已删除的提示词 ID 列表 */
  deletedPromptIds?: string[];
  /** 已删除的任务 ID 列表 */
  deletedTaskIds?: string[];
}

// ====================================
// 数据安全保护
// ====================================

/** 同步安全检查结果 */
export interface SyncSafetyCheck {
  /** 是否通过安全检查 */
  passed: boolean;
  /** 需要用户确认的警告 */
  warnings: SyncWarning[];
  /** 被保护跳过的项目 */
  skippedItems: SkippedItem[];
  /** 阻止执行的原因（严重错误） */
  blockedReason?: string;
}

/** 同步警告 */
export interface SyncWarning {
  /** 警告类型 */
  type: 'bulk_delete' | 'delete_current' | 'delete_all';
  /** 警告消息 */
  message: string;
  /** 受影响的项目 */
  affectedItems: Array<{ id: string; name: string }>;
}

/** 被跳过的项目 */
export interface SkippedItem {
  /** 项目 ID */
  id: string;
  /** 项目名称 */
  name: string;
  /** 跳过原因 */
  reason: 'current_board' | 'new_device' | 'local_newer';
  /** 本地更新时间（当 reason 为 'local_newer' 时有效） */
  localUpdatedAt?: number;
  /** 远程更新时间（当 reason 为 'local_newer' 时有效） */
  remoteUpdatedAt?: number;
}

/** 回收站中的已删除项目 */
export interface DeletedItems {
  /** 已删除的画板 */
  boards: Array<{
    id: string;
    name: string;
    deletedAt: number;
    deletedBy: string;
  }>;
  /** 已删除的提示词 */
  prompts: PromptTombstone[];
  /** 已删除的任务 */
  tasks: TaskTombstone[];
}

// ====================================
// GitHub API 相关
// ====================================

/** Gist 文件内容 */
export interface GistFile {
  filename: string;
  content: string;
  truncated?: boolean;
  raw_url?: string;
}

/** Gist 响应 */
export interface GistResponse {
  id: string;
  url: string;
  html_url: string;
  description: string;
  public: boolean;
  files: Record<string, GistFile>;
  created_at: string;
  updated_at: string;
}

/** 创建 Gist 请求 */
export interface CreateGistRequest {
  description: string;
  public: boolean;
  files: Record<string, { content: string }>;
}

/** 更新 Gist 请求 */
export interface UpdateGistRequest {
  description?: string;
  files: Record<string, { content: string } | null>;
}

// ====================================
// 同步配置
// ====================================

/** 同步配置 */
export interface SyncConfig {
  /** 是否启用同步 */
  enabled: boolean;
  /** 是否启用自动同步 */
  autoSync: boolean;
  /** 自动同步防抖时间（毫秒） */
  autoSyncDebounceMs: number;
  /** Gist ID */
  gistId: string | null;
  /** 最后同步时间 */
  lastSyncTime: number | null;
  /** 最后同步的设备 ID */
  lastSyncDeviceId: string | null;
}

/** 默认同步配置 */
export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  autoSync: true,
  autoSyncDebounceMs: 30000, // 30 秒
  gistId: null,
  lastSyncTime: null,
  lastSyncDeviceId: null,
};

// ====================================
// 常量
// ====================================

/** 同步版本号 */
export const SYNC_VERSION = 1;

/** Gist 描述 */
export const GIST_DESCRIPTION = 'Opentu - 数据同步';

/** 文件名常量 */
export const SYNC_FILES = {
  MANIFEST: 'manifest.json',
  WORKSPACE: 'workspace.json',
  PROMPTS: 'prompts.json',
  // 注意：tasks.json 已废弃，改用分页格式 (task-index.json + tasks_p{n}.json)
  SETTINGS: 'settings.json',
  CUSTOM_TOOLS: 'custom-tools.json',
  KNOWLEDGE_BASE: 'knowledge-base.json',
  boardFile: (id: string) => `board_${id}.json`,
  /** 基于 URL 的媒体文件名（使用 hash 编码，固定长度） */
  mediaFile: (url: string) => `media_${encodeUrlToFilename(url)}.json`,
  /** 从文件名解码回 URL（hash 不可逆，需从 manifest 查找，此方法返回 null） */
  urlFromMediaFile: (filename: string) => decodeFilenameToUrl(filename),
  /** 判断是否是媒体文件 */
  isMediaFile: (filename: string) => filename.startsWith('media_') && filename.endsWith('.json'),
} as const;

/** 分页同步文件名常量 */
export const SYNC_FILES_PAGED = {
  /** 任务索引文件 */
  TASK_INDEX: 'task-index.json',
  /** 任务详情分页文件 */
  taskPageFile: (pageId: number) => `tasks_p${pageId}.json`,
  /** 判断是否是任务分页文件 */
  isTaskPageFile: (filename: string) => /^tasks_p\d+\.json$/.test(filename),
  /** 从文件名提取任务分页 ID */
  getTaskPageId: (filename: string) => {
    const match = filename.match(/^tasks_p(\d+)\.json$/);
    return match ? parseInt(match[1], 10) : null;
  },
  /** 工作流索引文件 */
  WORKFLOW_INDEX: 'workflow-index.json',
  /** 工作流详情分页文件 */
  workflowPageFile: (pageId: number) => `workflows_p${pageId}.json`,
  /** 判断是否是工作流分页文件 */
  isWorkflowPageFile: (filename: string) => /^workflows_p\d+\.json$/.test(filename),
  /** 从文件名提取工作流分页 ID */
  getWorkflowPageId: (filename: string) => {
    const match = filename.match(/^workflows_p(\d+)\.json$/);
    return match ? parseInt(match[1], 10) : null;
  },
} as const;

/**
 * 简单的字符串 hash 函数（用于生成固定长度的文件名）
 * 使用 FNV-1a 算法的变体，生成 32 位 hex 字符串
 */
function simpleHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  
  // 返回 16 位 hex 字符串（64 位 hash 的一部分）
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

/**
 * 将 URL 编码为安全的文件名
 * 使用 hash 生成固定长度的文件名（避免 Base64 导致的文件名过长问题）
 * 
 * 注意：hash 是单向的，URL 需要从 shard-manifest.json 中恢复
 */
export function encodeUrlToFilename(url: string): string {
  // 使用 hash 生成固定长度的文件名（16 个 hex 字符）
  return simpleHash(url);
}

/**
 * 从文件名解码回 URL
 * 
 * 注意：由于使用 hash，此函数不再能直接解码。
 * URL 应从 shard-manifest.json 或 fileIndex 中查找。
 * 此函数仅用于兼容性，返回 null 表示需要从 manifest 查找。
 */
export function decodeFilenameToUrl(_filename: string): string | null {
  // Hash 是单向的，无法直接解码
  // URL 需要从 shard-manifest.json 或 MasterIndex.fileIndex 中查找
  return null;
}

/** 媒体文件大小限制（50MB） */
export const MAX_MEDIA_SIZE = 50 * 1024 * 1024;

/** GitHub API 基础 URL */
export const GITHUB_API_BASE = 'https://api.github.com';

// ====================================
// 分片系统重导出
// ====================================

// 重导出分片类型（用于外部模块使用）
export type {
  MasterIndex,
  ShardInfo,
  ShardManifest,
  FileIndexEntry,
  MediaTombstone,
  ShardStats,
  ShardSyncResult,
  ShardSyncDetail,
  MigrationResult,
} from './shard-types';

export {
  SHARD_CONFIG,
  SHARD_FILES,
  SHARD_VERSION,
  GIST_DESCRIPTION_PREFIX,
} from './shard-types';
