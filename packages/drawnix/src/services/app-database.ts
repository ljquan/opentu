/**
 * App Database (Main Thread)
 *
 * 主线程专用的 IndexedDB 数据库 "aitu-app"。
 * 不再与 SW 共享 "sw-task-queue" 数据库，消除 IDB 并发竞争。
 *
 * Stores:
 * - tasks: 任务状态和结果
 * - workflows: 工作流状态
 * - config: API 配置
 */

const DB_NAME = 'aitu-app';
const DB_VERSION = 1;

// Store 名称常量
export const APP_DB_STORES = {
  TASKS: 'tasks',
  WORKFLOWS: 'workflows',
  CONFIG: 'config',
} as const;

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
let migrationDone = false;

/**
 * 获取主线程专用数据库连接
 */
export async function getAppDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const timeout = setTimeout(() => {
      dbPromise = null;
      reject(new Error('[AppDB] open timeout'));
    }, 5000);

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      clearTimeout(timeout);
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      clearTimeout(timeout);
      dbInstance = request.result;

      // 监听数据库关闭事件，清理缓存
      dbInstance.onclose = () => {
        dbInstance = null;
        dbPromise = null;
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      // tasks store
      if (!db.objectStoreNames.contains(APP_DB_STORES.TASKS)) {
        const tasksStore = db.createObjectStore(APP_DB_STORES.TASKS, {
          keyPath: 'id',
        });
        tasksStore.createIndex('status', 'status', { unique: false });
        tasksStore.createIndex('type', 'type', { unique: false });
        tasksStore.createIndex('createdAt', 'createdAt', { unique: false });
        tasksStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // workflows store
      if (!db.objectStoreNames.contains(APP_DB_STORES.WORKFLOWS)) {
        const workflowsStore = db.createObjectStore(APP_DB_STORES.WORKFLOWS, {
          keyPath: 'id',
        });
        workflowsStore.createIndex('status', 'status', { unique: false });
        workflowsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // config store
      if (!db.objectStoreNames.contains(APP_DB_STORES.CONFIG)) {
        db.createObjectStore(APP_DB_STORES.CONFIG, { keyPath: 'key' });
      }
    };
  });

  return dbPromise;
}

/**
 * 从旧数据库 "sw-task-queue" 迁移数据到 "aitu-app"（一次性）
 * 在应用启动时调用
 */
export async function migrateFromLegacyDB(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;

  try {
    const newDb = await getAppDB();

    // 检查新数据库是否已有数据（避免重复迁移）
    const hasData = await new Promise<boolean>((resolve) => {
      try {
        const tx = newDb.transaction(APP_DB_STORES.TASKS, 'readonly');
        const countReq = tx.objectStore(APP_DB_STORES.TASKS).count();
        countReq.onsuccess = () => resolve(countReq.result > 0);
        countReq.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });

    if (hasData) {
      return;
    }

    // 尝试打开旧数据库
    const oldDb = await new Promise<IDBDatabase | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 3000);
      try {
        const request = indexedDB.open('sw-task-queue');
        request.onerror = () => {
          clearTimeout(timeout);
          resolve(null);
        };
        request.onsuccess = () => {
          clearTimeout(timeout);
          resolve(request.result);
        };
        request.onblocked = () => {
          clearTimeout(timeout);
          resolve(null);
        };
        request.onupgradeneeded = () => {
          // 旧数据库不存在（正在创建），关闭它
          clearTimeout(timeout);
          request.transaction?.abort();
          resolve(null);
        };
      } catch {
        clearTimeout(timeout);
        resolve(null);
      }
    });

    if (!oldDb) {
      return;
    }

    // 迁移 tasks
    if (oldDb.objectStoreNames.contains('tasks')) {
      await migrateStore(oldDb, newDb, 'tasks', APP_DB_STORES.TASKS);
    }

    // 迁移 workflows
    if (oldDb.objectStoreNames.contains('workflows')) {
      await migrateStore(oldDb, newDb, 'workflows', APP_DB_STORES.WORKFLOWS);
    }

    // 迁移 config
    if (oldDb.objectStoreNames.contains('config')) {
      await migrateStore(oldDb, newDb, 'config', APP_DB_STORES.CONFIG);
    }

    oldDb.close();
  } catch (error) {
    console.warn('[AppDB] 数据迁移失败（非致命）:', error);
  }
}

/**
 * 迁移单个 store 的数据
 */
async function migrateStore(
  oldDb: IDBDatabase,
  newDb: IDBDatabase,
  oldStoreName: string,
  newStoreName: string
): Promise<void> {
  try {
    // 读取旧数据
    const records = await new Promise<any[]>((resolve, reject) => {
      const tx = oldDb.transaction(oldStoreName, 'readonly');
      const request = tx.objectStore(oldStoreName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (records.length === 0) return;

    // 写入新数据库
    const tx = newDb.transaction(newStoreName, 'readwrite');
    const store = tx.objectStore(newStoreName);
    for (const record of records) {
      store.put(record);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn(`[AppDB] 迁移 ${oldStoreName} 失败:`, error);
  }
}

/**
 * 关闭数据库连接
 */
export function closeAppDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPromise = null;
  }
}

/** 导出数据库名称常量 */
export { DB_NAME as APP_DB_NAME };
