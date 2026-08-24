import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseLocalPptRecorderFormat,
  composeLocalPptExplainerVideo,
  localPptComposerInternals,
} from './local-composer';

class MockTrack {
  constructor(readonly kind: 'audio' | 'video') {}

  stop = vi.fn();
  requestFrame = vi.fn();
}

class MockStream {
  constructor(readonly tracks: MockTrack[]) {}

  getTracks(): MediaStreamTrack[] {
    return this.tracks as unknown as MediaStreamTrack[];
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter(
      (track) => track.kind === 'video'
    ) as unknown as MediaStreamTrack[];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter(
      (track) => track.kind === 'audio'
    ) as unknown as MediaStreamTrack[];
  }
}

class MockImage {
  crossOrigin = '';
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private value = '';

  get src(): string {
    return this.value;
  }

  set src(value: string) {
    this.value = value;
    if (value) {
      queueMicrotask(() => this.onload?.(new Event('load')));
    }
  }
}

class MockVideo extends EventTarget {
  crossOrigin = '';
  preload = '';
  playsInline = false;
  style = { display: '' };
  src = '';
  duration = 4.25;
  currentTime = 0;
  error: MediaError | null = null;
  readonly pause = vi.fn();
  readonly remove = vi.fn();
  readonly removeAttribute = vi.fn((name: string) => {
    if (name !== 'src') return;
    this.src = '';
    this.duration = Number.NaN;
    this.currentTime = 0;
  });
  readonly load: ReturnType<typeof vi.fn>;
  readonly play: ReturnType<typeof vi.fn>;

  constructor(
    mode: 'success' | 'error' | 'pending' | 'load-pending' = 'success',
    playError?: Error,
    getRecordedDuration: () => number = () => 0,
    onPlaybackComplete: (duration: number) => void = () => undefined
  ) {
    super();
    this.load = vi.fn(() => {
      if (!this.src) return;
      queueMicrotask(() => {
        if (this.src === 'blob:composed-video') {
          this.duration = getRecordedDuration();
          this.dispatchEvent(new Event('loadedmetadata'));
          return;
        }
        if (mode === 'error') {
          this.error = { message: 'decode failed' } as MediaError;
          this.dispatchEvent(new Event('error'));
          return;
        }
        if (mode === 'load-pending') return;
        this.dispatchEvent(new Event('canplay'));
      });
    });
    this.play = vi.fn(() => {
      if (playError) return Promise.reject(playError);
      if (mode === 'pending') return new Promise<void>(() => undefined);
      setTimeout(() => {
        this.currentTime = this.duration;
        onPlaybackComplete(this.duration);
        this.dispatchEvent(new Event('ended'));
      }, 0);
      return Promise.resolve();
    });
  }
}

interface ComposerBrowserOptions {
  videoMode?: 'success' | 'error' | 'pending' | 'load-pending';
  playError?: Error;
  recorderErrorAfterStart?: Error;
  recorderConstructorError?: Error;
  resumePending?: boolean;
  recorderStartPending?: boolean;
  recorderPausePending?: boolean;
  recorderResumePending?: boolean;
  recorderStopPending?: boolean;
  audibleSample?: number;
  decodedDuration?: number;
  finalDuration?: number;
}

