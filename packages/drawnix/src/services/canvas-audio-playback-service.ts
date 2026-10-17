import { DEFAULT_TTS_SETTINGS, resolveVoice } from '../hooks/useTextToSpeech';
import { LS_KEYS } from '../constants/storage-keys';
import { ttsSettings, type TtsSettings } from '../utils/settings-manager';
import { cacheRemoteUrl } from './media-executor/fallback-utils';
import { getAudioCacheKeySeed } from '../data/audio-cache-key';
import type {
  ReadingPlaybackOrigin,
  ReadingPlaybackSource,
  ReadingSubtitleSegment,
} from './reading-playback-source';
import { buildReadingSubtitleSegments } from './reading-playback-source';

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
export type PlaybackQueueItem =
  | CanvasAudioPlaybackSource
  | ReadingPlaybackSource;
export type PlaybackMode =
  | 'sequential'
  | 'list-loop'
  | 'single-loop'
  | 'shuffle';

export const DEFAULT_PLAYBACK_MODE: PlaybackMode = 'sequential';
export const AUDIO_PLAYBACK_SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2, 3] as const;
export const READING_PLAYBACK_SPEED_PRESETS = [
  0.75, 1, 1.25, 1.5, 2, 3, 5, 10,
] as const;
export const DEFAULT_AUDIO_PLAYBACK_RATE = 1;
const DEFAULT_VOLUME = 0.78;
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

function isPlaybackMode(
  value: string | null | undefined
): value is PlaybackMode {
  return (
    value === 'sequential' ||
    value === 'list-loop' ||
    value === 'single-loop' ||
    value === 'shuffle'
  );
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    // Access can throw in privacy-restricted or server-rendered runtimes.
  }

  return null;
}

