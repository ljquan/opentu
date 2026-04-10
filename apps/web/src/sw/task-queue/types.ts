/**
 * Service Worker Task Queue Type Definitions
 *
 * Defines all types for SW-based task queue management and
 * postMessage communication between main thread and Service Worker.
 *
 * Core types are imported from the shared types module to ensure consistency.
 * 核心类型从共享类型模块导入，确保与主线程一致。
 */

// ============================================================================
// Re-export Core Types from Shared Module
// ============================================================================

// Re-export all core types from shared module
// Import types for use in this file
// Note: TaskType is an enum used as a value, so it cannot be type-only import
import {
  TaskType,
  TaskStatus,
  GenerationParams,
  TaskResult,
  TaskError,
  TaskExecutionPhase,
} from '../../../../../packages/drawnix/src/types/shared/core.types';

export * from '../../../../../packages/drawnix/src/types/shared/core.types';

// ============================================================================
// Task Config
// ============================================================================

/**
 * 任务执行配置
 * 每次任务创建时由应用层传递，SW 不维护配置状态
 */
export interface TaskConfig {
  apiKey: string;
  baseUrl: string;
  modelName?: string;
  textModelName?: string;
}

// ============================================================================
// SW Task Definition
// ============================================================================

/**
 * Task stored and managed within Service Worker
 */
export interface SWTask {
  /** Unique task identifier (UUID v4) */
  id: string;
  /** Type of content to generate */
  type: TaskType;
  /** Current task status */
  status: TaskStatus;
  /** Parameters for content generation */
  params: GenerationParams;
  /** Task execution config (passed from main thread) */
  config: TaskConfig;
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
  /** Whether the task has been archived (excluded from active loading) */
  archived?: boolean;
}

// ============================================================================
// Chat Types
// ============================================================================

/**
 * Chat message for streaming
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Attachments (base64 encoded) */
  attachments?: ChatAttachment[];
}

/**
 * Chat attachment (image/file)
 */
export interface ChatAttachment {
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  /** Base64 encoded data */
  data: string;
}

/**
 * Chat request parameters
 */
export interface ChatParams {
  /** Chat history messages */
  messages: ChatMessage[];
  /** New message content */
  newContent: string;
  /** Attachments for the new message */
  attachments?: ChatAttachment[];
  /** Temporary model override */
  temporaryModel?: string;
  /** System prompt (for MCP tools) */
  systemPrompt?: string;
}

/**
 * Chat stream event types
 */
export type ChatStreamEventType = 'content' | 'done' | 'error';

/**
 * Chat stream event
 */
export interface ChatStreamEvent {
  type: ChatStreamEventType;
  content?: string;
  error?: string;
}

// ============================================================================
// API Configuration
// ============================================================================

/**
 * Gemini API configuration passed from main thread
 */
