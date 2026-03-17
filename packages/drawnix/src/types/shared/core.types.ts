/**
 * Core Type Definitions - Shared between Main Thread and Service Worker
 *
 * This is the single source of truth for task and workflow types.
 * Both main thread and SW import from here to ensure type consistency.
 *
 * 这是任务和工作流类型的唯一真相来源。
 * 主线程和 SW 都从这里导入，确保类型一致性。
 */

// ============================================================================
// Chat Tool Call
// ============================================================================

/**
 * Chat tool call interface
 * Represents a tool call made during AI chat/analysis
 */
export interface ChatToolCall {
  /** Tool name (e.g., 'generate_image', 'generate_video') */
  name: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
  /** Tool call result */
  result?: {
    success: boolean;
    taskId?: string;
    error?: string;
    data?: unknown;
  };
}

// ============================================================================
// Task Enums
// ============================================================================

/**
 * Task status enumeration
 * Represents all possible states a task can be in during its lifecycle
 */
export enum TaskStatus {
  /** Task is waiting to be executed */
  PENDING = 'pending',
  /** Task is currently being processed */
  PROCESSING = 'processing',
  /** Task completed successfully */
  COMPLETED = 'completed',
  /** Task failed */
  FAILED = 'failed',
  /** Task was cancelled by the user */
  CANCELLED = 'cancelled',
}

/**
 * Task type enumeration
 * Defines the types of content that can be generated
 */
export enum TaskType {
  /** Image generation task */
  IMAGE = 'image',
  /** Video generation task */
  VIDEO = 'video',
  /** Character extraction task */
  CHARACTER = 'character',
  /** Inspiration board generation task (image + split + layout) */
  INSPIRATION_BOARD = 'inspiration_board',
  /** Chat/AI analysis task (text model streaming) */
  CHAT = 'chat',
}

/**
 * Task execution phase enumeration
 * Used for tracking async task progress and enabling recovery after page refresh
 */
export enum TaskExecutionPhase {
  /** Task is being submitted to the API */
  SUBMITTING = 'submitting',
  /** Task submitted, polling for completion (video only) */
  POLLING = 'polling',
  /** Task completed, downloading result */
  DOWNLOADING = 'downloading',
}

// ============================================================================
// Generation Parameters
// ============================================================================

/**
 * Generation parameters interface
 * Contains all parameters needed for AI content generation
 */
import type { ModelRef } from '../../utils/settings-manager';

export interface GenerationParams {
  /** Text prompt describing the desired content */
  prompt: string;
  /** Image/video width in pixels */
  width?: number;
  /** Image/video height in pixels */
  height?: number;
  /** Size parameter for API (e.g., '16x9', '1x1') */
  size?: string;
  /** Video duration in seconds (video only) */
  duration?: number;
  /** Style or model to use for generation */
  style?: string;
  /** AI model to use (e.g., 'veo3', 'sora-2') */
  model?: string;
  /** 运行时模型来源引用（用于按供应商路由） */
  modelRef?: ModelRef | null;
  /** Random seed for reproducible generation */
  seed?: number;
  /** Source video task ID for character extraction */
  sourceVideoTaskId?: string;
  /** Time range for character extraction (format: "start,end") */
  characterTimestamps?: string;
  /** Local task ID of source video */
  sourceLocalTaskId?: string;
  /** Grid image grid rows (grid_image only) */
  gridImageRows?: number;
  /** Grid image grid columns (grid_image only) */
  gridImageCols?: number;
  /** Grid image layout style (grid_image only) */
  gridImageLayoutStyle?: 'scattered' | 'grid' | 'circular';
  /** Inspiration board layout style (inspiration_board only) */
  inspirationBoardLayoutStyle?: 'inspiration-board';
  /** Whether this is an inspiration board task */
  isInspirationBoard?: boolean;
  /** Inspiration board image count */
  inspirationBoardImageCount?: number;
  /** Whether to auto-insert the result to canvas when task completes */
  autoInsertToCanvas?: boolean;
  /** Additional parameters for specific generation types */
  [key: string]: any;
}

