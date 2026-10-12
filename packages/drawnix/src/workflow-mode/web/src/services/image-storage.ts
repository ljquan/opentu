import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { withLocalProxy } from "@/stores/use-config-store";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { StoredMediaUrls } from "./stored-media-urls";
import { imageLeaseCache } from './media-leases';
import { MediaWriteGuard } from './media-write-guard';

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const previewStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_previews" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new StoredMediaUrls();
const previewUrls = new StoredMediaUrls(notifyImagePreviews);
const previewJobs = new Map<string, { cancelled: boolean; promise: Promise<string | undefined> }>();
const activeUploads = new Map<string, number>();
const writeGuard = new MediaWriteGuard();
const previewWrites = new Map<string, Promise<unknown>>();
const waitingImageProbes: Array<() => void> = [];
let activeImageProbes = 0;
const previewListeners = new Set<() => void>();
let previewRevision = 0;
const foregroundPreviews: Array<() => void> = [];
const backgroundPreviews: Array<() => void> = [];
let previewRunning = false;
const IMAGE_PREVIEW_VERSION = 1;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_REMOTE_LOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";

type StoredImagePreview = { version: number; blob?: Blob };

type ImageReadOptions = { signal?: AbortSignal };

function writePreview(key: string, operation: () => Promise<unknown>) {
    const request = (previewWrites.get(key) || Promise.resolve()).catch(() => undefined).then(operation);
    previewWrites.set(key, request);
    const cleanup = () => { if (previewWrites.get(key) === request) previewWrites.delete(key); };
    void request.then(cleanup, cleanup);
    return request;
}

function retainUpload(key: string) {
    const releaseWrite = writeGuard.retain(key);
    activeUploads.set(key, (activeUploads.get(key) || 0) + 1);
    return () => {
        releaseWrite();
        const remaining = (activeUploads.get(key) || 1) - 1;
        if (remaining) activeUploads.set(key, remaining);
        else activeUploads.delete(key);
    };
}

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    if (typeof input !== "string") return storeImage(input, options);

    let blob: Blob;
    try {
        blob = await fetchImageBlob(input, options);
    } catch (error) {
        if (options?.signal?.aborted || isNamedError(error, IMAGE_RESPONSE_ERROR) || isNamedError(error, IMAGE_TIMEOUT_ERROR) || !/^https?:\/\//i.test(input)) throw error;
        const meta = await loadImageMeta(input, options, IMAGE_REMOTE_LOAD_TIMEOUT_MS);
        if (!meta) throw error;
        return { url: input, width: meta.width, height: meta.height, bytes: 0, mimeType: "" };
    }
    return storeImage(blob, options);
}

