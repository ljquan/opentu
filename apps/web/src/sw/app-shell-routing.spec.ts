import { describe, expect, it } from 'vitest';

import {
  shouldBypassAppShellCacheForLazyChunkRecovery,
  shouldUseOriginFirstPreload,
  shouldUseAppShellStrategy,
} from './app-shell-routing';

describe('app-shell-routing', () => {
  it('keeps SPA navigations on the app shell', () => {
    expect(shouldUseAppShellStrategy('navigate', '/workspace/abc')).toBe(true);
    expect(shouldUseAppShellStrategy('navigate', '/')).toBe(true);
    expect(shouldUseAppShellStrategy('navigate', '/index.html')).toBe(true);
  });

  it('does not treat explicit html documents as the app shell', () => {
    expect(
      shouldUseAppShellStrategy('navigate', '/user-manual/index.html')
    ).toBe(false);
    expect(
      shouldUseAppShellStrategy('navigate', '/advanced-settings.html')
    ).toBe(false);
  });

  it('keeps only root shell and release metadata on origin-first preload', () => {
    expect(shouldUseOriginFirstPreload('/')).toBe(true);
    expect(shouldUseOriginFirstPreload('/index.html')).toBe(true);
    expect(shouldUseOriginFirstPreload('/version.json')).toBe(true);
    expect(shouldUseOriginFirstPreload('/manifest.json')).toBe(true);
    expect(shouldUseOriginFirstPreload('/sw.js')).toBe(true);
    expect(shouldUseOriginFirstPreload('/precache-manifest.json')).toBe(true);
    expect(shouldUseOriginFirstPreload('/idle-prefetch-manifest.json')).toBe(
      true
    );
  });

  it('bypasses the cached app shell only for fresh lazy chunk recovery reloads', () => {
    expect(
      shouldBypassAppShellCacheForLazyChunkRecovery(
        '?_lazy_chunk_retry=1&_t=1000',
        1000 + 60 * 1000
      )
    ).toBe(true);
    expect(
      shouldBypassAppShellCacheForLazyChunkRecovery(
        '?_lazy_chunk_retry=1&_t=1000',
        1000 + 11 * 60 * 1000
      )
    ).toBe(false);
    expect(shouldBypassAppShellCacheForLazyChunkRecovery('?board=abc')).toBe(
      false
    );
  });
});
