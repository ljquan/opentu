/**
 * Service Worker 通道管理器
 * 
 * 基于 postmessage-duplex 库管理与多个客户端的双工通信
 * 
 * 核心设计：
 * 1. 使用 createFromWorker 预创建通道（在收到客户端连接请求时）
 * 2. subscribeMap 处理器直接返回响应值（而不是手动 publish）
 * 3. 通过 publish 向客户端推送事件（进度、完成、失败等）
 */

import { ServiceWorkerChannel } from 'postmessage-duplex';
import { taskQueueStorage } from './storage';
import {
  isPostMessageLoggerDebugMode,
  logReceivedMessage,
  updateRequestWithResponse,
  getAllLogs as getAllPostMessageLogs,
} from './postmessage-logger';
import { withTimeout } from './utils/timeout-utils';
import { RPC_METHODS, SW_EVENTS } from './channel-manager/constants';

// 从 channel-manager 模块导入常量
export { RPC_METHODS, SW_EVENTS } from './channel-manager/constants';

// ============================================================================
// 类型定义
// ============================================================================

interface ClientChannel {
  channel: ServiceWorkerChannel;
  clientId: string;
  createdAt: number;
  isDebugClient: boolean;
}

// Thumbnail types
interface ThumbnailGenerateParams {
  url: string;
  mediaType: 'image' | 'video';
  blob: ArrayBuffer;
  mimeType: string;
  sizes?: ('small' | 'large')[];
}

// Crash monitoring types
interface CrashSnapshotParams {
  snapshot: {
    id: string;
    timestamp: number;
    error?: {
      message: string;
      stack?: string;
      name?: string;
    };
    url?: string;
    userAgent?: string;
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
    };
  };
}

interface HeartbeatParams {
  timestamp: number;
}

// Console types
interface ConsoleReportParams {
  logLevel: string;
  logArgs: unknown[];
  timestamp: number;
}

// ============================================================================
// 通道管理器
// ============================================================================

export class SWChannelManager {
  private static instance: SWChannelManager | null = null;
  
  private sw: ServiceWorkerGlobalScope;
  private channels: Map<string, ClientChannel> = new Map();

  // 调试客户端状态变化回调
  private onDebugClientCountChanged: ((count: number) => void) | null = null;

  private constructor(sw: ServiceWorkerGlobalScope) {
    this.sw = sw;
    
    // SW 启动时立即清理所有旧通道（SW 重启后旧通道都无效）
    this.channels.clear();
    
    // 启用 postmessage-duplex 的全局路由
    // 当收到来自未知客户端的消息时，自动创建 channel 并处理消息
    ServiceWorkerChannel.enableGlobalRouting((clientId, event) => {
      // 创建 channel
      this.ensureChannel(clientId);
      // 使用 postmessage-duplex 的 handleMessage 处理当前消息
      const channel = this.channels.get(clientId)?.channel;
      if (channel) {
        channel.handleMessage(event as MessageEvent);
      }
    });
    
    // 定期清理断开的客户端和过期的待处理请求（每 60 秒）
    setInterval(() => {
      this.cleanupDisconnectedClients().catch(() => {});
      this.cleanupStalePendingRequests().catch(() => {});
    }, 60000);
  }

  /**
   * 清理过期的待处理请求（超过 1 小时的请求）
   */
  private async cleanupStalePendingRequests(): Promise<void> {
    try {
      const deleted = await taskQueueStorage.cleanupStalePendingToolRequests();
      if (deleted > 0) {
        console.log(`[ChannelManager] Cleaned up ${deleted} stale pending tool requests`);
      }
    } catch (error) {
      console.warn('[ChannelManager] Failed to cleanup stale pending requests:', error);
    }
  }

  /**
   * 设置调试客户端数量变化回调
   * 用于自动启用/禁用调试模式
   */
  setDebugClientCountChangedCallback(callback: (count: number) => void): void {
    this.onDebugClientCountChanged = callback;
  }

  /**
   * 获取当前调试客户端数量
   */
  getDebugClientCount(): number {
    let count = 0;
    for (const client of this.channels.values()) {
      if (client.isDebugClient) {
        count++;
      }
    }
    return count;
  }

  /**
   * 检测客户端是否是调试页面
   */
  private async isDebugClient(clientId: string): Promise<boolean> {
    try {
      const client = await this.sw.clients.get(clientId);
      if (client && client.url) {
        return client.url.includes('sw-debug');
      }
    } catch {
      // 静默忽略错误
    }
    return false;
  }

  /**
   * 获取单例实例
   */
  static getInstance(sw: ServiceWorkerGlobalScope): SWChannelManager {
    if (!SWChannelManager.instance) {
      SWChannelManager.instance = new SWChannelManager(sw);
    }
    return SWChannelManager.instance;
  }

