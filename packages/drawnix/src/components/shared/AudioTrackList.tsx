import React from 'react';
import classNames from 'classnames';
import { Heart, Pause, Play } from 'lucide-react';
import { AudioCover } from './AudioCover';
import './audio-track-list.scss';

export interface AudioTrackListItem {
  id: string;
  title: string;
  subtitle?: string;
  previewImageUrl?: string;
  isActive?: boolean;
  isPlaying?: boolean;
  isFavorite?: boolean;
}

interface AudioTrackListProps {
  items: AudioTrackListItem[];
  onSelect: (item: AudioTrackListItem) => void;
  onContextMenu?: (item: AudioTrackListItem, event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite?: (item: AudioTrackListItem) => void;
  showFavoriteButton?: boolean;
  showPlaybackIndicator?: boolean;
  className?: string;
  itemClassName?: string;
}

export const AudioTrackList: React.FC<AudioTrackListProps> = ({
  items,
  onSelect,
  onContextMenu,
  onToggleFavorite,
  showFavoriteButton = false,
  showPlaybackIndicator = false,
  className,
  itemClassName,
}) => {
  return (
    <div className={classNames('audio-track-list', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={classNames('audio-track-list__item', itemClassName, {
            'audio-track-list__item--active': item.isActive,
          })}
          onClick={() => onSelect(item)}
          onContextMenu={(event) => onContextMenu?.(item, event)}
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
              {showFavoriteButton ? (
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
                <div className="audio-track-list__status">
                  {item.isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </div>
              ) : null}
            </div>
          ) : null}
        </button>
      ))}
    </div>
  );
};
