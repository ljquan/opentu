/**
 * useTaskQueue Hook
 * 
 * Provides React components with task queue state and operations.
 * Subscribes to task updates and provides memoized selectors.
 */

import { useEffect, useCallback } from 'react';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { getDefaultStore } from 'jotai/vanilla';
import { taskQueueService } from '../services/task-queue';
import { taskStorageReader } from '../services/task-storage-reader';
import { Task, TaskStatus, TaskType, TaskEvent, GenerationParams } from '../types/task.types';
import { STORAGE_LIMITS } from '../constants/TASK_CONSTANTS';

/**
 * Return type for useTaskQueue hook
 */
export interface UseTaskQueueReturn {
  /** All tasks in the queue */
  tasks: Task[];
  /** Tasks that are pending, processing, or retrying */
  activeTasks: Task[];
  /** Successfully completed tasks */
  completedTasks: Task[];
  /** Failed tasks */
  failedTasks: Task[];
  /** Cancelled tasks */
  cancelledTasks: Task[];
  /** Whether data is being loaded from SW */
  isLoading: boolean;
  /** Whether more tasks are being loaded */
  isLoadingMore: boolean;
  /** Whether there are more tasks to load */
  hasMore: boolean;
  /** Total count of tasks in SW */
  totalCount: number;
  /** Loaded count of tasks */
  loadedCount: number;
  /** Load more tasks (pagination) */
  loadMore: () => Promise<void>;
  /** Creates a new task */
  createTask: (params: GenerationParams, type: TaskType) => Task | null;
  /** Cancels a task */
  cancelTask: (taskId: string) => void;
  /** Retries a failed task */
  retryTask: (taskId: string) => void;
  /** Deletes a task */
  deleteTask: (taskId: string) => void;
  /** Clears all completed tasks */
  clearCompleted: () => void;
  /** Clears all failed tasks */
  clearFailed: () => void;
  /** Gets a specific task by ID */
  getTask: (taskId: string) => Task | undefined;
  /** Batch delete multiple tasks */
  batchDeleteTasks: (taskIds: string[]) => void;
  /** Batch retry multiple failed tasks */
  batchRetryTasks: (taskIds: string[]) => void;
  /** Batch cancel multiple active tasks */
  batchCancelTasks: (taskIds: string[]) => void;
}

const tasksAtom = atom<Task[]>([]);
const isLoadingAtom = atom(true);
const activeTasksAtom = atom((get) =>
  get(tasksAtom).filter(
    (task) => task.status === TaskStatus.PENDING || task.status === TaskStatus.PROCESSING
  )
);
const completedTasksAtom = atom((get) =>
  get(tasksAtom).filter((task) => task.status === TaskStatus.COMPLETED)
);
const failedTasksAtom = atom((get) =>
  get(tasksAtom).filter((task) => task.status === TaskStatus.FAILED)
);
const cancelledTasksAtom = atom((get) =>
  get(tasksAtom).filter((task) => task.status === TaskStatus.CANCELLED)
);
const totalCountAtom = atom((get) => get(tasksAtom).length);
const loadedCountAtom = atom((get) => get(tasksAtom).length);
const createTaskAtom = atom(
  null,
  (_get, set, payload: { params: GenerationParams; type: TaskType }): Task | null => {
    try {
      const task = taskQueueService.createTask(payload.params, payload.type);
      set(tasksAtom, taskQueueService.getAllTasks());
      set(isLoadingAtom, false);
      return task;
    } catch {
      return null;
    }
  }
);
const cancelTaskAtom = atom(null, (_get, set, taskId: string) => {
  taskQueueService.cancelTask(taskId);
  set(tasksAtom, taskQueueService.getAllTasks());
  set(isLoadingAtom, false);
});
const retryTaskAtom = atom(null, (_get, set, taskId: string) => {
  taskQueueService.retryTask(taskId);
  set(tasksAtom, taskQueueService.getAllTasks());
  set(isLoadingAtom, false);
});
const deleteTaskAtom = atom(null, (_get, set, taskId: string) => {
  taskQueueService.deleteTask(taskId);
  set(tasksAtom, taskQueueService.getAllTasks());
  set(isLoadingAtom, false);
});
const clearCompletedAtom = atom(null, (_get, set) => {
  taskQueueService.clearCompletedTasks();
  set(tasksAtom, taskQueueService.getAllTasks());
  set(isLoadingAtom, false);
});
const clearFailedAtom = atom(null, (_get, set) => {
  taskQueueService.clearFailedTasks();
  set(tasksAtom, taskQueueService.getAllTasks());
  set(isLoadingAtom, false);
});

let taskStateSyncStarted = false;
let taskStateDbFallbackStarted = false;
const taskStateStore = getDefaultStore();

/**
 * 增量更新 atom store，避免每次事件都全量拷贝
 */
function applyTaskEvent(event: TaskEvent) {
  const current = taskStateStore.get(tasksAtom);
  let updated: Task[];

  switch (event.type) {
    case 'taskCreated':
      // 避免重复
      if (current.some(t => t.id === event.task.id)) {
        updated = current.map(t => t.id === event.task.id ? event.task : t);
      } else {
        updated = [event.task, ...current];
      }
      break;
    case 'taskDeleted':
      updated = current.filter(t => t.id !== event.task.id);
      break;
    default:
      // taskUpdated, taskStatus, taskCompleted, taskFailed, taskSynced
      updated = current.map(t => t.id === event.task.id ? event.task : t);
      break;
  }

  taskStateStore.set(tasksAtom, updated);
  taskStateStore.set(isLoadingAtom, false);
}

