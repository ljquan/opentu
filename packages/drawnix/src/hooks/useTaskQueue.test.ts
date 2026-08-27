import { describe, expect, it } from 'vitest';
import {
  isUserVisibleTask,
  TaskStatus,
  TaskType,
  type Task,
} from '../types/task.types';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: { prompt: '页面图' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('isUserVisibleTask', () => {
  it('hides internal tasks before they have a result', () => {
    expect(
      isUserVisibleTask(
        createTask({
          params: { prompt: '页面图', resultVisibility: 'internal' },
        })
      )
    ).toBe(false);
  });

  it('keeps legacy and explicit user tasks visible', () => {
    expect(isUserVisibleTask(createTask())).toBe(true);
    expect(
      isUserVisibleTask(
        createTask({ params: { prompt: '成片', resultVisibility: 'user' } })
      )
    ).toBe(true);
  });
});
