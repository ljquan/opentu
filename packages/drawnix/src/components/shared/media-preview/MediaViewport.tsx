/**
 * 统一媒体预览系统 - 媒体展示区组件
 * 复用于单图模式和对比模式的每个槽位
 */

import React, { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  GripHorizontal,
  Plus,
  Download,
  Pencil,
} from 'lucide-react';
import { MessagePlugin } from 'tdesign-react';
import { normalizeImageDataUrl } from '@aitu/utils';
import { quickInsert } from '../../../services/canvas-operations';
import { AudioCover } from '../AudioCover';
import type { MediaViewportProps, MediaViewportRef } from './types';
import { HoverPopover } from './HoverPopover';
import './MediaViewport.scss';

// 稳定的默认值
const DEFAULT_PAN = { x: 0, y: 0 };

// 工具栏方向类型
type ToolbarOrientation = 'horizontal' | 'vertical';

// 工具栏状态缓存 key - 只用于单图模式
const TOOLBAR_CACHE_KEY = 'media-viewport-toolbar-state-single';

// 工具栏缓存状态类型
interface ToolbarCacheState {
  orientation: ToolbarOrientation;
  position: { x: number; y: number } | null;
}

// 从 localStorage 读取工具栏状态（仅单图模式使用）
const loadToolbarState = (): ToolbarCacheState => {
  try {
    const cached = localStorage.getItem(TOOLBAR_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // ignore parse error
  }
  return { orientation: 'horizontal', position: null };
};

// 保存工具栏状态到 localStorage（仅单图模式使用）
const saveToolbarState = (state: ToolbarCacheState): void => {
  try {
    localStorage.setItem(TOOLBAR_CACHE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage error
  }
};

export const MediaViewport = forwardRef<MediaViewportRef, MediaViewportProps>(({
  item,
  slotIndex,
  isFocused = false,
  zoomLevel = 1,
  panOffset,
  onClick,
  videoAutoPlay = false,
  videoLoop = true,
  onZoomChange,
  onPanChange,
  isCompareMode = false,
  onInsertToCanvas,
  onDownload,
  onEdit,
  onVideoPlayStateChange,
  onVideoTimeUpdate,
  isSyncMode = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [localPan, setLocalPan] = useState(panOffset ?? DEFAULT_PAN);
  const [localZoom, setLocalZoom] = useState(zoomLevel);
  const [rotation, setRotation] = useState(0); // 旋转角度
  const [flipH, setFlipH] = useState(false); // 水平翻转
  const [flipV, setFlipV] = useState(false); // 垂直翻转
  const [isMediaHovered, setIsMediaHovered] = useState(false);
  const [isPromptHovered, setIsPromptHovered] = useState(false);
  const [isToolbarHovered, setIsToolbarHovered] = useState(false);
  const promptHideTimerRef = useRef<number | null>(null);
  const autoFitFrameRef = useRef<number | null>(null);

  // 暴露视频控制方法给父组件
  useImperativeHandle(ref, () => ({
    resetVideo: () => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {
          // 忽略自动播放限制错误
        });
      }
    },
    playVideo: () => {
      if (videoRef.current) {
        videoRef.current.play().catch(() => {
          // 忽略自动播放限制错误
        });
      }
    },
    pauseVideo: () => {
      if (videoRef.current) {
        videoRef.current.pause();
      }
    },
    toggleVideoPlayback: () => {
      if (!videoRef.current) {
        return;
      }
      if (videoRef.current.paused || videoRef.current.ended) {
        videoRef.current.play().catch(() => {
          // 忽略自动播放限制错误
        });
        return;
      }
      videoRef.current.pause();
    },
    setVideoTime: (time: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time;
      }
    },
    getVideoTime: () => {
      return videoRef.current?.currentTime ?? 0;
    },
    isVideo: () => {
      return item?.type === 'video';
    },
  }), [item]);

  // 工具栏状态 - 单图模式从缓存初始化，多图模式使用默认值
  const [toolbarState] = useState<ToolbarCacheState>(() =>
    isCompareMode ? { orientation: 'horizontal', position: null } : loadToolbarState()
  );
  const [toolbarOrientation, setToolbarOrientation] =
    useState<ToolbarOrientation>(toolbarState.orientation);
  const [toolbarPosition, setToolbarPosition] = useState<{
    x: number;
    y: number;
  } | null>(toolbarState.position);
  const [isToolbarDragging, setIsToolbarDragging] = useState(false);
  const toolbarDragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const isVideo = item?.type === 'video';
  const isAudio = item?.type === 'audio';
  const promptText = item?.prompt?.trim() || '';
  const showPrompt =
    Boolean(promptText) && (isMediaHovered || isPromptHovered) && !isToolbarHovered;
  const mediaUrl = item
    ? (isVideo || isAudio ? item.url : normalizeImageDataUrl(item.url))
    : '';
  const posterUrl = item?.posterUrl ? normalizeImageDataUrl(item.posterUrl) : '';
  const mediaIdentity = item ? `${item.type}:${item.id || item.url}` : 'empty';

  const clearPromptHideTimer = useCallback(() => {
    if (promptHideTimerRef.current !== null) {
      window.clearTimeout(promptHideTimerRef.current);
      promptHideTimerRef.current = null;
    }
  }, []);

  const handleMediaHoverStart = useCallback(() => {
    clearPromptHideTimer();
    setIsMediaHovered(true);
  }, [clearPromptHideTimer]);

  const handleMediaHoverEnd = useCallback(() => {
    setIsMediaHovered(false);
    clearPromptHideTimer();
    promptHideTimerRef.current = window.setTimeout(() => {
      setIsPromptHovered(false);
      promptHideTimerRef.current = null;
    }, 120);
  }, [clearPromptHideTimer]);

  const handlePromptHoverStart = useCallback(() => {
    clearPromptHideTimer();
    setIsPromptHovered(true);
  }, [clearPromptHideTimer]);

  const handlePromptHoverEnd = useCallback(() => {
    setIsPromptHovered(false);
  }, []);

  useEffect(() => {
    setImageLoadFailed(false);
    setIsDragging(false);
    setLocalPan(panOffset ?? DEFAULT_PAN);
    setLocalZoom(zoomLevel);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);

    if (autoFitFrameRef.current !== null) {
      window.cancelAnimationFrame(autoFitFrameRef.current);
      autoFitFrameRef.current = null;
    }
  }, [mediaIdentity]);

  useEffect(() => () => {
    clearPromptHideTimer();
    if (autoFitFrameRef.current !== null) {
      window.cancelAnimationFrame(autoFitFrameRef.current);
      autoFitFrameRef.current = null;
    }
  }, [clearPromptHideTimer]);

  // 保存工具栏状态到缓存 - 仅单图模式
  useEffect(() => {
    if (!isCompareMode) {
      saveToolbarState({ orientation: toolbarOrientation, position: toolbarPosition });
    }
  }, [toolbarOrientation, toolbarPosition, isCompareMode]);

  // 同步外部 props - 只在值真正变化时更新
  useEffect(() => {
    const newPan = panOffset ?? DEFAULT_PAN;
    setLocalPan((prev) => {
      if (prev.x === newPan.x && prev.y === newPan.y) return prev;
      return newPan;
    });
  }, [panOffset]);

  useEffect(() => {
    setLocalZoom((prev) => (prev === zoomLevel ? prev : zoomLevel));
  }, [zoomLevel]);

  const scheduleAutoFit = useCallback(() => {
    if (
      isCompareMode ||
      isAudio ||
      !containerRef.current ||
      (Math.abs(zoomLevel - 1) > 0.001) ||
      Math.abs((panOffset?.x ?? 0)) > 0.5 ||
      Math.abs((panOffset?.y ?? 0)) > 0.5
    ) {
      return;
    }

    if (autoFitFrameRef.current !== null) {
      window.cancelAnimationFrame(autoFitFrameRef.current);
    }

    autoFitFrameRef.current = window.requestAnimationFrame(() => {
      autoFitFrameRef.current = null;

      const mediaElement = isVideo ? videoRef.current : imageRef.current;
      if (!mediaElement || !containerRef.current) {
        return;
      }

      const containerRect = containerRef.current.getBoundingClientRect();
      if (containerRect.width <= 0 || containerRect.height <= 0) {
        return;
      }

      const intrinsicWidth = isVideo
        ? (mediaElement as HTMLVideoElement).videoWidth
        : (mediaElement as HTMLImageElement).naturalWidth;
      const intrinsicHeight = isVideo
        ? (mediaElement as HTMLVideoElement).videoHeight
        : (mediaElement as HTMLImageElement).naturalHeight;
      if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
        return;
      }

      const horizontalPadding = 32;
      const verticalReserve = isVideo ? 140 : 88;
      const availableWidth = Math.max(containerRect.width - horizontalPadding, 0);
      const availableHeight = Math.max(containerRect.height - verticalReserve, 0);
      if (availableWidth <= 0 || availableHeight <= 0) {
        return;
      }

      const fittedZoom = Math.min(
        1,
        availableWidth / intrinsicWidth,
        availableHeight / intrinsicHeight
      );

      if (!Number.isFinite(fittedZoom) || fittedZoom <= 0 || fittedZoom >= 0.995) {
        return;
      }

      setLocalZoom((prev) => (Math.abs(prev - fittedZoom) <= 0.01 ? prev : fittedZoom));
      onZoomChange?.(fittedZoom);
    });
  }, [isCompareMode, isAudio, isVideo, zoomLevel, panOffset?.x, panOffset?.y, onZoomChange]);

  useEffect(() => {
    if (!item?.url || isAudio || isCompareMode) {
      return;
    }

    const mediaElement = isVideo ? videoRef.current : imageRef.current;
    if (!mediaElement) {
      return;
    }

    if (isVideo) {
      const video = mediaElement as HTMLVideoElement;
      if (video.readyState >= 1) {
        scheduleAutoFit();
      }
      return;
    }

    const image = mediaElement as HTMLImageElement;
    if (image.complete && image.naturalWidth > 0) {
      scheduleAutoFit();
    }
  }, [item, isAudio, isCompareMode, isVideo, scheduleAutoFit]);

  // 鼠标拖拽
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - localPan.x, y: e.clientY - localPan.y });
    },
    [localPan]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const newPan = {
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      };
      setLocalPan(newPan);
      onPanChange?.(newPan);
    },
    [isDragging, dragStart, onPanChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 滚轮缩放
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(0.1, Math.min(5, localZoom + delta));
      setLocalZoom(newZoom);
      onZoomChange?.(newZoom);
    },
    [localZoom, onZoomChange]
  );

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(5, localZoom + 0.25);
    setLocalZoom(newZoom);
    onZoomChange?.(newZoom);
  }, [localZoom, onZoomChange]);

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(0.1, localZoom - 0.25);
    setLocalZoom(newZoom);
    onZoomChange?.(newZoom);
  }, [localZoom, onZoomChange]);

  // 旋转控制
  const handleRotateLeft = useCallback(() => {
    setRotation((prev) => prev - 90);
  }, []);

  const handleRotateRight = useCallback(() => {
    setRotation((prev) => prev + 90);
  }, []);

  // 翻转控制
  const handleFlipHorizontal = useCallback(() => {
    setFlipH((prev) => !prev);
  }, []);

  const handleFlipVertical = useCallback(() => {
    setFlipV((prev) => !prev);
  }, []);

  // 插入到画布（使用全局 quickInsert，无需 board 依赖）
  const handleInternalInsertToCanvas = useCallback(async () => {
    if (!item) return;
    
    try {
      const contentType = item.type === 'video' ? 'video' : 'image';
      if (item.type === 'audio') {
        MessagePlugin.warning('音频暂不支持直接插入到画布');
        return;
      }
      const result = await quickInsert(contentType, mediaUrl);
      if (result.success) {
        MessagePlugin.success(item.type === 'video' ? '视频已插入到画布' : '图片已插入到画布');
      } else {
        MessagePlugin.error(result.error || '插入失败');
      }
    } catch (error) {
      console.error('Failed to insert to canvas:', error);
      MessagePlugin.error('插入失败');
    }
  }, [item, mediaUrl]);

  // 工具栏方向切换
  const toggleToolbarOrientation = useCallback(() => {
    setToolbarOrientation((prev) =>
      prev === 'horizontal' ? 'vertical' : 'horizontal'
    );
  }, []);

  // 工具栏拖拽开始 - 鼠标事件
  const handleToolbarDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsToolbarDragging(true);

      const currentPos = toolbarPosition || { x: 0, y: 0 };
      toolbarDragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        posX: currentPos.x,
        posY: currentPos.y,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - toolbarDragStartRef.current.x;
        const deltaY = moveEvent.clientY - toolbarDragStartRef.current.y;
        setToolbarPosition({
          x: toolbarDragStartRef.current.posX + deltaX,
          y: toolbarDragStartRef.current.posY + deltaY,
        });
      };

      const handleMouseUp = () => {
        setIsToolbarDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [toolbarPosition]
  );

  // 工具栏拖拽开始 - 触摸事件
  const handleToolbarTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      setIsToolbarDragging(true);

      const currentPos = toolbarPosition || { x: 0, y: 0 };
      toolbarDragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        posX: currentPos.x,
        posY: currentPos.y,
      };

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.touches.length !== 1) return;
        moveEvent.preventDefault();
        const moveTouch = moveEvent.touches[0];
        const deltaX = moveTouch.clientX - toolbarDragStartRef.current.x;
        const deltaY = moveTouch.clientY - toolbarDragStartRef.current.y;
        setToolbarPosition({
          x: toolbarDragStartRef.current.posX + deltaX,
          y: toolbarDragStartRef.current.posY + deltaY,
        });
      };

      const handleTouchEnd = () => {
        setIsToolbarDragging(false);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('touchcancel', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.addEventListener('touchcancel', handleTouchEnd);
    },
    [toolbarPosition]
  );

  // 重置工具栏位置
  const resetToolbarPosition = useCallback(() => {
    setToolbarPosition(null);
  }, []);

  if (!item) {
    return (
      <div
        className={`media-viewport media-viewport--empty ${isFocused ? 'media-viewport--focused' : ''}`}
        onClick={onClick}
      >
        <div className="media-viewport__placeholder">
          <span>点击底部缩略图添加媒体</span>
        </div>
      </div>
    );
  }

  const scaleX = flipH ? -localZoom : localZoom;
  const scaleY = flipV ? -localZoom : localZoom;
  const transformStyle = {
    transform: `translate(${localPan.x}px, ${localPan.y}px) scale(${scaleX}, ${scaleY}) rotate(${rotation}deg)`,
  };

  return (
    <div
      ref={containerRef}
      className={`media-viewport ${isFocused ? 'media-viewport--focused' : ''} ${isAudio ? 'media-viewport--audio' : ''} ${isVideo ? 'media-viewport--video' : ''} ${!isCompareMode ? 'media-viewport--single' : ''}`}
      onClick={onClick}
      onMouseDown={isAudio ? undefined : handleMouseDown}
      onMouseMove={isAudio ? undefined : handleMouseMove}
      onMouseUp={isAudio ? undefined : handleMouseUp}
      onWheel={isAudio ? undefined : handleWheel}
      onMouseLeave={() => {
        if (!isAudio) {
          handleMouseUp();
        }
        setIsMediaHovered(false);
        setIsPromptHovered(false);
        setIsToolbarHovered(false);
        clearPromptHideTimer();
      }}
      data-slot={slotIndex}
    >
      {/* 媒体内容 */}
      <div
        className="media-viewport__content"
        style={isAudio ? undefined : transformStyle}
      >
        {isVideo ? (
          <div
            className="media-viewport__media-hitbox"
            onMouseEnter={handleMediaHoverStart}
            onMouseLeave={handleMediaHoverEnd}
          >
            <video
              ref={videoRef}
              src={mediaUrl}
              autoPlay={videoAutoPlay}
              loop={videoLoop}
              controls
              className="media-viewport__video"
              // @ts-expect-error -- React types lack referrerPolicy on <video>
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
              onPlay={() => {
                if (isSyncMode && onVideoPlayStateChange) {
                  onVideoPlayStateChange(true);
                }
              }}
              onPause={() => {
                if (isSyncMode && onVideoPlayStateChange) {
                  onVideoPlayStateChange(false);
                }
              }}
              onSeeked={() => {
                if (isSyncMode && onVideoTimeUpdate && videoRef.current) {
                  onVideoTimeUpdate(videoRef.current.currentTime);
                }
              }}
              onLoadedMetadata={scheduleAutoFit}
            />
          </div>
        ) : isAudio ? (
          <div className="media-viewport__audio-shell" onClick={(e) => e.stopPropagation()}>
            <div className="media-viewport__audio-card">
              <AudioCover
                src={posterUrl}
                alt={item.alt || item.title || ''}
                imageClassName="media-viewport__audio-poster"
                fallbackClassName="media-viewport__audio-poster media-viewport__audio-poster--fallback"
                iconSize={56}
              />
              <div className="media-viewport__audio-meta">
                {item.title && <div className="media-viewport__audio-title">{item.title}</div>}
                {typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0 && (
                  <div className="media-viewport__audio-duration">
                    {Math.floor(item.duration / 60)}:{String(Math.round(item.duration % 60)).padStart(2, '0')}
                  </div>
                )}
              </div>
              <audio
                src={mediaUrl}
                controls
                preload="metadata"
                className="media-viewport__audio"
                // @ts-expect-error -- React types lack referrerPolicy on <audio>
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        ) : imageLoadFailed ? (
          <div
            className="media-viewport__media-hitbox"
            onMouseEnter={handleMediaHoverStart}
            onMouseLeave={handleMediaHoverEnd}
          >
            <div className="media-viewport__image-fallback">
              <span>图片加载失败</span>
            </div>
          </div>
        ) : (
          <div
            className="media-viewport__media-hitbox"
            onMouseEnter={handleMediaHoverStart}
            onMouseLeave={handleMediaHoverEnd}
          >
            <img
              ref={imageRef}
              src={mediaUrl}
              alt={item.alt || item.title || ''}
              className="media-viewport__image"
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={scheduleAutoFit}
              onError={() => setImageLoadFailed(true)}
            />
          </div>
        )}
      </div>

      {/* 工具控制栏 */}
      <div
        className={`media-viewport__toolbar media-viewport__toolbar--${toolbarOrientation} ${
          isToolbarDragging ? 'media-viewport__toolbar--dragging' : ''
        } ${isCompareMode ? 'media-viewport__toolbar--compact' : ''}`}
        style={
          !isCompareMode && toolbarPosition
            ? {
                transform: `translate(calc(-50% + ${toolbarPosition.x}px), ${toolbarPosition.y}px)`,
              }
            : undefined
        }
        onMouseEnter={() => setIsToolbarHovered(true)}
        onMouseLeave={() => setIsToolbarHovered(false)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {!isAudio && (
          <>
        {/* 拖拽手柄 + 方向切换 - 仅单图模式 */}
        {!isCompareMode && (
          <>
            <HoverPopover
              content="拖拽移动工具栏，双击重置位置"
              placement="top"
              contentClassName="viewer-popover"
            >
              <div
                className="media-viewport__toolbar-handle"
                onMouseDown={handleToolbarDragStart}
                onTouchStart={handleToolbarTouchStart}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  resetToolbarPosition();
                }}
              >
                <GripHorizontal size={14} />
              </div>
            </HoverPopover>
            <HoverPopover
              content={toolbarOrientation === 'horizontal' ? '切换为垂直布局' : '切换为水平布局'}
              placement="top"
              contentClassName="viewer-popover"
            >
              <button
                type="button"
                className="media-viewport__toolbar-orientation-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  toggleToolbarOrientation();
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {toolbarOrientation === 'horizontal' ? (
                    <>
                      <line x1="12" y1="3" x2="12" y2="21" />
                      <polyline points="8 7 12 3 16 7" />
                      <polyline points="8 17 12 21 16 17" />
                    </>
                  ) : (
                    <>
                      <line x1="3" y1="12" x2="21" y2="12" />
                      <polyline points="7 8 3 12 7 16" />
                      <polyline points="17 8 21 12 17 16" />
                    </>
                  )}
                </svg>
              </button>
            </HoverPopover>
            <div className="media-viewport__toolbar-divider" />
          </>
        )}

        {/* 缩放控制 */}
        <div className="media-viewport__toolbar-group">
          <HoverPopover content="缩小" placement="top" contentClassName="viewer-popover">
            <button
              type="button"
              aria-label="缩小"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleZoomOut();
              }}
            >
              <ZoomOut size={16} />
            </button>
          </HoverPopover>
          <span className="media-viewport__zoom-level">
            {Math.round(localZoom * 100)}%
          </span>
          <HoverPopover content="放大" placement="top" contentClassName="viewer-popover">
            <button
              type="button"
              aria-label="放大"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleZoomIn();
              }}
            >
              <ZoomIn size={16} />
            </button>
          </HoverPopover>
        </div>

        <div className="media-viewport__toolbar-divider" />

        {/* 旋转控制 */}
        <div className="media-viewport__toolbar-group">
          <HoverPopover content="向左旋转 90°" placement="top" contentClassName="viewer-popover">
            <button
              type="button"
              aria-label="向左旋转 90°"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleRotateLeft();
              }}
            >
              <RotateCcw size={16} />
            </button>
          </HoverPopover>
          <HoverPopover content="向右旋转 90°" placement="top" contentClassName="viewer-popover">
            <button
              type="button"
              aria-label="向右旋转 90°"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleRotateRight();
              }}
            >
              <RotateCw size={16} />
            </button>
          </HoverPopover>
        </div>

        <div className="media-viewport__toolbar-divider" />

        {/* 翻转控制 */}
        <div className="media-viewport__toolbar-group">
          <HoverPopover content="水平翻转" placement="top" contentClassName="viewer-popover">
            <button
              type="button"
              aria-label="水平翻转"
              className={flipH ? 'active' : ''}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleFlipHorizontal();
              }}
            >
              <FlipHorizontal size={16} />
            </button>
          </HoverPopover>
          <HoverPopover content="垂直翻转" placement="top" contentClassName="viewer-popover">
            <button
              type="button"
              aria-label="垂直翻转"
              className={flipV ? 'active' : ''}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleFlipVertical();
              }}
            >
              <FlipVertical size={16} />
            </button>
          </HoverPopover>
        </div>
          </>
        )}

        {/* 插入到画布 - 仅单图模式（使用内部 quickInsert，无需外部依赖） */}
        {!isCompareMode && !isAudio && (
          <>
            <div className="media-viewport__toolbar-divider" />
            <HoverPopover
              content="插入到画布"
              placement="top"
              contentClassName="viewer-popover"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  // 优先使用外部回调（如果有），否则使用内部 quickInsert
                  if (onInsertToCanvas) {
                    onInsertToCanvas();
                  } else {
                    handleInternalInsertToCanvas();
                  }
                }}
              >
                <Plus size={16} />
              </button>
            </HoverPopover>
          </>
        )}

        {/* 下载 - 仅单图模式 */}
        {!isCompareMode && onDownload && (
          <>
            {isAudio && <div className="media-viewport__toolbar-divider" />}
            <HoverPopover
              content="下载"
              placement="top"
              contentClassName="viewer-popover"
            >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onDownload();
              }}
            >
              <Download size={16} />
            </button>
            </HoverPopover>
          </>
        )}

        {/* 编辑 - 仅单图模式且为图片 */}
        {!isCompareMode && onEdit && item?.type === 'image' && (
          <HoverPopover
            content="编辑图片"
            placement="top"
            contentClassName="viewer-popover"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onEdit();
              }}
            >
              <Pencil size={16} />
            </button>
          </HoverPopover>
        )}
      </div>

      {/* 提示词 */}
      {promptText && !isAudio && (
        <HoverPopover
          content={promptText}
          placement="bottom"
          sideOffset={10}
          contentClassName="viewer-popover viewer-popover--prompt"
        >
          <div
            className={`media-viewport__prompt ${showPrompt ? 'media-viewport__prompt--visible' : ''} ${isPromptHovered ? 'media-viewport__prompt--expanded' : ''}`}
            onMouseEnter={handlePromptHoverStart}
            onMouseLeave={handlePromptHoverEnd}
          >
            {promptText}
          </div>
        </HoverPopover>
      )}
    </div>
  );
});

MediaViewport.displayName = 'MediaViewport';

export default MediaViewport;
