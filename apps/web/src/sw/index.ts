/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

// Import task queue module
import {
  taskQueueStorage,
  initChannelManager,
  getChannelManager,
} from './task-queue';
import {
  setDebugFetchBroadcast,
  setDebugFetchEnabled,
  getInternalFetchLogs,
  clearInternalFetchLogs,
  isDebugFetchEnabled,
} from './task-queue/debug-fetch';
import {
  logReceivedMessage,
  getAllLogs as getAllPostMessageLogs,
  clearLogs as clearPostMessageLogs,
  getLogStats as getPostMessageLogStats,
  isPostMessageLoggerDebugMode,
  type PostMessageLogEntry,
} from './task-queue/postmessage-logger';
import {
  setDebugMode as setMessageSenderDebugMode,
  setBroadcastCallback,
} from './task-queue/utils/message-bus';
import { setSwRuntimeBridge } from './task-queue/sw-runtime-bridge';
import {
  beginMediaCacheOperation,
  getMediaCacheEpoch,
  isMediaCacheEpochCurrent,
  pauseMediaCacheWrites,
  resumeMediaCacheWrites,
  waitForMediaCacheOperations,
} from './task-queue/media-cache-epoch';
import { clearThumbnailCache } from './task-queue/utils/thumbnail-utils';
import { getSafeErrorMessage } from './task-queue/utils/sanitize-utils';
import {
  shouldBypassAppShellCacheForLazyChunkRecovery,
  shouldUseOriginFirstPreload,
  shouldUseAppShellStrategy,
} from './app-shell-routing';
import { isUsableImageFetchResponse } from './image-fetch-response';

// fix: self redeclaration error and type casting
const sw = self as unknown as ServiceWorkerGlobalScope;

// Export functions for channel-manager to use
export {
  saveCrashSnapshot,
  getDebugStatus,
  addConsoleLog,
  // Debug helpers
  getDebugLogs,
  clearDebugLogs,
  clearConsoleLogs,
  enableDebugMode,
  disableDebugMode,
  loadConsoleLogsFromDB,
  clearAllConsoleLogs,
  getCrashSnapshots,
  clearCrashSnapshots,
  getCacheStats,
  deleteCacheByUrl,
  // Re-export from imports
  getInternalFetchLogs,
  // Constants
  APP_VERSION,
  IMAGE_CACHE_NAME,
};

// Initialize channel manager for duplex communication (postmessage-duplex)
const channelManager = initChannelManager(sw);

// 设置调试客户端数量变化回调
// 当调试页面连接时自动启用调试模式，当所有调试页面关闭时自动禁用
channelManager.setDebugClientCountChangedCallback(
  handleDebugClientCountChanged
);

// ============================================================================
// SW Console Log Capture（应用页面 + Service Worker 日志均需捕获）
// - 调试开启：log/info/warn/error 均转发并记录、持久化 7 天、广播到调试面板
// - 调试关闭：仅转发并记录 warn/error，持久化 7 天，不广播
// ============================================================================
const originalSWConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// 检查是否应该过滤掉日志（防止死循环）
function shouldFilterLog(args: unknown[]): boolean {
  const message = args[0]?.toString() || '';

  // 过滤 postmessage-duplex 库的日志（避免广播时死循环）
  if (
    message.includes('[ServiceWorkerChannel]') ||
    message.includes('[BaseChannel]') ||
    message.includes('Invalid message structure') ||
    message.includes('broadcast:') ||
    message.includes('publish:') ||
    message.includes('subscribe:')
  ) {
    return true;
  }

  // 过滤来自主线程转发的重复消息（主线程通过 console:report 独立上报，不走 SW console）
  // 注意：不在此过滤 "Service Worker"，否则会误拦 SW 自身的日志如 "Service Worker [Video-xxx]: fetch failed"
  if (message.includes('[Main]') || message.includes('[SW Console Capture]')) {
    return true;
  }

  // 过滤 channel-manager 广播相关的日志
  if (
    message.includes('[SWChannelManager]') &&
    (message.includes('broadcast') || message.includes('sendConsoleLog'))
  ) {
    return true;
  }

  return false;
}

// 转发 SW 内部 console 到 addConsoleLog（调试开：全部；调试关：仅 warn/error，均持久化 7 天）
function setupSWConsoleCapture() {
  console.log = (...args: unknown[]) => {
    originalSWConsole.log(...args);
    if (isDebugFetchEnabled() && !shouldFilterLog(args)) {
      forwardSWConsoleLog('log', args);
    }
  };

  console.info = (...args: unknown[]) => {
    originalSWConsole.info(...args);
    if (isDebugFetchEnabled() && !shouldFilterLog(args)) {
      forwardSWConsoleLog('info', args);
    }
  };

  // warn/error 始终转发并记录（调试关闭时也会持久化 7 天）
  console.warn = (...args: unknown[]) => {
    originalSWConsole.warn(...args);
    if (!shouldFilterLog(args)) {
      forwardSWConsoleLog('warn', args);
    }
  };

  console.error = (...args: unknown[]) => {
    originalSWConsole.error(...args);
    if (!shouldFilterLog(args)) {
      forwardSWConsoleLog('error', args);
    }
  };
}

/** 序列化日志参数为字符串，Error 对象需特殊处理（message/stack 不可枚举，JSON.stringify 会得到 {}） */
function formatLogArgs(args: unknown[]): { message: string; stack?: string } {
  let extractedStack: string | undefined;
  const parts: string[] = [];
  for (const arg of args) {
    try {
      // Error 或类 Error 对象（跨 realm 时 instanceof 可能为 false）
      const err = arg as { name?: string; message?: string; stack?: string };
      if (
        arg instanceof Error ||
        (arg && typeof arg === 'object' && typeof err.message === 'string')
      ) {
        extractedStack = err.stack || extractedStack;
        parts.push(`${err.name || 'Error'}: ${err.message || ''}`);
      } else if (typeof arg === 'object' && arg !== null) {
        const str = JSON.stringify(arg);
        parts.push(str === '{}' ? String(arg) : str);
      } else {
        parts.push(String(arg));
      }
    } catch {
      parts.push(String(arg));
    }
  }
  const message = parts.join(' ') || '(empty)';
  return { message, stack: extractedStack };
}

function forwardSWConsoleLog(
  level: 'log' | 'info' | 'warn' | 'error',
  args: unknown[]
) {
  try {
    const { message, stack } = formatLogArgs(args);

    // Add [SW] prefix only if not already present
    const prefixedMessage =
      message.startsWith('[SW]') || message.startsWith('[SW-')
        ? message
        : `[SW] ${message}`;

    if (typeof addConsoleLogLater === 'function') {
      addConsoleLogLater({
        logLevel: level,
        logMessage: prefixedMessage,
        logStack: stack,
        logSource: 'service-worker',
      });
    }
  } catch (e) {
    originalSWConsole.error(
      '[SW Console Capture] forwardSWConsoleLog failed:',
      e
    );
  }
}

// Placeholder - will be set after addConsoleLog is defined
let addConsoleLogLater: typeof addConsoleLog | null = null;

// Setup console capture immediately
setupSWConsoleCapture();

// Setup debug fetch broadcast to send SW internal API logs to debug panel
setDebugFetchBroadcast((log) => {
  const cm = getChannelManager();
  if (cm) {
    cm.sendDebugLog({ ...log, type: 'fetch' });
  }
});

// Setup LLM API log broadcast for real-time updates (always on, not affected by debug mode)
import('./task-queue/llm-api-logger').then(({ setLLMApiLogBroadcast }) => {
  setLLMApiLogBroadcast((log) => {
    const cm = getChannelManager();
    if (cm) {
      cm.sendDebugLLMLog(log as unknown as Record<string, unknown>);
    }
  });
});

// Service Worker for PWA functionality and handling CORS issues with external images
// Version will be replaced during build process
declare const __APP_VERSION__: string;
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const SW_SCOPE_BASE_URL = new URL('./', self.location.href);
const SW_SCOPE_BASE_PATH = SW_SCOPE_BASE_URL.pathname;
const CACHE_NAME = `drawnix-v${APP_VERSION}`;
const IMAGE_CACHE_NAME = `drawnix-images`;
const STATIC_CACHE_NAME = `drawnix-static-v${APP_VERSION}`;
const FONT_CACHE_NAME = `drawnix-fonts`;
const SW_CACHE_DATE_HEADER = 'sw-cache-date';
const SW_CACHE_CREATED_AT_HEADER = 'sw-cache-created-at';
const STATIC_SOURCE_HEADER = 'x-sw-source';
const STATIC_REVISION_HEADER = 'x-sw-revision';
const STATIC_APP_VERSION_HEADER = 'x-sw-app-version';
const STATIC_FETCH_TARGET_HEADER = 'x-sw-fetch-target';
const SERVICE_WORKER_DB_NAME = 'ServiceWorkerDB';
const SERVICE_WORKER_DB_VERSION = 2;

setSwRuntimeBridge({
  saveCrashSnapshot,
  getDebugStatus,
  addConsoleLog,
  getDebugLogs,
  clearDebugLogs,
  clearConsoleLogs,
  enableDebugMode,
  disableDebugMode,
  loadConsoleLogsFromDB,
  clearAllConsoleLogs,
  getCrashSnapshots,
  clearCrashSnapshots,
  getCacheStats,
  deleteCacheByUrl,
  clearImageCache,
  getInternalFetchLogs,
  getAppVersion: () => APP_VERSION,
  getImageCacheName: () => IMAGE_CACHE_NAME,
  requestVideoThumbnail: async (url, timeoutMs, maxSize) => {
    const cm = getChannelManager();
    if (!cm || cm.getConnectedClientCount() === 0) {
      return null;
    }
    return cm.requestVideoThumbnail(url, timeoutMs, maxSize);
  },
});
const FAILED_DOMAINS_STORE = 'failedDomains';
const VERSION_STATE_STORE = 'versionState';
const VERSION_STATE_KEY = 'app-version-state';

// 缓存 URL 前缀 - 用于合并视频、图片等本地缓存资源
const CACHE_URL_PREFIX = '/__aitu_cache__/';
const AI_GENERATED_AUDIO_CACHE_PREFIX = '/__aitu_generated__/audio/';

// 素材库 URL 前缀 - 用于素材库媒体资源
const ASSET_LIBRARY_PREFIX = '/asset-library/';

// Detect development mode
// 在构建时，process.env.NODE_ENV 会被替换，或者我们可以通过 mode 判断
// 这里使用 location 判断也行，但通常构建时会注入
const isDevelopment =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1';

function createScopeUrl(pathname: string): URL {
  return new URL(pathname.replace(/^\//, ''), SW_SCOPE_BASE_URL);
}

function getScopeRelativePathname(pathname: string): string {
  if (SW_SCOPE_BASE_PATH !== '/' && pathname.startsWith(SW_SCOPE_BASE_PATH)) {
    return `/${pathname.slice(SW_SCOPE_BASE_PATH.length)}`;
  }

  return pathname;
}

interface CorsDomain {
  hostname: string;
  pathPattern: string;
  fallbackDomain: string;
}

type SWUpgradeState = 'idle' | 'prewarming' | 'ready' | 'committing';

interface SWVersionState {
  committedVersion: string;
  pendingVersion: string | null;
  pendingReadyAt: number | null;
  upgradeState: SWUpgradeState;
  updatedAt: number;
}

// 允许跨域处理的域名配置 - 仅拦截需要CORS处理的域名
// 备用域名 cdn.i666.fun 支持原生跨域显示，不需要拦截
const CORS_ALLOWED_DOMAINS: CorsDomain[] = [
  {
    hostname: 'google.datas.systems',
    pathPattern: 'response_images',
    fallbackDomain: 'cdn.i666.fun',
  },
  {
    hostname: 'googlecdn2.datas.systems',
    pathPattern: 'response_images',
    fallbackDomain: 'googlecdn2.i666.fun',
  },
  {
    hostname: 'filesystem.i666.fun',
    pathPattern: 'response_images',
    fallbackDomain: 'filesystem.i666.fun',
  },
];

// 通用图片文件扩展名匹配
const IMAGE_EXTENSIONS_REGEX = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i;

// 视频文件扩展名匹配
const VIDEO_EXTENSIONS_REGEX = /\.(mp4|webm|ogg|mov|avi|mkv|flv|wmv|m4v)$/i;
const AUDIO_EXTENSIONS_REGEX = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i;

const VOLATILE_CACHE_QUERY_PARAMS = new Set([
  '_t',
  'cache_buster',
  'v',
  'timestamp',
  'nocache',
  '_cb',
  't',
  'retry',
  '_retry',
  '_poster_retry',
  'rand',
  '_force',
  'bypass_sw',
  'direct_fetch',
  'thumbnail',
  'expires',
  'signature',
  'sig',
  'token',
  'policy',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-expires',
  'x-amz-security-token',
  'x-amz-signature',
  'x-amz-signedheaders',
  'x-goog-algorithm',
  'x-goog-credential',
  'x-goog-date',
  'x-goog-expires',
  'x-goog-signature',
  'x-goog-signedheaders',
  'ossaccesskeyid',
  'x-oss-security-token',
  'x-oss-signature-version',
  'x-oss-credential',
  'x-oss-date',
  'x-oss-expires',
  'x-oss-signature',
]);

function buildNormalizedCacheUrl(input: string | URL): URL {
  const url = new URL(typeof input === 'string' ? input : input.toString());
  const keys = Array.from(url.searchParams.keys());
  for (const key of keys) {
    if (VOLATILE_CACHE_QUERY_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  return url;
}

interface PendingRequestEntry {
  promise: Promise<Response>;
  timestamp: number;
  count: number;
  originalRequestId?: string;
  duplicateRequestIds?: string[];
  requestId?: string; // for video
}

// 图片请求去重字典：存储正在进行的请求Promise
const pendingImageRequests = new Map<string, PendingRequestEntry>();

// 已完成请求的缓存：存储最近完成的请求 Response，避免短时间内重复请求
interface CompletedRequestEntry {
  response: Response;
  timestamp: number;
}
const completedImageRequests = new Map<string, CompletedRequestEntry>();
// 已完成请求的缓存保留时间（30秒）
const COMPLETED_REQUEST_CACHE_TTL = 30 * 1000;

const cacheFailureNotificationCache = new Map<string, number>();
const CACHE_FAILURE_NOTIFICATION_TTL = 5 * 60 * 1000;
const MAX_CACHE_FAILURE_NOTIFICATION_CACHE_SIZE = 500;

interface VideoRequestEntry {
  promise: Promise<Blob | null | symbol>; // symbol = VIDEO_LOAD_ERROR 表示下载失败
  timestamp: number;
  count: number;
  requestId: string;
}

// 视频请求去重字典：存储正在进行的视频下载Promise
// 注意：这里 promise 返回的是 Blob 而不是 Response，所以类型略有不同，但为了方便统一定义
const pendingVideoRequests = new Map<string, VideoRequestEntry>();

interface VideoCacheEntry {
  blob: Blob;
  timestamp: number;
}

// 视频缓存：存储已下载的完整视频Blob，用于快速响应Range请求
const videoBlobCache = new Map<string, VideoCacheEntry>();

// ==================== 视频 Blob 缓存清理配置 ====================
// 视频 Blob 缓存 TTL（5 分钟）- 超过此时间的视频 Blob 会被清理
const VIDEO_BLOB_CACHE_TTL = 5 * 60 * 1000;
// 视频 Blob 缓存最大数量 - 超过此数量时删除最老的
const VIDEO_BLOB_CACHE_MAX_SIZE = 10;

// 域名故障标记：记录已知失败的域名
const failedDomains = new Set<string>();

// CORS 问题域名：记录返回错误 CORS 头的域名，SW 将跳过这些域名让浏览器直接处理
const corsFailedDomains = new Set<string>();
// CORS 失败域名缓存过期时间（1小时后重试）
const CORS_FAILED_DOMAIN_TTL = 60 * 60 * 1000;
const corsFailedDomainTimestamps = new Map<string, number>();

/**
 * 标记域名存在 CORS 问题
 */
function markCorsFailedDomain(hostname: string): void {
  corsFailedDomains.add(hostname);
  corsFailedDomainTimestamps.set(hostname, Date.now());
  console.warn(
    `Service Worker: 标记 ${hostname} 为 CORS 问题域名，后续请求将跳过 SW`
  );
}

/**
 * 检查域名是否存在 CORS 问题（考虑过期时间）
 */
function isCorsFailedDomain(hostname: string): boolean {
  if (!corsFailedDomains.has(hostname)) return false;

  const timestamp = corsFailedDomainTimestamps.get(hostname);
  if (timestamp && Date.now() - timestamp > CORS_FAILED_DOMAIN_TTL) {
    // 超过 TTL，移除标记，允许重试
    corsFailedDomains.delete(hostname);
    corsFailedDomainTimestamps.delete(hostname);
    return false;
  }
  return true;
}

// ==================== 调试功能相关 ====================

// 调试日志条目接口
interface DebugLogEntry {
  id: string;
  timestamp: number;
  type: 'fetch' | 'cache' | 'message' | 'error' | 'console';
  url?: string;
  method?: string;
  requestType?: string; // 'image' | 'video' | 'audio' | 'font' | 'static' | 'cache-url' | 'asset-library' | 'other'
  status?: number;
  statusText?: string;
  responseType?: string;
  cached?: boolean;
  duration?: number;
  error?: string;
  headers?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  size?: number;
  details?: string;
  resourceSource?: string;
  resourceFetchTarget?: string;
  // 控制台日志专用字段
  logLevel?: 'log' | 'info' | 'warn' | 'error' | 'debug';
  logMessage?: string;
  logStack?: string;
  logSource?: string;
}

// 控制台日志存储（内存缓存，用于实时广播）
// 持久化存储在 IndexedDB，缓存 7 天
const consoleLogs: DebugLogEntry[] = [];
const CONSOLE_LOG_RETENTION_DAYS = 7;

// 调试日志存储（最多保留 500 条）
const debugLogs: DebugLogEntry[] = [];
const MAX_DEBUG_LOGS = 500;

// 调试模式开关
let debugModeEnabled = false;

// 添加调试日志
function addDebugLog(entry: Omit<DebugLogEntry, 'id' | 'timestamp'>): string {
  if (!debugModeEnabled) return '';

  const id = Math.random().toString(36).substring(2, 10);
  const logEntry: DebugLogEntry = {
    ...entry,
    id,
    timestamp: Date.now(),
  };

  debugLogs.unshift(logEntry);

  // 保持日志数量限制
  if (debugLogs.length > MAX_DEBUG_LOGS) {
    debugLogs.pop();
  }

  // 广播日志到调试页面
  broadcastDebugLog(logEntry);

  return id;
}

// 更新调试日志
function updateDebugLog(id: string, updates: Partial<DebugLogEntry>): void {
  if (!debugModeEnabled || !id) return;

  const entry = debugLogs.find((e) => e.id === id);
  if (entry) {
    Object.assign(entry, updates);
    broadcastDebugLog(entry);
  }
}

// 广播调试日志到所有客户端（通过 postmessage-duplex）
function broadcastDebugLog(entry: DebugLogEntry): void {
  const cm = getChannelManager();
  if (cm) {
    cm.sendDebugLog(entry as unknown as Record<string, unknown>);
  }
}

// 获取控制台日志数据库连接
function openConsoleLogDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ConsoleLogDB', 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('logs')) {
        const store = db.createObjectStore('logs', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('logLevel', 'logLevel', { unique: false });
      }
    };
  });
}

// 保存控制台日志到 IndexedDB
async function saveConsoleLogToDB(logEntry: DebugLogEntry): Promise<void> {
  try {
    const db = await openConsoleLogDB();
    const transaction = db.transaction(['logs'], 'readwrite');
    const store = transaction.objectStore('logs');
    store.add(logEntry);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    console.warn('Service Worker: 无法保存控制台日志:', error);
  }
}

// 从 IndexedDB 加载控制台日志（仅返回 7 天内，加载前先清理过期）
async function loadConsoleLogsFromDB(): Promise<DebugLogEntry[]> {
  try {
    await cleanupExpiredConsoleLogs();
    const db = await openConsoleLogDB();
    const transaction = db.transaction(['logs'], 'readonly');
    const store = transaction.objectStore('logs');
    const index = store.index('timestamp');
    const expirationTime =
      Date.now() - CONSOLE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev'); // 按时间倒序
      const logs: DebugLogEntry[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const entry = cursor.value as DebugLogEntry;
          if (entry.timestamp >= expirationTime) {
            logs.push(entry);
          }
          cursor.continue();
        } else {
          db.close();
          resolve(logs);
        }
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn('Service Worker: 无法加载控制台日志:', error);
    return [];
  }
}

