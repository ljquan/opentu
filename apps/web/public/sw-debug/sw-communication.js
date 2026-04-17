/**
 * SW Debug Panel - Service Worker Communication Module
 * 
 * 使用 postmessage-duplex 实现可靠的点对点通信
 */

import {
  initDuplexClient,
  resetDuplexClient,
  addEventListener as addDuplexEventListener,
  getDebugStatus,
  getFetchLogs,
  clearFetchLogs as clearFetchLogsRPC,
  getConsoleLogs as getConsoleLogsRPC,
  clearConsoleLogs as clearConsoleLogsRPC,
  getPostMessageLogs,
  clearPostMessageLogs as clearPostMessageLogsRPC,
  getLLMApiLogs as getLLMApiLogsRPC,
  getLLMApiLogById as getLLMApiLogByIdRPC,
  clearLLMApiLogs as clearLLMApiLogsRPC,
  deleteLLMApiLogs as deleteLLMApiLogsRPC,
  getCrashSnapshots as getCrashSnapshotsRPC,
  clearCrashSnapshots as clearCrashSnapshotsRPC,
  getCacheStats as getCacheStatsRPC,
  enableDebugMode,
  disableDebugMode,
  sendHeartbeat,
  sendNativeMessage,
  SW_EVENTS,
} from './duplex-client.js';

// 直接读取 IndexedDB/Cache Storage（避免 RPC 通信开销和不稳定性）
import {
  getConsoleLogsDirect,
  getLLMApiLogsDirect,
  getLLMApiLogByIdDirect,
  getLinkedTaskDebugDataForLLMLog,
  getCrashSnapshotsDirect,
  getCacheStatsDirect,
} from './debug-storage-reader.js';

/** @type {Function|null} PostMessage log callback */
let postMessageLogCallback = null;

/** @type {number} Counter for generating unique log IDs */
let logIdCounter = 0;

/** @type {boolean} */
let duplexInitialized = false;

/** @type {object} Message handlers */
let messageHandlers = {};

/**
 * Track requestId -> cmdname for duplex responses
 * This allows us to show the correct message type for responses that don't include the request info
 * @type {Map<string, {cmdname: string, timestamp: number}>}
 */
const requestIdToMethod = new Map();

/** Max age for request tracking entries (5 minutes) */
const REQUEST_TRACKING_MAX_AGE = 5 * 60 * 1000;

/**
 * Track an outgoing request's requestId and cmdname
 * @param {string} requestId
 * @param {string} cmdname
 */
function trackOutgoingRequest(requestId, cmdname) {
  // Clean up old entries first
  const now = Date.now();
  for (const [id, entry] of requestIdToMethod.entries()) {
    if (now - entry.timestamp > REQUEST_TRACKING_MAX_AGE) {
      requestIdToMethod.delete(id);
    }
  }
  
  requestIdToMethod.set(requestId, { cmdname, timestamp: now });
}

/**
 * Look up the cmdname for a response by requestId
 * @param {string} requestId
 * @returns {string|null}
 */
function lookupRequestMethod(requestId) {
  const entry = requestIdToMethod.get(requestId);
  if (entry) {
    // Remove after lookup (one-time use)
    requestIdToMethod.delete(requestId);
    return entry.cmdname;
  }
  return null;
}

/** @type {boolean} Flag to prevent double-wrapping postMessage */
let postMessageWrapped = false;

/**
 * Wrap navigator.serviceWorker.controller.postMessage to intercept outgoing messages
 * This allows us to track requestId -> cmdname for duplex protocol messages
 */
function wrapPostMessage() {
  if (postMessageWrapped) return;
  
  // We need to wrap the postMessage on any controller that gets set
  // Use a getter/setter on navigator.serviceWorker to catch controller changes
  const originalDescriptor = Object.getOwnPropertyDescriptor(ServiceWorkerContainer.prototype, 'controller');
  
  if (originalDescriptor && originalDescriptor.get) {
    let lastController = null;
    
    Object.defineProperty(navigator.serviceWorker, 'controller', {
      get() {
        const controller = originalDescriptor.get.call(this);
        if (controller && controller !== lastController) {
          lastController = controller;
          wrapControllerPostMessage(controller);
        }
        return controller;
      },
      configurable: true,
    });
    
    // Also wrap the current controller if it exists
    const currentController = originalDescriptor.get.call(navigator.serviceWorker);
    if (currentController) {
      wrapControllerPostMessage(currentController);
    }
  }
  
  postMessageWrapped = true;
}

/**
 * Wrap a specific controller's postMessage method
 * @param {ServiceWorker} controller
 */
