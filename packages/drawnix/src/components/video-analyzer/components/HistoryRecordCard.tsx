import React, { useCallback } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { AnalysisRecord } from '../types';
import type { Task } from '../../../types/task.types';
import { TaskStatus, TaskType } from '../../../types/task.types';
import { VideoPosterPreview } from '../../shared/VideoPosterPreview';

export interface RelatedTasks {
  rewrite: Task[];
  image: Task[];
  video: Task[];
}

export function getTaskMediaUrls(task: Task): string[] {
  if (!task.result) {
    return [];
  }

  if (task.result.urls?.length) {
    return task.result.urls.filter(Boolean);
  }

  return task.result.url ? [task.result.url] : [];
}

function getTaskThumbnailUrl(task: Task): string | null {
  if (!task.result) {
    return null;
  }

  if (task.type === TaskType.VIDEO) {
    return task.result.thumbnailUrls?.[0] || task.result.thumbnailUrl || null;
  }

  return task.result.thumbnailUrls?.[0] || task.result.url || null;
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED:
      return '已完成';
    case TaskStatus.PROCESSING:
      return '进行中';
    case TaskStatus.PENDING:
      return '等待中';
    case TaskStatus.FAILED:
      return '失败';
    default:
      return '';
  }
}

function statusClass(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED:
      return 'completed';
    case TaskStatus.PROCESSING:
      return 'processing';
    case TaskStatus.PENDING:
      return 'pending';
    case TaskStatus.FAILED:
      return 'failed';
    default:
      return 'pending';
  }
}

function shortTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function taskPromptSummary(task: Task): string {
  const prompt = String(task.params.prompt || '');
  return prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt;
}

interface HistoryRecordCardProps {
  record: AnalysisRecord;
  related?: RelatedTasks;
  isExpanded: boolean;
  onSelect: (record: AnalysisRecord) => void;
  onToggleStar: (event: React.MouseEvent, record: AnalysisRecord) => void;
  onDelete: (event: React.MouseEvent, id: string) => void;
  onToggleExpand: (event: React.MouseEvent, id: string) => void;
  onInsertTask?: (event: React.MouseEvent, task: Task) => void;
  onPreviewOpen?: (event: React.MouseEvent, task: Task, previewTasks: Task[]) => void;
  onSelectScript?: (event: React.MouseEvent, record: AnalysisRecord, task: Task) => void;
}

export const HistoryRecordCard: React.FC<HistoryRecordCardProps> = ({
  record,
  related,
  isExpanded,
  onSelect,
  onToggleStar,
  onDelete,
  onToggleExpand,
  onInsertTask,
  onPreviewOpen,
  onSelectScript,
}) => {
  const hasRelated = Boolean(
    related && related.rewrite.length + related.image.length + related.video.length > 0
  );
  const previewTasks = related ? [...related.image, ...related.video] : [];

  return (
    <div className="va-history-item" onClick={() => onSelect(record)}>
      <div className="va-history-header">
        <span className="va-history-source">
          {record.source === 'youtube' ? '🔗' : '📁'} {record.sourceLabel}
        </span>
        <button
          className={`va-star-btn ${record.starred ? 'starred' : ''}`}
          onClick={(event) => onToggleStar(event, record)}
        >
          {record.starred ? '★' : '☆'}
        </button>
      </div>
      <div className="va-history-meta">
        {hasRelated && (
          <button
            className={`va-history-expand-btn ${isExpanded ? 'expanded' : ''}`}
            onClick={(event) => onToggleExpand(event, record.id)}
          >
            <ChevronRight size={12} />
            <span>{isExpanded ? '收起' : '关联任务'}</span>
          </button>
        )}
        <span>{new Date(record.createdAt).toLocaleString()}</span>
        <span>{record.analysis.shotCount} 镜头</span>
        <span>{record.model}</span>
        <button className="va-history-delete" onClick={(event) => onDelete(event, record.id)}>
          删除
        </button>
      </div>
      {record.analysis.video_style && (
        <div className="va-history-style">{record.analysis.video_style}</div>
      )}
      {isExpanded && related && (
        <RelatedTasksSection
          related={related}
          record={record}
          previewTasks={previewTasks}
          onInsertTask={onInsertTask}
          onPreviewOpen={onPreviewOpen}
          onSelectScript={onSelectScript}
        />
      )}
    </div>
  );
};

