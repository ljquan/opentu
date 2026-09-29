import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

// Keep the standalone workflow database and store names, but avoid mutating
// localforage's global default instance used by the rest of OpenTu.
const store = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try { return (await store.getItem<string>(name)) || null; }
        catch { return window.localStorage.getItem(name); }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try { await store.setItem(name, value); }
        catch { window.localStorage.setItem(name, value); }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try { await store.removeItem(name); }
        catch { window.localStorage.removeItem(name); }
    },
};
