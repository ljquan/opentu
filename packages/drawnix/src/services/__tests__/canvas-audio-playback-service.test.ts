import { describe, expect, it, vi } from 'vitest';
import {
  CanvasAudioPlaybackService,
  EMPTY_AUDIO_SPECTRUM,
  EMPTY_AUDIO_WAVEFORM,
} from '../canvas-audio-playback-service';

class MockAudioElement extends EventTarget {
  src = '';
  currentTime = 0;
  duration = 0;
  preload = '';
  volume = 1;

  async play(): Promise<void> {
    this.dispatchEvent(new Event('play'));
  }

  pause(): void {
    this.dispatchEvent(new Event('pause'));
  }

  load(): void {
    this.dispatchEvent(new Event('loadedmetadata'));
  }

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
    }
  }
}

class MockMediaElementSourceNode {
  connect = vi.fn();
}

class MockAnalyserNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
  readonly frequencyBinCount = 32;
  readonly data = new Uint8Array(this.frequencyBinCount);
  readonly timeDomainData = new Uint8Array(256).fill(128);
  connect = vi.fn();

  getByteFrequencyData(target: Uint8Array): void {
    target.set(this.data);
  }

  getByteTimeDomainData(target: Uint8Array): void {
    target.set(this.timeDomainData.subarray(0, target.length));
  }
}

class MockAudioContext {
  state: AudioContextState = 'running';
  readonly destination = {} as AudioDestinationNode;
  readonly mediaSource = new MockMediaElementSourceNode();
  readonly analyser = new MockAnalyserNode();

  createMediaElementSource = vi.fn(() => this.mediaSource as unknown as MediaElementAudioSourceNode);
  createAnalyser = vi.fn(() => this.analyser as unknown as AnalyserNode);
  resume = vi.fn(async () => {
    this.state = 'running';
  });
}

