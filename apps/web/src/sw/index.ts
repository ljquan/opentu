/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

// Import task queue module
import {
  initTaskQueue,
  handleTaskQueueMessage,
  initWorkflowHandler,
  updateWorkflowConfig,
  isWorkflowMessage,
  handleWorkflowMessage,
  handleMainThreadToolResponse,
  resendPendingToolRequests,
  taskQueueStorage,
  type MainToSWMessage,
  type WorkflowMainToSWMessage,
  type MainThreadToolResponseMessage,
} from './task-queue';
import {
  setDebugFetchBroadcast,
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
  initMessageSender,
  setDebugMode as setMessageSenderDebugMode,
  setBroadcastCallback,
} from './task-queue/utils/message-bus';
import {
  fetchFromCDNWithFallback,
  getCDNStatusReport,
  resetCDNStatus,
  performHealthCheck,
} from './cdn-fallback';
import { getSafeErrorMessage } from './task-queue/utils/sanitize-utils';

// fix: self redeclaration error and type casting
const sw = self as unknown as ServiceWorkerGlobalScope;
export {}; // Make this a module

// Initialize task queue (instance used internally by handleTaskQueueMessage)
initTaskQueue(sw);

// Initialize message sender (will be fully configured later with debug mode)
initMessageSender(sw);

// ============================================================================
// SW Console Log Capture (for debug mode)
// Intercepts SW internal console.log/info calls and forwards to debug panel
// ============================================================================
const originalSWConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

// Forward SW console logs to debug panel when debug mode is enabled
function setupSWConsoleCapture() {
  console.log = (...args: unknown[]) => {
    originalSWConsole.log(...args);
    if (isDebugFetchEnabled()) {
      forwardSWConsoleLog('log', args);
    }
  };

  console.info = (...args: unknown[]) => {
    originalSWConsole.info(...args);
    if (isDebugFetchEnabled()) {
      forwardSWConsoleLog('info', args);
    }
  };

  // warn and error are always forwarded
  console.warn = (...args: unknown[]) => {
    originalSWConsole.warn(...args);
    forwardSWConsoleLog('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalSWConsole.error(...args);
    forwardSWConsoleLog('error', args);
  };
}

function forwardSWConsoleLog(
  level: 'log' | 'info' | 'warn' | 'error',
  args: unknown[]
) {
  const message = args
    .map((arg) => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');

  // Add [SW] prefix only if not already present
  const prefixedMessage =
    message.startsWith('[SW]') || message.startsWith('[SW-')
      ? message
      : `[SW] ${message}`;

  // Use the existing addConsoleLog function (defined later in this file)
  // We'll call it after it's defined
  if (typeof addConsoleLogLater === 'function') {
    addConsoleLogLater({
      logLevel: level,
      logMessage: prefixedMessage,
      logSource: 'service-worker',
    });
  }
}

// Placeholder - will be set after addConsoleLog is defined
let addConsoleLogLater: typeof addConsoleLog | null = null;

// Setup console capture immediately
setupSWConsoleCapture();

// Setup debug fetch broadcast to send SW internal API logs to debug panel
setDebugFetchBroadcast((log) => {
  // Broadcast as a special SW internal log type
  sw.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'SW_DEBUG_LOG',
        entry: {
          ...log,
          type: 'fetch',
        },
      });
    });
  });
});

// Setup LLM API log broadcast for real-time updates (always on, not affected by debug mode)
import('./task-queue/llm-api-logger').then(({ setLLMApiLogBroadcast }) => {
  setLLMApiLogBroadcast((log) => {
    sw.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_DEBUG_LLM_API_LOG',
          log,
        });
      });
    });
  });
});

// Service Worker for PWA functionality and handling CORS issues with external images
// Version will be replaced during build process
declare const __APP_VERSION__: string;
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const CACHE_NAME = `drawnix-v${APP_VERSION}`;
const IMAGE_CACHE_NAME = `drawnix-images`;
const STATIC_CACHE_NAME = `drawnix-static-v${APP_VERSION}`;
const FONT_CACHE_NAME = `drawnix-fonts`;

// 缓存 URL 前缀 - 用于合并视频、图片等本地缓存资源
const CACHE_URL_PREFIX = '/__aitu_cache__/';

// 素材库 URL 前缀 - 用于素材库媒体资源
const ASSET_LIBRARY_PREFIX = '/asset-library/';

// Detect development mode
// 在构建时，process.env.NODE_ENV 会被替换，或者我们可以通过 mode 判断
// 这里使用 location 判断也行，但通常构建时会注入
const isDevelopment =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1';

interface CorsDomain {
  hostname: string;
  pathPattern: string;
  fallbackDomain: string;
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

interface VideoRequestEntry {
  promise: Promise<Blob | null>;
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
  requestType?: string; // 'image' | 'video' | 'font' | 'static' | 'cache-url' | 'asset-library' | 'other'
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

// 心跳机制：用于检测调试页面是否存活
let lastHeartbeatTime = 0;
const HEARTBEAT_TIMEOUT = 15000; // 15秒无心跳则认为调试页面已关闭
let heartbeatCheckTimer: ReturnType<typeof setTimeout> | null = null;

// 检查心跳是否超时，如果超时则自动关闭调试模式
function checkHeartbeatTimeout() {
  if (!debugModeEnabled) return;

  const now = Date.now();
  if (lastHeartbeatTime > 0 && now - lastHeartbeatTime > HEARTBEAT_TIMEOUT) {
    // 心跳超时，关闭调试模式
    originalSWConsole.log(
      'Service Worker: Debug heartbeat timeout, auto-disabling debug mode'
    );
    debugModeEnabled = false;
    lastHeartbeatTime = 0;
    setMessageSenderDebugMode(false);

    // Sync debug mode to debugFetch
    import('./task-queue/debug-fetch').then(({ setDebugFetchEnabled }) => {
      setDebugFetchEnabled(false);
    });

    // Broadcast to ALL clients
    sw.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_DEBUG_DISABLED' });
      });
    });

    if (heartbeatCheckTimer) {
      clearTimeout(heartbeatCheckTimer);
      heartbeatCheckTimer = null;
    }
  } else if (debugModeEnabled) {
    // 继续检查
    heartbeatCheckTimer = setTimeout(checkHeartbeatTimeout, 5000);
  }
}

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

// 广播调试日志到所有客户端
async function broadcastDebugLog(entry: DebugLogEntry): Promise<void> {
  try {
    const clients = await sw.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'SW_DEBUG_LOG',
        entry,
      });
    });
  } catch (error) {
    // 忽略广播错误
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

// 从 IndexedDB 加载所有控制台日志
async function loadConsoleLogsFromDB(): Promise<DebugLogEntry[]> {
  try {
    const db = await openConsoleLogDB();
    const transaction = db.transaction(['logs'], 'readonly');
    const store = transaction.objectStore('logs');
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev'); // 按时间倒序
      const logs: DebugLogEntry[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          logs.push(cursor.value);
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

// 添加控制台日志
// 注意：只有调试模式启用时才存储和广播日志
// 这与主线程 sw-console-capture.ts 的设计一致：
// - 主线程：warn/error 始终发送，log/info/debug 只在调试模式时发送
// - SW 端：只有调试模式启用时才处理日志，避免不必要的存储和广播
function addConsoleLog(entry: {
  logLevel: 'log' | 'info' | 'warn' | 'error' | 'debug';
  logMessage: string;
  logStack?: string;
  logSource?: string;
  url?: string;
}): void {
  // 调试模式未启用时，不存储和广播日志
  if (!debugModeEnabled) {
    return;
  }

  const id = Math.random().toString(36).substring(2, 10);
  const logEntry: DebugLogEntry = {
    id,
    timestamp: Date.now(),
    type: 'console',
    ...entry,
  };

  // 保存到内存（用于 getDebugStatus 统计）
  consoleLogs.unshift(logEntry);

  // 保存到 IndexedDB（异步，不阻塞）
  saveConsoleLogToDB(logEntry);

  // 广播日志到调试页面
  broadcastConsoleLog(logEntry);
}

// Set the forward function now that addConsoleLog is defined
addConsoleLogLater = addConsoleLog;

// 广播控制台日志到所有客户端
async function broadcastConsoleLog(entry: DebugLogEntry): Promise<void> {
  try {
    const clients = await sw.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'SW_CONSOLE_LOG',
        entry,
      });
    });
  } catch (error) {
    // 忽略广播错误
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
  workflowHandlerInitialized: boolean;
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
    workflowHandlerInitialized,
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

// 从IndexedDB恢复失败域名列表
async function loadFailedDomains(): Promise<void> {
  try {
    const request = indexedDB.open('ServiceWorkerDB', 1);

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('failedDomains')) {
          const transaction = db.transaction(['failedDomains'], 'readonly');
          const store = transaction.objectStore('failedDomains');
          const getAllRequest = store.getAll();

          getAllRequest.onsuccess = () => {
            const domains = getAllRequest.result;
            domains.forEach((item: any) => failedDomains.add(item.domain));
            // console.log('Service Worker: 恢复失败域名列表:', Array.from(failedDomains));
            resolve();
          };
          getAllRequest.onerror = () => reject(getAllRequest.error);
        } else {
          resolve();
        }
      };
      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('failedDomains')) {
          db.createObjectStore('failedDomains', { keyPath: 'domain' });
        }
      };
    });
  } catch (error) {
    console.warn('Service Worker: 无法加载失败域名列表:', error);
  }
}

