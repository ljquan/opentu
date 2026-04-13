import React from 'react';
import { Heart, ListMusic, Plus, XSquare } from 'lucide-react';
import type {
  AudioPlaylist,
  AudioPlaylistItem,
  AudioPlaylistItemRef,
} from '../../types/audio-playlist.types';
import {
  getAudioPlaylistItemRef,
  getAudioPlaylistItemRefKey,
  isAudioPlaylistAssetItemRef,
} from '../../types/audio-playlist.types';
import {
  ContextMenu,
  type ContextMenuEntry,
} from './ContextMenu';

interface AudioTrackContextMenuProps {
  contextMenu: {
    x: number;
    y: number;
    item: AudioPlaylistItemRef;
  } | null;
  playlists: AudioPlaylist[];
  playlistItems: Record<string, AudioPlaylistItem[]>;
  favoriteAssetIds: Set<string>;
  selectedPlaylistId?: string | null;
  currentPlaylistItemKeys?: Set<string>;
  onClose: () => void;
  onToggleFavorite: (assetId: string) => void;
  onAddToPlaylist: (item: AudioPlaylistItemRef, playlistId: string) => void;
  onRemoveFromPlaylist?: (item: AudioPlaylistItemRef, playlistId: string) => void;
  onCreatePlaylistAndAdd: (item: AudioPlaylistItemRef) => void;
}

export const AudioTrackContextMenu: React.FC<AudioTrackContextMenuProps> = ({
  contextMenu,
  playlists,
  playlistItems,
  favoriteAssetIds,
  selectedPlaylistId,
  currentPlaylistItemKeys,
  onClose,
  onToggleFavorite,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onCreatePlaylistAndAdd,
}) => {
  if (!contextMenu) {
    return null;
  }

  const items: ContextMenuEntry<AudioPlaylistItemRef>[] = [];

  if (isAudioPlaylistAssetItemRef(contextMenu.item)) {
    items.push({
      key: 'favorite',
      label: (item) => (
        isAudioPlaylistAssetItemRef(item) && favoriteAssetIds.has(item.assetId)
          ? '取消收藏'
          : '加入收藏'
      ),
      icon: <Heart size={14} />,
      onSelect: (item) => {
        if (isAudioPlaylistAssetItemRef(item)) {
          onToggleFavorite(item.assetId);
        }
      },
    });
  }

  items.push(
    {
      key: 'playlist-actions',
      type: 'submenu',
      label: '添加到播放列表',
      icon: <ListMusic size={14} />,
      children: (itemRef) =>
        playlists.map((playlist) => {
          const exists = (playlistItems[playlist.id] || [])
            .map((item) => getAudioPlaylistItemRef(item))
            .some((item) => item ? getAudioPlaylistItemRefKey(item) === getAudioPlaylistItemRefKey(itemRef) : false);
          return {
            key: `playlist-${playlist.id}`,
            label: exists ? `已在 ${playlist.name}` : `添加到 ${playlist.name}`,
            icon: <ListMusic size={14} />,
            disabled: exists,
            onSelect: () => onAddToPlaylist(itemRef, playlist.id),
          };
        }),
    },
  );

  if (
    selectedPlaylistId &&
    currentPlaylistItemKeys?.has(getAudioPlaylistItemRefKey(contextMenu.item)) &&
    onRemoveFromPlaylist
  ) {
    items.push({
      key: 'remove-from-current',
      label: '从当前播放列表移除',
      icon: <XSquare size={14} />,
      danger: true,
      onSelect: (item) => onRemoveFromPlaylist(item, selectedPlaylistId),
    });
  }

  items.push({
    key: 'create-playlist',
    label: '新建播放列表并添加',
    icon: <Plus size={14} />,
    onSelect: (item) => onCreatePlaylistAndAdd(item),
  });

  return (
    <ContextMenu
      state={{
        x: contextMenu.x,
        y: contextMenu.y,
        payload: contextMenu.item,
      }}
      items={items}
      onClose={onClose}
    />
  );
};