function syncTasksToAtomStore() {
  const allTasks = taskQueueService.getAllTasks();
  taskStateStore.set(tasksAtom, allTasks);
  taskStateStore.set(isLoadingAtom, false);
}

async function loadTasksFromStorageFallback() {
  await new Promise((resolve) => setTimeout(resolve, 500));

  const memoryTasks = taskQueueService.getAllTasks();
  if (memoryTasks.length > 0) {
    syncTasksToAtomStore();
    return;
  }

  const isAvailable = await taskStorageReader.isAvailable();
  if (!isAvailable) {
    taskStateStore.set(isLoadingAtom, false);
    return;
  }

  // 限制恢复数量，避免内存溢出
  const storedTasks = await taskStorageReader.getAllTasks({
    limit: STORAGE_LIMITS.MAX_RETAINED_TASKS,
  });
  if (storedTasks.length > 0) {
    taskQueueService.restoreTasks(storedTasks);
  }
  syncTasksToAtomStore();
}

export function ensureTaskStateSyncStarted() {
  if (taskStateSyncStarted) {
    return;
  }

  taskStateSyncStarted = true;

  const currentTasks = taskQueueService.getAllTasks();
  taskStateStore.set(tasksAtom, currentTasks);
  taskStateStore.set(isLoadingAtom, currentTasks.length === 0);

  taskQueueService.observeTaskUpdates().subscribe((event) => {
    applyTaskEvent(event);
  });

  if (currentTasks.length === 0 && !taskStateDbFallbackStarted) {
    taskStateDbFallbackStarted = true;
    loadTasksFromStorageFallback().catch(() => {
      taskStateStore.set(isLoadingAtom, false);
    });
  }
}

export function useSharedTaskState() {
  useEffect(() => {
    ensureTaskStateSyncStarted();
  }, []);

  const tasks = useAtomValue(tasksAtom);
  const isLoading = useAtomValue(isLoadingAtom);

  return {
    tasks,
    isLoading,
  };
}

export function useTaskActions() {
  const create = useSetAtom(createTaskAtom);
  const cancel = useSetAtom(cancelTaskAtom);
  const retry = useSetAtom(retryTaskAtom);
  const remove = useSetAtom(deleteTaskAtom);
  const clearCompleted = useSetAtom(clearCompletedAtom);
  const clearFailed = useSetAtom(clearFailedAtom);

  const createTask = useCallback(
    (params: GenerationParams, type: TaskType) => create({ params, type }),
    [create]
  );
  const cancelTask = useCallback((taskId: string) => cancel(taskId), [cancel]);
  const retryTask = useCallback((taskId: string) => retry(taskId), [retry]);
  const deleteTask = useCallback((taskId: string) => remove(taskId), [remove]);
  const clearCompletedTasks = useCallback(() => clearCompleted(), [clearCompleted]);
  const clearFailedTasks = useCallback(() => clearFailed(), [clearFailed]);

  return {
    createTask,
    cancelTask,
    retryTask,
    deleteTask,
    clearCompletedTasks,
    clearFailedTasks,
  };
}

/**
 * Hook for managing task queue state and operations
 * 
 * @example
 * function TaskManager() {
 *   const { tasks, createTask, cancelTask } = useTaskQueue();
 *   
 *   const handleCreate = () => {
 *     createTask({ prompt: "cat" }, 'image');
 *   };
 *   
 *   return (
 *     <div>
 *       <button onClick={handleCreate}>Create Task</button>
 *       {tasks.map(task => (
 *         <div key={task.id}>{task.params.prompt}</div>
 *       ))}
 *     </div>
 *   );
 * }
 */
export function useTaskQueue(): UseTaskQueueReturn {
  const { tasks, isLoading } = useSharedTaskState();
  const activeTasks = useAtomValue(activeTasksAtom);
  const completedTasks = useAtomValue(completedTasksAtom);
  const failedTasks = useAtomValue(failedTasksAtom);
  const cancelledTasks = useAtomValue(cancelledTasksAtom);
  const totalCount = useAtomValue(totalCountAtom);
  const loadedCount = useAtomValue(loadedCountAtom);
  const isLoadingMore = false;
  const hasMore = false;
  const {
    createTask,
    cancelTask,
    retryTask,
    deleteTask,
    clearCompletedTasks,
    clearFailedTasks,
  } = useTaskActions();

  // 加载更多任务（不再需要 SW 分页，直接返回）
  const loadMore = useCallback(async () => {
    // All tasks loaded from IndexedDB on mount, no pagination needed
  }, []);

  // 注意：任务状态更新主要依赖 SW 的广播事件
  // visibility 监听器会在页面变为可见时同步第一页
  // 不再使用轮询，避免重置分页状态和内存问题

  const getTask = useCallback((taskId: string) => {
    return taskQueueService.getTask(taskId);
  }, []);

  const batchDeleteTasks = useCallback((taskIds: string[]) => {
    taskIds.forEach(taskId => {
      deleteTask(taskId);
    });
  }, [deleteTask]);

  const batchRetryTasks = useCallback((taskIds: string[]) => {
    taskIds.forEach(taskId => {
      retryTask(taskId);
    });
  }, [retryTask]);

  const batchCancelTasks = useCallback((taskIds: string[]) => {
    taskIds.forEach(taskId => {
      cancelTask(taskId);
    });
  }, [cancelTask]);

  return {
    tasks,
    activeTasks,
    completedTasks,
    failedTasks,
    cancelledTasks,
    isLoading,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    createTask,
    cancelTask,
    retryTask,
    deleteTask,
    clearCompleted: clearCompletedTasks,
    clearFailed: clearFailedTasks,
    getTask,
    batchDeleteTasks,
    batchRetryTasks,
    batchCancelTasks,
  };
}