// 保存失败域名到IndexedDB
async function saveFailedDomain(domain: string): Promise<void> {
  try {
    const request = indexedDB.open('ServiceWorkerDB', 1);

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction(['failedDomains'], 'readwrite');
        const store = transaction.objectStore('failedDomains');

        store.put({ domain: domain, timestamp: Date.now() });
        transaction.oncomplete = () => {
          // console.log('Service Worker: 已保存失败域名到数据库:', domain);
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('failedDomains')) {
          db.createObjectStore('failedDomains', { keyPath: 'domain' });
        }
      };
    });
  } catch (error) {
    console.warn('Service Worker: 无法保存失败域名:', error);
  }
}

// ==================== 智能升级相关函数 ====================

// 标记新版本已准备好，等待用户确认
// isUpdate: 是否是版本更新（有旧版本存在）
function markNewVersionReady(isUpdate: boolean) {
  // console.log(`Service Worker: 新版本 v${APP_VERSION} 已准备好，isUpdate=${isUpdate}`);

  // 只有在版本更新时才通知客户端显示升级提示
  // 首次安装不需要显示，因为没有"旧版本"可更新
  if (!isUpdate) {
    // console.log('Service Worker: 首次安装，不显示更新提示');
    return;
  }

  // 通知客户端有新版本可用
  sw.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({
        type: 'SW_NEW_VERSION_READY',
        version: APP_VERSION,
      });
    });
  });
}

// 清理旧的缓存条目以释放空间（基于LRU策略）
async function cleanOldCacheEntries(cache: Cache) {
  try {
    // console.log('Service Worker: Starting cache cleanup to free space');
    const requests = await cache.keys();

    if (requests.length <= 10) {
      // console.log('Service Worker: Cache has few entries, skipping cleanup');
      return;
    }

    interface CacheEntry {
      request: Request;
      cacheDate: number;
      imageSize: number;
    }

    // 获取所有缓存条目及其时间戳
    const entries: CacheEntry[] = [];
    for (const request of requests) {
      try {
        const response = await cache.match(request);
        if (response) {
          const cacheDate = response.headers.get('sw-cache-date');
          const imageSize = response.headers.get('sw-image-size');
          entries.push({
            request,
            cacheDate: cacheDate ? parseInt(cacheDate) : 0,
            imageSize: imageSize ? parseInt(imageSize) : 0,
          });
        }
      } catch (error) {
        console.warn('Service Worker: Error reading cache entry:', error);
      }
    }

    // 按时间排序，最老的在前面
    entries.sort((a, b) => a.cacheDate - b.cacheDate);

    // 删除最老的25%缓存条目
    const deleteCount = Math.max(1, Math.floor(entries.length * 0.25));
    let deletedCount = 0;
    let freedSpace = 0;

    for (let i = 0; i < deleteCount && i < entries.length; i++) {
      try {
        await cache.delete(entries[i].request);
        deletedCount++;
        freedSpace += entries[i].imageSize;
        // console.log(`Service Worker: Deleted old cache entry (${(entries[i].imageSize / 1024 / 1024).toFixed(2)}MB)`);
      } catch (error) {
        console.warn('Service Worker: Error deleting cache entry:', error);
      }
    }

    // console.log(`Service Worker: Cache cleanup completed, deleted ${deletedCount} entries, freed ${(freedSpace / 1024 / 1024).toFixed(2)}MB`);
  } catch (error) {
    console.warn('Service Worker: Cache cleanup failed:', error);
  }
}

// Precache manifest 类型定义
interface PrecacheManifest {
  version: string;
  timestamp: string;
  files: Array<{ url: string; revision: string }>;
}

/**
 * 从 precache-manifest.json 加载预缓存文件列表
 * 如果加载失败（开发模式没有此文件），返回 null 表示不需要预缓存
 */
async function loadPrecacheManifest(): Promise<
  { url: string; revision: string }[] | null
> {
  try {
    const response = await fetch('./precache-manifest.json', {
      cache: 'reload',
    });
    if (!response.ok) {
      // 没有 manifest 文件，说明是开发模式，不需要预缓存
      console.log(
        'Service Worker: No precache-manifest.json found (dev mode), skipping precache'
      );
      return null;
    }

    const manifest: PrecacheManifest = await response.json();
    console.log(
      `Service Worker: Loaded precache manifest v${manifest.version} with ${manifest.files.length} files`
    );
    return manifest.files;
  } catch (error) {
    // 加载失败，不预缓存
    console.log(
      'Service Worker: Cannot load precache-manifest.json, skipping precache'
    );
    return null;
  }
}

/**
 * 缓存单个文件
 * - HTML 文件从当前服务器获取（确保最新版本）
 * - JS/CSS 等静态资源优先从 CDN 获取，失败后回退到服务器
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
    // 检查缓存中是否已有相同 revision 的文件
    const cachedResponse = await cache.match(url);

    if (cachedResponse) {
      const cachedRevision = cachedResponse.headers.get('x-sw-revision');
      if (cachedRevision === revision) {
        // 文件未变化，跳过
        return { url, success: true, skipped: true };
      }
    }

    // 判断是否是 HTML 文件（必须从当前服务器获取）
    const isHtml = url.endsWith('.html') || url === '/';

    let response: Response | null = null;
    let source = 'server';

    // 非 HTML 文件尝试从 CDN 获取
    if (!isHtml) {
      const cdnResult = await fetchFromCDNWithFallback(
        url.startsWith('/') ? url.slice(1) : url, // 移除开头的 /
        APP_VERSION,
        location.origin
      );

      if (cdnResult && cdnResult.response.ok) {
        response = cdnResult.response;
        source = cdnResult.source;
      }
    }

    // 如果 CDN 失败或是 HTML 文件，从当前服务器获取
    if (!response) {
      response = await fetch(url, { cache: 'reload' });
      source = 'server';
    }

    if (response.ok) {
      // 添加 revision 头用于后续比较
      const headers = new Headers(response.headers);
      headers.set('x-sw-revision', revision);
      headers.set('x-sw-cached-at', new Date().toISOString());
      headers.set('x-sw-source', source);

      const modifiedResponse = new Response(await response.blob(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      // 使用完整 URL 作为缓存 key，确保与运行时请求匹配
      const fullUrl = new URL(url, self.location.origin).href;
      await cache.put(fullUrl, modifiedResponse);
      return { url, success: true, source };
    }
    return { url, success: false, status: response.status };
  } catch (error) {
    return { url, success: false, error: String(error) };
  }
}

/**
 * 预缓存静态资源
 * 使用并发控制避免同时发起太多请求
 * CDN 优先策略：JS/CSS 从 CDN 获取，HTML 从服务器获取
 */
async function precacheStaticFiles(
  cache: Cache,
  files: { url: string; revision: string }[]
): Promise<void> {
  const CONCURRENCY = 6; // 并发数
  const allResults: { success: boolean; source?: string }[] = [];

  // 分批处理
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(({ url, revision }) => cacheFile(cache, url, revision))
    );

    // 收集结果
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allResults.push({
          success: result.value.success,
          source: result.value.source,
        });
      } else {
        allResults.push({ success: false });
      }
    }
  }

  const successCount = allResults.filter((r) => r.success).length;
  const failCount = allResults.length - successCount;
  const cdnCount = allResults.filter(
    (r) => r.success && r.source && r.source !== 'server'
  ).length;
  const serverCount = allResults.filter(
    (r) => r.success && r.source === 'server'
  ).length;

  console.log(
    `Service Worker: Precached ${successCount}/${files.length} files (${failCount} failed)`
  );
  if (cdnCount > 0) {
    console.log(
      `Service Worker: Sources - CDN: ${cdnCount}, Server: ${serverCount}`
    );
  }
}

