import type { BoardMetadata } from '@drawnix/drawnix/runtime';
import type { Task, TaskStatus, TaskType } from '@drawnix/drawnix/task-types';

export type WorkspaceSurface =
  | 'canvas'
  | 'projects'
  | 'assets'
  | 'tasks'
  | 'activity';

export interface WorkspaceBoardSummary {
  id: string;
  name: string;
  folderId: string | null;
  updatedAt: number;
  createdAt: number;
  elementCount?: number;
}

export interface WorkspaceTaskSummary {
  id: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  prompt: string;
  title: string;
  resultUrl?: string;
  resultKind?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface WorkspaceActivityEntry {
  id: string;
  kind: 'board' | 'task' | 'system';
  label: string;
  detail: string;
  timestamp: number;
  status?: TaskStatus;
}

export interface WorkspaceRuntimeSnapshot {
  boards: WorkspaceBoardSummary[];
  tasks: WorkspaceTaskSummary[];
  activities: WorkspaceActivityEntry[];
  updatedAt: number;
}

export interface WorkspaceRuntimePort {
  getSnapshot(): WorkspaceRuntimeSnapshot;
  refresh(): Promise<WorkspaceRuntimeSnapshot>;
  subscribe(listener: (snapshot: WorkspaceRuntimeSnapshot) => void): () => void;
  cancelTask(taskId: string): void;
  retryTask(taskId: string): void;
}

export function toBoardSummary(board: BoardMetadata): WorkspaceBoardSummary {
  return {
    id: board.id,
    name: board.name,
    folderId: board.folderId,
    updatedAt: board.updatedAt,
    createdAt: board.createdAt,
  };
}

export function toTaskSummary(task: Task): WorkspaceTaskSummary {
  const prompt =
    typeof task.params?.prompt === 'string' ? task.params.prompt.trim() : '';
  const title =
    typeof task.params?.title === 'string' && task.params.title.trim()
      ? task.params.title.trim()
      : prompt || `${task.type} 创作任务`;
  const resultUrl = task.result?.url || task.result?.urls?.[0];

  return {
    id: task.id,
    type: task.type,
    status: task.status,
    progress: Math.max(
      0,
      Math.min(100, task.progress ?? (task.status === 'completed' ? 100 : 0))
    ),
    prompt,
    title,
    resultUrl,
    resultKind: task.result?.resultKind,
    errorMessage: task.error?.message,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  };
}

export function createActivities(
  boards: WorkspaceBoardSummary[],
  tasks: WorkspaceTaskSummary[],
  now = Date.now()
): WorkspaceActivityEntry[] {
  const boardEntries = boards.slice(0, 5).map((board) => ({
    id: `board:${board.id}`,
    kind: 'board' as const,
    label: board.name || '未命名画布',
    detail: '画布已保存到本地设备',
    timestamp: board.updatedAt,
  }));
  const taskEntries = tasks.slice(0, 12).map((task) => ({
    id: `task:${task.id}`,
    kind: 'task' as const,
    label: task.title,
    detail:
      task.status === 'completed'
        ? '生成结果已就绪'
        : task.status === 'failed'
        ? task.errorMessage || '生成任务失败'
        : `生成中 ${task.progress}%`,
    timestamp: task.updatedAt || task.createdAt || now,
    status: task.status,
  }));

  return [...taskEntries, ...boardEntries]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 16);
}
