/**
 * LLM API Logger for Service Worker
 *
 * 记录所有大模型 API 调用，用于成本追踪和调试。
 * 此日志记录不受调试模式影响，始终运行。
 * 数据持久化到 IndexedDB，可在 sw-debug.html 查看和导出。
 */

import { sanitizeRequestBody } from './utils/sanitize-utils';

export interface LLMReferenceImage {
  url: string; // Base64 或虚拟路径 URL (用于预览)
  size: number; // 大小 (字节)
  width: number; // 宽度 (像素)
  height: number; // 高度 (像素)
  name?: string; // 可选名称
}

export interface LLMApiLog {
  id: string;
  timestamp: number;

  // 请求信息
  endpoint: string; // API endpoint (e.g., /images/generations, /chat/completions)
  model: string; // 使用的模型
  taskType: 'image' | 'video' | 'audio' | 'chat' | 'character' | 'other';

  // 请求参数（脱敏后）
  prompt?: string; // 提示词
  requestBody?: string; // 完整请求体（JSON 格式，用于调试）
  hasReferenceImages?: boolean; // 是否有参考图
  referenceImageCount?: number; // 参考图数量
  referenceImages?: LLMReferenceImage[]; // 参考图详情

  // 响应信息
  status: 'pending' | 'success' | 'error';
  httpStatus?: number;
  duration?: number; // 耗时（毫秒）

  // 结果
  resultType?: string; // 结果类型 (image/video/text)
  resultCount?: number; // 生成数量
  resultUrl?: string; // 生成的图片/视频 URL
  resultText?: string; // 聊天响应文本（截断）
  responseBody?: string; // 原始响应体（超大时限长截断）
  errorMessage?: string; // 错误信息
  remoteId?: string; // API 厂商的任务 ID (用于异步任务恢复)

  // 关联任务
  taskId?: string;
  workflowId?: string;
}

// 内存中的日志缓存（最近 N 条）
const memoryLogs: LLMApiLog[] = [];
const MAX_MEMORY_LOGS = 50;

// IndexedDB 配置
const DB_NAME = 'llm-api-logs';
const DB_VERSION = 4; // Bump to ensure taskId index exists
const STORE_NAME = 'logs';
const MAX_DB_LOGS = 1000; // IndexedDB 中最多保存的日志数量
const MAX_RESPONSE_BODY_LENGTH = 128 * 1024; // 保留原始 JSON，极端大响应再截断，避免日志库膨胀

// 广播回调
let broadcastCallback: ((log: LLMApiLog) => void) | null = null;

/**
 * 打开 IndexedDB
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // 全新创建
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('taskType', 'taskType', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('taskId', 'taskId', { unique: false });
      } else {
        // 升级现有 store
        const tx = (event.target as IDBOpenDBRequest).transaction;
        if (tx) {
          store = tx.objectStore(STORE_NAME);
          // 确保 taskId 索引存在（修复之前版本升级的问题）
          if (oldVersion < 4 && !store.indexNames.contains('taskId')) {
            store.createIndex('taskId', 'taskId', { unique: false });
          }
        }
      }
    };
  });
}

/**
 * 保存日志到 IndexedDB
 */
async function saveLogToDB(log: LLMApiLog): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put(log);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // 清理旧日志在独立 transaction 中执行，失败不影响写入
    try {
      const cleanTx = db.transaction(STORE_NAME, 'readwrite');
      const cleanStore = cleanTx.objectStore(STORE_NAME);
      const countRequest = cleanStore.count();
      countRequest.onsuccess = () => {
        if (countRequest.result > MAX_DB_LOGS) {
          const index = cleanStore.index('timestamp');
          const deleteCount = countRequest.result - MAX_DB_LOGS;
          let deleted = 0;
          index.openCursor().onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor && deleted < deleteCount) {
              cursor.delete();
              deleted++;
              cursor.continue();
            }
          };
        }
      };
    } catch {
      // 清理失败不影响主流程
    }
  } catch (error) {
    console.warn('[LLMApiLogger] Failed to save log to DB:', error);
  }
}

/**
 * 更新 IndexedDB 中的日志
 */
async function updateLogInDB(log: LLMApiLog): Promise<void> {
  await saveLogToDB(log);
}

/**
 * 从 IndexedDB 获取所有日志
 */
export async function getAllLLMApiLogs(): Promise<LLMApiLog[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
      const request = index.getAll();
      request.onsuccess = () => {
        // 按时间倒序排列
        const logs = (request.result as LLMApiLog[]).reverse();
        resolve(logs);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn('[LLMApiLogger] Failed to get logs from DB:', error);
    return memoryLogs;
  }
}

