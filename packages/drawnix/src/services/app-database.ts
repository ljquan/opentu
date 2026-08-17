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

import { migrateLegacyIndexedDB } from './indexeddb-namespace-migration';
import {
  getActiveStorageNamespace,
  getNamespacedDatabaseName,
} from './storage-context';

const LEGACY_DB_NAME = 'aitu-app';
const LEGACY_SW_DB_NAME = 'sw-task-queue';
const DB_VERSION = 1;

// Store 名称常量
export const APP_DB_STORES = {
  TASKS: 'tasks',
  WORKFLOWS: 'workflows',
  CONFIG: 'config',
} as const;

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;
const migratedNamespaces = new Set<string>();

export function getAppDBName(): string {
  return getNamespacedDatabaseName(LEGACY_DB_NAME);
}

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

    const request = indexedDB.open(getAppDBName(), DB_VERSION);

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
  const namespace = getActiveStorageNamespace();
  if (migratedNamespaces.has(namespace.key)) return;

  try {
    await getAppDB();
    const targetDatabaseName = getAppDBName();
    const stores = Object.values(APP_DB_STORES);
    await migrateLegacyIndexedDB({
      sourceDatabaseName: LEGACY_DB_NAME,
      targetDatabaseName,
      stores,
    });

    // The historical SW database is an anonymous-only source. Credential
    // identities are deliberately never sent to or derived inside the SW.
    if (namespace.kind === 'anonymous') {
      await migrateLegacyIndexedDB({
        sourceDatabaseName: LEGACY_SW_DB_NAME,
        targetDatabaseName,
        stores,
      });
    }
    migratedNamespaces.add(namespace.key);
  } catch (error) {
    console.warn('[AppDB] 数据迁移失败（非致命）:', error);
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
/** @deprecated Use getAppDBName() when the value may outlive an account switch. */
export const APP_DB_NAME = getAppDBName();
