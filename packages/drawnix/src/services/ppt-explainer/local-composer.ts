export interface LocalPptSubtitleCue {
  text: string;
  speakerName?: string;
  startSeconds?: number;
  endSeconds?: number;
}

export interface LocalPptNarrationTurn {
  audio?: Blob;
  /** A same-origin video or audio URL whose audio track drives the slide. */
  mediaUrl?: string;
  /** Legacy full-turn subtitle. Prefer subtitleCues for timed short captions. */
  subtitle?: string;
  subtitleCues?: LocalPptSubtitleCue[];
  speakerName?: string;
  /** Hard playback ceiling used when the source duration is unreliable. */
  maxDurationSeconds?: number;
  /** Planned output duration. Longer source media is truncated to this value. */
  outputDurationSeconds?: number;
}

export interface LocalPptCompositionSlide {
  imageUrl: string;
  turns: LocalPptNarrationTurn[];
}

export interface LocalPptCompositionInput {
  slides: LocalPptCompositionSlide[];
  width?: number;
  height?: number;
  frameRate?: number;
  transitionDurationMs?: number;
  signal?: AbortSignal;
  /** Loads virtual/local media as a Blob when Service Worker URLs are unavailable. */
  loadMediaBlob?: (url: string, signal: AbortSignal) => Promise<Blob>;
  onProgress?: (progress: number, message: string) => void | Promise<void>;
}

export interface LocalPptCompositionResult {
  blob: Blob;
  url: string;
  mimeType: string;
  duration: number;
}

export type PptExplainerNarrationQualityReason =
  | 'decode_failed'
  | 'duration_short'
  | 'activity_unavailable'
  | 'silent'
  | 'low_coverage'
  | 'leading_silence'
  | 'trailing_silence'
  | 'long_silence';

export class PptExplainerNarrationQualityError extends Error {
  readonly code = 'PPT_NARRATION_QUALITY';

  constructor(
    message: string,
    readonly reason: PptExplainerNarrationQualityReason,
    readonly slideIndex?: number,
    readonly turnIndex?: number
  ) {
    super(message);
    this.name = 'PptExplainerNarrationQualityError';
  }
}

export function isPptExplainerNarrationQualityError(
  error: unknown
): error is PptExplainerNarrationQualityError {
  return (
    error instanceof PptExplainerNarrationQualityError ||
    (error instanceof Error &&
      (error as Error & { code?: string }).code === 'PPT_NARRATION_QUALITY')
  );
}

interface RecorderFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_TRANSITION_MS = 350;
const MAX_SUBTITLE_LINES = 2;
const AUDIO_ANALYSIS_FFT_SIZE = 256;
const AUDIO_RMS_THRESHOLD = 0.008;
const AUDIO_SAMPLE_INTERVAL_MS = 100;
const MEDIA_DURATION_TOLERANCE_SECONDS = 0.25;
const FINAL_DURATION_PROBE_TIMEOUT_MS = 10_000;
const RESOURCE_LOAD_TIMEOUT_MS = 15_000;
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 8_000;
const AUDIO_DECODE_TIMEOUT_MS = 15_000;
const MEDIA_PLAY_START_TIMEOUT_MS = 10_000;
const RECORDER_STATE_TIMEOUT_MS = 5_000;
const RECORDER_STOP_TIMEOUT_MS = 10_000;
const AUDIO_PLAYBACK_GRACE_MS = 5_000;
const AUDIO_CONTEXT_CLOSE_TIMEOUT_MS = 2_000;
const COMPOSITION_WATCHDOG_OVERHEAD_MS = 60_000;

export function chooseLocalPptRecorderFormat(
  isTypeSupported: (mimeType: string) => boolean
): RecorderFormat {
  const candidates: RecorderFormat[] = [
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
  ];
  return (
    candidates.find((candidate) => isTypeSupported(candidate.mimeType)) || {
      mimeType: '',
      extension: 'webm',
    }
  );
}

function assertLocalCompositionInput(input: LocalPptCompositionInput): void {
  if (!input.slides.length) throw new Error('PPT 本地合成没有可用页面');
  for (const [slideIndex, slide] of input.slides.entries()) {
    if (!slide.imageUrl.trim()) {
      throw new Error(`PPT 第 ${slideIndex + 1} 页缺少页面快照`);
    }
    if (!slide.turns.length) {
      throw new Error(`PPT 第 ${slideIndex + 1} 页缺少旁白音频`);
    }
    for (const turn of slide.turns) {
      const hasAudio = turn.audio !== undefined;
      const mediaUrl = turn.mediaUrl?.trim();
      if (hasAudio === Boolean(mediaUrl)) {
        throw new Error(
          `PPT 第 ${slideIndex + 1} 页旁白来源必须且只能配置一种`
        );
      }
      if (
        hasAudio &&
        (!(turn.audio instanceof Blob) || turn.audio.size === 0)
      ) {
        throw new Error(`PPT 第 ${slideIndex + 1} 页包含空旁白音频`);
      }
      for (const field of [
        'maxDurationSeconds',
        'outputDurationSeconds',
      ] as const) {
        const value = turn[field];
        if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
          throw new Error(`PPT 第 ${slideIndex + 1} 页旁白时长无效`);
        }
      }
      for (const cue of turn.subtitleCues || []) {
        if (!cue.text?.trim()) {
          throw new Error(`PPT 第 ${slideIndex + 1} 页包含空字幕`);
        }
        if (
          (cue.startSeconds !== undefined &&
            (!Number.isFinite(cue.startSeconds) || cue.startSeconds < 0)) ||
          (cue.endSeconds !== undefined &&
            (!Number.isFinite(cue.endSeconds) || cue.endSeconds <= 0)) ||
          (cue.startSeconds !== undefined &&
            cue.endSeconds !== undefined &&
            cue.endSeconds <= cue.startSeconds)
        ) {
          throw new Error(`PPT 第 ${slideIndex + 1} 页字幕时间无效`);
        }
      }
      const timedCues = (turn.subtitleCues || []).filter(
        (cue) => cue.startSeconds !== undefined || cue.endSeconds !== undefined
      );
      if (
        timedCues.some(
          (cue) =>
            cue.startSeconds === undefined || cue.endSeconds === undefined
        )
      ) {
        throw new Error(`PPT 第 ${slideIndex + 1} 页字幕时间必须完整配置`);
      }
      for (let cueIndex = 1; cueIndex < timedCues.length; cueIndex += 1) {
        if (
          (timedCues[cueIndex].startSeconds || 0) <
          (timedCues[cueIndex - 1].endSeconds || 0)
        ) {
          throw new Error(`PPT 第 ${slideIndex + 1} 页字幕时间存在重叠`);
        }
      }
    }
  }
}

