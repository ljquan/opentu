import { memoryMonitorService } from '../../../../services/memory-monitor-service';

type Entry = { url: string; bytes: number; users: number; touched: number };
export type MediaLease = { url: string; release: () => void };

export class MediaLeaseCache {
    private entries = new Map<string, Entry>();
    private pending = new Map<string, Promise<Entry | undefined>>();
    private reading = 0;
    private queue: Array<() => void> = [];
    private revisions = new Map<string, number>();
    private listeners = new Set<() => void>();
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    revision(prefix: string) { return this.revisions.get(prefix) || 0; }
    constructor(private budget: number, private concurrency = 2) {}

    private async readBlob(read: () => Promise<Blob | null>): Promise<Blob | null> {
        if (this.reading >= this.concurrency) await new Promise<void>(resolve => this.queue.push(resolve));
        else this.reading++;
        try { return await read(); }
        finally {
            const next = this.queue.shift();
            if (next) next();
            else this.reading--;
        }
    }

    async acquire(key: string, read: () => Promise<Blob | null>): Promise<MediaLease | undefined> {
        let entry = this.entries.get(key);
        if (!entry) {
            let request = this.pending.get(key);
            if (!request) {
                request = this.readBlob(() => this.pending.get(key) === request ? read() : Promise.resolve(null)).then(blob => {
                    if (!blob || this.pending.get(key) !== request) return undefined;
                    const created = { url: URL.createObjectURL(blob), bytes: blob.size, users: 0, touched: Date.now() };
                    this.entries.set(key, created);
                    return created;
                }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key); });
                this.pending.set(key, request);
            }
            entry = await request;
            if (entry && this.entries.get(key) !== entry) return this.acquire(key, read);
        }
        if (!entry) return undefined;
        entry.users++;
        entry.touched = Date.now();
        this.trim();
        let released = false;
        const owned = entry;
        return { url: owned.url, release: () => {
            if (released) return;
            released = true;
            owned.users--;
            owned.touched = Date.now();
            for (const [retiredKey, retired] of this.entries) {
                if (retiredKey.startsWith('retired:') && retired === owned && !owned.users) {
                    this.entries.delete(retiredKey);
                    URL.revokeObjectURL(owned.url);
                }
            }
            this.trim();
        } };
    }

    trim(force = false) {
        let bytes = [...this.entries.values()].reduce((total, entry) => total + entry.bytes, 0);
        for (const [key, entry] of [...this.entries.entries()].sort((a, b) => a[1].touched - b[1].touched)) {
            if (!force && bytes <= this.budget) break;
            if (entry.users) continue;
            this.entries.delete(key);
            URL.revokeObjectURL(entry.url);
            bytes -= entry.bytes;
        }
    }

    stats() {
        const values = [...this.entries.values()];
        return { entries: values.length, bytes: values.reduce((n, e) => n + e.bytes, 0), active: values.filter(e => e.users > 0).length, pending: this.pending.size };
    }

    invalidate(prefix: string) {
        this.revisions.set(prefix, this.revision(prefix) + 1);
        for (const key of this.pending.keys()) if (key.startsWith(prefix)) this.pending.delete(key);
        for (const [key, entry] of [...this.entries]) {
            if (!key.startsWith(prefix)) continue;
            this.entries.delete(key);
            if (!entry.users) URL.revokeObjectURL(entry.url);
            else {
                // The old version stays valid until its final lease is released.
                this.entries.set(`retired:${key}:${entry.url}`, entry);
            }
        }
        this.listeners.forEach(listener => listener());
    }
}

export const imageLeaseCache = new MediaLeaseCache(64 * 1024 * 1024);
export const mediaLeaseCache = new MediaLeaseCache(128 * 1024 * 1024);
memoryMonitorService.registerCleanupHandler({ name: 'workflow-cold-media', priority: 1, cleanup: () => {
    imageLeaseCache.trim(true);
    mediaLeaseCache.trim(true);
} });
