import {
  IDB_DATABASES,
  LS_KEYS,
  LS_KEYS_TO_MIGRATE,
} from '../constants/storage-keys';
import { characterAvatarCacheService } from './character-avatar-cache-service';
import { chatStorageService } from './chat-storage-service';
import { syncEngine } from './github-sync/sync-engine';
import { kvStorageService } from './kv-storage-service';
import { taskStorageWriter } from './media-executor/task-storage-writer';
import { clearGenerationPromptHistory } from './prompt-storage-service';
import { taskQueueService } from './task-queue-service';
import { unifiedCacheService } from './unified-cache-service';
import { workflowCompletionService } from './workflow-completion-service';
import { workflowSubmissionService } from './workflow-submission-service';
import { workspaceStorageService } from './workspace-storage-service';
import { workflowStorageWriter } from './workflow-engine/workflow-storage-writer';

export type LocalDataClearMode = 'cache' | 'all';

export interface LocalDataClearRisk {
  activeTaskCount: number;
  activeWorkflowCount: number;
  hasPendingSync: boolean;
  requiresStrongConfirmation: boolean;
}

const LEGACY_TASK_STORES = [
  'tasks',
  'workflows',
  'chat-workflows',
  'pending-tool-requests',
  'pending-dom-operations',
  'task-step-mappings',
  'pending-canvas-operations',
] as const;

const WORKFLOW_RECORD_KEYS = [
  'music-analyzer:records',
  'video-analyzer:records',
  'mv-creator:records',
  'comic-creator:records',
  'aitu:model-benchmark:sessions',
] as const;

const LEGACY_BUSINESS_LOCAL_STORAGE_KEYS = [
  LS_KEYS.OLD_LOCAL_DATA,
  LS_KEYS.OLD_IMAGE_HISTORY,
  LS_KEYS.OLD_VIDEO_HISTORY,
  LS_KEYS_TO_MIGRATE.PROMPT_HISTORY,
  LS_KEYS_TO_MIGRATE.VIDEO_PROMPT_HISTORY,
  LS_KEYS_TO_MIGRATE.IMAGE_PROMPT_HISTORY,
  LS_KEYS_TO_MIGRATE.BATCH_IMAGE_CACHE,
] as const;

const AUDIO_PLAYLIST_STORES = [
  'audio_playlists',
  'audio_playlist_items',
] as const;

const KNOWLEDGE_BASE_STORES = Object.values(
  IDB_DATABASES.KNOWLEDGE_BASE.STORES
);

type IndexedDBFactoryWithDatabaseList = IDBFactory & {
  databases?: () => Promise<Array<{ name?: string }>>;
};

async function openExistingDatabase(
  databaseName: string
): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }

  const factory = indexedDB as IndexedDBFactoryWithDatabaseList;
  if (factory.databases) {
    try {
      const databases = await factory.databases();
      if (!databases.some((database) => database.name === databaseName)) {
        return null;
      }
    } catch {
      // 无法枚举时继续使用兼容的 open + upgrade abort 路径。
    }
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    let createdEmptyDatabase = false;

    request.onupgradeneeded = () => {
      createdEmptyDatabase = true;
      request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (createdEmptyDatabase) {
        resolve(null);
        return;
      }
      reject(request.error || new Error(`无法打开本地数据库: ${databaseName}`));
    };
  });
}

async function clearExistingStores(
  databaseName: string,
  storeNames: readonly string[]
): Promise<void> {
  const db = await openExistingDatabase(databaseName);
  if (!db) {
    return;
  }

  try {
    const existingStores = storeNames.filter((storeName) =>
      db.objectStoreNames.contains(storeName)
    );
    if (existingStores.length === 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(existingStores, 'readwrite');
      for (const storeName of existingStores) {
        transaction.objectStore(storeName).clear();
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error || new Error(`清理 ${databaseName} 失败`));
      transaction.onabort = () =>
        reject(transaction.error || new Error(`清理 ${databaseName} 已中止`));
    });
  } finally {
    db.close();
  }
}

async function clearMediaCache(): Promise<void> {
  await unifiedCacheService.clearAllCache({ keepWritesPaused: true });
  const avatarCacheCleared = await characterAvatarCacheService.clearAll();
  if (!avatarCacheCleared) {
    throw new Error('清理头像图片缓存失败');
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LS_KEYS.AI_IMAGE_PREVIEW_CACHE);
    localStorage.removeItem(LS_KEYS.AI_VIDEO_PREVIEW_CACHE);
  }
}

async function clearWorkflowRecordHistory(): Promise<void> {
  for (const key of WORKFLOW_RECORD_KEYS) {
    await kvStorageService.remove(key);
  }
  await kvStorageService.remove(LS_KEYS_TO_MIGRATE.BATCH_IMAGE_CACHE);
}

function clearLegacyBusinessLocalStorage(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  for (const key of LEGACY_BUSINESS_LOCAL_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

async function clearCharacterRecords(): Promise<void> {
  const { characterStorageService } = await import(
    './character-storage-service'
  );
  await characterStorageService.clearAll();
}

export function getLocalDataClearRisk(): LocalDataClearRisk {
  const activeTaskCount = taskQueueService.getActiveTasks().length;
  const activeWorkflowCount =
    workflowSubmissionService.getRunningWorkflows().length;
  let hasPendingSync = false;

  try {
    hasPendingSync = syncEngine.hasPendingChanges();
  } catch {
    // 同步功能未初始化时不阻塞清理，活动任务仍会单独提示。
  }

  return {
    activeTaskCount,
    activeWorkflowCount,
    hasPendingSync,
    requiresStrongConfirmation:
      hasPendingSync || activeTaskCount > 0 || activeWorkflowCount > 0,
  };
}

async function clearAllLocalBusinessData(): Promise<void> {
  await workflowSubmissionService.clearAllWorkflows();
  await taskQueueService.clearAllTasks();
  workflowCompletionService.clear();

  await clearMediaCache();
  await clearExistingStores(IDB_DATABASES.TASK_QUEUE.NAME, ['tasks']);
  await clearExistingStores(
    IDB_DATABASES.SW_TASK_QUEUE.NAME,
    LEGACY_TASK_STORES
  );
  await clearExistingStores(IDB_DATABASES.ASSETS.NAME, ['assets']);
  await clearExistingStores('aitu-audio-playlists', AUDIO_PLAYLIST_STORES);
  await clearCharacterRecords();
  await clearExistingStores(
    IDB_DATABASES.KNOWLEDGE_BASE.NAME,
    KNOWLEDGE_BASE_STORES
  );
  await clearExistingStores('kb-chat-storage', ['sessions']);
  await chatStorageService.clearConversationHistory();
  await clearGenerationPromptHistory();
  await clearWorkflowRecordHistory();
  clearLegacyBusinessLocalStorage();
  await workspaceStorageService.clearContent();
}

export async function clearLocalData(mode: LocalDataClearMode): Promise<void> {
  try {
    if (mode === 'cache') {
      await clearMediaCache();
      return;
    }
    await clearAllLocalBusinessData();
  } catch (error) {
    unifiedCacheService.resumeCacheWrites();
    taskStorageWriter.resumeWrites();
    workflowStorageWriter.resumeWrites();
    throw error;
  }
}

export const localDataClearService = {
  getRisk: getLocalDataClearRisk,
  clear: clearLocalData,
};