function loadImage(
  url: string,
  signal?: AbortSignal
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timeoutId = setTimeout(() => {
      cleanup();
      image.src = '';
      reject(new Error('加载 PPT 页面快照超过 15 秒，请保持页面在前台后重试'));
    }, RESOURCE_LOAD_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = '';
      reject(getCompositionAbortReason(signal));
    };
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('无法加载 PPT 页面快照，可能被跨域策略阻止'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = url;
  });
}

interface LoadedImage {
  image: HTMLImageElement;
  dispose: () => void;
}

async function loadCompositionImage(
  url: string,
  loadMediaBlob: LocalPptCompositionInput['loadMediaBlob'],
  signal?: AbortSignal
): Promise<LoadedImage> {
  if (!loadMediaBlob) {
    return { image: await loadImage(url, signal), dispose: () => undefined };
  }

  const blob = await waitForAbortable(
    loadMediaBlob(url, signal || new AbortController().signal),
    signal,
    RESOURCE_LOAD_TIMEOUT_MS,
    '读取 PPT 页面快照超过 15 秒，请保持页面在前台后重试'
  );
  signal?.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl, signal);
    return {
      image,
      dispose: () => {
        if (typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(objectUrl);
        }
      },
    };
  } catch (error) {
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
    throw error;
  }
}

function resolveSubtitleCue(
  turn: LocalPptNarrationTurn | undefined,
  currentTime = 0,
  duration = 0
): LocalPptSubtitleCue | undefined {
  if (!turn) return undefined;
  const cues = turn.subtitleCues?.filter((cue) => cue.text.trim()) || [];
  if (cues.length) {
    const hasTimedCue = cues.some(
      (cue) => cue.startSeconds !== undefined || cue.endSeconds !== undefined
    );
    if (hasTimedCue) {
      return cues.find((cue) => {
        const start = cue.startSeconds ?? 0;
        const end = cue.endSeconds ?? Number.POSITIVE_INFINITY;
        return currentTime >= start && currentTime < end;
      });
    }
    const safeDuration =
      duration > 0 ? duration : turn.outputDurationSeconds || 0;
    const index =
      safeDuration > 0
        ? Math.min(
            cues.length - 1,
            Math.floor((currentTime / safeDuration) * cues.length)
          )
        : 0;
    return cues[index];
  }
  const subtitle = turn.subtitle?.trim();
  return subtitle
    ? { text: subtitle, speakerName: turn.speakerName }
    : undefined;
}

