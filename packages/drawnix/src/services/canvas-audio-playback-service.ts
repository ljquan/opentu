export interface CanvasAudioPlaybackSource {
  elementId?: string;
  audioUrl: string;
  title?: string;
  duration?: number;
  previewImageUrl?: string;
  clipId?: string;
  providerTaskId?: string;
  clipIds?: string[];
}

export interface CanvasAudioPlaybackState {
  activeElementId?: string;
  activeAudioUrl?: string;
  activeTitle?: string;
  activeClipId?: string;
  activePreviewImageUrl?: string;
  activeProviderTaskId?: string;
  activeClipIds?: string[];
  queue: CanvasAudioPlaybackSource[];
  activeQueueIndex: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  analysisAvailable: boolean;
  spectrumLevels: number[];
  waveformLevels: number[];
  pulseLevel: number;
  error?: string;
}

type PlaybackListener = () => void;

const DEFAULT_VOLUME = 0.78;
const ANALYSIS_BAND_COUNT = 16;
const ANALYSIS_WAVEFORM_SAMPLE_COUNT = 48;
const ANALYSIS_FFT_SIZE = 256;
const ANALYSIS_MIN_FRAME_MS = 48;
const ANALYSIS_SMOOTHING = 0.68;
const WAVEFORM_SMOOTHING = 0.42;
const PULSE_SMOOTHING = 0.52;
export const EMPTY_AUDIO_SPECTRUM = Object.freeze(
  Array.from({ length: ANALYSIS_BAND_COUNT }, () => 0)
);
export const EMPTY_AUDIO_WAVEFORM = Object.freeze(
  Array.from({ length: ANALYSIS_WAVEFORM_SAMPLE_COUNT }, () => 0)
);

const INITIAL_STATE: CanvasAudioPlaybackState = {
  queue: [],
  activeQueueIndex: -1,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: DEFAULT_VOLUME,
  analysisAvailable: false,
  spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
  waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
  pulseLevel: 0,
};

interface CanvasAudioPlaybackRuntime {
  audioContextFactory?: () => AudioContext;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

function getPlaybackErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return '浏览器阻止了音频播放，请再次点击播放';
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return '音频播放失败，请稍后重试';
}

export class CanvasAudioPlaybackService {
  private audio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null;
  private mediaElementSource: MediaElementAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private analyserData: Uint8Array | null = null;
  private timeDomainData: Uint8Array | null = null;
  private analysisFrameHandle: number | null = null;
  private lastAnalysisFrameAt = 0;
  private readonly listeners = new Set<PlaybackListener>();
  private state: CanvasAudioPlaybackState = INITIAL_STATE;

  constructor(
    private readonly audioFactory: () => HTMLAudioElement = () => new Audio(),
    private readonly runtime: CanvasAudioPlaybackRuntime = {}
  ) {}

  getState(): CanvasAudioPlaybackState {
    return this.state;
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  private setState(next: CanvasAudioPlaybackState): void {
    this.state = next;
    this.notifyListeners();
  }

  private patchState(
    partial:
      | Partial<CanvasAudioPlaybackState>
      | ((current: CanvasAudioPlaybackState) => Partial<CanvasAudioPlaybackState>)
  ): void {
    const patch = typeof partial === 'function' ? partial(this.state) : partial;
    this.setState({
      ...this.state,
      ...patch,
    });
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = this.audioFactory();
      this.audio.preload = 'metadata';
      this.audio.volume = this.state.volume;
      this.audio.crossOrigin = 'anonymous';
      this.attachAudioListeners(this.audio);
    }

    return this.audio;
  }

  private getAudioContextFactory(): (() => AudioContext) | undefined {
    if (this.runtime.audioContextFactory) {
      return this.runtime.audioContextFactory;
    }

    if (typeof window === 'undefined') {
      return undefined;
    }

    const AudioContextCtor = window.AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return undefined;
    }

