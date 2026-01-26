/**
 * TaskItem Component
 *
 * Displays a single task with its details, status, and action buttons.
 * Shows input parameters (prompt) and output results when completed.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button, Tag, Tooltip, Checkbox } from 'tdesign-react';
import { ImageIcon, VideoIcon, DeleteIcon, DownloadIcon, EditIcon, UserIcon, CheckCircleFilledIcon, PlayCircleIcon, CloseCircleIcon } from 'tdesign-icons-react';
import { Task, TaskStatus, TaskType } from '../../types/task.types';
import { formatDateTime, formatTaskDuration } from '../../utils/task-utils';
import { useUnifiedCache } from '../../hooks/useUnifiedCache';
import { supportsCharacterExtraction, isSora2VideoId } from '../../types/character.types';
import { RetryImage } from '../retry-image';
import { TaskProgressOverlay } from './TaskProgressOverlay';
import { useThumbnailUrl } from '../../hooks/useThumbnailUrl';
import './task-queue.scss';
import './task-progress-overlay.scss';

// 布局切换阈值：容器宽度小于此值时使用紧凑布局（info 在图片下方全宽）
// 弹窗侧栏宽度约 280px-500px，任务队列面板宽度约 300px-600px
const COMPACT_LAYOUT_THRESHOLD = 500;

export interface TaskItemProps {
  /** The task to display */
  task: Task;
  /** Whether selection mode is active */
  selectionMode?: boolean;
  /** Whether this task is selected */
  isSelected?: boolean;
  /** Forced layout mode from parent */
  isCompact?: boolean;
  /** Callback when selection changes */
  onSelectionChange?: (taskId: string, selected: boolean) => void;
  /** Callback when retry button is clicked */
  onRetry?: (taskId: string) => void;
  /** Callback when delete button is clicked */
  onDelete?: (taskId: string) => void;
  /** Callback when download button is clicked */
  onDownload?: (taskId: string) => void;
  /** Callback when insert to board button is clicked */
  onInsert?: (taskId: string) => void;
  /** Callback when preview is opened */
  onPreviewOpen?: () => void;
  /** Callback when edit button is clicked */
  onEdit?: (taskId: string) => void;
  /** Callback when extract character button is clicked */
  onExtractCharacter?: (taskId: string) => void;
}

/**
 * Gets the appropriate status tag color based on task status
 * Note: PENDING is deprecated, treated same as PROCESSING for legacy compatibility
 */
function getStatusTagTheme(status: TaskStatus): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case TaskStatus.PENDING:
    case TaskStatus.PROCESSING:
      return 'primary';
    case TaskStatus.COMPLETED:
      return 'success';
    case TaskStatus.FAILED:
      return 'danger';
    case TaskStatus.CANCELLED:
      return 'default';
    default:
      return 'default';
  }
}

/**
 * Gets the status label in Chinese
 * Note: PENDING is deprecated, displayed as '处理中' for legacy compatibility
 */
function getStatusLabel(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.PENDING:
    case TaskStatus.PROCESSING:
      return '处理中';
    case TaskStatus.COMPLETED:
      return '已完成';
    case TaskStatus.FAILED:
      return '失败';
    case TaskStatus.CANCELLED:
      return '已取消';
    default:
      return '未知';
  }
}

/**
 * TaskItem component - displays a single task
 */
