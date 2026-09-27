import { afterEach, describe, expect, it, vi } from 'vitest';
import { LS_KEYS } from '../../constants/storage-keys';

const storageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'localStorage'
);
afterEach(() => {
  if (storageDescriptor)
    Object.defineProperty(window, 'localStorage', storageDescriptor);
  vi.restoreAllMocks();
  vi.resetModules();
});

async function settings() {
  return import('./canvas-view-settings');
}

describe('canvas view settings', () => {
  it('defaults to enabled for missing or invalid values', async () => {
    const { readCenterImageOnClickEnabled: read } = await settings();
    for (const value of [null, 'invalid', 'true']) {
      expect(read({ getItem: () => value })).toBe(true);
    }
    expect(read({ getItem: () => 'false' })).toBe(false);
  });

  it('falls back safely when reads are unavailable', async () => {
    const { readCenterImageOnClickEnabled: read } = await settings();
    expect(read(null)).toBe(true);
    expect(
      read({
        getItem: () => {
          throw new Error('denied');
        },
      })
    ).toBe(true);
  });

  it('persists changes, notifies consumers and survives module reload', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
    const api = await settings();
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(api.persistCenterImageOnClickEnabled(false)).toBe(false);
    expect(values.get(LS_KEYS.AI_CENTER_IMAGE_ON_CLICK_ENABLED)).toBe('false');
    expect(dispatch.mock.calls[0][0].type).toBe(
      api.CANVAS_VIEW_SETTINGS_CHANGE_EVENT
    );
    vi.resetModules();
    const reloaded = await settings();
    expect(reloaded.readCenterImageOnClickEnabled()).toBe(false);
    reloaded.persistCenterImageOnClickEnabled(true);
    expect(reloaded.readCenterImageOnClickEnabled()).toBe(true);
  });

  it('keeps both components in sync when writes throw', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
      },
    });
    const api = await settings();
    const observed: boolean[] = [];
    const listener = () => observed.push(api.readCenterImageOnClickEnabled());
    window.addEventListener(api.CANVAS_VIEW_SETTINGS_CHANGE_EVENT, listener);
    try {
      api.persistCenterImageOnClickEnabled(false);
      api.persistCenterImageOnClickEnabled(true);
      expect(observed).toEqual([false, true]);
    } finally {
      window.removeEventListener(
        api.CANVAS_VIEW_SETTINGS_CHANGE_EVENT,
        listener
      );
    }
  });

  it('keeps the session setting when accessing storage throws', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('security');
      },
    });
    const api = await settings();
    api.persistCenterImageOnClickEnabled(false);
    expect(api.readCenterImageOnClickEnabled()).toBe(false);
  });
});
