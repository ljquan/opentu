import { beforeEach, describe, expect, it, vi } from 'vitest';
import contract from './fixtures/suno-native-contract.json';
import { audioAPIService, extractAudioGenerationResult, type AudioRequestContext } from '../audio-api-service';
import { SUNO_NATIVE_ACTIONS, isSunoNativeFieldVisible, buildSunoNativeBody, normalizeSunoNativeResponse, getSunoNativeAction, type NativeSunoAction } from '../suno-native';
import { buildSunoNativeInputParams, getSunoNativeParams, sunoNativeResourceKey } from '../suno-native-params';
import { inferBindingsForProviderModel } from '../provider-routing/binding-inference';
import { inferBindingHintFromEndpoints } from '../provider-routing/endpoint-binding-inference';
import { ModelVendor } from '../../constants/model-config';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../provider-routing', () => ({ providerTransport: { send }, resolveInvocationPlanFromRoute: vi.fn() }));
vi.mock('../../utils/settings-manager', () => ({ resolveInvocationRoute: vi.fn() }));
vi.mock('../media-executor/llm-api-logger', () => ({ startLLMApiLog: vi.fn(), completeLLMApiLog: vi.fn(), failLLMApiLog: vi.fn(), updateLLMApiLogMetadata: vi.fn() }));
const context: AudioRequestContext = { providerContext: { profileId: 'p', profileName: 'Tuzi', providerType: 'openai-compatible', baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test', authType: 'bearer' },
  binding: { id: 'native', profileId: 'p', modelId: 'suno_act_mp4', operation: 'audio', protocol: 'tuzi.suno.native', requestSchema: 'tuzi.suno.native.submit', responseSchema: 'tuzi.suno.native.task', baseUrlStrategy: 'trim-v1', priority: 400, confidence: 'high', source: 'template' } };

function request(action: NativeSunoAction): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(action.schema.properties || {})) {
    if (schema.enum) body[key] = schema.enum[0];
    else if (schema.type === 'boolean') body[key] = false;
    else if (schema.type === 'number' || schema.type === 'integer') body[key] = /End/.test(key) ? Math.max(schema.minimum ?? 0, 20) : schema.minimum ?? (/Start|At/.test(key) ? 0 : 0.5);
    else if (schema.type === 'array') body[key] = Array.from({ length: schema.minItems ?? Math.min(schema.maxItems ?? 2, 2) }, (_, i) => `https://cdn.test/${i}.mp3`);
    else if (/Url$|URL$|^url$/.test(key)) body[key] = 'https://cdn.test/input.mp3';
    else if (key === 'file' || key === 'base64Data') body[key] = 'data:audio/mpeg;base64,YQ==';
    else body[key] = key === 'uploadPath' ? 'audio/uploads' : key.includes('Id') || key.endsWith('_id') ? 'public-id' : 'value';
  }
  if (action.schema.oneOf) for (const branch of action.schema.oneOf.slice(1)) for (const key of Object.keys(branch.properties || {})) delete body[key];
  for (const [key, schema] of Object.entries(action.schema.properties || {})) if (body[key] === undefined && schema.default !== undefined) body[key] = schema.default;
  for (const key of Object.keys(body)) if (!isSunoNativeFieldVisible(action, key, body)) delete body[key];
  return body;
}
function success(action: NativeSunoAction): unknown {
  const shared = { taskId: 'public-task', status: 'SUCCESS' };
  const response = action.resultKind === 'audio' ? { ...shared, response: { sunoData: [{ id: 'public-audio', audio_url: 'https://cdn.test/song.mp3' }] } }
    : action.resultKind === 'video' ? { ...shared, response: { videoUrl: 'https://cdn.test/video.mp4' } }
    : action.resultKind === 'image' ? { ...shared, successFlag: 1, response: { images: ['https://cdn.test/cover.png'] } }
    : action.resultKind === 'lyrics' ? { ...shared, response: { data: [{ text: 'Hello', title: 'Song' }] } }
    : action.resultKind === 'persona' ? { personaId: 'public-persona', name: 'Voice' }
    : action.resultKind === 'voice' ? { ...shared, voiceId: 'public-voice' }
    : action.resultKind === 'timeline' ? { alignedWords: [{ word: 'Hello', startS: 0, endS: 1 }] }
    : action.resultKind === 'midi' ? { ...shared, successFlag: 1, midiData: { state: 'complete', instruments: [{ name: 'Piano', notes: [] }] } }
    : action.resultKind === 'text' ? { ...shared, validateInfo: 'Read this phrase', result: 'piano style' }
    : action.resultKind === 'availability' ? { isAvailable: false }
    : action.resultKind === 'credits' ? 0
    : { downloadUrl: 'https://cdn.test/upload.mp3' };
  return { code: 200, data: response };
}
const nativeActions = SUNO_NATIVE_ACTIONS.filter((action) => !action.legacy);
beforeEach(() => send.mockReset());

