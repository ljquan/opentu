// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LS_KEYS } from '../constants/storage-keys';

const storageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'localStorage'
);

afterEach(() => {
  if (storageDescriptor) {
    Object.defineProperty(window, 'localStorage', storageDescriptor);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function settings() {
  return import('./reference-image-settings');
}

describe('reference image fidelity settings', () => {
  it('defaults to disabled and only accepts the persisted true value', async () => {
    const { readKeepOriginalImageEnabled: read } = await settings();

    expect(read()).toBe(false);
    expect(read({ getItem: () => null })).toBe(false);
    expect(read({ getItem: () => 'false' })).toBe(false);
    expect(read({ getItem: () => 'invalid' })).toBe(false);
    expect(read({ getItem: () => 'true' })).toBe(true);
  });

  it('persists changes, notifies consumers and restores after module reload', async () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });

    const api = await settings();
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(api.persistKeepOriginalImageEnabled(true)).toBe(true);
    expect(values.get(LS_KEYS.AI_KEEP_ORIGINAL_IMAGE_ENABLED)).toBe('true');
    expect(dispatch.mock.calls[0][0].type).toBe(
      api.REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT
    );

    vi.resetModules();
    const reloaded = await settings();
    expect(reloaded.readKeepOriginalImageEnabled()).toBe(true);
    reloaded.persistKeepOriginalImageEnabled(false);
    expect(reloaded.readKeepOriginalImageEnabled()).toBe(false);
  });

  it('keeps the session choice when storage reads or writes are denied', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('security');
      },
    });

    const api = await settings();
    expect(api.readKeepOriginalImageEnabled()).toBe(false);
    expect(api.persistKeepOriginalImageEnabled(true)).toBe(true);
    expect(api.readKeepOriginalImageEnabled()).toBe(true);
  });

  it('notifies consumers with the session choice when storage writes fail', async () => {
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
    const listener = () => observed.push(api.readKeepOriginalImageEnabled());
    window.addEventListener(api.REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT, listener);
    try {
      api.persistKeepOriginalImageEnabled(true);
      api.persistKeepOriginalImageEnabled(false);
      expect(observed).toEqual([true, false]);
    } finally {
      window.removeEventListener(api.REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT, listener);
    }
  });

  it('does not fail when CustomEvent construction is unavailable', async () => {
    const api = await settings();
    const customEvent = globalThis.CustomEvent;
    vi.stubGlobal('CustomEvent', undefined);

    expect(() => api.persistKeepOriginalImageEnabled(true)).not.toThrow();

    vi.stubGlobal('CustomEvent', customEvent);
  });
});

describe('reference image canvas insertion settings', () => {
  it('preserves automatic insertion by default and restores an explicit disabled choice', async () => {
    const { readAutoInsertReferenceImagesEnabled: read } = await settings();
    expect(read(null)).toBe(true);
    expect(read({ getItem: () => null })).toBe(true);
    expect(read({ getItem: () => 'invalid' })).toBe(true);
    expect(read({ getItem: () => 'true' })).toBe(true);
    expect(read({ getItem: () => 'false' })).toBe(false);
  });

  it('persists independently of image fidelity, notifies consumers and restores after reload', async () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    const api = await settings();
    const observed: boolean[] = [];
    const listener = () => observed.push(api.readAutoInsertReferenceImagesEnabled());
    window.addEventListener(api.REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT, listener);
    try {
      api.persistAutoInsertReferenceImagesEnabled(false);
      api.persistKeepOriginalImageEnabled(true);
      expect(api.readKeepOriginalImageEnabled()).toBe(true);
      expect(api.readAutoInsertReferenceImagesEnabled()).toBe(false);
      expect(values.get(LS_KEYS.AI_REFERENCE_IMAGE_AUTO_INSERT)).toBe('false');
      expect(observed).toEqual([false, false]);
      vi.resetModules();
      const reloaded = await settings();
      expect(reloaded.readAutoInsertReferenceImagesEnabled()).toBe(false);
      reloaded.persistAutoInsertReferenceImagesEnabled(true);
      expect(values.get(LS_KEYS.AI_REFERENCE_IMAGE_AUTO_INSERT)).toBe('true');
    } finally {
      window.removeEventListener(api.REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT, listener);
    }
  });

  it.each(['access', 'quota'])('keeps and announces the session choice when storage fails: %s', async (failure) => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      ...(failure === 'access'
        ? { get: () => { throw new Error('security'); } }
        : { value: { getItem: () => null, setItem: () => { throw new Error('quota'); } } }),
    });
    const api = await settings();
    expect(api.readAutoInsertReferenceImagesEnabled()).toBe(true);
    const observed: boolean[] = [];
    const listener = () => observed.push(api.readAutoInsertReferenceImagesEnabled());
    window.addEventListener(api.REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT, listener);
    try {
      api.persistAutoInsertReferenceImagesEnabled(false);
      api.persistAutoInsertReferenceImagesEnabled(true);
      expect(observed).toEqual([false, true]);
      expect(api.readAutoInsertReferenceImagesEnabled()).toBe(true);
    } finally {
      window.removeEventListener(api.REFERENCE_IMAGE_SETTINGS_CHANGE_EVENT, listener);
    }
  });
});
