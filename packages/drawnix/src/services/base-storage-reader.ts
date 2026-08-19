/**
 * Base Storage Reader
 * 
 * 主线程直接读取 IndexedDB 的基类，提供通用的数据库连接和缓存管理功能。
 * 避免 task-storage-reader 和 workflow-storage-reader 之间的代码重复。
 * 
 * 注意：这些模块只负责读取操作，写操作仍然通过 SW 进行以确保数据一致性
 */

// 默认缓存过期时间（2分钟）
const DEFAULT_CACHE_TTL = 2 * 60 * 1000;

/**
 * 打开 IndexedDB 连接
 * @param dbName 数据库名称
 * @param logPrefix 日志前缀
 */
export function openIndexedDB(dbName: string, logPrefix: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    
    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    // 主线程不创建 store，只有 SW 端会创建
    request.onupgradeneeded = () => {
      console.warn(`[${logPrefix}] Database upgrade triggered from main thread, skipping store creation`);
    };
  });
}

/**
 * 通用缓存配置
 */
export interface CacheConfig {
  /** 缓存过期时间（毫秒） */
  ttl: number;
}

/**
 * 基础存储读取器
 * 提供数据库连接管理、可用性检查和缓存管理的通用实现
 */
export abstract class BaseStorageReader<TCache> {
  protected db: IDBDatabase | null = null;
  protected dbPromise: Promise<IDBDatabase> | null = null;
  protected availabilityChecked = false;
  protected isAvailableResult = false;
  protected cache: TCache | null = null;
  protected cacheTimestamp = 0;
  protected cacheTTL: number;

  protected abstract readonly dbName: string;
  protected abstract readonly storeName: string;
  protected abstract readonly logPrefix: string;

  constructor(config?: Partial<CacheConfig>) {
    this.cacheTTL = config?.ttl ?? DEFAULT_CACHE_TTL;
  }

  /**
   * 获取数据库连接（带缓存）
   */
  protected async getDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = openIndexedDB(this.dbName, this.logPrefix).then(db => {
      this.db = db;
      
      // 监听数据库关闭事件
      db.onclose = () => {
        this.db = null;
        this.dbPromise = null;
        this.availabilityChecked = false;
      };
      
      return db;
    }).catch(error => {
      this.dbPromise = null;
      throw error;
    });

    return this.dbPromise;
  }

  /**
   * 检查数据库和 store 是否存在（带缓存）
   * 注意：仅缓存 true 结果。false 结果不缓存，允许后续重新检查
   * （数据库 store 可能在首次检查后被其他模块创建）
   */
  async isAvailable(): Promise<boolean> {
    // 仅缓存 true 结果，避免永久缓存 false 导致后续读取全部失败
    if (this.availabilityChecked && this.isAvailableResult) {
      return true;
    }

    try {
      const db = await this.getDB();
      const hasStore = db.objectStoreNames.contains(this.storeName);
      
      // 缓存结果（false 不标记为已检查，允许后续重试）
      if (hasStore) {
        this.availabilityChecked = true;
        this.isAvailableResult = true;
      }
      return hasStore;
    } catch (error) {
      console.warn(`[${this.logPrefix}] isAvailable failed:`, error);
      return false;
    }
  }

  /**
   * 检查缓存是否有效
   */
  protected isCacheValid(): boolean {
    return this.cache !== null && Date.now() - this.cacheTimestamp < this.cacheTTL;
  }

  /**
   * 清除缓存（数据变更时调用）
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
    // 同时重置可用性检查，允许重新检测 store 是否存在
    this.availabilityChecked = false;
    this.isAvailableResult = false;
  }

  /**
   * 更新缓存时间戳
   */
  protected updateCacheTimestamp(): void {
    this.cacheTimestamp = Date.now();
  }

  /**
   * 执行 IndexedDB 事务并获取所有记录
   * @param storeName store 名称
   * @param indexName 可选的索引名称
   * @param direction 游标方向
   */
  protected async getAllFromStore<T>(
    storeName: string,
    indexName?: string,
    direction: IDBCursorDirection = 'prev'
  ): Promise<T[]> {
    const db = await this.getDB();
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const source = indexName ? store.index(indexName) : store;

    return new Promise((resolve, reject) => {
      const results: T[] = [];
      const request = source.openCursor(null, direction);

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value as T);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 通过 ID 获取单条记录
   */
  protected async getById<T>(storeName: string, id: string): Promise<T | null> {
    if (!id) {
      return null;
    }

    const db = await this.getDB();
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }
}
