/**
 * Service Worker 双工通信客户端
 * 
 * 基于 postmessage-duplex 库实现的应用层客户端
 * 提供请求-响应和事件订阅功能
 */

import { ServiceWorkerChannel, ReturnCode } from 'postmessage-duplex';
import type {
  SWMethods,
  TaskOperationResult,
  DebugStatusResult,
} from './types';
import { callWithDefault, callOperation } from './rpc-helpers';

// ============================================================================
// 事件处理器类型
// ============================================================================

export interface SWChannelEventHandlers {
  // Cache events
  onCacheImageCached?: (event: import('./types').CacheImageCachedEvent) => void;
  onCacheDeleted?: (event: import('./types').CacheDeletedEvent) => void;
  onCacheQuotaWarning?: (event: import('./types').CacheQuotaWarningEvent) => void;
  // SW status events
  onSWNewVersionReady?: (event: import('./types').SWNewVersionReadyEvent) => void;
  onSWActivated?: (event: import('./types').SWActivatedEvent) => void;
  onSWUpdated?: (event: import('./types').SWUpdatedEvent) => void;
}

// ============================================================================
// SW 双工通信客户端
// ============================================================================

export class SWChannelClient {
  private static instance: SWChannelClient | null = null;

  private channel: ServiceWorkerChannel<SWMethods> | null = null;
  private initialized = false;
  private eventHandlers: SWChannelEventHandlers = {};

  // 连接重试配置
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  // 并发初始化保护
  private initializing: Promise<boolean> | null = null;

