import React, { useCallback, useState } from 'react';
import { WorkflowMessageBubble } from './WorkflowMessageBubble';
import { UserMessageBubble } from './UserMessageBubble';
import type { WorkflowMessageData } from '../../types/chat.types';
import type { ChatHandler, Message } from '../../types/chat-ui.types';
import MarkdownReadonly from '../MarkdownReadonly';
import {
  UnifiedMediaViewer,
  type MediaItem as UnifiedMediaItem,
} from '../shared/media-preview';

// 工作流消息的特殊标记前缀
const WORKFLOW_MESSAGE_PREFIX = '[[WORKFLOW_MESSAGE]]';

interface ChatMessagesAreaProps {
  handler: ChatHandler;
  workflowMessages: Map<string, WorkflowMessageData>;
  retryingWorkflowId: string | null;
  handleWorkflowReply?: (
    messageId: string,
    workflow: WorkflowMessageData
  ) => void;
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
  handleWorkflowReply,
  handleWorkflowRetry,
  className = 'chat-section',
}) => {
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewItems, setPreviewItems] = useState<UnifiedMediaItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);

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
    let firstText: string | null = null;
    let textParts: string[] | null = null;

    for (const part of message.parts) {
      if (part.type !== 'text') continue;
      if (firstText === null) {
        firstText = part.text;
        continue;
      }
      if (!textParts) {
        textParts = [firstText];
      }
      textParts.push(part.text);
    }

    return textParts ? textParts.join('') : firstText ?? '';
  }, []);

  const handlePreviewImages = useCallback(
    (items: UnifiedMediaItem[], initialIndex: number) => {
      if (items.length === 0) return;
      setPreviewItems(items);
      setPreviewInitialIndex(initialIndex);
      setPreviewVisible(true);
    },
    []
  );

  const showLoading =
    handler.status === 'submitted' || handler.status === 'streaming';
  const showEmpty = handler.messages.length === 0 && !showLoading;

  return (
    <div className={className}>
      <div className="chat-messages">
        <div className="chat-messages-list">
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
                    onReply={
                      handleWorkflowReply
                        ? () => handleWorkflowReply(workflowMsgId, workflowData)
                        : undefined
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
                <UserMessageBubble
                  key={message.id}
                  message={message}
                  onPreviewImages={handlePreviewImages}
                />
              );
            }

            return (
              <div
                key={message.id}
                className={messageClass}
                data-message-id={message.id}
                data-message-last={index === handler.messages.length - 1}
              >
                <div className="chat-message-avatar">
                  <span>{message.role === 'user' ? '👤' : '🤖'}</span>
                </div>
                <div className="chat-message-content">
                  <MarkdownReadonly
                    markdown={getMessageMarkdown(message)}
                    className="chat-markdown"
                  />
                </div>
                {message.role === 'assistant' && !isError && (
                  <div className="chat-message-actions" />
                )}
              </div>
            );
          })}
          {showLoading && (
            <div className="chat-loading">
              <div className="chat-loading__spinner" />
              <span>思考中...</span>
            </div>
          )}
          {showEmpty && (
            <div className="chat-empty">
              <h3>开始对话</h3>
              <p>输入消息与AI助手交流</p>
            </div>
          )}
        </div>
      </div>
      <UnifiedMediaViewer
        visible={previewVisible}
        items={previewItems}
        initialIndex={previewInitialIndex}
        onClose={() => setPreviewVisible(false)}
        showThumbnails={previewItems.length > 1}
        videoAutoPlay={true}
      />
    </div>
  );
};

export default ChatMessagesArea;
