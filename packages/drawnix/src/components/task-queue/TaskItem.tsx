/**
 * TaskItem Component
 *
 * Displays a single task with its details, status, and action buttons.
 * Shows input parameters (prompt) and output results when completed.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button, Tag, Tooltip, Checkbox } from 'tdesign-react';
import { ImageIcon, VideoIcon, DeleteIcon, DownloadIcon, EditIcon, UserIcon, PlayCircleIcon, CloseCircleIcon, CopyIcon } from 'tdesign-icons-react';
import { normalizeImageDataUrl } from '@aitu/utils';
import { Task, TaskStatus, TaskType } from '../../types/task.types';
import { formatDateTime, formatTaskDuration } from '../../utils/task-utils';
import { useUnifiedCache } from '../../hooks/useUnifiedCache';
import { supportsCharacterExtraction, isSora2VideoId } from '../../types/character.types';
import { RetryImage } from '../retry-image';
import { TaskProgressOverlay } from './TaskProgressOverlay';
import { useThumbnailUrl } from '../../hooks/useThumbnailUrl';
import { getLyricsPreview, getLyricsTags, getLyricsText, getLyricsTitle, isLyricsResult } from '../../utils/lyrics-task-utils';
import { VideoPosterPreview } from '../shared/VideoPosterPreview';
import './task-queue.scss';
import './task-progress-overlay.scss';

// 布局切换阈值：容器宽度小于此值时使用紧凑布局（info 在图片下方全宽）
// 弹窗侧栏宽度约 280px-500px，任务队列面板宽度约 300px-600px
const COMPACT_LAYOUT_THRESHOLD = 500;

function formatAudioDuration(duration?: number): string | null {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeNestedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isKlingTaskModel(model?: string): boolean {
  if (!model) {
    return false;
  }

  const normalized = model.toLowerCase();
  return normalized === 'kling_video' || normalized.startsWith('kling-v');
}

function getKlingActionLabel(action?: string): string | undefined {
  if (action === 'text2video') {
    return '文生视频';
  }
  if (action === 'image2video') {
    return '图生视频';
  }
  return undefined;
}

function getKlingModeLabel(mode?: string): string | undefined {
  if (mode === 'std') {
    return 'std 高性能';
  }
  if (mode === 'pro') {
    return 'pro 高表现';
  }
  return mode;
}

function getVideoAnalyzerAction(task: Task): 'analyze' | 'rewrite' | null {
  const action = task.params.videoAnalyzerAction;
  return action === 'analyze' || action === 'rewrite' ? action : null;
}

function getVideoAnalyzerSubtitle(task: Task): string | null {
  const action = getVideoAnalyzerAction(task);
  if (action === 'analyze') {
    const sourceLabel = normalizeNestedString(task.params.videoAnalyzerSourceLabel);
    return sourceLabel || null;
  }

  if (action === 'rewrite') {
    const prompt = normalizeNestedString(task.params.prompt);
    if (!prompt) {
      return null;
    }
    return prompt.replace(/^改编脚本：\s*/, '');
  }

  return null;
}

