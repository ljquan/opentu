/**
 * Gist 分片存储类型定义
 * 支持多 Gist 分片存储，突破单 Gist 300 文件限制
 */

// ====================================
// 分片配置常量
// ====================================

/** 分片配置 */
export const SHARD_CONFIG = {
  /** 每分片最多文件数（预留 50 个给系统文件） */
  FILE_LIMIT: 250,
  /** 每分片最大大小（500MB） */
  SIZE_LIMIT: 500 * 1024 * 1024,
  /** 软删除保留天数 */
  TOMBSTONE_RETENTION_DAYS: 30,
  /** 批量操作大小 */
  BATCH_SIZE: 20,
  /** 并发请求数 */
  CONCURRENCY: 3,
  /** 分片缓存过期时间（5分钟） */
  CACHE_TTL_MS: 5 * 60 * 1000,
} as const;

/** 分片版本号 */
export const SHARD_VERSION = {
  MASTER_INDEX: 2,
  SHARD_MANIFEST: 1,
} as const;

/** 分片文件名常量 */
export const SHARD_FILES = {
  /** 主索引文件 */
  MASTER_INDEX: 'master-index.json',
  /** 分片清单文件 */
  SHARD_MANIFEST: 'shard-manifest.json',
} as const;

/** Gist 描述前缀 */
export const GIST_DESCRIPTION_PREFIX = {
  MASTER: 'Opentu - 数据同步',
  SHARD: 'Opentu - Media Shard',
} as const;

// ====================================
// 分片状态
// ====================================

/** 分片状态 */
export type ShardStatus = 'active' | 'full' | 'archived';

// ====================================
// 主索引结构
// ====================================

/** 主索引 (master-index.json) */
export interface MasterIndex {
  /** 索引版本 */
  version: number;
  /** 应用版本 */
  appVersion: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;

  /** 分片注册表 (shardId -> ShardInfo) */
  shards: Record<string, ShardInfo>;

  /** 文件路由索引 (URL -> FileIndexEntry) */
  fileIndex: Record<string, FileIndexEntry>;

  /** 软删除记录 */
  tombstones: MediaTombstone[];

  /** 统计信息 */
  stats: MasterIndexStats;
}

/** 分片信息 */
export interface ShardInfo {
  /** Gist ID */
  gistId: string;
  /** 可读别名，如 "photos-2024" */
  alias: string;
  /** Gist 描述 */
  description: string;
  /** 分片序号（用于生成默认别名） */
  order: number;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 当前文件数 */
  fileCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 分片状态 */
  status: ShardStatus;
}

/** 文件索引条目 */
export interface FileIndexEntry {
  /** 分片 ID（alias） */
  shardId: string;
  /** Gist 中的文件名 */
  filename: string;
  /** 文件大小（字节） */
  size: number;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 同步时间 */
  syncedAt: number;
  /** 内容校验和（可选） */
  checksum?: string;
}

/** 媒体软删除记录 */
export interface MediaTombstone {
  /** 原始 URL */
  url: string;
  /** 所在分片 ID */
  shardId: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  size: number;
  /** 删除时间 */
  deletedAt: number;
  /** 删除操作的设备/用户 */
  deletedBy: string;
  /** 过期时间（30 天后可清理） */
  expiresAt: number;
}

/** 主索引统计信息 */
export interface MasterIndexStats {
  /** 总文件数 */
  totalFiles: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 活跃分片数 */
  activeShards: number;
  /** 已满分片数 */
  fullShards: number;
  /** 已归档分片数 */
  archivedShards: number;
}

// ====================================
// 分片清单结构
// ====================================

/** 分片清单 (shard-manifest.json) */
export interface ShardManifest {
  /** 清单版本 */
  version: number;
  /** 分片 ID（与 MasterIndex 中的 alias 对应） */
  shardId: string;
  /** 主 Gist ID（用于验证归属） */
  masterGistId: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 本分片文件列表 (filename -> ShardFileInfo) */
  files: Record<string, ShardFileInfo>;
}

/** 分片文件信息 */
export interface ShardFileInfo {
  /** 原始 URL */
  url: string;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 文件大小 */
  size: number;
  /** MIME 类型 */
  mimeType: string;
  /** 同步时间 */
  syncedAt: number;
  /** 同步来源设备 */
  syncedFromDevice?: string;
}

// ====================================
// 分片操作相关类型
// ====================================

/** 分片分配结果 */
export interface ShardAllocation {
  /** 目标分片 */
  shard: ShardInfo;
  /** 是否新创建的分片 */
  isNewShard: boolean;
}

/** 批量分片分配结果 */
export interface BatchShardAllocation {
  /** URL -> 分配的分片 */
  allocations: Map<string, ShardInfo>;
  /** 新创建的分片列表 */
  newShards: ShardInfo[];
}

