import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LS_KEYS, LS_KEYS_TO_MIGRATE } from '../constants/storage-keys';

const mocks = vi.hoisted(() => ({
  clearAllCache: vi.fn(),
  resumeCacheWrites: vi.fn(),
  clearAvatars: vi.fn(async () => true),
  clearCharacters: vi.fn(),
  clearConversationHistory: vi.fn(),
  hasPendingChanges: vi.fn(() => false),
  removeKv: vi.fn(),
  clearPromptHistory: vi.fn(),
  activeTasks: [] as unknown[],
  runningWorkflows: [] as unknown[],
  clearAllTasks: vi.fn(),
  clearAllWorkflows: vi.fn(),
  clearWorkflowCompletion: vi.fn(),
  clearWorkspaceContent: vi.fn(),
}));

const storage = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => Array.from(storage.keys())[index] ?? null,
  removeItem: (key) => {
    storage.delete(key);
  },
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
};

vi.mock('./app-database', () => ({
  APP_DB_NAME: 'aitu-app',
  APP_DB_STORES: {
    TASKS: 'tasks',
    WORKFLOWS: 'workflows',
    CONFIG: 'config',
  },
  getAppDB: vi.fn(async () => ({
    transaction: () => {
      const transaction: {
        objectStore: () => { clear: () => void };
        oncomplete?: () => void;
        onerror?: () => void;
        onabort?: () => void;
      } = {
        objectStore: () => ({ clear: () => undefined }),
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    },
  })),
}));

vi.mock('./unified-cache-service', () => ({
  unifiedCacheService: {
    clearAllCache: mocks.clearAllCache,
    resumeCacheWrites: mocks.resumeCacheWrites,
  },
}));
vi.mock('./character-avatar-cache-service', () => ({
  characterAvatarCacheService: { clearAll: mocks.clearAvatars },
}));
vi.mock('./character-storage-service', () => ({
  characterStorageService: { clearAll: mocks.clearCharacters },
}));
vi.mock('./chat-storage-service', () => ({
  chatStorageService: {
    clearConversationHistory: mocks.clearConversationHistory,
  },
}));
vi.mock('./github-sync/sync-engine', () => ({
  syncEngine: { hasPendingChanges: mocks.hasPendingChanges },
}));
vi.mock('./kv-storage-service', () => ({
  kvStorageService: { remove: mocks.removeKv },
}));
vi.mock('./prompt-storage-service', () => ({
  clearGenerationPromptHistory: mocks.clearPromptHistory,
}));
vi.mock('./task-queue-service', () => ({
  taskQueueService: {
    getActiveTasks: () => mocks.activeTasks,
    clearAllTasks: mocks.clearAllTasks,
  },
}));
vi.mock('./workflow-completion-service', () => ({
  workflowCompletionService: { clear: mocks.clearWorkflowCompletion },
}));
vi.mock('./workflow-submission-service', () => ({
  workflowSubmissionService: {
    getRunningWorkflows: () => mocks.runningWorkflows,
    clearAllWorkflows: mocks.clearAllWorkflows,
  },
}));
vi.mock('./workspace-storage-service', () => ({
  workspaceStorageService: { clearContent: mocks.clearWorkspaceContent },
}));

// eslint-disable-next-line import/first
import {
  getLocalDataClearRisk,
  clearLocalData,
} from './local-data-clear-service';

async function createDatabaseWithStores(
  name: string,
  stores: readonly string[]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      for (const storeName of stores) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction([...stores], 'readwrite');
      for (const storeName of stores) {
        transaction.objectStore(storeName).put({ value: storeName }, 'item');
      }
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function countStore(name: string, storeName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(storeName, 'readonly');
      const countRequest = transaction.objectStore(storeName).count();
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => reject(countRequest.error);
      transaction.oncomplete = () => db.close();
    };
    request.onerror = () => reject(request.error);
  });
}