function drawSlide(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  turn?: LocalPptNarrationTurn,
  opacity = 1,
  currentTime = 0,
  duration = 0
): void {
  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.restore();

  const cue = resolveSubtitleCue(turn, currentTime, duration);
  if (!cue) return;
  const speaker = cue.speakerName?.trim() || turn?.speakerName?.trim();
  const text = speaker ? `${speaker}：${cue.text.trim()}` : cue.text.trim();
  const fontSize = Math.max(28, Math.round(canvas.height * 0.038));
  const horizontalPadding = Math.round(canvas.width * 0.06);
  const verticalPadding = Math.round(canvas.height * 0.025);
  context.font = `${fontSize}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const maxWidth = canvas.width - horizontalPadding * 2;
  const words = Array.from(text);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = `${current}${word}`;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const visibleLines = lines.slice(0, MAX_SUBTITLE_LINES);
  if (lines.length > MAX_SUBTITLE_LINES) {
    const lastIndex = visibleLines.length - 1;
    const lastLine = visibleLines[lastIndex];
    visibleLines[lastIndex] = `${lastLine.slice(
      0,
      Math.max(1, lastLine.length - 1)
    )}…`;
  }
  const lineHeight = Math.round(fontSize * 1.35);
  const boxHeight = visibleLines.length * lineHeight + verticalPadding * 2;
  const boxY = canvas.height - boxHeight - Math.round(canvas.height * 0.045);
  context.fillStyle = 'rgba(0, 0, 0, 0.68)';
  context.fillRect(0, boxY, canvas.width, boxHeight);
  context.fillStyle = '#fff';
  visibleLines.forEach((line, index) => {
    context.fillText(
      line,
      canvas.width / 2,
      boxY + verticalPadding + lineHeight * (index + 0.5),
      maxWidth
    );
  });
}

function getCompositionAbortReason(signal?: AbortSignal): unknown {
  return signal?.reason || new DOMException('PPT 本地合成已取消', 'AbortError');
}

function waitForAbortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  timeoutMs?: number,
  timeoutMessage = 'PPT 本地合成等待超时'
): Promise<T> {
  if (!signal && timeoutMs === undefined) return operation;
  signal?.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => finish(() => reject(new Error(timeoutMessage))),
            timeoutMs
          );
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() => reject(getCompositionAbortReason(signal)));
    signal?.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
}

function waitForRecorderStateChange(
  recorder: MediaRecorder,
  eventName: 'pause' | 'resume',
  expectedState: RecordingState,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  if (recorder.state === expectedState) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const action = eventName === 'pause' ? '暂停' : '恢复';
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`${action} PPT 视频录制超过 5 秒，请刷新页面后重试`));
    }, RECORDER_STATE_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeoutId);
      recorder.removeEventListener(eventName, onStateChange);
      signal?.removeEventListener('abort', onAbort);
    };
    const onStateChange = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(getCompositionAbortReason(signal));
    };
    recorder.addEventListener(eventName, onStateChange, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function setRecorderCapturing(
  recorder: MediaRecorder,
  capturing: boolean,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  if (capturing) {
    if (recorder.state === 'recording') return;
    if (recorder.state !== 'paused') {
      throw new Error('PPT 录制器无法恢复讲解录制');
    }
    const resumed = waitForRecorderStateChange(
      recorder,
      'resume',
      'recording',
      signal
    );
    recorder.resume();
    await resumed;
    return;
  }
  if (recorder.state === 'paused') return;
  if (recorder.state !== 'recording') {
    throw new Error('PPT 录制器无法暂停准备阶段');
  }
  const paused = waitForRecorderStateChange(
    recorder,
    'pause',
    'paused',
    signal
  );
  recorder.pause();
  await paused;
}

function waitForAnimationFrame(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    let frameId = 0;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (frameId) cancelAnimationFrame(frameId);
      cleanup();
      reject(getCompositionAbortReason(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    frameId = requestAnimationFrame(() => {
      cleanup();
      resolve();
    });
  });
}

interface AudioActivitySummary {
  samples: number;
  audibleSamples: number;
  firstAudibleSeconds?: number;
  lastAudibleSeconds?: number;
  maxSilentGapSeconds?: number;
}

class BoundedAudioActivityMonitor {
  private readonly samples: Float32Array;
  private sampleCount = 0;
  private audibleSampleCount = 0;
  private firstAudibleSeconds: number | undefined;
  private lastAudibleSeconds: number | undefined;
  private silentGapStartedSeconds = 0;
  private maxSilentGapSeconds = 0;

  constructor(private readonly analyser: AnalyserNode) {
    this.samples = new Float32Array(analyser.fftSize);
  }

  sample(currentTime: number): void {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sumSquares = 0;
    for (let index = 0; index < this.samples.length; index += 1) {
      const value = this.samples[index];
      sumSquares += value * value;
    }
    this.sampleCount += 1;
    if (Math.sqrt(sumSquares / this.samples.length) >= AUDIO_RMS_THRESHOLD) {
      this.audibleSampleCount += 1;
      this.firstAudibleSeconds ??= currentTime;
      this.lastAudibleSeconds = currentTime;
      this.maxSilentGapSeconds = Math.max(
        this.maxSilentGapSeconds,
        currentTime - this.silentGapStartedSeconds
      );
      this.silentGapStartedSeconds = currentTime;
    } else if (this.lastAudibleSeconds !== undefined) {
      this.silentGapStartedSeconds = Math.max(
        this.silentGapStartedSeconds,
        this.lastAudibleSeconds
      );
    }
  }

  getSummary(): AudioActivitySummary {
    return {
      samples: this.sampleCount,
      audibleSamples: this.audibleSampleCount,
      firstAudibleSeconds: this.firstAudibleSeconds,
      lastAudibleSeconds: this.lastAudibleSeconds,
      maxSilentGapSeconds: this.maxSilentGapSeconds,
    };
  }
}

function getTurnDurationLimit(turn: LocalPptNarrationTurn): number | undefined {
  const values = [turn.outputDurationSeconds, turn.maxDurationSeconds].filter(
    (value): value is number => value !== undefined
  );
  return values.length ? Math.min(...values) : undefined;
}

function assertMediaCoversPlannedDuration(
  sourceDuration: number,
  plannedDuration?: number
): void {
  if (
    plannedDuration === undefined ||
    sourceDuration + MEDIA_DURATION_TOLERANCE_SECONDS >= plannedDuration
  ) {
    return;
  }
  throw new PptExplainerNarrationQualityError(
    `讲解片段仅有 ${sourceDuration.toFixed(
      1
    )} 秒，无法覆盖计划的 ${plannedDuration.toFixed(1)} 秒`,
    'duration_short'
  );
}

function validateAudioActivity(
  summary: AudioActivitySummary,
  duration: number
): void {
  if (duration < 1) return;
  const minimumSamples = duration >= 4 ? 2 : 1;
  if (summary.samples < minimumSamples) {
    throw new PptExplainerNarrationQualityError(
      '讲解片段无法检测声音活动，请重试或更换视频模型',
      'activity_unavailable'
    );
  }
  if (summary.audibleSamples === 0) {
    throw new PptExplainerNarrationQualityError(
      '讲解片段没有检测到有效声音，请更换支持有声视频的模型',
      'silent'
    );
  }
  if (
    duration >= 4 &&
    summary.samples >= 10 &&
    summary.audibleSamples / summary.samples < 0.2
  ) {
    throw new PptExplainerNarrationQualityError(
      '讲解片段有效声音占比过低，请更换支持稳定语音的视频模型',
      'low_coverage'
    );
  }
  if (
    duration >= 4 &&
    (summary.firstAudibleSeconds === undefined ||
      summary.firstAudibleSeconds > Math.min(1, duration * 0.15))
  ) {
    throw new PptExplainerNarrationQualityError(
      '讲解片段前导静音过长，请更换支持稳定语音的视频模型',
      'leading_silence'
    );
  }
  if (
    duration >= 4 &&
    summary.samples >= 10 &&
    (summary.lastAudibleSeconds === undefined ||
      duration - summary.lastAudibleSeconds > Math.min(1, duration * 0.15))
  ) {
    throw new PptExplainerNarrationQualityError(
      '讲解片段尾部静音过长，请更换支持稳定语音的视频模型',
      'trailing_silence'
    );
  }
  if (
    duration >= 4 &&
    summary.samples >= 10 &&
    (summary.maxSilentGapSeconds || 0) > Math.min(2, duration * 0.35)
  ) {
    throw new PptExplainerNarrationQualityError(
      '讲解片段连续静音过长，请更换支持稳定语音的视频模型',
      'long_silence'
    );
  }
}

function getFinalDurationTolerance(expectedDuration: number): number {
  return Math.max(0.75, Math.min(3, expectedDuration * 0.02));
}

function assertFinalDurationMatches(
  actualDuration: number,
  expectedDuration: number
): void {
  if (!Number.isFinite(actualDuration) || actualDuration <= 0) {
    throw new Error('无法读取 PPT 讲解成片的真实时长');
  }
  const tolerance = getFinalDurationTolerance(expectedDuration);
  if (Math.abs(actualDuration - expectedDuration) <= tolerance) return;
  throw new Error(
    `PPT 讲解成片实际 ${actualDuration.toFixed(
      1
    )} 秒，与计划 ${expectedDuration.toFixed(1)} 秒不一致`
  );
}

async function readRecordedMediaDuration(
  url: string,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  const media = document.createElement('video');
  media.preload = 'metadata';
  media.muted = true;
  media.playsInline = true;
  media.style.display = 'none';
  document.body?.appendChild(media);

  try {
    return await new Promise<number>((resolve, reject) => {
      let settled = false;
      let attemptedDurationSeek = false;
      const timeoutId = setTimeout(
        () => finish(() => reject(new Error('读取 PPT 讲解成片时长超时'))),
        FINAL_DURATION_PROBE_TIMEOUT_MS
      );
      const cleanup = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        media.removeEventListener('loadedmetadata', onMetadata);
        media.removeEventListener('durationchange', onMetadata);
        media.removeEventListener('error', onError);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = () =>
        finish(() => reject(getCompositionAbortReason(signal)));
      const onError = () =>
        finish(() => reject(new Error('无法读取 PPT 讲解成片的媒体信息')));
      const onMetadata = () => {
        if (Number.isFinite(media.duration) && media.duration > 0) {
          finish(() => resolve(media.duration));
          return;
        }
        if (
          media.duration === Number.POSITIVE_INFINITY &&
          !attemptedDurationSeek
        ) {
          attemptedDurationSeek = true;
          try {
            media.currentTime = Number.MAX_SAFE_INTEGER;
          } catch {
            finish(() => reject(new Error('无法读取 PPT 讲解成片的真实时长')));
          }
        }
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      media.addEventListener('loadedmetadata', onMetadata);
      media.addEventListener('durationchange', onMetadata);
      media.addEventListener('error', onError, { once: true });
      media.src = url;
      media.load();
    });
  } finally {
    media.pause();
    media.removeAttribute('src');
    media.load();
    media.remove();
  }
}

interface RecordingGate {
  startPlayback: () => Promise<void>;
  finishPlayback: () => Promise<void>;
}

function startPlaybackFrameLoop(options: {
  getCurrentTime: () => number;
  getDuration: () => number;
  monitor: BoundedAudioActivityMonitor;
  onFrame: (currentTime: number, duration: number) => void;
}): () => void {
  let stopped = false;
  let frameId: number | undefined;
  const sample = () => {
    const currentTime = Math.max(0, options.getCurrentTime());
    options.monitor.sample(currentTime);
  };
  const draw = () => {
    if (stopped) return;
    const currentTime = Math.max(0, options.getCurrentTime());
    const duration = Math.max(0, options.getDuration());
    options.onFrame(currentTime, duration);
    if (typeof requestAnimationFrame === 'function') {
      frameId = requestAnimationFrame(draw);
    }
  };
  sample();
  const sampleTimerId = setInterval(sample, AUDIO_SAMPLE_INTERVAL_MS);
  draw();
  return () => {
    stopped = true;
    clearInterval(sampleTimerId);
    if (frameId !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameId);
    }
  };
}

function requestCapturedFrame(track?: MediaStreamTrack): void {
  const captureTrack = track as MediaStreamTrack & {
    requestFrame?: () => void;
  };
  captureTrack?.requestFrame?.();
}

async function drawTransition(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  durationMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (durationMs <= 0) {
    drawSlide(context, canvas, image);
    return;
  }
  const startedAt = performance.now();
  let progress = 0;
  while (progress < 1) {
    signal?.throwIfAborted();
    const elapsed = performance.now() - startedAt;
    progress = Math.min(1, elapsed / durationMs);
    drawSlide(context, canvas, image, undefined, progress);
    if (progress < 1) {
      await waitForAnimationFrame(signal);
    }
  }
}

async function playAudioBuffer(
  audioContext: AudioContext,
  analyser: AnalyserNode,
  blob: Blob,
  turn: LocalPptNarrationTurn,
  onFrame: (currentTime: number, duration: number) => void,
  recordingGate: RecordingGate,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  const bytes =
    typeof blob.arrayBuffer === 'function'
      ? await waitForAbortable(
          blob.arrayBuffer(),
          signal,
          RESOURCE_LOAD_TIMEOUT_MS,
          '读取 PPT 讲解音轨超过 15 秒，请重试'
        )
      : await waitForAbortable(
          new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(blob);
          }),
          signal,
          RESOURCE_LOAD_TIMEOUT_MS,
          '读取 PPT 讲解音轨超过 15 秒，请重试'
        );
  signal?.throwIfAborted();
  let buffer: AudioBuffer;
  try {
    buffer = await waitForAbortable(
      audioContext.decodeAudioData(bytes),
      signal,
      AUDIO_DECODE_TIMEOUT_MS,
      '解码 PPT 讲解音轨超过 15 秒，请重试或更换视频模型'
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('解码 PPT 讲解音轨超过')
    ) {
      throw error;
    }
    throw new PptExplainerNarrationQualityError(
      `讲解片段无法解码${
        error instanceof Error && error.message ? `：${error.message}` : ''
      }`,
      'decode_failed'
    );
  }
  signal?.throwIfAborted();

  const durationLimit = getTurnDurationLimit(turn);
  assertMediaCoversPlannedDuration(buffer.duration, turn.outputDurationSeconds);
  const playbackDuration = Math.min(
    buffer.duration,
    durationLimit ?? buffer.duration
  );
  await recordingGate.startPlayback();
  try {
    const result = await new Promise<number>((resolve, reject) => {
      const source = audioContext.createBufferSource();
      const startedAt = audioContext.currentTime;
      const monitor = new BoundedAudioActivityMonitor(analyser);
      let settled = false;
      let stopFrameLoop: (() => void) | undefined;
      const playbackTimeoutId = setTimeout(() => {
        finish(() => {
          try {
            source.stop();
          } catch {
            // The source may have ended while the timeout was handled.
          }
          reject(
            new Error(
              `播放 PPT 讲解音轨超过预计 ${playbackDuration.toFixed(
                1
              )} 秒，请保持页面在前台后重试`
            )
          );
        });
      }, playbackDuration * 1000 + AUDIO_PLAYBACK_GRACE_MS);
      const cleanup = () => {
        clearTimeout(playbackTimeoutId);
        signal?.removeEventListener('abort', onAbort);
        stopFrameLoop?.();
        source.onended = null;
        source.buffer = null;
        try {
          source.disconnect();
        } catch {
          // The source may already be disconnected after ending.
        }
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = () => {
        try {
          source.stop();
        } catch {
          // Stopping an already-ended source is harmless.
        }
        finish(() => reject(getCompositionAbortReason(signal)));
      };
      source.buffer = buffer;
      source.connect(analyser);
      source.onended = () => {
        monitor.sample(playbackDuration);
        const summary = monitor.getSummary();
        finish(() => {
          try {
            validateAudioActivity(summary, playbackDuration);
            resolve(playbackDuration);
          } catch (error) {
            reject(error);
          }
        });
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        stopFrameLoop = startPlaybackFrameLoop({
          getCurrentTime: () =>
            Math.min(playbackDuration, audioContext.currentTime - startedAt),
          getDuration: () => playbackDuration,
          monitor,
          onFrame,
        });
        source.start(0, 0, playbackDuration);
      } catch (error) {
        finish(() => reject(error));
      }
    });
    await recordingGate.finishPlayback();
    return result;
  } catch (error) {
    await recordingGate.finishPlayback().catch(() => undefined);
    throw error;
  }
}

async function playMediaElementAudio(
  audioContext: AudioContext,
  analyser: AnalyserNode,
  mediaUrl: string,
  turn: LocalPptNarrationTurn,
  onFrame: (currentTime: number, duration: number) => void,
  recordingGate: RecordingGate,
  loadMediaBlob: LocalPptCompositionInput['loadMediaBlob'],
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  let objectUrl: string | undefined;
  if (loadMediaBlob) {
    const blob = await waitForAbortable(
      loadMediaBlob(mediaUrl, signal || new AbortController().signal),
      signal,
      RESOURCE_LOAD_TIMEOUT_MS,
      '读取 PPT 讲解片段超过 15 秒，请重试'
    );
    signal?.throwIfAborted();
    objectUrl = URL.createObjectURL(blob);
  }
  const media = document.createElement('video');
  media.crossOrigin = 'anonymous';
  media.preload = 'auto';
  media.playsInline = true;
  media.style.display = 'none';
  let source: MediaElementAudioSourceNode | undefined;
  try {
    source = audioContext.createMediaElementSource(media);
    source.connect(analyser);
    document.body?.appendChild(media);
  } catch (error) {
    try {
      source?.disconnect();
    } catch {
      // The partially initialized node may not be connected.
    }
    media.removeAttribute('src');
    media.remove();
    if (objectUrl && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
    throw error;
  }

  try {
    const result = await new Promise<number>((resolve, reject) => {
      let settled = false;
      let started = false;
      let stopFrameLoop: (() => void) | undefined;
      let monitor: BoundedAudioActivityMonitor | undefined;
      let playbackDuration = 0;
      let durationTimer: ReturnType<typeof setTimeout> | undefined;
      const loadTimeoutId = setTimeout(
        () =>
          fail(
            new Error('加载 PPT 讲解音轨超过 15 秒，请保持页面在前台后重试')
          ),
        RESOURCE_LOAD_TIMEOUT_MS
      );
      const cleanup = () => {
        clearTimeout(loadTimeoutId);
        signal?.removeEventListener('abort', onAbort);
        media.removeEventListener('canplay', onCanPlay);
        media.removeEventListener('ended', onEnded);
        media.removeEventListener('error', onError);
        stopFrameLoop?.();
        if (durationTimer !== undefined) clearTimeout(durationTimer);
        media.pause();
        media.removeAttribute('src');
        media.load();
        media.remove();
        if (objectUrl && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(objectUrl);
        }
        try {
          source.disconnect();
        } catch {
          // The node may already be disconnected while handling an abort.
        }
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const fail = (error: unknown) =>
        finish(() =>
          reject(
            error instanceof Error || error instanceof DOMException
              ? error
              : new Error(String(error))
          )
        );
      const onAbort = () => fail(getCompositionAbortReason(signal));
      const onEnded = () => {
        const sourceDuration =
          Number.isFinite(media.duration) && media.duration > 0
            ? media.duration
            : media.currentTime;
        const duration = playbackDuration || sourceDuration;
        monitor?.sample(Math.min(duration, media.currentTime));
        const summary = monitor?.getSummary();
        finish(() => {
          try {
            if (summary) validateAudioActivity(summary, duration);
            resolve(duration);
          } catch (error) {
            reject(error);
          }
        });
      };
      const onError = () =>
        fail(
          new PptExplainerNarrationQualityError(
            `讲解片段无法解码或播放${
              media.error?.message ? `：${media.error.message}` : ''
            }`,
            'decode_failed'
          )
        );
      const onCanPlay = () => {
        if (started || settled) return;
        started = true;
        clearTimeout(loadTimeoutId);
        const sourceDuration =
          Number.isFinite(media.duration) && media.duration > 0
            ? media.duration
            : 0;
        const durationLimit = getTurnDurationLimit(turn);
        try {
          assertMediaCoversPlannedDuration(
            sourceDuration,
            turn.outputDurationSeconds
          );
        } catch (error) {
          fail(error);
          return;
        }
        playbackDuration = durationLimit
          ? sourceDuration > 0
            ? Math.min(sourceDuration, durationLimit)
            : durationLimit
          : sourceDuration;
        void waitForAbortable(
          media.play().catch((error) => {
            throw new Error(
              `浏览器无法播放讲解音轨：${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }),
          signal,
          MEDIA_PLAY_START_TIMEOUT_MS,
          '启动 PPT 讲解音轨超过 10 秒，请保持页面在前台后重试'
        )
          .then(() => recordingGate.startPlayback())
          .then(() => {
            if (settled) return;
            // The play() handshake is intentionally excluded from recording.
            // Restart from zero after the recorder resumes so narration is complete.
            media.currentTime = 0;
            if (durationLimit !== undefined) {
              durationTimer = setTimeout(onEnded, durationLimit * 1000);
            }
            monitor = new BoundedAudioActivityMonitor(analyser);
            stopFrameLoop = startPlaybackFrameLoop({
              getCurrentTime: () => media.currentTime,
              getDuration: () => playbackDuration || media.duration || 0,
              monitor,
              onFrame: (currentTime, duration) => {
                onFrame(currentTime, duration);
                if (
                  durationLimit !== undefined &&
                  currentTime >= durationLimit &&
                  !settled
                ) {
                  onEnded();
                }
              },
            });
          })
          .catch(fail);
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      media.addEventListener('canplay', onCanPlay);
      media.addEventListener('ended', onEnded, { once: true });
      media.addEventListener('error', onError, { once: true });
      media.src = objectUrl || mediaUrl;
      media.load();
    });
    await recordingGate.finishPlayback();
    return result;
  } catch (error) {
    await recordingGate.finishPlayback().catch(() => undefined);
    throw error;
  }
}

