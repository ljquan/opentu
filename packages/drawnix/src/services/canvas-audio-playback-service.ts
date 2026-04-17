import {
  DEFAULT_TTS_SETTINGS,
  resolveVoice,
} from '../hooks/useTextToSpeech';
import { getFileExtension } from '@aitu/utils';
import { LS_KEYS } from '../constants/storage-keys';
import { ttsSettings, type TtsSettings } from '../utils/settings-manager';
import { cacheRemoteUrl } from './media-executor/fallback-utils';
import { getAudioCacheKeySeed } from '../data/audio-cache-key';
import type {
  ReadingPlaybackOrigin,
  ReadingPlaybackSource,
  ReadingSubtitleSegment,
} from './reading-playback-source';

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

export type PlaybackQueueSource = 'canvas' | 'playlist' | 'reading';
export type CanvasAudioQueueSource = PlaybackQueueSource;
export type PlaybackMediaType = 'audio' | 'reading' | null;
export type PlaybackRateMediaType = Exclude<PlaybackMediaType, null>;
export type PlaybackQueueItem = CanvasAudioPlaybackSource | ReadingPlaybackSource;
export type PlaybackMode = 'sequential' | 'list-loop' | 'single-loop' | 'shuffle';

export const DEFAULT_PLAYBACK_MODE: PlaybackMode = 'sequential';
export const AUDIO_PLAYBACK_SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2, 3] as const;
export const READING_PLAYBACK_SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2, 3, 5, 10] as const;
export const DEFAULT_AUDIO_PLAYBACK_RATE = 1;
export const PLAYBACK_MODE_LABELS: Record<PlaybackMode, string> = {
  sequential: '顺序播放',
  'list-loop': '列表循环',
  'single-loop': '单曲循环',
  shuffle: '随机播放',
};

