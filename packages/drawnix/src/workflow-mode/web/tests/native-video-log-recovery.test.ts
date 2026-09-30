import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { taskStorageWriter } from '../../../services/media-executor/task-storage-writer';
import { runLocalWorkflowTask } from '../src/services/workflow-local-task';
import { registerWorkflowTaskTarget } from '../src/services/workflow-task-target';
import { defaultConfig } from '../src/stores/use-config-store';
import { buildLog, formatVideoTiming, hydrateVideoLogFromTask, normalizeLog, serializeLog, videoLogResults, videoLogTiming } from '../src/pages/video';
import { pollVideoGenerationTask, type VideoGenerationTask } from '../src/services/api/video';

const scope = vi.hoisted(() => ({ id: 'owner' }));
vi.mock('../src/services/document-batch-scope', () => ({ getDocumentBatchScope: () => scope.id, subscribeDocumentBatchScope: () => () => undefined }));
vi.mock('../src/services/file-storage', () => ({ resolveMediaUrl: vi.fn(async (_key, url) => url), deleteStoredMedia: vi.fn(), uploadMediaFile: vi.fn() }));
vi.mock('../src/services/image-storage', () => ({ resolveImageUrl: vi.fn(async (_key, url) => url), ensureImagePreview: vi.fn(), subscribeImagePreviews: vi.fn(() => () => {}), getImagePreviewRevision: vi.fn(() => 0), previewUrlFor: vi.fn(), uploadImage: vi.fn() }));
const config = { ...defaultConfig, model: 'MiniMax-H3', videoModel: 'MiniMax-H3', baseUrl: 'https://example.test', apiKey: 'fictional-key', channels: [] };
const remote: VideoGenerationTask = { id: 'upstream', provider: 'openai', protocol: 'minimax-h3-v2', model: config.model };
const log = () => ({ ...buildLog({ prompt: 'video', model: config.model, config, references: [], durationMs: 0, status: 'pending' }), id: 'log', scopeId: 'owner' });
beforeEach(() => { taskStorageWriter.close(); taskStorageWriter.resumeWrites(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); scope.id = 'owner'; });
afterEach(() => { taskStorageWriter.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function submitted() {
    registerWorkflowTaskTarget('attempt', { targetId: 'log', logId: 'log' });
    const post = vi.fn().mockResolvedValue(remote);
    await runLocalWorkflowTask('attempt', 'video', config, config.model, {}, post, () => null);
    taskStorageWriter.close();
    return post;
}

describe('video history reload with a durable task', () => {
    it('measures a continuous request with a monotonic clock instead of the age of its log', () => {
        const pending = { ...log(), createdAt: 1, durationMs: 0 };
        vi.spyOn(Date, 'now').mockReturnValue(115 * 60_000 + 56_000);
        vi.spyOn(performance, 'now').mockReturnValue(65_000);
        const timing = videoLogTiming(pending, 5_000);
        expect(timing).toEqual({ durationMs: 60_000, durationIsPartial: false });
        expect(formatVideoTiming(timing)).toBe('1分00秒');
    });
    it('does not count hours offline or repeated recovery as generation time', async () => {
        const pending = { ...log(), createdAt: Date.now() - 2 * 60 * 60_000, durationMs: 30_000, durationIsPartial: true };
        const timing = videoLogTiming(pending);
        expect(timing).toEqual({ durationMs: 30_000, durationIsPartial: true });
        const restored = await normalizeLog(serializeLog({ ...pending, ...timing }));
        vi.spyOn(performance, 'now').mockReturnValue(9_000_000);
        expect(videoLogTiming(restored)).toEqual(timing);
        expect(restored.durationIsPartial).toBe(true);
        expect(formatVideoTiming(restored)).toBe('已记录 30秒');
        expect(formatVideoTiming(videoLogTiming(log()))).toBe('耗时未知');
    });
    it('preserves recorded time when restoring a failure without inventing an end time', async () => {
        await submitted();
        await taskStorageWriter.mutateWorkflowTask('attempt', 'owner', task => {
            task.startedAt = Date.now() - 2 * 60 * 60_000;
            task.completedAt = Date.now();
            task.status = 'failed';
            return true;
        });
        const restored = await hydrateVideoLogFromTask({ ...log(), createdAt: 1, durationMs: 15_000, durationIsPartial: true });
        expect(restored).toMatchObject({ status: 'failed', durationMs: 15_000, durationIsPartial: true });
        expect((await hydrateVideoLogFromTask(restored)).durationMs).toBe(15_000);
    });
    it('does not display an unverified legacy total as actual generation time', async () => {
        const legacy = { ...log(), status: 'success' as const, durationMs: 115 * 60_000 + 56_000 };
        const restored = await normalizeLog(serializeLog(legacy));
        expect(restored.durationMs).toBe(legacy.durationMs);
        expect(formatVideoTiming(restored)).toBe('耗时未知');
        expect(formatVideoTiming(videoLogTiming(restored))).toBe('耗时未知');
    });
    it('binds a missing log task through its saved target and queries the same remote task', async () => {
        const post = await submitted();
        const restored = await hydrateVideoLogFromTask(log());
        expect(restored.task).toEqual({ id: 'attempt', provider: 'native', model: config.model });
        const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { task: { status: 'running' } } });
        expect(await pollVideoGenerationTask(config, restored.task!)).toEqual({ status: 'pending' });
        expect(get).toHaveBeenCalledWith('https://example.test/v2/query/video_generation/upstream', expect.anything());
        expect(post).toHaveBeenCalledTimes(1);
    });
    it('reads a completed durable result without contacting the provider', async () => {
        await submitted();
        await taskStorageWriter.mutateWorkflowTask('attempt', 'owner', task => { task.status = 'completed'; task.params.nativeResult = { resultKind: 'video', urls: ['https://example.test/done.mp4'] }; return true; });
        const get = vi.spyOn(axios, 'get');
        const restored = await hydrateVideoLogFromTask(log());
        expect(await pollVideoGenerationTask(config, restored.task!)).toMatchObject({ status: 'completed', result: { url: 'https://example.test/done.mp4' } });
        expect(get).not.toHaveBeenCalled();
    });
    it('retains the actual failed state and error after reload', async () => {
        await submitted();
        await taskStorageWriter.mutateWorkflowTask('attempt', 'owner', task => { task.status = 'failed'; task.error = { code: 'provider', message: 'model_price_error: unavailable group' }; return true; });
        const restored = await hydrateVideoLogFromTask(log());
        await expect(pollVideoGenerationTask(config, restored.task!)).rejects.toMatchObject({ name: 'VideoTaskFailed', message: 'model_price_error: unavailable group' });
    });
    it('keeps an interrupted submission without a remote id uncertain and never POSTs again', async () => {
        registerWorkflowTaskTarget('attempt', { targetId: 'log', logId: 'log' });
        const post = vi.fn().mockRejectedValue(new Error('closed'));
        await expect(runLocalWorkflowTask('attempt', 'video', config, config.model, {}, post, () => null)).rejects.toThrow();
        const restored = await hydrateVideoLogFromTask(log());
        expect(restored.status).toBe('pending');
        await expect(pollVideoGenerationTask(config, restored.task!)).rejects.toMatchObject({ name: 'WorkflowRecoveryUnavailable' });
        expect(post).toHaveBeenCalledTimes(1);
        expect((await taskStorageWriter.getTask('attempt'))?.status).toBe('processing');
    });
    it('continues querying an accepted task after 15 minutes and persists provider failure', async () => {
        const post = await submitted();
        await taskStorageWriter.mutateWorkflowTask('attempt', 'owner', task => { task.createdAt = task.startedAt = Date.now() - 20 * 60_000; return true; });
        const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { base_resp: { status_code: 100, status_msg: 'Rejected' } } });
        const restored = await hydrateVideoLogFromTask(log());
        await expect(pollVideoGenerationTask(config, restored.task!)).rejects.toMatchObject({ name: 'VideoTaskFailed', message: 'Rejected' });
        await expect(pollVideoGenerationTask(config, restored.task!)).rejects.toThrow('Rejected');
        expect((await taskStorageWriter.getTask('attempt'))?.status).toBe('failed');
        expect(get).toHaveBeenCalledTimes(1);
        expect(post).toHaveBeenCalledTimes(1);
    });
    it('does not restore another account task or expose its saved error', async () => {
        await submitted();
        scope.id = 'other';
        expect(await taskStorageWriter.findWorkflowTask('log', scope.id)).toBeNull();
        expect((await hydrateVideoLogFromTask(log())).task).toBeUndefined();
        await expect(pollVideoGenerationTask(config, { id: 'attempt', provider: 'native', model: config.model })).rejects.toThrow('账号已切换');
    });
    it('leaves completed history unchanged', async () => {
        await submitted();
        const completed = { ...log(), status: 'success' as const };
        expect(await hydrateVideoLogFromTask(completed)).toBe(completed);
    });
    it('keeps a temporary query error pending in the result card, then recovers the same task', async () => {
        const post = await submitted();
        const get = vi.spyOn(axios, 'get').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { task: { status: 'succeeded', video_url: 'https://example.test/result.mp4' } } }).mockRejectedValueOnce(new Error('asset download blocked'));
        const restored = await hydrateVideoLogFromTask(log());
        await expect(pollVideoGenerationTask(config, restored.task!)).rejects.toThrow();
        expect(videoLogResults({ ...restored, error: 'offline' })).toEqual([{ id: 'log', status: 'pending', error: '结果待确认：offline' }]);
        expect((await taskStorageWriter.getTask('attempt'))?.status).toBe('processing');
        taskStorageWriter.close();
        expect(await pollVideoGenerationTask(config, restored.task!)).toMatchObject({ status: 'completed', result: { url: 'https://example.test/result.mp4' } });
        expect(post).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(3);
    });
});
