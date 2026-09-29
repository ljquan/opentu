import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { BATCH_IMAGE_DOWNLOAD_TIMEOUT_MS, exportBatchResults, loadBatchReference, loadResult } from '../src/services/document-batch-export';
import { strFromU8, unzipSync } from 'fflate';
import type { BatchWorkItem, DocumentBatch } from '../src/types/document-batch';
const cache = vi.hoisted(() => ({ getCachedBlob: vi.fn() }));
vi.mock('../../../services/unified-cache-service', () => ({ unifiedCacheService: cache }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('document image loading boundary', () => {
    it('cancels a stalled response body at 60 seconds', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn(async (_url, options) => new Response(new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(options.signal.reason)); } })));
        vi.stubGlobal('fetch', fetcher);
        const pending = loadBatchReference({ id: 'slow', name: 'slow', source: 'test', url: 'https://example.com/slow.png' });
        const assertion = expect(pending).rejects.toThrow('60 秒');
        await vi.advanceTimersByTimeAsync(BATCH_IMAGE_DOWNLOAD_TIMEOUT_MS);
        await assertion;
        expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('exports later results and a failure manifest after one stalled download', async () => {
        vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
        cache.getCachedBlob.mockResolvedValue(null);
        const png = new Uint8Array([137,80,78,71,13,10,26,10]);
        vi.stubGlobal('fetch', vi.fn(async (url, options) => String(url).includes('slow')
            ? new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)))
            : new Response(png)));
        const downloads: Blob[] = [];
        vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (blob: Blob) => { downloads.push(blob); return 'blob:download'; }, revokeObjectURL: vi.fn() }));
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const batch = { id: 'b', scopeId: 'owner', title: 'export' } as DocumentBatch;
        const items = [{ batchId: 'b', scopeId: 'owner', runId: 'run', slot: 0, snapshot: { title: 'row', rowId: 'r', source: 'sheet!2' }, results: [{ id: 'slow', url: 'https://example.com/slow.png' }, { id: 'good', url: 'https://example.com/good.png' }] }] as BatchWorkItem[];
        const pending = exportBatchResults(batch, items, ['slow', 'good']);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(BATCH_IMAGE_DOWNLOAD_TIMEOUT_MS);
        const result = await pending;
        expect(result).toMatchObject({ saved: 1, failed: [{ id: 'slow', message: expect.stringContaining('60 秒') }] });
        const files = unzipSync(new Uint8Array(await downloads[0].arrayBuffer()));
        expect(Object.keys(files).filter(name => name.endsWith('.png'))).toHaveLength(1);
        expect(JSON.parse(strFromU8(files['manifest.json']))).toMatchObject({ results: [{ resultId: 'good' }], failures: [{ id: 'slow' }] });
        expect(downloads).toHaveLength(2);
    });
    it('reads virtual result URLs from cache without a network request', async () => {
        const png = new NodeBlob([new Uint8Array([137,80,78,71,13,10,26,10])], {type:'image/png'});
        cache.getCachedBlob.mockResolvedValueOnce(png);
        const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
        const result = await loadResult('/__aitu_cache__/result.png', 'result', 'batch');
        expect(result.blob?.size).toBe(png.size);
        expect(result.mimeType).toBe('image/png');
        expect(cache.getCachedBlob).toHaveBeenCalledWith('/__aitu_cache__/result.png', {allowNetwork:false});
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('rejects HTML even with HTTP 200 and omits credentials', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('<html>expired link</html>', { status: 200 }));
        vi.stubGlobal('fetch', fetcher);
        await expect(loadBatchReference({id:'r',name:'r',source:'test',url:'https://example.com/signed?token=abc'})).rejects.toThrow();
        expect(fetcher).toHaveBeenCalledWith('https://example.com/signed?token=abc', expect.objectContaining({credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'}));
    });
    it('rejects an oversized declared response before reading its body', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('image', {headers:{'content-length':String(26*1024*1024)}})));
        await expect(loadBatchReference({id:'r',name:'r',source:'test',url:'https://example.com/a.png'})).rejects.toThrow(/25 MiB/);
    });
    it('honors cancellation even for a frozen local reference', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(loadBatchReference({id:'r',name:'r',source:'test',url:'',blob:new Blob(['x'])},controller.signal)).rejects.toMatchObject({name:'AbortError'});
    });
});