// 清理过期的控制台日志（7 天前）
async function cleanupExpiredConsoleLogs(): Promise<number> {
  try {
    const db = await openConsoleLogDB();
    const transaction = db.transaction(['logs'], 'readwrite');
    const store = transaction.objectStore('logs');
    const index = store.index('timestamp');

    const expirationTime =
      Date.now() - CONSOLE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const range = IDBKeyRange.upperBound(expirationTime);

    return new Promise((resolve, reject) => {
      const request = index.openCursor(range);
      let deletedCount = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          db.close();
          if (deletedCount > 0) {
            // console.log(`Service Worker: 清理了 ${deletedCount} 条过期控制台日志`);
          }
          resolve(deletedCount);
        }
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn('Service Worker: 无法清理过期日志:', error);
    return 0;
  }
}

// 清空所有控制台日志
async function clearAllConsoleLogs(): Promise<void> {
  try {
    const db = await openConsoleLogDB();
    const transaction = db.transaction(['logs'], 'readwrite');
    const store = transaction.objectStore('logs');
    store.clear();

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    console.warn('Service Worker: 无法清空控制台日志:', error);
  }
}

// 控制台日志内存条数上限（避免无限增长）
const MAX_CONSOLE_LOGS_MEMORY = 500;

// 添加控制台日志
// - 调试模式开启：记录所有级别（log/info/warn/error/debug），持久化 7 天并广播到调试面板
// - 调试模式关闭：仅记录 warn 及以上，持久化 7 天，不广播
// 应用页面与 Service Worker 的日志均经此入口（主线程通过 console:report，SW 通过 forwardSWConsoleLog）
function addConsoleLog(entry: {
  logLevel: 'log' | 'info' | 'warn' | 'error' | 'debug';
  logMessage: string;
  logStack?: string;
  logSource?: string;
  url?: string;
}): void {
  const isWarnOrAbove = entry.logLevel === 'warn' || entry.logLevel === 'error';
  const shouldRecord = debugModeEnabled || isWarnOrAbove;
  if (!shouldRecord) {
    return;
  }

  const id = Math.random().toString(36).substring(2, 10);
  const logEntry: DebugLogEntry = {
    id,
    timestamp: Date.now(),
    type: 'console',
    ...entry,
  };

  // 持久化到 IndexedDB（保留 7 天，由 cleanupExpiredConsoleLogs 清理）
  saveConsoleLogToDB(logEntry);

  // 内存缓存：调试开启时存全部，关闭时只存 warn+（用于统计与调试面板加载）
  consoleLogs.unshift(logEntry);
  if (consoleLogs.length > MAX_CONSOLE_LOGS_MEMORY) {
    consoleLogs.length = MAX_CONSOLE_LOGS_MEMORY;
  }

  // 仅调试模式开启时广播到调试面板
  if (debugModeEnabled) {
    broadcastConsoleLog(logEntry);
  }
}

// Set the forward function now that addConsoleLog is defined
addConsoleLogLater = addConsoleLog;

// 广播控制台日志到所有客户端（通过 postmessage-duplex）
function broadcastConsoleLog(entry: DebugLogEntry): void {
  const cm = getChannelManager();
  if (cm) {
    cm.sendConsoleLog(entry as unknown as Record<string, unknown>);
  }
}

// 估算 videoBlobCache 的总大小（字节）
function estimateVideoBlobCacheSize(): number {
  let totalSize = 0;
  videoBlobCache.forEach((entry) => {
    if (entry.blob) {
      totalSize += entry.blob.size;
    }
  });
  return totalSize;
}

// 获取 SW 状态信息
function getDebugStatus(): {
  version: string;
  cacheNames: string[];
  pendingImageRequests: number;
  pendingVideoRequests: number;
  videoBlobCacheSize: number;
  videoBlobCacheTotalBytes: number;
  completedImageRequestsSize: number;
  failedDomainsCount: number;
  failedDomains: string[];
  corsFailedDomainsCount: number;
  corsFailedDomains: string[];
  debugLogsCount: number;
  consoleLogsCount: number;
  debugModeEnabled: boolean;
  memoryStats: {
    pendingRequestsMapSize: number;
    completedRequestsMapSize: number;
    videoBlobCacheMapSize: number;
    failedDomainsSetSize: number;
    corsFailedDomainsSetSize: number;
    debugLogsArraySize: number;
    consoleLogsArraySize: number;
  };
} {
  return {
    version: APP_VERSION,
    cacheNames: [
      CACHE_NAME,
      IMAGE_CACHE_NAME,
      STATIC_CACHE_NAME,
      FONT_CACHE_NAME,
    ],
    pendingImageRequests: pendingImageRequests.size,
    pendingVideoRequests: pendingVideoRequests.size,
    videoBlobCacheSize: videoBlobCache.size,
    videoBlobCacheTotalBytes: estimateVideoBlobCacheSize(),
    completedImageRequestsSize: completedImageRequests.size,
    failedDomainsCount: failedDomains.size,
    failedDomains: Array.from(failedDomains),
    corsFailedDomainsCount: corsFailedDomains.size,
    corsFailedDomains: Array.from(corsFailedDomains),
    debugLogsCount: debugLogs.length,
    consoleLogsCount: consoleLogs.length,
    debugModeEnabled,
    // 运行时内存统计
    memoryStats: {
      pendingRequestsMapSize: pendingImageRequests.size,
      completedRequestsMapSize: completedImageRequests.size,
      videoBlobCacheMapSize: videoBlobCache.size,
      failedDomainsSetSize: failedDomains.size,
      corsFailedDomainsSetSize: corsFailedDomains.size,
      debugLogsArraySize: debugLogs.length,
      consoleLogsArraySize: consoleLogs.length,
    },
  };
}

// ============================================================================
// 导出给 channel-manager 使用的帮助函数
// ============================================================================

// 获取调试日志数组
function getDebugLogs(): typeof debugLogs {
  return debugLogs;
}

// 清空调试日志
function clearDebugLogs(): void {
  debugLogs.length = 0;
}

// 清空控制台日志（内存）
function clearConsoleLogs(): void {
  consoleLogs.length = 0;
}

// 启用调试模式（当调试页面连接时自动启用）
function enableDebugMode(): void {
  if (debugModeEnabled) return; // 避免重复启用

  debugModeEnabled = true;
  setDebugFetchEnabled(true);
  setMessageSenderDebugMode(true);

  originalSWConsole.log(
    'Service Worker: Debug mode enabled (debug page connected)'
  );
}

// 禁用调试模式（当所有调试页面关闭时自动禁用）
function disableDebugMode(): void {
  if (!debugModeEnabled) return; // 避免重复禁用

  debugModeEnabled = false;
  setDebugFetchEnabled(false);
  setMessageSenderDebugMode(false);

  // 禁用调试时仅清空内存；IndexedDB 中 warn+ 日志保留 7 天
  consoleLogs.length = 0;
  debugLogs.length = 0;

  originalSWConsole.log('Service Worker: Debug mode disabled (no debug pages)');
}

// 处理调试客户端数量变化
// 由 channelManager 在调试页面连接/断开时调用
function handleDebugClientCountChanged(count: number): void {
  if (count > 0) {
    enableDebugMode();
  } else {
    disableDebugMode();
  }
}

// 检查URL是否需要CORS处理
function shouldHandleCORS(url: URL): CorsDomain | null {
  for (const domain of CORS_ALLOWED_DOMAINS) {
    if (
      url.hostname === domain.hostname &&
      url.pathname.includes(domain.pathPattern)
    ) {
      return domain;
    }
  }
  return null;
}

// 检查是否为图片请求
function isImageRequest(url: URL, request: Request): boolean {
  return (
    IMAGE_EXTENSIONS_REGEX.test(url.pathname) ||
    request.destination === 'image' ||
    shouldHandleCORS(url) !== null
  );
}

// 检查是否为视频请求
function isVideoRequest(url: URL, request: Request): boolean {
  return (
    VIDEO_EXTENSIONS_REGEX.test(url.pathname) ||
    request.destination === 'video' ||
    url.pathname.includes('/video/') ||
    url.hash.startsWith('#merged-video-') || // 合并视频的特殊标识
    url.hash.includes('video') // 视频的 # 标识
  );
}

function isAudioRequest(url: URL, request: Request): boolean {
  return (
    AUDIO_EXTENSIONS_REGEX.test(url.pathname) ||
    request.destination === 'audio' ||
    url.pathname.includes('/audio/')
  );
}

// 检查是否为字体请求
function isFontRequest(url: URL, request: Request): boolean {
  // Google Fonts CSS 文件
  if (url.hostname === 'fonts.googleapis.com') {
    return true;
  }
  // Google Fonts 字体文件
  if (url.hostname === 'fonts.gstatic.com') {
    return true;
  }
  // 通用字体文件扩展名
  const fontExtensions = /\.(woff|woff2|ttf|otf|eot)$/i;
  return fontExtensions.test(url.pathname) || request.destination === 'font';
}

// 检查是否为 Gemini generateContent 系列请求
function isGenerateContentRequest(url: URL): boolean {
  return (
    url.pathname.includes(':generateContent') ||
    url.pathname.includes(':streamGenerateContent')
  );
}

function getStaticCacheName(version: string): string {
  return `drawnix-static-v${version}`;
}

function createDefaultVersionState(): SWVersionState {
  return {
    committedVersion: APP_VERSION,
    pendingVersion: null,
    pendingReadyAt: null,
    upgradeState: 'idle',
    updatedAt: Date.now(),
  };
}

function normalizeVersionState(value: unknown): SWVersionState {
  const raw = (value || {}) as Partial<SWVersionState>;
  const committedVersion =
    typeof raw.committedVersion === 'string' && raw.committedVersion
      ? raw.committedVersion
      : APP_VERSION;
  const pendingVersion =
    typeof raw.pendingVersion === 'string' && raw.pendingVersion
      ? raw.pendingVersion
      : null;
  const pendingReadyAt =
    typeof raw.pendingReadyAt === 'number' &&
    Number.isFinite(raw.pendingReadyAt)
      ? raw.pendingReadyAt
      : null;
  const upgradeState: SWUpgradeState =
    raw.upgradeState === 'prewarming' ||
    raw.upgradeState === 'ready' ||
    raw.upgradeState === 'committing'
      ? raw.upgradeState
      : 'idle';

  return {
    committedVersion,
    pendingVersion,
    pendingReadyAt,
    upgradeState,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : Date.now(),
  };
}

function openServiceWorkerDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      SERVICE_WORKER_DB_NAME,
      SERVICE_WORKER_DB_VERSION
    );

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(FAILED_DOMAINS_STORE)) {
        db.createObjectStore(FAILED_DOMAINS_STORE, { keyPath: 'domain' });
      }
      if (!db.objectStoreNames.contains(VERSION_STATE_STORE)) {
        db.createObjectStore(VERSION_STATE_STORE, { keyPath: 'key' });
      }
    };
  });
}

async function readVersionState(): Promise<SWVersionState> {
  try {
    const db = await openServiceWorkerDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([VERSION_STATE_STORE], 'readonly');
      const store = transaction.objectStore(VERSION_STATE_STORE);
      const request = store.get(VERSION_STATE_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(
          normalizeVersionState(result?.state || createDefaultVersionState())
        );
      };
    });
  } catch (error) {
    console.warn('Service Worker: 无法读取版本状态:', error);
    return createDefaultVersionState();
  }
}

