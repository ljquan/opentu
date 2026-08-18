import { getCanvasBoardBinding } from '../canvas-operations';
import {
  generatePPT,
  materializePPTOutline,
} from '../../mcp/tools/ppt-generation';
import { validateOutline, type PPTOutline } from '../ppt';
import { cacheRemoteUrl } from '../media-executor/fallback-utils';
import {
  assertTaskInvocationRouteAvailable,
  resolveTaskInvocationRouteModel,
} from '../task-invocation-route';
import { taskQueueService } from '../task-queue';
import { unifiedCacheService } from '../unified-cache-service';
import { workspaceService } from '../workspace-service';
import { generateVideo } from '../media-generation/video-generation-service';
import { mergeVideos } from '../video-merge-webcodecs';
import {
  deletePptxImportCache,
  deletePptxImportCacheByJobId,
  importPptx,
  importPptxBlob,
  PptxImportError,
  resumePptxImport,
} from '../pptx-import';
import {
  TaskExecutionPhase,
  TaskStatus,
  type Task,
} from '../../types/task.types';
import type { CacheWarning } from '../../types/cache-warning.types';
import {
  cancelPptExplainerProviderJob,
  pollPptExplainerProviderJob,
  submitPptExplainerProviderJob,
  type PptExplainerProviderSlideInput,
  type PptExplainerProviderVoiceReferenceInput,
} from './provider-adapter';
import { resolvePptExplainerProviderRouteSnapshot } from './provider-contract';
import {
  deletePptExplainerArtifact,
  deletePptExplainerArtifacts,
  getPptExplainerArtifact,
  isPptExplainerArtifactUrl,
} from './internal-artifact-cache';
import { buildPptExplainerNarrationPlan } from './narration-planner';
import {
  cancelPptExplainerTaskAcrossTabs,
  runPptExplainerTaskExclusive,
} from './cross-tab-coordinator';
import {
  applyPptxCheckpointToExplainerState,
  freezeCurrentPptSource,
  getCurrentPptExplainerDraftOwners,
  listCurrentPptFrameIds,
  prepareMissingPptSlideImages,
  type CurrentPptSourceSelection,
} from './source-resolver';
import { updatePptExplainerRootTask } from './task-state';
import type {
  PptExplainerManifest,
  PptExplainerSlide,
  PptExplainerTaskState,
} from './types';
import {
  getPptExplainerSpeakerVoiceSource,
  hasPptExplainerReferenceAudio,
  isPptExplainerTask,
  PptExplainerValidationError,
  readPptExplainerState,
  validatePptExplainerSlides,
  validatePptExplainerSpeakers,
} from './validation';

const POLL_INTERVAL_MS = 2000;
const LOCAL_SEGMENT_TIMEOUT_MS = 15 * 60 * 1000;

interface ActiveRun {
  controller: AbortController;
  executionAttempt: number;
}

const activeRuns = new Map<string, ActiveRun>();
const pendingPptxInputs = new Map<string, File>();
const activeInternalTaskIds = new Map<string, Set<string>>();
const internalTaskCleanupPromises = new Map<string, Promise<void>>();
const remoteCancellationPromises = new Map<string, Promise<void>>();
const remotelyCancelledTaskIds = new Map<string, true>();
const REMOTE_CANCELLATION_HISTORY_LIMIT = 100;
let submissionQueueTail: Promise<void> = Promise.resolve();
const boardMutationTails = new Map<string, Promise<void>>();

export function buildPptExplainerVideoPrompt(
  slide: PptExplainerSlide,
  speakers: ReadonlyArray<PptExplainerTaskState['speakers'][number]>
): string {
  const speakerNames = new Map(
    speakers.map((speaker) => [speaker.id, speaker.displayName])
  );
  return [
    '以提供的 PPT 页面为固定主体生成一段有声讲解视频。',
    '保持页面排版、文字和图表清晰稳定，不改写页面，不新增屏幕文字。',
    '使用自然、专业的普通话，严格按以下顺序朗读；多人角色使用明显不同的声线。',
    ...slide.turns.map(
      (turn) =>
        `${speakerNames.get(turn.speakerId) || turn.speakerId}：${turn.text}`
    ),
    '禁止背景音乐，讲解结束后立即结束视频。',
  ].join('\n');
}

async function generatePptExplainerSegment(
  prompt: string,
  options: Parameters<typeof generateVideo>[1],
  pageIndex: number,
  parentSignal: AbortSignal
) {
  const controller = new AbortController();
  const abortFromParent = () =>
    controller.abort(
      parentSignal.reason ||
        new DOMException('PPT 讲解任务已取消', 'AbortError')
    );
  parentSignal.addEventListener('abort', abortFromParent, { once: true });
  const timeoutError = new Error(
    `PPT 第 ${pageIndex} 页视频生成超过 15 分钟，请检查供应商任务或重试`
  );
  const timeoutId = setTimeout(
    () => controller.abort(timeoutError),
    LOCAL_SEGMENT_TIMEOUT_MS
  );
  try {
    return await generateVideo(prompt, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timeoutId);
    parentSignal.removeEventListener('abort', abortFromParent);
  }
}

export async function runPptExplainerBoardMutationExclusive<T>(
  boardId: string,
  run: () => T | Promise<T>
): Promise<T> {
  const normalizedBoardId = boardId.trim();
  if (!normalizedBoardId) throw new Error('PPT 讲解画板 ID 不能为空');
  const previous =
    boardMutationTails.get(normalizedBoardId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current);
  boardMutationTails.set(normalizedBoardId, next);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (boardMutationTails.get(normalizedBoardId) === next) {
      boardMutationTails.delete(normalizedBoardId);
    }
  }
}

