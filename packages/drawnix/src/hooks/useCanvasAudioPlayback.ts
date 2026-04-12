import { useMemo, useSyncExternalStore } from 'react';
import {
  canvasAudioPlaybackService,
  type CanvasAudioPlaybackSource,
  type CanvasAudioQueueSource,
  type CanvasAudioPlaybackState,
  type PlaybackMode,
  type PlaybackRateMediaType,
} from '../services/canvas-audio-playback-service';
import type { ReadingPlaybackSource } from '../services/reading-playback-source';

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
    setReadingQueue: (queue: ReadingPlaybackSource[]) =>
      canvasAudioPlaybackService.setReadingQueue(queue),
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
        queueId?: string;
        queueName?: string;
      }
    ) =>
      canvasAudioPlaybackService.togglePlaybackInQueue(source, queue, options),
    togglePlayback: (source: CanvasAudioPlaybackSource) =>
      canvasAudioPlaybackService.togglePlayback(source),
    toggleReadingPlayback: (source: ReadingPlaybackSource) =>
      canvasAudioPlaybackService.toggleReadingPlayback(source),
    toggleReadingPlaybackInQueue: (
      source: ReadingPlaybackSource,
      queue: ReadingPlaybackSource[],
      options?: {
        queueId?: string;
        queueName?: string;
      }
    ) =>
      canvasAudioPlaybackService.toggleReadingPlaybackInQueue(source, queue, options),
    pausePlayback: () => canvasAudioPlaybackService.pausePlayback(),
    resumePlayback: () => canvasAudioPlaybackService.resumePlayback(),
    playPrevious: () => canvasAudioPlaybackService.playPrevious(),
    playNext: () => canvasAudioPlaybackService.playNext(),
    setPlaybackMode: (mode: PlaybackMode) => canvasAudioPlaybackService.setPlaybackMode(mode),
    setPlaybackRate: (rate: number, mediaType?: PlaybackRateMediaType) =>
      canvasAudioPlaybackService.setPlaybackRate(rate, mediaType),
    seekTo: (time: number) => canvasAudioPlaybackService.seekTo(time),
    seekToReadingSegment: (index: number) => canvasAudioPlaybackService.seekToReadingSegment(index),
    setVolume: (volume: number) => canvasAudioPlaybackService.setVolume(volume),
    stopPlayback: () => canvasAudioPlaybackService.stopAndClear(),
  }), []);
}

export function useCanvasAudioPlayback() {
  const state = useSyncExternalStore<CanvasAudioPlaybackState>(
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