describe('Tuzi Suno native actions', () => {
  it('covers exactly the 26 native operation contracts verified against Tuzi routes', () => {
    expect(nativeActions.map((a) => a.path)).toEqual(contract.actions.map((a) => a.path));
  });
  it.each(nativeActions)('$action carries every schema field into its exact request and result contract', async (action) => {
    const body = request(action);
    const values = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, Array.isArray(value) ? JSON.stringify(value) : String(value)]));
    const params = buildSunoNativeInputParams('suno_act_mp4', { ...values, sunoNativeAction: action.action }, '', 'p');
    expect(params.sunoNativeBody).toEqual(body);
    expect(getSunoNativeParams('suno_act_mp4', { ...values, sunoNativeAction: action.action }).map((field) => field.id)).toEqual(['sunoNativeAction', ...Object.keys(action.schema.properties || {}).filter((key) => isSunoNativeFieldVisible(action, key, body))]);
    send.mockResolvedValueOnce(Response.json(action.pollPath ? { code: 200, data: { taskId: 'public-task' } } : success(action)));
    if (action.pollPath) send.mockResolvedValueOnce(Response.json(success(action)));
    const result = await audioAPIService.generateAudioWithPolling({ model: 'suno_act_mp4', prompt: '', params }, { requestContext: context, interval: 0, maxAttempts: 1 });
    expect(send.mock.calls[0][1]).toMatchObject({ path: action.path, method: action.method });
    if (action.mime === 'multipart/form-data') {
      const form = send.mock.calls[0][1].body as FormData;
      expect(form.get('file')).toBeInstanceOf(Blob); expect(form.get('uploadPath')).toBe(body.uploadPath);
      expect(send.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
    } else if (action.method !== 'GET') expect(JSON.parse(send.mock.calls[0][1].body)).toEqual(body);
    if (action.pollPath) expect(send.mock.calls[1][1]).toMatchObject({ method: 'GET', path: `${action.pollPath}?taskId=public-task` });
    else expect(send).toHaveBeenCalledOnce();
    expect(result.status).toBe('completed');
    const extracted = extractAudioGenerationResult(result);
    expect(extracted.analysisData).toMatchObject({ sunoNative: { action: action.action, profileId: 'p' } });
    if (['video', 'image', 'midi', 'voice', 'text', 'availability', 'credits', 'upload', 'persona', 'timeline'].includes(action.resultKind)) expect(extracted.url).toBe('');
  });
  it('recovers the selected action using only its own record-info query and escaped public ID', async () => {
    send.mockResolvedValueOnce(Response.json(success(getSunoNativeAction('suno_act_mp4'))));
    const result = await audioAPIService.resumePolling('public task/&', { routeModel: 'suno_act_wav', requestContext: context, params: { sunoNativeAction: 'mp4' } });
    expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][1].path).toBe('/suno/api/v1/mp4/record-info?taskId=public%20task%2F%26');
    expect(result.taskId).toBe('public task/&');
  });
  it('distinguishes in-progress numeric flags from terminal failure for each endpoint', () => {
    const mp4 = getSunoNativeAction('suno_act_mp4');
    expect(normalizeSunoNativeResponse({ code: 200, data: { successFlag: 2 } }, mp4, 'p', 'task').status).toBe('processing');
    expect(normalizeSunoNativeResponse({ code: 200, data: { successFlag: 'GENERATE_MP4_FAILED' } }, mp4, 'p', 'task').status).toBe('failed');
    const midi = getSunoNativeAction('suno_act_midi');
    expect(normalizeSunoNativeResponse({ code: 200, data: { successFlag: 2 } }, midi, 'p', 'task').status).toBe('failed');
  });
  it('rejects envelope failure, empty success, unknown action, and wrong protocol', async () => {
    const mp4 = getSunoNativeAction('suno_act_mp4');
    expect(() => normalizeSunoNativeResponse({ code: 400, msg: 'bad' }, mp4, 'p')).toThrow('bad');
    expect(() => normalizeSunoNativeResponse({ code: 200, data: { status: 'SUCCESS' } }, mp4, 'p')).toThrow('有效结果');
    expect(() => getSunoNativeAction('suno_act_mp4', { sunoNativeAction: 'unknown' })).toThrow('未知');
    await expect(audioAPIService.submitAudioGeneration({ model: 'suno_act_mp4', prompt: '', params: { sunoNativeBody: request(mp4) } }, { ...context, binding: { ...(context.binding as NonNullable<AudioRequestContext['binding']>), protocol: 'tuzi.suno.v2' } })).rejects.toThrow('其他协议');
  });
  it('validates callback URLs, source choices, resource ownership and related IDs', () => {
    const mp4 = getSunoNativeAction('suno_act_mp4'); const body = request(mp4);
    const build = (patch: Record<string, unknown>, resources: unknown[] = []) => buildSunoNativeBody({ model: 'suno_act_mp4', prompt: '', params: { sunoNativeBody: { ...body, ...patch }, sunoNativeResources: resources } }, 'p');
    expect(() => build({ callBackUrl: ['javascript', 'alert(1)'].join(':') })).toThrow('HTTP');
    expect(() => build({ audioId: 'foreign' }, [{ profileId: 'other', audioId: 'foreign' }])).toThrow('其他渠道');
    expect(() => build({ audioId: 'local' }, [{ profileId: 'p', taskId: 'other-task', audioId: 'local' }])).toThrow('同一结果');
    const params = { sunoNativeAction: 'stems', sunoNativeBody: { callBackUrl: 'https://callback.test', taskId: 't', audioId: 'a', audioUrl: 'https://cdn.test/a.mp3' } };
    expect(() => buildSunoNativeBody({ model: 'suno_act_stems', prompt: '', params }, 'p')).toThrow('一种来源');
  });
  it('infers native bindings for the screenshot entries without v2 or chat fallback', () => {
    const profile = { id: 'p', name: 'Tuzi', providerType: 'openai-compatible' as const, baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'test', authType: 'bearer' as const };
    for (const id of ['suno_act_mp4', 'suno_act_midi', 'suno_act_vox', 'suno_persona_create', 'suno_act_tags']) {
      const bindings = inferBindingsForProviderModel(profile, { id, label: id, vendor: ModelVendor.SUNO, type: 'text' });
      expect(bindings).toHaveLength(1); expect(bindings[0].protocol).toBe('tuzi.suno.native');
      expect(bindings[0].submitPath).toBe(getSunoNativeAction(id).path);
    }
  });
});