export function formatPlaybackRateLabel(rate: number): string {
  const roundedRate = Math.round(rate * 100) / 100;
  const normalized = Number.isInteger(roundedRate)
    ? roundedRate.toFixed(0)
    : roundedRate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${normalized}x`;
}

export function getPlaybackSpeedPresets(
  mediaType: PlaybackRateMediaType
): readonly number[] {
  return mediaType === 'reading'
    ? READING_PLAYBACK_SPEED_PRESETS
    : AUDIO_PLAYBACK_SPEED_PRESETS;
}

function isPlaybackMode(value: string | null | undefined): value is PlaybackMode {
  return (
    value === 'sequential'
    || value === 'list-loop'
    || value === 'single-loop'
    || value === 'shuffle'
  );
}

function readPersistedPlaybackMode(): PlaybackMode {
  if (typeof window === 'undefined') {
    return DEFAULT_PLAYBACK_MODE;
  }

  try {
    const stored = window.localStorage.getItem(LS_KEYS.AUDIO_PLAYER_PLAYBACK_MODE);
    return isPlaybackMode(stored) ? stored : DEFAULT_PLAYBACK_MODE;
  } catch {
    return DEFAULT_PLAYBACK_MODE;
  }
}

function persistPlaybackMode(mode: PlaybackMode): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LS_KEYS.AUDIO_PLAYER_PLAYBACK_MODE, mode);
  } catch {
    // ignore
  }
}

function normalizeAudioPlaybackRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_AUDIO_PLAYBACK_RATE;
  }

  return Math.max(0.25, Math.min(value, 3));
}

function normalizeReadingPlaybackRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TTS_SETTINGS.rate;
  }

  return Math.max(0.5, Math.min(value, 10));
}

function readPersistedAudioPlaybackRate(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_AUDIO_PLAYBACK_RATE;
  }

  try {
    const stored = window.localStorage.getItem(LS_KEYS.AUDIO_PLAYER_AUDIO_PLAYBACK_RATE);
    return normalizeAudioPlaybackRate(stored ? Number(stored) : undefined);
  } catch {
    return DEFAULT_AUDIO_PLAYBACK_RATE;
  }
}

function persistAudioPlaybackRate(rate: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      LS_KEYS.AUDIO_PLAYER_AUDIO_PLAYBACK_RATE,
      String(normalizeAudioPlaybackRate(rate))
    );
  } catch {
    // ignore
  }
}

function readPersistedReadingPlaybackRate(): number {
  return normalizeReadingPlaybackRate(ttsSettings.get()?.rate);
}

export interface CanvasAudioPlaybackState {
  mediaType: PlaybackMediaType;
  activeElementId?: string;
  activeAudioUrl?: string;
  activeTitle?: string;
  activeClipId?: string;
  activePreviewImageUrl?: string;
  activeProviderTaskId?: string;
  activeClipIds?: string[];
  activeReadingSourceId?: string;
  activeReadingOrigin?: ReadingPlaybackOrigin;
  activeReadingSegmentIndex: number;
  readingSegments: ReadingSubtitleSegment[];
  subtitleMode: 'none' | 'estimated';
  queueSource: PlaybackQueueSource;
  activePlaylistId?: string;
  activePlaylistName?: string;
  queue: PlaybackQueueItem[];
  activeQueueIndex: number;
  playbackMode: PlaybackMode;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  audioPlaybackRate: number;
  readingPlaybackRate: number;
  effectivePlaybackRate: number;
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
const READING_PROGRESS_INTERVAL_MS = 250;

export const EMPTY_AUDIO_SPECTRUM = Object.freeze(
  Array.from({ length: ANALYSIS_BAND_COUNT }, () => 0)
);
export const EMPTY_AUDIO_WAVEFORM = Object.freeze(
  Array.from({ length: ANALYSIS_WAVEFORM_SAMPLE_COUNT }, () => 0)
);

function createInitialState(): CanvasAudioPlaybackState {
  return {
    mediaType: null,
    activeReadingSegmentIndex: -1,
    readingSegments: [],
    subtitleMode: 'none',
    queueSource: 'canvas',
    queue: [],
    activeQueueIndex: -1,
    playbackMode: readPersistedPlaybackMode(),
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: DEFAULT_VOLUME,
    audioPlaybackRate: readPersistedAudioPlaybackRate(),
    readingPlaybackRate: readPersistedReadingPlaybackRate(),
    effectivePlaybackRate: readPersistedAudioPlaybackRate(),
    analysisAvailable: false,
    spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
    waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
    pulseLevel: 0,
  };
}

interface CanvasAudioPlaybackRuntime {
  audioContextFactory?: () => AudioContext;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  speechSynthesis?: SpeechSynthesis;
  utteranceFactory?: (text: string) => SpeechSynthesisUtterance;
  setInterval?: typeof window.setInterval;
  clearInterval?: typeof window.clearInterval;
  now?: () => number;
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

export function isReadingPlaybackSource(
  source: PlaybackQueueItem | undefined | null
): source is ReadingPlaybackSource {
  return !!source && 'readingSourceId' in source;
}

function isAudioPlaybackSource(
  source: PlaybackQueueItem | undefined | null
): source is CanvasAudioPlaybackSource {
  return !!source && 'audioUrl' in source;
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
  private state: CanvasAudioPlaybackState = createInitialState();
  private canvasQueue: CanvasAudioPlaybackSource[] = [];
  private currentReadingSource: ReadingPlaybackSource | null = null;
  private readingVersion = 0;
  private readingProgressHandle: number | ReturnType<typeof setInterval> | null = null;
  private readingSegmentResumeAt = 0;
  private readingSegmentOffsetMs = 0;
  private readingResumeRequiresRestart = false;

  constructor(
    private readonly audioFactory: () => HTMLAudioElement = () => new Audio(),
    private readonly runtime: CanvasAudioPlaybackRuntime = {}
  ) {
    ttsSettings.addListener(this.handleTtsSettingsChange);
  }

  getState(): CanvasAudioPlaybackState {
    return this.state;
  }

  getCanvasQueue(): CanvasAudioPlaybackSource[] {
    return this.canvasQueue.map((source) => ({ ...source }));
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

  private getSpeechSynthesis(): SpeechSynthesis | null {
    if (this.runtime.speechSynthesis) {
      return this.runtime.speechSynthesis;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return null;
    }

    return window.speechSynthesis;
  }

  private handleTtsSettingsChange = (nextSettings: TtsSettings): void => {
    const nextReadingRate = normalizeReadingPlaybackRate(nextSettings?.rate);

    if (Math.abs(nextReadingRate - this.state.readingPlaybackRate) < 0.001) {
      return;
    }

    this.patchState((current) => ({
      readingPlaybackRate: nextReadingRate,
      effectivePlaybackRate:
        current.mediaType !== 'audio' ? nextReadingRate : current.effectivePlaybackRate,
    }));

    if (this.state.mediaType !== 'reading' || !this.currentReadingSource) {
      return;
    }

    if (this.state.playing) {
      const nextSegmentIndex = Math.max(0, this.state.activeReadingSegmentIndex);
      this.startReading(this.currentReadingSource, nextSegmentIndex);
      return;
    }

    this.readingResumeRequiresRestart = true;
  };

  private getUtteranceFactory(): ((text: string) => SpeechSynthesisUtterance) | null {
    if (this.runtime.utteranceFactory) {
      return this.runtime.utteranceFactory;
    }

    if (typeof window === 'undefined' || typeof window.SpeechSynthesisUtterance === 'undefined') {
      return null;
    }

    return (text: string) => new window.SpeechSynthesisUtterance(text);
  }

  private getSetInterval(): typeof window.setInterval | null {
    if (this.runtime.setInterval) {
      return this.runtime.setInterval;
    }

    if (typeof window === 'undefined') {
      return null;
    }

    return window.setInterval.bind(window);
  }

  private getClearInterval(): typeof window.clearInterval | null {
    if (this.runtime.clearInterval) {
      return this.runtime.clearInterval;
    }

    if (typeof window === 'undefined') {
      return null;
    }

    return window.clearInterval.bind(window);
  }

  private getNow(): number {
    if (this.runtime.now) {
      return this.runtime.now();
    }

    return Date.now();
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = this.audioFactory();
      this.audio.preload = 'metadata';
      this.audio.volume = this.state.volume;
      this.audio.playbackRate = this.state.audioPlaybackRate;
      this.audio.crossOrigin = 'anonymous';
      this.attachAudioListeners(this.audio);
    }

    return this.audio;
  }

  private getActivePlaybackRateMediaType(): PlaybackRateMediaType {
    return this.state.mediaType === 'reading' ? 'reading' : 'audio';
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

  private getSourceKey(source: PlaybackQueueItem): string {
    if (isReadingPlaybackSource(source)) {
      return source.readingSourceId;
    }
    return `${source.elementId || ''}::${source.audioUrl}`;
  }

  private normalizeQueue<T extends PlaybackQueueItem>(queue: T[]): T[] {
    const seen = new Set<string>();
    const normalized: T[] = [];

    queue.forEach((source) => {
      const key = this.getSourceKey(source);
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      const clonedSource = isReadingPlaybackSource(source)
        ? {
            ...source,
            segments: source.segments.map((segment) => ({ ...segment })),
            origin: { ...source.origin },
          }
        : { ...source };

      normalized.push(clonedSource as T);
    });

    return normalized;
  }

  private findQueueIndex(queue: PlaybackQueueItem[], source: PlaybackQueueItem): number {
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
    if (this.state.mediaType !== 'audio') {
      return;
    }

    this.patchState({
      mediaType: 'audio',
      playing: true,
      error: undefined,
    });
    void this.activateAnalysis();
  };

  private handlePause = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

    const audio = this.audio;
    this.stopAnalysisLoop();
    this.patchState({
      playing: false,
      currentTime: audio ? audio.currentTime : this.state.currentTime,
      pulseLevel: 0,
    });
  };

  private handleEnded = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

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

    void this.continueQueueAfterCurrentEnd();
  };

  private handleTimeUpdate = (): void => {
    if (!this.audio || this.state.mediaType !== 'audio') {
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
    if (!this.audio || this.state.mediaType !== 'audio') {
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
    if (!this.audio || this.state.mediaType !== 'audio') {
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
      if (!this.analyserNode || !this.analyserData || !this.state.playing || this.state.mediaType !== 'audio') {
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

  private stopReadingProgressLoop(): void {
    if (!this.readingProgressHandle) {
      return;
    }

    this.getClearInterval()?.(this.readingProgressHandle);
    this.readingProgressHandle = null;
  }

  private startReadingProgressLoop(): void {
    this.stopReadingProgressLoop();
    const setIntervalFn = this.getSetInterval();
    if (!setIntervalFn || !this.currentReadingSource || this.state.activeReadingSegmentIndex < 0) {
      return;
    }

    this.readingProgressHandle = setIntervalFn(() => {
      if (!this.currentReadingSource || this.state.activeReadingSegmentIndex < 0 || !this.state.playing) {
        return;
      }

      const segment = this.currentReadingSource.segments[this.state.activeReadingSegmentIndex];
      if (!segment) {
        return;
      }

      const elapsedMs = this.readingSegmentOffsetMs + Math.max(0, this.getNow() - this.readingSegmentResumeAt);
      const currentTimeMs = Math.min(segment.endMs, segment.startMs + elapsedMs);
      this.patchState({
        currentTime: currentTimeMs / 1000,
      });
    }, READING_PROGRESS_INTERVAL_MS);
  }

  private clearReadingRuntime(cancelSpeech = true): void {
    this.readingVersion += 1;
    this.stopReadingProgressLoop();
    this.readingSegmentResumeAt = 0;
    this.readingSegmentOffsetMs = 0;
    this.readingResumeRequiresRestart = false;
    this.currentReadingSource = null;
    if (cancelSpeech) {
      this.getSpeechSynthesis()?.cancel();
    }
  }

  private stopAudioForReading(): void {
    this.stopAnalysisLoop();
    if (this.audio) {
      this.audio.pause();
    }
    this.patchState({
      analysisAvailable: false,
      spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
      waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
      pulseLevel: 0,
      activeAudioUrl: undefined,
      activeClipId: undefined,
      activeProviderTaskId: undefined,
      activeClipIds: undefined,
    });
  }

  private stopReadingForAudio(): void {
    this.clearReadingRuntime(true);
    this.patchState({
      activeReadingSourceId: undefined,
      activeReadingOrigin: undefined,
      activeReadingSegmentIndex: -1,
      readingSegments: [],
      subtitleMode: 'none',
    });
  }

  private async startPlayback(
    source: CanvasAudioPlaybackSource,
    restartFromBeginning = false
  ): Promise<void> {
    this.stopReadingForAudio();
    const audio = this.ensureAudio();
    const playbackUrl = await this.resolvePlaybackAudioUrl(source);
    const switchingTrack =
      restartFromBeginning
      || this.state.activeAudioUrl !== source.audioUrl
      || this.state.mediaType !== 'audio';
    const activeQueueIndex = this.findQueueIndex(this.state.queue, source);

    if (switchingTrack) {
      audio.pause();
      audio.src = playbackUrl;
      audio.currentTime = 0;

      try {
        audio.load();
      } catch {
        // ignore
      }
    }

    audio.playbackRate = this.state.audioPlaybackRate;

    this.patchState({
      mediaType: 'audio',
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
      effectivePlaybackRate: this.state.audioPlaybackRate,
      activeReadingSourceId: undefined,
      activeReadingOrigin: undefined,
      activeReadingSegmentIndex: -1,
      readingSegments: [],
      subtitleMode: 'none',
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

  private async resolvePlaybackAudioUrl(
    source: CanvasAudioPlaybackSource
  ): Promise<string> {
    const { audioUrl } = source;
    if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
      return audioUrl;
    }

    try {
      const ext = getFileExtension(audioUrl);
      const cacheKey = source.elementId?.startsWith('asset:')
        ? source.elementId
        : getAudioCacheKeySeed(audioUrl, {
            clipId: source.clipId,
            providerTaskId: source.providerTaskId,
          });
      return await cacheRemoteUrl(
        audioUrl,
        cacheKey,
        'audio',
        ext !== 'bin' ? ext : 'mp3',
        undefined,
        {
          source:
            source.elementId?.startsWith('asset:')
              ? 'PLAYBACK_CACHE'
              : 'AI_GENERATED',
        }
      );
    } catch (error) {
      console.warn('[CanvasAudioPlayback] Failed to resolve local audio cache:', error);
      return audioUrl;
    }
  }

  private createReadingUtterance(text: string, preferredLanguage: string): SpeechSynthesisUtterance | null {
    const speechSynthesis = this.getSpeechSynthesis();
    const utteranceFactory = this.getUtteranceFactory();
    if (!speechSynthesis || !utteranceFactory) {
      return null;
    }

    const persistedTtsSettings = ttsSettings.get();
    const settings = {
      ...DEFAULT_TTS_SETTINGS,
      ...(persistedTtsSettings || {}),
      voicesByLanguage: persistedTtsSettings?.voicesByLanguage || {},
      rate: this.state.readingPlaybackRate,
    };
    const utterance = utteranceFactory(text);
    utterance.lang = preferredLanguage;
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    const voice = resolveVoice(speechSynthesis.getVoices(), settings, preferredLanguage);
    if (voice) {
      utterance.voice = voice;
    }
    return utterance;
  }

  private beginReadingSegment(
    source: ReadingPlaybackSource,
    segmentIndex: number,
    sourceVersion = this.readingVersion
  ): void {
    const speechSynthesis = this.getSpeechSynthesis();
    if (!speechSynthesis) {
      this.patchState({
        playing: false,
        error: '当前浏览器不支持语音朗读',
      });
      return;
    }

    const segment = source.segments[segmentIndex];
    if (!segment) {
      this.patchState({
        playing: false,
        currentTime: this.state.duration,
        activeReadingSegmentIndex: source.segments.length - 1,
      });
      return;
    }

    const utterance = this.createReadingUtterance(segment.text, source.preferredLanguage);
    if (!utterance) {
      this.patchState({
        playing: false,
        error: '当前浏览器不支持语音朗读',
      });
      return;
    }

    this.readingSegmentOffsetMs = 0;
    this.readingSegmentResumeAt = this.getNow();
    this.readingResumeRequiresRestart = false;
    utterance.onend = () => {
      if (sourceVersion !== this.readingVersion) {
        return;
      }

      this.stopReadingProgressLoop();
      const isLastSegment = segmentIndex >= source.segments.length - 1;
      if (isLastSegment) {
        this.patchState({
          playing: false,
          currentTime: segment.endMs / 1000,
          activeReadingSegmentIndex: segmentIndex,
        });
        void this.continueQueueAfterCurrentEnd();
        return;
      }

      this.beginReadingSegment(source, segmentIndex + 1, sourceVersion);
    };
    utterance.onerror = () => {
      if (sourceVersion !== this.readingVersion) {
        return;
      }

      this.stopReadingProgressLoop();
      this.patchState({
        playing: false,
        error: '朗读失败，请稍后重试',
      });
    };

    this.patchState({
      mediaType: 'reading',
      activeElementId: source.elementId,
      activeTitle: source.title,
      activePreviewImageUrl: source.previewImageUrl,
      activeReadingSourceId: source.readingSourceId,
      activeReadingOrigin: source.origin,
      activeReadingSegmentIndex: segmentIndex,
      readingSegments: source.segments,
      subtitleMode: 'estimated',
      currentTime: segment.startMs / 1000,
      duration: (source.segments[source.segments.length - 1]?.endMs || 0) / 1000,
      effectivePlaybackRate: this.state.readingPlaybackRate,
      playing: true,
      analysisAvailable: false,
      spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
      waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
      pulseLevel: 0,
      error: undefined,
    });

    this.startReadingProgressLoop();
    speechSynthesis.speak(utterance);
  }

  private startReading(source: ReadingPlaybackSource, segmentIndex = 0): void {
    this.stopAudioForReading();
    this.clearReadingRuntime(true);
    this.currentReadingSource = source;
    this.readingVersion += 1;

    const activeQueueIndex = this.findQueueIndex(this.state.queue, source);
    this.patchState({
      queueSource: 'reading',
      activePlaylistId: this.state.activePlaylistId,
      activePlaylistName: this.state.activePlaylistName,
      activeQueueIndex,
    });

    this.beginReadingSegment(source, Math.max(0, Math.min(segmentIndex, source.segments.length - 1)));
  }

  async togglePlayback(source: CanvasAudioPlaybackSource): Promise<void> {
    const isSameTrack = this.state.mediaType === 'audio'
      && this.state.activeElementId === source.elementId
      && this.state.activeAudioUrl === source.audioUrl;

    if (isSameTrack && this.state.playing) {
      this.pausePlayback();
      return;
    }

    await this.startPlayback(source);
  }

  toggleReadingPlayback(source: ReadingPlaybackSource): void {
    const isSameSource = this.state.mediaType === 'reading'
      && this.state.activeReadingSourceId === source.readingSourceId;

    if (isSameSource) {
      if (this.state.playing) {
        this.pausePlayback();
      } else {
        void this.resumePlayback();
      }
      return;
    }

    this.startReading(source);
  }

  setPlaybackMode(mode: PlaybackMode): void {
    persistPlaybackMode(mode);
    this.patchState({
      playbackMode: mode,
    });
  }

  setPlaybackRate(rate: number, mediaType?: PlaybackRateMediaType): void {
    const targetMediaType = mediaType || this.getActivePlaybackRateMediaType();

    if (targetMediaType === 'reading') {
      const nextRate = normalizeReadingPlaybackRate(rate);
      if (Math.abs(nextRate - this.state.readingPlaybackRate) < 0.001) {
        return;
      }

      this.patchState((current) => ({
        readingPlaybackRate: nextRate,
        effectivePlaybackRate:
          current.mediaType !== 'audio' ? nextRate : current.effectivePlaybackRate,
      }));

      if (this.state.mediaType === 'reading' && this.currentReadingSource) {
        const nextSegmentIndex = Math.max(0, this.state.activeReadingSegmentIndex);
        if (this.state.playing) {
          this.startReading(this.currentReadingSource, nextSegmentIndex);
        } else {
          this.readingResumeRequiresRestart = true;
        }
      }

      void ttsSettings.update({ rate: nextRate }).catch((error) => {
        console.warn('[CanvasAudioPlayback] Failed to persist reading playback rate:', error);
      });
      return;
    }

    const nextRate = normalizeAudioPlaybackRate(rate);
    if (Math.abs(nextRate - this.state.audioPlaybackRate) < 0.001) {
      return;
    }

    persistAudioPlaybackRate(nextRate);
    if (this.audio) {
      this.audio.playbackRate = nextRate;
    }

    this.patchState((current) => ({
      audioPlaybackRate: nextRate,
      effectivePlaybackRate:
        current.mediaType !== 'reading' ? nextRate : current.effectivePlaybackRate,
    }));
  }

  private getSequentialQueueIndex(offset: -1 | 1): number {
    const targetIndex = this.state.activeQueueIndex + offset;
    if (targetIndex < 0 || targetIndex >= this.state.queue.length) {
      return -1;
    }

    return targetIndex;
  }

  private getNextQueueIndexForAutoAdvance(): number {
    const { activeQueueIndex, playbackMode, queue } = this.state;
    if (activeQueueIndex < 0 || queue.length === 0) {
      return -1;
    }

    if (playbackMode === 'single-loop') {
      return activeQueueIndex;
    }

    if (playbackMode === 'shuffle') {
      if (queue.length === 1) {
        return activeQueueIndex;
      }

      let candidate = activeQueueIndex;
      let attempts = 0;
      while (candidate === activeQueueIndex && attempts < 8) {
        candidate = Math.floor(Math.random() * queue.length);
        attempts += 1;
      }

      return candidate === activeQueueIndex
        ? (activeQueueIndex + 1) % queue.length
        : candidate;
    }

    const nextIndex = activeQueueIndex + 1;
    if (nextIndex < queue.length) {
      return nextIndex;
    }

    if (playbackMode === 'list-loop') {
      return 0;
    }

    return -1;
  }

  private async playQueueItemAt(index: number, restartFromBeginning = false): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) {
      return;
    }

    const target = this.state.queue[index];
    if (isReadingPlaybackSource(target)) {
      this.startReading(target);
      return;
    }

    if (isAudioPlaybackSource(target)) {
      await this.startPlayback(target, restartFromBeginning);
    }
  }

  private async continueQueueAfterCurrentEnd(): Promise<void> {
    const nextIndex = this.getNextQueueIndexForAutoAdvance();
    if (nextIndex < 0) {
      return;
    }

    await this.playQueueItemAt(nextIndex, nextIndex === this.state.activeQueueIndex);
  }

  setCanvasQueue(queue: CanvasAudioPlaybackSource[]): void {
    const normalizedQueue = this.normalizeQueue(queue);
    this.canvasQueue = normalizedQueue;

    if (this.state.queueSource !== 'canvas') {
      return;
    }

    const activeSource = this.state.activeAudioUrl
      ? {
          elementId: this.state.activeElementId,
          audioUrl: this.state.activeAudioUrl,
        } as CanvasAudioPlaybackSource
      : null;

    const activeQueueIndex = activeSource
      ? this.findQueueIndex(normalizedQueue, activeSource)
      : -1;

    this.patchState({
      queue: normalizedQueue,
      activeQueueIndex,
    });
  }

  async togglePlaybackInQueue(
    source: CanvasAudioPlaybackSource,
    queue: PlaybackQueueItem[],
    options?: {
      queueSource?: CanvasAudioQueueSource;
      playlistId?: string;
      playlistName?: string;
      queueId?: string;
      queueName?: string;
    }
  ): Promise<void> {
    this.setQueue(queue, options);
    await this.togglePlayback(source);
  }

  setReadingQueue(
    queue: ReadingPlaybackSource[],
    options?: {
      queueId?: string;
      queueName?: string;
    }
  ): void {
    const normalizedQueue = this.normalizeQueue(queue);
    const activeSource = this.state.activeReadingSourceId
      ? normalizedQueue.find((item) => item.readingSourceId === this.state.activeReadingSourceId)
      : null;

    this.patchState({
      queueSource: 'reading',
      activePlaylistId: options?.queueId,
      activePlaylistName: options?.queueName,
      queue: normalizedQueue,
      activeQueueIndex: activeSource ? this.findQueueIndex(normalizedQueue, activeSource) : -1,
    });
  }

  toggleReadingPlaybackInQueue(
    source: ReadingPlaybackSource,
    queue: ReadingPlaybackSource[],
    options?: {
      queueId?: string;
      queueName?: string;
    }
  ): void {
    this.setReadingQueue(queue, options);
    this.toggleReadingPlayback(source);
  }

  setQueue(
    queue: PlaybackQueueItem[],
    options?: {
      queueSource?: CanvasAudioQueueSource;
      playlistId?: string;
      playlistName?: string;
      queueId?: string;
      queueName?: string;
    }
  ): void {
    const normalizedQueue = this.normalizeQueue(queue);
    if ((options?.queueSource || 'canvas') === 'canvas') {
      this.canvasQueue = normalizedQueue.filter(isAudioPlaybackSource);
    }
    const activeSource = this.state.activeAudioUrl
      ? {
          elementId: this.state.activeElementId,
          audioUrl: this.state.activeAudioUrl,
        } as CanvasAudioPlaybackSource
      : null;

    this.patchState({
      queueSource: options?.queueSource || 'canvas',
      activePlaylistId:
        options?.queueId ?? (options?.queueSource === 'playlist' ? options.playlistId : undefined),
      activePlaylistName:
        options?.queueName ?? (options?.queueSource === 'playlist' ? options.playlistName : undefined),
      queue: normalizedQueue,
      activeQueueIndex: activeSource ? this.findQueueIndex(normalizedQueue, activeSource) : -1,
    });
  }

  pausePlayback(): void {
    if (this.state.mediaType === 'reading') {
      const speechSynthesis = this.getSpeechSynthesis();
      if (!speechSynthesis || this.state.activeReadingSegmentIndex < 0) {
        return;
      }

      speechSynthesis.pause();
      if (this.readingSegmentResumeAt > 0) {
        this.readingSegmentOffsetMs += Math.max(0, this.getNow() - this.readingSegmentResumeAt);
      }
      this.readingSegmentResumeAt = 0;
      this.stopReadingProgressLoop();
      this.patchState({
        playing: false,
      });
      return;
    }

    if (!this.audio) {
      return;
    }

    this.audio.pause();
  }

  async playPrevious(): Promise<void> {
    const previousIndex = this.getSequentialQueueIndex(-1);
    if (previousIndex < 0) {
      return;
    }

    await this.playQueueItemAt(previousIndex);
  }

  async playNext(): Promise<void> {
    const nextIndex = this.getSequentialQueueIndex(1);
    if (nextIndex < 0) {
      return;
    }

    await this.playQueueItemAt(nextIndex);
  }

  async resumePlayback(): Promise<void> {
    if (this.state.mediaType === 'reading') {
      const speechSynthesis = this.getSpeechSynthesis();
      if (!speechSynthesis || !this.currentReadingSource) {
        return;
      }

      if (this.state.activeReadingSegmentIndex < 0 || this.readingResumeRequiresRestart) {
        this.startReading(
          this.currentReadingSource,
          Math.max(0, this.state.activeReadingSegmentIndex)
        );
        return;
      }

      this.readingSegmentResumeAt = this.getNow();
      speechSynthesis.resume();
      this.startReadingProgressLoop();
      this.patchState({
        playing: true,
        error: undefined,
      });
      return;
    }

    if (!this.audio || !this.state.activeAudioUrl) {
      return;
    }

    this.audio.playbackRate = this.state.audioPlaybackRate;

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
    if (this.state.mediaType !== 'audio' || !this.audio) {
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

  seekToReadingSegment(index: number): void {
    if (!this.currentReadingSource) {
      return;
    }

    const boundedIndex = Math.max(0, Math.min(index, this.currentReadingSource.segments.length - 1));
    this.startReading(this.currentReadingSource, boundedIndex);
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
    this.clearReadingRuntime(true);

    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.removeAttribute('src');

      try {
        this.audio.load();
      } catch {
        // ignore
      }
    }

    this.setState({
      ...createInitialState(),
      queue: this.state.queue,
      volume: this.state.volume,
      audioPlaybackRate: this.state.audioPlaybackRate,
      readingPlaybackRate: this.state.readingPlaybackRate,
      effectivePlaybackRate: this.state.audioPlaybackRate,
      playbackMode: this.state.playbackMode,
      queueSource: this.state.queueSource,
      activePlaylistId: this.state.activePlaylistId,
      activePlaylistName: this.state.activePlaylistName,
    });
  }
}

export const canvasAudioPlaybackService = new CanvasAudioPlaybackService();
