/**
 * Service Worker Task Queue Storage
 *
 * Provides IndexedDB-based persistence for task queue state.
 * Ensures tasks survive page refreshes and SW restarts.
 *
 * Supports:
 * - Tasks (image/video/character generation)
 * - Workflows (multi-step operations)
 * - Chat Workflows (LLM chat with tool execution)
 * - Pending Tool Requests (main thread tool delegation)
 */

import type { SWTask, GeminiConfig, VideoAPIConfig, ChatParams } from './types';
import { getSafeErrorMessage } from './utils/sanitize-utils';

// Import Workflow type from the main package's workflow-engine types
import type { Workflow } from '../../../../../packages/drawnix/src/services/workflow-engine/types';

/**
 * Inline ChatWorkflow type (previously imported from deleted chat-workflow/types.ts)
 * Kept for IndexedDB storage compatibility
 */
interface ChatWorkflow {
  id: string;
  status: string;
  params: ChatParams;
  content: string;
  aiAnalysis?: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    status: string;
    result?: {
      success: boolean;
      data?: unknown;
      error?: string;
      taskId?: string;
    };
  }>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

/**
 * Task-Step mapping for unified progress sync
 * (Duplicated here to avoid circular dependency with task-step-registry.ts)
 */
export interface TaskStepMapping {
  taskId: string;
  workflowId: string;
  stepId: string;
  createdAt: number;
}

const DB_NAME = 'sw-task-queue';
const MIN_DB_VERSION = 3; // Minimum required version (with task-step mappings store)
const TASKS_STORE = 'tasks';
const CONFIG_STORE = 'config';
const WORKFLOWS_STORE = 'workflows';
const CHAT_WORKFLOWS_STORE = 'chat-workflows';
const PENDING_TOOL_REQUESTS_STORE = 'pending-tool-requests';
const PENDING_DOM_OPERATIONS_STORE = 'pending-dom-operations';
const TASK_STEP_MAPPINGS_STORE = 'task-step-mappings';
const PENDING_CANVAS_OPERATIONS_STORE = 'pending-canvas-operations';

// All required stores for integrity check
const REQUIRED_STORES = [
  TASKS_STORE,
  CONFIG_STORE,
  WORKFLOWS_STORE,
  CHAT_WORKFLOWS_STORE,
  PENDING_TOOL_REQUESTS_STORE,
  PENDING_DOM_OPERATIONS_STORE,
  TASK_STEP_MAPPINGS_STORE,
  PENDING_CANVAS_OPERATIONS_STORE,
];

/**
 * Pending tool request stored in IndexedDB
 */
export interface StoredPendingToolRequest {
  requestId: string;
  workflowId: string;
  stepId: string;
  toolName: string;
  args: Record<string, unknown>;
  createdAt: number;
  /** ID of the client that initiated the request */
  clientId?: string;
}

/**
 * Pending DOM operation stored in IndexedDB
 *
 * When a main-thread tool completes in SW but no client is available,
 * the result is stored here. When a client reconnects, these operations
 * are sent to the client to continue execution.
 */
