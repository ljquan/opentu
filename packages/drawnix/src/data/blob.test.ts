import { describe, expect, it, vi } from 'vitest';
import {
  getImageMimeTypeFromFileName,
  getSupportedImageFileMimeType,
  getSupportedVideoFileMimeType,
  isSupportedVideoFileType,
} from './blob';

vi.mock('../services/unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob: vi.fn(),
    getCachedBlob: vi.fn(),
    getCacheInfo: vi.fn(),
    isCached: vi.fn(),
  },
}));

describe('video file type helpers', () => {
  it('supports local mov files reported as QuickTime video', () => {
    expect(isSupportedVideoFileType('video/quicktime')).toBe(true);
  });

  it('falls back to the file extension when the browser omits MIME type', () => {
    const file = new File(['video'], 'clip.mov', { type: '' });

    expect(getSupportedVideoFileMimeType(file)).toBe('video/quicktime');
  });
});

describe('image file type helpers', () => {
  it('falls back to the file extension when the browser omits MIME type', () => {
    const file = new File(['image'], 'photo.JFIF', { type: '' });

    expect(getSupportedImageFileMimeType(file)).toBe('image/jfif');
  });

  it('recognizes supported image extensions case-insensitively', () => {
    expect(getImageMimeTypeFromFileName('poster.AVIF')).toBe('image/avif');
    expect(getImageMimeTypeFromFileName('icon.ico')).toBe('image/x-icon');
  });
});