describe('native Suno workflow boundaries', () => {
  it.each(['legacy-upload', 'legacy-concat', 'upload-url'])('%s uses the exact legacy query when Tuzi returns an asynchronous proxy task', async (actionName) => {
    const action = getSunoNativeAction('suno_uploads', { sunoNativeAction: actionName });
    send.mockResolvedValueOnce(Response.json({ code: 'success', data: 'public-upload' }));
    send.mockResolvedValueOnce(Response.json({ code: 'success', data: { task_id: 'public-upload', status: 'SUCCESS', data: [{ id: 'public-clip', audio_url: 'https://cdn.test/upload.mp3' }] } }));
    const result = await audioAPIService.generateAudioWithPolling({ model: 'suno_uploads', prompt: '', params: { sunoNativeAction: actionName, sunoNativeBody: request(action) } }, { requestContext: context, interval: 0, maxAttempts: 1 });
    expect(send.mock.calls[0][1].path).toBe(action.path);
    expect(send.mock.calls[1][1].path).toBe('/suno/fetch/public-upload');
    expect(result.sunoNative?.resources).toContainEqual(expect.objectContaining({ taskId: 'public-upload', audioId: 'public-clip', profileId: 'p' }));
  });
  it('preserves file bytes, filename, and multipart fields without a JSON content type', async () => {
    send.mockResolvedValueOnce(Response.json({ code: 200, data: { downloadUrl: 'https://cdn.test/file.wav' } }));
    await audioAPIService.submitAudioGeneration({ model: 'suno_uploads', prompt: '', params: { sunoNativeAction: 'upload-stream', sunoNativeBody: { file: 'data:audio/wav;base64,YWJj', uploadPath: 'audio', fileName: 'my.wav' } } }, context);
    const form = send.mock.calls[0][1].body as FormData;
    const file = form.get('file') as File;
    const contents = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(file); });
    expect(contents).toBe('abc'); expect(file.name).toBe('my.wav'); expect(form.get('uploadPath')).toBe('audio');
  });
  it('reuses the same resource when task ordering changes and rejects removed sources', () => {
    const first = { profileId: 'p', sourceAction: 'generate', taskId: 't1', audioId: 'a1', url: 'https://cdn.test/a.mp3' };
    const second = { ...first, taskId: 't2', audioId: 'a2' };
    const values = { sunoNativeAction: 'stems', sunoNativeSource: sunoNativeResourceKey(first), callBackUrl: 'https://callback.test' };
    const params = buildSunoNativeInputParams('suno_act_stems', values, '', 'p', [second, first]);
    expect(params.sunoNativeBody).toMatchObject({ taskId: 't1', audioId: 'a1' });
    expect(params.sunoNativeBody.audioUrl).toBeUndefined();
    expect(() => buildSunoNativeInputParams('suno_act_stems', values, '', 'p', [second])).toThrow('已不可用');
  });
  it('does not fabricate callbacks and preserves the voice regenerate spelling', () => {
    expect(() => buildSunoNativeInputParams('suno_act_mp4', { taskId: 't', audioId: 'a' }, '', 'p')).toThrow('callBackUrl');
    expect(buildSunoNativeInputParams('suno_act_mp4', { sunoNativeAction: 'voice-regenerate', taskId: 't', calBackUrl: 'https://callback.test' }, '', 'p').sunoNativeBody).toEqual({ taskId: 't', calBackUrl: 'https://callback.test' });
  });
  it('accepts both documented source branches and rejects an invalid prerequisite', () => {
    expect(buildSunoNativeInputParams('suno_act_stems', { audioUrl: 'https://cdn.test/a.mp3', callBackUrl: 'https://callback.test' }, '', 'p').sunoNativeBody.audioUrl).toBe('https://cdn.test/a.mp3');
    expect(() => buildSunoNativeInputParams('suno_act_stems', { taskId: 'only-task', callBackUrl: 'https://callback.test' }, '', 'p')).toThrow('一种来源');
  });
  it('times out pending work and reports provider failure without resubmission', async () => {
    send.mockImplementation(async () => Response.json({ code: 200, data: { taskId: 't', status: 'PENDING' } }));
    const params = { model: 'suno_act_mp4', prompt: '', params: { sunoNativeBody: request(getSunoNativeAction('suno_act_mp4')) } };
    await expect(audioAPIService.generateAudioWithPolling(params, { requestContext: context, interval: 0, maxAttempts: 2 })).rejects.toThrow('超时');
    expect(send.mock.calls.map((call) => call[1].method)).toEqual(['POST', 'GET', 'GET']);
    send.mockReset();
    send.mockResolvedValueOnce(Response.json({ code: 200, data: { taskId: 't' } }));
    send.mockResolvedValueOnce(Response.json({ code: 200, data: { status: 'GENERATE_MP4_FAILED', errorMessage: 'provider rejected' } }));
    await expect(audioAPIService.generateAudioWithPolling(params, { requestContext: context, interval: 0 })).rejects.toThrow('provider rejected');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('cancels polling locally without submitting a replacement', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(audioAPIService.resumePolling('t', { routeModel: 'suno_act_mp4', requestContext: { ...context, signal: controller.signal }, assertAvailable: () => controller.signal.throwIfAborted() })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it('does not confuse MIDI download files with playable audio', () => {
    const response = normalizeSunoNativeResponse({ code: 200, data: { status: 'SUCCESS', midiUrl: 'https://cdn.test/song.mid' } }, getSunoNativeAction('suno_act_midi'), 'p', 'public');
    expect(response.sunoNative?.files[0].kind).toBe('midi');
    expect(extractAudioGenerationResult(response)).toMatchObject({ url: '', format: 'json' });
  });
});

it('recognizes native endpoint metadata and never maps record-info or unknown native paths to legacy', () => {
  expect(inferBindingHintFromEndpoints({ native: { path: '/suno/api/v1/mp4/generate', method: 'POST' } })).toMatchObject({ protocol: 'tuzi.suno.native', submitPath: '/suno/api/v1/mp4/generate' });
  expect(inferBindingHintFromEndpoints({ query: { path: '/suno/api/v1/mp4/record-info', method: 'GET' } })).toBeNull();
  expect(inferBindingHintFromEndpoints({ unknown: { path: '/suno/api/unknown', method: 'POST' } })).toBeNull();
});

it('validates custom mode without making the optional title mandatory and omits hidden controls', () => {
  const values = { customMode: 'true', instrumental: 'true', style: 'piano', callBackUrl: 'https://callback.test', model: 'V6', imageUrls: 'https://cdn.test/image.png' };
  const params = buildSunoNativeInputParams('suno_native_generate', values, '', 'p');
  expect(params.sunoNativeBody.title).toBeUndefined(); expect(params.sunoNativeBody.imageUrls).toBeUndefined();
  expect(() => buildSunoNativeInputParams('suno_native_generate', { ...values, style: '' }, '', 'p')).toThrow('至少');
  expect(() => buildSunoNativeBody({ model: 'suno_native_generate', prompt: '', params: { sunoNativeBody: { ...params.sunoNativeBody, variety: 0.5 } } }, 'p')).toThrow('步长');
});

it('completes the validation phrase step when it is ready for user recording', () => {
  const action = getSunoNativeAction('suno_act_mp4', { sunoNativeAction: 'voice-validate' });
  expect(normalizeSunoNativeResponse({ code: 200, data: { status: 'wait_validating', validateInfo: 'Read aloud' } }, action, 'p', 'public')).toMatchObject({ status: 'completed', taskId: 'public' });
});
it('uses a public voice ID with voice_persona in follow-up music', () => {
  const resource = { profileId: 'p', sourceAction: 'voice-generate', taskId: 'public-task', voiceId: 'public-voice' };
  const params = buildSunoNativeInputParams('suno_native_generate', { sunoNativeSource: sunoNativeResourceKey(resource), customMode: 'true', instrumental: 'false', style: 'pop', lyrics: 'hello', callBackUrl: 'https://callback.test' }, '', 'p', [resource]);
  expect(params.sunoNativeBody).toMatchObject({ personaId: 'public-voice', personaModel: 'voice_persona' });
});