function wrapControllerPostMessage(controller) {
  if (controller._postMessageWrapped) return;
  
  const originalPostMessage = controller.postMessage.bind(controller);
  
  controller.postMessage = function(message, transfer) {
    // Track duplex protocol messages (those with requestId and cmdname)
    if (message && typeof message === 'object' && message.requestId && message.cmdname) {
      trackOutgoingRequest(message.requestId, message.cmdname);
      // Log the outgoing message
      logPostMessage('send', message.cmdname, message);
    }
    
    return originalPostMessage(message, transfer);
  };
  
  controller._postMessageWrapped = true;
}

/**
 * Set the callback for PostMessage logging
 * @param {Function} callback - Called with (logEntry) when a message is sent/received
 */
export function setPostMessageLogCallback(callback) {
  postMessageLogCallback = callback;
}

/**
 * Message types from the debug panel itself (should be filtered out)
 * We only want to show main application's communications
 */
const DEBUG_PANEL_MESSAGE_PREFIXES = [
  'SW_DEBUG_',
  'SW_POSTMESSAGE_',
  'SW_CHANNEL_',
  'SW_CONSOLE_',
  // postmessage-duplex debug event prefixes
  'debug:',
  'console:',
  'postmessage:',
  'crash:',
];

/**
 * Check if a message type is from the debug panel
 * @param {string} messageType
 * @returns {boolean}
 */
function isDebugPanelMessage(messageType) {
  if (!messageType || typeof messageType !== 'string') {
    return false;
  }
  return DEBUG_PANEL_MESSAGE_PREFIXES.some(prefix => messageType.startsWith(prefix));
}

/**
 * Log a PostMessage event
 * @param {'send'|'receive'} direction
 * @param {string} messageType
 * @param {object} data
 * @param {object} [response]
 * @param {string} [error]
 */
function logPostMessage(direction, messageType, data, response, error) {
  // Filter out debug panel's own messages - only log main application communications
  if (isDebugPanelMessage(messageType)) {
    return;
  }

  if (postMessageLogCallback) {
    const entry = {
      id: `pm-${Date.now()}-${++logIdCounter}`,
      timestamp: Date.now(),
      direction,
      messageType,
      data,
      response,
      error,
    };
    postMessageLogCallback(entry);
  }
}

/**
 * 初始化 duplex 通信
 * @returns {Promise<boolean>}
 */
async function ensureDuplexInitialized() {
  if (duplexInitialized) return true;
  
  try {
    const success = await initDuplexClient();
    if (success) {
      duplexInitialized = true;
      setupDuplexEventHandlers();
      console.log('[SW Communication] Duplex communication initialized');
    }
    return success;
  } catch (error) {
    console.error('[SW Communication] Failed to initialize duplex:', error);
    return false;
  }
}

/**
 * 设置 duplex 事件处理
 */
function setupDuplexEventHandlers() {
  // 调试状态变更 - 映射到 SW_DEBUG_ENABLED/SW_DEBUG_DISABLED
  addDuplexEventListener(SW_EVENTS.DEBUG_STATUS_CHANGED, (data) => {
    const enabled = data?.enabled;
    if (enabled && messageHandlers['SW_DEBUG_ENABLED']) {
      messageHandlers['SW_DEBUG_ENABLED'](data);
    } else if (!enabled && messageHandlers['SW_DEBUG_DISABLED']) {
      messageHandlers['SW_DEBUG_DISABLED'](data);
    }
  });

  // Fetch 日志（SW 的调试日志）
  addDuplexEventListener(SW_EVENTS.DEBUG_LOG, (data) => {
    if (messageHandlers['SW_DEBUG_LOG']) {
      messageHandlers['SW_DEBUG_LOG'](data);
    }
  });

  // Console 日志（duplex 广播，与 SW_CONSOLE_LOG 原生消息格式一致：{ entry }）
  addDuplexEventListener(SW_EVENTS.CONSOLE_LOG, (data) => {
    if (messageHandlers['SW_CONSOLE_LOG']) {
      messageHandlers['SW_CONSOLE_LOG'](data);
    }
  });

  // PostMessage 日志
  addDuplexEventListener(SW_EVENTS.POSTMESSAGE_LOG, (data) => {
    if (messageHandlers['SW_DEBUG_POSTMESSAGE_LOG']) {
      messageHandlers['SW_DEBUG_POSTMESSAGE_LOG'](data);
    }
  });

  // PostMessage 日志批量
  addDuplexEventListener(SW_EVENTS.POSTMESSAGE_LOG_BATCH, (data) => {
    if (messageHandlers['SW_DEBUG_POSTMESSAGE_LOG_BATCH']) {
      messageHandlers['SW_DEBUG_POSTMESSAGE_LOG_BATCH'](data);
    }
  });

  // LLM API 日志
  addDuplexEventListener(SW_EVENTS.DEBUG_LLM_LOG, (data) => {
    if (messageHandlers['SW_DEBUG_LLM_API_LOG']) {
      messageHandlers['SW_DEBUG_LLM_API_LOG'](data);
    }
  });
}

