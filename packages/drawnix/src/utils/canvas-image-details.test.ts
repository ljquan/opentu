import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskQueueService } from '../services/task-queue';
import { TaskStatus, TaskType, type Task } from '../types/task.types';
import {
  findCanvasImageTask,
  getCanvasImageDetails,
} from './canvas-image-details';

vi.mock('../services/task-queue', () => ({
  taskQueueService: {
    getCompleteTask: vi.fn(),
    findImageTaskByResultUrl: vi.fn(),
  },
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