async function writeVersionState(
  state: SWVersionState
): Promise<SWVersionState> {
  const normalized = normalizeVersionState(state);
  try {
    const db = await openServiceWorkerDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([VERSION_STATE_STORE], 'readwrite');
      const store = transaction.objectStore(VERSION_STATE_STORE);
      store.put({
        key: VERSION_STATE_KEY,
        state: normalized,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('Service Worker: 无法写入版本状态:', error);
  }

  return normalized;
}

async function updateVersionState(
  patch:
    | Partial<SWVersionState>
    | ((current: SWVersionState) => Partial<SWVersionState>)
): Promise<SWVersionState> {
  const current = await readVersionState();
  const nextPatch = typeof patch === 'function' ? patch(current) : patch;
  return writeVersionState({
    ...current,
    ...nextPatch,
    updatedAt: Date.now(),
  });
}

async function postVersionState(
  target?: Client | ServiceWorker | null
): Promise<SWVersionState> {
  const state = await readVersionState();
  const payload = {
    type: 'SW_VERSION_STATE' as const,
    ...state,
    swVersion: APP_VERSION,
  };

  if (target) {
    target.postMessage(payload);
    return state;
  }

  const clients = await sw.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  for (const client of clients) {
    client.postMessage(payload);
  }

  return state;
}

// 从IndexedDB恢复失败域名列表
async function loadFailedDomains(): Promise<void> {
  try {
    const db = await openServiceWorkerDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([FAILED_DOMAINS_STORE], 'readonly');
      const store = transaction.objectStore(FAILED_DOMAINS_STORE);
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const domains = getAllRequest.result;
        domains.forEach((item: any) => failedDomains.add(item.domain));
        resolve();
      };
      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  } catch (error) {
    console.warn('Service Worker: 无法加载失败域名列表:', error);
  }
}

// 保存失败域名到IndexedDB
async function saveFailedDomain(domain: string): Promise<void> {
  try {
    const db = await openServiceWorkerDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction([FAILED_DOMAINS_STORE], 'readwrite');
      const store = transaction.objectStore(FAILED_DOMAINS_STORE);

      store.put({ domain: domain, timestamp: Date.now() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn('Service Worker: 无法保存失败域名:', error);
  }
}

// ==================== 智能升级相关函数 ====================

// 标记新版本已准备好，等待用户确认
// isUpdate: 是否是版本更新（有旧版本存在）
async function markNewVersionReady(isUpdate: boolean): Promise<void> {
  if (!isUpdate) {
    await updateVersionState({
      committedVersion: APP_VERSION,
      pendingVersion: null,
      pendingReadyAt: null,
      upgradeState: 'idle',
    });
    await postVersionState();
    return;
  }

  await updateVersionState((current) => ({
    committedVersion: current.committedVersion || APP_VERSION,
    pendingVersion: APP_VERSION,
    pendingReadyAt: Date.now(),
    upgradeState: 'ready',
  }));

  const cm = getChannelManager();
  if (cm) {
    cm.sendSWNewVersionReady(APP_VERSION);
  }
  await postVersionState();
}

// Precache manifest 类型定义
interface PrecacheManifest {
  version: string;
  timestamp: string;
  files: Array<{ url: string; revision: string }>;
}

interface IdlePrefetchManifest {
  version: string;
  timestamp: string;
  defaults?: string[];
  groups: Record<string, Array<{ url: string; revision: string }>>;
}

const IDLE_PREFETCH_CONCURRENCY = 2;
const IDLE_PREFETCH_RECENT_FETCH_WINDOW_MS = 1500;
const IDLE_PREFETCH_SWEEP_DELAY_MS = 2500;
const IDLE_PREFETCH_FETCH_RECHECK_INTERVAL_MS = 8000;
const IDLE_PREFETCH_FAILURE_RETRY_BASE_DELAY_MS = 5000;
const IDLE_PREFETCH_FAILURE_RETRY_MAX_DELAY_MS = 60000;
const IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS = 5000;
const UPDATE_FULL_PREWARM_TIMEOUT_MS = 10 * 60 * 1000;
const FOLLOW_UP_IDLE_PREFETCH_GROUPS = ['offline-static-assets'] as const;
const IDLE_PREFETCH_MANIFEST_DISABLED_REASON = 'disabled-in-development';
let lastObservedClientFetchAt = 0;
let lastIdlePrefetchFetchKickAt = 0;
const completedIdlePrefetchEntries = new Set<string>();
const activeIdlePrefetchEntries = new Set<string>();
const completedIdlePrefetchGroups = new Set<string>();
const idlePrefetchRetryState = new Map<
  string,
  {
    count: number;
    nextRetryAt: number;
    lastError?: string;
    lastStatus?: number;
  }
>();
let idlePrefetchTaskQueue: Promise<void> = Promise.resolve();
let scheduledIdlePrefetchSweepTimer: number | null = null;
let scheduledIdlePrefetchSweepAt = 0;
let installingVersionIsUpdate = false;
let shouldClaimClientsOnActivate = false;

function logSWDebug(message: string, detail?: unknown): void {
  if (detail === undefined) {
    return;
  }
}

function logStatic503Decision(
  stage: string,
  request: Request,
  detail?: Record<string, unknown>
): void {
  console.warn('[SW Static 503]', {
    stage,
    requestUrl: request.url,
    destination: request.destination,
    mode: request.mode,
    ...detail,
  });
}

type SWBootProgressPhase =
  | 'idle'
  | 'installing'
  | 'precache'
  | 'activating'
  | 'activated'
  | 'development'
  | 'error';

interface SWBootProgressState {
  phase: SWBootProgressPhase;
  percent: number;
  completed: number;
  total: number;
  failed: number;
  message?: string;
  version: string;
  updatedAt: number;
}

let swBootProgressState: SWBootProgressState = {
  phase: 'idle',
  percent: 0,
  completed: 0,
  total: 0,
  failed: 0,
  version: APP_VERSION,
  updatedAt: Date.now(),
};

async function broadcastSWBootProgress(target?: Client | null): Promise<void> {
  const payload = {
    type: 'SW_BOOT_PROGRESS' as const,
    ...swBootProgressState,
  };

  if (target) {
    target.postMessage(payload);
    return;
  }

  const clients = await sw.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  for (const client of clients) {
    client.postMessage(payload);
  }
}

function setSWBootProgress(
  patch: Partial<SWBootProgressState>,
  target?: Client | null
): void {
  swBootProgressState = {
    ...swBootProgressState,
    ...patch,
    version: APP_VERSION,
    updatedAt: Date.now(),
  };
  void broadcastSWBootProgress(target);
}

/**
 * 从 precache-manifest.json 加载预缓存文件列表
 * 如果加载失败（开发模式没有此文件），返回 null 表示不需要预缓存
 */
async function loadPrecacheManifest(): Promise<
  { url: string; revision: string }[] | null
> {
  try {
    const response = await fetch(
      createScopeUrl('precache-manifest.json').href,
      {
        cache: 'reload',
      }
    );
    if (!response.ok) {
      logSWDebug('loadPrecacheManifest: response not ok', {
        status: response.status,
        statusText: response.statusText,
      });
      // 没有 manifest 文件，说明是开发模式，不需要预缓存
      return null;
    }

    const manifest: PrecacheManifest = await response.json();
    logSWDebug('loadPrecacheManifest: loaded', {
      version: manifest.version,
      fileCount: manifest.files.length,
    });
    if (manifest.version && manifest.version !== APP_VERSION) {
      logSWDebug('loadPrecacheManifest: version mismatch', {
        manifestVersion: manifest.version,
        workerVersion: APP_VERSION,
      });
      return null;
    }
    return manifest.files;
  } catch (error) {
    logSWDebug('loadPrecacheManifest: failed', {
      error: getSafeErrorMessage(error),
    });
    // 加载失败，不预缓存
    return null;
  }
}

let idlePrefetchManifestPromise: Promise<IdlePrefetchManifest | null> | null =
  null;
let idlePrefetchManifestLastFailureAt = 0;
let idlePrefetchManifestLastFailureReason: string | null = null;
let idlePrefetchManifestTerminalFailureVersion: string | null = null;
let idlePrefetchManifestTerminalFailureReason: string | null = null;

function isIdlePrefetchManifestDisabled(): boolean {
  return isDevelopment;
}

function markIdlePrefetchManifestTerminalFailure(reason: string): void {
  idlePrefetchManifestTerminalFailureVersion = APP_VERSION;
  idlePrefetchManifestTerminalFailureReason = reason;
  idlePrefetchManifestLastFailureAt = Date.now();
  idlePrefetchManifestLastFailureReason = reason;
}

function clearIdlePrefetchManifestTerminalFailure(): void {
  idlePrefetchManifestTerminalFailureVersion = null;
  idlePrefetchManifestTerminalFailureReason = null;
}

function hasTerminalIdlePrefetchManifestFailure(): boolean {
  return idlePrefetchManifestTerminalFailureVersion === APP_VERSION;
}

async function readResponsePreview(
  response: Response,
  maxChars = 200
): Promise<string | undefined> {
  try {
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    if (!text) {
      return undefined;
    }
    return text.slice(0, maxChars);
  } catch {
    return undefined;
  }
}

async function loadIdlePrefetchManifest(): Promise<IdlePrefetchManifest | null> {
  if (isIdlePrefetchManifestDisabled()) {
    logSWDebug('loadIdlePrefetchManifest: skipped in development mode');
    return null;
  }

  const manifestUrl = createScopeUrl('idle-prefetch-manifest.json').href;

  try {
    const response = await fetch(manifestUrl, {
      cache: 'reload',
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const preview = await readResponsePreview(response.clone());
      logSWDebug('loadIdlePrefetchManifest: response not ok', {
        manifestUrl,
        status: response.status,
        statusText: response.statusText,
        contentType,
        preview,
      });
      if (response.status === 404 || response.status === 410) {
        markIdlePrefetchManifestTerminalFailure(`status:${response.status}`);
      }
      return null;
    }

    const manifestText = await response.text();
    const preview = manifestText.replace(/\s+/g, ' ').trim().slice(0, 200);

    if (
      contentType.includes('text/html') ||
      /<!DOCTYPE|<html|<HTML/i.test(preview)
    ) {
      logSWDebug('loadIdlePrefetchManifest: html fallback detected', {
        manifestUrl,
        status: response.status,
        contentType,
        preview,
      });
      markIdlePrefetchManifestTerminalFailure('html-fallback');
      return null;
    }

    let manifest: IdlePrefetchManifest;
    try {
      manifest = JSON.parse(manifestText) as IdlePrefetchManifest;
    } catch (error) {
      logSWDebug('loadIdlePrefetchManifest: invalid json', {
        manifestUrl,
        contentType,
        error: getSafeErrorMessage(error),
        preview,
      });
      markIdlePrefetchManifestTerminalFailure('invalid-json');
      return null;
    }

    if (!manifest || typeof manifest !== 'object' || !manifest.groups) {
      logSWDebug('loadIdlePrefetchManifest: invalid manifest shape', {
        manifestUrl,
        contentType,
        preview,
      });
      markIdlePrefetchManifestTerminalFailure('invalid-shape');
      return null;
    }

    if (manifest.version && manifest.version !== APP_VERSION) {
      logSWDebug('loadIdlePrefetchManifest: version mismatch', {
        manifestUrl,
        manifestVersion: manifest.version,
        workerVersion: APP_VERSION,
      });
      markIdlePrefetchManifestTerminalFailure(
        `version-mismatch:${manifest.version}`
      );
      return null;
    }

    clearIdlePrefetchManifestTerminalFailure();
    logSWDebug('loadIdlePrefetchManifest: loaded', {
      manifestUrl,
      version: manifest.version,
      defaults: manifest.defaults || [],
      groupEntryCounts: Object.fromEntries(
        Object.entries(manifest.groups).map(([group, entries]) => [
          group,
          entries.length,
        ])
      ),
    });
    return manifest;
  } catch (error) {
    logSWDebug('loadIdlePrefetchManifest: failed', {
      manifestUrl,
      error: getSafeErrorMessage(error),
    });
    return null;
  }
}

async function getIdlePrefetchManifest(): Promise<IdlePrefetchManifest | null> {
  if (isIdlePrefetchManifestDisabled()) {
    idlePrefetchManifestLastFailureAt = 0;
    idlePrefetchManifestLastFailureReason =
      IDLE_PREFETCH_MANIFEST_DISABLED_REASON;
    idlePrefetchManifestPromise = null;
    clearIdlePrefetchManifestTerminalFailure();
    return null;
  }

  const now = Date.now();
  if (hasTerminalIdlePrefetchManifestFailure()) {
    logSWDebug('getIdlePrefetchManifest: terminal failure cached', {
      version: APP_VERSION,
      reason: idlePrefetchManifestTerminalFailureReason,
    });
    return null;
  }

  if (!idlePrefetchManifestPromise) {
    if (
      idlePrefetchManifestLastFailureAt > 0 &&
      now - idlePrefetchManifestLastFailureAt <
        IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS
    ) {
      const retryAfterMs =
        IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS -
        (now - idlePrefetchManifestLastFailureAt);
      logSWDebug('getIdlePrefetchManifest: retry cooldown active', {
        retryAfterMs,
        lastFailureReason: idlePrefetchManifestLastFailureReason,
      });
      return null;
    }

    idlePrefetchManifestPromise = loadIdlePrefetchManifest()
      .then((manifest) => {
        if (!manifest) {
          const terminalFailure = hasTerminalIdlePrefetchManifestFailure();
          idlePrefetchManifestLastFailureAt = Date.now();
          idlePrefetchManifestLastFailureReason =
            idlePrefetchManifestTerminalFailureReason ||
            'manifest-missing-or-invalid';
          idlePrefetchManifestPromise = terminalFailure
            ? Promise.resolve(null)
            : null;
          return null;
        }

        idlePrefetchManifestLastFailureAt = 0;
        idlePrefetchManifestLastFailureReason = null;
        clearIdlePrefetchManifestTerminalFailure();
        return manifest;
      })
      .catch((error) => {
        idlePrefetchManifestLastFailureAt = Date.now();
        idlePrefetchManifestLastFailureReason = getSafeErrorMessage(error);
        idlePrefetchManifestPromise = null;
        throw error;
      });
  }

  return idlePrefetchManifestPromise;
}

async function broadcastIdlePrefetchStatus(
  target?: Client | null
): Promise<void> {
  const payload = {
    type: 'SW_IDLE_PREFETCH_STATUS' as const,
    completedGroups: Array.from(completedIdlePrefetchGroups),
    version: APP_VERSION,
    updatedAt: Date.now(),
  };

  if (target) {
    logSWDebug('broadcast idle prefetch status to target client', {
      clientId: target.id,
      completedGroups: payload.completedGroups,
    });
    target.postMessage(payload);
    return;
  }

  const clients = await sw.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  for (const client of clients) {
    client.postMessage(payload);
  }

  logSWDebug('broadcast idle prefetch status to all clients', {
    clientCount: clients.length,
    completedGroups: payload.completedGroups,
  });
}

function createIdlePrefetchEntryKey(url: string, revision: string): string {
  return `${url}@${revision}`;
}

async function getCacheEntryCount(cache: Cache): Promise<number> {
  try {
    return (await cache.keys()).length;
  } catch {
    return -1;
  }
}

function enqueueIdlePrefetchTask(
  label: string,
  task: () => Promise<void>
): Promise<void> {
  const run = idlePrefetchTaskQueue
    .catch(() => undefined)
    .then(async () => {
      logSWDebug('idle prefetch task start', { label });
      try {
        await task();
      } finally {
        logSWDebug('idle prefetch task done', { label });
      }
    });

  idlePrefetchTaskQueue = run.catch((error) => {
    console.warn('[SWDebug] idle prefetch task failed', {
      label,
      error: getSafeErrorMessage(error),
    });
  });

  return run;
}

interface IdlePrefetchRunSummary {
  completedGroups: string[];
  pendingGroups: string[];
  queuedEntries: number;
  coolingEntries: number;
  nextRetryDelayMs: number | null;
}

function getIdlePrefetchRetryDelayMs(failureCount: number): number {
  return Math.min(
    IDLE_PREFETCH_FAILURE_RETRY_MAX_DELAY_MS,
    IDLE_PREFETCH_FAILURE_RETRY_BASE_DELAY_MS *
      2 ** Math.max(0, failureCount - 1)
  );
}

function getOrderedIdlePrefetchGroups(
  manifest: IdlePrefetchManifest,
  preferredGroups: string[] = []
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (groupName: string | undefined) => {
    if (
      !groupName ||
      seen.has(groupName) ||
      (manifest.groups[groupName] || []).length === 0
    ) {
      return;
    }

    seen.add(groupName);
    ordered.push(groupName);
  };

  preferredGroups.forEach(push);
  (manifest.defaults || []).forEach(push);
  FOLLOW_UP_IDLE_PREFETCH_GROUPS.forEach(push);
  Object.keys(manifest.groups).forEach(push);

  return ordered;
}

function resolveIdlePrefetchRunState(
  manifest: IdlePrefetchManifest,
  groupNames: string[]
): {
  completedGroups: string[];
  pendingGroups: string[];
  queue: Array<[string, { url: string; revision: string }]>;
  coolingEntries: number;
  nextRetryDelayMs: number | null;
} {
  const now = Date.now();
  const files = new Map<string, { url: string; revision: string }>();
  const completedGroups: string[] = [];
  const pendingGroups: string[] = [];
  let coolingEntries = 0;
  let nextRetryDelayMs: number | null = null;

  for (const groupName of groupNames) {
    const entries = manifest.groups[groupName] || [];
    if (entries.length === 0) {
      continue;
    }

    let groupPending = false;

    for (const entry of entries) {
      const entryKey = createIdlePrefetchEntryKey(entry.url, entry.revision);
      if (completedIdlePrefetchEntries.has(entryKey)) {
        continue;
      }

      groupPending = true;

      if (activeIdlePrefetchEntries.has(entryKey)) {
        continue;
      }

      const retryState = idlePrefetchRetryState.get(entryKey);
      if (retryState && retryState.nextRetryAt > now) {
        coolingEntries += 1;
        const retryDelayMs = Math.max(0, retryState.nextRetryAt - now);
        nextRetryDelayMs =
          nextRetryDelayMs === null
            ? retryDelayMs
            : Math.min(nextRetryDelayMs, retryDelayMs);
        continue;
      }

      files.set(entryKey, entry);
    }

    if (groupPending) {
      pendingGroups.push(groupName);
    } else {
      completedGroups.push(groupName);
    }
  }

  return {
    completedGroups,
    pendingGroups,
    queue: Array.from(files.entries()),
    coolingEntries,
    nextRetryDelayMs,
  };
}

function scheduleIdlePrefetchSweep(
  reason: string,
  delayMs: number = IDLE_PREFETCH_SWEEP_DELAY_MS
): void {
  const safeDelayMs = Math.max(0, Math.round(delayMs));
  const targetAt = Date.now() + safeDelayMs;

  if (scheduledIdlePrefetchSweepTimer !== null) {
    if (scheduledIdlePrefetchSweepAt <= targetAt) {
      logSWDebug(
        'scheduleIdlePrefetchSweep skipped: earlier timer already exists',
        {
          reason,
          scheduledInMs: Math.max(0, scheduledIdlePrefetchSweepAt - Date.now()),
          requestedDelayMs: safeDelayMs,
        }
      );
      return;
    }

    clearTimeout(scheduledIdlePrefetchSweepTimer);
    scheduledIdlePrefetchSweepTimer = null;
    scheduledIdlePrefetchSweepAt = 0;
  }

  scheduledIdlePrefetchSweepAt = targetAt;
  scheduledIdlePrefetchSweepTimer = self.setTimeout(() => {
    scheduledIdlePrefetchSweepTimer = null;
    scheduledIdlePrefetchSweepAt = 0;
    void enqueueIdlePrefetchTask(`idle-sweep:${reason}`, async () => {
      await prefetchPendingIdleGroups(`scheduled:${reason}`);
    });
  }, safeDelayMs);

  logSWDebug('scheduleIdlePrefetchSweep queued', {
    reason,
    delayMs: safeDelayMs,
  });
}

function shouldDeferIdlePrefetch(): boolean {
  if (lastObservedClientFetchAt === 0) {
    return false;
  }

  return (
    Date.now() - lastObservedClientFetchAt <
    IDLE_PREFETCH_RECENT_FETCH_WINDOW_MS
  );
}

function waitForIdlePrefetchWindow(): Promise<void> {
  if (lastObservedClientFetchAt === 0) {
    return Promise.resolve();
  }

  const elapsed = Date.now() - lastObservedClientFetchAt;
  const waitMs =
    Math.max(0, IDLE_PREFETCH_RECENT_FETCH_WINDOW_MS - elapsed) + 100;
  logSWDebug('waitForIdlePrefetchWindow: delaying idle prefetch', {
    elapsedMs: elapsed,
    waitMs,
    recentFetchWindowMs: IDLE_PREFETCH_RECENT_FETCH_WINDOW_MS,
  });
  return new Promise((resolve) => {
    setTimeout(resolve, waitMs);
  });
}

function shouldKickIdlePrefetchFromFetch(event: FetchEvent, url: URL): boolean {
  if (hasTerminalIdlePrefetchManifestFailure()) {
    return false;
  }

  const scopeRelativePathname = getScopeRelativePathname(url.pathname);
  if (
    event.request.method !== 'GET' ||
    !event.clientId ||
    url.origin !== self.location.origin
  ) {
    return false;
  }

  if (
    url.pathname.startsWith(CACHE_URL_PREFIX) ||
    url.pathname.startsWith(AI_GENERATED_AUDIO_CACHE_PREFIX) ||
    scopeRelativePathname === '/sw.js' ||
    scopeRelativePathname === '/precache-manifest.json' ||
    scopeRelativePathname === '/idle-prefetch-manifest.json'
  ) {
    return false;
  }

  const now = Date.now();
  if (
    now - lastIdlePrefetchFetchKickAt <
    IDLE_PREFETCH_FETCH_RECHECK_INTERVAL_MS
  ) {
    return false;
  }

  lastIdlePrefetchFetchKickAt = now;
  return true;
}

function isOriginFirstStaticPath(pathname: string): boolean {
  return shouldUseOriginFirstPreload(getScopeRelativePathname(pathname));
}

function isVersionedStaticResource(request: Request, url: URL): boolean {
  if (isDevelopment || request.method !== 'GET') {
    return false;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    return false;
  }

  if (isOriginFirstStaticPath(url.pathname)) {
    return false;
  }

  return Boolean(
    url.pathname.match(
      /\.(js|css|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot|json|ico)$/i
    ) ||
      request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'image' ||
      request.destination === 'font'
  );
}

function normalizeScopedResourcePath(pathnameWithSearch: string): string {
  const [pathname, search = ''] = pathnameWithSearch.split(/([?#].*)/, 2);
  return `${getScopeRelativePathname(pathname)}${search}`;
}

function resolveStaticResourceFetchTargets(inputUrl: string): {
  requestUrl: URL;
  resourcePath: string;
  cacheKey: string;
  originFetchUrl: string;
} {
  const requestUrl = new URL(inputUrl, self.location.origin);
  const resourcePath = normalizeScopedResourcePath(
    `${requestUrl.pathname}${requestUrl.search}`
  );
  const normalizedResourceUrl = createScopeUrl(resourcePath);

  return {
    requestUrl,
    resourcePath,
    cacheKey: normalizedResourceUrl.href,
    // 源站兜底始终回到当前 origin，避免被上游传入的绝对 URL 带偏。
    originFetchUrl: normalizedResourceUrl.href,
  };
}

function isStaticHtmlFallbackResponse(
  request: Request,
  url: URL,
  response: Response
): boolean {
  const contentType = response.headers.get('Content-Type') || '';
  return (
    response.status === 200 &&
    contentType.includes('text/html') &&
    isVersionedStaticResource(request, url)
  );
}

function decorateStaticCacheResponse(
  response: Response,
  metadata: {
    source: string;
    revision: string;
    fetchTarget?: string;
    appVersion?: string;
  }
): Response {
  const headers = new Headers(response.headers);
  headers.set(STATIC_SOURCE_HEADER, metadata.source);
  headers.set(STATIC_REVISION_HEADER, metadata.revision);
  headers.set(STATIC_APP_VERSION_HEADER, metadata.appVersion || APP_VERSION);
  if (metadata.fetchTarget) {
    headers.set(STATIC_FETCH_TARGET_HEADER, metadata.fetchTarget);
  }
  headers.set('x-sw-cached-at', new Date().toISOString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function cacheStaticResponse(
  cache: Cache,
  request: RequestInfo | URL,
  response: Response,
  metadata: {
    source: string;
    revision: string;
    fetchTarget?: string;
    appVersion?: string;
  }
): Promise<Response> {
  const cachedResponse = decorateStaticCacheResponse(response, metadata);
  await cache.put(request, cachedResponse.clone());
  return cachedResponse;
}

async function findStaticResponseInOldCaches(
  request: Request,
  fallbackKeys: string[] = []
): Promise<Response | null> {
  const normalizedFallbackKeys = fallbackKeys.filter(
    (key) => Boolean(key) && key !== request.url
  );
  const allCacheNames = await caches.keys();
  for (const cacheName of allCacheNames) {
    if (cacheName.startsWith('drawnix-static-v')) {
      try {
        const oldCache = await caches.open(cacheName);
        const oldCachedResponse = await oldCache.match(request);
        if (oldCachedResponse) {
          return oldCachedResponse;
        }

        for (const fallbackKey of normalizedFallbackKeys) {
          const fallbackResponse = await oldCache.match(fallbackKey);
          if (fallbackResponse) {
            logSWDebug('findStaticResponseInOldCaches: normalized key hit', {
              cacheName,
              requestUrl: request.url,
              normalizedCacheKey: fallbackKey,
            });
            return fallbackResponse;
          }
        }
      } catch {
        // Ignore cache errors
      }
    }
  }

  return null;
}

async function findStaticResponseInBrowserCache(
  request: Request,
  fallbackKeys: string[] = []
): Promise<Response | null> {
  const candidates = [request.url, ...fallbackKeys].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const cachedResponse = await fetch(candidate, {
        cache: 'only-if-cached',
        mode: 'same-origin',
      });
      if (cachedResponse.ok) {
        return cachedResponse;
      }
    } catch {
      void candidate;
    }
  }

  return null;
}

async function matchStaticCacheEntry(
  cache: Cache,
  request: Request
): Promise<{
  response: Response | null;
  normalizedCacheKey: string;
  matchedBy: 'request' | 'normalized' | null;
}> {
  const normalizedCacheKey = resolveStaticResourceFetchTargets(
    request.url
  ).cacheKey;

  const directResponse = await cache.match(request);
  if (directResponse) {
    return {
      response: directResponse,
      normalizedCacheKey,
      matchedBy: 'request',
    };
  }

  if (normalizedCacheKey !== request.url) {
    const normalizedResponse = await cache.match(normalizedCacheKey);
    if (normalizedResponse) {
      return {
        response: normalizedResponse,
        normalizedCacheKey,
        matchedBy: 'normalized',
      };
    }
  }

  return {
    response: null,
    normalizedCacheKey,
    matchedBy: null,
  };
}

async function deleteStaticCacheLookupKeys(
  cache: Cache,
  request: Request,
  normalizedCacheKey: string
): Promise<void> {
  await cache.delete(request);
  if (normalizedCacheKey !== request.url) {
    await cache.delete(normalizedCacheKey);
  }
}

/**
 * 缓存单个文件，全部走同源服务器
 */
async function cacheFile(
  cache: Cache,
  url: string,
  revision: string
): Promise<{
  url: string;
  success: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
  source?: string;
}> {
  try {
    const targets = resolveStaticResourceFetchTargets(url);

    // 检查缓存中是否已有相同 revision 的文件
    const cachedResponse = await cache.match(targets.cacheKey);

    if (cachedResponse) {
      const cachedRevision = cachedResponse.headers.get(STATIC_REVISION_HEADER);
      const cachedVersion = cachedResponse.headers.get(
        STATIC_APP_VERSION_HEADER
      );
      if (cachedRevision === revision && cachedVersion === APP_VERSION) {
        // 文件未变化，跳过
        return { url, success: true, skipped: true };
      }
    }

    const response = await fetch(targets.originFetchUrl, { cache: 'reload' });
    const source = 'server';
    const fetchTarget = targets.originFetchUrl;

    if (
      response.ok &&
      isStaticHtmlFallbackResponse(
        new Request(targets.cacheKey, { method: 'GET' }),
        targets.requestUrl,
        response
      )
    ) {
      return {
        url,
        success: false,
        status: 404,
        error: 'html-fallback-for-static-resource',
      };
    }

    if (response.ok) {
      await cacheStaticResponse(cache, targets.cacheKey, response, {
        source,
        revision,
        fetchTarget,
        appVersion: APP_VERSION,
      });

      // index.html 额外存一份 '/' 的 key，导航请求直接命中无需回退查找
      if (targets.resourcePath === '/index.html') {
        const rootUrl = createScopeUrl('/').href;
        const rootResponse = await cache.match(targets.cacheKey);
        if (rootResponse) {
          await cache.put(rootUrl, rootResponse.clone());
        }
      }

      return { url, success: true, source };
    }
    return { url, success: false, status: response.status };
  } catch (error) {
    return { url, success: false, error: String(error) };
  }
}

/**
 * 预缓存静态资源
 * 使用并发控制避免同时发起太多请求，全部走同源服务器
 */
async function precacheStaticFiles(
  cache: Cache,
  files: { url: string; revision: string }[]
): Promise<{
  total: number;
  successCount: number;
  failCount: number;
}> {
  const CONCURRENCY = 6; // 并发数
  const allResults: Array<{
    url?: string;
    success: boolean;
    skipped?: boolean;
    source?: string;
    status?: number;
    error?: string;
  }> = [];
  const total = files.length;
  let completed = 0;
  let failed = 0;
  const cacheEntriesBefore = await getCacheEntryCount(cache);

  logSWDebug('precacheStaticFiles start', {
    total,
    concurrency: CONCURRENCY,
    cacheEntriesBefore,
    sampleUrls: files.slice(0, 8).map((file) => file.url),
  });

  setSWBootProgress({
    phase: 'precache',
    total,
    completed: 0,
    failed: 0,
    percent: total > 0 ? 0 : 100,
    message:
      total > 0
        ? `正在预热启动资源（0/${total}）...`
        : '没有需要预热的启动资源',
  });

  // 分批处理
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(({ url, revision }) => cacheFile(cache, url, revision))
    );
    const batchResults: Array<{
      url?: string;
      success: boolean;
      skipped?: boolean;
      source?: string;
      status?: number;
      error?: string;
    }> = [];

    // 收集结果
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const value = {
          url: result.value.url,
          success: result.value.success,
          skipped: result.value.skipped,
          source: result.value.source,
          status: result.value.status,
          error: result.value.error,
        };
        allResults.push(value);
        batchResults.push(value);
        completed += 1;
        if (!result.value.success) {
          failed += 1;
        }
      } else {
        const failedValue = {
          success: false,
          error: String(result.reason),
        };
        allResults.push(failedValue);
        batchResults.push(failedValue);
        completed += 1;
        failed += 1;
      }
    }

    logSWDebug('precacheStaticFiles batch done', {
      completed,
      total,
      batchSize: batch.length,
      batchSuccess: batchResults.filter((item) => item.success).length,
      batchSkipped: batchResults.filter((item) => item.skipped).length,
      batchFailed: batchResults.filter((item) => !item.success).length,
      batchSources: Object.fromEntries(
        Array.from(
          batchResults.reduce((acc, item) => {
            const key = item.source || 'unknown';
            acc.set(key, (acc.get(key) || 0) + 1);
            return acc;
          }, new Map<string, number>())
        )
      ),
      batchErrors: batchResults
        .filter((item) => !item.success)
        .slice(0, 5)
        .map((item) => ({
          url: item.url,
          status: item.status,
          error: item.error,
        })),
    });

    setSWBootProgress({
      phase: 'precache',
      total,
      completed,
      failed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 100,
      message:
        total > 0
          ? `正在预热启动资源（${completed}/${total}${
              failed > 0 ? `，${failed} 项回退` : ''
            }）...`
          : '没有需要预热的启动资源',
    });
  }

  const successCount = allResults.filter((r) => r.success).length;
  const failCount = allResults.length - successCount;
  const cacheEntriesAfter = await getCacheEntryCount(cache);

  logSWDebug('precacheStaticFiles finished', {
    total,
    successCount,
    failCount,
    cacheEntriesBefore,
    cacheEntriesAfter,
  });

  return {
    total,
    successCount,
    failCount,
  };
}

async function prefetchIdleGroups(
  groupNames: string[]
): Promise<IdlePrefetchRunSummary> {
  logSWDebug('prefetchIdleGroups start', { groupNames });

  if (groupNames.length === 0) {
    return {
      completedGroups: [],
      pendingGroups: [],
      queuedEntries: 0,
      coolingEntries: 0,
      nextRetryDelayMs: null,
    };
  }

  const manifest = await getIdlePrefetchManifest();
  if (!manifest) {
    logSWDebug('prefetchIdleGroups aborted: manifest missing');
    return {
      completedGroups: [],
      pendingGroups: [],
      queuedEntries: 0,
      coolingEntries: 0,
      nextRetryDelayMs: null,
    };
  }

  logSWDebug('prefetchIdleGroups manifest summary', {
    requestedGroups: groupNames,
    groupEntryCounts: Object.fromEntries(
      groupNames.map((groupName) => [
        groupName,
        manifest.groups[groupName]?.length || 0,
      ])
    ),
    defaults: manifest.defaults || [],
  });

  const completedGroupsBeforeRun = new Set(completedIdlePrefetchGroups);
  const initialState = resolveIdlePrefetchRunState(manifest, groupNames);

  initialState.completedGroups.forEach((groupName) =>
    completedIdlePrefetchGroups.add(groupName)
  );

  if (initialState.queue.length === 0) {
    logSWDebug('prefetchIdleGroups no ready files', {
      groupNames,
      completedGroups: initialState.completedGroups,
      pendingGroups: initialState.pendingGroups,
      coolingEntries: initialState.coolingEntries,
      nextRetryDelayMs: initialState.nextRetryDelayMs,
      completedEntries: completedIdlePrefetchEntries.size,
      activeEntries: activeIdlePrefetchEntries.size,
    });
    return {
      completedGroups: initialState.completedGroups,
      pendingGroups: initialState.pendingGroups,
      queuedEntries: 0,
      coolingEntries: initialState.coolingEntries,
      nextRetryDelayMs: initialState.nextRetryDelayMs,
    };
  }

  const cache = await caches.open(STATIC_CACHE_NAME);
  const cacheEntriesBefore = await getCacheEntryCount(cache);
  const queue = initialState.queue;

  logSWDebug('prefetchIdleGroups queue prepared', {
    groupNames,
    totalCandidates: initialState.queue.length,
    queuedEntries: queue.length,
    pendingGroups: initialState.pendingGroups,
    coolingEntries: initialState.coolingEntries,
    cacheEntriesBefore,
    sampleUrls: queue.slice(0, 8).map(([, entry]) => entry.url),
  });

  for (
    let index = 0;
    index < queue.length;
    index += IDLE_PREFETCH_CONCURRENCY
  ) {
    while (shouldDeferIdlePrefetch()) {
      await waitForIdlePrefetchWindow();
    }

    const batch = queue.slice(index, index + IDLE_PREFETCH_CONCURRENCY);
    batch.forEach(([entryKey]) => activeIdlePrefetchEntries.add(entryKey));
    const results = await Promise.allSettled(
      batch.map(([, { url, revision }]) => cacheFile(cache, url, revision))
    );
    const batchResults: Array<{
      url?: string;
      success: boolean;
      skipped?: boolean;
      source?: string;
      status?: number;
      error?: string;
    }> = [];
    results.forEach((result, batchIndex) => {
      const [entryKey] = batch[batchIndex];
      activeIdlePrefetchEntries.delete(entryKey);

      if (result.status === 'fulfilled' && result.value.success) {
        idlePrefetchRetryState.delete(entryKey);
        completedIdlePrefetchEntries.add(entryKey);
      } else {
        const previous = idlePrefetchRetryState.get(entryKey);
        const nextCount = (previous?.count || 0) + 1;
        const retryDelayMs = getIdlePrefetchRetryDelayMs(nextCount);
        idlePrefetchRetryState.set(entryKey, {
          count: nextCount,
          nextRetryAt: Date.now() + retryDelayMs,
          lastError:
            result.status === 'fulfilled'
              ? result.value.error
              : String(result.reason),
          lastStatus:
            result.status === 'fulfilled' ? result.value.status : undefined,
        });
      }

      if (result.status === 'fulfilled') {
        batchResults.push({
          url: result.value.url,
          success: result.value.success,
          skipped: result.value.skipped,
          source: result.value.source,
          status: result.value.status,
          error: result.value.error,
        });
      } else {
        batchResults.push({
          success: false,
          error: String(result.reason),
        });
      }
    });

    logSWDebug('prefetchIdleGroups batch done', {
      groupNames,
      batchStart: index,
      batchSize: batch.length,
      batchSuccess: batchResults.filter((item) => item.success).length,
      batchSkipped: batchResults.filter((item) => item.skipped).length,
      batchFailed: batchResults.filter((item) => !item.success).length,
      batchSources: Object.fromEntries(
        Array.from(
          batchResults.reduce((acc, item) => {
            const key = item.source || 'unknown';
            acc.set(key, (acc.get(key) || 0) + 1);
            return acc;
          }, new Map<string, number>())
        )
      ),
      batchErrors: batchResults
        .filter((item) => !item.success)
        .slice(0, 5)
        .map((item) => ({
          url: item.url,
          status: item.status,
          error: item.error,
        })),
      completedEntries: completedIdlePrefetchEntries.size,
      activeEntries: activeIdlePrefetchEntries.size,
    });
  }

  const finalState = resolveIdlePrefetchRunState(manifest, groupNames);
  const newlyCompletedGroups = finalState.completedGroups.filter(
    (groupName) => !completedGroupsBeforeRun.has(groupName)
  );

  newlyCompletedGroups.forEach((groupName) =>
    completedIdlePrefetchGroups.add(groupName)
  );

  const cacheEntriesAfter = await getCacheEntryCount(cache);

  logSWDebug('prefetchIdleGroups finished', {
    groupNames,
    newlyCompletedGroups,
    pendingGroups: finalState.pendingGroups,
    completedEntries: completedIdlePrefetchEntries.size,
    cacheEntriesBefore,
    cacheEntriesAfter,
    completedGroups: Array.from(completedIdlePrefetchGroups),
    coolingEntries: finalState.coolingEntries,
    nextRetryDelayMs: finalState.nextRetryDelayMs,
  });

  return {
    completedGroups: newlyCompletedGroups,
    pendingGroups: finalState.pendingGroups,
    queuedEntries: queue.length,
    coolingEntries: finalState.coolingEntries,
    nextRetryDelayMs: finalState.nextRetryDelayMs,
  };
}

async function prefetchPendingIdleGroups(
  reason: string,
  preferredGroups: string[] = []
): Promise<IdlePrefetchRunSummary> {
  if (isIdlePrefetchManifestDisabled()) {
    logSWDebug('prefetchPendingIdleGroups skipped: disabled in development', {
      reason,
      preferredGroups,
    });
    return {
      completedGroups: [],
      pendingGroups: [],
      queuedEntries: 0,
      coolingEntries: 0,
      nextRetryDelayMs: null,
    };
  }

  const manifest = await getIdlePrefetchManifest();
  if (!manifest) {
    const isTerminalFailure = hasTerminalIdlePrefetchManifestFailure();
    if (!isTerminalFailure) {
      scheduleIdlePrefetchSweep(
        `${reason}:manifest-missing`,
        IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS
      );
    }
    logSWDebug('prefetchPendingIdleGroups skipped: manifest missing', {
      reason,
      preferredGroups,
      retryDelayMs: isTerminalFailure
        ? null
        : IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS,
      lastFailureReason: idlePrefetchManifestLastFailureReason,
    });
    return {
      completedGroups: [],
      pendingGroups: [],
      queuedEntries: 0,
      coolingEntries: 0,
      nextRetryDelayMs: isTerminalFailure
        ? null
        : IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS,
    };
  }

  const orderedGroups = getOrderedIdlePrefetchGroups(manifest, preferredGroups);
  if (orderedGroups.length === 0) {
    logSWDebug('prefetchPendingIdleGroups skipped: no groups', {
      reason,
      preferredGroups,
    });
    return {
      completedGroups: [],
      pendingGroups: [],
      queuedEntries: 0,
      coolingEntries: 0,
      nextRetryDelayMs: null,
    };
  }

  logSWDebug('prefetchPendingIdleGroups start', {
    reason,
    preferredGroups,
    orderedGroups,
    groupEntryCounts: Object.fromEntries(
      orderedGroups.map((group) => [group, manifest.groups[group]?.length || 0])
    ),
  });

  const summary = await prefetchIdleGroups(orderedGroups);
  if (summary.completedGroups.length > 0) {
    await broadcastIdlePrefetchStatus();
  }

  if (summary.pendingGroups.length > 0) {
    scheduleIdlePrefetchSweep(
      `${reason}:pending`,
      summary.nextRetryDelayMs ?? IDLE_PREFETCH_SWEEP_DELAY_MS
    );
  }

  logSWDebug('prefetchPendingIdleGroups done', {
    reason,
    preferredGroups,
    orderedGroups,
    summary,
  });

  return summary;
}

async function prefetchDefaultIdleGroups(): Promise<void> {
  if (isIdlePrefetchManifestDisabled()) {
    logSWDebug('prefetchDefaultIdleGroups skipped: disabled in development');
    return;
  }

  const manifest = await getIdlePrefetchManifest();
  if (!manifest) {
    const isTerminalFailure = hasTerminalIdlePrefetchManifestFailure();
    if (!isTerminalFailure) {
      scheduleIdlePrefetchSweep(
        'default-groups:manifest-missing',
        IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS
      );
    }
    logSWDebug('prefetchDefaultIdleGroups skipped: manifest missing', {
      retryDelayMs: isTerminalFailure
        ? null
        : IDLE_PREFETCH_MANIFEST_RETRY_DELAY_MS,
      lastFailureReason: idlePrefetchManifestLastFailureReason,
    });
    return;
  }

  const defaultGroups = manifest?.defaults?.filter(
    (group): group is string => typeof group === 'string' && group.length > 0
  );

  if (!defaultGroups || defaultGroups.length === 0) {
    logSWDebug('prefetchDefaultIdleGroups skipped: no default groups');
    return;
  }

  await prefetchPendingIdleGroups('default-groups', defaultGroups);
}

async function prewarmAllIdlePrefetchGroupsForUpdateReady(): Promise<void> {
  if (isIdlePrefetchManifestDisabled()) {
    logSWDebug(
      'prewarmAllIdlePrefetchGroupsForUpdateReady skipped: disabled in development'
    );
    return;
  }

  const startedAt = Date.now();
  let iteration = 0;
  let orderedGroups: string[] | null = null;

  while (true) {
    if (!orderedGroups) {
      const manifest = await getIdlePrefetchManifest();
      if (!manifest) {
        const elapsedMs = Date.now() - startedAt;
        logSWDebug(
          'prewarmAllIdlePrefetchGroupsForUpdateReady skipped: manifest unavailable',
          {
            elapsedMs,
            lastFailureReason: idlePrefetchManifestLastFailureReason,
          }
        );
        return;
      }

      orderedGroups = getOrderedIdlePrefetchGroups(manifest);
      if (orderedGroups.length === 0) {
        logSWDebug(
          'prewarmAllIdlePrefetchGroupsForUpdateReady skipped: no groups'
        );
        return;
      }
    }

    iteration += 1;
    const summary = await prefetchIdleGroups(orderedGroups);
    if (summary.completedGroups.length > 0) {
      await broadcastIdlePrefetchStatus();
    }

    if (summary.pendingGroups.length === 0) {
      logSWDebug('prewarmAllIdlePrefetchGroupsForUpdateReady complete', {
        orderedGroups,
        iteration,
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= UPDATE_FULL_PREWARM_TIMEOUT_MS) {
      throw new Error(
        `idle-prefetch incomplete after ${elapsedMs}ms: pending groups ${summary.pendingGroups.join(
          ', '
        )}`
      );
    }

    const waitMs = Math.max(
      250,
      summary.nextRetryDelayMs ??
        (summary.queuedEntries > 0 ? IDLE_PREFETCH_SWEEP_DELAY_MS : 1000)
    );

    logSWDebug(
      'prewarmAllIdlePrefetchGroupsForUpdateReady waiting next round',
      {
        orderedGroups,
        iteration,
        pendingGroups: summary.pendingGroups,
        coolingEntries: summary.coolingEntries,
        queuedEntries: summary.queuedEntries,
        waitMs,
        elapsedMs,
      }
    );

    await new Promise((resolve) => {
      setTimeout(resolve, waitMs);
    });
  }
}

sw.addEventListener('install', (event: ExtendableEvent) => {
  logSWDebug('install event received', { version: APP_VERSION });
  installingVersionIsUpdate = Boolean(sw.registration.active);
  shouldClaimClientsOnActivate = !installingVersionIsUpdate;

  // 首次安装：允许尽快接管页面，提升新用户首次访问的缓存命中率。
  // 版本更新：保持 waiting，不打断当前正在运行的旧版本，等后台整包准备完成后再提示升级。
  if (!installingVersionIsUpdate) {
    sw.skipWaiting();
  }

  setSWBootProgress({
    phase: 'installing',
    percent: 0,
    completed: 0,
    total: 0,
    failed: 0,
    message: '正在读取启动资源清单...',
  });

  // 后台预缓存，不阻塞激活
  event.waitUntil(
    (async () => {
      await loadFailedDomains();
      await updateVersionState((current) => ({
        committedVersion: current.committedVersion || APP_VERSION,
        pendingVersion: installingVersionIsUpdate ? APP_VERSION : null,
        pendingReadyAt: null,
        upgradeState: installingVersionIsUpdate ? 'prewarming' : 'idle',
      }));
      await postVersionState();
      try {
        const files = await loadPrecacheManifest();
        if (files && files.length > 0) {
          const cache = await caches.open(STATIC_CACHE_NAME);
          const precacheSummary = await precacheStaticFiles(cache, files);
          if (installingVersionIsUpdate && precacheSummary.failCount > 0) {
            throw new Error(
              `precache incomplete: ${precacheSummary.failCount}/${precacheSummary.total} files failed`
            );
          }
        } else if (isDevelopment) {
          setSWBootProgress({
            phase: 'development',
            percent: 100,
            completed: 0,
            total: 0,
            failed: 0,
            message: '开发模式下跳过静态预缓存',
          });
        }

        // 更新提示只依赖首屏必需资源。idle-prefetch 是增强能力，不能阻塞
        // 新版本 ready，否则可选资源或旧 SW 的重试会让升级提示长期卡住。
        if (installingVersionIsUpdate) {
          void enqueueIdlePrefetchTask('update-ready-follow-up', async () => {
            await prewarmAllIdlePrefetchGroupsForUpdateReady();
          });
        }

        await markNewVersionReady(installingVersionIsUpdate);
      } catch (err) {
        await updateVersionState((current) => ({
          committedVersion: current.committedVersion || APP_VERSION,
          pendingVersion: null,
          pendingReadyAt: null,
          upgradeState: 'idle',
        }));
        await postVersionState();
        setSWBootProgress({
          phase: 'error',
          message: `启动资源预热失败：${getSafeErrorMessage(err)}`,
        });
        console.warn('Service Worker: Precache failed:', err);
      }
    })()
  );
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  logSWDebug('activate event received', { version: APP_VERSION });

  setSWBootProgress({
    phase: 'activating',
    percent: 100,
    message: '启动缓存服务正在接管页面...',
  });

  event.waitUntil(
    (async () => {
      const versionStateBeforeActivate = await readVersionState();
      // SW 一旦激活，committedVersion 就应该是当前版本。
      // 无论是首次安装、用户确认升级、还是所有旧 tab 关闭后自然激活，
      // 都需要更新，否则新 tab 会用旧版本号请求新 hash 资源导致 404。
      await updateVersionState({
        committedVersion: APP_VERSION,
        pendingVersion: null,
        pendingReadyAt: null,
        upgradeState: 'idle',
      });
      await postVersionState();

      if (shouldClaimClientsOnActivate) {
        logSWDebug('activate: before clients.claim');
        await sw.clients.claim();
        logSWDebug('activate: after clients.claim');
      } else {
        logSWDebug('activate: skip clients.claim for staged update');
      }

      // 激活后自动消费 idle-prefetch manifest 的默认分组。
      // prefetchIdleGroups 会在最近有客户端请求时自动延后，避免抢占首屏。
      setTimeout(() => {
        logSWDebug('activate: scheduling default idle prefetch');
        void enqueueIdlePrefetchTask('default-groups', async () =>
          prefetchDefaultIdleGroups()
        );
      }, 800);

      // 使用 channelManager 通知所有客户端 SW 已更新
      const cm = getChannelManager();
      if (cm) {
        cm.sendSWActivated(APP_VERSION);
        logSWDebug('activate: sent sw:activated broadcast');
      }
      setSWBootProgress({
        phase: 'activated',
        percent: 100,
        message: '启动缓存服务已就绪',
      });
    })()
  );

  // 迁移旧的图片缓存并清理过期缓存
  // 重要：延迟清理旧版本的静态资源缓存，避免升级时资源加载失败
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      // 查找旧的版本化图片缓存
      const legacyImageCaches = cacheNames.filter(
        (name) =>
          name.startsWith('drawnix-images-v') && name !== IMAGE_CACHE_NAME
      );

      // 如果存在旧的图片缓存,迁移到新的固定名称缓存
      if (legacyImageCaches.length > 0) {
        // console.log('Migrating legacy image caches to new cache name:', legacyImageCaches);

        const newImageCache = await caches.open(IMAGE_CACHE_NAME);

        // 迁移所有旧缓存中的数据
        for (const legacyCacheName of legacyImageCaches) {
          try {
            const legacyCache = await caches.open(legacyCacheName);
            const requests = await legacyCache.keys();

            // console.log(`Migrating ${requests.length} images from ${legacyCacheName}`);

            for (const request of requests) {
              const response = await legacyCache.match(request);
              if (response) {
                await newImageCache.put(request, response);
              }
            }

            // 迁移完成后删除旧缓存
            await caches.delete(legacyCacheName);
            // console.log(`Deleted legacy cache: ${legacyCacheName}`);
          } catch (error) {
            console.warn(`Failed to migrate cache ${legacyCacheName}:`, error);
          }
        }

        // console.log('Image cache migration completed');
      }

      // 找出旧版本的静态资源缓存（但不立即删除）
      const currentVersionState = await readVersionState();
      const committedStaticCacheName = getStaticCacheName(
        currentVersionState.committedVersion || APP_VERSION
      );
      const oldStaticCaches = cacheNames.filter(
        (name) =>
          name.startsWith('drawnix-static-v') &&
          name !== STATIC_CACHE_NAME &&
          name !== committedStaticCacheName
      );

      const oldAppCaches = cacheNames.filter(
        (name) =>
          name.startsWith('drawnix-v') &&
          name !== CACHE_NAME &&
          name !== IMAGE_CACHE_NAME &&
          !name.startsWith('drawnix-static-v')
      );

      try {
        const currentStaticCache = await caches.open(STATIC_CACHE_NAME);
        await purgeSuspiciousStaticCacheEntries(currentStaticCache);
      } catch (error) {
        console.warn('Failed to purge suspicious static cache entries:', error);
      }

      if (oldStaticCaches.length > 0 || oldAppCaches.length > 0) {
        // console.log('Found old version caches, will keep them temporarily:', [...oldStaticCaches, ...oldAppCaches]);
        // console.log('Old caches will be cleaned up after clients are updated');

        // 延迟 30 秒后清理旧缓存，给所有客户端足够时间刷新
        setTimeout(async () => {
          // console.log('Cleaning up old version caches now...');
          for (const cacheName of [...oldStaticCaches, ...oldAppCaches]) {
            try {
              await caches.delete(cacheName);
              // console.log('Deleted old cache:', cacheName);
            } catch (error) {
              console.warn('Failed to delete old cache:', cacheName, error);
            }
          }
          // console.log('Old version caches cleanup completed');
        }, 30000); // 30秒延迟
      }

      // console.log(`Service Worker v${APP_VERSION} activated`);

      // 清理过期的控制台日志（7 天前）
      cleanupExpiredConsoleLogs().catch((err) => {
        console.warn('Failed to cleanup expired console logs:', err);
      });

      // 归档超出保留限制的旧任务（不删除，标记 archived）
      taskQueueStorage.archiveOldTasks(100).catch((err) => {
        console.warn('Failed to archive old tasks:', err);
      });
    })
  );
});

// Helper function to broadcast PostMessage log to debug panel
function broadcastPostMessageLog(entry: PostMessageLogEntry): void {
  if (debugModeEnabled) {
    const cm = getChannelManager();
    if (cm) {
      cm.sendPostMessageLog(entry as unknown as Record<string, unknown>);
    }
  }
}

async function tryFetchVersionedStaticResourceFromOrigin(
  cache: Cache,
  request: Request,
  resourcePath: string,
  appVersion: string
): Promise<Response | null> {
  try {
    const targets = resolveStaticResourceFetchTargets(request.url);
    const response = await fetch(targets.originFetchUrl, { cache: 'reload' });

    if (!response.ok) {
      console.warn('[SW] Static resource unavailable from origin', {
        requestUrl: request.url,
        resourcePath,
        appVersion,
        status: response.status,
      });
      return null;
    }

    const requestUrl = new URL(request.url);
    if (isStaticHtmlFallbackResponse(request, requestUrl, response)) {
      return null;
    }

    const cachedResponse = await cacheStaticResponse(
      cache,
      targets.cacheKey,
      response,
      {
        source: 'server',
        revision: 'runtime',
        fetchTarget: targets.originFetchUrl,
        appVersion,
      }
    );

    if (targets.cacheKey !== request.url) {
      logSWDebug(
        'tryFetchVersionedStaticResourceFromOrigin: cached under normalized key',
        {
          requestUrl: request.url,
          normalizedCacheKey: targets.cacheKey,
          resourcePath,
          fetchTarget: targets.originFetchUrl,
        }
      );
    }

    return cachedResponse;
  } catch (fetchError) {
    console.warn('[SW] Origin fetch failed for static resource:', fetchError);
    return null;
  }
}

function getStaticDebugMetadata(response: Response): {
  resourceSource?: string;
  resourceFetchTarget?: string;
} {
  const resourceSource =
    response.headers.get(STATIC_SOURCE_HEADER) || undefined;
  const resourceFetchTarget =
    response.headers.get(STATIC_FETCH_TARGET_HEADER) || undefined;

  return {
    resourceSource,
    resourceFetchTarget,
  };
}

function isSuspiciousStaticCacheResponse(
  request: Request,
  response: Response,
  expectedVersion = APP_VERSION
): boolean {
  const sourceHeader = response.headers.get(STATIC_SOURCE_HEADER);
  const revisionHeader = response.headers.get(STATIC_REVISION_HEADER);
  const versionHeader = response.headers.get(STATIC_APP_VERSION_HEADER);

  if (!sourceHeader || !revisionHeader || !versionHeader) {
    const responseUrl = new URL(request.url);
    if (
      response.ok &&
      !isStaticHtmlFallbackResponse(request, responseUrl, response)
    ) {
      return false;
    }

    return true;
  }

  if (versionHeader !== expectedVersion) {
    return true;
  }

  if (
    sourceHeader !== 'server' &&
    sourceHeader !== 'local' &&
    sourceHeader !== 'jsdelivr'
  ) {
    return true;
  }

  const requestUrl = new URL(request.url);
  return isStaticHtmlFallbackResponse(request, requestUrl, response);
}

async function purgeSuspiciousStaticCacheEntries(cache: Cache): Promise<void> {
  const requests = await cache.keys();

  for (const request of requests) {
    try {
      const response = await cache.match(request);
      if (response && isSuspiciousStaticCacheResponse(request, response)) {
        await cache.delete(request);
      }
    } catch (error) {
      console.warn(
        'Service Worker: Failed to inspect static cache entry:',
        error
      );
    }
  }
}

// Configure message sender with debug callback
setBroadcastCallback(broadcastPostMessageLog);

// Handle messages from main thread
sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  // Extract message type from different message formats:
  // - Native messages: event.data.type
  // - postmessage-duplex requests: event.data.cmdname
  // - postmessage-duplex responses: event.data.req.cmdname
  const messageType =
    event.data?.type ||
    event.data?.cmdname ||
    event.data?.req?.cmdname ||
    'unknown';
  const clientId = (event.source as Client)?.id || '';
  const clientUrl = (event.source as WindowClient)?.url || '';

  // Note: postmessage-duplex 1.1.0 automatically handles channel creation and message routing
  // via enableGlobalRouting() in channel-manager.ts. No manual SW_CHANNEL_CONNECT handling needed.
  // postmessage-duplex messages (with __key__ or requestId) are automatically handled
  // by the channel's internal message listener.

  // 跳过 postmessage-duplex 的消息，它们会在 wrapRpcHandler 中被记录为 RPC:xxx 格式
  // postmessage-duplex 消息特征：有 cmdname 字段（RPC 请求）或 requestId+ret 字段（RPC 响应）
  const isDuplexMessage =
    event.data?.cmdname ||
    (event.data?.requestId && event.data?.ret !== undefined);

  // Log received message only if debug mode is enabled
  // This ensures postMessage logging doesn't affect performance when debug mode is off
  let logId = '';
  // Skip logging for internal messages and postmessage-duplex messages
  if (isPostMessageLoggerDebugMode() && !isDuplexMessage) {
    logId = logReceivedMessage(
      messageType,
      event.data,
      clientId,
      clientUrl,
      event.data?.__internal__
    );
    if (logId && debugModeEnabled) {
      const logs = getAllPostMessageLogs();
      const entry = logs.find((l) => l.id === logId);
      if (entry) {
        broadcastPostMessageLog(entry);
      }
    }
  }

  // Handle thumbnail generation request from main thread
  if (event.data && event.data.type === 'GENERATE_THUMBNAIL') {
    const requestCacheEpoch = getMediaCacheEpoch();
    const { url, mediaType, blob: arrayBuffer, mimeType } = event.data;
    if (url && mediaType && arrayBuffer) {
      // 将 ArrayBuffer 转换为 Blob
      const blob = new Blob([arrayBuffer], {
        type: mimeType || (mediaType === 'video' ? 'video/mp4' : 'image/png'),
      });

      // 异步生成预览图
      (async () => {
        const { generateThumbnailAsync } = await import(
          './task-queue/utils/thumbnail-utils'
        );
        generateThumbnailAsync(
          blob,
          url,
          mediaType,
          undefined,
          requestCacheEpoch
        );
      })();
    }
    return;
  }

  if (event.data && event.data.type === 'RECOVER_DYNAMIC_IMPORT_FAILURE') {
    event.waitUntil(
      caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith('drawnix-static-v'))
            .map((name) => caches.delete(name))
        ).then(() => {
          logSWDebug('message: RECOVER_DYNAMIC_IMPORT_FAILURE', {
            appVersion: event.data.appVersion,
            moduleKey: event.data.moduleKey,
          });
        })
      )
    );
    return;
  }

  if (event.data && event.data.type === 'SW_BOOT_PROGRESS_GET') {
    const client = event.source as Client | null;
    logSWDebug('message: SW_BOOT_PROGRESS_GET', {
      clientId: client?.id ?? null,
    });
    void broadcastSWBootProgress(client);
    return;
  }

  if (event.data && event.data.type === 'GET_VERSION_STATE') {
    const client = event.source as Client | null;
    logSWDebug('message: GET_VERSION_STATE', { clientId: client?.id ?? null });
    event.waitUntil(postVersionState(client));
    return;
  }

  if (event.data && event.data.type === 'SW_IDLE_PREFETCH_STATUS_GET') {
    const client = event.source as Client | null;
    logSWDebug('message: SW_IDLE_PREFETCH_STATUS_GET', {
      clientId: client?.id ?? null,
    });
    void broadcastIdlePrefetchStatus(client);
    return;
  }

  if (event.data && event.data.type === 'SW_PREFETCH_GROUPS') {
    const groups = Array.isArray(event.data.groups)
      ? event.data.groups.filter(
          (group: unknown): group is string => typeof group === 'string'
        )
      : [];
    logSWDebug('message: SW_PREFETCH_GROUPS', { groups });
    event.waitUntil(
      enqueueIdlePrefetchTask(
        `message:${groups.join(',') || 'empty'}`,
        async () => {
          await prefetchPendingIdleGroups(
            `message:${groups.join(',') || 'empty'}`,
            groups
          );
        }
      )
    );
    return;
  }

  if (event.data && event.data.type === 'CLAIM_CLIENTS') {
    event.waitUntil(sw.clients.claim());
    return;
  }

  if (
    event.data &&
    (event.data.type === 'COMMIT_UPGRADE' || event.data.type === 'SKIP_WAITING')
  ) {
    const client = event.source as Client | null;
    logSWDebug('message: COMMIT_UPGRADE', { clientId: client?.id ?? null });
    event.waitUntil(
      (async () => {
        shouldClaimClientsOnActivate = true;
        await updateVersionState({
          committedVersion: APP_VERSION,
          pendingVersion: null,
          pendingReadyAt: null,
          upgradeState: 'committing',
        });
        await postVersionState(client);
        sw.skipWaiting();

        const cm = getChannelManager();
        if (cm) {
          cm.sendSWUpdated(APP_VERSION);
        }
      })()
    );
  } else if (event.data && event.data.type === 'FORCE_UPGRADE') {
    // 主线程强制升级
    event.waitUntil(
      (async () => {
        shouldClaimClientsOnActivate = true;
        await updateVersionState({
          committedVersion: APP_VERSION,
          pendingVersion: null,
          pendingReadyAt: null,
          upgradeState: 'committing',
        });
        await postVersionState(event.source as Client | null);
        sw.skipWaiting();

        const cm = getChannelManager();
        if (cm) {
          cm.sendSWUpdated(APP_VERSION);
        }
      })()
    );
  } else if (event.data && event.data.type === 'DELETE_CACHE') {
    // 删除单个缓存
    const { url } = event.data;
    if (url) {
      deleteCacheByUrl(url)
        .then(() => {
          // 使用 channelManager 通知主线程
          const cm = getChannelManager();
          if (cm) {
            cm.sendCacheDeleted(url);
          }
        })
        .catch((error) => {
          console.error('Service Worker: Failed to delete cache:', error);
        });
    }
  } else if (event.data && event.data.type === 'DELETE_CACHE_BATCH') {
    // 批量删除缓存
    const { urls } = event.data;
    if (urls && Array.isArray(urls)) {
      deleteCacheBatch(urls)
        .then(() => {
          // console.log('Service Worker: Batch cache deleted:', urls.length);
        })
        .catch((error) => {
          console.error(
            'Service Worker: Failed to batch delete caches:',
            error
          );
        });
    }
  } else if (event.data && event.data.type === 'CLEAR_ALL_CACHE') {
    // 清空所有缓存
    clearImageCache()
      .then(() => {
        // console.log('Service Worker: All image cache cleared');
      })
      .catch((error) => {
        console.error('Service Worker: Failed to clear all cache:', error);
      });
  } else if (event.data && event.data.type === 'SW_DEBUG_ENABLE') {
    // 启用调试模式（同步设置 debugFetch，否则 log/info 会因 isDebugFetchEnabled 延迟为 true 而漏捕）
    debugModeEnabled = true;
    setDebugFetchEnabled(true);
    setMessageSenderDebugMode(true);
    originalSWConsole.log('Service Worker: Debug mode enabled');
    // 响应发送方（native message）
    if (event.source) {
      (event.source as Client).postMessage({ type: 'SW_DEBUG_ENABLED' });
    }
    // 使用 channelManager 广播调试模式状态变更（给其他客户端）
    const cm = getChannelManager();
    if (cm) {
      cm.sendDebugStatusChanged(true);
    }
  } else if (event.data && event.data.type === 'SW_DEBUG_DISABLE') {
    // 禁用调试模式
    debugModeEnabled = false;
    setDebugFetchEnabled(false);
    setMessageSenderDebugMode(false);

    // 禁用调试时仅清空内存；IndexedDB 中 warn+ 日志保留 7 天供后续查看
    consoleLogs.length = 0;
    debugLogs.length = 0;

    originalSWConsole.log('Service Worker: Debug mode disabled');
    // 响应发送方（native message）
    if (event.source) {
      (event.source as Client).postMessage({ type: 'SW_DEBUG_DISABLED' });
    }
    // 使用 channelManager 广播调试模式状态变更（给其他客户端）
    const cm = getChannelManager();
    if (cm) {
      cm.sendDebugStatusChanged(false);
    }
  }

  // 为调试页面提供原生 postMessage 支持（调试页面不使用 postmessage-duplex）
  // LLM API 日志查询
  if (event.data && event.data.type === 'SW_DEBUG_GET_LLM_API_LOGS') {
    (async () => {
      try {
        const { getAllLLMApiLogs } = await import(
          './task-queue/llm-api-logger'
        );
        const logs = await getAllLLMApiLogs();
        const client = event.source as Client;
        if (client) {
          client.postMessage({
            type: 'SW_DEBUG_LLM_API_LOGS',
            logs,
          });
        }
      } catch (error) {
        console.error('[SW] Failed to get LLM API logs:', error);
      }
    })();
    return;
  }

  // LLM API 日志清理
  if (event.data && event.data.type === 'SW_DEBUG_CLEAR_LLM_API_LOGS') {
    (async () => {
      try {
        const { clearAllLLMApiLogs } = await import(
          './task-queue/llm-api-logger'
        );
        await clearAllLLMApiLogs();
        const client = event.source as Client;
        if (client) {
          client.postMessage({
            type: 'SW_DEBUG_LLM_API_LOGS_CLEARED',
          });
        }
      } catch (error) {
        console.error('[SW] Failed to clear LLM API logs:', error);
      }
    })();
    return;
  }

  // 调试状态查询
  if (event.data && event.data.type === 'SW_DEBUG_GET_STATUS') {
    const client = event.source as Client;
    if (client) {
      client.postMessage({
        type: 'SW_DEBUG_STATUS',
        debugModeEnabled,
        swVersion: APP_VERSION,
        logs: debugLogs.slice(-100), // 只发送最近 100 条
        consoleLogs: consoleLogs.slice(-100),
      });
    }
    return;
  }

  // Fetch 日志查询
  if (event.data && event.data.type === 'SW_DEBUG_GET_LOGS') {
    (async () => {
      try {
        const { getInternalFetchLogs } = await import(
          './task-queue/debug-fetch'
        );
        const logs = getDebugLogs();
        const internalLogs = getInternalFetchLogs();
        const client = event.source as Client;
        if (client) {
          client.postMessage({
            type: 'SW_DEBUG_LOGS',
            logs: [
              ...logs,
              ...internalLogs.map((l) => ({ ...l, type: 'fetch' })),
            ],
          });
        }
      } catch (error) {
        console.error('[SW] Failed to get fetch logs:', error);
      }
    })();
    return;
  }

  // Console 日志查询
  if (event.data && event.data.type === 'SW_DEBUG_GET_CONSOLE_LOGS') {
    (async () => {
      try {
        const client = event.source as Client;
        if (client) {
          client.postMessage({
            type: 'SW_DEBUG_CONSOLE_LOGS',
            logs: consoleLogs,
          });
        }
      } catch (error) {
        console.error('[SW] Failed to get console logs:', error);
      }
    })();
    return;
  }

  // PostMessage 日志查询
  if (event.data && event.data.type === 'SW_DEBUG_GET_POSTMESSAGE_LOGS') {
    (async () => {
      try {
        const logs = getAllPostMessageLogs();
        const client = event.source as Client;
        if (client) {
          client.postMessage({
            type: 'SW_DEBUG_POSTMESSAGE_LOGS',
            logs,
          });
        }
      } catch (error) {
        console.error('[SW] Failed to get postmessage logs:', error);
      }
    })();
    return;
  }
});

