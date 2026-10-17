import { workspaceService } from '@drawnix/drawnix/runtime';
import type { TaskEvent, Task } from '@drawnix/drawnix/task-types';
import {
  createActivities,
  toBoardSummary,
  toTaskSummary,
  type WorkspaceRuntimePort,
  type WorkspaceRuntimeSnapshot,
} from '../domain/workspace-model';

type TaskQueueModule = {
  taskQueueService: {
    getAllTasks: () => Task[];
    cancelTask: (taskId: string) => void;
    retryTask: (taskId: string) => void;
    observeTaskUpdates: () => {
      subscribe: (listener: (event: TaskEvent) => void) => {
        unsubscribe: () => void;
      };
    };
  };
};

let runtimePromise: Promise<TaskQueueModule> | null = null;

function loadTaskQueue(): Promise<TaskQueueModule> {
  runtimePromise ??= import('@drawnix/drawnix/task-queue');
  return runtimePromise;
}

function emptySnapshot(): WorkspaceRuntimeSnapshot {
  return { boards: [], tasks: [], activities: [], updatedAt: 0 };
}

class DrawnixWorkspaceRuntime implements WorkspaceRuntimePort {
  private snapshot: WorkspaceRuntimeSnapshot = emptySnapshot();
  private listeners = new Set<(snapshot: WorkspaceRuntimeSnapshot) => void>();
  private boardSubscription?: { unsubscribe: () => void };
  private taskSubscription?: { unsubscribe: () => void };
  private started = false;

  getSnapshot(): WorkspaceRuntimeSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<WorkspaceRuntimeSnapshot> {
    await workspaceService.waitForInitialization();
    const boards = workspaceService.getAllBoardMetadata().map(toBoardSummary);
    let tasks: ReturnType<typeof toTaskSummary>[] = [];
    try {
      const { taskQueueService } = await loadTaskQueue();
      tasks = taskQueueService.getAllTasks().map(toTaskSummary);
    } catch (error) {
      console.warn('[WorkspaceRuntime] task projection unavailable:', error);
    }
    this.snapshot = {
      boards: boards.sort((a, b) => b.updatedAt - a.updatedAt),
      tasks: tasks.sort((a, b) => b.updatedAt - a.updatedAt),
      activities: createActivities(boards, tasks),
      updatedAt: Date.now(),
    };
    this.emit();
    this.startSubscriptions();
    return this.snapshot;
  }

  subscribe(
    listener: (snapshot: WorkspaceRuntimeSnapshot) => void
  ): () => void {
    this.listeners.add(listener);
    this.startSubscriptions();
    if (this.snapshot.updatedAt === 0) {
      void this.refresh().catch((error) => {
        console.warn('[WorkspaceRuntime] refresh unavailable:', error);
        this.snapshot = emptySnapshot();
        this.emit();
      });
    } else {
      listener(this.snapshot);
    }
    return () => this.listeners.delete(listener);
  }

  cancelTask(taskId: string): void {
    void loadTaskQueue()
      .then(({ taskQueueService }) => {
        taskQueueService.cancelTask(taskId);
        return this.safeRefresh();
      })
      .catch((error) =>
        console.warn('[WorkspaceRuntime] cancel unavailable:', error)
      );
  }

  retryTask(taskId: string): void {
    void loadTaskQueue()
      .then(({ taskQueueService }) => {
        taskQueueService.retryTask(taskId);
        return this.safeRefresh();
      })
      .catch((error) =>
        console.warn('[WorkspaceRuntime] retry unavailable:', error)
      );
  }

  private startSubscriptions(): void {
    if (this.started) return;
    this.started = true;
    this.boardSubscription = workspaceService.observeEvents().subscribe(() => {
      void this.safeRefresh();
    });
    void loadTaskQueue()
      .then(({ taskQueueService }) => {
        this.taskSubscription = taskQueueService
          .observeTaskUpdates()
          .subscribe(() => {
            void this.safeRefresh();
          });
      })
      .catch((error) =>
        console.warn('[WorkspaceRuntime] task subscription unavailable:', error)
      );
  }

  private async safeRefresh(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      console.warn(
        '[WorkspaceRuntime] subscription refresh unavailable:',
        error
      );
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

export const drawnixWorkspaceRuntime: WorkspaceRuntimePort =
  new DrawnixWorkspaceRuntime();
