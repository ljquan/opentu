import 'fake-indexeddb/auto';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTuziModels } from '../src/services/tuzi-model-discovery';
import { nativeModel, getNativeParameterValues, setNativeParameterValue } from '../src/integration/native-parameters';
import { defaultConfig, type AiConfig } from '../src/stores/use-config-store';
import { createVideoGenerationTask, pollVideoGenerationTask } from '../src/services/api/video';

const modelId = 'tuzi::MiniMax-H3';
function configFor(name = 'MiniMax-H3'): AiConfig {
  const [model] = parseTuziModels({ success: true, data: [{ model_name: name, tags: ['video'], hot_rank: 1 }] }, 'hot');
  return { ...defaultConfig, model: `tuzi::${name}`, videoModel: `tuzi::${name}`, channels: [{ id: 'tuzi', name: 'Tuzi', baseUrl: 'https://provider.example/v1', apiKey: 'test-key', apiFormat: 'openai', models: [model] }] };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('local video model parameters', () => {
  it('uses the H3 contract for already discovered models', () => {
    const config = configFor();
    expect(nativeModel(config, 'video')?.referenceInputs?.videos?.maxCount).toBe(3);
    expect(getNativeParameterValues(config, modelId, 'video')).toMatchObject({ duration: '5', size: '768P', ratio: '16:9', prompt_enhancement: 'false' });
    expect(nativeModel(config, 'video')?.parameters?.find(p => p.id === 'duration')?.options).toHaveLength(12);
  });
  it('does not invent contracts for unknown models or override scripts', () => {
    expect(nativeModel(configFor('vendor-video-x'), 'video')).toBeUndefined();
    const config = configFor(); config.channels[0].models[0].script = 'return 1';
    expect(nativeModel(config, 'video')).toBeUndefined();
  });
  it('preserves independent channel settings across serialization', () => {
    const config = configFor();
    config.channels.push({ ...config.channels[0], id: 'other' });
    config.nativeParams = setNativeParameterValue(config, modelId, 'video', 'size', '2K');
    expect(getNativeParameterValues(JSON.parse(JSON.stringify(config)), modelId, 'video').size).toBe('2K');
    expect(getNativeParameterValues(config, 'other::MiniMax-H3', 'video').size).toBe('768P');
  });
  it('exposes OpenTu adapter fields per model family', () => {
    const cases = [
      ['kling-v1-6', ['klingAction2', 'cfg_scale', 'negative_prompt']],
      ['seedance-1.5-pro', ['duration', 'size']],
      ['veo3.1', ['duration', 'size']],
      ['happyhorse-1.0-t2v', ['duration', 'size']],
    ] as const;
    for (const [name, expected] of cases) {
      const entry = nativeModel(configFor(name), 'video');
      expect(entry, name).toBeTruthy();
      for (const id of expected) expect(entry?.parameters?.some(parameter => parameter.id === id), `${name}:${id}`).toBe(true);
    }
  });
  it('serializes selected H3 parameters to the selected local endpoint and key', async () => {
    const config = configFor();
    for (const [key, value] of Object.entries({ duration: '15', size: '2K', ratio: '9:16' })) config.nativeParams = setNativeParameterValue(config, modelId, 'video', key, value);
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { task_id: 'remote-1' } });
    const task = await createVideoGenerationTask(config, 'A landscape');
    expect(post).toHaveBeenCalledWith('https://provider.example/v2/video_generation', { model: 'MiniMax-H3', duration: 15, resolution: '2K', ratio: '9:16', content: [{ type: 'text', text: 'A landscape' }] }, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-key' }) }));
    expect(task).toMatchObject({ id: 'remote-1', protocol: 'minimax-h3-v2', model: modelId });
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { task: { status: 'running' } } });
    expect(await pollVideoGenerationTask(config, JSON.parse(JSON.stringify(task)))).toEqual({ status: 'pending' });
    expect(get).toHaveBeenCalledWith('https://provider.example/v2/query/video_generation/remote-1', expect.anything());
  });
  it('rejects invalid parameters and unsupported audio before POST', async () => {
    const config = configFor();
    const post = vi.spyOn(axios, 'post');
    config.nativeParams = setNativeParameterValue(config, modelId, 'video', 'duration', '99');
    await expect(createVideoGenerationTask(config, 'test')).rejects.toThrow();
    await expect(createVideoGenerationTask(configFor(), 'test', [], { audios: [{ id: 'a', name: 'a.mp3', type: 'audio/mpeg', url: 'https://example.test/a.mp3' }] })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it('handles provider business failures instead of polling forever', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { base_resp: { status_code: 100, status_msg: 'Rejected' } } });
    await expect(createVideoGenerationTask(configFor(), 'test')).rejects.toThrow('Rejected');
    vi.spyOn(axios, 'get').mockResolvedValue({ data: { base_resp: { status_code: 100, status_msg: 'Rejected' } } });
    expect(await pollVideoGenerationTask(configFor(), { id: 'remote', model: modelId, provider: 'openai', protocol: 'minimax-h3-v2' })).toEqual({ status: 'failed', error: 'Rejected' });
  });
  it('returns a completed H3 result', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { task: { status: 'succeeded', content: { url: 'https://example.test/v.mp4' } } } }).mockRejectedValueOnce(new Error('CORS'));
    expect(await pollVideoGenerationTask(configFor(), { id: 'remote', model: modelId, provider: 'openai', protocol: 'minimax-h3-v2' })).toEqual({ status: 'completed', result: { url: 'https://example.test/v.mp4', mimeType: 'video/mp4' } });
  });
  it.each(['url', 'video_url'])('reads Seedance 2.5 metadata.%s without requesting the content endpoint', async (field) => {
    const config = configFor('doubao-seedance-2-5-260628');
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { id: 'seedance-25-task', status: 'completed', metadata: { [field]: 'https://example.test/seedance-25.mp4' } } }).mockRejectedValueOnce(new Error('CORS'));
    expect(await pollVideoGenerationTask(config, { id: 'seedance-25-task', model: 'tuzi::doubao-seedance-2-5-260628', provider: 'openai' })).toEqual({ status: 'completed', result: { url: 'https://example.test/seedance-25.mp4', mimeType: 'video/mp4' } });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toBe('https://example.test/seedance-25.mp4');
  });
  it.each(['completed', 'complete', 'succeeded', 'succeed', 'success', 'done'])('downloads content for terminal status %s without an inline URL', async (status) => {
    const blob = new Blob(['video'], { type: 'video/mp4' });
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { id: 'remote', status: status.toUpperCase() } }).mockResolvedValueOnce({ data: blob });
    expect(await pollVideoGenerationTask(configFor('doubao-seedance-2-5-260628'), { id: 'remote', model: 'tuzi::doubao-seedance-2-5-260628', provider: 'openai' })).toEqual({ status: 'completed', result: { blob } });
    expect(get.mock.calls[1][0]).toBe('https://provider.example/v1/videos/remote/content');
  });
  it.each(['failed', 'failure', 'error', 'cancelled', 'canceled'])('stops polling terminal status %s', async (status) => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { id: 'remote', status: status.toUpperCase(), error: { message: 'provider stopped task' } } });
    expect(await pollVideoGenerationTask(configFor('doubao-seedance-2-5-260628'), { id: 'remote', model: 'tuzi::doubao-seedance-2-5-260628', provider: 'openai' })).toEqual({ status: 'failed', error: 'provider stopped task' });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('uses distinct Sora parameters without hidden generic flags', async () => {
    const config = configFor('sora-2');
    const params = getNativeParameterValues(config, config.model, 'video');
    expect(params).not.toHaveProperty('prompt_enhancement');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { id: 'sora-task' } });
    await createVideoGenerationTask(config, 'test');
    const body = post.mock.calls[0][1] as FormData;
    expect(body.get('seconds')).toBe(String(params.duration));
    expect(body.get('size')).toBe(String(params.size));
    expect(body.has('generate_audio')).toBe(false);
    expect(body.has('resolution_name')).toBe(false);
  });
  it('rejects H3 prompt enhancement on a local/Tuzi channel', async () => {
    const config = configFor();
    config.nativeParams = setNativeParameterValue(config, modelId, 'video', 'prompt_enhancement', 'true');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const post = vi.spyOn(axios, 'post');
    await expect(createVideoGenerationTask(config, 'Original prompt')).rejects.toThrow('提示词增强请求失败');
    expect(fetcher).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });


  it('identifies enhancement submission errors and never submits a video after failure', async () => {
    const config = configFor();
    config.nativeParams = setNativeParameterValue(config, modelId, 'video', 'prompt_enhancement', 'true');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const post = vi.spyOn(axios, 'post');
    await expect(createVideoGenerationTask(config, 'Original prompt')).rejects.toThrow('提示词增强请求失败');
    expect(fetcher).toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

});
