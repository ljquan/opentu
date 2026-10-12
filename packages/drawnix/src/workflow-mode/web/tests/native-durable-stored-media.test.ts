import { describe, expect, it, vi } from 'vitest';
import { durableWorkflowValue } from '../src/services/workflow-local-task';

const read = vi.hoisted(() => ({ image: vi.fn(), media: vi.fn() }));
vi.mock('../src/services/image-storage', () => ({ getImageBlob: read.image }));
vi.mock('../src/services/file-storage', () => ({ getMediaBlob: read.media }));

describe('stored history task input', () => {
    it('persists old-session image/video/audio references by storage key before fetching blob strings', async () => {
        read.image.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
        read.media.mockResolvedValue(new Blob(['media'], { type: 'video/mp4' }));
        const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('expired URL'));
        try {
            const result = await durableWorkflowValue({
                image: { storageKey: 'image:one', dataUrl: 'blob:expired' },
                videos: [{ storageKey: 'video:one', url: '' }],
                audios: [{ storageKey: 'audio:one', url: 'blob:expired-audio' }],
            });
            expect(result.image.dataUrl).toMatch(/^data:image\/png;base64,/);
            expect(result.videos[0].url).toMatch(/^data:video\/mp4;base64,/);
            expect(result.audios[0].url).toMatch(/^data:/);
            expect(fetch).toHaveBeenCalledWith('blob:expired');
            expect(fetch).toHaveBeenCalledWith('blob:expired-audio');
            expect(result.image.storageKey).toBe('image:one');
        } finally { fetch.mockRestore(); }
    });
    it('keeps an explicit transformed image instead of overwriting it with the stored original', async () => {
        read.image.mockClear();
        const value = { storageKey: 'image:one', dataUrl: 'data:image/png;base64,transformed' };
        expect(await durableWorkflowValue(value)).toEqual(value);
        expect(read.image).not.toHaveBeenCalled();
    });
    it('keeps a live transformed Blob input and uses storage only for expired URLs', async () => {
        read.image.mockClear();
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['edited'], { type: 'image/png' }) } as Response);
        try {
            const result = await durableWorkflowValue({ storageKey: 'image:one', dataUrl: 'blob:live-edit' });
            expect(result.dataUrl).toBe('data:image/png;base64,ZWRpdGVk');
            expect(read.image).not.toHaveBeenCalled();
        } finally { fetch.mockRestore(); }
    });
});
