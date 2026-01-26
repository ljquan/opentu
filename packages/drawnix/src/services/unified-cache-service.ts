/**
 * Unified Cache Service
 *
 * 统一缓存管理服务，协调 Service Worker Cache API 和 IndexedDB
 * 负责元数据管理、智能图片传递、缓存满处理等功能
 */

import { getDataURL } from '../data/blob';

// ==================== 常量定义 ====================

/** 新的统一数据库名称 */
export const UNIFIED_DB_NAME = 'drawnix-unified-cache';
export const UNIFIED_DB_VERSION = 1;
export const UNIFIED_STORE_NAME = 'media';

/** 旧数据库名称（用于迁移） */
const LEGACY_DB_NAMES = {
  MEDIA_CACHE: 'aitu-media-cache',
  URL_CACHE: 'aitu-url-cache',
} as const;

/** Service Worker 图片缓存名称 */
const IMAGE_CACHE_NAME = 'drawnix-images';

/** 缓存策略常量 */
export const CACHE_CONSTANTS = {
  /** 默认最大年龄（1天），超过则使用 base64 */
  DEFAULT_MAX_AGE: 24 * 60 * 60 * 1000,
  /** 图片压缩默认质量 */
  DEFAULT_QUALITY: 0.85,
  /** 最大图片尺寸（超过则压缩） */
  MAX_IMAGE_SIZE: 2 * 1024 * 1024, // 2MB
  /** 缓存满警告阈值 */
  QUOTA_WARNING_THRESHOLD: 0.9, // 90%
} as const;

/** 缓存状态（兼容旧 API） */
export type CacheStatus = 'none' | 'caching' | 'cached' | 'error';

/** 缓存进度回调 */
export type CacheProgressCallback = (progress: number) => void;

// ==================== 类型定义 ====================

/** 缓存媒体类型 */
export type CacheMediaType = 'image' | 'video';

/** 缓存条目元数据 */
export interface CachedMedia {
  /** URL（主键） */
  url: string;
  /** 媒体类型 */
  type: CacheMediaType;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 缓存时间戳 */
  cachedAt: number;
  /** 最后使用时间戳 */
  lastUsed: number;
  /** 任务元数据 */
  metadata: {
    taskId?: string;
    prompt?: string;
    model?: string;
    params?: any;
    [key: string]: any;
  };
}

/** 缓存信息 */
export interface CacheInfo {
  isCached: boolean;
  cachedAt?: number;
  age?: number; // 毫秒
  size?: number;
  metadata?: CachedMedia['metadata'];
}

/** 存储使用情况 */
export interface StorageUsage {
  usage: number;
  quota: number;
  percentage: number;
}

/** 图片数据类型 */
export type ImageDataType = 'url' | 'base64';

/** 图片数据结果 */
export interface ImageData {
  type: ImageDataType;
  value: string;
}

/** getImageForAI 选项 */
export interface GetImageForAIOptions {
  /** 最大年龄（毫秒），超过则使用 base64，默认 24 小时 */
  maxAge?: number;
  /** 最大文件大小（字节），超过则压缩 */
  maxSize?: number;
  /** 压缩质量 0-1 */
  quality?: number;
}

/** Service Worker 消息类型 */
export type SWMessageType =
  | 'IMAGE_CACHED'
  | 'CACHE_DELETED'
  | 'QUOTA_WARNING'
  | 'DELETE_CACHE'
  | 'DELETE_CACHE_BATCH'
  | 'CLEAR_ALL_CACHE';

/** SW → 主线程消息 */
export interface SWToMainMessage {
  type: 'IMAGE_CACHED' | 'CACHE_DELETED' | 'QUOTA_WARNING';
  url?: string;
  size?: number;
  mimeType?: string;
  timestamp?: number;
  usage?: number;
  quota?: number;
}

/** 主线程 → SW 消息 */
export interface MainToSWMessage {
  type: 'DELETE_CACHE' | 'DELETE_CACHE_BATCH' | 'CLEAR_ALL_CACHE';
  url?: string;
  urls?: string[];
}

// ==================== 统一缓存服务类 ====================

/**
 * 统一缓存管理服务
 * 单例模式，协调 Service Worker 和 IndexedDB
 */
