import { SubmissionPersistenceError } from '../../../services/submission-persistence';
import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { prepareNativeTask, runNativeTask, recoverNativeTask } from '../../host/native-task-recovery';
import { taskStorageWriter } from '../../../services/media-executor/task-storage-writer';
import { imageGenerationRecoveryService } from '../../../services/image-generation-recovery-service';
const state = vi.hoisted(() => ({ scope: 'owner', key: 'fake-key', generate: vi.fn(), resumeImage: vi.fn(), resumeVideo: vi.fn(), resumeAudio: vi.fn(), restore: vi.fn() }));
vi.mock('../src/services/document-batch-scope', () => ({ getDocumentBatchScope: () => state.scope, subscribeDocumentBatchScope: () => () => undefined }));
vi.mock('../../host/native-models', () => ({ readNativeModels: async () => ({ channels: [{ id: 'channel', opentuProfileId: 'profile' }] }) }));
vi.mock('../../../services/model-adapters', () => ({ getAdapterContextFromSettings: () => ({ baseUrl: 'https://example.test', apiKey: state.key, authType: 'bearer' }) }));
vi.mock('../../host/native-generation', () => ({ generateNative: state.generate }));
vi.mock('../../../services/task-invocation-route', () => ({ createTaskInvocationRouteSnapshot: () => undefined, assertTaskInvocationRouteAvailable: () => undefined, resolveTaskInvocationRouteModel: () => 'image' }));
vi.mock('../../../services/image-generation-recovery-service', () => ({ imageGenerationRecoveryService: { start: vi.fn(() => ({ status: 'rejected' })), stop: vi.fn() } }));
vi.mock('../../../services/task-queue-service', () => ({ taskQueueService: { restoreTasks: state.restore } }));
vi.mock('../../../services/generation-api-service', () => ({ generationAPIService: { resumeAsyncImageGeneration: state.resumeImage, resumeVideoGeneration: state.resumeVideo, resumeAudioGeneration: state.resumeAudio } }));
const request = { channelId: 'channel', model: 'text', capability: 'text' as const, prompt: 'hello', images: [], params: {} };
beforeEach(() => { taskStorageWriter.close(); taskStorageWriter.resumeWrites(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); state.scope = 'owner'; state.key = 'fake-key'; state.generate.mockReset(); state.resumeImage.mockReset(); state.restore.mockReset(); vi.mocked(imageGenerationRecoveryService.start).mockReset().mockReturnValue({ status: 'rejected', reason: 'invalid-task' }); vi.mocked(imageGenerationRecoveryService.stop).mockReset(); });
afterEach(() => { taskStorageWriter.close(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('native durable lifecycle', () => {
  it.each(['credential', 'abort'] as const)('blocks a submission when %s changes during the durable claim', async change => {
    await prepareNativeTask('claim-race', request);
    const controller = new AbortController();
    const original = taskStorageWriter.claimWorkflowTask.bind(taskStorageWriter);
    const claim = vi.spyOn(taskStorageWriter, 'claimWorkflowTask').mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      if (change === 'credential') state.key = 'replacement'; else controller.abort();
      return result;
    });
    const post = vi.fn();
    state.generate.mockImplementation(async (_request, _signal, options) => { options.assertAvailable(); post(); return { text: 'unexpected' }; });
    try {
      await expect(runNativeTask('claim-race', controller.signal)).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
      expect((await taskStorageWriter.getTask('claim-race'))?.status).toBe('processing');
    } finally { claim.mockRestore(); }
  });
  it.each(['video', 'audio'] as const)('recovers %s after repeated interruptions without a second submission', async capability => {
    const resume = capability === 'video' ? state.resumeVideo : state.resumeAudio;
    resume.mockReset().mockRejectedValueOnce(new Error('TIMEOUT')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ url: `https://example.test/${capability}` });
    state.generate.mockImplementation(async (_request, _signal, options) => { await options.onSubmitted('remote'); throw new Error('interrupted'); });
    await prepareNativeTask('media', { ...request, capability });
    await expect(runNativeTask('media', new AbortController().signal)).rejects.toThrow('interrupted');
    await taskStorageWriter.mutateWorkflowTask('media', 'owner', task => { task.startedAt = Date.now() - 40 * 60_000; return true; });
    taskStorageWriter.close();
    expect(await recoverNativeTask('media')).toBeNull();
    await expect(recoverNativeTask('media')).rejects.toThrow('offline');
    expect((await taskStorageWriter.getTask('media'))?.status).toBe('processing');
    expect(await recoverNativeTask('media')).toMatchObject({ resultKind: capability, urls: [`https://example.test/${capability}`] });
    expect(resume).toHaveBeenCalledTimes(3);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });

  it.each(['video', 'audio'] as const)('persists an explicit %s provider failure but keeps its original id', async capability => {
    const resume = capability === 'video' ? state.resumeVideo : state.resumeAudio;
    resume.mockReset().mockRejectedValue(Object.assign(new Error('provider rejected'), { workflowProviderFailure: true }));
    state.generate.mockImplementation(async (_request, _signal, options) => { await options.onSubmitted('remote'); throw new Error('interrupted'); });
    await prepareNativeTask('media', { ...request, capability });
    await expect(runNativeTask('media', new AbortController().signal)).rejects.toThrow();
    await expect(recoverNativeTask('media')).rejects.toMatchObject({ name: 'WorkflowTaskFailed' });
    expect(await taskStorageWriter.getTask('media')).toMatchObject({ status: 'failed', remoteId: 'remote' });
    await expect(recoverNativeTask('media')).rejects.toThrow('provider rejected');
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('restores lyrics as text rather than an empty audio URL', async () => {
    state.resumeAudio.mockReset().mockResolvedValue({ url: '', resultKind: 'lyrics', lyricsText: 'Verse and chorus' });
    state.generate.mockImplementation(async (_request, _signal, options) => { await options.onSubmitted('remote'); throw new Error('interrupted'); });
    await prepareNativeTask('lyrics', { ...request, capability: 'audio' });
    await expect(runNativeTask('lyrics', new AbortController().signal)).rejects.toThrow();
    expect(await recoverNativeTask('lyrics')).toEqual({ resultKind: 'lyrics', text: 'Verse and chorus' });
  });
  it('persists an upstream rejection received while recovering an image', async () => {
    state.generate.mockRejectedValue(new Error('interrupted'));
    await prepareNativeTask('image', { ...request, model: 'gpt-image-2.5', capability: 'image' });
    await expect(runNativeTask('image', new AbortController().signal)).rejects.toThrow();
    vi.mocked(imageGenerationRecoveryService.start).mockImplementationOnce((_task, callbacks) => {
      void callbacks.onFailed({ status: 'failed', kind: 'upstream', code: 'model_price_error', message: 'group unavailable' }, new AbortController().signal);
      return { status: 'started', handle: { taskId: 'image', stop: vi.fn() } };
    });
    await expect(recoverNativeTask('image')).rejects.toThrow('group unavailable');
    expect((await taskStorageWriter.getTask('image'))?.status).toBe('failed');
    await expect(recoverNativeTask('image')).rejects.toThrow('group unavailable');
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it('records acceptance before returning success and restores without generating', async () => {
    state.generate.mockImplementation(async (_request, _signal, options) => {
      await options.onSubmitted('remote');
      expect((await taskStorageWriter.getTask('one'))?.remoteId).toBe('remote');
      return { text: 'answer', resultKind: 'text' };
    });
    await prepareNativeTask('one', request);
    expect(await runNativeTask('one', new AbortController().signal)).toMatchObject({ text: 'answer' });
    taskStorageWriter.close();
    expect(await recoverNativeTask('one')).toMatchObject({ text: 'answer' });
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it('does not reuse submission after an interrupted call', async () => {
    state.generate.mockRejectedValue(new Error('interrupt'));
    await prepareNativeTask('one', request);
    await expect(runNativeTask('one', new AbortController().signal)).rejects.toThrow('interrupt');
    await expect(recoverNativeTask('one')).rejects.toMatchObject({ name: 'WorkflowRecoveryUnavailable' });
    await expect(runNativeTask('one', new AbortController().signal)).rejects.toThrow('已经提交');
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it('restores an upstream pricing-group rejection as a failed task', async () => {
    state.generate.mockRejectedValue(Object.assign(new Error('HTTP 400: model_price_error: model is not available in pricing group'), { httpStatus: 400 }));
    await prepareNativeTask('pricing', request);
    await expect(runNativeTask('pricing', new AbortController().signal)).rejects.toThrow('model_price_error');
    expect((await taskStorageWriter.getTask('pricing'))?.status).toBe('failed');
    await expect(recoverNativeTask('pricing')).rejects.toThrow('model_price_error');
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it('does not submit after key replacement or account switch', async () => {
    await prepareNativeTask('one', request);
    state.key = 'replacement';
    await expect(runNativeTask('one', new AbortController().signal)).rejects.toThrow('等待原配置');
    state.scope = 'other';
    expect(await recoverNativeTask('one')).toBeNull();
    expect(state.generate).not.toHaveBeenCalled();
  });
  it('ignores the late response for another account', async () => {
    state.generate.mockImplementation(async () => { state.scope = 'other'; return { text: 'late' }; });
    await prepareNativeTask('one', request);
    await expect(runNativeTask('one', new AbortController().signal)).rejects.toThrow('账号已切换');
    expect((await taskStorageWriter.getTask('one'))?.status).toBe('processing');
  });
  it('starts synchronous image recovery with a fresh polling window after reload', async () => {
    state.generate.mockRejectedValue(new Error('interrupted'));
    await prepareNativeTask('image-reload', { ...request, model: 'gpt-image-2.5', capability: 'image' });
    await expect(runNativeTask('image-reload', new AbortController().signal)).rejects.toThrow();
    const oldStartedAt = Date.now() - 20 * 60_000;
    await taskStorageWriter.mutateWorkflowTask('image-reload', 'owner', task => { task.startedAt = oldStartedAt; return true; });
    let recoveryStartedAt = 0;
    vi.mocked(imageGenerationRecoveryService.start).mockImplementationOnce((task, callbacks) => {
      recoveryStartedAt = task.startedAt || 0;
      void callbacks.onSucceeded({ status: 'succeeded', requestId: 'image-reload', url: 'https://example.test/image.png', urls: ['https://example.test/image.png'] }, new AbortController().signal);
      return { status: 'started', handle: { taskId: 'image-reload', stop: vi.fn() } };
    });
    await expect(recoverNativeTask('image-reload')).resolves.toMatchObject({ urls: ['https://example.test/image.png'] });
    expect(recoveryStartedAt).toBeGreaterThan(oldStartedAt);
    expect(await taskStorageWriter.getTask('image-reload')).toMatchObject({ status: 'completed', startedAt: oldStartedAt });
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it('does not abandon a synchronous query at the former 10 minute wrapper timeout', async () => {
    state.generate.mockRejectedValue(new Error('interrupted'));
    await prepareNativeTask('slow-image', { ...request, model: 'gpt-image-2.5', capability: 'image' });
    await expect(runNativeTask('slow-image', new AbortController().signal)).rejects.toThrow();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let callbacks!: Parameters<typeof imageGenerationRecoveryService.start>[1];
    vi.mocked(imageGenerationRecoveryService.start).mockImplementationOnce((_task, value) => {
      callbacks = value;
      return { status: 'started', handle: { taskId: 'slow-image', stop: vi.fn() } };
    });
    let settled = false;
    const recovery = recoverNativeTask('slow-image').then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(imageGenerationRecoveryService.start).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(settled).toBe(false);
    expect(imageGenerationRecoveryService.stop).not.toHaveBeenCalled();
    await callbacks.onSucceeded({ status: 'succeeded', requestId: 'slow-image', url: 'https://example.test/late.png', urls: ['https://example.test/late.png'] }, new AbortController().signal);
    await expect(recovery).resolves.toMatchObject({ urls: ['https://example.test/late.png'] });
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps a timed out synchronous polling window pending and queries the original request again', async () => {
    state.generate.mockRejectedValue(new Error('interrupted'));
    await prepareNativeTask('window', { ...request, model: 'gpt-image-2.5', capability: 'image' });
    await expect(runNativeTask('window', new AbortController().signal)).rejects.toThrow();
    vi.mocked(imageGenerationRecoveryService.start).mockImplementationOnce((_task, callbacks) => {
      void callbacks.onFailed({ status: 'failed', kind: 'timeout', code: 'RECOVERY_TIMEOUT', message: 'timed out' }, new AbortController().signal);
      return { status: 'started', handle: { taskId: 'window', stop: vi.fn() } };
    }).mockImplementationOnce((_task, callbacks) => {
      void callbacks.onSucceeded({ status: 'succeeded', requestId: 'window', url: 'https://example.test/late.png', urls: ['https://example.test/late.png'] }, new AbortController().signal);
      return { status: 'started', handle: { taskId: 'window', stop: vi.fn() } };
    });
    await expect(recoverNativeTask('window')).resolves.toBeNull();
    expect((await taskStorageWriter.getTask('window'))?.status).toBe('processing');
    await expect(recoverNativeTask('window')).resolves.toMatchObject({ urls: ['https://example.test/late.png'] });
    expect(imageGenerationRecoveryService.start).toHaveBeenCalledTimes(2);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it('queries an old accepted image remote id and survives a polling-window timeout without submitting again', async () => {
    state.generate.mockImplementation(async (_request, _signal, options) => { await options.onSubmitted('remote-image'); throw new Error('interrupted'); });
    await prepareNativeTask('remote-image', { ...request, model: 'gpt-image-2.5', capability: 'image' });
    await expect(runNativeTask('remote-image', new AbortController().signal)).rejects.toThrow();
    await taskStorageWriter.mutateWorkflowTask('remote-image', 'owner', task => { task.startedAt = Date.now() - 30 * 60_000; return true; });
    state.resumeImage.mockRejectedValueOnce(new Error('TIMEOUT')).mockResolvedValueOnce({ url: 'https://example.test/remote.png' });
    await expect(recoverNativeTask('remote-image')).resolves.toBeNull();
    expect((await taskStorageWriter.getTask('remote-image'))?.status).toBe('processing');
    await expect(recoverNativeTask('remote-image')).resolves.toMatchObject({ urls: ['https://example.test/remote.png'] });
    expect(state.resumeImage).toHaveBeenNthCalledWith(1, 'remote-image', 'remote-image', 'image', 'remote-image', expect.any(Function));
    expect(state.resumeImage).toHaveBeenCalledTimes(2);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
});

 it.each(['video', 'audio'] as const)('reports missing %s recovery identity without resubmitting', async capability => {
    state.generate.mockRejectedValue(new Error('lost response'));
    await prepareNativeTask('missing-id', { ...request, capability });
    await expect(runNativeTask('missing-id', new AbortController().signal)).rejects.toThrow();
    await expect(recoverNativeTask('missing-id')).rejects.toMatchObject({ name: 'WorkflowRecoveryUnavailable' });
    expect((await taskStorageWriter.getTask('missing-id'))?.status).toBe('processing');
    await expect(runNativeTask('missing-id', new AbortController().signal)).rejects.toThrow('已经提交');
    expect(state.generate).toHaveBeenCalledTimes(1);
 });
 it('preserves an accepted remote id after callback storage failure and recovers by query', async () => {
    state.generate.mockRejectedValue(new SubmissionPersistenceError('accepted'));
    state.resumeVideo.mockResolvedValue({ url: 'https://example.test/accepted.mp4' });
    await prepareNativeTask('accepted', { ...request, capability: 'video' });
    await expect(runNativeTask('accepted', new AbortController().signal)).rejects.toMatchObject({ retryable: false });
    expect(await taskStorageWriter.getTask('accepted')).toMatchObject({ status: 'processing', remoteId: 'accepted' });
    await expect(recoverNativeTask('accepted')).resolves.toMatchObject({ urls: ['https://example.test/accepted.mp4'] });
    expect(state.generate).toHaveBeenCalledTimes(1);
 });
