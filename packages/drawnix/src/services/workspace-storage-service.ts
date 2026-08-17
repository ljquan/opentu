/**
 * Workspace Storage Service
 *
 * Handles IndexedDB operations for workspace data persistence.
 * Manages folders, boards, and workspace state.
 */

import localforage from 'localforage';
import {
  Folder,
  Board,
  BoardMetadata,
  WorkspaceState,
  WORKSPACE_DEFAULTS,
} from '../types/workspace.types';
import { migrateElementsFillData } from '../types/fill.types';
import type { PlaitElement } from '@plait/core';
import { migrateLegacyIndexedDB } from './indexeddb-namespace-migration';
import { getNamespacedDatabaseName } from './storage-context';

/**
 * Cache name for images (must match the one in sw/index.ts)
 */
const IMAGE_CACHE_NAME = 'drawnix-images';

/**
 * 检测 URL 是否为 Base64 data URL
 */
function isBase64ImageUrl(url: string): boolean {
  return (
    typeof url === 'string' &&
    url.startsWith('data:image/') &&
    url.includes(';base64,')
  );
}

/**
 * 将 Base64 图片缓存到 Cache API，返回虚拟路径 URL
 */
async function cacheBase64ImageToVirtualPath(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return dataUrl;

  const [, mimeType, base64Data] = match;

  try {
    // 将 Base64 转为 Blob
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    // 生成唯一 ID
    const id = `img-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 10)}`;
    const ext = mimeType.split('/')[1] || 'png';
    const virtualPath = `/__aitu_cache__/image/${id}.${ext}`;

    // 缓存到 Cache API
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const response = new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': blob.size.toString(),
        'Cache-Control': 'max-age=31536000',
      },
    });
    await cache.put(virtualPath, response);

    return virtualPath;
  } catch (error) {
    console.error('[Migration] Failed to cache Base64 image:', error);
    return dataUrl;
  }
}

/**
 * 迁移画布元素中的 Base64 图片 URL 到虚拟路径
 * 返回是否有元素被迁移
 */
async function migrateElementsBase64Urls(
  elements: PlaitElement[]
): Promise<boolean> {
  let migrated = false;

  for (const element of elements) {
    // 检查图片元素
    if ((element as any).url && isBase64ImageUrl((element as any).url)) {
      const originalSize = Math.round((element as any).url.length / 1024);
      const newUrl = await cacheBase64ImageToVirtualPath((element as any).url);
      if (newUrl !== (element as any).url) {
        (element as any).url = newUrl;
        migrated = true;
        // console.log(`[Migration] Element ${element.id}: Base64 (${originalSize}KB) -> ${newUrl}`);
      }
    }

    // 递归处理子元素
    if ((element as any).children && Array.isArray((element as any).children)) {
      const childMigrated = await migrateElementsBase64Urls(
        (element as any).children
      );
      if (childMigrated) migrated = true;
    }
  }

  return migrated;
}

/**
 * Database configuration
 */
const WORKSPACE_DB_CONFIG = {
  LEGACY_DATABASE_NAME: 'aitu-workspace',
  MIN_DATABASE_VERSION: 8,
  STORES: {
    FOLDERS: 'folders',
    BOARDS: 'boards',
    STATE: 'state',
  },
} as const;

function getWorkspaceDatabaseName(): string {
  return getNamespacedDatabaseName(WORKSPACE_DB_CONFIG.LEGACY_DATABASE_NAME);
}

const STATE_KEY = 'workspace_state';

/**
 * Helper to wait for browser idle time
 */
function waitForIdle(timeout = 50): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as Window).requestIdleCallback(() => resolve(), { timeout });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Detect existing database version to avoid downgrade errors
 */
