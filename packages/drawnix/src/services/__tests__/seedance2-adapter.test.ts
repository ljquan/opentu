import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedance2VideoAdapter } from '../model-adapters/seedance2-adapter';
import type { AdapterContext } from '../model-adapters/types';

const { getCachedBlob } = vi.hoisted(() => ({
  getCachedBlob: vi.fn(),
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: { getCachedBlob },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createContext(fetcher: typeof fetch): AdapterContext {
  return {
    baseUrl: 'https://video.example.com/v1',
    apiKey: 'sk-test',
    authType: 'bearer',
    operation: 'video',
    fetcher,
    binding: {
      id: 'provider:seedance-2:video',
      profileId: 'provider',
      modelId: 'doubao-seedance-2-0-260128',
      operation: 'video',
      protocol: 'openai.async.video',
      requestSchema: 'doubao.seedance-2.video.content-json',
      responseSchema: 'openai.async.task',
      submitPath: '/videos',
      pollPathTemplate: '/videos/{taskId}',
      priority: 700,
      confidence: 'high',
      source: 'template',
    },
  };
}

describe('seedance 2.0 video adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getCachedBlob.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits official model IDs as JSON and polls queued tasks to completion', async () => {
    const onProgress = vi.fn();
    const onSubmitted = vi.fn();
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init: init || {} });

        if ((init?.method || 'GET') === 'POST') {
          return jsonResponse({ id: 'seedance-2-task', status: 'queued' });
        }

        return jsonResponse({
          id: 'seedance-2-task',
          status: 'completed',
          progress: 100,
          duration: 12,
          metadata: { url: 'https://cdn.example.com/seedance-2.mp4' },
        });
      }
    ) as unknown as typeof fetch;

    const resultPromise = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'camera flies over a glass city',
        size: '1080p',
        duration: 12,
        referenceImages: ['https://assets.example.com/ref.png'],
        params: {
          generate_audio: true,
          watermark: false,
          input_video: 'https://assets.example.com/ref.mp4',
          input_audio: 'https://assets.example.com/ref.mp3',
          ratio: '9:16',
          seed: '0',
          camera_fixed: 'false',
          onProgress,
          onSubmitted,
        },
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result).toMatchObject({
      url: 'https://cdn.example.com/seedance-2.mp4',
      format: 'mp4',
      duration: 12,
    });
    expect(onSubmitted).toHaveBeenCalledWith('seedance-2-task');
    expect(onProgress).toHaveBeenNthCalledWith(1, 5, 'queued');
    expect(onProgress).toHaveBeenLastCalledWith(100, 'completed');
    expect(requests[0]?.url).toBe('https://video.example.com/v1/videos');
    expect(requests[0]?.init.method).toBe('POST');
    expect(requests[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer sk-test',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: 'camera flies over a glass city' },
        {
          type: 'image_url',
          image_url: { url: 'https://assets.example.com/ref.png' },
          role: 'reference_image',
        },
        {
          type: 'video_url',
          video_url: { url: 'https://assets.example.com/ref.mp4' },
          role: 'reference_video',
        },
        {
          type: 'audio_url',
          audio_url: { url: 'https://assets.example.com/ref.mp3' },
          role: 'reference_audio',
        },
      ],
      resolution: '1080p',
      ratio: '9:16',
      duration: 12,
      generate_audio: true,
      watermark: false,
      seed: 0,
      camera_fixed: false,
    });
    expect(requests[1]?.url).toBe(
      'https://video.example.com/v1/videos/seedance-2-task'
    );
  });

  it('keeps fast and mini official IDs unchanged', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init: init || {} });
        return (init?.method || 'GET') === 'POST'
          ? jsonResponse({ task_id: 'seedance-mini-task', status: 'queued' })
          : jsonResponse({
              task_id: 'seedance-mini-task',
              status: 'succeeded',
              video_url: 'https://cdn.example.com/mini.mp4',
            });
      }
    ) as unknown as typeof fetch;

    const resultPromise = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-0-mini-260615',
        prompt: 'small product turntable',
        size: '720p',
        duration: 4,
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;
    const submitBody = JSON.parse(String(requests[0]?.init.body));

    expect(result.url).toBe('https://cdn.example.com/mini.mp4');
    expect(submitBody.model).toBe('doubao-seedance-2-0-mini-260615');
    expect(submitBody).toMatchObject({
      resolution: '720p',
      ratio: '16:9',
      duration: 4,
      generate_audio: true,
      watermark: false,
    });
  });

  it('uses Seedance 2.5 duration and reference limits without 2.0-only controls', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), init: init || {} });
        return (init?.method || 'GET') === 'POST'
          ? jsonResponse({ id: 'seedance-25-task', status: 'queued' })
          : jsonResponse({
              id: 'seedance-25-task',
              status: 'completed',
              duration: 30,
              metadata: { url: 'https://cdn.example.com/seedance-25.mp4' },
            });
      }
    ) as unknown as typeof fetch;

    const resultPromise = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-5-260628',
        prompt: 'long-form reference scene',
        size: '1080p',
        duration: 30,
        referenceImages: ['https://assets.example.com/ref.png'],
        params: {
          ratio: '1:1',
          input_videos: [
            'https://assets.example.com/ref-1.mp4',
            'https://assets.example.com/ref-2.mp4',
            'https://assets.example.com/ref-3.mp4',
            'https://assets.example.com/ref-4.mp4',
          ],
          input_audios: [
            'https://assets.example.com/ref-1.mp3',
            'https://assets.example.com/ref-2.mp3',
            'https://assets.example.com/ref-3.mp3',
            'https://assets.example.com/ref-4.mp3',
          ],
          seed: '7',
          camera_fixed: 'true',
        },
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    await expect(resultPromise).resolves.toMatchObject({
      url: 'https://cdn.example.com/seedance-25.mp4',
      duration: 30,
    });

    const submitBody = JSON.parse(String(requests[0]?.init.body));
    expect(submitBody).toMatchObject({
      model: 'doubao-seedance-2-5-260628',
      ratio: '1:1',
      duration: 30,
    });
    expect(submitBody.resolution).toBeUndefined();
    expect(submitBody.seed).toBeUndefined();
    expect(submitBody.camera_fixed).toBeUndefined();
    expect(
      submitBody.content.filter((item: { type: string }) => item.type === 'video_url')
    ).toHaveLength(4);
    expect(
      submitBody.content.filter((item: { type: string }) => item.type === 'audio_url')
    ).toHaveLength(4);
  });

  it.each(['16:9', '16x9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])(
    'normalizes Seedance 2.5 ratio %s before submission',
    async (ratio) => {
      const requests: RequestInit[] = [];
      const fetcher = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(init || {});
          return (init?.method || 'GET') === 'POST'
            ? jsonResponse({ id: 'seedance-25-ratio-task', status: 'queued' })
            : jsonResponse({
                id: 'seedance-25-ratio-task',
                status: 'completed',
                duration: 4,
                metadata: {
                  url: 'https://cdn.example.com/seedance-25-ratio.mp4',
                },
              });
        }
      ) as unknown as typeof fetch;

      const resultPromise = seedance2VideoAdapter.generateVideo(
        createContext(fetcher),
        {
          model: 'doubao-seedance-2-5-260628',
          prompt: 'ratio regression',
          size: ratio,
          duration: 4,
        }
      );

      await vi.advanceTimersByTimeAsync(5000);
      await expect(resultPromise).resolves.toMatchObject({
        url: 'https://cdn.example.com/seedance-25-ratio.mp4',
      });
      const submitBody = JSON.parse(String(requests[0]?.body));
      expect(submitBody.ratio).toBe(ratio === '16x9' ? '16:9' : ratio);
      expect(submitBody.resolution).toBeUndefined();
    }
  );

  it('normalizes Auto to adaptive from explicit params', async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(init || {});
        return (init?.method || 'GET') === 'POST'
          ? jsonResponse({ id: 'seedance-25-auto-task', status: 'queued' })
          : jsonResponse({
              id: 'seedance-25-auto-task',
              status: 'completed',
              duration: 4,
              metadata: { url: 'https://cdn.example.com/seedance-25-auto.mp4' },
            });
      }
    ) as unknown as typeof fetch;

    const resultPromise = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-5-260628',
        prompt: 'auto ratio regression',
        duration: 4,
        params: { ratio: 'Auto' },
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    await expect(resultPromise).resolves.toMatchObject({
      url: 'https://cdn.example.com/seedance-25-auto.mp4',
    });
    expect(JSON.parse(String(requests[0]?.body)).ratio).toBe('adaptive');
  });

  it('rejects Seedance 2.5 durations outside 4-30 seconds before transport', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-5-260628',
        prompt: 'invalid duration',
        duration: 3,
      })
    ).rejects.toThrow('4-30 秒整数');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('surfaces a top-level provider message for Seedance submission errors', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ message: '请求参数无效，请检查后重试' }, 400)
    ) as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-5-260628',
        prompt: 'provider validation error',
      })
    ).rejects.toThrow('请求参数无效，请检查后重试');
  });

  it('submits multiple workflow media references and deduplicates legacy values', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'captured' } }, 400)
    ) as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'multiple canvas references',
        params: {
          input_video: 'https://assets.example.com/video-1.mp4',
          input_videos: [
            ' https://assets.example.com/video-1.mp4 ',
            'https://assets.example.com/video-2.mp4',
            'https://assets.example.com/video-3.mp4',
          ],
          input_audio: 'audio-material-1',
          input_audios: [
            ' audio-material-1 ',
            'asset://audio-material-2',
            'https://assets.example.com/audio-3.mp3',
          ],
        },
      })
    ).rejects.toThrow('captured');

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      content: [
        { type: 'text', text: 'multiple canvas references' },
        {
          type: 'video_url',
          video_url: { url: 'https://assets.example.com/video-1.mp4' },
          role: 'reference_video',
        },
        {
          type: 'video_url',
          video_url: { url: 'https://assets.example.com/video-2.mp4' },
          role: 'reference_video',
        },
        {
          type: 'video_url',
          video_url: { url: 'https://assets.example.com/video-3.mp4' },
          role: 'reference_video',
        },
        {
          type: 'audio_url',
          audio_url: { url: 'audio-material-1' },
          role: 'reference_audio',
        },
        {
          type: 'audio_url',
          audio_url: { url: 'asset://audio-material-2' },
          role: 'reference_audio',
        },
        {
          type: 'audio_url',
          audio_url: { url: 'https://assets.example.com/audio-3.mp3' },
          role: 'reference_audio',
        },
      ],
    });
  });

  it('keeps empty workflow media arrays equivalent to no references', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'captured' } }, 400)
    ) as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'no canvas media references',
        params: { input_videos: [], input_audios: [] },
      })
    ).rejects.toThrow('captured');

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      content: [{ type: 'text', text: 'no canvas media references' }],
    });
  });

  it.each([
    {
      params: {
        input_videos: 'https://assets.example.com/reference.mp4',
      },
      message: '参考视频必须为字符串数组',
    },
    {
      params: { input_audios: ['audio-material-1', 2] },
      message: '第 2 条参考音频必须为非空字符串',
    },
    {
      params: {
        input_videos: [
          'https://assets.example.com/reference.mp4',
          'http://127.0.0.1/private.mp4',
        ],
      },
      message: '第 2 条参考视频仅支持公网 HTTP(S) 地址',
    },
    {
      params: {
        input_audios: [
          'audio-material-1',
          'blob:https://app.example.com/audio-2',
        ],
      },
      message: '第 2 条参考音频仅支持 HTTP(S)',
    },
  ])(
    'rejects invalid multi-reference input before submission: $message',
    async ({ params, message }) => {
      const fetcher = vi.fn() as unknown as typeof fetch;

      await expect(
        seedance2VideoAdapter.generateVideo(createContext(fetcher), {
          model: 'doubao-seedance-2-0-260128',
          prompt: 'invalid multi-reference input',
          params,
        })
      ).rejects.toThrow(message);
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      params: {
        input_videos: [1, 2, 3, 4].map(
          (index) => `https://assets.example.com/video-${index}.mp4`
        ),
      },
      message: '参考视频最多支持 3 条',
    },
    {
      params: {
        input_audios: [1, 2, 3, 4].map((index) => `audio-material-${index}`),
      },
      message: '参考音频最多支持 3 条',
    },
  ])(
    'rejects references beyond the Seedance 2.0 count boundary: $message',
    async ({ params, message }) => {
      const fetcher = vi.fn() as unknown as typeof fetch;

      await expect(
        seedance2VideoAdapter.generateVideo(createContext(fetcher), {
          model: 'doubao-seedance-2-0-260128',
          prompt: 'too many references',
          params,
        })
      ).rejects.toThrow(message);
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it('rejects aggregate inline audio data beyond the single-reference budget', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const firstPayload = 'A'.repeat(8 * 1024 * 1024);
    const secondPayload = 'B'.repeat(8 * 1024 * 1024);

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'bounded inline audio references',
        params: {
          input_audios: [
            `data:audio/mpeg;base64,${firstPayload}`,
            `data:audio/mpeg;base64,${secondPayload}`,
          ],
        },
      })
    ).rejects.toThrow('音频 Data URL 合计不能超过 16 MiB');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts official audio references but rejects browser-local media URLs', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'stop after request capture' } }, 400)
    ) as unknown as typeof fetch;
    const validResult = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'asset reference',
        params: { input_audio: ' audio-material-123 ' },
      }
    );

    await expect(validResult).rejects.toThrow('stop after request capture');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      content: [
        { type: 'text', text: 'asset reference' },
        {
          type: 'audio_url',
          audio_url: { url: 'audio-material-123' },
          role: 'reference_audio',
        },
      ],
    });

    fetcher.mockClear();
    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'audio data reference',
        params: { input_audio: 'data:audio/mpeg;base64,ZmFrZQ==' },
      })
    ).rejects.toThrow('stop after request capture');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      content: [
        { type: 'text', text: 'audio data reference' },
        {
          type: 'audio_url',
          audio_url: { url: 'data:audio/mpeg;base64,ZmFrZQ==' },
          role: 'reference_audio',
        },
      ],
    });

    fetcher.mockClear();
    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'local reference',
        params: { input_audio: 'blob:https://app.example.com/audio-123' },
      })
    ).rejects.toThrow(
      'Seedance 2.0 参考音频仅支持 HTTP(S)、asset://、音频 Data URL 或素材 ID'
    );
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'invalid audio data reference',
        params: { input_audio: 'data:audio/mpeg;base64,%%%' },
      })
    ).rejects.toThrow('Seedance 2.0 参考音频仅支持');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('materializes a persisted virtual audio reference only at request time', async () => {
    vi.useRealTimers();
    getCachedBlob.mockResolvedValueOnce(
      new Blob(['audio'], { type: 'audio/mpeg' })
    );
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'captured' } }, 400)
    ) as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'virtual audio reference',
        params: {
          input_audio: '/__aitu_generated__/audio/content-reference.mp3',
        },
      })
    ).rejects.toThrow('captured');

    expect(getCachedBlob).toHaveBeenCalledWith(
      '/__aitu_generated__/audio/content-reference.mp3'
    );
    const submitBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(submitBody.content[1]).toMatchObject({
      type: 'audio_url',
      role: 'reference_audio',
    });
    expect(submitBody.content[1].audio_url.url).toMatch(
      /^data:audio\/mpeg;base64,/
    );
  });

  it('rejects a missing virtual audio cache before submission', async () => {
    getCachedBlob.mockResolvedValueOnce(null);
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'missing virtual audio reference',
        params: { input_audio: '/__aitu_cache__/audio/missing.mp3' },
      })
    ).rejects.toThrow('本地参考音频缓存不可用');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an oversized cached audio before materializing base64', async () => {
    getCachedBlob.mockResolvedValueOnce({
      size: 13 * 1024 * 1024,
      type: 'audio/mpeg',
    } as Blob);
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'oversized cached audio',
        params: {
          input_audio: '/__aitu_cache__/audio/oversized.mp3',
        },
      })
    ).rejects.toThrow('音频 Data URL 合计不能超过 16 MiB');

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks aggregate cached audio size before materializing any reference', async () => {
    getCachedBlob
      .mockResolvedValueOnce({
        size: 7 * 1024 * 1024,
        type: 'audio/mpeg',
      } as Blob)
      .mockResolvedValueOnce({
        size: 7 * 1024 * 1024,
        type: 'audio/mpeg',
      } as Blob);
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'aggregate cached audio',
        params: {
          input_audios: [
            '/__aitu_cache__/audio/first.mp3',
            '/__aitu_cache__/audio/second.mp3',
          ],
        },
      })
    ).rejects.toThrow('音频 Data URL 合计不能超过 16 MiB');

    expect(getCachedBlob).toHaveBeenCalledTimes(2);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-public reference video addresses before submission', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'invalid reference video',
        params: { input_video: 'asset://video-123' },
      })
    ).rejects.toThrow('Seedance 2.0 参考视频仅支持公网 HTTP(S) 地址');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps legacy combined sizes as a compatibility fallback', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: 'captured' } }, 400)
    ) as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'legacy task',
        size: '480p@21:9',
        duration: 4,
      })
    ).rejects.toThrow('captured');

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      resolution: '480p',
      ratio: '21:9',
      duration: 4,
    });
  });

  it.each([
    { duration: 3, message: '视频时长必须为 4-12 秒整数' },
    { duration: 13, message: '视频时长必须为 4-12 秒整数' },
    { duration: 4.5, message: '视频时长必须为 4-12 秒整数' },
  ])('rejects invalid duration $duration before submission', async (entry) => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'duration boundary',
        size: '720p',
        duration: entry.duration,
      })
    ).rejects.toThrow(entry.message);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('backs off after transient poll errors and then recovers', async () => {
    let pollCount = 0;
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method || 'GET') === 'POST') {
          return jsonResponse({ id: 'retry-task', status: 'queued' });
        }
        pollCount += 1;
        if (pollCount === 1) {
          throw new Error('Load failed');
        }
        return jsonResponse({
          id: 'retry-task',
          status: 'completed',
          metadata: { video_url: 'https://cdn.example.com/recovered.mp4' },
        });
      }
    ) as unknown as typeof fetch;

    const resultPromise = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-0-fast-260128',
        prompt: 'recover after temporary network error',
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7500);
    const result = await resultPromise;

    expect(result.url).toBe('https://cdn.example.com/recovered.mp4');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not retry terminal failed task states', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method || 'GET') === 'POST') {
          return jsonResponse({ id: 'failed-task', status: 'queued' });
        }
        return jsonResponse({
          id: 'failed-task',
          status: 'failed',
          error: { message: 'upstream rejected prompt' },
        });
      }
    ) as unknown as typeof fetch;

    const resultPromise = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'terminal failure',
      }
    );
    const rejection = expect(resultPromise).rejects.toThrow(
      'upstream rejected prompt'
    );

    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves immediate submission failures without requiring a task ID', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ status: 'failed', error: { message: 'quota exhausted' } })
    ) as unknown as typeof fetch;

    await expect(
      seedance2VideoAdapter.generateVideo(createContext(fetcher), {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'submission failure',
      })
    ).rejects.toThrow('quota exhausted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fails immediately for non-transient poll HTTP errors', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        (init?.method || 'GET') === 'POST'
          ? jsonResponse({ id: 'bad-task', status: 'queued' })
          : jsonResponse({ error: { message: 'forbidden' } }, 403)
    ) as unknown as typeof fetch;

    const resultPromise = seedance2VideoAdapter.generateVideo(
      createContext(fetcher),
      {
        model: 'doubao-seedance-2-0-260128',
        prompt: 'forbidden poll',
      }
    );
    const rejection = expect(resultPromise).rejects.toThrow('forbidden');

    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
