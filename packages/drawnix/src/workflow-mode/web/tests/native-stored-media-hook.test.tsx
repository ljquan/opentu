import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStoredMedia, useStoredImage } from '../src/hooks/use-stored-media';
import { imageLeaseCache, mediaLeaseCache } from '../src/services/media-leases';
const mocks = vi.hoisted(() => ({ image: vi.fn(), preview: vi.fn(), media: vi.fn() }));
vi.mock('../src/services/image-storage', () => ({ getImageBlob: mocks.image, getImagePreviewBlob: mocks.preview }));
vi.mock('../src/services/file-storage', () => ({ getMediaBlob: mocks.media }));
vi.mock('../../../../services/memory-monitor-service', () => ({ memoryMonitorService: { registerCleanupHandler: vi.fn() } }));
let n = 0;
const revoke = vi.fn();
beforeEach(() => {
    vi.clearAllMocks(); n = 0;
    mocks.image.mockResolvedValue(new Blob(['original']));
    mocks.media.mockResolvedValue(new Blob(['video']));
    mocks.preview.mockResolvedValue(new Blob(['preview']));
    vi.stubGlobal('URL', class extends URL { static createObjectURL = () => `blob:hook-${++n}`; static revokeObjectURL = revoke; });
});
afterEach(() => { cleanup(); imageLeaseCache.trim(true); mediaLeaseCache.trim(true); vi.unstubAllGlobals(); });
describe('stored media consumers', () => {
    it('does not return a revoked prior activation when a visible consumer returns', async () => {
        const view = renderHook(({ visible }) => useStoredMedia(visible ? 'image:visibility' : undefined, visible ? 'blob:old' : undefined, 'image'), { initialProps: { visible: true } });
        await waitFor(() => expect(view.result.current).toBe('blob:hook-1'));
        view.rerender({ visible: false }); imageLeaseCache.trim(true);
        view.rerender({ visible: true });
        expect(view.result.current).toBeUndefined();
        await waitFor(() => expect(view.result.current).toBe('blob:hook-2'));
    });

    it('reacts to storage replacement without changing the caller metadata', async () => {
        const view = renderHook(() => useStoredMedia('image:replacement', 'blob:old', 'image'));
        await waitFor(() => expect(view.result.current).toBe('blob:hook-1'));
        act(() => imageLeaseCache.invalidate('image:replacement:'));
        await waitFor(() => expect(view.result.current).toBe('blob:hook-2'));
        expect(revoke).toHaveBeenCalledWith('blob:hook-1');
    });
    it('a broken preview falls back to the stored original and releases the preview lease', async () => {
        const view = renderHook(() => useStoredImage('image:broken-preview', 'blob:old'));
        await waitFor(() => expect(view.result.current.source).toBe('blob:hook-1'));
        act(() => view.result.current.onError());
        await waitFor(() => expect(view.result.current.source).toBe('blob:hook-2'));
        expect(mocks.image).toHaveBeenCalledWith('image:broken-preview');
        expect(imageLeaseCache.stats().active).toBe(1);
    });
    it('uses a stored preview without loading the original and releases the view lease', async () => {
        const view = renderHook(() => useStoredMedia('image:one', 'blob:old', 'image', true));
        expect(view.result.current).toBeUndefined();
        await waitFor(() => expect(view.result.current).toBe('blob:hook-1'));
        expect(mocks.image).not.toHaveBeenCalled();
        expect(imageLeaseCache.stats().active).toBe(1);
        view.unmount();
        imageLeaseCache.trim(true);
        expect(revoke).toHaveBeenCalledWith('blob:hook-1');
    });
    it('changing source releases the old lease and does not show an old URL during loading', async () => {
        const view = renderHook(({ key }) => useStoredMedia(key, 'blob:old', 'image'), { initialProps: { key: 'image:one' } });
        await waitFor(() => expect(view.result.current).toBe('blob:hook-1'));
        view.rerender({ key: 'image:two' });
        expect(view.result.current).toBeUndefined();
        await waitFor(() => expect(view.result.current).toBe('blob:hook-2'));
        expect(imageLeaseCache.stats().active).toBe(1);
    });
    it('late completion after unmount is released rather than becoming active', async () => {
        let finish!: (blob: Blob) => void;
        mocks.image.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const view = renderHook(() => useStoredMedia('image:late', 'blob:old', 'image'));
        await waitFor(() => expect(mocks.image).toHaveBeenCalled());
        view.unmount();
        await act(async () => finish(new Blob(['late'])));
        expect(imageLeaseCache.stats().active).toBe(0);
    });
    it('missing local data never renders an invalid old-session Blob URL', async () => {
        mocks.image.mockResolvedValue(null);
        const view = renderHook(() => useStoredMedia('image:missing', 'blob:old-session', 'image'));
        await waitFor(() => expect(mocks.image).toHaveBeenCalled());
        expect(view.result.current).toBeUndefined();
    });
    it('remote-only resources keep signed URL untouched', () => {
        const signed = 'https://cdn.test/image.png?signature=a';
        const view = renderHook(() => useStoredMedia(undefined, signed, 'image'));
        expect(view.result.current).toBe(signed);
        expect(mocks.image).not.toHaveBeenCalled();
    });
});
