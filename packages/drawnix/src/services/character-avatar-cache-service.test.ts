import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  iterate: vi.fn(),
  length: vi.fn(),
}));

vi.mock('localforage', () => ({
  default: {
    createInstance: () => storeMocks,
  },
}));

// eslint-disable-next-line import/first
import { characterAvatarCacheService } from './character-avatar-cache-service';

const avatarCacheInternals = characterAvatarCacheService as unknown as {
  fetchImageAsBlob: (url: string) => Promise<Blob | null>;
};

describe('character-avatar-cache-service clear barrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMocks.getItem.mockResolvedValue(null);
    storeMocks.setItem.mockResolvedValue(undefined);
    storeMocks.clear.mockResolvedValue(undefined);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:avatar'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('waits for an in-flight avatar write before clearing the store', async () => {
    let resolveBlob: ((blob: Blob) => void) | undefined;
    const fetchImageAsBlob = vi
      .spyOn(avatarCacheInternals, 'fetchImageAsBlob')
      .mockReturnValue(
        new Promise<Blob>((resolve) => {
          resolveBlob = resolve;
        })
      );

    const caching = characterAvatarCacheService.cacheAvatar(
      'character-old',
      'https://example.com/old.png'
    );
    await vi.waitFor(() => {
      expect(fetchImageAsBlob).toHaveBeenCalledTimes(1);
    });

    const clearing = characterAvatarCacheService.clearAll();
    const lateCaching = characterAvatarCacheService.cacheAvatar(
      'character-late',
      'https://example.com/late.png'
    );
    await Promise.resolve();

    expect(storeMocks.clear).not.toHaveBeenCalled();
    await expect(lateCaching).resolves.toBe(false);

    resolveBlob?.(new Blob(['avatar'], { type: 'image/png' }));
    await expect(caching).resolves.toBe(true);
    await expect(clearing).resolves.toBe(true);

    expect(storeMocks.setItem).toHaveBeenCalledTimes(1);
    expect(storeMocks.setItem.mock.invocationCallOrder[0]).toBeLessThan(
      storeMocks.clear.mock.invocationCallOrder[0]
    );
  });
});
