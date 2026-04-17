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
import {
  getAdapterContextFromSettings,
  resolveAdapterForInvocation,
} from './model-adapters';
import { cacheRemoteUrl } from './media-executor/fallback-utils';
import { STORAGE_LIMITS } from '../constants/TASK_CONSTANTS';
import { sendChatWithGemini } from '../utils/gemini-api/services';
import type { GeminiMessage } from '../utils/gemini-api/types';
import { buildInlineDataPart } from '../utils/gemini-api/message-utils';
import { unifiedCacheService } from './unified-cache-service';
import { buildGenerateContentConfig } from './analysis-core';
import { callGoogleGenerateContentWithLog } from '../utils/gemini-api/logged-calls';
import { executeVideoAnalysis } from './video-analysis-service';
import {
  formatShotsMarkdown,
  type VideoAnalysisData,
} from '../components/video-analyzer/types';
import { loadRecords } from '../components/video-analyzer/storage';
import {
  applyRewriteShotUpdates,
  parseRewriteShotUpdates,
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

const VIDEO_ANALYZER_SIMULATED_DURATION_MS = 10 * 60 * 1000;
const VIDEO_ANALYZER_SIMULATED_INTERVAL_MS = 5000;
const VIDEO_ANALYZER_SIMULATED_START_PROGRESS = 15;
const VIDEO_ANALYZER_SIMULATED_END_PROGRESS = 95;
const VIDEO_REWRITE_SIMULATED_DURATION_MS = 2 * 60 * 1000;
const VIDEO_REWRITE_SIMULATED_INTERVAL_MS = 2000;
const VIDEO_REWRITE_SIMULATED_START_PROGRESS = 20;
const VIDEO_REWRITE_SIMULATED_END_PROGRESS = 95;
const MUSIC_ANALYZER_SIMULATED_DURATION_MS = 4 * 60 * 1000;
const MUSIC_ANALYZER_SIMULATED_INTERVAL_MS = 3000;
const MUSIC_ANALYZER_SIMULATED_START_PROGRESS = 12;
const MUSIC_ANALYZER_SIMULATED_END_PROGRESS = 95;
const MUSIC_REWRITE_SIMULATED_DURATION_MS = 2 * 60 * 1000;
const MUSIC_REWRITE_SIMULATED_INTERVAL_MS = 2000;
const MUSIC_REWRITE_SIMULATED_START_PROGRESS = 20;
const MUSIC_REWRITE_SIMULATED_END_PROGRESS = 95;

function normalizeImageDataUrl(value: string, fallbackMimeType = 'image/png'): string {
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
    console.warn('[TaskQueueService] Audio cover cache failed, using original URL:', error);
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
  private executingTasks = new Set<string>();
  private blockedTaskIds = new Set<string>();

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
      executionPhase: task.executionPhase,
      savedToLibrary: task.savedToLibrary,
      insertedToCanvas: task.insertedToCanvas,
    };
  }

  /**
   * Persist task to IndexedDB (async, fire-and-forget)
   */
  private persistTask(task: Task): void {
    const swTask = this.convertToSWTask(task);
    taskStorageWriter.saveTask(swTask).catch((error) => {
      console.error('[TaskQueueService] Failed to persist task:', error);
    });
    // Invalidate reader cache after write
    taskStorageReader.invalidateCache();
  }

  /**
   * Delete task from IndexedDB (async, fire-and-forget)
   */
  private persistDelete(taskId: string): void {
    taskStorageWriter.deleteTask(taskId).catch((error) => {
      console.error(
        '[TaskQueueService] Failed to delete task from storage:',
        error
      );
    });
    // Invalidate reader cache after delete
    taskStorageReader.invalidateCache();
  }

  /**
   * Execute task using executor (for legacy/fallback mode)
   * This is called automatically after task creation
   */
  private async executeTask(task: Task): Promise<void> {
    // 防止同一任务被重复执行（双重调用防护）
    if (this.executingTasks.has(task.id)) {
      console.warn(`[TaskQueueService] Task ${task.id} is already executing, skipping duplicate`);
      return;
    }
    this.executingTasks.add(task.id);
    try {
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
        this.updateTaskStatus(task.id, TaskStatus.FAILED, {
          error: { code: 'NO_API_KEY', message: '未配置 API Key' },
        });
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
              onProgress: (progress: number) => {
                this.updateTaskProgress(task.id, progress);
                this.updateTaskStatus(task.id, TaskStatus.PROCESSING, {
                  executionPhase: TaskExecutionPhase.POLLING,
                });
              },
              onSubmitted: (remoteId: string) => {
                this.updateTaskStatus(task.id, TaskStatus.PROCESSING, {
                  remoteId,
                  executionPhase: TaskExecutionPhase.POLLING,
                });
              },
            },
          }
        );

        // 缓存音频 URL 到 Cache Storage，防止远程链接过期
        const fmt = result.format || (result.resultKind === 'lyrics' ? 'lyrics' : 'mp3');
        let cachedUrl = result.url;
        let cachedUrls = result.urls;
        let cachedPreviewImageUrl = result.imageUrl;
        let cachedClips = result.clips;

        if (fmt !== 'lyrics') {
          try {
            const audioMeta = {
              extraMetadata: {
                name: result.title || task.params.title || task.params.prompt?.substring(0, 30) || 'AI音频',
                providerTaskId: result.providerTaskId || task.remoteId,
                duration: typeof result.duration === 'number' ? result.duration : undefined,
              },
            };
            cachedUrl = await cacheRemoteUrl(result.url, task.id, 'audio', fmt, undefined, audioMeta);
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
                      name: clip.title || result.title || task.params.title || task.params.prompt?.substring(0, 30) || 'AI音频',
                      clipId: clip.clipId || clip.id,
                      providerTaskId: result.providerTaskId || task.remoteId,
                      duration: typeof clip.duration === 'number' ? clip.duration : undefined,
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
                cachedClips?.[0]?.imageLargeUrl ||
                cachedClips?.[0]?.imageUrl;
            }
          } catch (cacheError) {
            console.warn('[TaskQueueService] Audio cache failed, using original URLs:', cacheError);
          }
        }

        const now = Date.now();
        const completedTask: Task = {
          ...(this.tasks.get(task.id) || task),
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
        onProgress: (progress: { progress: number; phase?: string }) => {
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
          // 从 params.params 中提取额外参数（如 quality）
          const extraParams = (task.params as any).params || {};
          await executor.generateImage(
            {
              taskId: task.id,
              prompt: task.params.prompt,
              model: task.params.model,
              modelRef: task.params.modelRef || null,
              size: task.params.size,
              referenceImages: task.params.referenceImages as
                | string[]
                | undefined,
              count: task.params.count as number | undefined,
              uploadedImages: task.params.uploadedImages as
                | Array<{ url?: string }>
                | undefined,
              quality: extraParams.quality as '1k' | '2k' | '4k' | undefined,
              params: extraParams,
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
            },
            executionOptions
          );
          break;
        }
        case TaskType.CHAT: {
          if ((task.params as { videoAnalyzerAction?: string }).videoAnalyzerAction === 'analyze') {
            await this.executeVideoAnalyzerAnalyzeTask(task);
            break;
          }

          if ((task.params as { videoAnalyzerAction?: string }).videoAnalyzerAction === 'rewrite') {
            await this.executeVideoAnalyzerRewriteTask(task, executionOptions);
            break;
          }

          if ((task.params as { musicAnalyzerAction?: string }).musicAnalyzerAction === 'analyze') {
            await this.executeMusicAnalyzerAnalyzeTask(task);
            break;
          }

          if ((task.params as { musicAnalyzerAction?: string }).musicAnalyzerAction === 'rewrite') {
            await this.executeMusicAnalyzerRewriteTask(task, executionOptions);
            break;
          }

          if ((task.params as { musicAnalyzerAction?: string }).musicAnalyzerAction === 'lyrics-gen') {
            await this.executeMusicAnalyzerLyricsGenTask(task, executionOptions);
            break;
          }

          if ((task.params as { mvCreatorAction?: string }).mvCreatorAction === 'storyboard') {
            await this.executeMVStoryboardTask(task, executionOptions);
            break;
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
              params: (task.params as any).params,
            },
            executionOptions
          );
          break;
        }
        default:
          throw new Error(`Unsupported task type: ${task.type}`);
      }

      // Poll for task completion (executor 已完成，此处主要是从 IndexedDB 读取最终结果)
      const result = await waitForTaskCompletion(task.id, {
        timeout: 10 * 60 * 1000, // 10 minutes
        onProgress: (updatedTask) => {
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
            this.tasks.set(task.id, newTask);
            this.emitEvent('taskUpdated', newTask);
          }
        },
      });

      // Update final state & persist
      const localTask = this.tasks.get(task.id);
      if (localTask && result.task) {
        const finalTask: Task = {
          ...localTask,
          status: result.task.status as TaskStatus,
          result: result.task.result,
          error: result.task.error,
          completedAt: result.task.completedAt,
          updatedAt: Date.now(),
        };
        this.tasks.set(task.id, finalTask);

        // Persist final state
        this.persistTask(finalTask);
        this.emitEvent('taskUpdated', finalTask);
      }
    } catch (error: any) {
      console.error('[TaskQueueService] Task execution failed:', error);
      const localTask = this.tasks.get(task.id);
      if (localTask) {
        const now = Date.now();
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
        this.tasks.set(task.id, failedTask);
        this.persistTask(failedTask);
        this.emitEvent('taskUpdated', failedTask);
      }
    } finally {
      this.executingTasks.delete(task.id);
    }
  }

  private async finalizeChatTask(
    task: Task,
    payload: {
      title: string;
      chatResponse: string;
      format?: string;
      resultExtras?: Partial<NonNullable<Task['result']>>;
    }
  ): Promise<void> {
    const result: NonNullable<Task['result']> = {
      url: '',
      format: payload.format || 'json',
      size: payload.chatResponse.length,
      resultKind: 'chat',
      title: payload.title,
      chatResponse: payload.chatResponse,
      ...payload.resultExtras,
    };

    await taskStorageWriter.completeTask(task.id, result);

    const now = Date.now();
    const completedTask: Task = {
      ...(this.tasks.get(task.id) || task),
      status: TaskStatus.COMPLETED,
      progress: 100,
      result,
      executionPhase: undefined,
      completedAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, completedTask);
    this.persistTask(completedTask);
    this.emitEvent('taskUpdated', completedTask);
    this.emitEvent('taskCompleted', completedTask);
  }

  private async executeVideoAnalyzerAnalyzeTask(task: Task): Promise<void> {
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

    await taskStorageWriter.updateStatus(task.id, 'processing');
    this.updateTaskProgress(task.id, 8);

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

    this.updateTaskProgress(task.id, VIDEO_ANALYZER_SIMULATED_START_PROGRESS);

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / VIDEO_ANALYZER_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        VIDEO_ANALYZER_SIMULATED_START_PROGRESS +
        (VIDEO_ANALYZER_SIMULATED_END_PROGRESS -
          VIDEO_ANALYZER_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateTaskProgress(task.id, Math.floor(nextProgress));
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

      const analysis = (result.data as { analysis: VideoAnalysisData }).analysis;
      const formattedText = formatShotsMarkdown(analysis.shots || [], analysis);
      await this.finalizeChatTask(task, {
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
    options: {
      onProgress: (progress: { progress: number; phase?: string }) => void;
    }
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

    await taskStorageWriter.updateStatus(task.id, 'processing');
    options.onProgress({
      progress: VIDEO_REWRITE_SIMULATED_START_PROGRESS,
      phase: 'submitting',
    });
    await taskStorageWriter.updateProgress(
      task.id,
      VIDEO_REWRITE_SIMULATED_START_PROGRESS,
      'submitting'
    );

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / VIDEO_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        VIDEO_REWRITE_SIMULATED_START_PROGRESS +
        (VIDEO_REWRITE_SIMULATED_END_PROGRESS -
          VIDEO_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateTaskProgress(task.id, Math.floor(nextProgress));
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
        ? (await loadRecords()).find(record => record.id === recordId) || null
        : null;

      const updates = parseRewriteShotUpdates(text);
      const baseShots = targetRecord?.editedShots || targetRecord?.analysis.shots || [];
      const editedShots = applyRewriteShotUpdates(baseShots, updates);
      const formattedText =
        targetRecord && editedShots.length > 0
          ? formatShotsMarkdown(
              editedShots,
              targetRecord.analysis,
              targetRecord.productInfo
            )
          : text;

      options.onProgress({ progress: 100 });
      await this.finalizeChatTask(task, {
        title: '脚本改编结果',
        chatResponse: formattedText,
        format: 'md',
        resultExtras: {
          analysisData: {
            editedShots,
            rawResponse: text,
          },
        },
      });
    } finally {
      window.clearInterval(progressTimer);
    }
  }

  private async executeMusicAnalyzerAnalyzeTask(task: Task): Promise<void> {
    const params = task.params as {
      model?: string;
      modelRef?: Task['params']['modelRef'];
      mimeType?: string;
      audioData?: string;
      audioCacheUrl?: string;
      musicAnalyzerPrompt?: string;
      prompt?: string;
    };

    await taskStorageWriter.updateStatus(task.id, 'processing');
    this.updateTaskProgress(task.id, 8);

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

    this.updateTaskProgress(task.id, MUSIC_ANALYZER_SIMULATED_START_PROGRESS);

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_ANALYZER_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_ANALYZER_SIMULATED_START_PROGRESS +
        (MUSIC_ANALYZER_SIMULATED_END_PROGRESS -
          MUSIC_ANALYZER_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateTaskProgress(task.id, Math.floor(nextProgress));
    }, MUSIC_ANALYZER_SIMULATED_INTERVAL_MS);

    try {
      const result = await executeMusicAnalysis({
        audioData,
        mimeType,
        prompt: params.musicAnalyzerPrompt || params.prompt || DEFAULT_MUSIC_ANALYSIS_PROMPT,
        model: params.model,
        modelRef: params.modelRef || null,
      });

      if (!result.success || !result.data) {
        throw new Error(result.error || '音频分析失败');
      }

      const analysis = (result.data as { analysis: MusicAnalysisData }).analysis;
      const formattedText = formatMusicAnalysisMarkdown(analysis);
      await this.finalizeChatTask(task, {
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
    options: {
      onProgress: (progress: { progress: number; phase?: string }) => void;
    }
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

    await taskStorageWriter.updateStatus(task.id, 'processing');
    options.onProgress({
      progress: MUSIC_REWRITE_SIMULATED_START_PROGRESS,
      phase: 'submitting',
    });
    await taskStorageWriter.updateProgress(
      task.id,
      MUSIC_REWRITE_SIMULATED_START_PROGRESS,
      'submitting'
    );

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_REWRITE_SIMULATED_START_PROGRESS +
        (MUSIC_REWRITE_SIMULATED_END_PROGRESS -
          MUSIC_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateTaskProgress(task.id, Math.floor(nextProgress));
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
        ? (await loadMusicRecords()).find((record) => record.id === recordId) || null
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
      await this.finalizeChatTask(task, {
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
    options: {
      onProgress: (progress: { progress: number; phase?: string }) => void;
    }
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

    await taskStorageWriter.updateStatus(task.id, 'processing');
    options.onProgress({
      progress: MUSIC_REWRITE_SIMULATED_START_PROGRESS,
      phase: 'submitting',
    });
    await taskStorageWriter.updateProgress(
      task.id,
      MUSIC_REWRITE_SIMULATED_START_PROGRESS,
      'submitting'
    );

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_REWRITE_SIMULATED_START_PROGRESS +
        (MUSIC_REWRITE_SIMULATED_END_PROGRESS -
          MUSIC_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateTaskProgress(task.id, Math.floor(nextProgress));
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
        ? (await loadMusicRecords()).find((record) => record.id === recordId) || null
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
      await this.finalizeChatTask(task, {
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
    options: {
      onProgress: (progress: { progress: number; phase?: string }) => void;
    }
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

    await taskStorageWriter.updateStatus(task.id, 'processing');
    options.onProgress({
      progress: MUSIC_REWRITE_SIMULATED_START_PROGRESS,
      phase: 'submitting',
    });
    await taskStorageWriter.updateProgress(
      task.id,
      MUSIC_REWRITE_SIMULATED_START_PROGRESS,
      'submitting'
    );

    // 读取音频 base64
    let audioData: string | undefined;
    let audioMimeType = 'audio/mpeg';
    if (params.audioCacheUrl) {
      const blob =
        (await unifiedCacheService.getCachedBlob(params.audioCacheUrl)) ||
        (await fetch(params.audioCacheUrl).then(r => r.ok ? r.blob() : null));
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

    const startedAt = Date.now();
    const progressTimer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.min(elapsed / MUSIC_REWRITE_SIMULATED_DURATION_MS, 1);
      const nextProgress =
        MUSIC_REWRITE_SIMULATED_START_PROGRESS +
        (MUSIC_REWRITE_SIMULATED_END_PROGRESS -
          MUSIC_REWRITE_SIMULATED_START_PROGRESS) *
          ratio;
      this.updateTaskProgress(task.id, Math.floor(nextProgress));
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
      await this.finalizeChatTask(task, {
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
    const sanitizedParams = sanitizeGenerationParams(params);

    // Create new task - starts as PROCESSING since it will be executed immediately
    const now = Date.now();
    const task: Task = {
      id: generateTaskId(),
      type,
      status: TaskStatus.PROCESSING,
      params: sanitizedParams,
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

    this.blockedTaskIds.delete(task.id);

    // Add to queue
    this.tasks.set(task.id, task);

    // Persist to IndexedDB
    this.persistTask(task);

    // Emit event
    this.emitEvent('taskCreated', task);

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
    updates?: Partial<Task>
  ): void {
    if (this.blockedTaskIds.has(taskId) && status !== TaskStatus.CANCELLED) {
      console.debug(
        `[TaskQueueService] Ignoring blocked task update: ${taskId} → ${status}`
      );
      return;
    }

    let task = this.tasks.get(taskId);
    if (!task) {
      // Task not in memory — create a minimal entry so the event is still emitted.
      // This can happen after page refresh if restoreTasks hasn't run yet.
      console.warn(
        `[TaskQueueService] Task ${taskId} not in memory, creating stub for status update`
      );
      const now = Date.now();
      task = {
        id: taskId,
        type: (updates as any)?.type || TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        params: { prompt: '' },
        createdAt: now,
        updatedAt: now,
      };
      this.tasks.set(taskId, task);
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

    // Persist to IndexedDB
    this.persistTask(updatedTask);

    this.emitEvent('taskUpdated', updatedTask);

    // console.log(`[TaskQueueService] Updated task ${taskId} to ${status}`);
    if (status === TaskStatus.FAILED || status === TaskStatus.COMPLETED) {
      console.debug(
        `[TaskQueueService] Task ${taskId} → ${status}, event emitted`
      );
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
    if (this.blockedTaskIds.has(taskId)) {
      console.debug(
        `[TaskQueueService] Ignoring blocked task progress update: ${taskId}`
      );
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

    this.blockedTaskIds.add(taskId);
    this.updateTaskStatus(taskId, TaskStatus.CANCELLED);
    // console.log(`[TaskQueueService] Cancelled task ${taskId}`);
  }

  /**
   * Retries a failed or cancelled task
   *
   * @param taskId - The task ID to retry
   */
  retryTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    if (
      task.status !== TaskStatus.FAILED &&
      task.status !== TaskStatus.CANCELLED
    ) {
      console.warn(
        `[TaskQueueService] Task ${taskId} is not failed or cancelled, cannot retry`
      );
      return;
    }

    // Reset task for retry - set to PROCESSING for immediate execution
    const now = Date.now();
    this.blockedTaskIds.delete(taskId);
    this.updateTaskStatus(taskId, TaskStatus.PROCESSING, {
      error: undefined,
      startedAt: now, // Set new start time
      completedAt: undefined, // Clear completion time
      remoteId: undefined, // Clear remote ID for fresh submission
      executionPhase: TaskExecutionPhase.SUBMITTING,
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
    if (updatedTask) {
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
    this.tasks.delete(taskId);

    // Delete from IndexedDB
    this.persistDelete(taskId);

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
   * Tracks an externally-created task in the in-memory Map.
   * Used by media generation services to register tasks so that
   * retryTask() and observeTaskUpdates() work correctly.
   * Idempotent: skips if task already exists in memory.
   */
  trackExternalTask(task: Task): void {
    this.blockedTaskIds.delete(task.id);
    if (this.tasks.has(task.id)) return;
    this.tasks.set(task.id, task);
    this.persistTask(task);
    this.emitEvent('taskCreated', task);
  }

  /**
   * Sync task state from IndexedDB to in-memory Map without writing back.
   * Used by media generation services to keep the in-memory state in sync
   * when the executor updates IndexedDB directly.
   */
  syncTaskFromStorage(taskId: string, storageTask: Partial<Task>): void {
    if (this.blockedTaskIds.has(taskId)) {
      console.debug(
        `[TaskQueueService] Ignoring blocked storage sync for task ${taskId}`
      );
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) return;
    if (
      task.status === storageTask.status &&
      task.progress === storageTask.progress
    )
      return;

    const updatedTask: Task = {
      ...task,
      ...storageTask,
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, updatedTask);
    this.emitEvent('taskUpdated', updatedTask);
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
   */
  restoreTasks(tasks: Task[]): void {
    let restoredCount = 0;
    tasks.forEach((task) => {
      // 跳过已归档的任务
      if (task.archived) return;

      const existing = this.tasks.get(task.id);

      // Skip if in-memory task is newer or at a more advanced status
      if (existing) {
        // If in-memory task was updated more recently, keep it
        if (existing.updatedAt >= task.updatedAt) {
          return;
        }
      }

      // Ensure video tasks have progress field (for backward compatibility)
      let restoredTask: Task =
        task.type === TaskType.VIDEO && task.progress === undefined
          ? { ...task, progress: 0 }
          : { ...task };

      // 剥离大字段（base64 参考图等），减少内存占用
      if (restoredTask.params?.referenceImages || restoredTask.params?.uploadedImages) {
        restoredTask = {
          ...restoredTask,
          params: {
            ...restoredTask.params,
            referenceImages: undefined,
            uploadedImages: undefined,
          },
        };
      }

      this.blockedTaskIds.delete(restoredTask.id);
      this.tasks.set(restoredTask.id, restoredTask);
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
  markAsInserted(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`[TaskQueueService] Task ${taskId} not found`);
      return;
    }

    this.updateTaskStatus(taskId, task.status, {
      insertedToCanvas: true,
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
    for (let i = 0; i < Math.min(toArchiveCount, terminalTasks.length); i++) {
      const task = terminalTasks[i];
      this.tasks.delete(task.id);
      archiveIds.push(task.id);
    }

    // 异步批量归档到 IndexedDB（fire-and-forget）
    if (archiveIds.length > 0) {
      taskStorageWriter.archiveTasks(archiveIds).catch((err) => {
        console.debug('[TaskQueueService] Archive tasks failed:', err);
      });
      taskStorageReader.invalidateCache();
      console.debug(
        `[TaskQueueService] Archived ${archiveIds.length} tasks, active: ${this.tasks.size}`
      );
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
    if (params.referenceImages || params.uploadedImages || params.videoData || params.audioData) {
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