function getAudioFileExtension(url: string): string {
  const pathname = url.split(/[?#]/, 1)[0] || '';
  const extension = pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1];
  return extension?.toLowerCase() || 'mp3';
}

function readPersistedPlaybackMode(): PlaybackMode {
  try {
    const stored = getLocalStorage()?.getItem(
      LS_KEYS.AUDIO_PLAYER_PLAYBACK_MODE
    );
    return isPlaybackMode(stored) ? stored : DEFAULT_PLAYBACK_MODE;
  } catch {
    return DEFAULT_PLAYBACK_MODE;
  }
}

function persistPlaybackMode(mode: PlaybackMode): void {
  try {
    getLocalStorage()?.setItem(LS_KEYS.AUDIO_PLAYER_PLAYBACK_MODE, mode);
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
  try {
    const stored = getLocalStorage()?.getItem(
      LS_KEYS.AUDIO_PLAYER_AUDIO_PLAYBACK_RATE
    );
    return normalizeAudioPlaybackRate(stored ? Number(stored) : undefined);
  } catch {
    return DEFAULT_AUDIO_PLAYBACK_RATE;
  }
}

function persistAudioPlaybackRate(rate: number): void {
  try {
    getLocalStorage()?.setItem(
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
  loading: boolean;
  analysisAvailable: boolean;
  spectrumLevels: number[];
  waveformLevels: number[];
  pulseLevel: number;
  error?: string;
}

type PlaybackListener = () => void;

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
    volume: readPersistedAudioVolume(),
    audioPlaybackRate: readPersistedAudioPlaybackRate(),
    readingPlaybackRate: readPersistedReadingPlaybackRate(),
    effectivePlaybackRate: readPersistedAudioPlaybackRate(),
    loading: false,
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

function normalizeVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_VOLUME;
  }

  return Math.max(0, Math.min(value, 1));
}

function readPersistedAudioVolume(): number {
  try {
    const stored = getLocalStorage()?.getItem(LS_KEYS.AUDIO_PLAYER_VOLUME);
    return normalizeVolume(stored ? Number(stored) : undefined);
  } catch {
    return DEFAULT_VOLUME;
  }
}

function persistAudioVolume(volume: number): void {
  try {
    getLocalStorage()?.setItem(
      LS_KEYS.AUDIO_PLAYER_VOLUME,
      String(normalizeVolume(volume))
    );
  } catch {
    // ignore
  }
}

interface PlaybackEndExpectation {
  mediaType: Exclude<PlaybackMediaType, null>;
  sourceKey: string;
  queueIndex: number;
  requestVersion: number;
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
  private activePlaybackUrl: string | null = null;
  /** Invalidates async URL resolution and play requests from previous tracks. */
  private playbackRequestVersion = 0;
  private readingVersion = 0;
  private readingProgressHandle:
    | number
    | ReturnType<typeof setInterval>
    | null = null;
  private readingSegmentResumeAt = 0;
  private readingSegmentOffsetMs = 0;
  private readingResumeRequiresRestart = false;
  private directPlaybackFallbackUrl: string | null = null;
  private playbackFallbackInProgress = false;
  private playbackFallbackPromise: Promise<boolean> | null = null;
  private analysisEnabledForCurrentAudio = true;

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
      | ((
          current: CanvasAudioPlaybackState
        ) => Partial<CanvasAudioPlaybackState>)
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
        current.mediaType !== 'audio'
          ? nextReadingRate
          : current.effectivePlaybackRate,
    }));

    if (this.state.mediaType !== 'reading' || !this.currentReadingSource) {
      return;
    }

    const refreshedSource = this.refreshReadingSourceRate(
      this.currentReadingSource,
      nextReadingRate
    );

    if (this.state.playing && refreshedSource) {
      const nextSegmentIndex = Math.max(
        0,
        this.state.activeReadingSegmentIndex
      );
      this.startReading(refreshedSource, nextSegmentIndex);
      return;
    }

    this.readingResumeRequiresRestart = true;
  };

  private getUtteranceFactory():
    | ((text: string) => SpeechSynthesisUtterance)
    | null {
    if (this.runtime.utteranceFactory) {
      return this.runtime.utteranceFactory;
    }

    if (
      typeof window === 'undefined' ||
      typeof window.SpeechSynthesisUtterance === 'undefined'
    ) {
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

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) {
      return undefined;
    }

    return () => new AudioContextCtor();
  }

  private getRequestFrame():
    | ((callback: FrameRequestCallback) => number)
    | undefined {
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

  private getActiveSourceKey(): string | undefined {
    if (this.state.mediaType === 'reading') {
      return this.state.activeReadingSourceId;
    }

    if (this.state.mediaType === 'audio' && this.state.activeAudioUrl) {
      return `${this.state.activeElementId || ''}::${
        this.state.activeAudioUrl
      }`;
    }

    return undefined;
  }

  private invalidatePlaybackRequests(): number {
    this.playbackRequestVersion += 1;
    return this.playbackRequestVersion;
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

  private findQueueIndex(
    queue: PlaybackQueueItem[],
    source: PlaybackQueueItem
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
    audio.addEventListener('loadstart', this.handleLoadStart);
    audio.addEventListener('waiting', this.handleWaiting);
    audio.addEventListener('stalled', this.handleWaiting);
    audio.addEventListener('canplay', this.handleCanPlay);
    audio.addEventListener('playing', this.handleCanPlay);
  }

  private detachAudioListeners(audio: HTMLAudioElement): void {
    audio.removeEventListener('play', this.handlePlay);
    audio.removeEventListener('pause', this.handlePause);
    audio.removeEventListener('ended', this.handleEnded);
    audio.removeEventListener('timeupdate', this.handleTimeUpdate);
    audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    audio.removeEventListener('durationchange', this.handleDurationChange);
    audio.removeEventListener('error', this.handleError);
    audio.removeEventListener('loadstart', this.handleLoadStart);
    audio.removeEventListener('waiting', this.handleWaiting);
    audio.removeEventListener('stalled', this.handleWaiting);
    audio.removeEventListener('canplay', this.handleCanPlay);
    audio.removeEventListener('playing', this.handleCanPlay);
  }

  private handlePlay = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

    this.patchState({
      mediaType: 'audio',
      playing: true,
      loading: false,
      error: undefined,
    });
    void this.activateAnalysis(this.playbackRequestVersion);
  };

  private handlePause = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

    const audio = this.audio;
    this.stopAnalysisLoop();
    this.patchState({
      playing: false,
      loading: false,
      currentTime: audio ? audio.currentTime : this.state.currentTime,
      pulseLevel: 0,
    });
  };

  private handleLoadStart = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

    this.patchState({ loading: true, error: undefined });
  };

  private handleWaiting = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

    this.patchState({ loading: true });
  };

  private handleCanPlay = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

    this.patchState({ loading: false });
  };

  private handleEnded = (): void => {
    if (this.state.mediaType !== 'audio') {
      return;
    }

    const duration =
      this.audio && Number.isFinite(this.audio.duration)
        ? this.audio.duration
        : this.state.duration;
    const expectation: PlaybackEndExpectation = {
      mediaType: 'audio',
      sourceKey: this.getActiveSourceKey() || '',
      queueIndex: this.state.activeQueueIndex,
      requestVersion: this.playbackRequestVersion,
    };

    this.stopAnalysisLoop();
    this.patchState({
      playing: false,
      loading: false,
      currentTime: duration,
      duration,
      pulseLevel: 0,
    });

    void this.continueQueueAfterCurrentEnd(expectation);
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
    if (this.state.mediaType !== 'audio') {
      return;
    }

    if (this.playbackFallbackInProgress) {
      return;
    }

    if (
      this.audio &&
      this.directPlaybackFallbackUrl &&
      !this.playbackFallbackInProgress
    ) {
      void this.playDirectPlaybackFallback();
      return;
    }
    this.stopAnalysisLoop();
    this.patchState({
      playing: false,
      loading: false,
      analysisAvailable: false,
      spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
      waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
      pulseLevel: 0,
      error: '音频加载失败，请稍后重试',
    });
  };

  private replaceAudioElementForDirectPlayback(): void {
    const previousAudio = this.audio;
    if (!previousAudio) {
      return;
    }

    this.detachAudioListeners(previousAudio);
    this.stopAnalysisLoop();
    this.mediaElementSource?.disconnect?.();
    this.mediaElementSource = null;

    const audio = this.audioFactory();
    audio.preload = 'metadata';
    audio.volume = this.state.volume;
    audio.playbackRate = this.state.audioPlaybackRate;
    this.audio = audio;
    this.attachAudioListeners(audio);
  }

  private async performDirectPlaybackFallback(): Promise<boolean> {
    const fallbackUrl = this.directPlaybackFallbackUrl;
    if (!this.audio || !fallbackUrl || this.playbackFallbackInProgress) {
      return false;
    }

    this.directPlaybackFallbackUrl = null;
    this.playbackFallbackInProgress = true;
    if (this.mediaElementSource) {
      this.replaceAudioElementForDirectPlayback();
    }

    const audio = this.audio;
    this.analysisEnabledForCurrentAudio = false;
    this.stopAnalysisLoop();
    audio.pause();
    audio.removeAttribute('crossorigin');
    audio.src = fallbackUrl;
    audio.currentTime = 0;
    try {
      audio.load();
    } catch {
      // Let play surface the final error.
    }

    try {
      await audio.play();
      return true;
    } catch (error) {
      this.patchState({
        playing: false,
        analysisAvailable: false,
        error: getPlaybackErrorMessage(error),
      });
      return false;
    } finally {
      this.playbackFallbackInProgress = false;
    }
  }

  private playDirectPlaybackFallback(): Promise<boolean> {
    if (this.playbackFallbackPromise) {
      return this.playbackFallbackPromise;
    }

    const fallbackPromise = this.performDirectPlaybackFallback();
    const trackedPromise = fallbackPromise.finally(() => {
      if (this.playbackFallbackPromise === trackedPromise) {
        this.playbackFallbackPromise = null;
      }
    });
    this.playbackFallbackPromise = trackedPromise;
    return trackedPromise;
  }

  private async ensureAnalysisGraph(): Promise<boolean> {
    if (!this.analysisEnabledForCurrentAudio) {
      return false;
    }

    const createAudioContext = this.getAudioContextFactory();

    if (!createAudioContext) {
      return false;
    }

    try {
      const audio = this.ensureAudio();

      if (!this.audioContext) {
        this.audioContext = createAudioContext();
      }

      if (!this.analyserNode) {
        this.analyserNode = this.audioContext.createAnalyser();
        this.analyserNode.fftSize = ANALYSIS_FFT_SIZE;
        this.analyserNode.smoothingTimeConstant = 0.82;
        this.analyserNode.connect(this.audioContext.destination);
      }

      if (!this.mediaElementSource) {
        this.mediaElementSource =
          this.audioContext.createMediaElementSource(audio);
        this.mediaElementSource.connect(this.analyserNode);
      }

      if (
        !this.analyserData ||
        this.analyserData.length !== this.analyserNode.frequencyBinCount
      ) {
        this.analyserData = new Uint8Array(this.analyserNode.frequencyBinCount);
      }

      if (
        !this.timeDomainData ||
        this.timeDomainData.length !== this.analyserNode.fftSize
      ) {
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
      const start = Math.floor((index / ANALYSIS_BAND_COUNT) ** 1.85 * length);
      const end = Math.floor(
        ((index + 1) / ANALYSIS_BAND_COUNT) ** 1.85 * length
      );
      return [start, Math.max(start + 1, end)];
    });
  }

  private readSpectrumLevels(): {
    levels: number[];
    waveformLevels: number[];
    pulseLevel: number;
  } | null {
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
          (index / Math.max(1, ANALYSIS_WAVEFORM_SAMPLE_COUNT - 1)) *
            (timeDomainData.length - 1)
        );
        const start = Math.max(0, position - 1);
        const end = Math.min(timeDomainData.length, position + 2);
        let total = 0;

        for (let sampleIndex = start; sampleIndex < end; sampleIndex++) {
          total += ((this.timeDomainData?.[sampleIndex] ?? 128) - 128) / 128;
        }

        const average = total / Math.max(1, end - start);
        const emphasized =
          Math.sign(average) *
          Math.min(1, Math.pow(Math.abs(average), 0.88) * 1.72);

        return Math.max(-1, Math.min(1, emphasized));
      }
    );
    const waveformLevels = rawWaveformLevels.map((sample, index, values) => {
      const previous = values[index - 1] ?? sample;
      const next = values[index + 1] ?? sample;
      return Math.max(
        -1,
        Math.min(1, previous * 0.2 + sample * 0.6 + next * 0.2)
      );
    });
    const waveformEnergy =
      waveformLevels.reduce((total, sample) => total + Math.abs(sample), 0) /
      Math.max(1, waveformLevels.length);
    const pulseLevel = Math.max(
      0,
      Math.min(
        1,
        (levels[0] ?? 0) * 0.42 +
          (levels[1] ?? 0) * 0.28 +
          (levels[2] ?? 0) * 0.16 +
          waveformEnergy * 0.22
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
      if (
        !this.analyserNode ||
        !this.analyserData ||
        !this.state.playing ||
        this.state.mediaType !== 'audio'
      ) {
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
              return Math.max(
                0,
                Math.min(
                  1,
                  previous * ANALYSIS_SMOOTHING +
                    level * (1 - ANALYSIS_SMOOTHING)
                )
              );
            }),
            waveformLevels: nextSpectrum.waveformLevels.map((sample, index) => {
              const previous = current.waveformLevels[index] ?? 0;
              return Math.max(
                -1,
                Math.min(
                  1,
                  previous * WAVEFORM_SMOOTHING +
                    sample * (1 - WAVEFORM_SMOOTHING)
                )
              );
            }),
            pulseLevel: Math.max(
              0,
              Math.min(
                1,
                current.pulseLevel * PULSE_SMOOTHING +
                  nextSpectrum.pulseLevel * (1 - PULSE_SMOOTHING)
              )
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

  private async activateAnalysis(requestVersion: number): Promise<void> {
    const analysisReady = await this.ensureAnalysisGraph();

    if (
      requestVersion !== this.playbackRequestVersion ||
      this.state.mediaType !== 'audio' ||
      !this.state.playing
    ) {
      return;
    }

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
    if (
      !setIntervalFn ||
      !this.currentReadingSource ||
      this.state.activeReadingSegmentIndex < 0
    ) {
      return;
    }

    this.readingProgressHandle = setIntervalFn(() => {
      if (
        !this.currentReadingSource ||
        this.state.activeReadingSegmentIndex < 0 ||
        !this.state.playing
      ) {
        return;
      }

      const segment =
        this.currentReadingSource.segments[
          this.state.activeReadingSegmentIndex
        ];
      if (!segment) {
        return;
      }

      const elapsedMs =
        this.readingSegmentOffsetMs +
        Math.max(0, this.getNow() - this.readingSegmentResumeAt);
      const currentTimeMs = Math.min(
        segment.endMs,
        segment.startMs + elapsedMs
      );
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
    restartFromBeginning = false,
    options?: { preferRemote?: boolean }
  ): Promise<void> {
    const requestVersion = this.invalidatePlaybackRequests();
    this.stopReadingForAudio();
    const playbackUrlResolution = this.resolvePlaybackAudioUrl(source, options);
    const playbackUrl =
      typeof playbackUrlResolution === 'string'
        ? playbackUrlResolution
        : await playbackUrlResolution;
    if (requestVersion !== this.playbackRequestVersion) {
      return;
    }

    let audio = this.ensureAudio();
    const switchingTrack =
      restartFromBeginning ||
      this.state.activeAudioUrl !== source.audioUrl ||
      this.state.mediaType !== 'audio' ||
      this.activePlaybackUrl !== playbackUrl;
    const activeQueueIndex = this.findQueueIndex(this.state.queue, source);

    // Stop the previous track before resolving a remote URL. Otherwise a slow
    // cache request leaves the old track audible while the UI appears idle.
    audio.pause();
    this.stopAnalysisLoop();

    if (switchingTrack) {
      const resolvedToLocalCache = playbackUrl !== source.audioUrl;
      const directRemotePlayback = /^https?:\/\//i.test(playbackUrl);
      if (directRemotePlayback && this.mediaElementSource) {
        this.replaceAudioElementForDirectPlayback();
        audio = this.ensureAudio();
      }
      this.analysisEnabledForCurrentAudio = !directRemotePlayback;
      this.directPlaybackFallbackUrl =
        resolvedToLocalCache && /^https?:\/\//i.test(source.audioUrl)
          ? source.audioUrl
          : null;
      this.playbackFallbackInProgress = false;
      if (directRemotePlayback) {
        audio.removeAttribute('crossorigin');
      } else {
        audio.crossOrigin = 'anonymous';
      }
    }

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
      duration: switchingTrack
        ? source.duration || 0
        : source.duration ||
          (Number.isFinite(audio.duration) ? audio.duration : 0),
      effectivePlaybackRate: this.state.audioPlaybackRate,
      activeReadingSourceId: undefined,
      activeReadingOrigin: undefined,
      activeReadingSegmentIndex: -1,
      readingSegments: [],
      subtitleMode: 'none',
      loading: true,
      playing: false,
      analysisAvailable: false,
      spectrumLevels: [...EMPTY_AUDIO_SPECTRUM],
      waveformLevels: [...EMPTY_AUDIO_WAVEFORM],
      pulseLevel: 0,
      error: undefined,
    });

    if (switchingTrack) {
      audio.src = playbackUrl;
      this.activePlaybackUrl = playbackUrl;
      audio.currentTime = 0;

      try {
        audio.load();
      } catch {
        // ignore
      }
    }

    audio.playbackRate = this.state.audioPlaybackRate;

    try {
      await audio.play();
    } catch (error) {
      if (requestVersion !== this.playbackRequestVersion) {
        return;
      }
      const fallbackWasAvailable = Boolean(
        this.directPlaybackFallbackUrl || this.playbackFallbackPromise
      );
      if (await this.playDirectPlaybackFallback()) {
        return;
      }
      if (!fallbackWasAvailable) {
        this.patchState({
          playing: false,
          loading: false,
          error: getPlaybackErrorMessage(error),
        });
      }
      throw error;
    }
  }

  private resolvePlaybackAudioUrl(
    source: CanvasAudioPlaybackSource,
    options?: { preferRemote?: boolean }
  ): Promise<string> | string {
    const { audioUrl } = source;
    if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
      return audioUrl;
    }

    // Remote caching is a persistence optimization, not a prerequisite for
    // playback. Start the native stream immediately and cache in the
    // background so long tracks do not block the first audible frame.
    const ext = getAudioFileExtension(audioUrl);
    const cacheKey = source.elementId?.startsWith('asset:')
      ? source.elementId
      : getAudioCacheKeySeed(audioUrl, {
          clipId: source.clipId,
          providerTaskId: source.providerTaskId,
        });
    const cachePromise = cacheRemoteUrl(
      audioUrl,
      cacheKey,
      'audio',
      ext,
      undefined,
      {
        source: source.elementId?.startsWith('asset:')
          ? 'PLAYBACK_CACHE'
          : 'AI_GENERATED',
        returnLocalCacheUrl: true,
      }
    ).catch((error) => {
      console.warn(
        '[CanvasAudioPlayback] Failed to cache remote audio:',
        error
      );
      return audioUrl;
    });

    const directPlaybackPromise = new Promise<string>((resolve) => {
      queueMicrotask(() => resolve(audioUrl));
    });
    if (options?.preferRemote) {
      return audioUrl;
    }
    return Promise.race([cachePromise, directPlaybackPromise]);
  }

  private refreshReadingSourceRate(
    source: ReadingPlaybackSource | null,
    rate: number
  ): ReadingPlaybackSource | null {
    if (!source) {
      return null;
    }

    const refreshedSource: ReadingPlaybackSource = {
      ...source,
      segments: buildReadingSubtitleSegments(source.plainText, rate),
    };
    this.currentReadingSource = refreshedSource;

    const nextQueue = this.state.queue.map((item) =>
      isReadingPlaybackSource(item) &&
      item.readingSourceId === source.readingSourceId
        ? refreshedSource
        : item
    );
    const nextDuration =
      (refreshedSource.segments[refreshedSource.segments.length - 1]?.endMs ||
        0) / 1000;
    this.patchState({
      queue: nextQueue,
      readingSegments:
        this.state.activeReadingSourceId === source.readingSourceId
          ? refreshedSource.segments
          : this.state.readingSegments,
      duration:
        this.state.activeReadingSourceId === source.readingSourceId
          ? nextDuration
          : this.state.duration,
    });
    return refreshedSource;
  }

  private createReadingUtterance(
    text: string,
    preferredLanguage: string
  ): SpeechSynthesisUtterance | null {
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
    const voice = resolveVoice(
      speechSynthesis.getVoices(),
      settings,
      preferredLanguage
    );
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

    const utterance = this.createReadingUtterance(
      segment.text,
      source.preferredLanguage
    );
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
        void this.continueQueueAfterCurrentEnd({
          mediaType: 'reading',
          sourceKey: source.readingSourceId,
          queueIndex: this.state.activeQueueIndex,
          requestVersion: sourceVersion,
        });
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
      duration:
        (source.segments[source.segments.length - 1]?.endMs || 0) / 1000,
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
    this.invalidatePlaybackRequests();
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

    this.beginReadingSegment(
      source,
      Math.max(0, Math.min(segmentIndex, source.segments.length - 1))
    );
  }

  async togglePlayback(source: CanvasAudioPlaybackSource): Promise<void> {
    const isSameTrack =
      this.state.mediaType === 'audio' &&
      this.state.activeElementId === source.elementId &&
      this.state.activeAudioUrl === source.audioUrl;

    if (isSameTrack && this.state.playing) {
      this.pausePlayback();
      return;
    }

    if (isSameTrack && this.state.loading) {
      return;
    }

    if (isSameTrack && !this.state.error) {
      await this.resumePlayback();
      return;
    }

    await this.startPlayback(source, isSameTrack);
  }

  toggleReadingPlayback(source: ReadingPlaybackSource): void {
    const isSameSource =
      this.state.mediaType === 'reading' &&
      this.state.activeReadingSourceId === source.readingSourceId;

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
          current.mediaType !== 'audio'
            ? nextRate
            : current.effectivePlaybackRate,
      }));

      if (this.state.mediaType === 'reading' && this.currentReadingSource) {
        const refreshedSource = this.refreshReadingSourceRate(
          this.currentReadingSource,
          nextRate
        );
        const nextSegmentIndex = Math.max(
          0,
          this.state.activeReadingSegmentIndex
        );
        if (this.state.playing && refreshedSource) {
          this.startReading(refreshedSource, nextSegmentIndex);
        } else {
          this.readingResumeRequiresRestart = true;
        }
      }

      void ttsSettings.update({ rate: nextRate }).catch((error) => {
        console.warn(
          '[CanvasAudioPlayback] Failed to persist reading playback rate:',
          error
        );
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
        current.mediaType !== 'reading'
          ? nextRate
          : current.effectivePlaybackRate,
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

  private async playQueueItemAt(
    index: number,
    restartFromBeginning = false,
    options?: { preferRemote?: boolean }
  ): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) {
      return;
    }

    const target = this.state.queue[index];
    if (isReadingPlaybackSource(target)) {
      this.startReading(target);
      return;
    }

    if (isAudioPlaybackSource(target)) {
      await this.startPlayback(target, restartFromBeginning, options);
    }
  }

  private async continueQueueAfterCurrentEnd(
    expectation?: PlaybackEndExpectation
  ): Promise<void> {
    if (expectation) {
      const activeVersion =
        expectation.mediaType === 'audio'
          ? this.playbackRequestVersion
          : this.readingVersion;
      if (
        activeVersion !== expectation.requestVersion ||
        this.state.mediaType !== expectation.mediaType ||
        this.state.activeQueueIndex !== expectation.queueIndex ||
        this.getActiveSourceKey() !== expectation.sourceKey
      ) {
        return;
      }
    }

    const nextIndex = this.getNextQueueIndexForAutoAdvance();
    if (nextIndex < 0) {
      return;
    }

    await this.playQueueItemAt(
      nextIndex,
      nextIndex === this.state.activeQueueIndex,
      { preferRemote: true }
    );
  }

  setCanvasQueue(queue: CanvasAudioPlaybackSource[]): void {
    const normalizedQueue = this.normalizeQueue(queue);
    this.canvasQueue = normalizedQueue;

    if (this.state.queueSource !== 'canvas') {
      return;
    }

    const activeSource = this.state.activeAudioUrl
      ? ({
          elementId: this.state.activeElementId,
          audioUrl: this.state.activeAudioUrl,
        } as CanvasAudioPlaybackSource)
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
      ? normalizedQueue.find(
          (item) => item.readingSourceId === this.state.activeReadingSourceId
        )
      : null;

    this.patchState({
      queueSource: 'reading',
      activePlaylistId: options?.queueId,
      activePlaylistName: options?.queueName,
      queue: normalizedQueue,
      activeQueueIndex: activeSource
        ? this.findQueueIndex(normalizedQueue, activeSource)
        : -1,
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
      ? ({
          elementId: this.state.activeElementId,
          audioUrl: this.state.activeAudioUrl,
        } as CanvasAudioPlaybackSource)
      : null;

    this.patchState({
      queueSource: options?.queueSource || 'canvas',
      activePlaylistId:
        options?.queueId ??
        (options?.queueSource === 'playlist' ? options.playlistId : undefined),
      activePlaylistName:
        options?.queueName ??
        (options?.queueSource === 'playlist'
          ? options.playlistName
          : undefined),
      queue: normalizedQueue,
      activeQueueIndex: activeSource
        ? this.findQueueIndex(normalizedQueue, activeSource)
        : -1,
    });
  }

  pausePlayback(): void {
    // A pause also cancels any unresolved URL/play request so it cannot start later.
    this.invalidatePlaybackRequests();

    if (this.state.mediaType === 'reading') {
      const speechSynthesis = this.getSpeechSynthesis();
      if (!speechSynthesis || this.state.activeReadingSegmentIndex < 0) {
        return;
      }

      speechSynthesis.pause();
      if (this.readingSegmentResumeAt > 0) {
        this.readingSegmentOffsetMs += Math.max(
          0,
          this.getNow() - this.readingSegmentResumeAt
        );
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
    const nextIndex =
      this.state.playbackMode === 'sequential'
        ? this.getSequentialQueueIndex(1)
        : this.getNextQueueIndexForAutoAdvance();
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

      if (
        this.state.duration > 0 &&
        this.state.currentTime >= this.state.duration - 0.05
      ) {
        this.startReading(this.currentReadingSource, 0);
        return;
      }

      if (
        this.state.activeReadingSegmentIndex < 0 ||
        this.readingResumeRequiresRestart
      ) {
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

    if (
      this.state.duration > 0 &&
      this.state.currentTime >= this.state.duration - 0.05
    ) {
      const source = this.getActiveAudioSource();
      if (source) {
        await this.startPlayback(source, true);
      }
      return;
    }

    this.audio.playbackRate = this.state.audioPlaybackRate;
    this.patchState({ loading: true, error: undefined });

    try {
      await this.audio.play();
    } catch (error) {
      this.patchState({
        playing: false,
        loading: false,
        error: getPlaybackErrorMessage(error),
      });
      throw error;
    }
  }

  async retryPlayback(): Promise<void> {
    if (this.state.mediaType === 'reading' && this.currentReadingSource) {
      this.startReading(
        this.currentReadingSource,
        Math.max(0, this.state.activeReadingSegmentIndex)
      );
      return;
    }

    if (!this.state.activeAudioUrl) {
      return;
    }

    const source = this.getActiveAudioSource();
    if (source) {
      await this.startPlayback(source, true);
    }
  }

  private getActiveAudioSource(): CanvasAudioPlaybackSource | null {
    const queuedSource =
      this.state.activeQueueIndex >= 0
        ? this.state.queue[this.state.activeQueueIndex]
        : undefined;
    if (isAudioPlaybackSource(queuedSource)) {
      return queuedSource;
    }

    if (!this.state.activeAudioUrl) {
      return null;
    }

    return {
      elementId: this.state.activeElementId,
      audioUrl: this.state.activeAudioUrl,
      title: this.state.activeTitle,
      previewImageUrl: this.state.activePreviewImageUrl,
      clipId: this.state.activeClipId,
      providerTaskId: this.state.activeProviderTaskId,
      clipIds: this.state.activeClipIds,
    };
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

    const boundedIndex = Math.max(
      0,
      Math.min(index, this.currentReadingSource.segments.length - 1)
    );
    this.startReading(this.currentReadingSource, boundedIndex);
  }

  setVolume(volume: number): void {
    const nextVolume = normalizeVolume(volume);

    persistAudioVolume(nextVolume);

    if (this.audio) {
      this.audio.volume = nextVolume;
    }

    this.patchState({
      volume: nextVolume,
    });
  }

  stopAndClear(): void {
    this.invalidatePlaybackRequests();
    this.stopAnalysisLoop();
    this.clearReadingRuntime(true);
    this.directPlaybackFallbackUrl = null;

    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.removeAttribute('src');
      this.activePlaybackUrl = null;

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

  dispose(): void {
    this.stopAndClear();
    ttsSettings.removeListener(this.handleTtsSettingsChange);

    if (this.audio) {
      this.detachAudioListeners(this.audio);
    }

    this.mediaElementSource?.disconnect();
    this.analyserNode?.disconnect();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => undefined);
    }

    this.audio = null;
    this.audioContext = null;
    this.mediaElementSource = null;
    this.analyserNode = null;
    this.analyserData = null;
    this.timeDomainData = null;
    this.listeners.clear();
  }
}

export const canvasAudioPlaybackService = new CanvasAudioPlaybackService();
