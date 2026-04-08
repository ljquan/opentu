import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('audio-api-service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('polls Suno tasks when submit returns the task id as data string', async () => {
    const taskId = '01f7e7fd-8d57-4305-a3e5-fcc7e2783956';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: taskId,
            action: 'MUSIC',
            status: 'SUCCESS',
            data: [
              {
                id: 'clip-1',
                clip_id: 'clip-1',
                title: 'Starry',
                status: 'complete',
                batch_index: 0,
                audio_url: 'https://cdn1.suno.ai/clip-1.mp3',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    vi.doMock('../../utils/settings-manager', () => ({
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import('../audio-api-service');

    const result = await audioAPIService.generateAudioWithPolling({
      model: 'suno_music',
      prompt: 'write a heavy metal song',
    }, {
      interval: 1,
      maxAttempts: 2,
    });

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/music',
      baseUrlStrategy: 'trim-v1',
      method: 'POST',
    });
    expect(sendMock.mock.calls[1]?.[1]).toMatchObject({
      path: `/suno/fetch/${taskId}`,
      baseUrlStrategy: 'trim-v1',
      method: 'GET',
    });
    expect(result.taskId).toBe(taskId);
    expect(result.clips[0]?.audio_url).toBe('https://cdn1.suno.ai/clip-1.mp3');
    const extracted = extractAudioGenerationResult(result);
    expect(extracted.providerTaskId).toBe(taskId);
    expect(extracted.primaryClipId).toBe('clip-1');
    expect(extracted.clipIds).toEqual(['clip-1']);
  });

  it('fails early when task id is empty instead of querying an invalid fetch path', async () => {
    const sendMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'success', data: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    vi.doMock('../../utils/settings-manager', () => ({
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService } = await import('../audio-api-service');

    await expect(
      audioAPIService.generateAudioWithPolling({
        model: 'suno_music',
        prompt: 'write a heavy metal song',
      })
    ).rejects.toThrow('音乐生成提交成功，但未返回任务 ID');

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('treats nested success with completed clips as terminal even when wrapper status stays IN_PROGRESS', async () => {
    const taskId = 'd9d2378b-ff5e-4a2e-b0f9-01e85e9d7b72';
    const sendMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'success',
          message: '',
          data: {
            task_id: taskId,
            action: 'MUSIC',
            status: 'IN_PROGRESS',
            progress: '100%',
            data: {
              task_id: taskId,
              action: 'MUSIC',
              status: 'SUCCESS',
              data: [
                {
                  clip_id: 'clip-1',
                  batch_index: 0,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/clip-1.mp3',
                },
                {
                  clip_id: 'clip-2',
                  batch_index: 1,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/clip-2.mp3',
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    vi.doMock('../../utils/settings-manager', () => ({
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import('../audio-api-service');

    const result = await audioAPIService.resumePolling(taskId, {
      interval: 1,
      maxAttempts: 1,
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect(result.progress).toBe(100);
    expect(result.clips).toHaveLength(2);
    expect(result.clips[0]?.audio_url).toBe('https://cdn1.suno.ai/clip-1.mp3');
    const extracted = extractAudioGenerationResult(result);
    expect(extracted.providerTaskId).toBe(taskId);
    expect(extracted.primaryClipId).toBe('clip-1');
    expect(extracted.clipIds).toEqual(['clip-1', 'clip-2']);
    expect(extracted.clips).toHaveLength(2);
  });

  it('submits Suno lyrics generation and extracts text results from fetch payloads', async () => {
    const taskId = 'fc415768-51b9-4fb0-89f9-31b6863a736e';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              task_id: taskId,
              action: 'LYRICS',
              status: 'SUCCESS',
              progress: '100%',
              data: {
                tags: ['EDM, 激烈的'],
                text: '[Chorus]\\n我想象他们看我微笑着',
                title: '战斗进行时',
                status: 'complete',
                error_message: '',
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    vi.doMock('../../utils/settings-manager', () => ({
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import('../audio-api-service');

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        prompt: '编写一首儿歌',
        sunoAction: 'lyrics',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/lyrics',
      baseUrlStrategy: 'trim-v1',
      method: 'POST',
    });
    expect(result.taskId).toBe(taskId);
    expect(result.action).toBe('LYRICS');
    expect(result.status).toBe('completed');
    expect(result.lyrics?.title).toBe('战斗进行时');
    expect(result.lyrics?.tags).toEqual(['EDM, 激烈的']);

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.resultKind).toBe('lyrics');
    expect(extracted.url).toBe('');
    expect(extracted.format).toBe('lyrics');
    expect(extracted.title).toBe('战斗进行时');
    expect(extracted.lyricsTitle).toBe('战斗进行时');
    expect(extracted.lyricsText).toContain('我想象他们看我微笑着');
    expect(extracted.lyricsTags).toEqual(['EDM, 激烈的']);
    expect(extracted.providerTaskId).toBe(taskId);
  });

  it('extracts lyrics text from nested data wrappers without losing compatibility', async () => {
    const taskId = '9c02be46-2393-4867-b993-4c6722868481';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            message: '',
            data: {
              task_id: taskId,
              action: 'LYRICS',
              status: 'IN_PROGRESS',
              progress: '100%',
              data: {
                data: {
                  tags: ['traditional Chinese instrumentation, epic, rock'],
                  text: '[Verse]\\n太陽從西方升起',
                  title: '战斗神曲',
                  status: 'complete',
                  error_message: '',
                },
                action: 'LYRICS',
                status: 'SUCCESS',
                task_id: taskId,
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    vi.doMock('../../utils/settings-manager', () => ({
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import('../audio-api-service');

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_lyrics',
        prompt: '写一首战斗神曲',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(result.status).toBe('completed');
    expect(result.lyrics?.title).toBe('战斗神曲');
    expect(result.lyrics?.text).toContain('太陽從西方升起');
    expect(result.lyrics?.tags).toEqual([
      'traditional Chinese instrumentation, epic, rock',
    ]);

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.resultKind).toBe('lyrics');
    expect(extracted.lyricsTitle).toBe('战斗神曲');
    expect(extracted.lyricsText).toContain('太陽從西方升起');
    expect(extracted.lyricsTags).toEqual([
      'traditional Chinese instrumentation, epic, rock',
    ]);
  });

  it('treats the suno_lyrics model alias as a lyrics action even without explicit params', async () => {
    const taskId = '91f6eb95-6ce5-4e35-b4ae-67dca3a5dc27';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              task_id: taskId,
              action: 'LYRICS',
              status: 'SUCCESS',
              data: {
                text: '[Verse]\\n测试歌词',
                title: '别名歌词',
                tags: ['pop'],
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    vi.doMock('../../utils/settings-manager', () => ({
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import('../audio-api-service');

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_lyrics',
        prompt: '写一首流行歌歌词',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/lyrics',
      method: 'POST',
    });
    expect(result.action).toBe('LYRICS');

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.resultKind).toBe('lyrics');
    expect(extracted.lyricsTitle).toBe('别名歌词');
    expect(extracted.lyricsText).toContain('测试歌词');
  });
});