export function registerPptExplainerPptxInput(
  jobId: string,
  file: File
): () => void {
  pendingPptxInputs.set(jobId, file);
  return () => {
    if (pendingPptxInputs.get(jobId) === file) pendingPptxInputs.delete(jobId);
  };
}

function enqueuePptExplainerSubmission<T>(
  run: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  const execution = submissionQueueTail.then(async () => {
    signal.throwIfAborted();
    return run();
  });
  submissionQueueTail = execution.then(
    () => undefined,
    () => undefined
  );
  return execution;
}

function getPptSourceSelection(
  state: PptExplainerTaskState
): CurrentPptSourceSelection | undefined {
  if (state.source === 'topic') {
    return state.outlineFrameIds?.length
      ? {
          frameIds: state.outlineFrameIds,
          ...(state.sourceFrameRevisions
            ? { frameRevisions: state.sourceFrameRevisions }
            : {}),
        }
      : undefined;
  }
  if (state.source !== 'current_ppt') return undefined;
  return {
    frameIds: state.outlineFrameIds || [],
    frameRevisions: state.sourceFrameRevisions || {},
  };
}

function getOwnedInternalTaskIds(
  taskId: string,
  state: PptExplainerTaskState
): string[] {
  return Array.from(
    new Set([
      ...(state.internalTaskIds || []),
      ...(activeInternalTaskIds.get(taskId) || []),
    ])
  ).filter((internalTaskId) => internalTaskId && internalTaskId !== taskId);
}

async function registerInternalTaskOwnership(
  taskId: string,
  internalTaskId: string,
  executionAttempt: number
): Promise<void> {
  if (!internalTaskId || internalTaskId === taskId) return;
  const owned = activeInternalTaskIds.get(taskId) || new Set<string>();
  owned.add(internalTaskId);
  activeInternalTaskIds.set(taskId, owned);

  const current = taskQueueService.getTask(taskId);
  const currentState = current ? readPptExplainerState(current) : null;
  if (
    !current ||
    !currentState ||
    currentState.executionAttempt !== executionAttempt ||
    (current.status !== TaskStatus.PENDING &&
      current.status !== TaskStatus.PROCESSING)
  ) {
    return;
  }

  await updatePptExplainerRootTask(
    taskId,
    {
      state: {
        ...currentState,
        internalTaskIds: Array.from(
          new Set([...(currentState.internalTaskIds || []), internalTaskId])
        ),
      },
      status: current.status,
      progress: current.progress,
      remoteId: current.remoteId,
      result: current.result,
      error: current.error,
      executionPhase: current.executionPhase,
    },
    { expectedExecutionAttempt: executionAttempt }
  );
}

async function cleanupPptExplainerInternalTasks(
  taskId: string,
  state: PptExplainerTaskState
): Promise<void> {
  const existingCleanup = internalTaskCleanupPromises.get(taskId);
  if (existingCleanup) return existingCleanup;

  const cleanup = (async () => {
    const internalTaskIds = getOwnedInternalTaskIds(taskId, state);
    if (internalTaskIds.length === 0) return;
    const internalTaskIdSet = new Set(internalTaskIds);

    for (const internalTaskId of internalTaskIds) {
      if (taskQueueService.getTask(internalTaskId)) {
        taskQueueService.deleteTask(internalTaskId);
      }
    }

    const cachedMedia = await unifiedCacheService
      .getAllCachedMedia()
      .catch(() => []);
    for (const item of cachedMedia) {
      if (
        item.metadata?.taskId &&
        internalTaskIdSet.has(item.metadata.taskId)
      ) {
        await unifiedCacheService.deleteCache(item.url).catch(() => undefined);
      }
    }
    activeInternalTaskIds.delete(taskId);
  })();
  internalTaskCleanupPromises.set(taskId, cleanup);
  try {
    await cleanup;
  } finally {
    internalTaskCleanupPromises.delete(taskId);
  }
}

async function cleanupPptExplainerInputs(
  taskId: string,
  state: PptExplainerTaskState
): Promise<void> {
  pendingPptxInputs.delete(state.jobId);
  await cleanupPptExplainerInternalTasks(taskId, state);
  await deletePptExplainerArtifacts(state.jobId).catch(() => undefined);
  if (state.pptxImport) {
    await deletePptxImportCache(state.pptxImport).catch(() => undefined);
  }
  await deletePptxImportCacheByJobId(state.jobId).catch(() => undefined);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, POLL_INTERVAL_MS);
    const handleAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', handleAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function isCurrentAttempt(
  taskId: string,
  executionAttempt: number,
  signal: AbortSignal
): boolean {
  if (signal.aborted) return false;
  const task = taskQueueService.getTask(taskId);
  const state = task ? readPptExplainerState(task) : null;
  return Boolean(
    task &&
      state &&
      state.executionAttempt === executionAttempt &&
      (task.status === TaskStatus.PENDING ||
        task.status === TaskStatus.PROCESSING)
  );
}

function requireSourceBoard(state: PptExplainerTaskState) {
  const binding = getCanvasBoardBinding();
  const currentBoardId = workspaceService.getState().currentBoardId;
  if (
    !binding ||
    !binding.boardId ||
    binding.boardId !== state.sourceBoardId ||
    currentBoardId !== state.sourceBoardId
  ) {
    throw new Error('原画板当前不可用，请切回创建任务的画板后重试');
  }
  return binding.board;
}

