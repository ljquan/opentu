export type CompletedImageEntry = { response: Response; timestamp: number; bytes?: number };
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 100;
const TTL = 30_000;

export function trimCompletedImages(cache: Map<string, CompletedImageEntry>, now = Date.now()) {
    let bytes = 0;
    for (const [key, entry] of cache) {
        if (now - entry.timestamp > TTL) {
            cache.delete(key);
            void entry.response.body?.cancel().catch(() => undefined);
        } else bytes += entry.bytes || 0;
    }
    for (const [key, entry] of cache) {
        if (bytes <= MAX_BYTES && cache.size <= MAX_ENTRIES) break;
        cache.delete(key);
        bytes -= entry.bytes || 0;
        void entry.response.body?.cancel().catch(() => undefined);
    }
}

export function cacheCompletedImage(cache: Map<string, CompletedImageEntry>, key: string, response: Response, now = Date.now()) {
    const bytes = Number(response.headers.get('sw-image-size') || response.headers.get('Content-Length'));
    // Unknown-length bodies are already persisted by the media path. Avoid
    // keeping an unconsumed tee in memory solely for short-lived deduplication.
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES) return;
    const old = cache.get(key);
    if (old) void old.response.body?.cancel().catch(() => undefined);
    cache.delete(key);
    cache.set(key, { response: response.clone(), timestamp: now, bytes });
    trimCompletedImages(cache, now);
}
