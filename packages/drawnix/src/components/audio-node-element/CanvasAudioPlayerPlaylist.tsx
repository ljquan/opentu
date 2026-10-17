import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Input } from 'tdesign-react';
import { Music4 } from 'lucide-react';
import { AudioTrackList } from '../shared/AudioTrackList';
import { AudioTrackContextMenu } from '../shared/AudioTrackContextMenu';
import { AudioPlaylistTabs } from '../shared/AudioPlaylistTabs';
import { useContextMenuState } from '../shared/ContextMenu';
import { useAssets } from '../../contexts/AssetContext';
import { useResolvedAudioDurations } from '../../hooks/useResolvedAudioDurations';
import { useAllTracksPlaybackSources } from '../../hooks/useAllTracksPlaybackSources';
import { AssetType } from '../../types/asset.types';
import { useAudioPlaylists } from '../../contexts/AudioPlaylistContext';
import {
  AUDIO_PLAYLIST_ALL_ID,
  AUDIO_PLAYLIST_ALL_TRACKS_ID,
  getAudioPlaylistItemRef,
  getAudioPlaylistItemRefKey,
  type AudioPlaylistItemRef,
} from '../../types/audio-playlist.types';
import {
  isReadingPlaybackSource,
  type CanvasAudioPlaybackSource,
  type CanvasAudioQueueSource,
  type PlaybackQueueItem,
} from '../../services/canvas-audio-playback-service';
import type { ReadingPlaybackSource } from '../../services/reading-playback-source';

interface CanvasAudioPlayerPlaylistProps {
  queue: PlaybackQueueItem[];
  activeQueueIndex: number;
  queueSource: CanvasAudioQueueSource;
  activePlaylistId?: string;
  playing?: boolean;
  loading?: boolean;
  activeReadingSourceId?: string;
  onSelect: (item: PlaybackQueueItem) => void;
  onPlayAllTracksItem: (
    source: ReadingPlaybackSource,
    queue: ReadingPlaybackSource[]
  ) => void | Promise<void>;
}

const ASSET_ELEMENT_ID_PREFIX = 'asset:';

function getAssetIdFromSource(item?: CanvasAudioPlaybackSource): string | null {
  if (!item?.elementId?.startsWith(ASSET_ELEMENT_ID_PREFIX)) {
    return null;
  }

  return item.elementId.slice(ASSET_ELEMENT_ID_PREFIX.length);
}