describe('CanvasAudioPlaybackService', () => {
  it('starts playback and stores active metadata for a source', async () => {
    const audio = new MockAudioElement();
    audio.duration = 215;
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);

    await service.togglePlayback({
      elementId: 'audio-node-1',
      audioUrl: 'https://example.com/audio-1.mp3',
      title: 'Test Track',
      duration: 215,
      clipId: 'clip-1',
    });

    expect(service.getState()).toMatchObject({
      activeElementId: 'audio-node-1',
      activeAudioUrl: 'https://example.com/audio-1.mp3',
      activeTitle: 'Test Track',
      activeClipId: 'clip-1',
      duration: 215,
      playing: true,
    });
  });

  it('pauses when toggling the same source twice', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);
    const source = {
      elementId: 'audio-node-2',
      audioUrl: 'https://example.com/audio-2.mp3',
      title: 'Loopback',
    };

    await service.togglePlayback(source);
    expect(service.getState().playing).toBe(true);

    await service.togglePlayback(source);
    expect(service.getState().playing).toBe(false);
    expect(service.getState().activeElementId).toBe('audio-node-2');
  });

  it('seeks and clears playback state', async () => {
    const audio = new MockAudioElement();
    audio.duration = 120;
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);

    await service.togglePlayback({
      elementId: 'audio-node-3',
      audioUrl: 'https://example.com/audio-3.mp3',
      title: 'Seek Test',
      duration: 120,
    });

    service.seekTo(42.5);
    expect(service.getState().currentTime).toBe(42.5);

    service.stopAndClear();
    expect(service.getState()).toMatchObject({
      playing: false,
      currentTime: 0,
      duration: 0,
    });
    expect(service.getState().activeAudioUrl).toBeUndefined();
  });

  it('keeps a canvas queue and can move between tracks', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);

    service.setQueue([
      {
        elementId: 'audio-node-1',
        audioUrl: 'https://example.com/audio-1.mp3',
        title: 'Track One',
      },
      {
        elementId: 'audio-node-2',
        audioUrl: 'https://example.com/audio-2.mp3',
        title: 'Track Two',
      },
      {
        elementId: 'audio-node-3',
        audioUrl: 'https://example.com/audio-3.mp3',
        title: 'Track Three',
      },
    ]);

    await service.togglePlayback({
      elementId: 'audio-node-2',
      audioUrl: 'https://example.com/audio-2.mp3',
      title: 'Track Two',
    });
    expect(service.getState().activeQueueIndex).toBe(1);

    await service.playNext();
    expect(service.getState()).toMatchObject({
      activeElementId: 'audio-node-3',
      activeAudioUrl: 'https://example.com/audio-3.mp3',
      activeQueueIndex: 2,
    });

    await service.playPrevious();
    expect(service.getState()).toMatchObject({
      activeElementId: 'audio-node-2',
      activeAudioUrl: 'https://example.com/audio-2.mp3',
      activeQueueIndex: 1,
      queueSource: 'canvas',
    });
  });

  it('tracks playlist queue metadata separately from canvas queue', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);

    service.setQueue(
      [
        {
          elementId: 'asset:1',
          audioUrl: 'https://example.com/audio-1.mp3',
          title: 'Track One',
        },
      ],
      {
        queueSource: 'playlist',
        playlistId: 'favorites',
        playlistName: '收藏',
      }
    );

    await service.togglePlayback({
      elementId: 'asset:1',
      audioUrl: 'https://example.com/audio-1.mp3',
      title: 'Track One',
    });

    expect(service.getState()).toMatchObject({
      queueSource: 'playlist',
      activePlaylistId: 'favorites',
      activePlaylistName: '收藏',
      activeQueueIndex: 0,
    });
  });

  it('switches to the provided canvas queue before playback starts', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);

    service.setQueue(
      [
        {
          elementId: 'playlist:1',
          audioUrl: 'https://example.com/playlist-1.mp3',
          title: 'Playlist Track',
        },
      ],
      {
        queueSource: 'playlist',
        playlistId: 'favorites',
        playlistName: '收藏',
      }
    );

    await service.togglePlaybackInQueue(
      {
        elementId: 'canvas:2',
        audioUrl: 'https://example.com/canvas-2.mp3',
        title: 'Canvas Track Two',
      },
      [
        {
          elementId: 'canvas:1',
          audioUrl: 'https://example.com/canvas-1.mp3',
          title: 'Canvas Track One',
        },
        {
          elementId: 'canvas:2',
          audioUrl: 'https://example.com/canvas-2.mp3',
          title: 'Canvas Track Two',
        },
      ],
      {
        queueSource: 'canvas',
      }
    );

    expect(service.getState()).toMatchObject({
      queueSource: 'canvas',
      activePlaylistId: undefined,
      activePlaylistName: undefined,
      activeElementId: 'canvas:2',
      activeAudioUrl: 'https://example.com/canvas-2.mp3',
      activeQueueIndex: 1,
    });
    expect(service.getState().queue).toHaveLength(2);
  });

  it('updates stored canvas queue without overriding playlist playback context', () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);

    service.setQueue(
      [
        {
          elementId: 'playlist:1',
          audioUrl: 'https://example.com/playlist-1.mp3',
          title: 'Playlist Track',
        },
      ],
      {
        queueSource: 'playlist',
        playlistId: 'favorites',
        playlistName: '收藏',
      }
    );

    service.setCanvasQueue([
      {
        elementId: 'canvas:1',
        audioUrl: 'https://example.com/canvas-1.mp3',
        title: 'Canvas Track One',
      },
      {
        elementId: 'canvas:2',
        audioUrl: 'https://example.com/canvas-2.mp3',
        title: 'Canvas Track Two',
      },
    ]);

    expect(service.getCanvasQueue()).toHaveLength(2);
    expect(service.getState()).toMatchObject({
      queueSource: 'playlist',
      activePlaylistId: 'favorites',
      activePlaylistName: '收藏',
    });
    expect(service.getState().queue).toHaveLength(1);
  });

  it('updates audio volume and keeps it after clearing playback', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(() => audio as unknown as HTMLAudioElement);

    service.setVolume(0.35);
    expect(service.getState().volume).toBe(0.35);

    await service.togglePlayback({
      elementId: 'audio-node-4',
      audioUrl: 'https://example.com/audio-4.mp3',
      title: 'Volume Test',
    });

    expect(audio.volume).toBe(0.35);

    service.stopAndClear();
    expect(service.getState().volume).toBe(0.35);
  });

  it('publishes live spectrum and pulse data when audio analysis is available', async () => {
    const audio = new MockAudioElement();
    const audioContext = new MockAudioContext();
    let frameCallback: FrameRequestCallback | null = null;

    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        audioContextFactory: () => audioContext as unknown as AudioContext,
        requestFrame: (callback) => {
          frameCallback = callback;
          return 1;
        },
        cancelFrame: vi.fn(),
      }
    );

    await service.togglePlayback({
      elementId: 'audio-node-reactive',
      audioUrl: 'https://example.com/audio-reactive.mp3',
      title: 'Reactive Track',
    });

    await Promise.resolve();

    audioContext.analyser.data.set([
      220, 200, 180, 120, 90, 70, 60, 55,
      48, 42, 38, 33, 28, 24, 20, 18,
      16, 14, 12, 10, 9, 8, 7, 6,
      5, 4, 4, 3, 3, 2, 2, 1,
    ]);
    audioContext.analyser.timeDomainData.set(
      Uint8Array.from({ length: 256 }, (_, index) =>
        128 + Math.round(Math.sin((index / 256) * Math.PI * 12) * 54)
      )
    );

    frameCallback?.(64);

    const state = service.getState();
    expect(state.analysisAvailable).toBe(true);
    expect(state.spectrumLevels.some((level) => level > 0.05)).toBe(true);
    expect(state.waveformLevels.some((level) => Math.abs(level) > 0.04)).toBe(true);
    expect(state.pulseLevel).toBeGreaterThan(0.05);
  });

  it('clears reactive analysis state when playback is stopped', async () => {
    const audio = new MockAudioElement();
    const audioContext = new MockAudioContext();
    let frameCallback: FrameRequestCallback | null = null;

    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        audioContextFactory: () => audioContext as unknown as AudioContext,
        requestFrame: (callback) => {
          frameCallback = callback;
          return 7;
        },
        cancelFrame: vi.fn(),
      }
    );

    await service.togglePlayback({
      elementId: 'audio-node-reactive-stop',
      audioUrl: 'https://example.com/audio-reactive-stop.mp3',
      title: 'Reactive Stop',
    });

    await Promise.resolve();

    audioContext.analyser.data.fill(160);
    frameCallback?.(64);

    service.stopAndClear();

    expect(service.getState().analysisAvailable).toBe(false);
    expect(service.getState().pulseLevel).toBe(0);
    expect(service.getState().spectrumLevels).toEqual([...EMPTY_AUDIO_SPECTRUM]);
    expect(service.getState().waveformLevels).toEqual([...EMPTY_AUDIO_WAVEFORM]);
  });
});
