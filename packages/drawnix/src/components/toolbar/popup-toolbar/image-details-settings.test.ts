import { afterEach, describe, expect, it, vi } from 'vitest';
import { LS_KEYS } from '../../../constants/storage-keys';

afterEach(() => vi.unstubAllGlobals());

async function settings(value: string | null, throws = false) {
  vi.resetModules();
  const storage = {
    getItem: vi.fn(() => {
      if (throws) throw new Error('blocked');
      return value;
    }),
    setItem: vi.fn(() => {
      if (throws) throw new Error('blocked');
    }),
  };
  vi.stubGlobal('window', { localStorage: storage });
  return { ...(await import('./image-details-settings')), storage };
}

describe('image details auto-open preference', () => {
  it('defaults on when no preference is recorded', async () => {
    const config = await settings(null);
    expect(config.readImageDetailsOnClickEnabled()).toBe(true);
  });
  it('reads the saved disabled preference and persists changes', async () => {
    const config = await settings('false');
    expect(config.readImageDetailsOnClickEnabled()).toBe(false);
    config.persistImageDetailsOnClickEnabled(true);
    expect(config.storage.setItem).toHaveBeenCalledWith(
      LS_KEYS.AI_IMAGE_DETAILS_ON_CLICK_ENABLED,
      'true'
    );
    expect(config.readImageDetailsOnClickEnabled()).toBe(true);
  });
  it('preserves the session choice even if storage rejects reads and writes', async () => {
    const config = await settings(null, true);
    expect(config.readImageDetailsOnClickEnabled()).toBe(true);
    config.persistImageDetailsOnClickEnabled(false);
    expect(config.readImageDetailsOnClickEnabled()).toBe(false);
  });
});