export interface PendingDomOperation {
  /** Unique operation ID */
  id: string;
  /** Associated workflow ID */
  workflowId: string;
  /** Associated chat ID (for chat workflows) */
  chatId: string;
  /** Tool name that needs to be executed on main thread */
  toolName: string;
  /** Tool arguments */
  toolArgs: Record<string, unknown>;
  /** Result from SW tool execution (e.g., generated image URL) */
  toolResult: unknown;
  /** Tool call ID (for tracking in workflow) */
  toolCallId: string;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Pending Canvas operation stored in IndexedDB
 *
 * When a canvas operation fails (e.g., timeout, no client), it's stored here
 * for retry when client reconnects.
 */
export interface PendingCanvasOperation {
  /** Unique operation ID */
  id: string;
  /** Associated workflow ID */
  workflowId: string;
  /** Operation type (e.g., 'canvas_insert') */
  operation: string;
  /** Operation parameters */
  params: Record<string, unknown>;
  /** Number of retry attempts */
  retryCount: number;
  /** Last error message */
  lastError?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last retry timestamp */
  lastRetryAt?: number;
}

/**
 * Detect existing database version to avoid downgrade errors
 */
function detectDatabaseVersion(): Promise<number> {
  return new Promise((resolve) => {
    // Open without version to get current version
    const request = indexedDB.open(DB_NAME);

    request.onsuccess = () => {
      const db = request.result;
      const version = db.version;
      db.close();
      resolve(Math.max(version, MIN_DB_VERSION));
    };

    request.onerror = () => {
      resolve(MIN_DB_VERSION);
    };
  });
}

/**
 * Check if all required object stores exist
 */
function checkStoresIntegrity(db: IDBDatabase): string[] {
  const missing: string[] = [];
  for (const store of REQUIRED_STORES) {
    if (!db.objectStoreNames.contains(store)) {
      missing.push(store);
    }
  }
  return missing;
}

/**
 * Create missing object stores by incrementing version
 */
function repairDatabase(currentVersion: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Increment version to trigger onupgradeneeded
    const newVersion = currentVersion + 1;

    const request = indexedDB.open(DB_NAME, newVersion);

    request.onerror = () => {
      console.error('[SWStorage] Failed to repair DB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      createAllStores(db);
    };
  });
}

/**
 * Create all required object stores if they don't exist
 */
function createAllStores(db: IDBDatabase): void {
  // Create tasks store
  if (!db.objectStoreNames.contains(TASKS_STORE)) {
    const tasksStore = db.createObjectStore(TASKS_STORE, { keyPath: 'id' });
    tasksStore.createIndex('status', 'status', { unique: false });
    tasksStore.createIndex('type', 'type', { unique: false });
    tasksStore.createIndex('createdAt', 'createdAt', { unique: false });
  }

  // Create config store
  if (!db.objectStoreNames.contains(CONFIG_STORE)) {
    db.createObjectStore(CONFIG_STORE, { keyPath: 'key' });
  }

  // Create workflows store
  if (!db.objectStoreNames.contains(WORKFLOWS_STORE)) {
    const workflowsStore = db.createObjectStore(WORKFLOWS_STORE, {
      keyPath: 'id',
    });
    workflowsStore.createIndex('status', 'status', { unique: false });
    workflowsStore.createIndex('createdAt', 'createdAt', { unique: false });
  }

  // Create chat workflows store
  if (!db.objectStoreNames.contains(CHAT_WORKFLOWS_STORE)) {
    const chatWorkflowsStore = db.createObjectStore(CHAT_WORKFLOWS_STORE, {
      keyPath: 'id',
    });
    chatWorkflowsStore.createIndex('status', 'status', { unique: false });
    chatWorkflowsStore.createIndex('createdAt', 'createdAt', { unique: false });
  }

  // Create pending tool requests store
  if (!db.objectStoreNames.contains(PENDING_TOOL_REQUESTS_STORE)) {
    const pendingRequestsStore = db.createObjectStore(
      PENDING_TOOL_REQUESTS_STORE,
      { keyPath: 'requestId' }
    );
    pendingRequestsStore.createIndex('workflowId', 'workflowId', {
      unique: false,
    });
  }

  // Create pending DOM operations store (for page refresh recovery)
  if (!db.objectStoreNames.contains(PENDING_DOM_OPERATIONS_STORE)) {
    const pendingDomOpsStore = db.createObjectStore(
      PENDING_DOM_OPERATIONS_STORE,
      { keyPath: 'id' }
    );
    pendingDomOpsStore.createIndex('workflowId', 'workflowId', {
      unique: false,
    });
    pendingDomOpsStore.createIndex('chatId', 'chatId', { unique: false });
  }

  // Create task-step mappings store (for unified progress sync)
  if (!db.objectStoreNames.contains(TASK_STEP_MAPPINGS_STORE)) {
    const taskStepMappingsStore = db.createObjectStore(
      TASK_STEP_MAPPINGS_STORE,
      { keyPath: 'taskId' }
    );
    taskStepMappingsStore.createIndex('workflowId', 'workflowId', {
      unique: false,
    });
  }

  // Create pending canvas operations store (for canvas operation retry)
  if (!db.objectStoreNames.contains(PENDING_CANVAS_OPERATIONS_STORE)) {
    const pendingCanvasOpsStore = db.createObjectStore(
      PENDING_CANVAS_OPERATIONS_STORE,
      { keyPath: 'id' }
    );
    pendingCanvasOpsStore.createIndex('workflowId', 'workflowId', {
      unique: false,
    });
  }
}