async function detectDatabaseVersion(dbName: string): Promise<number> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      console.warn(
        '[WorkspaceStorage] IndexedDB not available, using min version'
      );
      resolve(WORKSPACE_DB_CONFIG.MIN_DATABASE_VERSION);
      return;
    }

    // Open without version to get current version
    const request = indexedDB.open(dbName);

    request.onsuccess = () => {
      const db = request.result;
      const version = db.version;
      db.close();
      const targetVersion = Math.max(
        version,
        WORKSPACE_DB_CONFIG.MIN_DATABASE_VERSION
      );
      resolve(targetVersion);
    };

    request.onerror = (event) => {
      // Try to get version from error event or use a safe high version
      console.error('[WorkspaceStorage] Error detecting DB version:', event);
      // Use a higher version to avoid downgrade - version 10 should be safe
      resolve(10);
    };

    request.onblocked = () => {
      // Database is blocked by another connection, use a safe high version
      console.warn('[WorkspaceStorage] DB blocked, using safe version 10');
      resolve(10);
    };
  });
}

/**
 * Workspace storage service for managing data persistence
 */
class WorkspaceStorageService {
  private foldersStore: LocalForage | null = null;
  private boardsStore: LocalForage | null = null;
  private stateStore: LocalForage | null = null;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private writesSuspended = false;
  private pendingWrites = new Set<Promise<void>>();

  constructor() {
    // Defer store creation until initialization to detect version first
  }

  /**
   * Create stores with the detected version
   */
  private async createStores(): Promise<void> {
    const version = await detectDatabaseVersion(getWorkspaceDatabaseName());

    this.foldersStore = localforage.createInstance({
      driver: localforage.INDEXEDDB,
      name: getWorkspaceDatabaseName(),
      version: version,
      storeName: WORKSPACE_DB_CONFIG.STORES.FOLDERS,
      description: 'Workspace folders storage',
    });

    this.boardsStore = localforage.createInstance({
      driver: localforage.INDEXEDDB,
      name: getWorkspaceDatabaseName(),
      version: version,
      storeName: WORKSPACE_DB_CONFIG.STORES.BOARDS,
      description: 'Workspace boards storage',
    });

    this.stateStore = localforage.createInstance({
      driver: localforage.INDEXEDDB,
      name: getWorkspaceDatabaseName(),
      version: version,
      storeName: WORKSPACE_DB_CONFIG.STORES.STATE,
      description: 'Workspace state storage',
    });
  }

