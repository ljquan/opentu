/**
 * 统一媒体预览系统 - 缩略图队列组件
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Play, CheckCircle, Music4 } from 'lucide-react';
import { isDataURL, normalizeImageDataUrl } from '@aitu/utils';
import { AudioCover } from '../AudioCover';
import { VideoPosterPreview } from '../VideoPosterPreview';
import type { ThumbnailQueueProps, MediaItem } from './types';
import './ThumbnailQueue.scss';

const ThumbnailImage: React.FC<{
  src: string;
  fallbackSrc?: string;
  alt: string;
}> = ({ src, fallbackSrc, alt }) => {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div className="thumbnail-queue__image thumbnail-queue__image-fallback">
        <span>加载失败</span>
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className="thumbnail-queue__image"
      loading="lazy"
      onError={() => {
        if (fallbackSrc && currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc);
          return;
        }
        setFailed(true);
      }}
    />
  );
};

/**
 * 获取预览图 URL（通过添加查询参数）
 * @param originalUrl 原始 URL
 * @param size 预览图尺寸（默认 small）
 */
function getThumbnailUrl(originalUrl: string, size: 'small' | 'large' = 'small'): string {
  const normalizedUrl = normalizeImageDataUrl(originalUrl);

  if (
    normalizedUrl.startsWith('http://') ||
    normalizedUrl.startsWith('https://') ||
    normalizedUrl.startsWith('blob:') ||
    isDataURL(normalizedUrl)
  ) {
    return normalizedUrl;
  }

  try {
    const url = new URL(normalizedUrl, window.location.origin);
    url.searchParams.set('thumbnail', size);
    return url.toString();
  } catch {
    const separator = normalizedUrl.includes('?') ? '&' : '?';
    return `${normalizedUrl}${separator}thumbnail=${size}`;
  }
}

export const ThumbnailQueue: React.FC<ThumbnailQueueProps> = ({
  items,
  mode,
  currentIndex,
  compareIndices,
  onThumbnailClick,
  onDragStart,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // 自动滚动到当前项
  useEffect(() => {
    if (mode === 'single' && containerRef.current) {
      const activeThumb = containerRef.current.querySelector(
        '.thumbnail-queue__item--active'
      );
      if (activeThumb) {
        activeThumb.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }
    }
  }, [currentIndex, mode]);

  const handleDragStart = useCallback(
    (index: number, e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.effectAllowed = 'move';
      setDraggedIndex(index);
      onDragStart?.(index);
    },
    [onDragStart]
  );

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
  }, []);

  const isItemActive = useCallback(
    (index: number): boolean => {
      if (mode === 'single') {
        return index === currentIndex;
      }
      return compareIndices.includes(index);
    },
    [mode, currentIndex, compareIndices]
  );

  const getSlotNumber = useCallback(
    (index: number): number | undefined => {
      if (mode !== 'compare') return undefined;
      const slotIdx = compareIndices.indexOf(index);
      return slotIdx >= 0 ? slotIdx + 1 : undefined;
    },
    [mode, compareIndices]
  );

  const renderThumbnail = useCallback(
    (item: MediaItem, index: number) => {
      const isActive = isItemActive(index);
      const slotNumber = getSlotNumber(index);
      const isDragging = draggedIndex === index;
      const isVideo = item.type === 'video';
      const isAudio = item.type === 'audio';
      const normalizedUrl = normalizeImageDataUrl(item.url);
      const posterUrl = item.posterUrl ? normalizeImageDataUrl(item.posterUrl) : '';
      const thumbnailUrl = getThumbnailUrl(
        isAudio && posterUrl ? posterUrl : normalizedUrl,
        'small'
      ); // 缩略图导航使用小尺寸

      return (
        <div
          key={item.id || `${item.url}-${index}`}
          className={`thumbnail-queue__item ${
            isActive ? 'thumbnail-queue__item--active' : ''
          } ${isDragging ? 'thumbnail-queue__item--dragging' : ''}`}
          onClick={() => onThumbnailClick(index)}
          draggable={mode === 'compare'}
          onDragStart={(e) => handleDragStart(index, e)}
          onDragEnd={handleDragEnd}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onThumbnailClick(index);
            }
          }}
        >
          {/* 缩略图 */}
          <div className="thumbnail-queue__thumb">
            {isVideo ? (
              <>
                <VideoPosterPreview
                  src={normalizedUrl}
                  poster={posterUrl || undefined}
                  className="thumbnail-queue__video"
                  alt={item.alt || item.title || ''}
                  thumbnailSize="small"
                  videoProps={{
                    muted: true,
                    preload: 'metadata',
                  }}
                />
                <div className="thumbnail-queue__video-icon">
                  <Play size={16} />
                </div>
              </>
            ) : isAudio ? (
              <>
                <AudioCover
                  src={posterUrl ? thumbnailUrl : undefined}
                  fallbackSrc={posterUrl}
                  alt={item.alt || item.title || ''}
                  imageClassName="thumbnail-queue__image"
                  fallbackClassName="thumbnail-queue__image thumbnail-queue__audio-fallback"
                  iconSize={18}
                  loading="lazy"
                />
                <div className="thumbnail-queue__video-icon">
                  <Music4 size={16} />
                </div>
              </>
            ) : (
              <ThumbnailImage
                src={thumbnailUrl}
                alt={item.alt || item.title || ''}
                fallbackSrc={normalizedUrl}
              />
            )}
          </div>

          {/* 选中标记 */}
          {isActive && (
            <div className="thumbnail-queue__check">
              {slotNumber ? (
                <span className="thumbnail-queue__slot-number">
                  {slotNumber}
                </span>
              ) : (
                <CheckCircle size={18} />
              )}
            </div>
          )}
        </div>
      );
    },
    [
      isItemActive,
      getSlotNumber,
      draggedIndex,
      mode,
      onThumbnailClick,
      handleDragStart,
      handleDragEnd,
    ]
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="thumbnail-queue" ref={containerRef}>
      <div className="thumbnail-queue__list">
        {items.map((item, index) => renderThumbnail(item, index))}
      </div>
    </div>
  );
};

export default ThumbnailQueue;