function playNarrationTurn(
  audioContext: AudioContext,
  analyser: AnalyserNode,
  turn: LocalPptNarrationTurn,
  onFrame: (currentTime: number, duration: number) => void,
  recordingGate: RecordingGate,
  loadMediaBlob: LocalPptCompositionInput['loadMediaBlob'],
  signal?: AbortSignal
): Promise<number> {
  if (turn.audio) {
    return playAudioBuffer(
      audioContext,
      analyser,
      turn.audio,
      turn,
      onFrame,
      recordingGate,
      signal
    );
  }
  if (turn.mediaUrl?.trim()) {
    return playMediaElementAudio(
      audioContext,
      analyser,
      turn.mediaUrl,
      turn,
      onFrame,
      recordingGate,
      loadMediaBlob,
      signal
    );
  }
  throw new Error('PPT 旁白来源无效');
}

function getPlannedCompositionDuration(
  input: LocalPptCompositionInput
): number | undefined {
  let duration = 0;
  for (const slide of input.slides) {
    for (const turn of slide.turns) {
      const turnDuration = getTurnDurationLimit(turn);
      if (turnDuration === undefined) return undefined;
      duration += turnDuration;
    }
  }
  return duration > 0 ? duration : undefined;
}

function getCompositionWatchdogTimeoutMs(expectedDuration: number): number {
  return (
    expectedDuration * 1000 +
    Math.max(COMPOSITION_WATCHDOG_OVERHEAD_MS, expectedDuration * 1000 * 0.25)
  );
}

