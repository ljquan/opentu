/**
 * Task Queue Service
 *
 * Core service for managing the task queue lifecycle.
 * Implements singleton pattern and uses RxJS for event-driven architecture.
 *
 * In fallback mode (SW disabled), this service directly writes to IndexedDB
 * via taskStorageWriter to ensure data persistence.
 */

import { Subject, Observable } from 'rxjs';
import {
  Task,
  TaskStatus,
  TaskType,
  TaskEvent,
  GenerationParams,
  TaskExecutionPhase,
} from '../types/task.types';
import { generateTaskId, isTaskActive } from '../utils/task-utils';
import {
  validateGenerationParams,
  sanitizeGenerationParams,
} from '../utils/validation-utils';
import {
  taskStorageWriter,
  type SWTask,
} from './media-executor/task-storage-writer';
import { taskStorageReader } from './task-storage-reader';
import { executorFactory, waitForTaskCompletion } from './media-executor';
import { hasInvocationRouteCredentials } from '../utils/settings-manager';
import { DEFAULT_AUDIO_MODEL_ID } from '../constants/model-config';
import { analytics } from '../utils/posthog-analytics';
import {
  getAdapterContextFromSettings,
  resolveAdapterForInvocation,
} from './model-adapters';
import { cacheRemoteUrl } from './media-executor/fallback-utils';
import {
  IMAGE_GENERATION_TIMEOUT_MS,
  STORAGE_LIMITS,
} from '../constants/TASK_CONSTANTS';
import { sendChatWithGemini } from '../utils/gemini-api/services';
import type { GeminiMessage } from '../utils/gemini-api/types';
import { buildInlineDataPart } from '../utils/gemini-api/message-utils';
import { unifiedCacheService } from './unified-cache-service';
import { buildGenerateContentConfig } from './analysis-core';
import {
  createTaskInvocationRouteSnapshotFromTask,
  mergeTaskInvocationRoute,
} from './task-invocation-route';
import { callGoogleGenerateContentWithLog } from '../utils/gemini-api/logged-calls';
import { executeVideoAnalysis } from './video-analysis-service';
import {
  formatShotsMarkdown,
  type VideoAnalysisData,
} from '../components/video-analyzer/types';
import { loadRecords } from '../components/video-analyzer/storage';
import {
  parseVideoPromptGenerationResponse,
  parseScriptRewriteResponse,
} from '../components/video-analyzer/utils';
import {
  DEFAULT_MUSIC_ANALYSIS_PROMPT,
  executeMusicAnalysis,
  MAX_AUDIO_ANALYZE_FILE_SIZE,
  type MusicAnalysisData,
} from './music-analysis-service';
import { formatMusicAnalysisMarkdown } from '../components/music-analyzer/types';
import { loadRecords as loadMusicRecords } from '../components/music-analyzer/storage';
import { parseLyricsRewriteResult } from '../components/music-analyzer/utils';
import {
  buildPromptWithKnowledgeContext,
  normalizeGenerationParamsKnowledgeContext,
} from './generation-context-service';
import { MAX_VIDEO_GENERATION_PROMPT_LENGTH } from '../components/shared/workflow/prompt-builders';
import {
  createImageSubmissionParams,
  getImageSubmissionRequestId,
  imageGenerationRecoveryService,
  isImageRequestRecoveryCandidate,
} from './image-generation-recovery-service';
import { isImageSubmissionOutcomeUnknownError } from './provider-routing';

const VIDEO_ANALYZER_SIMULATED_DURATION_MS = 10 * 60 * 1000;
const VIDEO_ANALYZER_SIMULATED_INTERVAL_MS = 5000;
const VIDEO_ANALYZER_SIMULATED_START_PROGRESS = 15;
const VIDEO_ANALYZER_SIMULATED_END_PROGRESS = 95;
const VIDEO_REWRITE_SIMULATED_DURATION_MS = 2 * 60 * 1000;
const VIDEO_REWRITE_SIMULATED_INTERVAL_MS = 2000;
const VIDEO_REWRITE_SIMULATED_START_PROGRESS = 20;
const VIDEO_REWRITE_SIMULATED_END_PROGRESS = 95;
const VIDEO_PROMPT_SIMULATED_DURATION_MS = 2 * 60 * 1000;
const VIDEO_PROMPT_SIMULATED_INTERVAL_MS = 2000;
const VIDEO_PROMPT_SIMULATED_START_PROGRESS = 20;
const VIDEO_PROMPT_SIMULATED_END_PROGRESS = 95;
const MUSIC_ANALYZER_SIMULATED_DURATION_MS = 4 * 60 * 1000;
const MUSIC_ANALYZER_SIMULATED_INTERVAL_MS = 3000;
const MUSIC_ANALYZER_SIMULATED_START_PROGRESS = 12;
const MUSIC_ANALYZER_SIMULATED_END_PROGRESS = 95;
const MUSIC_REWRITE_SIMULATED_DURATION_MS = 2 * 60 * 1000;
const MUSIC_REWRITE_SIMULATED_INTERVAL_MS = 2000;
const MUSIC_REWRITE_SIMULATED_START_PROGRESS = 20;
const MUSIC_REWRITE_SIMULATED_END_PROGRESS = 95;
const STRIPPED_TASK_PARAM_KEYS = [
  'referenceImages',
  'uploadedImages',
  'videoData',
  'audioData',
  'pdfData',
] as const;
const MAX_RECENTLY_DELETED_TASK_IDS = STORAGE_LIMITS.MAX_RETAINED_TASKS * 10;
const PPT_EXPLAINER_REMOTE_CANCEL_FAILURE_DIAGNOSTIC =
  '远端取消失败，远端任务可能继续执行和计费；可再次尝试取消';

type InsertionSource = 'manual' | 'auto_insert';
type StrippedTaskParamKey = (typeof STRIPPED_TASK_PARAM_KEYS)[number];
type TaskExecutionGuardOptions = {
  isCurrentAttempt: () => boolean;
  onProgress: (progress: { progress: number; phase?: string }) => void;
};
type ImageAttemptExecutionGuard = {
  startedAt: number;
  executionToken: symbol;
};
const STORAGE_SYNC_FIELDS = [
  'status',
  'progress',
  'result',
  'error',
  'completedAt',
  'startedAt',
  'remoteId',
  'invocationRoute',
  'insertedToCanvas',
  'executionPhase',
  'savedToLibrary',
] as const satisfies readonly (keyof Task)[];

function stableStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function areStorageSyncValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftJson = stableStringify(left);
    const rightJson = stableStringify(right);
    return leftJson !== undefined && leftJson === rightJson;
  }

  return false;
}

function hasStorageTaskChanges(
  task: Task,
  storageTask: Partial<Task>
): boolean {
  return STORAGE_SYNC_FIELDS.some((field) => {
    if (!(field in storageTask)) {
      return false;
    }
    return !areStorageSyncValuesEqual(task[field], storageTask[field]);
  });
}

function getTaskResultCount(task: Task): number {
  if (Array.isArray(task.result?.urls) && task.result.urls.length > 0) {
    return task.result.urls.length;
  }
  if (
    task.result?.url ||
    task.result?.chatResponse ||
    task.result?.lyricsText
  ) {
    return 1;
  }
  return 0;
}

function buildTaskAnalyticsPayload(task: Task): Record<string, unknown> {
  const model =
    typeof task.params.model === 'string' && task.params.model.trim()
      ? task.params.model
      : undefined;
  const modelRef = task.params.modelRef || null;
  const resultCount = getTaskResultCount(task) || undefined;
  const hasReferenceImage = Boolean(
    task.params.referenceImages?.length ||
      task.params.uploadedImages?.length ||
      task.params.uploadedImage
  );
  const promptLength =
    typeof task.params.prompt === 'string' ? task.params.prompt.length : 0;

  return {
    taskId: task.id,
    task_id: task.id,
    taskType: task.type,
    task_type: task.type,
    taskStatus: task.status,
    task_status: task.status,
    model,
    profileId: modelRef?.profileId || undefined,
    profile_id: modelRef?.profileId || undefined,
    modelRefModelId: modelRef?.modelId || undefined,
    model_ref_model_id: modelRef?.modelId || undefined,
    executionPhase: task.executionPhase,
    execution_phase: task.executionPhase,
    hasRemoteId: Boolean(task.remoteId),
    has_remote_id: Boolean(task.remoteId),
    providerProfileId: task.invocationRoute?.providerProfileId || undefined,
    provider_profile_id: task.invocationRoute?.providerProfileId || undefined,
    bindingId: task.invocationRoute?.binding?.id || undefined,
    binding_id: task.invocationRoute?.binding?.id || undefined,
    resultCount,
    result_count: resultCount,
    hasReferenceImage,
    has_reference_image: hasReferenceImage,
    promptLength,
    prompt_length: promptLength,
    source: task.params.source,
    taskSource: task.params.source,
    task_source: task.params.source,
    generationMode: task.params.generationMode,
    generation_mode: task.params.generationMode,
    size: task.params.size,
    duration: task.params.duration,
    resultKind: task.result?.resultKind,
    result_kind: task.result?.resultKind,
  };
}

function trackTaskAnalytics(
  eventName: string,
  task: Task,
  extras?: Record<string, unknown>
): void {
  analytics.track(eventName, {
    ...buildTaskAnalyticsPayload(task),
    ...(extras || {}),
  });
}

function isTrackedTerminalTaskStatus(
  status: TaskStatus
): status is TaskStatus.COMPLETED | TaskStatus.FAILED | TaskStatus.CANCELLED {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.CANCELLED
  );
}

function getTerminalTaskEventName(status: TaskStatus): string {
  if (status === TaskStatus.COMPLETED) {
    return 'generation_task_completed';
  }
  if (status === TaskStatus.FAILED) {
    return 'generation_task_failed';
  }
  return 'generation_task_cancelled';
}

function getTaskDurationMs(task: Task): number | undefined {
  if (!task.startedAt) {
    return undefined;
  }
  const endedAt = task.completedAt || task.updatedAt || Date.now();
  return Math.max(0, endedAt - task.startedAt);
}

function trackTerminalTaskAnalytics(
  task: Task,
  previousStatus?: TaskStatus,
  extras?: Record<string, unknown>
): void {
  if (
    !isTrackedTerminalTaskStatus(task.status) ||
    previousStatus === task.status
  ) {
    return;
  }

  const durationMs = getTaskDurationMs(task);
  trackTaskAnalytics(getTerminalTaskEventName(task.status), task, {
    durationMs,
    duration_ms: durationMs,
    errorCode: task.error?.code,
    error_code: task.error?.code,
    errorMessage: task.error?.message,
    error_message: task.error?.message,
    ...(extras || {}),
  });
}

function normalizeImageDataUrl(
  value: string,
  fallbackMimeType = 'image/png'
): string {
  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed || value;
  }

  const normalized = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized) || normalized.length < 32) {
    return trimmed;
  }

  return `data:${fallbackMimeType};base64,${normalized}`;
}

function normalizeComparableMediaUrl(value: string): string {
  const normalized = normalizeImageDataUrl(value);

  if (typeof window === 'undefined') {
    return normalized;
  }

  try {
    const parsed = new URL(normalized, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return parsed.toString();
    }

    parsed.searchParams.delete('_retry');
    parsed.searchParams.delete('bypass_sw');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return normalized.trim();
  }
}

function getTaskResultUrls(task: Task): string[] {
  const urls = new Set<string>();
  if (task.result?.url) {
    urls.add(task.result.url);
  }
  task.result?.urls?.forEach((url) => {
    if (url) {
      urls.add(url);
    }
  });
  return Array.from(urls);
}

function imageTaskMatchesUrl(task: Task, imageUrl: string): boolean {
  if (task.type !== TaskType.IMAGE) {
    return false;
  }

  const targetUrl = normalizeComparableMediaUrl(imageUrl);
  return getTaskResultUrls(task).some(
    (url) => normalizeComparableMediaUrl(url) === targetUrl
  );
}

function hasAnyPersistedLargeTaskParams(
  params?: Record<string, unknown> | null
): boolean {
  if (!params) {
    return false;
  }

  return STRIPPED_TASK_PARAM_KEYS.some((key) => params[key] !== undefined);
}

function mergePersistedLargeTaskParams(
  params: GenerationParams,
  persistedParams?: Record<string, unknown> | null
): GenerationParams {
  if (!persistedParams) {
    return params;
  }

  let nextParams: GenerationParams | null = null;

  STRIPPED_TASK_PARAM_KEYS.forEach((key: StrippedTaskParamKey) => {
    if (params[key] === undefined && persistedParams[key] !== undefined) {
      if (!nextParams) {
        nextParams = { ...params };
      }
      nextParams[key] = persistedParams[key];
    }
  });

  return nextParams || params;
}