  /**
   * 确保客户端通道存在
   * 使用 createFromWorker 创建通道，通道会自动监听来自该客户端的消息
   */
  ensureChannel(clientId: string): ServiceWorkerChannel {
    let clientChannel = this.channels.get(clientId);
    
    if (!clientChannel) {
      // 使用 createFromWorker 创建通道，禁用内部日志
      // 注意：禁用 error 日志以避免 fire-and-forget 广播的超时错误噪音
      // RPC 调用的日志通过 wrapRpcHandler 记录到 postmessage-logger
      // 使用较长的超时时间（120秒）以支持慢速 IndexedDB 操作
      const channel = ServiceWorkerChannel.createFromWorker(clientId, {
        timeout: 120000,
        subscribeMap: this.createSubscribeMap(clientId),
        log: { log: () => {}, warn: () => {}, error: () => {} },
      });
      
      clientChannel = {
        channel,
        clientId,
        createdAt: Date.now(),
        isDebugClient: false,  // 初始设为 false，异步检测后更新
      };
      
      this.channels.set(clientId, clientChannel);
      
      // 异步检测是否是调试客户端
      this.checkAndUpdateDebugClient(clientId);
    }
    
    return clientChannel.channel;
  }

  /**
   * 异步检测并更新调试客户端状态
   */
  private async checkAndUpdateDebugClient(clientId: string): Promise<void> {
    const isDebug = await this.isDebugClient(clientId);
    const clientChannel = this.channels.get(clientId);
    if (clientChannel && isDebug) {
      clientChannel.isDebugClient = true;
      this.onDebugClientCountChanged?.(this.getDebugClientCount());
    }
  }

  /**
   * Check if there are any active client channels
   */
  hasAnyClientChannel(): boolean {
    return this.channels.size > 0;
  }

  /**
   * 创建 RPC 订阅映射
   * 处理器直接返回响应值（Promise 或同步值）
   */
  /**
   * 解包 RPC 数据
   * postmessage-duplex 的 subscribeMap 回调接收的是完整的请求对象:
   * { requestId, cmdname, data: <实际参数>, time, t }
   * 我们需要提取 data 字段作为实际参数
   */
  private unwrapRpcData<T>(rawData: any): T {
    // 如果有 cmdname 字段，说明是 postmessage-duplex 包装格式
    if (rawData && typeof rawData === 'object' && 'cmdname' in rawData) {
      return rawData.data as T;
    }
    // 否则直接返回
    return rawData as T;
  }

  /**
   * 广播 PostMessage 日志到调试面板
   */
  private broadcastPostMessageLog(logId: string): void {
    if (!logId) return;
    
    const logs = getAllPostMessageLogs();
    const entry = logs.find((l) => l.id === logId);
    if (entry) {
      this.sendPostMessageLog(entry as unknown as Record<string, unknown>);
    }
  }

  /**
   * 包装 RPC 处理器，添加日志记录
   * 将 postmessage-duplex 的 RPC 调用记录到 postmessage-logger
   */
  private wrapRpcHandler<T, R>(
    methodName: string,
    clientId: string,
    handler: (data: T) => Promise<R> | R
  ): (rawData: any) => Promise<R> {
    return async (rawData: any) => {
      const data = this.unwrapRpcData<T>(rawData);
      const startTime = Date.now();
      const requestId = rawData?.requestId;
      
      // 跳过调试面板客户端的日志记录
      const shouldLog = isPostMessageLoggerDebugMode() && !(this.channels.get(clientId)?.isDebugClient ?? false);
      
      // 记录收到的 RPC 请求并广播
      if (shouldLog) {
        const logId = logReceivedMessage(
          `RPC:${methodName}`,
          { params: data, requestId },
          clientId
        );
        this.broadcastPostMessageLog(logId);
      }
      
      try {
        const result = await handler(data);
        
        // 验证结果可以序列化（捕获序列化错误）
        try {
          JSON.stringify(result);
        } catch (serializeError) {
          console.error(`[SW wrapRpcHandler] ${methodName} result serialization failed:`, serializeError);
          throw new Error(`Result serialization failed: ${serializeError}`);
        }
        
        // 更新请求日志的响应数据（不创建新的日志条目）
        if (shouldLog && requestId) {
          const logId = updateRequestWithResponse(
            requestId,
            { result },
            Date.now() - startTime
          );
          // 广播更新后的请求日志
          if (logId) {
            this.broadcastPostMessageLog(logId);
          }
        }
        
        return result;
      } catch (error) {
        console.error(`[SW wrapRpcHandler] ${methodName} error:`, error);
        // 更新请求日志的错误信息
        if (shouldLog && requestId) {
          const logId = updateRequestWithResponse(
            requestId,
            null,
            Date.now() - startTime,
            String(error)
          );
          // 广播更新后的请求日志
          if (logId) {
            this.broadcastPostMessageLog(logId);
          }
        }
        throw error;
      }
    };
  }

