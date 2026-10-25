/**
 * PostMessage Logger for Service Worker
 *
 * 记录主线程与Service Worker之间的所有消息通讯
 * 用于调试面板的PostMessage日志功能
 *
 * 注意：只有在调试模式启用时才会记录日志，避免影响性能。
 * PostMessage 日志记录完全由调试模式控制，不会对未开启调试模式的应用性能产生影响。
 */

import { sanitizeObject as sanitizeObjectFromUtils } from '@aitu/utils';

// 调试模式开关（默认关闭，避免影响性能）
let debugModeEnabled = false;

// 日志存储（保留最近500条）
const MAX_LOGS = 500;
const logs: PostMessageLogEntry[] = [];

// 消息ID计数器
let logIdCounter = 0;

/**
 * 内部标志：检查是否真的已启用调试模式
 * 用于防止调试面板自身的消息被记录
 */
function isDebugModeActive(): boolean {
  return debugModeEnabled;
}

export interface PostMessageLogEntry {
  id: string;
  timestamp: number;
  direction: 'send' | 'receive';
  messageType: string;
  data?: unknown;
  response?: unknown;
  error?: string;
  clientId?: string;
  clientUrl?: string;
  clientType?: 'main' | 'debug' | 'other'; // 区分应用页面、调试面板、其他
  duration?: number;
}

// 排除的消息类型（调试面板自身的消息）
// 包括 native message types 和 postmessage-duplex event names
const EXCLUDED_MESSAGE_TYPES = [
  // Native message types
  'SW_DEBUG_ENABLE',
  'SW_DEBUG_DISABLE',
  'SW_DEBUG_GET_STATUS',
  'SW_DEBUG_CLEAR_LOGS',
  'SW_DEBUG_CLEAR_CONSOLE_LOGS',
  'SW_DEBUG_GET_CONSOLE_LOGS',
  'SW_DEBUG_EXPORT_LOGS',
  'SW_DEBUG_HEARTBEAT',
  'SW_DEBUG_STATUS',
  'SW_DEBUG_ENABLED',
  'SW_DEBUG_DISABLED',
  'SW_DEBUG_LOG',
  'SW_DEBUG_LOGS',
  'SW_DEBUG_LOGS_CLEARED',
  'SW_CONSOLE_LOG',
  'SW_DEBUG_CONSOLE_LOGS',
  'SW_DEBUG_CONSOLE_LOGS_CLEARED',
  'SW_POSTMESSAGE_LOG',
  'SW_DEBUG_POSTMESSAGE_LOGS',
  'SW_DEBUG_POSTMESSAGE_LOGS_CLEARED',
  'SW_DEBUG_NEW_CRASH_SNAPSHOT',
  'SW_DEBUG_CRASH_SNAPSHOTS',
  'SW_DEBUG_CRASH_SNAPSHOTS_CLEARED',
  'SW_DEBUG_GET_CRASH_SNAPSHOTS',
  'SW_DEBUG_CLEAR_CRASH_SNAPSHOTS',
  'CRASH_SNAPSHOT',
  // postmessage-duplex debug event names (避免死循环)
  'debug:log',
  'debug:llmLog',
  'debug:statusChanged',
  'debug:enable',
  'debug:disable',
  'debug:getStatus',
  'debug:getLogs',
  'debug:clearLogs',
  'debug:getConsoleLogs',
  'debug:clearConsoleLogs',
  'debug:getPostMessageLogs',
  'debug:clearPostMessageLogs',
  'debug:getCrashSnapshots',
  'debug:clearCrashSnapshots',
  'debug:getLLMApiLogs',
  'debug:clearLLMApiLogs',
  'debug:getCacheStats',
  'debug:exportLogs',
  'debug:newCrashSnapshot',
  'console:log',
  'console:report',
  'postmessage:log',
  'postmessage:logBatch',
  'crash:snapshot',
  'crash:heartbeat',
];

// 请求-响应关联映射
const pendingRequests = new Map<string, {
  entry: PostMessageLogEntry;
  startTime: number;
}>();

/**
 * 设置调试模式
 * 只有调试模式启用时才记录日志
 */
export function setPostMessageLoggerDebugMode(enabled: boolean): void {
  const wasEnabled = debugModeEnabled;
  debugModeEnabled = enabled;
  
  if (!enabled && wasEnabled) {
    // 从启用变为禁用时，立即清空日志，释放内存
    logs.length = 0;
    pendingRequests.clear();
    logIdCounter = 0;
  }
}

/**
 * 检查调试模式是否启用
 */
export function isPostMessageLoggerDebugMode(): boolean {
  return debugModeEnabled;
}

