import localforage from "localforage";
import { nanoid } from "nanoid";

import { withLocalProxy } from "@/stores/use-config-store";
import { StoredMediaUrls } from "./stored-media-urls";
import { mediaLeaseCache } from './media-leases';
import { MediaWriteGuard } from './media-write-guard';

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
const objectUrls = new StoredMediaUrls();
const activeUploads = new Map<string, number>();
const writeGuard = new MediaWriteGuard();
let metadataQueue: Promise<unknown> = Promise.resolve();

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

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(withLocalProxy(input))).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    const releaseUpload = retainUpload(storageKey);
    try {
        await writeGuard.run(storageKey, () => store.setItem(storageKey, blob));
        mediaLeaseCache.invalidate(`${storageKey}:`);
        const url = URL.createObjectURL(blob);
        objectUrls.set(storageKey, url);
        const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
        return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
    } finally { releaseUpload(); }
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return await objectUrls.resolve(storageKey, () => store.getItem<Blob>(storageKey)) || fallback;
}

export async function getMediaBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob, resolveUrl = true) {
    const releaseUpload = retainUpload(storageKey);
    try {
        await writeGuard.run(storageKey, () => store.setItem(storageKey, blob));
        mediaLeaseCache.invalidate(`${storageKey}:`);
        objectUrls.invalidate(storageKey);
        return resolveUrl ? objectUrls.set(storageKey, URL.createObjectURL(blob)) : undefined;
    } finally { releaseUpload(); }
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            objectUrls.delete(key);
            mediaLeaseCache.invalidate(`${key}:`);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown) {
    const snapshot = writeGuard.snapshot();
    try {
    const usedKeys = collectMediaStorageKeys(usedData);
    await Promise.all([
        imageLogStore.iterate(value => { collectMediaStorageKeys(value, usedKeys); }),
        videoLogStore.iterate(value => { collectMediaStorageKeys(value, usedKeys); }),
    ]);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key) && !activeUploads.has(key)) unused.push(key);
    });
    await Promise.all(unused.map(key => writeGuard.removeIfUnchanged(key, snapshot, () => deleteStoredMedia([key]))));
    } finally { snapshot.release(); }
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return readMediaMeta(url, true);
}

function readAudioMeta(url: string) {
    return readMediaMeta(url, false);
}

function readMediaMeta(url: string, isVideo: boolean) {
    const request = metadataQueue.then(() => probeMediaMeta(url, isVideo));
    metadataQueue = request.catch(() => undefined);
    return request;
}

function probeMediaMeta(url: string, isVideo: boolean): Promise<{ width?: number; height?: number; durationMs?: number }> {
    return new Promise(resolve => {
        const media = document.createElement(isVideo ? "video" : "audio");
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            const durationMs = Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : undefined;
            const dimensions = isVideo ? { width: (media as HTMLVideoElement).videoWidth || 1280, height: (media as HTMLVideoElement).videoHeight || 720 } : {};
            window.clearTimeout(timer);
            media.onloadedmetadata = null;
            media.onerror = null;
            try { media.pause(); media.removeAttribute("src"); media.load(); } catch { /* Detached players still settle the probe. */ }
            resolve({ ...dimensions, durationMs });
        };
        const timer = window.setTimeout(done, 10_000);
        media.preload = "metadata";
        media.onloadedmetadata = done;
        media.onerror = done;
        media.src = url;
    });
}
