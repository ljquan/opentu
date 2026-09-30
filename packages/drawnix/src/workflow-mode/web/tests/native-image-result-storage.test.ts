import { afterEach, describe, expect, it, vi } from 'vitest';
import { storeWorkflowImageResults } from '../src/lib/canvas/canvas-generation-helpers';
import { deleteStoredImages, uploadImage } from '../src/services/image-storage';

vi.mock('../src/services/image-storage', () => ({ uploadImage: vi.fn(), deleteStoredImages: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => vi.resetAllMocks());

describe('workflow multi-image result storage', () => {
    it('preserves provider ordering and the original slot when downloads finish out of order', async () => {
        const urls = Array.from({ length: 4 }, (_, i) => `https://example.test/${i}.png`);
        const finish: Array<() => void> = [];
        vi.mocked(uploadImage).mockImplementation(url => new Promise(resolve => {
            const index = urls.indexOf(String(url));
            finish[index] = () => resolve({ url: `blob:${index}`, storageKey: `image:${index}`, width: 1200, height: 800, bytes: 10 + index, mimeType: 'image/png' });
        }));
        const pending = storeWorkflowImageResults(urls, 'original-slot');
        for (const index of [3, 1, 2, 0]) finish[index]();
        const images = await pending;
        expect(images).toHaveLength(4);
        expect(images[0].id).toBe('original-slot');
        expect(new Set(images.map(image => image.id)).size).toBe(4);
        expect(images.map(image => image.storageKey)).toEqual(['image:0', 'image:1', 'image:2', 'image:3']);
        expect(images.every(image => image.status === 'success' && image.naturalWidth === 1200 && image.naturalHeight === 800)).toBe(true);
    });

    it('does not report partial storage as a completed result that would stop recovery', async () => {
        vi.mocked(uploadImage).mockResolvedValueOnce({ url: 'blob:0', storageKey: 'image:0', width: 1, height: 1, bytes: 1, mimeType: 'image/png' }).mockRejectedValueOnce(new Error('download failed'));
        await expect(storeWorkflowImageResults(['https://example.test/0.png', 'https://example.test/1.png'], 'slot')).rejects.toThrow('download failed');
        expect(deleteStoredImages).toHaveBeenCalledWith(['image:0']);
    });
    it('removes newly stored images when the target was deleted during download', async () => {
        vi.mocked(uploadImage).mockResolvedValue({ url: 'blob:new', storageKey: 'image:new', width: 1, height: 1, bytes: 1, mimeType: 'image/png' });
        await expect(storeWorkflowImageResults(['https://example.test/0.png'], 'slot', { isCurrent: () => false })).rejects.toMatchObject({ name: 'AbortError' });
        expect(deleteStoredImages).toHaveBeenCalledWith(['image:new']);
    });

    it('discards late downloads after cancellation and rejects empty results', async () => {
        const controller = new AbortController();
        vi.mocked(uploadImage).mockImplementation(async () => {
            controller.abort();
            return { url: 'blob:0', width: 1, height: 1, bytes: 1, mimeType: 'image/png' };
        });
        await expect(storeWorkflowImageResults(['https://example.test/0.png'], 'slot', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        await expect(storeWorkflowImageResults([], 'slot')).rejects.toThrow('未返回图片结果');
    });
});