async function cacheAudioCoverUrl(
  coverUrl: string | undefined,
  taskId: string,
  index?: number
): Promise<string | undefined> {
  if (!coverUrl) {
    return undefined;
  }

  try {
    return await cacheRemoteUrl(
      coverUrl,
      `${taskId}-cover`,
      'image',
      'png',
      index,
      { forceRemoteCache: true }
    );
  } catch (error) {
    console.warn(
      '[TaskQueueService] Audio cover cache failed, using original URL:',
      error
    );
    return coverUrl;
  }
}

/**
 * Task Queue Service
 * Manages task creation, updates, and lifecycle events
 */
class TaskQueueService {
  private static instance: TaskQueueService;
  private tasks: Map<string, Task>;
  private taskUpdates$: Subject<TaskEvent>;
  private executingTasks = new Map<string, AbortController>();
  private taskAbortControllers = new Map<string, AbortController>();
  private taskStorageOperations = new Map<string, Promise<void>>();
  private pendingTaskDeletions = new Map<string, Promise<void>>();
  private recentlyDeletedTaskIds = new Set<string>();
  private blockedTaskIds = new Set<string>();
  private tasksWithStrippedParams = new Set<string>();
  private taskExecutionTokens = new Map<string, symbol>();

  private constructor() {
    this.tasks = new Map();
    this.taskUpdates$ = new Subject();
  }

