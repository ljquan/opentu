import React, { useCallback, useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { MusicAnalysisRecord } from '../types';
import { deleteRecord, updateRecord } from '../storage';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import type { Task } from '../../../types/task.types';
import { TaskStatus, TaskType } from '../../../types/task.types';
import { ConfirmDialog } from '../../dialog/ConfirmDialog';

interface RelatedTasks {
  rewrite: Task[];
  lyricsGen: Task[];
  audio: Task[];
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED: return '已完成';
    case TaskStatus.PROCESSING: return '进行中';
    case TaskStatus.PENDING: return '等待中';
    case TaskStatus.FAILED: return '失败';
    default: return '';
  }
}

function statusClass(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.COMPLETED: return 'completed';
    case TaskStatus.PROCESSING: return 'processing';
    case TaskStatus.PENDING: return 'pending';
    case TaskStatus.FAILED: return 'failed';
    default: return 'pending';
  }
}

function shortTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function taskPromptSummary(task: Task): string {
  const action = task.params.musicAnalyzerAction;
  if (action === 'rewrite') {
    const analysisData =
      task.result?.analysisData && typeof task.result.analysisData === 'object'
        ? (task.result.analysisData as Record<string, unknown>)
        : null;
    const rewrittenTitle =
      typeof analysisData?.title === 'string' && analysisData.title.trim()
        ? analysisData.title.trim()
        : '';
    if (rewrittenTitle) {
      return rewrittenTitle;
    }
  }

  if (action === 'lyrics-gen') {
    const analysisData =
      task.result?.analysisData && typeof task.result.analysisData === 'object'
        ? (task.result.analysisData as Record<string, unknown>)
        : null;
    const rewrittenTitle =
      typeof analysisData?.title === 'string' && analysisData.title.trim()
        ? analysisData.title.trim()
        : '';
    if (rewrittenTitle) {
      return rewrittenTitle;
    }

    const generatedTitle =
      typeof task.result?.lyricsTitle === 'string' && task.result.lyricsTitle.trim()
        ? task.result.lyricsTitle.trim()
        : typeof task.result?.title === 'string' && task.result.title.trim()
        ? task.result.title.trim()
        : '';
    if (generatedTitle) {
      return generatedTitle;
    }
  }

  const prompt = String(task.params.prompt || '');
  return prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt;
}

