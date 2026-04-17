/**
 * Asset Types and Interfaces
 * 素材类型和接口定义
 *
 * This file contains all type definitions for the media library feature.
 * Based on data-model.md specifications.
 */

/**
 * Asset Type Enum
 * 素材类型枚举
 */
export enum AssetType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  AUDIO = 'AUDIO',
}

/**
 * Asset Source Enum
 * 素材来源枚举
 */
export enum AssetSource {
  LOCAL = 'LOCAL', // 本地上传
  AI_GENERATED = 'AI_GENERATED', // AI生成
}

/**
 * Asset Interface
 * 素材接口 - 运行时使用的数据结构
 */
export interface Asset {
  // 标识
  id: string; // UUID v4

  // 分类
  type: AssetType; // 素材类型
  source: AssetSource; // 素材来源

  // 内容
  url: string; // Blob URL for display
  name: string; // 用户可见名称
  mimeType: string; // MIME类型 (image/jpeg, video/mp4, etc.)

  // 元数据
  createdAt: number; // Unix timestamp (ms)
  size?: number; // 文件大小（字节），可选
  contentHash?: string; // 文件内容哈希，用于本地去重
  dedupeAssetIds?: string[]; // 去重组内的本地素材 ID（仅本地来源）
  dedupeUrls?: string[]; // 去重组内的缓存 URL（仅本地来源）

  // 可选扩展
  thumbnail?: string; // 缩略图URL（视频用）
  prompt?: string; // AI生成的提示词（仅AI_GENERATED）
  modelName?: string; // 生成模型名称（仅AI_GENERATED）
  taskId?: string; // 来源任务 ID（仅运行时 AI 生成素材）
  duration?: number; // 音频/视频时长（秒）
  clipId?: string; // 音频片段 ID（仅 AI 音频）
  providerTaskId?: string; // 供应商任务 ID（仅 AI 音频）
}

/**
 * Stored Asset Interface
 * 存储的素材接口 - IndexedDB中的数据结构
 * 支持本地上传和 AI 生成的素材
 */
export interface StoredAsset {
  id: string;
  type: AssetType;
  source: AssetSource;
  url: string; // 统一缓存中的 URL
  name: string;
  mimeType: string;
  createdAt: number;
  size?: number;
  contentHash?: string; // 文件内容哈希，用于去重
  prompt?: string; // AI 生成的提示词（仅 AI_GENERATED）
  modelName?: string; // 生成模型名称（仅 AI_GENERATED）
}

/**
 * Legacy Stored Asset Interface
 * 旧版存储的素材接口 - 用于数据迁移
 */
export interface LegacyStoredAsset {
  id: string;
  type: AssetType;
  source: AssetSource;
  name: string;
  mimeType: string;
  createdAt: number;
  size?: number;
  prompt?: string;
  modelName?: string;
  blobData: Blob; // 旧版存储的 Blob 数据
}

/**
 * Add Asset Data Interface
 * 添加素材时的数据接口
 */
export interface AddAssetData {
  type: AssetType;
  source: AssetSource;
  name: string;
  blob: Blob;
  mimeType: string;
  prompt?: string;
  modelName?: string;
}

/**
 * Asset Type Filter
 * 素材类型筛选器
 */
export type AssetTypeFilter = 'ALL' | AssetType;

/**
 * Asset Source Filter
 * 素材来源筛选器
 */
export type AssetSourceFilter = 'ALL' | AssetSource;

/**
 * Sort Option
 * 排序选项
 */
export type SortOption = 'DATE_DESC' | 'DATE_ASC' | 'NAME_ASC' | 'NAME_DESC' | 'SIZE_ASC' | 'SIZE_DESC';

/**
 * View Mode
 * 视图模式
 */
export type ViewMode = 'grid' | 'compact' | 'list';

/**
 * Filter State Interface
 * 筛选状态接口
 */
export interface FilterState {
  activeType: AssetTypeFilter; // 类型筛选
  activeSource: AssetSourceFilter; // 来源筛选
  searchQuery: string; // 搜索关键词
  sortBy: SortOption; // 排序方式
}

/**
 * Default Filter State
 * 默认筛选状态
 */
export const DEFAULT_FILTER_STATE: FilterState = {
  activeType: 'ALL',
  activeSource: 'ALL',
  searchQuery: '',
  sortBy: 'DATE_DESC',
};

/**
 * Selection Mode Enum
 * 选择模式枚举
 */
export enum SelectionMode {
  BROWSE = 'BROWSE', // 浏览模式：查看和管理
  SELECT = 'SELECT', // 选择模式：从AI生成界面选择
}

/**
 * Media Library Config Interface
 * 素材库配置接口
 */
export interface MediaLibraryConfig {
  mode: SelectionMode;
  filterType?: AssetType; // 限制显示的类型（SELECT模式）
  onSelect?: (asset: Asset) => void; // 选择回调（SELECT模式）
}

/**
 * Storage Quota Interface
 * 存储配额接口
 */
export interface StorageQuota {
  usage: number; // 已使用空间（字节）
  quota: number; // 总配额（字节）
  percentUsed: number; // 使用百分比 (0-100)
  available: number; // 可用空间（字节）
}

