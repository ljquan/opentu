import { describe, expect, it } from 'vitest';
import localforage from 'localforage';
import { localForageStorage } from '../src/lib/localforage-storage';

describe('workflow persistence after runtime merge', () => {
    it('reads existing records and writes the same format without reconfiguring OpenTu storage', async () => {
        const originalName = localforage.config('name');
        const originalStore = localforage.config('storeName');
        const legacy = localforage.createInstance({ name: 'infinite-canvas', storeName: 'app_state', driver: localforage.LOCALSTORAGE });
        const key = 'infinite-canvas:canvas_store';
        const record = JSON.stringify({ state: { projects: [{ id: 'existing', nodes: [{ id: 'node-1', type: 'text' }], viewport: { x: 7, y: 9, k: 2 } }], deletedProjects: [] }, version: 0 });
        await legacy.setItem(key, record);
        expect(await localForageStorage.getItem(key)).toBe(record);
        const updated = record.replace('node-1', 'node-2');
        await localForageStorage.setItem(key, updated);
        expect(await legacy.getItem(key)).toBe(updated);
        expect(localforage.config('name')).toBe(originalName);
        expect(localforage.config('storeName')).toBe(originalStore);
        await localForageStorage.removeItem(key);
        expect(await legacy.getItem(key)).toBeNull();
    });
});
