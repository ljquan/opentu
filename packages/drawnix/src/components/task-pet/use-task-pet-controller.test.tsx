// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskStatus,
  TaskType,
  type Task,
  type TaskEvent,
} from '../../types/task.types';
import type { TaskPetSettings } from '../../utils/settings-manager';
import { useTaskPetController } from './use-task-pet-controller';

const mocks = vi.hoisted(() => ({
  useSharedTaskState: vi.fn(),
  observeTaskUpdates: vi.fn(),
  speak: vi.fn(),
}));

vi.mock('../../hooks/useTaskQueue', () => ({
  useSharedTaskState: mocks.useSharedTaskState,
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: { observeTaskUpdates: mocks.observeTaskUpdates },
}));

vi.mock('./task-pet-speech', () => ({
  speakTaskPetMessage: mocks.speak,
}));

const SETTINGS: TaskPetSettings = {
  version: 1,
  enabled: true,
  motionEnabled: true,
  speechEnabled: true,
  taskTypes: { text: true, image: true, video: true },
};

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: { prompt: '' },
    createdAt: 1,
    updatedAt: 2,
    startedAt: 2,
    ...overrides,
  };
}

describe('useTaskPetController', () => {
  let emit: (event: TaskEvent) => void = () => undefined;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.useSharedTaskState.mockReturnValue({ tasks: [], isLoading: false });
    mocks.observeTaskUpdates.mockReturnValue({
      subscribe: (listener: (event: TaskEvent) => void) => {
        emit = listener;
        return { unsubscribe };
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows an initial active snapshot without speaking history', () => {
    mocks.useSharedTaskState.mockReturnValue({
      tasks: [createTask({ type: TaskType.VIDEO })],
      isLoading: false,
    });
    const { result, unmount } = renderHook(() =>
      useTaskPetController(SETTINGS)
    );

    expect(result.current).toMatchObject({
      state: 'running',
      message: '视频任务正在处理',
      activeCount: 1,
    });
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(mocks.observeTaskUpdates).toHaveBeenCalledOnce();
    unmount();
  });

  it('aggregates a terminal event and ignores a duplicate event for the run', () => {
    const completed = createTask({ status: TaskStatus.COMPLETED });
    const { result } = renderHook(() => useTaskPetController(SETTINGS));

    act(() => {
      emit({ type: 'taskUpdated', task: completed, timestamp: 3 });
      emit({ type: 'taskCompleted', task: completed, timestamp: 4 });
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toMatchObject({
      state: 'jumping',
      message: '生图任务已完成',
    });
    expect(mocks.speak).toHaveBeenCalledOnce();
  });

  it('does not subscribe while disabled and unsubscribes when disabled later', () => {
    const { rerender } = renderHook(
      ({ settings }) => useTaskPetController(settings),
      { initialProps: { settings: SETTINGS } }
    );
    expect(mocks.observeTaskUpdates).toHaveBeenCalledOnce();

    rerender({ settings: { ...SETTINGS, enabled: false } });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not subscribe when every task type is disabled', () => {
    const { result } = renderHook(() =>
      useTaskPetController({
        ...SETTINGS,
        taskTypes: { text: false, image: false, video: false },
      })
    );

    expect(result.current).toEqual({
      state: 'idle',
      message: '',
      activeCount: 0,
    });
    expect(mocks.observeTaskUpdates).not.toHaveBeenCalled();
  });
});
