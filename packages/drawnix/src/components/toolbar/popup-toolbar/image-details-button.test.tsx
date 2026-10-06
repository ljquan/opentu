import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskQueueService } from '../../../services/task-queue';
import { TaskStatus, TaskType, type Task } from '../../../types/task.types';
import { PopupImageDetailsButton } from './image-details-button';
import { persistImageDetailsOnClickEnabled } from './image-details-settings';

vi.mock('../../../services/task-queue', () => ({
  taskQueueService: {
    getCompleteTask: vi.fn(),
    findImageTaskByResultUrl: vi.fn(),
    getAllTasks: vi.fn(() => []),
  },
}));
vi.mock('../../../services/task-storage-reader', () => ({
  taskStorageReader: { findMediaTaskIdByResultUrl: vi.fn() },
}));
vi.mock('../../../services/task-invocation-route', () => ({
  resolveTaskInvocationRouteModel: (task: Task) => task.params.model,
}));
vi.mock('../../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@aitu/utils', () => ({
  isPromiseLike: (value: unknown) => value instanceof Promise,
}));

const image = { id: 'image', url: '/image.png', width: 1024, height: 1536 };
const task: Task = {
  id: 'task',
  type: TaskType.IMAGE,
  status: TaskStatus.COMPLETED,
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
  completedAt: 1700000001000,
  params: {
    prompt: 'A mountain',
    model: 'test-image-model',
    params: { imageSize: '4K' },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  persistImageDetailsOnClickEnabled(true);
});
afterEach(cleanup);

