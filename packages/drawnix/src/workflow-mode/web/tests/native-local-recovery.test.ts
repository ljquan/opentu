import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { taskStorageWriter } from '../../../services/media-executor/task-storage-writer';
import { runLocalWorkflowTask, recoverWorkflowTask, isDefinitiveSubmissionFailure } from '../src/services/workflow-local-task';
import { defaultConfig } from '../src/stores/use-config-store';
import { gptImageAdapter } from '../../../services/model-adapters/gpt-image-adapter';
import { tuziGPTImageAdapter } from '../../../services/model-adapters/tuzi-gpt-image-adapter';
import { notifyTaskSubmitted, SubmissionPersistenceError } from '../../../services/submission-persistence';
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../services/provider-routing/tuzi-api-endpoints', async importOriginal => ({
  ...await importOriginal<typeof import('../../../services/provider-routing/tuzi-api-endpoints')>(),
  loadTuziApiEndpointBaseUrls: vi.fn(async () => []),
}));
vi.mock('../src/services/document-batch-scope', () => ({ getDocumentBatchScope: () => 'owner' }));
const config = { ...defaultConfig, model: 'image', baseUrl: 'https://api.tu-zi.com', apiKey: 'fictional-key', apiFormat: 'openai' as const, channels: [] };
beforeEach(() => { taskStorageWriter.close(); taskStorageWriter.resumeWrites(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.clearAllMocks(); });
afterEach(() => { taskStorageWriter.close(); taskStorageWriter.resumeWrites(); vi.unstubAllGlobals(); });
describe('workflow synchronous recovery', () => {
  it.each(['image', 'audio'] as const)('preserves an accepted %s id after a transient storage failure and forbids resubmission', async kind => {
    const error = Object.assign(new SubmissionPersistenceError('accepted'), { protocol: 'flux-image-adapter' });
    const post = vi.fn(async () => { await notifyTaskSubmitted('accepted', async () => { throw error; }); });
    await expect(runLocalWorkflowTask('accepted-attempt', kind, config, 'image', {}, post, () => null)).rejects.toBe(error);
    const stored = await taskStorageWriter.getTask('accepted-attempt');
    expect(stored).toMatchObject({ status: 'processing', error: { code: 'SUBMISSION_PERSISTENCE_FAILED' } });
    if (kind === 'audio') expect(stored?.params.localAudioTaskId).toBe('accepted');
    else expect(stored?.params.localImageTask).toEqual({ protocol: 'flux-image-adapter', remoteId: 'accepted' });
    expect(isDefinitiveSubmissionFailure(error)).toBe(false);
    await expect(runLocalWorkflowTask('accepted-attempt', kind, config, 'image', {}, post, () => null)).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each([gptImageAdapter, tuziGPTImageAdapter])('persists $id HTTP rejection rather than an uncertain submission', async adapter => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'model_price_error: unavailable group' } }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    await expect(runLocalWorkflowTask('adapter-reject', 'image', config, 'image', {},
      () => adapter.generateImage({ baseUrl: 'https://api.tu-zi.com/v1', apiKey: 'fictional-key', operation: 'image', requestId: 'adapter-reject', fetcher }, { prompt: 'cat', model: 'gpt-image-2.5' }), () => null)).rejects.toMatchObject({ httpStatus: 403 });
    taskStorageWriter.close();
    await expect(recoverWorkflowTask('adapter-reject', config)).rejects.toThrow('model_price_error');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(axios.get).not.toHaveBeenCalled();
  });
  it('retains the input and only queries after interruption', async () => {
    const post = vi.fn().mockRejectedValue(new Error('connection closed'));
    await expect(runLocalWorkflowTask('one', 'image', config, 'image', { prompt: 'cat' }, post, () => ({ urls: [] }))).rejects.toThrow();
    taskStorageWriter.close();
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'succeeded', request_id: 'one', data: [{ url: 'https://example.test/result.png' }] } });
    expect(await recoverWorkflowTask('one', config)).toMatchObject({ urls: ['https://example.test/result.png'] });
    expect(post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect((await taskStorageWriter.getTask('one'))?.params.localInput).toEqual({ prompt: 'cat' });
    await recoverWorkflowTask('one', config);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
  it('never queries with a replaced credential', async () => {
    await expect(runLocalWorkflowTask('one', 'image', config, 'image', {}, async () => { throw new Error('interrupt'); }, () => ({ urls: [] }))).rejects.toThrow();
    await expect(recoverWorkflowTask('one', { ...config, apiKey: 'replacement' })).rejects.toThrow('等待原配置');
    expect(axios.get).not.toHaveBeenCalled();
  });
  it('shares a slow recovery query across periodic scans and persists the late result', async () => {
    const post = vi.fn().mockRejectedValue(new Error('connection closed'));
    await expect(runLocalWorkflowTask('slow', 'image', config, 'image', {}, post, () => null)).rejects.toThrow();
    let finish!: (value: unknown) => void;
    vi.mocked(axios.get).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = recoverWorkflowTask('slow', config);
    await vi.waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1));
    const second = recoverWorkflowTask('slow', config);
    finish({ data: { status: 'succeeded', request_id: 'slow', data: [{ url: 'https://example.test/slow.png' }] } });
    expect(await first).toEqual(await second);
    expect((await taskStorageWriter.getTask('slow'))?.status).toBe('completed');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('queries an image result after the generation timeout instead of expiring its request id', async () => {
    await expect(runLocalWorkflowTask('older', 'image', config, 'image', {}, async () => { throw new Error('closed'); }, () => null)).rejects.toThrow();
    await taskStorageWriter.mutateWorkflowTask('older', 'owner', task => { task.createdAt = task.startedAt = Date.now() - 30 * 60_000; return true; });
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'succeeded', data: [{ url: 'https://example.test/older.png' }] } });
    expect(await recoverWorkflowTask('older', config)).toMatchObject({ urls: ['https://example.test/older.png'] });
  });
  it('keeps an old image task processing when the recovery query is unavailable', async () => {
    await expect(runLocalWorkflowTask('offline', 'image', config, 'image', {}, async () => { throw new Error('closed'); }, () => null)).rejects.toThrow();
    await taskStorageWriter.mutateWorkflowTask('offline', 'owner', task => { task.createdAt = task.startedAt = Date.now() - 30 * 60_000; return true; });
    vi.mocked(axios.get).mockRejectedValue(new Error('network unavailable'));
    await expect(recoverWorkflowTask('offline', config)).rejects.toThrow('network unavailable');
    expect((await taskStorageWriter.getTask('offline'))?.status).toBe('processing');
  });
  it('keeps an interrupted text request pending without resubmitting', async () => {
    const post = vi.fn().mockRejectedValue(new Error('interrupt'));
    await expect(runLocalWorkflowTask('one', 'text', config, 'text', {}, post, () => ({ text: '' }))).rejects.toThrow();
    expect((await taskStorageWriter.getTask('one'))?.params.recoveryError).toBe('interrupt');
    expect(await recoverWorkflowTask('one', config)).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(axios.get).not.toHaveBeenCalled();
  });
  it('persists definitive provider rejection so refresh shows the provider error', async () => {
    const providerError = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { code: 'model_price_error', message: 'Model is not available in pricing group' } },
    });
    await expect(runLocalWorkflowTask('rejected', 'video', config, 'video', {}, async () => { throw providerError; }, () => null)).rejects.toBe(providerError);
    await expect(recoverWorkflowTask('rejected', config)).rejects.toThrow('Model is not available in pricing group');
    expect((await taskStorageWriter.getTask('rejected'))?.status).toBe('failed');
  });
  it.each([new Error('请求失败'), Object.assign(new Error('gateway timeout'), { response: { status: 504 } })])('keeps ambiguous failures queryable', async error => {
    expect(isDefinitiveSubmissionFailure(error)).toBe(false);
    await expect(runLocalWorkflowTask('unknown', 'image', config, 'image', {}, async () => { throw error; }, () => null)).rejects.toBe(error);
    expect((await taskStorageWriter.getTask('unknown'))?.status).toBe('processing');
  });
  it('keeps an old image pending across reload and recovers a later result without a new POST', async () => {
    const post = vi.fn().mockRejectedValue(new Error('connection closed'));
    await expect(runLocalWorkflowTask('pending', 'image', config, 'image', {}, post, () => null)).rejects.toThrow();
    await taskStorageWriter.mutateWorkflowTask('pending', 'owner', task => { task.createdAt = task.startedAt = Date.now() - 30 * 60_000; return true; });
    taskStorageWriter.close();
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { status: 'processing_or_not_found' } })
      .mockResolvedValueOnce({ data: { status: 'succeeded', request_id: 'pending', data: [{ url: 'https://example.test/recovered.png' }] } });
    expect(await recoverWorkflowTask('pending', config)).toBeNull();
    expect((await taskStorageWriter.getTask('pending'))?.status).toBe('processing');
    taskStorageWriter.close();
    expect(await recoverWorkflowTask('pending', config)).toMatchObject({ urls: ['https://example.test/recovered.png'] });
    expect(post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect((await taskStorageWriter.getTask('pending'))?.status).toBe('completed');
  });
  it('persists a rejection returned by the recovery endpoint', async () => {
    await expect(runLocalWorkflowTask('failed-query', 'image', config, 'image', {}, async () => { throw new Error('closed'); }, () => null)).rejects.toThrow();
    await taskStorageWriter.mutateWorkflowTask('failed-query', 'owner', task => { task.createdAt = task.startedAt = Date.now() - 30 * 60_000; return true; });
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'failed', error: { message: 'model_price_error: unavailable group' } } });
    await expect(recoverWorkflowTask('failed-query', config)).rejects.toThrow('model_price_error');
    await expect(recoverWorkflowTask('failed-query', config)).rejects.toThrow('model_price_error');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
  it('stops before POST if storage is unavailable', async () => {
    const post = vi.fn(); taskStorageWriter.pauseWrites();
    await expect(runLocalWorkflowTask('one', 'image', config, 'image', {}, post, () => ({ urls: [] }))).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it('persists an explicit failure of an accepted async image and does not confuse a query error with it', async () => {
    const model = 'original::bfl-flux-2-pro';
    const original = { ...config, model, channels: [{ id: 'original', name: 'Original', apiFormat: 'openai' as const, apiKey: 'original-key', baseUrl: 'https://original.example', models: [{ name: 'bfl-flux-2-pro', capability: 'image' as const }] }] };
    await expect(runLocalWorkflowTask('remote-failed', 'image', original, model, {}, async () => {
      await taskStorageWriter.mutateWorkflowTask('remote-failed', 'owner', task => { task.params.localImageTask = { protocol: 'flux-image-adapter', remoteId: 'upstream' }; return true; });
      throw new Error('interrupted');
    }, () => null)).rejects.toThrow('interrupted');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed', error: { message: 'provider rejected' } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(recoverWorkflowTask('remote-failed', original)).rejects.toThrow('HTTP 503');
    expect((await taskStorageWriter.getTask('remote-failed'))?.status).toBe('processing');
    await expect(recoverWorkflowTask('remote-failed', original)).rejects.toMatchObject({ name: 'WorkflowTaskFailed', message: 'provider rejected' });
    taskStorageWriter.close();
    await expect(recoverWorkflowTask('remote-failed', original)).rejects.toThrow('provider rejected');
    expect((await taskStorageWriter.getTask('remote-failed'))?.status).toBe('failed');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['image', 'audio'] as const)('recovers %s with the saved channel after the selected model changes', async kind => {
    const name = kind === 'image' ? 'bfl-flux-2-pro' : 'suno_music';
    const model = `original::${name}`;
    const original = { ...config, model, channels: [
      { id: 'original', name: 'Original', apiFormat: 'openai' as const, apiKey: 'original-key', baseUrl: 'https://original.example', models: [{ name, capability: kind }] },
      { id: 'other', name: 'Other', apiFormat: 'openai' as const, apiKey: 'other-key', baseUrl: 'https://other.example', models: [{ name, capability: kind }] },
    ] };
    await expect(runLocalWorkflowTask('remote', kind, original, model, {}, async () => {
      await taskStorageWriter.mutateWorkflowTask('remote', 'owner', task => {
        task.createdAt = task.startedAt = Date.now() - 30 * 60_000;
        if (kind === 'image') {
          task.params.localImageTask = { protocol: 'flux-image-adapter', remoteId: 'upstream' };
          task.createdAt = task.startedAt = Date.now() - 30 * 60_000;
        }
        else task.params.localAudioTaskId = 'upstream';
        return true;
      });
      throw new Error('interrupted');
    }, () => null)).rejects.toThrow('interrupted');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(kind === 'image'
      ? { status: 'Ready', result: { sample: 'https://result.example/image.png' } }
      : { task_id: 'upstream', status: 'SUCCESS', action: 'MUSIC', data: [{ status: 'complete', audio_url: 'https://result.example/audio.mp3' }] }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    expect(await recoverWorkflowTask('remote', { ...original, model: `other::${name}` })).toMatchObject({ resultKind: kind });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('https://original.example/');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer original-key');
    expect(fetcher.mock.calls[0][1].method || 'GET').toBe('GET');
  });

  it('keeps an old audio task queryable and persists a confirmed provider failure', async () => {
    const audioConfig = { ...config, model: 'suno_music' };
    await expect(runLocalWorkflowTask('audio', 'audio', audioConfig, 'suno_music', {}, async () => {
      await taskStorageWriter.mutateWorkflowTask('audio', 'owner', task => { task.params.localAudioTaskId = 'remote'; task.startedAt = Date.now() - 30 * 60_000; return true; });
      throw new Error('interrupted');
    }, () => null)).rejects.toThrow();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: 'remote', status: 'FAILED', fail_reason: 'provider rejected' }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(recoverWorkflowTask('audio', audioConfig)).rejects.toThrow();
    expect((await taskStorageWriter.getTask('audio'))?.status).toBe('processing');
    await expect(recoverWorkflowTask('audio', audioConfig)).rejects.toMatchObject({ name: 'WorkflowTaskFailed' });
    expect((await taskStorageWriter.getTask('audio'))?.status).toBe('failed');
    await expect(recoverWorkflowTask('audio', audioConfig)).rejects.toMatchObject({ name: 'WorkflowTaskFailed' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

});