async function storeImage(blob: Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    const storageKey = `image:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    const releaseUpload = retainUpload(storageKey);
    try {
        const meta = await loadImageMeta(url, options);
        if (!meta) throw new Error(i18n.t("common.imageReadFailed"));
        throwIfAborted(options?.signal);
        await writeGuard.run(storageKey, () => store.setItem(storageKey, blob));
        throwIfAborted(options?.signal);
        objectUrls.set(storageKey, url);
        await storeImagePreview(storageKey, blob);
        throwIfAborted(options?.signal);
        return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type.startsWith("image/") ? blob.type : "" };
    } catch (error) {
        if (objectUrls.get(storageKey) !== url) URL.revokeObjectURL(url);
        objectUrls.delete(storageKey);
        await deleteImagePreview(storageKey);
        await store.removeItem(storageKey).catch(() => undefined);
        throw error;
    } finally { releaseUpload(); }
}

async function fetchImageBlob(url: string, options?: ImageReadOptions) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(withLocalProxy(url), { signal: controller.signal });
        if (!response.ok) throw namedError(IMAGE_RESPONSE_ERROR);
        return await response.blob();
    } catch (error) {
        if (timedOut) throw namedError(IMAGE_TIMEOUT_ERROR);
        if (options?.signal?.aborted) throw abortReason(options.signal);
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    // Keep the existing long remote compatibility timeout outside the local decode queue.
    if (timeoutMs !== IMAGE_DECODE_TIMEOUT_MS) return probeImageMeta(url, options, timeoutMs);
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const cancelQueued = () => {
            const index = waitingImageProbes.indexOf(start);
            if (index < 0) return;
            waitingImageProbes.splice(index, 1);
            options?.signal?.removeEventListener('abort', cancelQueued);
            reject(abortReason(options!.signal!));
        };
        const start = () => {
            options?.signal?.removeEventListener('abort', cancelQueued);
            activeImageProbes++;
            void probeImageMeta(url, options, timeoutMs).then(resolve, reject).finally(() => {
                activeImageProbes--;
                waitingImageProbes.shift()?.();
            });
        };
        if (activeImageProbes < 2) start();
        else {
            waitingImageProbes.push(start);
            options?.signal?.addEventListener('abort', cancelQueued, { once: true });
        }
    });
}

function probeImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const image = new Image();
        let settled = false;
        const cleanup = () => {
            window.clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            image.removeAttribute("src");
        };
        const finish = (value: { width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(abortReason(options!.signal!));
        };
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        options?.signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => finish(null);
        image.src = url;
    });
}

function namedError(name: string) {
    const error = new Error(i18n.t("common.imageReadFailed"));
    error.name = name;
    return error;
}

function isNamedError(error: unknown, name: string) {
    return error instanceof Error && error.name === name;
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return await objectUrls.resolve(storageKey, () => store.getItem<Blob>(storageKey)) || fallback;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function getImagePreviewBlob(storageKey: string) {
    let preview = await previewStore.getItem<StoredImagePreview>(storageKey).catch(() => null);
    if (!preview || preview.version !== IMAGE_PREVIEW_VERSION) {
        await storeImagePreview(storageKey, undefined, false);
        preview = await previewStore.getItem<StoredImagePreview>(storageKey).catch(() => null);
    }
    return preview?.version === IMAGE_PREVIEW_VERSION ? preview.blob || null : null;
}

// 缩略图按图片的 storageKey 另存一份 WebP，只放在本地 IndexedDB 里，不写进节点数据，也不参与导出和 WebDAV 同步。
export function previewUrlFor(storageKey?: string) {
    return storageKey ? previewUrls.get(storageKey) : undefined;
}

// 缩略图在后台补，生成完成后再让用到它的界面重渲染一次。
export function subscribeImagePreviews(listener: () => void) {
    previewListeners.add(listener);
    return () => {
        previewListeners.delete(listener);
    };
}

export function getImagePreviewRevision() {
    return previewRevision;
}

export async function ensureImagePreview(storageKey?: string) {
    if (!storageKey) return undefined;
    const existing = previewUrls.get(storageKey);
    if (existing) return existing;
    const resolved = await previewUrls.resolve(storageKey, async () => {
        const stored = await previewStore.getItem<StoredImagePreview>(storageKey).catch(() => null);
        if (stored?.version === IMAGE_PREVIEW_VERSION) return stored.blob || null;
        queueImagePreview(storageKey);
        return null;
    });
    return resolved;
}

// 缩略图生成排成一队，避免一次打开大量图片时同时解码。
function queueImagePreview(storageKey: string) {
    if (previewJobs.has(storageKey)) return;
    void storeImagePreview(storageKey);
}

function enqueueImagePreview<T>(run: () => Promise<T>, foreground: boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const queue = foreground ? foregroundPreviews : backgroundPreviews;
        queue.push(() => {
            previewRunning = true;
            void run().then(resolve, reject).finally(() => {
                previewRunning = false;
                (foregroundPreviews.shift() || backgroundPreviews.shift())?.();
            });
        });
        if (!previewRunning) (foregroundPreviews.shift() || backgroundPreviews.shift())?.();
    });
}

function storeImagePreview(storageKey: string, supplied?: Blob, cacheUrl = true) {
    const job = { cancelled: false, promise: Promise.resolve<string | undefined>(undefined) };
    if (supplied) {
        const previous = previewJobs.get(storageKey);
        if (previous) previous.cancelled = true;
    } else if (previewJobs.has(storageKey)) return previewJobs.get(storageKey)!.promise;
    job.promise = enqueueImagePreview(async () => {
        if (job.cancelled) return undefined;
        const original = supplied || await getImageBlob(storageKey);
        if (!original || job.cancelled) return undefined;
        const preview = await createImageThumbnail(original).catch(() => undefined);
        if (job.cancelled) return undefined;
        await writePreview(storageKey, () => job.cancelled ? Promise.resolve() : previewStore.setItem<StoredImagePreview>(storageKey, { version: IMAGE_PREVIEW_VERSION, blob: preview })).catch(() => undefined);
        return !job.cancelled && preview && cacheUrl ? cacheImagePreview(storageKey, preview) : undefined;
    }, Boolean(supplied)).catch(() => undefined).finally(() => {
        if (previewJobs.get(storageKey) === job) previewJobs.delete(storageKey);
    });
    previewJobs.set(storageKey, job);
    return job.promise;
}

function cacheImagePreview(storageKey: string, preview: Blob) {
    const url = URL.createObjectURL(preview);
    previewUrls.set(storageKey, url);
    notifyImagePreviews();
    return url;
}

function notifyImagePreviews() {
    previewRevision += 1;
    previewListeners.forEach(listener => {
        try { listener(); } catch (error) { console.warn('[ImageStorage] Preview listener failed:', error); }
    });
}

async function deleteImagePreview(storageKey: string, preserveUrls = false) {
    const job = previewJobs.get(storageKey);
    if (job) job.cancelled = true;
    previewJobs.delete(storageKey);
    if (preserveUrls) previewUrls.invalidate(storageKey);
    else previewUrls.delete(storageKey);
    notifyImagePreviews();
    await writePreview(storageKey, () => previewStore.removeItem(storageKey)).catch(() => undefined);
}

export async function setImageBlob(storageKey: string, blob: Blob, resolveUrl = true) {
    const releaseUpload = retainUpload(storageKey);
    try {
        await writeGuard.run(storageKey, () => store.setItem(storageKey, blob));
        imageLeaseCache.invalidate(`${storageKey}:`);
        objectUrls.invalidate(storageKey);
        const url = resolveUrl ? objectUrls.set(storageKey, URL.createObjectURL(blob)) : undefined;
        await deleteImagePreview(storageKey, true);
        await storeImagePreview(storageKey, blob, resolveUrl);
        return url;
    } finally { releaseUpload(); }
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    throwIfAborted(options?.signal);
    if (image.storageKey && !image.dataUrl) {
        const blob = await getImageBlob(image.storageKey);
        throwIfAborted(options?.signal);
        if (blob) return blobToDataUrl(blob, options);
    }
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    try {
        return await blobToDataUrl(await fetchImageBlob(url, options), options);
    } catch (error) {
        throwIfAborted(options?.signal);
        if (image.storageKey && url.startsWith("blob:")) {
            const blob = await getImageBlob(image.storageKey);
            throwIfAborted(options?.signal);
            if (blob) return blobToDataUrl(blob, options);
        }
        throw error;
    }
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            objectUrls.delete(key);
            imageLeaseCache.invalidate(`${key}:`);
            await deleteImagePreview(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const snapshot = writeGuard.snapshot();
    try {
    const usedKeys = collectImageStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
        videoLogStore.iterate((value) => {
            collectImageStorageKeys(value, usedKeys);
        }),
    ]);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key) && !activeUploads.has(key)) unused.push(key);
    });
    const orphanPreviews: string[] = [];
    await previewStore.iterate((_value, key) => {
        if (!usedKeys.has(key) && !activeUploads.has(key)) orphanPreviews.push(key);
    });
    await Promise.all([
        ...unused.map(key => writeGuard.removeIfUnchanged(key, snapshot, () => deleteStoredImages([key]))),
        ...orphanPreviews.map(key => writeGuard.removeIfUnchanged(key, snapshot, () => deleteImagePreview(key))),
    ]);
    } finally { snapshot.release(); }
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob, options?: ImageReadOptions) {
    return new Promise<string>((resolve, reject) => {
        throwIfAborted(options?.signal);
        const reader = new FileReader();
        const cleanup = () => {
            options?.signal?.removeEventListener("abort", abort);
            reader.onload = null;
            reader.onerror = null;
        };
        const abort = () => {
            cleanup();
            reader.abort();
            reject(abortReason(options!.signal!));
        };
        reader.onload = () => { const result = String(reader.result || ""); cleanup(); resolve(result); };
        reader.onerror = () => { cleanup(); reject(new Error(i18n.t("common.imageReadFailed"))); };
        options?.signal?.addEventListener("abort", abort, { once: true });
        reader.readAsDataURL(blob);
    });
}