    return () => new AudioContextCtor();
  }

  private getRequestFrame(): ((callback: FrameRequestCallback) => number) | undefined {
    if (this.runtime.requestFrame) {
      return this.runtime.requestFrame;
    }

    if (typeof window === 'undefined') {
      return undefined;
    }

    return window.requestAnimationFrame.bind(window);
  }

  private getCancelFrame(): ((handle: number) => void) | undefined {
    if (this.runtime.cancelFrame) {
      return this.runtime.cancelFrame;
    }

    if (typeof window === 'undefined') {
      return undefined;
    }

    return window.cancelAnimationFrame.bind(window);
  }

  private getSourceKey(source: Pick<CanvasAudioPlaybackSource, 'elementId' | 'audioUrl'>): string {
    return `${source.elementId || ''}::${source.audioUrl}`;
  }

  private normalizeQueue(queue: CanvasAudioPlaybackSource[]): CanvasAudioPlaybackSource[] {
    const seen = new Set<string>();
    const normalized: CanvasAudioPlaybackSource[] = [];

    queue.forEach((source) => {
      if (!source?.audioUrl) {
        return;
      }

      const key = this.getSourceKey(source);
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      normalized.push({ ...source });
    });

    return normalized;
  }

  private findQueueIndex(
    queue: CanvasAudioPlaybackSource[],
    source: Pick<CanvasAudioPlaybackSource, 'elementId' | 'audioUrl'>
  ): number {
    const sourceKey = this.getSourceKey(source);
    return queue.findIndex((item) => this.getSourceKey(item) === sourceKey);
  }

  private attachAudioListeners(audio: HTMLAudioElement): void {
    audio.addEventListener('play', this.handlePlay);
    audio.addEventListener('pause', this.handlePause);
    audio.addEventListener('ended', this.handleEnded);
    audio.addEventListener('timeupdate', this.handleTimeUpdate);
    audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    audio.addEventListener('durationchange', this.handleDurationChange);
    audio.addEventListener('error', this.handleError);
  }

  private handlePlay = (): void => {
    this.patchState({
      playing: true,
      error: undefined,
    });
    void this.activateAnalysis();
  };

  private handlePause = (): void => {
    const audio = this.audio;
    this.stopAnalysisLoop();
    this.patchState({
      playing: false,
      currentTime: audio ? audio.currentTime : this.state.currentTime,
      pulseLevel: 0,
    });
  };

  private handleEnded = (): void => {
    const duration = this.audio && Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : this.state.duration;

    this.stopAnalysisLoop();
    this.patchState({
      playing: false,
      currentTime: duration,
      duration,
      pulseLevel: 0,
    });
  };

  private handleTimeUpdate = (): void => {
    if (!this.audio) {
      return;
    }

    this.patchState({
      currentTime: this.audio.currentTime,
      duration: Number.isFinite(this.audio.duration)
        ? this.audio.duration
        : this.state.duration,
    });
  };

  private handleLoadedMetadata = (): void => {
    if (!this.audio) {
      return;
    }

    this.patchState({
      duration: Number.isFinite(this.audio.duration)
        ? this.audio.duration
        : this.state.duration,
      error: undefined,
    });
  };

  private handleDurationChange = (): void => {
    if (!this.audio) {
      return;
    }

    this.patchState({
      duration: Number.isFinite(this.audio.duration)
        ? this.audio.duration
        : this.state.duration,
    });
  };

  private handleError = (): void => {
    this.stopAnalysisLoop();
    this.patchState({
      playing: false,
      analysisAvailable: false,
      spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
      waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
      pulseLevel: 0,
      error: '音频加载失败，请稍后重试',
    });
  };

  private async ensureAnalysisGraph(): Promise<boolean> {
    const createAudioContext = this.getAudioContextFactory();

    if (!createAudioContext) {
      return false;
    }

    try {
      const audio = this.ensureAudio();

      if (!this.audioContext) {
        this.audioContext = createAudioContext();
      }

      if (!this.mediaElementSource) {
        this.mediaElementSource = this.audioContext.createMediaElementSource(audio);
      }

      if (!this.analyserNode) {
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = ANALYSIS_FFT_SIZE;
        this.analyserNode.smoothingTimeConstant = 0.82;
        this.mediaElementSource.connect(this.analyserNode);
        this.analyserNode.connect(this.audioContext.destination);
      }

      if (!this.analyserData || this.analyserData.length !== this.analyserNode.frequencyBinCount) {
        this.analyserData = new Uint8Array(this.analyserNode.frequencyBinCount);
      }

      if (!this.timeDomainData || this.timeDomainData.length !== this.analyserNode.fftSize) {
        this.timeDomainData = new Uint8Array(this.analyserNode.fftSize);
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      return true;
    } catch {
      return false;
    }
  }

  private normalizeBandRanges(length: number): Array<[number, number]> {
    return Array.from({ length: ANALYSIS_BAND_COUNT }, (_, index) => {
      const start = Math.floor(((index / ANALYSIS_BAND_COUNT) ** 1.85) * length);
      const end = Math.floor((((index + 1) / ANALYSIS_BAND_COUNT) ** 1.85) * length);
      return [start, Math.max(start + 1, end)];
    });
  }

  private readSpectrumLevels():
    | { levels: number[]; waveformLevels: number[]; pulseLevel: number }
    | null {
    if (!this.analyserNode || !this.analyserData || !this.timeDomainData) {
      return null;
    }

    this.analyserNode.getByteFrequencyData(this.analyserData);
    this.analyserNode.getByteTimeDomainData(this.timeDomainData);
    const timeDomainData = this.timeDomainData;
    const ranges = this.normalizeBandRanges(this.analyserData.length);
    const levels = ranges.map(([start, end]) => {
      let total = 0;
      for (let index = start; index < end; index++) {
        total += this.analyserData?.[index] ?? 0;
      }
      const average = total / Math.max(1, end - start) / 255;
      return Math.max(0, Math.min(1, average ** 0.9));
    });

    const rawWaveformLevels = Array.from(
      { length: ANALYSIS_WAVEFORM_SAMPLE_COUNT },
      (_, index) => {
        const position = Math.round(
          (index / Math.max(1, ANALYSIS_WAVEFORM_SAMPLE_COUNT - 1))
            * (timeDomainData.length - 1)
        );
        const start = Math.max(0, position - 1);
        const end = Math.min(timeDomainData.length, position + 2);
        let total = 0;

        for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
          total += ((this.timeDomainData?.[sampleIndex] ?? 128) - 128) / 128;
        }

        const average = total / Math.max(1, end - start);
        const emphasized =
          Math.sign(average) * Math.min(1, Math.pow(Math.abs(average), 0.88) * 1.72);

        return Math.max(-1, Math.min(1, emphasized));
      }
    );
    const waveformLevels = rawWaveformLevels.map((sample, index, values) => {
      const previous = values[index - 1] ?? sample;
      const next = values[index + 1] ?? sample;
      return Math.max(-1, Math.min(1, previous * 0.2 + sample * 0.6 + next * 0.2));
    });
    const waveformEnergy =
      waveformLevels.reduce((total, sample) => total + Math.abs(sample), 0)
      / Math.max(1, waveformLevels.length);
    const pulseLevel = Math.max(
      0,
      Math.min(
        1,
        (levels[0] ?? 0) * 0.42
          + (levels[1] ?? 0) * 0.28
          + (levels[2] ?? 0) * 0.16
          + waveformEnergy * 0.22
      )
    );

    return { levels, waveformLevels, pulseLevel };
  }

  private startAnalysisLoop(): void {
    const requestFrame = this.getRequestFrame();

    if (!requestFrame) {
      return;
    }

    this.stopAnalysisLoop();
    this.lastAnalysisFrameAt = 0;

    const step = (timestamp: number) => {
      if (!this.analyserNode || !this.analyserData || !this.state.playing) {
        this.analysisFrameHandle = null;
        return;
      }

      if (timestamp - this.lastAnalysisFrameAt >= ANALYSIS_MIN_FRAME_MS) {
        this.lastAnalysisFrameAt = timestamp;
        const nextSpectrum = this.readSpectrumLevels();

        if (nextSpectrum) {
          this.patchState((current) => ({
            analysisAvailable: true,
            spectrumLevels: nextSpectrum.levels.map((level, index) => {
              const previous = current.spectrumLevels[index] ?? 0;
              return Math.max(0, Math.min(1, previous * ANALYSIS_SMOOTHING + level * (1 - ANALYSIS_SMOOTHING)));
            }),
            waveformLevels: nextSpectrum.waveformLevels.map((sample, index) => {
              const previous = current.waveformLevels[index] ?? 0;
              return Math.max(
                -1,
                Math.min(1, previous * WAVEFORM_SMOOTHING + sample * (1 - WAVEFORM_SMOOTHING))
              );
            }),
            pulseLevel: Math.max(
              0,
              Math.min(1, current.pulseLevel * PULSE_SMOOTHING + nextSpectrum.pulseLevel * (1 - PULSE_SMOOTHING))
            ),
          }));
        }
      }

      this.analysisFrameHandle = requestFrame(step);
    };

    this.analysisFrameHandle = requestFrame(step);
  }

  private stopAnalysisLoop(): void {
    if (this.analysisFrameHandle === null) {
      return;
    }

    const cancelFrame = this.getCancelFrame();
    cancelFrame?.(this.analysisFrameHandle);
    this.analysisFrameHandle = null;
  }

  private async activateAnalysis(): Promise<void> {
    const analysisReady = await this.ensureAnalysisGraph();

    if (!analysisReady) {
      this.stopAnalysisLoop();
      this.patchState({
        analysisAvailable: false,
        spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
        waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
        pulseLevel: 0,
      });
      return;
    }

    this.patchState({
      analysisAvailable: true,
    });
    this.startAnalysisLoop();
  }

  private async startPlayback(source: CanvasAudioPlaybackSource): Promise<void> {
    const audio = this.ensureAudio();
    const switchingTrack = this.state.activeAudioUrl !== source.audioUrl;
    const activeQueueIndex = this.findQueueIndex(this.state.queue, source);

    if (switchingTrack) {
      audio.pause();
      audio.src = source.audioUrl;
      audio.currentTime = 0;

      try {
        audio.load();
      } catch {
        // Some browser mocks do not implement load().
      }
    }

    this.patchState({
      activeElementId: source.elementId,
      activeAudioUrl: source.audioUrl,
      activeTitle: source.title,
      activeClipId: source.clipId,
      activePreviewImageUrl: source.previewImageUrl,
      activeProviderTaskId: source.providerTaskId,
      activeClipIds: source.clipIds,
      activeQueueIndex,
      currentTime: switchingTrack ? 0 : audio.currentTime,
      duration: source.duration || (Number.isFinite(audio.duration) ? audio.duration : 0),
      analysisAvailable: false,
      spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
      waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
      pulseLevel: 0,
      error: undefined,
    });

    try {
      await audio.play();
    } catch (error) {
      this.patchState({
        playing: false,
        error: getPlaybackErrorMessage(error),
      });
      throw error;
    }
  }

  async togglePlayback(source: CanvasAudioPlaybackSource): Promise<void> {
    const isSameTrack = this.state.activeElementId === source.elementId
      && this.state.activeAudioUrl === source.audioUrl;

    if (isSameTrack && this.state.playing) {
      this.pausePlayback();
      return;
    }

    await this.startPlayback(source);
  }

  setQueue(queue: CanvasAudioPlaybackSource[]): void {
    const normalizedQueue = this.normalizeQueue(queue);
    const activeQueueIndex = this.state.activeAudioUrl
      ? this.findQueueIndex(normalizedQueue, {
          elementId: this.state.activeElementId,
          audioUrl: this.state.activeAudioUrl,
        })
      : -1;

    this.patchState({
      queue: normalizedQueue,
      activeQueueIndex,
    });
  }

  pausePlayback(): void {
    if (!this.audio) {
      return;
    }

    this.audio.pause();
  }

  async playPrevious(): Promise<void> {
    const previousIndex = this.state.activeQueueIndex - 1;
    if (previousIndex < 0 || previousIndex >= this.state.queue.length) {
      return;
    }

    await this.startPlayback(this.state.queue[previousIndex]);
  }

  async playNext(): Promise<void> {
    const nextIndex = this.state.activeQueueIndex + 1;
    if (nextIndex < 0 || nextIndex >= this.state.queue.length) {
      return;
    }

    await this.startPlayback(this.state.queue[nextIndex]);
  }

  async resumePlayback(): Promise<void> {
    if (!this.audio || !this.state.activeAudioUrl) {
      return;
    }

    try {
      await this.audio.play();
    } catch (error) {
      this.patchState({
        playing: false,
        error: getPlaybackErrorMessage(error),
      });
      throw error;
    }
  }

  seekTo(time: number): void {
    if (!this.audio) {
      return;
    }

    const duration = Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : this.state.duration;
    const nextTime = Math.max(0, Math.min(time, duration || time));

    this.audio.currentTime = nextTime;
    this.patchState({
      currentTime: nextTime,
      duration,
    });
  }

  setVolume(volume: number): void {
    const nextVolume = Math.max(0, Math.min(volume, 1));

    if (this.audio) {
      this.audio.volume = nextVolume;
    }

    this.patchState({
      volume: nextVolume,
    });
  }

  stopAndClear(): void {
    this.stopAnalysisLoop();

    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.removeAttribute('src');

      try {
        this.audio.load();
      } catch {
        // Some browser mocks do not implement load().
      }
    }

    this.setState({
      ...INITIAL_STATE,
      queue: this.state.queue,
      volume: this.state.volume,
    });
  }
}

export const canvasAudioPlaybackService = new CanvasAudioPlaybackService();