  /**
   * Initialize storage service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure we only initialize once even if called concurrently
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Create stores with detected version first
      await this.createStores();

      await Promise.all([
        this.foldersStore!.ready(),
        this.boardsStore!.ready(),
        this.stateStore!.ready(),
      ]);
      await migrateLegacyIndexedDB({
        sourceDatabaseName: WORKSPACE_DB_CONFIG.LEGACY_DATABASE_NAME,
        targetDatabaseName: getWorkspaceDatabaseName(),
        stores: Object.values(WORKSPACE_DB_CONFIG.STORES),
      });
      this.initialized = true;
    } catch (error) {
      console.error('[WorkspaceStorage] Failed to initialize:', error);

      // Check if it's a version downgrade error
      const errorMsg = String(error);
      if (
        errorMsg.includes("can't be downgraded") ||
        errorMsg.includes('version')
      ) {
        console.warn(
          '[WorkspaceStorage] Version conflict detected, attempting recovery...'
        );

        // Try to delete the database and reinitialize
        try {
          await this.deleteDatabase();
          await this.createStores();
          await Promise.all([
            this.foldersStore!.ready(),
            this.boardsStore!.ready(),
            this.stateStore!.ready(),
          ]);
          this.initialized = true;
          return;
        } catch (recoveryError) {
          console.error('[WorkspaceStorage] Recovery failed:', recoveryError);
        }
      }

      throw new Error('Workspace storage initialization failed');
    }
  }

  /**
   * Delete the database (for recovery from version conflicts)
   */
  private async deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }

      const request = indexedDB.deleteDatabase(getWorkspaceDatabaseName());
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        console.error('[WorkspaceStorage] Failed to delete database');
        reject(new Error('Failed to delete database'));
      };
      request.onblocked = () => {
        console.warn('[WorkspaceStorage] Database deletion blocked');
        // Still resolve after a timeout
        setTimeout(resolve, 1000);
      };
    });
  }

  // ========== Private Store Getters (ensure initialized) ==========

  private getFoldersStore(): LocalForage {
    if (!this.foldersStore) {
      throw new Error('WorkspaceStorage not initialized');
    }
    return this.foldersStore;
  }

  private getBoardsStore(): LocalForage {
    if (!this.boardsStore) {
      throw new Error('WorkspaceStorage not initialized');
    }
    return this.boardsStore;
  }

  private getStateStore(): LocalForage {
    if (!this.stateStore) {
      throw new Error('WorkspaceStorage not initialized');
    }
    return this.stateStore;
  }

  // ========== Folder Operations ==========

  async saveFolder(folder: Folder): Promise<void> {
    await this.runWrite(async () => {
      await this.getFoldersStore().setItem(folder.id, folder);
    });
  }

  async loadFolder(id: string): Promise<Folder | null> {
    await this.ensureInitialized();
    return this.getFoldersStore().getItem<Folder>(id);
  }

  async loadAllFolders(): Promise<Folder[]> {
    await this.ensureInitialized();
    const folders: Folder[] = [];
    await this.getFoldersStore().iterate<Folder, void>((value) => {
      if (value && value.id) folders.push(value);
    });
    // Wait for browser idle time after IndexedDB operation
    await waitForIdle();
    return folders.sort((a, b) => a.order - b.order);
  }

  async deleteFolder(id: string): Promise<void> {
    await this.runWrite(async () => {
      await this.getFoldersStore().removeItem(id);
    });
  }

  // ========== Board Operations ==========

  async saveBoard(board: Board): Promise<void> {
    await this.runWrite(async () => {
      await this.getBoardsStore().setItem(board.id, board);
    });
  }

  async loadBoard(id: string): Promise<Board | null> {
    await this.ensureInitialized();
    let board: Board | null;
    try {
      board = await this.getBoardsStore().getItem<Board>(id);
    } catch (error) {
      console.error(
        `[Storage] Failed to load board ${id} from IndexedDB:`,
        error
      );
      return null;
    }
    if (board && board.elements) {
      // 迁移 fill 数据格式，确保渐变填充不会显示为黑色
      board.elements = migrateElementsFillData(board.elements);

      // 迁移 Base64 图片 URL 到虚拟路径（同步等待，确保画布显示迁移后的数据）
      try {
        const migrated = await migrateElementsBase64Urls(board.elements);
        if (migrated) {
          // 保存迁移后的数据
          await this.saveBoard(board);
          // console.log(`[Migration] Board ${id}: Base64 URLs migrated and saved`);
        }
      } catch (error) {
        console.error(`[Migration] Board ${id}: Failed to migrate`, error);
      }
    }
    return board;
  }

  async loadAllBoards(): Promise<Board[]> {
    await this.ensureInitialized();
    const boards: Board[] = [];
    await this.getBoardsStore().iterate<Board, void>((value) => {
      if (value && value.id) {
        // 迁移 fill 数据格式，确保渐变填充不会显示为黑色
        if (value.elements) {
          value.elements = migrateElementsFillData(value.elements);
        }
        boards.push(value);
      }
    });
    // Wait for browser idle time after IndexedDB operation
    await waitForIdle();

    // 迁移 Base64 图片 URL 到虚拟路径
    for (const board of boards) {
      if (board.elements) {
        try {
          const migrated = await migrateElementsBase64Urls(board.elements);
          if (migrated) {
            await this.saveBoard(board);
            // console.log(`[Migration] Board ${board.id}: Base64 URLs migrated and saved`);
          }
        } catch (error) {
          console.error(
            `[Migration] Board ${board.id}: Failed to migrate`,
            error
          );
        }
      }
    }

    return boards.sort((a, b) => a.order - b.order);
  }

  /**
   * 加载所有画板的元数据（不含 elements）
   * 用于侧边栏显示，减少内存占用
   */
  async loadAllBoardMetadata(): Promise<BoardMetadata[]> {
    await this.ensureInitialized();
    const boards: BoardMetadata[] = [];
    await this.getBoardsStore().iterate<Board, void>((value) => {
      if (value && value.id) {
        // 只提取元数据，不包含 elements
        boards.push({
          id: value.id,
          name: value.name,
          folderId: value.folderId,
          order: value.order,
          viewport: value.viewport,
          theme: value.theme,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
        });
      }
    });
    // Wait for browser idle time after IndexedDB operation
    await waitForIdle();

    return boards.sort((a, b) => a.order - b.order);
  }

  async loadFolderBoards(folderId: string | null): Promise<Board[]> {
    await this.ensureInitialized();
    const boards: Board[] = [];
    await this.getBoardsStore().iterate<Board, void>((value) => {
      if (value && value.folderId === folderId) {
        // 迁移 fill 数据格式，确保渐变填充不会显示为黑色
        if (value.elements) {
          value.elements = migrateElementsFillData(value.elements);
        }
        boards.push(value);
      }
    });
    // Wait for browser idle time after IndexedDB operation
    await waitForIdle();
    return boards.sort((a, b) => a.order - b.order);
  }

  async deleteBoard(id: string): Promise<void> {
    await this.runWrite(async () => {
      await this.getBoardsStore().removeItem(id);
    });
  }

  async deleteFolderBoards(folderId: string): Promise<void> {
    await this.ensureInitialized();
    const boards = await this.loadFolderBoards(folderId);
    await Promise.all(boards.map((b) => this.deleteBoard(b.id)));
  }

  // ========== State Operations ==========

  async saveState(state: WorkspaceState): Promise<void> {
    await this.runWrite(async () => {
      await this.getStateStore().setItem(STATE_KEY, state);
    });
  }

  async loadState(): Promise<WorkspaceState> {
    await this.ensureInitialized();
    const state = await this.getStateStore().getItem<WorkspaceState>(STATE_KEY);
    return (
      state || {
        currentBoardId: null,
        expandedFolderIds: [],
        sidebarWidth: WORKSPACE_DEFAULTS.SIDEBAR_WIDTH,
        sidebarCollapsed: false,
      }
    );
  }

  // ========== Utility Operations ==========

  async getBoardCount(): Promise<number> {
    await this.ensureInitialized();
    return this.getBoardsStore().length();
  }

  async clearAll(): Promise<void> {
    await this.ensureInitialized();
    await Promise.all([
      this.getFoldersStore().clear(),
      this.getBoardsStore().clear(),
      this.getStateStore().clear(),
    ]);
  }

  /**
   * 清空本地画板内容，同时保留侧栏宽度和折叠状态等用户偏好。
   */
  async clearContent(): Promise<void> {
    await this.ensureInitialized();
    const state = await this.loadState();
    this.writesSuspended = true;
    try {
      await Promise.all([
        this.getFoldersStore().clear(),
        this.getBoardsStore().clear(),
        this.getStateStore().setItem(STATE_KEY, {
          ...state,
          currentBoardId: null,
          expandedFolderIds: [],
        }),
      ]);
    } catch (error) {
      this.writesSuspended = false;
      throw error;
    }
  }

  suspendWrites(): void {
    this.writesSuspended = true;
  }

  resumeWrites(): void {
    this.writesSuspended = false;
  }

  async flushPendingWrites(): Promise<void> {
    await Promise.allSettled(Array.from(this.pendingWrites));
  }

  async close(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise.catch(() => undefined);
    }
    for (const store of [
      this.foldersStore,
      this.boardsStore,
      this.stateStore,
    ]) {
      const database = (
        store as (LocalForage & { _dbInfo?: { db?: IDBDatabase } }) | null
      )?._dbInfo?.db;
      database?.close();
    }
    this.foldersStore = null;
    this.boardsStore = null;
    this.stateStore = null;
    this.initialized = false;
    this.initPromise = null;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async runWrite(operation: () => Promise<void>): Promise<void> {
    if (this.writesSuspended) return;
    const pending = (async () => {
      await this.ensureInitialized();
      if (this.writesSuspended) return;
      await operation();
    })();
    this.pendingWrites.add(pending);
    try {
      await pending;
    } finally {
      this.pendingWrites.delete(pending);
    }
  }
}

export const workspaceStorageService = new WorkspaceStorageService();
