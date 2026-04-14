/**
 * 历史记录页 - 分析历史列表 + 收藏 + 删除 + 关联任务展开
 */

import React, { useCallback, useState, useMemo } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import type { AnalysisRecord } from '../types';
import { updateRecord, deleteRecord } from '../storage';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import type { Task } from '../../../types/task.types';
import { TaskType, TaskStatus } from '../../../types/task.types';

interface RelatedTasks {
  rewrite: Task[];
  image: Task[];
  video: Task[];
}

interface HistoryPageProps {
  records: AnalysisRecord[];
  onSelect: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
  showStarredOnly?: boolean;
  onInsertTask?: (task: Task) => void;
  /** 点击脚本改编任务时，跳转到该记录的脚本页 */
  onSelectScript?: (record: AnalysisRecord, task: Task) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({
  records,
  onSelect,
  onRecordsChange,
  showStarredOnly = false,
  onInsertTask,
  onSelectScript,
}) => {
  const filtered = showStarredOnly ? records.filter(r => r.starred) : records;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { tasks: allTasks } = useSharedTaskState();

  // 一次遍历构建 recordId → 关联任务映射
  const relatedTasksMap = useMemo(() => {
    const map = new Map<string, RelatedTasks>();
    const recordIds = new Set(records.map(r => r.id));

    for (const task of allTasks) {
      const params = task.params;

      // 脚本改编任务
      if (
        task.type === TaskType.CHAT &&
        params.videoAnalyzerAction === 'rewrite' &&
        typeof params.videoAnalyzerRecordId === 'string' &&
        recordIds.has(params.videoAnalyzerRecordId)
      ) {
        const rid = params.videoAnalyzerRecordId as string;
        if (!map.has(rid)) map.set(rid, { rewrite: [], image: [], video: [] });
        map.get(rid)!.rewrite.push(task);
        continue;
      }

      // 图片/视频生成任务（batchId 以 va_{recordId} 开头）
      if (
        (task.type === TaskType.IMAGE || task.type === TaskType.VIDEO) &&
        typeof params.batchId === 'string' &&
        params.batchId.startsWith('va_')
      ) {
        const batchId = params.batchId as string;
        // 从 batchId 提取 recordId: va_{recordId} 或 va_{recordId}_shot...
        const rest = batchId.slice(3); // 去掉 'va_'
        // recordId 是 UUID 格式，找到第一个匹配的 recordId
        for (const rid of recordIds) {
          if (rest === rid || rest.startsWith(rid + '_')) {
            if (!map.has(rid)) map.set(rid, { rewrite: [], image: [], video: [] });
            const group = task.type === TaskType.IMAGE ? 'image' : 'video';
            map.get(rid)![group].push(task);
            break;
          }
        }
      }
    }

    // 按创建时间倒序排列
    for (const related of map.values()) {
      related.rewrite.sort((a, b) => b.createdAt - a.createdAt);
      related.image.sort((a, b) => b.createdAt - a.createdAt);
      related.video.sort((a, b) => b.createdAt - a.createdAt);
    }

    return map;
  }, [allTasks, records]);

  const handleToggleStar = useCallback(async (e: React.MouseEvent, record: AnalysisRecord) => {
    e.stopPropagation();
    const updated = await updateRecord(record.id, { starred: !record.starred });
    onRecordsChange(updated);
  }, [onRecordsChange]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = await deleteRecord(id);
    onRecordsChange(updated);
  }, [onRecordsChange]);

  const handleToggleExpand = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const handleInsertClick = useCallback((e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    onInsertTask?.(task);
  }, [onInsertTask]);

  const handleScriptClick = useCallback((e: React.MouseEvent, record: AnalysisRecord, task: Task) => {
    e.stopPropagation();
    onSelectScript?.(record, task);
  }, [onSelectScript]);

  if (filtered.length === 0) {
    return (
      <div className="va-page va-empty">
        <span>{showStarredOnly ? '暂无收藏' : '暂无分析记录'}</span>
      </div>
    );
  }