// ============================================================================
// Task Result
// ============================================================================

/**
 * Task result interface
 * Contains the output from a successfully completed task
 */
export interface TaskResult {
  /** URL to the generated content */
  url: string;
  /** Multiple URLs when API returns more than one asset */
  urls?: string[];
  /** Optional thumbnail URLs corresponding to urls */
  thumbnailUrls?: string[];
  /** File format (e.g., 'png', 'jpg', 'mp4') */
  format: string;
  /** File size in bytes */
  size: number;
  /** Content width in pixels */
  width?: number;
  /** Content height in pixels */
  height?: number;
  /** Video duration in seconds (video only) */
  duration?: number;
  /** Video thumbnail URL (video only) */
  thumbnailUrl?: string;
  /** Character username for @mention (character only) */
  characterUsername?: string;
  /** Character profile picture URL (character only) */
  characterProfileUrl?: string;
  /** Character permalink (character only) */
  characterPermalink?: string;
  /** Chat response content (chat only) */
  chatResponse?: string;
  /** Tool calls made during chat (chat only) */
  toolCalls?: ChatToolCall[];
}

// ============================================================================
// Task Error
// ============================================================================

/**
 * Task error details interface
 * Contains the original error information for debugging
 */
export interface TaskErrorDetails {
  /** Original error message from the API or system */
  originalError?: string;
  /** API response data (sensitive info filtered) */
  apiResponse?: any;
  /** Error occurrence timestamp */
  timestamp?: number;
}

/**
 * Task error interface
 * Contains detailed information about task failures
 */
export interface TaskError {
  /** Error code for categorization (e.g., 'TIMEOUT', 'NETWORK', 'API_ERROR') */
  code: string;
  /** Human-readable error message (user-friendly) */
  message: string;
  /** Detailed error information for debugging */
  details?: TaskErrorDetails;
}

// ============================================================================
// Task Interface
// ============================================================================

/**
 * Core task interface
 * Represents a single generation task with all its metadata
 */
export interface Task {
  /** Unique task identifier (UUID v4) */
  id: string;
  /** Type of content to generate */
  type: TaskType;
  /** Current task status */
  status: TaskStatus;
  /** Parameters for content generation */
  params: GenerationParams;
  /** Task creation timestamp (Unix milliseconds) */
  createdAt: number;
  /** Last update timestamp (Unix milliseconds) */
  updatedAt: number;
  /** Execution start timestamp (Unix milliseconds) */
  startedAt?: number;
  /** Completion timestamp (Unix milliseconds) */
  completedAt?: number;
  /** Generation result (if successful) */
  result?: TaskResult;
  /** Error information (if failed) */
  error?: TaskError;
  /** User identifier (reserved for multi-user support) */
  userId?: string;
  /** Task progress percentage (0-100) for video generation */
  progress?: number;
  /** Remote task ID from API (e.g., videoId for video generation) */
  remoteId?: string;
  /** Current execution phase for recovery support */
  executionPhase?: TaskExecutionPhase;
  /** Whether the task result has been saved to the media library */
  savedToLibrary?: boolean;
  /** Whether the task result has been inserted to canvas */
  insertedToCanvas?: boolean;
  /** Whether the task was synced from remote (should not be resumed) */
  syncedFromRemote?: boolean;
}

// ============================================================================
// Utility Constants and Functions
// ============================================================================

/**
 * Terminal task statuses (task lifecycle has ended)
 */
export const TERMINAL_STATUSES: TaskStatus[] = [
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
];

/**
 * Retryable task statuses (task can be retried)
 */
export const RETRYABLE_STATUSES: TaskStatus[] = [
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
];

/**
 * Active task statuses (task is currently being processed)
 */
export const ACTIVE_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.PROCESSING,
];

/**
 * Check if a task status is terminal (lifecycle has ended)
 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Check if a task status is retryable
 */
export function isRetryableStatus(status: TaskStatus): boolean {
  return RETRYABLE_STATUSES.includes(status);
}

/**
 * Check if a task status is active (currently being processed)
 */
export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}