// ==================== 崩溃快照存储 ====================

const CRASH_SNAPSHOT_DB_NAME = 'MemorySnapshotDB';
const CRASH_SNAPSHOT_STORE = 'snapshots';
const MAX_CRASH_SNAPSHOTS = 50; // 最多保留 50 条

interface CrashSnapshot {
  id: string;
  timestamp: number;
  type:
    | 'startup'
    | 'periodic'
    | 'error'
    | 'beforeunload'
    | 'freeze'
    | 'whitescreen'
    | 'longtask';
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
  pageStats?: {
    domNodeCount: number;
    canvasCount: number;
    imageCount: number;
    videoCount: number;
    iframeCount: number;
    eventListenerCount?: number;
    plaitBoardExists: boolean;
    plaitElementCount?: number;
  };
  performance?: {
    fps?: number;
    longTaskDuration?: number;
    freezeDuration?: number;
    lastHeartbeat?: number;
  };
  userAgent: string;
  url: string;
  error?: {
    message: string;
    stack?: string;
    type: string;
  };
  customData?: Record<string, unknown>;
}

/**
 * 打开崩溃快照数据库
 */
async function openMemorySnapshotDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CRASH_SNAPSHOT_DB_NAME, 1);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(CRASH_SNAPSHOT_STORE)) {
        const store = db.createObjectStore(CRASH_SNAPSHOT_STORE, {
          keyPath: 'id',
        });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
  });
}