/**
 * 检查消息是否应该被记录
 * 只有调试模式启用且消息类型不在排除列表中时才记录
 */
function shouldLogMessage(messageType: string): boolean {
  // 调试模式未启用时，立即返回 false，不进行任何记录操作
  if (!isDebugModeActive()) {
    return false;
  }
  
  // 过滤掉 unknown 类型的消息（通常是 postmessage-duplex 的内部响应）
  if (messageType === 'unknown') {
    return false;
  }
  
  // 直接匹配排除列表
  if (EXCLUDED_MESSAGE_TYPES.includes(messageType)) {
    return false;
  }
  
  // 处理 RPC 格式的消息: RPC:xxx 或 RPC:xxx:response 或 RPC:xxx:error
  // 提取实际的方法名（去掉 RPC: 前缀和 :response/:error 后缀）
  if (messageType.startsWith('RPC:')) {
    let methodName = messageType.slice(4); // 去掉 "RPC:" 前缀
    if (methodName.endsWith(':response')) {
      methodName = methodName.slice(0, -9);
    } else if (methodName.endsWith(':error')) {
      methodName = methodName.slice(0, -6);
    }
    // 检查方法名是否在排除列表中
    if (EXCLUDED_MESSAGE_TYPES.includes(methodName)) {
      return false;
    }
  }
  
  return true;
}

/**
 * 获取客户端类型和 URL（用于在 SW 环境中识别应用页面）
 * @returns {object} { type: 'main' | 'debug' | 'other', url?: string }
 */
function getClientInfo(clientUrl?: string): { clientType?: string; clientUrl?: string } {
  if (!clientUrl) {
    return {};
  }

  let clientType: 'main' | 'debug' | 'other' = 'other';

  // 判断客户端类型
  if (clientUrl.includes('sw-debug')) {
    clientType = 'debug';
  } else if (clientUrl.includes('localhost') || clientUrl.includes('127.0.0.1')) {
    clientType = 'main';
  } else if (!clientUrl.includes('chrome-extension') && !clientUrl.includes('moz-extension')) {
    clientType = 'main';
  }

  return {
    clientType,
    clientUrl: new URL(clientUrl).pathname + new URL(clientUrl).search,
  };
}

/**
 * 记录收到的消息
 */
export function logReceivedMessage(
  messageType: string,
  data: unknown,
  clientId?: string,
  clientUrl?: string,
  isInternal?: boolean
): string {
  // 跳过内部消息，防止循环记录
  if (isInternal) {
    return '';
  }

  if (!shouldLogMessage(messageType)) {
    return '';
  }

  const clientInfo = getClientInfo(clientUrl);
  
  // 过滤掉调试面板客户端的消息
  if (clientInfo.clientType === 'debug') {
    return '';
  }
  const logId = `pm-recv-${Date.now()}-${++logIdCounter}`;
  const entry: PostMessageLogEntry = {
    id: logId,
    timestamp: Date.now(),
    direction: 'receive',
    messageType,
    data: sanitizeData(data),
    clientId,
    clientUrl: clientInfo.clientUrl,
    clientType: clientInfo.clientType as any,
  };

  addLog(entry);

  // 如果是请求类消息，记录开始时间
  if (isRequestMessage(messageType)) {
    const requestId = getRequestId(data);
    if (requestId) {
      pendingRequests.set(requestId, {
        entry,
        startTime: Date.now(),
      });
    }
  }

  return logId;
}

/**
 * 记录发送的消息
 */
export function logSentMessage(
  messageType: string,
  data: unknown,
  clientId?: string,
  clientUrl?: string
): string {
  if (!shouldLogMessage(messageType)) {
    return '';
  }

  const clientInfo = getClientInfo(clientUrl);
  
  // 过滤掉发送给调试面板的消息
  if (clientInfo.clientType === 'debug') {
    return '';
  }
  const logId = `pm-send-${Date.now()}-${++logIdCounter}`;
  const entry: PostMessageLogEntry = {
    id: logId,
    timestamp: Date.now(),
    direction: 'send',
    messageType,
    data: sanitizeData(data),
    clientId,
    clientUrl: clientInfo.clientUrl,
    clientType: clientInfo.clientType as any,
  };

  // 关联的请求条目 ID（用于广播更新后的请求）
  let linkedRequestId: string | null = null;

  // 如果是响应类消息，关联请求并计算耗时
  if (isResponseMessage(messageType)) {
    const requestId = getRequestId(data);
    if (requestId) {
      const pending = pendingRequests.get(requestId);
      if (pending) {
        entry.duration = Date.now() - pending.startTime;
        pending.entry.response = sanitizeData(data);
        pending.entry.duration = entry.duration;
        linkedRequestId = pending.entry.id;
        pendingRequests.delete(requestId);
      }
    }
  }

  addLog(entry);
  
  // 返回响应 logId 和关联的请求 logId（如果有）
  // 格式: "responseId|requestId" 或 "responseId"
  return linkedRequestId ? `${logId}|${linkedRequestId}` : logId;
}

