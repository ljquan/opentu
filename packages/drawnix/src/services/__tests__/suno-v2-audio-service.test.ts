import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioAPIService, extractAudioGenerationResult } from '../audio-api-service';
import type { AudioRequestContext } from '../audio-api-service';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../provider-routing', () => ({
  providerTransport: { send: mocks.send },
  resolveInvocationPlanFromRoute: vi.fn(),
}));
vi.mock('../media-executor/llm-api-logger', () => ({
  startLLMApiLog: vi.fn(), completeLLMApiLog: vi.fn(),
  failLLMApiLog: vi.fn(), updateLLMApiLogMetadata: vi.fn(),
}));
vi.mock('../../utils/settings-manager', () => ({ resolveInvocationRoute: vi.fn() }));

const context: AudioRequestContext = {
  providerContext: { profileId: 'p', profileName: 'Tuzi', providerType: 'openai-compatible',
    baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test', authType: 'bearer' },
  binding: { id: 'v2', profileId: 'p', modelId: 'suno/music', operation: 'audio', protocol: 'tuzi.suno.v2',
    requestSchema: 'tuzi.suno.v2.submit', responseSchema: 'tuzi.suno.v2.task', submitPath: '/suno/v2/music',
    pollPathTemplate: '/suno/v2/fetch/{taskId}', baseUrlStrategy: 'trim-v1',
    priority: 400, confidence: 'high', source: 'template' },
};
const completed = { code: 'success', data: { task_id: 'public-task', action: 'music', status: 'SUCCESS',
  data: { musics: [{ music_id: 'public-music', audio_url: 'https://cdn.test/song.mp3' }] } } };
const options = { routeModel: 'suno/music', requestContext: context, interval: 0, maxAttempts: 2 };

describe('Suno v2 audio execution', () => {
  beforeEach(() => mocks.send.mockReset());

  it('submits native JSON, polls the original channel and persists the task ID before polling', async () => {
    const submitted = vi.fn();
    mocks.send.mockResolvedValueOnce(Response.json({ code: 'success', data: { task_id: 'public-task' } }))
      .mockImplementationOnce(() => {
        expect(submitted).toHaveBeenCalledWith('public-task');
        return Response.json({ code: 'success', data: { task_id: 'public-task', status: 'IN_PROGRESS' } });
      }).mockResolvedValueOnce(Response.json(completed));
    const result = await audioAPIService.generateAudioWithPolling({
      model: 'suno/music', prompt: 'piano', params: { sunoV2Body: {
        custom: false, instrumental: false, gpt_description_prompt: 'piano',
      } },
    }, { ...options, onSubmitted: submitted });
    expect(mocks.send.mock.calls[0]).toEqual([context.providerContext, expect.objectContaining({
      path: '/suno/v2/music', method: 'POST', baseUrlStrategy: 'trim-v1',
    })]);
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toEqual({
      custom: false, instrumental: false, gpt_description_prompt: 'piano',
    });
    expect(mocks.send.mock.calls.slice(1).map((call) => call[1])).toEqual([
      expect.objectContaining({ path: '/suno/v2/fetch/public-task', method: 'GET' }),
      expect.objectContaining({ path: '/suno/v2/fetch/public-task', method: 'GET' }),
    ]);
    expect(extractAudioGenerationResult(result)).toMatchObject({
      providerTaskId: 'public-task', analysisData: { sunoV2: { resources: [{ id: 'public-music', profileId: 'p' }] } },
    });
  });

  it('recovers by fetch without resubmitting', async () => {
    mocks.send.mockResolvedValueOnce(Response.json(completed));
    expect((await audioAPIService.resumePolling('public-task', options)).status).toBe('completed');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][1]).toMatchObject({ path: '/suno/v2/fetch/public-task', method: 'GET' });
  });

  it.each(['suno/create-voice', 'suno/add-instrumental', 'suno/add-vocals'])('blocks new %s submissions before transport', async (model) => {
    await expect(audioAPIService.generateAudioWithPolling({ model, prompt: '', params: { sunoV2Body: {} } }, options)).rejects.toThrow('不可用');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'failure', message: 'rejected' },
    { code: 'success', data: { task_id: 't', status: 'FAILURE', fail_reason: 'rejected' } },
    { code: 'success', data: { task_id: 't', action: 'music', status: 'SUCCESS', musics: [] } },
  ])('does not retry HTTP 200 business failures or empty success', async (payload) => {
    mocks.send.mockResolvedValueOnce(Response.json({ code: 'success', data: { task_id: 't', status: 'IN_PROGRESS' } }))
      .mockResolvedValue(Response.json(payload));
    await expect(audioAPIService.resumePolling('t', options)).rejects.toMatchObject({ workflowProviderFailure: true });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('times out with only fetches while the remote task stays pending', async () => {
    mocks.send.mockImplementation(() => Response.json({ code: 'success', data: { task_id: 't', status: 'IN_PROGRESS' } }));
    await expect(audioAPIService.resumePolling('t', { ...options, maxAttempts: 1 })).rejects.toThrow('超时');
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
  });

  it('rejects legacy bindings and unavailable actions before transport', async () => {
    await expect(audioAPIService.submitAudioGeneration({ model: 'suno/music', prompt: 'piano' }, {
      ...context, binding: { ...context.binding!, protocol: 'tuzi.suno.music' },
    })).rejects.toThrow('绑定');
    await expect(audioAPIService.submitAudioGeneration({ model: 'suno/not-a-real-action', prompt: '' }, context)).rejects.toThrow('不可用');
    await expect(audioAPIService.submitAudioGeneration({ model: 'suno_music', prompt: 'piano' }, context)).rejects.toThrow('绑定');
    await expect(audioAPIService.queryAudioTask('t', 'suno_music', context)).rejects.toThrow('绑定');
    await expect(audioAPIService.queryAudioTask('t', 'suno/music', {
      ...context, binding: { ...context.binding!, protocol: 'tuzi.suno.music' },
    })).rejects.toThrow('绑定');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
