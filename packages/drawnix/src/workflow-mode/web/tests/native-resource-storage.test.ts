import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    stores: new Map<string, Map<string, unknown>>(),
    get: vi.fn(),
    thumbnail: vi.fn(),
    createUrl: vi.fn(),
    revokeUrl: vi.fn(),
}));
vi.mock('localforage', () => ({ default: {
    createInstance: ({ storeName }: { storeName: string }) => {
        const values = mocks.stores.get(storeName) || new Map<string, unknown>();
        mocks.stores.set(storeName, values);
        return {
            getItem: (key: string) => mocks.get(storeName, key, values),
            setItem: async (key: string, value: unknown) => { values.set(key, value); return value; },
            removeItem: async (key: string) => { values.delete(key); },
            iterate: async (callback: (value: unknown, key: string) => void) => { for (const [key, value] of values) callback(value, key); },
        };
    },
} }));
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/stores/use-config-store', () => ({ withLocalProxy: (url: string) => url }));
vi.mock('@/lib/image-thumbnail', () => ({ createImageThumbnail: mocks.thumbnail }));

let imageStorage: typeof import('../src/services/image-storage');
let fileStorage: typeof import('../src/services/file-storage');
let imageProbes: HTMLImageElement[];
let autoImageLoad: boolean;
let sequence: number;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.stores.clear();
    imageProbes = [];
    autoImageLoad = true;
    sequence = 0;
    mocks.get.mockImplementation(async (_store: string, key: string, values: Map<string, unknown>) => values.get(key) ?? null);
    mocks.thumbnail.mockImplementation(async () => new window.Blob(['thumb'], { type: 'image/webp' }));
    mocks.createUrl.mockImplementation(() => `blob:file-${++sequence}`);
    vi.stubGlobal('URL', class extends URL { static createObjectURL = mocks.createUrl; static revokeObjectURL = mocks.revokeUrl; });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('unexpected fetch'); }));
    vi.stubGlobal('Image', class {
        constructor() {
            const image = document.createElement('img');
            Object.defineProperties(image, {
                naturalWidth: { value: 1600 }, naturalHeight: { value: 900 },
                src: {
                    get: () => image.getAttribute('src') || '',
                    set: (source: string) => {
                        image.setAttribute('src', source);
                        if (autoImageLoad) queueMicrotask(() => image.dispatchEvent(new Event('load')));
                    },
                },
            });
            imageProbes.push(image);
            return image;
        }
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    imageStorage = await import('../src/services/image-storage');
    fileStorage = await import('../src/services/file-storage');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('workflow media storage lifecycle', () => {
    it('does not retain unused full media URLs when imports only persist blobs', async () => {
        await imageStorage.setImageBlob('image:import', new window.Blob(['one']), false);
        await fileStorage.setMediaBlob('video:import', new window.Blob(['one']), false);
        await imageStorage.setImageBlob('image:import', new window.Blob(['two']), false);
        await fileStorage.setMediaBlob('video:import', new window.Blob(['two']), false);
        expect(mocks.createUrl).not.toHaveBeenCalled();
        expect(await imageStorage.getImageBlob('image:import')).toBe(mocks.stores.get('image_files')!.get('image:import'));
        expect(await fileStorage.resolveMediaUrl('video:import')).toBe('blob:file-1');
        expect(mocks.createUrl).toHaveBeenCalledOnce();
    });

    it('prioritizes a foreground upload over queued legacy preview regeneration', async () => {
        mocks.stores.get('image_files')!.set('image:first', new window.Blob(['first']));
        mocks.stores.get('image_files')!.set('image:backlog', new window.Blob(['backlog']));
        let finish!: (blob: Blob) => void;
        mocks.thumbnail.mockReturnValueOnce(new Promise<Blob>(resolve => { finish = resolve; }));
        await imageStorage.ensureImagePreview('image:first');
        await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledOnce());
        await imageStorage.ensureImagePreview('image:backlog');
        const foregroundBlob = new window.Blob(['foreground'], { type: 'image/png' });
        const foreground = imageStorage.uploadImage(foregroundBlob);
        await vi.waitFor(() => expect(mocks.stores.get('image_files')!.size).toBe(3));
        finish(new window.Blob(['preview']));
        await foreground;
        expect(mocks.thumbnail.mock.calls[1][0]).toBe(foregroundBlob);
        await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledTimes(3));
        expect(mocks.thumbnail.mock.calls[2][0]).toBe(mocks.stores.get('image_files')!.get('image:backlog'));
    });
    it('keeps the old image and preview valid during replacement, releasing their versions at deletion', async () => {
        const first = await imageStorage.setImageBlob('image:a', new window.Blob(['first']));
        const firstPreview = imageStorage.previewUrlFor('image:a');
        const second = await imageStorage.setImageBlob('image:a', new window.Blob(['second']));
        const secondPreview = imageStorage.previewUrlFor('image:a');
        expect(first).not.toBe(second);
        expect(firstPreview).not.toBe(secondPreview);
        expect(mocks.revokeUrl).not.toHaveBeenCalled();
        await imageStorage.deleteStoredImages(['image:a']);
        expect(mocks.revokeUrl).toHaveBeenCalledWith(first);
        expect(mocks.revokeUrl).toHaveBeenCalledWith(second);
        expect(mocks.revokeUrl).toHaveBeenCalledWith(firstPreview);
        expect(mocks.revokeUrl).toHaveBeenCalledWith(secondPreview);
    });

    it('cleans up an upload cancelled while its thumbnail is being encoded', async () => {
        let finish!: (blob: Blob) => void;
        mocks.thumbnail.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
        const controller = new AbortController();
        const pending = imageStorage.uploadImage(new window.Blob(['original']), { signal: controller.signal });
        await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledOnce());
        controller.abort();
        finish(new window.Blob(['thumbnail']));
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.stores.get('image_files')!.size).toBe(0);
        expect(mocks.stores.get('image_previews')!.size).toBe(0);
        expect(mocks.revokeUrl).toHaveBeenCalledTimes(2);
    });
    it('shares one stored preview URL and notification across concurrent consumers', async () => {
        mocks.stores.get('image_previews')!.set('image:a', { version: 1, blob: new window.Blob(['thumbnail']) });
        const listener = vi.fn();
        const unsubscribe = imageStorage.subscribeImagePreviews(listener);
        const urls = await Promise.all([imageStorage.ensureImagePreview('image:a'), imageStorage.ensureImagePreview('image:a')]);
        expect(urls).toEqual(['blob:file-1', 'blob:file-1']);
        expect(listener).toHaveBeenCalledOnce();
        expect(mocks.createUrl).toHaveBeenCalledOnce();
        unsubscribe();
    });

    it('limits local image metadata decoding to two probes and promptly cancels a queued upload', async () => {
        autoImageLoad = false;
        const controller = new AbortController();
        const first = imageStorage.uploadImage(new window.Blob(['first']));
        const second = imageStorage.uploadImage(new window.Blob(['second']));
        const queued = imageStorage.uploadImage(new window.Blob(['queued']), { signal: controller.signal });
        await vi.waitFor(() => expect(imageProbes).toHaveLength(2));
        controller.abort();
        await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
        imageProbes[0].dispatchEvent(new Event('load'));
        imageProbes[1].dispatchEvent(new Event('load'));
        await Promise.all([first, second]);
        expect(imageProbes).toHaveLength(2);
        expect(mocks.stores.get('image_files')!.size).toBe(2);
    });

    it('does not lose the original upload when a preview listener fails', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const unsubscribe = imageStorage.subscribeImagePreviews(() => { throw new Error('consumer failed'); });
        const uploaded = await imageStorage.uploadImage(new window.Blob(['original'], { type: 'image/png' }));
        expect(mocks.stores.get('image_files')!.has(uploaded.storageKey!)).toBe(true);
        expect(await imageStorage.resolveImageUrl(uploaded.storageKey)).toBe(uploaded.url);
        expect(warning).toHaveBeenCalled();
        unsubscribe();
    });
    it('coalesces stored image and file reads instead of creating orphan URLs', async () => {
        mocks.stores.get('image_files')!.set('image:a', new window.Blob(['original']));
        mocks.stores.get('media_files')!.set('file:a', new window.Blob(['video']));
        expect(await Promise.all([imageStorage.resolveImageUrl('image:a'), imageStorage.resolveImageUrl('image:a')])).toEqual(['blob:file-1', 'blob:file-1']);
        expect(await Promise.all([fileStorage.resolveMediaUrl('file:a'), fileStorage.resolveMediaUrl('file:a')])).toEqual(['blob:file-2', 'blob:file-2']);
        expect(mocks.createUrl).toHaveBeenCalledTimes(2);
    });

    it('retains old versions for legacy consumers and releases all versions on explicit deletion', async () => {
        const first = await fileStorage.setMediaBlob('file:a', new window.Blob(['old']));
        const second = await fileStorage.setMediaBlob('file:a', new window.Blob(['new']));
        expect(mocks.revokeUrl).not.toHaveBeenCalled();
        expect(await fileStorage.resolveMediaUrl('file:a')).toBe(second);
        await fileStorage.deleteStoredMedia(['file:a']);
        expect(mocks.revokeUrl.mock.calls.map(call => call[0])).toEqual([first, second]);
        expect(mocks.stores.get('media_files')!.has('file:a')).toBe(false);
    });

    it('keeps files referenced by generation history during unused-resource cleanup', async () => {
        const protectedUrl = await fileStorage.setMediaBlob('video:history', new window.Blob(['history']));
        const unused = await fileStorage.setMediaBlob('file:unused', new window.Blob(['unused']));
        mocks.stores.get('video_generation_logs')!.set('log', { video: { storageKey: 'video:history' } });
        await fileStorage.cleanupUnusedMedia({ nodes: [] });
        expect(mocks.stores.get('media_files')!.has('video:history')).toBe(true);
        expect(mocks.revokeUrl).not.toHaveBeenCalledWith(protectedUrl);
        expect(mocks.revokeUrl).toHaveBeenCalledWith(unused);
    });

    it('reads a keyed API reference directly from storage without retaining another object URL', async () => {
        mocks.stores.get('image_files')!.set('image:a', new window.Blob(['original'], { type: 'image/png' }));
        expect(await imageStorage.imageToDataUrl({ storageKey: 'image:a' })).toBe('data:image/png;base64,b3JpZ2luYWw=');
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.createUrl).not.toHaveBeenCalled();
    });

    it('keeps an explicit transformed reference rather than replacing it with its original stored file', async () => {
        mocks.stores.get('image_files')!.set('image:a', new window.Blob(['original'], { type: 'image/png' }));
        vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new window.Blob(['edited'], { type: 'image/png' }) } as Response);
        expect(await imageStorage.imageToDataUrl({ storageKey: 'image:a', dataUrl: 'blob:external-edit' })).toBe('data:image/png;base64,ZWRpdGVk');
        expect(fetch).toHaveBeenCalledWith('blob:external-edit', expect.anything());
    });

    it('can recover a stale persisted Blob URL from its original storage key', async () => {
        mocks.stores.get('image_files')!.set('image:a', new window.Blob(['original'], { type: 'image/png' }));
        vi.mocked(fetch).mockRejectedValue(new TypeError('stale blob'));
        expect(await imageStorage.imageToDataUrl({ storageKey: 'image:a', dataUrl: 'blob:previous-session' })).toBe('data:image/png;base64,b3JpZ2luYWw=');
    });

    it('does not fall back to stored data after an API reference read is cancelled', async () => {
        const controller = new AbortController();
        vi.mocked(fetch).mockImplementation(async () => { controller.abort(); throw new Error('cancelled'); });
        await expect(imageStorage.imageToDataUrl({ storageKey: 'image:a', dataUrl: 'blob:edit' }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it('deduplicates missing preview generation and does not recreate a deleted preview', async () => {
        mocks.stores.get('image_files')!.set('image:a', new window.Blob(['original']));
        let finish!: (blob: Blob) => void;
        mocks.thumbnail.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
        await Promise.all([imageStorage.ensureImagePreview('image:a'), imageStorage.ensureImagePreview('image:a')]);
        await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledOnce());
        await imageStorage.deleteStoredImages(['image:a']);
        finish(new window.Blob(['late thumbnail']));
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(imageStorage.previewUrlFor('image:a')).toBeUndefined();
        expect(mocks.stores.get('image_previews')!.has('image:a')).toBe(false);
        expect(mocks.createUrl).not.toHaveBeenCalled();
    });

    it('releases the image probe source on successful upload and excludes in-progress uploads from cleanup', async () => {
        let finish!: (blob: Blob) => void;
        mocks.thumbnail.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
        const uploading = imageStorage.uploadImage(new window.Blob(['image'], { type: 'image/png' }));
        await vi.waitFor(() => expect(mocks.thumbnail).toHaveBeenCalledOnce());
        expect(imageProbes[0].getAttribute('src')).toBeNull();
        await imageStorage.cleanupUnusedImages({ nodes: [] });
        expect(mocks.stores.get('image_files')!.size).toBe(1);
        finish(new window.Blob(['thumbnail']));
        const uploaded = await uploading;
        expect(mocks.stores.get('image_files')!.has(uploaded.storageKey!)).toBe(true);
    });

    it('cleans up an aborted image metadata probe without storing the cancelled file', async () => {
        autoImageLoad = false;
        const controller = new AbortController();
        const uploading = imageStorage.uploadImage(new window.Blob(['image'], { type: 'image/png' }), { signal: controller.signal });
        controller.abort();
        await expect(uploading).rejects.toMatchObject({ name: 'AbortError' });
        expect(imageProbes[0].getAttribute('src')).toBeNull();
        expect(imageProbes[0].onload).toBeNull();
        expect(mocks.stores.get('image_files')!.size).toBe(0);
    });

    it('settles stalled media metadata in ten seconds and releases the temporary player', async () => {
        vi.useFakeTimers();
        let probe!: HTMLVideoElement;
        const create = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation(((name: string) => {
            const element = create(name);
            if (name === 'video') probe = element as HTMLVideoElement;
            return element;
        }) as typeof document.createElement);
        const uploading = fileStorage.uploadMediaFile(new window.Blob(['video'], { type: 'video/mp4' }));
        await vi.advanceTimersByTimeAsync(10_000);
        const uploaded = await uploading;
        expect(uploaded.width).toBe(1280);
        expect(uploaded.durationMs).toBeUndefined();
        expect(probe.getAttribute('src')).toBeNull();
        expect(probe.onloadedmetadata).toBeNull();
        expect(probe.pause).toHaveBeenCalled();
        expect(probe.load).toHaveBeenCalled();
    });
});
