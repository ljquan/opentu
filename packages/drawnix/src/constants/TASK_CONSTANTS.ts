/**
 * Task Queue System Constants
 * 
 * Centralized constant definitions for the task queue system.
 * All timing, limits, and configuration values are defined here.
 */

/**
 * Task timeout durations (in milliseconds)
 * Different timeouts for different content types
 * This is the total task timeout, not HTTP request timeout
 */
export const TASK_TIMEOUT = {
  /** Image generation task timeout: 45 minutes */
  IMAGE: 45 * 60 * 1000,
  /** Video generation task timeout: 1.5 hours (90 minutes) */
  VIDEO: 90 * 60 * 1000,
  /** Audio generation task timeout: 30 minutes */
  AUDIO: 30 * 60 * 1000,
} as const;

/**
 * Duplicate submission prevention window (in milliseconds)
 * Tasks with identical parameters submitted within this window are rejected
 */
export const DUPLICATE_SUBMISSION_WINDOW = 5 * 1000; // 5 seconds

/**
 * Form reset delay (in milliseconds)
 * Delay before resetting the form after task creation
 */
export const FORM_RESET_DELAY = 100; // 100ms for smooth UX

/**
 * IndexedDB configuration
 * Database settings for task persistence
 *
 * @deprecated 此配置已废弃，仅用于历史数据迁移。
 * 新代码请使用 storage-keys.ts 中的 SW_TASK_QUEUE 配置。
 */
export const INDEXEDDB_CONFIG = {
  /** Database name */
  DATABASE_NAME: 'aitu-task-queue',
  /** Database version */
  DATABASE_VERSION: 1,
  /** Object store name for tasks */
  TASKS_STORE_NAME: 'tasks',
} as const;

/**
 * Storage limits and thresholds
 */
export const STORAGE_LIMITS = {
  /** Warning threshold (50MB in bytes) */
  WARNING_THRESHOLD: 50 * 1024 * 1024,
  /** Maximum number of completed tasks to retain */
  MAX_RETAINED_TASKS: 100,
} as const;

/**
 * UI update intervals (in milliseconds)
 */
export const UPDATE_INTERVALS = {
  /** Task status polling interval */
  STATUS_POLL: 5 * 1000, // 5 seconds
  /** Storage sync debounce delay */
  STORAGE_SYNC: 500, // 500ms
  /** UI refresh throttle */
  UI_REFRESH: 100, // 100ms
} as const;

/**
 * Animation durations (in milliseconds)
 */
export const ANIMATION_DURATIONS = {
  /** Panel expand/collapse animation */
  PANEL_TOGGLE: 200,
  /** Notification display duration */
  NOTIFICATION: 5000, // 5 seconds
} as const;
