import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let values: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('new feature discovery', () => {
  it('does not mark a feature seen just by reading or refreshing, and dismisses entries independently', async () => {
    const api = await import('./feature-discovery');
    expect(api.hasUnseenFeature('app-menu')).toBe(true);
    expect(api.hasUnseenFeature('canvas-settings')).toBe(true);
    expect(values.size).toBe(0);
    vi.resetModules();
    const refreshed = await import('./feature-discovery');
    expect(refreshed.hasUnseenFeature('app-menu')).toBe(true);
    refreshed.acknowledgeFeature('app-menu');
    expect(refreshed.hasUnseenFeature('app-menu')).toBe(false);
    expect(refreshed.hasUnseenFeature('canvas-settings')).toBe(true);
    vi.resetModules();
    const clickedThenRefreshed = await import('./feature-discovery');
    expect(clickedThenRefreshed.hasUnseenFeature('app-menu')).toBe(false);
    expect(clickedThenRefreshed.hasUnseenFeature('canvas-settings')).toBe(true);
    clickedThenRefreshed.acknowledgeFeature('canvas-settings');
    vi.resetModules();
    const allViewed = await import('./feature-discovery');
    expect(allViewed.hasUnseenFeature('app-menu')).toBe(false);
    expect(allViewed.hasUnseenFeature('canvas-settings')).toBe(false);
  });

  it('shows another announcement when the stored revision belongs to an older feature', async () => {
    const api = await import('./feature-discovery');
    const key = api.FEATURE_DISCOVERY_STORAGE_PREFIX + 'canvas-settings';
    values.set(key, 'older-feature');
    expect(api.hasUnseenFeature('canvas-settings')).toBe(true);
    api.acknowledgeFeature('canvas-settings');
    expect(values.get(key)).toBe(
      api.FEATURE_DISCOVERY_REVISIONS['canvas-settings']
    );
    expect(api.hasUnseenFeature('canvas-settings')).toBe(false);
  });

  it('keeps the dismissal in this page if storage is unavailable and notifies mounted consumers', async () => {
    const api = await import('./feature-discovery');
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(api.hasUnseenFeature('app-menu')).toBe(true);
    expect(() => api.acknowledgeFeature('app-menu')).not.toThrow();
    expect(api.hasUnseenFeature('app-menu')).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: api.FEATURE_DISCOVERY_CHANGE_EVENT })
    );
  });

  it('does not rewrite an already acknowledged entry', async () => {
    const api = await import('./feature-discovery');
    const write = vi.spyOn(localStorage, 'setItem');
    api.acknowledgeFeature('canvas-settings');
    api.acknowledgeFeature('canvas-settings');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