export async function composeLocalPptExplainerVideo(
  input: LocalPptCompositionInput
): Promise<LocalPptCompositionResult> {
  assertLocalCompositionInput(input);
  input.signal?.throwIfAborted();
  if (
    typeof document === 'undefined' ||
    typeof MediaRecorder === 'undefined' ||
    typeof AudioContext === 'undefined'
  ) {
    throw new Error('当前浏览器不支持 PPT 本地音视频合成');
  }

  const canvas = document.createElement('canvas');
  canvas.width = input.width || DEFAULT_WIDTH;
  canvas.height = input.height || DEFAULT_HEIGHT;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建 PPT 合成画布');

  const format = chooseLocalPptRecorderFormat(MediaRecorder.isTypeSupported);
  const audioContext = new AudioContext();
  const compositionController = new AbortController();
  const abortFromInput = () =>
    compositionController.abort(getCompositionAbortReason(input.signal));
  input.signal?.addEventListener('abort', abortFromInput, { once: true });
  const signal = compositionController.signal;
  const plannedDuration = getPlannedCompositionDuration(input);
  const watchdogTimeoutMs = plannedDuration
    ? getCompositionWatchdogTimeoutMs(plannedDuration)
    : undefined;
  const watchdogId =
    watchdogTimeoutMs === undefined
      ? undefined
      : setTimeout(
          () =>
            compositionController.abort(
              new Error(
                `PPT 本地合成超过预计 ${Math.ceil(
                  watchdogTimeoutMs / 1000
                )} 秒，请保持页面在前台后重试`
              )
            ),
          watchdogTimeoutMs
        );
  let destination: MediaStreamAudioDestinationNode | undefined;
  let analyser: AnalyserNode | undefined;
  let canvasStream: MediaStream | undefined;
  let combinedStream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let recorderStopped: Promise<void> | undefined;
  let recorderFailure: Promise<never> | undefined;
  const chunks: Blob[] = [];

  let duration = 0;
  let createdUrl = '';
  let activeImage: HTMLImageElement | undefined;
  let activeImageDispose: (() => void) | undefined;
  try {
    destination = audioContext.createMediaStreamDestination();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = AUDIO_ANALYSIS_FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    analyser.connect(destination);
    canvasStream = canvas.captureStream(input.frameRate || DEFAULT_FRAME_RATE);
    const capturedVideoTrack = canvasStream.getVideoTracks()[0];
    combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    recorder = new MediaRecorder(combinedStream, {
      ...(format.mimeType ? { mimeType: format.mimeType } : {}),
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 128_000,
    });
    const activeRecorder = recorder;
    activeRecorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorderStopped = new Promise<void>((resolve) => {
      activeRecorder.onstop = () => resolve();
    });
    recorderFailure = new Promise<never>((_, reject) => {
      activeRecorder.onerror = (event) => {
        const error =
          event instanceof ErrorEvent && event.error instanceof Error
            ? event.error
            : new Error('视频录制失败');
        compositionController.abort(error);
        reject(error);
      };
    });
    void recorderFailure.catch(() => undefined);

    await waitForAbortable(
      audioContext.resume(),
      signal,
      AUDIO_CONTEXT_RESUME_TIMEOUT_MS,
      '浏览器未能启动讲解音频，请保持页面在前台并点击页面后重试'
    );
    let activeImageLoad = await loadCompositionImage(
      input.slides[0].imageUrl,
      input.loadMediaBlob,
      signal
    );
    activeImageDispose = activeImageLoad.dispose;
    const firstImage = activeImageLoad.image;
    activeImage = firstImage;
    drawSlide(context, canvas, firstImage, input.slides[0].turns[0]);
    requestCapturedFrame(capturedVideoTrack);
    activeRecorder.start(1000);
    const activeRecorderFailure = recorderFailure;
    const waitWhileRecording = <T>(operation: Promise<T>) =>
      Promise.race([operation, activeRecorderFailure]);
    await waitWhileRecording(
      setRecorderCapturing(activeRecorder, false, signal)
    );
    const recordingGate: RecordingGate = {
      startPlayback: () =>
        waitWhileRecording(setRecorderCapturing(activeRecorder, true, signal)),
      finishPlayback: () =>
        waitWhileRecording(setRecorderCapturing(activeRecorder, false, signal)),
    };
    let completedTurns = 0;
    const totalTurns = input.slides.reduce(
      (sum, slide) => sum + slide.turns.length,
      0
    );
    for (const [slideIndex, slide] of input.slides.entries()) {
      signal.throwIfAborted();
      if (slideIndex > 0) {
        activeImageLoad = await waitWhileRecording(
          loadCompositionImage(slide.imageUrl, input.loadMediaBlob, signal)
        );
        activeImageDispose = activeImageLoad.dispose;
      }
      const image = activeImageLoad.image;
      activeImage = image;
      try {
        if (slideIndex > 0) {
          await waitWhileRecording(
            drawTransition(
              context,
              canvas,
              image,
              input.transitionDurationMs ?? DEFAULT_TRANSITION_MS,
              signal
            )
          );
        }
        for (const [turnIndex, turn] of slide.turns.entries()) {
          const turnDuration = getTurnDurationLimit(turn);
          await waitWhileRecording(
            waitForAbortable(
              Promise.resolve(
                input.onProgress?.(
                  Math.round((completedTurns / totalTurns) * 100),
                  `实时录制 ${slideIndex + 1}/${input.slides.length} 页 · ${
                    turnIndex + 1
                  }/${slide.turns.length} 段${
                    turnDuration ? ` · 约 ${Math.ceil(turnDuration)} 秒` : ''
                  }`
                )
              ),
              signal
            )
          );
          drawSlide(context, canvas, image, turn);
          try {
            duration += await waitWhileRecording(
              playNarrationTurn(
                audioContext,
                analyser,
                turn,
                (currentTime, turnDuration) => {
                  drawSlide(
                    context,
                    canvas,
                    image,
                    turn,
                    1,
                    currentTime,
                    turnDuration
                  );
                  requestCapturedFrame(capturedVideoTrack);
                },
                recordingGate,
                input.loadMediaBlob,
                signal
              )
            );
          } catch (error) {
            if (isPptExplainerNarrationQualityError(error)) {
              throw new PptExplainerNarrationQualityError(
                error.message,
                error.reason,
                slideIndex,
                turnIndex
              );
            }
            throw error;
          }
          completedTurns += 1;
          await waitWhileRecording(
            waitForAbortable(
              Promise.resolve(
                input.onProgress?.(
                  Math.round((completedTurns / totalTurns) * 100),
                  `已完成 ${slideIndex + 1}/${input.slides.length} 页 · ${
                    turnIndex + 1
                  }/${slide.turns.length} 段`
                )
              ),
              signal
            )
          );
        }
      } finally {
        image.src = '';
        activeImageDispose?.();
        activeImageDispose = undefined;
        if (activeImage === image) activeImage = undefined;
      }
    }

    await waitWhileRecording(
      waitForAbortable(
        Promise.resolve(input.onProgress?.(100, '正在校验 PPT 讲解成片')),
        signal
      )
    );
    activeRecorder.stop();
    await waitForAbortable(
      Promise.race([recorderStopped, activeRecorderFailure]),
      signal,
      RECORDER_STOP_TIMEOUT_MS,
      '停止 PPT 视频录制超过 10 秒，请刷新页面后重试'
    );
    signal.throwIfAborted();
    const mimeType =
      recorder.mimeType || format.mimeType || chunks[0]?.type || 'video/webm';
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error('PPT 本地合成未产生视频数据');
    createdUrl = URL.createObjectURL(blob);
    const actualDuration = await readRecordedMediaDuration(createdUrl, signal);
    assertFinalDurationMatches(actualDuration, duration);
    return { blob, url: createdUrl, mimeType, duration: actualDuration };
  } catch (error) {
    if (!compositionController.signal.aborted) {
      compositionController.abort(error);
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      if (recorderStopped) {
        await waitForAbortable(
          recorderStopped,
          undefined,
          RECORDER_STOP_TIMEOUT_MS,
          '停止 PPT 视频录制超时'
        ).catch(() => undefined);
      }
    }
    if (createdUrl) URL.revokeObjectURL(createdUrl);
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', abortFromInput);
    if (watchdogId !== undefined) clearTimeout(watchdogId);
    if (activeImage) activeImage.src = '';
    activeImageDispose?.();
    if (combinedStream) {
      combinedStream.getTracks().forEach((track) => track.stop());
    } else {
      canvasStream?.getTracks().forEach((track) => track.stop());
      destination?.stream.getTracks().forEach((track) => track.stop());
    }
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    try {
      analyser?.disconnect();
    } catch {
      // The analyser may already be disconnected during browser teardown.
    }
    await waitForAbortable(
      audioContext.close(),
      undefined,
      AUDIO_CONTEXT_CLOSE_TIMEOUT_MS,
      '关闭 PPT 音频上下文超时'
    ).catch(() => undefined);
    chunks.length = 0;
    canvas.width = 1;
    canvas.height = 1;
  }
}

export const localPptComposerInternals = {
  assertFinalDurationMatches,
  assertMediaCoversPlannedDuration,
  getFinalDurationTolerance,
  getCompositionWatchdogTimeoutMs,
  getPlannedCompositionDuration,
  resolveSubtitleCue,
  validateAudioActivity,
};
