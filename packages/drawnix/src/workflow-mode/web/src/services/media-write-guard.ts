export class MediaWriteGuard {
    private active = new Map<string, number>();
    private snapshots = new Set<Set<string>>();
    private writes = new Map<string, Promise<unknown>>();

    retain(key: string) {
        this.snapshots.forEach(snapshot => snapshot.add(key));
        this.active.set(key, (this.active.get(key) || 0) + 1);
        return () => {
            const count = (this.active.get(key) || 1) - 1;
            if (count) this.active.set(key, count);
            else this.active.delete(key);
        };
    }

    snapshot() {
        const touched = new Set(this.active.keys());
        this.snapshots.add(touched);
        return { touched, release: () => this.snapshots.delete(touched) };
    }

    run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const request = (this.writes.get(key) || Promise.resolve()).catch(() => undefined).then(operation);
        this.writes.set(key, request);
        const cleanup = () => { if (this.writes.get(key) === request) this.writes.delete(key); };
        void request.then(cleanup, cleanup);
        return request;
    }

    removeIfUnchanged(key: string, snapshot: ReturnType<MediaWriteGuard['snapshot']>, operation: () => Promise<unknown>) {
        // Serialize the final check and deletion with writes to this key.
        return this.run(key, async () => {
            if (!snapshot.touched.has(key) && !this.active.has(key)) await operation();
        });
    }
}
