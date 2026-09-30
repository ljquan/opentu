import { IDBFactory } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskStorageWriter } from '../../../services/media-executor/task-storage-writer';
import { requestImageQuestion } from '../src/services/api/image';
import { recoverWorkflowTask } from '../src/services/workflow-local-task';
import { defaultConfig } from '../src/stores/use-config-store';

const scope = vi.hoisted(() => ({ id: 'owner' }));
vi.mock('../src/services/document-batch-scope', () => ({ getDocumentBatchScope: () => scope.id }));
const config = { ...defaultConfig, model: 'text-model', textModel: 'text-model', systemPrompt: '', baseUrl: 'https://example.test', apiKey: 'original-key', channels: [] };
const messages = [{ role: 'user' as const, content: 'Write a story' }];
const created = { type: 'response.created', response: { id: 'resp_original', status: 'in_progress' } };
const delta = { type: 'response.output_text.delta', delta: 'Once upon a time' };
const payload = (status = 'completed', text = 'Once upon a time, the end.') => ({ id: 'resp_original', status, output_text: text });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (...events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
    taskStorageWriter.close(); taskStorageWriter.resumeWrites(); scope.id = 'owner';
    vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto);
    fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { taskStorageWriter.close(); vi.unstubAllGlobals(); });

async function interrupted() {
    fetcher.mockResolvedValueOnce(sse(created, delta));
    await expect(requestImageQuestion(config, messages, vi.fn(), { taskId: 'attempt' })).rejects.toThrow('连接中断');
    taskStorageWriter.close();
}

async function interruptedWithoutResponseId() {
    fetcher.mockResolvedValueOnce(sse(delta));
    await expect(requestImageQuestion(config, messages, vi.fn(), { taskId: 'attempt' })).rejects.toThrow('连接中断');
    taskStorageWriter.close();
}

