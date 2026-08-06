/**
 * Channel Manager Constants
 *
 * RPC 方法名和事件名常量定义
 */

// ============================================================================
// RPC 方法名常量
// ============================================================================

export const RPC_METHODS = {
  // 活跃的 RPC
  THUMBNAIL_GENERATE: 'thumbnail:generate',
  CRASH_SNAPSHOT: 'crash:snapshot',
  CRASH_HEARTBEAT: 'crash:heartbeat',
  CONSOLE_REPORT: 'console:report',

  // Debug
  DEBUG_GET_STATUS: 'debug:getStatus',
  DEBUG_ENABLE: 'debug:enable',
  DEBUG_DISABLE: 'debug:disable',
  DEBUG_GET_LOGS: 'debug:getLogs',
  DEBUG_CLEAR_LOGS: 'debug:clearLogs',
  DEBUG_GET_CONSOLE_LOGS: 'debug:getConsoleLogs',
  DEBUG_CLEAR_CONSOLE_LOGS: 'debug:clearConsoleLogs',
  DEBUG_GET_POSTMESSAGE_LOGS: 'debug:getPostMessageLogs',
  DEBUG_CLEAR_POSTMESSAGE_LOGS: 'debug:clearPostMessageLogs',
  DEBUG_GET_CRASH_SNAPSHOTS: 'debug:getCrashSnapshots',
  DEBUG_CLEAR_CRASH_SNAPSHOTS: 'debug:clearCrashSnapshots',
  DEBUG_GET_LLM_API_LOGS: 'debug:getLLMApiLogs',
  DEBUG_GET_LLM_API_LOG_BY_ID: 'debug:getLLMApiLogById',
  DEBUG_CLEAR_LLM_API_LOGS: 'debug:clearLLMApiLogs',
  DEBUG_DELETE_LLM_API_LOGS: 'debug:deleteLLMApiLogs',
  DEBUG_GET_CACHE_ENTRIES: 'debug:getCacheEntries',
  DEBUG_GET_CACHE_STATS: 'debug:getCacheStats',
  DEBUG_EXPORT_LOGS: 'debug:exportLogs',

  // Upgrade
  UPGRADE_GET_STATUS: 'upgrade:getStatus',
  UPGRADE_FORCE: 'upgrade:force',

  // Cache management
  CACHE_DELETE: 'cache:delete',
  CACHE_CLEAR_ALL: 'cache:clearAll',

  // Health check
  PING: 'ping',
} as const;

// ============================================================================
// 事件名常量（SW 推送给客户端）
// ============================================================================

export const SW_EVENTS = {
  // Cache events
  CACHE_IMAGE_CACHED: 'cache:imageCached',
  CACHE_IMAGE_CACHE_FAILED: 'cache:imageCacheFailed',
  CACHE_DELETED: 'cache:deleted',
  CACHE_QUOTA_WARNING: 'cache:quotaWarning',

  // SW status events
  SW_NEW_VERSION_READY: 'sw:newVersionReady',
  SW_ACTIVATED: 'sw:activated',
  SW_UPDATED: 'sw:updated',

  // Console events
  CONSOLE_LOG: 'console:log',

  // Debug events
  DEBUG_LOG: 'debug:log',
  DEBUG_LLM_LOG: 'debug:llmLog',
  DEBUG_STATUS_CHANGED: 'debug:statusChanged',
  DEBUG_NEW_CRASH_SNAPSHOT: 'debug:newCrashSnapshot',
  POSTMESSAGE_LOG: 'postmessage:log',
  POSTMESSAGE_LOG_BATCH: 'postmessage:logBatch',
} as const;
