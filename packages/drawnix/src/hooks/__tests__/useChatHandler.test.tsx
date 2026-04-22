// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@llamaindex/chat-ui';
import {
  MessageRole,
  MessageStatus,
  type ChatMessage,
} from '../../types/chat.types';

const getMessagesMock = vi.fn();
const addMessageMock = vi.fn().mockResolvedValue(undefined);
const getSessionMock = vi.fn().mockResolvedValue({
  id: 'session-1',
  messageCount: 2,
});
const updateSessionMock = vi.fn().mockResolvedValue(undefined);
const sendChatMessageMock = vi.fn();
const executeToolMock = vi.fn();
const parseToolCallsMock = vi.fn();
const extractTextContentMock = vi.fn();
const generateIdMock = vi.fn(() => 'assistant-msg-1');

vi.mock('../../services/chat-storage-service', () => ({
  chatStorageService: {
    getMessages: (...args: unknown[]) => getMessagesMock(...args),
    addMessage: (...args: unknown[]) => addMessageMock(...args),
    getSession: (...args: unknown[]) => getSessionMock(...args),
    updateSession: (...args: unknown[]) => updateSessionMock(...args),
    generateId: (...args: unknown[]) => generateIdMock(...args),
  },
}));

vi.mock('../../services/chat-service', () => ({
  chatService: {
    sendChatMessage: (...args: unknown[]) => sendChatMessageMock(...args),
    stopGeneration: vi.fn(),
    isGenerating: vi.fn(() => false),
  },
}));

vi.mock('../../services/agent', () => ({
  generateSystemPrompt: vi.fn(() => 'system prompt'),
}));

vi.mock('../../services/agent/tool-parser', () => ({
  parseToolCalls: (...args: unknown[]) => parseToolCallsMock(...args),
  extractTextContent: (...args: unknown[]) => extractTextContentMock(...args),
}));

vi.mock('../../mcp', () => ({
  initializeMCP: vi.fn(),
  mcpRegistry: {
    executeTool: (...args: unknown[]) => executeToolMock(...args),
  },
}));

vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: {
    get: () => ({
      imageModelName: 'gemini-3-pro-image-preview-vip',
      videoModelName: 'veo3.1',
    }),
  },
}));

function createUserMessage(
  text: string,
  extraParts: Message['parts'] = []
): Message {
  return {
    id: 'user-msg-1',
    role: 'user',
    parts: [{ type: 'text', text }, ...extraParts],
  };
}

function createImagePart(filename: string, url: string) {
  return {
    type: 'data-file' as const,
    data: {
      filename,
      mediaType: 'image/png',
      url,
    },
  };
}

function createImageWorkflowMessage(): ChatMessage {
  return {
    id: 'workflow-msg-1',
    sessionId: 'session-1',
    role: MessageRole.ASSISTANT,
    content: '[[WORKFLOW_MESSAGE]]workflow-msg-1',
    timestamp: 1,
    status: MessageStatus.SUCCESS,
    workflow: {
      id: 'workflow-1',
      name: '图片生成',
      generationType: 'image',
      prompt: '生成一个香蕉',
      count: 1,
      steps: [
        {
          id: 'step-1',
          description: '生成图片',
          status: 'completed',
          mcp: 'generate_image',
          args: { prompt: '生成一个香蕉' },
          result: {
            taskId: 'task-1',
            url: 'https://example.com/banana.png',
            format: 'png',
            size: 1024,
          },
        },
      ],
    },
  };
}

