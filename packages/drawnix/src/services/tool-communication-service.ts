/**
 * Tool Communication Service
 *
 * 工具通信服务
 * 管理画布与工具 iframe 之间的 postMessage 通信
 */

import { PlaitBoard } from '@plait/core';
import {
  ToolMessage,
  ToolMessageType,
  MessageHandler,
  PendingMessage,
  InitPayload,
  InsertTextPayload,
  InsertImagePayload,
} from '../types/tool-communication.types';

export function getToolTargetOrigin(iframe: HTMLIFrameElement): string | null {
  try {
    const url = new URL(iframe.src, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (iframe.hasAttribute('sandbox') &&
      !iframe.getAttribute('sandbox')!.split(/\s+/).includes('allow-same-origin')) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * 工具通信服务类
 */
export class ToolCommunicationService {
  private board: PlaitBoard;
  private messageHandlers: Map<ToolMessageType, MessageHandler[]>;
  private pendingMessages: Map<string, PendingMessage>;
  private processedMessageIds: Set<string>;
  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  // 默认超时时间（毫秒）
  private static readonly DEFAULT_TIMEOUT = 5000;

  // 消息 ID 缓存大小限制
  private static readonly MAX_PROCESSED_IDS = 1000;

  constructor(board: PlaitBoard) {
    this.board = board;
    this.messageHandlers = new Map();
    this.pendingMessages = new Map();
    this.processedMessageIds = new Set();

    this.setupMessageListener();
    this.setupCleanupInterval();
  }

  /**
   * 发送消息给工具（带超时和重试）
   */
  async sendToTool<T>(
    toolId: string,
    type: ToolMessageType,
    payload: T,
    options?: {
      timeout?: number;
      expectReply?: boolean;
    }
  ): Promise<ToolMessage | void> {
    const iframe = this.getToolIframe(toolId);
    if (!iframe?.contentWindow) {
      throw new Error(`Tool iframe not found: ${toolId}`);
    }
    const targetOrigin = getToolTargetOrigin(iframe);
    if (!targetOrigin) throw new Error('Tool origin is not supported');

    const message: ToolMessage<T> = {
      version: '1.0',
      type,
      toolId,
      messageId: this.generateMessageId(),
      payload,
      timestamp: Date.now(),
    };

    // 如果期待回复，注册 pending 消息
    if (options?.expectReply) {
      return new Promise((resolve, reject) => {
        const timeoutMs = options.timeout || ToolCommunicationService.DEFAULT_TIMEOUT;
        const timeoutId = setTimeout(() => {
          this.pendingMessages.delete(message.messageId);
          reject(new Error('Message timeout'));
        }, timeoutMs);

        this.pendingMessages.set(message.messageId, {
          message,
          resolve,
          reject,
          timeoutId,
        });

        iframe.contentWindow!.postMessage(message, targetOrigin);
      });
    } else {
      // 不期待回复，直接发送
      iframe.contentWindow.postMessage(message, targetOrigin);
    }
  }

  /**
   * 注册消息处理器
   */
  on(type: ToolMessageType, handler: MessageHandler): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);
  }

  /**
   * 取消注册处理器
   */
  off(type: ToolMessageType, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 设置全局消息监听器
   */
  private setupMessageListener(): void {
    window.addEventListener('message', this.handleMessage);
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage = (event: MessageEvent): void => {
    // 1. 验证消息格式
    if (!this.isValidToolMessage(event)) {
      return;
    }

    const message: ToolMessage = event.data;

    // 2. 防止重复处理
    if (this.processedMessageIds.has(message.messageId)) {
      console.warn('[ToolCommunication] Duplicate message:', message.messageId);
      return;
    }
    this.processedMessageIds.add(message.messageId);
    this.cleanupProcessedMessages();

    // 3. 如果是回复消息，解析 pending promise
    if (message.replyTo) {
      this.resolvePendingMessage(message);
      return;
    }

    // 4. 调用注册的处理器
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('[ToolCommunication] Handler error:', error);
        }
      });
    }
  };

  /**
   * 解析等待中的消息
   */
  private resolvePendingMessage(message: ToolMessage): void {
    const pending = this.pendingMessages.get(message.replyTo!);
    if (pending && pending.message.toolId === message.toolId) {
      clearTimeout(pending.timeoutId);
      pending.resolve(message);
      this.pendingMessages.delete(message.replyTo!);
    }
  }

  /**
   * 验证消息格式和来源
   */
  private isValidToolMessage(event: MessageEvent): boolean {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return false;
    }

    // 检查必需字段
    const requiredFields = ['version', 'type', 'toolId', 'messageId', 'timestamp'];
    const hasAllFields = requiredFields.every((field) => field in data);

    if (!hasAllFields) {
      return false;
    }
    if (
      typeof data.toolId !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,200}$/.test(data.toolId) ||
      typeof data.messageId !== 'string' ||
      data.messageId.length === 0 || data.messageId.length > 200 ||
      !Number.isFinite(data.timestamp) ||
      !Object.values(ToolMessageType).includes(data.type) ||
      (data.replyTo !== undefined && typeof data.replyTo !== 'string')
    ) return false;

    // 检查版本
    if (data.version !== '1.0') {
      console.warn('[ToolCommunication] Unsupported message version:', data.version);
      return false;
    }

    // 检查工具是否存在
    const iframe = this.getToolIframe(data.toolId);
    if (!iframe) {
      console.warn('[ToolCommunication] Message from unknown tool:', data.toolId);
      return false;
    }

    return event.source === iframe.contentWindow &&
      event.origin === getToolTargetOrigin(iframe);
  }

  /**
   * 生成唯一消息 ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取工具 iframe
   */
  private getToolIframe(toolId: string): HTMLIFrameElement | null {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(toolId)) return null;
    // 从 DOM 中查找对应的工具元素
    const selector = `[data-element-id="${toolId}"] iframe`;
    const iframe = document.querySelector(selector) as HTMLIFrameElement;
    return iframe;
  }

  /**
   * 清理过期的消息 ID（防止内存泄漏）
   */
  private cleanupProcessedMessages(): void {
    if (this.processedMessageIds.size > ToolCommunicationService.MAX_PROCESSED_IDS) {
      const idsArray = Array.from(this.processedMessageIds);
      this.processedMessageIds = new Set(
        idsArray.slice(-ToolCommunicationService.MAX_PROCESSED_IDS)
      );
    }
  }

  /**
   * 设置清理定时器
   */
  private setupCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupProcessedMessages();
    }, 60000); // 每分钟清理一次
  }

  /**
   * 销毁服务
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage);
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = undefined;

    // 清理所有 pending 消息
    this.pendingMessages.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Service destroyed'));
    });

    this.pendingMessages.clear();
    this.messageHandlers.clear();
    this.processedMessageIds.clear();
  }
}

/**
 * 工具通信服务的便捷方法
 */