describe('image details popover', () => {
  it.each([
    ['video', TaskType.VIDEO, '视频'],
    ['audio', TaskType.AUDIO, '音频'],
    ['text', TaskType.CHAT, '文本'],
  ] as const)(
    'opens %s details and shows its own model and parameters',
    async (kind, type, label) => {
      vi.mocked(taskQueueService.getCompleteTask).mockResolvedValue({
        ...task,
        type,
        params: {
          prompt: `${kind} prompt`,
          model: `${kind}-model`,
          duration: 20,
          temperature: 0.7,
        },
      });
      render(
        <PopupImageDetailsButton
          image={{ ...image, kind, generationTaskId: 'task', duration: 20 }}
          language="zh"
          autoOpenRequest={1}
        />
      );
      expect(await screen.findByText(`${kind}-model`)).toBeTruthy();
      expect(screen.getByRole('dialog', { name: `${label}详情` })).toBeTruthy();
      expect(screen.getByText(`${kind} prompt`)).toBeTruthy();
      if (kind === 'audio' || kind === 'video')
        expect(screen.getByText('20 s')).toBeTruthy();
      if (kind === 'text' || kind === 'audio')
        expect(screen.queryByText('1024 × 1536 px')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: `关闭${label}详情` }));
      fireEvent.click(screen.getByRole('button', { name: `查看${label}详情` }));
      expect(await screen.findByText(`${kind}-model`)).toBeTruthy();
    }
  );
  it('positions details to the right of the image with a gap', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      task
    );
    render(
      <PopupImageDetailsButton
        image={image}
        language="zh"
        autoOpenRequest={1}
        selectionRect={{ left: 180, right: 580, top: 100, bottom: 600 }}
      />
    );
    await screen.findByText('test-image-model');
    const panel = screen.getByRole('dialog');
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.left).toBe('592px');
    expect(panel.style.top).toBe('100px');
    expect(panel.style.width).toBe('380px');
  });

  it('uses the left side instead of overlapping when right space is too small', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      task
    );
    render(
      <PopupImageDetailsButton
        image={image}
        language="zh"
        autoOpenRequest={1}
        selectionRect={{ left: 450, right: 950, top: 100, bottom: 600 }}
      />
    );
    await screen.findByText('test-image-model');
    const panel = screen.getByRole('dialog');
    expect(panel.style.left).toBe('58px');
    expect(
      Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)
    ).toBeLessThan(450);
  });

  it('automatically opens on an image click request and can reopen the same image after closing', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      task
    );
    const { rerender } = render(
      <PopupImageDetailsButton
        image={image}
        language="zh"
        autoOpenRequest={1}
      />
    );
    expect(await screen.findByText('test-image-model')).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: '点击内容自动打开详情' })
    ).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('button', { name: '关闭图片详情' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <PopupImageDetailsButton
        image={image}
        language="zh"
        autoOpenRequest={2}
      />
    );
    expect(await screen.findByText('test-image-model')).toBeTruthy();
  });

  it('retains a disabled preference for the next image while allowing manual opening', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      task
    );
    const { rerender } = render(
      <PopupImageDetailsButton
        key="first"
        image={image}
        language="zh"
        autoOpenRequest={1}
      />
    );
    await screen.findByText('test-image-model');
    fireEvent.click(
      screen.getByRole('switch', { name: '点击内容自动打开详情' })
    );
    expect(screen.getByRole('switch')).toHaveProperty('checked', false);
    rerender(
      <PopupImageDetailsButton
        key="second"
        image={{ ...image, id: 'second' }}
        language="zh"
        autoOpenRequest={2}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看图片详情' }));
    await screen.findByText('test-image-model');
    expect(screen.getByRole('switch')).toHaveProperty('checked', false);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByRole('switch')).toHaveProperty('checked', true);
  });

  it('loads only on activation and shows recorded generation metadata', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      task
    );
    render(<PopupImageDetailsButton image={image} language="zh" />);
    expect(taskQueueService.findImageTaskByResultUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看图片详情' }));
    expect(await screen.findByText('test-image-model')).toBeTruthy();
    expect(screen.getByText('A mountain')).toBeTruthy();
    expect(screen.getByText('4K')).toBeTruthy();
    expect(screen.getByText('1024 × 1536 px')).toBeTruthy();
    expect(screen.getByText('生成时间')).toBeTruthy();
    expect(screen.getByText('完成时间')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭图片详情' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows missing fields without using the current model for uploaded images', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      undefined
    );
    render(<PopupImageDetailsButton image={image} language="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'View image details' }));
    expect(
      await screen.findByText('No generation record found for this image')
    ).toBeTruthy();
    expect(screen.getAllByText('Not recorded')).toHaveLength(4);
    expect(screen.getByText('1024 × 1536 px')).toBeTruthy();
    expect(screen.queryByText('Completion time')).toBeNull();
  });

  it('offers retry after a read error', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl)
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(task);
    render(<PopupImageDetailsButton image={image} language="zh" />);
    fireEvent.click(screen.getByRole('button', { name: '查看图片详情' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '生成记录读取失败'
    );
    expect(screen.queryByText('未找到该图片的生成记录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('test-image-model')).toBeTruthy();
  });

  it('closes with Escape and returns focus to the details button', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      task
    );
    render(<PopupImageDetailsButton image={image} language="zh" />);
    const trigger = screen.getByRole('button', { name: '查看图片详情' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByText('test-image-model');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('discards a pending lookup when the toolbar changes to another image', async () => {
    let resolveOld!: (task: Task) => void;
    vi.mocked(taskQueueService.findImageTaskByResultUrl)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      )
      .mockResolvedValueOnce({
        ...task,
        params: { prompt: 'New image', model: 'new-model' },
      });
    const { rerender } = render(
      <PopupImageDetailsButton key="old" image={image} language="zh" />
    );
    fireEvent.click(screen.getByRole('button', { name: '查看图片详情' }));
    expect(screen.getByRole('status')).toBeTruthy();
    rerender(
      <PopupImageDetailsButton
        key="new"
        image={{ ...image, id: 'new', url: '/new.png' }}
        language="zh"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '查看图片详情' }));
    expect(await screen.findByText('new-model')).toBeTruthy();
    await act(async () => resolveOld(task));
    expect(screen.queryByText('test-image-model')).toBeNull();
    expect(screen.getByText('new-model')).toBeTruthy();
  });
});
