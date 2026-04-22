import React, { useCallback, useEffect, useRef } from 'react';
import {
  ChatSection,
  ChatMessages,
  ChatMessage,
  type ChatHandler,
  type Message,
} from '@llamaindex/chat-ui';
import '@llamaindex/chat-ui/styles/pdf.css';
import { WorkflowMessageBubble } from './WorkflowMessageBubble';
import { UserMessageBubble } from './UserMessageBubble';
import type { WorkflowMessageData } from '../../types/chat.types';
import MarkdownEditor from '../MarkdownEditor';

// 工作流消息的特殊标记前缀
const WORKFLOW_MESSAGE_PREFIX = '[[WORKFLOW_MESSAGE]]';

interface ChatMessagesAreaProps {
  handler: ChatHandler;
  workflowMessages: Map<string, WorkflowMessageData>;
  retryingWorkflowId: string | null;
  handleWorkflowRetry: (
    messageId: string,
    workflow: WorkflowMessageData,
    stepIndex: number
  ) => void;
  className?: string;
}

export const ChatMessagesArea: React.FC<ChatMessagesAreaProps> = ({
  handler,
  workflowMessages,
  retryingWorkflowId,
  handleWorkflowRetry,
  className = 'chat-section',
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  // 检查消息是否为工作流消息
  const isWorkflowMessage = useCallback((message: Message): string | null => {
    const textPart = message.parts.find((p) => p.type === 'text');
    if (textPart && 'text' in textPart) {
      const text = textPart.text as string;
      if (text.startsWith(WORKFLOW_MESSAGE_PREFIX)) {
        return text.replace(WORKFLOW_MESSAGE_PREFIX, '');
      }
    }
    return null;
  }, []);

  // 检查用户消息是否包含图片
  const hasImages = useCallback((message: Message): boolean => {
    return message.parts.some((p) => p.type === 'data-file');
  }, []);

  const getMessageMarkdown = useCallback((message: Message) => {
    const parts = message.parts
      .filter((part) => part.type === 'text' && 'text' in part)
      .map((part) => (typeof (part as any).text === 'string' ? (part as any).text : String((part as any).text ?? '')));
    return parts.join('');
  }, []);

  const getScrollContainer = useCallback(() => {
    if (scrollContainerRef.current?.isConnected) {
      return scrollContainerRef.current;
    }

    const container = bottomAnchorRef.current?.closest(
      '.chat-messages-list'
    ) as HTMLDivElement | null;
    scrollContainerRef.current = container;
    return container;
  }, []);

  const isNearBottom = useCallback((container?: HTMLDivElement | null) => {
    const target = container || getScrollContainer();
    if (!target) return true;

    return target.scrollHeight - target.scrollTop - target.clientHeight <= 24;
  }, [getScrollContainer]);

  const scrollToLatest = useCallback(() => {
    const container = getScrollContainer();

    bottomAnchorRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'end',
    });

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [getScrollContainer]);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    const handleScroll = () => {
      shouldStickToBottomRef.current = isNearBottom(container);
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [getScrollContainer, isNearBottom]);

  const lastMessageId = handler.messages[handler.messages.length - 1]?.id;

  useEffect(() => {
    if (handler.messages.length === 0) return;

    shouldStickToBottomRef.current = true;
    requestAnimationFrame(() => {
      scrollToLatest();
    });
  }, [handler.messages.length, lastMessageId, scrollToLatest]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !contentRef.current) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!shouldStickToBottomRef.current) {
        return;
      }

      requestAnimationFrame(() => {
        scrollToLatest();
      });
    });

    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [scrollToLatest]);

  return (
    <ChatSection handler={handler} className={className}>
      <ChatMessages className="chat-messages">
        <ChatMessages.List className="chat-messages-list">
          <div ref={contentRef}>
            {handler.messages.map((message, index) => {
              // 检查是否为工作流消息
              const workflowMsgId = isWorkflowMessage(message);
              if (workflowMsgId) {
                const workflowData = workflowMessages.get(workflowMsgId);
                if (workflowData) {
                  return (
                    <WorkflowMessageBubble
                      key={message.id}
                      workflow={workflowData}
                      onRetry={(stepIndex) =>
                        handleWorkflowRetry(workflowMsgId, workflowData, stepIndex)
                      }
                      isRetrying={retryingWorkflowId === workflowMsgId}
                    />
                  );
                }
              }

              // Check if message is an error
              const isError = message.parts.some(
                (part) =>
                  part.type === 'text' &&
                  'text' in part &&
                  typeof part.text === 'string' &&
                  part.text.startsWith('❌ 错误')
              );
              const messageClass = `chat-message chat-message--${message.role} ${
                isError ? 'chat-message--error' : ''
              }`;

              // 用户消息包含图片时使用自定义气泡
              if (message.role === 'user' && hasImages(message)) {
                return (
                  <UserMessageBubble key={message.id} message={message} />
                );
              }

              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isLast={index === handler.messages.length - 1}
                  className={messageClass}
                >
                  <ChatMessage.Avatar className="chat-message-avatar" />
                  <ChatMessage.Content className="chat-message-content">
                    <MarkdownEditor
                      markdown={getMessageMarkdown(message)}
                      readOnly
                      showModeSwitch={false}
                      initialMode="wysiwyg"
                      className="chat-markdown"
                    />
                  </ChatMessage.Content>
                  {message.role === 'assistant' && !isError && (
                    <ChatMessage.Actions className="chat-message-actions" />
                  )}
                </ChatMessage>
              );
            })}
            <div ref={bottomAnchorRef} aria-hidden="true" />
          </div>
        </ChatMessages.List>
        <ChatMessages.Loading className="chat-loading">
          <div className="chat-loading__spinner" />
          <span>思考中...</span>
        </ChatMessages.Loading>
        <ChatMessages.Empty
          className="chat-empty"
          heading="开始对话"
          subheading="输入消息与AI助手交流"
        />
      </ChatMessages>
    </ChatSection>
  );
};

export default ChatMessagesArea;
