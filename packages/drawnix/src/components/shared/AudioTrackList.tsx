import React from 'react';
import classNames from 'classnames';
import { BookOpen, Heart, LoaderCircle, Pause, Play } from 'lucide-react';
import { AudioCover } from './AudioCover';
import { HoverTip } from './hover';
import type { AudioPlaylistItemRef } from '../../types/audio-playlist.types';
import './audio-track-list.scss';

export interface AudioTrackListItem {
  id: string;
  title: string;
  subtitle?: string;
  previewImageUrl?: string;
  isActive?: boolean;
  isPlaying?: boolean;
  isLoading?: boolean;
  isFavorite?: boolean;
  canFavorite?: boolean;
  assetId?: string;
  noteId?: string;
  playlistItemRef?: AudioPlaylistItemRef;
}

interface AudioTrackListProps {
  items: AudioTrackListItem[];
  onSelect: (item: AudioTrackListItem) => void;
  onContextMenu?: (item: AudioTrackListItem, event: React.MouseEvent<HTMLDivElement>) => void;
  onToggleFavorite?: (item: AudioTrackListItem) => void;
  onTogglePlayback?: (item: AudioTrackListItem) => void;
  showFavoriteButton?: boolean;
  showPlaybackIndicator?: boolean;
  className?: string;
  itemClassName?: string;
  onOpenKnowledgeBase?: (noteId: string) => void;
}

export const AudioTrackList: React.FC<AudioTrackListProps> = ({
  items,
  onSelect,
  onContextMenu,
  onToggleFavorite,
  onTogglePlayback,
  showFavoriteButton = false,
  showPlaybackIndicator = false,
  className,
  itemClassName,
  onOpenKnowledgeBase,
}) => {
  return (
    <div className={classNames('audio-track-list', className)}>
      {items.map((item) => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          className={classNames('audio-track-list__item', itemClassName, {
            'audio-track-list__item--active': item.isActive,
          })}
          onClick={() => onSelect(item)}
          onContextMenu={(event) => onContextMenu?.(item, event)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(item);
            }
          }}
        >
          <div className="audio-track-list__cover">
            <AudioCover
              src={item.previewImageUrl}
              alt={item.title}
              fallbackClassName="audio-track-list__cover audio-track-list__cover--fallback"
              iconSize={16}
              loading="lazy"
            />
          </div>
          <div className="audio-track-list__meta">
            <div className="audio-track-list__title">{item.title}</div>
            <div className="audio-track-list__subtitle">{item.subtitle || '--:--'}</div>
          </div>
          {showFavoriteButton || showPlaybackIndicator ? (
            <div
              className="audio-track-list__trailing"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {item.noteId && onOpenKnowledgeBase ? (
                <HoverTip content="打开知识库笔记" showArrow={false}>
                  <button
                    type="button"
                    className="audio-track-list__action-btn"
                    onClick={() => {
                      if (item.noteId) onOpenKnowledgeBase(item.noteId);
                    }}
                    aria-label="打开知识库笔记"
                  >
                    <BookOpen size={14} />
                  </button>
                </HoverTip>
              ) : null}
              {showFavoriteButton && item.canFavorite !== false ? (
                <button
                  type="button"
                  className={classNames('audio-track-list__favorite-btn', {
                    'audio-track-list__favorite-btn--active': item.isFavorite,
                  })}
                  onClick={() => onToggleFavorite?.(item)}
                  aria-label={item.isFavorite ? '取消收藏' : '加入收藏'}
                >
                  <Heart size={14} fill={item.isFavorite ? 'currentColor' : 'none'} />
                </button>
              ) : null}
              {showPlaybackIndicator ? (
                <button
                  type="button"
                  className="audio-track-list__status"
                  onClick={() => onTogglePlayback?.(item)}
                  aria-label={
                    item.isLoading
                      ? '取消加载'
                      : item.isPlaying
                        ? '暂停播放'
                        : '开始播放'
                  }
                >
                  {item.isLoading ? (
                    <LoaderCircle className="audio-track-list__loading-icon" size={16} />
                  ) : item.isPlaying ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};
