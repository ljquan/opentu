import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAWNIX_SETTINGS_KEY } from '../../constants/storage';

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => store.set(key, value),
  } as Storage;
}

function mockDependencies() {
  vi.doMock('../crypto-utils', () => ({
    CryptoUtils: {
      testCrypto: async () => false,
      isEncrypted: () => false,
      decrypt: async (value: string) => value,
      encrypt: async (value: string) => value,
    },
  }));
  vi.doMock('../config-indexeddb-writer', () => ({
    configIndexedDBWriter: { saveConfig: async () => undefined },
  }));
}

describe('task-pet settings', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: createStorageMock(),
    });
    if (typeof window === 'undefined') {
      vi.stubGlobal('window', {
        location: { search: '', href: 'https://example.com/app' },
        history: { replaceState: () => undefined },
        dispatchEvent: () => true,
      });
    }
    mockDependencies();
  });

  it('uses complete defaults when the preference is missing', async () => {
    const { taskPetSettings } = await import('../settings-manager');
    expect(taskPetSettings.get()).toEqual({
      version: 1,
      enabled: true,
      motionEnabled: true,
      speechEnabled: false,
      taskTypes: { text: true, image: true, video: true },
    });
  });

  it('uses complete defaults when stored JSON is corrupted', async () => {
    localStorage.setItem(DRAWNIX_SETTINGS_KEY, '{invalid');
    const { taskPetSettings } = await import('../settings-manager');
    expect(taskPetSettings.get()).toMatchObject({
      version: 1,
      enabled: true,
      motionEnabled: true,
      speechEnabled: false,
      taskTypes: { text: true, image: true, video: true },
    });
  });

  it.each([
    null,
    [],
    { enabled: false },
    {
      version: 2,
      enabled: false,
      motionEnabled: false,
      speechEnabled: true,
      taskTypes: { text: false, image: false, video: false },
    },
    {
      version: 1,
      enabled: false,
      motionEnabled: 'yes',
      speechEnabled: true,
      taskTypes: { text: false, image: false, video: false },
    },
    {
      version: 1,
      enabled: false,
      motionEnabled: false,
      speechEnabled: true,
      taskTypes: { text: false, image: false },
    },
  ])('falls back for an invalid preference: %o', async (taskPet) => {
    localStorage.setItem(DRAWNIX_SETTINGS_KEY, JSON.stringify({ taskPet }));
    const { taskPetSettings } = await import('../settings-manager');
    expect(taskPetSettings.get()).toMatchObject({
      version: 1,
      enabled: true,
      motionEnabled: true,
      speechEnabled: false,
      taskTypes: { text: true, image: true, video: true },
    });
  });

  it('preserves valid values and merges typed partial updates', async () => {
    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        taskPet: {
          version: 1,
          enabled: false,
          motionEnabled: false,
          speechEnabled: true,
          taskTypes: { text: false, image: true, video: false },
        },
      })
    );
    const { taskPetSettings } = await import('../settings-manager');
    await taskPetSettings.update({
      enabled: true,
      taskTypes: { video: true },
    });
    expect(taskPetSettings.get()).toEqual({
      version: 1,
      enabled: true,
      motionEnabled: false,
      speechEnabled: true,
      taskTypes: { text: false, image: true, video: true },
    });
  });

  it('notifies until removed and retains in-memory updates on write failure', async () => {
    const { taskPetSettings } = await import('../settings-manager');
    const listener = vi.fn();
    taskPetSettings.addListener(listener);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await taskPetSettings.update({ speechEnabled: true });
    expect(taskPetSettings.get().speechEnabled).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ speechEnabled: true }),
      expect.objectContaining({ speechEnabled: false })
    );

    taskPetSettings.removeListener(listener);
    await taskPetSettings.update({ speechEnabled: false });
    expect(listener).toHaveBeenCalledOnce();
  });
});
