// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@llamaindex/chat-ui';
import type { WorkflowMessageData } from '../../../types/chat.types';

const scrollIntoViewMock = vi.fn();
let resizeObserverCallback:
  | ResizeObserverCallback
  | null = null;

vi.mock('@llamaindex/chat-ui', () => {
  const ChatMessagesComponent = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;

  const ChatMessagesList = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div className={className} data-testid="chat-messages-list">
      {children}
    </div>
  );

  const ChatMessageComponent = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;

  ChatMessagesComponent.List = ChatMessagesList;
  ChatMessagesComponent.Loading = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  ChatMessagesComponent.Empty = ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;

  ChatMessageComponent.Avatar = ({ className }: { className?: string }) => (
    <div className={className} />
  );
  ChatMessageComponent.Content = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>;
  ChatMessageComponent.Actions = ({ className }: { className?: string }) => (
    <div className={className} />
  );

  return {
    ChatSection: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
    ChatMessages: ChatMessagesComponent,
    ChatMessage: ChatMessageComponent,
  };
});

vi.mock('../WorkflowMessageBubble', () => ({
  WorkflowMessageBubble: ({ workflow }: { workflow: WorkflowMessageData }) => (
    <div data-testid={`workflow-bubble-${workflow.id}`}>{workflow.name}</div>
  ),
}));

vi.mock('../UserMessageBubble', () => ({
  UserMessageBubble: ({ message }: { message: Message }) => (
    <div data-testid={`user-bubble-${message.id}`}>user</div>
  ),
}));

vi.mock('../../MarkdownEditor', () => ({
  __esModule: true,
  default: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}));

describe('ChatMessagesArea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resizeObserverCallback = null;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback;
        }

        observe() {}

        disconnect() {}
      }
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('内容后续增高时会继续贴到最新消息', async () => {
    const { ChatMessagesArea } = await import('../ChatMessagesArea');

    const handler = {
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '旧消息' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '最新消息' }] },
      ],
    } as any;

    render(
      <ChatMessagesArea
        handler={handler}
        workflowMessages={new Map()}
        retryingWorkflowId={null}
        handleWorkflowRetry={vi.fn()}
      />
    );

    scrollIntoViewMock.mockClear();
    resizeObserverCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('用户已经滚离底部时，不再被后续高度变化强拉回去', async () => {
    const { ChatMessagesArea } = await import('../ChatMessagesArea');

    const handler = {
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '旧消息' }] },
        { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '最新消息' }] },
      ],
    } as any;

    render(
      <ChatMessagesArea
        handler={handler}
        workflowMessages={new Map()}
        retryingWorkflowId={null}
        handleWorkflowRetry={vi.fn()}
      />
    );

    const scrollContainer = screen.getByTestId('chat-messages-list');
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    fireEvent.scroll(scrollContainer);
    scrollIntoViewMock.mockClear();
    resizeObserverCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });
});