sw.addEventListener('install', (event: ExtendableEvent) => {
  console.log(`Service Worker v${APP_VERSION} installing...`);

  const installPromises: Promise<any>[] = [];

  // Load failed domains from database
  installPromises.push(loadFailedDomains());

  // 预缓存静态资源（通过 manifest 文件是否存在来判断是否需要预缓存）
  // - 构建产物有 precache-manifest.json → 预缓存
  // - 开发模式没有此文件 → 跳过预缓存
  installPromises.push(
    (async () => {
      try {
        const files = await loadPrecacheManifest();
        if (files && files.length > 0) {
          const cache = await caches.open(STATIC_CACHE_NAME);
          await precacheStaticFiles(cache, files);
        }
      } catch (err) {
        console.warn('Service Worker: Precache failed:', err);
        // 预缓存失败不应该阻止 SW 安装
      }
    })()
  );

  event.waitUntil(
    Promise.all(installPromises).then(async () => {
      console.log(`Service Worker v${APP_VERSION} installed, resources ready`);

      // 判断是否是版本更新的最可靠方式：检查是否存在旧版本的缓存
      // 旧版本缓存名称包含版本号，只有在版本变化时才会不同
      const cacheNames = await caches.keys();
      const hasOldStaticCache = cacheNames.some(
        (name) =>
          name.startsWith('drawnix-static-v') && name !== STATIC_CACHE_NAME
      );
      const hasOldAppCache = cacheNames.some(
        (name) =>
          name.startsWith('drawnix-v') &&
          name !== CACHE_NAME &&
          name !== IMAGE_CACHE_NAME &&
          !name.startsWith('drawnix-static-v')
      );

      // 只有存在旧版本缓存时，才认为是版本更新
      const isUpdate = hasOldStaticCache || hasOldAppCache;

      // console.log(`Service Worker: isUpdate=${isUpdate}, oldStatic=${hasOldStaticCache}, oldApp=${hasOldAppCache}`);

      // 预缓存完成后，直接激活新 SW，不等待用户确认
      // 这样可以确保用户总是使用最新版本
      // 注意：这不会强制刷新页面，只是让新 SW 接管控制权
      sw.skipWaiting();
    })
  );
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  // console.log('Service Worker activated');

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
      const oldStaticCaches = cacheNames.filter(
        (name) =>
          name.startsWith('drawnix-static-v') && name !== STATIC_CACHE_NAME
      );

      const oldAppCaches = cacheNames.filter(
        (name) =>
          name.startsWith('drawnix-v') &&
          name !== CACHE_NAME &&
          name !== IMAGE_CACHE_NAME &&
          !name.startsWith('drawnix-static-v')
      );

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

      // 立即接管所有页面
      await sw.clients.claim();

      // 通知所有客户端 SW 已更新（让 UI 知道可能需要刷新）
      const clients = await sw.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: APP_VERSION,
        });
      });
    })
  );
});

// Task queue message types
const TASK_QUEUE_MESSAGE_TYPES = [
  'TASK_QUEUE_INIT',
  'TASK_QUEUE_UPDATE_CONFIG',
  'TASK_SUBMIT',
  'TASK_CANCEL',
  'TASK_RETRY',
  'TASK_RESUME',
  'TASK_GET_STATUS',
  'TASK_GET_ALL',
  'TASK_DELETE',
  'TASK_MARK_INSERTED',
  'CHAT_START',
  'CHAT_STOP',
  'CHAT_GET_CACHED',
  'TASK_RESTORE',
];

// Check if message is a task queue message
function isTaskQueueMessage(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { type?: string };
  return msg.type ? TASK_QUEUE_MESSAGE_TYPES.includes(msg.type) : false;
}

// Track if workflow handler is initialized
let workflowHandlerInitialized = false;

// Store config for lazy initialization
let storedGeminiConfig: any = null;
let storedVideoConfig: any = null;

// Pending workflow messages waiting for config
interface PendingWorkflowMessage {
  message: WorkflowMainToSWMessage;
  clientId: string;
}
const pendingWorkflowMessages: PendingWorkflowMessage[] = [];

// Helper function to broadcast PostMessage log to debug panel
function broadcastPostMessageLog(entry: PostMessageLogEntry): void {
  if (debugModeEnabled) {
    // Use direct postMessage for debug logs to avoid infinite loop
    sw.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_POSTMESSAGE_LOG',
          entry,
        });
      });
    });
  }
}

// Configure message sender with debug callback
setBroadcastCallback(broadcastPostMessageLog);

