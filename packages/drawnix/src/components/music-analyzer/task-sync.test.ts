import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicAnalysisRecord } from './types';
import { syncMusicAnalyzerTask, syncMusicGenerationTask } from './task-sync';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

const { recordsStore, loadRecordsMock, updateRecordMock, addRecordMock } =
  vi.hoisted(() => ({
    recordsStore: { records: [] as MusicAnalysisRecord[] },
    loadRecordsMock: vi.fn(),
    updateRecordMock: vi.fn(),
    addRecordMock: vi.fn(),
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

vi.mock('./storage', () => ({
  loadRecords: loadRecordsMock,
  updateRecord: updateRecordMock,
  addRecord: addRecordMock,
}));

describe('music-analyzer task sync', () => {
  beforeEach(() => {
    recordsStore.records = [];
    loadRecordsMock.mockReset();
    updateRecordMock.mockReset();
    addRecordMock.mockReset();
    loadRecordsMock.mockImplementation(async () => recordsStore.records);
    updateRecordMock.mockImplementation(
      async (id: string, patch: Partial<MusicAnalysisRecord>) => {
        recordsStore.records = recordsStore.records.map((record) =>
          record.id === id ? { ...record, ...patch } : record
        );
        return recordsStore.records;
      }
    );
  });

  it('merges music brief style tags when syncing Suno lyrics results', async () => {
    recordsStore.records = [
      {
        id: 'record-1',
        createdAt: 1,
        source: 'scratch',
        sourceLabel: '热血新歌',
        creationPrompt: '写一首冲破低谷的歌',
        pendingLyricsGenTaskId: 'task-1',
        musicBrief: {
          genreStyle: 'EDM Pop',
          vocalStyle: 'female vocal',
          energyMood: '高能上扬',
        },
        styleTags: ['old tag'],
        starred: false,
      },
    ];

    const task = {
      id: 'task-1',
      type: TaskType.AUDIO,
      status: TaskStatus.COMPLETED,
      params: {
        prompt: 'lyrics prompt',
        musicAnalyzerAction: 'lyrics-gen',
        musicAnalyzerRecordId: 'record-1',
      },
      createdAt: 1,
      updatedAt: 1,
      result: {
        url: '',
        format: 'lyrics',
        size: 0,
        resultKind: 'lyrics',
        lyricsTitle: '燃夜',
        lyricsTags: ['dance pop', 'female vocal'],
        lyricsText: '[Chorus]\n把黑夜点燃',
      },
    } satisfies Task;

    const synced = await syncMusicAnalyzerTask(task);

    expect(synced?.record.title).toBe('燃夜');
    expect(synced?.record.styleTags).toEqual([
      'dance pop',
      'female vocal',
      'EDM Pop',
      '高能上扬',
    ]);
    expect(synced?.record.lyricsDraft).toBe('[Chorus]\n把黑夜点燃');
    expect(synced?.record.pendingLyricsGenTaskId).toBeNull();
    expect(synced?.record.lyricsVersions?.[0]).toMatchObject({
      label: 'Suno 歌词',
      title: '燃夜',
      styleTags: ['dance pop', 'female vocal', 'EDM Pop', '高能上扬'],
    });
  });

  it('persists native public resources and both lyric versions idempotently', async () => {
    recordsStore.records = [{ id: 'native-record', source: 'scratch', sourceLabel: 'native', createdAt: 1, starred: false }];
    const sunoNative = { action: 'lyrics', profileId: 'p', resources: [{ taskId: 'public', sourceAction: 'lyrics', profileId: 'p' }],
      lyrics: [{ text: 'first', title: 'First' }, { text: 'second', title: 'Second' }], files: [], data: {} };
    const task: Task = { id: 'native-task', type: TaskType.AUDIO, status: TaskStatus.COMPLETED,
      params: { model: 'suno_act_mp4', prompt: 'pop', batchId: 'ma_native-record_native_0' }, createdAt: 1, updatedAt: 1,
      result: { url: '', format: 'lyrics', size: 0, analysisData: { sunoNative } } };
    const synced = await syncMusicGenerationTask(task, 'native-record');
    expect(synced?.record.sunoNativeResults).toEqual([{ taskId: 'native-task', result: sunoNative }]);
    expect(synced?.record.lyricsVersions?.map((version) => version.lyricsDraft)).toEqual(['first', 'second']);
    expect(synced?.record.generatedClips).toBeUndefined();
    await syncMusicGenerationTask(task, 'native-record'); expect(updateRecordMock).toHaveBeenCalledOnce();
  });

  it('persists all v2 resources and lyric versions once without creating empty clips', async () => {
    recordsStore.records = [{ id: 'v2-record', source: 'scratch', sourceLabel: 'v2', createdAt: 1, starred: false }];
    const sunoV2 = {
      action: 'lyrics', profileId: 'p', resources: [{ id: 'm', kind: 'music_id' as const, profileId: 'p' }],
      lyrics: [{ text: 'first', title: 'First' }, { text: 'second', title: 'Second' }], files: [], data: {},
    };
    const task: Task = { id: 'v2-task', type: TaskType.AUDIO, status: TaskStatus.COMPLETED,
      params: { model: 'suno/lyrics', prompt: 'pop', batchId: 'ma_v2-record_v2_0' }, createdAt: 1, updatedAt: 1,
      result: { url: '', format: 'lyrics', size: 0, analysisData: { sunoV2 } } };
    const synced = await syncMusicGenerationTask(task, 'v2-record');
    expect(synced?.record.sunoV2Results).toEqual([{ taskId: 'v2-task', result: sunoV2 }]);
    expect(synced?.record.lyricsVersions?.map((v) => v.lyricsDraft)).toEqual(['first', 'second']);
    expect(synced?.record.lyricsVersions?.find((v) => v.id === synced.record.activeVersionId)?.lyricsDraft).toBe('first');
    expect(synced?.record.generatedClips).toBeUndefined();
    await syncMusicGenerationTask(task, 'v2-record');
    expect(updateRecordMock).toHaveBeenCalledTimes(1);
  });

  it('syncs both v2 lyrics candidates from the lyrics page and clears the pending task', async () => {
    recordsStore.records = [{ id: 'record', source: 'scratch', sourceLabel: 'lyrics', createdAt: 1,
      starred: false, pendingLyricsGenTaskId: 'lyrics-task', styleTags: ['pop'],
      musicBrief: { genreStyle: 'EDM' } }];
    const sunoV2 = { action: 'lyrics', profileId: 'p', resources: [], files: [], data: {},
      lyrics: [{ text: 'first', title: 'First', tags: ['piano'] }, { text: 'second', title: 'Second' }] };
    const task: Task = { id: 'lyrics-task', type: TaskType.AUDIO, status: TaskStatus.COMPLETED,
      params: { model: 'suno/lyrics', prompt: 'pop', musicAnalyzerAction: 'lyrics-gen',
        musicAnalyzerRecordId: 'record' }, createdAt: 1, updatedAt: 1,
      result: { url: '', format: 'lyrics', size: 0, analysisData: { sunoV2 } } };
    const synced = await syncMusicAnalyzerTask(task);
    expect(synced?.record).toMatchObject({ title: 'First', lyricsDraft: 'first',
      pendingLyricsGenTaskId: null, styleTags: ['piano', 'EDM'],
      sunoV2Results: [{ taskId: 'lyrics-task', result: sunoV2 }] });
    expect(synced?.record.lyricsVersions?.map((version) => version.lyricsDraft)).toEqual(['first', 'second']);
    expect(await syncMusicAnalyzerTask(task)).toBeNull();
    expect(updateRecordMock).toHaveBeenCalledTimes(1);
  });

  it('saves a cloned voice once as a persona resource without replacing lyrics or adding an empty clip', async () => {
    recordsStore.records = [{ id: 'voice-record', source: 'scratch', sourceLabel: 'voice', createdAt: 1,
      starred: false, lyricsDraft: 'existing lyrics' }];
    const sunoV2 = { action: 'create-voice', profileId: 'p',
      resources: [{ id: 'voice', kind: 'persona_id' as const, profileId: 'p' }], files: [], lyrics: [], data: { persona_id: 'voice' } };
    const task: Task = { id: 'voice-task', type: TaskType.AUDIO, status: TaskStatus.COMPLETED,
      params: { model: 'suno/create-voice', prompt: '音色克隆', batchId: 'ma_voice-record_v2_0' }, createdAt: 1, updatedAt: 1,
      result: { url: '', format: 'json', size: 0, analysisData: { sunoV2 } } };
    const synced = await syncMusicGenerationTask(task, 'voice-record');
    expect(synced?.record).toMatchObject({ lyricsDraft: 'existing lyrics', sunoV2Results: [{ taskId: 'voice-task', result: sunoV2 }] });
    expect(synced?.record.generatedClips).toBeUndefined();
    await syncMusicGenerationTask(task, 'voice-record');
    expect(updateRecordMock).toHaveBeenCalledTimes(1);
  });
});
