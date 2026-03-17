/**
 * Chat Related Types
 *
 * Chat 相关类型定义
 */

import type { ModelRef } from '../../../utils/settings-manager';

// ============================================================================
// 实体类型
// ============================================================================

/**
 * Chat 消息
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatAttachment[];
}

/**
 * Chat 附件
 */
export interface ChatAttachment {
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  data: string;
}

// ============================================================================
// RPC 参数
// ============================================================================

/**
 * Chat 请求参数
 */
export interface ChatStartParams {
  chatId: string;
  messages: ChatMessage[];
  newContent: string;
  attachments?: ChatAttachment[];
  temporaryModel?: string | ModelRef | null;
  systemPrompt?: string;
}

/**
 * Chat 停止参数
 */
export interface ChatStopParams {
  chatId: string;
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * Chat 数据块事件
 */
export interface ChatChunkEvent {
  chatId: string;
  content: string;
}

/**
 * Chat 完成事件
 */
export interface ChatDoneEvent {
  chatId: string;
  fullContent: string;
}

/**
 * Chat 错误事件
 */
export interface ChatErrorEvent {
  chatId: string;
  error: string;
}
