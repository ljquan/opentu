import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTuziModels, parseTuziModels, tuziPricingUrl } from '../src/services/tuzi-model-discovery';
import { createModelChannel, defaultConfig, resolveModelRequestConfig } from '../src/stores/use-config-store';
import { sanitizeConfigForExport } from '../src/services/config-file';
import { pollVideoGenerationTask } from '../src/services/api/video';
import axios from 'axios';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const channel = () => createModelChannel({ id: 'tuzi', providerKind: 'tuzi-fixed', activeCredentialId: 'b',
    credentials: ['a', 'b'].map(id => ({ id, label: id, apiKey: `test-${id}`, createdAt: 1 })),
    models: [{ name: 'video-model', capability: 'video' }] });

describe('Tuzi explicit discovery', () => {
    it('sorts valid ranks, caps hot at 200 and keeps all mode complete', () => {
        const data = Array.from({ length: 250 }, (_, i) => ({ model_name: `m${250-i}`, hot_rank: 250-i }));
        data.push({ model_name: 'unranked', hot_rank: 0 }, data[0]);
        const hot = parseTuziModels({ success: true, data }, 'hot');
        expect(hot).toHaveLength(200);
        expect(hot[0].name).toBe('m1');
        expect(hot[199].name).toBe('m200');
        expect(parseTuziModels({ success: true, data }, 'all')).toHaveLength(251);
    });
    it('rejects invalid, empty and over-budget lists and recognizes video tags', () => {
        for (const data of [null, [], Array(10001).fill({ model_name: 'a' })]) {
            expect(() => parseTuziModels({ success: true, data }, 'all')).toThrow();
        }
        expect(() => parseTuziModels({ success: true, data: [{ model_name: 'a' }] }, 'hot')).toThrow();
        expect(parseTuziModels({ success: true, data: [{ model_name: 'minimaxh3', tags: '视频' }] }, 'all')[0].capability).toBe('video');
    });
    it('fetches public data without credentials only when invoked', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: [{ model_name: 'a', hot_rank: 1 }] }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
        vi.stubGlobal('fetch', fetcher);
        expect(fetcher).not.toHaveBeenCalled();
        await fetchTuziModels('hot');
        expect(fetcher).toHaveBeenCalledWith('/__opentu_tuzi_session__/api/pricing', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
        expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
    });
    it('uses the same-origin proxy for local, LAN and hosted apps, and direct path on Tuzi', () => {
        for (const origin of ['http://localhost:7204', 'http://192.168.50.87:7204', 'https://opentu.ai']) {
            expect(tuziPricingUrl(origin)).toBe('/__opentu_tuzi_session__/api/pricing');
        }
        expect(tuziPricingUrl('https://api.tu-zi.com')).toBe('/api/pricing');
    });
    it('explains missing proxy SPA responses and malformed JSON', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }))
            .mockResolvedValueOnce(new Response('{', { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetcher);
        await expect(fetchTuziModels('all')).rejects.toThrow('同源代理配置');
        await expect(fetchTuziModels('hot')).rejects.toThrow('不是有效 JSON');
    });
    it('explains network failures without exposing transport details', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(fetchTuziModels('all')).rejects.toThrow('无法连接 Tuzi 榜单');
    });
    it('propagates HTTP failure and cancellation', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
        vi.stubGlobal('fetch', fetcher);
        await expect(fetchTuziModels('all')).rejects.toThrow('HTTP 503');
        const controller = new AbortController(); controller.abort();
        await expect(fetchTuziModels('all', controller.signal)).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('aborts timed-out discovery', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })));
        const assertion = expect(fetchTuziModels('all')).rejects.toThrow('超时');
        await vi.advanceTimersByTimeAsync(20000);
        await assertion;
    });
    it('enforces fixed endpoint and current credential with no fallback', () => {
        const fixed = { ...channel(), baseUrl: 'https://wrong.example', apiKey: 'wrong' };
        const config = { ...defaultConfig, channels: [fixed] };
        expect(resolveModelRequestConfig(config, 'tuzi::video-model')).toMatchObject({ baseUrl: 'https://api.tu-zi.com', apiKey: 'test-b', apiFormat: 'openai' });
        fixed.activeCredentialId = 'missing';
        expect(resolveModelRequestConfig(config, 'tuzi::video-model').apiKey).toBe('');
    });
    it('redacts fixed keys including the legacy top-level mirror without mutating config', () => {
        const config = { ...defaultConfig, apiKey: 'test-b', channels: [channel()] };
        const json = JSON.stringify(sanitizeConfigForExport(config));
        expect(json).not.toContain('test-a'); expect(json).not.toContain('test-b');
        expect(config.channels[0].credentials).toHaveLength(2);
    });
    it('refuses missing original task credentials before making requests', async () => {
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        await expect(pollVideoGenerationTask({ ...defaultConfig, channels: [channel()] }, {
            id: 'task', provider: 'openai', model: 'tuzi::video-model', tuziCredential: { channelId: 'tuzi', credentialId: 'deleted' },
        })).rejects.toThrow('原任务');
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('queries an old task using its original key after the current key changes', async () => {
        const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { status: 'queued' } });
        await pollVideoGenerationTask({ ...defaultConfig, channels: [channel()] }, {
            id: 'task', provider: 'openai', model: 'tuzi::video-model', tuziCredential: { channelId: 'tuzi', credentialId: 'a' },
        });
        expect(get).toHaveBeenCalledWith(expect.stringContaining('api.tu-zi.com'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-a' }) }));
    });
});
