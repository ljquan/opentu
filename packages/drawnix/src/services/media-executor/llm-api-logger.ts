/**
 * LLM API Logger for Main Thread (Fallback Mode)
 *
 * 主线程版本的 LLM API 日志记录器，用于降级模式。
 * 写入与 SW 相同的 IndexedDB，确保调试面板能读取。
 */

import { truncate, sanitizeRequestBody } from '@aitu/utils';

// 与 SW 端保持一致的数据库配置
const DB_NAME = 'llm-api-logs';
const DB_VERSION = 4;
const STORE_NAME = 'logs';
const MAX_DB_LOGS = 1000;
const MAX_RESPONSE_BODY_LENGTH = 128 * 1024; // 保留原始 JSON，极端大响应再截断，避免日志库膨胀

/**
 * 参考图信息
 */
export interface LLMReferenceImage {
  url: string;
  size: number;
  width: number;
  height: number;
  name?: string;
}

/**
 * LLM API 日志条目
 */
export interface LLMApiLog {
  id: string;
  timestamp: number;
  endpoint: string;
  model: string;
  taskType: 'image' | 'video' | 'audio' | 'chat' | 'character' | 'other';
  prompt?: string;
  requestBody?: string;
  hasReferenceImages?: boolean;
  referenceImageCount?: number;
  referenceImages?: LLMReferenceImage[];
  status: 'pending' | 'success' | 'error';
  httpStatus?: number;
  duration?: number;
  resultType?: string;
  resultCount?: number;
  resultUrl?: string;
  resultText?: string;
  responseBody?: string;
  errorMessage?: string;
  remoteId?: string;
  taskId?: string;
  workflowId?: string;
}

/**
 * 内存日志缓存
 */
const memoryLogs: LLMApiLog[] = [];
const MAX_MEMORY_LOGS = 50;

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
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('taskType', 'taskType', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('taskId', 'taskId', { unique: false });
      } else {
        const tx = (event.target as IDBOpenDBRequest).transaction;
        if (tx) {
          store = tx.objectStore(STORE_NAME);
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

    // 清理旧日志
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const count = countRequest.result;
      if (count > MAX_DB_LOGS) {
        const index = store.index('timestamp');
        const deleteCount = count - MAX_DB_LOGS;
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

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.warn('[LLMApiLogger:Fallback] Failed to save log:', error);
  }
}


/**
 * 开始记录 LLM API 调用
 */
export function startLLMApiLog(params: {
  endpoint: string;
  model: string;
  taskType: LLMApiLog['taskType'];
  prompt?: string;
  requestBody?: string;
  hasReferenceImages?: boolean;
  referenceImageCount?: number;
  referenceImages?: LLMReferenceImage[];
  taskId?: string;
  workflowId?: string;
}): string {
  const id = `llm-fallback-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const log: LLMApiLog = {
    id,
    timestamp: Date.now(),
    endpoint: params.endpoint,
    model: params.model,
    taskType: params.taskType,
    prompt: params.prompt ? truncate(params.prompt, 2000) : undefined,
    requestBody: params.requestBody ? sanitizeRequestBody(params.requestBody) : undefined,
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
    log.resultText = params.resultText ? truncate(params.resultText, 1000) : undefined;
    log.responseBody = params.responseBody ? truncateResponseBody(params.responseBody) : undefined;
    log.remoteId = params.remoteId;

    // 更新 IndexedDB
    saveLogToDB(log);
  }
}

/**
 * 更新 LLM API 日志元数据（如 remoteId）
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
    if (params.responseBody) log.responseBody = truncateResponseBody(params.responseBody);
    if (params.httpStatus) log.httpStatus = params.httpStatus;

    // 更新 IndexedDB
    saveLogToDB(log);
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
  }
): void {
  const log = memoryLogs.find((l) => l.id === logId);
  if (log) {
    log.status = 'error';
    log.httpStatus = params.httpStatus;
    log.duration = params.duration;
    log.errorMessage = truncate(params.errorMessage, 500);
    log.responseBody = params.responseBody ? truncateResponseBody(params.responseBody) : undefined;

    // 更新 IndexedDB
    saveLogToDB(log);
  }
}

/**
 * 带日志记录的 fetch 包装器
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
    taskId?: string;
    workflowId?: string;
  }
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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
        resultType: meta.taskType === 'image' ? 'image' : meta.taskType === 'video' ? 'video' : 'text',
        resultCount: 1,
      });
    } else {
      const errorText = await response.clone().text().catch(() => 'Unknown error');
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

/**
 * 获取日志 ID（用于后续更新）
 */
export function getLogId(taskId: string): string | undefined {
  const log = memoryLogs.find((l) => l.taskId === taskId);
  return log?.id;
}

function truncateResponseBody(text: string): string {
  if (text.length <= MAX_RESPONSE_BODY_LENGTH) return text;
  return `${text.substring(0, MAX_RESPONSE_BODY_LENGTH)}\n... [response truncated for log storage]`;
}
