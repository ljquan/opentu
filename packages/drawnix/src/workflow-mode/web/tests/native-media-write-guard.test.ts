import { describe, expect, it, vi } from 'vitest';
import { MediaWriteGuard } from '../src/services/media-write-guard';

describe('cleanup and media writers', () => {
    it('retains a write completed after the cleanup snapshot', async () => {
        const guard = new MediaWriteGuard();
        const snapshot = guard.snapshot();
        const release = guard.retain('image:one');
        await guard.run('image:one', async () => undefined);
        release();
        const remove = vi.fn(async () => undefined);
        await guard.removeIfUnchanged('image:one', snapshot, remove);
        expect(remove).not.toHaveBeenCalled();
        snapshot.release();
        const later = guard.snapshot();
        await guard.removeIfUnchanged('image:one', later, remove);
        expect(remove).toHaveBeenCalledOnce(); later.release();
    });
    it('checks a queued removal after a fixed-key replacement starts', async () => {
        const guard = new MediaWriteGuard();
        const snapshot = guard.snapshot();
        const remove = vi.fn(async () => undefined);
        const cleaning = guard.removeIfUnchanged('video:one', snapshot, remove);
        const release = guard.retain('video:one');
        const writing = guard.run('video:one', async () => undefined);
        await cleaning; await writing; release();
        expect(remove).not.toHaveBeenCalled(); snapshot.release();
    });
});