export const TaskItem: React.FC<TaskItemProps> = React.memo(({
  task,
  selectionMode = false,
  isSelected = false,
  isCompact: forcedIsCompact,
  onSelectionChange,
  onRetry,
  onDelete,
  onDownload,
  onInsert,
  onPreviewOpen,
  onEdit,
  onExtractCharacter,
}) => {
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [internalIsCompact, setInternalIsCompact] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isCompleted = task.status === TaskStatus.COMPLETED;
  const isFailed = task.status === TaskStatus.FAILED;

  // 使用传入的布局模式，如果没有传入则使用内部的 ResizeObserver（兼容旧用法）
  const isCompactLayout = forcedIsCompact !== undefined ? forcedIsCompact : internalIsCompact;

  // 使用 ResizeObserver 监听容器宽度，切换布局模式
  useEffect(() => {
    if (forcedIsCompact !== undefined) return; // 如果有外部传入的模式，不需要内部观察

    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setInternalIsCompact(width < COMPACT_LAYOUT_THRESHOLD);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [forcedIsCompact]);

  // Check if task supports character extraction (Sora-2 completed video tasks)
  // Note: Storyboard mode videos do not support character extraction
  const isStoryboardVideo = task.params.storyboard?.enabled === true;
  const canExtractCharacter =
    isCompleted &&
    task.type === TaskType.VIDEO &&
    isSora2VideoId(task.remoteId) &&
    supportsCharacterExtraction(task.params.model) &&
    !isStoryboardVideo;

  // Check if this is a character task
  const isCharacterTask = task.type === TaskType.CHARACTER;

  // Unified cache hook (skip for character tasks)
  const { isCached } = useUnifiedCache(
    isCharacterTask ? undefined : task.result?.url
  );

  // Use original URL or cached URL (Service Worker handles caching automatically)
  const mediaUrl = task.result?.url;
  
  // 获取预览图URL（任务列表使用小尺寸）
  const thumbnailUrl = useThumbnailUrl(
    mediaUrl,
    task.type === TaskType.IMAGE ? 'image' : task.type === TaskType.VIDEO ? 'video' : undefined,
    'small' // 任务列表使用小尺寸预览图
  );

  // Load image to get actual dimensions
  useEffect(() => {
    if (isCompleted && mediaUrl && task.type === TaskType.IMAGE) {
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        // If image fails to load, keep dimensions null
        setImageDimensions(null);
      };
      img.src = mediaUrl;
    }
  }, [isCompleted, mediaUrl, task.type]);

  // Build detailed tooltip content
  const buildTooltipContent = () => {
    const displayWidth = imageDimensions?.width || task.result?.width || task.params.width;
    const displayHeight = imageDimensions?.height || task.result?.height || task.params.height;

    return (
      <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
        <div><strong>提示词：</strong>{task.params.prompt}</div>
        <div><strong>状态：</strong>{getStatusLabel(task.status)}</div>
        {task.params.model && <div><strong>模型：</strong>{task.params.model}</div>}
        {displayWidth && displayHeight && (
          <div><strong>尺寸：</strong>{displayWidth}x{displayHeight}</div>
        )}
        {task.type === TaskType.VIDEO && task.params.seconds && (
          <div><strong>时长：</strong>{task.params.seconds}秒</div>
        )}
        {task.type === TaskType.VIDEO && task.params.size && (
          <div><strong>分辨率：</strong>{task.params.size}</div>
        )}
        {task.params.batchId && task.params.batchIndex && task.params.batchTotal && (
          <div><strong>批量：</strong>{task.params.batchIndex}/{task.params.batchTotal}</div>
        )}
        <div><strong>创建时间：</strong>{formatDateTime(task.createdAt)}</div>
        {task.startedAt && (
          <div><strong>执行时长：</strong>{formatTaskDuration(
            (task.completedAt || Date.now()) - task.startedAt
          )}</div>
        )}
        {task.type === TaskType.VIDEO && (
          <div><strong>进度：</strong>{task.progress ?? 0}%</div>
        )}
      </div>
    );
  };

  // Handle click on task item to toggle selection or open preview
  const handleItemClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // 排除按钮、复选框、链接等交互元素的点击
    if (target.closest('button') || target.closest('.t-checkbox') || target.closest('a')) return;
    
    if (selectionMode) {
      onSelectionChange?.(task.id, !isSelected);
    } else if (isCompleted && mediaUrl) {
      onPreviewOpen?.();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`task-item ${selectionMode ? 'task-item--selection-mode' : ''} ${isSelected ? 'task-item--selected' : ''} ${isCompactLayout ? 'task-item--compact' : 'task-item--wide'} task-item--${task.status.toLowerCase()}`}
      onClick={handleItemClick}
    >
        {/* Selection checkbox - Move to an overlay or separate grid area */}
        {selectionMode && (
          <div className="task-item__checkbox">
            <Checkbox
              checked={isSelected}
              onChange={(checked) => onSelectionChange?.(task.id, checked as boolean)}
            />
          </div>
        )}

      {/* 1. Preview Area - Visual entry point */}
      {(isCompleted || isFailed || task.status === TaskStatus.PROCESSING) && (mediaUrl || isCharacterTask || task.type === TaskType.VIDEO || task.type === TaskType.IMAGE) && (
        <div className="task-item__preview-wrapper">
          <div className="task-item__preview" data-track="task_click_preview" onClick={onPreviewOpen}>
            {/* 失败状态：显示失败占位图 */}
            {isFailed ? (
              <div className="task-item__preview-failed">
                <CloseCircleIcon size="24px" />
                <span>生成失败</span>
              </div>
            ) : task.status === TaskStatus.PROCESSING ? (
              /* 处理中状态：只显示进度覆盖层，不显示其他内容 */
              <TaskProgressOverlay
                key={task.startedAt} // 重试时 startedAt 变化，强制重新挂载以重置进度
                taskType={task.type}
                taskStatus={task.status}
                realProgress={task.progress}
                startedAt={task.startedAt}
                mediaUrl={mediaUrl}
              />
            ) : (
              <>
                {/* 已完成状态：显示实际内容 */}
                {task.type === TaskType.IMAGE && mediaUrl ? (
                  <RetryImage
                    src={thumbnailUrl || mediaUrl}
                    alt="Generated"
                    maxRetries={5}
                    fallback={
                      <div className="task-item__preview-placeholder">
                        <span>图片加载失败</span>
                      </div>
                    }
                  />
                ) : isCharacterTask && task.result?.characterProfileUrl ? (
                  <div className="task-item__character-preview">
                    <RetryImage
                      src={task.result.characterProfileUrl}
                      alt={`@${task.result.characterUsername}`}
                      maxRetries={5}
                      fallback={
                        <div className="task-item__character-fallback">
                          <UserIcon size="32px" />
                        </div>
                      }
                    />
                  </div>
                ) : mediaUrl ? (
                  <>
                    <video src={mediaUrl} muted playsInline poster={thumbnailUrl || undefined} />
                    {/* 视频播放按钮覆盖层 */}
                    <div className="task-item__video-play-overlay">
                      <PlayCircleIcon size="32px" />
                    </div>
                  </>
                ) : (
                  <div className="task-item__preview-placeholder">
                    {task.type === TaskType.IMAGE ? <ImageIcon size="24px" /> : <VideoIcon size="24px" />}
                  </div>
                )}
                
                {/* Cache indicator */}
                {isCached && !isCharacterTask && (
                  <div className="task-item__cache-badge">
                    <CheckCircleFilledIcon />
                    <span>已缓存</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 2. Content Area (Prompt + Info) */}
      <div className="task-item__body">
        {/* Prompt Area */}
        <div className="task-item__prompt-area">
          <div className="task-item__prompt" title={task.params.prompt}>
            {isCharacterTask ? (
              isCompleted && task.result?.characterUsername
                ? `@${task.result.characterUsername}`
                : '角色创建中...'
            ) : task.params.prompt}
          </div>
        </div>

        {/* Info Area - Meta & Actions */}
        <div className="task-item__info-area">
          <div className="task-item__content-row">
            <div className="task-item__meta">
              <div className="task-item__tags">
                {/* Status Tag */}
                <Tag theme={getStatusTagTheme(task.status)} variant="light" className="task-item__status-tag">
                  {getStatusLabel(task.status)}
                </Tag>

                {/* Model Tag */}
                {task.params.model && (
                  <Tag variant="outline" className="task-item__model-tag">
                    {task.params.model}
                  </Tag>
                )}

                {/* Video/Image specific meta as tags */}
                {task.type === TaskType.VIDEO && task.params.seconds && (
                  <Tag variant="outline">{task.params.seconds}s</Tag>
                )}
                {task.type === TaskType.VIDEO && task.params.size && (
                  <Tag variant="outline">{task.params.size}</Tag>
                )}
                {task.params.batchId && task.params.batchIndex && (
                  <Tag variant="outline">批量 {task.params.batchIndex}/{task.params.batchTotal}</Tag>
                )}
              </div>

              <div className="task-item__details">
                <span className="task-item__time">{formatDateTime(task.createdAt)}</span>
                {task.startedAt && (
                  <span className="task-item__duration">
                    · {formatTaskDuration((task.completedAt || Date.now()) - task.startedAt)}
                  </span>
                )}
                {(() => {
                  const displayWidth = imageDimensions?.width || task.result?.width || task.params.width;
                  const displayHeight = imageDimensions?.height || task.result?.height || task.params.height;
                  if (displayWidth && displayHeight) {
                    return <span className="task-item__size"> · {displayWidth}x{displayHeight}</span>;
                  }
                  return null;
                })()}
                {isCompleted && task.result?.url && (
                  <a
                    href={task.result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="task-item__link"
                    data-track="task_click_open_link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    · 打开链接
                  </a>
                )}
              </div>

              {/* Progress bar for video tasks (outside tags) */}
              {task.type === TaskType.VIDEO && task.status === TaskStatus.PROCESSING && (
                <div className="task-item__progress-container">
                  <div className="task-item__progress-bar">
                    <div
                      className={`task-item__progress-fill task-item__progress-fill--${task.status}`}
                      style={{ width: `${task.progress ?? 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="task-item__actions">
              {/* Secondary Actions - Simple icons */}
              <div className="task-item__secondary-actions">
                {isCompleted && task.result?.url && !isCharacterTask && (
                  <Tooltip content="下载" theme="light">
                    <Button
                      size="small"
                      variant="text"
                      icon={<DownloadIcon />}
                      onClick={(e) => { e.stopPropagation(); onDownload?.(task.id); }}
                    />
                  </Tooltip>
                )}

                {!isCharacterTask && (
                  <Tooltip content="编辑" theme="light">
                    <Button
                      size="small"
                      variant="text"
                      icon={<EditIcon />}
                      onClick={(e) => { e.stopPropagation(); onEdit?.(task.id); }}
                    />
                  </Tooltip>
                )}

                {canExtractCharacter && (
                  <Tooltip content="角色" theme="light">
                    <Button
                      size="small"
                      variant="text"
                      icon={<UserIcon />}
                      onClick={(e) => { e.stopPropagation(); onExtractCharacter?.(task.id); }}
                    />
                  </Tooltip>
                )}

                <Tooltip content="删除" theme="light">
                  <Button
                    size="small"
                    variant="text"
                    className="task-item__delete-btn"
                    icon={<DeleteIcon />}
                    onClick={(e) => { e.stopPropagation(); onDelete?.(task.id); }}
                  />
                </Tooltip>
              </div>

              {/* Primary Action Button (Insert/Retry) - Moved to far right */}
              {isCompleted && task.result?.url && !isCharacterTask && (
                <Button
                  size="small"
                  theme="primary"
                  className="task-item__primary-action"
                  data-track="task_click_insert"
                  onClick={(e) => { e.stopPropagation(); onInsert?.(task.id); }}
                >
                  插入
                </Button>
              )}

              {isFailed && (
                <Button
                  size="small"
                  theme="primary"
                  className="task-item__primary-action"
                  data-track="task_click_retry"
                  onClick={(e) => { e.stopPropagation(); onRetry?.(task.id); }}
                >
                  重试
                </Button>
              )}
            </div>
          </div>

          {/* Error Message */}
          {isFailed && task.error && (
            <div className="task-item__error">
              <div className="task-item__error-message">
                {task.error.message}
                {task.error.details?.originalError && (
                  <Tooltip
                    content={
                      <div className="task-item__error-details-tooltip">
                        <div className="task-item__error-details-title">详细错误:</div>
                        <div className="task-item__error-details-content">
                          {task.error.details.originalError}
                        </div>
                      </div>
                    }
                    theme="light"
                    placement="bottom"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="task-item__error-details-link">[详情]</span>
                  </Tooltip>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}, (prev, next) => {
  // 性能优化：仅在关键属性变化时重绘
  return prev.task.id === next.task.id && 
         prev.task.status === next.task.status &&
         prev.task.progress === next.task.progress &&
         prev.isSelected === next.isSelected &&
         prev.selectionMode === next.selectionMode &&
         prev.isCompact === next.isCompact;
});