describe('text refresh recovery', () => {
    it.each(['MAX_TOKENS', 'SAFETY', 'RECITATION'])('does not mark a Gemini %s response successful and keeps the received prefix', async finishReason => {
        const gemini = { ...config, apiFormat: 'gemini' as const };
        fetcher.mockResolvedValueOnce(sse({ candidates: [{ content: { parts: [{ text: 'Saved prefix' }] }, finishReason }] }));
        await expect(requestImageQuestion(gemini, messages, vi.fn(), { taskId: 'attempt' })).rejects.toThrow(finishReason);
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'failed', params: { textProgress: 'Saved prefix' } });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('accepts Gemini STOP as a completed text response', async () => {
        const gemini = { ...config, apiFormat: 'gemini' as const };
        fetcher.mockResolvedValueOnce(sse({ candidates: [{ content: { parts: [{ text: 'Complete' }] }, finishReason: 'STOP' }] }));
        await expect(requestImageQuestion(gemini, messages, vi.fn(), { taskId: 'attempt' })).resolves.toBe('Complete');
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'completed' });
    });
    it('persists text before displaying it and retrieves the same old response without another POST', async () => {
        const displayed: string[] = [];
        fetcher.mockResolvedValueOnce(sse(created, delta));
        await expect(requestImageQuestion(config, messages, text => { displayed.push(text); }, { taskId: 'attempt' })).rejects.toThrow('连接中断');
        expect(displayed).toEqual(['Once upon a time']);
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'processing', params: { textProgress: displayed[0], localTextResponseId: 'resp_original', localInput: { messages } } });
        await taskStorageWriter.mutateWorkflowTask('attempt', 'owner', task => { task.startedAt = Date.now() - 30 * 60_000; return true; });
        taskStorageWriter.close();
        fetcher.mockResolvedValueOnce(json(payload()));
        expect(await recoverWorkflowTask('attempt', config)).toEqual({ resultKind: 'text', text: payload().output_text });
        expect(fetcher.mock.calls[1]).toEqual(['https://example.test/v1/responses/resp_original', { headers: { Authorization: 'Bearer original-key' } }]);
        expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
        expect(await recoverWorkflowTask('attempt', config)).toMatchObject({ text: payload().output_text });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('keeps an interrupted response without an id pending instead of claiming the channel is unsupported', async () => {
        await interruptedWithoutResponseId();
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'processing', params: { textProgress: 'Once upon a time', recoveryError: expect.stringContaining('连接中断') } });
        expect(await recoverWorkflowTask('attempt', config)).toBeNull();
        expect((await taskStorageWriter.getTask('attempt'))?.params.textRecoveryUnavailable).toBeUndefined();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('keeps a partial query pending and saves the later full result', async () => {
        await interrupted();
        fetcher.mockResolvedValueOnce(json(payload('in_progress', 'Once upon a time, more'))).mockResolvedValueOnce(json(payload()));
        expect(await recoverWorkflowTask('attempt', config)).toBeNull();
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'processing', params: { textProgress: 'Once upon a time, more' } });
        expect(await recoverWorkflowTask('attempt', config)).toMatchObject({ text: payload().output_text });
    });

    it('stores a completed stream and never queries or submits it again', async () => {
        fetcher.mockResolvedValueOnce(sse(created, delta, { type: 'response.completed', response: payload() }));
        expect(await requestImageQuestion(config, messages, vi.fn(), { taskId: 'attempt' })).toBe(payload().output_text);
        taskStorageWriter.close();
        expect(await recoverWorkflowTask('attempt', config)).toMatchObject({ text: payload().output_text });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('accepts a complete JSON response from a provider that ignores streaming', async () => {
        fetcher.mockResolvedValueOnce(json(payload()));
        expect(await requestImageQuestion(config, messages, vi.fn(), { taskId: 'attempt' })).toBe(payload().output_text);
        expect(await recoverWorkflowTask('attempt', config)).toMatchObject({ text: payload().output_text });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it.each(['stream', 'json'])('persists a failed terminal %s response without discarding its prefix', async format => {
        const failed = { ...payload('failed', 'Once upon a time'), error: { message: 'provider rejected' } };
        fetcher.mockResolvedValueOnce(format === 'stream' ? sse(created, delta, { type: 'response.failed', response: failed }) : json(failed));
        await expect(requestImageQuestion(config, messages, vi.fn(), { taskId: 'attempt' })).rejects.toThrow('provider rejected');
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'failed', params: { textProgress: 'Once upon a time' } });
        await expect(recoverWorkflowTask('attempt', config)).rejects.toMatchObject({ name: 'WorkflowTaskFailed' });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it.each(['failed', 'cancelled', 'incomplete'])('preserves partial output when the provider confirms %s', async status => {
        await interrupted();
        fetcher.mockResolvedValueOnce(json({ ...payload(status, 'Partial text'), error: status === 'failed' ? { message: 'provider rejected' } : undefined }));
        await expect(recoverWorkflowTask('attempt', config)).rejects.toMatchObject({ name: 'WorkflowTaskFailed' });
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'failed', params: { textProgress: 'Partial text' } });
        await expect(recoverWorkflowTask('attempt', config)).rejects.toMatchObject({ name: 'WorkflowTaskFailed' });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it.each([404, 503])('does not mistake retrieval HTTP %s for provider generation failure', async status => {
        await interrupted(); fetcher.mockResolvedValueOnce(json({ error: { message: 'query unavailable' } }, status));
        await expect(recoverWorkflowTask('attempt', config)).rejects.toThrow('query unavailable');
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'processing', params: { textProgress: 'Once upon a time' } });
    });

    it.each([200, 400, 404, 405, 501])('stops unavailable GET queries across reload without marking generation failed (HTTP %s)', async status => {
        await interrupted();
        fetcher.mockResolvedValueOnce(json({ error: { message: status === 405 ? 'Method not allowed' : status === 501 ? 'Not implemented' : 'Invalid URL (GET /v1/responses/resp_original)' } }, status));
        await expect(recoverWorkflowTask('attempt', config)).rejects.toMatchObject({ name: 'WorkflowRecoveryUnavailable', message: expect.stringContaining('无法自动找回') });
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'processing', params: { localTextResponseId: 'resp_original', textProgress: 'Once upon a time', textRecoveryUnavailable: expect.any(String) } });
        taskStorageWriter.close();
        await expect(recoverWorkflowTask('attempt', config)).rejects.toMatchObject({ name: 'WorkflowRecoveryUnavailable' });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
        // An original executor may still finish in another tab; its result remains authoritative.
        await taskStorageWriter.mutateWorkflowTask('attempt', 'owner', task => { task.status = 'completed'; task.params.nativeResult = { resultKind: 'text', text: 'Late full result' }; return true; });
        expect(await recoverWorkflowTask('attempt', config)).toMatchObject({ text: 'Late full result' });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('does not persist an unsupported-query marker after the account changes', async () => {
        await interrupted();
        fetcher.mockImplementationOnce(async () => { scope.id = 'other'; return json({ error: { message: 'Invalid URL (GET /v1/responses/resp_original)' } }, 404); });
        expect(await recoverWorkflowTask('attempt', config)).toBeNull();
        expect((await taskStorageWriter.getTask('attempt'))?.params.textRecoveryUnavailable).toBeUndefined();
    });

    it('rejects a mismatched response id without replacing text', async () => {
        await interrupted(); fetcher.mockResolvedValueOnce(json({ ...payload(), id: 'another-response' }));
        await expect(recoverWorkflowTask('attempt', config)).rejects.toThrow('不匹配');
        expect((await taskStorageWriter.getTask('attempt'))?.status).toBe('processing');
    });

    it('does not query with a replaced key or another account', async () => {
        await interrupted();
        await expect(recoverWorkflowTask('attempt', { ...config, apiKey: 'other-key' })).rejects.toThrow('等待原配置');
        scope.id = 'other';
        expect(await recoverWorkflowTask('attempt', config)).toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('ignores a retrieval that finishes after account switch', async () => {
        await interrupted();
        fetcher.mockImplementationOnce(async () => { scope.id = 'other'; return json(payload()); });
        expect(await recoverWorkflowTask('attempt', config)).toBeNull();
        expect((await taskStorageWriter.getTask('attempt'))?.status).toBe('processing');
    });

    it('keeps Gemini partial text without claiming success or inventing a query endpoint', async () => {
        const gemini = { ...config, apiFormat: 'gemini' as const };
        fetcher.mockResolvedValueOnce(sse({ candidates: [{ content: { parts: [{ text: 'Received prefix' }] } }] }));
        await expect(requestImageQuestion(gemini, messages, vi.fn(), { taskId: 'attempt' })).rejects.toThrow('连接中断');
        taskStorageWriter.close();
        await expect(recoverWorkflowTask('attempt', gemini)).rejects.toMatchObject({ name: 'WorkflowRecoveryUnavailable' });
        expect(await taskStorageWriter.getTask('attempt')).toMatchObject({ status: 'processing', params: { textProgress: 'Received prefix' } });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('keeps a definitive submission rejection failed across refresh', async () => {
        fetcher.mockResolvedValueOnce(json({ error: { message: 'unavailable group' } }, 403));
        await expect(requestImageQuestion(config, messages, vi.fn(), { taskId: 'attempt' })).rejects.toThrow('unavailable group');
        await expect(recoverWorkflowTask('attempt', config)).rejects.toMatchObject({ name: 'WorkflowTaskFailed', message: 'unavailable group' });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
});