/**
 * Enable debug mode
 */
export function enableDebug() {
  try { sessionStorage.setItem('sw-debug-enabled', 'true'); } catch {}
  enableDebugMode();
}

/**
 * Disable debug mode
 */
export function disableDebug() {
  try { sessionStorage.setItem('sw-debug-enabled', 'false'); } catch {}
  disableDebugMode();
}

/**
 * Send heartbeat to keep debug mode alive
 */
export function heartbeat() {
  sendHeartbeat();
}

/**
 * Request status update (uses duplex RPC)
 */
export async function refreshStatus() {
  await ensureDuplexInitialized();
  
  try {
    const result = await getDebugStatus();
    if (messageHandlers['SW_DEBUG_STATUS']) {
      // Wrap the result to match the expected format: { status: {...} }
      messageHandlers['SW_DEBUG_STATUS']({ status: result });
    }
  } catch (error) {
    console.error('[SW Communication] Failed to get debug status:', error);
    // 回退到原生方式
    sendNativeMessage('SW_DEBUG_GET_STATUS');
  }
}

/**
 * Load fetch logs from SW (uses duplex RPC)
 */
export async function loadFetchLogs() {
  await ensureDuplexInitialized();
  
  try {
    const result = await getFetchLogs();
    if (messageHandlers['SW_DEBUG_LOGS']) {
      messageHandlers['SW_DEBUG_LOGS'](result);
    }
  } catch (error) {
    console.error('[SW Communication] Failed to load fetch logs:', error);
    sendNativeMessage('SW_DEBUG_GET_LOGS');
  }
}

/**
 * Clear fetch logs (uses duplex RPC)
 */
export async function clearFetchLogs() {
  await ensureDuplexInitialized();
  
  try {
    await clearFetchLogsRPC();
    if (messageHandlers['SW_DEBUG_LOGS_CLEARED']) {
      messageHandlers['SW_DEBUG_LOGS_CLEARED']({});
    }
  } catch (error) {
    console.error('[SW Communication] Failed to clear fetch logs:', error);
    sendNativeMessage('SW_DEBUG_CLEAR_LOGS');
  }
}

/**
 * Clear console logs (uses duplex RPC)
 */
export async function clearConsoleLogs() {
  await ensureDuplexInitialized();
  
  try {
    await clearConsoleLogsRPC();
    if (messageHandlers['SW_DEBUG_CONSOLE_LOGS_CLEARED']) {
      messageHandlers['SW_DEBUG_CONSOLE_LOGS_CLEARED']({});
    }
  } catch (error) {
    console.error('[SW Communication] Failed to clear console logs:', error);
    sendNativeMessage('SW_DEBUG_CLEAR_CONSOLE_LOGS');
  }
}

/**
 * Request all console logs from IndexedDB (直接读取，避免 RPC)
 */
export async function loadConsoleLogs() {
  try {
    // 优先直接从 IndexedDB 读取
    const result = await getConsoleLogsDirect(1000);
    if (messageHandlers['SW_DEBUG_CONSOLE_LOGS']) {
      messageHandlers['SW_DEBUG_CONSOLE_LOGS'](result);
    }
  } catch (error) {
    console.error('[SW Communication] Failed to load console logs directly, falling back to RPC:', error);
    // Fallback to RPC
    try {
      await ensureDuplexInitialized();
      const result = await getConsoleLogsRPC(1000);
      if (messageHandlers['SW_DEBUG_CONSOLE_LOGS']) {
        messageHandlers['SW_DEBUG_CONSOLE_LOGS'](result);
      }
    } catch (rpcError) {
      console.error('[SW Communication] RPC fallback also failed:', rpcError);
    }
  }
}

/**
 * Load PostMessage logs from SW (uses duplex RPC)
 */
export async function loadPostMessageLogs() {
  await ensureDuplexInitialized();
  
  try {
    const result = await getPostMessageLogs(500);
    if (messageHandlers['SW_DEBUG_POSTMESSAGE_LOGS']) {
      messageHandlers['SW_DEBUG_POSTMESSAGE_LOGS'](result);
    }
  } catch (error) {
    console.error('[SW Communication] Failed to load postmessage logs:', error);
    sendNativeMessage('SW_DEBUG_GET_POSTMESSAGE_LOGS', { limit: 500 });
  }
}

