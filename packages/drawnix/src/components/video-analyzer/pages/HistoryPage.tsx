/**
 * 历史记录页 - 分析历史列表 + 收藏 + 删除 + 关联任务展开
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { AnalysisRecord } from '../types';
import { updateRecord, deleteRecord } from '../storage';
import { useSharedTaskState } from '../../../hooks/useTaskQueue';
import type { Task } from '../../../types/task.types';
import { TaskType } from '../../../types/task.types';
import {
  UnifiedMediaViewer,
  type MediaItem,
} from '../../shared/media-preview';
import { ConfirmDialog } from '../../dialog/ConfirmDialog';
import {
  HistoryRecordCard,
  getTaskMediaUrls,
  type RelatedTasks,
} from '../components/HistoryRecordCard';

interface HistoryPageProps {
  records: AnalysisRecord[];
  onSelect: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
  showStarredOnly?: boolean;
  onInsertTask?: (task: Task) => void;
  /** 点击脚本改编任务时，跳转到该记录的脚本页 */
  onSelectScript?: (record: AnalysisRecord, task: Task) => void;
}

function buildPreviewTitle(task: Task, index: number, total: number): string {
  const baseTitle =
    task.result?.title ||
    task.params.title ||
    task.params.prompt ||
    (task.type === TaskType.VIDEO ? '视频预览' : '图片预览');

  return total > 1 ? `${baseTitle} (${index + 1}/${total})` : baseTitle;
}

function buildPreviewItems(tasks: Task[]): {
  items: MediaItem[];
  taskIdToIndex: Map<string, number>;
} {
  const items: MediaItem[] = [];
  const taskIdToIndex = new Map<string, number>();

  for (const task of tasks) {
    if (task.type !== TaskType.IMAGE && task.type !== TaskType.VIDEO) {
      continue;
    }

    const urls = getTaskMediaUrls(task);
    if (urls.length === 0) {
      continue;
    }

    const startIndex = items.length;
    const posterUrl =
      task.type === TaskType.VIDEO
        ? task.result?.thumbnailUrls?.[0] || task.result?.thumbnailUrl || undefined
        : undefined;

    urls.forEach((url, index) => {
      items.push({
        id: urls.length > 1 ? `${task.id}-${index}` : task.id,
        url,
        type: task.type === TaskType.VIDEO ? 'video' : 'image',
        title: buildPreviewTitle(task, index, urls.length),
        prompt: task.params.prompt,
        posterUrl: task.type === TaskType.VIDEO ? posterUrl : undefined,
      });
    });

    taskIdToIndex.set(task.id, startIndex);
  }

  return { items, taskIdToIndex };
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
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewItems, setPreviewItems] = useState<MediaItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
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

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteId) {
      return;
    }

    const updated = await deleteRecord(pendingDeleteId);
    onRecordsChange(updated);
    setPendingDeleteId(null);
  }, [onRecordsChange, pendingDeleteId]);

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

  const handlePreviewOpen = useCallback((e: React.MouseEvent, task: Task, previewTasks: Task[]) => {
    e.stopPropagation();
    const { items, taskIdToIndex } = buildPreviewItems(previewTasks);
    const initialIndex = taskIdToIndex.get(task.id);
    if (!items.length || initialIndex === undefined) {
      return;
    }
    setPreviewItems(items);
    setPreviewInitialIndex(initialIndex);
    setPreviewVisible(true);
  }, []);

  const handlePreviewClose = useCallback(() => {
    setPreviewVisible(false);
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
          {filtered.map(record => {
            const related = relatedTasksMap.get(record.id);
            const isExpanded = expandedId === record.id;

            return (
              <HistoryRecordCard
                key={record.id}
                record={record}
                related={related}
                isExpanded={isExpanded}
                onSelect={onSelect}
                onToggleStar={handleToggleStar}
                onDelete={handleDelete}
                onToggleExpand={handleToggleExpand}
                onInsertTask={handleInsertClick}
                onPreviewOpen={handlePreviewOpen}
                onSelectScript={handleScriptClick}
              />
            );
          })}
        </div>
      </div>

      <UnifiedMediaViewer
        visible={previewVisible}
        items={previewItems}
        initialIndex={previewInitialIndex}
        onClose={handlePreviewClose}
        showThumbnails={previewItems.length > 1}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="确认删除"
        description="确定要删除这条历史记录吗？此操作不可撤销。"
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
