import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindGenerationThumbnail } from './generation-node-thumbnail';
import { unifiedCacheService } from './unified-cache-service';
vi.mock('@aitu/utils', () => ({ normalizeImageDataUrl: (url: string) => url }));
vi.mock('./unified-cache-service', () => ({
  unifiedCacheService: { getCachedBlob: vi.fn() },
}));
const flush = async () => {
  await vi.dynamicImportSettled();
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('generation thumbnail cache', () => {
  it('uses cached image bytes and revokes their URL when removed', async () => {
    const create = vi.fn(() => 'blob:thumbnail');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    vi.mocked(unifiedCacheService.getCachedBlob).mockResolvedValue(
      new Blob(['image'])
    );
    const image = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'image'
    );
    const cleanup = bindGenerationThumbnail(image, '/cached.png');
    image.dispatchEvent(new Event('error'));
    await flush();
    expect(image.getAttribute('href')).toBe('blob:thumbnail');
    image.dispatchEvent(new Event('load'));
    expect(image.hasAttribute('visibility')).toBe(false);
    expect(unifiedCacheService.getCachedBlob).toHaveBeenCalledWith(
      '/cached.png',
      { allowNetwork: false }
    );
    cleanup();
    expect(revoke).toHaveBeenCalledWith('blob:thumbnail');
  });
  it('does not create an object URL after a thumbnail has been removed', async () => {
    const create = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.mocked(unifiedCacheService.getCachedBlob).mockResolvedValue(
      new Blob(['image'])
    );
    const image = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'image'
    );
    bindGenerationThumbnail(image, '/cached.png')();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });
});
