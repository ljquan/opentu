import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeatureDiscovery } from './use-feature-discovery';
import {
  FEATURE_DISCOVERY_REVISIONS,
  FEATURE_DISCOVERY_STORAGE_PREFIX,
} from '../utils/feature-discovery';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('feature indicators', () => {
  it('updates mounted copies after clicking an entry and retains an unclicked section after remount', () => {
    const menu = renderHook(() => useFeatureDiscovery('app-menu'));
    const menuCopy = renderHook(() => useFeatureDiscovery('app-menu'));
    const canvas = renderHook(() => useFeatureDiscovery('canvas-settings'));
    expect(menu.result.current.hasNewFeature).toBe(true);
    expect(canvas.result.current.hasNewFeature).toBe(true);
    act(() => menu.result.current.markSeen());
    expect(menu.result.current.hasNewFeature).toBe(false);
    expect(menuCopy.result.current.hasNewFeature).toBe(false);
    expect(canvas.result.current.hasNewFeature).toBe(true);
    menu.unmount();
    const reopened = renderHook(() => useFeatureDiscovery('app-menu'));
    expect(reopened.result.current.hasNewFeature).toBe(false);
    act(() => canvas.result.current.markSeen());
    expect(canvas.result.current.hasNewFeature).toBe(false);
  });

  it('updates when the same feature was viewed in another tab', () => {
    const canvas = renderHook(() => useFeatureDiscovery('canvas-settings'));
    act(() => {
      const key = FEATURE_DISCOVERY_STORAGE_PREFIX + 'canvas-settings';
      const newValue = FEATURE_DISCOVERY_REVISIONS['canvas-settings'];
      localStorage.setItem(key, newValue);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
    });
    expect(canvas.result.current.hasNewFeature).toBe(false);
  });
});