class UnifiedCacheService {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private migrationPromise: Promise<void> | null = null;
  private listeners: Set<() => void> = new Set();
  private quotaExceededListeners: Set<() => void> = new Set();
  private cachedUrls: Set<string> = new Set();

  constructor() {
    // 初始化数据库
    this.initDB().then(async () => {
      // 刷新缓存状态
      await this.refreshCacheState();
      // 触发数据迁移
      this.migrateFromLegacyDBs();
    });

    // 监听 Service Worker 消息
    this.setupSWMessageListener();
  }

  // ==================== IndexedDB 操作 ====================

  /**
   * 初始化 IndexedDB
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(UNIFIED_DB_NAME, UNIFIED_DB_VERSION);

      request.onerror = () => {
        console.error('[UnifiedCache] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        // console.log('[UnifiedCache] Database opened successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(UNIFIED_STORE_NAME)) {
          const store = db.createObjectStore(UNIFIED_STORE_NAME, { keyPath: 'url' });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
          store.createIndex('lastUsed', 'lastUsed', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          // console.log('[UnifiedCache] Object store created with indexes');
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * 刷新内存中的缓存状态
   */
  private async refreshCacheState(): Promise<void> {
    try {
      const urls = await this.getAllCachedUrls();
      this.cachedUrls = new Set(urls);
      this.notifyListeners();
    } catch (error) {
      console.error('[UnifiedCache] Failed to refresh cache state:', error);
    }
  }

  /**
   * 获取单个缓存条目
   */
  private async getItem(url: string): Promise<CachedMedia | undefined> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(UNIFIED_STORE_NAME, 'readonly');
      const store = transaction.objectStore(UNIFIED_STORE_NAME);
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 存储缓存条目
   */
  private async putItem(item: CachedMedia): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(UNIFIED_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(UNIFIED_STORE_NAME);
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 删除缓存条目
   */
  private async deleteItem(url: string): Promise<void> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(UNIFIED_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(UNIFIED_STORE_NAME);
      const request = store.delete(url);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 更新最后使用时间
   */
  private async touch(url: string): Promise<void> {
    try {
      const item = await this.getItem(url);
      if (item) {
        item.lastUsed = Date.now();
        await this.putItem(item);
      }
    } catch (error) {
      console.warn('[UnifiedCache] Failed to touch item:', error);
    }
  }

  // ==================== Service Worker 通信 ====================

  /**
   * 设置 SW 消息监听器
   */
  private setupSWMessageListener(): void {
    if (!navigator.serviceWorker) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      const message = event.data as SWToMainMessage;
      this.handleSWMessage(message);
    });
  }

  /**
   * 处理来自 SW 的消息
   */
  private async handleSWMessage(message: SWToMainMessage): Promise<void> {
    switch (message.type) {
      case 'IMAGE_CACHED':
        if (message.url) {
          await this.handleImageCachedNotification(
            message.url,
            message.size || 0,
            message.mimeType || 'image/png'
          );
        }
        break;

      case 'CACHE_DELETED':
        if (message.url) {
          this.cachedUrls.delete(message.url);
          this.notifyListeners();
        }
        break;

      case 'QUOTA_WARNING':
        console.warn('[UnifiedCache] Storage quota warning from SW:', {
          usage: message.usage,
          quota: message.quota,
        });
        this.notifyQuotaExceededListeners();
        break;
    }
  }

  /**
   * 处理图片已缓存通知
   */
  private async handleImageCachedNotification(
    url: string,
    size: number,
    mimeType: string
  ): Promise<void> {
    try {
      const existing = await this.getItem(url);
      const now = Date.now();

      const item: CachedMedia = {
        url,
        type: 'image',
        mimeType,
        size,
        cachedAt: existing?.cachedAt || now,
        lastUsed: now,
        metadata: existing?.metadata || {},
      };

      await this.putItem(item);
      this.cachedUrls.add(url);
      this.notifyListeners();

      // console.log('[UnifiedCache] Image metadata updated:', url);
    } catch (error) {
      console.error('[UnifiedCache] Failed to handle IMAGE_CACHED:', error);
    }
  }

