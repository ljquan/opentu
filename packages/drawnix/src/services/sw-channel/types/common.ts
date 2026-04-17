/**
 * Common Types
 *
 * 通用类型定义，包括初始化、RPC 方法映射、事件映射等
 */

import type { Methods, PostResponse } from 'postmessage-duplex';

// 导入其他模块的类型用于 SWMethods 和 SWEvents
import type {
  TaskOperationParams,
  TaskOperationResult,
  TaskStatusEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskCreatedEvent,
} from './task';

import type {
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
} from './chat';

import type {
  WorkflowStatusEvent,
  WorkflowStepStatusEvent,
  WorkflowCompletedEvent,
  WorkflowFailedEvent,
  WorkflowStepsAddedEvent,
  CanvasOperationRequestEvent,
  MainThreadToolRequestEvent,
  WorkflowRecoveredEvent,
} from './workflow';

import type {
  DebugStatusResult,
  DebugLogEvent,
  DebugLLMLogEvent,
  DebugStatusChangedEvent,
  DebugNewCrashSnapshotEvent,
  PostMessageLogEvent,
  PostMessageLogBatchEvent,
  CrashSnapshotParams,
  HeartbeatParams,
  ConsoleLogEvent,
  ConsoleReportParams,
} from './debug';

// ============================================================================
// 初始化类型
// ============================================================================

/**
 * 初始化参数
 * 
 * 配置参数现在是可选的：
 * - 主线程会自动同步配置到 IndexedDB
 * - SW 从 IndexedDB 读取配置
 * - 传递配置仅用于兼容旧版本或强制覆盖
 */
export interface InitParams {
  /** @deprecated 配置现在从 IndexedDB 读取，此参数仅用于兼容旧版本 */
  geminiConfig?: {
    apiKey: string;
    baseUrl: string;
    modelName?: string;
    /** Text model for ai_analyze (e.g., 'deepseek-v3.2') */
    textModelName?: string;
  };
  /** @deprecated 配置现在从 IndexedDB 读取，此参数仅用于兼容旧版本 */
  videoConfig?: {
    baseUrl: string;
    apiKey?: string;
  };
}

/**
 * 初始化响应
 */
export interface InitResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// Cache 事件类型
// ============================================================================

/**
 * 图片缓存事件
 */
export interface CacheImageCachedEvent {
  url: string;
  size?: number;
  thumbnailUrl?: string;
}

/**
 * 缓存删除事件
 */
export interface CacheDeletedEvent {
  url: string;
}

/**
 * 缓存配额警告事件
 */
export interface CacheQuotaWarningEvent {
  usage: number;
  quota: number;
  percentUsed: number;
}

// ============================================================================
// SW 状态事件类型
// ============================================================================

/**
 * 新版本就绪事件
 */
export interface SWNewVersionReadyEvent {
  version: string;
}

/**
 * SW 激活事件
 */
export interface SWActivatedEvent {
  version: string;
}

/**
 * SW 更新事件
 */
export interface SWUpdatedEvent {
  version?: string;
}

/**
 * SW 请求配置事件
 * @deprecated 配置现在同步到 IndexedDB，SW 直接读取，不再需要请求主线程
 */
export interface SWRequestConfigEvent {
  reason: string;
}

// ============================================================================
// 缩略图类型
// ============================================================================

/**
 * 视频缩略图请求事件（SW -> 主线程）
 */
export interface ThumbnailVideoRequestEvent {
  requestId: string;
  url: string;
  maxSize?: number;
  timestamp?: number;
}

/**
 * 生成缩略图参数
 */
export interface ThumbnailGenerateParams {
  url: string;
  mediaType: 'image' | 'video';
  blob: ArrayBuffer;
  mimeType: string;
  sizes?: ('small' | 'large')[];
}

/**
 * 视频缩略图响应参数
 */
export interface ThumbnailVideoResponseParams {
  requestId: string;
  thumbnailUrl?: string;
  error?: string;
}

// ============================================================================
// MCP 事件类型
// ============================================================================

/**
 * MCP 工具结果事件
 */
export interface MCPToolResultEvent {
  requestId: string;
  result: unknown;
  error?: string;
}

// ============================================================================
// RPC 方法映射
// ============================================================================

/**
 * SW RPC 方法定义
 * 格式: methodName: (params) => result
 */
export interface SWMethods extends Methods {
  // Thumbnail
  'thumbnail:generate': (params: ThumbnailGenerateParams) => TaskOperationResult;
  'thumbnail:videoResponse': (params: ThumbnailVideoResponseParams) => TaskOperationResult;

  // Crash monitoring
  'crash:snapshot': (params: CrashSnapshotParams) => TaskOperationResult;
  'crash:heartbeat': (params: HeartbeatParams) => TaskOperationResult;

  // Console
  'console:report': (params: ConsoleReportParams) => TaskOperationResult;

  // Debug
  'debug:getStatus': (params?: undefined) => DebugStatusResult;
}

// ============================================================================
// 事件类型映射
// ============================================================================

/**
 * SW 事件类型映射
 */
export interface SWEvents {
  'task:status': TaskStatusEvent;
  'task:completed': TaskCompletedEvent;
  'task:failed': TaskFailedEvent;
  'task:created': TaskCreatedEvent;
  'task:cancelled': { taskId: string };
  'task:deleted': { taskId: string };
  'chat:chunk': ChatChunkEvent;
  'chat:done': ChatDoneEvent;
  'chat:error': ChatErrorEvent;
  // Workflow events
  'workflow:status': WorkflowStatusEvent;
  'workflow:stepStatus': WorkflowStepStatusEvent;
  'workflow:completed': WorkflowCompletedEvent;
  'workflow:failed': WorkflowFailedEvent;
  'workflow:stepsAdded': WorkflowStepsAddedEvent;
  'workflow:canvasRequest': CanvasOperationRequestEvent;
  'workflow:toolRequest': MainThreadToolRequestEvent;
  'workflow:recovered': WorkflowRecoveredEvent;
  // Cache events
  'cache:imageCached': CacheImageCachedEvent;
  'cache:deleted': CacheDeletedEvent;
  'cache:quotaWarning': CacheQuotaWarningEvent;
  // SW status events
  'sw:newVersionReady': SWNewVersionReadyEvent;
  'sw:activated': SWActivatedEvent;
  'sw:updated': SWUpdatedEvent;
  // Note: 'sw:requestConfig' 已移除 - 配置现在同步到 IndexedDB，SW 直接读取
  // Thumbnail events
  'thumbnail:videoRequest': ThumbnailVideoRequestEvent;
  // MCP events
  'mcp:toolResult': MCPToolResultEvent;
  // Console events
  'console:log': ConsoleLogEvent;
  // Debug events
  'debug:log': DebugLogEvent;
  'debug:llmLog': DebugLLMLogEvent;
  'debug:statusChanged': DebugStatusChangedEvent;
  'debug:newCrashSnapshot': DebugNewCrashSnapshotEvent;
  'postmessage:log': PostMessageLogEvent;
  'postmessage:logBatch': PostMessageLogBatchEvent;
}

// ============================================================================
// 工具类型
// ============================================================================

/**
 * 类型安全的 PostResponse
 */
export { ReturnCode } from 'postmessage-duplex';
export type TypedPostResponse<T> = PostResponse & { data?: T };