function getTextRouteModel(task: Task, state: PptExplainerTaskState) {
  if (state.models.textRoute) {
    assertTaskInvocationRouteAvailable(
      'text',
      {
        invocationRoute: state.models.textRoute,
      },
      { requireSelectedBindingMatch: true }
    );
    const routeModel = resolveTaskInvocationRouteModel({
      params: {
        prompt: task.params.prompt,
        model: state.models.textModel,
        modelRef: state.models.textModelRef,
      },
      invocationRoute: state.models.textRoute,
    });
    if (!routeModel) throw new Error('讲稿文本模型原路由无效');
    return routeModel;
  }
  return state.models.textModelRef ?? state.models.textModel;
}

function getImageRouteModel(state: PptExplainerTaskState) {
  if (state.models.imageRoute) {
    assertTaskInvocationRouteAvailable(
      'image',
      {
        invocationRoute: state.models.imageRoute,
      },
      { requireSelectedBindingMatch: true }
    );
    return resolveTaskInvocationRouteModel({
      params: {
        prompt: state.topic || 'PPT 页面',
        model: state.models.imageModel,
        modelRef: state.models.imageModelRef,
      },
      invocationRoute: state.models.imageRoute,
    });
  }
  return state.models.imageModelRef ?? state.models.imageModel;
}