  /**
   * 向 Service Worker 发送消息
   */
  private async sendMessageToSW(message: MainToSWMessage): Promise<void> {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
      console.warn('[UnifiedCache] No active service worker to send message to');
      return;
    }

    navigator.serviceWorker.controller.postMessage(message);
  }

  // ==================== 公共 API ====================

  /**
   * 注册图片元数据（任务完成时调用）
   */
  async registerImageMetadata(
    url: string,
    metadata: {
      taskId: string;
      prompt?: string;
      model?: string;
      params?: any;
    }
  ): Promise<void> {
    try {
      const existing = await this.getItem(url);
      const now = Date.now();

      const item: CachedMedia = {
        url,
        type: 'image',
        mimeType: existing?.mimeType || 'image/png',
        size: existing?.size || 0,
        cachedAt: existing?.cachedAt || now,
        lastUsed: now,
        metadata: {
          ...existing?.metadata,
          ...metadata,
        },
      };

      await this.putItem(item);
      this.cachedUrls.add(url);
      this.notifyListeners();

      // console.log('[UnifiedCache] Image metadata registered:', { url, taskId: metadata.taskId });
    } catch (error) {
      this.handleQuotaError(error);
      console.error('[UnifiedCache] Failed to register metadata:', error);
    }
  }

  /**
   * 获取适合传给 AI 的图片数据
   * 自动决策返回 URL 或 base64
   */
  async getImageForAI(
    url: string,
    options: GetImageForAIOptions = {}
  ): Promise<ImageData> {
    const {
      maxAge = CACHE_CONSTANTS.DEFAULT_MAX_AGE,
      maxSize = CACHE_CONSTANTS.MAX_IMAGE_SIZE,
      quality = CACHE_CONSTANTS.DEFAULT_QUALITY,
    } = options;

    try {
      // 检查是否为虚拟 URL（素材库本地 URL）
      // 虚拟 URL 必须转换为 base64，因为大模型无法访问本地虚拟路径
      const isVirtualUrl = url.startsWith('/asset-library/') || url.startsWith('/__aitu_cache__/');

      // 1. 查询缓存信息
      const info = await this.getCacheInfo(url);

      // 2. 如果未缓存或年龄未知
      if (!info.isCached || !info.cachedAt) {
        // 虚拟 URL 必须从缓存获取，如果没有缓存则尝试 fetch
        if (isVirtualUrl) {
          // console.log('[UnifiedCache] Virtual URL not in metadata, trying to fetch from Cache API');
          // 继续执行下面的 fetch 逻辑
        } else {
          // console.log('[UnifiedCache] Image not cached or age unknown, using URL');
          return { type: 'url', value: url };
        }
      } else {
        // 3. 计算年龄
        const age = Date.now() - info.cachedAt;

        // 4. 如果缓存时间在阈值内，且不是虚拟 URL，返回 URL
        if (age < maxAge && !isVirtualUrl) {
          // console.log(`[UnifiedCache] Image is fresh (age: ${Math.round(age / 1000 / 60)}min), using URL`);
          // 更新最后使用时间
          this.touch(url);
          return { type: 'url', value: url };
        }

        // 5. 缓存时间超过阈值或是虚拟 URL，需要转换为 base64
        if (isVirtualUrl) {
          // console.log(`[UnifiedCache] Virtual URL detected, converting to base64`);
        } else {
          // console.log(`[UnifiedCache] Image is old (age: ${Math.round(age / 1000 / 60 / 60)}h), converting to base64`);
        }
      }

      // 6. 从 Cache API 获取图片（通过 fetch）
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      let blob = await response.blob();

      // 7. 如果图片过大，进行压缩
      if (blob.size > maxSize && blob.type.startsWith('image/')) {
        // console.log(`[UnifiedCache] Image too large (${(blob.size / 1024 / 1024).toFixed(2)}MB), compressing...`);
        blob = await this.compressImage(blob, quality);
        // console.log(`[UnifiedCache] Compressed to ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
      }

      // 8. 转换为 base64
      const base64 = await getDataURL(blob);

      return { type: 'base64', value: base64 };
    } catch (error) {
      console.error('[UnifiedCache] Failed to get image for AI:', error);
      // 降级：返回原始 URL
      return { type: 'url', value: url };
    }
  }

  /**
   * 压缩图片
   */
  private async compressImage(blob: Blob, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (compressedBlob) => {
            if (compressedBlob) {
              resolve(compressedBlob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(blob);
    });
  }

  /**
   * 获取缓存信息
   */
  async getCacheInfo(url: string): Promise<CacheInfo> {
    try {
      // 1. 检查 IndexedDB 中是否有元数据
      const item = await this.getItem(url);
      if (!item) {
        return { isCached: false };
      }

      // 2. 检查 Cache API 中是否有实际图片文件
      let isInCacheAPI = false;
      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(IMAGE_CACHE_NAME);

          // 尝试精确匹配
          let response = await cache.match(url);

          // 如果精确匹配失败，尝试忽略查询参数匹配
          if (!response) {
            response = await cache.match(url, { ignoreSearch: true });
          }

          isInCacheAPI = !!response;

          // console.log('[UnifiedCache] Cache API check:', {
          //   url: url.substring(0, 80) + '...',
          //   found: isInCacheAPI,
          //   cacheName: IMAGE_CACHE_NAME
          // });
        } catch (error) {
          console.warn('[UnifiedCache] Failed to check Cache API:', error);
          // Cache API 检查失败，降级为只检查 IndexedDB
          isInCacheAPI = true;
        }
      } else {
        // 浏览器不支持 Cache API（不太可能，但兼容处理）
        isInCacheAPI = true;
      }

      // 3. 只有在 IndexedDB 和 Cache API 都有时，才返回 isCached: true
      if (!isInCacheAPI) {
        // IndexedDB 有记录但 Cache API 没有，清理 IndexedDB 记录
        // console.log('[UnifiedCache] Found orphaned metadata, cleaning up:', url);
        await this.deleteItem(url);
        this.cachedUrls.delete(url);
        return { isCached: false };
      }

      const age = Date.now() - item.cachedAt;

      return {
        isCached: true,
        cachedAt: item.cachedAt,
        age,
        size: item.size,
        metadata: item.metadata,
      };
    } catch (error) {
      console.error('[UnifiedCache] Failed to get cache info:', error);
      return { isCached: false };
    }
  }

  /**
   * 手动缓存图片
   */
  async cacheImage(url: string, metadata?: any): Promise<boolean> {
    try {
      // 触发缓存（通过 fetch）
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();

      // 注册元数据
      const existing = await this.getItem(url);
      const now = Date.now();

      const item: CachedMedia = {
        url,
        type: 'image',
        mimeType: blob.type || 'image/png',
        size: blob.size,
        cachedAt: existing?.cachedAt || now,
        lastUsed: now,
        metadata: {
          ...existing?.metadata,
          ...metadata,
        },
      };

      await this.putItem(item);
      this.cachedUrls.add(url);
      this.notifyListeners();

      // console.log('[UnifiedCache] Image cached manually:', url);
      return true;
    } catch (error) {
      this.handleQuotaError(error);
      console.error('[UnifiedCache] Failed to cache image:', error);
      return false;
    }
  }

  /**
   * 删除缓存
   */
  async deleteCache(url: string): Promise<void> {
    try {
      // 1. 从 IndexedDB 删除
      await this.deleteItem(url);
      this.cachedUrls.delete(url);

      // 2. 通知 SW 删除 Cache API 中的条目
      await this.sendMessageToSW({ type: 'DELETE_CACHE', url });

      this.notifyListeners();
      // console.log('[UnifiedCache] Cache deleted:', url);
    } catch (error) {
      console.error('[UnifiedCache] Failed to delete cache:', error);
      throw error;
    }
  }

  /**
   * 批量删除缓存
   */
  async deleteCacheBatch(urls: string[]): Promise<number> {
    let deletedCount = 0;

    try {
      const db = await this.initDB();
      const transaction = db.transaction(UNIFIED_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(UNIFIED_STORE_NAME);

      for (const url of urls) {
        try {
          store.delete(url);
          this.cachedUrls.delete(url);
          deletedCount++;
        } catch (error) {
          console.warn('[UnifiedCache] Failed to delete item in batch:', url, error);
        }
      }

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });

      // 通知 SW 批量删除
      await this.sendMessageToSW({ type: 'DELETE_CACHE_BATCH', urls });

      this.notifyListeners();
      // console.log(`[UnifiedCache] Batch deleted ${deletedCount} caches`);
    } catch (error) {
      console.error('[UnifiedCache] Failed to batch delete caches:', error);
    }

    return deletedCount;
  }

  /**
   * 获取所有缓存URL
   */
  async getAllCachedUrls(): Promise<string[]> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(UNIFIED_STORE_NAME, 'readonly');
        const store = transaction.objectStore(UNIFIED_STORE_NAME);
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result as string[]);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('[UnifiedCache] Failed to get all cached URLs:', error);
      return [];
    }
  }

  /**
   * 获取所有缓存项元数据
   */
  async getAllCacheMetadata(): Promise<CachedMedia[]> {
    try {
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(UNIFIED_STORE_NAME, 'readonly');
        const store = transaction.objectStore(UNIFIED_STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
          const items = request.result as CachedMedia[];
          // 按 lastUsed 降序排序
          items.sort((a, b) => b.lastUsed - a.lastUsed);
          resolve(items);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('[UnifiedCache] Failed to get all cache metadata:', error);
      return [];
    }
  }

  /**
   * 获取存储使用情况
   */
  async getStorageUsage(): Promise<StorageUsage> {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        return {
          usage,
          quota,
          percentage: quota > 0 ? (usage / quota) * 100 : 0,
        };
      } catch (error) {
        console.error('[UnifiedCache] Failed to get storage estimate:', error);
      }
    }
    return { usage: 0, quota: 0, percentage: 0 };
  }

  /**
   * 清空所有缓存
   */
  async clearAllCache(): Promise<void> {
    try {
      const db = await this.initDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(UNIFIED_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(UNIFIED_STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      this.cachedUrls.clear();
      await this.sendMessageToSW({ type: 'CLEAR_ALL_CACHE' });
      this.notifyListeners();

      // console.log('[UnifiedCache] All cache cleared');
    } catch (error) {
      console.error('[UnifiedCache] Failed to clear all cache:', error);
      throw error;
    }
  }

  /**
   * 检查 URL 是否已缓存
   */
  async isCached(url: string): Promise<boolean> {
    if (this.cachedUrls.has(url)) {
      return true;
    }
    const item = await this.getItem(url);
    return !!item;
  }

  /**
   * 获取所有缓存的媒体元数据（从 IndexedDB）
   * 用于素材库展示
   */
  async getAllCachedMedia(): Promise<CachedMedia[]> {
    const db = await this.initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(UNIFIED_STORE_NAME, 'readonly');
      const store = transaction.objectStore(UNIFIED_STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 更新缓存媒体的元数据（如重命名）
   */
  async updateCachedMedia(url: string, updates: Partial<Pick<CachedMedia, 'metadata'>>): Promise<boolean> {
    try {
      const item = await this.getItem(url);
      if (!item) return false;
      
      if (updates.metadata) {
        item.metadata = { ...item.metadata, ...updates.metadata };
      }
      item.lastUsed = Date.now();
      
      await this.putItem(item);
      this.notifyListeners();
      return true;
    } catch (error) {
      console.error('[UnifiedCache] Failed to update cached media:', error);
      return false;
    }
  }

  /**
   * 创建缓存媒体元数据（用于同步 Cache Storage 中存在但 IndexedDB 中没有的条目）
   */
  async createCachedMediaMetadata(
    url: string,
    type: CacheMediaType,
    mimeType: string,
    size: number,
    cachedAt: number,
    metadata?: { name?: string; taskId?: string }
  ): Promise<void> {
    const item: CachedMedia = {
      url,
      type,
      mimeType,
      size,
      cachedAt,
      lastUsed: Date.now(),
      metadata: metadata || {},
    };
    await this.putItem(item);
    this.cachedUrls.add(url);
  }

  // ==================== 兼容旧 API ====================

  /**
   * 仅将 Blob 存入 Cache Storage（不存 IndexedDB 元数据）
   * 设置 sw-cache-date 响应头用于记录添加时间
   */
  async cacheToCacheStorageOnly(
    url: string,
    blob: Blob
  ): Promise<boolean> {
    try {
      if (typeof caches === 'undefined') {
        console.warn('[UnifiedCache] caches API not available');
        return false;
      }
      const cache = await caches.open(IMAGE_CACHE_NAME);
      const response = new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'application/octet-stream',
          'Content-Length': blob.size.toString(),
          'sw-cache-date': Date.now().toString(), // 记录添加时间，用于素材库排序
          'sw-image-size': blob.size.toString(),
        },
      });
      await cache.put(url, response);
      return true;
    } catch (error) {
      console.error('[UnifiedCache] Failed to cache to storage only:', error);
      return false;
    }
  }

  /**
   * 从 Blob 缓存媒体（兼容 mediaCacheService.cacheMediaFromBlob）
   * 同时存入 Cache Storage 和 IndexedDB 元数据
   * 用于 AI 生成的媒体，需要在素材库中显示
   */
  async cacheMediaFromBlob(
    url: string,
    blob: Blob,
    type: CacheMediaType,
    metadata?: { taskId?: string; prompt?: string; model?: string }
  ): Promise<string> {
    try {
      // 1. 将 blob 放入 Cache API（通过创建 Response）
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(IMAGE_CACHE_NAME);
        const response = new Response(blob, {
          headers: {
            'Content-Type': blob.type || 'application/octet-stream',
            'Content-Length': blob.size.toString(),
            'sw-cache-date': Date.now().toString(), // 记录添加时间，用于素材库排序
            'sw-image-size': blob.size.toString(),
          },
        });
        await cache.put(url, response);
        
        // 异步生成预览图（不阻塞主流程）
        // 注意：需要在 Service Worker 中执行，通过 postMessage 通知 SW 生成
        if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
          // 将 Blob 转换为 ArrayBuffer 以便通过 postMessage 传递
          blob.arrayBuffer().then((arrayBuffer) => {
            navigator.serviceWorker.ready.then((registration) => {
              if (registration.active) {
                registration.active.postMessage({
                  type: 'GENERATE_THUMBNAIL',
                  url,
                  mediaType: type, // 'image' | 'video'
                  blob: arrayBuffer,
                  mimeType: blob.type,
                }).catch((err) => {
                  console.warn('[UnifiedCache] Failed to request thumbnail generation:', err);
                });
              }
            }).catch(() => {
              // Service Worker 不可用，静默失败
            });
          }).catch((err) => {
            console.warn('[UnifiedCache] Failed to convert blob to arrayBuffer:', err);
          });
        }
      } else {
        console.warn('[UnifiedCache] caches API not available');
      }

      // 2. 存储元数据到 IndexedDB
      const now = Date.now();
      const item: CachedMedia = {
        url,
        type,
        mimeType: blob.type || (type === 'video' ? 'video/mp4' : 'image/png'),
        size: blob.size,
        cachedAt: now,
        lastUsed: now,
        metadata: metadata || {},
      };

      await this.putItem(item);
      this.cachedUrls.add(url);
      this.notifyListeners();

      // console.log('[UnifiedCache] Media cached from blob:', { url, type, size: blob.size });
      return url;
    } catch (error) {
      this.handleQuotaError(error);
      console.error('[UnifiedCache] Failed to cache media from blob:', error);
      throw error;
    }
  }

  /**
   * 获取缓存的 Blob（兼容 urlCacheService.getVideoAsBlob）
   * 支持 taskId（如 "merged-video-xxx"）或完整 URL
   */
  async getCachedBlob(url: string): Promise<Blob | null> {
    try {
      // 检查是否为虚拟 URL（素材库本地 URL 或缓存 URL）
      const isVirtualUrl = url.startsWith('/asset-library/') || url.startsWith('/__aitu_cache__/');

      // 如果是 taskId（不是完整 URL）或虚拟 URL，直接从 Cache API 获取
      if (isVirtualUrl || (!url.startsWith('http') && !url.startsWith('blob:') && !url.startsWith('/'))) {
        if (typeof caches !== 'undefined') {
          const cache = await caches.open(IMAGE_CACHE_NAME);
          const response = await cache.match(url);
          if (response) {
            return await response.blob();
          }
        }
        console.warn('[UnifiedCache] Blob not found in cache:', url);
        return null;
      }

      // 完整 URL 通过 fetch 获取
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      return await response.blob();
    } catch (error) {
      console.error('[UnifiedCache] Failed to get cached blob:', error);
      return null;
    }
  }

  /**
   * 获取缓存状态（兼容 mediaCacheService.getCacheStatus）
   */
  getCacheStatus(url: string): CacheStatus {
    if (this.cachedUrls.has(url)) {
      return 'cached';
    }
    return 'none';
  }

  /**
   * 获取缓存的 URL（兼容 mediaCacheService.getCachedUrl）
   * 如果已缓存返回原 URL，否则返回 null
   */
  async getCachedUrl(url: string): Promise<string | null> {
    const cached = await this.isCached(url);
    return cached ? url : null;
  }

  /**
   * 初始化缓存状态（兼容旧 API，实际上在构造函数中已自动初始化）
   */
  async initCacheStatus(): Promise<void> {
    await this.refreshCacheState();
  }

  // ==================== 事件订阅 ====================

  /**
   * 订阅缓存变化
   */
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 监听缓存满事件
   */
  onQuotaExceeded(callback: () => void): () => void {
    this.quotaExceededListeners.add(callback);
    return () => this.quotaExceededListeners.delete(callback);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((callback) => callback());
  }

  /**
   * 通知缓存满监听器
   */
  private notifyQuotaExceededListeners(): void {
    this.quotaExceededListeners.forEach((callback) => callback());
  }

  /**
   * 处理配额错误
   */
  private handleQuotaError(error: any): void {
    if (
      error instanceof Error &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    ) {
      console.error('[UnifiedCache] Storage quota exceeded');
      this.notifyQuotaExceededListeners();
    }
  }

  // ==================== 数据迁移 ====================

  /**
   * 从旧数据库迁移数据
   */
  private async migrateFromLegacyDBs(): Promise<void> {
    if (this.migrationPromise) return this.migrationPromise;

    // 检查迁移标记
    const migrated = localStorage.getItem('drawnix_cache_migrated');
    if (migrated === 'true') {
      // console.log('[UnifiedCache] Migration already completed');
      return;
    }

    this.migrationPromise = (async () => {
      try {
        // console.log('[UnifiedCache] Starting migration from legacy databases...');

        // 迁移 Media Cache
        await this.migrateFromMediaCache();

        // 迁移 URL Cache
        await this.migrateFromURLCache();

        // 刷新缓存状态
        await this.refreshCacheState();

        // 设置迁移标记
        localStorage.setItem('drawnix_cache_migrated', 'true');
        // console.log('[UnifiedCache] Migration completed successfully');

        // 通知所有订阅者更新
        this.notifyListeners();
      } catch (error) {
        console.error('[UnifiedCache] Migration failed:', error);
      }
    })();

    return this.migrationPromise;
  }

  /**
   * 从 aitu-media-cache 迁移
   */
  private async migrateFromMediaCache(): Promise<void> {
    try {
      const exists = await this.checkDBExists(LEGACY_DB_NAMES.MEDIA_CACHE);
      if (!exists) return;

      // console.log('[UnifiedCache] Migrating from aitu-media-cache...');

      const oldDB = await this.openLegacyDB(LEGACY_DB_NAMES.MEDIA_CACHE);

      if (!oldDB.objectStoreNames.contains('media')) {
        oldDB.close();
        await this.deleteLegacyDB(LEGACY_DB_NAMES.MEDIA_CACHE);
        return;
      }

      const oldItems = await this.getAllFromStore(oldDB, 'media');
      oldDB.close();

      if (oldItems.length === 0) {
        await this.deleteLegacyDB(LEGACY_DB_NAMES.MEDIA_CACHE);
        return;
      }

      let migratedCount = 0;
      for (const item of oldItems) {
        try {
          const url = item.originalUrl || item.url;
          if (!url) continue;

          const newEntry: CachedMedia = {
            url,
            type: item.type || 'image',
            mimeType: item.mimeType || item.blob?.type || 'image/png',
            size: item.size || item.blob?.size || 0,
            cachedAt: item.cachedAt || Date.now(),
            lastUsed: Date.now(),
            metadata: {
              taskId: item.taskId,
              prompt: item.prompt,
            },
          };

          await this.putItem(newEntry);
          this.cachedUrls.add(url);
          migratedCount++;
        } catch (error) {
          console.warn('[UnifiedCache] Failed to migrate item from media-cache:', error);
        }
      }

      await this.deleteLegacyDB(LEGACY_DB_NAMES.MEDIA_CACHE);
      // console.log(`[UnifiedCache] Migrated ${migratedCount} items from media-cache`);
    } catch (error) {
      console.error('[UnifiedCache] Failed to migrate from media-cache:', error);
    }
  }

  /**
   * 从 aitu-url-cache 迁移
   */
  private async migrateFromURLCache(): Promise<void> {
    try {
      const exists = await this.checkDBExists(LEGACY_DB_NAMES.URL_CACHE);
      if (!exists) return;

      // console.log('[UnifiedCache] Migrating from aitu-url-cache...');

      const oldDB = await this.openLegacyDB(LEGACY_DB_NAMES.URL_CACHE);

      if (!oldDB.objectStoreNames.contains('media-cache')) {
        oldDB.close();
        await this.deleteLegacyDB(LEGACY_DB_NAMES.URL_CACHE);
        return;
      }

      const oldItems = await this.getAllFromStore(oldDB, 'media-cache');
      oldDB.close();

      if (oldItems.length === 0) {
        await this.deleteLegacyDB(LEGACY_DB_NAMES.URL_CACHE);
        return;
      }

      let migratedCount = 0;
      let skippedCount = 0;

      for (const item of oldItems) {
        try {
          const url = item.url;
          if (!url) continue;

          // 检查是否已存在（可能已从 media-cache 迁移）
          const existing = await this.getItem(url);

          if (existing) {
            // 已存在，保留原有的元数据（来自 media-cache），只更新缺失的字段
            const merged: CachedMedia = {
              ...existing,
              // 只在原数据缺失时更新
              mimeType: existing.mimeType || item.mimeType || 'image/png',
              size: existing.size || item.size || 0,
              // 保留更早的缓存时间
              cachedAt: Math.min(existing.cachedAt, item.cachedAt || Date.now()),
              lastUsed: Date.now(),
            };

            await this.putItem(merged);
            skippedCount++;
            // console.log(`[UnifiedCache] Merged url-cache item with existing: ${url.substring(0, 50)}...`);
          } else {
            // 不存在，创建新条目
            const newEntry: CachedMedia = {
              url,
              type: item.type || 'image',
              mimeType: item.mimeType || 'image/png',
              size: item.size || 0,
              cachedAt: item.cachedAt || Date.now(),
              lastUsed: Date.now(),
              metadata: {},
            };

            await this.putItem(newEntry);
            migratedCount++;
          }

          this.cachedUrls.add(url);
        } catch (error) {
          console.warn('[UnifiedCache] Failed to migrate item from url-cache:', error);
        }
      }

      await this.deleteLegacyDB(LEGACY_DB_NAMES.URL_CACHE);
      // console.log(`[UnifiedCache] Migrated ${migratedCount} items, merged ${skippedCount} items from url-cache`);
    } catch (error) {
      console.error('[UnifiedCache] Failed to migrate from url-cache:', error);
    }
  }

  /**
   * 检查数据库是否存在
   */
  private async checkDBExists(dbName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        req.result.close();
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  }

  /**
   * 打开旧数据库
   */
  private async openLegacyDB(dbName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 从 store 获取所有数据
   */
  private async getAllFromStore(db: IDBDatabase, storeName: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 删除旧数据库
   */
  private async deleteLegacyDB(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => {
        // console.log(`[UnifiedCache] Deleted legacy database: ${dbName}`);
        resolve();
      };
      request.onerror = () => {
        console.warn(`[UnifiedCache] Failed to delete legacy database: ${dbName}`);
        reject(request.error);
      };
    });
  }

  /**
   * 格式化文件大小
   */
  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

// ==================== 导出单例实例 ====================

export const unifiedCacheService = new UnifiedCacheService();
