import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetProvider, useAssets } from './AssetContext';
import { AssetType, type Asset } from '../types/asset.types';
import { TaskStatus, TaskType } from '../types/task.types';

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  getAllAssets: vi.fn(),
  getAllCachedMedia: vi.fn(),
  getAssetTasks: vi.fn(),
  getInternalResultTaskIds: vi.fn(),
  initializeAssetStorage: vi.fn(),
  initializeAudioPlaylist: vi.fn(),
  setGlobalAssetMap: vi.fn(),
}));

vi.mock('../services/asset-storage-service', () => ({
  assetStorageService: {
    initialize: mocks.initializeAssetStorage,
    cleanup: mocks.cleanup,
    getAllAssets: mocks.getAllAssets,
  },
}));

vi.mock('../services/audio-playlist-service', () => ({
  audioPlaylistService: {
    initialize: mocks.initializeAudioPlaylist,
  },
}));

vi.mock('../services/task-storage-reader', () => ({
  taskStorageReader: {
    getAssetTasks: mocks.getAssetTasks,
    getInternalResultTaskIds: mocks.getInternalResultTaskIds,
  },
}));

vi.mock('../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getAllCachedMedia: mocks.getAllCachedMedia,
  },
}));

vi.mock('../services/task-queue', () => ({
  taskQueueService: {
    deleteTask: vi.fn(),
  },
}));

vi.mock('../stores/asset-map-store', () => ({
  setGlobalAssetMap: mocks.setGlobalAssetMap,
}));

let renderedAssets: Asset[] = [];

function AssetProbe() {
  renderedAssets = useAssets().assets;
  return null;
}

describe('AssetContext result visibility', () => {
  beforeEach(() => {
    renderedAssets = [];
    mocks.cleanup.mockReset();
    mocks.getAllAssets.mockReset().mockResolvedValue([]);
    mocks.getAssetTasks.mockReset().mockResolvedValue([]);
    mocks.getInternalResultTaskIds
      .mockReset()
      .mockResolvedValue(new Set(['internal-video']));
    mocks.initializeAssetStorage.mockReset().mockResolvedValue(undefined);
    mocks.initializeAudioPlaylist.mockReset().mockResolvedValue(undefined);
    mocks.setGlobalAssetMap.mockReset();
    mocks.getAllCachedMedia.mockReset().mockResolvedValue([
      {
        url: '/__aitu_cache__/video/internal.mp4',
        type: 'video',
        mimeType: 'video/mp4',
        size: 128,
        cachedAt: 3,
        lastUsed: 3,
        metadata: {
          taskId: 'internal-video',
          prompt: 'internal',
        },
      },
      {
        url: '/__aitu_cache__/image/internal-metadata.png',
        type: 'image',
        mimeType: 'image/png',
        size: 128,
        cachedAt: 2.5,
        lastUsed: 2.5,
        metadata: {
          taskId: 'internal-metadata-image',
          prompt: 'internal metadata',
          resultVisibility: 'internal',
        },
      },
      {
        url: '/__aitu_cache__/image/user.png',
        type: 'image',
        mimeType: 'image/png',
        size: 128,
        cachedAt: 2,
        lastUsed: 2,
        metadata: {
          taskId: 'user-image',
          prompt: 'user',
          resultVisibility: 'user',
        },
      },
      {
        url: '/__aitu_cache__/audio/legacy.mp3',
        type: 'audio',
        mimeType: 'audio/mpeg',
        size: 128,
        cachedAt: 1,
        lastUsed: 1,
        metadata: {
          taskId: 'legacy-audio',
          prompt: 'legacy',
        },
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('filters internal cache supplements while keeping legacy entries visible', async () => {
    const view = render(
      <AssetProvider>
        <AssetProbe />
      </AssetProvider>
    );

    await waitFor(() => {
      expect(renderedAssets.map((asset) => asset.taskId)).toEqual([
        'user-image',
        'legacy-audio',
      ]);
    });
    expect(mocks.getAssetTasks).toHaveBeenCalledWith({
      includeArchived: true,
    });
    expect(mocks.getInternalResultTaskIds).toHaveBeenCalledWith([
      'internal-video',
      'internal-metadata-image',
      'user-image',
      'legacy-audio',
    ]);

    view.unmount();
  });

  it('keeps an internal cached image hidden after its task record is deleted', async () => {
    mocks.getInternalResultTaskIds.mockResolvedValue(new Set());
    mocks.getAllCachedMedia.mockResolvedValue([
      {
        url: '/__aitu_cache__/image/deleted-internal-task.png',
        type: 'image',
        mimeType: 'image/png',
        size: 128,
        cachedAt: 2,
        lastUsed: 2,
        metadata: {
          taskId: 'deleted-internal-task',
          resultVisibility: 'internal',
        },
      },
      {
        url: '/__aitu_cache__/image/legacy-user-task.png',
        type: 'image',
        mimeType: 'image/png',
        size: 128,
        cachedAt: 1,
        lastUsed: 1,
        metadata: { taskId: 'legacy-user-task' },
      },
    ]);

    const view = render(
      <AssetProvider>
        <AssetProbe />
      </AssetProvider>
    );

    await waitFor(() => {
      expect(renderedAssets.map((asset) => asset.taskId)).toEqual([
        'legacy-user-task',
      ]);
    });
    expect(mocks.getInternalResultTaskIds).toHaveBeenCalledWith([
      'deleted-internal-task',
      'legacy-user-task',
    ]);

    view.unmount();
  });

  it('projects one PPT explainer final video when task and cache entries overlap', async () => {
    mocks.getAssetTasks.mockResolvedValue([
      {
        id: 'ppt-explainer-final',
        type: TaskType.VIDEO,
        status: TaskStatus.COMPLETED,
        params: {
          prompt: 'PPT 讲解视频',
          resultVisibility: 'user',
          pptExplainer: { schemaVersion: 1, sourceBoardId: 'board-1' },
        },
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
        result: {
          url: '/__aitu_cache__/video/ppt-explainer-final.mp4',
          format: 'mp4',
          size: 128,
          resultKind: 'video',
          resultVisibility: 'user',
        },
      },
    ]);
    mocks.getInternalResultTaskIds.mockResolvedValue(new Set());
    mocks.getAllCachedMedia.mockResolvedValue([
      {
        url: '/__aitu_cache__/video/ppt-explainer-final.mp4',
        type: 'video',
        mimeType: 'video/mp4',
        size: 128,
        cachedAt: 2,
        lastUsed: 2,
        metadata: {
          taskId: 'ppt-explainer-final',
          resultVisibility: 'user',
        },
      },
    ]);

    const view = render(
      <AssetProvider>
        <AssetProbe />
      </AssetProvider>
    );

    await waitFor(() => {
      expect(renderedAssets).toHaveLength(1);
      expect(renderedAssets[0]).toMatchObject({
        taskId: 'ppt-explainer-final',
        type: AssetType.VIDEO,
      });
    });

    view.unmount();
  });
});
