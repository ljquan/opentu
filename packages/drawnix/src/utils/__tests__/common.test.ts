import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getElementGMock, hasMountedMock, toImageMock } = vi.hoisted(() => ({
  getElementGMock: vi.fn(),
  hasMountedMock: vi.fn(),
  toImageMock: vi.fn(),
}));
const { getCachedBlobMock } = vi.hoisted(() => ({ getCachedBlobMock: vi.fn() }));
vi.mock('../../services/unified-cache-service', () => ({ unifiedCacheService: { getCachedBlob: getCachedBlobMock } }));

vi.mock('@plait/core', () => ({
  IS_APPLE: false,
  IS_MAC: false,
  PlaitElement: {
    getElementG: getElementGMock,
    hasMounted: hasMountedMock,
  },
  toImage: toImageMock,
}));

import { safeToImage } from '../common';

function createMountedElementG(imageUrl: string): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const foreignObject = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'foreignObject'
  );
  const wrapper = document.createElement('div');
  const image = document.createElement('img');

  image.setAttribute('src', imageUrl);
  wrapper.appendChild(image);
  foreignObject.appendChild(wrapper);
  g.appendChild(foreignObject);

  return g;
}

describe('safeToImage', () => {
  beforeEach(() => getCachedBlobMock.mockResolvedValue(null));
  it('rejects unavailable originals instead of exporting transparency and restores the preview', async () => {
    const g = createMountedElementG('/preview.png');
    const image = g.querySelector('img')!;
    image.dataset.canvasOriginalSrc = '/expired.png';
    image.decode = vi.fn().mockRejectedValue(new Error('original unavailable'));
    hasMountedMock.mockReturnValue(true); getElementGMock.mockReturnValue(g);
    await expect(safeToImage({ children: [{ id: 'image' }] } as any)).rejects.toThrow('original unavailable');
    expect(image.getAttribute('src')).toBe('/preview.png');
  });
  it('waits for original decoding before cloning computed styles and restores lazy loading', async () => {
    const g = createMountedElementG('data:image/png;base64,placeholder');
    const image = g.querySelector('img')!;
    image.dataset.canvasOriginalSrc = '/original.png';
    image.setAttribute('loading', 'lazy');
    const decode = vi.fn(async () => {
      expect(image.getAttribute('src')).toBe('/original.png');
      expect(image.getAttribute('loading')).toBe('eager');
    });
    image.decode = decode;
    hasMountedMock.mockReturnValue(true);
    getElementGMock.mockReturnValue(g);
    toImageMock.mockImplementation(async () => {
      expect(decode).toHaveBeenCalledOnce();
      return 'full-resolution-export';
    });
    expect(await safeToImage({ children: [{ id: 'image' }] } as any)).toBe('full-resolution-export');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('src')).toBe('data:image/png;base64,placeholder');
  });
  it('exports an expired original from persistent cache and releases only its temporary export URL', async () => {
    const g = createMountedElementG('blob:preview');
    const image = g.querySelector('img')!;
    image.dataset.canvasOriginalSrc = 'https://expired.test/a.png?signature=abc';
    hasMountedMock.mockReturnValue(true);
    getElementGMock.mockReturnValue(g);
    getCachedBlobMock.mockResolvedValue(new Blob(['original image'], { type: 'image/png' }));
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = () => 'blob:export-original';
      static revokeObjectURL = revoke;
    });
    toImageMock.mockImplementation(async () => image.getAttribute('src'));
    expect(await safeToImage({ children: [{ id: 'image' }] } as any)).toBe('blob:export-original');
    expect(image.getAttribute('src')).toBe('blob:preview');
    expect(getCachedBlobMock).toHaveBeenCalledWith(image.dataset.canvasOriginalSrc, { allowNetwork: false });
    expect(revoke).toHaveBeenCalledWith('blob:export-original');
    expect(revoke).not.toHaveBeenCalledWith('blob:preview');
  });
  it.each(['dormant', 'preview'])('exports %s images using the original URL and restores the display source', async (mode) => {
    const g = createMountedElementG('blob:preview');
    const image = g.querySelector('img')!;
    if (mode === 'dormant') image.removeAttribute('src');
    image.dataset.canvasOriginalSrc = '/__aitu_cache__/image/original.png';
    hasMountedMock.mockReturnValue(true);
    getElementGMock.mockReturnValue(g);
    toImageMock.mockImplementation(async () => image.getAttribute('src'));
    expect(await safeToImage({ children: [{ id: 'image' }] } as any)).toBe('/__aitu_cache__/image/original.png');
    expect(image.getAttribute('src')).toBe(mode === 'dormant' ? null : 'blob:preview');
  });

  it('restores the preview source even when export throws', async () => {
    const g = createMountedElementG('blob:preview');
    const image = g.querySelector('img')!;
    image.dataset.canvasOriginalSrc = '/original.png';
    hasMountedMock.mockReturnValue(true);
    getElementGMock.mockReturnValue(g);
    toImageMock.mockRejectedValueOnce(new Error('export failed'));
    await expect(safeToImage({ children: [{ id: 'image' }] } as any)).rejects.toThrow('export failed');
    expect(image.getAttribute('src')).toBe('blob:preview');
  });

  it('keeps the original pinned until overlapping exports both complete', async () => {
    const g = createMountedElementG('blob:preview');
    const image = g.querySelector('img')!;
    image.dataset.canvasOriginalSrc = '/original.png';
    hasMountedMock.mockReturnValue(true);
    getElementGMock.mockReturnValue(g);
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    toImageMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishSecond = resolve; }));
    const board = { children: [{ id: 'image' }] } as any;
    const first = safeToImage(board);
    await vi.waitFor(() => expect(finishFirst).toBeDefined());
    const second = safeToImage(board);
    await vi.waitFor(() => expect(finishSecond).toBeDefined());
    finishFirst();
    await first;
    expect(image.getAttribute('src')).toBe('/original.png');
    finishSecond();
    await second;
    expect(image.getAttribute('src')).toBe('blob:preview');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('falls back failed mounted DOM images to transparent PNG during toImage', async () => {
    const imageUrl = 'https://media.example.com/missing.png';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));

    vi.stubGlobal('fetch', fetchMock);
    hasMountedMock.mockReturnValue(true);
    getElementGMock.mockReturnValue(createMountedElementG(imageUrl));
    toImageMock.mockImplementation(async () => {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      return `${blob.type}:${blob.size}`;
    });

    const result = await safeToImage(
      { children: [{ id: 'image-1' }] } as any,
      {}
    );

    expect(result).toMatch(/^image\/png:\d+$/);
    expect(fetchMock).toHaveBeenCalledWith(imageUrl, undefined);
    expect(window.fetch).toBe(fetchMock);
  });
});