/**
 * 精简日志数据，去掉大字段以减少传输大小
 */
function compactLog(log: LLMApiLog): Partial<LLMApiLog> {
  // 只保留必要字段，去掉 requestBody 和 responseBody 等大字段
  return {
    id: log.id,
    timestamp: log.timestamp,
    endpoint: log.endpoint,
    model: log.model,
    taskType: log.taskType,
    taskId: log.taskId,
    prompt: log.prompt
      ? log.prompt.length > 200
        ? log.prompt.substring(0, 200) + '...'
        : log.prompt
      : undefined,
    status: log.status,
    httpStatus: log.httpStatus,
    duration: log.duration,
    errorMessage: log.errorMessage,
    hasReferenceImages: log.hasReferenceImages,
    referenceImageCount: log.referenceImageCount,
    // 不传输 referenceImages 完整数据，只传数量
    resultType: log.resultType,
    resultCount: log.resultCount,
    resultUrl: log.resultUrl,
    // 不传输 requestBody 和 responseBody
  };
}

function matchesTaskTypeFilter(log: LLMApiLog, taskType?: string): boolean {
  if (!taskType) return true;

  const isLyrics =
    log.taskType === 'audio' &&
    (log.resultType === 'lyrics' ||
      /\/lyrics(?:\/|$)/i.test(log.endpoint || ''));

  if (taskType === 'lyrics') {
    return isLyrics;
  }

  if (taskType === 'audio') {
    return log.taskType === 'audio' && !isLyrics;
  }

  return log.taskType === taskType;
}

/**
 * 分页获取 LLM API 日志（精简版，用于列表展示）
 * @param page 页码
 * @param pageSize 每页条数
 * @param filter 过滤条件
 */
export async function getLLMApiLogsPaginated(
  page = 1,
  pageSize = 20,
  filter?: { taskType?: string; status?: string }
): Promise<{
  logs: Partial<LLMApiLog>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  let allLogs = await getAllLLMApiLogs();

  // 应用过滤条件
  if (filter?.taskType) {
    allLogs = allLogs.filter((log) =>
      matchesTaskTypeFilter(log, filter.taskType)
    );
  }
  if (filter?.status) {
    allLogs = allLogs.filter((log) => log.status === filter.status);
  }

  const total = allLogs.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const logs = allLogs.slice(startIndex, startIndex + pageSize).map(compactLog);

  return {
    logs,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * 获取单条日志的完整数据（用于展开详情）
 */
export async function getLLMApiLogById(
  logId: string
): Promise<LLMApiLog | null> {
  // 先从内存查找
  const memoryLog = memoryLogs.find((l) => l.id === logId);
  if (memoryLog) return memoryLog;

  // 从 IndexedDB 查找
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(logId);
      request.onsuccess = () => {
        resolve((request.result as LLMApiLog) || null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.warn('[LLMApiLogger] Failed to get log by id:', error);
    return null;
  }
}

/**
 * 通过 taskId 查找成功的 LLM API 日志
 * 用于恢复已完成但状态未更新的任务
 */
export async function findSuccessLogByTaskId(
  taskId: string
): Promise<LLMApiLog | null> {
  // 先从内存缓存查找
  const memoryLog = memoryLogs.find(
    (log) => log.taskId === taskId && log.status === 'success' && log.resultUrl
  );
  if (memoryLog) {
    return memoryLog;
  }

  // 从 IndexedDB 查找
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('taskId');

    return new Promise((resolve) => {
      const request = index.getAll(taskId);
      request.onsuccess = () => {
        const results = request.result as LLMApiLog[];
        // 查找成功的且有结果 URL 的，按时间降序
        const successLog = results
          .filter((l) => l.status === 'success' && l.resultUrl)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        resolve(successLog || null);
      };
      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (error) {
    console.warn('[LLMApiLogger] Failed to find log by taskId:', error);
    return null;
  }
}

/**
 * 通过 taskId 查找最新的 LLM API 日志（不论状态）
 * 用于恢复中断的异步任务（获取 remoteId）
 */
export async function findLatestLogByTaskId(
  taskId: string
): Promise<LLMApiLog | null> {
  // 先从内存缓存查找
  const memoryLog = memoryLogs.find((log) => log.taskId === taskId);
  if (memoryLog) {
    return memoryLog;
  }

  // 从 IndexedDB 查找
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve) => {
      // 尝试使用 taskId 索引，如果不存在则回退到全表扫描
      let request: IDBRequest<LLMApiLog[]>;
      let useIndex = false;

      if (store.indexNames.contains('taskId')) {
        const index = store.index('taskId');
        request = index.getAll(taskId);
        useIndex = true;
      } else {
        // 回退：全表扫描后过滤
        console.warn(
          '[LLMApiLogger] taskId index not found, falling back to full scan'
        );
        request = store.getAll();
      }

      request.onsuccess = () => {
        let results = request.result as LLMApiLog[];

        // 如果是全表扫描，需要手动过滤
        if (!useIndex) {
          results = results.filter((log) => log.taskId === taskId);
        }

        // 按时间降序，取最新的一条
        const latestLog = results.sort((a, b) => b.timestamp - a.timestamp)[0];
        resolve(latestLog || null);
      };
      request.onerror = () => {
        resolve(null);
      };
    });
  } catch (error) {
    console.warn('[LLMApiLogger] Failed to find latest log by taskId:', error);
    return null;
  }
}

/**
 * 清空所有 LLM API 日志
 */
export async function clearAllLLMApiLogs(): Promise<void> {
  memoryLogs.length = 0;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error);
      };
    });
  } catch (error) {
    console.warn('[LLMApiLogger] Failed to clear logs from DB:', error);
  }
}