const RelatedTasksSection: React.FC<{
  related: RelatedTasks;
  record: AnalysisRecord;
  previewTasks: Task[];
  onInsertTask?: (event: React.MouseEvent, task: Task) => void;
  onPreviewOpen?: (event: React.MouseEvent, task: Task, previewTasks: Task[]) => void;
  onSelectScript?: (event: React.MouseEvent, record: AnalysisRecord, task: Task) => void;
}> = ({ related, record, previewTasks, onInsertTask, onPreviewOpen, onSelectScript }) => (
  <div className="va-history-related" onClick={(event) => event.stopPropagation()}>
    {related.rewrite.length > 0 && (
      <div>
        <div className="va-history-related-group-title">脚本改编 ({related.rewrite.length})</div>
        {related.rewrite.map((task) => (
          <RelatedTaskItem
            key={task.id}
            task={task}
            onClick={(event) => onSelectScript?.(event, record, task)}
          />
        ))}
      </div>
    )}
    {related.image.length > 0 && (
      <div>
        <div className="va-history-related-group-title">图片生成 ({related.image.length})</div>
        {related.image.map((task) => (
          <RelatedTaskItem
            key={task.id}
            task={task}
            previewTasks={previewTasks}
            onInsertTask={onInsertTask}
            onPreviewOpen={onPreviewOpen}
          />
        ))}
      </div>
    )}
    {related.video.length > 0 && (
      <div>
        <div className="va-history-related-group-title">视频生成 ({related.video.length})</div>
        {related.video.map((task) => (
          <RelatedTaskItem
            key={task.id}
            task={task}
            previewTasks={previewTasks}
            onInsertTask={onInsertTask}
            onPreviewOpen={onPreviewOpen}
          />
        ))}
      </div>
    )}
  </div>
);

const RelatedTaskItem: React.FC<{
  task: Task;
  previewTasks?: Task[];
  onClick?: (event: React.MouseEvent) => void;
  onInsertTask?: (event: React.MouseEvent, task: Task) => void;
  onPreviewOpen?: (event: React.MouseEvent, task: Task, previewTasks: Task[]) => void;
}> = ({ task, previewTasks, onClick, onInsertTask, onPreviewOpen }) => {
  const isCompleted = task.status === TaskStatus.COMPLETED;
  const mediaUrls = getTaskMediaUrls(task);
  const hasResult = isCompleted && mediaUrls.length > 0;
  const isPreviewableMedia =
    (task.type === TaskType.IMAGE || task.type === TaskType.VIDEO) &&
    hasResult &&
    Boolean(previewTasks?.length);
  const thumbnailUrl = getTaskThumbnailUrl(task);
  const primaryUrl = mediaUrls[0];

  const handleItemClick = useCallback(
    (event: React.MouseEvent) => {
      if (isPreviewableMedia && previewTasks) {
        onPreviewOpen?.(event, task, previewTasks);
        return;
      }
      onClick?.(event);
    },
    [isPreviewableMedia, onClick, onPreviewOpen, previewTasks, task]
  );

  return (
    <div
      className="va-history-related-task"
      title={statusLabel(task.status)}
      onClick={handleItemClick}
    >
      <span className={`va-history-related-task-status ${statusClass(task.status)}`} />
      <span className="va-history-related-task-prompt">{taskPromptSummary(task)}</span>
      <span className="va-history-related-task-time">{shortTime(task.createdAt)}</span>
      {hasResult && primaryUrl && task.type !== TaskType.CHAT && (
        <span className="va-history-related-task-thumb">
          {task.type === TaskType.VIDEO ? (
            <VideoPosterPreview
              src={primaryUrl}
              poster={thumbnailUrl || undefined}
              alt=""
              className="va-history-related-task-thumb-media"
              thumbnailSize="small"
              videoProps={{
                preload: 'metadata',
                muted: true,
                playsInline: true,
                'aria-hidden': true,
              }}
            />
          ) : (
            <img src={thumbnailUrl || primaryUrl} alt="" referrerPolicy="no-referrer" />
          )}
          {task.type === TaskType.VIDEO && (
            <span className="va-history-related-task-thumb-badge" aria-hidden="true">
              ▶
            </span>
          )}
        </span>
      )}
      {hasResult && onInsertTask && (
        <button
          className="va-history-related-insert-btn"
          onClick={(event) => onInsertTask(event, task)}
          title="插入画板"
          aria-label="插入画板"
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
};

export default HistoryRecordCard;
