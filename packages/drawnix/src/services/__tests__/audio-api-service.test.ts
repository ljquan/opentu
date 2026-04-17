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

  it('sends continue and infill parameters in Suno music submit body', async () => {
    const taskId = 'b16bca7d-17ee-41fd-a218-31ca5fda0ac9';
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
                clip_id: 'clip-continue-1',
                batch_index: 0,
                status: 'complete',
                audio_url: 'https://cdn1.suno.ai/clip-continue-1.mp3',
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

    const { audioAPIService } = await import('../audio-api-service');

    await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        prompt: '继续完善副歌',
        continueClipId: 'clip-continue-1',
        continueTaskId: 'task-continue-1',
        continueAt: 32,
        infillStartS: 8,
        infillEndS: 16,
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/music',
      method: 'POST',
    });
    expect(JSON.parse(sendMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      prompt: '继续完善副歌',
      continue_clip_id: 'clip-continue-1',
      task_id: 'task-continue-1',
      continue_at: 32,
      infill_start_s: 8,
      infill_end_s: 16,
    });
  });

  it('remembers clip_id discovered during polling and reuses it for continuation ids', async () => {
    const taskId = 'a1a214aa-b4b2-4744-9d05-7977b9fcf6b9';
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
              action: 'MUSIC',
              status: 'IN_PROGRESS',
              progress: '30%',
              data: [
                {
                  id: 'song-row-1',
                  clip_id: 'continue-clip-1',
                  batch_index: 0,
                  status: 'queued',
                },
                {
                  id: 'song-row-2',
                  clip_id: 'continue-clip-2',
                  batch_index: 1,
                  status: 'queued',
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              task_id: taskId,
              action: 'MUSIC',
              status: 'SUCCESS',
              data: [
                {
                  id: 'final-row-1',
                  batch_index: 0,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/final-1.mp3',
                },
                {
                  id: 'final-row-2',
                  batch_index: 1,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/final-2.mp3',
                },
              ],
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
        prompt: '写一首儿歌',
      },
      {
        interval: 1,
        maxAttempts: 3,
      }
    );

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.primaryClipId).toBe('continue-clip-1');
    expect(extracted.clipIds).toEqual(['continue-clip-1', 'continue-clip-2']);
    expect(extracted.clips?.map((clip) => clip.clipId)).toEqual([
      'continue-clip-1',
      'continue-clip-2',
    ]);
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
