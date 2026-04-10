/**
 * ArchivedTaskList Component
 *
 * 历史任务列表，从 IndexedDB 分页加载已归档的任务。
 * 只读展示，支持预览和滚动加载更多。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Loading } from 'tdesign-react';
import { Task } from '../../types/task.types';
import { taskStorageReader } from '../../services/task-storage-reader';
import { TaskItem } from './TaskItem';

const PAGE_SIZE = 30;

export interface ArchivedTaskListProps {
  onPreviewOpen?: (taskId: string) => void;
  onDownload?: (taskId: string) => void;
  className?: string;
}

export const ArchivedTaskList: React.FC<ArchivedTaskListProps> = ({
  onPreviewOpen,
  onDownload,
  className,
}) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadTasks = useCallback(async (offset: number) => {
    try {
      const result = await taskStorageReader.getArchivedTasks(offset, PAGE_SIZE);
      return result;
    } catch {
      return { tasks: [], hasMore: false };
    }
  }, []);

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    offsetRef.current = 0;

    loadTasks(0).then((result) => {
      if (cancelled) return;
      setTasks(result.tasks);
      setHasMore(result.hasMore);
      offsetRef.current = result.tasks.length;
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [loadTasks]);

  // 加载更多
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const result = await loadTasks(offsetRef.current);
    setTasks((prev) => [...prev, ...result.tasks]);
    setHasMore(result.hasMore);
    offsetRef.current += result.tasks.length;
    setLoadingMore(false);
  }, [loadingMore, hasMore, loadTasks]);

  // 滚动到底部自动加载
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        handleLoadMore();
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [handleLoadMore]);

  if (loading) {
    return (
      <div className="task-queue-panel__empty">
        <Loading size="small" />
        <div className="task-queue-panel__empty-text">加载历史任务...</div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="task-queue-panel__empty">
        <div className="task-queue-panel__empty-icon">📦</div>
        <div className="task-queue-panel__empty-text">暂无历史任务</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ overflow: 'auto', height: '100%' }}
    >
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          onPreviewOpen={onPreviewOpen ? () => onPreviewOpen(task.id) : undefined}
          onDownload={onDownload}
        />
      ))}
      {hasMore && (
        <div style={{ padding: '12px', textAlign: 'center' }}>
          {loadingMore ? (
            <Loading size="small" />
          ) : (
            <Button
              size="small"
              variant="text"
              theme="default"
              onClick={handleLoadMore}
            >
              加载更多
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
