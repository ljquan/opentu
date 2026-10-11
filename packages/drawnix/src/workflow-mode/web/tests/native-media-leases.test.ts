import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaLeaseCache } from '../src/services/media-leases';
vi.mock('../../../../services/memory-monitor-service', () => ({ memoryMonitorService: { registerCleanupHandler: vi.fn() } }));
let index = 0;
const revoke = vi.fn();
beforeEach(() => {
    index = 0;
    vi.clearAllMocks();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = () => `blob:lease-${++index}`; static revokeObjectURL = revoke; });
});
afterEach(() => vi.unstubAllGlobals());
describe('leased media budgets', () => {
    it('limits storage reads and settles an invalidated queued item without reading it', async () => {
        const cache = new MediaLeaseCache(100, 1);
        let finish!: (blob: Blob) => void;
        const first = cache.acquire('image:first', () => new Promise(resolve => { finish = resolve; }));
        const readNext = vi.fn(async () => new Blob(['next']));
        const second = cache.acquire('image:second', readNext);
        const removed = vi.fn(async () => new Blob(['removed']));
        const third = cache.acquire('image:removed', removed);
        expect(readNext).not.toHaveBeenCalled();
        cache.invalidate('image:removed');
        finish(new Blob(['first']));
        const [a, b, c] = await Promise.all([first, second, third]);
        expect(readNext).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled(); expect(c).toBeUndefined();
        a!.release(); b!.release(); cache.trim(true);
    });
    it('shares concurrent reads and retains an active resource even above budget', async () => {
        const cache = new MediaLeaseCache(1);
        const read = vi.fn(async () => new Blob(['big']));
        const [a, b] = await Promise.all([cache.acquire('image:a', read), cache.acquire('image:a', read)]);
        expect(read).toHaveBeenCalledOnce();
        expect(a?.url).toBe(b?.url);
        a!.release();
        cache.trim(true);
        expect(revoke).not.toHaveBeenCalled();
        b!.release();
        expect(revoke).toHaveBeenCalledOnce();
        expect(cache.stats().bytes).toBe(0);
    });
    it('release is idempotent and only cold resources are reclaimed', async () => {
        const cache = new MediaLeaseCache(100);
        const active = await cache.acquire('active', async () => new Blob(['active']));
        const cold = await cache.acquire('cold', async () => new Blob(['cold']));
        cold!.release(); cold!.release();
        cache.trim(true);
        expect(revoke).toHaveBeenCalledWith(cold!.url);
        expect(revoke).not.toHaveBeenCalledWith(active!.url);
        expect(cache.stats().active).toBe(1);
        active!.release(); cache.trim(true);
        expect(cache.stats().entries).toBe(0);
    });
    it('replacement preserves active old versions until final release', async () => {
        const cache = new MediaLeaseCache(100);
        const old = await cache.acquire('image:a:original', async () => new Blob(['old']));
        cache.invalidate('image:a:');
        expect(revoke).not.toHaveBeenCalled();
        const current = await cache.acquire('image:a:original', async () => new Blob(['new']));
        expect(current!.url).not.toBe(old!.url);
        old!.release();
        expect(revoke).toHaveBeenCalledWith(old!.url);
        expect(revoke).not.toHaveBeenCalledWith(current!.url);
        current!.release(); cache.trim(true);
    });
    it('a late read cannot recreate an invalidated version', async () => {
        const cache = new MediaLeaseCache(100);
        let finish!: (blob: Blob) => void;
        const pending = cache.acquire('image:a:original', () => new Promise(resolve => { finish = resolve; }));
        await Promise.resolve();
        cache.invalidate('image:a:');
        finish(new Blob(['old']));
        expect(await pending).toBeUndefined();
        expect(cache.stats().entries).toBe(0);
    });
});
