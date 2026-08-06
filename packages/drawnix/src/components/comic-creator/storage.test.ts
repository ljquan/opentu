import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRecords } from './storage';

const { getMock, setMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
}));

vi.mock('../../services/kv-storage-service', () => ({
  kvStorageService: {
    get: getMock,
    isAvailable: () => true,
    set: setMock,
  },
}));

vi.mock('./utils', () => ({
  stripLargeImageDataFromComicPage: (page: unknown) => page,
}));

describe('comic-creator storage', () => {
  beforeEach(() => {
    getMock.mockReset();
    setMock.mockReset();
  });

  it('migrates legacy default image model on load', async () => {
    getMock.mockResolvedValue([
      {
        id: 'record-1',
        starred: false,
        title: '旧记录',
        sourcePrompt: '故事',
        commonPrompt: '',
        pageCount: 1,
        pages: [],
        imageModel: 'gpt-image-2-vip',
        imageModelRef: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const records = await loadRecords();

    expect(records[0]).toMatchObject({
      imageModel: 'gpt-image-2',
      imageModelRef: null,
    });
  });

  it('preserves explicit profile-bound legacy image model', async () => {
    getMock.mockResolvedValue([
      {
        id: 'record-1',
        starred: false,
        title: '自定义记录',
        sourcePrompt: '故事',
        commonPrompt: '',
        pageCount: 1,
        pages: [],
        imageModel: 'gpt-image-2-vip',
        imageModelRef: {
          profileId: 'custom-profile',
          modelId: 'gpt-image-2-vip',
        },
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const records = await loadRecords();

    expect(records[0]).toMatchObject({
      imageModel: 'gpt-image-2-vip',
      imageModelRef: {
        profileId: 'custom-profile',
        modelId: 'gpt-image-2-vip',
      },
    });
  });
});
