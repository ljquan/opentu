/**
 * Audio Playlist Service (stub)
 *
 * 播放列表管理服务的最小实现。
 */

class AudioPlaylistService {
  async initialize(): Promise<void> {
    // no-op
  }

  async removeAssetFromAllPlaylists(_assetId: string): Promise<void> {
    // no-op
  }
}

export const audioPlaylistService = new AudioPlaylistService();