  // Private constructor for singleton pattern
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): SWChannelClient {
    if (!SWChannelClient.instance) {
      SWChannelClient.instance = new SWChannelClient();
    }
    return SWChannelClient.instance;
  }

  /**
   * 初始化通道
   * 支持重试和并发保护
   */
  async initialize(): Promise<boolean> {
    // 已初始化直接返回
    // Note: channel.isReady 可能是数字（0=未就绪, 1=就绪）或布尔值
    if (this.initialized && !!this.channel?.isReady) {
      return true;
    }

    // 并发保护：复用进行中的初始化
    if (this.initializing) {
      return this.initializing;
    }

    // 开始初始化
    this.initializing = this.doInitialize();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  /**
   * 实际执行初始化逻辑
   * postmessage-duplex 1.1.0 自动处理 SW 重启和重连
   */
  private async doInitialize(): Promise<boolean> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // 等待 Service Worker 就绪
        const sw = navigator.serviceWorker?.controller;
        if (!sw) {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('SW activation timeout')), 10000);
            
            if (navigator.serviceWorker.controller) {
              clearTimeout(timeout);
              resolve();
              return;
            }
            
            navigator.serviceWorker.addEventListener('controllerchange', () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
        }

        // 创建客户端通道
        // postmessage-duplex 1.1.0 配合 SW 的 enableGlobalRouting 自动创建 channel
        // autoReconnect: SW 更新时自动重连
        // timeout: 120 秒，与 SW 端保持一致，以支持慢速 IndexedDB 操作
        this.channel = await ServiceWorkerChannel.createFromPage<SWMethods>({
          timeout: 120000,
          autoReconnect: true,
          log: { log: () => {}, warn: () => {}, error: () => {} },
        } as any);  // log 属性在 PageChannelOptions 中不存在，但 BaseChannel 支持

        // 设置事件订阅
        this.setupEventSubscriptions();

        this.initialized = true;
        return true;

      } catch (error) {
        lastError = error as Error;
        console.error(`[SWChannelClient] Attempt ${attempt + 1} failed:`, error);

        // 清理失败的通道
        this.channel = null;
        this.initialized = false;

        // 如果还有重试次数，等待后重试
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    console.error('[SWChannelClient] All attempts failed, lastError:', lastError);
    return false;
  }

  /**
   * 检查是否已初始化
   * Note: channel.isReady 可能是数字（0=未就绪, 1=就绪）或布尔值，需要用 truthy 检查
   */
  isInitialized(): boolean {
    return this.initialized && !!this.channel?.isReady;
  }

  /**
   * 获取底层 channel 引用
   * 同一页面只能有一个 ServiceWorkerChannel，否则 SW 的 enableGlobalRouting
   * 按 clientId 路由会导致消息冲突。
   */
  getChannel(): ServiceWorkerChannel<SWMethods> | null {
    return this.isInitialized() ? this.channel : null;
  }

  /**
   * 仅初始化 SW 通道，不同步配置
   */
  async initializeChannel(): Promise<boolean> {
    // URL 参数检查（?sw=0 禁用 SW）
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('sw') === '0') {
      return false;
    }

    // 已初始化则直接返回
    if (this.isInitialized()) {
      return true;
    }

    // 只初始化通道，不同步配置
    try {
      const initSuccess = await this.initialize();
      return initSuccess;
    } catch (error) {
      console.error('[SWChannelClient] initializeChannel failed:', error);
      return false;
    }
  }

  /**
   * 设置事件处理器
   */
  setEventHandlers(handlers: SWChannelEventHandlers): void {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  // ============================================================================
  // 通用 RPC 调用 helper
  // ============================================================================

  /**
   * 带超时的 Promise 包装器
   * @param promise 原始 Promise
   * @param timeoutMs 超时时间（毫秒）
   * @param errorMessage 超时错误消息
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
      ),
    ]);
  }

  /**
   * 通用 RPC 调用 helper，统一处理初始化检查、响应处理和默认值
   * @param timeoutMs 可选超时时间，默认使用 channel 的 120s 超时
   */
  private async callRPC<T>(
    method: string,
    params: unknown,
    defaultOnError: T,
    timeoutMs?: number
  ): Promise<T> {
    this.ensureInitialized();
    try {
      const callPromise = this.channel!.call(method, params);
      const response = timeoutMs
        ? await this.withTimeout(callPromise, timeoutMs, `RPC ${method} timeout`)
        : await callPromise;
      if (response.ret !== ReturnCode.Success) {
        return defaultOnError;
      }
      return (response.data ?? defaultOnError) as T;
    } catch (error) {
      console.warn(`[SWChannelClient] ${method} failed:`, error);
      return defaultOnError;
    }
  }

  /**
   * 通用操作型 RPC 调用 helper，返回 { success, error? } 格式
   * @param timeoutMs 可选超时时间
   */
  private async callOperationRPC(
    method: string,
    params: unknown,
    errorMessage: string,
    timeoutMs?: number
  ): Promise<TaskOperationResult> {
    this.ensureInitialized();
    try {
      const callPromise = this.channel!.call(method, params);
      const response = timeoutMs
        ? await this.withTimeout(callPromise, timeoutMs, `RPC ${method} timeout`)
        : await callPromise;
      if (response.ret !== ReturnCode.Success) {
        return { success: false, error: response.msg || errorMessage };
      }
      return response.data || { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : errorMessage;
      console.warn(`[SWChannelClient] ${method} failed:`, error);
      return { success: false, error: errMsg };
    }
  }

  // ============================================================================
  // 缩略图方法
  // ============================================================================

  /**
   * 请求生成缩略图
   */
  async generateThumbnail(
    url: string,
    mediaType: 'image' | 'video',
    blob: ArrayBuffer,
    mimeType: string,
    sizes?: ('small' | 'large')[]
  ): Promise<TaskOperationResult> {
    this.ensureInitialized();
    
    try {
      const response = await this.channel!.call('thumbnail:generate', {
        url,
        mediaType,
        blob,
        mimeType,
        sizes,
      });
      
      if (response.ret !== ReturnCode.Success) {
        return { success: false, error: response.msg || 'Generate thumbnail failed' };
      }
      
      return response.data || { success: true };
    } catch (error) {
      console.error('[SWChannelClient] thumbnail:generate error:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * 注册视频缩略图生成处理器
   * SW 发起 publish('thumbnail:generate', { url }) 请求，主线程处理并返回 thumbnailUrl
   * 
   * @param handler 处理函数，接收 url，返回 { thumbnailUrl } 或 { error }
   */
  registerVideoThumbnailHandler(
    handler: (url: string, maxSize?: number) => Promise<{ thumbnailUrl?: string; error?: string }>
  ): void {
    this.ensureInitialized();
    this.channel!.subscribe('thumbnail:generate', async (request) => {
      const { url, maxSize } = (request.data as { url?: string; maxSize?: number }) || {};
      if (!url) {
        throw new Error('Missing url parameter');
      }

      return handler(url, maxSize);
    });
  }

  // ============================================================================
  // 崩溃监控方法
  // ============================================================================

  /**
   * 上报崩溃快照
   */
  async reportCrashSnapshot(snapshot: import('./types').CrashSnapshot): Promise<TaskOperationResult> {
    if (!this.initialized || !this.channel) {
      // 崩溃上报不应该因为未初始化而失败，静默返回
      return { success: false, error: 'Not initialized' };
    }
    
    try {
      const response = await this.channel.call('crash:snapshot', { snapshot });
      
      if (response.ret !== ReturnCode.Success) {
        return { success: false, error: response.msg || 'Report crash snapshot failed' };
      }
      
      return response.data || { success: true };
    } catch (error) {
      // 崩溃上报失败不应该抛出异常
      return { success: false, error: String(error) };
    }
  }

  /**
   * 发送心跳
   */
  async sendHeartbeat(timestamp: number): Promise<TaskOperationResult> {
    if (!this.initialized || !this.channel) {
      return { success: false, error: 'Not initialized' };
    }
    
    try {
      const response = await this.channel.call('crash:heartbeat', { timestamp });
      
      if (response.ret !== ReturnCode.Success) {
        return { success: false, error: response.msg || 'Send heartbeat failed' };
      }
      
      return response.data || { success: true };
    } catch (error) {
      // 心跳失败不应该抛出异常
      return { success: false, error: String(error) };
    }
  }

  // ============================================================================
  // 控制台日志方法
  // ============================================================================

  /**
   * 上报控制台日志
   */
  async reportConsoleLog(
    logLevel: string,
    logArgs: unknown[],
    timestamp: number
  ): Promise<TaskOperationResult> {
    if (!this.initialized || !this.channel) {
      return { success: false, error: 'Not initialized' };
    }
    
    try {
      const response = await this.channel.call('console:report', {
        logLevel,
        logArgs,
        timestamp,
      });
      
      if (response.ret !== ReturnCode.Success) {
        return { success: false, error: response.msg || 'Report console log failed' };
      }
      
      return response.data || { success: true };
    } catch (error) {
      // 日志上报失败不应该抛出异常
      return { success: false, error: String(error) };
    }
  }

  // ============================================================================
  // 调试方法
  // ============================================================================

  /**
   * 获取调试状态
   */
  async getDebugStatus(): Promise<DebugStatusResult> {
    return callWithDefault(this.channel, 'debug:getStatus', undefined, { enabled: false });
  }

  /**
   * 启用调试模式
   */
  async enableDebugMode(): Promise<TaskOperationResult & { status?: Record<string, unknown> }> {
    return callOperation(this.channel, 'debug:enable', undefined, 'Enable debug mode failed');
  }

  /**
   * 禁用调试模式
   */
  async disableDebugMode(): Promise<TaskOperationResult & { status?: Record<string, unknown> }> {
    return callOperation(this.channel, 'debug:disable', undefined, 'Disable debug mode failed');
  }

  /**
   * 获取调试日志
   */
  async getDebugLogs(params?: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<{
    logs: unknown[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const defaultValue = { logs: [], total: 0, offset: params?.offset || 0, limit: params?.limit || 100 };
    return callWithDefault(this.channel, 'debug:getLogs', params || {}, defaultValue);
  }

  /**
   * 清空调试日志
   */
  async clearDebugLogs(): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'debug:clearLogs', undefined, 'Clear debug logs failed');
  }

  /**
   * 获取控制台日志
   */
  async getConsoleLogs(params?: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<{
    logs: unknown[];
    total: number;
    offset: number;
    limit: number;
    error?: string;
  }> {
    const defaultValue = { logs: [], total: 0, offset: params?.offset || 0, limit: params?.limit || 500 };
    return callWithDefault(this.channel, 'debug:getConsoleLogs', params || {}, defaultValue);
  }

  /**
   * 清空控制台日志
   */
  async clearConsoleLogs(): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'debug:clearConsoleLogs', undefined, 'Clear console logs failed');
  }

  /**
   * 获取 PostMessage 日志
   */
  async getPostMessageLogs(params?: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<{
    logs: unknown[];
    total: number;
    offset: number;
    limit: number;
    stats?: Record<string, unknown>;
  }> {
    const defaultValue = { logs: [], total: 0, offset: params?.offset || 0, limit: params?.limit || 200 };
    return callWithDefault(this.channel, 'debug:getPostMessageLogs', params || {}, defaultValue);
  }

  /**
   * 清空 PostMessage 日志
   */
  async clearPostMessageLogs(): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'debug:clearPostMessageLogs', undefined, 'Clear postmessage logs failed');
  }

  /**
   * 获取崩溃快照列表
   */
  async getCrashSnapshots(): Promise<{ snapshots: unknown[]; total: number; error?: string }> {
    return callWithDefault(this.channel, 'debug:getCrashSnapshots', undefined, { snapshots: [], total: 0 });
  }

  /**
   * 清空崩溃快照
   */
  async clearCrashSnapshots(): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'debug:clearCrashSnapshots', undefined, 'Clear crash snapshots failed');
  }

  /**
   * 获取 LLM API 日志
   */
  async getLLMApiLogs(): Promise<{ logs: unknown[]; total: number; error?: string }> {
    return callWithDefault(this.channel, 'debug:getLLMApiLogs', undefined, { logs: [], total: 0 });
  }

  /**
   * 清空 LLM API 日志
   */
  async clearLLMApiLogs(): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'debug:clearLLMApiLogs', undefined, 'Clear LLM API logs failed');
  }

  /**
   * 获取缓存条目
   */
  async getCacheEntries(params?: { cacheName?: string; limit?: number; offset?: number }): Promise<{
    cacheName: string;
    entries: { url: string; cacheDate?: number; size?: number }[];
    total: number;
    offset: number;
    limit: number;
    error?: string;
  }> {
    const defaultValue = { cacheName: '', entries: [], total: 0, offset: 0, limit: 50 };
    return callWithDefault(this.channel, 'debug:getCacheEntries', params || {}, defaultValue);
  }

  /**
   * 导出所有日志
   */
  async exportLogs(): Promise<{
    exportTime: string;
    swVersion: string;
    status: Record<string, unknown>;
    fetchLogs: unknown[];
    consoleLogs: unknown[];
    postmessageLogs: unknown[];
  }> {
    const defaultValue = {
      exportTime: new Date().toISOString(),
      swVersion: 'unknown',
      status: {},
      fetchLogs: [],
      consoleLogs: [],
      postmessageLogs: [],
    };
    return callWithDefault(this.channel, 'debug:exportLogs', undefined, defaultValue);
  }

  // ============================================================================
  // CDN 相关方法
  // ============================================================================

  /**
   * 获取 CDN 状态
   */
  async getCDNStatus(): Promise<{ status: Record<string, unknown> }> {
    return callWithDefault(this.channel, 'cdn:getStatus', undefined, { status: {} });
  }

  /**
   * 重置 CDN 状态
   */
  async resetCDNStatus(): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'cdn:resetStatus', undefined, 'Reset CDN status failed');
  }

  /**
   * CDN 健康检查
   */
  async cdnHealthCheck(): Promise<{ results: Record<string, unknown> }> {
    return callWithDefault(this.channel, 'cdn:healthCheck', undefined, { results: {} });
  }

  // ============================================================================
  // 升级相关方法
  // ============================================================================

  /**
   * 获取升级状态（SW 版本）
   */
  async getUpgradeStatus(): Promise<{ version: string }> {
    return callWithDefault(this.channel, 'upgrade:getStatus', undefined, { version: 'unknown' });
  }

  /**
   * 强制升级 SW
   */
  async forceUpgrade(): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'upgrade:force', undefined, 'Force upgrade failed');
  }

  // ============================================================================
  // 缓存管理方法
  // ============================================================================

  /**
   * 删除单个缓存项
   */
  async deleteCache(url: string): Promise<TaskOperationResult> {
    return callOperation(this.channel, 'cache:delete', { url }, 'Delete cache failed');
  }

  // ============================================================================
  // 工具方法
  // ============================================================================

  /**
   * 销毁客户端
   */
  destroy(): void {
    if (this.channel) {
      this.channel.destroy();
      this.channel = null;
    }
    this.initialized = false;
    SWChannelClient.instance = null;
  }

  // ============================================================================
  // 通用消息方法
  // ============================================================================

  /**
   * 发送任意消息到 Service Worker（用于不需要预定义 RPC 的消息）
   * @param eventName 事件名称
   * @param data 消息数据
   */
  async publish(eventName: string, data?: Record<string, unknown>): Promise<void> {
    this.ensureInitialized();
    try {
      await this.channel!.publish(eventName, data);
    } catch (error) {
      console.error(`[SWChannelClient] publish(${eventName}) error:`, error);
      throw error;
    }
  }

  /**
   * 订阅来自 Service Worker 的任意事件
   * @param eventName 事件名称
   * @param callback 回调函数
   * @returns 取消订阅的函数
   * Note: subscribe handler must return a response to avoid timeout on the sender side
   */
  subscribeToEvent(eventName: string, callback: (data: unknown) => unknown): () => void {
    this.ensureInitialized();
    this.channel!.subscribe(eventName, (response) => {
      if (response.data !== undefined) {
        const result = callback(response.data);
        // Allow callback to return custom response, default to ack
        return typeof result === 'undefined' ? { ack: true } : result;
      }
      // Must return ack to prevent sender timeout
      return { ack: true };
    });
    return () => {
      this.channel?.unSubscribe(eventName);
    };
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.channel) {
      throw new Error('SWChannelClient not initialized. Call initialize() first.');
    }
  }

  /**
   * 通用事件订阅 helper
   * 使用 onBroadcast() 接收 SW 的单向广播消息
   */
  private subscribeEvent<T>(
    eventName: string,
    getHandler: () => ((data: T) => void) | undefined
  ): void {
    // 使用 onBroadcast 接收 SW 的广播消息（单向，不需要响应）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.channel as any)?.onBroadcast(eventName, (response: { data?: Record<string, unknown> } | Record<string, unknown>) => {
      // 兼容两种数据格式：
      // 1. { data: { ... } } - 标准格式
      // 2. { ... } - 直接数据格式
      const data = (response as { data?: Record<string, unknown> })?.data ?? response;
      
      if (data && Object.keys(data).length > 0) {
        const handler = getHandler();
        if (handler) {
          handler(data as T);
        }
      }
    });
  }

  /**
   * 设置事件订阅
   */
  private setupEventSubscriptions(): void {
    if (!this.channel) {
      return;
    }

    // ============================================================================
    // Cache 事件订阅
    // ============================================================================
    this.subscribeEvent<import('./types').CacheImageCachedEvent>('cache:imageCached', () => this.eventHandlers.onCacheImageCached);
    this.subscribeEvent<import('./types').CacheDeletedEvent>('cache:deleted', () => this.eventHandlers.onCacheDeleted);
    this.subscribeEvent<import('./types').CacheQuotaWarningEvent>('cache:quotaWarning', () => this.eventHandlers.onCacheQuotaWarning);

    // ============================================================================
    // SW 状态事件订阅
    // ============================================================================
    this.subscribeEvent<import('./types').SWNewVersionReadyEvent>('sw:newVersionReady', () => this.eventHandlers.onSWNewVersionReady);
    this.subscribeEvent<import('./types').SWActivatedEvent>('sw:activated', () => this.eventHandlers.onSWActivated);
    this.subscribeEvent<import('./types').SWUpdatedEvent>('sw:updated', () => this.eventHandlers.onSWUpdated);
  }
}

// 导出单例获取函数
export const swChannelClient = SWChannelClient.getInstance();