  return (
    <div className="va-page">
      <div className="va-history-list">
        {filtered.map(record => {
          const related = relatedTasksMap.get(record.id);
          const hasRelated = related && (related.rewrite.length + related.image.length + related.video.length) > 0;
          const isExpanded = expandedId === record.id;

          return (
            <div
              key={record.id}
              className="va-history-item"
              onClick={() => onSelect(record)}
            >
              <div className="va-history-header">
                <span className="va-history-source">
                  {record.source === 'youtube' ? '🔗' : '📁'} {record.sourceLabel}
                </span>
                <button
                  className={`va-star-btn ${record.starred ? 'starred' : ''}`}
                  onClick={e => handleToggleStar(e, record)}
                >
                  {record.starred ? '★' : '☆'}
                </button>
              </div>
              <div className="va-history-meta">
                {hasRelated && (
                  <button
                    className={`va-history-expand-btn ${isExpanded ? 'expanded' : ''}`}
                    onClick={e => handleToggleExpand(e, record.id)}
                  >
                    <ChevronRight size={12} />
                    <span>{isExpanded ? '收起' : '关联任务'}</span>
                  </button>
                )}
                <span>{new Date(record.createdAt).toLocaleString()}</span>
                <span>{record.analysis.shotCount} 镜头</span>
                <span>{record.model}</span>
                <button
                  className="va-history-delete"
                  onClick={e => handleDelete(e, record.id)}
                >
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
                  onInsertClick={handleInsertClick}
                  onScriptClick={handleScriptClick}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** 状态文本映射 */
function statusLabel(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED: return '已完成';
    case TaskStatus.PROCESSING: return '进行中';
    case TaskStatus.PENDING: return '等待中';
    case TaskStatus.FAILED: return '失败';
    default: return '';
  }
}

/** 状态 CSS class */
function statusClass(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED: return 'completed';
    case TaskStatus.PROCESSING: return 'processing';
    case TaskStatus.PENDING: return 'pending';
    case TaskStatus.FAILED: return 'failed';
    default: return 'pending';
  }
}

/** 格式化时间为短格式 */
function shortTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 获取任务的 prompt 摘要 */
function taskPromptSummary(task: Task): string {
  const prompt = String(task.params.prompt || '');
  return prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt;
}

/** 关联任务分组展示 */
const RelatedTasksSection: React.FC<{
  related: RelatedTasks;
  record: AnalysisRecord;
  onInsertClick: (e: React.MouseEvent, task: Task) => void;
  onScriptClick: (e: React.MouseEvent, record: AnalysisRecord, task: Task) => void;
}> = ({ related, record, onInsertClick, onScriptClick }) => (
  <div className="va-history-related" onClick={e => e.stopPropagation()}>
    {related.rewrite.length > 0 && (
      <div>
        <div className="va-history-related-group-title">脚本改编 ({related.rewrite.length})</div>
        {related.rewrite.map(task => (
          <RelatedTaskItem
            key={task.id}
            task={task}
            onClick={e => onScriptClick(e, record, task)}
          />
        ))}
      </div>
    )}
    {related.image.length > 0 && (
      <div>
        <div className="va-history-related-group-title">图片生成 ({related.image.length})</div>
        {related.image.map(task => (
          <RelatedTaskItem key={task.id} task={task} onInsertClick={onInsertClick} />
        ))}
      </div>
    )}
    {related.video.length > 0 && (
      <div>
        <div className="va-history-related-group-title">视频生成 ({related.video.length})</div>
        {related.video.map(task => (
          <RelatedTaskItem key={task.id} task={task} onInsertClick={onInsertClick} />
        ))}
      </div>
    )}
  </div>
);

/** 单条关联任务 */
const RelatedTaskItem: React.FC<{
  task: Task;
  onClick?: (e: React.MouseEvent) => void;
  onInsertClick?: (e: React.MouseEvent, task: Task) => void;
}> = ({ task, onClick, onInsertClick }) => {
  const isCompleted = task.status === TaskStatus.COMPLETED;
  const hasResult = isCompleted && (task.result?.url || task.result?.urls?.length);
  const thumbUrl = task.result?.url || task.result?.urls?.[0];

  return (
    <div
      className="va-history-related-task"
      title={statusLabel(task.status)}
      onClick={onClick}
    >
      <span className={`va-history-related-task-status ${statusClass(task.status)}`} />
      <span className="va-history-related-task-prompt">{taskPromptSummary(task)}</span>
      <span className="va-history-related-task-time">{shortTime(task.createdAt)}</span>
      {hasResult && thumbUrl && task.type !== TaskType.CHAT && (
        <span className="va-history-related-task-thumb">
          <img src={thumbUrl} alt="" referrerPolicy="no-referrer" />
        </span>
      )}
      {hasResult && onInsertClick && (
        <button
          className="va-history-related-insert-btn"
          onClick={e => onInsertClick(e, task)}
          title="插入画板"
        >
          <Download size={14} />
        </button>
      )}
    </div>
  );
};