function getVideoAnalyzerTypeTag(task: Task): string | null {
  const action = getVideoAnalyzerAction(task);
  if (action === 'analyze') {
    return '视频分析';
  }
  if (action === 'rewrite') {
    return '脚本改编';
  }
  return null;
}

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
  /** Callback when lyrics copy button is clicked */
  onCopy?: (taskId: string) => void;
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
  onCopy,
  onPreviewOpen,
  onEdit,
  onExtractCharacter,
}) => {
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [internalIsCompact, setInternalIsCompact] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isCompleted = task.status === TaskStatus.COMPLETED;
  const isFailed = task.status === TaskStatus.FAILED;
  const isCancelled = task.status === TaskStatus.CANCELLED;
  const isRetryable = isFailed || isCancelled;

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
  const isAudioTask = task.type === TaskType.AUDIO;
  const isChatTask = task.type === TaskType.CHAT;
  const isLyricsTask = isAudioTask && isLyricsResult(task.result);
  const isPreviewableTask =
    task.type === TaskType.IMAGE || task.type === TaskType.VIDEO || (task.type === TaskType.AUDIO && !isLyricsTask);
  const lyricsText = getLyricsText(task.result);
  const lyricsTitle = getLyricsTitle(
    task.result,
    task.params.title || task.params.prompt
  );
  const lyricsPreview = getLyricsPreview(lyricsText);
  const lyricsTags = getLyricsTags(task.result);
  const videoAnalyzerAction = getVideoAnalyzerAction(task);
  const videoAnalyzerSubtitle = getVideoAnalyzerSubtitle(task);
  const videoAnalyzerTypeTag = getVideoAnalyzerTypeTag(task);
  const displayPrompt = isCharacterTask
    ? isCompleted && task.result?.characterUsername
      ? `@${task.result.characterUsername}`
      : '角色创建中...'
    : isChatTask
    ? task.result?.title || task.params.prompt || task.result?.chatResponse
    : isLyricsTask
    ? lyricsTitle || lyricsPreview || task.params.prompt
    : task.result?.title || task.params.title || task.params.prompt;
  const extraParams =
    task.params.params && typeof task.params.params === 'object'
      ? (task.params.params as Record<string, unknown>)
      : null;
  const audioDurationLabel =
    task.type === TaskType.AUDIO && !isLyricsTask
      ? formatAudioDuration(task.result?.duration)
      : null;
  const isKlingVideoTask =
    task.type === TaskType.VIDEO && isKlingTaskModel(task.params.model);
  const klingModelVersion =
    normalizeNestedString(extraParams?.model_name) ||
    (task.params.model?.toLowerCase().startsWith('kling-v')
      ? task.params.model
      : undefined);
  const klingMode = getKlingModeLabel(normalizeNestedString(extraParams?.mode));
  const klingAction = normalizeNestedString(extraParams?.klingAction2);
  const klingActionLabel = getKlingActionLabel(klingAction);
  const klingCfgScale = normalizeNestedString(extraParams?.cfg_scale);

  // Unified cache hook (skip for character tasks)
  const rawMediaUrl = isLyricsTask
    ? undefined
    : task.result?.urls?.[0] || task.result?.url;
  const mediaUrl =
    task.type === TaskType.IMAGE && rawMediaUrl
      ? normalizeImageDataUrl(rawMediaUrl)
      : rawMediaUrl;

  const { isCached } = useUnifiedCache(
    isCharacterTask || isAudioTask ? undefined : mediaUrl
  );

  // Use original URL or cached URL (Service Worker handles caching automatically)
  const mediaCount = isLyricsTask
    ? 0
    : task.result?.urls?.length || (task.result?.url ? 1 : 0);
  const previewMediaUrl = isAudioTask
    ? isLyricsTask
      ? undefined
      : task.result?.previewImageUrl
    : mediaUrl;
  
  // 获取预览图URL（任务列表使用小尺寸）
  const thumbnailUrl = useThumbnailUrl(
    previewMediaUrl,
    task.type === TaskType.IMAGE ? 'image' : undefined,
    'small' // 任务列表使用小尺寸预览图
  );

  // Load image to get actual dimensions
  useEffect(() => {
    if (isCompleted && previewMediaUrl && task.type === TaskType.IMAGE) {
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        // If image fails to load, keep dimensions null
        setImageDimensions(null);
      };
      img.src = previewMediaUrl;
    }
  }, [isCompleted, previewMediaUrl, task.type]);

  // Build detailed tooltip content
  const buildTooltipContent = () => {
    const displayWidth = imageDimensions?.width || task.result?.width || task.params.width;
    const displayHeight = imageDimensions?.height || task.result?.height || task.params.height;

    return (
      <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
        <div><strong>提示词：</strong>{task.params.prompt}</div>
        <div><strong>状态：</strong>{getStatusLabel(task.status)}</div>
        {task.params.model && <div><strong>模型：</strong>{task.params.model}</div>}
        {isKlingVideoTask && klingModelVersion && (
          <div><strong>Kling 版本：</strong>{klingModelVersion}</div>
        )}
        {isKlingVideoTask && klingMode && (
          <div><strong>生成模式：</strong>{klingMode}</div>
        )}
        {isKlingVideoTask && klingActionLabel && (
          <div><strong>Kling 类型：</strong>{klingActionLabel}</div>
        )}
        {isKlingVideoTask && klingCfgScale && (
          <div><strong>自由度：</strong>{klingCfgScale}</div>
        )}
        {displayWidth && displayHeight && (
          <div><strong>尺寸：</strong>{displayWidth}x{displayHeight}</div>
        )}
        {task.type === TaskType.VIDEO && task.params.seconds && (
          <div><strong>时长：</strong>{task.params.seconds}秒</div>
        )}
        {task.type === TaskType.VIDEO && task.params.size && (
          <div><strong>分辨率：</strong>{task.params.size}</div>
        )}
        {task.params.batchId &&
          typeof task.params.batchIndex === 'number' &&
          typeof task.params.batchTotal === 'number' && (
            <div><strong>批量：</strong>{task.params.batchIndex + 1}/{task.params.batchTotal}</div>
          )}
        <div><strong>创建时间：</strong>{formatDateTime(task.createdAt)}</div>
        {task.startedAt && (
          <div><strong>执行时长：</strong>{formatTaskDuration(
            (task.completedAt || Date.now()) - task.startedAt
          )}</div>
        )}
        {(task.type === TaskType.VIDEO || task.type === TaskType.CHAT) && (
          <div><strong>进度：</strong>{task.progress ?? 0}%</div>
        )}
      </div>
    );
  };

  // Handle click on task item to toggle selection or open preview
  const handleItemClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // 排除按钮、复选框、链接、预览区域等交互元素的点击
    // 预览区域有自己的 onClick 处理器，避免重复触发
    if (target.closest('button') || target.closest('.t-checkbox') || target.closest('a') || target.closest('.task-item__preview')) return;
    
    if (selectionMode) {
      onSelectionChange?.(task.id, !isSelected);
    } else if (isCompleted && mediaUrl && isPreviewableTask) {
      onPreviewOpen?.();
    }
  };
  
  // Handle preview click with event propagation stopped
  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡到父元素的 handleItemClick
    if (isCompleted && mediaUrl && isPreviewableTask) {
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
      {(isCompleted || isFailed || task.status === TaskStatus.PROCESSING) &&
        (previewMediaUrl ||
          isCharacterTask ||
          isChatTask ||
          task.type === TaskType.VIDEO ||
          task.type === TaskType.IMAGE ||
          task.type === TaskType.AUDIO) && (
        <div className="task-item__preview-wrapper">
          <div className="task-item__preview" data-track="task_click_preview" onClick={handlePreviewClick}>
            {/* 失败状态：显示失败占位图 */}
            {isFailed ? (
              <div className="task-item__preview-failed">
                <CloseCircleIcon size="24px" />
                <span>生成失败</span>
              </div>
            ) : task.status === TaskStatus.PROCESSING ? (
              isChatTask ? (
                <div className="task-item__preview-placeholder">
                  <span>
                    {videoAnalyzerAction === 'analyze'
                      ? `视频分析中 ${Math.round(task.progress ?? 0)}%`
                      : videoAnalyzerAction === 'rewrite'
                      ? `脚本改编中 ${Math.round(task.progress ?? 0)}%`
                      : '生成文本中'}
                  </span>
                </div>
              ) : (
                /* 处理中状态：只显示进度覆盖层，不显示其他内容 */
                <TaskProgressOverlay
                  key={task.startedAt} // 重试时 startedAt 变化，强制重新挂载以重置进度
                  taskType={task.type}
                  taskStatus={task.status}
                  realProgress={task.progress}
                  startedAt={task.startedAt}
                  mediaUrl={previewMediaUrl}
                />
              )
            ) : (
              <>
                {/* 已完成状态：显示实际内容 */}
                {task.type === TaskType.IMAGE && mediaUrl ? (
                  <>
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
                    {mediaCount > 1 && (
                      <span className="task-item__multi-badge">{mediaCount}张</span>
                    )}
                  </>
                ) : isAudioTask && previewMediaUrl ? (
                  <>
                    <RetryImage
                      src={previewMediaUrl}
                      alt={displayPrompt || '音频封面'}
                      maxRetries={3}
                      fallback={
                        <div className="task-item__preview-placeholder">
                          <PlayCircleIcon size="24px" />
                          <span>音频封面</span>
                        </div>
                      }
                    />
                    <div className="task-item__video-play-overlay">
                      <PlayCircleIcon size="28px" />
                    </div>
                    {mediaCount > 1 && (
                      <span className="task-item__multi-badge">{mediaCount}首</span>
                    )}
                  </>
                ) : isLyricsTask ? (
                  <div className="task-item__preview-placeholder">
                    <CopyIcon size="24px" />
                    <span>歌词</span>
                  </div>
                ) : isChatTask ? (
                  <div className="task-item__preview-placeholder">
                    <span>文本</span>
                  </div>
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
                    <VideoPosterPreview
                      src={mediaUrl}
                      poster={task.result?.previewImageUrl}
                      alt={displayPrompt || '视频预览'}
                      thumbnailSize="small"
                      videoProps={{
                        muted: true,
                        playsInline: true,
                        preload: 'metadata',
                      }}
                    />
                    {/* 视频播放按钮覆盖层 */}
                    <div className="task-item__video-play-overlay">
                      <PlayCircleIcon size="32px" />
                    </div>
                  </>
                ) : (
                  <div className="task-item__preview-placeholder">
                    {task.type === TaskType.IMAGE ? (
                      <ImageIcon size="24px" />
                    ) : task.type === TaskType.VIDEO ? (
                      <VideoIcon size="24px" />
                    ) : (
                      <>
                        <PlayCircleIcon size="24px" />
                        <span>音频</span>
                      </>
                    )}
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
            {displayPrompt}
          </div>
          {isChatTask && videoAnalyzerSubtitle && (
            <div className="task-item__subtitle" title={videoAnalyzerSubtitle}>
              {videoAnalyzerSubtitle}
            </div>
          )}
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
                {isChatTask && videoAnalyzerTypeTag && (
                  <Tag variant="outline">{videoAnalyzerTypeTag}</Tag>
                )}
                {isKlingVideoTask && klingModelVersion && (
                  <Tag variant="outline">{klingModelVersion}</Tag>
                )}
                {isKlingVideoTask && klingMode && (
                  <Tag variant="outline">{klingMode}</Tag>
                )}
                {isKlingVideoTask && klingActionLabel && (
                  <Tag variant="outline">{klingActionLabel}</Tag>
                )}

                {/* Video/Image specific meta as tags */}
                {task.type === TaskType.VIDEO && task.params.seconds && (
                  <Tag variant="outline">{task.params.seconds}s</Tag>
                )}
                {task.type === TaskType.VIDEO && task.params.size && (
                  <Tag variant="outline">{task.params.size}</Tag>
                )}
                {audioDurationLabel && (
                  <Tag variant="outline">
                    {audioDurationLabel}
                  </Tag>
                )}
                {task.type === TaskType.AUDIO && task.params.mv && !isLyricsTask && (
                  <Tag variant="outline">{task.params.mv}</Tag>
                )}
                {task.type === TaskType.AUDIO && task.params.tags && !isLyricsTask && (
                  <Tag variant="outline">
                    {String(task.params.tags).split(',')[0]?.trim() || '音频'}
                  </Tag>
                )}
                {isLyricsTask && (
                  <Tag variant="outline">歌词</Tag>
                )}
                {isLyricsTask && lyricsTags[0] && (
                  <Tag variant="outline">{lyricsTags[0]}</Tag>
                )}
                {task.params.batchId &&
                  typeof task.params.batchIndex === 'number' &&
                  typeof task.params.batchTotal === 'number' && (
                    <Tag variant="outline">
                      批量 {task.params.batchIndex + 1}/{task.params.batchTotal}
                    </Tag>
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
                {audioDurationLabel && (
                  <span className="task-item__size">
                    {' · '}
                    {audioDurationLabel}
                  </span>
                )}
                {isCompleted && task.result?.url && !isLyricsTask && (
                  <a
                    href={task.result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="task-item__link"
                    data-track="task_click_open_link"
                    onClick={(e: any) => e.stopPropagation()}
                  >
                    · 打开链接
                  </a>
                )}
              </div>

              {/* Progress bar for video tasks (outside tags) */}
              {(task.type === TaskType.VIDEO ||
                task.type === TaskType.AUDIO ||
                (task.type === TaskType.CHAT &&
                  typeof task.progress === 'number')) &&
                task.status === TaskStatus.PROCESSING && (
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

                {isCompleted && isLyricsTask && lyricsText && (
                  <Tooltip content="复制歌词" theme="light">
                    <Button
                      size="small"
                      variant="text"
                      icon={<CopyIcon />}
                      onClick={(e) => { e.stopPropagation(); onCopy?.(task.id); }}
                    />
                  </Tooltip>
                )}

                {!isCharacterTask && !isAudioTask && !isChatTask && (
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
              {isCompleted &&
                (((task.result?.url || task.result?.chatResponse) && !isCharacterTask) ||
                  isLyricsTask) && (
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

              {isRetryable && (
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
                  >
                    <span className="task-item__error-details-link" onClick={(e: any) => e.stopPropagation()}>[详情]</span>
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
         prev.task.error?.message === next.task.error?.message &&
         prev.task.result === next.task.result &&
         prev.isSelected === next.isSelected &&
         prev.selectionMode === next.selectionMode &&
         prev.isCompact === next.isCompact;
});