/**
 * 保存崩溃快照
 */
async function saveCrashSnapshot(snapshot: CrashSnapshot): Promise<void> {
  try {
    const db = await openMemorySnapshotDB();
    const transaction = db.transaction(CRASH_SNAPSHOT_STORE, 'readwrite');
    const store = transaction.objectStore(CRASH_SNAPSHOT_STORE);

    // 添加新快照
    store.put(snapshot);

    // 获取所有快照数量
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const count = countRequest.result;

      // 如果超过最大数量，删除最老的
      if (count > MAX_CRASH_SNAPSHOTS) {
        const index = store.index('timestamp');
        const cursorRequest = index.openCursor();
        let deleted = 0;
        const toDelete = count - MAX_CRASH_SNAPSHOTS;

        cursorRequest.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor && deleted < toDelete) {
            store.delete(cursor.value.id);
            deleted++;
            cursor.continue();
          }
        };
      }
    };

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });

    // console.log('[SW] Crash snapshot saved:', snapshot.id, snapshot.type);
  } catch (error) {
    console.warn('[SW] Failed to save crash snapshot:', error);
  }
}

/**
 * 获取所有崩溃快照
 */
async function getCrashSnapshots(): Promise<CrashSnapshot[]> {
  try {
    const db = await openMemorySnapshotDB();
    const transaction = db.transaction(CRASH_SNAPSHOT_STORE, 'readonly');
    const store = transaction.objectStore(CRASH_SNAPSHOT_STORE);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.getAll();

      request.onsuccess = () => {
        db.close();
        // 按时间倒序排列
        const snapshots = (request.result as CrashSnapshot[]).sort(
          (a, b) => b.timestamp - a.timestamp
        );
        resolve(snapshots);
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn('[SW] Failed to get crash snapshots:', error);
    return [];
  }
}

/**
 * 清空崩溃快照
 */
async function clearCrashSnapshots(): Promise<void> {
  try {
    const db = await openMemorySnapshotDB();
    const transaction = db.transaction(CRASH_SNAPSHOT_STORE, 'readwrite');
    const store = transaction.objectStore(CRASH_SNAPSHOT_STORE);
    store.clear();

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    });

    // console.log('[SW] Crash snapshots cleared');
  } catch (error) {
    console.warn('[SW] Failed to clear crash snapshots:', error);
  }
}

// IndexedDB 数据库列表（用于统计）
const INDEXEDDB_NAMES = [
  'ConsoleLogDB', // SW 控制台日志
  'ServiceWorkerDB', // SW 失败域名
  'sw-task-queue', // SW 任务队列
  'aitu-workspace', // 工作空间存储
  'drawnix-unified-cache', // 统一缓存（媒体、URL等）
  'drawnix-kv-storage', // KV 存储
  'drawnix-prompts', // 提示词存储
  'drawnix-chat-db', // 聊天存储
  'MemorySnapshotDB', // 崩溃快照存储
];

// 估算对象大小（字节）
function estimateObjectSize(obj: unknown): number {
  try {
    const str = JSON.stringify(obj);
    // UTF-8 编码，中文等字符可能占用更多字节
    return new Blob([str]).size;
  } catch {
    return 0;
  }
}

// 获取单个 IndexedDB 的统计信息（含大小估算）
async function getIndexedDBStats(
  dbName: string
): Promise<{ count: number; totalSize: number }> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(dbName);

      request.onerror = () => resolve({ count: 0, totalSize: 0 });

      request.onsuccess = () => {
        const db = request.result;
        const storeNames = Array.from(db.objectStoreNames);

        if (storeNames.length === 0) {
          db.close();
          resolve({ count: 0, totalSize: 0 });
          return;
        }

        let totalCount = 0;
        let totalSampledSize = 0;
        let totalSampledCount = 0;
        let completedStores = 0;
        const SAMPLE_SIZE = 10; // 每个 store 采样数量

        try {
          const transaction = db.transaction(storeNames, 'readonly');

          for (const storeName of storeNames) {
            const store = transaction.objectStore(storeName);
            const countRequest = store.count();

            countRequest.onsuccess = () => {
              const storeCount = countRequest.result;
              totalCount += storeCount;

              // 采样获取大小
              if (storeCount > 0) {
                const cursorRequest = store.openCursor();
                let sampled = 0;

                cursorRequest.onsuccess = (e) => {
                  const cursor = (e.target as IDBRequest<IDBCursorWithValue>)
                    .result;
                  if (cursor && sampled < SAMPLE_SIZE) {
                    totalSampledSize += estimateObjectSize(cursor.value);
                    totalSampledCount++;
                    sampled++;
                    cursor.continue();
                  } else {
                    completedStores++;
                    if (completedStores === storeNames.length) {
                      db.close();
                      // 估算总大小
                      const avgSize =
                        totalSampledCount > 0
                          ? totalSampledSize / totalSampledCount
                          : 0;
                      const estimatedTotal = Math.round(avgSize * totalCount);
                      resolve({ count: totalCount, totalSize: estimatedTotal });
                    }
                  }
                };

                cursorRequest.onerror = () => {
                  completedStores++;
                  if (completedStores === storeNames.length) {
                    db.close();
                    const avgSize =
                      totalSampledCount > 0
                        ? totalSampledSize / totalSampledCount
                        : 0;
                    const estimatedTotal = Math.round(avgSize * totalCount);
                    resolve({ count: totalCount, totalSize: estimatedTotal });
                  }
                };
              } else {
                completedStores++;
                if (completedStores === storeNames.length) {
                  db.close();
                  resolve({ count: totalCount, totalSize: 0 });
                }
              }
            };

            countRequest.onerror = () => {
              completedStores++;
              if (completedStores === storeNames.length) {
                db.close();
                const avgSize =
                  totalSampledCount > 0
                    ? totalSampledSize / totalSampledCount
                    : 0;
                const estimatedTotal = Math.round(avgSize * totalCount);
                resolve({ count: totalCount, totalSize: estimatedTotal });
              }
            };
          }
        } catch {
          db.close();
          resolve({ count: 0, totalSize: 0 });
        }
      };

      // 如果数据库不存在，onupgradeneeded 会被触发
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        db.close();
        try {
          indexedDB.deleteDatabase(dbName);
        } catch {
          // 忽略删除错误
        }
        resolve({ count: 0, totalSize: 0 });
      };
    } catch {
      resolve({ count: 0, totalSize: 0 });
    }
  });
}

// 获取缓存统计信息（包括 Cache API 和 IndexedDB）
async function getCacheStats(): Promise<{
  [cacheName: string]: { count: number; totalSize: number; type?: string };
}> {
  const stats: {
    [cacheName: string]: { count: number; totalSize: number; type?: string };
  } = {};

  // 1. Cache API 统计
  const cacheNames = [
    CACHE_NAME,
    IMAGE_CACHE_NAME,
    STATIC_CACHE_NAME,
    FONT_CACHE_NAME,
  ];

  for (const cacheName of cacheNames) {
    try {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      let totalSize = 0;

      // 只采样前 100 个条目来估算总大小（避免性能问题）
      const sampleSize = Math.min(requests.length, 100);
      let sampledSize = 0;

      for (let i = 0; i < sampleSize; i++) {
        const response = await cache.match(requests[i]);
        if (response) {
          const size =
            response.headers.get('sw-image-size') ||
            response.headers.get('content-length');
          if (size) {
            sampledSize += parseInt(size);
          }
        }
      }

      // 估算总大小
      if (sampleSize > 0 && requests.length > sampleSize) {
        totalSize = Math.round((sampledSize / sampleSize) * requests.length);
      } else {
        totalSize = sampledSize;
      }

      stats[cacheName] = { count: requests.length, totalSize, type: 'cache' };
    } catch (error) {
      stats[cacheName] = { count: 0, totalSize: 0, type: 'cache' };
    }
  }

  // 2. IndexedDB 统计
  for (const dbName of INDEXEDDB_NAMES) {
    try {
      const dbStats = await getIndexedDBStats(dbName);
      if (dbStats.count > 0) {
        stats[`[IDB] ${dbName}`] = { ...dbStats, type: 'indexeddb' };
      }
    } catch {
      // 忽略错误
    }
  }

  return stats;
}

// 删除单个缓存条目
async function deleteCacheByUrl(url: string): Promise<void> {
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    await cache.delete(url);
    // console.log('Service Worker: Deleted cache entry:', url);
  } catch (error) {
    console.error('Service Worker: Failed to delete cache entry:', url, error);
    throw error;
  }
}

// 批量删除缓存
async function deleteCacheBatch(urls: string[]): Promise<void> {
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    let deletedCount = 0;

    for (const url of urls) {
      try {
        await cache.delete(url);
        deletedCount++;
      } catch (error) {
        console.warn(
          'Service Worker: Failed to delete cache in batch:',
          url,
          error
        );
      }
    }

    // console.log(`Service Worker: Batch deleted ${deletedCount}/${urls.length} cache entries`);
  } catch (error) {
    console.error('Service Worker: Failed to batch delete caches:', error);
    throw error;
  }
}

// 清空所有图片缓存
async function clearImageCache(): Promise<void> {
  pauseMediaCacheWrites();
  try {
    await waitForMediaCacheOperations();
    pendingImageRequests.clear();
    completedImageRequests.clear();
    pendingVideoRequests.clear();
    videoBlobCache.clear();
    cacheFailureNotificationCache.clear();
    failedUrlCache.clear();
    await Promise.all([
      caches.delete(IMAGE_CACHE_NAME),
      clearThumbnailCache(false),
    ]);
  } catch (error) {
    console.error('Service Worker: Failed to clear image cache:', error);
    throw error;
  } finally {
    resumeMediaCacheWrites();
  }
}

async function putMediaCacheEntry(
  cache: Cache,
  request: RequestInfo | URL,
  response: Response,
  cacheEpoch: number
): Promise<boolean> {
  const finishOperation = beginMediaCacheOperation(cacheEpoch);
  if (!finishOperation) {
    return false;
  }

  try {
    await cache.put(request, response);
    return true;
  } finally {
    finishOperation();
  }
}

// 通知主线程图片已缓存（带元数据）
async function notifyImageCached(
  url: string,
  size: number,
  mimeType: string
): Promise<void> {
  try {
    // 使用 channelManager 发送缓存事件
    const cm = getChannelManager();
    if (cm) {
      cm.sendCacheImageCached(url, size);
    }
  } catch (error) {
    console.warn('Service Worker: Failed to notify image cached:', error);
  }
}

function shouldNotifyCacheFailure(url: string): boolean {
  const now = Date.now();
  const lastNotifiedAt = cacheFailureNotificationCache.get(url);
  if (lastNotifiedAt && now - lastNotifiedAt < CACHE_FAILURE_NOTIFICATION_TTL) {
    return false;
  }

  if (
    cacheFailureNotificationCache.size >=
    MAX_CACHE_FAILURE_NOTIFICATION_CACHE_SIZE
  ) {
    for (const [key, timestamp] of cacheFailureNotificationCache) {
      if (now - timestamp > CACHE_FAILURE_NOTIFICATION_TTL) {
        cacheFailureNotificationCache.delete(key);
      }
    }

    if (
      cacheFailureNotificationCache.size >=
      MAX_CACHE_FAILURE_NOTIFICATION_CACHE_SIZE
    ) {
      const entries = Array.from(cacheFailureNotificationCache.entries());
      entries.sort((a, b) => a[1] - b[1]);
      for (const [key] of entries.slice(0, Math.floor(entries.length / 2))) {
        cacheFailureNotificationCache.delete(key);
      }
    }
  }

  cacheFailureNotificationCache.set(url, now);
  return true;
}

async function notifyImageCacheFailed(
  url: string,
  error?: string
): Promise<void> {
  try {
    const normalizedUrl = buildNormalizedCacheUrl(
      new URL(url, self.location.origin)
    ).toString();
    if (!shouldNotifyCacheFailure(normalizedUrl)) {
      return;
    }

    const cm = getChannelManager();
    if (cm) {
      cm.sendCacheImageCacheFailed(normalizedUrl, error);
    }
  } catch (notifyError) {
    console.warn('Service Worker: Failed to notify image cache failure:', {
      url,
      error,
      notifyError,
    });
  }
}

// 检测并警告存储配额
async function checkStorageQuota(): Promise<void> {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const percentage = quota > 0 ? (usage / quota) * 100 : 0;

      // 如果使用率超过 90%，发送警告
      if (percentage > 90) {
        console.warn('Service Worker: Storage quota warning:', {
          usage,
          quota,
          percentage,
        });

        // 使用 channelManager 发送配额警告
        const cm = getChannelManager();
        if (cm) {
          cm.sendCacheQuotaWarning(usage, quota, percentage);
        }
      }
    }
  } catch (error) {
    console.warn('Service Worker: Failed to check storage quota:', error);
  }
}

// ============================================================================
// 失败 URL 缓存 - 避免短时间内重复请求已知 404 的过期外部图片
// 注意：只对"过期"的 URL 生效，刚生成的资源可能暂时 404（还在处理中）
// ============================================================================
const failedUrlCache = new Map<string, number>(); // URL -> 失败时间戳
const FAILED_URL_TTL = 5 * 60 * 1000; // 5 分钟内不重复请求
const MAX_FAILED_URL_CACHE_SIZE = 500; // 最大缓存条目

/**
 * 检查 URL 是否可能是"过期"的（不是今天生成的）
 * 通过检查 URL 中的日期路径来判断，如 /2026/01/09/
 */
