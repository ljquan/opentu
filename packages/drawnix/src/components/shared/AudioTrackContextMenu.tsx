import React from 'react';
import { createPortal } from 'react-dom';
import { Heart, ListMusic, Plus, XSquare } from 'lucide-react';
import type { AudioPlaylist, AudioPlaylistItem } from '../../types/audio-playlist.types';

interface AudioTrackContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    assetId: string;
  } | null;
  playlists: AudioPlaylist[];
  playlistItems: Record<string, AudioPlaylistItem[]>;
  favoriteAssetIds: Set<string>;
  selectedPlaylistId?: string | null;
  currentPlaylistAssetIds?: Set<string>;
  onClose: () => void;
  onToggleFavorite: (assetId: string) => void;
  onAddToPlaylist: (assetId: string, playlistId: string) => void;
  onRemoveFromPlaylist?: (assetId: string, playlistId: string) => void;
  onCreatePlaylistAndAdd: (assetId: string) => void;
}

export const AudioTrackContextMenu: React.FC<AudioTrackContextMenuProps> = ({
  contextMenu,
  playlists,
  playlistItems,
  favoriteAssetIds,
  selectedPlaylistId,
  currentPlaylistAssetIds,
  onClose,
  onToggleFavorite,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onCreatePlaylistAndAdd,
}) => {
  if (!contextMenu) {
    return null;
  }

  return createPortal(
    <div
      className="audio-track-context-menu"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="audio-track-context-menu__item"
        onClick={() => {
          onClose();
          onToggleFavorite(contextMenu.assetId);
        }}
      >
        <Heart size={14} />
        <span>{favoriteAssetIds.has(contextMenu.assetId) ? '取消收藏' : '加入收藏'}</span>
      </button>
      {playlists.map((playlist) => {
        const exists = (playlistItems[playlist.id] || []).some((item) => item.assetId === contextMenu.assetId);
        return (
          <button
            key={playlist.id}
            type="button"
            className="audio-track-context-menu__item"
            disabled={exists}
            onClick={() => {
              onClose();
              onAddToPlaylist(contextMenu.assetId, playlist.id);
            }}
          >
            <ListMusic size={14} />
            <span>{exists ? `已在 ${playlist.name}` : `添加到 ${playlist.name}`}</span>
          </button>
        );
      })}
      {selectedPlaylistId && currentPlaylistAssetIds?.has(contextMenu.assetId) && onRemoveFromPlaylist ? (
        <button
          type="button"
          className="audio-track-context-menu__item audio-track-context-menu__item--danger"
          onClick={() => {
            onClose();
            onRemoveFromPlaylist(contextMenu.assetId, selectedPlaylistId);
          }}
        >
          <XSquare size={14} />
          <span>从当前播放列表移除</span>
        </button>
      ) : null}
      <button
        type="button"
        className="audio-track-context-menu__item"
        onClick={() => {
          onClose();
          onCreatePlaylistAndAdd(contextMenu.assetId);
        }}
      >
        <Plus size={14} />
        <span>新建播放列表并添加</span>
      </button>
    </div>,
    document.body
  );
};
