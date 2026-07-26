import { describe, expect, it } from 'vitest';
import {
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import {
  formatTaskErrorMessage,
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
  describe('formatTaskErrorMessage', () => {
    it('replaces a persisted HTML 404 page with a concise retry message', () => {
      expect(
        formatTaskErrorMessage(
          '视频生成提交失败: 404 - <!DOCTYPE html><html><title>Page not found</title></html>'
        )
      ).toBe(
        '视频生成提交失败: 404 - 视频 API 端点不存在，请刷新页面后重试'
      );
    });

    it('keeps ordinary provider errors unchanged', () => {
      expect(formatTaskErrorMessage('账户额度不足')).toBe('账户额度不足');
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
