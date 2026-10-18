import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from './fixtures/suno-v2-contract.json';
import { audioAPIService, extractAudioGenerationResult, type AudioRequestContext } from '../audio-api-service';
import { buildSunoV2Body, getSunoV2Action, getSunoV2Fields, normalizeSunoV2Response, type SunoV2Resource } from '../suno-v2';
import { buildSunoV2InputParams } from '../suno-v2-params';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../provider-routing', () => ({ providerTransport: { send }, resolveInvocationPlanFromRoute: vi.fn() }));
vi.mock('../../utils/settings-manager', () => ({ resolveInvocationRoute: vi.fn() }));
vi.mock('../media-executor/llm-api-logger', () => ({
  startLLMApiLog: vi.fn(), completeLLMApiLog: vi.fn(), failLLMApiLog: vi.fn(), updateLLMApiLogMetadata: vi.fn(),
}));

function resourcesFor(body: Record<string, unknown>): SunoV2Resource[] {
  return Object.entries(body).flatMap(([name, value]) => {
    const kind = name === 'mashup_music_id' ? 'music_id' : name;
    if (!['music_id', 'persona_id', 'model_id', 'file_id'].includes(kind)) return [];
    return (Array.isArray(value) ? value : [value]).map((id) => ({ id: String(id), kind: kind as SunoV2Resource['kind'], profileId: 'p' }));
  });
}
const provider: AudioRequestContext['providerContext'] = { profileId: 'p', profileName: 'Tuzi',
  providerType: 'openai-compatible', baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test', authType: 'bearer' };

describe('Tuzi native Suno contract fixtures', () => {
  beforeEach(() => send.mockReset());
  it.each(fixtures.actions.filter((fixture) => getSunoV2Action(fixture.model)?.supported))('$model submits its documented body and fetches its documented result', async (fixture) => {
    const definition = getSunoV2Action(fixture.model);
    expect(definition?.supported).toBe(true);
    const params = { sunoV2Body: fixture.request, sunoV2Resources: resourcesFor(fixture.request) };
    expect(buildSunoV2Body({ model: fixture.model, prompt: '', params }, 'p')).toEqual(fixture.request);
    const requestContext: AudioRequestContext = { providerContext: provider, binding: {
      id: fixture.action, profileId: 'p', modelId: fixture.model, operation: 'audio', protocol: 'tuzi.suno.v2',
      requestSchema: 'tuzi.suno.v2.submit', responseSchema: 'tuzi.suno.v2.task', submitPath: fixture.path,
      pollPathTemplate: '/suno/v2/fetch/{taskId}', baseUrlStrategy: 'trim-v1',
      priority: 400, confidence: 'high', source: 'template',
    } };
    send.mockResolvedValueOnce(Response.json({ code: 'success', data: { task_id: 'public-task' } }))
      .mockResolvedValueOnce(Response.json(fixture.response));
    const response = await audioAPIService.generateAudioWithPolling({ model: fixture.model, prompt: '', params },
      { routeModel: fixture.model, requestContext, interval: 0, maxAttempts: 1 });
    expect(send.mock.calls[0][1]).toMatchObject({ method: 'POST', path: fixture.path });
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual(fixture.request);
    expect(send.mock.calls[1][1]).toMatchObject({ method: 'GET', path: '/suno/v2/fetch/public-task' });
    expect(response.status).toBe('completed');
    expect(extractAudioGenerationResult(response).analysisData).toMatchObject({ sunoV2: { action: fixture.action, profileId: 'p' } });
  });

  it.each(fixtures.actions.filter((fixture) => getSunoV2Action(fixture.model)?.supported))('$model carries every documented UI parameter into a valid native body', (fixture) => {
    const values = Object.fromEntries(Object.entries(fixture.request).map(([key, value]) => [key, Array.isArray(value) ? JSON.stringify(value) : String(value)]));
    const body = buildSunoV2InputParams(fixture.model, values, '', 'p', resourcesFor(fixture.request)).sunoV2Body;
    expect(body).toMatchObject(fixture.request);
    expect(Object.keys(body).every((name) => getSunoV2Fields(fixture.model).some((field) => field.name === name))).toBe(true);
  });

  it.each(fixtures.actions.filter((fixture) => !getSunoV2Action(fixture.model)?.supported))('$model rejects submission despite a documented schema', async (fixture) => {
    const params = { sunoV2Body: fixture.request, sunoV2Resources: resourcesFor(fixture.request) };
    expect(() => buildSunoV2Body({ model: fixture.model, prompt: '', params }, 'p')).toThrow('不可用');
    expect(() => buildSunoV2InputParams(fixture.model, {}, '', 'p', [])).toThrow('不可用');
    await expect(audioAPIService.submitAudioGeneration({ model: fixture.model, prompt: '', params })).rejects.toThrow('不可用');
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['aligned-lyrics', 'gen-midi', 'upsample-tags'])('rejects empty %s results', (action) => {
    expect(() => normalizeSunoV2Response({ status: 'SUCCESS', action, result: {} }, 't', 'p')).toThrow('有效结果');
  });
  it('preserves MIDI download links without passing them to audio playback or caching', () => {
    const response = normalizeSunoV2Response({ status: 'SUCCESS', action: 'gen-midi',
      result: { instruments: [{ name: 'Piano', midi_url: 'https://cdn.test/piano.mid' }] } }, 't', 'p');
    expect(extractAudioGenerationResult(response)).toMatchObject({ url: '', urls: [], format: 'json',
      analysisData: { sunoV2: { files: [{ format: 'midi', fileUrl: 'https://cdn.test/piano.mid' }] } } });
  });
});
