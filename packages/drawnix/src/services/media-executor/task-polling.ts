/**
 * Task Polling Utility
 *
 * 轮询 IndexedDB 等待任务完成。
 * 用于主线程工作流引擎等待 SW/降级执行器完成任务。
 */

import { taskStorageReader } from '../task-storage-reader';
import type { Task, TaskStatus } from '../../types/task.types';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';

/**
 * 轮询选项
 */
export interface PollingOptions {
  /** 轮询间隔（毫秒），默认 1000 */
  interval?: number;
  /** 最大等待时间（毫秒），默认 15 分钟 */
  timeout?: number;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 当前执行实例是否仍拥有该任务 */
  isCurrentAttempt?: () => boolean;
  /** 进度回调 */
  onProgress?: (task: Task) => void;
}

/**
 * 轮询结果
 */
export interface PollingResult {
  success: boolean;
  task?: Task;
  error?: string;
}

/**
 * 等待任务完成
 *
 * 轮询 IndexedDB 直到任务完成、失败或超时。
 *
 * @param taskId 任务 ID
 * @param options 轮询选项
 * @returns 轮询结果
 */
export async function waitForTaskCompletion(
  taskId: string,
  options: PollingOptions = {}
): Promise<PollingResult> {
  const {
    interval = 1000,
    timeout = IMAGE_GENERATION_TIMEOUT_MS,
    signal,
    isCurrentAttempt,
    onProgress,
  } = options;

  const startTime = Date.now();

  return new Promise((resolve) => {
    const poll = async () => {
      // 检查是否已取消
      if (signal?.aborted || isCurrentAttempt?.() === false) {
        resolve({ success: false, error: 'Polling cancelled' });
        return;
      }

      // 检查是否超时
      if (Date.now() - startTime > timeout) {
        resolve({ success: false, error: 'Polling timeout' });
        return;
      }

      try {
        // 清除缓存以获取最新数据
        taskStorageReader.invalidateCache();

        // 获取任务状态
        const task = await taskStorageReader.getTask(taskId);
        if (signal?.aborted || isCurrentAttempt?.() === false) {
          resolve({ success: false, error: 'Polling cancelled' });
          return;
        }

        if (!task) {
          // 任务不存在，继续等待（可能还在创建中）
          setTimeout(poll, interval);
          return;
        }

        // 回调进度
        onProgress?.(task);

        // 检查终态
        if (task.status === 'completed') {
          resolve({ success: true, task });
          return;
        }

        if (task.status === 'failed') {
          resolve({
            success: false,
            task,
            error: task.error?.message || 'Task failed',
          });
          return;
        }

        if (task.status === 'cancelled') {
          resolve({ success: false, task, error: 'Task cancelled' });
          return;
        }

        // 继续轮询
        setTimeout(poll, interval);
      } catch (error: any) {
        // 读取失败，继续重试
        console.error('[TaskPolling] Error reading task:', error);
        setTimeout(poll, interval);
      }
    };

    // 开始轮询
    poll();
  });
}

/**
 * 等待多个任务完成
 *
 * 并行轮询多个任务，返回所有任务的结果。
 *
 * @param taskIds 任务 ID 列表
 * @param options 轮询选项
 * @returns 所有任务的轮询结果
 */
export async function waitForTasksCompletion(
  taskIds: string[],
  options: PollingOptions = {}
): Promise<Map<string, PollingResult>> {
  const results = new Map<string, PollingResult>();

  await Promise.all(
    taskIds.map(async (taskId) => {
      const result = await waitForTaskCompletion(taskId, options);
      results.set(taskId, result);
    })
  );

  return results;
}

/**
 * 创建任务状态观察器
 *
 * 返回一个可以随时检查任务状态的函数。
 * 用于需要手动控制轮询时机的场景。
 *
 * @param taskId 任务 ID
 * @returns 获取任务状态的函数
 */
export function createTaskObserver(taskId: string): () => Promise<Task | null> {
  return async () => {
    taskStorageReader.invalidateCache();
    return taskStorageReader.getTask(taskId);
  };
}

/**
 * 检查任务是否完成（终态）
 */
export function isTaskTerminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
