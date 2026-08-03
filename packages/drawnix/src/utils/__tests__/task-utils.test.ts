import { describe, expect, it } from 'vitest';
import {
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import {
  formatImageTaskResultSize,
  isResumableAsyncImageTask,
} from '../task-utils';

function createImageTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: {
      prompt: 'draw a cat',
      model: 'custom-dynamic-image-model',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('task-utils', () => {
  describe('formatImageTaskResultSize', () => {
    it('uses only provider result dimensions', () => {
      const task = createImageTask({
        status: TaskStatus.COMPLETED,
        params: {
          prompt: 'draw a cat',
          width: 1024,
          height: 1024,
        },
        result: {
          url: 'https://example.com/cat.png',
          format: 'png',
          size: 0,
          width: 1024,
          height: 1536,
        },
      });

      expect(formatImageTaskResultSize(task)).toBe('1024×1536');
    });

    it('shows unknown dimensions without falling back to request params', () => {
      const task = createImageTask({
        status: TaskStatus.COMPLETED,
        params: {
          prompt: 'draw a cat',
          width: 1024,
          height: 1024,
        },
        result: {
          url: 'https://example.com/cat.png',
          format: 'png',
          size: 0,
        },
      });

      expect(formatImageTaskResultSize(task)).toBe('未知尺寸');
    });

    it('formats each batch task with its own result dimensions', () => {
      const portraitTask = createImageTask({
        id: 'batch-task-1',
        status: TaskStatus.COMPLETED,
        result: {
          url: 'https://example.com/portrait.png',
          format: 'png',
          size: 0,
          width: 1024,
          height: 1536,
        },
      });
      const landscapeTask = createImageTask({
        id: 'batch-task-2',
        status: TaskStatus.COMPLETED,
        result: {
          url: 'https://example.com/landscape.png',
          format: 'png',
          size: 0,
          width: 1536,
          height: 1024,
        },
      });

      expect(formatImageTaskResultSize(portraitTask)).toBe('1024×1536');
      expect(formatImageTaskResultSize(landscapeTask)).toBe('1536×1024');
    });

    it('does not display a result size before image completion', () => {
      const task = createImageTask({
        result: {
          url: 'https://example.com/cat.png',
          format: 'png',
          size: 0,
          width: 1024,
          height: 1536,
        },
      });

      expect(formatImageTaskResultSize(task)).toBeNull();
    });
  });

  describe('isResumableAsyncImageTask', () => {
    it('uses persisted async image binding as resumable source of truth', () => {
      const task = createImageTask({
        remoteId: 'remote-task-1',
        invocationRoute: {
          operation: 'image',
          modelId: 'custom-dynamic-image-model',
          binding: {
            protocol: 'openai.async.media',
            requestSchema: 'openai.async.image.form',
            pollPathTemplate: '/videos/{taskId}',
          },
        },
      });

      expect(isResumableAsyncImageTask(task)).toBe(true);
    });

    it('does not resume ordinary image tasks without a remote task id', () => {
      const task = createImageTask({
        invocationRoute: {
          operation: 'image',
          binding: {
            protocol: 'openai.async.media',
            requestSchema: 'openai.async.image.form',
          },
        },
      });

      expect(isResumableAsyncImageTask(task)).toBe(false);
    });

    it('treats any image task with remoteId as resumable', () => {
      const task = createImageTask({
        remoteId: 'remote-task-1',
        invocationRoute: {
          operation: 'image',
          binding: {
            protocol: 'openai.images.generations',
            requestSchema: 'openai.image.basic-json',
          },
        },
      });

      expect(isResumableAsyncImageTask(task)).toBe(true);
    });
  });
});
