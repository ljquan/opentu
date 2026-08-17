export interface LocalPptNarrationTurn {
  audio: Blob;
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
  onProgress?: (progress: number, message: string) => void;
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

function assertLocalCompositionInput(
  input: LocalPptCompositionInput
): void {
  if (!input.slides.length) throw new Error('PPT 本地合成没有可用页面');
  for (const [slideIndex, slide] of input.slides.entries()) {
    if (!slide.imageUrl.trim()) {
      throw new Error(`PPT 第 ${slideIndex + 1} 页缺少页面快照`);
    }
    if (!slide.turns.length) {
      throw new Error(`PPT 第 ${slideIndex + 1} 页缺少旁白音频`);
    }
    for (const turn of slide.turns) {
      if (!(turn.audio instanceof Blob) || turn.audio.size === 0) {
        throw new Error(`PPT 第 ${slideIndex + 1} 页包含空旁白音频`);
      }
    }
  }
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
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
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
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
  const bytes = await blob.arrayBuffer();
  signal?.throwIfAborted();
  const buffer = await audioContext.decodeAudioData(bytes);
  signal?.throwIfAborted();

  return new Promise<number>((resolve, reject) => {
    const source = audioContext.createBufferSource();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
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
    source.start();
  });
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

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const canvasStream = canvas.captureStream(input.frameRate || DEFAULT_FRAME_RATE);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  const format = chooseLocalPptRecorderFormat(MediaRecorder.isTypeSupported);
  const recorder = new MediaRecorder(combinedStream, {
    ...(format.mimeType ? { mimeType: format.mimeType } : {}),
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  let duration = 0;
  let createdUrl = '';
  try {
    await audioContext.resume();
    recorder.start(1000);
    let completedTurns = 0;
    const totalTurns = input.slides.reduce(
      (sum, slide) => sum + slide.turns.length,
      0
    );
    for (const [slideIndex, slide] of input.slides.entries()) {
      input.signal?.throwIfAborted();
      const image = await loadImage(slide.imageUrl, input.signal);
      if (slideIndex > 0) {
        await drawTransition(
          context,
          canvas,
          image,
          input.transitionDurationMs ?? DEFAULT_TRANSITION_MS,
          input.signal
        );
      }
      for (const turn of slide.turns) {
        drawSlide(context, canvas, image, turn);
        duration += await playAudioBuffer(
          audioContext,
          destination,
          turn.audio,
          input.signal
        );
        completedTurns += 1;
        input.onProgress?.(
          Math.round((completedTurns / totalTurns) * 100),
          `正在合成第 ${slideIndex + 1}/${input.slides.length} 页`
        );
      }
      image.src = '';
    }

    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = (event) =>
        reject(
          event instanceof ErrorEvent && event.error instanceof Error
            ? event.error
            : new Error('视频录制失败')
        );
    });
    recorder.stop();
    await stopped;
    input.signal?.throwIfAborted();
    const mimeType =
      recorder.mimeType || format.mimeType || chunks[0]?.type || 'video/webm';
    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error('PPT 本地合成未产生视频数据');
    createdUrl = URL.createObjectURL(blob);
    return { blob, url: createdUrl, mimeType, duration };
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop();
    if (createdUrl) URL.revokeObjectURL(createdUrl);
    throw error;
  } finally {
    combinedStream.getTracks().forEach((track) => track.stop());
    destination.stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => undefined);
    chunks.length = 0;
    canvas.width = 1;
    canvas.height = 1;
  }
}
