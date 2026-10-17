import {
  Check,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { WorkspaceTaskSummary } from '../domain/workspace-model';

interface WorkspaceTaskListProps {
  tasks: WorkspaceTaskSummary[];
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
}

const statusLabel = {
  processing: '生成中',
  pending: '排队中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
} as const;

export function safeTaskResultUrl(value?: string): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (/^\/(?!\/)/.test(candidate)) return candidate;
  if (/^blob:/i.test(candidate)) return candidate;
  if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(candidate)) {
    return candidate;
  }
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? candidate
      : null;
  } catch {
    return null;
  }
}

export function WorkspaceTaskList({
  tasks,
  onCancel,
  onRetry,
}: WorkspaceTaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="next-workspace__empty-panel">
        <LoaderCircle size={19} />
        <strong>还没有生成任务</strong>
        <span>从底部创作入口开始一次探索</span>
      </div>
    );
  }

  return (
    <div className="next-workspace__task-list">
      {tasks.slice(0, 8).map((task) => {
        const active =
          task.status === 'processing' || task.status === 'pending';
        const resultUrl = safeTaskResultUrl(task.resultUrl);
        return (
          <article className="next-workspace__task-card" key={task.id}>
            <div
              className={`next-workspace__task-status next-workspace__task-status--${task.status}`}
            >
              {active ? (
                <LoaderCircle size={14} className="next-workspace__spin" />
              ) : task.status === 'completed' ? (
                <Check size={14} />
              ) : (
                <CircleAlert size={14} />
              )}
            </div>
            <div className="next-workspace__task-main">
              <strong title={task.title}>{task.title}</strong>
              <span>
                {statusLabel[task.status]} · {task.type}
              </span>
              {active && (
                <div className="next-workspace__task-progress">
                  <span style={{ width: `${task.progress}%` }} />
                </div>
              )}
              {task.status === 'failed' && task.errorMessage && (
                <small>{task.errorMessage}</small>
              )}
              {task.status === 'completed' && resultUrl && (
                <a
                  className="next-workspace__task-result"
                  href={resultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看结果
                </a>
              )}
              {task.status === 'completed' && task.resultUrl && !resultUrl && (
                <small>结果地址不可用</small>
              )}
            </div>
            <button
              type="button"
              className="next-workspace__task-action"
              aria-label={active ? '取消任务' : '重试任务'}
              onClick={() => (active ? onCancel(task.id) : onRetry(task.id))}
            >
              {active ? <Square size={13} /> : <RotateCcw size={14} />}
            </button>
          </article>
        );
      })}
    </div>
  );
}
