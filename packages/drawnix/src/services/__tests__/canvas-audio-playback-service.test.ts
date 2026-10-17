/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../media-executor/fallback-utils', () => ({
  cacheRemoteUrl: vi.fn(async (url: string) => url),
}));

import { cacheRemoteUrl } from '../media-executor/fallback-utils';
import {
  CanvasAudioPlaybackService,
  DEFAULT_PLAYBACK_MODE,
  EMPTY_AUDIO_SPECTRUM,
  EMPTY_AUDIO_WAVEFORM,
} from '../canvas-audio-playback-service';
import { ttsSettings } from '../../utils/settings-manager';
import {
  buildReadingSubtitleSegments,
  createReadingPlaybackSource,
} from '../reading-playback-source';

beforeEach(async () => {
  vi.mocked(cacheRemoteUrl)
    .mockReset()
    .mockImplementation(async (url) => url);
  globalThis.localStorage?.clear?.();
  await ttsSettings.update({
    selectedVoice: '',
    rate: 1,
    pitch: 1,
    volume: 1,
    voicesByLanguage: {},
  });
});

class MockAudioElement extends EventTarget {
  src = '';
  crossOrigin = '';
  currentTime = 0;
  duration = 0;
  preload = '';
  volume = 1;
  playbackRate = 1;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  playError?: Error;

  play = vi.fn(async (): Promise<void> => {
    this.playCalls += 1;
    if (this.playError) {
      throw this.playError;
    }
    this.dispatchEvent(new Event('play'));
  });

  pause(): void {
    this.pauseCalls += 1;
    this.dispatchEvent(new Event('pause'));
  }

  load(): void {
    this.loadCalls += 1;
    this.dispatchEvent(new Event('loadedmetadata'));
  }

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
    }
    if (name.toLowerCase() === 'crossorigin') {
      this.crossOrigin = '';
    }
  }
}

class MockMediaElementSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
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

  createMediaElementSource = vi.fn(
    () => this.mediaSource as unknown as MediaElementAudioSourceNode
  );
  createAnalyser = vi.fn(() => this.analyser as unknown as AnalyserNode);
  resume = vi.fn(async () => {
    this.state = 'running';
  });
}

class MockSpeechSynthesis {
  utterances: Array<SpeechSynthesisUtterance> = [];
  paused = false;

  speak(utterance: SpeechSynthesisUtterance): void {
    this.utterances.push(utterance);
  }

