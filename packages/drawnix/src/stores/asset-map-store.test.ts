import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAssetMapLoader, subscribeAssetMap } from './asset-map-store';

afterEach(() => vi.clearAllMocks());

describe('asset map demand', () => {
  it('does not request scans until an embedded asset subscribes', () => {
    const load = vi.fn();
    const unregister = registerAssetMapLoader(load);
    expect(load).not.toHaveBeenCalled();
    const unsubscribe = subscribeAssetMap(() => undefined);
    expect(load).toHaveBeenCalledOnce();
    unsubscribe();
    unregister();
  });

  it('loads assets for independent roots mounted before the provider is ready', () => {
    const unsubscribe = subscribeAssetMap(() => undefined);
    const load = vi.fn();
    const unregister = registerAssetMapLoader(load);
    expect(load).toHaveBeenCalledOnce();
    unsubscribe();
    unregister();
  });

  it('an old provider cleanup does not unregister the current loader', () => {
    const cleanupOld = registerAssetMapLoader(vi.fn());
    const current = vi.fn();
    const cleanupCurrent = registerAssetMapLoader(current);
    cleanupOld();
    const unsubscribe = subscribeAssetMap(() => undefined);
    expect(current).toHaveBeenCalledOnce();
    unsubscribe();
    cleanupCurrent();
  });
});
