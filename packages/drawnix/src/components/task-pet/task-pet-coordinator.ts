import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
  type TaskEvent,
} from '../../types/task.types';
import type { TaskPetSettings } from '../../utils/settings-manager';

export type TaskPetState =
  | 'idle'
  | 'wave'
  | 'running'
  | 'waiting'
  | 'review'
  | 'jumping'
  | 'failed';

export interface TaskPetPresentation {
  state: TaskPetState;
  message: string;
  activeCount: number;
  speechText?: string;
}

export interface TaskPetCoordinatorResult {
  presentation?: TaskPetPresentation;
  terminalPending: boolean;
}

type TaskPetCategory = keyof TaskPetSettings['taskTypes'];
type TerminalResult = 'completed' | 'failed';

interface ActiveTaskSummary {
  id: string;
  signature: string;
  state: TaskPetState;
  message: string;
}

const CATEGORY_LABELS: Record<TaskPetCategory, string> = {
  text: '文本',
  image: '生图',
  video: '视频',
};

const DEFAULT_MAX_ACTIVE_RUNS = 128;
const DEFAULT_MAX_TERMINAL_RUNS = 256;

function createTerminalCounts(): Record<
  TaskPetCategory,
  Record<TerminalResult, number>
> {
  return {
    text: { completed: 0, failed: 0 },
    image: { completed: 0, failed: 0 },
    video: { completed: 0, failed: 0 },
  };
}

export function getTaskPetCategory(taskType: TaskType): TaskPetCategory | null {
  if (taskType === TaskType.CHAT) return 'text';
  if (taskType === TaskType.IMAGE) return 'image';
  if (taskType === TaskType.VIDEO) return 'video';
  return null;
}

export function isTaskPetTaskEnabled(
  task: Pick<Task, 'type'>,
  taskTypes: TaskPetSettings['taskTypes']
): boolean {
  const category = getTaskPetCategory(task.type);
  return category !== null && taskTypes[category];
}

export function getTaskPetRunKey(task: Pick<Task, 'id' | 'startedAt'>): string {
  return `${task.id}:${task.startedAt ?? 'not-started'}`;
}

function isActiveTask(task: Pick<Task, 'status'>): boolean {
  return (
    task.status === TaskStatus.PENDING || task.status === TaskStatus.PROCESSING
  );
}

function getProgressBucket(progress?: number): number | null {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    return null;
  }
  const normalized = Math.min(100, Math.max(0, progress));
  return Math.floor(normalized / 25) * 25;
}

function getActivePresentation(task: Task): Omit<ActiveTaskSummary, 'id'> {
  const category = getTaskPetCategory(task.type);
  const label = category ? CATEGORY_LABELS[category] : 'AI';
  let state: TaskPetState;
  let message: string;

  if (task.status === TaskStatus.PENDING) {
    state = 'wave';
    message = `${label}任务已开始`;
  } else if (task.executionPhase === TaskExecutionPhase.POLLING) {
    state = 'waiting';
    message = `${label}任务正在等待结果`;
  } else if (task.executionPhase === TaskExecutionPhase.DOWNLOADING) {
    state = 'review';
    message = `${label}任务正在检查结果`;
  } else if (task.executionPhase === TaskExecutionPhase.SUBMITTING) {
    state = 'running';
    message = `${label}任务正在提交`;
  } else {
    const progressBucket = getProgressBucket(task.progress);
    state = 'running';
    message =
      progressBucket !== null && progressBucket > 0
        ? `${label}任务处理中 ${progressBucket}%`
        : `${label}任务正在处理`;
  }

  const progressBucket = getProgressBucket(task.progress);
  return {
    state,
    message,
    signature: `${task.status}:${task.executionPhase || ''}:${
      progressBucket ?? ''
    }`,
  };
}

export class TaskPetCoordinator {
  private readonly activeRuns = new Map<string, ActiveTaskSummary>();
  private readonly terminalRunKeys = new Set<string>();
  private terminalCounts = createTerminalCounts();

  constructor(
    private readonly taskTypes: TaskPetSettings['taskTypes'],
    private readonly maxActiveRuns = DEFAULT_MAX_ACTIVE_RUNS,
    private readonly maxTerminalRuns = DEFAULT_MAX_TERMINAL_RUNS
  ) {}

  initialize(tasks: readonly Task[]): TaskPetPresentation {
    this.activeRuns.clear();
    const recentTasks: Task[] = [];
    const limit = Math.max(0, this.maxActiveRuns);
    for (const task of tasks) {
      if (
        limit === 0 ||
        !isActiveTask(task) ||
        !isTaskPetTaskEnabled(task, this.taskTypes)
      ) {
        continue;
      }

      const insertAt = recentTasks.findIndex(
        (candidate) => candidate.updatedAt > task.updatedAt
      );
      recentTasks.splice(insertAt < 0 ? recentTasks.length : insertAt, 0, task);
      if (recentTasks.length > limit) {
        recentTasks.shift();
      }
    }

    recentTasks.forEach((task) => this.rememberActiveTask(task));
    return this.getCurrentPresentation();
  }

