import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, Input } from 'tdesign-react';
import { AudioTrackList } from '../shared/AudioTrackList';
import { AudioTrackContextMenu } from '../shared/AudioTrackContextMenu';
import { useAudioPlaylists } from '../../contexts/AudioPlaylistContext';
import { AUDIO_PLAYLIST_ALL_ID } from '../../types/audio-playlist.types';
import type { CanvasAudioPlaybackSource, CanvasAudioQueueSource } from '../../services/canvas-audio-playback-service';

interface CanvasAudioPlayerPlaylistProps {
  queue: CanvasAudioPlaybackSource[];
  activeQueueIndex: number;
  queueSource: CanvasAudioQueueSource;
  activePlaylistId?: string;
  onSelect: (item: CanvasAudioPlaybackSource) => void;
}

const ASSET_ELEMENT_ID_PREFIX = 'asset:';

function formatDuration(duration?: number): string {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const CanvasAudioPlayerPlaylist: React.FC<CanvasAudioPlayerPlaylistProps> = ({
  queue,
  activeQueueIndex,
  queueSource,
  activePlaylistId,
  onSelect,
}) => {
  const {
    playlists,
    playlistItems,
    favoriteAssetIds,
    createPlaylist,
    addAssetToPlaylist,
    removeAssetFromPlaylist,
    toggleFavorite,
  } = useAudioPlaylists();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    assetId: string;
  } | null>(null);
  const [createDialogVisible, setCreateDialogVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    document.addEventListener('click', closeMenu);
    document.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
    };
  }, []);

  const selectedPlaylistId =
    queueSource === 'playlist' && activePlaylistId ? activePlaylistId : AUDIO_PLAYLIST_ALL_ID;
  const currentPlaylistAssetIds = useMemo(
    () => new Set(
      selectedPlaylistId !== AUDIO_PLAYLIST_ALL_ID
        ? (playlistItems[selectedPlaylistId] || []).map((item) => item.assetId)
        : []
    ),
    [playlistItems, selectedPlaylistId]
  );
  const showPlaylistActions = queueSource === 'playlist';

  return (
    <div className="canvas-audio-player__playlist">
      <AudioTrackList
        className="canvas-audio-player__playlist-list"
        items={queue.map((item, index) => ({
          id: `${item.audioUrl}-${index}`,
          title: item.title || '未命名音频',
          subtitle: formatDuration(item.duration),
          previewImageUrl: item.previewImageUrl,
          isActive: index === activeQueueIndex,
          isPlaying: index === activeQueueIndex,
          isFavorite: item.elementId?.startsWith(ASSET_ELEMENT_ID_PREFIX)
            ? favoriteAssetIds.has(item.elementId.slice(ASSET_ELEMENT_ID_PREFIX.length))
            : false,
        }))}
        onSelect={(selectedItem) => {
          const nextItem = queue.find((item, index) => `${item.audioUrl}-${index}` === selectedItem.id);
          if (nextItem) {
            onSelect(nextItem);
          }
        }}
        onContextMenu={(selectedItem, event) => {
          if (!showPlaylistActions) {
            return;
          }
          const nextItem = queue.find((item, index) => `${item.audioUrl}-${index}` === selectedItem.id);
          const assetId = nextItem?.elementId?.startsWith(ASSET_ELEMENT_ID_PREFIX)
            ? nextItem.elementId.slice(ASSET_ELEMENT_ID_PREFIX.length)
            : null;
          if (!assetId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            assetId,
          });
        }}
        onToggleFavorite={(selectedItem) => {
          if (!showPlaylistActions) {
            return;
          }
          const nextItem = queue.find((item, index) => `${item.audioUrl}-${index}` === selectedItem.id);
          const assetId = nextItem?.elementId?.startsWith(ASSET_ELEMENT_ID_PREFIX)
            ? nextItem.elementId.slice(ASSET_ELEMENT_ID_PREFIX.length)
            : null;
          if (assetId) {
            void toggleFavorite(assetId);
          }
        }}
        showFavoriteButton={showPlaylistActions}
        showPlaybackIndicator
      />
      <AudioTrackContextMenu
        contextMenu={contextMenu}
        playlists={playlists}
        playlistItems={playlistItems}
        favoriteAssetIds={favoriteAssetIds}
        selectedPlaylistId={selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID ? null : selectedPlaylistId}
        currentPlaylistAssetIds={currentPlaylistAssetIds}
        onClose={() => setContextMenu(null)}
        onToggleFavorite={(assetId) => void toggleFavorite(assetId)}
        onAddToPlaylist={(assetId, playlistId) => void addAssetToPlaylist(assetId, playlistId)}
        onRemoveFromPlaylist={(assetId, playlistId) => void removeAssetFromPlaylist(assetId, playlistId)}
        onCreatePlaylistAndAdd={(assetId) => {
          setPendingAssetId(assetId);
          setPlaylistName('');
          setCreateDialogVisible(true);
        }}
      />
      <Dialog
        visible={createDialogVisible}
        header="新建播放列表"
        onClose={() => setCreateDialogVisible(false)}
        onConfirm={async () => {
          const playlist = await createPlaylist(playlistName);
          if (pendingAssetId) {
            await addAssetToPlaylist(pendingAssetId, playlist.id);
          }
          setCreateDialogVisible(false);
          setPlaylistName('');
          setPendingAssetId(null);
        }}
        onCancel={() => {
          setCreateDialogVisible(false);
          setPendingAssetId(null);
        }}
        confirmBtn="确定"
        cancelBtn="取消"
      >
        <Input
          value={playlistName}
          onChange={(value) => setPlaylistName(String(value))}
          placeholder="请输入播放列表名称"
        />
      </Dialog>
    </div>
  );
};
