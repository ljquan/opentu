import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createImageThumbnail } from '../src/lib/image-thumbnail';

const close = vi.fn();
const bitmap = () => ({ width: 3000, height: 2000, close }) as unknown as ImageBitmap;
let canvas: HTMLCanvasElement;
beforeEach(() => {
    vi.clearAllMocks();
    canvas = document.createElement('canvas');
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);
    vi.spyOn(canvas, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(new window.Blob(['preview'], { type: 'image/webp' })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap()));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('thumbnail resources', () => {
    it('closes the bitmap and clears canvas pixels after successful encoding', async () => {
        const output = await createImageThumbnail(new window.Blob(['original']));
        expect(output?.type).toBe('image/webp');
        expect(close).toHaveBeenCalledOnce();
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
    });

    it('releases resources if drawing throws', async () => {
        vi.mocked(canvas.getContext).mockReturnValue({ drawImage: () => { throw new Error('GPU failed'); } } as any);
        await expect(createImageThumbnail(new window.Blob(['original']))).rejects.toThrow('GPU failed');
        expect(close).toHaveBeenCalledOnce();
        expect(canvas.width).toBe(0);
    });

    it('does not retain a bitmap when the image is already small', async () => {
        vi.mocked(createImageBitmap).mockResolvedValue({ width: 32, height: 32, close } as unknown as ImageBitmap);
        expect(await createImageThumbnail(new window.Blob(['small']))).toBeUndefined();
        expect(close).toHaveBeenCalledOnce();
    });

    it('settles an unresponsive decoder and closes a bitmap that arrives after timeout', async () => {
        vi.useFakeTimers();
        let finish!: (bitmap: ImageBitmap) => void;
        vi.mocked(createImageBitmap).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const pending = createImageThumbnail(new window.Blob(['original']));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await pending).toBeUndefined();
        finish(bitmap());
        await Promise.resolve();
        await Promise.resolve();
        expect(close).toHaveBeenCalledOnce();
    });

    it('settles an unresponsive encoder without retaining decoded pixels', async () => {
        vi.useFakeTimers();
        vi.mocked(canvas.toBlob).mockImplementation(() => undefined);
        const pending = createImageThumbnail(new window.Blob(['original']));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(await pending).toBeUndefined();
        expect(close).toHaveBeenCalledOnce();
        expect(canvas.width).toBe(0);
    });
});
