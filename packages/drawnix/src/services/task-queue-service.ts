/**
 * Task Queue Service
 *
 * Core service for managing the task queue lifecycle.
 * Implements singleton pattern and uses RxJS for event-driven architecture.
 *
 * In fallback mode (SW disabled), this service directly writes to IndexedDB
 * via taskStorageWriter to ensure data persistence.
 */

import { Subject, Observable } from 'rxjs';
import {
  Task,
  TaskStatus,
  TaskType,
  TaskEvent,
  GenerationParams,
  TaskExecutionPhase,
} from '../types/task.types';
import { generateTaskId, isTaskActive } from '../utils/task-utils';
import {
  validateGenerationParams,
  sanitizeGenerationParams,
} from '../utils/validation-utils';
import {
  taskStorageWriter,
  type SWTask,
} from './media-executor/task-storage-writer';
import { taskStorageReader } from './task-storage-reader';
import { executorFactory, waitForTaskCompletion } from './media-executor';
import { hasInvocationRouteCredentials } from '../utils/settings-manager';
import { DEFAULT_AUDIO_MODEL_ID } from '../constants/model-config';
import {
  getAdapterContextFromSettings,
  resolveAdapterForInvocation,
} from './model-adapters';

/**
 * Task Queue Service
 * Manages task creation, updates, and lifecycle events
 */
class TaskQueueService {
  private static instance: TaskQueueService;
  private tasks: Map<string, Task>;
  private taskUpdates$: Subject<TaskEvent>;

  private constructor() {
    this.tasks = new Map();
    this.taskUpdates$ = new Subject();
  }

