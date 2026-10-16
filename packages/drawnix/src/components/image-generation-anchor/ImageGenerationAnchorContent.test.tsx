import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import {
  IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
  type PlaitImageGenerationAnchor,
} from '../../types/image-generation-anchor.types';
import { workflowCompletionService } from '../../services/workflow-completion-service';
import { ImageGenerationAnchorContent } from './ImageGenerationAnchorContent';

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  retryTask: vi.fn(),
  updateAnchor: vi.fn(),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    getAllTasks: () => mocks.tasks,
    retryTask: mocks.retryTask,
    observeTaskUpdates: () => ({
      subscribe: () => ({ unsubscribe: () => undefined }),
    }),
  },
}));

vi.mock('./image-generation-anchor.transforms', () => ({
  ImageGenerationAnchorTransforms: { updateAnchor: mocks.updateAnchor },
}));

vi.mock('../retry-image', () => ({ RetryImage: () => null }));
vi.mock('tdesign-react', () => ({
  MessagePlugin: { success: vi.fn(), error: vi.fn() },
}));

function createAnchor(): PlaitImageGenerationAnchor {
  return {
    id: 'anchor-1',
    type: 'generation-anchor',
    points: [
      [0, 0],
      [320, 320],
    ],
    angle: 0,
    anchorType: 'ratio',
    phase: 'failed',
    title: '图片生成',
    subtitle: '生成失败，请重试',
    error: '插入失败：图片加载失败',
    transitionMode: 'hold',
    createdAt: 1,
    workflowId: 'workflow-1',
    taskIds: ['task-1'],
    primaryTaskId: 'task-1',
    requestedCount: 1,
    zoom: 1,
  };
}

describe('ImageGenerationAnchorContent result recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tasks = [
      {
        id: 'task-1',
        type: TaskType.IMAGE,
        status: TaskStatus.COMPLETED,
        params: { prompt: '生成图片', workflowId: 'workflow-1' },
        result: {
          url: 'https://cdn.example.com/result.png',
          format: 'png',
          size: 0,
        },
        createdAt: 1,
        updatedAt: 2,
      },
    ];
  });

  afterEach(() => {
    cleanup();
    workflowCompletionService.clear();
  });

  it('shows successful generation and retries insertion without regenerating', async () => {
    workflowCompletionService.failPostProcessing('task-1', '图片加载失败');
    const onRetryInsertion = vi.fn();
    window.addEventListener(
      IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
      onRetryInsertion
    );
    try {
      render(
        <ImageGenerationAnchorContent
          board={{ children: [] } as unknown as PlaitBoard}
          element={createAnchor()}
          selected={false}
        />
      );

      expect(screen.getByText('已生成，插入失败')).toBeTruthy();
      expect(screen.queryByText('生成失败')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '重试插入' }));

      await waitFor(() => expect(onRetryInsertion).toHaveBeenCalledTimes(1));
      expect(onRetryInsertion.mock.calls[0][0].detail).toEqual({
        taskId: 'task-1',
        anchorId: 'anchor-1',
      });
      expect(mocks.retryTask).not.toHaveBeenCalled();
      expect(mocks.tasks[0].status).toBe(TaskStatus.COMPLETED);
      expect(mocks.tasks[0].result?.url).toBe(
        'https://cdn.example.com/result.png'
      );
    } finally {
      window.removeEventListener(
        IMAGE_GENERATION_ANCHOR_RETRY_EVENT,
        onRetryInsertion
      );
    }
  });

  it('continues to offer generation retry when the provider task failed', async () => {
    mocks.tasks[0] = {
      ...mocks.tasks[0],
      status: TaskStatus.FAILED,
      result: undefined,
    };
    render(
      <ImageGenerationAnchorContent
        board={{ children: [] } as unknown as PlaitBoard}
        element={createAnchor()}
        selected={false}
      />
    );

    expect(screen.getByText('生成失败')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重试插入' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() =>
      expect(mocks.retryTask).toHaveBeenCalledExactlyOnceWith('task-1')
    );
  });
});