/**
 * 删除指定的 LLM API 日志
 */
export async function deleteLLMApiLogs(logIds: string[]): Promise<number> {
  if (!logIds || logIds.length === 0) return 0;

  const idsSet = new Set(logIds);

  // 从内存中删除
  const beforeCount = memoryLogs.length;
  for (let i = memoryLogs.length - 1; i >= 0; i--) {
    if (idsSet.has(memoryLogs[i].id)) {
      memoryLogs.splice(i, 1);
    }
  }
  const deletedFromMemory = beforeCount - memoryLogs.length;

  // 从 IndexedDB 中删除
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const id of logIds) {
      store.delete(id);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error);
      };
    });
  } catch (error) {
    console.warn('[LLMApiLogger] Failed to delete logs from DB:', error);
  }

  return deletedFromMemory;
}

/**
 * 设置广播回调（用于实时推送到 sw-debug.html）
 */
export function setLLMApiLogBroadcast(callback: (log: LLMApiLog) => void) {
  broadcastCallback = callback;
}

/**
 * 获取内存中的日志（用于快速访问）
 */
export function getMemoryLLMApiLogs(): LLMApiLog[] {
  return [...memoryLogs];
}

/**
 * 创建一个新的 LLM API 日志条目
 * 返回日志 ID，用于后续更新
 */