/**
 * Storage Status Interface
 * 存储状态接口
 */
export interface StorageStatus {
  quota: StorageQuota;
  isNearLimit: boolean; // 是否接近限制 (>80%)
  isCritical: boolean; // 是否严重 (>95%)
}

/**
 * Storage Stats Interface
 * 存储统计接口
 */
export interface StorageStats {
  totalAssets: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  localCount: number;
  aiGeneratedCount: number;
  totalSize: number; // 估算的总大小（字节）
}

/**
 * Asset Context State Interface
 * 素材Context状态接口
 */
export interface AssetContextState {
  // 核心数据
  assets: Asset[];

  // UI状态
  loading: boolean;
  error: string | null;

  // 筛选和排序
  filters: FilterState;

  // 选择
  selectedAssetId: string | null;

  // 存储状态
  storageStatus: StorageStatus | null;

  // 同步状态 - 已同步到 Gist 的 URL 集合
  syncedUrls: Set<string>;
}

/**
 * Asset Context Actions Interface
 * 素材Context操作接口
 */
export interface AssetContextActions {
  // 素材操作
  loadAssets: () => Promise<void>;
  addAsset: (
    file: File | Blob,
    type: AssetType,
    source: AssetSource,
    name?: string,
  ) => Promise<Asset>;
  removeAsset: (id: string) => Promise<void>;
  removeAssets: (ids: string[]) => Promise<void>;
  renameAsset: (id: string, newName: string) => Promise<void>;

  // 筛选和选择
  setFilters: (filters: Partial<FilterState>) => void;
  setSelectedAssetId: (id: string | null) => void;

  // 存储管理
  checkStorageQuota: () => Promise<void>;

  // 同步状态
  loadSyncedUrls: () => Promise<void>;
}

/**
 * Asset Context Value Type
 * 素材Context值类型
 */
export type AssetContextValue = AssetContextState & AssetContextActions;

/**
 * Filtered Assets Result Interface
 * 筛选后的素材结果接口
 */
export interface FilteredAssetsResult {
  assets: Asset[];
  count: number;
  isEmpty: boolean;
}

/**
 * Component Props Interfaces
 * 组件Props接口
 */

export interface MediaLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: SelectionMode;
  filterType?: AssetType;
  onSelect?: (asset: Asset) => void;
  /** 自定义选择按钮文本，默认为"使用到画板" */
  selectButtonText?: string;
}

export interface AssetGridItemProps {
  asset: Asset;
  isSelected: boolean;
  onSelect: (assetId: string) => void;
  onDoubleClick?: (asset: Asset) => void;
  isInSelectionMode?: boolean;
  viewMode?: ViewMode;
}

export interface AssetListItemProps {
  asset: Asset;
  isSelected: boolean;
  onSelect: (assetId: string) => void;
  onDoubleClick?: (asset: Asset) => void;
  isInSelectionMode?: boolean;
}

export interface MediaLibrarySidebarProps {
  filters: FilterState;
  assetCount: number;
  storageStatus: StorageStatus | null;
  onFilterChange: (filters: Partial<FilterState>) => void;
}

export interface MediaLibraryInspectorProps {
  asset: Asset | null;
  onRename: (assetId: string, newName: string) => void;
  onDelete: (assetId: string) => void;
  onDownload: (asset: Asset) => void;
  onSelect?: (asset: Asset) => void;
  showSelectButton: boolean;
  /** 自定义选择按钮文本，默认为"使用到画板" */
  selectButtonText?: string;
}

export interface MediaLibraryGridProps {
  filterType?: AssetType;
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
  onDoubleClick?: (asset: Asset) => void;
  onFileUpload?: (files: FileList) => void;
  onUploadClick?: () => void;
  storageStatus?: StorageStatus | null;
}

export interface MediaLibraryStorageBarProps {
  assetCount: number;
  storageStatus: StorageStatus | null;
}

/**
 * Factory Functions
 * 工厂函数
 */

/**
 * Create Asset
 * 创建素材对象
 */
export function createAsset(params: {
  type: AssetType;
  source: AssetSource;
  url: string;
  name: string;
  mimeType: string;
  size?: number;
  contentHash?: string;
  prompt?: string;
  modelName?: string;
}): Asset {
  return {
    id: crypto.randomUUID(),
    type: params.type,
    source: params.source,
    url: params.url,
    name: params.name,
    mimeType: params.mimeType,
    createdAt: Date.now(),
    ...(params.size && { size: params.size }),
    ...(params.contentHash && { contentHash: params.contentHash }),
    ...(params.prompt && { prompt: params.prompt }),
    ...(params.modelName && { modelName: params.modelName }),
  };
}

/**
 * Stored Asset to Asset Conversion
 * 将存储的素材转换为运行时素材
 * 新版：直接使用存储的 URL（统一缓存服务管理）
 */
export function storedAssetToAsset(stored: StoredAsset): Asset {
  return { ...stored };
}

/**
 * Asset to Stored Asset Conversion
 * 将运行时素材转换为存储素材
 * 新版：不再存储 Blob 数据
 */
export function assetToStoredAsset(asset: Asset): StoredAsset {
  return { ...asset };
}