/**
 * Open IndexedDB connection with dynamic version detection and auto-repair
 */
async function openDB(): Promise<IDBDatabase> {
  // First, detect the current database version
  const targetVersion = await detectDatabaseVersion();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, targetVersion);

    request.onerror = () => {
      console.error('[SWStorage] Failed to open DB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      const db = request.result;

      // Check if all stores exist
      const missingStores = checkStoresIntegrity(db);
      if (missingStores.length > 0) {
        console.warn(
          `[SWStorage] Missing object stores: ${missingStores.join(
            ', '
          )}. Repairing...`
        );
        db.close();

        // Repair by incrementing version
        repairDatabase(db.version).then(resolve).catch(reject);
        return;
      }

      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      createAllStores(db);
    };
  });
}

/**
 * Task Queue Storage Manager
 */
export class TaskQueueStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  // Batch save optimization to reduce IndexedDB transaction overhead
  private pendingTaskSaves: Map<string, SWTask> = new Map();
  private batchSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private batchSavePromises: Map<
    string,
    { resolve: () => void; reject: (err: unknown) => void }
  > = new Map();
  private readonly BATCH_SAVE_DELAY = 50; // ms - batch saves within this window

  /**
   * Get database connection
   */
  private async getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB();
    }
    return this.dbPromise;
  }

  /**
   * Flush pending task saves immediately
   */
  private async flushPendingTaskSaves(): Promise<void> {
    if (this.batchSaveTimer) {
      clearTimeout(this.batchSaveTimer);
      this.batchSaveTimer = null;
    }

    const tasksToSave = Array.from(this.pendingTaskSaves.values());
    const promisesToResolve = new Map(this.batchSavePromises);

    this.pendingTaskSaves.clear();
    this.batchSavePromises.clear();

    if (tasksToSave.length === 0) return;

    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readwrite');
        const store = transaction.objectStore(TASKS_STORE);

        // Put all tasks in a single transaction
        for (const task of tasksToSave) {
          store.put(task);
        }

        transaction.oncomplete = () => {
          // Resolve all pending promises
          promisesToResolve.forEach(({ resolve }) => resolve());
          resolve();
        };
        transaction.onerror = () => {
          const error = transaction.error;
          promisesToResolve.forEach(({ reject }) => reject(error));
          reject(error);
        };
      });
    } catch (error) {
      console.error('[SWStorage] Failed to batch save tasks:', error);
      promisesToResolve.forEach(({ reject }) => reject(error));
    }
  }

  /**
   * Save a task to IndexedDB (batched for performance)
   */
  async saveTask(task: SWTask): Promise<void> {
    return new Promise((resolve, reject) => {
      // Add to pending saves
      this.pendingTaskSaves.set(task.id, task);
      this.batchSavePromises.set(task.id, { resolve, reject });

      // Schedule batch save
      if (!this.batchSaveTimer) {
        this.batchSaveTimer = setTimeout(() => {
          this.flushPendingTaskSaves();
        }, this.BATCH_SAVE_DELAY);
      }
    });
  }

  /**
   * Save a task immediately without batching (for critical saves)
   */
  async saveTaskImmediate(task: SWTask): Promise<void> {
    // First, remove from pending batch if present
    this.pendingTaskSaves.delete(task.id);
    const pendingPromise = this.batchSavePromises.get(task.id);
    if (pendingPromise) {
      this.batchSavePromises.delete(task.id);
    }

    try {
      const db = await this.getDB();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readwrite');
        const store = transaction.objectStore(TASKS_STORE);
        const request = store.put(task);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });

      // Resolve the pending promise if it existed
      if (pendingPromise) {
        pendingPromise.resolve();
      }
    } catch (error) {
      console.error('[SWStorage] Failed to save task:', error);
      if (pendingPromise) {
        pendingPromise.reject(error);
      }
      throw error;
    }
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<SWTask | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readonly');
        const store = transaction.objectStore(TASKS_STORE);
        const request = store.get(taskId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get task:', error);
      return null;
    }
  }

  /**
   * Get all tasks
   */
  async getAllTasks(): Promise<SWTask[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readonly');
        const store = transaction.objectStore(TASKS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get all tasks:', error);
      return [];
    }
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(status: string): Promise<SWTask[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readonly');
        const store = transaction.objectStore(TASKS_STORE);
        const index = store.index('status');
        const request = index.getAll(status);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get tasks by status:', error);
      return [];
    }
  }

  /**
   * Get tasks with pagination using cursor
   * @param options Pagination options
   * @returns Paginated tasks and metadata
   */
  async getTasksPaginated(options: {
    offset: number;
    limit: number;
    status?: string;
    type?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ tasks: SWTask[]; total: number; hasMore: boolean }> {
    const { offset, limit, status, type, sortOrder = 'desc' } = options;

    try {
      const db = await this.getDB();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readonly');
        const store = transaction.objectStore(TASKS_STORE);
        const index = store.index('createdAt');

        // Use cursor to iterate with pagination (filteredTotal is calculated during iteration)
        const direction: IDBCursorDirection =
          sortOrder === 'desc' ? 'prev' : 'next';
        const cursorRequest = index.openCursor(null, direction);

        const tasks: SWTask[] = [];
        let skipped = 0;
        let filteredTotal = 0;

        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
            .result;

          if (!cursor) {
            // No more entries
            resolve({
              tasks,
              total: filteredTotal,
              hasMore: filteredTotal > offset + tasks.length,
            });
            return;
          }

          const task = cursor.value as SWTask;

          // Apply filters
          const matchesStatus = !status || task.status === status;
          const matchesType = !type || task.type === type;

          if (matchesStatus && matchesType) {
            filteredTotal++;

            if (skipped < offset) {
              // Skip items before offset
              skipped++;
            } else if (tasks.length < limit) {
              // Collect items within limit
              tasks.push(task);
            }
          }

          cursor.continue();
        };
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get paginated tasks:', error);
      return { tasks: [], total: 0, hasMore: false };
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(TASKS_STORE, 'readwrite');
        const store = transaction.objectStore(TASKS_STORE);
        const request = store.delete(taskId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to delete task:', error);
    }
  }

  /**
   * Get a specific configuration by key
   */
  async getConfig<T>(key: 'gemini' | 'video'): Promise<T | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG_STORE, 'readonly');
        const store = transaction.objectStore(CONFIG_STORE);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          if (!result) {
            resolve(null);
            return;
          }
          // Remove the 'key' field from result
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { key: _, ...config } = result;
          resolve(config as T);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get config:',
        getSafeErrorMessage(error)
      );
      return null;
    }
  }

  /**
   * Save a configuration by key
   * 持久化配置到 IndexedDB，确保 SW 重启后可恢复
   */
  async saveConfig<T extends object>(
    key: 'gemini' | 'video',
    config: T
  ): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG_STORE, 'readwrite');
        const store = transaction.objectStore(CONFIG_STORE);
        store.put({
          key,
          ...config,
          updatedAt: Date.now(),
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to save config:',
        getSafeErrorMessage(error)
      );
      throw error;
    }
  }

  /**
   * Load both gemini and video configurations
   * 便捷方法，一次性加载两个配置
   */
  async loadConfig(): Promise<{
    geminiConfig: GeminiConfig | null;
    videoConfig: VideoAPIConfig | null;
  }> {
    const geminiConfig = await this.getConfig<GeminiConfig>('gemini');
    const videoConfig = await this.getConfig<VideoAPIConfig>('video');
    return { geminiConfig, videoConfig };
  }

  /**
   * Save both gemini and video configurations
   * 便捷方法，一次性保存两个配置
   */
  async saveAllConfig(
    geminiConfig: GeminiConfig,
    videoConfig: VideoAPIConfig
  ): Promise<void> {
    await this.saveConfig('gemini', geminiConfig);
    await this.saveConfig('video', videoConfig);
  }

  // ============================================================================
  // MCP System Prompt Storage Methods
  // ============================================================================

  /**
   * Save MCP system prompt to IndexedDB
   * Called from main thread during initialization
   */
  async saveSystemPrompt(systemPrompt: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG_STORE, 'readwrite');
        const store = transaction.objectStore(CONFIG_STORE);
        store.put({
          key: 'systemPrompt',
          value: systemPrompt,
          updatedAt: Date.now(),
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to save system prompt:', error);
    }
  }

  /**
   * Get MCP system prompt from IndexedDB
   * Called from SW during AI analysis
   */
  async getSystemPrompt(): Promise<string | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CONFIG_STORE, 'readonly');
        const store = transaction.objectStore(CONFIG_STORE);
        const request = store.get('systemPrompt');

        request.onsuccess = () => {
          const result = request.result;
          resolve(result?.value || null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get system prompt:', error);
      return null;
    }
  }

  // ============================================================================
  // Workflow Storage Methods
  // ============================================================================

  /**
   * Save a workflow to IndexedDB
   */
  async saveWorkflow(workflow: Workflow): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(WORKFLOWS_STORE, 'readwrite');
        const store = transaction.objectStore(WORKFLOWS_STORE);
        const request = store.put(workflow);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to save workflow:', error);
    }
  }

  /**
   * Get a workflow by ID
   */
  async getWorkflow(workflowId: string): Promise<Workflow | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(WORKFLOWS_STORE, 'readonly');
        const store = transaction.objectStore(WORKFLOWS_STORE);
        const request = store.get(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get workflow:', error);
      return null;
    }
  }

  /**
   * Get all workflows
   */
  async getAllWorkflows(): Promise<Workflow[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(WORKFLOWS_STORE, 'readonly');
        const store = transaction.objectStore(WORKFLOWS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get all workflows:', error);
      return [];
    }
  }

  /**
   * Get workflows by status
   */
  async getWorkflowsByStatus(status: string): Promise<Workflow[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(WORKFLOWS_STORE, 'readonly');
        const store = transaction.objectStore(WORKFLOWS_STORE);
        const index = store.index('status');
        const request = index.getAll(status);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get workflows by status:', error);
      return [];
    }
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(WORKFLOWS_STORE, 'readwrite');
        const store = transaction.objectStore(WORKFLOWS_STORE);
        const request = store.delete(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to delete workflow:', error);
    }
  }

  // ============================================================================
  // Chat Workflow Storage Methods
  // ============================================================================

  /**
   * Save a chat workflow to IndexedDB
   */
  async saveChatWorkflow(workflow: ChatWorkflow): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CHAT_WORKFLOWS_STORE, 'readwrite');
        const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
        const request = store.put(workflow);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to save chat workflow:', error);
    }
  }

  /**
   * Get a chat workflow by ID
   */
  async getChatWorkflow(workflowId: string): Promise<ChatWorkflow | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CHAT_WORKFLOWS_STORE, 'readonly');
        const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
        const request = store.get(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get chat workflow:', error);
      return null;
    }
  }

  /**
   * Get all chat workflows
   */
  async getAllChatWorkflows(): Promise<ChatWorkflow[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CHAT_WORKFLOWS_STORE, 'readonly');
        const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get all chat workflows:', error);
      return [];
    }
  }

  /**
   * Get chat workflows by status
   */
  async getChatWorkflowsByStatus(status: string): Promise<ChatWorkflow[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CHAT_WORKFLOWS_STORE, 'readonly');
        const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
        const index = store.index('status');
        const request = index.getAll(status);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get chat workflows by status:',
        error
      );
      return [];
    }
  }

  /**
   * Delete a chat workflow
   */
  async deleteChatWorkflow(workflowId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(CHAT_WORKFLOWS_STORE, 'readwrite');
        const store = transaction.objectStore(CHAT_WORKFLOWS_STORE);
        const request = store.delete(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to delete chat workflow:', error);
    }
  }

  // ============================================================================
  // Pending Tool Request Storage Methods
  // ============================================================================

  /**
   * Save a pending tool request to IndexedDB
   */
  async savePendingToolRequest(
    request: StoredPendingToolRequest
  ): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_TOOL_REQUESTS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
        const req = store.put(request);

        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to save pending tool request:', error);
    }
  }

  /**
   * Get all pending tool requests
   */
  async getAllPendingToolRequests(): Promise<StoredPendingToolRequest[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_TOOL_REQUESTS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get all pending tool requests:',
        error
      );
      return [];
    }
  }

  /**
   * Get pending tool requests by workflow ID
   */
  async getPendingToolRequestsByWorkflow(
    workflowId: string
  ): Promise<StoredPendingToolRequest[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_TOOL_REQUESTS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
        const index = store.index('workflowId');
        const request = index.getAll(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get pending tool requests by workflow:',
        error
      );
      return [];
    }
  }

  /**
   * Get a pending tool request by requestId
   */
  async getPendingToolRequest(
    requestId: string
  ): Promise<StoredPendingToolRequest | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_TOOL_REQUESTS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
        const request = store.get(requestId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get pending tool request:', error);
      return null;
    }
  }

  /**
   * Delete a pending tool request
   */
  async deletePendingToolRequest(requestId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_TOOL_REQUESTS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(PENDING_TOOL_REQUESTS_STORE);
        const request = store.delete(requestId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete pending tool request:',
        error
      );
    }
  }

  /**
   * Delete all pending tool requests for a workflow
   */
  async deletePendingToolRequestsByWorkflow(workflowId: string): Promise<void> {
    try {
      const requests = await this.getPendingToolRequestsByWorkflow(workflowId);
      for (const request of requests) {
        await this.deletePendingToolRequest(request.requestId);
      }
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete pending tool requests by workflow:',
        error
      );
    }
  }

  /**
   * Cleanup stale pending tool requests older than maxAgeMs
   * @param maxAgeMs Maximum age in milliseconds (default: 1 hour)
   * @returns Number of requests deleted
   */
  async cleanupStalePendingToolRequests(maxAgeMs = 3600000): Promise<number> {
    try {
      const db = await this.getDB();
      const cutoff = Date.now() - maxAgeMs;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(PENDING_TOOL_REQUESTS_STORE, 'readwrite');
        const store = tx.objectStore(PENDING_TOOL_REQUESTS_STORE);
        const cursorReq = store.openCursor();
        let deleted = 0;

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return; // tx.oncomplete will resolve
          if (cursor.value.createdAt < cutoff) {
            cursor.delete();
            deleted++;
          }
          cursor.continue();
        };

        tx.oncomplete = () => {
          resolve(deleted);
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to cleanup stale pending tool requests:',
        error
      );
      return 0;
    }
  }

  // ============================================================================
  // Pending DOM Operations Storage Methods
  // ============================================================================

  /**
   * Save a pending DOM operation to IndexedDB
   * Called when a main-thread tool result is ready but no client is available
   */
  async savePendingDomOperation(operation: PendingDomOperation): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_DOM_OPERATIONS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
        const request = store.put(operation);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to save pending DOM operation:', error);
    }
  }

  /**
   * Get all pending DOM operations
   */
  async getAllPendingDomOperations(): Promise<PendingDomOperation[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_DOM_OPERATIONS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get all pending DOM operations:',
        error
      );
      return [];
    }
  }

  /**
   * Get pending DOM operations by workflow ID
   */
  async getPendingDomOperationsByWorkflow(
    workflowId: string
  ): Promise<PendingDomOperation[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_DOM_OPERATIONS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
        const index = store.index('workflowId');
        const request = index.getAll(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get pending DOM operations by workflow:',
        error
      );
      return [];
    }
  }

  /**
   * Get pending DOM operations by chat ID
   */
  async getPendingDomOperationsByChatId(
    chatId: string
  ): Promise<PendingDomOperation[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_DOM_OPERATIONS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
        const index = store.index('chatId');
        const request = index.getAll(chatId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get pending DOM operations by chat ID:',
        error
      );
      return [];
    }
  }

  /**
   * Get a pending DOM operation by ID
   */
  async getPendingDomOperation(
    operationId: string
  ): Promise<PendingDomOperation | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_DOM_OPERATIONS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
        const request = store.get(operationId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get pending DOM operation:', error);
      return null;
    }
  }

  /**
   * Delete a pending DOM operation
   */
  async deletePendingDomOperation(operationId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_DOM_OPERATIONS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(PENDING_DOM_OPERATIONS_STORE);
        const request = store.delete(operationId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete pending DOM operation:',
        error
      );
    }
  }

  /**
   * Delete all pending DOM operations for a workflow
   */
  async deletePendingDomOperationsByWorkflow(
    workflowId: string
  ): Promise<void> {
    try {
      const operations = await this.getPendingDomOperationsByWorkflow(
        workflowId
      );
      for (const op of operations) {
        await this.deletePendingDomOperation(op.id);
      }
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete pending DOM operations by workflow:',
        error
      );
    }
  }

  /**
   * Delete all pending DOM operations for a chat
   */
  async deletePendingDomOperationsByChatId(chatId: string): Promise<void> {
    try {
      const operations = await this.getPendingDomOperationsByChatId(chatId);
      for (const op of operations) {
        await this.deletePendingDomOperation(op.id);
      }
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete pending DOM operations by chat ID:',
        error
      );
    }
  }

  // ============================================================================
  // Task-Step Mapping Storage Methods (for unified progress sync)
  // ============================================================================

  /**
   * Save a task-step mapping to IndexedDB
   */
  async saveTaskStepMapping(mapping: TaskStepMapping): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          TASK_STEP_MAPPINGS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
        const request = store.put(mapping);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to save task-step mapping:', error);
    }
  }

  /**
   * Get all task-step mappings
   */
  async getAllTaskStepMappings(): Promise<TaskStepMapping[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          TASK_STEP_MAPPINGS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get all task-step mappings:', error);
      return [];
    }
  }

  /**
   * Get task-step mapping by task ID
   */
  async getTaskStepMapping(taskId: string): Promise<TaskStepMapping | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          TASK_STEP_MAPPINGS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
        const request = store.get(taskId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to get task-step mapping:', error);
      return null;
    }
  }

  /**
   * Get task-step mappings by workflow ID
   */
  async getTaskStepMappingsByWorkflow(
    workflowId: string
  ): Promise<TaskStepMapping[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          TASK_STEP_MAPPINGS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
        const index = store.index('workflowId');
        const request = index.getAll(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get task-step mappings by workflow:',
        error
      );
      return [];
    }
  }

  /**
   * Delete a task-step mapping
   */
  async deleteTaskStepMapping(taskId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          TASK_STEP_MAPPINGS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(TASK_STEP_MAPPINGS_STORE);
        const request = store.delete(taskId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('[SWStorage] Failed to delete task-step mapping:', error);
    }
  }

  /**
   * Delete all task-step mappings for a workflow
   */
  async deleteTaskStepMappingsByWorkflow(workflowId: string): Promise<void> {
    try {
      const mappings = await this.getTaskStepMappingsByWorkflow(workflowId);
      for (const mapping of mappings) {
        await this.deleteTaskStepMapping(mapping.taskId);
      }
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete task-step mappings by workflow:',
        error
      );
    }
  }

  // ============================================================================
  // Pending Canvas Operation Storage Methods (for canvas operation retry)
  // ============================================================================

  /**
   * Save a pending canvas operation to IndexedDB
   */
  async savePendingCanvasOperation(
    operation: PendingCanvasOperation
  ): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_CANVAS_OPERATIONS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
        const request = store.put(operation);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to save pending canvas operation:',
        error
      );
    }
  }

  /**
   * Get all pending canvas operations
   */
  async getAllPendingCanvasOperations(): Promise<PendingCanvasOperation[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_CANVAS_OPERATIONS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get all pending canvas operations:',
        error
      );
      return [];
    }
  }

  /**
   * Get pending canvas operations by workflow ID
   */
  async getPendingCanvasOperationsByWorkflow(
    workflowId: string
  ): Promise<PendingCanvasOperation[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_CANVAS_OPERATIONS_STORE,
          'readonly'
        );
        const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
        const index = store.index('workflowId');
        const request = index.getAll(workflowId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to get pending canvas operations by workflow:',
        error
      );
      return [];
    }
  }

  /**
   * Delete a pending canvas operation
   */
  async deletePendingCanvasOperation(operationId: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(
          PENDING_CANVAS_OPERATIONS_STORE,
          'readwrite'
        );
        const store = transaction.objectStore(PENDING_CANVAS_OPERATIONS_STORE);
        const request = store.delete(operationId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete pending canvas operation:',
        error
      );
    }
  }

  /**
   * Delete all pending canvas operations for a workflow
   */
  async deletePendingCanvasOperationsByWorkflow(
    workflowId: string
  ): Promise<void> {
    try {
      const operations = await this.getPendingCanvasOperationsByWorkflow(
        workflowId
      );
      for (const op of operations) {
        await this.deletePendingCanvasOperation(op.id);
      }
    } catch (error) {
      console.error(
        '[SWStorage] Failed to delete pending canvas operations by workflow:',
        error
      );
    }
  }

  /**
   * 归档超出保留限制的终态任务（标记 archived=true）
   * SW 启动时调用，确保 IndexedDB 中活跃任务数量受控
   * @param maxRetained 最大保留活跃任务数
   */
  async archiveOldTasks(maxRetained = 100): Promise<number> {
    try {
      const db = await this.getDB();
      // 先统计非归档任务数量
      const allTasks = await new Promise<SWTask[]>((resolve, reject) => {
        const tx = db.transaction(TASKS_STORE, 'readonly');
        const store = tx.objectStore(TASKS_STORE);
        const index = store.index('createdAt');
        const results: SWTask[] = [];
        const cursorReq = index.openCursor(null, 'next'); // 最旧的在前

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) {
            resolve(results);
            return;
          }
          const task = cursor.value as SWTask;
          if (!task.archived) {
            results.push(task);
          }
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });

      const toArchiveCount = allTasks.length - maxRetained;
      if (toArchiveCount <= 0) return 0;

      // 从最旧的开始，归档终态任务
      const terminalStatuses = ['completed', 'failed', 'cancelled'];
      const toArchive = allTasks
        .filter((t) => terminalStatuses.includes(t.status as string))
        .slice(0, toArchiveCount);

      if (toArchive.length === 0) return 0;

      const now = Date.now();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(TASKS_STORE, 'readwrite');
        const store = tx.objectStore(TASKS_STORE);
        for (const task of toArchive) {
          task.archived = true;
          task.updatedAt = now;
          store.put(task);
        }
        tx.oncomplete = () => {
          resolve(toArchive.length);
        };
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      console.error('[SWStorage] Failed to archive old tasks:', error);
      return 0;
    }
  }
}

// Singleton instance
export const taskQueueStorage = new TaskQueueStorage();
