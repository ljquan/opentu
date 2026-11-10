import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectEmbeddedMediaFromElements,
  restoreEmbeddedMedia,
} from '../../data/embedded-media';
import { mediaCollector } from '../github-sync/media-collector';

const mocks = vi.hoisted(() => ({
  blobs: new Map<string, Blob>(),
  loadBoard: vi.fn(),
}));
vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: async (url: string) => mocks.blobs.get(url) || null,
    getCacheInfo: async (url: string) => ({
      isCached: mocks.blobs.has(url),
      size: 100,
      cachedAt: 1,
      lastUsed: 2,
      metadata: { mimeType: 'image/svg+xml' },
    }),
    isCached: async (url: string) => mocks.blobs.has(url),
    cacheMediaFromBlob: async (url: string, blob: Blob) => {
      mocks.blobs.set(url, blob);
      return url;
    },
  },
}));
vi.mock('../workspace-storage-service', () => ({
  workspaceStorageService: { loadBoard: mocks.loadBoard },
}));
vi.mock('../asset-storage-service', () => ({ assetStorageService: {} }));
vi.mock('../task-storage-reader', () => ({ taskStorageReader: {} }));
vi.mock('../../plugins/with-video', () => ({ isVideoElement: () => false }));
vi.mock('../../utils/asset-cleanup', () => ({
  isVirtualUrl: (url: string) => url.startsWith('/__aitu_cache__/'),
}));
vi.mock('../github-sync/sync-log-service', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logSuccess: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
}));

const original = '/__aitu_cache__/image/original.svg';
const fragment = '/__aitu_cache__/image/part.svg';
const element = {
  id: 'part',
  type: 'image',
  url: fragment,
  points: [
    [0, 0],
    [20, 20],
  ],
  svgPlayback: 'paused',
  svgVectorPart: {
    version: 1,
    sourceUrl: original,
    sourceElementId: 'removed-original-node',
    partId: 'a',
    label: 'flower',
    fill: 'blue',
  },
};

beforeEach(() => {
  mocks.blobs.clear();
  mocks.loadBoard.mockReset();
  for (const url of [original, fragment])
    mocks.blobs.set(
      url,
      new Blob(
        [`<svg xmlns="http://www.w3.org/2000/svg"><title>${url}</title></svg>`],
        { type: 'image/svg+xml' }
      )
    );
});

describe('SVG original references survive media persistence', () => {
  it('embeds both the fragment and original even after the original canvas node is removed', async () => {
    const elements = JSON.parse(JSON.stringify([element]));
    const embedded = await collectEmbeddedMediaFromElements(elements);
    expect(new Set(embedded?.map((item) => item.url))).toEqual(
      new Set([original, fragment])
    );
    expect(embedded?.every((item) => item.mimeType === 'image/svg+xml')).toBe(
      true
    );
    mocks.blobs.clear();
    await restoreEmbeddedMedia(embedded);
    expect(new Set(mocks.blobs.keys())).toEqual(new Set([original, fragment]));
    expect(elements[0].svgVectorPart).toEqual(element.svgVectorPart);
    expect(elements[0].svgPlayback).toBe('paused');
  });
  it('includes the preserved original in existing media-sync collection without changing board nodes', async () => {
    const board = { id: 'board', elements: [element] };
    mocks.loadBoard.mockResolvedValue(board);
    const media = await mediaCollector.collectCurrentBoardMedia('board');
    expect(new Set(media.items.map((item) => item.url))).toEqual(
      new Set([original, fragment])
    );
    expect(board.elements).toEqual([element]);
  });
});
