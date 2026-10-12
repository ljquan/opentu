// Legacy nodes/history hold URL strings. Keep replaced versions usable until
// explicit deletion; eviction requires migrating those consumers to leases.
export class StoredMediaUrls {
    private current = new Map<string, string>();
    private retired = new Map<string, Set<string>>();
    private pending = new Map<string, Promise<string | undefined>>();
    constructor(private onResolve?: () => void) {}

    get(key: string) { return this.current.get(key); }

    set(key: string, url: string) {
        this.invalidate(key);
        this.current.set(key, url);
        return url;
    }

    invalidate(key: string) {
        this.pending.delete(key);
        const old = this.current.get(key);
        if (old) {
            const versions = this.retired.get(key) || new Set<string>();
            versions.add(old);
            this.retired.set(key, versions);
            this.current.delete(key);
        }
    }

    delete(key: string) {
        this.invalidate(key);
        this.retired.get(key)?.forEach(url => URL.revokeObjectURL(url));
        this.retired.delete(key);
    }

    resolve(key: string, read: () => Promise<Blob | null>) {
        const existing = this.current.get(key);
        if (existing) return Promise.resolve(existing);
        const pending = this.pending.get(key);
        if (pending) return pending;
        const request: Promise<string | undefined> = Promise.resolve().then(read).then(blob => {
            if (this.pending.get(key) !== request) return this.current.get(key);
            if (!blob) return undefined;
            const url = URL.createObjectURL(blob);
            this.current.set(key, url);
            this.onResolve?.();
            return url;
        }, error => {
            if (this.pending.get(key) !== request) return this.current.get(key);
            throw error;
        }).finally(() => {
            if (this.pending.get(key) === request) this.pending.delete(key);
        });
        this.pending.set(key, request);
        return request;
    }
}
