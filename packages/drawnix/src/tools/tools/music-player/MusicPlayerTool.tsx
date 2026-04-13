import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Dialog, Dropdown } from 'tdesign-react';
import {
  Pause,
  Play,
  Search,
  Minimize2,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  ListOrdered,
  Gauge,
} from 'lucide-react';
import { useAssets } from '../../../contexts/AssetContext';
import { useAudioPlaylists } from '../../../contexts/AudioPlaylistContext';
import { AssetType } from '../../../types/asset.types';
import {
  AUDIO_PLAYLIST_ALL_ID,
  AUDIO_PLAYLIST_ALL_TRACKS_ID,
  AUDIO_PLAYLIST_CANVAS_AUDIO_ID,
  AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL,
  AUDIO_PLAYLIST_CANVAS_READING_ID,
  AUDIO_PLAYLIST_CANVAS_READING_LABEL,
  getAudioPlaylistItemRefKey,
  isAudioPlaylistAssetItemRef,
  type AudioPlaylistItemRef,
} from '../../../types/audio-playlist.types';
import { AudioCover } from '../../../components/shared/AudioCover';
import { type AudioTrackListItem } from '../../../components/shared/AudioTrackList';
import { AudioPlaylistTabs } from '../../../components/shared/AudioPlaylistTabs';
import { AudioTrackContextMenu } from '../../../components/shared/AudioTrackContextMenu';
import { useCanvasAudioPlayback } from '../../../hooks/useCanvasAudioPlayback';
import { useAllTracksPlaybackSources } from '../../../hooks/useAllTracksPlaybackSources';
import { useResolvedAudioDurations } from '../../../hooks/useResolvedAudioDurations';
import {
  getPlaybackSpeedPresets,
  formatPlaybackRateLabel,
  type CanvasAudioPlaybackSource,
  isReadingPlaybackSource,
  PLAYBACK_MODE_LABELS,
  type PlaybackQueueItem,
  type PlaybackMode,
} from '../../../services/canvas-audio-playback-service';
import { toolWindowService } from '../../../services/tool-window-service';
import { MUSIC_PLAYER_TOOL_ID } from '../../tool-ids';
import { MusicPlayerQueueList } from './MusicPlayerQueueList';
import './music-player-tool.scss';

const DEFAULT_PLAYER_WINDOW_SIZE = { width: 520, height: 640 };
const SUBTITLE_PLAYER_WINDOW_SIZE = { width: 860, height: 640 };
const PLAYBACK_MODE_ICONS: Record<PlaybackMode, React.ReactElement> = {
  sequential: <ListOrdered size={16} />,
  'list-loop': <Repeat size={16} />,
  'single-loop': <Repeat1 size={16} />,
  shuffle: <Shuffle size={16} />,
};
const PLAYBACK_MODE_OPTIONS = (Object.keys(PLAYBACK_MODE_LABELS) as PlaybackMode[]).map((mode) => ({
  value: mode,
  content: PLAYBACK_MODE_LABELS[mode],
  prefixIcon: PLAYBACK_MODE_ICONS[mode],
}));

function buildPlaybackRateOptions(currentRate: number, mediaType: 'audio' | 'reading') {
  return getPlaybackSpeedPresets(mediaType).map((rate) => {
    const label = formatPlaybackRateLabel(rate);
    const isActive = Math.abs(rate - currentRate) < 0.001;
    return {
      value: rate,
      content: isActive ? `✓ ${label}` : label,
    };
  });
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

function formatGeneratedTime(createdAt?: number): string {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt) || createdAt <= 0) {
    return '--:--';
  }

  return new Date(createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatTrackSubtitle(duration?: number, createdAt?: number): string {
  const formattedDuration = formatDuration(duration);
  if (formattedDuration !== '--:--') {
    return formattedDuration;
  }
  return formatGeneratedTime(createdAt);
}

function openKnowledgeBaseNote(noteId: string): void {
  window.dispatchEvent(new CustomEvent('kb:open', { detail: { noteId } }));
}

function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}

