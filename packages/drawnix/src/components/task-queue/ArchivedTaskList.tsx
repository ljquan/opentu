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
import type { TaskQueueFilters } from '../../utils/task-queue-filters';
import { TaskItem } from './TaskItem';

const PAGE_SIZE = 30;

export interface ArchivedTaskListProps {
  onPreviewOpen?: (taskId: string) => void;
  onDownload?: (taskId: string) => void;
  className?: string;
  filters?: TaskQueueFilters;
}

export const ArchivedTaskList: React.FC<ArchivedTaskListProps> = ({
  onPreviewOpen,
  onDownload,
  className,
  filters,
}) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestVersionRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const { searchText, createdAtFrom, createdAtTo } = filters || {};
  const hasFilters = Boolean(
    searchText?.trim() ||
      createdAtFrom !== undefined ||
      createdAtTo !== undefined
  );

  const loadTasks = useCallback(
    (offset: number) =>
      taskStorageReader.getArchivedTasks(offset, PAGE_SIZE, {
        searchText,
        createdAtFrom,
        createdAtTo,
      }),
    [searchText, createdAtFrom, createdAtTo]
  );

  // 初始加载
  useEffect(() => {
    const version = ++requestVersionRef.current;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setError(false);
    setTasks([]);
    offsetRef.current = 0;
    if (containerRef.current) containerRef.current.scrollTop = 0;

    loadTasks(0)
      .then((result) => {
        if (requestVersionRef.current !== version) return;
        setTasks(result.tasks);
        setHasMore(result.hasMore);
        offsetRef.current = result.tasks.length;
      })
      .catch(() => {
        if (requestVersionRef.current === version) setError(true);
      })
      .finally(() => {
        if (requestVersionRef.current !== version) return;
        setLoading(false);
      });

    return () => {
      requestVersionRef.current = version + 1;
    };
  }, [loadTasks, reload]);

  // 加载更多
  const handleLoadMore = useCallback(async () => {
    if (loading || loadingMoreRef.current || !hasMore) return;
    const version = requestVersionRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(false);
    try {
      const result = await loadTasks(offsetRef.current);
      if (requestVersionRef.current !== version) return;
      setTasks((prev) => [...prev, ...result.tasks]);
      setHasMore(result.hasMore);
      offsetRef.current += result.tasks.length;
    } catch {
      if (requestVersionRef.current === version) setError(true);
    } finally {
      if (requestVersionRef.current === version) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [loading, hasMore, loadTasks]);

  // 滚动到底部自动加载
  useEffect(() => {
    const el = containerRef.current;
    if (!el || error) return;

    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        handleLoadMore();
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [handleLoadMore, error]);

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
        <div className="task-queue-panel__empty-text" role="status">
          {error
            ? '历史任务加载失败，请重试'
            : hasFilters
            ? '没有符合筛选条件的历史任务'
            : '暂无历史任务'}
        </div>
        {error && (
          <Button size="small" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="历史任务列表"
      className={className}
      style={{ overflow: 'auto', height: '100%' }}
    >
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          onPreviewOpen={
            onPreviewOpen ? () => onPreviewOpen(task.id) : undefined
          }
          onDownload={onDownload}
        />
      ))}
      {hasMore && (
        <div style={{ padding: '12px', textAlign: 'center' }}>
          {error && <div role="alert">加载失败，请重试</div>}
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
