import { useMemo, useSyncExternalStore } from 'react';
import {
  canvasAudioPlaybackService,
  type CanvasAudioPlaybackSource,
  type CanvasAudioQueueSource,
  type CanvasAudioPlaybackState,
} from '../services/canvas-audio-playback-service';

export function useCanvasAudioPlaybackSelector<T>(
  selector: (state: CanvasAudioPlaybackState) => T
): T {
  return useSyncExternalStore(
    canvasAudioPlaybackService.subscribe.bind(canvasAudioPlaybackService),
    () => selector(canvasAudioPlaybackService.getState()),
    () => selector(canvasAudioPlaybackService.getState())
  );
}

export function useCanvasAudioPlaybackControls() {
  return useMemo(() => ({
    setQueue: (queue: CanvasAudioPlaybackSource[]) =>
      canvasAudioPlaybackService.setQueue(queue),
    setPlaylistQueue: (
      queue: CanvasAudioPlaybackSource[],
      playlist: { playlistId: string; playlistName: string }
    ) =>
      canvasAudioPlaybackService.setQueue(queue, {
        queueSource: 'playlist',
        playlistId: playlist.playlistId,
        playlistName: playlist.playlistName,
      }),
    togglePlaybackInQueue: (
      source: CanvasAudioPlaybackSource,
      queue: CanvasAudioPlaybackSource[],
      options?: {
        queueSource?: CanvasAudioQueueSource;
        playlistId?: string;
        playlistName?: string;
      }
    ) =>
      canvasAudioPlaybackService.togglePlaybackInQueue(source, queue, options),
    togglePlayback: (source: CanvasAudioPlaybackSource) =>
      canvasAudioPlaybackService.togglePlayback(source),
    pausePlayback: () => canvasAudioPlaybackService.pausePlayback(),
    resumePlayback: () => canvasAudioPlaybackService.resumePlayback(),
    playPrevious: () => canvasAudioPlaybackService.playPrevious(),
    playNext: () => canvasAudioPlaybackService.playNext(),
    seekTo: (time: number) => canvasAudioPlaybackService.seekTo(time),
    setVolume: (volume: number) => canvasAudioPlaybackService.setVolume(volume),
    stopPlayback: () => canvasAudioPlaybackService.stopAndClear(),
  }), []);
}

export function useCanvasAudioPlayback() {
  const state = useSyncExternalStore(
    canvasAudioPlaybackService.subscribe.bind(canvasAudioPlaybackService),
    canvasAudioPlaybackService.getState.bind(canvasAudioPlaybackService),
    canvasAudioPlaybackService.getState.bind(canvasAudioPlaybackService)
  );
  const controls = useCanvasAudioPlaybackControls();

  return {
    ...state,
    ...controls,
  };
}
