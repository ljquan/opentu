const createStorage = () => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  };
};
if (typeof globalThis.localStorage === "undefined") Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createStorage() });
if (typeof globalThis.sessionStorage === "undefined") Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: createStorage() });
