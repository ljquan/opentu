import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareVideoReferenceImageBlob } from './video-reference-image-utils';

const mocks = vi.hoisted(() => ({
  readKeepOriginalImageEnabled: vi.fn(() => false),
  compressImageBlob: vi.fn(),
  normalizeImageBlobToSize: vi.fn(),
}));

vi.mock('@aitu/utils', () => ({
  compressImageBlob: mocks.compressImageBlob,
  normalizeImageBlobToSize: mocks.normalizeImageBlobToSize,
}));
vi.mock('./reference-image-settings', () => ({
  readKeepOriginalImageEnabled: mocks.readKeepOriginalImageEnabled,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readKeepOriginalImageEnabled.mockReturnValue(false);
});

describe('video reference image fidelity', () => {
  it.each([true, false])('retains size normalization with keepOriginal=%s', async (keepOriginal) => {
    const source = new Blob(['source'], { type: 'image/png' });
    const normalized = new Blob([new Uint8Array(1024 * 1024 + 1)], { type: 'image/png' });
    const compressed = new Blob(['small'], { type: 'image/jpeg' });
    mocks.readKeepOriginalImageEnabled.mockReturnValue(keepOriginal);
    mocks.normalizeImageBlobToSize.mockResolvedValue(normalized);
    mocks.compressImageBlob.mockResolvedValue(compressed);

    expect(await prepareVideoReferenceImageBlob(source, '1280x720')).toBe(keepOriginal ? normalized : compressed);
    expect(mocks.normalizeImageBlobToSize).toHaveBeenCalledWith(source, '1280x720', { fit: 'cover', outputType: 'image/png' });
    if (keepOriginal) {
      expect(mocks.compressImageBlob).not.toHaveBeenCalled();
    } else {
      expect(mocks.compressImageBlob).toHaveBeenCalledWith(normalized, 1);
    }
  });

  it('preserves a non-image input without transforming it', async () => {
    const source = new Blob(['video'], { type: 'video/mp4' });
    expect(await prepareVideoReferenceImageBlob(source, '1280x720')).toBe(source);
    expect(mocks.normalizeImageBlobToSize).not.toHaveBeenCalled();
    expect(mocks.compressImageBlob).not.toHaveBeenCalled();
  });

  it('retains the original on normalization failure while fidelity is enabled', async () => {
    const source = new Blob(['source'], { type: 'image/png' });
    mocks.readKeepOriginalImageEnabled.mockReturnValue(true);
    mocks.normalizeImageBlobToSize.mockRejectedValue(new Error('decode failed'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(await prepareVideoReferenceImageBlob(source, '1280x720')).toBe(source);
      expect(mocks.compressImageBlob).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
});