export function startLLMApiLog(params: {
  endpoint: string;
  model: string;
  taskType: LLMApiLog['taskType'];
  prompt?: string;
  requestBody?: string; // 完整请求体（JSON 格式，用于调试）
  hasReferenceImages?: boolean;
  referenceImageCount?: number;
  referenceImages?: LLMReferenceImage[];
  taskId?: string;
  workflowId?: string;
}): string {
  const id = `llm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const log: LLMApiLog = {
    id,
    timestamp: Date.now(),
    endpoint: params.endpoint,
    model: params.model,
    taskType: params.taskType,
    prompt: params.prompt ? truncatePrompt(params.prompt) : undefined,
    // 对请求体进行脱敏处理，过滤 API Key 等敏感信息
    requestBody: params.requestBody
      ? sanitizeRequestBody(params.requestBody)
      : undefined,
    hasReferenceImages: params.hasReferenceImages,
    referenceImageCount: params.referenceImageCount,
    referenceImages: params.referenceImages,
    status: 'pending',
    taskId: params.taskId,
    workflowId: params.workflowId,
  };

  // 添加到内存缓存
  memoryLogs.unshift(log);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.pop();
  }

  // 保存到 IndexedDB
  saveLogToDB(log);

  // 广播
  if (broadcastCallback) {
    broadcastCallback({ ...log });
  }

  return id;
}

/**
 * 更新 LLM API 日志为成功状态
 */
export function completeLLMApiLog(
  logId: string,
  params: {
    httpStatus: number;
    duration: number;
    resultType?: string;
    resultCount?: number;
    resultUrl?: string;
    resultText?: string;
    responseBody?: string;
    remoteId?: string;
  }
): void {
  const log = memoryLogs.find((l) => l.id === logId);
  if (log) {
    log.status = 'success';
    log.httpStatus = params.httpStatus;
    log.duration = params.duration;
    log.resultType = params.resultType;
    log.resultCount = params.resultCount;
    log.resultUrl = params.resultUrl;
    log.resultText = params.resultText
      ? truncateText(params.resultText, 1000)
      : undefined;
    log.responseBody = params.responseBody
      ? truncateResponseBody(params.responseBody)
      : undefined;
    if (params.remoteId) log.remoteId = params.remoteId;

    // 更新 IndexedDB
    updateLogInDB(log);

    // 广播
    if (broadcastCallback) {
      broadcastCallback({ ...log });
    }
  }
}

/**
 * 更新 LLM API 日志的元数据（如 remoteId, responseBody）
 * 用于异步任务在提交成功后记录信息，以便后续恢复
 */
export function updateLLMApiLogMetadata(
  logId: string,
  params: {
    remoteId?: string;
    responseBody?: string;
    httpStatus?: number;
  }
): void {
  const log = memoryLogs.find((l) => l.id === logId);
  if (log) {
    if (params.remoteId) log.remoteId = params.remoteId;
    if (params.responseBody)
      log.responseBody = truncateResponseBody(params.responseBody);
    if (params.httpStatus) log.httpStatus = params.httpStatus;

    // 更新 IndexedDB
    updateLogInDB(log);

    // 广播
    if (broadcastCallback) {
      broadcastCallback({ ...log });
    }
  }
}

/**
 * 更新 LLM API 日志为失败状态
 */
export function failLLMApiLog(
  logId: string,
  params: {
    httpStatus?: number;
    duration: number;
    errorMessage: string;
    responseBody?: string;
    remoteId?: string;
  }
): void {
  const log = memoryLogs.find((l) => l.id === logId);
  if (log) {
    log.status = 'error';
    log.httpStatus = params.httpStatus;
    log.duration = params.duration;
    log.errorMessage = truncateError(params.errorMessage);
    log.responseBody = params.responseBody
      ? truncateResponseBody(params.responseBody)
      : undefined;
    if (params.remoteId) log.remoteId = params.remoteId;

    // 更新 IndexedDB
    updateLogInDB(log);

    // 广播
    if (broadcastCallback) {
      broadcastCallback({ ...log });
    }
  }
}

/**
 * 截断提示词（减少存储）
 * 增加到 2000 字符以便调试时查看完整 prompt
 */
function truncatePrompt(prompt: string): string {
  if (prompt.length <= 2000) return prompt;
  return prompt.substring(0, 2000) + '...';
}

/**
 * 截断文本到指定长度
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function truncateResponseBody(text: string): string {
  if (text.length <= MAX_RESPONSE_BODY_LENGTH) return text;
  return `${text.substring(
    0,
    MAX_RESPONSE_BODY_LENGTH
  )}\n... [response truncated for log storage]`;
}

/**
 * 截断错误信息
 */
function truncateError(error: string): string {
  if (error.length <= 500) return error;
  return error.substring(0, 500) + '...';
}

/**
 * 高级 fetch 包装器，自动记录 LLM API 调用
 * 始终记录，不受调试模式影响
 */
export async function llmFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  meta: {
    model: string;
    taskType: LLMApiLog['taskType'];
    prompt?: string;
    hasReferenceImages?: boolean;
    referenceImageCount?: number;
    referenceImages?: LLMReferenceImage[];
    taskId?: string;
    workflowId?: string;
  }
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
  const endpoint = new URL(url).pathname;
  const startTime = Date.now();

  // 开始记录
  const logId = startLLMApiLog({
    endpoint,
    model: meta.model,
    taskType: meta.taskType,
    prompt: meta.prompt,
    hasReferenceImages: meta.hasReferenceImages,
    referenceImageCount: meta.referenceImageCount,
    referenceImages: meta.referenceImages,
    taskId: meta.taskId,
    workflowId: meta.workflowId,
  });

  try {
    const response = await fetch(input, init);
    const duration = Date.now() - startTime;

    if (response.ok) {
      completeLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        resultType:
          meta.taskType === 'image'
            ? 'image'
            : meta.taskType === 'video'
            ? 'video'
            : 'text',
        resultCount: 1,
      });
    } else {
      const errorText = await response
        .clone()
        .text()
        .catch(() => 'Unknown error');
      failLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        errorMessage: errorText,
      });
    }

    return response;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    failLLMApiLog(logId, {
      duration,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
