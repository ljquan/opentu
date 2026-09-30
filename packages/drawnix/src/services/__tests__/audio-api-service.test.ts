import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('audio-api-service', () => {
  it('cancels the polling delay immediately without another query', async () => {
    const { audioAPIService } = await import('../audio-api-service');
    const query = vi.spyOn(audioAPIService, 'queryAudioTask').mockResolvedValue({ taskId: 'remote', status: 'submitted', clips: [], failReason: '', raw: { task_id: 'remote', status: 'SUBMITTED' } } as Awaited<ReturnType<typeof audioAPIService.queryAudioTask>>);
    const controller = new AbortController();
    vi.useFakeTimers();
    try {
      const pending = audioAPIService.resumePolling('remote', { requestContext: { signal: controller.signal } });
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await rejection;
      expect(query).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { query.mockRestore(); vi.useRealTimers(); }
  });
  it.each([false, true])('does not retry a confirmed audio failure (already failed: %s)', async immediate => {
    const { audioAPIService } = await import('../audio-api-service');
    const query = vi.spyOn(audioAPIService, 'queryAudioTask');
    const response = (status: string) => ({ taskId: 'remote', status: status.toLowerCase(), clips: [], failReason: 'provider rejected', raw: { task_id: 'remote', status, fail_reason: 'provider rejected' } }) as Awaited<ReturnType<typeof audioAPIService.queryAudioTask>>;
    if (!immediate) query.mockResolvedValueOnce(response('SUBMITTED'));
    query.mockResolvedValue(response('FAILED'));
    try {
      await expect(audioAPIService.resumePolling('remote', { interval: 0, maxAttempts: 1 })).rejects.toMatchObject({ workflowProviderFailure: true });
      expect(query).toHaveBeenCalledTimes(immediate ? 1 : 2);
    } finally { query.mockRestore(); }
  });
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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        prompt: 'write a heavy metal song',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
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
        instrumental: true,
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
    expect(
      JSON.parse(sendMock.mock.calls[0]?.[1]?.body as string)
    ).toMatchObject({
      prompt: '继续完善副歌',
      make_instrumental: true,
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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

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
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
      resolveInvocationRoute: () => ({
        profileId: 'runtime',
        profileName: 'Runtime',
        providerType: 'custom',
        baseUrl: 'https://api.tu-zi.com/v1',
        apiKey: 'test-key',
        authType: 'bearer',
      }),
    }));

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

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

describe('audio result recovery regressions', () => {
  const taskId = 'task-existing-suno';
  const urls = [
    'https://cdn.example.com/one.mp3',
    'https://cdn.example.com/two.mp3',
  ];

  async function setup(
    payloads: unknown[],
    manualHttp?: Record<string, unknown>
  ) {
    vi.resetModules();
    const send = vi.fn();
    for (const payload of payloads) {
      send.mockResolvedValueOnce(
        new Response(JSON.stringify(payload), { status: 200 })
      );
    }
    const provider = {
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    };
    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () =>
          manualHttp
            ? {
                provider,
                binding: {
                  metadata: { manualHttp },
                  submitPath: '/suno/submit/music',
                },
              }
            : null,
        providerTransport: { send },
      };
    });
    vi.doMock('../../utils/settings-manager', () => ({
      providerPricingCacheSettings: { get: () => null, update: vi.fn() },
      resolveInvocationRoute: () => provider,
    }));
    return { ...(await import('../audio-api-service')), send };
  }

  it.each(['immediate', 'poll', 'submit'] as const)(
    'retains configured response paths and two unique URLs during %s recovery',
    async (mode) => {
      const complete = {
        output: {
          phase: 'completed',
          tracks: urls.map((url) => ({ file: url })),
        },
      };
      const payloads =
        mode === 'immediate'
          ? [complete]
          : mode === 'poll'
          ? [{ output: { phase: 'processing' } }, complete]
          : [{ job: taskId }, complete];
      const { audioAPIService, extractAudioGenerationResult, send } =
        await setup(payloads, {
          responsePaths: { taskId: 'job' },
          pollResponsePaths: {
            status: 'output.phase',
            audioUrls: 'output.tracks.*.file',
          },
        });
      const options = { interval: 1, maxAttempts: 1, routeModel: 'suno_music' };
      const result =
        mode === 'submit'
          ? await audioAPIService.generateAudioWithPolling(
              { model: 'suno_music', prompt: 'test' },
              options
            )
          : await audioAPIService.resumePolling(taskId, options);
      expect(result.clips.map((clip) => clip.audio_url)).toEqual(urls);
      expect(extractAudioGenerationResult(result).urls).toEqual(urls);
      expect(send).toHaveBeenCalledTimes(payloads.length);
    }
  );

  it('recovers both camelCase clips in nested result and task wrappers', async () => {
    const { audioAPIService, extractAudioGenerationResult } = await setup([
      {
        data: {
          result: {
            task: {
              clips: urls.map((audioUrl, batchIndex) => ({
                clipId: `clip-${batchIndex}`,
                audioUrl,
                batchIndex,
                status: 'complete',
                imageUrl: 'https://cdn.example.com/cover.jpeg',
              })),
            },
          },
        },
      },
    ]);
    const result = await audioAPIService.resumePolling(taskId, {
      maxAttempts: 1,
    });
    const extracted = extractAudioGenerationResult(result);
    expect(result.status).toBe('completed');
    expect(extracted.urls).toEqual(urls);
    expect(extracted.clipIds).toEqual(['clip-0', 'clip-1']);
    expect(extracted.imageUrl).toBe('https://cdn.example.com/cover.jpeg');
  });

  it.each(['audio_urls', 'audioUrls'])(
    'recovers a completed %s URL list',
    async (field) => {
      const { audioAPIService } = await setup([
        { status: 'SUCCESS', data: { [field]: urls } },
      ]);
      const result = await audioAPIService.resumePolling(taskId, {
        maxAttempts: 1,
      });
      expect(result.clips.map((clip) => clip.audio_url)).toEqual(urls);
    }
  );

  it('does not finish a successful task without any usable audio URL', async () => {
    const { audioAPIService, send } = await setup([
      { status: 'SUCCESS', data: { audio_urls: ['', null] } },
      { status: 'SUCCESS', data: { audio_urls: ['', null] } },
    ]);
    await expect(
      audioAPIService.resumePolling(taskId, { interval: 1, maxAttempts: 1 })
    ).rejects.toThrow('Suno 生成超时');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('preserves failure clips even when the provider omits identifiers and URLs', async () => {
    const { audioAPIService } = await setup([
      {
        status: 'IN_PROGRESS',
        data: [
          {
            status: 'failed',
            metadata: { error_message: 'provider rejected' },
          },
        ],
      },
    ]);
    await expect(audioAPIService.resumePolling(taskId)).rejects.toThrow(
      'provider rejected'
    );
  });

  it('prefers full clips over a URL-list fallback and preserves continuation metadata', async () => {
    const clips = urls.map((audio_url, batch_index) => ({
      clip_id: `provider-${batch_index}`,
      audio_url,
      batch_index,
      image_url: 'https://cdn.example.com/cover.jpeg',
      status: 'complete',
    }));
    const { audioAPIService, extractAudioGenerationResult } = await setup([
      { status: 'SUCCESS', audio_urls: urls, data: { clips } },
    ]);
    const result = extractAudioGenerationResult(
      await audioAPIService.resumePolling(taskId)
    );
    expect(result.urls).toEqual(urls);
    expect(result.clipIds).toEqual(['provider-0', 'provider-1']);
    expect(result.imageUrl).toBe('https://cdn.example.com/cover.jpeg');
  });

  it.each(['items', 'results'])(
    'ignores %s summaries before deeper audio clips',
    async (key) => {
      const { audioAPIService } = await setup([
        {
          status: 'SUCCESS',
          [key]: [{ id: 'summary', status: 'failed' }],
          data: { result: { clips: urls.map((audioUrl) => ({ audioUrl })) } },
        },
      ]);
      const result = await audioAPIService.resumePolling(taskId, {
        interval: 1,
        maxAttempts: 1,
      });
      expect(result.clips.map((clip) => clip.audio_url)).toEqual(urls);
    }
  );

  it.each(['clips', 'audio_urls'])(
    'uses nested task status without per-clip status for %s',
    async (key) => {
      const { audioAPIService } = await setup([
        {
          data: {
            result: {
              task: {
                status: 'SUCCESS',
                progress: '100%',
                [key]:
                  key === 'clips'
                    ? urls.map((audioUrl) => ({ audioUrl }))
                    : urls,
              },
            },
          },
        },
      ]);
      const result = await audioAPIService.resumePolling(taskId, {
        interval: 1,
        maxAttempts: 1,
      });
      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.clips.map((clip) => clip.audio_url)).toEqual(urls);
    }
  );

  it.each(['IN_PROGRESS', 'FAILED'])(
    'respects nested %s status even with audio URLs',
    async (status) => {
      const payload = {
        data: { result: { task: { status, audio_urls: urls } } },
      };
      const { audioAPIService, send } = await setup([payload, payload]);
      await expect(
        audioAPIService.resumePolling(taskId, { interval: 1, maxAttempts: 1 })
      ).rejects.toThrow(status === 'FAILED' ? '音乐生成失败' : 'Suno 生成超时');
      expect(send).toHaveBeenCalledTimes(status === 'FAILED' ? 1 : 2);
    }
  );

  it.each(['immediate', 'poll', 'submit'] as const)(
    'preserves native lyrics with a manual template during %s',
    async (mode) => {
      const complete = {
        data: {
          task_id: taskId,
          action: 'LYRICS',
          status: 'SUCCESS',
          data: { text: 'test lyrics', title: 'Song', status: 'complete' },
        },
      };
      const payloads =
        mode === 'immediate'
          ? [complete]
          : mode === 'poll'
          ? [{ status: 'IN_PROGRESS' }, complete]
          : [{ job: taskId }, complete];
      const { audioAPIService, extractAudioGenerationResult } = await setup(
        payloads,
        {
          responsePaths: { taskId: 'job' },
          pollResponsePaths: { status: 'data.status' },
        }
      );
      const options = {
        interval: 1,
        maxAttempts: 1,
        routeModel: 'suno_lyrics',
      };
      const result =
        mode === 'submit'
          ? await audioAPIService.generateAudioWithPolling(
              { model: 'suno_lyrics', prompt: 'test' },
              options
            )
          : await audioAPIService.resumePolling(taskId, options);
      expect(result.action).toBe('LYRICS');
      expect(extractAudioGenerationResult(result)).toMatchObject({
        resultKind: 'lyrics',
        lyricsText: 'test lyrics',
      });
    }
  );
});