export class ToolCommunicationHelper {
  private service: ToolCommunicationService;

  constructor(service: ToolCommunicationService) {
    this.service = service;
  }

  /**
   * 发送初始化消息
   */
  async initTool(toolId: string, payload: InitPayload): Promise<void> {
    await this.service.sendToTool(toolId, ToolMessageType.BOARD_TO_TOOL_INIT, payload);
  }

  /**
   * 处理工具插入文本请求
   */
  onInsertText(handler: (toolId: string, payload: InsertTextPayload) => void): void {
    this.service.on(ToolMessageType.TOOL_TO_BOARD_INSERT_TEXT, (message) => {
      handler(message.toolId, message.payload);
    });
  }

  /**
   * 处理工具插入图片请求
   */
  onInsertImage(handler: (toolId: string, payload: InsertImagePayload) => void): void {
    this.service.on(ToolMessageType.TOOL_TO_BOARD_INSERT_IMAGE, (message) => {
      handler(message.toolId, message.payload);
    });
  }

  /**
   * 处理工具就绪通知
   */
  onToolReady(handler: (toolId: string) => void): void {
    this.service.on(ToolMessageType.TOOL_TO_BOARD_READY, (message) => {
      handler(message.toolId);
    });
  }

  /**
   * 处理工具关闭请求
   */
  onToolClose(handler: (toolId: string) => void): void {
    this.service.on(ToolMessageType.TOOL_TO_BOARD_CLOSE, (message) => {
      handler(message.toolId);
    });
  }
}