  handleEvent(event: TaskEvent): TaskPetCoordinatorResult {
    const { task } = event;
    if (!isTaskPetTaskEnabled(task, this.taskTypes)) {
      return { terminalPending: false };
    }

    if (event.type === 'taskDeleted' || task.status === TaskStatus.CANCELLED) {
      this.removeTaskRuns(task.id);
      return {
        presentation: this.getCurrentPresentation(),
        terminalPending: false,
      };
    }

    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.FAILED
    ) {
      this.activeRuns.delete(getTaskPetRunKey(task));
      return this.collectTerminalTask(task);
    }

    if (!isActiveTask(task)) {
      return { terminalPending: false };
    }

    const runKey = getTaskPetRunKey(task);
    const previous = this.activeRuns.get(runKey) || this.findTaskRun(task.id);
    const next = this.rememberActiveTask(task);
    if (previous?.signature === next.signature) {
      return { terminalPending: false };
    }

    const presentation: TaskPetPresentation = {
      state: next.state,
      message: next.message,
      activeCount: this.activeRuns.size,
    };
    if (!previous) {
      const category = getTaskPetCategory(task.type);
      if (category) {
        presentation.speechText = `${CATEGORY_LABELS[category]}任务已开始`;
      }
    }

    return { presentation, terminalPending: false };
  }

  flushTerminalAggregate(): TaskPetPresentation | null {
    const counts = this.terminalCounts;
    this.terminalCounts = createTerminalCounts();
    const completed =
      counts.text.completed + counts.image.completed + counts.video.completed;
    const failed =
      counts.text.failed + counts.image.failed + counts.video.failed;
    if (completed + failed === 0) {
      return null;
    }

    const message = this.formatTerminalMessage(counts, completed, failed);
    return {
      state: failed > 0 ? 'failed' : 'jumping',
      message,
      activeCount: this.activeRuns.size,
      speechText: message,
    };
  }

  getCurrentPresentation(): TaskPetPresentation {
    let latest: ActiveTaskSummary | undefined;
    for (const summary of this.activeRuns.values()) {
      latest = summary;
    }
    if (!latest) {
      return { state: 'idle', message: '', activeCount: 0 };
    }
    return {
      state: latest.state,
      message: latest.message,
      activeCount: this.activeRuns.size,
    };
  }

  clear(): void {
    this.activeRuns.clear();
    this.terminalRunKeys.clear();
    this.terminalCounts = createTerminalCounts();
  }

  private rememberActiveTask(task: Task): ActiveTaskSummary {
    const runKey = getTaskPetRunKey(task);
    const presentation = getActivePresentation(task);
    const summary: ActiveTaskSummary = {
      id: task.id,
      ...presentation,
    };

    this.removeTaskRuns(task.id);
    this.activeRuns.set(runKey, summary);
    while (this.activeRuns.size > this.maxActiveRuns) {
      const oldestKey = this.activeRuns.keys().next().value;
      if (oldestKey === undefined) break;
      this.activeRuns.delete(oldestKey);
    }
    return summary;
  }

  private collectTerminalTask(task: Task): TaskPetCoordinatorResult {
    const runKey = getTaskPetRunKey(task);
    this.removeTaskRuns(task.id);
    if (this.terminalRunKeys.has(runKey)) {
      return { terminalPending: false };
    }

    this.terminalRunKeys.add(runKey);
    while (this.terminalRunKeys.size > this.maxTerminalRuns) {
      const oldestKey = this.terminalRunKeys.values().next().value;
      if (oldestKey === undefined) break;
      this.terminalRunKeys.delete(oldestKey);
    }

    const category = getTaskPetCategory(task.type);
    if (!category) {
      return { terminalPending: false };
    }
    const result =
      task.status === TaskStatus.COMPLETED ? 'completed' : 'failed';
    this.terminalCounts[category][result] += 1;
    return { terminalPending: true };
  }

  private removeTaskRuns(taskId: string): void {
    for (const [runKey, summary] of this.activeRuns) {
      if (summary.id === taskId) {
        this.activeRuns.delete(runKey);
      }
    }
  }

  private findTaskRun(taskId: string): ActiveTaskSummary | undefined {
    for (const summary of this.activeRuns.values()) {
      if (summary.id === taskId) return summary;
    }
    return undefined;
  }

  private formatTerminalMessage(
    counts: Record<TaskPetCategory, Record<TerminalResult, number>>,
    completed: number,
    failed: number
  ): string {
    if (completed + failed === 1) {
      const category = (Object.keys(counts) as TaskPetCategory[]).find(
        (key) => counts[key].completed + counts[key].failed > 0
      );
      const label = category ? CATEGORY_LABELS[category] : 'AI';
      return completed === 1 ? `${label}任务已完成` : `${label}任务失败`;
    }
    if (failed === 0) return `${completed} 个任务已完成`;
    if (completed === 0) return `${failed} 个任务失败`;
    return `${completed} 个任务完成，${failed} 个任务失败`;
  }
}