  private createSubscribeMap(clientId: string): Record<string, (data: any) => any> {
    return {
      // ============================================================================
      // RPC Handlers
      // ============================================================================
      
      // Thumbnail (图片缩略图，由 SW 生成)
      [RPC_METHODS.THUMBNAIL_GENERATE]: this.wrapRpcHandler<ThumbnailGenerateParams, any>(
        RPC_METHODS.THUMBNAIL_GENERATE, clientId, (data) => this.handleThumbnailGenerate(data)
      ),
      
      // Crash monitoring (不记录日志，避免死循环)
      [RPC_METHODS.CRASH_SNAPSHOT]: async (rawData: any) => {
        const data = this.unwrapRpcData<CrashSnapshotParams>(rawData);
        return this.handleCrashSnapshot(data);
      },
      
      [RPC_METHODS.CRASH_HEARTBEAT]: async (rawData: any) => {
        const data = this.unwrapRpcData<HeartbeatParams>(rawData);
        return this.handleHeartbeat(data);
      },
      
      // Console (不记录日志，避免死循环)
      [RPC_METHODS.CONSOLE_REPORT]: async (rawData: any) => {
        const data = this.unwrapRpcData<ConsoleReportParams>(rawData);
        return this.handleConsoleReport(data);
      },
      
      // Debug
      [RPC_METHODS.DEBUG_GET_STATUS]: async () => this.handleDebugGetStatus(),
      [RPC_METHODS.DEBUG_ENABLE]: async () => this.handleDebugEnable(),
      [RPC_METHODS.DEBUG_DISABLE]: async () => this.handleDebugDisable(),
      [RPC_METHODS.DEBUG_GET_LOGS]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ limit?: number; offset?: number; filter?: Record<string, unknown> }>(rawData);
        return this.handleDebugGetLogs(data);
      },
      [RPC_METHODS.DEBUG_CLEAR_LOGS]: async () => this.handleDebugClearLogs(),
      [RPC_METHODS.DEBUG_GET_CONSOLE_LOGS]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ limit?: number; offset?: number; filter?: Record<string, unknown> }>(rawData);
        return this.handleDebugGetConsoleLogs(data);
      },
      [RPC_METHODS.DEBUG_CLEAR_CONSOLE_LOGS]: async () => this.handleDebugClearConsoleLogs(),
      [RPC_METHODS.DEBUG_GET_POSTMESSAGE_LOGS]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ limit?: number; offset?: number; filter?: Record<string, unknown> }>(rawData);
        return this.handleDebugGetPostMessageLogs(data);
      },
      [RPC_METHODS.DEBUG_CLEAR_POSTMESSAGE_LOGS]: async () => this.handleDebugClearPostMessageLogs(),
      [RPC_METHODS.DEBUG_GET_CRASH_SNAPSHOTS]: async () => this.handleDebugGetCrashSnapshots(),
      [RPC_METHODS.DEBUG_CLEAR_CRASH_SNAPSHOTS]: async () => this.handleDebugClearCrashSnapshots(),
      [RPC_METHODS.DEBUG_GET_LLM_API_LOGS]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ page?: number; pageSize?: number; taskType?: string; status?: string }>(rawData);
        return this.handleDebugGetLLMApiLogs(data);
      },
      [RPC_METHODS.DEBUG_GET_LLM_API_LOG_BY_ID]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ logId: string }>(rawData);
        return this.handleDebugGetLLMApiLogById(data?.logId);
      },
      [RPC_METHODS.DEBUG_CLEAR_LLM_API_LOGS]: async () => this.handleDebugClearLLMApiLogs(),
      [RPC_METHODS.DEBUG_DELETE_LLM_API_LOGS]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ logIds: string[] }>(rawData);
        return this.handleDebugDeleteLLMApiLogs(data);
      },
      [RPC_METHODS.DEBUG_GET_CACHE_ENTRIES]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ cacheName?: string; limit?: number; offset?: number }>(rawData);
        return this.handleDebugGetCacheEntries(data);
      },
      [RPC_METHODS.DEBUG_GET_CACHE_STATS]: async () => this.handleDebugGetCacheStats(),
      [RPC_METHODS.DEBUG_EXPORT_LOGS]: async () => this.handleDebugExportLogs(),

      // CDN
      [RPC_METHODS.CDN_GET_STATUS]: async () => this.handleCDNGetStatus(),
      [RPC_METHODS.CDN_RESET_STATUS]: async () => this.handleCDNResetStatus(),
      [RPC_METHODS.CDN_HEALTH_CHECK]: async () => this.handleCDNHealthCheck(),

      // Upgrade
      [RPC_METHODS.UPGRADE_GET_STATUS]: async () => this.handleUpgradeGetStatus(),
      [RPC_METHODS.UPGRADE_FORCE]: async () => this.handleUpgradeForce(),

      // Cache management
      [RPC_METHODS.CACHE_DELETE]: async (rawData: any) => {
        const data = this.unwrapRpcData<{ url: string }>(rawData);
        return this.handleCacheDelete(data);
      },

      // Ping
      [RPC_METHODS.PING]: async () => this.handlePing(),
    };
  }

  // ============================================================================
  // RPC 处理器（直接返回响应值）
  // ============================================================================

  // ============================================================================
  // Thumbnail RPC 处理器
  // ============================================================================

  private async handleThumbnailGenerate(data: ThumbnailGenerateParams): Promise<{ success: boolean; error?: string }> {
    try {
      const { url, mediaType, blob, mimeType, sizes } = data;
      console.info('[SWChannelManager] thumbnail RPC received', {
        url,
        mediaType,
        mimeType,
        sizes,
        bytes: blob.byteLength,
      });
      
      // 动态导入缩略图工具
      const { generateThumbnailAsync } = await import('./utils/thumbnail-utils');
      
      // 将 ArrayBuffer 转换为 Blob
      const mediaBlob = new Blob([blob], { type: mimeType || (mediaType === 'video' ? 'video/mp4' : 'image/png') });
      
      // 生成缩略图 (参数顺序: blob, url, mediaType)
      generateThumbnailAsync(mediaBlob, url, mediaType, sizes);
      
      return { success: true };
    } catch (error: any) {
      console.error('[SWChannelManager] Thumbnail generation failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // Crash monitoring RPC 处理器
  // ============================================================================

  private async handleCrashSnapshot(data: CrashSnapshotParams): Promise<{ success: boolean; error?: string }> {
    try {
      const { saveCrashSnapshot } = await import('../index');
      await saveCrashSnapshot(data.snapshot as any);
      return { success: true };
    } catch (error: any) {
      console.error('[SWChannelManager] Crash snapshot save failed:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleHeartbeat(data: HeartbeatParams): Promise<{ success: boolean; error?: string }> {
    // 心跳处理 - 更新客户端最后活跃时间
    // 可用于检测客户端是否还活跃
    return { success: true };
  }

  // ============================================================================
  // Console RPC 处理器
  // ============================================================================

  /**
   * 将单个日志参数序列化为字符串，避免对象显示为 [object Object]
   */
  private serializeLogArg(arg: unknown): string {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }

  private async handleConsoleReport(data: ConsoleReportParams): Promise<{ success: boolean; error?: string }> {
    try {
      const { addConsoleLog } = await import('../index');
      const logArgs = data.logArgs ?? [];
      const parts = Array.isArray(logArgs) ? logArgs.map((a) => this.serializeLogArg(a)) : [this.serializeLogArg(logArgs)];
      const logMessage = parts.join(' ');
      addConsoleLog({
        logLevel: data.logLevel as 'log' | 'info' | 'warn' | 'error' | 'debug',
        logMessage: logMessage || '-',
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // Debug RPC 处理器
  // ============================================================================

  private async handleDebugGetStatus(): Promise<Record<string, unknown>> {
    try {
      const { getDebugStatus, getCacheStats } = await import('../index');
      const status = getDebugStatus();
      const cacheStats = await getCacheStats();
      // 返回完整状态，同时提供 enabled 别名以兼容 DebugStatusResult 类型
      return { ...status, enabled: status.debugModeEnabled, cacheStats };
    } catch {
      return { debugModeEnabled: false };
    }
  }

  private async handleDebugEnable(): Promise<{ success: boolean; status?: Record<string, unknown> }> {
    try {
      const { enableDebugMode, getDebugStatus } = await import('../index');
      await enableDebugMode();
      const status = getDebugStatus();
      // 广播调试状态变更
      this.sendDebugStatusChanged(true);
      return { success: true, status };
    } catch (error: any) {
      return { success: false };
    }
  }

  private async handleDebugDisable(): Promise<{ success: boolean; status?: Record<string, unknown> }> {
    try {
      const { disableDebugMode, getDebugStatus } = await import('../index');
      await disableDebugMode();
      const status = getDebugStatus();
      // 广播调试状态变更
      this.sendDebugStatusChanged(false);
      return { success: true, status };
    } catch (error: any) {
      return { success: false };
    }
  }

  private async handleDebugGetLogs(data: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<{
    logs: unknown[];
    total: number;
    offset: number;
    limit: number;
  }> {
    try {
      const { getDebugLogs, getInternalFetchLogs } = await import('../index');
      const { limit = 100, offset = 0, filter } = data || {};
      
      // Merge internal fetch logs with debug logs
      const internalLogs = getInternalFetchLogs().map((log) => ({
        ...log,
        type: 'fetch' as const,
      }));
      const debugLogs = getDebugLogs();


      // Combine and deduplicate by ID
      const logMap = new Map<string, unknown>();
      for (const log of debugLogs) {
        logMap.set((log as { id: string }).id, log);
      }
      for (const log of internalLogs) {
        logMap.set((log as { id: string }).id, log);
      }

      // Sort by timestamp descending
      let logs = Array.from(logMap.values()).sort(
        (a: any, b: any) => b.timestamp - a.timestamp
      );

      // Apply filters
      if (filter) {
        if (filter.type) {
          logs = logs.filter((l: any) => l.type === filter.type);
        }
        if (filter.status) {
          logs = logs.filter((l: any) => l.status === filter.status);
        }
      }

      const paginatedLogs = logs.slice(offset, offset + limit);
      return { logs: paginatedLogs, total: logs.length, offset, limit };
    } catch {
      return { logs: [], total: 0, offset: data?.offset || 0, limit: data?.limit || 100 };
    }
  }

  private async handleDebugClearLogs(): Promise<{ success: boolean }> {
    try {
      const { clearDebugLogs } = await import('../index');
      clearDebugLogs();
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async handleDebugGetConsoleLogs(data: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<{
    logs: unknown[];
    total: number;
    offset: number;
    limit: number;
    error?: string;
  }> {
    try {
      const { loadConsoleLogsFromDB } = await import('../index');
      const { limit = 500, offset = 0, filter } = data || {};
      let logs = await loadConsoleLogsFromDB();

      // Apply filters
      if (filter) {
        if (filter.logLevel) {
          logs = logs.filter((l: any) => l.logLevel === filter.logLevel);
        }
        if (filter.search) {
          const search = (filter.search as string).toLowerCase();
          logs = logs.filter(
            (l: any) =>
              l.logMessage?.toLowerCase().includes(search) ||
              l.logStack?.toLowerCase().includes(search)
          );
        }
      }

      const paginatedLogs = logs.slice(offset, offset + limit);
      return { logs: paginatedLogs, total: logs.length, offset, limit };
    } catch (error: any) {
      return { logs: [], total: 0, offset: data?.offset || 0, limit: data?.limit || 500, error: String(error) };
    }
  }

  private async handleDebugClearConsoleLogs(): Promise<{ success: boolean }> {
    try {
      const { clearConsoleLogs, clearAllConsoleLogs } = await import('../index');
      clearConsoleLogs();
      await clearAllConsoleLogs();
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async handleDebugGetPostMessageLogs(data: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<{
    logs: unknown[];
    total: number;
    offset: number;
    limit: number;
    stats?: Record<string, unknown>;
  }> {
    try {
      const { getAllLogs, getLogStats } = await import('./postmessage-logger');
      const { limit = 200, offset = 0, filter } = data || {};
      let logs = getAllLogs();

      // Apply filters
      if (filter) {
        if (filter.direction) {
          logs = logs.filter((l) => l.direction === filter.direction);
        }
        if (filter.messageType) {
          const search = (filter.messageType as string).toLowerCase();
          logs = logs.filter((l) => l.messageType?.toLowerCase().includes(search));
        }
      }

      const paginatedLogs = logs.slice(offset, offset + limit);
      return { logs: paginatedLogs, total: logs.length, offset, limit, stats: getLogStats() };
    } catch {
      return { logs: [], total: 0, offset: data?.offset || 0, limit: data?.limit || 200 };
    }
  }

  private async handleDebugClearPostMessageLogs(): Promise<{ success: boolean }> {
    try {
      const { clearLogs } = await import('./postmessage-logger');
      clearLogs();
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async handleDebugGetCrashSnapshots(): Promise<{ snapshots: unknown[]; total: number; error?: string }> {
    try {
      const { getCrashSnapshots } = await import('../index');
      const snapshots = await getCrashSnapshots();
      return { snapshots, total: snapshots.length };
    } catch (error: any) {
      return { snapshots: [], total: 0, error: String(error) };
    }
  }

  private async handleDebugClearCrashSnapshots(): Promise<{ success: boolean }> {
    try {
      const { clearCrashSnapshots } = await import('../index');
      await clearCrashSnapshots();
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async handleDebugGetLLMApiLogs(params?: { page?: number; pageSize?: number; taskType?: string; status?: string }): Promise<{ 
    logs: unknown[]; 
    total: number; 
    page: number;
    pageSize: number;
    totalPages: number;
    error?: string 
  }> {
    try {
      // Ensure page and pageSize are numbers (postmessage-duplex may pass objects)
      const page = typeof params?.page === 'number' ? params.page : (Number(params?.page) || 1);
      const pageSize = typeof params?.pageSize === 'number' ? params.pageSize : (Number(params?.pageSize) || 20);
      const filter = {
        taskType: typeof params?.taskType === 'string' ? params.taskType : undefined,
        status: typeof params?.status === 'string' ? params.status : undefined,
      };
      
      const { getLLMApiLogsPaginated } = await import('./llm-api-logger');
      const result = await getLLMApiLogsPaginated(page, pageSize, filter);
      return result;
    } catch (error: any) {
      console.error('[SWChannelManager] handleDebugGetLLMApiLogs error:', error);
      return { logs: [], total: 0, page: 1, pageSize: 20, totalPages: 0, error: String(error) };
    }
  }

  private async handleDebugGetLLMApiLogById(logId?: string): Promise<{ log: unknown | null; error?: string }> {
    try {
      if (!logId) {
        return { log: null, error: 'Missing logId' };
      }
      const { getLLMApiLogById } = await import('./llm-api-logger');
      const log = await getLLMApiLogById(logId);
      return { log };
    } catch (error: any) {
      console.error('[SWChannelManager] handleDebugGetLLMApiLogById error:', error);
      return { log: null, error: String(error) };
    }
  }

  private async handleDebugClearLLMApiLogs(): Promise<{ success: boolean }> {
    try {
      const { clearAllLLMApiLogs } = await import('./llm-api-logger');
      await clearAllLLMApiLogs();
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async handleDebugDeleteLLMApiLogs(params?: { logIds: string[] }): Promise<{ success: boolean; deletedCount: number }> {
    try {
      if (!params?.logIds || params.logIds.length === 0) {
        return { success: false, deletedCount: 0 };
      }
      const { deleteLLMApiLogs } = await import('./llm-api-logger');
      const deletedCount = await deleteLLMApiLogs(params.logIds);
      return { success: true, deletedCount };
    } catch {
      return { success: false, deletedCount: 0 };
    }
  }

  private async handleDebugGetCacheEntries(data: { cacheName?: string; limit?: number; offset?: number }): Promise<{
    cacheName: string;
    entries: { url: string; cacheDate?: number; cacheCreatedAt?: number; size?: number }[];
    total: number;
    offset: number;
    limit: number;
    error?: string;
  }> {
    try {
      const { IMAGE_CACHE_NAME } = await import('../index');
      const { cacheName = IMAGE_CACHE_NAME, limit = 50, offset = 0 } = data || {};
      
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      const entries: { url: string; cacheDate?: number; cacheCreatedAt?: number; size?: number }[] = [];

      for (let i = offset; i < Math.min(offset + limit, requests.length); i++) {
        const request = requests[i];
        const response = await cache.match(request);
        if (response) {
          const cacheDate = response.headers.get('sw-cache-date');
          const cacheCreatedAt =
            response.headers.get('sw-cache-created-at') || cacheDate;
          const size = response.headers.get('sw-image-size') || response.headers.get('content-length');
          entries.push({
            url: request.url,
            cacheDate: cacheDate ? parseInt(cacheDate) : undefined,
            cacheCreatedAt: cacheCreatedAt ? parseInt(cacheCreatedAt) : undefined,
            size: size ? parseInt(size) : undefined,
          });
        }
      }

      return { cacheName, entries, total: requests.length, offset, limit };
    } catch (error: any) {
      return { cacheName: data?.cacheName || '', entries: [], total: 0, offset: data?.offset || 0, limit: data?.limit || 50, error: String(error) };
    }
  }

  private async handleDebugGetCacheStats(): Promise<{
    stats: {
      caches: { name: string; count: number; size: number }[];
      totalCount: number;
      totalSize: number;
    };
    error?: string;
  }> {
    try {
      const cacheNames = await caches.keys();
      const cacheStats: { name: string; count: number; size: number }[] = [];
      let totalCount = 0;
      let totalSize = 0;

      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        let cacheSize = 0;

        for (const request of requests) {
          const response = await cache.match(request);
          if (response) {
            const size = response.headers.get('content-length');
            if (size) {
              cacheSize += parseInt(size);
            }
          }
        }

        cacheStats.push({ name, count: requests.length, size: cacheSize });
        totalCount += requests.length;
        totalSize += cacheSize;
      }

      return {
        stats: { caches: cacheStats, totalCount, totalSize },
      };
    } catch (error: any) {
      return {
        stats: { caches: [], totalCount: 0, totalSize: 0 },
        error: String(error),
      };
    }
  }

  private async handleDebugExportLogs(): Promise<{
    exportTime: string;
    swVersion: string;
    status: Record<string, unknown>;
    fetchLogs: unknown[];
    consoleLogs: unknown[];
    postmessageLogs: unknown[];
  }> {
    try {
      const { getDebugStatus, getDebugLogs, loadConsoleLogsFromDB, APP_VERSION } = await import('../index');
      const { getAllLogs } = await import('./postmessage-logger');
      
      const allConsoleLogs = await loadConsoleLogsFromDB();
      const postmessageLogs = getAllLogs();
      const debugLogs = getDebugLogs();
      
      return {
        exportTime: new Date().toISOString(),
        swVersion: APP_VERSION,
        status: getDebugStatus(),
        fetchLogs: debugLogs,
        consoleLogs: allConsoleLogs,
        postmessageLogs,
      };
    } catch {
      return {
        exportTime: new Date().toISOString(),
        swVersion: 'unknown',
        status: {},
        fetchLogs: [],
        consoleLogs: [],
        postmessageLogs: [],
      };
    }
  }

  // ============================================================================
  // CDN RPC 处理器
  // ============================================================================

  private async handleCDNGetStatus(): Promise<{ status: unknown }> {
    try {
      const { getCDNStatusReport } = await import('../index');
      return { status: getCDNStatusReport() };
    } catch {
      return { status: {} };
    }
  }

  private async handleCDNResetStatus(): Promise<{ success: boolean }> {
    try {
      const { resetCDNStatus } = await import('../index');
      resetCDNStatus();
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  private async handleCDNHealthCheck(): Promise<{ results: Record<string, unknown> }> {
    try {
      const { performHealthCheck, APP_VERSION } = await import('../index');
      const results = await performHealthCheck(APP_VERSION);
      return { results: Object.fromEntries(results) };
    } catch {
      return { results: {} };
    }
  }

  // ============================================================================
  // Upgrade RPC 处理器
  // ============================================================================

  private async handleUpgradeGetStatus(): Promise<{ version: string }> {
    try {
      const { APP_VERSION } = await import('../index');
      return { version: APP_VERSION };
    } catch {
      return { version: 'unknown' };
    }
  }

  private async handleUpgradeForce(): Promise<{ success: boolean }> {
    try {
      const sw = self as unknown as ServiceWorkerGlobalScope;
      sw.skipWaiting();
      // 广播 SW 已更新
      const { APP_VERSION } = await import('../index');
      this.sendSWUpdated(APP_VERSION);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  // ============================================================================
  // Cache RPC 处理器
  // ============================================================================

  private async handleCacheDelete(data: { url: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const { deleteCacheByUrl } = await import('../index');
      await deleteCacheByUrl(data.url);
      // 广播缓存删除事件
      this.sendCacheDeleted(data.url);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 健康检查 - 用于检测 SW 是否可用
   */
  private async handlePing(): Promise<{ success: boolean }> {
    return { success: true };
  }

  // ============================================================================
  // 事件推送方法（SW 主动推送给客户端）
  // ============================================================================

  /**
   * 广播给所有客户端（fire-and-forget 模式）
   * 使用 postmessage-duplex 的 broadcast() 方法，不等待响应
   */
  broadcastToAll(event: string, data: Record<string, unknown>): void {
    // 注意：不能在这里使用 console.log，会导致死循环（console 日志被捕获并广播）
    this.channels.forEach((clientChannel) => {
      // 使用 broadcast() 进行单向消息发送，不等待响应
      clientChannel.channel.broadcast(event, data);
    });
  }

  /**
   * 广播给除指定客户端外的所有客户端（fire-and-forget 模式）
   */
  broadcastToOthers(event: string, data: Record<string, unknown>, excludeClientId: string): void {
    this.channels.forEach((clientChannel) => {
      if (clientChannel.clientId !== excludeClientId) {
        clientChannel.channel.broadcast(event, data);
      }
    });
  }

  /**
   * 发送给特定客户端（fire-and-forget 模式）
   */
  publishToClient(clientId: string, event: string, data: Record<string, unknown>): void {
    const clientChannel = this.channels.get(clientId);
    if (clientChannel) {
      clientChannel.channel.broadcast(event, data);
    }
  }

  // ============================================================================
  // 缓存事件发送方法
  // ============================================================================

  /**
   * 发送图片缓存完成事件
   */
  sendCacheImageCached(url: string, size?: number, thumbnailUrl?: string): void {
    this.broadcastToAll(SW_EVENTS.CACHE_IMAGE_CACHED, { url, size, thumbnailUrl });
  }

  /**
   * 发送缓存删除事件
   */
  sendCacheDeleted(url: string): void {
    this.broadcastToAll(SW_EVENTS.CACHE_DELETED, { url });
  }

  /**
   * 发送缓存配额警告事件
   */
  sendCacheQuotaWarning(usage: number, quota: number, percentUsed: number): void {
    this.broadcastToAll(SW_EVENTS.CACHE_QUOTA_WARNING, { usage, quota, percentUsed });
  }

  // ============================================================================
  // SW 状态事件发送方法
  // ============================================================================

  /**
   * 发送新版本就绪事件
   */
  sendSWNewVersionReady(version: string): void {
    this.broadcastToAll(SW_EVENTS.SW_NEW_VERSION_READY, { version });
  }

  /**
   * 发送 SW 激活事件
   */
  sendSWActivated(version: string): void {
    this.broadcastToAll(SW_EVENTS.SW_ACTIVATED, { version });
  }

  /**
   * 发送 SW 更新事件
   */
  sendSWUpdated(version?: string): void {
    this.broadcastToAll(SW_EVENTS.SW_UPDATED, { version });
  }

  // ============================================================================
  // 调试事件发送方法
  // ============================================================================

  /**
   * 发送调试状态变更事件
   */
  sendDebugStatusChanged(enabled: boolean): void {
    this.broadcastToAll(SW_EVENTS.DEBUG_STATUS_CHANGED, { enabled });
  }

  /**
   * 发送调试日志事件（SW 内部 API 日志）
   */
  sendDebugLog(entry: Record<string, unknown>): void {
    this.broadcastToAll(SW_EVENTS.DEBUG_LOG, { entry });
  }

  /**
   * 发送控制台日志事件
   */
  sendConsoleLog(entry: Record<string, unknown>): void {
    this.broadcastToAll(SW_EVENTS.CONSOLE_LOG, { entry });
  }

  /**
   * 发送 LLM API 日志事件
   */
  sendDebugLLMLog(log: Record<string, unknown>): void {
    this.broadcastToAll(SW_EVENTS.DEBUG_LLM_LOG, { log });
  }

  // PostMessage 日志批量发送缓冲区
  private postMessageLogBuffer: Record<string, unknown>[] = [];
  private postMessageLogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly POSTMESSAGE_LOG_BATCH_INTERVAL = 500; // 500ms 批量发送间隔

  /**
   * 发送 PostMessage 日志事件（批量发送以避免速率限制）
   */
  sendPostMessageLog(entry: Record<string, unknown>): void {
    // 添加到缓冲区
    this.postMessageLogBuffer.push(entry);
    
    // 如果没有定时器，启动一个
    if (!this.postMessageLogTimer) {
      this.postMessageLogTimer = setTimeout(() => {
        this.flushPostMessageLogs();
      }, this.POSTMESSAGE_LOG_BATCH_INTERVAL);
    }
  }

  /**
   * 刷新 PostMessage 日志缓冲区
   */
  private flushPostMessageLogs(): void {
    this.postMessageLogTimer = null;
    
    if (this.postMessageLogBuffer.length === 0) {
      return;
    }
    
    // 批量发送所有缓冲的日志
    const entries = this.postMessageLogBuffer;
    this.postMessageLogBuffer = [];
    
    this.broadcastToAll(SW_EVENTS.POSTMESSAGE_LOG_BATCH, { entries });
  }

  /**
   * 发送新崩溃快照事件
   */
  sendNewCrashSnapshot(snapshot: Record<string, unknown>): void {
    this.broadcastToAll(SW_EVENTS.DEBUG_NEW_CRASH_SNAPSHOT, { snapshot });
  }

  // ============================================================================
  // 工具方法
  // ============================================================================

  /**
   * 请求主线程生成视频缩略图
   * @param url 视频 URL
   * @param timeoutMs 超时时间（毫秒）
   * @returns 缩略图 Data URL，失败返回 null
   */
  async requestVideoThumbnail(url: string, timeoutMs = 30000, maxSize?: number): Promise<string | null> {
    const candidateChannels = Array.from(this.channels.values()).sort((left, right) => {
      if (left.isDebugClient === right.isDebugClient) {
        return right.createdAt - left.createdAt;
      }
      return left.isDebugClient ? 1 : -1;
    });

    if (candidateChannels.length === 0) {
      return null;
    }

    for (const clientChannel of candidateChannels) {
      try {
        const response = await withTimeout(
          clientChannel.channel.call('thumbnail:generate', { url, maxSize }),
          timeoutMs,
          'Video thumbnail generation timeout' as any
        ) as any;

        if (!response || response.ret !== 0) {
          continue;
        }

        const data = response.data as { thumbnailUrl?: string; error?: string } | undefined;
        if (data?.error) {
          continue;
        }

        if (!data?.thumbnailUrl) {
          continue;
        }

        return data.thumbnailUrl;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * 获取连接的客户端列表
   */
  getConnectedClients(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * 获取连接的客户端数量
   */
  getConnectedClientCount(): number {
    return this.channels.size;
  }

  /**
   * 清理断开的客户端
   */
  async cleanupDisconnectedClients(): Promise<void> {
    const clients = await this.sw.clients.matchAll({ type: 'window' });
    const activeClientIds = new Set(clients.map(c => c.id));

    let debugClientRemoved = false;
    for (const [clientId, clientChannel] of this.channels) {
      if (!activeClientIds.has(clientId)) {
        if (clientChannel.isDebugClient) {
          debugClientRemoved = true;
        }
        this.channels.delete(clientId);
      }
    }

    // 如果有调试客户端被移除，通知状态变化
    if (debugClientRemoved) {
      this.onDebugClientCountChanged?.(this.getDebugClientCount());
    }
  }
}

// 导出单例获取函数
let channelManagerInstance: SWChannelManager | null = null;

export function initChannelManager(sw: ServiceWorkerGlobalScope): SWChannelManager {
  if (!channelManagerInstance) {
    channelManagerInstance = SWChannelManager.getInstance(sw);
  }
  return channelManagerInstance;
}

export function getChannelManager(): SWChannelManager | null {
  return channelManagerInstance;
}