interface HistoryPageProps {
  records: MusicAnalysisRecord[];
  onSelect: (record: MusicAnalysisRecord) => void;
  onRecordsChange: (records: MusicAnalysisRecord[]) => void;
  showStarredOnly?: boolean;
  onSelectLyrics?: (record: MusicAnalysisRecord) => void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({
  records,
  onSelect,
  onRecordsChange,
  showStarredOnly = false,
  onSelectLyrics,
}) => {
  const filtered = showStarredOnly ? records.filter((record) => record.starred) : records;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { tasks: allTasks } = useSharedTaskState();

  // 构建 recordId → 关联任务映射
  const relatedTasksMap = useMemo(() => {
    const map = new Map<string, RelatedTasks>();
    const recordIds = new Set(records.map((r) => r.id));

    for (const task of allTasks) {
      const params = task.params;

      // 歌词改写任务
      if (
        task.type === TaskType.CHAT &&
        params.musicAnalyzerAction === 'rewrite' &&
        typeof params.musicAnalyzerRecordId === 'string' &&
        recordIds.has(params.musicAnalyzerRecordId)
      ) {
        const rid = params.musicAnalyzerRecordId as string;
        if (!map.has(rid)) map.set(rid, { rewrite: [], lyricsGen: [], audio: [] });
        map.get(rid)!.rewrite.push(task);
        continue;
      }

      // Suno 歌词生成任务
      if (
        (task.type === TaskType.AUDIO || task.type === TaskType.CHAT) &&
        params.musicAnalyzerAction === 'lyrics-gen' &&
        typeof params.musicAnalyzerRecordId === 'string' &&
        recordIds.has(params.musicAnalyzerRecordId)
      ) {
        const rid = params.musicAnalyzerRecordId as string;
        if (!map.has(rid)) map.set(rid, { rewrite: [], lyricsGen: [], audio: [] });
        map.get(rid)!.lyricsGen.push(task);
        continue;
      }

      // 音乐生成任务（batchId 以 ma_ 开头）
      if (
        task.type === TaskType.AUDIO &&
        typeof params.batchId === 'string' &&
        (params.batchId as string).startsWith('ma_')
      ) {
        const batchId = params.batchId as string;
        const rest = batchId.slice(3);
        for (const rid of recordIds) {
          if (rest === rid || rest.startsWith(rid + '_')) {
            if (!map.has(rid)) map.set(rid, { rewrite: [], lyricsGen: [], audio: [] });
            map.get(rid)!.audio.push(task);
            break;
          }
        }
      }
    }

    for (const related of map.values()) {
      related.rewrite.sort((a, b) => b.createdAt - a.createdAt);
      related.lyricsGen.sort((a, b) => b.createdAt - a.createdAt);
      related.audio.sort((a, b) => b.createdAt - a.createdAt);
    }

    return map;
  }, [allTasks, records]);

  const handleToggleStar = useCallback(
    async (event: React.MouseEvent, record: MusicAnalysisRecord) => {
      event.stopPropagation();
      const updated = await updateRecord(record.id, { starred: !record.starred });
      onRecordsChange(updated);
    },
    [onRecordsChange]
  );

  const handleDelete = useCallback(
    (event: React.MouseEvent, id: string) => {
      event.stopPropagation();
      setPendingDeleteId(id);
    },
    []
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) {
      return;
    }

    const updated = await deleteRecord(pendingDeleteId);
    onRecordsChange(updated);
    setPendingDeleteId(null);
  }, [onRecordsChange, pendingDeleteId]);

  const handleToggleExpand = useCallback((event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  if (filtered.length === 0) {
    return (
      <div className="va-page va-empty">
        <span>{showStarredOnly ? '暂无收藏' : '暂无分析记录'}</span>
      </div>
    );
  }

  return (
    <>
      <div className="va-page">
        <div className="va-history-list">
        {filtered.map((record) => {
          const related = relatedTasksMap.get(record.id);
          const hasRelated = Boolean(
            related && related.rewrite.length + related.lyricsGen.length + related.audio.length > 0
          );
          const isExpanded = expandedId === record.id;

          return (
            <div key={record.id} className="va-history-item" onClick={() => onSelect(record)}>
              <div className="va-history-header">
                <span className="va-history-source">
                  <span role="img" aria-label="audio">
                    {record.source === 'scratch' ? '✨' : '🎵'}
                  </span>{' '}
                  {record.sourceLabel}
                </span>
                <button
                  className={`va-star-btn ${record.starred ? 'starred' : ''}`}
                  onClick={(event) => handleToggleStar(event, record)}
                >
                  {record.starred ? '★' : '☆'}
                </button>
              </div>
              <div className="va-history-meta">
                {hasRelated && (
                  <button
                    className={`va-history-expand-btn ${isExpanded ? 'expanded' : ''}`}
                    onClick={(event) => handleToggleExpand(event, record.id)}
                  >
                    <ChevronRight size={12} />
                    <span>{isExpanded ? '收起' : '关联任务'}</span>
                  </button>
                )}
                <span>{new Date(record.createdAt).toLocaleString()}</span>
                <span>{record.analysisModel || record.source}</span>
                <button
                  className="va-history-delete"
                  onClick={(event) => handleDelete(event, record.id)}
                >
                  删除
                </button>
              </div>
              <div className="ma-history-title">{record.title || '未命名歌曲'}</div>
              <div className="ma-history-summary">
                {record.analysis?.summary || record.creationPrompt || '暂无摘要'}
              </div>
              {record.generatedClips && record.generatedClips.length > 0 && (
                <div className="ma-history-clips-count">
                  {record.generatedClips.length} 首已生成
                </div>
              )}
              {isExpanded && related && (
                <div className="va-history-related" onClick={(e) => e.stopPropagation()}>
                  {related.lyricsGen.length > 0 && (
                    <div>
                      <div className="va-history-related-group-title">
                        歌词生成 ({related.lyricsGen.length})
                      </div>
                      {related.lyricsGen.map((task) => (
                        <RelatedTaskItem
                          key={task.id}
                          task={task}
                          onClick={() => onSelectLyrics?.(record)}
                        />
                      ))}
                    </div>
                  )}
                  {related.rewrite.length > 0 && (
                    <div>
                      <div className="va-history-related-group-title">
                        歌词改写 ({related.rewrite.length})
                      </div>
                      {related.rewrite.map((task) => (
                        <RelatedTaskItem
                          key={task.id}
                          task={task}
                          onClick={() => onSelectLyrics?.(record)}
                        />
                      ))}
                    </div>
                  )}
                  {related.audio.length > 0 && (
                    <div>
                      <div className="va-history-related-group-title">
                        音乐生成 ({related.audio.length})
                      </div>
                      {related.audio.map((task) => (
                        <RelatedTaskItem key={task.id} task={task} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="确认删除"
        description="确定要删除这条音乐分析记录吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        danger
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteId(null);
          }
        }}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
};

const RelatedTaskItem: React.FC<{ task: Task; onClick?: () => void }> = ({ task, onClick }) => {
  const isCompleted = task.status === TaskStatus.COMPLETED;
  const audioUrl = isCompleted ? (task.result?.url || '') : '';

  return (
    <div
      className="va-history-related-task"
      title={statusLabel(task.status)}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >      <span className={`va-history-related-task-status ${statusClass(task.status)}`} />
      <span className="va-history-related-task-prompt">{taskPromptSummary(task)}</span>
      <span className="va-history-related-task-time">{shortTime(task.createdAt)}</span>
      {isCompleted && audioUrl && task.type === TaskType.AUDIO && (
        <audio
          controls
          src={audioUrl}
          preload="metadata"
          className="ma-related-task-audio"
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
};
