import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseLocalPptRecorderFormat,
  composeLocalPptExplainerVideo,
} from './local-composer';

class MockTrack {
  constructor(readonly kind: 'audio' | 'video') {}

  stop = vi.fn();
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
  currentTime = 4.25;
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
    mode: 'success' | 'error' | 'pending' = 'success',
    playError?: Error
  ) {
    super();
    this.load = vi.fn(() => {
      if (!this.src) return;
      queueMicrotask(() => {
        if (mode === 'error') {
          this.error = { message: 'decode failed' } as MediaError;
          this.dispatchEvent(new Event('error'));
          return;
        }
        this.dispatchEvent(new Event('canplay'));
      });
    });
    this.play = vi.fn(() => {
      if (playError) return Promise.reject(playError);
      if (mode === 'pending') return new Promise<void>(() => undefined);
      queueMicrotask(() => this.dispatchEvent(new Event('ended')));
      return Promise.resolve();
    });
  }
}

interface ComposerBrowserOptions {
  videoMode?: 'success' | 'error' | 'pending';
  playError?: Error;
  recorderErrorAfterStart?: Error;
  recorderConstructorError?: Error;
  resumePending?: boolean;
}

function installComposerBrowser(options: ComposerBrowserOptions = {}) {
  const videoTrack = new MockTrack('video');
  const audioTrack = new MockTrack('audio');
  const canvasStream = new MockStream([videoTrack]);
  const destinationStream = new MockStream([audioTrack]);
  const mediaSource = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const bufferSource = {
    buffer: null as AudioBuffer | null,
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(function (this: typeof bufferSource) {
      queueMicrotask(() => this.onended?.());
    }),
  };
  const audioContext = {
    createMediaStreamDestination: vi.fn(
      () =>
        ({
          stream: destinationStream,
        } as unknown as MediaStreamAudioDestinationNode)
    ),
    createMediaElementSource: vi.fn(
      () => mediaSource as unknown as MediaElementAudioSourceNode
    ),
    createBufferSource: vi.fn(
      () => bufferSource as unknown as AudioBufferSourceNode
    ),
    decodeAudioData: vi.fn(async () => ({ duration: 2 } as AudioBuffer)),
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
    drawImage: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 12 })),
    fillText: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    captureStream: vi.fn(() => canvasStream),
  };
  const video = new MockVideo(options.videoMode, options.playError);
  const recorderInstances: Array<{
    state: RecordingState;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];

  class MockMediaRecorder {
    static isTypeSupported = vi.fn((mimeType: string) =>
      mimeType.startsWith('video/webm')
    );

    state: RecordingState = 'inactive';
    mimeType = 'video/webm';
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    constructor() {
      if (options.recorderConstructorError) {
        throw options.recorderConstructorError;
      }
      recorderInstances.push(this);
    }

    start = vi.fn(() => {
      this.state = 'recording';
      if (options.recorderErrorAfterStart) {
        queueMicrotask(() =>
          this.onerror?.(
            new ErrorEvent('error', { error: options.recorderErrorAfterStart })
          )
        );
      }
    });

    stop = vi.fn(() => {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.ondataavailable?.({
        data: new Blob(['recorded-video'], { type: this.mimeType }),
      } as BlobEvent);
      queueMicrotask(() => this.onstop?.());
    });
  }

  const nativeCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName === 'canvas') return canvas;
    if (tagName === 'video') return video;
    return nativeCreateElement(tagName);
  }) as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation(
    ((node: Node) => node) as typeof document.body.appendChild
  );
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:composed-video');
      static revokeObjectURL = vi.fn();
    }
  );
  vi.stubGlobal('Image', MockImage);
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
    audioTrack,
    bufferSource,
    canvas,
    context,
    mediaSource,
    recorderInstances,
    video,
    videoTrack,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('local PPT explainer composer', () => {
  it('prefers MP4 when the browser supports audio and video codecs', () => {
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
    expect(onProgress).toHaveBeenCalledWith(100, '正在合成第 1/1 页');
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
    await vi.waitFor(() =>
      expect(requestAnimationFrame).toHaveBeenCalledOnce()
    );

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

    expect(browser.video.remove).toHaveBeenCalledOnce();
    expect(browser.mediaSource.disconnect).toHaveBeenCalledOnce();
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
});
