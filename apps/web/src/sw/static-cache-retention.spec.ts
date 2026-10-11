import { describe, expect, it, vi } from 'vitest';
import { mayRemovePreviousStaticCaches } from './static-cache-retention';
describe('previous-version lazy assets', () => {
    it('retains caches when an old page remains open beyond the cleanup timer', async () => {
        const matchAll = vi.fn(async () => [{ id: 'old-page', url: 'https://app.test/workflow' }] as WindowClient[]);
        expect(await mayRemovePreviousStaticCaches({ matchAll } as any)).toBe(false);
        expect(matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    });
    it('allows cleanup only after all pages have closed', async () => {
        expect(await mayRemovePreviousStaticCaches({ matchAll: async () => [] } as any)).toBe(true);
    });
    it('does not interpret a failed client enumeration as permission to delete assets', async () => {
        await expect(mayRemovePreviousStaticCaches({ matchAll: async () => { throw new Error('unavailable'); } } as any)).rejects.toThrow('unavailable');
    });
    it('can clean up on the first new navigation after a worker restart', async () => {
        const matchAll = vi.fn(async () => [{ id: 'new-page' }] as WindowClient[]);
        expect(await mayRemovePreviousStaticCaches({ matchAll } as any, 'new-page')).toBe(true);
        matchAll.mockResolvedValue([{ id: 'new-page' }, { id: 'old-page' }] as WindowClient[]);
        expect(await mayRemovePreviousStaticCaches({ matchAll } as any, 'new-page')).toBe(false);
        expect(await mayRemovePreviousStaticCaches({ matchAll } as any)).toBe(false);
    });
});