// Handle messages from main thread
sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const messageType = event.data?.type || 'unknown';
  const clientId = (event.source as Client)?.id || '';

  // Log received message only if debug mode is enabled
  // This ensures postMessage logging doesn't affect performance when debug mode is off
  let logId = '';
  if (isPostMessageLoggerDebugMode()) {
    logId = logReceivedMessage(messageType, event.data, clientId);
    if (logId && debugModeEnabled) {
      const logs = getAllPostMessageLogs();
      const entry = logs.find((l) => l.id === logId);
      if (entry) {
        broadcastPostMessageLog(entry);
      }
    }
  }

  // Handle task queue messages
  if (event.data && isTaskQueueMessage(event.data)) {
    const clientId = (event.source as Client)?.id || '';
    handleTaskQueueMessage(event.data as MainToSWMessage, clientId);

    // Initialize workflow handler when task queue is initialized
    if (event.data.type === 'TASK_QUEUE_INIT') {
      const { geminiConfig, videoConfig } = event.data;
      // Store config for later use
      storedGeminiConfig = geminiConfig;
      storedVideoConfig = videoConfig;

      if (!workflowHandlerInitialized) {
        initWorkflowHandler(sw, geminiConfig, videoConfig);
        workflowHandlerInitialized = true;
        // console.log('Service Worker: Workflow handler initialized');

        // Process any pending workflow messages that were waiting for config
        if (pendingWorkflowMessages.length > 0) {
          for (const pending of pendingWorkflowMessages) {
            handleWorkflowMessage(pending.message, pending.clientId);
          }
          pendingWorkflowMessages.length = 0; // Clear the array
        }
      }

      // Re-send any pending tool requests to the new client
      // This handles page refresh during workflow execution
      resendPendingToolRequests();
    }

    // Update workflow config when task queue config is updated
    if (event.data.type === 'TASK_QUEUE_UPDATE_CONFIG') {
      const { geminiConfig, videoConfig } = event.data;
      // Update stored config
      if (geminiConfig)
        storedGeminiConfig = { ...storedGeminiConfig, ...geminiConfig };
      if (videoConfig)
        storedVideoConfig = { ...storedVideoConfig, ...videoConfig };
      updateWorkflowConfig(geminiConfig, videoConfig);
    }

    return;
  }

  // Handle workflow messages
  if (event.data && isWorkflowMessage(event.data)) {
    const wfClientId = (event.source as Client)?.id || '';

    // Lazy initialize workflow handler if not yet initialized
    if (
      !workflowHandlerInitialized &&
      storedGeminiConfig &&
      storedVideoConfig
    ) {
      initWorkflowHandler(sw, storedGeminiConfig, storedVideoConfig);
      workflowHandlerInitialized = true;
    }

    // If still not initialized, try to load config from storage
    if (!workflowHandlerInitialized) {
      // Use async IIFE to handle the async operation
      (async () => {
        try {
          const { geminiConfig, videoConfig } =
            await taskQueueStorage.loadConfig();
          if (geminiConfig && videoConfig) {
            storedGeminiConfig = geminiConfig;
            storedVideoConfig = videoConfig;
            initWorkflowHandler(sw, geminiConfig, videoConfig);
            workflowHandlerInitialized = true;
            // console.log('Service Worker: Workflow handler initialized from storage');

            // Now handle the message (use wfClientId from outer scope)
            handleWorkflowMessage(
              event.data as WorkflowMainToSWMessage,
              wfClientId
            );
          } else {
            // 配置不存在时，通知主线程需要重新发送配置
            // 广播请求配置消息给所有客户端
            const clients = await sw.clients.matchAll({ type: 'window' });
            for (const client of clients) {
              client.postMessage({
                type: 'SW_REQUEST_CONFIG',
                reason: 'workflow_handler_not_initialized',
                pendingMessageType: (event.data as WorkflowMainToSWMessage)
                  .type,
              });
            }

            // 将消息暂存，等配置到达后再处理
            pendingWorkflowMessages.push({
              message: event.data as WorkflowMainToSWMessage,
              clientId: wfClientId,
            });
          }
        } catch (error) {
          // 只记录错误类型，不记录详细信息（可能包含敏感配置）
          console.error(
            '[SW] Failed to load config from storage:',
            getSafeErrorMessage(error)
          );
        }
      })();
      return;
    }

    handleWorkflowMessage(event.data as WorkflowMainToSWMessage, wfClientId);
    return;
  }

  // Handle main thread tool response
  if (event.data && event.data.type === 'MAIN_THREAD_TOOL_RESPONSE') {
    handleMainThreadToolResponse(event.data as MainThreadToolResponseMessage);
    return;
  }

  // Handle thumbnail generation request from main thread
  if (event.data && event.data.type === 'GENERATE_THUMBNAIL') {
    const { url, mediaType, blob: arrayBuffer, mimeType } = event.data;
    if (url && mediaType && arrayBuffer) {
      // 将 ArrayBuffer 转换为 Blob
      const blob = new Blob([arrayBuffer], {
        type: mimeType || (mediaType === 'video' ? 'video/mp4' : 'image/png'),
      });
      
      // 异步生成预览图
      (async () => {
        const { generateThumbnailAsync } = await import('./task-queue/utils/thumbnail-utils');
        generateThumbnailAsync(blob, url, mediaType);
      })();
    }
    return;
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    // 主线程请求立即升级（用户主动触发）
    // console.log('Service Worker: 收到主线程的 SKIP_WAITING 请求');

    // 直接调用 skipWaiting
    sw.skipWaiting();

    // Notify clients that SW has been updated
    sw.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_UPDATED' });
      });
    });
  } else if (event.data && event.data.type === 'GET_UPGRADE_STATUS') {
    // 主线程查询升级状态
    event.source?.postMessage({
      type: 'UPGRADE_STATUS',
      version: APP_VERSION,
    });
  } else if (event.data && event.data.type === 'FORCE_UPGRADE') {
    // 主线程强制升级
    // console.log('Service Worker: 收到强制升级请求');
    sw.skipWaiting();
    sw.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_UPDATED' });
      });
    });
  } else if (event.data && event.data.type === 'DELETE_CACHE') {
    // 删除单个缓存
    const { url } = event.data;
    if (url) {
      deleteCacheByUrl(url)
        .then(() => {
          // console.log('Service Worker: Cache deleted:', url);
          // 通知主线程
          sw.clients.matchAll().then((clients) => {
            clients.forEach((client) => {
              client.postMessage({ type: 'CACHE_DELETED', url });
            });
          });
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
    // 启用调试模式
    debugModeEnabled = true;
    lastHeartbeatTime = Date.now(); // 初始化心跳时间
    // Sync debug mode to debugFetch and message sender
    import('./task-queue/debug-fetch').then(({ setDebugFetchEnabled }) => {
      setDebugFetchEnabled(true);
    });
    setMessageSenderDebugMode(true);
    originalSWConsole.log('Service Worker: Debug mode enabled');
    // 启动心跳检测
    if (heartbeatCheckTimer) {
      clearTimeout(heartbeatCheckTimer);
    }
    heartbeatCheckTimer = setTimeout(checkHeartbeatTimeout, 5000);
    // Broadcast to ALL clients (including app pages) so they can capture logs
    sw.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_DEBUG_ENABLED' });
      });
    });
    event.source?.postMessage({
      type: 'SW_DEBUG_STATUS',
      status: getDebugStatus(),
    });
  } else if (event.data && event.data.type === 'SW_DEBUG_HEARTBEAT') {
    // 调试页面心跳：更新心跳时间
    if (debugModeEnabled) {
      lastHeartbeatTime = Date.now();
    }
  } else if (event.data && event.data.type === 'SW_DEBUG_DISABLE') {
    // 禁用调试模式
    debugModeEnabled = false;
    lastHeartbeatTime = 0;
    if (heartbeatCheckTimer) {
      clearTimeout(heartbeatCheckTimer);
      heartbeatCheckTimer = null;
    }
    // Sync debug mode to debugFetch and message sender
    import('./task-queue/debug-fetch').then(({ setDebugFetchEnabled }) => {
      setDebugFetchEnabled(false);
    });
    setMessageSenderDebugMode(false);

    // 禁用调试模式时清空所有日志（内存和 IndexedDB）
    // 这样重新打开调试面板时不会显示旧日志
    consoleLogs.length = 0;
    debugLogs.length = 0;
    clearAllConsoleLogs().catch(() => {
      // 忽略 IndexedDB 清理失败
    });

    originalSWConsole.log('Service Worker: Debug mode disabled, logs cleared');
    // Broadcast to ALL clients (including app pages) so they stop capturing verbose logs
    sw.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_DEBUG_DISABLED' });
      });
    });
    event.source?.postMessage({
      type: 'SW_DEBUG_STATUS',
      status: getDebugStatus(),
    });
  } else if (event.data && event.data.type === 'SW_DEBUG_GET_STATUS') {
    // 获取调试状态
    (async () => {
      const status = getDebugStatus();
      // 获取缓存统计
      const cacheStats = await getCacheStats();
      event.source?.postMessage({
        type: 'SW_DEBUG_STATUS',
        status: { ...status, cacheStats },
      });
    })();
  } else if (event.data && event.data.type === 'SW_DEBUG_GET_LOGS') {
    // 获取调试日志 (合并 debugLogs 和 internalFetchLogs)
    const { limit = 100, offset = 0, filter } = event.data;

    // Merge internal fetch logs with debug logs
    const internalLogs = getInternalFetchLogs().map((log) => ({
      ...log,
      type: 'fetch',
    }));

    // Combine and deduplicate by ID (internal logs take priority as they're more up-to-date)
    const logMap = new Map<string, any>();
    for (const log of debugLogs) {
      logMap.set(log.id, log);
    }
    for (const log of internalLogs) {
      logMap.set(log.id, log);
    }

    // Sort by timestamp descending
    let logs = Array.from(logMap.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );

    // 应用过滤器
    if (filter) {
      if (filter.type) {
        logs = logs.filter((l) => l.type === filter.type);
      }
      if (filter.requestType) {
        logs = logs.filter((l) => l.requestType === filter.requestType);
      }
      if (filter.url) {
        logs = logs.filter((l) => l.url?.includes(filter.url));
      }
      if (filter.status) {
        logs = logs.filter((l) => l.status === filter.status);
      }
    }

    const paginatedLogs = logs.slice(offset, offset + limit);
    event.source?.postMessage({
      type: 'SW_DEBUG_LOGS',
      logs: paginatedLogs,
      total: logs.length,
      offset,
      limit,
    });
  } else if (event.data && event.data.type === 'SW_DEBUG_CLEAR_LOGS') {
    // 清空调试日志
    debugLogs.length = 0;
    event.source?.postMessage({
      type: 'SW_DEBUG_LOGS_CLEARED',
    });
  } else if (event.data && event.data.type === 'SW_CDN_GET_STATUS') {
    // 获取 CDN 状态
    event.source?.postMessage({
      type: 'SW_CDN_STATUS',
      status: getCDNStatusReport(),
    });
  } else if (event.data && event.data.type === 'SW_CDN_RESET_STATUS') {
    // 重置 CDN 状态
    resetCDNStatus();
    event.source?.postMessage({
      type: 'SW_CDN_STATUS_RESET',
    });
  } else if (event.data && event.data.type === 'SW_CDN_HEALTH_CHECK') {
    // 执行 CDN 健康检查
    (async () => {
      const results = await performHealthCheck(APP_VERSION);
      event.source?.postMessage({
        type: 'SW_CDN_HEALTH_CHECK_RESULT',
        results: Object.fromEntries(results),
      });
    })();
  } else if (event.data && event.data.type === 'SW_DEBUG_GET_CACHE_ENTRIES') {
    // 获取缓存条目列表
    const { cacheName, limit = 50, offset = 0 } = event.data;
    (async () => {
      try {
        const cache = await caches.open(cacheName || IMAGE_CACHE_NAME);
        const requests = await cache.keys();
        const entries: { url: string; cacheDate?: number; size?: number }[] =
          [];

        for (
          let i = offset;
          i < Math.min(offset + limit, requests.length);
          i++
        ) {
          const request = requests[i];
          const response = await cache.match(request);
          if (response) {
            const cacheDate = response.headers.get('sw-cache-date');
            const size =
              response.headers.get('sw-image-size') ||
              response.headers.get('content-length');
            entries.push({
              url: request.url,
              cacheDate: cacheDate ? parseInt(cacheDate) : undefined,
              size: size ? parseInt(size) : undefined,
            });
          }
        }

        event.source?.postMessage({
          type: 'SW_DEBUG_CACHE_ENTRIES',
          cacheName: cacheName || IMAGE_CACHE_NAME,
          entries,
          total: requests.length,
          offset,
          limit,
        });
      } catch (error) {
        event.source?.postMessage({
          type: 'SW_DEBUG_CACHE_ENTRIES',
          error: String(error),
        });
      }
    })();
  } else if (event.data && event.data.type === 'SW_CONSOLE_LOG_REPORT') {
    // 接收来自主应用的控制台日志
    const { logLevel, logMessage, logStack, logSource, url } = event.data;
    addConsoleLog({
      logLevel,
      logMessage,
      logStack,
      logSource,
      url,
    });
  } else if (event.data && event.data.type === 'SW_DEBUG_GET_CONSOLE_LOGS') {
    // 从 IndexedDB 获取控制台日志
    (async () => {
      try {
        const { limit = 500, offset = 0, filter } = event.data;
        let logs = await loadConsoleLogsFromDB();

        // 应用过滤器
        if (filter) {
          if (filter.logLevel) {
            logs = logs.filter((l) => l.logLevel === filter.logLevel);
          }
          if (filter.search) {
            const search = filter.search.toLowerCase();
            logs = logs.filter(
              (l) =>
                l.logMessage?.toLowerCase().includes(search) ||
                l.logStack?.toLowerCase().includes(search)
            );
          }
        }

        const paginatedLogs = logs.slice(offset, offset + limit);
        event.source?.postMessage({
          type: 'SW_DEBUG_CONSOLE_LOGS',
          logs: paginatedLogs,
          total: logs.length,
          offset,
          limit,
        });
      } catch (error) {
        event.source?.postMessage({
          type: 'SW_DEBUG_CONSOLE_LOGS',
          logs: [],
          total: 0,
          error: String(error),
        });
      }
    })();
  } else if (event.data && event.data.type === 'SW_DEBUG_CLEAR_CONSOLE_LOGS') {
    // 清空控制台日志（内存和 IndexedDB）
    (async () => {
      consoleLogs.length = 0;
      await clearAllConsoleLogs();
      event.source?.postMessage({
        type: 'SW_DEBUG_CONSOLE_LOGS_CLEARED',
      });
    })();
  } else if (event.data && event.data.type === 'SW_DEBUG_EXPORT_LOGS') {
    // 导出所有日志（从 IndexedDB 读取）
    (async () => {
      const allConsoleLogs = await loadConsoleLogsFromDB();
      const postmessageLogs = getAllPostMessageLogs();
      const exportData = {
        exportTime: new Date().toISOString(),
        swVersion: APP_VERSION,
        userAgent: '', // 将由调试页面填充
        status: getDebugStatus(),
        fetchLogs: debugLogs,
        consoleLogs: allConsoleLogs,
        postmessageLogs,
      };
      event.source?.postMessage({
        type: 'SW_DEBUG_EXPORT_DATA',
        data: exportData,
      });
    })();
  } else if (
    event.data &&
    event.data.type === 'SW_DEBUG_GET_POSTMESSAGE_LOGS'
  ) {
    // 获取 PostMessage 日志
    const { limit = 200, offset = 0, filter } = event.data;
    let logs = getAllPostMessageLogs();

    // 应用过滤器
    if (filter) {
      if (filter.direction) {
        logs = logs.filter((l) => l.direction === filter.direction);
      }
      if (filter.messageType) {
        const search = filter.messageType.toLowerCase();
        logs = logs.filter((l) =>
          l.messageType?.toLowerCase().includes(search)
        );
      }
    }

    const paginatedLogs = logs.slice(offset, offset + limit);
    event.source?.postMessage({
      type: 'SW_DEBUG_POSTMESSAGE_LOGS',
      logs: paginatedLogs,
      total: logs.length,
      offset,
      limit,
      stats: getPostMessageLogStats(),
    });
  } else if (
    event.data &&
    event.data.type === 'SW_DEBUG_CLEAR_POSTMESSAGE_LOGS'
  ) {
    // 清空 PostMessage 日志
    clearPostMessageLogs();
    event.source?.postMessage({
      type: 'SW_DEBUG_POSTMESSAGE_LOGS_CLEARED',
    });
  } else if (event.data && event.data.type === 'CRASH_SNAPSHOT') {
    // 保存崩溃快照到 IndexedDB
    const snapshot = event.data.snapshot;
    if (snapshot) {
      saveCrashSnapshot(snapshot);
      // 广播新快照到所有客户端（包括 sw-debug.html）
      sw.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_DEBUG_NEW_CRASH_SNAPSHOT',
            snapshot,
          });
        });
      });
    }
  } else if (event.data && event.data.type === 'SW_DEBUG_GET_CRASH_SNAPSHOTS') {
    // 获取崩溃快照列表
    (async () => {
      try {
        const snapshots = await getCrashSnapshots();
        event.source?.postMessage({
          type: 'SW_DEBUG_CRASH_SNAPSHOTS',
          snapshots,
          total: snapshots.length,
        });
      } catch (error) {
        event.source?.postMessage({
          type: 'SW_DEBUG_CRASH_SNAPSHOTS',
          snapshots: [],
          total: 0,
          error: String(error),
        });
      }
    })();
  } else if (
    event.data &&
    event.data.type === 'SW_DEBUG_CLEAR_CRASH_SNAPSHOTS'
  ) {
    // 清空崩溃快照
    (async () => {
      await clearCrashSnapshots();
      event.source?.postMessage({
        type: 'SW_DEBUG_CRASH_SNAPSHOTS_CLEARED',
      });
    })();
  } else if (event.data && event.data.type === 'SW_DEBUG_GET_LLM_API_LOGS') {
    // 获取 LLM API 日志列表
    (async () => {
      try {
        const { getAllLLMApiLogs } = await import(
          './task-queue/llm-api-logger'
        );
        const logs = await getAllLLMApiLogs();
        event.source?.postMessage({
          type: 'SW_DEBUG_LLM_API_LOGS',
          logs,
          total: logs.length,
        });
      } catch (error) {
        event.source?.postMessage({
          type: 'SW_DEBUG_LLM_API_LOGS',
          logs: [],
          total: 0,
          error: String(error),
        });
      }
    })();
  } else if (event.data && event.data.type === 'SW_DEBUG_CLEAR_LLM_API_LOGS') {
    // 清空 LLM API 日志
    (async () => {
      const { clearAllLLMApiLogs } = await import(
        './task-queue/llm-api-logger'
      );
      await clearAllLLMApiLogs();
      event.source?.postMessage({
        type: 'SW_DEBUG_LLM_API_LOGS_CLEARED',
      });
    })();
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
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const requests = await cache.keys();

    for (const request of requests) {
      await cache.delete(request);
    }

    // console.log(`Service Worker: Cleared ${requests.length} cache entries`);
  } catch (error) {
    console.error('Service Worker: Failed to clear image cache:', error);
    throw error;
  }
}

