/**
 * useFilteredTaskQueue Hook
 * 
 * 用于弹窗中的任务列表，支持按类型过滤和分页加载。
 * 与 useTaskQueue 不同，这个 hook 直接从 SW 查询数据，
 * 支持类型过滤，并且不会影响全局任务缓存。
 */

import { useCallback, useMemo } from 'react';
import { Task, TaskType, isUserVisibleTask } from '../types/task.types';
import { taskQueueService } from '../services/task-queue';
import { taskStorageReader } from '../services/task-storage-reader';
import { useSharedTaskState, ensureTaskStateSyncStarted, useTaskActions } from './useTaskQueue';

export interface UseFilteredTaskQueueOptions {
  /** 任务类型过滤 */
  taskType?: TaskType;
  /** 每页加载数量 */
  pageSize?: number;
}

export interface UseFilteredTaskQueueReturn {
  /** 已加载的任务列表 */
  tasks: Task[];
  /** 是否正在加载初始数据 */
  isLoading: boolean;
  /** 是否正在加载更多 */
  isLoadingMore: boolean;
  /** 是否还有更多数据 */
  hasMore: boolean;
  /** 总任务数 */
  totalCount: number;
  /** 已加载任务数 */
  loadedCount: number;
  /** 加载更多 */
  loadMore: () => Promise<void>;
  /** 刷新数据 */
  refresh: () => Promise<void>;
  /** 重试任务 */
  retryTask: (taskId: string) => void;
  /** 删除任务 */
  deleteTask: (taskId: string) => void;
}

/**
 * 用于弹窗中按类型过滤的任务列表 hook
 */
export function useFilteredTaskQueue(
  options: UseFilteredTaskQueueOptions = {}
): UseFilteredTaskQueueReturn {
  const { taskType } = options;
  const { tasks: allTasks, isLoading } = useSharedTaskState();
  const { retryTask, deleteTask } = useTaskActions();

  const tasks = useMemo(() => {
    const userVisibleTasks = allTasks.filter(isUserVisibleTask);
    const filtered = taskType
      ? userVisibleTasks.filter((task) => task.type === taskType)
      : userVisibleTasks;
    return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
  }, [allTasks, taskType]);

  const loadMore = useCallback(async () => undefined, []);

  const refresh = useCallback(async () => {
    ensureTaskStateSyncStarted();
    const isAvailable = await taskStorageReader.isAvailable();
    if (!isAvailable) {
      return;
    }
    const storedTasks = await taskStorageReader.getAllTasks();
    if (storedTasks.length > 0) {
      taskQueueService.restoreTasks(storedTasks);
    }
  }, []);

  return {
    tasks,
    isLoading,
    isLoadingMore: false,
    hasMore: false,
    totalCount: tasks.length,
    loadedCount: tasks.length,
    loadMore,
    refresh,
    retryTask,
    deleteTask,
  };
}
