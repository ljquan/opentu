export interface VideoMemoryEntry {
  blob: Blob;
  timestamp: number;
}

export const VIDEO_MEMORY_BUDGET = 64 * 1024 * 1024;
const MAX_ENTRIES = 10;
const TTL = 5 * 60 * 1000;

export function trimVideoMemoryCache(
  cache: Map<string, VideoMemoryEntry>,
  now = Date.now()
): void {
  let bytes = 0;
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > TTL) cache.delete(key);
    else bytes += entry.blob.size;
  }
  if (bytes <= VIDEO_MEMORY_BUDGET && cache.size <= MAX_ENTRIES) return;
  const oldest = [...cache.entries()].sort(
    (a, b) => a[1].timestamp - b[1].timestamp
  );
  for (const [key, entry] of oldest) {
    if (bytes <= VIDEO_MEMORY_BUDGET && cache.size <= MAX_ENTRIES) break;
    cache.delete(key);
    bytes -= entry.blob.size;
  }
}