async function readInputBlob(url: string, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (isPptExplainerArtifactUrl(url)) {
    const artifact = await getPptExplainerArtifact(url);
    if (artifact?.size) return artifact;
    throw new Error('任务私有输入缓存已丢失，请重新选择文件');
  }
  const cached = await unifiedCacheService.getCachedBlob(url);
  if (cached?.size) return cached;
  const response = await fetch(url, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    throw new Error(`演示输入读取失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('演示输入为空');
  return blob;
}

function buildManifest(state: PptExplainerTaskState): PptExplainerManifest {
  return {
    schemaVersion: state.schemaVersion,
    jobId: state.jobId,
    source: state.source,
    deckFingerprint: state.deckFingerprint,
    presenterMode: state.presenterMode,
    speakers: state.speakers.map((speaker) => {
      const voiceSource = getPptExplainerSpeakerVoiceSource(speaker);
      return {
        id: speaker.id,
        displayName: speaker.displayName,
        voiceSource,
        ...(voiceSource === 'reference_audio' && speaker.voiceReference
          ? {
              voiceReference: {
                assetName: speaker.voiceReference.assetName,
              },
            }
          : { voiceId: speaker.voiceId }),
        ...(speaker.avatarAssetId
          ? { avatarAssetId: speaker.avatarAssetId }
          : {}),
        ...(speaker.avatarSourceUrl
          ? { avatarSourceUrl: speaker.avatarSourceUrl }
          : {}),
      };
    }),
    slides: state.slides.map((slide) => ({
      pageIndex: slide.pageIndex,
      title: slide.title,
      notes: slide.notes,
      transition: slide.transition,
      turns: slide.turns.map((turn) => ({ ...turn })),
      ...(state.presentationInput === 'slide_images'
        ? {
            assetName: `slide-${String(slide.pageIndex).padStart(
              4,
              '0'
            )}.${inferImageExtension(slide.snapshotMimeType)}`,
          }
        : {}),
    })),
  };
}

function getProviderRequirements(state: PptExplainerTaskState) {
  return {
    source: state.source,
    presentationInput: state.presentationInput,
    presenterMode: state.presenterMode,
    requiresReferenceAudio: hasPptExplainerReferenceAudio(state.speakers),
  } as const;
}

function inferImageExtension(mimeType?: string): string {
  const normalized = mimeType?.toLowerCase() || '';
  if (normalized.includes('svg')) return 'svg';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  return 'png';
}

async function* streamSlideInputs(
  slides: readonly PptExplainerSlide[],
  signal: AbortSignal
): AsyncGenerator<PptExplainerProviderSlideInput, void, void> {
  const orderedSlides = [...slides].sort(
    (left, right) => left.pageIndex - right.pageIndex
  );
  for (const slide of orderedSlides) {
    signal.throwIfAborted();
    if (!slide.snapshotUrl) {
      throw new Error(`第 ${slide.pageIndex} 页缺少页面快照`);
    }
    const blob = await readInputBlob(slide.snapshotUrl, signal);
    signal.throwIfAborted();
    yield {
      pageIndex: slide.pageIndex,
      blob,
      filename: `slide-${String(slide.pageIndex).padStart(
        4,
        '0'
      )}.${inferImageExtension(blob.type || slide.snapshotMimeType)}`,
    };
  }
}

async function* streamVoiceReferences(
  state: PptExplainerTaskState,
  signal: AbortSignal
): AsyncGenerator<PptExplainerProviderVoiceReferenceInput, void, void> {
  for (const speaker of state.speakers) {
    if (getPptExplainerSpeakerVoiceSource(speaker) !== 'reference_audio') {
      continue;
    }
    signal.throwIfAborted();
    const reference = speaker.voiceReference;
    if (!reference) {
      throw new Error(`讲解者「${speaker.displayName}」缺少声音样本引用`);
    }
    let blob: Blob | undefined;
    try {
      blob = await readInputBlob(reference.cacheUrl, signal);
      signal.throwIfAborted();
      yield {
        assetName: reference.assetName,
        blob,
        filename: reference.assetName,
        mimeType: reference.mimeType,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new Error(
        `讲解者「${speaker.displayName}」的声音样本缓存已丢失，请重新创建任务`
      );
    } finally {
      blob = undefined;
    }
  }
}

function inferVideoFormat(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return extension || 'mp4';
  } catch {
    return 'mp4';
  }
}

async function persistStage(
  taskId: string,
  state: PptExplainerTaskState,
  executionAttempt: number,
  progress: number,
  executionPhase?: TaskExecutionPhase,
  remoteId?: string,
  status: TaskStatus = TaskStatus.PROCESSING
): Promise<PptExplainerTaskState> {
  const updated = await updatePptExplainerRootTask(
    taskId,
    {
      state,
      status,
      progress,
      executionPhase,
      remoteId,
    },
    { expectedExecutionAttempt: executionAttempt }
  );
  const updatedState = updated ? readPptExplainerState(updated) : null;
  if (!updatedState) {
    const error = new Error('PPT 讲解任务已被取消或替代');
    error.name = 'AbortError';
    throw error;
  }
  return updatedState;
}

async function finalizeResult(
  taskId: string,
  state: PptExplainerTaskState,
  executionAttempt: number,
  finalVideoUrl: string,
  signal: AbortSignal
): Promise<void> {
  let resultUrl = finalVideoUrl;
  let cacheWarning: CacheWarning | undefined;
  try {
    resultUrl = await cacheRemoteUrl(
      finalVideoUrl,
      taskId,
      'video',
      inferVideoFormat(finalVideoUrl),
      undefined,
      { signal }
    );
  } catch (error) {
    if (signal.aborted) throw error;
  }
  if (resultUrl === finalVideoUrl && /^https?:\/\//i.test(finalVideoUrl)) {
    cacheWarning = {
      status: 'unavailable',
      reasonCode: 'cache_missing',
      message: '该成片未缓存到浏览器，原始链接可能会过期，请尽快下载保存。',
      detectedAt: Date.now(),
      expiresHint: '原始链接可能带有效期',
    };
  }
  signal.throwIfAborted();
  const completedState: PptExplainerTaskState = {
    ...state,
    stage: 'completed',
    delivery: {
      ...state.delivery,
      resultSaved: true,
    },
  };
  await updatePptExplainerRootTask(
    taskId,
    {
      state: completedState,
      status: TaskStatus.COMPLETED,
      progress: 100,
      executionPhase: undefined,
      result: {
        url: resultUrl,
        format: inferVideoFormat(finalVideoUrl),
        size: 0,
        resultKind: 'video',
        resultVisibility: 'user',
        providerTaskId: state.remoteId,
        title: state.topic?.trim() || 'PPT 讲解视频',
        ...(cacheWarning ? { cacheWarning } : {}),
      },
    },
    { expectedExecutionAttempt: executionAttempt }
  );
  await cleanupPptExplainerInputs(taskId, state);
}

async function runLocalComposition(
  taskId: string,
  state: PptExplainerTaskState,
  executionAttempt: number,
  signal: AbortSignal
): Promise<void> {
  const videoModel = state.models.videoModelRef || state.models.videoModel;
  if (!videoModel) throw new Error('PPT 逐页生成缺少视频模型');
  const segmentUrls: string[] = [];

  for (const [slideIndex, slide] of state.slides.entries()) {
    signal.throwIfAborted();
    if (!slide.snapshotUrl) {
      throw new Error(`PPT 第 ${slide.pageIndex} 页缺少页面快照`);
    }
    const segmentProgress =
      50 + Math.round((slideIndex / Math.max(1, state.slides.length)) * 30);
    state = await persistStage(
      taskId,
      {
        ...state,
        stage: 'submitting',
        diagnostics: [
          ...(state.diagnostics || []).filter(
            (item) => !item.startsWith('正在生成第 ')
          ),
          `正在生成第 ${slideIndex + 1}/${state.slides.length} 页有声视频`,
        ],
      },
      executionAttempt,
      segmentProgress,
      TaskExecutionPhase.SUBMITTING
    );
    const prompt = buildPptExplainerVideoPrompt(slide, state.speakers);
    let ownershipWrite: Promise<void> | undefined;
    const generated = await generatePptExplainerSegment(
      prompt,
      {
        model:
          typeof videoModel === 'string'
            ? videoModel
            : videoModel.modelId || undefined,
        modelRef: typeof videoModel === 'string' ? undefined : videoModel,
        referenceImages: [slide.snapshotUrl],
        size: '1920x1080',
        onTaskCreated: (internalTaskId) => {
          ownershipWrite = registerInternalTaskOwnership(
            taskId,
            internalTaskId,
            executionAttempt
          );
        },
      },
      slide.pageIndex,
      signal
    );
    await ownershipWrite;
    signal.throwIfAborted();
    if (!generated.url) {
      throw new Error(`PPT 第 ${slide.pageIndex} 页有声视频生成失败`);
    }
    segmentUrls.push(generated.url);
    const progress =
      50 +
      Math.round(((slideIndex + 1) / Math.max(1, state.slides.length)) * 30);
    state = await persistStage(
      taskId,
      { ...state, stage: 'submitting' },
      executionAttempt,
      progress,
      TaskExecutionPhase.SUBMITTING
    );
  }

  state = await persistStage(
    taskId,
    { ...state, stage: 'finalizing' },
    executionAttempt,
    80,
    TaskExecutionPhase.DOWNLOADING
  );
  signal.throwIfAborted();
  const composed = await mergeVideos(segmentUrls);
  signal.throwIfAborted();
  const extension = composed.blob.type.includes('mp4') ? 'mp4' : 'webm';
  const stableUrl = `/__aitu_cache__/video/${taskId}.${extension}`;
  try {
    await unifiedCacheService.cacheMediaFromBlob(
      stableUrl,
      composed.blob,
      'video',
      { taskId }
    );
  } finally {
    if (composed.url.startsWith('blob:')) URL.revokeObjectURL(composed.url);
  }
  await finalizeResult(taskId, state, executionAttempt, stableUrl, signal);
}

async function pollUntilComplete(
  taskId: string,
  initialState: PptExplainerTaskState,
  executionAttempt: number,
  signal: AbortSignal
): Promise<void> {
  let state = initialState;
  const remoteId = state.remoteId;
  if (!remoteId) throw new Error('PPT 讲解任务缺少 remoteId');
  if (!state.originalRoute) throw new Error('PPT 讲解任务缺少原供应商路由');
  const route = resolvePptExplainerProviderRouteSnapshot(
    state.originalRoute,
    getProviderRequirements(state)
  );

  while (isCurrentAttempt(taskId, executionAttempt, signal)) {
    const result = await pollPptExplainerProviderJob({
      route,
      remoteId,
      signal,
    });
    if (!isCurrentAttempt(taskId, executionAttempt, signal)) return;
    if (result.status === 'cancelled') {
      taskQueueService.cancelTask(taskId);
      return;
    }
    if (result.status === 'completed') {
      state = await persistStage(
        taskId,
        { ...state, stage: 'finalizing' },
        executionAttempt,
        98,
        TaskExecutionPhase.DOWNLOADING,
        remoteId
      );
      await finalizeResult(
        taskId,
        state,
        executionAttempt,
        result.finalVideoUrl!,
        signal
      );
      return;
    }
    const providerProgress = result.progress ?? 0;
    state = await persistStage(
      taskId,
      { ...state, stage: 'polling' },
      executionAttempt,
      Math.min(97, 55 + providerProgress * 0.42),
      TaskExecutionPhase.POLLING,
      remoteId
    );
    await waitForNextPoll(signal);
  }
}

async function prepareTopicSource(
  task: Task,
  initialState: PptExplainerTaskState,
  executionAttempt: number,
  signal: AbortSignal
): Promise<{ state: PptExplainerTaskState; awaitingReview: boolean }> {
  const topic = initialState.topic?.trim();
  if (!topic) throw new PptExplainerValidationError('请输入 PPT 主题');
  const board = requireSourceBoard(initialState);
  const textRouteModel = getTextRouteModel(task, initialState);
  if (!textRouteModel) {
    throw new PptExplainerValidationError('讲稿文本模型原路由无效');
  }

  const result = await runPptExplainerBoardMutationExclusive(
    initialState.sourceBoardId,
    () =>
      generatePPT(
        {
          topic,
          ...(typeof textRouteModel === 'string'
            ? { textModel: textRouteModel }
            : { textModelRef: textRouteModel }),
        },
        {
          signal,
          pptExplainerJobId: initialState.jobId,
          replaceExistingPpt: false,
        }
      )
  );
  signal.throwIfAborted();
  if (!result.success) {
    throw new PptExplainerValidationError(result.error || 'PPT 大纲生成失败');
  }
  const outline = (
    result.data && typeof result.data === 'object'
      ? (result.data as { outline?: unknown }).outline
      : undefined
  ) as unknown;
  if (!validateOutline(outline)) {
    throw new PptExplainerValidationError('PPT 大纲结果无效，无法恢复任务');
  }
  const outlineFrameIds = listCurrentPptFrameIds(board, initialState.jobId);
  if (outlineFrameIds.length === 0) {
    throw new PptExplainerValidationError('PPT 大纲未生成任何页面');
  }

  const awaitingReview =
    initialState.reviewMode === 'confirm' && !initialState.reviewAcceptedAt;
  const state = await persistStage(
    task.id,
    {
      ...initialState,
      topicOutline: outline as PPTOutline,
      outlineFrameIds,
      stage: awaitingReview ? 'review_pending' : 'snapshotting',
    },
    executionAttempt,
    10,
    awaitingReview ? undefined : TaskExecutionPhase.SUBMITTING,
    undefined,
    awaitingReview ? TaskStatus.PENDING : TaskStatus.PROCESSING
  );
  return { state, awaitingReview };
}

async function preparePptxSource(
  taskId: string,
  initialState: PptExplainerTaskState,
  executionAttempt: number,
  signal: AbortSignal
): Promise<PptExplainerTaskState> {
  const initialCheckpoint = initialState.pptxImport;
  let state = initialState;
  const mode =
    initialState.presentationInput === 'pptx' ? 'cache-only' : 'slide-images';
  const onCheckpoint = async (
    nextCheckpoint: NonNullable<PptExplainerTaskState['pptxImport']>
  ): Promise<void> => {
    state = await persistStage(
      taskId,
      {
        ...applyPptxCheckpointToExplainerState(state, nextCheckpoint),
        stage:
          nextCheckpoint.status === 'completed' ? 'snapshotting' : 'preparing',
      },
      executionAttempt,
      nextCheckpoint.status === 'completed'
        ? 20
        : mode === 'cache-only'
        ? 10
        : nextCheckpoint.slideCount
        ? 5 +
          Math.round(
            (nextCheckpoint.slides.length / nextCheckpoint.slideCount) * 15
          )
        : 5,
      TaskExecutionPhase.SUBMITTING
    );
  };

  let checkpoint = initialCheckpoint;
  if (!checkpoint) {
    const file = pendingPptxInputs.get(initialState.jobId);
    if (file) {
      checkpoint = await importPptx(file, {
        jobId: initialState.jobId,
        mode,
        signal,
        onCheckpoint,
      });
    } else if (initialState.pptx?.cacheUrl) {
      const staged = await getPptExplainerArtifact(initialState.pptx.cacheUrl);
      if (!staged?.size) {
        throw new PptxImportError(
          'cached-input-missing',
          'input',
          '原始 PPTX 缓存已被清理，请重新选择文件或重新开始导入'
        );
      }
      checkpoint = await importPptxBlob(staged, initialState.pptx.filename, {
        jobId: initialState.jobId,
        mode,
        signal,
        onCheckpoint,
      });
    } else {
      throw new PptxImportError(
        'cached-input-missing',
        'input',
        'PPTX 原文件尚未缓存，请重新选择文件或重新开始导入'
      );
    }
  } else if (checkpoint.status !== 'completed') {
    checkpoint = await resumePptxImport(checkpoint, {
      mode,
      signal,
      onCheckpoint,
    });
  }
  if (
    initialState.pptx?.cacheUrl &&
    isPptExplainerArtifactUrl(initialState.pptx.cacheUrl)
  ) {
    await deletePptExplainerArtifact(initialState.pptx.cacheUrl).catch(
      () => undefined
    );
  }

  return persistStage(
    taskId,
    {
      ...applyPptxCheckpointToExplainerState(state, checkpoint),
      stage: 'snapshotting',
    },
    executionAttempt,
    20,
    TaskExecutionPhase.SUBMITTING
  );
}

async function executePptExplainerRun(
  task: Task,
  executionAttempt: number,
  signal: AbortSignal
): Promise<void> {
  let state = readPptExplainerState(task)!;
  validatePptExplainerSpeakers(state.presenterMode, state.speakers, {
    requireVoice: (state.executionMode || 'provider') === 'provider',
  });
  state = await persistStage(
    task.id,
    { ...state, executionAttempt },
    executionAttempt,
    Math.max(task.progress || 0, 5),
    state.remoteId ? TaskExecutionPhase.POLLING : TaskExecutionPhase.SUBMITTING,
    state.remoteId
  );

  if (state.remoteId) {
    await pollUntilComplete(task.id, state, executionAttempt, signal);
    return;
  }

  if (state.stage === 'review_pending') return;

  if (state.stage === 'preparing') {
    if (state.source === 'topic') {
      const prepared = await prepareTopicSource(
        task,
        state,
        executionAttempt,
        signal
      );
      state = prepared.state;
      if (prepared.awaitingReview) return;
    } else if (state.source === 'pptx') {
      state = await preparePptxSource(task.id, state, executionAttempt, signal);
    } else {
      state = await persistStage(
        task.id,
        { ...state, stage: 'snapshotting' },
        executionAttempt,
        10,
        TaskExecutionPhase.SUBMITTING
      );
    }
  }

  if (state.stage === 'snapshotting') {
    if (state.source === 'topic' || state.source === 'current_ppt') {
      const board = requireSourceBoard(state);
      if (state.source === 'topic') {
        const owners = getCurrentPptExplainerDraftOwners(board);
        if (!owners.includes(state.jobId)) {
          if (!state.topicOutline || !validateOutline(state.topicOutline)) {
            throw new PptExplainerValidationError(
              '该 PPT 讲解任务的大纲快照已丢失，请重新创建任务'
            );
          }
          materializePPTOutline(
            board,
            state.topicOutline,
            { topic: state.topic || 'PPT 讲解视频' },
            {
              pptExplainerJobId: state.jobId,
              replaceExistingPpt: false,
              signal,
              focusFirstFrame: false,
              openEditor: false,
            }
          );
        }
      }
      const imageRouteModel = getImageRouteModel(state);
      const selection = getPptSourceSelection(state);
      const ownershipWrites: Promise<void>[] = [];
      let slideImageOverrides: Map<string, string>;
      try {
        slideImageOverrides = await prepareMissingPptSlideImages(board, {
          model:
            typeof imageRouteModel === 'string' ? imageRouteModel : undefined,
          modelRef:
            imageRouteModel && typeof imageRouteModel !== 'string'
              ? imageRouteModel
              : undefined,
          signal,
          selection,
          onInternalTaskCreated: (internalTaskId) => {
            ownershipWrites.push(
              registerInternalTaskOwnership(
                task.id,
                internalTaskId,
                executionAttempt
              )
            );
          },
        });
        await Promise.all(ownershipWrites);
      } catch (error) {
        await Promise.allSettled(ownershipWrites);
        throw error;
      }
      const currentTask = taskQueueService.getTask(task.id);
      const currentState = currentTask
        ? readPptExplainerState(currentTask)
        : null;
      if (currentState && currentState.executionAttempt === executionAttempt) {
        state = {
          ...state,
          internalTaskIds: currentState.internalTaskIds,
        };
      }
      const frozen = await freezeCurrentPptSource(board, state.jobId, {
        signal,
        slideImageOverrides,
        selection,
      });
      state = await persistStage(
        task.id,
        {
          ...state,
          stage: 'scripting',
          slides: frozen.slides,
          deckFingerprint: frozen.deckFingerprint,
          outlineFrameIds: state.outlineFrameIds?.length
            ? state.outlineFrameIds
            : frozen.frameIds,
        },
        executionAttempt,
        25,
        TaskExecutionPhase.SUBMITTING
      );
      await cleanupPptExplainerInternalTasks(task.id, state);
    } else {
      validatePptExplainerSlides(state.slides, state.speakers, {
        requireSnapshots: state.presentationInput === 'slide_images',
      });
      state = await persistStage(
        task.id,
        { ...state, stage: 'scripting' },
        executionAttempt,
        25,
        TaskExecutionPhase.SUBMITTING
      );
    }
  }

  if (state.stage === 'scripting') {
    const currentTask = taskQueueService.getTask(task.id);
    if (!currentTask) return;
    state = await persistStage(
      task.id,
      {
        ...state,
        slides: await buildPptExplainerNarrationPlan(state.slides, {
          presenterMode: state.presenterMode,
          speakers: state.speakers,
          textRoute: getTextRouteModel(currentTask, state),
          signal,
        }),
        stage: 'submitting',
      },
      executionAttempt,
      45,
      TaskExecutionPhase.SUBMITTING
    );
  }

  validatePptExplainerSlides(state.slides, state.speakers, {
    requireSnapshots: state.presentationInput === 'slide_images',
    requireTurns: true,
  });
  state = await persistStage(
    task.id,
    { ...state, stage: 'submitting' },
    executionAttempt,
    50,
    TaskExecutionPhase.SUBMITTING
  );
  if ((state.executionMode || 'provider') === 'local') {
    await runLocalComposition(task.id, state, executionAttempt, signal);
    return;
  }
  if (!state.originalRoute) {
    throw new Error('PPT 讲解任务缺少原供应商路由');
  }
  const route = resolvePptExplainerProviderRouteSnapshot(
    state.originalRoute,
    getProviderRequirements(state)
  );
  const submitResult = await enqueuePptExplainerSubmission(async () => {
    let presentation: Blob | undefined;
    try {
      if (state.presentationInput === 'pptx') {
        if (!state.pptx?.cacheUrl) {
          throw new Error('PPTX 缓存已丢失，请重新选择文件');
        }
        presentation = await readInputBlob(state.pptx.cacheUrl, signal);
      }
      return await submitPptExplainerProviderJob({
        route,
        manifest: buildManifest(state),
        idempotencyKey: state.idempotencyKey,
        presentation,
        presentationFilename: state.pptx?.filename,
        slides:
          state.presentationInput === 'slide_images'
            ? streamSlideInputs(state.slides, signal)
            : undefined,
        voiceReferences: hasPptExplainerReferenceAudio(state.speakers)
          ? streamVoiceReferences(state, signal)
          : undefined,
        signal,
      });
    } finally {
      presentation = undefined;
    }
  }, signal);

  if (!isCurrentAttempt(task.id, executionAttempt, signal)) {
    await cancelPptExplainerProviderJob({
      route,
      remoteId: submitResult.remoteId,
      idempotencyKey: state.idempotencyKey,
    }).catch((error) => {
      console.warn(
        '[PptExplainer] Late submit result could not be cancelled:',
        error instanceof Error ? error.message : String(error)
      );
    });
    if (signal.reason instanceof Error) throw signal.reason;
    throw new DOMException('PPT 讲解任务已取消或替代', 'AbortError');
  }

  state = await persistStage(
    task.id,
    {
      ...state,
      remoteId: submitResult.remoteId,
      stage: submitResult.status === 'completed' ? 'finalizing' : 'polling',
    },
    executionAttempt,
    submitResult.status === 'completed' ? 98 : 55,
    submitResult.status === 'completed'
      ? TaskExecutionPhase.DOWNLOADING
      : TaskExecutionPhase.POLLING,
    submitResult.remoteId
  );
  if (submitResult.status === 'completed') {
    await finalizeResult(
      task.id,
      state,
      executionAttempt,
      submitResult.finalVideoUrl!,
      signal
    );
    return;
  }
  await pollUntilComplete(task.id, state, executionAttempt, signal);
}

async function runPptExplainerTaskWithLock(
  taskId: string,
  coordinationSignal: AbortSignal
): Promise<void> {
  if (activeRuns.has(taskId)) return;
  const task = taskQueueService.getTask(taskId);
  const initialState = task ? readPptExplainerState(task) : null;
  if (
    !task ||
    !initialState ||
    initialState.stage === 'review_pending' ||
    task.status === TaskStatus.FAILED ||
    task.status === TaskStatus.CANCELLED ||
    task.status === TaskStatus.COMPLETED
  ) {
    return;
  }

  const controller = new AbortController();
  const abortFromCoordination = () =>
    controller.abort(
      coordinationSignal.reason ||
        new DOMException('PPT 讲解任务已在其他标签页取消', 'AbortError')
    );
  if (coordinationSignal.aborted) {
    abortFromCoordination();
    return;
  }
  coordinationSignal.addEventListener('abort', abortFromCoordination, {
    once: true,
  });
  const executionAttempt = initialState.executionAttempt + 1;
  activeRuns.set(taskId, { controller, executionAttempt });
  let activatedTask: Task | null;
  try {
    activatedTask = await updatePptExplainerRootTask(
      taskId,
      {
        state: { ...initialState, executionAttempt },
        status: TaskStatus.PROCESSING,
        progress: Math.max(task.progress || 0, 5),
        executionPhase: initialState.remoteId
          ? TaskExecutionPhase.POLLING
          : TaskExecutionPhase.SUBMITTING,
        remoteId: initialState.remoteId,
      },
      { expectedExecutionAttempt: initialState.executionAttempt }
    );
  } catch (error) {
    coordinationSignal.removeEventListener('abort', abortFromCoordination);
    const active = activeRuns.get(taskId);
    if (active?.executionAttempt === executionAttempt)
      activeRuns.delete(taskId);
    throw error;
  }
  if (!activatedTask) {
    coordinationSignal.removeEventListener('abort', abortFromCoordination);
    activeRuns.delete(taskId);
    return;
  }
  try {
    await executePptExplainerRun(
      activatedTask,
      executionAttempt,
      controller.signal
    );
  } catch (error) {
    const current = taskQueueService.getTask(taskId);
    const state = current ? readPptExplainerState(current) : null;
    if (
      isAbortError(error) ||
      controller.signal.aborted ||
      !state ||
      current?.status === TaskStatus.CANCELLED ||
      state.executionAttempt !== executionAttempt
    ) {
      if (state) {
        await cleanupPptExplainerInternalTasks(taskId, state);
      }
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (
      state.pptxImport &&
      error instanceof PptxImportError &&
      (error.kind === 'input' || error.kind === 'security')
    ) {
      await deletePptxImportCache(state.pptxImport).catch(() => undefined);
    }
    await cleanupPptExplainerInternalTasks(taskId, state);
    await updatePptExplainerRootTask(
      taskId,
      {
        state: { ...state, stage: 'failed' },
        status: TaskStatus.FAILED,
        progress: current?.progress || 0,
        executionPhase: undefined,
        error: {
          code:
            error && typeof error === 'object' && 'code' in error
              ? String((error as { code?: unknown }).code || 'ERROR')
              : 'ERROR',
          message,
        },
      },
      { expectedExecutionAttempt: executionAttempt }
    );
  } finally {
    coordinationSignal.removeEventListener('abort', abortFromCoordination);
    const active = activeRuns.get(taskId);
    if (active?.executionAttempt === executionAttempt) {
      activeRuns.delete(taskId);
    }
    pendingPptxInputs.delete(initialState.jobId);
  }
}

export async function runPptExplainerTask(taskId: string): Promise<void> {
  await runPptExplainerTaskExclusive(taskId, (signal) =>
    runPptExplainerTaskWithLock(taskId, signal)
  );
}

export async function cancelPptExplainerRemoteTask(task: Task): Promise<void> {
  if (!isPptExplainerTask(task)) return;
  cancelPptExplainerTaskAcrossTabs(task.id);
  activeRuns
    .get(task.id)
    ?.controller.abort(new DOMException('PPT 讲解任务已取消', 'AbortError'));
  activeRuns.delete(task.id);
  const existingCancellation = remoteCancellationPromises.get(task.id);
  if (existingCancellation) return existingCancellation;
  if (remotelyCancelledTaskIds.has(task.id)) return;

  const cancellation = (async () => {
    const state = readPptExplainerState(task);
    if (!state) return;
    const remoteId = task.remoteId || state.remoteId;
    if (!remoteId) {
      await cleanupPptExplainerInputs(task.id, state);
      return;
    }
    try {
      if (!state.originalRoute) {
        await cleanupPptExplainerInputs(task.id, state);
        return;
      }
      const route = resolvePptExplainerProviderRouteSnapshot(
        state.originalRoute,
        getProviderRequirements(state)
      );
      await cancelPptExplainerProviderJob({
        route,
        remoteId,
        idempotencyKey: state.idempotencyKey,
      });
    } finally {
      await cleanupPptExplainerInputs(task.id, state);
    }
  })();
  remoteCancellationPromises.set(task.id, cancellation);
  try {
    await cancellation;
    remotelyCancelledTaskIds.delete(task.id);
    remotelyCancelledTaskIds.set(task.id, true);
    while (remotelyCancelledTaskIds.size > REMOTE_CANCELLATION_HISTORY_LIMIT) {
      const oldestTaskId = remotelyCancelledTaskIds.keys().next().value;
      if (typeof oldestTaskId !== 'string') break;
      remotelyCancelledTaskIds.delete(oldestTaskId);
    }
  } finally {
    remoteCancellationPromises.delete(task.id);
  }
}

export async function cleanupPptExplainerTask(task: Task): Promise<void> {
  if (!isPptExplainerTask(task)) return;
  cancelPptExplainerTaskAcrossTabs(task.id);
  activeRuns
    .get(task.id)
    ?.controller.abort(new DOMException('PPT 讲解任务已清理', 'AbortError'));
  activeRuns.delete(task.id);
  const state = readPptExplainerState(task);
  if (state) await cleanupPptExplainerInputs(task.id, state);
}

export function suspendPptExplainerRuns(): void {
  for (const activeRun of activeRuns.values()) {
    activeRun.controller.abort(
      new DOMException('PPT 讲解执行器已卸载，等待恢复', 'AbortError')
    );
  }
  activeRuns.clear();
}

export function isPptExplainerRunActive(taskId: string): boolean {
  return activeRuns.has(taskId);
}

export const pptExplainerOrchestratorInternals = {
  buildManifest,
  inferVideoFormat,
  isCurrentAttempt,
};
