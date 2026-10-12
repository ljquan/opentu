import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoredMediaUrls } from '../src/services/stored-media-urls';

let sequence = 0;
const createUrl = vi.fn(() => `blob:resource-${++sequence}`);
const revokeUrl = vi.fn();
beforeEach(() => {
    sequence = 0;
    vi.clearAllMocks();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl; });
});
afterEach(() => vi.unstubAllGlobals());

describe('stored media URL ownership', () => {
    it('coalesces concurrent reads and creates one URL for the same stored file', async () => {
        const urls = new StoredMediaUrls();
        const read = vi.fn(async () => new Blob(['media']));
        expect(await Promise.all([urls.resolve('file', read), urls.resolve('file', read)])).toEqual(['blob:resource-1', 'blob:resource-1']);
        expect(read).toHaveBeenCalledOnce();
        expect(createUrl).toHaveBeenCalledOnce();
    });

    it('returns the new version instead of adopting a stale read after replacement', async () => {
        const urls = new StoredMediaUrls();
        let finish!: (blob: Blob) => void;
        const reading = urls.resolve('file', () => new Promise(resolve => { finish = resolve; }));
        await Promise.resolve();
        urls.set('file', 'blob:new');
        finish(new Blob(['old']));
        expect(await reading).toBe('blob:new');
        expect(createUrl).not.toHaveBeenCalled();
    });

    it('ignores a stale read failure once a new version is available', async () => {
        const urls = new StoredMediaUrls();
        let fail!: (error: Error) => void;
        const reading = urls.resolve('file', () => new Promise((_resolve, reject) => { fail = reject; }));
        await Promise.resolve();
        urls.set('file', 'blob:new');
        fail(new Error('old read failed'));
        expect(await reading).toBe('blob:new');
    });

    it('does not resurrect a URL when a pending file is deleted', async () => {
        const urls = new StoredMediaUrls();
        let finish!: (blob: Blob) => void;
        const reading = urls.resolve('file', () => new Promise(resolve => { finish = resolve; }));
        await Promise.resolve();
        urls.delete('file');
        finish(new Blob(['deleted']));
        expect(await reading).toBeUndefined();
        expect(createUrl).not.toHaveBeenCalled();
    });

    it('keeps legacy versions valid until explicit deletion and then releases all versions once', () => {
        const urls = new StoredMediaUrls();
        urls.set('file', 'blob:first');
        urls.set('file', 'blob:second');
        urls.invalidate('file');
        urls.set('file', 'blob:third');
        expect(revokeUrl).not.toHaveBeenCalled();
        urls.delete('file');
        urls.delete('file');
        expect(revokeUrl.mock.calls.map(call => call[0])).toEqual(['blob:first', 'blob:second', 'blob:third']);
    });

    it('allows a failed read to be retried and does not cache missing files', async () => {
        const urls = new StoredMediaUrls();
        await expect(urls.resolve('file', async () => { throw new Error('blocked'); })).rejects.toThrow('blocked');
        expect(await urls.resolve('file', async () => null)).toBeUndefined();
        expect(await urls.resolve('file', async () => new Blob(['retry']))).toBe('blob:resource-1');
    });
});
