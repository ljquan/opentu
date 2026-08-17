import { describe, expect, it } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
  type TaskEvent,
} from '../../types/task.types';
import type { TaskPetSettings } from '../../utils/settings-manager';
import { TaskPetCoordinator, getTaskPetCategory } from './task-pet-coordinator';

const ALL_TASK_TYPES: TaskPetSettings['taskTypes'] = {
  text: true,
  image: true,
  video: true,
};

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: { prompt: '' },
    createdAt: 1,
    updatedAt: 1,
    startedAt: 10,
    ...overrides,
  };
}

function createEvent(task: Task, type: TaskEvent['type'] = 'taskUpdated') {
  return { type, task, timestamp: task.updatedAt } satisfies TaskEvent;
}

describe('TaskPetCoordinator', () => {
  it('maps CHAT, IMAGE and VIDEO while filtering disabled and unsupported types', () => {
    expect(getTaskPetCategory(TaskType.CHAT)).toBe('text');
    expect(getTaskPetCategory(TaskType.IMAGE)).toBe('image');
    expect(getTaskPetCategory(TaskType.VIDEO)).toBe('video');
    expect(getTaskPetCategory(TaskType.AUDIO)).toBeNull();

    const coordinator = new TaskPetCoordinator({
      text: false,
      image: true,
      video: false,
    });
    expect(
      coordinator.handleEvent(createEvent(createTask({ type: TaskType.CHAT })))
        .presentation
    ).toBeUndefined();
    expect(
      coordinator.handleEvent(createEvent(createTask({ type: TaskType.IMAGE })))
        .presentation?.state
    ).toBe('running');
  });

  it('initializes from active tasks without creating speech and uses the latest phase', () => {
    const coordinator = new TaskPetCoordinator(ALL_TASK_TYPES);
    const presentation = coordinator.initialize([
      createTask({
        id: 'older',
        updatedAt: 10,
        executionPhase: TaskExecutionPhase.POLLING,
      }),
      createTask({
        id: 'newer',
        type: TaskType.VIDEO,
        updatedAt: 20,
        executionPhase: TaskExecutionPhase.DOWNLOADING,
      }),
      createTask({ id: 'history', status: TaskStatus.COMPLETED }),
    ]);

    expect(presentation).toEqual({
      state: 'review',
      message: '视频任务正在检查结果',
      activeCount: 2,
    });
  });

  it('deduplicates progress inside a fixed bucket and reacts to phase changes', () => {
    const coordinator = new TaskPetCoordinator(ALL_TASK_TYPES);
    const first = createTask({ progress: 26 });
    expect(
      coordinator.handleEvent(createEvent(first)).presentation
    ).toMatchObject({
      state: 'running',
      message: '生图任务处理中 25%',
      speechText: '生图任务已开始',
    });

    expect(
      coordinator.handleEvent(
        createEvent(createTask({ progress: 49, updatedAt: 2 }))
      ).presentation
    ).toBeUndefined();
    expect(
      coordinator.handleEvent(
        createEvent(
          createTask({
            progress: 50,
            updatedAt: 3,
            executionPhase: TaskExecutionPhase.POLLING,
          })
        )
      ).presentation
    ).toMatchObject({ state: 'waiting' });
  });

  it('aggregates terminal states from task.status and deduplicates the same run', () => {
    const coordinator = new TaskPetCoordinator(ALL_TASK_TYPES);
    const completed = createTask({ status: TaskStatus.COMPLETED });
    const failed = createTask({
      id: 'task-2',
      type: TaskType.VIDEO,
      status: TaskStatus.FAILED,
      startedAt: 20,
    });

    expect(
      coordinator.handleEvent(createEvent(completed)).terminalPending
    ).toBe(true);
    expect(
      coordinator.handleEvent(createEvent(completed, 'taskCompleted'))
        .terminalPending
    ).toBe(false);
    expect(
      coordinator.handleEvent(createEvent(failed, 'taskUpdated'))
        .terminalPending
    ).toBe(true);
    expect(coordinator.flushTerminalAggregate()).toMatchObject({
      state: 'failed',
      message: '1 个任务完成，1 个任务失败',
      speechText: '1 个任务完成，1 个任务失败',
    });
  });

  it('treats a retry with a new startedAt as a new run', () => {
    const coordinator = new TaskPetCoordinator(ALL_TASK_TYPES);
    const firstRun = createTask({
      status: TaskStatus.COMPLETED,
      startedAt: 10,
    });
    const retryRun = createTask({
      status: TaskStatus.COMPLETED,
      startedAt: 11,
    });

    expect(coordinator.handleEvent(createEvent(firstRun)).terminalPending).toBe(
      true
    );
    coordinator.flushTerminalAggregate();
    expect(coordinator.handleEvent(createEvent(retryRun)).terminalPending).toBe(
      true
    );
    expect(coordinator.flushTerminalAggregate()?.message).toBe(
      '生图任务已完成'
    );
  });

  it('cleans cancelled tasks and bounds active and terminal records', () => {
    const coordinator = new TaskPetCoordinator(ALL_TASK_TYPES, 2, 2);
    const tasks = [1, 2, 3].map((index) =>
      createTask({ id: `task-${index}`, startedAt: index, updatedAt: index })
    );
    expect(coordinator.initialize(tasks).activeCount).toBe(2);

    const cancelled = createTask({
      id: 'task-3',
      startedAt: 3,
      status: TaskStatus.CANCELLED,
    });
    expect(
      coordinator.handleEvent(createEvent(cancelled)).presentation?.activeCount
    ).toBe(1);

    tasks.forEach((task) => {
      coordinator.handleEvent(
        createEvent({ ...task, status: TaskStatus.COMPLETED })
      );
    });
    coordinator.flushTerminalAggregate();

    expect(
      coordinator.handleEvent(
        createEvent({ ...tasks[0], status: TaskStatus.COMPLETED })
      ).terminalPending
    ).toBe(true);
  });
});
