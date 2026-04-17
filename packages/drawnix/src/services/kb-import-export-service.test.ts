import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  KBDirectory,
  KBNote,
  KBNoteImage,
  KBNoteTag,
  KBTag,
} from '../types/knowledge-base.types';

type MemoryStore<T> = {
  data: Map<string, T>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  iterate: ReturnType<typeof vi.fn>;
};

function createMemoryStore<T>(): MemoryStore<T> {
  const data = new Map<string, T>();
  return {
    data,
    getItem: vi.fn(async (id: string) => data.get(id) ?? null),
    setItem: vi.fn(async (id: string, value: T) => {
      data.set(id, value);
      return value;
    }),
    iterate: vi.fn(async (callback: (value: T) => void) => {
      for (const value of data.values()) {
        callback(value);
      }
    }),
  };
}

const directoriesStore = createMemoryStore<KBDirectory>();
const notesStore = createMemoryStore<Omit<KBNote, 'content'>>();
const noteContentsStore = createMemoryStore<{ id: string; noteId: string; content: string }>();
const noteImagesStore = createMemoryStore<KBNoteImage>();
const tagsStore = createMemoryStore<KBTag>();
const noteTagsStore = createMemoryStore<KBNoteTag>();

const serviceMocks = vi.hoisted(() => ({
  getAllDirectories: vi.fn(),
  getDirectoryById: vi.fn(),
  getNoteById: vi.fn(),
  getTagById: vi.fn(),
}));

vi.mock('./knowledge-base-service', () => ({
  getAllDirectories: serviceMocks.getAllDirectories,
  getDirectoryById: serviceMocks.getDirectoryById,
  getNoteById: serviceMocks.getNoteById,
  getTagById: serviceMocks.getTagById,
  getAllNoteMetas: vi.fn(),
  getNoteMetasByDirectory: vi.fn(),
  getTagsForNote: vi.fn(),
  createNote: vi.fn(),
  createDirectory: vi.fn(),
  getOrCreateTag: vi.fn(),
  addTagToNote: vi.fn(),
  _getStoreInstances: vi.fn(() => ({
    directoriesStore,
    notesStore,
    noteContentsStore,
    noteImagesStore,
    tagsStore,
    noteTagsStore,
  })),
}));

describe('importAllData', () => {
  beforeEach(() => {
    directoriesStore.data.clear();
    notesStore.data.clear();
    noteContentsStore.data.clear();
    noteImagesStore.data.clear();
    tagsStore.data.clear();
    noteTagsStore.data.clear();
    vi.clearAllMocks();
  });

  it('reuses same-name directories and remaps imported notes', async () => {
    const localDirectory: KBDirectory = {
      id: 'dir-local',
      name: '笔记',
      isDefault: true,
      createdAt: 100,
      updatedAt: 100,
      order: 0,
    };
    directoriesStore.data.set(localDirectory.id, localDirectory);

    serviceMocks.getAllDirectories.mockResolvedValue([localDirectory]);
    serviceMocks.getDirectoryById.mockImplementation(async (id: string) => directoriesStore.data.get(id) ?? null);
    serviceMocks.getNoteById.mockImplementation(async (id: string) => {
      const meta = notesStore.data.get(id);
      if (!meta) return null;
      const content = noteContentsStore.data.get(id)?.content ?? '';
      return { ...meta, content };
    });
    serviceMocks.getTagById.mockImplementation(async (id: string) => tagsStore.data.get(id) ?? null);

    const { importAllData } = await import('./kb-import-export-service');
    const result = await importAllData({
      version: 2,
      exportedAt: Date.now(),
      directories: [
        {
          id: 'dir-remote',
          name: '笔记',
          isDefault: true,
          createdAt: 200,
          updatedAt: 200,
          order: 0,
        },
      ],
      notes: [
        {
          id: 'note-1',
          title: '恢复后的笔记',
          directoryId: 'dir-remote',
          content: 'hello world',
          createdAt: 300,
          updatedAt: 400,
        } as KBNote,
      ],
      tags: [],
      noteTags: [],
      images: [],
    });

    expect(result.dirCount).toBe(0);
    expect(result.noteCount).toBe(1);
    expect(Array.from(directoriesStore.data.keys())).toEqual(['dir-local']);
    expect(notesStore.data.get('note-1')).toMatchObject({
      id: 'note-1',
      directoryId: 'dir-local',
      title: '恢复后的笔记',
    });
    expect(noteContentsStore.data.get('note-1')).toMatchObject({
      noteId: 'note-1',
      content: 'hello world',
    });
  });

  it('exports all notes with separated contents without async iterate loss', async () => {
    const directory: KBDirectory = {
      id: 'dir-1',
      name: '笔记',
      isDefault: true,
      createdAt: 100,
      updatedAt: 100,
      order: 0,
    };
    directoriesStore.data.set(directory.id, directory);

    notesStore.data.set('note-1', {
      id: 'note-1',
      title: '第一条',
      directoryId: 'dir-1',
      createdAt: 100,
      updatedAt: 110,
    });
    notesStore.data.set('note-2', {
      id: 'note-2',
      title: '第二条',
      directoryId: 'dir-1',
      createdAt: 120,
      updatedAt: 130,
    });

    noteContentsStore.data.set('note-1', {
      id: 'note-1',
      noteId: 'note-1',
      content: '内容 1',
    });
    noteContentsStore.data.set('note-2', {
      id: 'note-2',
      noteId: 'note-2',
      content: '内容 2',
    });

    serviceMocks.getAllDirectories.mockResolvedValue([directory]);
    serviceMocks.getDirectoryById.mockImplementation(async (id: string) => directoriesStore.data.get(id) ?? null);
    serviceMocks.getNoteById.mockImplementation(async (id: string) => {
      const meta = notesStore.data.get(id);
      if (!meta) return null;
      const content = noteContentsStore.data.get(id)?.content ?? '';
      return { ...meta, content };
    });
    serviceMocks.getTagById.mockImplementation(async (id: string) => tagsStore.data.get(id) ?? null);

    const { exportAllData } = await import('./kb-import-export-service');
    const result = await exportAllData();

    expect(result.notes).toHaveLength(2);
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'note-1', content: '内容 1' }),
        expect.objectContaining({ id: 'note-2', content: '内容 2' }),
      ])
    );
  });
});