/**
 * Clear PostMessage logs in SW (uses duplex RPC)
 */
export async function clearPostMessageLogs() {
  await ensureDuplexInitialized();
  
  try {
    await clearPostMessageLogsRPC();
    if (messageHandlers['SW_DEBUG_POSTMESSAGE_LOGS_CLEARED']) {
      messageHandlers['SW_DEBUG_POSTMESSAGE_LOGS_CLEARED']({});
    }
  } catch (error) {
    console.error('[SW Communication] Failed to clear postmessage logs:', error);
    sendNativeMessage('SW_DEBUG_CLEAR_POSTMESSAGE_LOGS');
  }
}

/**
 * Load LLM API logs (直接从 IndexedDB 读取，避免 RPC)
 * @param {number} page - 页码，默认 1
 * @param {number} pageSize - 每页条数，默认 20
 * @param {object} filter - 过滤条件 { taskType?, status? }
 */
export async function loadLLMApiLogs(page = 1, pageSize = 20, filter = {}) {
  try {
    // 优先直接从 IndexedDB 读取
    const result = await getLLMApiLogsDirect(page, pageSize, filter);
    return result;
  } catch (error) {
    console.error('[SW Communication] Failed to load LLM API logs directly, falling back to RPC:', error);
    // Fallback to RPC
    try {
      await ensureDuplexInitialized();
      const result = await getLLMApiLogsRPC(page, pageSize, filter);
      return result;
    } catch (rpcError) {
      console.error('[SW Communication] RPC fallback also failed:', rpcError);
      return null;
    }
  }
}

/**
 * Clear LLM API logs in SW (uses duplex RPC)
 */
export async function clearLLMApiLogsInSW() {
  await ensureDuplexInitialized();
  
  try {
    await clearLLMApiLogsRPC();
    if (messageHandlers['SW_DEBUG_LLM_API_LOGS_CLEARED']) {
      messageHandlers['SW_DEBUG_LLM_API_LOGS_CLEARED']({});
    }
  } catch (error) {
    console.error('[SW Communication] Failed to clear LLM API logs:', error);
    sendNativeMessage('SW_DEBUG_CLEAR_LLM_API_LOGS');
  }
}

/**
 * Delete specific LLM API logs in SW (uses duplex RPC)
 * @param {string[]} logIds - 要删除的日志 ID 列表
 * @returns {Promise<{success: boolean, deletedCount: number}>}
 */
export async function deleteLLMApiLogsInSW(logIds) {
  await ensureDuplexInitialized();
  
  try {
    const result = await deleteLLMApiLogsRPC(logIds);
    return result;
  } catch (error) {
    console.error('[SW Communication] Failed to delete LLM API logs:', error);
    return { success: false, deletedCount: 0 };
  }
}

/**
 * Get a single LLM API log by ID (full data including responseBody)
 * @param {string} logId - 日志 ID
 * @returns {Promise<object|null>}
 */
export async function getLLMApiLogByIdInSW(logId) {
  try {
    // 优先直接从 IndexedDB 读取
    const log = await getLLMApiLogByIdDirect(logId);
    if (!log) {
      return null;
    }

    const linkedTask = await getLinkedTaskDebugDataForLLMLog(log);
    return linkedTask ? { ...log, linkedTask } : log;
  } catch (error) {
    console.error('[SW Communication] Failed to get LLM API log by ID directly, falling back to RPC:', error);
    // Fallback to RPC
    try {
      await ensureDuplexInitialized();
      const result = await getLLMApiLogByIdRPC(logId);
      const log = result?.log || null;
      if (!log) {
        return null;
      }

      const linkedTask = await getLinkedTaskDebugDataForLLMLog(log);
      return linkedTask ? { ...log, linkedTask } : log;
    } catch (rpcError) {
      console.error('[SW Communication] RPC fallback also failed:', rpcError);
      return null;
    }
  }
}

/**
 * Load crash snapshots (直接从 IndexedDB 读取，避免 RPC)
 */
export async function loadCrashSnapshots() {
  try {
    // 优先直接从 IndexedDB 读取
    const result = await getCrashSnapshotsDirect();
    if (messageHandlers['SW_DEBUG_CRASH_SNAPSHOTS']) {
      messageHandlers['SW_DEBUG_CRASH_SNAPSHOTS'](result);
    }
    return result;
  } catch (error) {
    console.error('[SW Communication] Failed to load crash snapshots directly, falling back to RPC:', error);
    // Fallback to RPC
    try {
      await ensureDuplexInitialized();
      const result = await getCrashSnapshotsRPC();
      if (messageHandlers['SW_DEBUG_CRASH_SNAPSHOTS']) {
        messageHandlers['SW_DEBUG_CRASH_SNAPSHOTS'](result);
      }
      return result;
    } catch (rpcError) {
      console.error('[SW Communication] RPC fallback also failed:', rpcError);
      return null;
    }
  }
}

