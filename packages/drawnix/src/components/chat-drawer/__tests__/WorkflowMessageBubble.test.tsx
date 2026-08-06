// @vitest-environment jsdom

import React from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { WorkflowMessageData } from '../../../types/chat.types';
import { WorkflowMessageBubble } from '../WorkflowMessageBubble';
import {
  getWorkflowBubbleStatus,
  normalizeWorkflowStepsForDisplay,
} from '../../../utils/workflow-bubble-status';

vi.mock('../../shared/MediaViewer', () => ({
  MediaViewer: ({
    visible,
    items,
    initialIndex = 0,
  }: {
    visible: boolean;
    items: Array<{ url: string; type: string; title?: string }>;
    initialIndex?: number;
  }) =>
    visible ? (
      <div
        data-testid="media-viewer"
        data-initial-index={initialIndex}
        data-item-urls={items.map((item) => item.url).join('|')}
      >
        {items.length} items
      </div>
    ) : null,
}));

function createImageWorkflow(
  overrides: Partial<WorkflowMessageData> = {}
): WorkflowMessageData {
  const baseSteps: WorkflowMessageData['steps'] = [1, 2, 3].map((index) => ({
    id: `step-${index}`,
    description: `生成图片 (${index}/3)`,
    status: 'completed' as const,
    mcp: 'generate_image',
    args: {
      prompt: '生成一个超级苹果。',
    },
    result: {
      taskId: `task-${index}`,
      result: {
        url: `/__aitu_cache__/image/task-${index}.png`,
        format: 'png',
        size: 123,
      },
    },
    options: {
      batchId: 'wf_batch_wf-1',
      batchIndex: index,
      batchTotal: 3,
    },
  }));

  return {
    id: 'wf-1',
    name: '图片生成',
    generationType: 'image',
    prompt: '生成一个超级苹果。',
    count: 3,
    status: 'completed',
    steps: baseSteps,
    ...overrides,
  };
}

function createFailedWorkflow(): WorkflowMessageData {
  return createImageWorkflow({
    status: 'failed',
    steps: createImageWorkflow().steps.map((step) => ({
      ...step,
      status: 'failed',
      error: '图片生成失败',
      result: { taskId: `task-${step.options?.batchIndex}` },
    })),
    retryContext: {
      aiContext: {} as WorkflowMessageData['retryContext']['aiContext'],
      referenceImages: [],
    },
  });
}

beforeEach(() => {
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('WorkflowMessageBubble status helpers', () => {
  it('shows image workflow as completed when all generation tasks are completed', () => {
    const workflow = createImageWorkflow();
    const steps = normalizeWorkflowStepsForDisplay(workflow.steps);

    expect(getWorkflowBubbleStatus(steps)).toEqual({
      status: 'completed',
      totalSteps: 3,
      completedSteps: 3,
    });
  });

  it('does not keep a completed image workflow running because post-processing is missing', () => {
    const workflow = createImageWorkflow({
      postProcessingStatus: undefined,
    });
    const steps = normalizeWorkflowStepsForDisplay(workflow.steps);

    expect(getWorkflowBubbleStatus(steps).status).toBe('completed');
  });
});

describe('WorkflowMessageBubble rendering', () => {
  it('hides completed media steps by default and omits redundant generated summary', () => {
    render(<WorkflowMessageBubble workflow={createImageWorkflow()} />);

    expect(screen.getByText('图片生成')).toBeTruthy();
    expect(screen.getAllByText('已完成')).toHaveLength(1);
    expect(screen.getByText('3/3')).toBeTruthy();
    expect(screen.queryByText('生成图片 (1/3)')).toBeNull();
    expect(screen.queryByText('已生成')).toBeNull();
    expect(screen.getByRole('img', { name: '生成结果 1' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '生成结果 2' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '生成结果 3' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '查看执行详情' })
        .getAttribute('aria-expanded')
    ).toBe('false');
  });

  it('reveals completed media steps from the details toggle', () => {
    render(<WorkflowMessageBubble workflow={createImageWorkflow()} />);

    const toggle = screen.getByRole('button', { name: '查看执行详情' });
    fireEvent.click(toggle);

    expect(screen.getByText('生成图片 (1/3)')).toBeTruthy();
    expect(screen.getByText('生成图片 (2/3)')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens generated media in the shared preview on double click', () => {
    render(<WorkflowMessageBubble workflow={createImageWorkflow()} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: '查看生成结果 2' }));

    const viewer = screen.getByTestId('media-viewer');
    expect(viewer.getAttribute('data-initial-index')).toBe('1');
    expect(viewer.getAttribute('data-item-urls')).toBe(
      [
        '/__aitu_cache__/image/task-1.png',
        '/__aitu_cache__/image/task-2.png',
        '/__aitu_cache__/image/task-3.png',
      ].join('|')
    );
    expect(viewer.textContent).toBe('3 items');
  });

  it('exposes a reply action for completed generated media workflows', () => {
    const onReply = vi.fn();

    render(
      <WorkflowMessageBubble
        workflow={createImageWorkflow()}
        onReply={onReply}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '回复' }));

    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('keeps running workflow steps visible immediately', () => {
    render(
      <WorkflowMessageBubble
        workflow={createImageWorkflow({
          status: 'running',
          steps: createImageWorkflow().steps.map((step, index) => ({
            ...step,
            status: index === 0 ? 'running' : 'pending',
            result: undefined,
          })),
        })}
      />
    );

    expect(screen.getByText('生成图片 (1/3)')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: '查看执行详情' })
    ).toBeNull();
  });

  it('keeps failed workflow details and retry controls visible', () => {
    render(
      <WorkflowMessageBubble
        workflow={createFailedWorkflow()}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByText('生成图片 (1/3)')).toBeTruthy();
    expect(screen.getByText('执行失败，请重试')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /从失败步骤重试/ })
    ).toBeTruthy();
  });
});