/**
 * 添加日志条目
 */
function addLog(entry: PostMessageLogEntry): void {
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }
}

/**
 * 更新请求日志的响应数据（不创建新的日志条目）
 * 用于双工通讯场景，将响应合并到请求日志中显示
 * @returns 更新后的请求日志 ID，如果找不到请求则返回空字符串
 */
export function updateRequestWithResponse(
  requestId: string,
  response: unknown,
  duration: number,
  error?: string
): string {
  if (!isDebugModeActive()) {
    return '';
  }

  const pending = pendingRequests.get(requestId);
  if (pending) {
    pending.entry.response = sanitizeData(response);
    pending.entry.duration = duration;
    if (error) {
      pending.entry.error = error;
    }
    const logId = pending.entry.id;
    pendingRequests.delete(requestId);
    return logId;
  }
  
  return '';
}

/**
 * 获取所有日志
 */
export function getAllLogs(): PostMessageLogEntry[] {
  return [...logs];
}

/**
 * 清空日志
 */
export function clearLogs(): void {
  logs.length = 0;
  pendingRequests.clear();
  logIdCounter = 0;
}

/**
 * 判断是否为请求类消息
 */
function isRequestMessage(messageType: string): boolean {
  // RPC 请求：以 RPC: 开头，但不以 :response 或 :error 结尾
  if (messageType.startsWith('RPC:') && !messageType.endsWith(':response') && !messageType.endsWith(':error')) {
    return true;
  }
  
  const requestPatterns = [
    'TASK_SUBMIT',
    'TASK_CANCEL',
    'TASK_RETRY',
    'TASK_DELETE',
    'TASK_GET_',
    'WORKFLOW_SUBMIT',
    'WORKFLOW_CANCEL',
    'WORKFLOW_GET_',
    'CHAT_START',
    'MCP_TOOL_EXECUTE',
    'MAIN_THREAD_TOOL_REQUEST',
  ];
  return requestPatterns.some(p => messageType.includes(p));
}

/**
 * 判断是否为响应类消息
 */
function isResponseMessage(messageType: string): boolean {
  // RPC 响应：以 :response 或 :error 结尾
  if (messageType.endsWith(':response') || messageType.endsWith(':error')) {
    return true;
  }
  
  const responsePatterns = [
    'TASK_QUEUE_INITIALIZED',
    'TASK_STATUS',
    'TASK_COMPLETED',
    'TASK_FAILED',
    'TASK_CREATED',
    'TASK_CANCELLED',
    'TASK_DELETED',
    'WORKFLOW_STATUS',
    'WORKFLOW_STEP_STATUS',
    'WORKFLOW_COMPLETED',
    'WORKFLOW_FAILED',
    'CHAT_CHUNK',
    'CHAT_DONE',
    'CHAT_ERROR',
    'MCP_TOOL_RESULT',
    'MAIN_THREAD_TOOL_RESPONSE',
  ];
  return responsePatterns.some(p => messageType.includes(p));
}

/**
 * 从消息数据中提取请求ID
 */
function getRequestId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  return (obj.requestId as string) 
    || (obj.taskId as string) 
    || (obj.workflowId as string) 
    || (obj.chatId as string) 
    || null;
}

/**
 * 清理敏感数据 - 使用 @aitu/utils 的 sanitizeObject
 */
function sanitizeData(data: unknown): unknown {
  if (!data) return data;

  try {
    // 使用 JSON 深拷贝确保可序列化，然后使用 utils 的 sanitize
    const cloned = JSON.parse(JSON.stringify(data));
    return sanitizeObjectFromUtils(cloned);
  } catch {
    // 无法序列化的数据
    return '[Non-serializable data]';
  }
}

/**
 * 获取日志统计信息
 */
export function getLogStats(): {
  total: number;
  sent: number;
  received: number;
  byType: Record<string, number>;
} {
  const stats = {
    total: logs.length,
    sent: 0,
    received: 0,
    byType: {} as Record<string, number>,
  };

  for (const log of logs) {
    if (log.direction === 'send') {
      stats.sent++;
    } else {
      stats.received++;
    }

    if (!stats.byType[log.messageType]) {
      stats.byType[log.messageType] = 0;
    }
    stats.byType[log.messageType]++;
  }

  return stats;
}
