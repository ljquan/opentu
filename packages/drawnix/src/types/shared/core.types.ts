/**
 * Core Type Definitions - Shared between Main Thread and Service Worker
 *
 * This is the single source of truth for task and workflow types.
 * Both main thread and SW import from here to ensure type consistency.
 *
 * 这是任务和工作流类型的唯一真相来源。
 * 主线程和 SW 都从这里导入，确保类型一致性。
 */

import type { CacheWarning } from '../cache-warning.types';
import type { ModelRef } from '../../utils/settings-manager';

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
  /** Audio generation task */
  AUDIO = 'audio',
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

export type TaskInvocationOperation = 'image' | 'video' | 'audio' | 'text';

export interface TaskInvocationBindingSnapshot {
  id?: string;
  protocol?: string;
  requestSchema?: string;
  responseSchema?: string;
  submitPath?: string;
  pollPathTemplate?: string;
  baseUrlStrategy?: 'preserve' | 'trim-v1' | 'ensure-v1';
  metadata?: Record<string, unknown>;
}

export interface TaskInvocationRouteSnapshot {
  operation: TaskInvocationOperation;
  modelRef?: ModelRef | null;
  providerProfileId?: string | null;
  providerType?: string | null;
  modelId?: string | null;
  binding?: TaskInvocationBindingSnapshot | null;
}

// ============================================================================
// Generation Parameters
// ============================================================================

export interface KnowledgeContextRef {
  noteId: string;
  title: string;
  directoryId?: string;
  updatedAt?: number;
}

export type CanvasAssociationKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'graphics'
  | 'frame'
  | 'card'
  | 'other';

/** Lightweight canvas source identity shared by the main thread and SW. */
export interface CanvasAssociationRef {
  referenceId: string;
  boardId: string;
  elementId: string;
  kind: CanvasAssociationKind;
  label: string;
  /** Start offset of the trusted inline mention in the taskbar prompt. */
  mentionStart?: number;
  /** End offset (exclusive) of the trusted inline mention. */
  mentionEnd?: number;
}

export interface GenerationAssetMetadata {
  category?: 'GENERAL' | 'CHARACTER';
  characterName?: string;
  characterPrompt?: string;
}

export interface GenerationParams {
  /** Text prompt describing the desired content */
  prompt: string;
  /** Lightweight canvas sources explicitly mentioned for this request */
  canvasAssociations?: CanvasAssociationRef[];
  /** Lightweight asset-library metadata for generated media */
  assetMetadata?: GenerationAssetMetadata;
  /** Lightweight Knowledge Base note references used as generation context */
  knowledgeContextRefs?: KnowledgeContextRef[];
  /** Lightweight prompt lineage metadata used by prompt history views */
  promptMeta?: {
    /** Prompt entered before parsing or optimization */
    initialPrompt?: string;
    /** Prompt actually sent to the generation tool */
    sentPrompt?: string;
    /** Display title for history cards */
    title?: string;
    /** Prompt category for filtering */
    category?:
      | 'image'
      | 'video'
      | 'audio'
      | 'text'
      | 'agent'
      | 'ppt-common'
      | 'ppt-slide';
    /** Lightweight tags such as Skill names */
    tags?: string[];
    /** Lightweight Knowledge Base note references used by this prompt */
    knowledgeContextRefs?: KnowledgeContextRef[];
    /** Agent Skill identifier, when available */
    skillId?: string;
    /** Agent Skill display name, when available */
    skillName?: string;
  };
  /** Image/video width in pixels */
  width?: number;
  /** Image/video height in pixels */
  height?: number;
  /** Size parameter for API (e.g., '16x9', '1x1') */
  size?: string;
  /** Image generation mode for providers that distinguish generation/edit */
  generationMode?: 'text_to_image' | 'image_to_image' | 'image_edit';
  /** Whether this image task is generating a PPT slide image */
  pptSlideImage?: boolean;
  /** PPT slide-specific prompt, separated from the full generated image prompt */
  pptSlidePrompt?: string;
  /** Existing PPT slide element to replace after generation */
  pptReplaceElementId?: string;
  /** Image edit mask URL or data URL */
  maskImage?: string;
  /** Image edit input fidelity */
  inputFidelity?: 'high' | 'low';
  /** Image output background mode */
  background?: 'transparent' | 'opaque' | 'auto';
  /** Image output format */
  outputFormat?: 'png' | 'jpeg' | 'webp';
  /** Image output compression, 0-100 */
  outputCompression?: number;
  /** Video duration in seconds (video only) */
  duration?: number;
  /** Audio title */
  title?: string;
  /** Audio style tags */
  tags?: string;
  /** Whether Suno should generate instrumental-only audio */
  instrumental?: boolean;
  /** Audio model version */
  mv?: string;
  /** Suno action type (e.g. music or lyrics) */
  sunoAction?: string;
  /** Provider webhook for async completion notifications */
  notifyHook?: string;
  /** Continue from clip ID */
  continueClipId?: string;
  /** Continue from provider task ID */
  continueTaskId?: string;
  /** Continue from timestamp */
  continueAt?: number;
  /** Infill start timestamp */
  infillStartS?: number;
  /** Infill end timestamp */
  infillEndS?: number;
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

/** Controls whether a completed task result is projected into user-facing views. */
export type TaskResultVisibility = 'user' | 'internal';

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
  /** Semantic result kind for mixed-capability providers */
  resultKind?: TaskResultKind;
  /** Internal results remain available to orchestration but are not user-facing. */
  resultVisibility?: TaskResultVisibility;
  /** Content width in pixels */
  width?: number;
  /** Content height in pixels */
  height?: number;
  /** Video duration in seconds (video only) */
  duration?: number;
  /** Video thumbnail URL (video only) */
  thumbnailUrl?: string;
  /** Preview cover image URL (audio only) */
  previewImageUrl?: string;
  /** Result title (audio only) */
  title?: string;
  /** Generated lyrics text (lyrics only) */
  lyricsText?: string;
  /** Generated lyrics title (lyrics only) */
  lyricsTitle?: string;
  /** Generated lyrics style tags (lyrics only) */
  lyricsTags?: string[];
  /** Provider task ID used to fetch audio results */
  providerTaskId?: string;
  /** Primary provider clip identifier for audio follow-up actions */
  primaryClipId?: string;
  /** Ordered provider clip identifiers corresponding to urls[] */
  clipIds?: string[];
  /** Ordered clip metadata corresponding to audio outputs */
  clips?: AudioClipResult[];
  /** Character username for @mention (character only) */
  characterUsername?: string;
  /** Character profile picture URL (character only) */
  characterProfileUrl?: string;
  /** Character permalink (character only) */
  characterPermalink?: string;
  /** Chat response content (chat only) */
  chatResponse?: string;
  /** Structured analysis payload for specialized text tasks */
  analysisData?: unknown;
  /** Tool calls made during chat (chat only) */
  toolCalls?: ChatToolCall[];
  /** Cache failure warning for media results */
  cacheWarning?: CacheWarning;
}