  /**
   * Converts Task to SWTask format for IndexedDB storage
   */
  private convertToSWTask(task: Task): SWTask {
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      params: task.params as SWTask['params'],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      result: task.result,
      error: task.error as any,
      progress: task.progress,
      remoteId: task.remoteId,
      executionPhase: task.executionPhase,
      savedToLibrary: task.savedToLibrary,
      insertedToCanvas: task.insertedToCanvas,
    };
  }

  /**
   * Persist task to IndexedDB (async, fire-and-forget)
   */
  private persistTask(task: Task): void {
    const swTask = this.convertToSWTask(task);
    taskStorageWriter.saveTask(swTask).catch((error) => {
      console.error('[TaskQueueService] Failed to persist task:', error);
    });
    // Invalidate reader cache after write
    taskStorageReader.invalidateCache();
  }

  /**
   * Delete task from IndexedDB (async, fire-and-forget)
   */
  private persistDelete(taskId: string): void {
    taskStorageWriter.deleteTask(taskId).catch((error) => {
      console.error(
        '[TaskQueueService] Failed to delete task from storage:',
        error
      );
    });
    // Invalidate reader cache after delete
    taskStorageReader.invalidateCache();
  }

  /**
   * Execute task using executor (for legacy/fallback mode)
   * This is called automatically after task creation
   */
  private async executeTask(task: Task): Promise<void> {
    try {
      // Check API configuration
      const routeType =
        task.type === TaskType.VIDEO
          ? 'video'
          : task.type === TaskType.AUDIO
          ? 'audio'
          : 'image';
      if (
        !hasInvocationRouteCredentials(
          routeType,
          task.params.modelRef || task.params.model
        )
      ) {
        console.warn(
          '[TaskQueueService] No API configuration, cannot execute task'
        );
        this.updateTaskStatus(task.id, TaskStatus.FAILED, {
          error: { code: 'NO_API_KEY', message: '未配置 API Key' },
        });
        return;
      }

      if (task.type === TaskType.AUDIO) {
        const requestedModel = task.params.model as string | undefined;
        const requestedModelRef = task.params.modelRef || null;
        const adapter = resolveAdapterForInvocation(
          'audio',
          requestedModel || DEFAULT_AUDIO_MODEL_ID,
          requestedModelRef
        );

        if (!adapter || adapter.kind !== 'audio') {
          throw new Error(`No audio adapter for model: ${requestedModel}`);
        }

        const result = await adapter.generateAudio(
          getAdapterContextFromSettings(
            'audio',
            requestedModelRef || requestedModel
          ),
          {
            prompt: task.params.prompt,
            model: requestedModel,
            modelRef: requestedModelRef,
            title: task.params.title,
            tags: task.params.tags,
            mv: task.params.mv,
            sunoAction: task.params.sunoAction,
            notifyHook: task.params.notifyHook,
            continueClipId: task.params.continueClipId,
            continueAt: task.params.continueAt,
            params: {
              ...(task.params as any).params,
              onProgress: (progress: number) => {
                this.updateTaskProgress(task.id, progress);
                this.updateTaskStatus(task.id, TaskStatus.PROCESSING, {
                  executionPhase: TaskExecutionPhase.POLLING,
                });
              },
              onSubmitted: (remoteId: string) => {
                this.updateTaskStatus(task.id, TaskStatus.PROCESSING, {
                  remoteId,
                  executionPhase: TaskExecutionPhase.POLLING,
                });
              },
            },
          }
        );

        const now = Date.now();
        const completedTask: Task = {
          ...(this.tasks.get(task.id) || task),
          status: TaskStatus.COMPLETED,
          progress: 100,
          result: {
            url: result.url,
            urls: result.urls,
            format: result.format || (result.resultKind === 'lyrics' ? 'lyrics' : 'mp3'),
            size: 0,
            resultKind: result.resultKind,
            duration:
              typeof result.duration === 'number' ? result.duration : undefined,
            previewImageUrl: result.imageUrl,
            title: result.title,
            lyricsText: result.lyricsText,
            lyricsTitle: result.lyricsTitle,
            lyricsTags: result.lyricsTags,
            providerTaskId: result.providerTaskId || task.remoteId,
            primaryClipId: result.primaryClipId,
            clipIds: result.clipIds,
            clips: result.clips,
          },
          executionPhase: undefined,
          completedAt: now,
          updatedAt: now,
        };
        this.tasks.set(task.id, completedTask);
        this.persistTask(completedTask);
        this.emitEvent('taskUpdated', completedTask);
        return;
      }

      // Get executor
      const executor = await executorFactory.getExecutor();

      // 实时进度回调：executor 执行期间同步更新内存中的 task 状态
      // 注意：必须创建新对象存入 Map，不能原地修改旧对象
      // 否则 useTaskQueue 通过 getAllTasks() 获取的对象引用不变，
      // React.memo 比较 prev.task.progress === next.task.progress 时永远相等
      const executionOptions = {
        onProgress: (progress: { progress: number; phase?: string }) => {
          const localTask = this.tasks.get(task.id);
          if (localTask) {
            const updatedTask: Task = {
              ...localTask,
              progress: progress.progress,
              updatedAt: Date.now(),
              ...(progress.phase && {
                executionPhase: progress.phase as Task['executionPhase'],
              }),
            };
            this.tasks.set(task.id, updatedTask);
            this.emitEvent('taskUpdated', updatedTask);
          }
        },
      };

      // Execute based on task type
      switch (task.type) {
        case TaskType.IMAGE: {
          // 从 params.params 中提取额外参数（如 quality）
          const extraParams = (task.params as any).params || {};
          await executor.generateImage(
            {
              taskId: task.id,
              prompt: task.params.prompt,
              model: task.params.model,
              modelRef: task.params.modelRef || null,
              size: task.params.size,
              referenceImages: task.params.referenceImages as
                | string[]
                | undefined,
              count: task.params.count as number | undefined,
              uploadedImages: task.params.uploadedImages as
                | Array<{ url?: string }>
                | undefined,
              quality: extraParams.quality as '1k' | '2k' | '4k' | undefined,
              params: extraParams,
            },
            executionOptions
          );
          break;
        }
        case TaskType.VIDEO: {
          // 从 uploadedImages（UI 层传入的 UploadedVideoImage[]）中提取 URL
          const uploaded = task.params.uploadedImages as
            | Array<{ url?: string }>
            | undefined;
          const uploadedUrls = uploaded
            ?.map((img) => img.url)
            .filter((url): url is string => !!url);
          // 兼容旧字段 referenceImages / inputReference
          const refImages = task.params.referenceImages as string[] | undefined;
          const inputRef = (task.params as { inputReference?: string })
            .inputReference;
          const finalRefs =
            uploadedUrls && uploadedUrls.length > 0
              ? uploadedUrls
              : refImages && refImages.length > 0
              ? refImages
              : inputRef
              ? [inputRef]
              : undefined;
          await executor.generateVideo(
            {
              taskId: task.id,
              prompt: task.params.prompt,
              model: task.params.model,
              modelRef: task.params.modelRef || null,
              duration: (
                task.params.duration ?? task.params.seconds
              )?.toString(),
              size: task.params.size,
              referenceImages: finalRefs,
              params: (task.params as any).params,
            },
            executionOptions
          );
          break;
        }
        default:
          throw new Error(`Unsupported task type: ${task.type}`);
      }

      // Poll for task completion (executor 已完成，此处主要是从 IndexedDB 读取最终结果)
      const result = await waitForTaskCompletion(task.id, {
        timeout: 10 * 60 * 1000, // 10 minutes
        onProgress: (updatedTask) => {
          // Update local state with progress
          // 注意：同时同步 result/error/completedAt，避免 status=completed 但 result 为空的中间状态
          // 创建新对象存入 Map，确保 React 能检测到引用变化
          const localTask = this.tasks.get(task.id);
          if (localTask) {
            const newTask: Task = {
              ...localTask,
              status: updatedTask.status as TaskStatus,
              progress: updatedTask.progress,
              updatedAt: Date.now(),
              ...(updatedTask.result && { result: updatedTask.result }),
              ...(updatedTask.error && { error: updatedTask.error }),
              ...(updatedTask.completedAt && {
                completedAt: updatedTask.completedAt,
              }),
            };
            this.tasks.set(task.id, newTask);
            this.emitEvent('taskUpdated', newTask);
          }
        },
      });

      // Update final state & persist
      const localTask = this.tasks.get(task.id);
      if (localTask && result.task) {
        const finalTask: Task = {
          ...localTask,
          status: result.task.status as TaskStatus,
          result: result.task.result,
          error: result.task.error,
          completedAt: result.task.completedAt,
          updatedAt: Date.now(),
        };
        this.tasks.set(task.id, finalTask);

        // Persist final state
        this.persistTask(finalTask);
        this.emitEvent('taskUpdated', finalTask);
      }
    } catch (error: any) {
      console.error('[TaskQueueService] Task execution failed:', error);
      const localTask = this.tasks.get(task.id);
      if (localTask) {
        const now = Date.now();
        const failedTask: Task = {
          ...localTask,
          status: TaskStatus.FAILED,
          error: {
            code: 'EXECUTION_ERROR',
            message: error.message || 'Task execution failed',
          },
          updatedAt: now,
          completedAt: now,
          progress: undefined,
        };
        this.tasks.set(task.id, failedTask);
        this.persistTask(failedTask);
        this.emitEvent('taskUpdated', failedTask);
      }
    }
  }

  /**
   * Gets the singleton instance of TaskQueueService
   */
  static getInstance(): TaskQueueService {
    if (!TaskQueueService.instance) {
      TaskQueueService.instance = new TaskQueueService();
    }
    return TaskQueueService.instance;
  }

  /**
   * Creates a new task and adds it to the queue
   *
   * @param params - Generation parameters
   * @param type - Task type (image or video)
   * @returns The created task
   * @throws Error if validation fails
   */
  createTask(params: GenerationParams, type: TaskType): Task {
    // Validate parameters
    const validation = validateGenerationParams(params, type);
    if (!validation.valid) {
      throw new Error(`Invalid parameters: ${validation.errors.join(', ')}`);
    }

    // Sanitize parameters
    const sanitizedParams = sanitizeGenerationParams(params);

    // Create new task - starts as PROCESSING since it will be executed immediately
    const now = Date.now();
    const task: Task = {
      id: generateTaskId(),
      type,
      status: TaskStatus.PROCESSING,
      params: sanitizedParams,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      executionPhase: TaskExecutionPhase.SUBMITTING,
      // Initialize progress for video tasks
      ...((type === TaskType.VIDEO || type === TaskType.AUDIO) && {
        progress: 0,
      }),
    };

    // Add to queue
    this.tasks.set(task.id, task);

    // Persist to IndexedDB
    this.persistTask(task);

    // Emit event
    this.emitEvent('taskCreated', task);

    // Execute task asynchronously (fire-and-forget)
    this.executeTask(task).catch((error) => {
      console.error('[TaskQueueService] Task execution error:', error);
    });

    // console.log(`[TaskQueueService] Created task ${task.id} (${type})`);
    return task;
  }

  /**
   * Updates a task's status
   *
   * @param taskId - The task ID
   * @param status - New status
   * @param updates - Additional fields to update
   */
  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    updates?: Partial<Task>
  ): void {
    let task = this.tasks.get(taskId);
    if (!task) {
      // Task not in memory — create a minimal entry so the event is still emitted.
      // This can happen after page refresh if restoreTasks hasn't run yet.
      console.warn(
        `[TaskQueueService] Task ${taskId} not in memory, creating stub for status update`
      );
      const now = Date.now();
      task = {
        id: taskId,
        type: (updates as any)?.type || TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: { prompt: '' },
        createdAt: now,
        updatedAt: now,
      };
      this.tasks.set(taskId, task);
    }

    const now = Date.now();
    const updatedTask: Task = {
      ...task,
      ...updates,
      status,
      updatedAt: now,
    };

    // Set timestamps based on status
    if (status === TaskStatus.PROCESSING && !updatedTask.startedAt) {
      updatedTask.startedAt = now;
    } else if (
      status === TaskStatus.COMPLETED ||
      status === TaskStatus.FAILED
    ) {
      updatedTask.completedAt = now;
    }

    this.tasks.set(taskId, updatedTask);

    // Persist to IndexedDB
    this.persistTask(updatedTask);

    this.emitEvent('taskUpdated', updatedTask);

    // console.log(`[TaskQueueService] Updated task ${taskId} to ${status}`);
    if (status === TaskStatus.FAILED || status === TaskStatus.COMPLETED) {
      console.debug(
        `[TaskQueueService] Task ${taskId} → ${status}, event emitted`
      );
    }
  }

  /**
   * Updates a task's progress
   *
   * @param taskId - The task ID
   * @param progress - Progress percentage (0-100)
   */
  updateTaskProgress(taskId: string, progress: number): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    const updatedTask: Task = {
      ...task,
      progress: Math.min(100, Math.max(0, progress)),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, updatedTask);

    // Persist to IndexedDB
    this.persistTask(updatedTask);

    this.emitEvent('taskUpdated', updatedTask);
  }

  /**
   * Gets a task by ID
   *
   * @param taskId - The task ID
   * @returns The task or undefined
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Gets all tasks
   *
   * @returns Array of all tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Gets tasks by status
   *
   * @param status - The status to filter by
   * @returns Array of tasks with the specified status
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }

  /**
   * Gets active tasks (pending, processing, retrying)
   *
   * @returns Array of active tasks
   */
  getActiveTasks(): Task[] {
    return this.getAllTasks().filter(isTaskActive);
  }

  /**
   * Cancels a task
   *
   * @param taskId - The task ID to cancel
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    if (!isTaskActive(task)) {
      console.warn(
        `[TaskQueueService] Task ${taskId} is not active, cannot cancel`
      );
      return;
    }

    this.updateTaskStatus(taskId, TaskStatus.CANCELLED);
    // console.log(`[TaskQueueService] Cancelled task ${taskId}`);
  }

  /**
   * Retries a failed or cancelled task
   *
   * @param taskId - The task ID to retry
   */
  retryTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    if (
      task.status !== TaskStatus.FAILED &&
      task.status !== TaskStatus.CANCELLED
    ) {
      console.warn(
        `[TaskQueueService] Task ${taskId} is not failed or cancelled, cannot retry`
      );
      return;
    }

    // Reset task for retry - set to PROCESSING for immediate execution
    const now = Date.now();
    this.updateTaskStatus(taskId, TaskStatus.PROCESSING, {
      error: undefined,
      startedAt: now, // Set new start time
      completedAt: undefined, // Clear completion time
      remoteId: undefined, // Clear remote ID for fresh submission
      executionPhase: TaskExecutionPhase.SUBMITTING,
      progress:
        task.type === TaskType.VIDEO || task.type === TaskType.AUDIO
          ? 0
          : undefined, // Reset progress for async media
    });

    // Execute task after retry
    const updatedTask = this.tasks.get(taskId);
    if (updatedTask) {
      this.executeTask(updatedTask).catch((error) => {
        console.error('[TaskQueueService] Retry execution error:', error);
      });
    }

    // console.log(`[TaskQueueService] Retrying task ${taskId}`);
  }

  /**
   * Deletes a task from the queue
   *
   * @param taskId - The task ID to delete
   */
  deleteTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    this.tasks.delete(taskId);

    // Delete from IndexedDB
    this.persistDelete(taskId);

    this.emitEvent('taskDeleted', task);

    // console.log(`[TaskQueueService] Deleted task ${taskId}`);
  }

  /**
   * Clears completed tasks
   */
  clearCompletedTasks(): void {
    const completedTasks = this.getTasksByStatus(TaskStatus.COMPLETED);
    completedTasks.forEach((task) => this.deleteTask(task.id));
    // console.log(`[TaskQueueService] Cleared ${completedTasks.length} completed tasks`);
  }

  /**
   * Clears failed tasks
   */
  clearFailedTasks(): void {
    const failedTasks = this.getTasksByStatus(TaskStatus.FAILED);
    failedTasks.forEach((task) => this.deleteTask(task.id));
    // console.log(`[TaskQueueService] Cleared ${failedTasks.length} failed tasks`);
  }

  /**
   * Tracks an externally-created task in the in-memory Map.
   * Used by media generation services to register tasks so that
   * retryTask() and observeTaskUpdates() work correctly.
   * Idempotent: skips if task already exists in memory.
   */
  trackExternalTask(task: Task): void {
    if (this.tasks.has(task.id)) return;
    this.tasks.set(task.id, task);
    this.persistTask(task);
    this.emitEvent('taskCreated', task);
  }

  /**
   * Sync task state from IndexedDB to in-memory Map without writing back.
   * Used by media generation services to keep the in-memory state in sync
   * when the executor updates IndexedDB directly.
   */
  syncTaskFromStorage(taskId: string, storageTask: Partial<Task>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (
      task.status === storageTask.status &&
      task.progress === storageTask.progress
    )
      return;

    const updatedTask: Task = {
      ...task,
      ...storageTask,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updatedTask);
    this.emitEvent('taskUpdated', updatedTask);
  }

  /**
   * Restores tasks from storage
   *
   * Uses merge strategy: only restores tasks that don't already exist in memory,
   * or whose in-memory version is older than the stored version.
   * This prevents overwriting active tasks whose status has been updated
   * by executeTask() but not yet persisted to IndexedDB at read time.
   *
   * @param tasks - Array of tasks to restore
   */
  restoreTasks(tasks: Task[]): void {
    let restoredCount = 0;
    tasks.forEach((task) => {
      const existing = this.tasks.get(task.id);

      // Skip if in-memory task is newer or at a more advanced status
      if (existing) {
        // If in-memory task was updated more recently, keep it
        if (existing.updatedAt >= task.updatedAt) {
          return;
        }
      }

      // Ensure video tasks have progress field (for backward compatibility)
      const restoredTask: Task =
        task.type === TaskType.VIDEO && task.progress === undefined
          ? { ...task, progress: 0 }
          : task;

      this.tasks.set(restoredTask.id, restoredTask);
      restoredCount++;
    });

    // Emit a single batch update event instead of per-task events
    console.warn(
      `[TaskQueueService] restoreTasks: ${restoredCount}/${tasks.length} restored, total in memory: ${this.tasks.size}`
    );
    if (restoredCount > 0) {
      // Use the first task to emit a generic update that triggers UI refresh
      const allTasks = Array.from(this.tasks.values());
      if (allTasks.length > 0) {
        this.emitEvent('taskCreated', allTasks[0]);
      }
    }
    // console.log(`[TaskQueueService] Restored ${restoredCount}/${tasks.length} tasks (merged)`);
  }

  /**
   * Observes task update events
   *
   * @returns Observable stream of task events
   */
  observeTaskUpdates(): Observable<TaskEvent> {
    return this.taskUpdates$.asObservable();
  }

  /**
   * Marks a task as saved to the media library
   * This prevents duplicate saves when task updates occur
   *
   * @param taskId - The task ID to mark as saved
   */
  markAsSaved(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    this.updateTaskStatus(taskId, task.status, {
      savedToLibrary: true,
    });

    // console.log(`[TaskQueueService] Marked task ${taskId} as saved to library`);
  }

  /**
   * Marks a task as inserted to canvas
   * @param taskId - The task ID to mark as inserted
   */
  markAsInserted(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    this.updateTaskStatus(taskId, task.status, {
      insertedToCanvas: true,
    });
  }

  /**
   * Emits a task event
   * @private
   */
  private emitEvent(type: TaskEvent['type'], task: Task): void {
    // 浅拷贝 task 对象，确保 React 组件的 memo/shouldComponentUpdate 能检测到变化
    // 否则 useFilteredTaskQueue 收到的 event.task 与数组中已有的对象是同一引用，
    // React.memo 比较 prev.task.progress === next.task.progress 时看到的是同一个已变异对象，
    // 永远相等，导致不重新渲染
    this.taskUpdates$.next({
      type,
      task: { ...task },
      timestamp: Date.now(),
    });
  }
}

// Export singleton instance
export const taskQueueService = TaskQueueService.getInstance();
