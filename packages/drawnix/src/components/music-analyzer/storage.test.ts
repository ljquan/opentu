import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicAnalysisRecord } from './types';
import { loadRecords, updateRecord } from './storage';

const { getMock, setMock, deleteCacheMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
  deleteCacheMock: vi.fn(),
}));

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  });
});

vi.mock('../../services/kv-storage-service', () => ({
  kvStorageService: {
    get: getMock,
    set: setMock,
  },
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    deleteCache: deleteCacheMock,
  },
}));

describe('music-analyzer storage', () => {
  beforeEach(() => {
    getMock.mockReset();
    setMock.mockReset();
    deleteCacheMock.mockReset();
  });

  it('normalizes legacy records without musicBrief on load', async () => {
    getMock.mockResolvedValue([
      {
        id: 'record-1',
        createdAt: 1,
        source: 'scratch',
        sourceLabel: '旧记录',
        analysis: {
          summary: '老数据',
          structure: ['Verse', '[Chorus]'],
        },
        styleTags: [' edm ', '', 'female vocal'],
        starred: false,
      },
    ]);

    const records = await loadRecords();

    expect(records[0]).toMatchObject({
      id: 'record-1',
      musicBrief: {},
      styleTags: ['edm', 'female vocal'],
      analysis: {
        structure: ['[Verse]', '[Chorus]'],
      },
    });
  });

  it('normalizes musicBrief when updating records', async () => {
    getMock.mockResolvedValue([
      {
        id: 'record-1',
        createdAt: 1,
        source: 'scratch',
        sourceLabel: '新歌',
        starred: false,
      } satisfies MusicAnalysisRecord,
    ]);

    const records = await updateRecord('record-1', {
      musicBrief: {
        purpose: ' 短视频爆点 ',
        genreStyle: ' EDM Pop ',
        vocalStyle: '',
      },
    });

    expect(records[0].musicBrief).toEqual({
      purpose: '短视频爆点',
      genreStyle: 'EDM Pop',
    });
    expect(setMock).toHaveBeenCalledWith(
      'music-analyzer:records',
      expect.arrayContaining([
        expect.objectContaining({
          musicBrief: {
            purpose: '短视频爆点',
            genreStyle: 'EDM Pop',
          },
        }),
      ])
    );
  });
});
