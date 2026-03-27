/**
 * useChatHandler Hook
 *
 * Adapter hook that connects our Gemini API and storage
 * with @llamaindex/chat-ui's ChatHandler interface.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { chatStorageService } from '../services/chat-storage-service';
import { chatService } from '../services/chat-service';
import { MessageStatus, MessageRole } from '../types/chat.types';
import type { ChatMessage, WorkflowMessageData } from '../types/chat.types';
import type { ChatHandler, Message } from '@llamaindex/chat-ui';
import type { ModelRef } from '../utils/settings-manager';
import { generateSystemPrompt } from '../services/agent';
import {
  parseToolCalls,
  extractTextContent,
} from '../services/agent/tool-parser';
import { mcpRegistry, initializeMCP } from '../mcp';
import type { ToolCall, MCPTaskResult } from '../mcp/types';
import {
  WORKFLOW_MESSAGE_PREFIX,
  injectModelForGenerationTool,
  toChatUIMessage,
  fromChatUIMessage,
  toApiMessage,
  extractMessageText,
} from './chat-utils';

// 确保 MCP 模块已初始化
initializeMCP();

/** 工具调用结果 */
interface ToolCallResult {
  toolCall: ToolCall;
  success: boolean;
  data?: unknown;
  error?: string;
  taskId?: string;
}

interface UseChatHandlerOptions {
  sessionId: string | null;
  /** 临时模型（仅在当前会话中使用，不影响全局设置） */
  temporaryModel?: string | ModelRef | null;
  /** 工具调用回调 - 当 AI 响应中包含工具调用时触发 */
  onToolCalls?: (
    toolCalls: ToolCall[],
    messageId: string,
    executeTools: () => Promise<ToolCallResult[]>,
    /** AI 分析内容（JSON 中的 content 字段） */
    aiAnalysis?: string
  ) => void;
  /** 工作流消息更新回调 */
  onWorkflowUpdate?: (messageId: string, workflow: WorkflowMessageData) => void;
}