export interface GeminiConfig {
  apiKey: string;
  baseUrl: string;
  modelName?: string;
  /** Text model for ai_analyze (e.g., 'deepseek-v3.2', 'gemini-2.0-flash-exp') */
  textModelName?: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

/**
 * Video API configuration
 */
export interface VideoAPIConfig {
  baseUrl: string;
  apiKey?: string;
}

// ============================================================================
// Main Thread → Service Worker Messages
// ============================================================================
// Service Worker → Main Thread Messages
// ============================================================================

/**
 * Task queue initialized
 */
export interface TaskQueueInitializedMessage {
  type: 'TASK_QUEUE_INITIALIZED';
  success: boolean;
  error?: string;
}

/**
 * Task status update
 */
export interface TaskStatusMessage {
  type: 'TASK_STATUS';
  taskId: string;
  status: TaskStatus;
  progress?: number;
  phase?: TaskExecutionPhase;
  remoteId?: string;
  updatedAt: number;
}

/**
 * Task completed successfully
 */
export interface TaskCompletedMessage {
  type: 'TASK_COMPLETED';
  taskId: string;
  result: TaskResult;
  completedAt: number;
  remoteId?: string; // Include remoteId for recovery
}

/**
 * Task failed
 */
export interface TaskFailedMessage {
  type: 'TASK_FAILED';
  taskId: string;
  error: TaskError;
}

/**
 * Task submitted to remote API
 */
export interface TaskSubmittedMessage {
  type: 'TASK_SUBMITTED';
  taskId: string;
  remoteId: string;
}

/**
 * Task created (new task added to queue)
 */
export interface TaskCreatedMessage {
  type: 'TASK_CREATED';
  task: SWTask;
}

/**
 * Task cancelled
 */
export interface TaskCancelledMessage {
  type: 'TASK_CANCELLED';
  taskId: string;
}

/**
 * Task deleted
 */
export interface TaskDeletedMessage {
  type: 'TASK_DELETED';
  taskId: string;
}

/**
 * Task rejected (before creation, e.g., missing config)
 */
export interface TaskRejectedMessage {
  type: 'TASK_REJECTED';
  taskId: string;
  reason: string;
}

/**
 * Chat stream chunk
 */
export interface ChatChunkMessage {
  type: 'CHAT_CHUNK';
  chatId: string;
  content: string;
}

/**
 * Chat stream completed
 */
export interface ChatDoneMessage {
  type: 'CHAT_DONE';
  chatId: string;
  fullContent: string;
}

/**
 * Chat stream error
 */
export interface ChatErrorMessage {
  type: 'CHAT_ERROR';
  chatId: string;
  error: string;
}

/**
 * Cached chat result response (for recovery after page refresh)
 */
export interface ChatCachedResultMessage {
  type: 'CHAT_CACHED_RESULT';
  chatId: string;
  fullContent?: string;
  found: boolean;
}

/**
 * MCP Tool Execute Result - SW returns tool execution result
 */
export interface MCPToolResultMessage {
  type: 'MCP_TOOL_RESULT';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  resultType?: 'image' | 'video' | 'text' | 'canvas' | 'error';
  taskId?: string;
}

/**
 * Union type for all SW to main thread messages
 */
export type SWToMainMessage =
  | TaskQueueInitializedMessage
  | TaskStatusMessage
  | TaskCompletedMessage
  | TaskFailedMessage
  | TaskSubmittedMessage
  | TaskCreatedMessage
  | TaskCancelledMessage
  | TaskDeletedMessage
  | TaskRejectedMessage
  | ChatChunkMessage
  | ChatDoneMessage
  | ChatErrorMessage
  | ChatCachedResultMessage
  | MCPToolResultMessage;

// ============================================================================
// Handler Types
// ============================================================================

/**
 * Task handler interface
 */
export interface TaskHandler {
  /** Execute the task */
  execute(task: SWTask, config: HandlerConfig): Promise<TaskResult>;
  /** Cancel the task */
  cancel(taskId: string): void;
  /** Resume a task (for video polling) */
  resume?(task: SWTask, config: HandlerConfig): Promise<TaskResult>;
}

/**
 * Handler configuration
 */
export interface HandlerConfig {
  geminiConfig: GeminiConfig;
  videoConfig: VideoAPIConfig;
  /** Callback to send progress updates */
  onProgress: (
    taskId: string,
    progress: number,
    phase?: TaskExecutionPhase
  ) => void;
  /** Callback when remote ID is received */
  onRemoteId: (taskId: string, remoteId: string) => void;
}

/**
 * Chat handler interface
 */
export interface ChatHandler {
  /** Start streaming chat */
  stream(
    chatId: string,
    params: ChatParams,
    config: GeminiConfig,
    onChunk: (content: string) => void
  ): Promise<string>;
  /** Stop streaming */
  stop(chatId: string): void;
}

// ============================================================================
// Queue Configuration
// ============================================================================

/**
 * Task queue configuration
 */
export interface TaskQueueConfig {
  /** Task timeout in milliseconds by type */
  timeouts: Record<TaskType, number>;
}

/**
 * Default task queue configuration
 */
export const DEFAULT_TASK_QUEUE_CONFIG: TaskQueueConfig = {
  timeouts: {
    [TaskType.IMAGE]: 10 * 60 * 1000, // 10 minutes for image
    [TaskType.VIDEO]: 20 * 60 * 1000, // 20 minutes for video
    [TaskType.AUDIO]: 30 * 60 * 1000, // 30 minutes for audio
    [TaskType.CHARACTER]: 10 * 60 * 1000, // 10 minutes
    [TaskType.INSPIRATION_BOARD]: 10 * 60 * 1000, // 10 minutes (same as image)
    [TaskType.CHAT]: 10 * 60 * 1000, // 10 minutes
  },
};
