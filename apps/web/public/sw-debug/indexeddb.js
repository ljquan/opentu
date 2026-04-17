/**
 * SW Debug Panel - IndexedDB Operations
 * IndexedDB 数据库操作函数
 */

/**
 * IndexedDB 存储名称常量（与应用层 storage-keys.ts 保持一致）
 */
export const IDB_STORES = {
  // 工作区数据（文件夹、画板）
  WORKSPACE: {
    name: 'aitu-workspace',
    stores: {
      FOLDERS: 'folders',
      BOARDS: 'boards',
      STATE: 'state',
    },
  },
  // 通用键值存储（提示词等）
  KV: {
    name: 'aitu-storage',
    store: 'data',
  },
  // 素材库元数据
  ASSETS: {
    name: 'aitu-assets',
    store: 'assets',
  },
  // 统一缓存（AI 生成的媒体元数据）
  UNIFIED_CACHE: {
    name: 'drawnix-unified-cache',
    store: 'media',
  },
  // 知识库
  KNOWLEDGE_BASE: {
    name: 'aitu-knowledge-base',
    stores: {
      DIRECTORIES: 'directories',
      NOTES: 'notes',
      TAGS: 'tags',
      NOTE_TAGS: 'noteTags',
      NOTE_CONTENTS: 'noteContents',
      NOTE_IMAGES: 'noteImages',
    },
  },
};

/**
 * KV 存储中的关键 key（与应用层 LS_KEYS_TO_MIGRATE 保持一致）
 */
export const KV_KEYS = {
  PROMPT_HISTORY: 'aitu_prompt_history',
  VIDEO_PROMPT_HISTORY: 'aitu_video_prompt_history',
  IMAGE_PROMPT_HISTORY: 'aitu_image_prompt_history',
  PRESET_SETTINGS: 'aitu-prompt-preset-settings',
};

/**
 * Cache Storage 名称
 */
export const CACHE_NAMES = {
  IMAGES: 'drawnix-images',
};

/**
 * 任务队列数据库配置
 */
export const SW_TASK_QUEUE_DB = {
  name: 'sw-task-queue',
  stores: {
    TASKS: 'tasks',
  },
};

/**
 * 任务类型和状态常量（与 SW 中的枚举值保持一致，是小写）
 */
export const TaskType = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
};

export const TaskStatus = {
  COMPLETED: 'completed',
};

/**
 * 打开 IndexedDB 数据库
 */
export function openIDB(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.close();
        resolve(null);
        return;
      }
      resolve(db);
    };
  });
}

/**
 * 从 IndexedDB 读取所有数据
 */
export async function readAllFromIDB(dbName, storeName) {
  try {
    const db = await openIDB(dbName, storeName);
    if (!db) return [];
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      request.onsuccess = () => {
        db.close();
        resolve(request.result || []);
      };
    });
  } catch (error) {
    return [];
  }
}

/**
 * 从 IndexedDB 读取单条数据
 */
export async function readItemFromIDB(dbName, storeName, key) {
  const db = await openIDB(dbName, storeName);
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
  });
}

/**
 * 从 IndexedDB KV 存储读取指定 key
 */
export async function readKVItem(key) {
  const db = await openIDB(IDB_STORES.KV.name, IDB_STORES.KV.store);
  if (!db) return null;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORES.KV.store, 'readonly');
    const store = transaction.objectStore(IDB_STORES.KV.store);
    const request = store.get(key);
    
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    request.onsuccess = () => {
      db.close();
      const result = request.result;
      resolve(result?.value || null);
    };
  });
}

/**
 * 向 IndexedDB 写入单条数据（put 语义，按 key 覆盖）
 */
export async function writeToIDB(dbName, storeName, item) {
  const db = await openIDB(dbName, storeName);
  if (!db) {
    throw new Error(`Database ${dbName} or store ${storeName} not found`);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(item);
    request.onerror = () => { db.close(); reject(request.error); };
    request.onsuccess = () => { db.close(); resolve(); };
  });
}

/**
 * 向 KV 存储写入数据
 */
export async function writeKVItem(key, value) {
  const db = await openIDB(IDB_STORES.KV.name, IDB_STORES.KV.store);
  if (!db) {
    throw new Error('KV store not found');
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORES.KV.store, 'readwrite');
    const store = tx.objectStore(IDB_STORES.KV.store);
    const request = store.put({ key, value });
    request.onerror = () => { db.close(); reject(request.error); };
    request.onsuccess = () => { db.close(); resolve(); };
  });
}

/**
 * 批量写入 IndexedDB（单事务内完成）
 */
export async function writeBatchToIDB(dbName, storeName, items) {
  if (!items || items.length === 0) return;
  const db = await openIDB(dbName, storeName);
  if (!db) {
    throw new Error(`Database ${dbName} or store ${storeName} not found`);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) {
      store.put(item);
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