export const MusicPlayerTool: React.FC = () => {
  const { assets, loadAssets } = useAssets();
  const {
    playlists,
    playlistItems,
    favoriteAssetIds,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addItemToPlaylist,
    removeItemFromPlaylist,
    toggleFavorite,
    getPlaylistItemRefs,
  } = useAudioPlaylists();
  const playback = useCanvasAudioPlayback();
  const isReadingMode = playback.queueSource === 'reading';
  const { noteMetas, loadReadingSource, buildReadingQueue } = useAllTracksPlaybackSources();
  const [query, setQuery] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(() => {
    if (playback.activePlaylistId) {
      return playback.activePlaylistId;
    }
    if (playback.queueSource === 'reading') {
      return AUDIO_PLAYLIST_ALL_TRACKS_ID;
    }
    return AUDIO_PLAYLIST_ALL_ID;
  });
  const isAllTracksTab = selectedPlaylistId === AUDIO_PLAYLIST_ALL_TRACKS_ID;
  const [createDialogVisible, setCreateDialogVisible] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: AudioPlaylistItemRef;
  } | null>(null);
  const [pendingPlaylistItem, setPendingPlaylistItem] = useState<AudioPlaylistItemRef | null>(null);
  const [playlistDialogMode, setPlaylistDialogMode] = useState<'create' | 'rename'>('create');
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const previousPlaybackTabIdRef = useRef(playback.activePlaylistId || (
    playback.queueSource === 'reading' ? AUDIO_PLAYLIST_ALL_TRACKS_ID : AUDIO_PLAYLIST_ALL_ID
  ));

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
    };
    document.addEventListener('click', closeMenu);
    document.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
    };
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const storedAudioAssets = useMemo(
    () => assets.filter((asset) => asset.type === AssetType.AUDIO),
    [assets]
  );
  const assetById = useMemo(
    () => new Map(storedAudioAssets.map((asset) => [asset.id, asset])),
    [storedAudioAssets]
  );
  const noteMetaById = useMemo(
    () => new Map(noteMetas.map((meta) => [meta.id, meta])),
    [noteMetas]
  );
  const allAudioAssets = useMemo(
    () =>
      storedAudioAssets
        .filter((asset) =>
          normalizedQuery.length === 0 ? true : asset.name.toLowerCase().includes(normalizedQuery)
        )
        .sort((left, right) => right.createdAt - left.createdAt),
    [normalizedQuery, storedAudioAssets]
  );
  const selectedPlaylistItems = useMemo(
    () =>
      selectedPlaylistId !== AUDIO_PLAYLIST_ALL_ID
      && selectedPlaylistId !== AUDIO_PLAYLIST_ALL_TRACKS_ID
        ? getPlaylistItemRefs(selectedPlaylistId)
        : [],
    [getPlaylistItemRefs, selectedPlaylistId]
  );
  const showPlaybackQueue =
    playback.queue.length > 0 && (isReadingMode || !!playback.activeAudioUrl);
  const playbackRateMediaType = playback.mediaType === 'reading' ? 'reading' : 'audio';
  const playbackTabId = playback.activePlaylistId || (
    isReadingMode
      ? AUDIO_PLAYLIST_ALL_TRACKS_ID
      : playback.queueSource === 'playlist'
        ? playback.activePlaylistId || AUDIO_PLAYLIST_ALL_ID
        : AUDIO_PLAYLIST_ALL_ID
  );
  const shouldShowPlaybackQueue = showPlaybackQueue && selectedPlaylistId === playbackTabId;
  const playbackRateOptions = useMemo(
    () => buildPlaybackRateOptions(playback.effectivePlaybackRate, playbackRateMediaType),
    [playback.effectivePlaybackRate, playbackRateMediaType]
  );
  const playbackRateLabel = formatPlaybackRateLabel(playback.effectivePlaybackRate);
  const playbackRateTooltip = `${
    playback.mediaType === 'reading' ? '语音速度' : '播放速度'
  } ${playbackRateLabel}`;
  const tempTabs = useMemo(() => {
    if (!showPlaybackQueue) {
      return [];
    }

    if (playbackTabId === AUDIO_PLAYLIST_CANVAS_AUDIO_ID) {
      return [{
        id: AUDIO_PLAYLIST_CANVAS_AUDIO_ID,
        label: playback.activePlaylistName || AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL,
        count: playback.queue.length,
        type: 'audio' as const,
      }];
    }

    if (playbackTabId === AUDIO_PLAYLIST_CANVAS_READING_ID) {
      return [{
        id: AUDIO_PLAYLIST_CANVAS_READING_ID,
        label: playback.activePlaylistName || AUDIO_PLAYLIST_CANVAS_READING_LABEL,
        count: playback.queue.length,
        type: 'reading' as const,
      }];
    }

    return [];
  }, [playback.activePlaylistName, playback.queue.length, playbackTabId, showPlaybackQueue]);

  useEffect(() => {
    if (!showPlaybackQueue) {
      previousPlaybackTabIdRef.current = playbackTabId;
      return;
    }

    setSelectedPlaylistId((current) => {
      if (current === playbackTabId) {
        return current;
      }
      if (previousPlaybackTabIdRef.current !== playbackTabId) {
        return playbackTabId;
      }
      return current;
    });
    previousPlaybackTabIdRef.current = playbackTabId;
  }, [playbackTabId, showPlaybackQueue]);

  const audioPlaybackQueue = useMemo(
    () =>
      playback.queue.filter(
        (item): item is CanvasAudioPlaybackSource => !isReadingPlaybackSource(item)
      ),
    [playback.queue]
  );
  const resolvedQueueDurations = useResolvedAudioDurations(audioPlaybackQueue);
  const audioAssetDurationSources = useMemo(
    () =>
      storedAudioAssets.map((asset) => ({
        audioUrl: asset.url,
      })),
    [storedAudioAssets]
  );
  const resolvedAudioAssetDurations = useResolvedAudioDurations(audioAssetDurationSources);

  const getQueueItemId = (item: PlaybackQueueItem, index: number) =>
    isReadingPlaybackSource(item) ? item.readingSourceId : `${item.audioUrl}-${index}`;

  const buildAudioPlaybackSource = (assetId: string): CanvasAudioPlaybackSource | null => {
    const asset = assetById.get(assetId);
    if (!asset) {
      return null;
    }

    return {
      elementId: `asset:${asset.id}`,
      audioUrl: asset.url,
      title: asset.name,
      previewImageUrl: asset.thumbnail,
    };
  };

  const queueListItems = useMemo(
    () =>
      playback.queue.map((item, index) => {
        if (isReadingPlaybackSource(item)) {
          const durationMs = item.segments[item.segments.length - 1]?.endMs || 0;
          const noteId = item.origin.kind === 'kb-note' ? item.origin.id : undefined;
          return {
            id: getQueueItemId(item, index),
            title: item.title || '朗读轨道',
            subtitle: formatDuration(durationMs / 1000),
            previewImageUrl: item.previewImageUrl,
            isActive: index === playback.activeQueueIndex,
            isPlaying: index === playback.activeQueueIndex && playback.playing,
            canFavorite: false,
            noteId,
            playlistItemRef: noteId ? { kind: 'reading' as const, noteId } : undefined,
          };
        }

        const assetId = item.elementId?.startsWith('asset:')
          ? item.elementId.slice('asset:'.length)
          : (
            assets.find((asset) => asset.type === AssetType.AUDIO && asset.url === item.audioUrl)?.id || null
          );
        return {
          id: getQueueItemId(item, index),
          title: item.title || '未命名音频',
          subtitle: formatTrackSubtitle(
            resolvedQueueDurations.get(item.audioUrl) ?? item.duration,
            assetId ? assetById.get(assetId)?.createdAt : undefined
          ),
          previewImageUrl: item.previewImageUrl,
          isActive: index === playback.activeQueueIndex,
          isPlaying: index === playback.activeQueueIndex && playback.playing,
          isFavorite: assetId ? favoriteAssetIds.has(assetId) : false,
          canFavorite: !!assetId,
          assetId: assetId || undefined,
          playlistItemRef: assetId ? { kind: 'asset' as const, assetId } : undefined,
        };
      }),
    [assetById, assets, favoriteAssetIds, playback.activeQueueIndex, playback.playing, playback.queue, resolvedQueueDurations]
  );

  const handlePlayQueueItem = async (itemId: string) => {
    const selectedItem = playback.queue.find((item, index) => getQueueItemId(item, index) === itemId);
    if (!selectedItem) {
      return;
    }
    if (isReadingPlaybackSource(selectedItem)) {
      playback.toggleReadingPlayback(selectedItem);
      return;
    }
    await playback.togglePlayback(selectedItem);
  };

  const activePlaylist = playlists.find((p) => p.id === selectedPlaylistId) || null;
  const currentPlaylistItemKeys = useMemo(
    () => new Set(selectedPlaylistItems.map((item) => getAudioPlaylistItemRefKey(item))),
    [selectedPlaylistItems]
  );
  const activeAsset = useMemo(() => {
    const elementAssetId = playback.activeElementId?.startsWith('asset:')
      ? playback.activeElementId.slice('asset:'.length)
      : null;
    if (elementAssetId) {
      return assetById.get(elementAssetId) || null;
    }

    const exactUrlAndTitleMatch = storedAudioAssets.find(
      (asset) => asset.url === playback.activeAudioUrl && asset.name === playback.activeTitle
    );
    if (exactUrlAndTitleMatch) {
      return exactUrlAndTitleMatch;
    }

    return storedAudioAssets.find((asset) => asset.url === playback.activeAudioUrl) || null;
  }, [assetById, storedAudioAssets, playback.activeAudioUrl, playback.activeElementId, playback.activeTitle]);
  const activeReadingNoteId =
    playback.activeReadingOrigin?.kind === 'kb-note' ? playback.activeReadingOrigin.id : null;
  const activeReadingItem = useMemo(
    () =>
      isReadingMode && playback.activeQueueIndex >= 0
        ? playback.queue[playback.activeQueueIndex]
        : null,
    [isReadingMode, playback.activeQueueIndex, playback.queue]
  );
  const activeAssetId = activeAsset?.id || null;
  const allTracksListItems = useMemo<AudioTrackListItem[]>(
    () =>
      noteMetas.map((meta) => ({
        id: `reading:${meta.id}`,
        title: meta.title || '未命名笔记',
        subtitle: new Date(meta.updatedAt).toLocaleDateString('zh-CN'),
        canFavorite: false,
        noteId: meta.id,
        playlistItemRef: { kind: 'reading', noteId: meta.id },
        isActive: activeReadingNoteId === meta.id,
        isPlaying: activeReadingNoteId === meta.id && playback.playing && playback.mediaType === 'reading',
      })),
    [activeReadingNoteId, noteMetas, playback.mediaType, playback.playing]
  );
  const allAudioListItems = useMemo<AudioTrackListItem[]>(
    () =>
      allAudioAssets.map((asset) => ({
        id: `asset:${asset.id}`,
        title: asset.name,
        subtitle: formatTrackSubtitle(
          resolvedAudioAssetDurations.get(asset.url),
          asset.createdAt
        ),
        previewImageUrl: asset.thumbnail,
        isActive: activeAssetId === asset.id,
        isPlaying: activeAssetId === asset.id && playback.playing && playback.mediaType === 'audio',
        isFavorite: favoriteAssetIds.has(asset.id),
        canFavorite: true,
        assetId: asset.id,
        playlistItemRef: { kind: 'asset', assetId: asset.id },
      })),
    [activeAssetId, allAudioAssets, favoriteAssetIds, playback.mediaType, playback.playing, resolvedAudioAssetDurations]
  );
  const playlistListItems = useMemo<AudioTrackListItem[]>(
    () =>
      selectedPlaylistItems.reduce<AudioTrackListItem[]>((items, itemRef) => {
        if (isAudioPlaylistAssetItemRef(itemRef)) {
          const asset = assetById.get(itemRef.assetId);
          if (!asset) {
            return items;
          }
          if (
            normalizedQuery.length > 0
            && !asset.name.toLowerCase().includes(normalizedQuery)
          ) {
            return items;
          }
          items.push({
            id: `asset:${asset.id}`,
            title: asset.name,
            subtitle: formatTrackSubtitle(
              resolvedAudioAssetDurations.get(asset.url),
              asset.createdAt
            ),
            previewImageUrl: asset.thumbnail,
            isActive: activeAssetId === asset.id,
            isPlaying: activeAssetId === asset.id && playback.playing && playback.mediaType === 'audio',
            isFavorite: favoriteAssetIds.has(asset.id),
            canFavorite: true,
            assetId: asset.id,
            playlistItemRef: itemRef,
          });
          return items;
        }

        const noteMeta = noteMetaById.get(itemRef.noteId);
        if (!noteMeta) {
          return items;
        }
        if (
          normalizedQuery.length > 0
          && !(noteMeta.title || '').toLowerCase().includes(normalizedQuery)
        ) {
          return items;
        }
        items.push({
          id: `reading:${noteMeta.id}`,
          title: noteMeta.title || '未命名笔记',
          subtitle: new Date(noteMeta.updatedAt).toLocaleDateString('zh-CN'),
          previewImageUrl: undefined,
          isFavorite: false,
          canFavorite: false,
          noteId: noteMeta.id,
          playlistItemRef: itemRef,
          isActive: activeReadingNoteId === noteMeta.id,
          isPlaying: activeReadingNoteId === noteMeta.id && playback.playing && playback.mediaType === 'reading',
        });
        return items;
      }, []),
    [
      activeAssetId,
      activeReadingNoteId,
      assetById,
      favoriteAssetIds,
      normalizedQuery,
      noteMetaById,
      playback.mediaType,
      playback.playing,
      resolvedAudioAssetDurations,
      selectedPlaylistItems,
    ]
  );
  const currentListItems = useMemo(() => {
    if (selectedPlaylistId === AUDIO_PLAYLIST_ALL_TRACKS_ID) {
      return allTracksListItems;
    }
    if (selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID) {
      return allAudioListItems;
    }
    return playlistListItems;
  }, [allAudioListItems, allTracksListItems, playlistListItems, selectedPlaylistId]);
  const fallbackTrackItem = currentListItems[0] || null;
  const fallbackAsset = fallbackTrackItem?.assetId ? assetById.get(fallbackTrackItem.assetId) || null : null;
  const displayAsset = isReadingMode ? null : (activeAsset || fallbackAsset);
  const resolvedPreviewImageUrl = isReadingMode
    ? (isReadingPlaybackSource(activeReadingItem) ? activeReadingItem.previewImageUrl : playback.activePreviewImageUrl)
    : (playback.activePreviewImageUrl || displayAsset?.thumbnail);
  const currentQueueTitle = playback.queueSource === 'playlist'
    ? (playback.activePlaylistName || '播放列表')
    : playback.activePlaylistName || (isReadingMode ? '朗读队列' : '当前播放队列');
  const listHeaderTitle = shouldShowPlaybackQueue
    ? currentQueueTitle
    : isAllTracksTab ? '全部语音' : (activePlaylist?.name || '素材库音频');
  const activeAssetCountLabel = shouldShowPlaybackQueue
    ? `${playback.queue.length} 项内容`
    : isAllTracksTab
      ? `${currentListItems.length} 篇笔记`
      : selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID
        ? `${currentListItems.length} 首音频`
        : `${currentListItems.length} 项内容`;
  const playbackModeLabel = PLAYBACK_MODE_LABELS[playback.playbackMode];
  const playbackModeIcon = PLAYBACK_MODE_ICONS[playback.playbackMode];

  const buildPlaylistQueue = async (items: AudioPlaylistItemRef[]): Promise<PlaybackQueueItem[]> => {
    const queueItems = await Promise.all(
      items.map(async (itemRef) => {
        if (isAudioPlaylistAssetItemRef(itemRef)) {
          return buildAudioPlaybackSource(itemRef.assetId);
        }
        return loadReadingSource(itemRef.noteId);
      })
    );

    return queueItems.filter(isNonNull);
  };

  const handlePlayListItem = async (item: AudioTrackListItem) => {
    const itemRef = item.playlistItemRef;
    if (!itemRef) {
      return;
    }

    if (isAudioPlaylistAssetItemRef(itemRef)) {
      const source = buildAudioPlaybackSource(itemRef.assetId);
      if (!source) {
        return;
      }

      if (selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID) {
        playback.setQueue(
          allAudioAssets.flatMap((asset) => {
            const playbackSource = buildAudioPlaybackSource(asset.id);
            return playbackSource ? [playbackSource] : [];
          })
        );
      } else {
        const playlistQueue = await buildPlaylistQueue(selectedPlaylistItems);
        playback.setQueue(playlistQueue, {
          queueSource: 'playlist',
          playlistId: activePlaylist?.id,
          playlistName: activePlaylist?.name,
        });
      }

      await playback.togglePlayback(source);
      return;
    }

    let source = await loadReadingSource(itemRef.noteId);
    if (!source) {
      return;
    }

    if (selectedPlaylistId === AUDIO_PLAYLIST_ALL_TRACKS_ID) {
      const readingQueue = await buildReadingQueue(itemRef.noteId);
      playback.setReadingQueue(readingQueue);
      source = readingQueue.find((queueItem) => queueItem.origin.kind === 'kb-note' && queueItem.origin.id === itemRef.noteId) || source;
    } else {
      const playlistQueue = await buildPlaylistQueue(selectedPlaylistItems);
      playback.setQueue(playlistQueue, {
        queueSource: 'playlist',
        playlistId: activePlaylist?.id,
        playlistName: activePlaylist?.name,
      });
      const matchedSource = playlistQueue.find(
        (queueItem): queueItem is NonNullable<typeof source> =>
          isReadingPlaybackSource(queueItem)
          && queueItem.origin.kind === 'kb-note'
          && queueItem.origin.id === itemRef.noteId
      );
      source = matchedSource || source;
    }

    playback.toggleReadingPlayback(source);
  };

  const closePlaylistDialog = () => {
    setCreateDialogVisible(false);
    setPlaylistName('');
    setPendingPlaylistItem(null);
    setEditingPlaylistId(null);
    setPlaylistDialogMode('create');
  };

  const openCreatePlaylistDialog = (item?: AudioPlaylistItemRef) => {
    setPendingPlaylistItem(item || null);
    setPlaylistName('');
    setPlaylistDialogMode('create');
    setEditingPlaylistId(null);
    setCreateDialogVisible(true);
    setContextMenu(null);
  };

  const openRenamePlaylistDialog = (playlistId: string, name: string) => {
    setPendingPlaylistItem(null);
    setPlaylistDialogMode('rename');
    setEditingPlaylistId(playlistId);
    setPlaylistName(name);
    setCreateDialogVisible(true);
  };

  const subtitleSegments = isReadingMode ? playback.readingSegments : [];
  const activeSubtitleIndex = isReadingMode ? playback.activeReadingSegmentIndex : -1;
  const hasSubtitlePanel = isReadingMode && subtitleSegments.length > 0;

  const isAudioTabSelected = selectedPlaylistId !== AUDIO_PLAYLIST_ALL_TRACKS_ID;

  useEffect(() => {
    const state = toolWindowService.getToolState(MUSIC_PLAYER_TOOL_ID);
    if (!state || state.status !== 'open') {
      return;
    }

    const targetSize = hasSubtitlePanel ? SUBTITLE_PLAYER_WINDOW_SIZE : DEFAULT_PLAYER_WINDOW_SIZE;
    const currentWidth = state.size?.width ?? DEFAULT_PLAYER_WINDOW_SIZE.width;
    const currentHeight = state.size?.height ?? DEFAULT_PLAYER_WINDOW_SIZE.height;

    if (currentWidth === targetSize.width && currentHeight === targetSize.height) {
      return;
    }

    if (hasSubtitlePanel) {
      toolWindowService.updateToolSize(MUSIC_PLAYER_TOOL_ID, targetSize);
      return;
    }

    if (currentWidth <= SUBTITLE_PLAYER_WINDOW_SIZE.width) {
      toolWindowService.updateToolSize(MUSIC_PLAYER_TOOL_ID, targetSize);
    }
  }, [hasSubtitlePanel]);

  return (
    <div className={`music-player-tool ${hasSubtitlePanel ? 'music-player-tool--with-subtitle' : ''}`}>
      <div className="music-player-tool__layout">
        <div className="music-player-tool__main-column">
          <div className="music-player-tool__now-playing">
            <div className="music-player-tool__now-playing-cover">
              <AudioCover
                src={resolvedPreviewImageUrl}
                alt={isReadingMode ? '当前朗读' : displayAsset?.name || fallbackTrackItem?.title || '当前音频'}
                fallbackClassName="music-player-tool__now-playing-cover music-player-tool__now-playing-cover--fallback"
                iconSize={22}
              />
            </div>
            <div className="music-player-tool__now-playing-meta">
              <div className="music-player-tool__eyebrow">当前播放</div>
              <div className="music-player-tool__title">
                {isReadingMode
                  ? (playback.activeTitle || (isReadingPlaybackSource(activeReadingItem) ? activeReadingItem.title : '未选择朗读'))
                  : (playback.activeTitle || displayAsset?.name || fallbackTrackItem?.title || '未选择音频')}
              </div>
              <div className="music-player-tool__subtitle">
                {playback.activePlaylistName || (
                  playback.queueSource === 'playlist'
                    ? '播放列表'
                    : isReadingMode
                      ? '朗读轨道'
                      : '画布音频'
                )}
                {' · '}
                {formatDuration(playback.currentTime)} / {formatDuration(playback.duration)}
              </div>
            </div>
            <div className="music-player-tool__now-playing-actions">
              <button
                type="button"
                className="music-player-tool__action-btn"
                onClick={() => void playback.playPrevious()}
                disabled={playback.activeQueueIndex <= 0}
                aria-label="上一首"
                data-tooltip="上一首"
              >
                <SkipBack size={16} />
              </button>
              <button
                type="button"
                className="music-player-tool__action-btn music-player-tool__action-btn--primary"
                onClick={() => {
                  if (playback.playing) {
                    playback.pausePlayback();
                  } else if (isReadingMode) {
                    void playback.resumePlayback();
                  } else if (playback.activeAudioUrl) {
                    void playback.resumePlayback();
                  } else if (fallbackTrackItem) {
                    void handlePlayListItem(fallbackTrackItem);
                  } else {
                    return;
                  }
                }}
                disabled={
                  isReadingMode
                    ? !playback.activeReadingSourceId
                    : !playback.activeAudioUrl && !fallbackTrackItem
                }
                aria-label={playback.playing ? '暂停' : '播放'}
                data-tooltip={playback.playing ? '暂停' : '播放'}
              >
                {playback.playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                type="button"
                className="music-player-tool__action-btn"
                onClick={() => void playback.playNext()}
                disabled={
                  playback.activeQueueIndex < 0 ||
                  playback.activeQueueIndex >= playback.queue.length - 1
                }
                aria-label="下一首"
                data-tooltip="下一首"
              >
                <SkipForward size={16} />
              </button>
              <Dropdown
                options={playbackRateOptions}
                trigger="click"
                placement="bottom-right"
                minColumnWidth={112}
                onClick={(data) => playback.setPlaybackRate(Number(data.value))}
              >
                <button
                  type="button"
                  className="music-player-tool__action-btn"
                  aria-label={`切换播放速度，当前${playbackRateLabel}`}
                  data-tooltip={playbackRateTooltip}
                >
                  <Gauge size={16} />
                </button>
              </Dropdown>
              <Dropdown
                options={PLAYBACK_MODE_OPTIONS}
                trigger="click"
                placement="bottom-right"
                minColumnWidth={132}
                onClick={(data) => playback.setPlaybackMode(data.value as PlaybackMode)}
              >
                <button
                  type="button"
                  className="music-player-tool__action-btn"
                  aria-label={`切换播放模式，当前${playbackModeLabel}`}
                  data-tooltip={playbackModeLabel}
                >
                  {playbackModeIcon}
                </button>
              </Dropdown>
              <button
                type="button"
                className="music-player-tool__action-btn music-player-tool__action-btn--ghost"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  // 延后一帧最小化，避免底层 popup-toolbar 接到同一次点击造成误暂停。
                  requestAnimationFrame(() => {
                    toolWindowService.minimizeTool(MUSIC_PLAYER_TOOL_ID);
                  });
                }}
                aria-label="切回播放控件"
                data-tooltip="切回播放控件"
              >
                <Minimize2 size={16} />
              </button>
            </div>
          </div>

          <AudioPlaylistTabs
            className="music-player-tool__playlists"
            selectedPlaylistId={selectedPlaylistId}
            allCount={assets.filter((asset) => asset.type === AssetType.AUDIO).length}
            allTracksCount={noteMetas.length}
            tempTabs={tempTabs}
            playlists={playlists}
            playlistItems={playlistItems}
            onSelect={setSelectedPlaylistId}
            onCreate={() => openCreatePlaylistDialog()}
            onRename={(playlist) => openRenamePlaylistDialog(playlist.id, playlist.name)}
            onDelete={(playlist) => void deletePlaylist(playlist.id)}
          />

          {isAudioTabSelected && !shouldShowPlaybackQueue ? (
            <div className="music-player-tool__search">
              <Input
                value={query}
                onChange={(value) => setQuery(String(value))}
                prefixIcon={<Search size={14} />}
                placeholder={selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID ? '搜索素材库音频' : '搜索当前播放列表'}
                clearable
              />
            </div>
          ) : null}

          <div className="music-player-tool__list-header">
            <span>{listHeaderTitle}</span>
            <span>{activeAssetCountLabel}</span>
          </div>

          <div className="music-player-tool__list">
            <MusicPlayerQueueList
              showPlaybackQueue={shouldShowPlaybackQueue}
              queueListItems={queueListItems}
              listItems={currentListItems}
              emptyLabel={
                selectedPlaylistId === AUDIO_PLAYLIST_ALL_TRACKS_ID
                  ? '知识库还没有笔记'
                  : selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID
                    ? '当前列表里还没有音频'
                    : '当前播放列表里还没有内容'
              }
              onPlayQueueItem={(itemId) => void handlePlayQueueItem(itemId)}
              onPlayListItem={(item) => void handlePlayListItem(item)}
              onContextMenu={(item, x, y) =>
                setContextMenu({ x, y, item })
              }
              onToggleFavorite={(assetId) => void toggleFavorite(assetId)}
              onOpenKnowledgeBase={openKnowledgeBaseNote}
            />
          </div>
        </div>

        {hasSubtitlePanel ? (
          <aside className="music-player-tool__subtitle-column">
            <div className="music-player-tool__subtitle-header">
              <span>字幕</span>
              <span>{subtitleSegments.length} 段</span>
            </div>
            <div className="music-player-tool__subtitle-panel">
              {subtitleSegments.map((segment, index) => {
                const isActive = index === activeSubtitleIndex;

                return (
                  <button
                    key={segment.id}
                    type="button"
                    className={`music-player-tool__subtitle-line ${isActive ? 'music-player-tool__subtitle-line--active' : ''}`}
                    onClick={() => playback.seekToReadingSegment(index)}
                  >
                    {segment.text}
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}
      </div>

      <Dialog
        visible={createDialogVisible}
        header={playlistDialogMode === 'rename' ? '重命名播放列表' : '新建播放列表'}
        onClose={closePlaylistDialog}
        onConfirm={async () => {
          if (playlistDialogMode === 'rename' && editingPlaylistId) {
            await renamePlaylist(editingPlaylistId, playlistName);
          } else {
            const playlist = await createPlaylist(playlistName);
            if (pendingPlaylistItem) {
              await addItemToPlaylist(pendingPlaylistItem, playlist.id);
            }
            setSelectedPlaylistId(playlist.id);
          }
          closePlaylistDialog();
        }}
        onCancel={closePlaylistDialog}
        confirmBtn="确定"
        cancelBtn="取消"
      >
        <Input
          value={playlistName}
          onChange={(value) => setPlaylistName(String(value))}
          placeholder="请输入播放列表名称"
          autofocus
        />
      </Dialog>

      <AudioTrackContextMenu
        contextMenu={contextMenu}
        playlists={playlists}
        playlistItems={playlistItems}
        favoriteAssetIds={favoriteAssetIds}
        selectedPlaylistId={selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID ? null : selectedPlaylistId}
        currentPlaylistItemKeys={currentPlaylistItemKeys}
        onClose={() => setContextMenu(null)}
        onToggleFavorite={(assetId) => void toggleFavorite(assetId)}
        onAddToPlaylist={(item, playlistId) => void addItemToPlaylist(item, playlistId)}
        onRemoveFromPlaylist={(item, playlistId) => void removeItemFromPlaylist(item, playlistId)}
        onCreatePlaylistAndAdd={(item) => openCreatePlaylistDialog(item)}
      />
    </div>
  );
};