function formatDuration(duration?: number): string {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatReadingDuration(source: ReadingPlaybackSource): string {
  const totalDurationMs = source.segments[source.segments.length - 1]?.endMs || 0;
  return formatDuration(totalDurationMs / 1000);
}

export const CanvasAudioPlayerPlaylist: React.FC<CanvasAudioPlayerPlaylistProps> = ({
  queue,
  activeQueueIndex,
  queueSource,
  activePlaylistId,
  playing = false,
  loading = false,
  activeReadingSourceId,
  onSelect,
  onPlayAllTracksItem,
}) => {
  const { assets } = useAssets();
  const {
    playlists,
    playlistItems,
    favoriteAssetIds,
    createPlaylist,
    addItemToPlaylist,
    removeItemFromPlaylist,
    toggleFavorite,
  } = useAudioPlaylists();
  const {
    contextMenu,
    openAt: openContextMenuAt,
    close: closeContextMenu,
  } = useContextMenuState<AudioPlaylistItemRef>();
  const [createDialogVisible, setCreateDialogVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [pendingPlaylistItem, setPendingPlaylistItem] = useState<AudioPlaylistItemRef | null>(null);
  const { noteMetas, loadReadingSource, buildReadingQueue } = useAllTracksPlaybackSources();
  const [selectedTabId, setSelectedTabId] = useState<string>(
    queueSource === 'reading'
      ? AUDIO_PLAYLIST_ALL_TRACKS_ID
      : activePlaylistId || AUDIO_PLAYLIST_ALL_ID
  );
  const playbackContextKey = `${queueSource}:${activePlaylistId || ''}`;
  const previousPlaybackContextKeyRef = useRef(playbackContextKey);
  const isAllTracksTab = selectedTabId === AUDIO_PLAYLIST_ALL_TRACKS_ID;

  useEffect(() => {
    if (previousPlaybackContextKeyRef.current === playbackContextKey) {
      return;
    }

    previousPlaybackContextKeyRef.current = playbackContextKey;
    setSelectedTabId(
      queueSource === 'reading'
        ? AUDIO_PLAYLIST_ALL_TRACKS_ID
        : activePlaylistId || AUDIO_PLAYLIST_ALL_ID
    );
  }, [activePlaylistId, playbackContextKey, queueSource]);

  const selectedPlaylistId =
    selectedTabId !== AUDIO_PLAYLIST_ALL_ID && selectedTabId !== AUDIO_PLAYLIST_ALL_TRACKS_ID
      ? selectedTabId
      : null;
  const audioQueue = queue.filter((item): item is CanvasAudioPlaybackSource => !isReadingPlaybackSource(item));
  const resolvedDurations = useResolvedAudioDurations(audioQueue);
  const resolveAssetId = useCallback(
    (item?: CanvasAudioPlaybackSource): string | null => {
      const directAssetId = getAssetIdFromSource(item);
      if (directAssetId) {
        return directAssetId;
      }

      if (!item?.audioUrl) {
        return null;
      }

      const matchedAsset = assets.find(
        (asset) => asset.type === AssetType.AUDIO && asset.url === item.audioUrl
      );
      return matchedAsset?.id || null;
    },
    [assets]
  );
  const currentPlaylistItemKeys = useMemo(
    () => new Set(
      selectedPlaylistId
        ? (playlistItems[selectedPlaylistId] || [])
          .map((item) => {
            const ref = getAudioPlaylistItemRef(item);
            return ref ? getAudioPlaylistItemRefKey(ref) : null;
          })
          .filter((item): item is string => !!item)
        : []
    ),
    [playlistItems, selectedPlaylistId]
  );
  const handlePlayAllTracksItem = useCallback(
    async (noteId: string) => {
      const source = await loadReadingSource(noteId);
      if (!source) return;
      const fullQueue = await buildReadingQueue(noteId);
      const queuedSource = fullQueue.find(
        (item) => item.readingSourceId === source.readingSourceId
      ) || source;
      await onPlayAllTracksItem(queuedSource, fullQueue);
    },
    [onPlayAllTracksItem, loadReadingSource, buildReadingQueue]
  );

  const allTracksListItems = useMemo(
    () =>
      noteMetas.map((meta) => ({
        id: meta.id,
        title: meta.title || '未命名笔记',
        subtitle: new Date(meta.updatedAt).toLocaleDateString('zh-CN'),
        canFavorite: false,
        isActive: activeReadingSourceId?.startsWith(`kb-note:${meta.id}:`) === true,
        isPlaying: playing && activeReadingSourceId?.startsWith(`kb-note:${meta.id}:`) === true,
        isLoading: loading && activeReadingSourceId?.startsWith(`kb-note:${meta.id}:`) === true,
      })),
    [noteMetas, activeReadingSourceId, loading, playing]
  );

  const getQueueItemId = (item: PlaybackQueueItem, index: number): string =>
    isReadingPlaybackSource(item) ? item.readingSourceId : `${item.audioUrl}-${index}`;

  const queueListItems = useMemo(
    () => queue.map((item, index) => {
      if (isReadingPlaybackSource(item)) {
        return {
          id: getQueueItemId(item, index),
          title: item.title || '朗读轨道',
          subtitle: formatReadingDuration(item),
          previewImageUrl: item.previewImageUrl,
          isActive: index === activeQueueIndex,
          isPlaying: playing && index === activeQueueIndex,
          isLoading: loading && index === activeQueueIndex,
          canFavorite: false,
          playlistItemRef: item.origin.kind === 'kb-note'
            ? { kind: 'reading' as const, noteId: item.origin.id }
            : undefined,
        };
      }

      const assetId = resolveAssetId(item);
      return {
        id: getQueueItemId(item, index),
        title: item.title || '未命名音频',
        subtitle: formatDuration(resolvedDurations.get(item.audioUrl) ?? item.duration),
        previewImageUrl: item.previewImageUrl,
        isActive: index === activeQueueIndex,
        isPlaying: playing && index === activeQueueIndex,
        isLoading: loading && index === activeQueueIndex,
        isFavorite: assetId ? favoriteAssetIds.has(assetId) : false,
        canFavorite: !!assetId,
        assetId: assetId || undefined,
        playlistItemRef: assetId ? { kind: 'asset' as const, assetId } : undefined,
      };
    }),
    [activeQueueIndex, favoriteAssetIds, loading, playing, queue, resolvedDurations, resolveAssetId]
  );

  const shouldRenderQueue = queueSource === 'reading'
    ? !isAllTracksTab
    : queueSource === 'playlist'
      ? selectedTabId !== AUDIO_PLAYLIST_ALL_ID
      : !isAllTracksTab;

  const findQueueItem = useCallback(
    (itemId: string) => queue.find((item, index) => getQueueItemId(item, index) === itemId),
    [queue]
  );

  return (
    <div className="canvas-audio-player__playlist">
      <AudioPlaylistTabs
        className="canvas-audio-player__playlist-tabs"
        selectedPlaylistId={selectedTabId}
        allCount={audioQueue.length}
        allTracksCount={noteMetas.length}
        playlists={playlists}
        playlistItems={playlistItems}
        onSelect={setSelectedTabId}
        onCreate={() => {
          setPendingPlaylistItem(null);
          setPlaylistName('');
          setCreateDialogVisible(true);
        }}
      />
      {isAllTracksTab ? (
        allTracksListItems.length === 0 ? (
          <div className="canvas-audio-player__playlist-empty">
            <Music4 size={16} />
            <span>知识库还没有笔记</span>
          </div>
        ) : (
          <AudioTrackList
            className="canvas-audio-player__playlist-list"
            items={allTracksListItems}
            onSelect={(item) => void handlePlayAllTracksItem(item.id)}
            onTogglePlayback={(item) => void handlePlayAllTracksItem(item.id)}
            showPlaybackIndicator
          />
        )
      ) : shouldRenderQueue ? (
        <AudioTrackList
        className="canvas-audio-player__playlist-list audio-track-list--queue"
        items={queueListItems}
        onSelect={(selectedItem) => {
          const nextItem = findQueueItem(selectedItem.id);
          if (nextItem) onSelect(nextItem);
        }}
        onContextMenu={(selectedItem, event) => {
          if (!selectedItem.playlistItemRef) return;
          event.preventDefault();
          event.stopPropagation();
          openContextMenuAt(event.clientX, event.clientY, selectedItem.playlistItemRef);
        }}
        onToggleFavorite={(selectedItem) => {
          if (selectedItem.assetId) void toggleFavorite(selectedItem.assetId);
        }}
        onTogglePlayback={(selectedItem) => {
          const nextItem = findQueueItem(selectedItem.id);
          if (nextItem) onSelect(nextItem);
        }}
        showFavoriteButton
        showPlaybackIndicator
        />
      ) : null}
      <AudioTrackContextMenu
        contextMenu={
          contextMenu
            ? {
                x: contextMenu.x,
                y: contextMenu.y,
                item: contextMenu.payload,
              }
            : null
        }
        playlists={playlists}
        playlistItems={playlistItems}
        favoriteAssetIds={favoriteAssetIds}
        selectedPlaylistId={selectedPlaylistId}
        currentPlaylistItemKeys={currentPlaylistItemKeys}
        onClose={closeContextMenu}
        onToggleFavorite={(assetId) => void toggleFavorite(assetId)}
        onAddToPlaylist={(item, playlistId) => {
          void addItemToPlaylist(item, playlistId);
        }}
        onRemoveFromPlaylist={(item, playlistId) => {
          void removeItemFromPlaylist(item, playlistId);
        }}
        onCreatePlaylistAndAdd={(item) => {
          setPendingPlaylistItem(item);
          setPlaylistName('');
          setCreateDialogVisible(true);
        }}
      />
      <Dialog
        visible={createDialogVisible}
        header="新建播放列表"
        onClose={() => {
          setCreateDialogVisible(false);
          setPendingPlaylistItem(null);
        }}
        onConfirm={async () => {
          const playlist = await createPlaylist(playlistName);
          if (pendingPlaylistItem) {
            await addItemToPlaylist(pendingPlaylistItem, playlist.id);
          }
          setCreateDialogVisible(false);
          setPlaylistName('');
          setPendingPlaylistItem(null);
        }}
        onCancel={() => {
          setCreateDialogVisible(false);
          setPendingPlaylistItem(null);
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