/** 分片统计信息 */
export interface ShardStats {
  /** 分片总数 */
  totalShards: number;
  /** 活跃分片数 */
  activeShards: number;
  /** 已满分片数 */
  fullShards: number;
  /** 已归档分片数 */
  archivedShards: number;
  /** 总文件数 */
  totalFiles: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 平均分片使用率 */
  averageUsage: number;
  /** 各分片详细信息 */
  shardDetails: ShardInfo[];
}

/** 分片同步结果 */
export interface ShardSyncResult {
  /** 是否成功 */
  success: boolean;
  /** 上传的文件数 */
  uploaded: number;
  /** 下载的文件数 */
  downloaded: number;
  /** 删除的文件数 */
  deleted: number;
  /** 跳过的文件数 */
  skipped: number;
  /** 错误信息 */
  error?: string;
  /** 详细结果 */
  details: ShardSyncDetail[];
}

/** 分片同步详情 */
export interface ShardSyncDetail {
  /** URL */
  url: string;
  /** 操作类型 */
  action: 'upload' | 'download' | 'delete' | 'skip';
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 目标分片 */
  shardId?: string;
}

// ====================================
// 迁移相关类型
// ====================================

/** 迁移结果 */
export interface MigrationResult {
  /** 是否成功 */
  success: boolean;
  /** 迁移的文件数 */
  migratedFiles: number;
  /** 创建的分片数 */
  createdShards: number;
  /** 错误信息 */
  error?: string;
  /** 警告列表 */
  warnings: string[];
}

/** 迁移进度回调 */
export type MigrationProgressCallback = (
  current: number,
  total: number,
  phase: 'analyzing' | 'creating_index' | 'migrating' | 'verifying'
) => void;

// ====================================
// 工具函数类型
// ====================================

/** 创建空的主索引 */
export function createEmptyMasterIndex(appVersion: string): MasterIndex {
  const now = Date.now();
  return {
    version: SHARD_VERSION.MASTER_INDEX,
    appVersion,
    createdAt: now,
    updatedAt: now,
    shards: {},
    fileIndex: {},
    tombstones: [],
    stats: {
      totalFiles: 0,
      totalSize: 0,
      activeShards: 0,
      fullShards: 0,
      archivedShards: 0,
    },
  };
}

/** 创建分片信息 */
export function createShardInfo(
  gistId: string,
  alias: string,
  order: number
): ShardInfo {
  const now = Date.now();
  return {
    gistId,
    alias,
    description: `${GIST_DESCRIPTION_PREFIX.SHARD} #${order} (${alias})`,
    order,
    createdAt: now,
    updatedAt: now,
    fileCount: 0,
    totalSize: 0,
    status: 'active',
  };
}

/** 创建分片清单 */
export function createShardManifest(
  shardId: string,
  masterGistId: string
): ShardManifest {
  const now = Date.now();
  return {
    version: SHARD_VERSION.SHARD_MANIFEST,
    shardId,
    masterGistId,
    createdAt: now,
    updatedAt: now,
    files: {},
  };
}

/** 创建媒体软删除记录 */
export function createMediaTombstone(
  url: string,
  shardId: string,
  filename: string,
  size: number,
  deletedBy: string
): MediaTombstone {
  const now = Date.now();
  return {
    url,
    shardId,
    filename,
    size,
    deletedAt: now,
    deletedBy,
    expiresAt: now + SHARD_CONFIG.TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  };
}

/** 检查分片是否有空间 */
export function shardHasCapacity(
  shard: ShardInfo,
  fileSize: number
): boolean {
  if (shard.status !== 'active') {
    return false;
  }
  if (shard.fileCount >= SHARD_CONFIG.FILE_LIMIT) {
    return false;
  }
  if (shard.totalSize + fileSize > SHARD_CONFIG.SIZE_LIMIT) {
    return false;
  }
  return true;
}

/** 更新主索引统计信息 */
export function updateMasterIndexStats(index: MasterIndex): void {
  const shards = Object.values(index.shards);
  index.stats = {
    totalFiles: Object.keys(index.fileIndex).length,
    totalSize: shards.reduce((sum, s) => sum + s.totalSize, 0),
    activeShards: shards.filter(s => s.status === 'active').length,
    fullShards: shards.filter(s => s.status === 'full').length,
    archivedShards: shards.filter(s => s.status === 'archived').length,
  };
  index.updatedAt = Date.now();
}

/** 检查 tombstone 是否过期 */
export function isTombstoneExpired(tombstone: MediaTombstone): boolean {
  return Date.now() >= tombstone.expiresAt;
}

/** 生成默认分片别名 */
export function generateShardAlias(order: number): string {
  return `media-${order}`;
}
