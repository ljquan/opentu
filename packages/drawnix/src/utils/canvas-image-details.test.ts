import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskQueueService } from '../services/task-queue';
import { taskStorageReader } from '../services/task-storage-reader';
import { TaskStatus, TaskType, type Task } from '../types/task.types';
import {
  findCanvasImageTask,
  getCanvasImageDetails,
} from './canvas-image-details';

vi.mock('../services/task-queue', () => ({
  taskQueueService: {
    getCompleteTask: vi.fn(),
    findImageTaskByResultUrl: vi.fn(),
    getAllTasks: vi.fn(),
  },
}));
vi.mock('../services/task-storage-reader', () => ({
  taskStorageReader: { findMediaTaskIdByResultUrl: vi.fn() },
}));
vi.mock('../services/task-invocation-route', () => ({
  resolveTaskInvocationRouteModel: (task: Task) =>
    task.invocationRoute?.modelId || task.params.modelRef || task.params.model,
}));

const image = { id: 'image', url: '/image.png', width: 1024, height: 1536 };
const task: Task = {
  id: 'task',
  type: TaskType.IMAGE,
  status: TaskStatus.COMPLETED,
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
  completedAt: 1700000001000,
  params: { prompt: 'A mountain', model: 'original-model' },
};

beforeEach(() => vi.resetAllMocks());