  /**
   * Converts Task to SWTask format for IndexedDB storage
   */
  private convertToSWTask(task: Task): SWTask {
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      params: task.params as SWTask['params'],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      result: task.result,
      error: task.error as any,
      progress: task.progress,
      remoteId: task.remoteId,
      invocationRoute: task.invocationRoute,
      executionPhase: task.executionPhase,
      savedToLibrary: task.savedToLibrary,
      insertedToCanvas: task.insertedToCanvas,
    };
  }

  /**
   * Persist task to IndexedDB (async, fire-and-forget)
   */
  private persistTask(task: Task): void {
    this.enqueueTaskStorageOperation(task.id, () =>
      this.persistTaskInternal(task)
    ).catch((error) => {
      console.error('[TaskQueueService] Failed to persist task:', error);
    });
  }

  private enqueueTaskStorageOperation(
    taskId: string,
    operation: () => Promise<void>
  ): Promise<void> {
    const previous =
      this.taskStorageOperations.get(taskId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.taskStorageOperations.set(taskId, next);
    void next
      .finally(() => {
        if (this.taskStorageOperations.get(taskId) === next) {
          this.taskStorageOperations.delete(taskId);
        }
      })
      .catch(() => undefined);
    return next;
  }

  private async persistTaskInternal(task: Task): Promise<void> {
    const persistableTask = await this.restoreStrippedTaskParams(task);
    const swTask = this.convertToSWTask(persistableTask);
    await taskStorageWriter.saveTask(swTask);
    // Invalidate reader cache after write
    taskStorageReader.invalidateCache();
  }

  private rememberRecentlyDeletedTask(taskId: string): void {
    this.recentlyDeletedTaskIds.delete(taskId);
    this.recentlyDeletedTaskIds.add(taskId);

    while (this.recentlyDeletedTaskIds.size > MAX_RECENTLY_DELETED_TASK_IDS) {
      const oldestTaskId = this.recentlyDeletedTaskIds.values().next().value;
      if (typeof oldestTaskId !== 'string') {
        break;
      }
      this.recentlyDeletedTaskIds.delete(oldestTaskId);
    }
  }

  private renewTaskExecutionToken(taskId: string): symbol {
    const token = Symbol(taskId);
    this.taskExecutionTokens.set(taskId, token);
    return token;
  }

  private abortTaskExecution(taskId: string): void {
    const taskAbortController = this.taskAbortControllers.get(taskId);
    taskAbortController?.abort();
    if (this.taskAbortControllers.get(taskId) === taskAbortController) {
      this.taskAbortControllers.delete(taskId);
    }

    const execution = this.executingTasks.get(taskId);
    execution?.abort();
    if (this.executingTasks.get(taskId) === execution) {
      this.executingTasks.delete(taskId);
    }
  }

  private shouldSkipExecutionWriteback(
    taskId: string,
    execution?: AbortController,
    requestId?: string
  ): boolean {
    const task = this.tasks.get(taskId);
    return (
      !task ||
      task.status === TaskStatus.CANCELLED ||
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId) ||
      Boolean(execution && this.executingTasks.get(taskId) !== execution) ||
      Boolean(
        requestId &&
          task.type === TaskType.IMAGE &&
          (task.status !== TaskStatus.PROCESSING ||
            getImageSubmissionRequestId(task) !== requestId)
      )
    );
  }

  private updateExecutionProgress(
    taskId: string,
    options: TaskExecutionGuardOptions,
    progress: number,
    phase?: string
  ): boolean {
    if (!options.isCurrentAttempt()) {
      return false;
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    this.updateTaskStatus(taskId, task.status, {
      progress: Math.min(100, Math.max(0, progress)),
      ...(phase ? { executionPhase: phase as Task['executionPhase'] } : {}),
    });
    return true;
  }

  private async repersistCancelledTask(
    taskId: string,
    requestId?: string
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task?.status !== TaskStatus.CANCELLED) {
      return;
    }

    if (task.type === TaskType.IMAGE && requestId) {
      await this.updateImageAttemptStorage(taskId, requestId, () =>
        taskStorageWriter.updateStatus(taskId, 'cancelled', requestId, {
          allowLegacyRequestId: true,
        })
      );
      return;
    }

    await this.enqueueTaskStorageOperation(taskId, () =>
      this.persistTaskInternal(task)
    );
  }

  private async resolveTaskKnowledgeContext(task: Task): Promise<Task> {
    const refs = task.params.knowledgeContextRefs;
    if (!refs?.length) {
      return task;
    }

    const specializedPromptKey = [
      'videoAnalyzerPrompt',
      'musicAnalyzerPrompt',
    ].find((key) => {
      const value = task.params[key];
      return typeof value === 'string' && value.trim().length > 0;
    });
    const basePrompt = specializedPromptKey
      ? task.params[specializedPromptKey]
      : task.params.prompt;
    const result = await buildPromptWithKnowledgeContext(
      basePrompt,
      refs,
      task.type === TaskType.VIDEO
        ? { maxPromptLength: MAX_VIDEO_GENERATION_PROMPT_LENGTH }
        : undefined
    );
    if (!result.contextBlock) {
      return task;
    }

    return {
      ...task,
      params: {
        ...task.params,
        ...(specializedPromptKey
          ? { [specializedPromptKey]: result.prompt }
          : { prompt: result.prompt }),
        promptMeta: {
          ...task.params.promptMeta,
          knowledgeContextRefs: result.includedRefs,
        },
      },
    };
  }

  private async buildChatInlineDataParts(
    task: Task
  ): Promise<GeminiMessage['content']> {
    const params = task.params as {
      pdfCacheUrl?: unknown;
      pdfData?: unknown;
      pdfMimeType?: unknown;
      pdfName?: unknown;
    };
    const parts: GeminiMessage['content'] = [];
    const mimeType =
      typeof params.pdfMimeType === 'string' && params.pdfMimeType.trim()
        ? params.pdfMimeType.trim()
        : 'application/pdf';

    if (typeof params.pdfData === 'string' && params.pdfData.trim()) {
      parts.push({
        type: 'inline_data',
        mimeType,
        data: params.pdfData.replace(/^data:application\/pdf;base64,/i, ''),
      });
    }

    if (typeof params.pdfCacheUrl === 'string' && params.pdfCacheUrl.trim()) {
      const blob = await unifiedCacheService.getCachedBlob(
        params.pdfCacheUrl.trim()
      );
      if (!blob) {
        throw new Error('无法读取已上传的 PDF 文件');
      }

      const file = new File(
        [blob],
        typeof params.pdfName === 'string' && params.pdfName.trim()
          ? params.pdfName.trim()
          : 'comic-source.pdf',
        { type: blob.type || mimeType }
      );
      const part = await buildInlineDataPart(file);
      if (part.type === 'inline_data') {
        parts.push(part);
      }
    }

    return parts;
  }

  /**
   * Delete task from IndexedDB (async, fire-and-forget)
   */
  private persistDelete(task: Task, hadStrippedParams: boolean): void {
    const taskId = task.id;
    const deletion = this.enqueueTaskStorageOperation(taskId, async () => {
      try {
        await taskStorageWriter.deleteTask(taskId);
      } finally {
        taskStorageReader.invalidateCache();
      }
    });
    this.pendingTaskDeletions.set(taskId, deletion);
    this.releaseDeletedTaskBlockWhenSettled(task, hadStrippedParams, deletion);
  }

  private releaseDeletedTaskBlockWhenSettled(
    deletedTask: Task,
    hadStrippedParams: boolean,
    deletion: Promise<void>
  ): void {
    const taskId = deletedTask.id;
    void (async () => {
      let deletionError: unknown;
      try {
        await deletion;
      } catch (error) {
        deletionError = error;
      }

      // 同 ID 的明确恢复/新建会排在删除之后持久化。等待当前串行链尾完成，
      // 再释放栅栏，避免删除完成与新状态落盘之间出现可写窗口。
      while (this.pendingTaskDeletions.get(taskId) === deletion) {
        const pending = this.taskStorageOperations.get(taskId);
        if (!pending || pending === deletion) {
          break;
        }
        await pending.catch(() => undefined);
      }

      if (this.pendingTaskDeletions.get(taskId) !== deletion) {
        return;
      }
      this.pendingTaskDeletions.delete(taskId);
      this.blockedTaskIds.delete(taskId);

      if (deletionError && !this.tasks.has(taskId)) {
        const restoredTask = isTaskActive(deletedTask)
          ? {
              ...deletedTask,
              status: TaskStatus.CANCELLED,
              updatedAt: Date.now(),
            }
          : deletedTask;
        this.recentlyDeletedTaskIds.delete(taskId);
        this.tasks.set(taskId, restoredTask);
        this.renewTaskExecutionToken(taskId);
        if (hadStrippedParams) {
          this.tasksWithStrippedParams.add(taskId);
        }
        if (restoredTask !== deletedTask) {
          this.persistTask(restoredTask);
        }
        this.emitEvent('taskCreated', restoredTask);
      }

      if (deletionError) {
        console.error(
          '[TaskQueueService] Failed to delete task from storage:',
          deletionError
        );
      } else {
        const restoredTask = this.tasks.get(taskId);
        if (restoredTask && !this.recentlyDeletedTaskIds.has(taskId)) {
          this.emitEvent('taskUpdated', restoredTask);
        }
      }
    })();
  }

  /**
   * Execute task using executor (for legacy/fallback mode)
   * This is called automatically after task creation
   */
  private async executeTask(task: Task): Promise<void> {
    const submissionRequestId =
      task.type === TaskType.IMAGE
        ? getImageSubmissionRequestId(task)
        : undefined;
    // 防止同一任务被重复执行（双重调用防护）
    const currentExecution = this.executingTasks.get(task.id);
    if (
      currentExecution &&
      (!currentExecution.signal.aborted || task.type !== TaskType.IMAGE)
    ) {
      console.warn(
        `[TaskQueueService] Task ${task.id} is already executing, skipping duplicate`
      );
      return;
    }
    const abortController = new AbortController();
    this.executingTasks.set(task.id, abortController);
    this.taskAbortControllers.set(task.id, abortController);
    const { signal } = abortController;
    let shouldNotifyRecoveryAfterExecution = false;

    try {
      if (
        this.shouldSkipExecutionWriteback(
          task.id,
          abortController,
          submissionRequestId
        )
      ) {
        return;
      }

      await this.taskStorageOperations.get(task.id);
      if (
        this.shouldSkipExecutionWriteback(
          task.id,
          abortController,
          submissionRequestId
        )
      ) {
        return;
      }

      // Check API configuration
      const routeType =
        task.type === TaskType.VIDEO
          ? 'video'
          : task.type === TaskType.AUDIO
          ? 'audio'
          : task.type === TaskType.CHAT
          ? 'text'
          : 'image';
      if (
        !hasInvocationRouteCredentials(
          routeType,
          task.params.modelRef || task.params.model
        )
      ) {
        console.warn(
          '[TaskQueueService] No API configuration, cannot execute task'
        );
        if (task.type === TaskType.IMAGE && submissionRequestId) {
          await this.failImageAttempt(
            task.id,
            submissionRequestId,
            { code: 'NO_API_KEY', message: '未配置 API Key' },
            { allowLegacyRequestId: true }
          );
          return;
        }
        this.updateTaskStatus(task.id, TaskStatus.FAILED, {
          error: { code: 'NO_API_KEY', message: '未配置 API Key' },
        });
        return;
      }

      task = await this.resolveTaskKnowledgeContext(
        await this.restoreStrippedTaskParams(task)
      );
      const isCurrentExecutionAttempt = () =>
        !this.shouldSkipExecutionWriteback(
          task.id,
          abortController,
          submissionRequestId
        );
      if (!isCurrentExecutionAttempt()) {
        return;
      }

      if (task.type === TaskType.AUDIO) {
        const requestedModel = task.params.model as string | undefined;
        const requestedModelRef = task.params.modelRef || null;
        const adapter = resolveAdapterForInvocation(
          'audio',
          requestedModel || DEFAULT_AUDIO_MODEL_ID,
          requestedModelRef
        );

        if (!adapter || adapter.kind !== 'audio') {
          throw new Error(`No audio adapter for model: ${requestedModel}`);
        }

        const result = await adapter.generateAudio(
          getAdapterContextFromSettings(
            'audio',
            requestedModelRef || requestedModel
          ),
          {
            prompt: task.params.prompt,
            model: requestedModel,
            modelRef: requestedModelRef,
            title: task.params.title,
            tags: task.params.tags,
            mv: task.params.mv,
            sunoAction: task.params.sunoAction,
            notifyHook: task.params.notifyHook,
            continueClipId: task.params.continueClipId,
            continueTaskId: task.params.continueTaskId,
            continueAt: task.params.continueAt,
            infillStartS: task.params.infillStartS,
            infillEndS: task.params.infillEndS,
            params: {
              ...(task.params as any).params,
              signal,
              onProgress: (progress: number) => {
                if (!isCurrentExecutionAttempt()) return;
                this.updateTaskProgress(task.id, progress);
                this.updateTaskStatus(task.id, TaskStatus.PROCESSING, {
                  executionPhase: TaskExecutionPhase.POLLING,
                });
              },
              onSubmitted: (remoteId: string) => {
                if (!isCurrentExecutionAttempt()) return;
                this.updateTaskStatus(task.id, TaskStatus.PROCESSING, {
                  remoteId,
                  invocationRoute: mergeTaskInvocationRoute(
                    task.invocationRoute,
                    createTaskInvocationRouteSnapshotFromTask(task, 'audio')
                  ),
                  executionPhase: TaskExecutionPhase.POLLING,
                });
              },
            },
          }
        );

        if (
          this.shouldSkipExecutionWriteback(
            task.id,
            abortController,
            submissionRequestId
          )
        ) {
          return;
        }

        // 缓存音频 URL 到 Cache Storage，防止远程链接过期
        const fmt =
          result.format || (result.resultKind === 'lyrics' ? 'lyrics' : 'mp3');
        let cachedUrl = result.url;
        let cachedUrls = result.urls;
        let cachedPreviewImageUrl = result.imageUrl;
        let cachedClips = result.clips;

        if (fmt !== 'lyrics') {
          try {
            const audioMeta = {
              extraMetadata: {
                name:
                  result.title ||
                  task.params.title ||
                  task.params.prompt?.substring(0, 30) ||
                  'AI音频',
                providerTaskId: result.providerTaskId || task.remoteId,
                duration:
                  typeof result.duration === 'number'
                    ? result.duration
                    : undefined,
              },
            };
            cachedUrl = await cacheRemoteUrl(
              result.url,
              task.id,
              'audio',
              fmt,
              undefined,
              audioMeta
            );
            if (result.imageUrl) {
              cachedPreviewImageUrl = await cacheAudioCoverUrl(
                result.imageUrl,
                task.id
              );
            }
            if (result.clips?.length) {
              cachedClips = await Promise.all(
                result.clips.map(async (clip, index) => {
                  const clipMeta = {
                    extraMetadata: {
                      name:
                        clip.title ||
                        result.title ||
                        task.params.title ||
                        task.params.prompt?.substring(0, 30) ||
                        'AI音频',
                      clipId: clip.clipId || clip.id,
                      providerTaskId: result.providerTaskId || task.remoteId,
                      duration:
                        typeof clip.duration === 'number'
                          ? clip.duration
                          : undefined,
                    },
                  };
                  const cachedAudioUrl = await cacheRemoteUrl(
                    clip.audioUrl,
                    task.id,
                    'audio',
                    fmt,
                    result.clips!.length > 1 ? index : undefined,
                    clipMeta
                  );
                  const cachedCoverUrl = await cacheAudioCoverUrl(
                    clip.imageLargeUrl || clip.imageUrl,
                    task.id,
                    result.clips!.length > 1 ? index : undefined
                  );

                  return {
                    ...clip,
                    audioUrl: cachedAudioUrl,
                    imageLargeUrl: clip.imageLargeUrl
                      ? cachedCoverUrl || clip.imageLargeUrl
                      : clip.imageLargeUrl,
                    imageUrl: clip.imageUrl
                      ? cachedCoverUrl || clip.imageUrl
                      : clip.imageUrl || cachedCoverUrl,
                  };
                })
              );
              cachedUrls = cachedClips
                .map((clip) => clip.audioUrl)
                .filter(
                  (audioUrl): audioUrl is string =>
                    typeof audioUrl === 'string' && audioUrl.trim().length > 0
                );
              if (cachedUrls.length > 0) {
                cachedUrl = cachedUrls[0];
              }
            } else if (result.urls?.length) {
              cachedUrls = await Promise.all(
                result.urls.map((audioUrl, index) =>
                  cacheRemoteUrl(
                    audioUrl,
                    task.id,
                    'audio',
                    fmt,
                    result.urls!.length > 1 ? index : undefined,
                    audioMeta
                  )
                )
              );
              if (cachedUrls.length > 0) {
                cachedUrl = cachedUrls[0];
              }
            }
            if (!cachedPreviewImageUrl) {
              cachedPreviewImageUrl =
                cachedClips?.[0]?.imageLargeUrl || cachedClips?.[0]?.imageUrl;
            }
          } catch (cacheError) {
            console.warn(
              '[TaskQueueService] Audio cache failed, using original URLs:',
              cacheError
            );
          }
        }

        if (
          this.shouldSkipExecutionWriteback(
            task.id,
            abortController,
            submissionRequestId
          )
        ) {
          return;
        }

        const now = Date.now();
        const previousTask = this.tasks.get(task.id) || task;
        const completedTask: Task = {
          ...previousTask,
          status: TaskStatus.COMPLETED,
          progress: 100,
          result: {
            url: normalizeImageDataUrl(cachedUrl),
            urls: cachedUrls?.map((u: string) => normalizeImageDataUrl(u)),
            format: fmt,
            size: 0,
            resultKind: result.resultKind,
            duration:
              typeof result.duration === 'number' ? result.duration : undefined,
            previewImageUrl: cachedPreviewImageUrl,
            title: result.title,
            lyricsText: result.lyricsText,
            lyricsTitle: result.lyricsTitle,
            lyricsTags: result.lyricsTags,
            providerTaskId: result.providerTaskId || task.remoteId,
            primaryClipId: result.primaryClipId,
            clipIds: result.clipIds,
            clips: cachedClips,
          },
          executionPhase: undefined,
          completedAt: now,
          updatedAt: now,
        };
        trackTerminalTaskAnalytics(completedTask, previousTask.status);
        this.tasks.set(task.id, completedTask);
        this.persistTask(completedTask);
        this.emitEvent('taskUpdated', completedTask);
        return;
      }

      // Get executor
      const executor = await executorFactory.getExecutor();

      // 实时进度回调：executor 执行期间同步更新内存中的 task 状态
      // 注意：必须创建新对象存入 Map，不能原地修改旧对象
      // 否则 useTaskQueue 通过 getAllTasks() 获取的对象引用不变，
      // React.memo 比较 prev.task.progress === next.task.progress 时永远相等
      const executionOptions = {
        signal,
        isCurrentAttempt: isCurrentExecutionAttempt,
        onSubmissionAttempt: async (
          invocationRoute?: Task['invocationRoute']
        ) => {
          if (submissionRequestId) {
            await this.markImageSubmissionAttempted(
              task.id,
              submissionRequestId,
              invocationRoute
            );
          }
          if (
            this.shouldSkipExecutionWriteback(
              task.id,
              abortController,
              submissionRequestId
            )
          ) {
            const error = new Error('图片提交已被取消或替代');
            error.name = 'AbortError';
            throw error;
          }
        },
        onProgress: (progress: { progress: number; phase?: string }) => {
          if (
            this.shouldSkipExecutionWriteback(
              task.id,
              abortController,
              submissionRequestId
            )
          ) {
            return;
          }

          const localTask = this.tasks.get(task.id);
          if (localTask) {
            const updatedTask: Task = {
              ...localTask,
              progress: progress.progress,
              updatedAt: Date.now(),
              ...(progress.phase && {
                executionPhase: progress.phase as Task['executionPhase'],
              }),
            };
            this.tasks.set(task.id, updatedTask);
            this.emitEvent('taskUpdated', updatedTask);
          }
        },
      };

      // Execute based on task type
      switch (task.type) {
        case TaskType.IMAGE: {
          // 从 params.params 中提取额外参数，并补齐新图像契约字段
          const extraParams = {
            ...(((task.params as any).params || {}) as Record<string, unknown>),
          };
          if (task.params.resolution !== undefined) {
            extraParams.resolution = task.params.resolution;
          }
          if (
            task.params.quality !== undefined &&
            extraParams.quality === undefined
          ) {
            extraParams.quality = task.params.quality;
          }
          if (
            typeof task.params.count === 'number' &&
            Number.isFinite(task.params.count) &&
            extraParams.n === undefined
          ) {
            extraParams.n = task.params.count;
          }
          await executor.generateImage(
            {
              taskId: task.id,
              requestId: submissionRequestId,
              prompt: task.params.prompt,
              model: task.params.model,
              modelRef: task.params.modelRef || null,
              size: task.params.size,
              resolution: task.params.resolution as
                | '1k'
                | '2k'
                | '4k'
                | undefined,
              generationMode: task.params.generationMode as
                | 'text_to_image'
                | 'image_to_image'
                | 'image_edit'
                | undefined,
              referenceImages: task.params.referenceImages as
                | string[]
                | undefined,
              maskImage: task.params.maskImage as string | undefined,
              inputFidelity: task.params.inputFidelity as
                | 'high'
                | 'low'
                | undefined,
              background: task.params.background as
                | 'transparent'
                | 'opaque'
                | 'auto'
                | undefined,
              outputFormat: task.params.outputFormat as
                | 'png'
                | 'jpeg'
                | 'webp'
                | undefined,
              outputCompression: task.params.outputCompression as
                | number
                | undefined,
              count: task.params.count as number | undefined,
              uploadedImages: task.params.uploadedImages as
                | Array<{ url?: string }>
                | undefined,
              quality: (task.params.quality ?? extraParams.quality) as
                | 'auto'
                | 'low'
                | 'medium'
                | 'high'
                | '1k'
                | '2k'
                | '4k'
                | undefined,
              params: extraParams,
              assetMetadata: task.params.assetMetadata,
              resultVisibility: task.params.resultVisibility,
            },
            executionOptions
          );
          break;
        }
        case TaskType.VIDEO: {
          // 从 uploadedImages（UI 层传入的 UploadedVideoImage[]）中提取 URL
          const uploaded = task.params.uploadedImages as
            | Array<{ url?: string }>
            | undefined;
          const uploadedUrls = uploaded
            ?.map((img) => img.url)
            .filter((url): url is string => !!url);
          // 兼容旧字段 referenceImages / inputReference
          const refImages = task.params.referenceImages as string[] | undefined;
          const inputRef = (task.params as { inputReference?: string })
            .inputReference;
          const finalRefs =
            uploadedUrls && uploadedUrls.length > 0
              ? uploadedUrls
              : refImages && refImages.length > 0
              ? refImages
              : inputRef
              ? [inputRef]
              : undefined;
          await executor.generateVideo(
            {
              taskId: task.id,
              prompt: task.params.prompt,
              model: task.params.model,
              modelRef: task.params.modelRef || null,
              duration: (
                task.params.duration ?? task.params.seconds
              )?.toString(),
              size: task.params.size,
              referenceImages: finalRefs,
              params: (task.params as any).params,
              resultVisibility: task.params.resultVisibility,
            },
            executionOptions
          );
          break;
        }
        case TaskType.CHAT: {
          if (
            (task.params as { videoAnalyzerAction?: string })
              .videoAnalyzerAction === 'analyze'
          ) {
            await this.executeVideoAnalyzerAnalyzeTask(task, executionOptions);
            break;
          }

          if (
            (task.params as { videoAnalyzerAction?: string })
              .videoAnalyzerAction === 'rewrite'
          ) {
            await this.executeVideoAnalyzerRewriteTask(task, executionOptions);
            break;
          }

          if (
            (task.params as { videoAnalyzerAction?: string })
              .videoAnalyzerAction === 'prompt-generate'
          ) {
            await this.executeVideoAnalyzerPromptGenerateTask(
              task,
              executionOptions
            );
            break;
          }

          if (
            (task.params as { musicAnalyzerAction?: string })
              .musicAnalyzerAction === 'analyze'
          ) {
            await this.executeMusicAnalyzerAnalyzeTask(task, executionOptions);
            break;
          }

          if (
            (task.params as { musicAnalyzerAction?: string })
              .musicAnalyzerAction === 'rewrite'
          ) {
            await this.executeMusicAnalyzerRewriteTask(task, executionOptions);
            break;
          }

          if (
            (task.params as { musicAnalyzerAction?: string })
              .musicAnalyzerAction === 'lyrics-gen'
          ) {
            await this.executeMusicAnalyzerLyricsGenTask(
              task,
              executionOptions
            );
            break;
          }

          if (
            (task.params as { mvCreatorAction?: string }).mvCreatorAction ===
            'storyboard'
          ) {
            await this.executeMVStoryboardTask(task, executionOptions);
            break;
          }

          const inlineDataParts = await this.buildChatInlineDataParts(task);
          if (!isCurrentExecutionAttempt()) {
            return;
          }
          await executor.generateText(
            {
              taskId: task.id,
              prompt: task.params.prompt,
              model: task.params.model,
              modelRef: task.params.modelRef || null,
              referenceImages: task.params.referenceImages as
                | string[]
                | undefined,
              inlineDataParts,
              params: (task.params as any).params,
            },
            executionOptions
          );
          break;
        }
        default:
          throw new Error(`Unsupported task type: ${task.type}`);
      }

      if (
        this.shouldSkipExecutionWriteback(
          task.id,
          abortController,
          submissionRequestId
        )
      ) {
        return;
      }

      // Poll for task completion (executor 已完成，此处主要是从 IndexedDB 读取最终结果)
      const result = await waitForTaskCompletion(task.id, {
        timeout: IMAGE_GENERATION_TIMEOUT_MS,
        signal,
        onProgress: (updatedTask) => {
          if (
            this.shouldSkipExecutionWriteback(
              task.id,
              abortController,
              submissionRequestId
            )
          ) {
            return;
          }

          if (task.type === TaskType.IMAGE && submissionRequestId) {
            this.syncImageAttemptFromStorage(task.id, updatedTask as SWTask);
            return;
          }

          // Update local state with progress
          // 注意：同时同步 result/error/completedAt，避免 status=completed 但 result 为空的中间状态
          // 创建新对象存入 Map，确保 React 能检测到引用变化
          const localTask = this.tasks.get(task.id);
          if (localTask) {
            const newTask: Task = {
              ...localTask,
              status: updatedTask.status as TaskStatus,
              progress: updatedTask.progress,
              updatedAt: Date.now(),
              ...(updatedTask.result && { result: updatedTask.result }),
              ...(updatedTask.error && { error: updatedTask.error }),
              ...(updatedTask.completedAt && {
                completedAt: updatedTask.completedAt,
              }),
            };
            trackTerminalTaskAnalytics(newTask, localTask.status);
            this.tasks.set(task.id, newTask);
            this.emitEvent('taskUpdated', newTask);
          }
        },
      });

      // Update final state & persist
      const localTask = this.tasks.get(task.id);
      if (
        localTask &&
        result.task &&
        !this.shouldSkipExecutionWriteback(
          task.id,
          abortController,
          submissionRequestId
        )
      ) {
        if (task.type === TaskType.IMAGE && submissionRequestId) {
          this.syncImageAttemptFromStorage(task.id, result.task as SWTask);
          return;
        }

        const finalTask: Task = {
          ...localTask,
          status: result.task.status as TaskStatus,
          result: result.task.result,
          error: result.task.error,
          completedAt: result.task.completedAt,
          updatedAt: Date.now(),
        };
        trackTerminalTaskAnalytics(finalTask, localTask.status);
        this.tasks.set(task.id, finalTask);

        // Persist final state
        this.persistTask(finalTask);
        this.emitEvent('taskUpdated', finalTask);
      }
    } catch (error: any) {
      if (
        this.shouldSkipExecutionWriteback(
          task.id,
          abortController,
          submissionRequestId
        )
      ) {
        return;
      }

      console.error('[TaskQueueService] Task execution failed:', error);
      const localTask = this.tasks.get(task.id);
      if (localTask) {
        const now = Date.now();
        if (task.type === TaskType.IMAGE && submissionRequestId) {
          if (isImageSubmissionOutcomeUnknownError(error)) {
            shouldNotifyRecoveryAfterExecution =
              await this.markImageAttemptRecovering(
                task.id,
                submissionRequestId
              );
            return;
          }
          await this.failImageAttempt(task.id, submissionRequestId, {
            code: 'EXECUTION_ERROR',
            message: error.message || 'Task execution failed',
          });
          return;
        }

        const failedTask: Task = {
          ...localTask,
          status: TaskStatus.FAILED,
          error: {
            code: 'EXECUTION_ERROR',
            message: error.message || 'Task execution failed',
          },
          updatedAt: now,
          completedAt: now,
          progress: undefined,
        };
        trackTerminalTaskAnalytics(failedTask, localTask.status);
        this.tasks.set(task.id, failedTask);
        this.persistTask(failedTask);
        this.emitEvent('taskUpdated', failedTask);
      }
    } finally {
      if (this.taskAbortControllers.get(task.id) === abortController) {
        this.taskAbortControllers.delete(task.id);
      }
      await this.repersistCancelledTask(task.id, submissionRequestId);
      if (this.executingTasks.get(task.id) === abortController) {
        this.executingTasks.delete(task.id);
      }
      if (shouldNotifyRecoveryAfterExecution) {
        const recoveryTask = this.tasks.get(task.id);
        if (
          recoveryTask &&
          getImageSubmissionRequestId(recoveryTask) === submissionRequestId &&
          isImageRequestRecoveryCandidate(recoveryTask)
        ) {
          this.emitEvent('taskUpdated', recoveryTask);
        }
      }
    }
  }

  private async finalizeChatTask(
    task: Task,
    options: TaskExecutionGuardOptions,
    payload: {
      title: string;
      chatResponse: string;
      format?: string;
      resultExtras?: Partial<NonNullable<Task['result']>>;
    }
  ): Promise<void> {
    if (!options.isCurrentAttempt()) {
      return;
    }

    const result: NonNullable<Task['result']> = {
      url: '',
      format: payload.format || 'json',
      size: payload.chatResponse.length,
      resultKind: 'chat',
      title: payload.title,
      chatResponse: payload.chatResponse,
      ...payload.resultExtras,
    };

    const now = Date.now();
    const previousTask = this.tasks.get(task.id) || task;
    const completedTask: Task = {
      ...previousTask,
      status: TaskStatus.COMPLETED,
      progress: 100,
      result,
      executionPhase: undefined,
      completedAt: now,
      updatedAt: now,
    };
    await this.enqueueTaskStorageOperation(task.id, () =>
      this.persistTaskInternal(completedTask)
    );

    if (!options.isCurrentAttempt()) {
      return;
    }

    trackTerminalTaskAnalytics(completedTask, previousTask.status);
    this.tasks.set(task.id, completedTask);
    this.emitEvent('taskUpdated', completedTask);
    this.emitEvent('taskCompleted', completedTask);
  }

  private async executeVideoAnalyzerAnalyzeTask(
    task: Task,
    options: TaskExecutionGuardOptions
  ): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      mimeType?: string;
      youtubeUrl?: string;
      videoData?: string;
      videoCacheUrl?: string;
      videoAnalyzerPrompt?: string;
      prompt?: string;
    };

    if (!this.updateExecutionProgress(task.id, options, 8)) return;

    let videoData = params.videoData;
    let mimeType = params.mimeType || 'video/mp4';

    if (!videoData && params.videoCacheUrl) {
      const blob =
        (await unifiedCacheService.getCachedBlob(params.videoCacheUrl)) ||
        (await fetch(params.videoCacheUrl).then((response) =>
          response.ok ? response.blob() : null
        ));

      if (!blob) {
        throw new Error('无法读取已缓存的视频文件');
      }

      const file = new File([blob], 'video-analyzer-source.mp4', {
        type: blob.type || mimeType,
      });
      const part = await buildInlineDataPart(file);
      if (part.type !== 'inline_data') {
        throw new Error('视频缓存转换失败');
      }
      videoData = part.data;
      mimeType = part.mimeType || mimeType;
    }

    if (
      !this.updateExecutionProgress(
        task.id,
        options,
        VIDEO_ANALYZER_SIMULATED_START_PROGRESS
      )
    ) {
      return;
    }

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / VIDEO_ANALYZER_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        VIDEO_ANALYZER_SIMULATED_START_PROGRESS +
        (VIDEO_ANALYZER_SIMULATED_END_PROGRESS -
          VIDEO_ANALYZER_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateExecutionProgress(task.id, options, Math.floor(nextProgress));
    }, VIDEO_ANALYZER_SIMULATED_INTERVAL_MS);

    try {
      const result = await executeVideoAnalysis({
        videoData,
        mimeType,
        youtubeUrl: params.youtubeUrl,
        prompt: params.videoAnalyzerPrompt || params.prompt,
        model: params.model,
        modelRef: params.modelRef || null,
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || '视频分析失败');
      }

      const analysis = (result.data as { analysis: VideoAnalysisData })
        .analysis;
      const formattedText = formatShotsMarkdown(analysis.shots || [], analysis);
      await this.finalizeChatTask(task, options, {
        title: '视频分析结果',
        chatResponse: formattedText,
        format: 'md',
        resultExtras: {
          analysisData: analysis,
        },
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  private async executeVideoAnalyzerRewriteTask(
    task: Task,
    options: TaskExecutionGuardOptions
  ): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      videoAnalyzerPrompt?: string;
      prompt?: string;
      videoAnalyzerRecordId?: string;
    };
    const actualPrompt = String(params.videoAnalyzerPrompt || '').trim();
    if (!actualPrompt) {
      throw new Error('缺少脚本改编提示词');
    }

    if (
      !this.updateExecutionProgress(
        task.id,
        options,
        VIDEO_REWRITE_SIMULATED_START_PROGRESS,
        'submitting'
      )
    )
      return;

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / VIDEO_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        VIDEO_REWRITE_SIMULATED_START_PROGRESS +
        (VIDEO_REWRITE_SIMULATED_END_PROGRESS -
          VIDEO_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateExecutionProgress(task.id, options, Math.floor(nextProgress));
    }, VIDEO_REWRITE_SIMULATED_INTERVAL_MS);

    try {
      const messages: GeminiMessage[] = [
        { role: 'user', content: [{ type: 'text', text: actualPrompt }] },
      ];
      const response = await sendChatWithGemini(
        messages,
        undefined,
        undefined,
        (params.modelRef as any) || params.model,
        { taskType: 'video', taskId: task.id }
      );
      const text = response.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('AI 未返回有效响应');
      }

      const recordId = String(params.videoAnalyzerRecordId || '').trim();
      const targetRecord = recordId
        ? (await loadRecords()).find((record) => record.id === recordId) || null
        : null;

      const baseShots =
        targetRecord?.editedShots || targetRecord?.analysis.shots || [];
      const rewriteResult = parseScriptRewriteResponse(text, baseShots);
      const editedShots = rewriteResult.shots;
      const formattedText =
        targetRecord && editedShots.length > 0
          ? formatShotsMarkdown(
              editedShots,
              targetRecord.analysis,
              targetRecord.productInfo
            )
          : text;

      options.onProgress({ progress: 100 });
      await this.finalizeChatTask(task, options, {
        title: '脚本改编结果',
        chatResponse: text,
        format: 'md',
        resultExtras: {
          analysisData: {
            editedShots,
            shots: editedShots,
            characters: rewriteResult.hasCharacters
              ? rewriteResult.characters || []
              : undefined,
            video_style: rewriteResult.videoStyle,
            bgm_mood: rewriteResult.bgmMood,
            formattedText,
            rawResponse: text,
          },
        },
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  private async executeVideoAnalyzerPromptGenerateTask(
    task: Task,
    options: TaskExecutionGuardOptions
  ): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      videoAnalyzerPrompt?: string;
      prompt?: string;
    };
    const actualPrompt = String(params.videoAnalyzerPrompt || '').trim();
    if (!actualPrompt) {
      throw new Error('缺少提示词生成内容');
    }

    if (
      !this.updateExecutionProgress(
        task.id,
        options,
        VIDEO_PROMPT_SIMULATED_START_PROGRESS,
        'submitting'
      )
    )
      return;

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / VIDEO_PROMPT_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        VIDEO_PROMPT_SIMULATED_START_PROGRESS +
        (VIDEO_PROMPT_SIMULATED_END_PROGRESS -
          VIDEO_PROMPT_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateExecutionProgress(task.id, options, Math.floor(nextProgress));
    }, VIDEO_PROMPT_SIMULATED_INTERVAL_MS);

    try {
      const messages: GeminiMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: actualPrompt },
            ...(await this.buildChatInlineDataParts(task)),
          ],
        },
      ];
      if (!options.isCurrentAttempt()) return;
      const response = await sendChatWithGemini(
        messages,
        undefined,
        undefined,
        (params.modelRef as any) || params.model,
        { taskType: 'video', taskId: task.id, prompt: actualPrompt }
      );
      const text = response.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('AI 未返回有效响应');
      }

      const analysis = parseVideoPromptGenerationResponse(text);
      const formattedText = formatShotsMarkdown(analysis.shots || [], analysis);

      options.onProgress({ progress: 100 });
      await this.finalizeChatTask(task, options, {
        title: '提示词生成结果',
        chatResponse: formattedText,
        format: 'md',
        resultExtras: {
          analysisData: analysis,
        },
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  private async executeMusicAnalyzerAnalyzeTask(
    task: Task,
    options: TaskExecutionGuardOptions
  ): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      mimeType?: string;
      audioData?: string;
      audioCacheUrl?: string;
      musicAnalyzerPrompt?: string;
      prompt?: string;
    };

    if (!this.updateExecutionProgress(task.id, options, 8)) return;

    let audioData = params.audioData;
    let mimeType = params.mimeType || 'audio/mpeg';

    if (!audioData && params.audioCacheUrl) {
      const blob =
        (await unifiedCacheService.getCachedBlob(params.audioCacheUrl)) ||
        (await fetch(params.audioCacheUrl).then((response) =>
          response.ok ? response.blob() : null
        ));

      if (!blob) {
        throw new Error('无法读取已缓存的音频文件');
      }
      if (blob.size > MAX_AUDIO_ANALYZE_FILE_SIZE) {
        throw new Error('音频文件过大，请控制在 20MB 内');
      }

      const file = new File([blob], 'music-analyzer-source.mp3', {
        type: blob.type || mimeType,
      });
      const part = await buildInlineDataPart(file);
      if (part.type !== 'inline_data') {
        throw new Error('音频缓存转换失败');
      }
      audioData = part.data;
      mimeType = part.mimeType || mimeType;
    }

    if (
      !this.updateExecutionProgress(
        task.id,
        options,
        MUSIC_ANALYZER_SIMULATED_START_PROGRESS
      )
    )
      return;

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_ANALYZER_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_ANALYZER_SIMULATED_START_PROGRESS +
        (MUSIC_ANALYZER_SIMULATED_END_PROGRESS -
          MUSIC_ANALYZER_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateExecutionProgress(task.id, options, Math.floor(nextProgress));
    }, MUSIC_ANALYZER_SIMULATED_INTERVAL_MS);

    try {
      const result = await executeMusicAnalysis({
        audioData,
        mimeType,
        prompt:
          params.musicAnalyzerPrompt ||
          params.prompt ||
          DEFAULT_MUSIC_ANALYSIS_PROMPT,
        model: params.model,
        modelRef: params.modelRef || null,
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || '音频分析失败');
      }

      const analysis = (result.data as { analysis: MusicAnalysisData })
        .analysis;
      const formattedText = formatMusicAnalysisMarkdown(analysis);
      await this.finalizeChatTask(task, options, {
        title: '音频分析结果',
        chatResponse: formattedText,
        format: 'md',
        resultExtras: {
          analysisData: analysis,
        },
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  private async executeMusicAnalyzerRewriteTask(
    task: Task,
    options: TaskExecutionGuardOptions
  ): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      musicAnalyzerPrompt?: string;
      prompt?: string;
      musicAnalyzerRecordId?: string;
    };
    const actualPrompt = String(params.musicAnalyzerPrompt || '').trim();
    if (!actualPrompt) {
      throw new Error('缺少歌词改写提示词');
    }

    if (
      !this.updateExecutionProgress(
        task.id,
        options,
        MUSIC_REWRITE_SIMULATED_START_PROGRESS,
        'submitting'
      )
    )
      return;

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_REWRITE_SIMULATED_START_PROGRESS +
        (MUSIC_REWRITE_SIMULATED_END_PROGRESS -
          MUSIC_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateExecutionProgress(task.id, options, Math.floor(nextProgress));
    }, MUSIC_REWRITE_SIMULATED_INTERVAL_MS);

    try {
      const messages: GeminiMessage[] = [
        { role: 'user', content: [{ type: 'text', text: actualPrompt }] },
      ];
      const response = await sendChatWithGemini(
        messages,
        undefined,
        undefined,
        (params.modelRef as any) || params.model,
        { taskType: 'audio', taskId: task.id }
      );
      const text = response.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('AI 未返回有效响应');
      }

      const recordId = String(params.musicAnalyzerRecordId || '').trim();
      const targetRecord = recordId
        ? (await loadMusicRecords()).find((record) => record.id === recordId) ||
          null
        : null;
      const rewriteResult = parseLyricsRewriteResult(text);
      const formattedText =
        targetRecord && rewriteResult.lyricsDraft
          ? [
              `# ${rewriteResult.title || targetRecord.title || '未命名歌曲'}`,
              '',
              `标签: ${
                rewriteResult.styleTags.length > 0
                  ? rewriteResult.styleTags.join(', ')
                  : (targetRecord.styleTags || []).join(', ') || '-'
              }`,
              '',
              rewriteResult.lyricsDraft,
            ].join('\n')
          : text;

      options.onProgress({ progress: 100 });
      await this.finalizeChatTask(task, options, {
        title: '歌词改写结果',
        chatResponse: formattedText,
        format: 'md',
        resultExtras: {
          analysisData: {
            title: rewriteResult.title,
            styleTags: rewriteResult.styleTags,
            lyricsDraft: rewriteResult.lyricsDraft,
            rawResponse: text,
          },
        },
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  private async executeMusicAnalyzerLyricsGenTask(
    task: Task,
    options: TaskExecutionGuardOptions
  ): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      musicAnalyzerPrompt?: string;
      musicAnalyzerRecordId?: string;
    };
    const actualPrompt = String(params.musicAnalyzerPrompt || '').trim();
    if (!actualPrompt) {
      throw new Error('缺少歌词生成提示词');
    }

    if (
      !this.updateExecutionProgress(
        task.id,
        options,
        MUSIC_REWRITE_SIMULATED_START_PROGRESS,
        'submitting'
      )
    )
      return;

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_REWRITE_SIMULATED_START_PROGRESS +
        (MUSIC_REWRITE_SIMULATED_END_PROGRESS -
          MUSIC_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateExecutionProgress(task.id, options, Math.floor(nextProgress));
    }, MUSIC_REWRITE_SIMULATED_INTERVAL_MS);

    try {
      const messages: GeminiMessage[] = [
        { role: 'user', content: [{ type: 'text', text: actualPrompt }] },
      ];
      const response = await sendChatWithGemini(
        messages,
        undefined,
        undefined,
        (params.modelRef as any) || params.model,
        { taskType: 'audio', taskId: task.id }
      );
      const text = response.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('AI 未返回有效响应');
      }

      const recordId = String(params.musicAnalyzerRecordId || '').trim();
      const targetRecord = recordId
        ? (await loadMusicRecords()).find((record) => record.id === recordId) ||
          null
        : null;
      const lyricsResult = parseLyricsRewriteResult(text);
      const formattedText =
        targetRecord && lyricsResult.lyricsDraft
          ? [
              `# ${lyricsResult.title || targetRecord.title || '未命名歌曲'}`,
              '',
              `标签: ${
                lyricsResult.styleTags.length > 0
                  ? lyricsResult.styleTags.join(', ')
                  : (targetRecord.styleTags || []).join(', ') || '-'
              }`,
              '',
              lyricsResult.lyricsDraft,
            ].join('\n')
          : text;

      options.onProgress({ progress: 100 });
      await this.finalizeChatTask(task, options, {
        title: '歌词草稿结果',
        chatResponse: formattedText,
        format: 'md',
        resultExtras: {
          analysisData: {
            title: lyricsResult.title,
            styleTags: lyricsResult.styleTags,
            lyricsDraft: lyricsResult.lyricsDraft,
            rawResponse: text,
          },
        },
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  private async executeMVStoryboardTask(
    task: Task,
    options: TaskExecutionGuardOptions
  ): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      prompt?: string;
      audioCacheUrl?: string;
    };
    const actualPrompt = String(params.prompt || '').trim();
    if (!actualPrompt) {
      throw new Error('缺少分镜规划提示词');
    }

    if (
      !this.updateExecutionProgress(
        task.id,
        options,
        MUSIC_REWRITE_SIMULATED_START_PROGRESS,
        'submitting'
      )
    )
      return;

    // 读取音频 base64
    let audioData: string | undefined;
    let audioMimeType = 'audio/mpeg';
    if (params.audioCacheUrl) {
      const blob =
        (await unifiedCacheService.getCachedBlob(params.audioCacheUrl)) ||
        (await fetch(params.audioCacheUrl).then((r) =>
          r.ok ? r.blob() : null
        ));
      if (blob) {
        const file = new File([blob], 'mv-audio.mp3', {
          type: blob.type || audioMimeType,
        });
        const part = await buildInlineDataPart(file);
        if (part.type === 'inline_data') {
          audioData = part.data;
          audioMimeType = part.mimeType || audioMimeType;
        }
      }
    }
    if (!options.isCurrentAttempt()) return;

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_REWRITE_SIMULATED_START_PROGRESS +
        (MUSIC_REWRITE_SIMULATED_END_PROGRESS -
          MUSIC_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateExecutionProgress(task.id, options, Math.floor(nextProgress));
    }, MUSIC_REWRITE_SIMULATED_INTERVAL_MS);

    try {
      const contentParts: GeminiMessage['content'] = [
        { type: 'text', text: actualPrompt },
      ];
      if (audioData) {
        (contentParts as any[]).push({
          type: 'inline_data',
          mimeType: audioMimeType,
          data: audioData,
        });
      }

      const messages: GeminiMessage[] = [
        { role: 'user', content: contentParts },
      ];

      const config = await buildGenerateContentConfig(
        params.model,
        (params.modelRef as any) || null
      );
      const response = await callGoogleGenerateContentWithLog(
        config,
        messages,
        { stream: false },
        { taskType: 'video', prompt: actualPrompt, taskId: task.id }
      );

      const text = response.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('AI 未返回有效响应');
      }

      options.onProgress({ progress: 100 });
      await this.finalizeChatTask(task, options, {
        title: 'MV 分镜脚本',
        chatResponse: text,
        format: 'md',
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  /**
   * Gets the singleton instance of TaskQueueService
   */
  static getInstance(): TaskQueueService {
    if (!TaskQueueService.instance) {
      TaskQueueService.instance = new TaskQueueService();
    }
    return TaskQueueService.instance;
  }

  /**
   * Creates a new task and adds it to the queue
   *
   * @param params - Generation parameters
   * @param type - Task type (image or video)
   * @returns The created task
   * @throws Error if validation fails
   */
  createTask(params: GenerationParams, type: TaskType): Task {
    // Validate parameters
    const validation = validateGenerationParams(params, type);
    if (!validation.valid) {
      throw new Error(`Invalid parameters: ${validation.errors.join(', ')}`);
    }

    // Sanitize parameters
    const sanitizedParams = normalizeGenerationParamsKnowledgeContext(
      sanitizeGenerationParams(params)
    );

    // Create new task - starts as PROCESSING since it will be executed immediately
    const now = Date.now();
    const taskId = generateTaskId();
    const taskParams =
      type === TaskType.IMAGE
        ? createImageSubmissionParams(sanitizedParams, taskId)
        : sanitizedParams;
    const task: Task = {
      id: taskId,
      type,
      status: TaskStatus.PROCESSING,
      params: taskParams,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      executionPhase: TaskExecutionPhase.SUBMITTING,
      // Initialize progress for video tasks
      ...((type === TaskType.VIDEO ||
        type === TaskType.AUDIO ||
        (type === TaskType.CHAT &&
          (typeof sanitizedParams.videoAnalyzerAction === 'string' ||
            typeof sanitizedParams.musicAnalyzerAction === 'string'))) && {
        progress: 0,
      }),
    };
    const invocationRoute = createTaskInvocationRouteSnapshotFromTask(task);
    if (invocationRoute) {
      task.invocationRoute = invocationRoute;
    }

    if (!this.pendingTaskDeletions.has(task.id)) {
      this.blockedTaskIds.delete(task.id);
      this.recentlyDeletedTaskIds.delete(task.id);
    }

    // Add to queue
    this.tasks.set(task.id, task);
    this.renewTaskExecutionToken(task.id);

    // Persist to IndexedDB
    this.persistTask(task);

    // Emit event
    this.emitEvent('taskCreated', task);
    trackTaskAnalytics('generation_task_created', task);

    // 归档超出限制的旧任务
    this.enforceRetentionLimit();

    // Execute task asynchronously (fire-and-forget)
    this.executeTask(task).catch((error) => {
      console.error('[TaskQueueService] Task execution error:', error);
    });

    // 任务开始执行后剥离大字段（base64 参考图等）
    this.stripLargeParams(task.id);

    // console.log(`[TaskQueueService] Created task ${task.id} (${type})`);
    return task;
  }

  /**
   * Updates a task's status
   *
   * @param taskId - The task ID
   * @param status - New status
   * @param updates - Additional fields to update
   */
  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    updates?: Partial<Task>,
    options: { persist?: boolean } = {}
  ): void {
    if (
      this.recentlyDeletedTaskIds.has(taskId) ||
      (this.blockedTaskIds.has(taskId) && status !== TaskStatus.CANCELLED)
    ) {
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    const now = Date.now();
    const updatedTask: Task = {
      ...task,
      ...updates,
      status,
      updatedAt: now,
    };

    // Set timestamps based on status
    if (status === TaskStatus.PROCESSING && !updatedTask.startedAt) {
      updatedTask.startedAt = now;
    } else if (
      status === TaskStatus.COMPLETED ||
      status === TaskStatus.FAILED
    ) {
      updatedTask.completedAt = now;
    }

    this.tasks.set(taskId, updatedTask);

    if (options.persist !== false) {
      // Persist to IndexedDB
      this.persistTask(updatedTask);
    }

    this.emitEvent('taskUpdated', updatedTask);

    // console.log(`[TaskQueueService] Updated task ${taskId} to ${status}`);
    const enteredTerminalStatus =
      isTrackedTerminalTaskStatus(status) && task.status !== status;
    if (enteredTerminalStatus) {
      trackTerminalTaskAnalytics(updatedTask, task.status);
      // 任务进入终态后检查是否需要归档旧任务
      this.enforceRetentionLimit();
    }
  }

  /**
   * Updates a task's progress
   *
   * @param taskId - The task ID
   * @param progress - Progress percentage (0-100)
   */
  updateTaskProgress(taskId: string, progress: number): void {
    if (
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    const updatedTask: Task = {
      ...task,
      progress: Math.min(100, Math.max(0, progress)),
      updatedAt: Date.now(),
    };

    this.tasks.set(taskId, updatedTask);

    // Persist to IndexedDB
    this.persistTask(updatedTask);

    this.emitEvent('taskUpdated', updatedTask);
  }

  async markImageSubmissionAttempted(
    taskId: string,
    requestId: string,
    invocationRoute?: Task['invocationRoute']
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (
      !task ||
      task.type !== TaskType.IMAGE ||
      getImageSubmissionRequestId(task) !== requestId ||
      task.status === TaskStatus.CANCELLED ||
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      const error = new Error('图片提交已被取消或替代');
      error.name = 'AbortError';
      throw error;
    }

    const marked = await this.updateImageAttemptStorage(taskId, requestId, () =>
      taskStorageWriter.markImageSubmissionAttempted(
        taskId,
        requestId,
        invocationRoute
      )
    );
    if (!marked) {
      const error = new Error('图片提交已被取消或替代');
      error.name = 'AbortError';
      throw error;
    }

    const currentTask = this.tasks.get(taskId);
    if (
      !currentTask ||
      currentTask.status === TaskStatus.CANCELLED ||
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId) ||
      getImageSubmissionRequestId(currentTask) !== requestId
    ) {
      const error = new Error('图片提交已被取消或替代');
      error.name = 'AbortError';
      throw error;
    }
  }

  /**
   * Gets a task by ID
   *
   * @param taskId - The task ID
   * @returns The task or undefined
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 当前页面是否仍持有该任务的真实执行实例。
   * 页面刷新后内存执行表会自然清空，此时持久化任务才允许进入恢复轮询。
   */
  isTaskExecutionActive(taskId: string): boolean {
    const execution = this.executingTasks.get(taskId);
    return Boolean(execution && !execution.signal.aborted);
  }

  getTaskExecutionToken(taskId: string): symbol | undefined {
    return this.taskExecutionTokens.get(taskId);
  }

  isTaskExecutionTokenCurrent(taskId: string, token: symbol): boolean {
    return (
      this.tasks.has(taskId) && this.taskExecutionTokens.get(taskId) === token
    );
  }

  async getCompleteTask(taskId: string): Promise<Task | undefined> {
    const storedTask = await taskStorageReader.getTask(taskId);
    if (storedTask) {
      return storedTask;
    }

    const memoryTask = this.tasks.get(taskId);
    return memoryTask ? this.restoreStrippedTaskParams(memoryTask) : undefined;
  }

  async waitForTaskPersistence(taskId: string): Promise<void> {
    await this.taskStorageOperations.get(taskId);
  }

  async findImageTaskByResultUrl(imageUrl: string): Promise<Task | undefined> {
    const memoryMatch = this.getAllTasks().find((task) =>
      imageTaskMatchesUrl(task, imageUrl)
    );
    if (memoryMatch) {
      return this.getCompleteTask(memoryMatch.id);
    }

    const storedTaskId = await taskStorageReader.findImageTaskIdByResultUrl(
      imageUrl,
      {
        includeArchived: true,
        limit: STORAGE_LIMITS.MAX_RETAINED_TASKS * 10,
      }
    );
    return storedTaskId ? this.getCompleteTask(storedTaskId) : undefined;
  }

  /**
   * Gets all tasks
   *
   * @returns Array of all tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Gets tasks by status
   *
   * @param status - The status to filter by
   * @returns Array of tasks with the specified status
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }

  /**
   * Gets active tasks (pending, processing, retrying)
   *
   * @returns Array of active tasks
   */
  getActiveTasks(): Task[] {
    return this.getAllTasks().filter(isTaskActive);
  }

  private recordPptExplainerRemoteCancellationFailure(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.CANCELLED) return;

    const state = task.params?.pptExplainer as
      | { diagnostics?: string[] }
      | undefined;
    if (!state) return;
    const diagnostics = state.diagnostics || [];
    if (diagnostics.includes(PPT_EXPLAINER_REMOTE_CANCEL_FAILURE_DIAGNOSTIC)) {
      return;
    }

    this.updateTaskStatus(taskId, TaskStatus.CANCELLED, {
      params: {
        ...task.params,
        pptExplainer: {
          ...state,
          diagnostics: [
            ...diagnostics,
            PPT_EXPLAINER_REMOTE_CANCEL_FAILURE_DIAGNOSTIC,
          ],
        },
      },
    });
  }

  /**
   * Cancels a task
   *
   * @param taskId - The task ID to cancel
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    if (!isTaskActive(task)) {
      console.warn(
        `[TaskQueueService] Task ${taskId} is not active, cannot cancel`
      );
      return;
    }

    const pptExplainerState = task.params?.pptExplainer as
      | {
          stage?: string;
          diagnostics?: string[];
          originalRoute?: {
            binding?: { pptExplainer?: { cancel?: unknown } };
          };
        }
      | undefined;
    const pptExplainerRemoteId = pptExplainerState
      ? task.remoteId || (pptExplainerState as { remoteId?: string }).remoteId
      : undefined;
    const hasPptExplainerCancel = Boolean(
      pptExplainerState?.originalRoute?.binding?.pptExplainer?.cancel
    );
    const cancellationDiagnostics = !pptExplainerState
      ? []
      : !pptExplainerRemoteId
      ? ['供应商提交结果可能未知', '远端任务可能继续执行和计费']
      : !hasPptExplainerCancel
      ? ['供应商未声明远端取消，远端任务可能继续执行和计费']
      : [];
    const cancellationUpdates = pptExplainerState
      ? {
          params: {
            ...task.params,
            pptExplainer: {
              ...pptExplainerState,
              stage: 'cancelled',
              ...(cancellationDiagnostics.length > 0
                ? {
                    diagnostics: [
                      ...(pptExplainerState.diagnostics || []),
                      ...cancellationDiagnostics,
                    ],
                  }
                : {}),
            },
          },
        }
      : undefined;

    this.blockedTaskIds.add(taskId);
    if (task.type === TaskType.IMAGE) {
      const requestId = getImageSubmissionRequestId(task);
      this.updateTaskStatus(taskId, TaskStatus.CANCELLED, cancellationUpdates, {
        persist: false,
      });
      void this.updateImageAttemptStorage(taskId, requestId, () =>
        taskStorageWriter.updateStatus(taskId, 'cancelled', requestId, {
          allowLegacyRequestId: true,
        })
      ).catch((error) => {
        console.error(
          '[TaskQueueService] Failed to cancel image attempt:',
          error
        );
      });
    } else {
      this.updateTaskStatus(taskId, TaskStatus.CANCELLED, cancellationUpdates);
    }
    this.abortTaskExecution(taskId);
    this.renewTaskExecutionToken(taskId);
    imageGenerationRecoveryService.stop(taskId);
    if (pptExplainerState) {
      const cancelledTask = this.tasks.get(taskId);
      if (cancelledTask) {
        void import('./ppt-explainer/orchestrator')
          .then(({ cancelPptExplainerRemoteTask }) =>
            cancelPptExplainerRemoteTask(cancelledTask)
          )
          .catch(() => {
            this.recordPptExplainerRemoteCancellationFailure(taskId);
            console.warn(
              '[TaskQueueService] PPT explainer remote cancellation failed; remote task may continue and incur charges'
            );
          });
      }
    }
    // console.log(`[TaskQueueService] Cancelled task ${taskId}`);
  }

  /**
   * Retries a failed or cancelled task
   *
   * @param taskId - The task ID to retry
   */
  retryTask(taskId: string, options: { allowCompleted?: boolean } = {}): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    if (
      this.pendingTaskDeletions.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return;
    }

    const canRetryCompleted =
      options.allowCompleted && task.status === TaskStatus.COMPLETED;
    const hasPptExplainerState = Boolean(task.params?.pptExplainer);
    if (hasPptExplainerState && task.status === TaskStatus.CANCELLED) {
      console.warn(
        `[TaskQueueService] Cancelled PPT explainer task ${taskId} cannot be retried because its input cache was released`
      );
      return;
    }
    if (
      task.status !== TaskStatus.FAILED &&
      task.status !== TaskStatus.CANCELLED &&
      !canRetryCompleted
    ) {
      console.warn(
        `[TaskQueueService] Task ${taskId} is not failed, cancelled, or explicitly retryable, cannot retry`
      );
      return;
    }

    // Reset task for retry - set to PROCESSING for immediate execution
    const now = Date.now();
    trackTaskAnalytics('generation_retry_after_failure', task, {
      previousStatus: task.status,
      previousErrorCode: task.error?.code,
      previousErrorMessage: task.error?.message,
    });
    imageGenerationRecoveryService.stop(taskId);
    this.abortTaskExecution(taskId);
    this.renewTaskExecutionToken(taskId);
    this.blockedTaskIds.delete(taskId);
    const pptExplainerState = task.params?.pptExplainer as
      | {
          remoteId?: string;
          source?: string;
          outlineFrameIds?: string[];
          pptxImport?: { status?: string };
          slides?: Array<{ turns?: unknown[] }>;
          stage?: string;
          jobId?: string;
          executionAttempt?: number;
        }
      | undefined;
    const pptExplainerRemoteId = pptExplainerState
      ? task.error?.code === 'remote_failed'
        ? undefined
        : task.remoteId || pptExplainerState.remoteId
      : undefined;
    const pptExplainerRetryStage = pptExplainerState
      ? task.error?.code === 'remote_failed'
        ? 'submitting'
        : pptExplainerRemoteId
        ? 'polling'
        : (pptExplainerState.source === 'topic' &&
            !pptExplainerState.outlineFrameIds?.length) ||
          (pptExplainerState.source === 'pptx' &&
            pptExplainerState.pptxImport?.status !== 'completed')
        ? 'preparing'
        : pptExplainerState.slides?.length
        ? pptExplainerState.slides.every((slide) => slide.turns?.length)
          ? 'submitting'
          : 'scripting'
        : 'snapshotting'
      : undefined;
    const retryParams =
      task.type === TaskType.IMAGE
        ? createImageSubmissionParams(task.params, generateTaskId())
        : pptExplainerState
        ? {
            ...task.params,
            pptExplainer: {
              ...pptExplainerState,
              stage: pptExplainerRetryStage,
              ...(task.error?.code === 'remote_failed'
                ? {
                    remoteId: undefined,
                    idempotencyKey: `${
                      pptExplainerState.jobId || task.id
                    }-retry-${(pptExplainerState.executionAttempt || 0) + 1}`,
                  }
                : {}),
            },
          }
        : task.params;
    this.updateTaskStatus(taskId, TaskStatus.PROCESSING, {
      params: retryParams,
      error: undefined,
      result: undefined,
      startedAt: now, // Set new start time
      completedAt: undefined, // Clear completion time
      remoteId: pptExplainerState ? pptExplainerRemoteId : undefined,
      executionPhase: pptExplainerRemoteId
        ? TaskExecutionPhase.POLLING
        : TaskExecutionPhase.SUBMITTING,
      insertedToCanvas: false,
      progress:
        task.type === TaskType.VIDEO ||
        task.type === TaskType.AUDIO ||
        (task.type === TaskType.CHAT &&
          (typeof task.params.videoAnalyzerAction === 'string' ||
            typeof task.params.musicAnalyzerAction === 'string'))
          ? 0
          : undefined, // Reset progress for async media
    });

    // Execute task after retry
    const updatedTask = this.tasks.get(taskId);
    if (updatedTask && !pptExplainerState) {
      this.executeTask(updatedTask).catch((error) => {
        console.error('[TaskQueueService] Retry execution error:', error);
      });
    }

    // console.log(`[TaskQueueService] Retrying task ${taskId}`);
  }

  /**
   * Deletes a task from the queue
   *
   * @param taskId - The task ID to delete
   */
  deleteTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    this.blockedTaskIds.add(taskId);
    this.rememberRecentlyDeletedTask(taskId);
    const hadStrippedParams = this.tasksWithStrippedParams.has(taskId);
    this.abortTaskExecution(taskId);
    imageGenerationRecoveryService.stop(taskId);
    this.tasks.delete(taskId);
    this.taskExecutionTokens.delete(taskId);
    this.tasksWithStrippedParams.delete(taskId);

    if (task.params?.pptExplainer) {
      const teardown = isTaskActive(task)
        ? (module: typeof import('./ppt-explainer/orchestrator')) =>
            module.cancelPptExplainerRemoteTask(task)
        : (module: typeof import('./ppt-explainer/orchestrator')) =>
            module.cleanupPptExplainerTask(task);
      void import('./ppt-explainer/orchestrator')
        .then(teardown)
        .catch((error) => {
          console.warn(
            '[TaskQueueService] PPT explainer deletion cleanup failed:',
            error
          );
        });
    }

    // Delete from IndexedDB
    this.persistDelete(task, hadStrippedParams);

    this.emitEvent('taskDeleted', task);

    // console.log(`[TaskQueueService] Deleted task ${taskId}`);
  }

  /**
   * Clears completed tasks
   */
  clearCompletedTasks(): void {
    const completedTasks = this.getTasksByStatus(TaskStatus.COMPLETED);
    completedTasks.forEach((task) => this.deleteTask(task.id));
    // console.log(`[TaskQueueService] Cleared ${completedTasks.length} completed tasks`);
  }

  /**
   * Clears failed tasks
   */
  clearFailedTasks(): void {
    const failedTasks = this.getTasksByStatus(TaskStatus.FAILED);
    failedTasks.forEach((task) => this.deleteTask(task.id));
    // console.log(`[TaskQueueService] Cleared ${failedTasks.length} failed tasks`);
  }

  /**
   * 停止所有任务并清空内存与持久化记录。
   * 先阻止异步写回，再使用单次 store.clear() 避免大量逐条删除。
   */
  async clearAllTasks(): Promise<void> {
    taskStorageWriter.pauseWrites();
    const tasks = this.getAllTasks();

    for (const task of tasks) {
      this.blockedTaskIds.add(task.id);
      this.abortTaskExecution(task.id);
      imageGenerationRecoveryService.stop(task.id);
    }

    const pptExplainerTasks = tasks.filter((task) => task.params?.pptExplainer);
    if (pptExplainerTasks.length > 0) {
      try {
        const orchestrator = await import('./ppt-explainer/orchestrator');
        await Promise.allSettled(
          pptExplainerTasks.map((task) =>
            isTaskActive(task)
              ? orchestrator.cancelPptExplainerRemoteTask(task)
              : orchestrator.cleanupPptExplainerTask(task)
          )
        );
      } catch (error) {
        console.warn(
          '[TaskQueueService] PPT explainer clear-all cleanup failed:',
          error
        );
      }
    }

    await Promise.allSettled(this.taskStorageOperations.values());
    for (const task of this.tasks.values()) {
      this.rememberRecentlyDeletedTask(task.id);
    }
    this.tasks.clear();
    this.taskExecutionTokens.clear();
    this.tasksWithStrippedParams.clear();
    this.taskAbortControllers.clear();
    this.executingTasks.clear();
    this.taskStorageOperations.clear();
    this.pendingTaskDeletions.clear();
    this.blockedTaskIds.clear();

    await taskStorageWriter.clearAllTasks();
    taskStorageReader.invalidateCache();

    for (const task of tasks) {
      this.emitEvent('taskDeleted', task);
    }
  }

  /**
   * Tracks an externally-created task in the in-memory Map.
   * Used by media generation services to register tasks so that
   * retryTask() and observeTaskUpdates() work correctly.
   * Idempotent: skips if task already exists in memory.
   */
  trackExternalTask(task: Task): void {
    if (
      this.pendingTaskDeletions.has(task.id) ||
      this.recentlyDeletedTaskIds.has(task.id)
    ) {
      return;
    }
    this.blockedTaskIds.delete(task.id);
    if (this.tasks.has(task.id)) return;
    const trackedTask: Task = task.invocationRoute
      ? task
      : {
          ...task,
          invocationRoute: createTaskInvocationRouteSnapshotFromTask(task),
        };
    this.tasks.set(task.id, trackedTask);
    this.renewTaskExecutionToken(task.id);
    this.persistTask(trackedTask);
    this.emitEvent('taskCreated', trackedTask);
    trackTaskAnalytics('generation_task_created', trackedTask, {
      source: 'external_task',
    });
  }

  /**
   * Sync task state from IndexedDB to in-memory Map without writing back.
   * Used by media generation services to keep the in-memory state in sync
   * when the executor updates IndexedDB directly.
   */
  syncTaskFromStorage(taskId: string, storageTask: Partial<Task>): void {
    if (
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) return;
    if (!hasStorageTaskChanges(task, storageTask)) {
      return;
    }

    const updatedTask: Task = {
      ...task,
      ...storageTask,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updatedTask);
    this.emitEvent('taskUpdated', updatedTask);
  }

  private syncImageAttemptFromStorage(
    taskId: string,
    storageTask: SWTask
  ): void {
    if (
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return;
    }

    const currentTask = this.tasks.get(taskId);
    if (!currentTask) {
      return;
    }

    const storagePatch: Partial<Task> = {
      status: storageTask.status as TaskStatus,
      params: {
        ...currentTask.params,
        submissionRequestId: storageTask.params.submissionRequestId,
        imageSubmissionAttempted: storageTask.params.imageSubmissionAttempted,
      },
      startedAt: storageTask.startedAt,
      completedAt: storageTask.completedAt,
      result: storageTask.result,
      error: storageTask.error as Task['error'],
      progress: storageTask.progress,
      remoteId: storageTask.remoteId,
      invocationRoute: storageTask.invocationRoute,
      executionPhase: storageTask.executionPhase as Task['executionPhase'],
    };
    const requestIdChanged =
      currentTask.params.submissionRequestId !==
      storageTask.params.submissionRequestId;
    const attemptChanged =
      requestIdChanged ||
      currentTask.params.imageSubmissionAttempted !==
        storageTask.params.imageSubmissionAttempted;
    const cancellationLostToTerminal =
      currentTask.status === TaskStatus.CANCELLED &&
      (storageTask.status === 'completed' || storageTask.status === 'failed');
    if (!attemptChanged && !hasStorageTaskChanges(currentTask, storagePatch)) {
      return;
    }

    if (requestIdChanged || cancellationLostToTerminal) {
      this.blockedTaskIds.delete(taskId);
    }

    const updatedTask: Task = {
      ...currentTask,
      ...storagePatch,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updatedTask);
    this.emitEvent('taskUpdated', updatedTask);
  }

  private async updateImageAttemptStorage(
    taskId: string,
    requestId: string,
    operation: () => Promise<boolean>,
    validateStoredTask: (task: SWTask) => boolean = () => true,
    isCurrentAttempt: () => boolean = () => true
  ): Promise<boolean> {
    let updated = false;
    await this.enqueueTaskStorageOperation(taskId, async () => {
      if (!isCurrentAttempt()) {
        return;
      }
      updated = await operation();
      taskStorageReader.invalidateCache();
    });

    if (!isCurrentAttempt()) {
      return false;
    }
    const storageTask = await taskStorageWriter.getTask(taskId);
    if (!isCurrentAttempt()) {
      return false;
    }
    if (storageTask) {
      const currentTask = this.tasks.get(taskId);
      const currentRequestId =
        currentTask?.type === TaskType.IMAGE
          ? getImageSubmissionRequestId(currentTask)
          : undefined;
      const storageRequestId = storageTask.params.submissionRequestId;
      const localAttemptChanged =
        currentRequestId !== undefined && currentRequestId !== requestId;
      const storageStillMatchesOperation = storageRequestId === requestId;

      // 本地已开始新重试时，不允许较晚结束的旧事务把内存回滚到旧尝试。
      // 若存储已是另一个 Request ID，则说明来自其他标签页，仍需同步。
      if (!localAttemptChanged || !storageStillMatchesOperation) {
        this.syncImageAttemptFromStorage(taskId, storageTask);
      }
    }
    return Boolean(
      updated &&
        storageTask?.params.submissionRequestId === requestId &&
        validateStoredTask(storageTask)
    );
  }

  async activateImageAttempt(
    taskId: string,
    requestId: string
  ): Promise<boolean> {
    if (
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return false;
    }
    return this.updateImageAttemptStorage(taskId, requestId, () =>
      taskStorageWriter.updateStatus(taskId, 'processing', requestId)
    );
  }

  async updateImageAttemptProgress(
    taskId: string,
    requestId: string,
    progress: number,
    phase?: Task['executionPhase']
  ): Promise<boolean> {
    if (
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return false;
    }
    return this.updateImageAttemptStorage(taskId, requestId, () =>
      taskStorageWriter.updateProgress(taskId, progress, phase, requestId)
    );
  }

  async updateImageAttemptRemoteId(
    taskId: string,
    requestId: string,
    remoteId: string,
    invocationRoute?: Task['invocationRoute']
  ): Promise<boolean> {
    if (
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return false;
    }
    return this.updateImageAttemptStorage(taskId, requestId, () =>
      taskStorageWriter.updateRemoteId(
        taskId,
        remoteId,
        invocationRoute,
        requestId
      )
    );
  }

  async markImageAttemptRecovering(
    taskId: string,
    requestId: string,
    executionGuard?: ImageAttemptExecutionGuard
  ): Promise<boolean> {
    const isCurrentRecoveryAttempt = () => {
      const currentTask = this.tasks.get(taskId);
      return Boolean(
        currentTask?.type === TaskType.IMAGE &&
          currentTask.status === TaskStatus.PROCESSING &&
          getImageSubmissionRequestId(currentTask) === requestId &&
          (!executionGuard ||
            ((currentTask.startedAt ?? currentTask.createdAt) ===
              executionGuard.startedAt &&
              this.taskExecutionTokens.get(taskId) ===
                executionGuard.executionToken)) &&
          !this.blockedTaskIds.has(taskId) &&
          !this.recentlyDeletedTaskIds.has(taskId)
      );
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!isCurrentRecoveryAttempt()) {
        return false;
      }

      try {
        const persisted = await this.updateImageAttemptStorage(
          taskId,
          requestId,
          () =>
            taskStorageWriter.markImageAttemptRecovering(taskId, requestId, {
              expectedStartedAt: executionGuard?.startedAt,
              shouldUpdate: isCurrentRecoveryAttempt,
            }),
          undefined,
          isCurrentRecoveryAttempt
        );
        if (persisted) {
          return true;
        }

        const currentTask = this.tasks.get(taskId);
        if (
          currentTask?.type !== TaskType.IMAGE ||
          currentTask.status !== TaskStatus.PROCESSING ||
          getImageSubmissionRequestId(currentTask) !== requestId
        ) {
          return false;
        }
        lastError = new Error('Recovery state persistence was rejected');
      } catch (error) {
        lastError = error;
        if (!isCurrentRecoveryAttempt()) {
          return false;
        }
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 25 * 2 ** attempt)
          );
          if (!isCurrentRecoveryAttempt()) {
            return false;
          }
        }
      }
    }

    if (lastError && isCurrentRecoveryAttempt()) {
      console.warn(
        `[TaskQueueService] Recovery state persistence failed for task ${taskId}; recovery was not started`,
        lastError
      );
    }

    return false;
  }

  async completeImageAttempt(
    taskId: string,
    requestId: string,
    result: Task['result']
  ): Promise<boolean> {
    if (
      this.blockedTaskIds.has(taskId) ||
      this.recentlyDeletedTaskIds.has(taskId)
    ) {
      return false;
    }
    return this.updateImageAttemptStorage(
      taskId,
      requestId,
      () => taskStorageWriter.completeTask(taskId, result, requestId),
      (storedTask) =>
        storedTask.status === 'completed' &&
        typeof storedTask.result?.url === 'string' &&
        storedTask.result.url.length > 0
    );
  }

  async failImageAttempt(
    taskId: string,
    requestId: string,
    error: NonNullable<Task['error']>,
    options: {
      allowPending?: boolean;
      allowLegacyRequestId?: boolean;
      clearStartedAt?: boolean;
      executionGuard?: ImageAttemptExecutionGuard;
    } = {}
  ): Promise<boolean> {
    const { executionGuard, ...storageOptions } = options;
    const isCurrentAttempt = () => {
      const currentTask = this.tasks.get(taskId);
      const currentRequestId =
        currentTask?.type === TaskType.IMAGE
          ? getImageSubmissionRequestId(currentTask)
          : undefined;
      return Boolean(
        currentTask?.type === TaskType.IMAGE &&
          (currentTask.status === TaskStatus.PROCESSING ||
            (storageOptions.allowPending &&
              currentTask.status === TaskStatus.PENDING)) &&
          (currentRequestId === requestId ||
            (storageOptions.allowLegacyRequestId &&
              currentRequestId === undefined &&
              taskId === requestId)) &&
          (!executionGuard ||
            ((currentTask.startedAt ?? currentTask.createdAt) ===
              executionGuard.startedAt &&
              this.taskExecutionTokens.get(taskId) ===
                executionGuard.executionToken)) &&
          !this.blockedTaskIds.has(taskId) &&
          !this.recentlyDeletedTaskIds.has(taskId)
      );
    };
    if (!isCurrentAttempt()) {
      return false;
    }
    return this.updateImageAttemptStorage(
      taskId,
      requestId,
      () =>
        taskStorageWriter.failTask(
          taskId,
          error as SWTask['error'],
          requestId,
          {
            ...storageOptions,
            expectedStartedAt: executionGuard?.startedAt,
            shouldUpdate: isCurrentAttempt,
          }
        ),
      (storedTask) => storedTask.status === 'failed',
      isCurrentAttempt
    );
  }

  /**
   * Restores tasks from storage
   *
   * Uses merge strategy: only restores tasks that don't already exist in memory,
   * or whose in-memory version is older than the stored version.
   * This prevents overwriting active tasks whose status has been updated
   * by executeTask() but not yet persisted to IndexedDB at read time.
   *
   * @param tasks - Array of tasks to restore
   * @param options.allowDeletedTaskRestore - Explicit backup/sync restore may
   * revive a recently deleted task and waits for the replacement write.
   * @param options.deletedTasksOnly - Restrict this batch to deleting or
   * recently deleted tasks.
   */
  restoreTasks(
    tasks: Task[],
    options: {
      allowDeletedTaskRestore?: boolean;
      deletedTasksOnly?: boolean;
    } = {}
  ): Promise<void> {
    let restoredCount = 0;
    const pendingRestores: Promise<void>[] = [];
    tasks.forEach((task) => {
      // 跳过已归档的任务
      if (task.archived) return;

      const restoreAfterDelete =
        this.pendingTaskDeletions.has(task.id) ||
        this.recentlyDeletedTaskIds.has(task.id);
      if (options.deletedTasksOnly && !restoreAfterDelete) {
        return;
      }
      if (restoreAfterDelete && !options.allowDeletedTaskRestore) {
        return;
      }

      const existing = this.tasks.get(task.id);

      // Skip if in-memory task is newer or at a more advanced status
      if (existing) {
        // If in-memory task was updated more recently, keep it
        if (existing.updatedAt >= task.updatedAt) {
          if (restoreAfterDelete && options.allowDeletedTaskRestore) {
            const pending = this.taskStorageOperations.get(task.id);
            if (pending) {
              pendingRestores.push(pending);
            }
          }
          return;
        }
      }
      const existingHadStrippedParams = this.tasksWithStrippedParams.has(
        task.id
      );
      // Ensure video tasks have progress field (for backward compatibility)
      let restoredTask: Task =
        task.type === TaskType.VIDEO && task.progress === undefined
          ? { ...task, progress: 0 }
          : { ...task };
      const persistableRestoredTask = restoredTask;

      // 剥离大字段（base64 参考图等），减少内存占用
      if (
        restoredTask.params?.referenceImages ||
        restoredTask.params?.uploadedImages ||
        restoredTask.params?.videoData ||
        restoredTask.params?.audioData
      ) {
        this.tasksWithStrippedParams.add(restoredTask.id);
        restoredTask = {
          ...restoredTask,
          params: {
            ...restoredTask.params,
            referenceImages: undefined,
            uploadedImages: undefined,
            videoData: undefined,
            audioData: undefined,
          },
        };
      } else {
        this.tasksWithStrippedParams.delete(restoredTask.id);
      }

      const deletionInFlight = this.pendingTaskDeletions.has(restoredTask.id);
      if (!deletionInFlight) {
        this.blockedTaskIds.delete(restoredTask.id);
      }
      if (existing) {
        imageGenerationRecoveryService.stop(restoredTask.id);
        this.abortTaskExecution(restoredTask.id);
      }
      this.tasks.set(restoredTask.id, restoredTask);
      this.renewTaskExecutionToken(restoredTask.id);
      if (restoreAfterDelete) {
        const restoreOperation = this.enqueueTaskStorageOperation(
          restoredTask.id,
          () => this.persistTaskInternal(persistableRestoredTask)
        ).then(
          () => {
            if (this.tasks.get(restoredTask.id) === restoredTask) {
              this.recentlyDeletedTaskIds.delete(restoredTask.id);
              if (!this.pendingTaskDeletions.has(restoredTask.id)) {
                this.emitEvent('taskUpdated', restoredTask);
              }
            }
          },
          (error) => {
            if (this.tasks.get(restoredTask.id) === restoredTask) {
              if (existing) {
                this.tasks.set(existing.id, existing);
                this.renewTaskExecutionToken(existing.id);
                if (existingHadStrippedParams) {
                  this.tasksWithStrippedParams.add(existing.id);
                } else {
                  this.tasksWithStrippedParams.delete(existing.id);
                }
                this.emitEvent('taskUpdated', existing);
              } else {
                this.tasks.delete(restoredTask.id);
                this.taskExecutionTokens.delete(restoredTask.id);
                this.tasksWithStrippedParams.delete(restoredTask.id);
                this.emitEvent('taskDeleted', restoredTask);
              }
            }
            throw error;
          }
        );
        pendingRestores.push(restoreOperation);
      }
      if (
        restoredTask.status === TaskStatus.PENDING ||
        restoredTask.status === TaskStatus.PROCESSING
      ) {
        trackTaskAnalytics('task_recovered_after_reload', restoredTask, {
          restoredAgeMs: Math.max(0, Date.now() - restoredTask.createdAt),
        });
      }
      restoredCount++;
    });

    // Emit a single batch update event instead of per-task events
    console.warn(
      `[TaskQueueService] restoreTasks: ${restoredCount}/${tasks.length} restored, total in memory: ${this.tasks.size}`
    );
    if (restoredCount > 0) {
      // Use the first task to emit a generic update that triggers UI refresh
      const allTasks = Array.from(this.tasks.values());
      if (allTasks.length > 0) {
        this.emitEvent('taskCreated', allTasks[0]);
      }
      // 恢复后检查是否需要归档
      this.enforceRetentionLimit();
    }
    // console.log(`[TaskQueueService] Restored ${restoredCount}/${tasks.length} tasks (merged)`);
    return Promise.all(pendingRestores).then(() => undefined);
  }

  /**
   * Observes task update events
   *
   * @returns Observable stream of task events
   */
  observeTaskUpdates(): Observable<TaskEvent> {
    return this.taskUpdates$.asObservable();
  }

  /**
   * Marks a task as saved to the media library
   * This prevents duplicate saves when task updates occur
   *
   * @param taskId - The task ID to mark as saved
   */
  markAsSaved(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    this.updateTaskStatus(taskId, task.status, {
      savedToLibrary: true,
    });

    // console.log(`[TaskQueueService] Marked task ${taskId} as saved to library`);
  }

  /**
   * Marks a task as inserted to canvas
   * @param taskId - The task ID to mark as inserted
   */
  markAsInserted(taskId: string, source: InsertionSource = 'manual'): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    if (task.insertedToCanvas) {
      return;
    }

    trackTaskAnalytics('generation_result_insert_canvas', task, {
      source,
      insertSource: source,
      insert_source: source,
      insertedToCanvas: true,
      inserted_to_canvas: true,
    });

    const pptExplainer = task.params?.pptExplainer as
      | {
          delivery?: { resultSaved?: boolean; canvasInserted?: boolean };
        }
      | undefined;

    this.updateTaskStatus(taskId, task.status, {
      insertedToCanvas: true,
      ...(pptExplainer
        ? {
            params: {
              ...task.params,
              pptExplainer: {
                ...pptExplainer,
                delivery: {
                  resultSaved: pptExplainer.delivery?.resultSaved ?? true,
                  canvasInserted: true,
                },
              },
            },
          }
        : {}),
    });
  }

  /**
   * 自动归档超出保留限制的终态任务
   * 归档后任务仍保留在 IndexedDB 中，但不参与活跃加载
   */
  private enforceRetentionLimit(): void {
    const maxActive = STORAGE_LIMITS.MAX_RETAINED_TASKS;
    if (this.tasks.size <= maxActive) return;

    // 收集终态任务，按 updatedAt 升序（最旧的优先归档）
    const terminalTasks: Task[] = [];
    for (const task of this.tasks.values()) {
      if (
        task.status === TaskStatus.COMPLETED ||
        task.status === TaskStatus.FAILED ||
        task.status === TaskStatus.CANCELLED
      ) {
        terminalTasks.push(task);
      }
    }

    terminalTasks.sort((a, b) => a.updatedAt - b.updatedAt);

    const toArchiveCount = this.tasks.size - maxActive;
    if (toArchiveCount <= 0) return;

    const archiveIds: string[] = [];
    const pptExplainerTasksToCleanup: Task[] = [];
    for (let i = 0; i < Math.min(toArchiveCount, terminalTasks.length); i++) {
      const task = terminalTasks[i];
      this.tasks.delete(task.id);
      this.taskExecutionTokens.delete(task.id);
      this.tasksWithStrippedParams.delete(task.id);
      archiveIds.push(task.id);
      if (task.params?.pptExplainer) {
        pptExplainerTasksToCleanup.push(task);
      }
    }

    // 异步批量归档到 IndexedDB（fire-and-forget）
    if (archiveIds.length > 0) {
      taskStorageWriter.archiveTasks(archiveIds).catch(() => undefined);
      taskStorageReader.invalidateCache();
    }
    if (pptExplainerTasksToCleanup.length > 0) {
      void import('./ppt-explainer/orchestrator')
        .then(({ cleanupPptExplainerTask }) =>
          Promise.allSettled(
            pptExplainerTasksToCleanup.map((task) =>
              cleanupPptExplainerTask(task)
            )
          )
        )
        .catch((error) => {
          console.warn(
            '[TaskQueueService] PPT explainer retention cleanup failed:',
            error
          );
        });
    }
  }

  /**
   * 从内存中的任务副本剥离大字段（referenceImages 等 base64 数据）
   * 不写回 IndexedDB，保留原始数据供重试时从 DB 读取
   */
  private stripLargeParams(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task?.params) return;
    const params = task.params as Record<string, unknown>;
    if (
      params.referenceImages ||
      params.uploadedImages ||
      params.videoData ||
      params.audioData
    ) {
      this.tasksWithStrippedParams.add(taskId);
      this.tasks.set(taskId, {
        ...task,
        params: {
          ...task.params,
          referenceImages: undefined,
          uploadedImages: undefined,
          videoData: undefined,
          audioData: undefined,
        },
      });
    }
  }

  private async restoreStrippedTaskParams(task: Task): Promise<Task> {
    if (!this.tasksWithStrippedParams.has(task.id)) {
      return task;
    }

    const storedTask = await taskStorageWriter
      .getTask(task.id)
      .catch(() => null);
    const persistedParams = storedTask?.params as Record<
      string,
      unknown
    > | null;

    if (!hasAnyPersistedLargeTaskParams(persistedParams)) {
      return task;
    }

    const mergedParams = mergePersistedLargeTaskParams(
      task.params,
      persistedParams
    );
    if (mergedParams === task.params) {
      return task;
    }

    return {
      ...task,
      params: mergedParams,
    };
  }

  /**
   * Emits a task event
   * @private
   */
  private emitEvent(type: TaskEvent['type'], task: Task): void {
    // 浅拷贝 task 对象，确保 React 组件的 memo/shouldComponentUpdate 能检测到变化
    // 否则 useFilteredTaskQueue 收到的 event.task 与数组中已有的对象是同一引用，
    // React.memo 比较 prev.task.progress === next.task.progress 时看到的是同一个已变异对象，
    // 永远相等，导致不重新渲染
    this.taskUpdates$.next({
      type,
      task: { ...task },
      timestamp: Date.now(),
    });
  }
}

// Export singleton instance
export const taskQueueService = TaskQueueService.getInstance();