/** Legacy results without an explicit visibility remain user-facing. */
export function isUserVisibleTaskResult(
  result: Pick<TaskResult, 'resultVisibility'> | null | undefined
): boolean {
  return result?.resultVisibility !== 'internal';
}

export type TaskResultKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'lyrics'
  | 'character'
  | 'chat';

export interface AudioClipResult {
  /** Provider entity id */
  id?: string;
  /** Provider clip id */
  clipId?: string;
  /** Display title */
  title?: string;
  /** Provider clip status */
  status?: string;
  /** Playable audio URL */
  audioUrl: string;
  /** Preview cover image */
  imageUrl?: string;
  /** High resolution preview cover image */
  imageLargeUrl?: string;
  /** Clip duration in seconds */
  duration?: number | null;
  /** Provider model name */
  modelName?: string;
  /** Provider major model version */
  majorModelVersion?: string;
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

export type ImageRecoveryStatus =
  | 'idle'
  | 'checking'
  | 'processing_or_not_found'
  | 'succeeded'
  | 'failed';

/** Image URLs recovered from the provider after the original response was lost. */
export interface ImageRecoveryInfo {
  /** Provider-side request ID returned by X-Oneapi-Request-Id, used as fallback. */
  requestId?: string;
  /** Full lookup endpoint using the stable local task ID sent as X-Request-Id. */
  url?: string;
  status: ImageRecoveryStatus;
  /** Original provider URLs. Keep these separate from locally cached task results. */
  urls?: string[];
  message?: string;
  checkedAt: number;
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
  /** Provider/model route snapshot used to resume async tasks with the original supplier */
  invocationRoute?: TaskInvocationRouteSnapshot;
  /** Current execution phase for recovery support */
  executionPhase?: TaskExecutionPhase;
  /** Provider image recovery state and original recovered URLs. */
  imageRecovery?: ImageRecoveryInfo;
  /** Whether the task result has been saved to the media library */
  savedToLibrary?: boolean;
  /** Whether the task result has been inserted to canvas */
  insertedToCanvas?: boolean;
  /** Whether the task was synced from remote (should not be resumed) */
  syncedFromRemote?: boolean;
  /** Whether the task has been archived (excluded from active loading) */
  archived?: boolean;
}

/** Internal orchestration tasks stay available to services but not user task views. */
export function isUserVisibleTask(
  task: Pick<Task, 'params' | 'result'>
): boolean {
  return (
    task.params.resultVisibility !== 'internal' &&
    task.result?.resultVisibility !== 'internal'
  );
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