describe('local-data-clear-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeTasks = [];
    mocks.runningWorkflows = [];
    mocks.hasPendingChanges.mockReturnValue(false);
    mocks.clearAvatars.mockResolvedValue(true);
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('indexedDB', new IDBFactory());
    storage.clear();
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('language', 'zh-CN');
    localStorage.setItem('model-config', 'image-model');
  });

  it('clears only media caches in cache mode and preserves preferences', async () => {
    localStorage.setItem(LS_KEYS.AI_IMAGE_PREVIEW_CACHE, 'image-preview');
    localStorage.setItem(LS_KEYS.AI_VIDEO_PREVIEW_CACHE, 'video-preview');

    await clearLocalData('cache');

    expect(mocks.clearAllCache).toHaveBeenCalledWith({
      keepWritesPaused: true,
    });
    expect(mocks.clearAvatars).toHaveBeenCalledTimes(1);
    expect(mocks.clearAllTasks).not.toHaveBeenCalled();
    expect(mocks.clearWorkspaceContent).not.toHaveBeenCalled();
    expect(localStorage.getItem(LS_KEYS.AI_IMAGE_PREVIEW_CACHE)).toBeNull();
    expect(localStorage.getItem(LS_KEYS.AI_VIDEO_PREVIEW_CACHE)).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('language')).toBe('zh-CN');
    expect(localStorage.getItem('model-config')).toBe('image-model');
  });

  it('reports strong-confirmation risk for active or unsynced work', () => {
    mocks.activeTasks = [{}];
    mocks.runningWorkflows = [{}, {}];
    mocks.hasPendingChanges.mockReturnValue(true);

    expect(getLocalDataClearRisk()).toEqual({
      activeTaskCount: 1,
      activeWorkflowCount: 2,
      hasPendingSync: true,
      requiresStrongConfirmation: true,
    });
  });

  it('resumes cache writes when clearing fails before reload', async () => {
    mocks.clearAvatars.mockResolvedValue(false);

    await expect(clearLocalData('cache')).rejects.toThrow(
      '清理头像图片缓存失败'
    );

    expect(mocks.resumeCacheWrites).toHaveBeenCalledTimes(1);
  });

  it('clears business history by explicit keys without clearing preferences', async () => {
    const businessKeys = [
      LS_KEYS.OLD_LOCAL_DATA,
      LS_KEYS.OLD_IMAGE_HISTORY,
      LS_KEYS.OLD_VIDEO_HISTORY,
      LS_KEYS_TO_MIGRATE.PROMPT_HISTORY,
      LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY,
      LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY,
      LS_KEYS_TO_MIGRATE.BATCH_IMAGE_CACHE,
    ];
    for (const key of businessKeys) {
      localStorage.setItem(key, 'business-data');
    }
    localStorage.setItem(LS_KEYS_TO_MIGRATE.PRESET_SETTINGS, 'user-presets');
    localStorage.setItem(
      LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS,
      'hidden-prompts'
    );
    localStorage.setItem(
      LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES,
      'edited-prompts'
    );

    await clearLocalData('all');

    expect(mocks.clearAllWorkflows.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearAllTasks.mock.invocationCallOrder[0]
    );
    expect(mocks.clearConversationHistory).toHaveBeenCalledTimes(1);
    expect(mocks.clearCharacters).toHaveBeenCalledTimes(1);
    expect(mocks.clearWorkspaceContent).toHaveBeenCalledTimes(1);
    expect(mocks.clearPromptHistory).toHaveBeenCalledTimes(1);
    expect(mocks.removeKv).toHaveBeenCalledWith('music-analyzer:records');
    expect(mocks.removeKv).toHaveBeenCalledWith('video-analyzer:records');
    expect(mocks.removeKv).toHaveBeenCalledWith('mv-creator:records');
    expect(mocks.removeKv).toHaveBeenCalledWith('comic-creator:records');
    expect(mocks.removeKv).toHaveBeenCalledWith(
      LS_KEYS_TO_MIGRATE.BATCH_IMAGE_CACHE
    );
    for (const key of businessKeys) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem(LS_KEYS_TO_MIGRATE.PRESET_SETTINGS)).toBe(
      'user-presets'
    );
    expect(
      localStorage.getItem(LS_KEYS_TO_MIGRATE.PROMPT_DELETED_CONTENTS)
    ).toBe('hidden-prompts');
    expect(
      localStorage.getItem(LS_KEYS_TO_MIGRATE.PROMPT_HISTORY_OVERRIDES)
    ).toBe('edited-prompts');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(localStorage.getItem('language')).toBe('zh-CN');
    expect(localStorage.getItem('model-config')).toBe('image-model');
  });

  it('clears only allowlisted stores and preserves colocated configuration', async () => {
    await createDatabaseWithStores('aitu-assets', ['assets', 'config']);

    await clearLocalData('all');

    expect(await countStore('aitu-assets', 'assets')).toBe(0);
    expect(await countStore('aitu-assets', 'config')).toBe(1);
  });
});