function isLikelyExpiredUrl(url: string): boolean {
  // 匹配 URL 中的日期路径 /YYYY/MM/DD/ 或 /YYYYMMDD/
  const datePathMatch = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  const dateCompactMatch = url.match(/\/(\d{4})(\d{2})(\d{2})\//);

  let urlDate: Date | null = null;

  if (datePathMatch) {
    urlDate = new Date(
      parseInt(datePathMatch[1]),
      parseInt(datePathMatch[2]) - 1,
      parseInt(datePathMatch[3])
    );
  } else if (dateCompactMatch) {
    urlDate = new Date(
      parseInt(dateCompactMatch[1]),
      parseInt(dateCompactMatch[2]) - 1,
      parseInt(dateCompactMatch[3])
    );
  }

  if (!urlDate) {
    // 没有日期路径，可能是新生成的资源，不缓存失败
    return false;
  }

  // 如果 URL 日期是今天，不认为是过期的（可能还在处理中）
  const today = new Date();
  const isToday =
    urlDate.getFullYear() === today.getFullYear() &&
    urlDate.getMonth() === today.getMonth() &&
    urlDate.getDate() === today.getDate();

  return !isToday;
}

function isUrlRecentlyFailed(url: string): boolean {
  const failedAt = failedUrlCache.get(url);
  if (!failedAt) return false;
  if (Date.now() - failedAt > FAILED_URL_TTL) {
    failedUrlCache.delete(url);
    return false;
  }
  return true;
}

function markUrlAsFailed(url: string): void {
  // 只缓存"过期"的 URL 失败状态
  if (!isLikelyExpiredUrl(url)) {
    return;
  }

  // 清理过期条目
  if (failedUrlCache.size >= MAX_FAILED_URL_CACHE_SIZE) {
    const now = Date.now();
    for (const [key, timestamp] of failedUrlCache) {
      if (now - timestamp > FAILED_URL_TTL) {
        failedUrlCache.delete(key);
      }
    }
    // 如果仍然太大，删除最旧的一半
    if (failedUrlCache.size >= MAX_FAILED_URL_CACHE_SIZE) {
      const entries = Array.from(failedUrlCache.entries());
      entries.sort((a, b) => a[1] - b[1]);
      const toDelete = entries.slice(0, Math.floor(entries.length / 2));
      for (const [key] of toDelete) {
        failedUrlCache.delete(key);
      }
    }
  }
  failedUrlCache.set(url, Date.now());
}

sw.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  const startTime = Date.now();

  // 只处理 http 和 https 协议的请求，忽略 chrome-extension、data、blob 等
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'other',
      details: `Skipped: non-http protocol (${url.protocol})`,
      status: 0,
      duration: 0,
    });
    return;
  }

  lastObservedClientFetchAt = startTime;

  if (shouldKickIdlePrefetchFromFetch(event, url)) {
    const clientPath = `${url.pathname}${url.search}`;
    logSWDebug('fetch: enqueue idle prefetch recheck', {
      clientId: event.clientId,
      requestUrl: clientPath,
    });
    event.waitUntil(
      enqueueIdlePrefetchTask(`fetch-recheck:${clientPath}`, async () => {
        await prefetchPendingIdleGroups(`fetch:${clientPath}`);
      })
    );
  }

  // 拦截缓存 URL 请求 (/__aitu_cache__/{type}/{taskId}.{ext})
  if (
    url.pathname.startsWith(CACHE_URL_PREFIX) ||
    url.pathname.startsWith(AI_GENERATED_AUDIO_CACHE_PREFIX)
  ) {
    // console.log('Service Worker: Intercepting cache URL request:', event.request.url);
    const debugId = addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'cache-url',
      details: 'Intercepting cache URL request',
    });

    event.respondWith(
      handleCacheUrlRequest(event.request)
        .then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            cached: response.status === 200,
          });
          return response;
        })
        .catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime,
          });
          throw error;
        })
    );
    return;
  }

  // 拦截素材库 URL 请求 (/asset-library/{assetId}.{ext})
  if (url.pathname.startsWith(ASSET_LIBRARY_PREFIX)) {
    // console.log('Service Worker: Intercepting asset library request:', event.request.url);
    const debugId = addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'asset-library',
      details: 'Intercepting asset library request',
    });

    event.respondWith(
      handleAssetLibraryRequest(event.request)
        .then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            cached: response.status === 200,
          });
          return response;
        })
        .catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime,
          });
          throw error;
        })
    );
    return;
  }

  // 注意：bypass_sw 和 direct_fetch 参数不再完全绕过 SW
  // 而是在 handleImageRequest 中跳过缓存检查直接 fetch，但仍会缓存响应
  // 这样可以确保绕过请求的响应也能被缓存，供后续正常请求使用

  // 放行监控服务域名（PostHog），让浏览器直接处理
  // 这些服务的请求失败不应该影响应用，也不需要记录到调试日志
  if (url.hostname.endsWith('.posthog.com')) {
    return; // 静默放行，不记录日志
  }

  // 完全不拦截备用域名，让浏览器直接处理
  if (url.hostname === 'cdn.i666.fun') {
    // console.log('Service Worker: 备用域名请求直接通过，不拦截:', url.href);
    addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'passthrough',
      details: 'Passthrough: cdn.i666.fun (fallback domain)',
      status: 0,
      duration: 0,
    });
    return; // 直接返回，让浏览器处理
  }

  // 放行火山引擎域名（seedream 模型图片），让浏览器直接用 <img> 标签加载
  // 这些域名不支持 CORS，但 <img> 标签可以直接加载
  if (
    url.hostname.endsWith('.volces.com') ||
    url.hostname.endsWith('.volccdn.com')
  ) {
    // console.log('Service Worker: 火山引擎域名请求直接通过，不拦截:', url.href);
    addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'passthrough',
      details: 'Passthrough: Volcengine domain (no CORS)',
      status: 0,
      duration: 0,
    });
    return; // 直接返回，让浏览器处理
  }

  // 放行阿里云OSS域名，这些域名不支持CORS fetch，但<img>标签可以直接加载
  if (url.hostname.endsWith('.aliyuncs.com')) {
    // console.log('Service Worker: 阿里云OSS域名请求直接通过，不拦截:', url.href);
    addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'passthrough',
      details: 'Passthrough: Aliyun OSS domain (no CORS)',
      status: 0,
      duration: 0,
    });
    return; // 直接返回，让浏览器处理
  }

  // 智能跳过：检查域名是否被标记为 CORS 问题域名
  if (isCorsFailedDomain(url.hostname)) {
    addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'passthrough',
      details: `Passthrough: ${url.hostname} (CORS failed domain, auto-detected)`,
      status: 0,
      duration: 0,
    });
    return; // 直接返回，让浏览器处理
  }

  // 放行 GitHub API 请求，让主线程的缓存机制生效
  // SW 拦截会导致每次都显示两个请求条目，且可能影响主线程缓存
  if (url.hostname === 'api.github.com') {
    return; // 静默放行，让浏览器直接处理
  }

  if (url.origin !== location.origin && isAudioRequest(url, event.request)) {
    const startTime = Date.now();
    const rangeHeader = event.request.headers.get('range');
    const debugId = addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'audio',
      headers: rangeHeader ? { range: rangeHeader } : undefined,
      details: rangeHeader
        ? `Audio Range request: ${rangeHeader}`
        : 'External audio request',
    });

    event.respondWith(
      handleAudioRequest(event.request)
        .then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            cached: response.headers.has(SW_CACHE_DATE_HEADER),
            responseHeaders: {
              'content-type': response.headers.get('content-type') || '',
              'content-length': response.headers.get('content-length') || '',
              'content-range': response.headers.get('content-range') || '',
            },
          });
          return response;
        })
        .catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime,
          });
          throw error;
        })
    );
    return;
  }

  // 拦截视频请求以支持 Range 请求
  if (isVideoRequest(url, event.request)) {
    // console.log('Service Worker: Intercepting video request:', url.href);
    const startTime = Date.now();
    const rangeHeader = event.request.headers.get('range');
    const debugId = addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'video',
      headers: rangeHeader ? { range: rangeHeader } : undefined,
      details: rangeHeader
        ? `Video Range request: ${rangeHeader}`
        : 'Video request',
    });

    event.respondWith(
      handleVideoRequest(event.request)
        .then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            responseHeaders: {
              'content-type': response.headers.get('content-type') || '',
              'content-length': response.headers.get('content-length') || '',
              'content-range': response.headers.get('content-range') || '',
            },
          });
          return response;
        })
        .catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime,
          });
          throw error;
        })
    );
    return;
  }

  // 拦截字体请求（Google Fonts CSS 和字体文件）
  if (isFontRequest(url, event.request)) {
    // console.log('Service Worker: Intercepting font request:', url.href);
    const startTime = Date.now();
    const debugId = addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'font',
      details: 'Font request',
    });

    event.respondWith(
      handleFontRequest(event.request)
        .then((response) => {
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            cached: response.headers.has('sw-cache-date'),
          });
          return response;
        })
        .catch((error) => {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime,
          });
          throw error;
        })
    );
    return;
  }

  // 拦截外部图片请求（非同源且为图片格式）
  if (url.origin !== location.origin && isImageRequest(url, event.request)) {
    // 检查是否是最近失败的 URL，避免重复请求
    if (isUrlRecentlyFailed(event.request.url)) {
      addDebugLog({
        type: 'fetch',
        url: event.request.url,
        method: event.request.method,
        requestType: 'image',
        details: 'Skipped: recently failed URL (cached 404)',
        status: 404,
        duration: 0,
      });
      event.respondWith(
        new Response('', { status: 404, statusText: 'Not Found (cached)' })
      );
      return;
    }

    // console.log('Service Worker: Intercepting external image request:', url.href);
    const startTime = Date.now();
    const debugId = addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'image',
      details: 'External image request',
    });

    event.respondWith(
      handleImageRequest(event.request)
        .then((response) => {
          // 如果是 404，标记为失败 URL
          if (response.status === 404) {
            markUrlAsFailed(event.request.url);
          }
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            cached: response.headers.has('sw-cache-date'),
            size: parseInt(response.headers.get('content-length') || '0'),
          });
          return response;
        })
        .catch((error) => {
          // 网络错误也标记为失败
          markUrlAsFailed(event.request.url);
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime,
          });
          throw error;
        })
    );
    return;
  }

  // Handle static file requests with cache-first strategy
  // Handle navigation requests and static resources (JS, CSS, images, fonts, etc.)
  // Note: For navigation requests, destination might be empty or 'document'
  // In development mode, we still need to handle requests when offline
  if (event.request.method === 'GET') {
    const isNavigationRequest = event.request.mode === 'navigate';
    const isStaticResource = event.request.destination !== '';

    // Handle both navigation requests and static resources
    if (isNavigationRequest || isStaticResource) {
      const startTime = Date.now();
      const debugId = addDebugLog({
        type: 'fetch',
        url: event.request.url,
        method: event.request.method,
        requestType: 'static',
        details: isNavigationRequest
          ? 'Navigation request'
          : `Static resource (${event.request.destination})`,
      });

      event.respondWith(
        handleStaticRequest(event.request)
          .then((response) => {
            const staticMetadata = getStaticDebugMetadata(response);
            updateDebugLog(debugId, {
              status: response.status,
              statusText: response.statusText,
              responseType: response.type,
              duration: Date.now() - startTime,
              resourceSource: staticMetadata.resourceSource,
              resourceFetchTarget: staticMetadata.resourceFetchTarget,
              details: isNavigationRequest
                ? 'Navigation request'
                : [
                    `Static resource (${event.request.destination})`,
                    staticMetadata.resourceSource
                      ? `来源: ${staticMetadata.resourceSource}`
                      : null,
                    staticMetadata.resourceFetchTarget
                      ? `实际拉取: ${staticMetadata.resourceFetchTarget}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('\n'),
            });
            return response;
          })
          .catch((error) => {
            updateDebugLog(debugId, {
              error: String(error),
              duration: Date.now() - startTime,
            });
            throw error;
          })
      );
      return;
    }
  }

  // 对于其他请求（如 XHR/API 请求），在调试模式下拦截以记录日志
  // 非调试模式下让浏览器直接处理
  if (debugModeEnabled) {
    // generateContent 长请求可能持续数分钟，调试模式下不应由 SW 读取请求/响应体，
    // 否则会放大长请求和流式请求的失败风险。
    if (isGenerateContentRequest(url)) {
      addDebugLog({
        type: 'fetch',
        url: event.request.url,
        method: event.request.method,
        requestType: 'xhr',
        details: `Skipped SW debug interception for generateContent request (${event.request.method})`,
        duration: 0,
      });
      return;
    }

    const debugId = addDebugLog({
      type: 'fetch',
      url: event.request.url,
      method: event.request.method,
      requestType: 'xhr',
      details: `XHR/API request (${event.request.method})`,
    });

    event.respondWith(
      (async () => {
        try {
          // 克隆请求以读取 body
          const requestClone = event.request.clone();
          let requestBody: string | undefined;
          const requestHeaders: Record<string, string> = {};

          // 提取请求头
          event.request.headers.forEach((value, key) => {
            requestHeaders[key] = value;
          });

          // 尝试读取请求体（仅限 POST/PUT/PATCH）
          if (['POST', 'PUT', 'PATCH'].includes(event.request.method)) {
            try {
              const contentType =
                event.request.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                requestBody = await requestClone.text();
                // 限制长度，避免日志过大
                if (requestBody.length > 2000) {
                  requestBody =
                    requestBody.substring(0, 2000) + '... (truncated)';
                }
              } else if (
                contentType.includes('application/x-www-form-urlencoded')
              ) {
                requestBody = await requestClone.text();
                if (requestBody.length > 2000) {
                  requestBody =
                    requestBody.substring(0, 2000) + '... (truncated)';
                }
              } else {
                requestBody = `[${contentType || 'binary data'}]`;
              }
            } catch {
              requestBody = '[unable to read body]';
            }
          }

          // 更新日志添加请求信息
          updateDebugLog(debugId, {
            headers: requestHeaders,
            details: requestBody
              ? `XHR/API request (${event.request.method})\n\nRequest Body:\n${requestBody}`
              : `XHR/API request (${event.request.method})`,
          });

          // 发起实际请求
          const response = await fetch(event.request);

          // 克隆响应以读取 body
          const responseClone = response.clone();
          let responseBody: string | undefined;
          const responseHeaders: Record<string, string> = {};

          // 提取响应头
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });

          // 尝试读取响应体
          try {
            const contentType = response.headers.get('content-type') || '';
            if (
              contentType.includes('application/json') ||
              contentType.includes('text/')
            ) {
              responseBody = await responseClone.text();
              // 限制长度
              if (responseBody.length > 5000) {
                responseBody =
                  responseBody.substring(0, 5000) + '... (truncated)';
              }
            } else {
              responseBody = `[${contentType || 'binary data'}] (${
                response.headers.get('content-length') || 'unknown'
              } bytes)`;
            }
          } catch {
            responseBody = '[unable to read response body]';
          }

          // 更新日志添加响应信息
          updateDebugLog(debugId, {
            status: response.status,
            statusText: response.statusText,
            responseType: response.type,
            duration: Date.now() - startTime,
            responseHeaders,
            size: parseInt(response.headers.get('content-length') || '0'),
            details: requestBody
              ? `XHR/API request (${event.request.method})\n\nRequest Body:\n${requestBody}\n\nResponse Body:\n${responseBody}`
              : `XHR/API request (${event.request.method})\n\nResponse Body:\n${responseBody}`,
          });

          return response;
        } catch (error) {
          updateDebugLog(debugId, {
            error: String(error),
            duration: Date.now() - startTime,
          });
          throw error;
        }
      })()
    );
    return;
  }

  // 非调试模式下，XHR/API 请求不拦截，让浏览器直接处理
});

// 处理字体请求（Google Fonts CSS 和字体文件）
async function handleFontRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = Math.random().toString(36).substring(2, 10);

  try {
    // 使用 Cache-First 策略：优先从缓存读取
    const cache = await caches.open(FONT_CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      // console.log(`Service Worker [Font-${requestId}]: 从缓存返回字体:`, url.href);
      return cachedResponse;
    }

    // 缓存未命中，从网络获取
    // console.log(`Service Worker [Font-${requestId}]: 从网络下载字体:`, url.href);
    const response = await fetch(request);

    // 只缓存成功的响应
    if (response && response.status === 200) {
      // 克隆响应用于缓存
      const responseToCache = response.clone();

      // 添加自定义头部标记缓存时间
      const headers = new Headers(responseToCache.headers);
      const now = Date.now().toString();
      headers.set(SW_CACHE_DATE_HEADER, now);
      headers.set(SW_CACHE_CREATED_AT_HEADER, now);

      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers,
      });

      // 异步缓存，不阻塞响应
      cache.put(request, cachedResponse).catch((error) => {
        console.warn(
          `Service Worker [Font-${requestId}]: 缓存字体失败:`,
          error
        );
      });

      // console.log(`Service Worker [Font-${requestId}]: 字体已缓存:`, url.href);
    }

    return response;
  } catch (error) {
    console.error(`Service Worker [Font-${requestId}]: 字体请求失败:`, error);

    // 尝试从缓存返回（离线场景）
    const cache = await caches.open(FONT_CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      // console.log(`Service Worker [Font-${requestId}]: 网络失败，从缓存返回:`, url.href);
      return cachedResponse;
    }

    // 返回错误响应
    return new Response('Font loading failed', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}

// Quick fetch without retries - for cache-first scenarios
async function fetchQuick(
  request: Request,
  fetchOptions: any = {}
): Promise<Response> {
  return fetch(request, fetchOptions);
}

function getVirtualMediaCacheKeys(request: Request, url: URL): string[] {
  const canonicalUrl = buildNormalizedCacheUrl(request.url);
  const scopeRelativePathname = getScopeRelativePathname(url.pathname);

  return Array.from(
    new Set([
      scopeRelativePathname,
      url.pathname,
      canonicalUrl.toString(),
      request.url,
    ])
  );
}

async function hasCachedMediaResponse(
  cache: Cache,
  cacheKeys: string[]
): Promise<boolean> {
  for (const cacheKey of cacheKeys) {
    const response = await cache.match(cacheKey);
    if (!response) continue;

    try {
      const blob = await response.clone().blob();
      if (blob.size > 0) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

// 处理缓存 URL 请求 (/__aitu_cache__/{type}/{taskId}.{ext})
// 从 Cache API 获取合并媒体并返回，视频支持 Range 请求
async function handleCacheUrlRequest(request: Request): Promise<Response> {
  const requestCacheEpoch = getMediaCacheEpoch();
  const requestId = Math.random().toString(36).substring(2, 10);
  const url = new URL(request.url);
  const rangeHeader = request.headers.get('range');
  const isAudio =
    url.pathname.includes('/audio/') ||
    AUDIO_EXTENSIONS_REGEX.test(url.pathname);

  // 通过路径或扩展名判断是否为视频
  const isVideo =
    url.pathname.includes('/video/') || /\.(mp4|webm|mov)$/i.test(url.pathname);

  // 参数优先级：bypass_sw > _retry > thumbnail
  const bypassCache =
    url.searchParams.has('bypass_sw') || url.searchParams.has('direct_fetch');
  const isRetryRequest = url.searchParams.has('_retry');

  // 检测是否为预览图请求（只有在没有 bypass_sw 和 _retry 时才处理）
  const isThumbnailRequest =
    url.searchParams.has('thumbnail') && !bypassCache && !isRetryRequest;

  if (isThumbnailRequest) {
    // 获取预览图尺寸（small 或 large，默认 small）
    const thumbnailSize = (url.searchParams.get('thumbnail') || 'small') as
      | 'small'
      | 'large';
    // 构建缓存 key：移除所有控制参数
    const originalUrlForCache = new URL(url.toString());
    originalUrlForCache.searchParams.delete('thumbnail');
    originalUrlForCache.searchParams.delete('bypass_sw');
    originalUrlForCache.searchParams.delete('direct_fetch');
    originalUrlForCache.searchParams.delete('_retry');

    const { findThumbnailWithFallback, createThumbnailResponse } = await import(
      './task-queue/utils/thumbnail-utils'
    );
    const result = await findThumbnailWithFallback(
      originalUrlForCache.toString(),
      thumbnailSize,
      [url.pathname] // 备用 key：pathname
    );

    if (result) {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const originalCacheKeys = getVirtualMediaCacheKeys(
        new Request(originalUrlForCache.toString()),
        originalUrlForCache
      );
      if (!(await hasCachedMediaResponse(cache, originalCacheKeys))) {
        await notifyImageCacheFailed(
          originalUrlForCache.toString(),
          'thumbnail_exists_original_missing'
        );
      }
      const blob = await result.response.blob();
      return createThumbnailResponse(blob);
    }

    // 预览图不存在，回退到原图（继续正常流程）
  }

  try {
    // 从 Cache API 获取
    const cache = await caches.open(IMAGE_CACHE_NAME);

    let cachedResponse: Response | undefined;
    for (const cacheKey of getVirtualMediaCacheKeys(request, url)) {
      cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        break;
      }
    }

    if (cachedResponse) {
      const blob = await cachedResponse.blob();

      // 如果是预览图请求且预览图不存在，异步生成预览图（不阻塞响应）
      if (isThumbnailRequest && !isVideo) {
        const { generateThumbnailAsync } = await import(
          './task-queue/utils/thumbnail-utils'
        );
        generateThumbnailAsync(
          blob,
          url.pathname,
          'image',
          undefined,
          requestCacheEpoch
        );
      }

      if (isVideo) {
        // 视频请求支持 Range
        return createVideoResponse(blob, rangeHeader, requestId);
      }

      if (isAudio) {
        return createAudioResponse(blob, rangeHeader, requestId);
      }

      // 图片请求 - 直接返回完整响应
      return new Response(blob, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': blob.type || 'image/png',
          'Content-Length': blob.size.toString(),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=31536000', // 1年
        },
      });
    }

    // 如果 Cache API 没有，返回 404。fetch 调试面板会记录状态，避免正常 miss 刷控制台。
    return new Response('Media not found', {
      status: 404,
      statusText: 'Not Found',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  } catch (error) {
    console.error(`Service Worker: Error handling cache URL request:`, error);
    return new Response('Internal error', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}

// 处理素材库 URL 请求 (/asset-library/{assetId}.{ext})
// 从 Cache API 获取素材库媒体并返回，支持 Range 请求（视频）
async function handleAssetLibraryRequest(request: Request): Promise<Response> {
  const requestCacheEpoch = getMediaCacheEpoch();
  const requestId = Math.random().toString(36).substring(2, 10);
  const url = new URL(request.url);
  const rangeHeader = request.headers.get('range');

  // 使用完整路径作为缓存 key
  const cacheKey = url.pathname;

  // 参数优先级：bypass_sw > _retry > thumbnail
  const bypassCache =
    url.searchParams.has('bypass_sw') || url.searchParams.has('direct_fetch');
  const isRetryRequest = url.searchParams.has('_retry');

  // 检测是否为预览图请求（只有在没有 bypass_sw 和 _retry 时才处理）
  const isThumbnailRequest =
    url.searchParams.has('thumbnail') && !bypassCache && !isRetryRequest;

  if (isThumbnailRequest) {
    // 获取预览图尺寸（small 或 large，默认 small）
    const thumbnailSize = (url.searchParams.get('thumbnail') || 'small') as
      | 'small'
      | 'large';

    const { findThumbnailWithFallback, createThumbnailResponse } = await import(
      './task-queue/utils/thumbnail-utils'
    );
    const result = await findThumbnailWithFallback(
      cacheKey,
      thumbnailSize,
      [cacheKey] // 备用 key：cacheKey（pathname）
    );

    if (result) {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const originalCacheKeys = getVirtualMediaCacheKeys(
        new Request(url.toString(), { method: request.method }),
        url
      );
      if (!(await hasCachedMediaResponse(cache, originalCacheKeys))) {
        await notifyImageCacheFailed(
          url.pathname,
          'thumbnail_exists_original_missing'
        );
      }
      const blob = await result.response.blob();
      return createThumbnailResponse(blob);
    }

    // 预览图不存在，回退到原图（继续正常流程）
  }

  // console.log(`Service Worker [Asset-${requestId}]: Handling asset library request:`, cacheKey);

  try {
    // 从 Cache API 获取
    const cache = await caches.open(IMAGE_CACHE_NAME);
    let cachedResponse: Response | undefined;
    for (const candidateKey of getVirtualMediaCacheKeys(request, url)) {
      cachedResponse = await cache.match(candidateKey);
      if (cachedResponse) {
        break;
      }
    }

    if (cachedResponse) {
      // console.log(`Service Worker [Asset-${requestId}]: Found cached asset:`, cacheKey);
      const blob = await cachedResponse.blob();

      // 检查是否是视频/音频请求
      const isVideo = url.pathname.match(/\.(mp4|webm|mov)$/i);
      const isAudio = AUDIO_EXTENSIONS_REGEX.test(url.pathname);

      // 如果是预览图请求且预览图不存在，异步生成预览图（不阻塞响应）
      if (isThumbnailRequest && !isVideo) {
        const { generateThumbnailAsync } = await import(
          './task-queue/utils/thumbnail-utils'
        );
        generateThumbnailAsync(
          blob,
          cacheKey,
          'image',
          undefined,
          requestCacheEpoch
        );
      }

      if (isVideo && rangeHeader) {
        // 视频请求支持 Range
        return createVideoResponse(blob, rangeHeader, requestId);
      }

      if (isAudio) {
        return createAudioResponse(blob, rangeHeader, requestId);
      }

      // 图片或完整视频请求
      return new Response(blob, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': blob.type || 'application/octet-stream',
          'Content-Length': blob.size.toString(),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=31536000', // 1年
        },
      });
    }

    // 如果 Cache API 没有，返回 404。fetch 调试面板会记录状态，避免正常 miss 刷控制台。
    return new Response('Asset not found', {
      status: 404,
      statusText: 'Not Found',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  } catch (error) {
    console.error(
      `Service Worker [Asset-${requestId}]: Error handling asset library request:`,
      error
    );
    return new Response('Internal error', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}

async function handleAudioRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = Math.random().toString(36).substring(2, 10);
  const requestCacheEpoch = getMediaCacheEpoch();
  const rangeHeader = request.headers.get('range');
  const dedupeUrl = buildNormalizedCacheUrl(url);
  const dedupeKey = dedupeUrl.toString();

  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    let cachedResponse = await cache.match(dedupeKey);
    if (!cachedResponse && dedupeKey !== request.url) {
      cachedResponse = await cache.match(request.url);
    }

    if (cachedResponse) {
      try {
        const cachedBlob = await cachedResponse.clone().blob();
        return createAudioResponse(cachedBlob, rangeHeader, requestId);
      } catch {
        return cachedResponse;
      }
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete('range');
    const response = await fetch(dedupeKey, {
      method: 'GET',
      headers: requestHeaders,
      mode: request.mode,
      credentials: request.credentials,
      cache: 'no-store',
      referrerPolicy: request.referrerPolicy || 'no-referrer',
    });

    if (!response.ok) {
      return response;
    }

    if (response.type === 'opaque') {
      if (isMediaCacheEpochCurrent(requestCacheEpoch)) {
        putMediaCacheEntry(
          cache,
          dedupeKey,
          response.clone(),
          requestCacheEpoch
        ).catch((error) => {
          console.warn(
            `Service Worker [Audio-${requestId}]: Failed to cache opaque audio response:`,
            error
          );
        });
      }
      return response;
    }

    const blob = await response.blob();
    const mimeType =
      response.headers.get('Content-Type') || blob.type || 'audio/mpeg';
    const now = Date.now().toString();
    const cacheResponse = new Response(blob, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': blob.size.toString(),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'Content-Range, Accept-Ranges, Content-Length',
        [SW_CACHE_DATE_HEADER]: now,
        [SW_CACHE_CREATED_AT_HEADER]: now,
        'sw-image-size': blob.size.toString(),
      },
    });

    if (isMediaCacheEpochCurrent(requestCacheEpoch)) {
      await putMediaCacheEntry(
        cache,
        dedupeKey,
        cacheResponse.clone(),
        requestCacheEpoch
      );
    }

    return createAudioResponse(blob, rangeHeader, requestId, mimeType);
  } catch (error) {
    console.error(
      `Service Worker [Audio-${requestId}]: Audio loading failed:`,
      error
    );
    const cache = await caches.open(IMAGE_CACHE_NAME);
    let cachedResponse = await cache.match(dedupeKey);
    if (!cachedResponse && dedupeKey !== request.url) {
      cachedResponse = await cache.match(request.url);
    }
    if (cachedResponse) {
      try {
        const cachedBlob = await cachedResponse.clone().blob();
        return createAudioResponse(cachedBlob, rangeHeader, requestId);
      } catch {
        return cachedResponse;
      }
    }

    return new Response('Audio loading error', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}

// Sentinel：视频下载失败时返回此值，避免 throw 导致 Uncaught (in promise)
const VIDEO_LOAD_ERROR = Symbol('VIDEO_LOAD_ERROR');

// 处理视频请求,支持 Range 请求以实现视频 seek 功能
async function handleVideoRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = Math.random().toString(36).substring(2, 10);
  const requestCacheEpoch = getMediaCacheEpoch();
  // console.log(`Service Worker [Video-${requestId}]: Handling video request:`, url.href);

  try {
    // 检查请求是否包含 Range header
    const rangeHeader = request.headers.get('range');
    // console.log(`Service Worker [Video-${requestId}]: Range header:`, rangeHeader);

    // 参数优先级：bypass_sw > _retry > thumbnail
    const bypassCache =
      url.searchParams.has('bypass_sw') || url.searchParams.has('direct_fetch');
    const isRetryRequest = url.searchParams.has('_retry');

    // 检测是否为预览图请求（只有在没有 bypass_sw 和 _retry 时才处理）
    const isThumbnailRequest =
      url.searchParams.has('thumbnail') && !bypassCache && !isRetryRequest;

    // 创建去重键（移除缓存破坏参数）
    const dedupeUrl = buildNormalizedCacheUrl(url);
    const dedupeKey = dedupeUrl.toString();

    // 如果是预览图请求（没有 bypass_sw 和 _retry），查找预览图
    if (isThumbnailRequest) {
      // 获取预览图尺寸（small 或 large，默认 small）
      const thumbnailSize = (url.searchParams.get('thumbnail') || 'small') as
        | 'small'
        | 'large';

      const { findThumbnailWithFallback, createThumbnailResponse } =
        await import('./task-queue/utils/thumbnail-utils');
      const result = await findThumbnailWithFallback(dedupeKey, thumbnailSize);

      if (result) {
        const blob = await result.response.blob();
        return createThumbnailResponse(blob);
      }

      void (async () => {
        try {
          const { generateThumbnailAsync } = await import(
            './task-queue/utils/thumbnail-utils'
          );
          generateThumbnailAsync(
            new Blob([], { type: 'video/mp4' }),
            dedupeKey,
            'video',
            [thumbnailSize],
            requestCacheEpoch
          );
        } catch {
          return;
        }
      })();

      return new Response('Thumbnail not ready', {
        status: 404,
        statusText: 'Thumbnail Not Ready',
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store',
        },
      });
    }

    // 检查是否有相同视频正在下载
    const existingEntry = pendingVideoRequests.get(dedupeKey);
    if (existingEntry) {
      existingEntry.count = (existingEntry.count || 1) + 1;
      // const waitTime = Date.now() - existingEntry.timestamp;

      // console.log(`Service Worker [Video-${requestId}]: 发现重复视频请求 (等待${waitTime}ms)，复用下载Promise:`, dedupeKey);
      // console.log(`Service Worker [Video-${requestId}]: 重复请求计数: ${existingEntry.count}`);

      // 等待视频下载完成
      const videoBlob = await existingEntry.promise;

      // 下载失败（404/403 等），返回 500
      if (videoBlob === VIDEO_LOAD_ERROR) {
        return new Response('Video loading error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      // 服务器支持 Range，重新 fetch
      if (videoBlob === null) {
        const fetchOptions = {
          method: 'GET',
          headers: new Headers(request.headers),
          mode: 'cors' as RequestMode,
          credentials: 'omit' as RequestCredentials,
        };
        return await fetch(url, fetchOptions);
      }

      // 使用缓存的blob响应Range请求
      return createVideoResponse(videoBlob as Blob, rangeHeader, requestId);
    }

    // 检查是否已有缓存的视频Blob（内存缓存）
    if (videoBlobCache.has(dedupeKey)) {
      const cacheEntry = videoBlobCache.get(dedupeKey);
      if (cacheEntry) {
        // console.log(`Service Worker [Video-${requestId}]: 使用内存缓存的视频Blob (缓存时间: ${Math.round((Date.now() - cacheEntry.timestamp) / 1000)}秒)`);

        // 更新访问时间
        cacheEntry.timestamp = Date.now();

        return createVideoResponse(cacheEntry.blob, rangeHeader, requestId);
      }
    }

    // 检查 Cache API 持久化缓存
    try {
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const cachedResponse = await cache.match(dedupeKey);
      if (cachedResponse) {
        // console.log(`Service Worker [Video-${requestId}]: 从 Cache API 恢复视频缓存`);
        const videoBlob = await cachedResponse.blob();
        const videoSizeMB = videoBlob.size / (1024 * 1024);

        // 恢复到内存缓存（用于后续快速访问）
        if (videoSizeMB < 50 && isMediaCacheEpochCurrent(requestCacheEpoch)) {
          videoBlobCache.set(dedupeKey, {
            blob: videoBlob,
            timestamp: Date.now(),
          });
          // console.log(`Service Worker [Video-${requestId}]: 视频已恢复到内存缓存`);
        }

        return createVideoResponse(videoBlob, rangeHeader, requestId);
      }
    } catch {
      // 检查 Cache API 失败，继续下载
    }

    // 创建新的视频下载Promise
    // console.log(`Service Worker [Video-${requestId}]: 开始下载新视频:`, dedupeKey);

    const downloadPromise = (async () => {
      try {
        // 构建请求选项
        const fetchOptions = {
          method: 'GET',
          mode: 'cors' as RequestMode,
          credentials: 'omit' as RequestCredentials,
          cache: 'default' as RequestCache, // 使用浏览器默认缓存策略
        };

        // 获取视频响应（不带Range header，获取完整视频）
        const fetchUrl = new URL(dedupeUrl);
        const response = await fetch(fetchUrl, fetchOptions);

        if (!response.ok) {
          return VIDEO_LOAD_ERROR;
        }

        // 如果服务器返回206，说明服务器原生支持Range，直接返回不缓存
        if (response.status === 206) {
          // console.log(`Service Worker [Video-${requestId}]: 服务器原生支持Range请求，直接返回`);
          return null; // 返回null表示不缓存，直接使用服务器响应
        }

        // 下载完整视频
        // console.log(`Service Worker [Video-${requestId}]: 开始下载完整视频...`);
        const videoBlob = await response.blob();
        const videoSizeMB = videoBlob.size / (1024 * 1024);
        // console.log(`Service Worker [Video-${requestId}]: 视频下载完成 (大小: ${videoSizeMB.toFixed(2)}MB)`);

        // 缓存视频Blob（仅缓存小于50MB的视频）
        const finishCacheOperation =
          videoSizeMB < 50 ? beginMediaCacheOperation(requestCacheEpoch) : null;
        if (finishCacheOperation) {
          try {
            // 1. 内存缓存（用于当前会话快速访问）
            videoBlobCache.set(dedupeKey, {
              blob: videoBlob,
              timestamp: Date.now(),
            });
            // 2. 持久化到 Cache API（用于跨会话持久化）
            try {
              const cache = await caches.open(IMAGE_CACHE_NAME);
              const cacheResponse = new Response(videoBlob, {
                headers: {
                  'Content-Type': videoBlob.type || 'video/mp4',
                  'Content-Length': videoBlob.size.toString(),
                  [SW_CACHE_DATE_HEADER]: Date.now().toString(),
                  [SW_CACHE_CREATED_AT_HEADER]: Date.now().toString(),
                  'sw-video-size': videoBlob.size.toString(),
                },
              });
              await cache.put(dedupeKey, cacheResponse);
              const { generateThumbnailAsync } = await import(
                './task-queue/utils/thumbnail-utils'
              );
              generateThumbnailAsync(
                videoBlob,
                dedupeKey,
                'video',
                undefined,
                requestCacheEpoch
              );
            } catch {
              // 持久化到 Cache API 失败，内存缓存仍可用
            }
          } finally {
            finishCacheOperation();
          }
        }

        return videoBlob;
      } catch {
        return VIDEO_LOAD_ERROR;
      }
    })();

    // 将下载Promise存储到去重字典
    pendingVideoRequests.set(dedupeKey, {
      promise: downloadPromise,
      timestamp: Date.now(),
      count: 1,
      requestId: requestId,
    });

    // 下载完成后从字典中移除
    downloadPromise.finally(() => {
      const entry = pendingVideoRequests.get(dedupeKey);
      if (entry?.promise === downloadPromise) {
        // const totalTime = Date.now() - entry.timestamp;
        // console.log(`Service Worker [Video-${requestId}]: 视频下载完成 (耗时${totalTime}ms，请求计数: ${entry.count})`);
        pendingVideoRequests.delete(dedupeKey);
      }
    });

    // 等待视频下载完成
    const videoBlob = await downloadPromise;

    // 下载失败（404/403 等），返回 500 让前端处理
    if (videoBlob === VIDEO_LOAD_ERROR) {
      return new Response('Video loading error', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // 如果返回null，说明服务器支持Range，重新发送原始请求
    if (videoBlob === null) {
      const fetchOptions = {
        method: 'GET',
        headers: new Headers(request.headers),
        mode: 'cors' as RequestMode,
        credentials: 'omit' as RequestCredentials,
      };
      return await fetch(url, fetchOptions);
    }

    // 使用下载的blob响应Range请求
    return createVideoResponse(videoBlob as Blob, rangeHeader, requestId);
  } catch {
    return new Response('Video loading error', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  }
}

// 创建视频响应，支持Range请求
function createVideoResponse(
  videoBlob: Blob,
  rangeHeader: string | null,
  requestId: string
): Response {
  return createBufferedMediaResponse(
    videoBlob,
    rangeHeader,
    requestId,
    videoBlob.type || 'video/mp4'
  );
}

function createAudioResponse(
  audioBlob: Blob,
  rangeHeader: string | null,
  requestId: string,
  mimeType?: string
): Response {
  return createBufferedMediaResponse(
    audioBlob,
    rangeHeader,
    requestId,
    mimeType || audioBlob.type || 'audio/mpeg'
  );
}

function createBufferedMediaResponse(
  mediaBlob: Blob,
  rangeHeader: string | null,
  _requestId: string,
  mimeType: string
): Response {
  const mediaSize = mediaBlob.size;

  // 如果没有Range请求，返回完整媒体
  if (!rangeHeader) {
    return new Response(mediaBlob, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': mediaSize.toString(),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'Content-Range, Accept-Ranges, Content-Length',
      },
    });
  }

  // 解析Range header (格式: "bytes=start-end")
  const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!rangeMatch) {
    return new Response(mediaBlob, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const start = parseInt(rangeMatch[1], 10);
  const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : mediaSize - 1;

  // 提取指定范围的数据
  const slicedBlob = mediaBlob.slice(start, end + 1);
  const contentLength = end - start + 1;

  // 构建206 Partial Content响应
  return new Response(slicedBlob, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': mimeType,
      'Content-Range': `bytes ${start}-${end}/${mediaSize}`,
      'Content-Length': contentLength.toString(),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers':
        'Content-Range, Accept-Ranges, Content-Length',
    },
  });
}

async function handleStaticRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const staticTargets = resolveStaticResourceFetchTargets(request.url);
  const normalizedCacheKey = staticTargets.cacheKey;
  const scopeRelativePathname = getScopeRelativePathname(url.pathname);
  const isAppShellRequest = shouldUseAppShellStrategy(
    request.mode,
    scopeRelativePathname
  );
  const versionState = await readVersionState();
  const committedVersion = versionState.committedVersion || APP_VERSION;
  const committedStaticCacheName = getStaticCacheName(committedVersion);
  const cache = await caches.open(committedStaticCacheName);

  // ===========================================
  // Development Mode: Network First (for hot reload / live updates)
  // Still caches for offline testing, but always tries network first
  // ===========================================
  if (isDevelopment) {
    try {
      const response = await fetchQuick(request);

      // Cache successful responses for offline testing
      if (
        response &&
        response.status === 200 &&
        request.url.startsWith('http')
      ) {
        cache.put(request, response.clone());
        return response;
      }

      // If server returns error response, try cache
      if (!response.ok) {
        let cachedResponse = await cache.match(request);

        if (!cachedResponse && isAppShellRequest) {
          cachedResponse = await cache.match(createScopeUrl('/').href);
          if (!cachedResponse) {
            cachedResponse = await cache.match(
              createScopeUrl('index.html').href
            );
          }
        }

        if (cachedResponse) {
          return cachedResponse;
        }

        // No cache, return the error response
        return response;
      }

      return response;
    } catch (networkError) {
      // Network failed (server stopped) - fall back to cache
      // console.warn('Dev mode: Network failed, trying cache');

      let cachedResponse = await cache.match(request);

      // For SPA navigation, fall back to index.html
      if (!cachedResponse && isAppShellRequest) {
        cachedResponse = await cache.match(createScopeUrl('/').href);
        if (!cachedResponse) {
          cachedResponse = await cache.match(createScopeUrl('index.html').href);
        }
      }

      if (cachedResponse) {
        return cachedResponse;
      }

      // No cache available
      if (isAppShellRequest) {
        return createOfflinePage();
      }
      return new Response('Resource unavailable', { status: 503 });
    }
  }

  // ===========================================
  // Production Mode: Optimized strategies
  // ===========================================

  // Strategy 1: HTML/Navigation - Cache first for already-controlled clients.
  // This keeps existing users on the old shell while the new worker prewarms
  // its own versioned cache in the background, and only switches after the
  // user explicitly confirms the upgrade.
  if (isAppShellRequest) {
    if (shouldBypassAppShellCacheForLazyChunkRecovery(url.search)) {
      try {
        const response = await fetchQuick(request, {
          cache: 'reload' as RequestCache,
        });

        if (
          response &&
          response.status === 200 &&
          request.url.startsWith('http')
        ) {
          cache.put(request, response.clone());

          logSWDebug('handleStaticRequest: refreshed app shell for recovery', {
            requestUrl: request.url,
            committedVersion,
            workerVersion: APP_VERSION,
          });
          return response;
        }

        if (response) {
          return response;
        }
      } catch (error) {
        logSWDebug('handleStaticRequest: recovery app shell refresh failed', {
          requestUrl: request.url,
          committedVersion,
          workerVersion: APP_VERSION,
          error: getSafeErrorMessage(error),
        });
      }
    }

    let cachedResponse = await cache.match(request);

    if (!cachedResponse) {
      cachedResponse = await cache.match(createScopeUrl('/').href);
    }
    if (!cachedResponse) {
      cachedResponse = await cache.match(createScopeUrl('index.html').href);
    }

    if (!cachedResponse) {
      const allCacheNames = await caches.keys();
      for (const cacheName of allCacheNames) {
        if (cacheName.startsWith('drawnix-static-v')) {
          try {
            const oldCache = await caches.open(cacheName);
            cachedResponse =
              (await oldCache.match(request)) ||
              (await oldCache.match(createScopeUrl('/').href)) ||
              (await oldCache.match(createScopeUrl('index.html').href));
            if (cachedResponse) {
              break;
            }
          } catch {
            // Ignore broken legacy caches and continue fallback lookup.
          }
        }
      }
    }

    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      // No cached shell available (typically first visit), fetch from network.
      const response = await fetchQuick(request, {
        cache: 'reload' as RequestCache,
      });

      // 只有 committed 版本与当前 worker 版本一致时，才回写到当前 cache。
      // staged update 期间避免把网络上的新壳写进旧版本 cache。
      if (
        response &&
        response.status === 200 &&
        request.url.startsWith('http') &&
        committedVersion === APP_VERSION
      ) {
        cache.put(request, response.clone());
        return response;
      }

      return response;
    } catch {
      // No cache - return offline page
      return createOfflinePage();
    }
  }

  // Strategy 2: Static Resources - Cache First (fast offline)
  const { response: cachedResponse, matchedBy } = await matchStaticCacheEntry(
    cache,
    request
  );
  if (cachedResponse) {
    if (
      !isSuspiciousStaticCacheResponse(
        request,
        cachedResponse,
        committedVersion
      )
    ) {
      if (matchedBy === 'normalized') {
        logSWDebug('handleStaticRequest: normalized static cache hit', {
          requestUrl: request.url,
          normalizedCacheKey,
        });
      }
      return cachedResponse;
    }

    await deleteStaticCacheLookupKeys(cache, request, normalizedCacheKey);
  }

  // Cache miss - versioned static assets (hashed js/css/images/fonts) get
  // an old-cache/browser-cache lookup before falling back to origin fetch.
  const resourcePath = staticTargets.resourcePath;
  const isVersionedAsset = isVersionedStaticResource(request, url);

  if (isVersionedAsset) {
    if (request.url !== normalizedCacheKey) {
      logSWDebug('handleStaticRequest: cross-origin static cache miss', {
        requestUrl: request.url,
        normalizedCacheKey,
        resourcePath,
        committedVersion,
      });
    }

    const oldCachedResponse = await findStaticResponseInOldCaches(request, [
      normalizedCacheKey,
    ]);
    if (oldCachedResponse) {
      return oldCachedResponse;
    }

    const browserCachedResponse = await findStaticResponseInBrowserCache(
      request,
      [normalizedCacheKey]
    );
    if (browserCachedResponse) {
      return browserCachedResponse;
    }

    const originResponse = await tryFetchVersionedStaticResourceFromOrigin(
      cache,
      request,
      resourcePath,
      committedVersion
    );
    if (originResponse) {
      return originResponse;
    }

    logStatic503Decision('versioned-resource-origin-failed', request, {
      resourcePath,
      committedVersion,
    });
    return new Response('Resource unavailable offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // 入口链路继续保持同源优先
  try {
    const response = await fetchQuick(request);

    const isInvalidResponse = isStaticHtmlFallbackResponse(
      request,
      url,
      response
    );

    if (isInvalidResponse) {
      console.warn(
        'Service Worker: HTML response for static resource (404 fallback), trying old caches:',
        request.url
      );

      const oldCachedResponse = await findStaticResponseInOldCaches(request, [
        normalizedCacheKey,
      ]);
      if (oldCachedResponse) {
        return oldCachedResponse;
      }

      return new Response('Resource not found', {
        status: 404,
        statusText: 'Not Found',
      });
    }

    // Cache successful responses
    if (
      response &&
      response.status === 200 &&
      request.url.startsWith('http') &&
      committedVersion === APP_VERSION
    ) {
      return await cacheStaticResponse(cache, request, response, {
        source: 'server',
        revision: 'runtime',
        appVersion: committedVersion,
      });
    }

    // If server returns error (4xx, 5xx), try to find any cached version from old caches
    // This is particularly useful if the static directory was deleted or server is misconfigured
    if (response.status >= 400) {
      // console.warn(`Service Worker: Server error ${response.status} for static resource:`, request.url);

      const oldCachedResponse = await findStaticResponseInOldCaches(request, [
        normalizedCacheKey,
      ]);
      if (oldCachedResponse) {
        return oldCachedResponse;
      }
    }

    return response;
  } catch (networkError) {
    console.warn('[SW] Network failed, trying old caches:', request.url);

    const oldCachedResponse = await findStaticResponseInOldCaches(request, [
      normalizedCacheKey,
    ]);
    if (oldCachedResponse) {
      return oldCachedResponse;
    }

    logStatic503Decision('origin-fetch-exception', request, {
      resourcePath,
      committedVersion,
    });
    // 所有来源都失败了
    return new Response('Resource unavailable offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// Create offline fallback page
function createOfflinePage(): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>离线 - Opentu</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      padding: 20px;
    }
    h1 { font-size: 2rem; margin-bottom: 1rem; }
    p { font-size: 1.1rem; opacity: 0.9; max-width: 400px; }
    button {
      margin-top: 2rem;
      padding: 12px 24px;
      font-size: 1rem;
      border: none;
      border-radius: 8px;
      background: white;
      color: #667eea;
      cursor: pointer;
      transition: transform 0.2s;
    }
    button:hover { transform: scale(1.05); }
  </style>
</head>
<body>
  <h1>📡 无法连接到服务器</h1>
  <p>Opentu 是一个以画布工作区为底座的 AI 应用平台，当前无法访问时请检查网络或稍后再试。</p>
  <button onclick="location.reload()">重试</button>
</body>
</html>`,
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}

// 图片请求超时时间（毫秒）
const IMAGE_REQUEST_TIMEOUT = 15000; // 15秒

// 过期请求清理阈值（毫秒）- 超过此时间的 pending 请求会被清理
const STALE_REQUEST_THRESHOLD = 30000; // 30秒

// 创建带超时的 Promise
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

// 清理过期的视频 Blob 缓存
function cleanupVideoBlobCache(): void {
  const now = Date.now();
  const staleKeys: string[] = [];

  // 1. 清理过期的视频（超过 TTL）
  videoBlobCache.forEach((entry, key) => {
    if (now - entry.timestamp > VIDEO_BLOB_CACHE_TTL) {
      staleKeys.push(key);
    }
  });

  if (staleKeys.length > 0) {
    // console.log(`Service Worker: 清理 ${staleKeys.length} 个过期的视频 Blob 缓存`);
    staleKeys.forEach((key) => videoBlobCache.delete(key));
  }

  // 2. 如果仍超过最大数量，删除最老的
  if (videoBlobCache.size > VIDEO_BLOB_CACHE_MAX_SIZE) {
    const entries = Array.from(videoBlobCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    const toDeleteCount = videoBlobCache.size - VIDEO_BLOB_CACHE_MAX_SIZE;
    const toDelete = entries.slice(0, toDeleteCount);

    if (toDelete.length > 0) {
      // console.log(`Service Worker: 视频缓存超过上限，清理 ${toDelete.length} 个最老的缓存`);
      toDelete.forEach(([key]) => videoBlobCache.delete(key));
    }
  }
}

// 清理过期的 pending 请求和已完成请求缓存
function cleanupStaleRequests(): void {
  const now = Date.now();

  // 清理过期的 pending 请求
  const stalePendingKeys: string[] = [];
  pendingImageRequests.forEach((entry, key) => {
    if (now - entry.timestamp > STALE_REQUEST_THRESHOLD) {
      stalePendingKeys.push(key);
    }
  });

  if (stalePendingKeys.length > 0) {
    console.warn(
      `Service Worker: 清理 ${stalePendingKeys.length} 个过期的 pending 请求`
    );
    stalePendingKeys.forEach((key) => pendingImageRequests.delete(key));
  }

  // 清理过期的已完成请求缓存
  const staleCompletedKeys: string[] = [];
  completedImageRequests.forEach((entry, key) => {
    if (now - entry.timestamp > COMPLETED_REQUEST_CACHE_TTL) {
      staleCompletedKeys.push(key);
    }
  });

  if (staleCompletedKeys.length > 0) {
    // console.log(`Service Worker: 清理 ${staleCompletedKeys.length} 个过期的已完成请求缓存`);
    staleCompletedKeys.forEach((key) => completedImageRequests.delete(key));
  }

  // 清理过期的视频 Blob 缓存
  cleanupVideoBlobCache();
}

async function handleImageRequest(request: Request): Promise<Response> {
  try {
    // 生成唯一的请求ID用于追踪
    const requestId = Math.random().toString(36).substring(2, 10);

    // console.log(`Service Worker [${requestId}]: Intercepting image request at ${new Date().toISOString()}:`, request.url);

    // 创建原始URL（不带缓存破坏参数）用于缓存键和去重键
    const originalUrl = new URL(request.url);

    // 参数优先级：bypass_sw > _retry > thumbnail
    // 检测是否要求绕过缓存检查（最高优先级）
    const bypassCache =
      originalUrl.searchParams.has('bypass_sw') ||
      originalUrl.searchParams.has('direct_fetch');

    // 检测是否为强制重试请求（次高优先级）
    const isRetryRequest = originalUrl.searchParams.has('_retry');

    // 检测是否为预览图请求（最低优先级，只有在没有 bypass_sw 和 _retry 时才处理）
    // bypass_sw 和 _retry 的存在表示用户明确要求获取原图或重新请求
    const isThumbnailRequest =
      originalUrl.searchParams.has('thumbnail') &&
      !bypassCache &&
      !isRetryRequest;

    // 在删除参数之前先获取预览图尺寸
    const thumbnailSize = isThumbnailRequest
      ? originalUrl.searchParams.get('thumbnail') || 'small'
      : 'small';

    const normalizedCacheUrl = buildNormalizedCacheUrl(originalUrl);
    const originalRequest = new Request(normalizedCacheUrl.toString(), {
      method: request.method,
      headers: request.headers,
      mode: request.mode,
      credentials: request.credentials,
    });
    const dedupeKey = normalizedCacheUrl.toString();

    // 如果是预览图请求（没有 bypass_sw 和 _retry），在移除参数后查找预览图
    if (isThumbnailRequest) {
      const { findThumbnailWithFallback, createThumbnailResponse } =
        await import('./task-queue/utils/thumbnail-utils');

      // 尝试使用 dedupeKey 和 originalRequest.url 作为备用 key
      const result = await findThumbnailWithFallback(
        dedupeKey,
        thumbnailSize as 'small' | 'large',
        [request.url, originalRequest.url] // 备用 key：兼容历史签名 URL 与 canonical key
      );

      if (result) {
        const blob = await result.response.blob();
        return createThumbnailResponse(blob);
      }

      // 如果都没找到，回退到原图（继续正常流程）
    }

    // 首先检查是否有最近完成的相同请求（内存缓存）
    const completedEntry = completedImageRequests.get(dedupeKey);
    if (completedEntry) {
      const elapsed = Date.now() - completedEntry.timestamp;
      if (elapsed < COMPLETED_REQUEST_CACHE_TTL) {
        // console.log(`Service Worker [${requestId}]: 命中已完成请求缓存 (${elapsed}ms ago):`, dedupeKey);
        return completedEntry.response.clone();
      } else {
        // 缓存过期，清理
        completedImageRequests.delete(dedupeKey);
      }
    }

    // 检查是否有相同的请求正在进行
    if (pendingImageRequests.has(dedupeKey)) {
      const existingEntry = pendingImageRequests.get(dedupeKey);
      if (existingEntry) {
        // 检查请求是否已过期（卡住了）
        const elapsed = Date.now() - existingEntry.timestamp;
        if (elapsed > STALE_REQUEST_THRESHOLD) {
          console.warn(
            `Service Worker [${requestId}]: 发现过期的 pending 请求 (${elapsed}ms)，清理并重新发起:`,
            dedupeKey
          );
          pendingImageRequests.delete(dedupeKey);
          // 继续执行下面的新请求逻辑
        } else {
          existingEntry.count = (existingEntry.count || 1) + 1;
          // const waitTime = Date.now() - existingEntry.timestamp;

          // console.log(`Service Worker [${requestId}]: 发现重复请求 (等待${waitTime}ms)，返回已有Promise:`, dedupeKey);
          // console.log(`Service Worker [${requestId}]: 重复请求计数: ${existingEntry.count}`, dedupeKey);

          // 为重复请求添加标记，便于追踪
          existingEntry.duplicateRequestIds =
            existingEntry.duplicateRequestIds || [];
          existingEntry.duplicateRequestIds.push(requestId);

          // Response body 只能被消费一次，重复请求需要返回克隆
          try {
            const response = await withTimeout(
              existingEntry.promise,
              IMAGE_REQUEST_TIMEOUT,
              'Image request timeout'
            );
            return response && response.clone ? response.clone() : response;
          } catch (timeoutError: any) {
            if (timeoutError.message === 'Image request timeout') {
              console.warn(
                `Service Worker [${requestId}]: 重复请求等待超时，清理并返回超时响应让前端直接加载`
              );
              // 超时后主动清理该条目，避免后续请求继续等待
              pendingImageRequests.delete(dedupeKey);
              return createTimeoutResponse(request.url, requestId);
            }
            throw timeoutError;
          }
        }
      }
    }

    // 定期清理过期请求（每次新请求时检查）
    cleanupStaleRequests();

    // 创建请求处理Promise并存储到去重字典
    const requestCacheEpoch = getMediaCacheEpoch();
    const requestPromise = handleImageRequestInternal(
      originalRequest,
      request.url,
      dedupeKey,
      requestId,
      bypassCache,
      isThumbnailRequest ? (thumbnailSize as 'small' | 'large') : undefined,
      requestCacheEpoch
    );

    // 将Promise存储到去重字典中，包含时间戳和计数
    pendingImageRequests.set(dedupeKey, {
      promise: requestPromise,
      timestamp: Date.now(),
      count: 1,
      originalRequestId: requestId,
      duplicateRequestIds: [],
    });

    // console.log(`Service Worker [${requestId}]: 创建新的请求处理Promise:`, dedupeKey);

    // 请求完成后从 pending 字典中移除，并存入 completed 缓存
    requestPromise
      .then((response) => {
        // 请求成功，将响应存入已完成缓存
        if (
          response &&
          response.ok &&
          isMediaCacheEpochCurrent(requestCacheEpoch)
        ) {
          completedImageRequests.set(dedupeKey, {
            response: response.clone(),
            timestamp: Date.now(),
          });
          // console.log(`Service Worker [${requestId}]: 请求成功，存入已完成缓存:`, dedupeKey);
        }
      })
      .catch(() => {
        // 请求失败，不缓存
      })
      .finally(() => {
        const entry = pendingImageRequests.get(dedupeKey);
        if (entry?.promise === requestPromise) {
          // const totalTime = Date.now() - entry.timestamp;
          // const allRequestIds = [entry.originalRequestId, ...entry.duplicateRequestIds || []];
          // console.log(`Service Worker [${requestId}]: 请求完成 (耗时${totalTime}ms，总计数: ${entry.count}，涉及请求IDs: [${allRequestIds.join(', ')}]):`, dedupeKey);
          pendingImageRequests.delete(dedupeKey);
        }
      });

    // 添加超时机制
    try {
      return await withTimeout(
        requestPromise,
        IMAGE_REQUEST_TIMEOUT,
        'Image request timeout'
      );
    } catch (timeoutError: any) {
      if (timeoutError.message === 'Image request timeout') {
        console.warn(
          `Service Worker [${requestId}]: 图片请求超时(${IMAGE_REQUEST_TIMEOUT}ms)，清理并返回超时响应让前端直接加载:`,
          request.url
        );
        // 超时后主动清理该条目
        pendingImageRequests.delete(dedupeKey);
        return createTimeoutResponse(request.url, requestId);
      }
      throw timeoutError;
    }
  } catch (error) {
    throw error;
  }
}

// 创建超时响应，通知前端使用直接加载方式
function createTimeoutResponse(url: string, requestId: string): Response {
  // console.log(`Service Worker [${requestId}]: 创建超时响应，建议前端直接加载:`, url);
  return new Response('Image request timeout - use direct load', {
    status: 504,
    statusText: 'Gateway Timeout',
    headers: {
      'Content-Type': 'text/plain',
      'X-SW-Timeout': 'true',
      'X-SW-Original-URL': url,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// 实际的图片请求处理逻辑
// bypassCache: 如果为 true，跳过缓存检查直接 fetch，但成功后仍会缓存响应
async function handleImageRequestInternal(
  originalRequest: Request,
  requestUrl: string,
  dedupeKey: string,
  requestId: string,
  bypassCache = false,
  requestedThumbnailSize?: 'small' | 'large',
  requestCacheEpoch = getMediaCacheEpoch()
): Promise<Response> {
  try {
    // console.log(`Service Worker [${requestId}]: 开始处理图片请求:`, dedupeKey);

    const cache = await caches.open(IMAGE_CACHE_NAME);

    // 如果不是绕过模式，先尝试从缓存获取
    if (!bypassCache) {
      // 尝试多种 key 格式匹配（兼容不同的缓存 key 格式）
      let cachedResponse = await cache.match(originalRequest);

      // 如果没找到，尝试使用 URL 字符串匹配
      if (!cachedResponse) {
        cachedResponse = await cache.match(originalRequest.url);
      }

      // 兼容历史上按完整签名 URL 落缓存的旧条目
      if (!cachedResponse && requestUrl !== originalRequest.url) {
        cachedResponse = await cache.match(requestUrl);
      }

      // 如果还没找到，尝试使用 dedupeKey 匹配
      if (!cachedResponse) {
        cachedResponse = await cache.match(dedupeKey);
      }

      if (cachedResponse) {
        // 检查缓存的响应是否有效（blob 不为空）
        const responseClone = cachedResponse.clone();
        const blob = await responseClone.blob();

        // 如果 blob 为空，说明是之前错误缓存的空响应，删除并重新获取
        if (blob.size === 0) {
          console.warn(
            `Service Worker [${requestId}]: 检测到空缓存，删除并重新获取:`,
            requestUrl
          );
          await cache.delete(originalRequest);
          // 继续执行后面的网络请求逻辑
        } else {
          // 如果是预览图请求且预览图不存在，异步生成预览图（不阻塞响应）
          if (
            requestedThumbnailSize &&
            isMediaCacheEpochCurrent(requestCacheEpoch)
          ) {
            const { generateThumbnailAsync } = await import(
              './task-queue/utils/thumbnail-utils'
            );
            generateThumbnailAsync(
              blob,
              originalRequest.url,
              'image',
              undefined,
              requestCacheEpoch
            );
          }

          const cacheDate = cachedResponse.headers.get(SW_CACHE_DATE_HEADER);
          if (cacheDate) {
            const now = Date.now();
            const cacheCreatedAt =
              cachedResponse.headers.get(SW_CACHE_CREATED_AT_HEADER) ||
              cacheDate;

            // 再次访问时延长缓存时间 - 创建新的响应并更新缓存
            const refreshedResponse = new Response(blob, {
              status: cachedResponse.status,
              statusText: cachedResponse.statusText,
              headers: {
                ...Object.fromEntries(
                  (cachedResponse.headers as any).entries()
                ),
                [SW_CACHE_DATE_HEADER]: now.toString(), // 更新访问时间为当前时间
                [SW_CACHE_CREATED_AT_HEADER]: cacheCreatedAt, // 保持首次缓存时间不变
              },
            });

            // 用新时间戳重新缓存（使用 canonical key 作为键）
            if (
              originalRequest.url.startsWith('http') &&
              isMediaCacheEpochCurrent(requestCacheEpoch)
            ) {
              const cached = await putMediaCacheEntry(
                cache,
                dedupeKey,
                refreshedResponse.clone(),
                requestCacheEpoch
              );
              if (cached && requestUrl !== dedupeKey) {
                await cache.delete(requestUrl);
              }
            }
            return refreshedResponse;
          } else {
            // 旧的缓存没有时间戳，为其添加时间戳并延长
            // console.log(`Service Worker [${requestId}]: Adding timestamp to legacy cached image:`, requestUrl);
            const refreshedResponse = new Response(blob, {
              status: cachedResponse.status,
              statusText: cachedResponse.statusText,
              headers: {
                ...Object.fromEntries(
                  (cachedResponse.headers as any).entries()
                ),
                [SW_CACHE_DATE_HEADER]: Date.now().toString(),
                [SW_CACHE_CREATED_AT_HEADER]: Date.now().toString(),
              },
            });

            if (
              originalRequest.url.startsWith('http') &&
              isMediaCacheEpochCurrent(requestCacheEpoch)
            ) {
              const cached = await putMediaCacheEntry(
                cache,
                dedupeKey,
                refreshedResponse.clone(),
                requestCacheEpoch
              );
              if (cached && requestUrl !== dedupeKey) {
                await cache.delete(requestUrl);
              }
            }
            return refreshedResponse;
          }
        }
      }
    } else {
      // console.log(`Service Worker [${requestId}]: 绕过缓存检查，直接发起网络请求:`, dedupeKey);
    }

    // 检查域名配置，准备备用域名
    const originalUrlObject = new URL(requestUrl);
    const domainConfig = shouldHandleCORS(originalUrlObject);
    let fallbackUrl = null;
    let shouldUseFallbackDirectly = false;

    if (domainConfig && domainConfig.fallbackDomain) {
      // 创建备用URL，替换域名
      fallbackUrl = requestUrl.replace(
        domainConfig.hostname,
        domainConfig.fallbackDomain
      );

      // 检查该域名是否已被标记为失败
      if (failedDomains.has(domainConfig.hostname)) {
        shouldUseFallbackDirectly = true;
        // console.log(`Service Worker [${requestId}]: ${domainConfig.hostname}已标记为失败域名，直接使用备用URL:`, fallbackUrl);
      } else {
        // console.log(`Service Worker [${requestId}]: 检测到${domainConfig.hostname}域名，准备备用URL:`, fallbackUrl);
      }
    }

    // 尝试多种获取方式，每种方式都支持重试和域名切换
    let response: Response | undefined;
    const fetchOptions = [
      // 1. 优先尝试cors模式（可以缓存响应）
      {
        method: 'GET',
        mode: 'cors' as RequestMode,
        cache: 'no-cache' as RequestCache,
        credentials: 'omit' as RequestCredentials,
        referrerPolicy: 'no-referrer' as ReferrerPolicy,
      },
      // 2. 尝试默认模式（可能支持缓存）
      {
        method: 'GET',
        cache: 'no-cache' as RequestCache,
      },
      // 3. 最后尝试no-cors模式（可以绕过CORS限制，但会导致opaque响应无法缓存）
      {
        method: 'GET',
        mode: 'no-cors' as RequestMode,
        cache: 'no-cache' as RequestCache,
        credentials: 'omit' as RequestCredentials,
        referrerPolicy: 'no-referrer' as ReferrerPolicy,
      },
    ];

    // 尝试不同的URL和不同的fetch选项
    let urlsToTry: string[];

    if (shouldUseFallbackDirectly) {
      // 如果域名已被标记为失败，直接使用备用URL
      urlsToTry = [fallbackUrl!];
    } else {
      // 正常情况下先尝试原始URL
      urlsToTry = [requestUrl];
      if (fallbackUrl) {
        urlsToTry.push(fallbackUrl); // 如果有备用URL，添加到尝试列表
      }
    }

    let finalError = null;

    for (let urlIndex = 0; urlIndex < urlsToTry.length; urlIndex++) {
      const currentUrl = urlsToTry[urlIndex];
      const isUsingFallback = urlIndex > 0;

      if (isUsingFallback) {
        // console.log(`Service Worker [${requestId}]: 原始URL失败，尝试备用域名:`, currentUrl);
      }

      for (const options of fetchOptions) {
        response = undefined;
        try {
          // console.log(`Service Worker [${requestId}]: Trying fetch with options (${isUsingFallback ? 'fallback' : 'original'} URL, mode: ${options.mode || 'default'}):`, options);

          // Use retry logic for each fetch attempt
          let lastError;
          let isCORSError = false;
          for (let attempt = 0; attempt <= 2; attempt++) {
            try {
              // console.log(`Service Worker [${requestId}]: Fetch attempt ${attempt + 1}/3 with options on ${isUsingFallback ? 'fallback' : 'original'} URL`);
              const fetchedResponse = await fetch(currentUrl, options);

              if (isUsableImageFetchResponse(fetchedResponse)) {
                response = fetchedResponse;
                // console.log(`Service Worker [${requestId}]: Fetch successful with status: ${response.status}, type: ${response.type} from ${isUsingFallback ? 'fallback' : 'original'} URL`);
                break;
              }

              // 4xx/5xx 是有效的 HTTP 响应，但不能作为图片返回。
              // 同一模式重试不会改变结果，直接切换到下一种 fetch 模式。
              lastError = new Error(
                `HTTP ${fetchedResponse.status}: ${fetchedResponse.statusText}`
              );
              finalError = lastError;
              break;
            } catch (fetchError: any) {
              // console.warn(`Service Worker [${requestId}]: Fetch attempt ${attempt + 1} failed on ${isUsingFallback ? 'fallback' : 'original'} URL:`, fetchError);
              lastError = fetchError;

              // 检测CORS错误，不重试直接跳过
              const errorMessage = fetchError.message || '';
              if (
                errorMessage.includes('CORS') ||
                errorMessage.includes('cross-origin') ||
                errorMessage.includes('Access-Control-Allow-Origin') ||
                errorMessage.includes('Failed to fetch') ||
                errorMessage.includes('NetworkError') ||
                errorMessage.includes('TypeError')
              ) {
                // console.log(`Service Worker [${requestId}]: 检测到CORS/网络错误，跳过重试:`, errorMessage);
                isCORSError = true;
                break;
              }

              if (attempt < 2) {
                // Wait before retrying (exponential backoff)
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.pow(2, attempt) * 1000)
                );
              }
            }
          }

          // 如果是CORS错误，标记域名并尝试 no-cors 模式获取 opaque 响应
          if (isCORSError) {
            // 标记该域名存在 CORS 问题，后续请求将跳过 SW
            const problemHostname = new URL(currentUrl).hostname;
            markCorsFailedDomain(problemHostname);

            // console.log(`Service Worker [${requestId}]: CORS 错误，尝试 no-cors 模式获取图片:`, requestUrl);

            try {
              // 使用 no-cors 模式获取 opaque 响应，图片可以显示但 SW 无法读取内容
              const opaqueResponse = await fetch(requestUrl, {
                mode: 'no-cors',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
              });

              if (opaqueResponse.type === 'opaque') {
                // console.log(`Service Worker [${requestId}]: no-cors 模式成功获取 opaque 响应`);
                await notifyImageCacheFailed(requestUrl, 'cors_opaque');
                return opaqueResponse;
              }
            } catch (noCorsError) {
              console.warn(
                `Service Worker [${requestId}]: no-cors 模式也失败:`,
                noCorsError
              );
            }

            // 如果 no-cors 也失败，返回空响应让浏览器重试
            await notifyImageCacheFailed(requestUrl, 'cors_fetch_failed');
            return new Response(null, {
              status: 200,
              headers: {
                'Content-Type': 'image/png',
                'X-SW-CORS-Bypass': 'true',
              },
            });
          }

          if (isUsableImageFetchResponse(response)) {
            break;
          }

          if (lastError) {
            // console.warn(`Service Worker [${requestId}]: All fetch attempts failed with options on ${isUsingFallback ? 'fallback' : 'original'} URL:`, options, lastError);
            finalError = lastError;
          }
        } catch (fetchError) {
          // console.warn(`Service Worker [${requestId}]: Fetch failed with options on ${isUsingFallback ? 'fallback' : 'original'} URL:`, options, fetchError);
          finalError = fetchError;
          continue;
        }
      }

      // 如果当前URL成功获取到响应，跳出URL循环
      if (isUsableImageFetchResponse(response)) {
        break;
      } else {
        // 如果是配置的域名且是第一次尝试（原始URL），标记为失败域名
        if (
          domainConfig &&
          domainConfig.fallbackDomain &&
          urlIndex === 0 &&
          !shouldUseFallbackDirectly
        ) {
          // console.warn(`Service Worker [${requestId}]: 标记${domainConfig.hostname}为失败域名，后续请求将直接使用备用域名`);
          failedDomains.add(domainConfig.hostname);
          // 异步保存到数据库，不阻塞当前请求
          saveFailedDomain(domainConfig.hostname).catch((error) => {
            console.warn('Service Worker: 保存失败域名到数据库时出错:', error);
          });
        }
      }
    }

    // 检查是否获取失败（opaque 响应是 no-cors 模式的正常结果）
    if (!response || !isUsableImageFetchResponse(response)) {
      let errorMessage = 'All fetch attempts failed';

      if (domainConfig && domainConfig.fallbackDomain) {
        if (shouldUseFallbackDirectly) {
          errorMessage = `备用域名${domainConfig.fallbackDomain}也失败了`;
        } else {
          errorMessage = `All fetch attempts failed for both ${domainConfig.hostname} and ${domainConfig.fallbackDomain} domains`;
        }
      }

      console.error(
        `Service Worker [${requestId}]: ${errorMessage}`,
        finalError
      );

      // 不要抛出错误，而是返回一个表示图片加载失败的响应
      // 这样前端img标签会触发onerror事件，但不会导致浏览器回退到默认CORS处理
      await notifyImageCacheFailed(dedupeKey, errorMessage);
      return new Response('Image load failed after all attempts', {
        status: 404,
        statusText: 'Image Not Found',
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    // 处理no-cors模式的opaque响应
    if (response.type === 'opaque') {
      // opaque 响应的 body 无法读取（安全限制），无法转换为普通响应
      // 直接返回 opaque 响应，让浏览器显示图片
      // 缓存由浏览器的 disk cache 处理（基于 HTTP 缓存头）
      // console.log(`Service Worker [${requestId}]: 返回 opaque 响应，依赖浏览器 disk cache`);

      // 标记该域名存在 CORS 问题，后续请求将跳过 SW
      const problemHostname = new URL(requestUrl).hostname;
      markCorsFailedDomain(problemHostname);

      await notifyImageCacheFailed(dedupeKey, 'cors_opaque');
      return response;

      /* 注释掉无效的缓存逻辑 - opaque 响应的 body 是 null
      const corsResponse = new Response(response.body, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': 'image/png',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'max-age=3153600000',
          'sw-cache-date': Date.now().toString()
        }
      });
      
      try {
        if (
          originalRequest.url.startsWith('http') &&
          isMediaCacheEpochCurrent(requestCacheEpoch)
        ) {
          await cache.put(originalRequest, corsResponse.clone());
          await notifyImageCached(requestUrl, 0, 'image/png');
          await checkStorageQuota();
        }
      } catch (cacheError) {
        // 旧的 opaque 缓存逻辑结束 */
    }

    // 处理正常响应
    if (response.ok) {
      const responseClone = response.clone();
      const blob = await responseClone.blob();

      // 检查图片大小
      const imageSizeMB = blob.size / (1024 * 1024);
      // console.log(`Service Worker: Image size: ${imageSizeMB.toFixed(2)}MB`);

      // 如果图片超过5MB，记录警告但仍尝试缓存
      // if (imageSizeMB > 5) {
      //   console.warn(`Service Worker: Large image detected (${imageSizeMB.toFixed(2)}MB), 可能影响缓存性能`);
      // }

      const corsResponse = new Response(blob, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'image/png',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': '*',
          'Cache-Control': 'max-age=3153600000', // 100年
          [SW_CACHE_DATE_HEADER]: Date.now().toString(), // 最后访问时间
          [SW_CACHE_CREATED_AT_HEADER]: Date.now().toString(), // 首次缓存生成时间
          'sw-image-size': blob.size.toString(), // 添加图片大小信息
        },
      });

      // 尝试缓存响应，处理存储限制错误
      try {
        if (
          originalRequest.url.startsWith('http') &&
          isMediaCacheEpochCurrent(requestCacheEpoch)
        ) {
          const cached = await putMediaCacheEntry(
            cache,
            dedupeKey,
            corsResponse.clone(),
            requestCacheEpoch
          );
          if (cached && requestUrl !== dedupeKey) {
            await cache.delete(requestUrl);
          }
          if (!cached) {
            return corsResponse;
          }
          // console.log(`Service Worker: Normal response cached (${imageSizeMB.toFixed(2)}MB) with 30-day expiry and timestamp`);
          // 通知主线程图片已缓存
          await notifyImageCached(dedupeKey, blob.size, blob.type);
          // 检查存储配额
          await checkStorageQuota();

          // 异步生成预览图（不阻塞主流程）
          // 使用 canonical key 作为预览图 key，避免同图因签名参数变化生成多套缩略图
          const { generateThumbnailAsync } = await import(
            './task-queue/utils/thumbnail-utils'
          );
          generateThumbnailAsync(
            blob,
            dedupeKey,
            'image',
            undefined,
            requestCacheEpoch
          );
        }
      } catch (cacheError) {
        console.warn(
          `Service Worker: Failed to cache normal response (${imageSizeMB.toFixed(
            2
          )}MB, 可能超出存储限制):`,
          cacheError
        );
        // Cache Storage 里可能包含用户资产。缓存失败只标记状态，不自动清理缓存。
        await notifyImageCacheFailed(dedupeKey, String(cacheError));
      }

      return corsResponse;
    }

    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  } catch (error: any) {
    // 重新获取URL用于错误处理
    const errorUrl = new URL(requestUrl);

    // 特殊处理SSL协议错误
    const isSSLError =
      error.message.includes('SSL_PROTOCOL_ERROR') ||
      error.message.includes('ERR_SSL_PROTOCOL_ERROR') ||
      error.message.includes('net::ERR_CERT') ||
      error.message.includes('ERR_INSECURE_RESPONSE');

    if (isSSLError) {
      console.warn(
        'Service Worker: 检测到SSL/证书错误，尝试跳过Service Worker处理'
      );

      // 对于SSL错误，让请求回退到浏览器的默认网络处理
      return fetch(requestUrl, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-cache',
        credentials: 'omit',
      }).catch(() => {
        // 如果仍然失败，返回404让SmartImage组件处理重试
        return new Response('SSL Error - Image not accessible', {
          status: 404,
          statusText: 'SSL Protocol Error',
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*',
          },
        });
      });
    }

    // 对于图片请求，返回错误状态码而不是占位符图片
    // 这样前端的img标签会触发onerror事件，SmartImage组件可以进行重试
    if (
      errorUrl.pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i) ||
      errorUrl.searchParams.has('_t') ||
      errorUrl.searchParams.has('cache_buster') ||
      errorUrl.searchParams.has('timestamp')
    ) {
      // console.log('Service Worker: 图片加载失败，返回错误状态码以触发前端重试');

      // 返回404错误，让前端img标签触发onerror事件
      await notifyImageCacheFailed(requestUrl, String(error?.message || error));
      return new Response('Image not found', {
        status: 404,
        statusText: 'Not Found',
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // 对于非图片请求，仍然返回错误信息
    return new Response(`Network Error: ${error.message}`, {
      status: 500,
      statusText: 'Internal Server Error',
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