export function useChatHandler(options: UseChatHandlerOptions): ChatHandler & {
  isLoading: boolean;
  setMessagesWithRaw: (
    newMessages: Message[],
    rawChatMessages?: ChatMessage[]
  ) => void;
  updateRawMessageWorkflow: (
    messageId: string,
    workflow: WorkflowMessageData
  ) => void;
} {
  const { sessionId, temporaryModel, onToolCalls, onWorkflowUpdate } = options;

  // 生成系统提示词（包含 MCP 工具定义）
  const systemPromptRef = useRef<string>(generateSystemPrompt());

  // 存储回调的 ref，避免依赖变化
  const onToolCallsRef = useRef(onToolCalls);
  onToolCallsRef.current = onToolCalls;
  const onWorkflowUpdateRef = useRef(onWorkflowUpdate);
  onWorkflowUpdateRef.current = onWorkflowUpdate;
  // 存储临时模型的 ref，确保 sendMessage 使用最新选择的模型
  const temporaryModelRef = useRef(temporaryModel);
  temporaryModelRef.current = temporaryModel;

  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ChatHandler['status']>('ready');
  const [isLoading, setIsLoading] = useState(false);
  const currentAssistantMsgRef = useRef<string | null>(null);
  // 保存原始的 ChatMessage 列表，用于构建完整的历史上下文
  const rawMessagesRef = useRef<ChatMessage[]>([]);
  // 防止重复发送的锁
  const isSendingRef = useRef(false);

  // Load messages when session changes
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      rawMessagesRef.current = [];
      return;
    }

    const loadMessages = async () => {
      setIsLoading(true);
      try {
        const loaded = await chatStorageService.getMessages(sessionId);
        rawMessagesRef.current = loaded; // 保存原始消息（包含 workflow 数据）
        setMessages(loaded.map(toChatUIMessage));
      } catch (error) {
        console.error('[useChatHandler] Failed to load messages:', error);
        setMessages([]);
        rawMessagesRef.current = [];
      } finally {
        setIsLoading(false);
      }
    };

    loadMessages();
  }, [sessionId]);

  // Send message implementation
  const sendMessage = useCallback(
    async (msg: Message) => {
      if (!sessionId) return;

      // 防止重复发送
      if (isSendingRef.current) {
        console.warn(
          '[useChatHandler] Message already being sent, ignoring duplicate call'
        );
        return;
      }
      isSendingRef.current = true;

      setStatus('submitted');

      // Convert to our format and save
      const ourMsg = fromChatUIMessage(msg, sessionId);
      await chatStorageService.addMessage(ourMsg);

      // Update messages state
      setMessages((prev) => [...prev, msg]);

      // Get current session for message count
      const session = await chatStorageService.getSession(sessionId);

      await chatStorageService.updateSession(sessionId, {
        updatedAt: Date.now(),
        messageCount: (session?.messageCount || 0) + 1,
      });

      // Create assistant message placeholder
      const assistantMsgId = chatStorageService.generateId();
      currentAssistantMsgRef.current = assistantMsgId;

      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStatus('streaming');

      // Build conversation history from raw messages (preserves workflow data)
      // Use rawMessagesRef which contains the original ChatMessage with workflow data
      const history: ChatMessage[] = rawMessagesRef.current.map(toApiMessage);
      history.push(ourMsg);

      // Also update rawMessagesRef with the new user message
      rawMessagesRef.current = [...rawMessagesRef.current, ourMsg];

      // Get the user message content
      const userContent = extractMessageText(msg);

      let fullContent = '';

      try {
        await chatService.sendChatMessage(
          history.slice(0, -1), // Exclude the new user message from history
          userContent,
          ourMsg.attachments || [],
          (event) => {
            if (event.type === 'content' && event.content) {
              fullContent += event.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, parts: [{ type: 'text', text: fullContent }] }
                    : m
                )
              );
            } else if (event.type === 'done') {
              // 解析工具调用
              const toolCalls = parseToolCalls(fullContent);
              const textContent =
                extractTextContent(fullContent) || fullContent;

              if (toolCalls.length > 0 && onToolCallsRef.current) {
                // 为生成工具注入正确的模型
                const processedToolCalls = toolCalls.map((tc) =>
                  injectModelForGenerationTool(tc)
                );

                // 有工具调用，创建执行函数
                const executeTools = async (): Promise<ToolCallResult[]> => {
                  const results: ToolCallResult[] = [];
                  for (const toolCall of processedToolCalls) {
                    try {
                      const result = (await mcpRegistry.executeTool(
                        toolCall
                      )) as MCPTaskResult;
                      results.push({
                        toolCall: toolCall as ToolCall,
                        success: result.success,
                        data: result.data,
                        error: result.error,
                        taskId: result.taskId,
                      });
                    } catch (error: any) {
                      results.push({
                        toolCall: toolCall as ToolCall,
                        success: false,
                        error: error.message || '工具执行失败',
                      });
                    }
                  }
                  return results;
                };

                // 更新消息为工作流消息格式（使用特殊前缀，以便 ChatDrawer 识别并渲染 WorkflowMessageBubble）
                const workflowMessageContent = `${WORKFLOW_MESSAGE_PREFIX}${assistantMsgId}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          parts: [
                            { type: 'text', text: workflowMessageContent },
                          ],
                        }
                      : m
                  )
                );

                // 触发回调，让 ChatDrawer 处理工具执行和 UI 显示
                onToolCallsRef.current(
                  processedToolCalls as ToolCall[],
                  assistantMsgId,
                  executeTools,
                  textContent
                );
              }

              setStatus('ready');

              // Save assistant message
              // 如果有工具调用，保存为工作流消息格式（内容使用前缀，workflow 数据由 ChatDrawer 后续更新）
              const assistantChatMsg: ChatMessage = {
                id: assistantMsgId,
                sessionId,
                role: MessageRole.ASSISTANT,
                content:
                  toolCalls.length > 0
                    ? `${WORKFLOW_MESSAGE_PREFIX}${assistantMsgId}`
                    : fullContent,
                timestamp: Date.now(),
                status:
                  toolCalls.length > 0
                    ? MessageStatus.STREAMING
                    : MessageStatus.SUCCESS,
              };
              chatStorageService.addMessage(assistantChatMsg);
              // Update rawMessagesRef with the assistant message
              rawMessagesRef.current = [
                ...rawMessagesRef.current,
                assistantChatMsg,
              ];
              chatStorageService.updateSession(sessionId, {
                updatedAt: Date.now(),
                messageCount: (session?.messageCount || 0) + 2,
              });

              currentAssistantMsgRef.current = null;
              // 重置发送锁
              isSendingRef.current = false;
            } else if (event.type === 'error' && event.error) {
              setStatus('error');

              // Display error message in chat
              const errorText = `❌ 错误: ${event.error}`;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, parts: [{ type: 'text', text: errorText }] }
                    : m
                )
              );

              // Save error message
              const errorChatMsg: ChatMessage = {
                id: assistantMsgId,
                sessionId,
                role: MessageRole.ASSISTANT,
                content: errorText,
                timestamp: Date.now(),
                status: MessageStatus.FAILED,
                error: event.error,
              };
              chatStorageService.addMessage(errorChatMsg);
              // Update rawMessagesRef with the error message
              rawMessagesRef.current = [
                ...rawMessagesRef.current,
                errorChatMsg,
              ];

              currentAssistantMsgRef.current = null;
              // 重置发送锁
              isSendingRef.current = false;
            }
          },
          temporaryModelRef.current, // 传递临时模型（使用 ref 确保获取最新值）
          systemPromptRef.current // 传递系统提示词
        );
      } catch (error: any) {
        if (error.message !== 'Request cancelled') {
          setStatus('error');
          console.error('[useChatHandler] Stream error:', error);

          // Display error in chat
          const errorText = `❌ 错误: ${error.message || '未知错误'}`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, parts: [{ type: 'text', text: errorText }] }
                : m
            )
          );

          // Save error message
          if (sessionId && assistantMsgId) {
            const errorChatMsg: ChatMessage = {
              id: assistantMsgId,
              sessionId,
              role: MessageRole.ASSISTANT,
              content: errorText,
              timestamp: Date.now(),
              status: MessageStatus.FAILED,
              error: error.message || '未知错误',
            };
            chatStorageService.addMessage(errorChatMsg);
            // Update rawMessagesRef with the error message
            rawMessagesRef.current = [...rawMessagesRef.current, errorChatMsg];
          }
        }
        currentAssistantMsgRef.current = null;
        // 重置发送锁
        isSendingRef.current = false;
      }
    },
    [sessionId]
  );

  // Stop generation
  const stop = useCallback(async () => {
    chatService.stopGeneration();
    setStatus('ready');

    if (currentAssistantMsgRef.current && sessionId) {
      const currentMsg = messages.find(
        (m) => m.id === currentAssistantMsgRef.current
      );
      if (currentMsg) {
        const content = extractMessageText(currentMsg);

        const assistantChatMsg: ChatMessage = {
          id: currentMsg.id,
          sessionId,
          role: MessageRole.ASSISTANT,
          content,
          timestamp: Date.now(),
          status: MessageStatus.SUCCESS,
        };
        await chatStorageService.addMessage(assistantChatMsg);
      }
      currentAssistantMsgRef.current = null;
    }
  }, [sessionId, messages]);

  // Regenerate last response
  const regenerate = useCallback(
    (_opts?: { messageId?: string }) => {
      if (messages.length < 2) return;

      // Find the last user message
      const lastUserMsgIndex = [...messages]
        .reverse()
        .findIndex((m) => m.role === 'user');
      if (lastUserMsgIndex === -1) return;

      const actualIndex = messages.length - 1 - lastUserMsgIndex;
      const lastUserMsg = messages[actualIndex];

      // Remove messages after the user message
      const newMessages = messages.slice(0, actualIndex + 1);
      setMessages(newMessages);

      // Re-send the user message
      sendMessage(lastUserMsg);
    },
    [messages, sendMessage]
  );

  // 同时设置 UI 消息和原始消息（用于工作流场景）
  const setMessagesWithRaw = useCallback(
    (newMessages: Message[], rawChatMessages?: ChatMessage[]) => {
      setMessages(newMessages);
      if (rawChatMessages) {
        rawMessagesRef.current = rawChatMessages;
      }
    },
    []
  );

  // 更新原始消息中的工作流数据（用于工作流更新场景）
  const updateRawMessageWorkflow = useCallback(
    (messageId: string, workflow: WorkflowMessageData) => {
      rawMessagesRef.current = rawMessagesRef.current.map((msg) =>
        msg.id === messageId ? { ...msg, workflow } : msg
      );
    },
    []
  );

  return {
    messages,
    status,
    sendMessage,
    stop,
    regenerate,
    setMessages,
    setMessagesWithRaw,
    updateRawMessageWorkflow,
    isLoading,
  };
}