/**
 * Clear crash snapshots in SW (uses duplex RPC)
 */
export async function clearCrashSnapshotsInSW() {
  await ensureDuplexInitialized();
  
  try {
    await clearCrashSnapshotsRPC();
    if (messageHandlers['SW_DEBUG_CRASH_SNAPSHOTS_CLEARED']) {
      messageHandlers['SW_DEBUG_CRASH_SNAPSHOTS_CLEARED']({});
    }
  } catch (error) {
    console.error('[SW Communication] Failed to clear crash snapshots:', error);
    sendNativeMessage('SW_DEBUG_CLEAR_CRASH_SNAPSHOTS');
  }
}

/**
 * Request cache stats (直接从 Cache Storage 读取，避免 RPC)
 */
export async function loadCacheStats() {
  try {
    // 优先直接从 Cache Storage 读取
    const result = await getCacheStatsDirect();
    if (messageHandlers['SW_DEBUG_CACHE_STATS']) {
      messageHandlers['SW_DEBUG_CACHE_STATS'](result);
    }
    return result;
  } catch (error) {
    console.error('[SW Communication] Failed to load cache stats directly, falling back to RPC:', error);
    // Fallback to RPC
    try {
      await ensureDuplexInitialized();
      const result = await getCacheStatsRPC();
      if (messageHandlers['SW_DEBUG_CACHE_STATS']) {
        messageHandlers['SW_DEBUG_CACHE_STATS'](result);
      }
      return result;
    } catch (rpcError) {
      console.error('[SW Communication] RPC fallback also failed:', rpcError);
      return null;
    }
  }
}

/** @type {ServiceWorkerRegistration|null} */
let cachedRegistration = null;

/**
 * Check if SW is available and ready
 * Also initializes duplex client
 * @returns {Promise<boolean>}
 */
export async function checkSwReady() {
  if (!('serviceWorker' in navigator)) {
    return false;
  }
  
  const registration = await navigator.serviceWorker.ready;
  cachedRegistration = registration;
  
  // If SW is active, initialize duplex communication
  if (registration.active) {
    await ensureDuplexInitialized();
    return true;
  }
  
  return false;
}

/**
 * Get the active SW to send messages to
 * Prefers controller, falls back to registration.active
 * @returns {ServiceWorker|null}
 */
export function getActiveSW() {
  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }
  if (cachedRegistration?.active) {
    return cachedRegistration.active;
  }
  return null;
}

/**
 * Register message handler for SW messages
 * Also sets up duplex event handlers
 * @param {object} handlers - Message type to handler function map
 */
export function registerMessageHandlers(handlers) {
  messageHandlers = handlers;
  
  // Initialize postMessage wrapper to track outgoing requests
  wrapPostMessage();
  
  // Also listen for native messages (for backward compatibility)
  navigator.serviceWorker.addEventListener('message', (event) => {
    // Extract message type from different message formats:
    // - Native messages: event.data.type
    // - postmessage-duplex requests: event.data.cmdname
    // - postmessage-duplex responses: event.data.req.cmdname
    // - postmessage-duplex responses without req: lookup by requestId
    let messageType = event.data?.type 
      || event.data?.cmdname 
      || event.data?.req?.cmdname;
    
    // For duplex responses without embedded request info, try to look up the method
    if (!messageType && event.data?.requestId && event.data?.ret !== undefined) {
      const trackedMethod = lookupRequestMethod(event.data.requestId);
      messageType = trackedMethod ? `${trackedMethod} [response]` : '[response]';
    }
    
    messageType = messageType || 'unknown';
    const { type, cmdname, req, ...data } = event.data || {};

    // Log the incoming message (filtering handled inside logPostMessage)
    logPostMessage('receive', messageType, data);

    if (handlers[messageType]) {
      handlers[messageType](data);
    }
  });
}

/**
 * Register controller change handler
 * @param {Function} callback 
 */
export function onControllerChange(callback) {
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (navigator.serviceWorker.controller) {
      console.log('[SW Communication] Controller changed, resetting duplex client');
      // 完全重置 duplex 客户端
      resetDuplexClient();
      duplexInitialized = false;
      
      // 重新初始化
      await ensureDuplexInitialized();
      callback();
    }
  });
}

// 导出 duplex 初始化函数供外部使用
export { ensureDuplexInitialized };