describe('useChatHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMessagesMock.mockResolvedValue([]);
    addMessageMock.mockResolvedValue(undefined);
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      messageCount: 2,
    });
    updateSessionMock.mockResolvedValue(undefined);
    generateIdMock.mockReturnValue('assistant-msg-1');
    parseToolCallsMock.mockReturnValue([]);
    extractTextContentMock.mockImplementation((content: string) => content);
    executeToolMock.mockResolvedValue({
      success: true,
      data: { taskId: 'task-1' },
      taskId: 'task-1',
      type: 'image',
    });
    sendChatMessageMock.mockImplementation(
      async (
        _history: unknown[],
        _content: string,
        _attachments: unknown[],
        onStream: (event: { type: 'content' | 'done'; content?: string }) => void
      ) => {
        onStream({ type: 'content', content: 'tool response' });
        onStream({ type: 'done' });
        return 'tool response';
      }
    );
  });

  it.each([
    ['generate_image', { mode: 'queue' }],
    ['generate_video', { mode: 'queue' }],
    ['generate_audio', { mode: 'queue' }],
    ['generate_text', undefined],
  ])(
    'agent 工具 %s 会传递正确的执行模式',
    async (toolName, expectedOptions) => {
      const { useChatHandler } = await import('../useChatHandler');
      let executeTools:
        | (() => Promise<
            Array<{
              toolCall: { name: string; arguments: Record<string, unknown> };
              success: boolean;
              data?: unknown;
              error?: string;
              taskId?: string;
            }>
          >)
        | null = null;

      parseToolCallsMock.mockReturnValue([
        {
          name: toolName,
          arguments: { prompt: '生成一个苹果' },
        },
      ]);
      extractTextContentMock.mockReturnValue('生成一个苹果');

      const { result } = renderHook(() =>
        useChatHandler({
          sessionId: 'session-1',
          onToolCalls: (_toolCalls, _messageId, exec) => {
            executeTools = exec;
          },
        })
      );

      await waitFor(() => {
        expect(getMessagesMock).toHaveBeenCalledWith('session-1');
      });

      await act(async () => {
        await result.current.sendMessage(createUserMessage('生成一个苹果'));
      });

      expect(executeTools).toBeTypeOf('function');

      await act(async () => {
        await executeTools?.();
      });

      const latestCall = executeToolMock.mock.calls.at(-1);
      expect(latestCall?.[0]).toMatchObject({ name: toolName });

      if (expectedOptions) {
        expect(latestCall?.[1]).toMatchObject(expectedOptions);
      } else {
        expect(latestCall).toHaveLength(1);
      }
    }
  );

  it('没有重新选图或上传参考图时，会对“上一张图基础上改”给出明确追问且不发起模型请求', async () => {
    const { useChatHandler } = await import('../useChatHandler');

    getMessagesMock.mockResolvedValue([createImageWorkflowMessage()]);

    const { result } = renderHook(() =>
      useChatHandler({
        sessionId: 'session-1',
      })
    );

    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledWith('session-1');
    });

    await act(async () => {
      await result.current.sendMessage(
        createUserMessage(
          '请在上一张图基础上，把香蕉改得更新鲜一点，少一点斑点。'
        )
      );
    });

    expect(sendChatMessageMock).not.toHaveBeenCalled();
    expect(addMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: MessageRole.ASSISTANT,
        status: MessageStatus.SUCCESS,
        content: expect.stringContaining('重新选中'),
      })
    );
    expect(
      result.current.messages[result.current.messages.length - 1]?.parts
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('上传参考图'),
        }),
      ])
    );
  });

  it('当前消息带图片附件时，会给模型补充参考图占位符语义并保留原始附件', async () => {
    const { useChatHandler } = await import('../useChatHandler');

    const { result } = renderHook(() =>
      useChatHandler({
        sessionId: 'session-1',
      })
    );

    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledWith('session-1');
    });

    await act(async () => {
      await result.current.sendMessage(
        createUserMessage('把这个香蕉改新鲜一点', [
          createImagePart('banana.png', 'data:image/png;base64,banana'),
        ])
      );
    });

    expect(sendChatMessageMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('[参考图片: [图片1]]'),
      expect.arrayContaining([
        expect.objectContaining({
          name: 'banana.png',
          type: 'image/png',
          data: 'data:image/png;base64,banana',
        }),
      ]),
      expect.any(Function),
      undefined,
      expect.stringContaining('用户提供了 1 张参考图片')
    );
  });

  it('当前消息带多张图片附件时，会稳定生成对应顺序的参考图占位符', async () => {
    const { useChatHandler } = await import('../useChatHandler');

    const { result } = renderHook(() =>
      useChatHandler({
        sessionId: 'session-1',
      })
    );

    await waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledWith('session-1');
    });

    await act(async () => {
      await result.current.sendMessage(
        createUserMessage('把这两张图融合一下', [
          createImagePart('banana-1.png', 'data:image/png;base64,banana-1'),
          createImagePart('banana-2.png', 'data:image/png;base64,banana-2'),
        ])
      );
    });

    expect(sendChatMessageMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('[参考图片: [图片1]、[图片2]]'),
      expect.arrayContaining([
        expect.objectContaining({ name: 'banana-1.png' }),
        expect.objectContaining({ name: 'banana-2.png' }),
      ]),
      expect.any(Function),
      undefined,
      expect.stringContaining('用户提供了 2 张参考图片')
    );
  });
});