// 通知主线程图片已缓存（带元数据）
async function notifyImageCached(
  url: string,
  size: number,
  mimeType: string
): Promise<void> {
  try {
    const clients = await sw.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: 'IMAGE_CACHED',
        url,
        size,
        mimeType,
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.warn('Service Worker: Failed to notify image cached:', error);
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
        const clients = await sw.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: 'QUOTA_WARNING',
            usage,
            quota,
          });
        });
      }
    }
  } catch (error) {
    console.warn('Service Worker: Failed to check storage quota:', error);
  }
}

sw.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  const startTime = Date.now();

  // 辅助函数：确定请求类型
  function getRequestType(): string {
    if (url.pathname.startsWith(CACHE_URL_PREFIX)) return 'cache-url';
    if (url.pathname.startsWith(ASSET_LIBRARY_PREFIX)) return 'asset-library';
    if (isVideoRequest(url, event.request)) return 'video';
    if (isFontRequest(url, event.request)) return 'font';
    if (url.origin !== location.origin && isImageRequest(url, event.request))
      return 'image';
    if (event.request.mode === 'navigate') return 'navigation';
    if (event.request.destination) return event.request.destination;
    return 'other';
  }

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

  // 拦截缓存 URL 请求 (/__aitu_cache__/{type}/{taskId}.{ext})
  if (url.pathname.startsWith(CACHE_URL_PREFIX)) {
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
            updateDebugLog(debugId, {
              status: response.status,
              statusText: response.statusText,
              responseType: response.type,
              duration: Date.now() - startTime,
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
          let requestHeaders: Record<string, string> = {};

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
      headers.set('sw-cache-date', Date.now().toString());

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

// 处理缓存 URL 请求 (/__aitu_cache__/{type}/{taskId}.{ext})
// 从 Cache API 获取合并媒体并返回，视频支持 Range 请求
async function handleCacheUrlRequest(request: Request): Promise<Response> {
  const requestId = Math.random().toString(36).substring(2, 10);
  const url = new URL(request.url);
  const rangeHeader = request.headers.get('range');

  // 通过路径或扩展名判断是否为视频
  const isVideo =
    url.pathname.includes('/video/') ||
    /\.(mp4|webm|ogg|mov)$/i.test(url.pathname);

  // 检测是否为预览图请求
  const isThumbnailRequest = url.searchParams.has('thumbnail');
  if (isThumbnailRequest) {
    // 获取预览图尺寸（small 或 large，默认 small）
    const thumbnailSize = (url.searchParams.get('thumbnail') || 'small') as 'small' | 'large';
    const originalUrlForCache = new URL(url.toString());
    originalUrlForCache.searchParams.delete('thumbnail');
    
    const { findThumbnailWithFallback, createThumbnailResponse } = await import('./task-queue/utils/thumbnail-utils');
    const result = await findThumbnailWithFallback(
      originalUrlForCache.toString(),
      thumbnailSize,
      [url.pathname] // 备用 key：pathname
    );
    
    if (result) {
      const blob = await result.response.blob();
      return createThumbnailResponse(blob);
    }
    
    // 预览图不存在，回退到原图（继续正常流程）
  }

  try {
    // 从 Cache API 获取
    const cache = await caches.open(IMAGE_CACHE_NAME);

    // 优先使用完整 URL 匹配，没找到再用 pathname 匹配
    // 兼容两种缓存 key 格式（完整 URL 和相对路径）
    let cachedResponse = await cache.match(request.url);

    if (!cachedResponse) {
      cachedResponse = await cache.match(url.pathname);
    }

    if (cachedResponse) {
      const blob = await cachedResponse.blob();

      // 如果是预览图请求且预览图不存在，异步生成预览图（不阻塞响应）
      if (isThumbnailRequest && !isVideo) {
        const { generateThumbnailAsync } = await import('./task-queue/utils/thumbnail-utils');
        generateThumbnailAsync(blob, url.pathname, 'image');
      }

      if (isVideo) {
        // 视频请求支持 Range
        return createVideoResponse(blob, rangeHeader, requestId);
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

    // 如果 Cache API 没有，返回 404
    console.error(`Service Worker: Media not found in cache:`, {
      fullUrl: request.url,
      pathname: url.pathname,
    });
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
  const requestId = Math.random().toString(36).substring(2, 10);
  const url = new URL(request.url);
  const rangeHeader = request.headers.get('range');

  // 使用完整路径作为缓存 key
  const cacheKey = url.pathname;
  
  // 检测是否为预览图请求
  const isThumbnailRequest = url.searchParams.has('thumbnail');
  if (isThumbnailRequest) {
    // 获取预览图尺寸（small 或 large，默认 small）
    const thumbnailSize = (url.searchParams.get('thumbnail') || 'small') as 'small' | 'large';
    
    const { findThumbnailWithFallback, createThumbnailResponse } = await import('./task-queue/utils/thumbnail-utils');
    const result = await findThumbnailWithFallback(
      cacheKey,
      thumbnailSize,
      [cacheKey] // 备用 key：cacheKey（pathname）
    );
    
    if (result) {
      const blob = await result.response.blob();
      return createThumbnailResponse(blob);
    }
    
    // 预览图不存在，回退到原图（继续正常流程）
  }

  // console.log(`Service Worker [Asset-${requestId}]: Handling asset library request:`, cacheKey);

  try {
    // 从 Cache API 获取
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      // console.log(`Service Worker [Asset-${requestId}]: Found cached asset:`, cacheKey);
      const blob = await cachedResponse.blob();

      // 检查是否是视频请求
      const isVideo = url.pathname.match(/\.(mp4|webm|ogg|mov)$/i);

      // 如果是预览图请求且预览图不存在，异步生成预览图（不阻塞响应）
      if (isThumbnailRequest && !isVideo) {
        const { generateThumbnailAsync } = await import('./task-queue/utils/thumbnail-utils');
        generateThumbnailAsync(blob, cacheKey, 'image');
      }

      if (isVideo && rangeHeader) {
        // 视频请求支持 Range
        return createVideoResponse(blob, rangeHeader, requestId);
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

    // 如果 Cache API 没有，返回 404
    console.error(
      `Service Worker [Asset-${requestId}]: Asset not found in cache:`,
      cacheKey
    );
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

// 处理视频请求,支持 Range 请求以实现视频 seek 功能
async function handleVideoRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = Math.random().toString(36).substring(2, 10);
  // console.log(`Service Worker [Video-${requestId}]: Handling video request:`, url.href);

  try {
    // 检查请求是否包含 Range header
    const rangeHeader = request.headers.get('range');
    // console.log(`Service Worker [Video-${requestId}]: Range header:`, rangeHeader);

    // 创建去重键（移除缓存破坏参数）
    const dedupeUrl = new URL(url);
    const cacheBreakingParams = [
      '_t',
      'cache_buster',
      'v',
      'timestamp',
      'nocache',
      '_cb',
      't',
      'retry',
      'rand',
      'thumbnail', // 也移除 thumbnail 参数，用于构建缓存key
    ];
    cacheBreakingParams.forEach((param) =>
      dedupeUrl.searchParams.delete(param)
    );
    const dedupeKey = dedupeUrl.toString();
    
    // 检测是否为预览图请求（在移除参数前检查，因为需要获取尺寸）
    const isThumbnailRequest = url.searchParams.has('thumbnail');
    if (isThumbnailRequest) {
      // 获取预览图尺寸（small 或 large，默认 small）
      const thumbnailSize = (url.searchParams.get('thumbnail') || 'small') as 'small' | 'large';
      
      const { findThumbnailWithFallback, createThumbnailResponse } = await import('./task-queue/utils/thumbnail-utils');
      const result = await findThumbnailWithFallback(dedupeKey, thumbnailSize);
      
      if (result) {
        const blob = await result.response.blob();
        return createThumbnailResponse(blob);
      }
      
      // 预览图不存在，回退到原视频（继续正常流程）
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

      if (!videoBlob) {
        const fetchOptions = {
          method: 'GET',
          headers: new Headers(request.headers),
          mode: 'cors' as RequestMode,
          credentials: 'omit' as RequestCredentials,
        };
        return await fetch(url, fetchOptions);
      }

      // 使用缓存的blob响应Range请求
      return createVideoResponse(videoBlob, rangeHeader, requestId);
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
        if (videoSizeMB < 50) {
          videoBlobCache.set(dedupeKey, {
            blob: videoBlob,
            timestamp: Date.now(),
          });
          // console.log(`Service Worker [Video-${requestId}]: 视频已恢复到内存缓存`);
        }

        return createVideoResponse(videoBlob, rangeHeader, requestId);
      }
    } catch (cacheError) {
      console.warn(
        `Service Worker [Video-${requestId}]: 检查 Cache API 失败:`,
        cacheError
      );
    }

    // 创建新的视频下载Promise
    // console.log(`Service Worker [Video-${requestId}]: 开始下载新视频:`, dedupeKey);

    const downloadPromise = (async () => {
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
        console.error(
          `Service Worker [Video-${requestId}]: Video fetch failed:`,
          response.status
        );
        throw new Error(`Video fetch failed: ${response.status}`);
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
      if (videoSizeMB < 50) {
        // 1. 内存缓存（用于当前会话快速访问）
        videoBlobCache.set(dedupeKey, {
          blob: videoBlob,
          timestamp: Date.now(),
        });
        // console.log(`Service Worker [Video-${requestId}]: 视频已缓存到内存`);

        // 2. 持久化到 Cache API（用于跨会话持久化）
        try {
          const cache = await caches.open(IMAGE_CACHE_NAME);
          const cacheResponse = new Response(videoBlob, {
            headers: {
              'Content-Type': videoBlob.type || 'video/mp4',
              'Content-Length': videoBlob.size.toString(),
              'sw-cache-date': Date.now().toString(),
              'sw-video-size': videoBlob.size.toString(),
            },
          });
          await cache.put(dedupeKey, cacheResponse);
          // console.log(`Service Worker [Video-${requestId}]: 视频已持久化到 Cache API`);
          
          // 异步生成预览图（不阻塞主流程）
          // 使用与缓存key一致的URL（dedupeKey）作为预览图key
          const { generateThumbnailAsync } = await import('./task-queue/utils/thumbnail-utils');
          generateThumbnailAsync(videoBlob, dedupeKey, 'video');
        } catch (cacheError) {
          console.warn(
            `Service Worker [Video-${requestId}]: 持久化到 Cache API 失败:`,
            cacheError
          );
        }
      } else {
        // console.log(`Service Worker [Video-${requestId}]: 视频过大(${videoSizeMB.toFixed(2)}MB)，不缓存`);
      }

      return videoBlob;
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
      if (entry) {
        // const totalTime = Date.now() - entry.timestamp;
        // console.log(`Service Worker [Video-${requestId}]: 视频下载完成 (耗时${totalTime}ms，请求计数: ${entry.count})`);
        pendingVideoRequests.delete(dedupeKey);
      }
    });

    // 等待视频下载完成
    const videoBlob = await downloadPromise;

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
  } catch (error) {
    console.error(
      `Service Worker [Video-${requestId}]: Video request error:`,
      error
    );
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
  const videoSize = videoBlob.size;

  // 如果没有Range请求，返回完整视频
  if (!rangeHeader) {
    // console.log(`Service Worker [Video-${requestId}]: 返回完整视频 (大小: ${(videoSize / 1024 / 1024).toFixed(2)}MB)`);
    return new Response(videoBlob, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoSize.toString(),
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
    console.error(
      `Service Worker [Video-${requestId}]: Invalid Range header format`
    );
    return new Response(videoBlob, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const start = parseInt(rangeMatch[1], 10);
  const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : videoSize - 1;

  // console.log(`Service Worker [Video-${requestId}]: Range请求: ${start}-${end} / ${videoSize} (${((end - start + 1) / 1024).toFixed(2)}KB)`);

  // 提取指定范围的数据
  const slicedBlob = videoBlob.slice(start, end + 1);
  const contentLength = end - start + 1;

  // 构建206 Partial Content响应
  return new Response(slicedBlob, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${videoSize}`,
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
  const isHtmlRequest =
    request.mode === 'navigate' || url.pathname.endsWith('.html');
  const cache = await caches.open(STATIC_CACHE_NAME);

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

        if (!cachedResponse && isHtmlRequest) {
          cachedResponse = await cache.match('/');
          if (!cachedResponse) {
            cachedResponse = await cache.match('/index.html');
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
      if (!cachedResponse && isHtmlRequest) {
        cachedResponse = await cache.match('/');
        if (!cachedResponse) {
          cachedResponse = await cache.match('/index.html');
        }
      }

      if (cachedResponse) {
        return cachedResponse;
      }

      // No cache available
      if (isHtmlRequest) {
        return createOfflinePage();
      }
      return new Response('Resource unavailable', { status: 503 });
    }
  }

  // ===========================================
  // Production Mode: Optimized strategies
  // ===========================================

  // Strategy 1: HTML/Navigation - Network First with fast fallback
  if (isHtmlRequest) {
    try {
      // Try network first (no retries for connection errors - fail fast)
      const response = await fetchQuick(request, {
        cache: 'reload' as RequestCache,
      });

      // Cache successful responses
      if (
        response &&
        response.status === 200 &&
        request.url.startsWith('http')
      ) {
        cache.put(request, response.clone());
        return response;
      }

      // If server returns error response (4xx, 5xx), try cache first
      if (!response.ok) {
        // console.warn(`Service Worker: Server returned ${response.status} for ${request.url}, trying cache`);
        let cachedResponse = await cache.match(request);

        // For SPA, any route should fall back to index.html
        if (!cachedResponse) {
          cachedResponse = await cache.match('/');
        }
        if (!cachedResponse) {
          cachedResponse = await cache.match('/index.html');
        }

        // If not in current cache, try older static caches
        if (!cachedResponse) {
          const allCacheNames = await caches.keys();
          for (const cacheName of allCacheNames) {
            if (cacheName.startsWith('drawnix-static-v')) {
              try {
                const oldCache = await caches.open(cacheName);
                cachedResponse =
                  (await oldCache.match(request)) ||
                  (await oldCache.match('/')) ||
                  (await oldCache.match('/index.html'));
                if (cachedResponse) {
                  // console.log(`Service Worker: Found navigation fallback in ${cacheName}`);
                  break;
                }
              } catch (e) {
                // Ignore
              }
            }
          }
        }

        if (cachedResponse) {
          return cachedResponse;
        }

        // No cache available, return the error response
        return response;
      }

      return response;
    } catch (networkError) {
      // Network failed - immediately try cache (no waiting)
      let cachedResponse = await cache.match(request);

      // For SPA, any route should fall back to index.html
      if (!cachedResponse) {
        cachedResponse = await cache.match('/');
      }
      if (!cachedResponse) {
        cachedResponse = await cache.match('/index.html');
      }

      // If not in current cache, try older static caches
      if (!cachedResponse) {
        const allCacheNames = await caches.keys();
        for (const cacheName of allCacheNames) {
          if (cacheName.startsWith('drawnix-static-v')) {
            try {
              const oldCache = await caches.open(cacheName);
              cachedResponse =
                (await oldCache.match(request)) ||
                (await oldCache.match('/')) ||
                (await oldCache.match('/index.html'));
              if (cachedResponse) {
                // console.log(`Service Worker: Found navigation fallback in ${cacheName} after network failure`);
                break;
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      if (cachedResponse) {
        return cachedResponse;
      }

      // No cache - return offline page
      return createOfflinePage();
    }
  }

  // Strategy 2: Static Resources - Cache First (fast offline)
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // Cache miss - determine if this is a CDN-cacheable static resource
  const resourcePath = url.pathname;
  const isStaticResource =
    !isDevelopment &&
    (resourcePath.match(
      /\.(js|css|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot|json|ico)$/i
    ) ||
      request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'image' ||
      request.destination === 'font');

  // ============================================
  // CDN 优先策略：暂时禁用，等 npm 包发布后再启用
  // TODO: npm publish aitu-app 后取消注释下面的代码
  // ============================================
  // if (isStaticResource) {
  //   try {
  //     console.log(`[SW CDN] Trying CDN first for: ${resourcePath}`);
  //     const cdnResult = await fetchFromCDNWithFallback(
  //       resourcePath,
  //       APP_VERSION,
  //       location.origin
  //     );
  //
  //     if (cdnResult && cdnResult.response.ok) {
  //       console.log(`[SW CDN] Success from ${cdnResult.source}: ${resourcePath}`);
  //       // 缓存成功的响应
  //       const responseToCache = cdnResult.response.clone();
  //       cache.put(request, responseToCache);
  //       return cdnResult.response;
  //     }
  //   } catch (cdnError) {
  //     console.warn('[SW CDN] CDN sources failed, trying local server:', cdnError);
  //   }
  // }

  // 回退到本地服务器（开发模式或 CDN 失败）
  try {
    const response = await fetchQuick(request);

    // Validate response - don't cache HTML responses for static assets (SPA 404 fallback)
    const contentType = response.headers.get('Content-Type');
    const isInvalidResponse =
      response.status === 200 &&
      contentType?.includes('text/html') &&
      (url.pathname.match(
        /\.(js|css|png|jpg|jpeg|gif|webp|svg|json|woff|woff2|ttf)$/i
      ) ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        request.destination === 'image' ||
        request.destination === 'font');

    if (isInvalidResponse) {
      console.warn(
        'Service Worker: HTML response for static resource (404 fallback), trying old caches:',
        request.url
      );

      // Try to find the resource in any cache (including old version caches)
      const allCacheNames = await caches.keys();
      for (const cacheName of allCacheNames) {
        if (cacheName.startsWith('drawnix-static-v')) {
          try {
            const oldCache = await caches.open(cacheName);
            const oldCachedResponse = await oldCache.match(request);
            if (oldCachedResponse) {
              console.log(
                `Service Worker: Found resource in ${cacheName} after invalid HTML response`
              );
              return oldCachedResponse;
            }
          } catch (e) {
            // Ignore cache errors
          }
        }
      }

      return new Response('Resource not found', {
        status: 404,
        statusText: 'Not Found',
      });
    }

    // Cache successful responses
    if (response && response.status === 200 && request.url.startsWith('http')) {
      cache.put(request, response.clone());
    }

    // If server returns error (4xx, 5xx), try to find any cached version from old caches
    // This is particularly useful if the static directory was deleted or server is misconfigured
    if (response.status >= 400) {
      // console.warn(`Service Worker: Server error ${response.status} for static resource:`, request.url);

      // Try to find the resource in any cache (including old version caches)
      const allCacheNames = await caches.keys();
      for (const cacheName of allCacheNames) {
        if (cacheName.startsWith('drawnix-static-v')) {
          try {
            const oldCache = await caches.open(cacheName);
            const oldCachedResponse = await oldCache.match(request);
            if (oldCachedResponse) {
              // console.log(`Service Worker: Found resource in ${cacheName}`);
              return oldCachedResponse;
            }
          } catch (e) {
            // Ignore cache errors
          }
        }
      }
    }

    return response;
  } catch (networkError) {
    console.warn('[SW] Network failed, trying old caches:', request.url);

    // Try to find the resource in any cache (including old version caches)
    const allCacheNames = await caches.keys();
    for (const cacheName of allCacheNames) {
      if (cacheName.startsWith('drawnix-static-v')) {
        try {
          const oldCache = await caches.open(cacheName);
          const oldCachedResponse = await oldCache.match(request);
          if (oldCachedResponse) {
            console.log(
              `[SW] Found resource in ${cacheName} after network failure`
            );
            return oldCachedResponse;
          }
        } catch (e) {
          // Ignore cache errors
        }
      }
    }

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
  <title>离线 - OpenTu</title>
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
  <p>请检查您的网络连接，或稍后再试。</p>
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
    
    // 检测是否为预览图请求（需要在移除其他参数之前检查）
    const isThumbnailRequest = originalUrl.searchParams.has('thumbnail');
    // 在删除参数之前先获取预览图尺寸
    const thumbnailSize = isThumbnailRequest 
      ? (originalUrl.searchParams.get('thumbnail') || 'small')
      : 'small';
    
    // 检测是否要求绕过缓存检查（但仍会缓存响应）
    const bypassCache =
      originalUrl.searchParams.has('bypass_sw') ||
      originalUrl.searchParams.has('direct_fetch');
    const cacheBreakingParams = [
      '_t',
      'cache_buster',
      'v',
      'timestamp',
      'nocache',
      '_cb',
      't',
      'retry',
      '_retry',
      'rand',
      '_force',
      'bypass_sw',
      'direct_fetch',
      'thumbnail', // 也移除 thumbnail 参数，用于构建缓存key
    ];
    cacheBreakingParams.forEach((param) =>
      originalUrl.searchParams.delete(param)
    );
    const originalRequest = new Request(originalUrl.toString(), {
      method: request.method,
      headers: request.headers,
      mode: request.mode,
      credentials: request.credentials,
    });

    const dedupeKey = originalUrl.toString();
    
    // 如果是预览图请求，在移除参数后查找预览图
    if (isThumbnailRequest) {
      const { findThumbnailWithFallback, createThumbnailResponse } = await import('./task-queue/utils/thumbnail-utils');
      
      // 尝试使用 dedupeKey 和 originalRequest.url 作为备用 key
      const result = await findThumbnailWithFallback(
        dedupeKey,
        thumbnailSize as 'small' | 'large',
        [originalRequest.url] // 备用 key：原始请求 URL
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
    const requestPromise = handleImageRequestInternal(
      originalRequest,
      request.url,
      dedupeKey,
      requestId,
      bypassCache,
      isThumbnailRequest ? (thumbnailSize as 'small' | 'large') : undefined
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
        if (response && response.ok) {
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
        if (entry) {
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
    console.error('Service Worker fetch error:', error);
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
  bypassCache: boolean = false,
  requestedThumbnailSize?: 'small' | 'large'
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
          if (requestedThumbnailSize) {
            const { generateThumbnailAsync } = await import('./task-queue/utils/thumbnail-utils');
            generateThumbnailAsync(blob, originalRequest.url, 'image');
          }
          
          const cacheDate = cachedResponse.headers.get('sw-cache-date');
          if (cacheDate) {
            const now = Date.now();

            // 再次访问时延长缓存时间 - 创建新的响应并更新缓存
            const refreshedResponse = new Response(blob, {
              status: cachedResponse.status,
              statusText: cachedResponse.statusText,
              headers: {
                ...Object.fromEntries(
                  (cachedResponse.headers as any).entries()
                ),
                'sw-cache-date': now.toString(), // 更新访问时间为当前时间
              },
            });

            // 用新时间戳重新缓存（使用原始URL作为键）
            if (originalRequest.url.startsWith('http')) {
              await cache.put(originalRequest, refreshedResponse.clone());
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
                'sw-cache-date': Date.now().toString(),
              },
            });

            if (originalRequest.url.startsWith('http')) {
              await cache.put(originalRequest, refreshedResponse.clone());
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
    let response;
    let fetchOptions = [
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

      for (let options of fetchOptions) {
        try {
          // console.log(`Service Worker [${requestId}]: Trying fetch with options (${isUsingFallback ? 'fallback' : 'original'} URL, mode: ${options.mode || 'default'}):`, options);

          // Use retry logic for each fetch attempt
          let lastError;
          let isCORSError = false;
          for (let attempt = 0; attempt <= 2; attempt++) {
            try {
              // console.log(`Service Worker [${requestId}]: Fetch attempt ${attempt + 1}/3 with options on ${isUsingFallback ? 'fallback' : 'original'} URL`);
              response = await fetch(currentUrl, options);

              // 成功条件：status !== 0 或者是 opaque 响应（no-cors 模式）
              if (
                response &&
                (response.status !== 0 || response.type === 'opaque')
              ) {
                // console.log(`Service Worker [${requestId}]: Fetch successful with status: ${response.status}, type: ${response.type} from ${isUsingFallback ? 'fallback' : 'original'} URL`);
                break;
              }
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
                return opaqueResponse;
              }
            } catch (noCorsError) {
              console.warn(
                `Service Worker [${requestId}]: no-cors 模式也失败:`,
                noCorsError
              );
            }

            // 如果 no-cors 也失败，返回空响应让浏览器重试
            return new Response(null, {
              status: 200,
              headers: {
                'Content-Type': 'image/png',
                'X-SW-CORS-Bypass': 'true',
              },
            });
          }

          // 成功条件：status !== 0 或者是 opaque 响应（no-cors 模式）
          if (
            response &&
            (response.status !== 0 || response.type === 'opaque')
          ) {
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
      // 成功条件：status !== 0 或者是 opaque 响应（no-cors 模式）
      if (response && (response.status !== 0 || response.type === 'opaque')) {
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

    // 检查是否获取失败（排除 opaque 响应，那是 no-cors 模式的正常结果）
    if (!response || (response.status === 0 && response.type !== 'opaque')) {
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
        if (originalRequest.url.startsWith('http')) {
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
          'sw-cache-date': Date.now().toString(), // 添加缓存时间戳
          'sw-image-size': blob.size.toString(), // 添加图片大小信息
        },
      });

      // 尝试缓存响应，处理存储限制错误
      try {
        if (originalRequest.url.startsWith('http')) {
          await cache.put(originalRequest, corsResponse.clone());
          // console.log(`Service Worker: Normal response cached (${imageSizeMB.toFixed(2)}MB) with 30-day expiry and timestamp`);
          // 通知主线程图片已缓存
          await notifyImageCached(requestUrl, blob.size, blob.type);
          // 检查存储配额
          await checkStorageQuota();
          
          // 异步生成预览图（不阻塞主流程）
          // 使用与缓存key一致的URL（originalRequest.url）作为预览图key
          const { generateThumbnailAsync } = await import('./task-queue/utils/thumbnail-utils');
          generateThumbnailAsync(blob, originalRequest.url, 'image');
        }
      } catch (cacheError) {
        console.warn(
          `Service Worker: Failed to cache normal response (${imageSizeMB.toFixed(
            2
          )}MB, 可能超出存储限制):`,
          cacheError
        );
        // 尝试清理一些旧缓存后重试
        await cleanOldCacheEntries(cache);
        try {
          if (originalRequest.url.startsWith('http')) {
            await cache.put(originalRequest, corsResponse.clone());
            // console.log(`Service Worker: Normal response cached after cleanup (${imageSizeMB.toFixed(2)}MB)`);
            // 通知主线程图片已缓存
            await notifyImageCached(requestUrl, blob.size, blob.type);
            
            // 异步生成预览图（不阻塞主流程）
            const { generateThumbnailAsync } = await import('./task-queue/utils/thumbnail-utils');
            generateThumbnailAsync(blob, originalRequest.url, 'image');
          }
        } catch (retryError) {
          console.error(
            'Service Worker: Still failed to cache after cleanup:',
            retryError
          );
        }
      }

      return corsResponse;
    }

    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  } catch (error: any) {
    console.error('Service Worker fetch error:', error);

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