function installComposerBrowser(options: ComposerBrowserOptions = {}) {
  const videoTrack = new MockTrack('video');
  const audioTrack = new MockTrack('audio');
  const canvasStream = new MockStream([videoTrack]);
  const destinationStream = new MockStream([audioTrack]);
  const recorderInstances: Array<{
    state: RecordingState;
    start: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const imageLoadRecorderStates: Array<RecordingState | undefined> = [];
  const drawRecorderStates: Array<RecordingState | undefined> = [];
  const mediaSource = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const analyser = {
    fftSize: 256,
    smoothingTimeConstant: 0,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((samples: Float32Array) => {
      samples.fill(options.audibleSample ?? 0.02);
    }),
  };
  let recordedDuration = 0;
  const bufferSource = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(function (
      this: typeof bufferSource,
      _when = 0,
      _offset = 0,
      duration?: number
    ) {
      recordedDuration += duration || 0;
      queueMicrotask(() => this.onended?.());
    }),
  };
  const audioContext = {
    currentTime: 0,
    createMediaStreamDestination: vi.fn(
      () =>
        ({
          stream: destinationStream,
        } as unknown as MediaStreamAudioDestinationNode)
    ),
    createMediaElementSource: vi.fn(
      () => mediaSource as unknown as MediaElementAudioSourceNode
    ),
    createAnalyser: vi.fn(() => analyser as unknown as AnalyserNode),
    createBufferSource: vi.fn(
      () => bufferSource as unknown as AudioBufferSourceNode
    ),
    decodeAudioData: vi.fn(
      async () => ({ duration: options.decodedDuration ?? 2 } as AudioBuffer)
    ),
    resume: vi.fn(() =>
      options.resumePending
        ? new Promise<void>(() => undefined)
        : Promise.resolve()
    ),
    close: vi.fn(async () => undefined),
  };
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(() => {
      drawRecorderStates.push(recorderInstances[0]?.state);
    }),
    measureText: vi.fn((text: string) => ({ width: text.length * 12 })),
    fillText: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    captureStream: vi.fn(() => canvasStream),
  };
  const createVideo = () =>
    new MockVideo(
      options.videoMode,
      options.playError,
      () => (options.finalDuration ?? recordedDuration) || 4.25,
      (duration) => {
        recordedDuration += duration;
      }
    );
  const video = createVideo();
  let videoCreateCount = 0;

  class MockMediaRecorder extends EventTarget {
    static isTypeSupported = vi.fn((mimeType: string) =>
      mimeType.startsWith('video/webm')
    );

    state: RecordingState = 'inactive';
    mimeType = 'video/webm';
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor() {
      super();
      if (options.recorderConstructorError) {
        throw options.recorderConstructorError;
      }
      recorderInstances.push(this);
    }

    start = vi.fn(() => {
      this.state = 'recording';
      if (!options.recorderStartPending) {
        queueMicrotask(() => this.dispatchEvent(new Event('start')));
      }
      if (options.recorderErrorAfterStart) {
        queueMicrotask(() =>
          this.onerror?.(
            new ErrorEvent('error', { error: options.recorderErrorAfterStart })
          )
        );
      }
    });

    pause = vi.fn(() => {
      if (this.state !== 'recording') return;
      this.state = 'paused';
      if (!options.recorderPausePending) {
        queueMicrotask(() => this.dispatchEvent(new Event('pause')));
      }
    });

    resume = vi.fn(() => {
      if (this.state !== 'paused') return;
      this.state = 'recording';
      if (!options.recorderResumePending) {
        queueMicrotask(() => this.dispatchEvent(new Event('resume')));
      }
    });

    stop = vi.fn(() => {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.ondataavailable?.({
        data: new Blob(['recorded-video'], { type: this.mimeType }),
      } as BlobEvent);
      if (!options.recorderStopPending) {
        queueMicrotask(() => this.onstop?.());
      }
    });
  }

  const nativeCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName === 'canvas') return canvas;
    if (tagName === 'video') {
      videoCreateCount += 1;
      return videoCreateCount === 1 ? video : createVideo();
    }
    return nativeCreateElement(tagName);
  }) as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation(
    ((node: Node) => node) as typeof document.body.appendChild
  );
  const NativeURL = URL;
  let objectUrlIndex = 0;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn((blob: Blob) =>
        blob.type === 'video/webm'
          ? 'blob:composed-video'
          : `blob:input-media-${++objectUrlIndex}`
      );
      static revokeObjectURL = vi.fn();
    }
  );
  vi.stubGlobal(
    'Image',
    class extends MockImage {
      override set src(value: string) {
        if (value) imageLoadRecorderStates.push(recorderInstances[0]?.state);
        super.src = value;
      }

      override get src(): string {
        return super.src;
      }
    }
  );
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return audioContext;
      }
    }
  );
  vi.stubGlobal(
    'MediaStream',
    class extends MockStream {
      constructor(tracks: MediaStreamTrack[]) {
        super(tracks as unknown as MockTrack[]);
      }
    }
  );
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);

  return {
    audioContext,
    analyser,
    audioTrack,
    bufferSource,
    canvas,
    context,
    drawRecorderStates,
    imageLoadRecorderStates,
    mediaSource,
    recorderInstances,
    video,
    videoTrack,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local PPT explainer composer', () => {
  it('prefers WebM with Opus and only falls back to MP4', () => {
    expect(
      chooseLocalPptRecorderFormat(
        (mimeType) =>
          mimeType.includes('vp9,opus') || mimeType.startsWith('video/mp4')
      )
    ).toEqual({
      mimeType: 'video/webm;codecs=vp9,opus',
      extension: 'webm',
    });
    expect(
      chooseLocalPptRecorderFormat((mimeType) =>
        mimeType.startsWith('video/mp4')
      )
    ).toEqual({
      mimeType: 'video/mp4;codecs=avc1,mp4a.40.2',
      extension: 'mp4',
    });
  });

  it('falls back to VP9 WebM and then an unspecified recorder format', () => {
    expect(
      chooseLocalPptRecorderFormat((mimeType) => mimeType.includes('vp9,opus'))
        .extension
    ).toBe('webm');
    expect(chooseLocalPptRecorderFormat(() => false)).toEqual({
      mimeType: '',
      extension: 'webm',
    });
  });

  it.each([
    {
      label: '缺少来源',
      turn: { subtitle: '旁白' },
      message: '旁白来源必须且只能配置一种',
    },
    {
      label: '同时配置两种来源',
      turn: {
        audio: new Blob(['audio'], { type: 'audio/mpeg' }),
        mediaUrl: '/__aitu_cache__/video/segment.mp4',
        subtitle: '旁白',
      },
      message: '旁白来源必须且只能配置一种',
    },
    {
      label: '空音频',
      turn: { audio: new Blob([], { type: 'audio/mpeg' }), subtitle: '旁白' },
      message: '包含空旁白音频',
    },
  ])('rejects invalid narration input: $label', async ({ turn, message }) => {
    await expect(
      composeLocalPptExplainerVideo({
        slides: [{ imageUrl: '/slide.png', turns: [turn] }],
      })
    ).rejects.toThrow(message);
  });

  it('keeps the original PPT image on canvas and only plays segment audio', async () => {
    const browser = installComposerBrowser();
    const onProgress = vi.fn();

    const result = await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
            },
          ],
        },
      ],
      onProgress,
    });

    expect(result).toMatchObject({
      url: 'blob:composed-video',
      mimeType: 'video/webm',
      duration: 4.25,
    });
    expect(browser.audioContext.createMediaElementSource).toHaveBeenCalledWith(
      browser.video
    );
    expect(browser.audioContext.decodeAudioData).not.toHaveBeenCalled();
    expect(browser.context.drawImage).toHaveBeenCalled();
    expect(
      browser.context.drawImage.mock.calls.some(
        ([image]) => image === browser.video
      )
    ).toBe(false);
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      0,
      '实时录制 1/1 页 · 1/1 段'
    );
    expect(onProgress).toHaveBeenCalledWith(100, '已完成 1/1 页 · 1/1 段');
    expect(onProgress).toHaveBeenLastCalledWith(100, '正在校验 PPT 讲解成片');
    expect(browser.video.pause).toHaveBeenCalledOnce();
    expect(browser.video.remove).toHaveBeenCalledOnce();
    expect(browser.mediaSource.disconnect).toHaveBeenCalledOnce();
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
    expect(browser.canvas).toMatchObject({ width: 1, height: 1 });
  });

  it('uses an audio Blob without creating a media element source', async () => {
    const browser = installComposerBrowser();

    const result = await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              audio: new Blob(['audio'], { type: 'audio/mpeg' }),
              subtitle: '本页讲解',
            },
          ],
        },
      ],
    });

    expect(result.duration).toBe(2);
    expect(browser.audioContext.decodeAudioData).toHaveBeenCalledOnce();
    expect(
      browser.audioContext.createMediaElementSource
    ).not.toHaveBeenCalled();
    expect(browser.bufferSource.disconnect).toHaveBeenCalledOnce();
    expect(browser.bufferSource.buffer).toBeNull();
  });

  it('does not depend on the asynchronous MediaRecorder start event', async () => {
    const browser = installComposerBrowser({ recorderStartPending: true });
    const result = await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
            },
          ],
        },
      ],
    });

    expect(result.duration).toBe(4.25);
    expect(browser.recorderInstances[0]?.start).toHaveBeenCalledOnce();
    expect(browser.video.play).toHaveBeenCalledOnce();
  });

  it('records only while narration is playing', async () => {
    const browser = installComposerBrowser();

    await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              audio: new Blob(['audio'], { type: 'audio/mpeg' }),
              subtitle: '本页讲解',
            },
          ],
        },
      ],
    });

    const recorder = browser.recorderInstances[0];
    expect(recorder.pause).toHaveBeenCalledTimes(2);
    expect(recorder.resume).toHaveBeenCalledOnce();
  });

  it('keeps recording paused while loading pages, switching slides, drawing transitions and persisting progress', async () => {
    const browser = installComposerBrowser();
    const progressRecorderStates: Array<RecordingState | undefined> = [];
    const transitionRecorderStates: Array<RecordingState | undefined> = [];

    await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide-1.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment-1.mp4',
              subtitle: '第一页讲解',
            },
          ],
        },
        {
          imageUrl: '/slide-2.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment-2.mp4',
              subtitle: '第二页讲解',
            },
          ],
        },
      ],
      transitionDurationMs: 0,
      onProgress: (_progress, message) => {
        progressRecorderStates.push(browser.recorderInstances[0]?.state);
        if (message.startsWith('实时录制 2/2 页')) {
          transitionRecorderStates.push(browser.drawRecorderStates.at(-1));
        }
      },
    });

    expect(browser.imageLoadRecorderStates).toEqual(['inactive', 'paused']);
    expect(progressRecorderStates.every((state) => state === 'paused')).toBe(
      true
    );
    expect(transitionRecorderStates).toEqual(['paused']);
    expect(browser.recorderInstances[0]?.pause).toHaveBeenCalledTimes(3);
    expect(browser.recorderInstances[0]?.resume).toHaveBeenCalledTimes(2);
  });

  it('allows cancellation while a progress update is pending', async () => {
    const browser = installComposerBrowser();
    const controller = new AbortController();
    const onProgress = vi.fn(() => new Promise<void>(() => undefined));
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
            },
          ],
        },
      ],
      signal: controller.signal,
      onProgress,
    });
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledOnce());

    controller.abort(new DOMException('用户取消', 'AbortError'));

    await expect(composition).rejects.toMatchObject({ name: 'AbortError' });
    expect(browser.video.play).not.toHaveBeenCalled();
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
  });

  it('truncates decoded audio at the planned output duration', async () => {
    const browser = installComposerBrowser({ decodedDuration: 12 });

    const result = await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              audio: new Blob(['audio'], { type: 'audio/mpeg' }),
              subtitle: '本页讲解',
              maxDurationSeconds: 8,
              outputDurationSeconds: 5,
            },
          ],
        },
      ],
    });

    expect(result.duration).toBe(5);
    expect(browser.bufferSource.start).toHaveBeenCalledWith(0, 0, 5);
  });

  it('rejects narration that is measurably silent', async () => {
    installComposerBrowser({ audibleSample: 0, decodedDuration: 5 });

    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              audio: new Blob(['audio'], { type: 'audio/mpeg' }),
              subtitle: '本页讲解',
            },
          ],
        },
      ],
    });

    await expect(composition).rejects.toMatchObject({
      code: 'PPT_NARRATION_QUALITY',
      reason: 'silent',
      slideIndex: 0,
      turnIndex: 0,
      message: expect.stringContaining('没有检测到有效声音'),
    });
  });

  it('updates short subtitle cues from media time and stops at the planned duration', async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const browser = installComposerBrowser({
      videoMode: 'pending',
      finalDuration: 3,
    });

    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '不应绘制的整页长字幕',
              subtitleCues: [
                { text: '第一句', speakerName: '主讲人' },
                { text: '第二句', speakerName: '主讲人' },
              ],
              outputDurationSeconds: 3,
            },
          ],
        },
      ],
    });
    await vi.waitFor(() => expect(browser.video.play).toHaveBeenCalledOnce());

    const renderedText = browser.context.fillText.mock.calls.map(
      ([text]) => text
    );
    expect(renderedText).toContain('主讲人：第一句');
    expect(renderedText).not.toContain('不应绘制的整页长字幕');

    browser.video.currentTime = 2;
    expect(
      localPptComposerInternals.resolveSubtitleCue(
        {
          mediaUrl: '/segment.mp4',
          subtitleCues: [
            { text: '第一句', speakerName: '主讲人' },
            { text: '第二句', speakerName: '主讲人' },
          ],
        },
        2,
        3
      )
    ).toEqual({ text: '第二句', speakerName: '主讲人' });

    browser.video.currentTime = 3;
    browser.video.dispatchEvent(new Event('ended'));
    await expect(composition).resolves.toMatchObject({ duration: 3 });
  });

  it('rejects long leading, trailing and low-coverage silence', () => {
    expect(() =>
      localPptComposerInternals.validateAudioActivity(
        {
          samples: 100,
          audibleSamples: 10,
          firstAudibleSeconds: 5,
          lastAudibleSeconds: 9,
        },
        10
      )
    ).toThrow(/占比过低|前导静音过长/);
    expect(() =>
      localPptComposerInternals.validateAudioActivity(
        {
          samples: 100,
          audibleSamples: 50,
          firstAudibleSeconds: 0.2,
          lastAudibleSeconds: 5,
        },
        10
      )
    ).toThrow('尾部静音过长');
    expect(() =>
      localPptComposerInternals.validateAudioActivity(
        { samples: 0, audibleSamples: 0 },
        10
      )
    ).toThrow('无法检测声音活动');
  });

  it('rejects a source that cannot cover the planned narration window', async () => {
    installComposerBrowser({ decodedDuration: 4 });

    await expect(
      composeLocalPptExplainerVideo({
        slides: [
          {
            imageUrl: '/slide.png',
            turns: [
              {
                audio: new Blob(['audio'], { type: 'audio/mpeg' }),
                subtitle: '本页讲解',
                outputDurationSeconds: 10,
              },
            ],
          },
        ],
      })
    ).rejects.toThrow('无法覆盖计划的 10.0 秒');
  });

  it('rejects and releases a recording whose real duration drifts from the plan', async () => {
    const browser = installComposerBrowser({
      decodedDuration: 60,
      finalDuration: 249,
    });

    await expect(
      composeLocalPptExplainerVideo({
        slides: [
          {
            imageUrl: '/slide.png',
            turns: [
              {
                audio: new Blob(['audio'], { type: 'audio/mpeg' }),
                subtitle: '本页讲解',
                outputDurationSeconds: 60,
              },
            ],
          },
        ],
      })
    ).rejects.toThrow('成片实际 249.0 秒，与计划 60.0 秒不一致');

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composed-video');
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('returns the real recording duration when it is within tolerance', async () => {
    installComposerBrowser({ decodedDuration: 60, finalDuration: 60.5 });

    const result = await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              audio: new Blob(['audio'], { type: 'audio/mpeg' }),
              subtitle: '本页讲解',
              outputDurationSeconds: 60,
            },
          ],
        },
      ],
    });

    expect(result.duration).toBe(60.5);
  });

  it('applies bounded tolerance to final recording duration', () => {
    expect(() =>
      localPptComposerInternals.assertFinalDurationMatches(249, 60)
    ).toThrow('成片实际 249.0 秒，与计划 60.0 秒不一致');
    expect(() =>
      localPptComposerInternals.assertFinalDurationMatches(10.75, 10)
    ).not.toThrow();
    expect(() =>
      localPptComposerInternals.assertFinalDurationMatches(10.76, 10)
    ).toThrow();
    expect(() =>
      localPptComposerInternals.assertFinalDurationMatches(203, 200)
    ).not.toThrow();
    expect(() =>
      localPptComposerInternals.assertFinalDurationMatches(203.01, 200)
    ).toThrow();
  });

  it('loads cached slide and narration blobs without Service Worker URLs', async () => {
    const browser = installComposerBrowser();
    const slideBlob = new Blob(['slide'], { type: 'image/png' });
    const narrationBlob = new Blob(['video'], { type: 'video/mp4' });
    const loadMediaBlob = vi.fn(async (url: string) =>
      url.endsWith('.png') ? slideBlob : narrationBlob
    );

    const result = await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/__aitu_internal__/ppt-explainer/job/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
            },
          ],
        },
      ],
      loadMediaBlob,
    });

    expect(result.url).toBe('blob:composed-video');
    expect(loadMediaBlob).toHaveBeenNthCalledWith(
      1,
      '/__aitu_internal__/ppt-explainer/job/slide.png',
      expect.any(AbortSignal)
    );
    expect(loadMediaBlob).toHaveBeenNthCalledWith(
      2,
      '/__aitu_cache__/video/segment.mp4',
      expect.any(AbortSignal)
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(slideBlob);
    expect(URL.createObjectURL).toHaveBeenCalledWith(narrationBlob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:input-media-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:input-media-2');
    expect(browser.video.src).toBe('');
  });

  it('fails clearly on media decode errors and releases all resources', async () => {
    const browser = installComposerBrowser({ videoMode: 'error' });

    await expect(
      composeLocalPptExplainerVideo({
        slides: [
          {
            imageUrl: '/slide.png',
            turns: [
              {
                mediaUrl: '/__aitu_cache__/video/broken.mp4',
                subtitle: '本页讲解',
              },
            ],
          },
        ],
      })
    ).rejects.toThrow('讲解片段无法解码或播放：decode failed');

    expect(browser.video.remove).toHaveBeenCalledOnce();
    expect(browser.mediaSource.disconnect).toHaveBeenCalledOnce();
    expect(browser.recorderInstances[0]?.stop).toHaveBeenCalledOnce();
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('does not classify a browser play rejection as upstream audio quality', async () => {
    installComposerBrowser({
      playError: new DOMException('play() failed', 'NotAllowedError'),
    });

    let capturedError: unknown;
    try {
      await composeLocalPptExplainerVideo({
        slides: [
          {
            imageUrl: '/slide.png',
            turns: [
              {
                mediaUrl: '/__aitu_cache__/video/segment.mp4',
                subtitle: '本页讲解',
              },
            ],
          },
        ],
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toContain(
      '浏览器无法播放讲解音轨'
    );
    expect((capturedError as Error).message).toContain('play() failed');
    expect(capturedError).not.toMatchObject({
      code: 'PPT_NARRATION_QUALITY',
    });
  });

  it('cancels pending media playback and releases all resources', async () => {
    const browser = installComposerBrowser({ videoMode: 'pending' });
    const controller = new AbortController();
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
            },
          ],
        },
      ],
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(browser.video.play).toHaveBeenCalledOnce());

    controller.abort(new DOMException('用户取消', 'AbortError'));

    await expect(composition).rejects.toMatchObject({ name: 'AbortError' });
    expect(browser.video.remove).toHaveBeenCalledOnce();
    expect(browser.mediaSource.disconnect).toHaveBeenCalledOnce();
    expect(browser.recorderInstances[0]?.stop).toHaveBeenCalledOnce();
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('cancels a transition even when requestAnimationFrame is suspended', async () => {
    const browser = installComposerBrowser();
    const controller = new AbortController();
    const cancelFrame = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 17)
    );
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide-1.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment-1.mp4',
              subtitle: '第一页',
            },
          ],
        },
        {
          imageUrl: '/slide-2.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment-2.mp4',
              subtitle: '第二页',
            },
          ],
        },
      ],
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(requestAnimationFrame).toHaveBeenCalled());

    controller.abort(new DOMException('用户取消', 'AbortError'));

    await expect(composition).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(browser.recorderInstances[0]?.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('releases initialized streams when MediaRecorder construction fails', async () => {
    const browser = installComposerBrowser({
      recorderConstructorError: new Error('recorder unavailable'),
    });

    await expect(
      composeLocalPptExplainerVideo({
        slides: [
          {
            imageUrl: '/slide.png',
            turns: [
              {
                mediaUrl: '/__aitu_cache__/video/segment.mp4',
                subtitle: '本页讲解',
              },
            ],
          },
        ],
      })
    ).rejects.toThrow('recorder unavailable');

    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('stops immediately when the recorder fails during media playback', async () => {
    const browser = installComposerBrowser({
      videoMode: 'pending',
      recorderErrorAfterStart: new Error('recorder failed'),
    });

    await expect(
      composeLocalPptExplainerVideo({
        slides: [
          {
            imageUrl: '/slide.png',
            turns: [
              {
                mediaUrl: '/__aitu_cache__/video/segment.mp4',
                subtitle: '本页讲解',
              },
            ],
          },
        ],
      })
    ).rejects.toThrow('recorder failed');

    // Recorder failure may win before the media element is allocated.
    expect(browser.video.remove).toHaveBeenCalledTimes(
      browser.audioContext.createMediaElementSource.mock.calls.length
    );
    expect(browser.mediaSource.disconnect).toHaveBeenCalledTimes(
      browser.audioContext.createMediaElementSource.mock.calls.length
    );
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('allows cancellation while AudioContext resume is pending', async () => {
    const browser = installComposerBrowser({ resumePending: true });
    const controller = new AbortController();
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
            },
          ],
        },
      ],
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(browser.audioContext.resume).toHaveBeenCalledOnce()
    );

    controller.abort(new DOMException('用户取消', 'AbortError'));

    await expect(composition).rejects.toMatchObject({ name: 'AbortError' });
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('fails clearly when AudioContext resume remains pending', async () => {
    vi.useFakeTimers();
    const browser = installComposerBrowser({ resumePending: true });
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
              outputDurationSeconds: 10,
            },
          ],
        },
      ],
    });
    const rejection = expect(composition).rejects.toThrow(
      '浏览器未能启动讲解音频，请保持页面在前台并点击页面后重试'
    );

    await vi.advanceTimersByTimeAsync(8_001);

    await rejection;
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('fails clearly when media play never starts', async () => {
    vi.useFakeTimers();
    const browser = installComposerBrowser({ videoMode: 'pending' });
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
              outputDurationSeconds: 4,
            },
          ],
        },
      ],
    });
    const rejection = expect(composition).rejects.toThrow(
      '启动 PPT 讲解音轨超过 10 秒，请保持页面在前台后重试'
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(browser.video.play).toHaveBeenCalledOnce();
    expect(browser.recorderInstances[0]?.state).toBe('paused');

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(browser.video.remove).toHaveBeenCalledOnce();
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
  });

  it('fails clearly when media never becomes playable', async () => {
    vi.useFakeTimers();
    const browser = installComposerBrowser({ videoMode: 'load-pending' });
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
              outputDurationSeconds: 4,
            },
          ],
        },
      ],
    });
    const rejection = expect(composition).rejects.toThrow(
      '加载 PPT 讲解音轨超过 15 秒，请保持页面在前台后重试'
    );

    await vi.advanceTimersByTimeAsync(15_001);

    await rejection;
    expect(browser.video.play).not.toHaveBeenCalled();
    expect(browser.video.remove).toHaveBeenCalledOnce();
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
  });

  it('uses recorder state when pause and resume events are missing', async () => {
    const browser = installComposerBrowser({
      recorderPausePending: true,
      recorderResumePending: true,
    });
    const result = await composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              mediaUrl: '/__aitu_cache__/video/segment.mp4',
              subtitle: '本页讲解',
            },
          ],
        },
      ],
    });

    expect(result.duration).toBe(4.25);
    expect(browser.video.play).toHaveBeenCalledOnce();
    expect(browser.recorderInstances[0]?.stop).toHaveBeenCalledOnce();
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
  });

  it('does not hang when recorder stop is not acknowledged', async () => {
    vi.useFakeTimers();
    const browser = installComposerBrowser({ recorderStopPending: true });
    const composition = composeLocalPptExplainerVideo({
      slides: [
        {
          imageUrl: '/slide.png',
          turns: [
            {
              audio: new Blob(['audio'], { type: 'audio/mpeg' }),
              subtitle: '本页讲解',
            },
          ],
        },
      ],
    });
    const rejection = expect(composition).rejects.toThrow(
      '停止 PPT 视频录制超过 10 秒，请刷新页面后重试'
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(browser.recorderInstances[0]?.stop).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(browser.videoTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioTrack.stop).toHaveBeenCalledOnce();
    expect(browser.audioContext.close).toHaveBeenCalledOnce();
  });

  it('derives the total composition watchdog from planned turn durations', () => {
    const input = {
      slides: [
        {
          imageUrl: '/slide-1.png',
          turns: [
            {
              mediaUrl: '/segment-1.mp4',
              outputDurationSeconds: 10,
            },
          ],
        },
        {
          imageUrl: '/slide-2.png',
          turns: [
            {
              mediaUrl: '/segment-2.mp4',
              outputDurationSeconds: 10,
            },
          ],
        },
      ],
    };

    expect(localPptComposerInternals.getPlannedCompositionDuration(input)).toBe(
      20
    );
    expect(localPptComposerInternals.getCompositionWatchdogTimeoutMs(20)).toBe(
      80_000
    );
  });
});
