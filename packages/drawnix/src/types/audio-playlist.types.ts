export const AUDIO_PLAYLIST_FAVORITES_ID = 'favorites';
export const AUDIO_PLAYLIST_ALL_ID = 'all-audio';
export const AUDIO_PLAYLIST_ALL_TRACKS_ID = 'all-tracks';
export const AUDIO_PLAYLIST_CANVAS_AUDIO_ID = 'canvas-audio';
export const AUDIO_PLAYLIST_CANVAS_READING_ID = 'canvas-reading';
export const AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL = '画布音频';
export const AUDIO_PLAYLIST_CANVAS_READING_LABEL = '画布语音';

export type AudioPlaylistItemKind = 'asset' | 'reading';

export interface AudioPlaylistAssetItemRef {
  kind: 'asset';
  assetId: string;
}

export interface AudioPlaylistReadingItemRef {
  kind: 'reading';
  noteId: string;
}

export type AudioPlaylistItemRef =
  | AudioPlaylistAssetItemRef
  | AudioPlaylistReadingItemRef;

export interface AudioPlaylist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  isSystem?: boolean;
}

export interface AudioPlaylistItem {
  playlistId: string;
  sourceType?: AudioPlaylistItemKind;
  assetId?: string;
  noteId?: string;
  addedAt: number;
}

export function isAudioPlaylistAssetItemRef(
  item: AudioPlaylistItemRef | null | undefined
): item is AudioPlaylistAssetItemRef {
  return item?.kind === 'asset';
}

export function isAudioPlaylistReadingItemRef(
  item: AudioPlaylistItemRef | null | undefined
): item is AudioPlaylistReadingItemRef {
  return item?.kind === 'reading';
}

export function getAudioPlaylistItemRef(
  item: AudioPlaylistItem
): AudioPlaylistItemRef | null {
  if (
    item.sourceType === 'reading'
    || (typeof item.noteId === 'string' && item.noteId.length > 0 && !item.assetId)
  ) {
    return item.noteId ? { kind: 'reading', noteId: item.noteId } : null;
  }

  return item.assetId ? { kind: 'asset', assetId: item.assetId } : null;
}

export function createAudioPlaylistItem(
  playlistId: string,
  item: AudioPlaylistItemRef,
  addedAt = Date.now()
): AudioPlaylistItem {
  return item.kind === 'asset'
    ? {
        playlistId,
        sourceType: 'asset',
        assetId: item.assetId,
        addedAt,
      }
    : {
        playlistId,
        sourceType: 'reading',
        noteId: item.noteId,
        addedAt,
      };
}

export function getAudioPlaylistItemRefKey(item: AudioPlaylistItemRef): string {
  return item.kind === 'asset' ? `asset:${item.assetId}` : `reading:${item.noteId}`;
}

export function isSameAudioPlaylistItemRef(
  left: AudioPlaylistItemRef,
  right: AudioPlaylistItemRef
): boolean {
  return getAudioPlaylistItemRefKey(left) === getAudioPlaylistItemRefKey(right);
}

export interface AudioPlaylistContextValue {
  loading: boolean;
  playlists: AudioPlaylist[];
  playlistItems: Record<string, AudioPlaylistItem[]>;
  favoriteAssetIds: Set<string>;
  loadPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<AudioPlaylist>;
  renamePlaylist: (playlistId: string, name: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addItemToPlaylist: (item: AudioPlaylistItemRef, playlistId: string) => Promise<void>;
  removeItemFromPlaylist: (item: AudioPlaylistItemRef, playlistId: string) => Promise<void>;
  addAssetToPlaylist: (assetId: string, playlistId: string) => Promise<void>;
  removeAssetFromPlaylist: (assetId: string, playlistId: string) => Promise<void>;
  removeAssetFromAllPlaylists: (assetId: string) => Promise<void>;
  toggleFavorite: (assetId: string) => Promise<boolean>;
  isFavorite: (assetId: string) => boolean;
  getPlaylistAssetIds: (playlistId: string) => string[];
  getPlaylistItemRefs: (playlistId: string) => AudioPlaylistItemRef[];
}
