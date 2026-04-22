// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowMessageData } from '../../../types/chat.types';

const getPostProcessingStatusMock = vi.fn();
const getTaskMock = vi.fn();
const scrollIntoViewMock = vi.fn();

vi.mock('@llamaindex/chat-ui', () => ({
  ChatMessage: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock('../MermaidRenderer', () => ({
  MermaidRenderer: () => null,
}));

vi.mock('../../shared', () => ({
  UnifiedMediaViewer: ({
    visible,
    items,
  }: {
    visible: boolean;
    items: Array<{ url: string }>;
  }) =>
    visible ? (
      <div data-testid="workflow-media-viewer">{items.map((item) => item.url).join(',')}</div>
    ) : null,
}));

vi.mock('../../../services/workflow-completion-service', () => ({
  workflowCompletionService: {
    getPostProcessingStatus: (...args: unknown[]) =>
      getPostProcessingStatusMock(...args),
  },
}));

vi.mock('../../../services/task-queue-service', () => ({
  taskQueueService: {
    getTask: (...args: unknown[]) => getTaskMock(...args),
  },
}));

describe('WorkflowMessageBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scrollIntoViewMock.mockReset();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('底层任务已插入画布时展示已完成而不是正在处理', async () => {
    const { WorkflowMessageBubble } = await import('../WorkflowMessageBubble');

    const workflow: WorkflowMessageData = {
      id: 'workflow-1',
      name: '图片生成',
      generationType: 'image',
      prompt: '生成一个苹果',
      count: 1,
      steps: [
        {
          id: 'step-1',
          description: '生成图片',
          status: 'completed',
          mcp: 'generate_image',
          args: { prompt: '生成一个苹果' },
          result: {
            taskId: 'task-1',
          },
        },
      ],
    };

    getPostProcessingStatusMock.mockReturnValue(undefined);
    getTaskMock.mockReturnValue({
      id: 'task-1',
      insertedToCanvas: true,
      status: 'completed',
    });

    render(<WorkflowMessageBubble workflow={workflow} />);

    expect(screen.queryByText('正在处理')).toBeNull();
    expect(
      document.querySelector('.workflow-bubble__status')?.textContent
    ).toBe('已完成');
  });

  it('底层任务已失败时展示执行失败而不是正在处理', async () => {
    const { WorkflowMessageBubble } = await import('../WorkflowMessageBubble');

    const workflow: WorkflowMessageData = {
      id: 'workflow-2',
      name: '图片生成',
      generationType: 'image',
      prompt: '生成一个苹果',
      count: 1,
      steps: [
        {
          id: 'step-1',
          description: '生成图片',
          status: 'completed',
          mcp: 'generate_image',
          args: { prompt: '生成一个苹果' },
          result: {
            taskId: 'task-2',
          },
        },
      ],
    };

    getPostProcessingStatusMock.mockReturnValue(undefined);
    getTaskMock.mockReturnValue({
      id: 'task-2',
      insertedToCanvas: false,
      status: 'failed',
    });

    render(<WorkflowMessageBubble workflow={workflow} />);

    expect(screen.queryByText('正在处理')).toBeNull();
    expect(
      document.querySelector('.workflow-bubble__status')?.textContent
    ).toBe('执行失败');
  });

  it('初次加载运行中的工作流卡片时不会主动滚动到旧卡片', async () => {
    const { WorkflowMessageBubble } = await import('../WorkflowMessageBubble');

    const workflow: WorkflowMessageData = {
      id: 'workflow-running-initial',
      name: '图片生成',
      generationType: 'image',
      prompt: '生成一个苹果',
      count: 1,
      steps: [
        {
          id: 'step-1',
          description: '生成图片',
          status: 'running',
          mcp: 'generate_image',
          args: { prompt: '生成一个苹果' },
          result: {
            taskId: 'task-running-initial',
          },
        },
      ],
      postProcessingStatus: 'processing',
    };

    render(<WorkflowMessageBubble workflow={workflow} />);

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('运行中的工作流后续有新进展时仍会自动滚动到当前卡片', async () => {
    const { WorkflowMessageBubble } = await import('../WorkflowMessageBubble');

    const workflow: WorkflowMessageData = {
      id: 'workflow-running-update',
      name: '图片生成',
      generationType: 'image',
      prompt: '生成一个苹果',
      count: 1,
      steps: [
        {
          id: 'step-1',
          description: '生成图片',
          status: 'running',
          mcp: 'generate_image',
          args: { prompt: '生成一个苹果' },
          result: {
            taskId: 'task-running-update',
          },
        },
      ],
      postProcessingStatus: 'processing',
    };

    const { rerender } = render(<WorkflowMessageBubble workflow={workflow} />);

    const updatedWorkflow: WorkflowMessageData = {
      ...workflow,
      steps: [
        workflow.steps[0],
        {
          id: 'step-2',
          description: '插入画布',
          status: 'running',
          mcp: 'canvas_insertion',
          args: {},
        },
      ],
    };

    rerender(<WorkflowMessageBubble workflow={updatedWorkflow} />);

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it('图片工作流成功后会展示结果缩略图并支持打开统一预览', async () => {
    const { WorkflowMessageBubble } = await import('../WorkflowMessageBubble');

    const workflow: WorkflowMessageData = {
      id: 'workflow-preview',
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
            taskId: 'task-preview',
          },
        },
      ],
      postProcessingStatus: 'completed',
      insertedCount: 1,
    };

    getPostProcessingStatusMock.mockReturnValue({
      status: 'completed',
      insertedCount: 1,
    });
    getTaskMock.mockReturnValue({
      id: 'task-preview',
      status: 'completed',
      insertedToCanvas: true,
      result: {
        url: 'https://example.com/banana.png',
        format: 'png',
        size: 1024,
      },
    });

    render(<WorkflowMessageBubble workflow={workflow} />);

    expect(
      screen.getByRole('button', {
        name: '预览结果 1',
      })
    ).toBeTruthy();
    expect(screen.getByAltText('工作流结果 1').getAttribute('src')).toBe(
      'https://example.com/banana.png'
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: '预览结果 1',
      })
    );

    expect(
      screen.getByTestId('workflow-media-viewer').textContent
    ).toContain(
      'https://example.com/banana.png'
    );
  });
});
