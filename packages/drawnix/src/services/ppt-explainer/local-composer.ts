export interface LocalPptNarrationTurn {
  audio?: Blob;
  /** A same-origin video or audio URL whose audio track drives the slide. */
  mediaUrl?: string;
  subtitle: string;
  speakerName?: string;
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

interface RecorderFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_TRANSITION_MS = 350;

export function chooseLocalPptRecorderFormat(
  isTypeSupported: (mimeType: string) => boolean
): RecorderFormat {
  const candidates: RecorderFormat[] = [
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
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
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('PPT 本地合成已取消', 'AbortError'));
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

  const blob = await loadMediaBlob(url, signal || new AbortController().signal);
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

function drawSlide(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  turn?: LocalPptNarrationTurn,
  opacity = 1
): void {
  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.restore();

  const subtitle = turn?.subtitle.trim();
  if (!subtitle) return;
  const speaker = turn?.speakerName?.trim();
  const text = speaker ? `${speaker}：${subtitle}` : subtitle;
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

  const lineHeight = Math.round(fontSize * 1.35);
  const boxHeight = lines.length * lineHeight + verticalPadding * 2;
  const boxY = canvas.height - boxHeight - Math.round(canvas.height * 0.045);
  context.fillStyle = 'rgba(0, 0, 0, 0.68)';
  context.fillRect(0, boxY, canvas.width, boxHeight);
  context.fillStyle = '#fff';
  lines.forEach((line, index) => {
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
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return operation;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() => reject(getCompositionAbortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
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
  destination: MediaStreamAudioDestinationNode,
  blob: Blob,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  const bytes =
    typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(blob);
        });
  signal?.throwIfAborted();
  const buffer = await audioContext.decodeAudioData(bytes);
  signal?.throwIfAborted();

  return new Promise<number>((resolve, reject) => {
    const source = audioContext.createBufferSource();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
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
      finish(() =>
        reject(new DOMException('PPT 本地合成已取消', 'AbortError'))
      );
    };
    source.buffer = buffer;
    source.connect(destination);
    source.onended = () => finish(() => resolve(buffer.duration));
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      source.start();
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function playMediaElementAudio(
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  mediaUrl: string,
  loadMediaBlob: LocalPptCompositionInput['loadMediaBlob'],
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  let objectUrl: string | undefined;
  if (loadMediaBlob) {
    const blob = await loadMediaBlob(
      mediaUrl,
      signal || new AbortController().signal
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
    source.connect(destination);
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

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let started = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      media.removeEventListener('canplay', onCanPlay);
      media.removeEventListener('ended', onEnded);
      media.removeEventListener('error', onError);
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
      const duration =
        Number.isFinite(media.duration) && media.duration > 0
          ? media.duration
          : media.currentTime;
      finish(() => resolve(duration));
    };
    const onError = () =>
      fail(
        new Error(
          `讲解片段无法解码或播放${
            media.error?.message ? `：${media.error.message}` : ''
          }`
        )
      );
    const onCanPlay = () => {
      if (started || settled) return;
      started = true;
      void media
        .play()
        .catch((error) =>
          fail(
            new Error(
              `浏览器无法播放讲解音轨：${
                error instanceof Error ? error.message : String(error)
              }`
            )
          )
        );
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    media.addEventListener('canplay', onCanPlay);
    media.addEventListener('ended', onEnded, { once: true });
    media.addEventListener('error', onError, { once: true });
    media.src = objectUrl || mediaUrl;
    media.load();
  });
}

function playNarrationTurn(
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  turn: LocalPptNarrationTurn,
  loadMediaBlob: LocalPptCompositionInput['loadMediaBlob'],
  signal?: AbortSignal
): Promise<number> {
  if (turn.audio) {
    return playAudioBuffer(audioContext, destination, turn.audio, signal);
  }
  if (turn.mediaUrl?.trim()) {
    return playMediaElementAudio(
      audioContext,
      destination,
      turn.mediaUrl,
      loadMediaBlob,
      signal
    );
  }
  throw new Error('PPT 旁白来源无效');
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
  let destination: MediaStreamAudioDestinationNode | undefined;
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
    canvasStream = canvas.captureStream(input.frameRate || DEFAULT_FRAME_RATE);
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

    await waitForAbortable(audioContext.resume(), signal);
    let activeImageLoad = await loadCompositionImage(
      input.slides[0].imageUrl,
      input.loadMediaBlob,
      signal
    );
    activeImageDispose = activeImageLoad.dispose;
    const firstImage = activeImageLoad.image;
    activeImage = firstImage;
    drawSlide(context, canvas, firstImage, input.slides[0].turns[0]);
    activeRecorder.start(1000);
    const activeRecorderFailure = recorderFailure;
    const waitWhileRecording = <T>(operation: Promise<T>) =>
      Promise.race([operation, activeRecorderFailure]);
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
        for (const turn of slide.turns) {
          drawSlide(context, canvas, image, turn);
          duration += await waitWhileRecording(
            playNarrationTurn(
              audioContext,
              destination,
              turn,
              input.loadMediaBlob,
              signal
            )
          );
          completedTurns += 1;
          await waitWhileRecording(
            Promise.resolve(
              input.onProgress?.(
                Math.round((completedTurns / totalTurns) * 100),
                `正在合成第 ${slideIndex + 1}/${input.slides.length} 页`
              )
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

    activeRecorder.stop();
    await Promise.race([recorderStopped, activeRecorderFailure]);
    signal.throwIfAborted();
    const mimeType =
      recorder.mimeType || format.mimeType || chunks[0]?.type || 'video/webm';
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error('PPT 本地合成未产生视频数据');
    createdUrl = URL.createObjectURL(blob);
    return { blob, url: createdUrl, mimeType, duration };
  } catch (error) {
    if (!compositionController.signal.aborted) {
      compositionController.abort(error);
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      await recorderStopped?.catch(() => undefined);
    }
    if (createdUrl) URL.revokeObjectURL(createdUrl);
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', abortFromInput);
    if (activeImage) activeImage.src = '';
    activeImageDispose?.();
    if (combinedStream) {
      combinedStream.getTracks().forEach((track) => track.stop());
    } else {
      canvasStream?.getTracks().forEach((track) => track.stop());
      destination?.stream.getTracks().forEach((track) => track.stop());
    }
    await audioContext.close().catch(() => undefined);
    chunks.length = 0;
    canvas.width = 1;
    canvas.height = 1;
  }
}