describe('canvas image generation details', () => {
  it('reports a failed legacy media lookup instead of treating it as no record', async () => {
    vi.mocked(taskQueueService.getAllTasks).mockReturnValue([]);
    vi.mocked(taskStorageReader.findMediaTaskIdByResultUrl).mockRejectedValue(
      new Error('history unavailable')
    );
    await expect(
      findCanvasImageTask({ ...image, kind: 'audio' })
    ).rejects.toThrow('history unavailable');
  });

  it('preserves nested token limits while filtering authentication tokens', () => {
    const details = getCanvasImageDetails(
      { ...image, kind: 'text' },
      {
        ...task,
        type: TaskType.CHAT,
        params: {
          prompt: 'story',
          params: { max_tokens: 2048, token: 'secret' },
        },
      }
    );
    expect(details.parameters).toEqual([{ name: 'max_tokens', value: '2048' }]);
  });
  it.each([
    ['video', TaskType.VIDEO],
    ['audio', TaskType.AUDIO],
    ['text', TaskType.CHAT],
  ] as const)('reads the bound generation task for %s', async (kind, type) => {
    const bound = { ...task, type };
    vi.mocked(taskQueueService.getCompleteTask).mockResolvedValue(bound);
    expect(
      await findCanvasImageTask({ ...image, kind, generationTaskId: 'task' })
    ).toBe(bound);
    expect(taskQueueService.findImageTaskByResultUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['video', TaskType.VIDEO],
    ['audio', TaskType.AUDIO],
  ] as const)(
    'finds legacy %s tasks in persistent storage by result URL',
    async (kind, type) => {
      vi.mocked(taskQueueService.getAllTasks).mockReturnValue([]);
      vi.mocked(taskStorageReader.findMediaTaskIdByResultUrl).mockResolvedValue(
        'stored'
      );
      const stored = { ...task, id: 'stored', type };
      vi.mocked(taskQueueService.getCompleteTask).mockResolvedValue(stored);
      expect(await findCanvasImageTask({ ...image, kind })).toBe(stored);
      expect(taskStorageReader.findMediaTaskIdByResultUrl).toHaveBeenCalledWith(
        image.url,
        type,
        { includeArchived: true, throwOnError: true }
      );
    }
  );

  it('does not match text by arbitrary URL or invent a task for manual text', async () => {
    expect(
      await findCanvasImageTask({ id: 'manual', kind: 'text' })
    ).toBeUndefined();
    expect(taskQueueService.getAllTasks).not.toHaveBeenCalled();
  });

  it('shows audio and text parameters without presenting canvas box size as output dimensions', () => {
    const audio = getCanvasImageDetails(
      { ...image, kind: 'audio', duration: 92 },
      {
        ...task,
        type: TaskType.AUDIO,
        params: { prompt: 'song', mv: 'v5', instrumental: false, tags: 'pop' },
      }
    );
    expect(audio.dimensions).toBeUndefined();
    expect(audio.duration).toBe(92);
    expect(audio.parameters).toContainEqual({
      name: 'instrumental',
      value: 'false',
    });
    const text = getCanvasImageDetails(
      { ...image, kind: 'text' },
      {
        ...task,
        type: TaskType.CHAT,
        params: { prompt: 'story', temperature: 0, max_tokens: 2048 },
      }
    );
    expect(text.dimensions).toBeUndefined();
    expect(text.parameters).toContainEqual({
      name: 'max_tokens',
      value: '2048',
    });
  });
  it('uses the bound task even when the result URL has changed', async () => {
    vi.mocked(taskQueueService.getCompleteTask).mockResolvedValue(task);
    expect(
      await findCanvasImageTask({ ...image, generationTaskId: ' task ' })
    ).toBe(task);
    expect(taskQueueService.getCompleteTask).toHaveBeenCalledWith('task');
    expect(taskQueueService.findImageTaskByResultUrl).not.toHaveBeenCalled();
  });

  it.each([undefined, { ...task, type: TaskType.VIDEO }])(
    'falls back to URL for a missing or non-image bound task',
    async (bound) => {
      vi.mocked(taskQueueService.getCompleteTask).mockResolvedValue(bound);
      vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
        task
      );
      expect(
        await findCanvasImageTask({ ...image, generationTaskId: 'old-task' })
      ).toBe(task);
      expect(taskQueueService.findImageTaskByResultUrl).toHaveBeenCalledWith(
        image.url
      );
    }
  );

  it('looks up legacy images by URL', async () => {
    vi.mocked(taskQueueService.findImageTaskByResultUrl).mockResolvedValue(
      task
    );
    expect(await findCanvasImageTask(image)).toBe(task);
    expect(taskQueueService.getCompleteTask).not.toHaveBeenCalled();
  });

  it('keeps lookup errors distinct from missing records', async () => {
    vi.mocked(taskQueueService.getCompleteTask).mockRejectedValue(
      new Error('storage failed')
    );
    await expect(
      findCanvasImageTask({ ...image, generationTaskId: 'task' })
    ).rejects.toThrow('storage failed');
    expect(taskQueueService.findImageTaskByResultUrl).not.toHaveBeenCalled();
  });

  it('does not infer generation metadata for uploaded images', () => {
    const details = getCanvasImageDetails({
      ...image,
      prompt: 'Recorded canvas prompt',
    });
    expect(details).toMatchObject({
      createdAt: undefined,
      completedAt: undefined,
      model: undefined,
      prompt: 'Recorded canvas prompt',
      dimensions: '1024 × 1536 px',
      parameters: [],
    });
  });

  it('shows recorded settings including zero/false and removes private fields recursively', () => {
    const details = getCanvasImageDetails(image, {
      ...task,
      params: {
        ...task.params,
        seed: 0,
        size: '3x4',
        apiKey: 'private-top-level',
        params: {
          imageSize: '4K',
          quality: 'standard',
          enabled: false,
          api_key: 'private-nested',
          Authorization: 'private-auth',
          options: { steps: 30, token: 'private-token' },
          referenceImages: ['private-image'],
          url: 'https://private.test',
        },
      },
    });
    expect(details.parameters).toEqual(
      expect.arrayContaining([
        { name: 'seed', value: '0' },
        { name: 'enabled', value: 'false' },
        { name: 'imageSize', value: '4K' },
        { name: 'options', value: '{"steps":30}' },
      ])
    );
    expect(JSON.stringify(details)).not.toContain('private-');
    expect(details.createdAt).toBe(task.createdAt);
    expect(details.completedAt).toBe(task.completedAt);
    expect(details.model).toBe('original-model');
  });
});