  cancel(): void {
    this.utterances = [];
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  getVoices(): SpeechSynthesisVoice[] {
    return [];
  }
}

describe('CanvasAudioPlaybackService', () => {
  it('uses sequential as the default playback mode and persists mode changes', () => {
    const service = new CanvasAudioPlaybackService();

    expect(service.getState().playbackMode).toBe(DEFAULT_PLAYBACK_MODE);

    service.setPlaybackMode('list-loop');
    expect(service.getState().playbackMode).toBe('list-loop');

    const restoredService = new CanvasAudioPlaybackService();
    expect(restoredService.getState().playbackMode).toBe('list-loop');
  });

  it('starts playback and stores active metadata for a source', async () => {
    const audio = new MockAudioElement();
    audio.duration = 215;
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

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
    expect(audio.crossOrigin).toBe('');
  });

  it('falls back to the original remote URL when cached playback is rejected', async () => {
    const cachedUrl = '/__aitu_generated__/audio/cached-track.mp3';
    const remoteUrl = 'https://example.com/remote-track.mp3';
    vi.mocked(cacheRemoteUrl).mockResolvedValue(cachedUrl);

    const audio = new MockAudioElement();
    audio.play
      .mockRejectedValueOnce(new Error('cached media unavailable'))
      .mockImplementationOnce(async () => {
        audio.dispatchEvent(new Event('play'));
      });
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

    await service.togglePlayback({
      elementId: 'audio-node-fallback',
      audioUrl: remoteUrl,
      title: 'Fallback Track',
    });

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe(remoteUrl);
    expect(audio.crossOrigin).toBe('');
    expect(service.getState()).toMatchObject({
      playing: true,
      activeAudioUrl: remoteUrl,
      error: undefined,
    });
  });

  it('replaces an analysed audio element before falling back to a remote URL', async () => {
    const cachedUrl = '/__aitu_generated__/audio/cached-track.mp3';
    const remoteUrl = 'https://example.com/remote-track.mp3';
    vi.mocked(cacheRemoteUrl).mockResolvedValue(cachedUrl);

    const cachedAudio = new MockAudioElement();
    const remoteAudio = new MockAudioElement();
    const audioContext = new MockAudioContext();
    const audioFactory = vi
      .fn<() => HTMLAudioElement>()
      .mockReturnValueOnce(cachedAudio as unknown as HTMLAudioElement)
      .mockReturnValueOnce(remoteAudio as unknown as HTMLAudioElement);
    const service = new CanvasAudioPlaybackService(audioFactory, {
      audioContextFactory: () => audioContext as unknown as AudioContext,
    });

    await service.togglePlayback({
      elementId: 'audio-node-analysed',
      audioUrl: remoteUrl,
    });
    await Promise.resolve();
    expect(audioContext.createMediaElementSource).toHaveBeenCalledWith(
      cachedAudio
    );

    cachedAudio.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(remoteAudio.play).toHaveBeenCalledOnce());

    expect(audioFactory).toHaveBeenCalledTimes(2);
    expect(audioContext.mediaSource.disconnect).toHaveBeenCalledOnce();
    expect(remoteAudio.src).toBe(remoteUrl);
    expect(service.getState()).toMatchObject({
      playing: true,
      analysisAvailable: false,
      error: undefined,
    });
  });

  it('plays a direct remote URL without creating a Web Audio analysis graph', async () => {
    const audio = new MockAudioElement();
    const audioContext = new MockAudioContext();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        audioContextFactory: () => audioContext as unknown as AudioContext,
      }
    );

    await service.togglePlayback({
      elementId: 'audio-node-direct',
      audioUrl: 'https://example.com/direct-track.mp3',
    });
    await Promise.resolve();

    expect(audio.play).toHaveBeenCalledOnce();
    expect(audioContext.createMediaElementSource).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      playing: true,
      analysisAvailable: false,
    });
  });

  it('reports a final remote playback failure without retrying again', async () => {
    vi.mocked(cacheRemoteUrl).mockResolvedValue(
      '/__aitu_generated__/audio/cached-track.mp3'
    );
    const audio = new MockAudioElement();
    audio.play
      .mockRejectedValueOnce(new Error('cached media unavailable'))
      .mockRejectedValueOnce(new Error('remote media unavailable'));
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

    await expect(
      service.togglePlayback({
        elementId: 'audio-node-final-error',
        audioUrl: 'https://example.com/remote-track.mp3',
      })
    ).rejects.toThrow('cached media unavailable');

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(service.getState()).toMatchObject({
      playing: false,
      error: 'remote media unavailable',
    });
  });

  it('pauses when toggling the same source twice', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
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

  it('keeps the latest track when an earlier remote cache request resolves late', async () => {
    const audio = new MockAudioElement();
    let resolveFirst: ((url: string) => void) | undefined;
    const firstResolution = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(cacheRemoteUrl).mockImplementation((url: string) =>
      url.includes('audio-1') ? firstResolution : Promise.resolve(url)
    );
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const first = {
      elementId: 'audio-node-race-1',
      audioUrl: 'https://example.com/audio-1.mp3',
      title: 'First',
    };
    const second = {
      elementId: 'audio-node-race-2',
      audioUrl: 'https://example.com/audio-2.mp3',
      title: 'Second',
    };

    const firstPlayback = service.togglePlayback(first);
    await Promise.resolve();
    await service.togglePlayback(second);
    resolveFirst?.(first.audioUrl);
    await firstPlayback;

    expect(service.getState()).toMatchObject({
      activeElementId: second.elementId,
      activeAudioUrl: second.audioUrl,
      activeTitle: second.title,
      playing: true,
    });
    expect(audio.src).toBe(second.audioUrl);
  });

  it('starts remote playback without waiting for background caching', async () => {
    const audio = new MockAudioElement();
    let resolveCache: ((url: string) => void) | undefined;
    vi.mocked(cacheRemoteUrl).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveCache = resolve;
        })
    );
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const source = {
      elementId: 'audio-node-streaming',
      audioUrl: 'https://example.com/streaming.mp3',
      title: 'Streaming',
    };

    await service.togglePlayback(source);

    expect(audio.src).toBe(source.audioUrl);
    expect(audio.playCalls).toBe(1);
    expect(service.getState()).toMatchObject({
      activeAudioUrl: source.audioUrl,
      playing: true,
      loading: false,
    });

    resolveCache?.(source.audioUrl);
  });

  it('resumes a paused track without reloading or recaching it', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const source = {
      elementId: 'audio-node-resume',
      audioUrl: 'https://example.com/resume.mp3',
      title: 'Resume',
    };

    await service.togglePlayback(source);
    service.pausePlayback();
    const loadCalls = audio.loadCalls;
    const cacheCalls = vi.mocked(cacheRemoteUrl).mock.calls.length;

    await service.togglePlayback(source);

    expect(audio.loadCalls).toBe(loadCalls);
    expect(vi.mocked(cacheRemoteUrl)).toHaveBeenCalledTimes(cacheCalls);
    expect(service.getState().playing).toBe(true);
  });

  it('publishes buffering state from native media events', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

    await service.togglePlayback({
      elementId: 'audio-node-buffering',
      audioUrl: '/fixtures/audio.wav',
      title: 'Buffering',
    });

    audio.dispatchEvent(new Event('waiting'));
    expect(service.getState().loading).toBe(true);

    audio.dispatchEvent(new Event('canplay'));
    expect(service.getState().loading).toBe(false);
  });

  it('surfaces playback failures and can retry the active track', async () => {
    const audio = new MockAudioElement();
    audio.playError = new Error('Network unavailable');
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const source = {
      elementId: 'audio-node-retry',
      audioUrl: 'https://example.com/retry.mp3',
      title: 'Retry Track',
    };

    await expect(service.togglePlayback(source)).rejects.toThrow(
      'Network unavailable'
    );
    expect(service.getState()).toMatchObject({
      playing: false,
      loading: false,
      error: 'Network unavailable',
    });

    audio.playError = undefined;
    await service.retryPlayback();

    expect(audio.playCalls).toBe(2);
    expect(service.getState()).toMatchObject({
      activeAudioUrl: source.audioUrl,
      playing: true,
      loading: false,
      error: undefined,
    });
  });

  it('invalidates a pending track when playback is stopped', async () => {
    const audio = new MockAudioElement();
    let resolvePending: ((url: string) => void) | undefined;
    const pendingResolution = new Promise<string>((resolve) => {
      resolvePending = resolve;
    });
    vi.mocked(cacheRemoteUrl).mockImplementation(() => pendingResolution);
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const pendingPlayback = service.togglePlayback({
      elementId: 'audio-node-stop-race',
      audioUrl: 'https://example.com/audio-stop-race.mp3',
      title: 'Pending',
    });

    await Promise.resolve();
    service.stopAndClear();
    resolvePending?.('https://example.com/audio-stop-race.mp3');
    await pendingPlayback;

    expect(service.getState()).toMatchObject({
      mediaType: null,
      playing: false,
      currentTime: 0,
      duration: 0,
    });
    expect(service.getState().activeAudioUrl).toBeUndefined();
    expect(audio.src).toBe('');
  });

  it('seeks and clears playback state', async () => {
    const audio = new MockAudioElement();
    audio.duration = 120;
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

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
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

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
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

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
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

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
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

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
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

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

    const restoredService = new CanvasAudioPlaybackService();
    expect(restoredService.getState().volume).toBe(0.35);
  });

  it('updates audio playback rate and persists it across service instances', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

    service.setPlaybackRate(1.5, 'audio');
    expect(service.getState()).toMatchObject({
      audioPlaybackRate: 1.5,
      effectivePlaybackRate: 1.5,
    });

    await service.togglePlayback({
      elementId: 'audio-node-speed',
      audioUrl: 'https://example.com/audio-speed.mp3',
      title: 'Speed Test',
    });

    expect(audio.playbackRate).toBe(1.5);

    const restoredService = new CanvasAudioPlaybackService();
    expect(restoredService.getState().audioPlaybackRate).toBe(1.5);
  });

  it('stops at queue end in sequential mode when playback ends', async () => {
    const audio = new MockAudioElement();
    audio.duration = 180;
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const queue = [
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
    ];

    service.setQueue(queue);
    await service.togglePlayback(queue[1]);

    audio.dispatchEvent(new Event('ended'));
    await Promise.resolve();

    expect(service.getState()).toMatchObject({
      activeAudioUrl: queue[1].audioUrl,
      activeQueueIndex: 1,
      playing: false,
      currentTime: 180,
    });

    await service.resumePlayback();
    expect(service.getState()).toMatchObject({
      activeAudioUrl: queue[1].audioUrl,
      playing: true,
      currentTime: 0,
    });
  });

  it('loops back to the first track in list-loop mode when playback ends', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const queue = [
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
    ];

    service.setPlaybackMode('list-loop');
    service.setQueue(queue);
    await service.togglePlayback(queue[1]);

    audio.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getState()).toMatchObject({
      activeAudioUrl: queue[0].audioUrl,
      activeQueueIndex: 0,
      playing: true,
    });
  });

  it('loops manual next navigation in list-loop mode', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const queue = [
      {
        elementId: 'loop-manual-1',
        audioUrl: 'https://example.com/loop-manual-1.mp3',
      },
      {
        elementId: 'loop-manual-2',
        audioUrl: 'https://example.com/loop-manual-2.mp3',
      },
    ];

    service.setPlaybackMode('list-loop');
    await service.togglePlaybackInQueue(queue[1], queue);
    await service.playNext();

    expect(service.getState()).toMatchObject({
      activeAudioUrl: queue[0].audioUrl,
      activeQueueIndex: 0,
      playing: true,
    });
  });

  it('restarts the same track in single-loop mode when playback ends', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const track = {
      elementId: 'audio-node-1',
      audioUrl: 'https://example.com/audio-1.mp3',
      title: 'Track One',
    };

    service.setPlaybackMode('single-loop');
    service.setQueue([track]);
    await service.togglePlayback(track);

    audio.currentTime = 42;
    audio.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    await Promise.resolve();

    expect(audio.currentTime).toBe(0);
    expect(service.getState()).toMatchObject({
      activeAudioUrl: track.audioUrl,
      activeQueueIndex: 0,
      playing: true,
      currentTime: 0,
    });
  });

  it('uses a different queue item for shuffle auto-advance when possible', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );
    const queue = [
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
    ];
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);

    service.setPlaybackMode('shuffle');
    service.setQueue(queue);
    await service.togglePlayback(queue[0]);

    audio.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getState().activeAudioUrl).toBe(queue[2].audioUrl);
    expect(service.getState().activeQueueIndex).toBe(2);
    randomSpy.mockRestore();
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
      audioUrl: '/__aitu_generated__/audio/audio-reactive.mp3',
      title: 'Reactive Track',
    });

    await Promise.resolve();

    audioContext.analyser.data.set([
      220, 200, 180, 120, 90, 70, 60, 55, 48, 42, 38, 33, 28, 24, 20, 18, 16,
      14, 12, 10, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1,
    ]);
    audioContext.analyser.timeDomainData.set(
      Uint8Array.from(
        { length: 256 },
        (_, index) =>
          128 + Math.round(Math.sin((index / 256) * Math.PI * 12) * 54)
      )
    );

    frameCallback?.(64);

    const state = service.getState();
    expect(state.analysisAvailable).toBe(true);
    expect(state.spectrumLevels.some((level) => level > 0.05)).toBe(true);
    expect(state.waveformLevels.some((level) => Math.abs(level) > 0.04)).toBe(
      true
    );
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
      audioUrl: '/__aitu_generated__/audio/audio-reactive-stop.mp3',
      title: 'Reactive Stop',
    });

    await Promise.resolve();

    audioContext.analyser.data.fill(160);
    frameCallback?.(64);

    service.stopAndClear();

    expect(service.getState().analysisAvailable).toBe(false);
    expect(service.getState().pulseLevel).toBe(0);
    expect(service.getState().spectrumLevels).toEqual([
      ...EMPTY_AUDIO_SPECTRUM,
    ]);
    expect(service.getState().waveformLevels).toEqual([
      ...EMPTY_AUDIO_WAVEFORM,
    ]);
  });

  it('plays reading sources and tracks subtitle progress', () => {
    const audio = new MockAudioElement();
    const speechSynthesis = new MockSpeechSynthesis();
    let currentNow = 0;
    let progressTick: (() => void) | null = null;
    const readingSource = createReadingPlaybackSource({
      elementId: 'kb-note:1',
      title: '测试笔记',
      content: '# 标题\n\n第一句。第二句。',
      origin: {
        kind: 'kb-note',
        id: '1',
      },
    });

    expect(readingSource).not.toBeNull();

    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        speechSynthesis: speechSynthesis as unknown as SpeechSynthesis,
        utteranceFactory: (text) => ({ text } as SpeechSynthesisUtterance),
        setInterval: ((callback: TimerHandler) => {
          progressTick = callback as () => void;
          return 1 as unknown as number;
        }) as typeof window.setInterval,
        clearInterval: vi.fn() as typeof window.clearInterval,
        now: () => currentNow,
      }
    );

    service.toggleReadingPlaybackInQueue(
      readingSource ? [readingSource][0] : (null as never),
      readingSource ? [readingSource] : []
    );

    expect(service.getState()).toMatchObject({
      mediaType: 'reading',
      activeReadingSourceId: readingSource?.readingSourceId,
      subtitleMode: 'estimated',
      activeQueueIndex: 0,
      playing: true,
    });

    currentNow = 900;
    progressTick?.();
    expect(service.getState().currentTime).toBeGreaterThan(0);

    service.pausePlayback();
    expect(service.getState().playing).toBe(false);
    expect(speechSynthesis.paused).toBe(true);

    void service.resumePlayback();
    expect(service.getState().playing).toBe(true);
    expect(speechSynthesis.paused).toBe(false);
  });

  it('keeps queue indexes aligned across audio and reading tracks', async () => {
    const audio = new MockAudioElement();
    const speechSynthesis = new MockSpeechSynthesis();
    const readingSource = createReadingPlaybackSource({
      elementId: 'kb-note:mixed',
      title: 'Mixed Reading',
      content: '音频与朗读可以在同一个队列里连续切换。',
      origin: { kind: 'kb-note', id: 'mixed' },
    });
    expect(readingSource).not.toBeNull();
    if (!readingSource) {
      return;
    }

    const firstAudio = {
      elementId: 'mixed-audio-1',
      audioUrl: 'https://example.com/mixed-1.mp3',
    };
    const lastAudio = {
      elementId: 'mixed-audio-2',
      audioUrl: 'https://example.com/mixed-2.mp3',
    };
    const queue = [firstAudio, readingSource, lastAudio];
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        speechSynthesis: speechSynthesis as unknown as SpeechSynthesis,
        utteranceFactory: (text) => ({ text } as SpeechSynthesisUtterance),
      }
    );

    await service.togglePlaybackInQueue(firstAudio, queue);
    await service.playNext();
    expect(service.getState()).toMatchObject({
      mediaType: 'reading',
      activeReadingSourceId: readingSource?.readingSourceId,
      activeQueueIndex: 1,
      playing: true,
    });

    await service.playNext();
    expect(service.getState()).toMatchObject({
      mediaType: 'audio',
      activeAudioUrl: lastAudio.audioUrl,
      activeQueueIndex: 2,
      playing: true,
    });
  });

  it('restarts reading from the same source in single-loop mode after the last segment', () => {
    const audio = new MockAudioElement();
    const speechSynthesis = new MockSpeechSynthesis();
    const readingSource = createReadingPlaybackSource({
      elementId: 'kb-note:2',
      title: '循环笔记',
      content: '第一句。第二句。',
      origin: {
        kind: 'kb-note',
        id: '2',
      },
    });

    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        speechSynthesis: speechSynthesis as unknown as SpeechSynthesis,
        utteranceFactory: (text) => ({ text } as SpeechSynthesisUtterance),
      }
    );

    service.setPlaybackMode('single-loop');
    service.toggleReadingPlaybackInQueue(
      readingSource ? [readingSource][0] : (null as never),
      readingSource ? [readingSource] : []
    );

    const firstUtterance = speechSynthesis.utterances[0];
    firstUtterance?.onend?.(new Event('end') as SpeechSynthesisEvent);
    const secondUtterance = speechSynthesis.utterances[1];
    secondUtterance?.onend?.(new Event('end') as SpeechSynthesisEvent);

    expect(speechSynthesis.utterances).toHaveLength(1);
    expect(speechSynthesis.utterances[0]?.text).toBe(firstUtterance?.text);
    expect(service.getState()).toMatchObject({
      activeReadingSourceId: readingSource?.readingSourceId,
      activeQueueIndex: 0,
      activeReadingSegmentIndex: 0,
      playing: true,
    });
  });

  it('syncs reading playback rate to tts settings when changed from playback controls', async () => {
    const audio = new MockAudioElement();
    const speechSynthesis = new MockSpeechSynthesis();
    const readingSource = createReadingPlaybackSource({
      elementId: 'kb-note:3',
      title: '语速同步',
      content: '第一句。第二句。',
      origin: {
        kind: 'kb-note',
        id: '3',
      },
    });

    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        speechSynthesis: speechSynthesis as unknown as SpeechSynthesis,
        utteranceFactory: (text) => ({ text } as SpeechSynthesisUtterance),
      }
    );

    service.toggleReadingPlaybackInQueue(
      readingSource ? [readingSource][0] : (null as never),
      readingSource ? [readingSource] : []
    );
    service.setPlaybackRate(1.5, 'reading');
    await Promise.resolve();

    expect(service.getState()).toMatchObject({
      readingPlaybackRate: 1.5,
      effectivePlaybackRate: 1.5,
      activeReadingSourceId: readingSource?.readingSourceId,
    });
    expect(speechSynthesis.utterances[0]?.rate).toBe(1.5);
    expect(ttsSettings.get()?.rate).toBe(1.5);
  });

  it('keeps estimated reading duration aligned with high speech rates', () => {
    const content =
      '这是一段足够长的中文内容，用于验证高速朗读时字幕时长不会被错误地限制。';
    const normalDuration =
      buildReadingSubtitleSegments(content, 1)[0]?.endMs || 0;
    const fastDuration =
      buildReadingSubtitleSegments(content, 10)[0]?.endMs || 0;

    expect(normalDuration).toBeGreaterThan(fastDuration);
    expect(fastDuration).toBeGreaterThanOrEqual(900);
  });

  it('reacts to external tts rate updates while reading is active', async () => {
    const audio = new MockAudioElement();
    const speechSynthesis = new MockSpeechSynthesis();
    const readingSource = createReadingPlaybackSource({
      elementId: 'kb-note:4',
      title: '设置联动',
      content: '第一句。第二句。',
      origin: {
        kind: 'kb-note',
        id: '4',
      },
    });

    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement,
      {
        speechSynthesis: speechSynthesis as unknown as SpeechSynthesis,
        utteranceFactory: (text) => ({ text } as SpeechSynthesisUtterance),
      }
    );

    service.toggleReadingPlaybackInQueue(
      readingSource ? [readingSource][0] : (null as never),
      readingSource ? [readingSource] : []
    );
    await ttsSettings.update({ rate: 2 });

    expect(service.getState()).toMatchObject({
      readingPlaybackRate: 2,
      effectivePlaybackRate: 2,
      activeReadingSourceId: readingSource?.readingSourceId,
    });
    expect(speechSynthesis.utterances[0]?.rate).toBe(2);
  });

  it('disposes media listeners and stops reacting to tts settings', async () => {
    const audio = new MockAudioElement();
    const service = new CanvasAudioPlaybackService(
      () => audio as unknown as HTMLAudioElement
    );

    await service.togglePlayback({
      elementId: 'audio-node-dispose',
      audioUrl: '/fixtures/dispose.wav',
      title: 'Dispose',
    });
    service.dispose();

    audio.dispatchEvent(new Event('play'));
    await ttsSettings.update({ rate: 2.5 });

    expect(service.getState()).toMatchObject({
      mediaType: null,
      playing: false,
      readingPlaybackRate: 1,
    });
  });
});
