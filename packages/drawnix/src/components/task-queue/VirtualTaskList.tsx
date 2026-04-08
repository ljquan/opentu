/**
 * VirtualTaskList Component
 *
 * A virtualized task list component that only renders visible items.
 * Uses @tanstack/react-virtual for efficient rendering of large lists.
 */

import React, { useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from 'tdesign-react';
import { ArrowUpIcon } from 'tdesign-icons-react';
import { Task } from '../../types/task.types';
import { TaskItem } from './TaskItem';

// Empty set singleton to avoid creating new objects on each render
const EMPTY_SET = new Set<string>();

// Estimated height for task items
const TASK_ITEM_HEIGHT = 140;
const TASK_ITEM_GAP = 0;
const OVERSCAN_COUNT = 3;
const COMPACT_LAYOUT_THRESHOLD = 375;

export interface VirtualTaskListProps {
  tasks: Task[];
  selectionMode?: boolean;
  selectedTaskIds?: Set<string>;
  onSelectionChange?: (taskId: string, selected: boolean) => void;
  onRetry?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
  onDownload?: (taskId: string) => void;
  onInsert?: (taskId: string) => void;
  onCopy?: (taskId: string) => void;
  onEdit?: (taskId: string) => void;
  onPreviewOpen?: (taskId: string) => void;
  onExtractCharacter?: (taskId: string) => void;
  className?: string;
  emptyContent?: React.ReactNode;
  /** Force compact layout */
  isCompact?: boolean;
  /** Whether there are more tasks to load */
  hasMore?: boolean;
  /** Whether more tasks are being loaded */
  isLoadingMore?: boolean;
  /** Callback to load more tasks */
  onLoadMore?: () => void;
  /** Total count of tasks */
  totalCount?: number;
  /** Loaded count of tasks */
  loadedCount?: number;
}

// Threshold for enabling virtualization
const VIRTUALIZATION_THRESHOLD = 20;

/**
 * VirtualTaskList component with optional virtualization
 * Uses simple rendering for small lists, virtualization for large lists
 */
export const VirtualTaskList: React.FC<VirtualTaskListProps> = ({
  tasks,
  selectionMode = false,
  selectedTaskIds,
  onSelectionChange,
  onRetry,
  onDelete,
  onDownload,
  onInsert,
  onCopy,
  onEdit,
  onPreviewOpen,
  onExtractCharacter,
  className = '',
  emptyContent,
  isCompact: forcedIsCompact,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  totalCount,
  loadedCount,
}) => {
  const stableSelectedTaskIds = selectedTaskIds ?? EMPTY_SET;
  const parentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const lastLoadMoreTimeRef = useRef<number>(0);
  // 惰性初始化：小屏幕默认使用紧凑布局（用屏幕宽度作为初始估计）
  const [internalIsCompact, setInternalIsCompact] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < COMPACT_LAYOUT_THRESHOLD) {
      return true;
    }
    return false;
  });
  const [showBackToTop, setShowBackToTop] = useState(false);

  // 统一的布局检测模式
  const isCompact = forcedIsCompact !== undefined ? forcedIsCompact : internalIsCompact;

  // 查找实际的滚动容器（可能是父级的 .side-drawer__content）
  const findScrollContainer = (element: HTMLElement | null): HTMLElement | null => {
    let current = element;
    while (current) {
      const style = getComputedStyle(current);
      const overflowY = style.overflowY;
      // 检查是否是滚动容器
      if (overflowY === 'auto' || overflowY === 'scroll') {
        // 确保它确实可以滚动（内容超出容器）
        if (current.scrollHeight > current.clientHeight) {
          return current;
        }
      }
      current = current.parentElement;
    }
    return null;
  };

  // 无限滚动：使用滚动事件监听替代 IntersectionObserver（更可靠）
  useEffect(() => {
    if (!hasMore || !onLoadMore) return;

    const container = parentRef.current;
    if (!container) return;

    // 延迟设置滚动监听，确保滚动容器已就绪
    const timer = setTimeout(() => {
      // 查找实际的滚动容器
      const selfScrollable = container.scrollHeight > container.clientHeight;
      const scrollRoot = selfScrollable ? container : findScrollContainer(container);
      scrollContainerRef.current = scrollRoot;

      if (!scrollRoot) return;

      const handleScroll = () => {
        // 检查是否滚动到底部附近（距离底部 300px 时触发加载）
        const { scrollTop, scrollHeight, clientHeight } = scrollRoot;
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;

        // 防抖：距上次加载不足 500ms 不重复触发，避免滚动时 loadMore 级联导致崩溃
        const now = Date.now();
        if (now - lastLoadMoreTimeRef.current < 500) return;

        if (distanceToBottom < 300 && hasMore && !isLoadingMore) {
          lastLoadMoreTimeRef.current = now;
          onLoadMore();
        }
      };

      scrollRoot.addEventListener('scroll', handleScroll, { passive: true });
      // 初始检查一次（可能内容不够一屏，需要立即加载更多）
      handleScroll();

      // 存储清理函数
      (container as any).__loadMoreCleanup = () => {
        scrollRoot.removeEventListener('scroll', handleScroll);
      };
    }, 150);

    return () => {
      clearTimeout(timer);
      (container as any).__loadMoreCleanup?.();
    };
  }, [hasMore, isLoadingMore, onLoadMore, tasks.length]);

  // 监听滚动位置以显示/隐藏回到顶部按钮
  useEffect(() => {
    const container = parentRef.current;
    if (!container) return;

    // 延迟查找滚动容器，确保 DOM 已完全渲染
    const timer = setTimeout(() => {
      // 先检查自身是否是滚动容器
      const selfScrollable = container.scrollHeight > container.clientHeight;
      const actualScrollContainer = selfScrollable ? container : findScrollContainer(container);
      scrollContainerRef.current = actualScrollContainer;

      if (!actualScrollContainer) return;

      const handleScroll = () => {
        // 当滚动超过一屏高度时显示按钮
        setShowBackToTop(actualScrollContainer.scrollTop > actualScrollContainer.clientHeight);
      };

      actualScrollContainer.addEventListener('scroll', handleScroll);
      // 初始检查一次
      handleScroll();

      // 存储清理函数到 ref，以便在 cleanup 时使用
      (container as any).__scrollCleanup = () => {
        actualScrollContainer.removeEventListener('scroll', handleScroll);
      };
    }, 100);

    return () => {
      clearTimeout(timer);
      (container as any).__scrollCleanup?.();
    };
  }, [tasks.length]); // 当任务数量变化时重新查找滚动容器

  // 回到顶部处理
  const scrollToTop = () => {
    const scrollContainer = scrollContainerRef.current || parentRef.current;
    if (scrollContainer) {
      // 直接设置 scrollTop，避免 smooth 动画问题
      scrollContainer.scrollTop = 0;
    }
  };

  // 使用一个全局的 ResizeObserver 监听容器宽度，批量同步给所有 TaskItem
  // 支持抽屉（.side-drawer__content）和弹窗（.t-dialog__body）等多种容器
  // 根据容器宽度判断是否使用紧凑布局
  useEffect(() => {
    if (forcedIsCompact !== undefined) return;

    const container = parentRef.current;
    if (!container) return;

    // 查找合适的父容器来监听宽度
    // 注意：监听 .side-drawer 而不是 .side-drawer__content，因为宽度变化发生在外层
    const targetElement = container;

    // 统一的布局检测函数 - 根据容器宽度判断
    const updateLayout = (containerWidth?: number) => {
      const width = containerWidth ?? targetElement.getBoundingClientRect().width;
      setInternalIsCompact(width < COMPACT_LAYOUT_THRESHOLD);
    };

    // 监听容器宽度变化（处理抽屉拖动、窗口缩放等）
    const resizeObserver = new ResizeObserver((entries) => {
      updateLayout(entries[0].contentRect.width);
    });
    resizeObserver.observe(targetElement);

    // 初始检查
    updateLayout();

    return () => {
      resizeObserver.disconnect();
    };
  }, [forcedIsCompact, parentRef.current]);

  // Only use virtualization for large lists
  const useVirtualization = tasks.length > VIRTUALIZATION_THRESHOLD;

  // Create virtualizer only when needed
  const virtualizer = useVirtualizer({
    count: useVirtualization ? tasks.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TASK_ITEM_HEIGHT + TASK_ITEM_GAP,
    overscan: OVERSCAN_COUNT,
    enabled: useVirtualization,
    measureElement: (el) => {
      // 优化测量：使用 offsetHeight 避免 layout thrashing
      return (el as HTMLElement).offsetHeight;
    },
  });

  // Handle empty state
  if (tasks.length === 0) {
    return (
      <div className={`virtual-task-list virtual-task-list--empty ${className}`}>
        {emptyContent}
      </div>
    );
  }

  // 实际已加载数量（优先使用 tasks.length，因为它是最准确的）
  const actualLoadedCount = tasks.length || loadedCount || 0;

  // 加载更多指示器组件
  const LoadMoreIndicator = () => (
    <>
      {/* 加载状态显示 */}
      {isLoadingMore && (
        <div className="virtual-task-list__loading-more">
          <span className="virtual-task-list__loading-spinner" />
          <span>加载中...</span>
        </div>
      )}
      {/* 分页信息 - 有更多数据待加载时显示 */}
      {hasMore && !isLoadingMore && totalCount !== undefined && totalCount > 0 && (
        <div className="virtual-task-list__pagination-info">
          已加载 {actualLoadedCount} / {totalCount}
        </div>
      )}
      {/* 没有更多数据提示 - 全部加载完成时显示 */}
      {!hasMore && tasks.length > 0 && totalCount !== undefined && totalCount > 50 && (
        <div className="virtual-task-list__no-more">
          已加载全部 {totalCount} 个任务
        </div>
      )}
    </>
  );

  // Simple rendering for small lists
  if (!useVirtualization) {
    return (
      <div 
        ref={containerRef}
        className={`virtual-task-list-container ${className}`}
        style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}
      >
        <div 
          ref={parentRef}
          className="virtual-task-list-scrollarea"
          style={{ flex: 1, overflow: 'auto' }}
        >
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              selectionMode={selectionMode}
              isSelected={stableSelectedTaskIds.has(task.id)}
              isCompact={isCompact}
              onSelectionChange={onSelectionChange}
              onRetry={onRetry}
              onDelete={onDelete}
              onDownload={onDownload}
              onInsert={onInsert}
              onEdit={onEdit}
              onPreviewOpen={() => onPreviewOpen?.(task.id)}
              onExtractCharacter={onExtractCharacter}
            />
          ))}
          <LoadMoreIndicator />
        </div>

        {showBackToTop && (
          <Button
            shape="circle"
            variant="base"
            theme="default"
            icon={<ArrowUpIcon />}
            onClick={scrollToTop}
            className="virtual-task-list__back-to-top"
          />
        )}
      </div>
    );
  }

  // Virtualized rendering for large lists
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      className={`virtual-task-list-container ${className}`}
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={parentRef}
        className="virtual-task-list-scrollarea"
        style={{
          flex: 1,
          width: '100%',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualItem) => {
            const task = tasks[virtualItem.index];
            if (!task) return null;

            return (
              <div
                key={task.id}
                data-index={virtualItem.index}
                ref={(node) => {
                  if (node) {
                    virtualizer.measureElement(node);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                  paddingBottom: `${TASK_ITEM_GAP}px`,
                }}
              >
                <TaskItem
                  task={task}
                  selectionMode={selectionMode}
                  isSelected={stableSelectedTaskIds.has(task.id)}
                  isCompact={isCompact}
                  onSelectionChange={onSelectionChange}
                  onRetry={onRetry}
                  onDelete={onDelete}
                  onDownload={onDownload}
                  onInsert={onInsert}
                  onCopy={onCopy}
                  onEdit={onEdit}
                  onPreviewOpen={() => onPreviewOpen?.(task.id)}
                  onExtractCharacter={onExtractCharacter}
                />
              </div>
            );
          })}
        </div>
        <LoadMoreIndicator />
      </div>

      {showBackToTop && (
        <Button
          shape="circle"
          variant="base"
          theme="default"
          icon={<ArrowUpIcon />}
          onClick={scrollToTop}
          className="virtual-task-list__back-to-top"
        />
      )}
    </div>
  );
};

export default VirtualTaskList;
