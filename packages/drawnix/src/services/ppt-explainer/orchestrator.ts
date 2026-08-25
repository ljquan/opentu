import { getCanvasBoardBinding } from '../canvas-operations';
import {
  generatePPT,
  materializePPTOutline,
} from '../../mcp/tools/ppt-generation';
import { validateOutline, type PPTOutline } from '../ppt';
import { cacheRemoteUrl } from '../media-executor/fallback-utils';
import { isVirtualMediaUrl } from '../../utils/virtual-media-url';
import {
  assertTaskInvocationRouteAvailable,
  resolveTaskInvocationRouteModel,
} from '../task-invocation-route';
import { resolveInvocationPlanFromRoute } from '../provider-routing';
import { downloadVideoContentToLocalUrl } from '../video-binding-utils';
import { getEffectiveVideoModelConfigForSelection } from '../video-binding-utils';
import { taskQueueService } from '../task-queue';
import { unifiedCacheService } from '../unified-cache-service';
import { workspaceService } from '../workspace-service';
import { generateVideo } from '../media-generation/video-generation-service';
import {
  deletePptxImportCache,
  deletePptxImportCacheByJobId,
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
import { planPptExplainerSlideTimeline } from './timeline-planner';
import {
  composeLocalPptExplainerVideo,
  isPptExplainerNarrationQualityError,
  type LocalPptCompositionSlide,
} from './local-composer';
import {
  cancelPptExplainerTaskAcrossTabs,
  runPptExplainerTaskExclusive,
} from './cross-tab-coordinator';
import {
  applyPptxCheckpointToExplainerState,
  freezeCurrentPptSource,
  getCurrentPptExplainerDraftOwners,
  listCurrentPptFrameIds,
  materializePptExplainerSlideImages,
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

interface ActiveRun {
  controller: AbortController;
  executionAttempt: number;
}

const activeRuns = new Map<string, ActiveRun>();
const activeInternalTaskIds = new Map<string, Set<string>>();
const internalTaskCleanupPromises = new Map<string, Promise<void>>();
const remoteCancellationPromises = new Map<string, Promise<void>>();
const remotelyCancelledTaskIds = new Map<string, true>();
const REMOTE_CANCELLATION_HISTORY_LIMIT = 100;
let submissionQueueTail: Promise<void> = Promise.resolve();
const boardMutationTails = new Map<string, Promise<void>>();

const PPT_EXPLAINER_HOST_VOICE_DIRECTION =
  '主讲人声线：必须使用成年男性声线，中低音、沉稳、克制，吐字清晰，语速略慢。禁止使用女声或嘉宾声线。';
const PPT_EXPLAINER_GUEST_VOICE_DIRECTION =
  '嘉宾声线：必须使用成年女性声线，音高明显高于主讲人，明亮、自然、亲切，语速略快。禁止使用男声或主讲人声线。';

function resolvePptExplainerSpeakerRole(
  speakers: ReadonlyArray<PptExplainerTaskState['speakers'][number]>,
  speakerId: string
): 'host' | 'guest' | 'other' {
  const speaker = speakers.find((candidate) => candidate.id === speakerId);
  const normalizedId = speakerId.trim().toLowerCase();
  const normalizedName = speaker?.displayName.trim().toLowerCase() || '';
  if (
    normalizedId === 'host' ||
    /(?:主讲|主持|主播|host|presenter)/i.test(normalizedName)
  ) {
    return 'host';
  }
  if (
    normalizedId === 'guest' ||
    /(?:嘉宾|访谈对象|guest|interviewee)/i.test(normalizedName)
  ) {
    return 'guest';
  }
  const speakerIndex = speakers.findIndex(
    (candidate) => candidate.id === speakerId
  );
  if (speakerIndex === 0) return 'host';
  if (speakerIndex === 1) return 'guest';
  return 'other';
}

function getPptExplainerVoiceDirection(
  speakers: ReadonlyArray<PptExplainerTaskState['speakers'][number]>,
  speakerId: string
): string {
  const role = resolvePptExplainerSpeakerRole(speakers, speakerId);
  if (role === 'host') return PPT_EXPLAINER_HOST_VOICE_DIRECTION;
  if (role === 'guest') return PPT_EXPLAINER_GUEST_VOICE_DIRECTION;
  return '保持当前角色稳定、清晰且与其他角色明显不同的声线。';
}

export function buildPptExplainerVideoPrompt(
  slide: PptExplainerSlide,
  speakers: ReadonlyArray<PptExplainerTaskState['speakers'][number]>,
  outputDurationSeconds?: number
): string {
  const speakerNames = new Map(
    speakers.map((speaker) => [speaker.id, speaker.displayName])
  );
  const activeSpeakerIds = [
    ...new Set(slide.turns.map((turn) => turn.speakerId)),
  ];
  const activeSpeakers = activeSpeakerIds
    .map((speakerId) => speakers.find((speaker) => speaker.id === speakerId))
    .filter((speaker): speaker is PptExplainerTaskState['speakers'][number] =>
      Boolean(speaker)
    );
  const singleSpeaker = activeSpeakers.length === 1;
  return [
    '生成一段包含清晰普通话人声的有声讲解视频，最终只使用其音轨。',
    '只讲解当前页面对应的内容，不要朗读页面之外的信息。',
    '使用自然、专业的普通话，严格按以下顺序朗读。每个视频片段只能由一个角色发言，禁止把多个角色合并成同一条声线。',
    ...(singleSpeaker
      ? [
          `当前片段唯一发言角色是「${
            activeSpeakers[0].displayName
          }」。${getPptExplainerVoiceDirection(
            speakers,
            activeSpeakers[0].id
          )}`,
          '从片段开头立即使用该角色的固定声线，整段保持性别、音色、音高和说话风格一致，不得切换成另一角色。',
        ]
      : [
          '检测到多个角色时，必须为每个角色使用明显不同的音色和声线，不能让主讲人和嘉宾听起来像同一个人。',
          ...activeSpeakers.map(
            (speaker) =>
              `角色「${speaker.displayName}」：${getPptExplainerVoiceDirection(
                speakers,
                speaker.id
              )}`
          ),
        ]),
    ...(outputDurationSeconds
      ? [
          `必须从视频开始立即讲解，并在 ${outputDurationSeconds} 秒内完整讲完；不要长时间停顿或把声音放到片段末尾。`,
        ]
      : []),
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
  parentSignal: AbortSignal
) {
  return generateVideo(prompt, {
    ...options,
    signal: parentSignal,
  });
}

async function cachePptExplainerNarrationSegment(
  url: string,
  internalTask: Task,
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted();
  let authenticatedDownloadError: unknown;
  const remoteId = internalTask.remoteId?.trim();
  if (remoteId) {
    const routeModel = resolveTaskInvocationRouteModel(internalTask);
    const route = resolveInvocationPlanFromRoute('video', routeModel, {
      bindingId: internalTask.invocationRoute?.binding?.id,
    });
    if (route) {
      try {
        const downloadedUrl = await downloadVideoContentToLocalUrl({
          videoId: remoteId,
          provider: route.provider,
          binding: route.binding,
          modelId: route.modelRef.modelId,
          cacheKey: internalTask.id,
          resultVisibility: 'internal',
          signal,
          fallbackToObjectUrl: false,
        });
        signal.throwIfAborted();
        if (isVirtualMediaUrl(downloadedUrl)) return downloadedUrl;
      } catch (error) {
        signal.throwIfAborted();
        authenticatedDownloadError = error;
        console.warn(
          '[PptExplainer] Authenticated video content download failed, falling back to result URL:',
          error
        );
      }
    }
  }

  const cachedUrl = await cacheRemoteUrl(
    url,
    internalTask.id,
    'video',
    inferVideoFormat(url),
    undefined,
    {
      forceRemoteCache: true,
      returnLocalCacheUrl: true,
      resultVisibility: 'internal',
      signal,
    }
  );
  signal.throwIfAborted();
  if (isVirtualMediaUrl(cachedUrl)) return cachedUrl;
  const downloadErrorMessage =
    authenticatedDownloadError instanceof Error
      ? authenticatedDownloadError.message.trim()
      : '';
  throw new Error(
    downloadErrorMessage
      ? `讲解片段下载失败：鉴权内容接口返回“${downloadErrorMessage}”，结果地址也无法缓存到本地`
      : '讲解片段未能缓存到本地，无法固定 PPT 画面合成；供应商结果地址不允许浏览器读取'
  );
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
    const pathname = new URL(url, 'http://aitu.local').pathname;
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
  signal: AbortSignal,
  duration?: number
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
        ...(Number.isFinite(duration) && (duration || 0) > 0
          ? { duration }
          : {}),
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
  const videoModelId =
    typeof videoModel === 'string'
      ? videoModel.trim()
      : videoModel.modelId?.trim();
  if (!videoModelId) throw new Error('PPT 逐页生成的视频模型 ID 无效');
  const videoModelRef = typeof videoModel === 'string' ? undefined : videoModel;
  const videoModelConfig = getEffectiveVideoModelConfigForSelection(
    videoModelId,
    videoModelRef
  );
  const legacySecondsPerSlide = Number.parseInt(
    videoModelConfig.defaultDuration,
    10
  );
  const secondsPerSlide =
    state.secondsPerSlide && state.secondsPerSlide > 0
      ? state.secondsPerSlide
      : Number.isFinite(legacySecondsPerSlide) && legacySecondsPerSlide > 0
      ? legacySecondsPerSlide
      : 8;
  const compositionSlides: LocalPptCompositionSlide[] = [];
  const compositionPlans: Array<
    Array<{
      slide: PptExplainerSlide;
      segment: ReturnType<typeof planPptExplainerSlideTimeline>[number];
      timelineIndex: number;
    }>
  > = [];

  const generateCompositionTurn = async (
    slide: PptExplainerSlide,
    segment: ReturnType<typeof planPptExplainerSlideTimeline>[number],
    timelineIndex: number
  ): Promise<LocalPptCompositionSlide['turns'][number]> => {
    if (!slide.snapshotUrl) {
      throw new Error(`PPT 第 ${slide.pageIndex} 页缺少页面快照`);
    }
    const prompt = buildPptExplainerVideoPrompt(
      { ...slide, turns: segment.turns },
      state.speakers,
      segment.outputDurationSeconds
    );
    let ownershipWrite: Promise<void> | undefined;
    const generated = await generatePptExplainerSegment(
      prompt,
      {
        model: videoModelId,
        modelRef: videoModelRef,
        duration: segment.requestDurationSeconds,
        size: videoModelConfig.defaultSize,
        resultVisibility: 'internal',
        autoInsertToCanvas: false,
        onTaskCreated: (internalTaskId) => {
          ownershipWrite = registerInternalTaskOwnership(
            taskId,
            internalTaskId,
            executionAttempt
          );
        },
      },
      signal
    );
    await ownershipWrite;
    state = {
      ...state,
      internalTaskIds: getOwnedInternalTaskIds(taskId, state),
    };
    signal.throwIfAborted();
    if (!generated.url) {
      const providerError = generated.task?.error?.message?.trim();
      throw new Error(
        providerError ||
          `PPT 第 ${slide.pageIndex} 页第 ${
            timelineIndex + 1
          } 段有声视频生成失败`
      );
    }
    const narrationMediaUrl = await cachePptExplainerNarrationSegment(
      generated.url,
      generated.task,
      signal
    );
    return {
      mediaUrl: narrationMediaUrl,
      subtitleCues: segment.subtitleCues,
      maxDurationSeconds: segment.outputDurationSeconds,
      outputDurationSeconds: segment.outputDurationSeconds,
    };
  };

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
    const timeline = planPptExplainerSlideTimeline({
      turns: slide.turns,
      speakers: state.speakers,
      secondsPerSlide,
      durationOptions: videoModelConfig.durationOptions,
    });
    const compositionTurns: LocalPptCompositionSlide['turns'] = [];
    const slidePlans: (typeof compositionPlans)[number] = [];
    for (const [timelineIndex, segment] of timeline.entries()) {
      signal.throwIfAborted();
      slidePlans.push({ slide, segment, timelineIndex });
      compositionTurns.push(
        await generateCompositionTurn(slide, segment, timelineIndex)
      );
    }
    compositionPlans.push(slidePlans);
    compositionSlides.push({
      imageUrl: slide.snapshotUrl,
      turns: compositionTurns,
    });
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
    {
      ...state,
      stage: 'finalizing',
      diagnostics: [
        ...(state.diagnostics || []).filter(
          (item) => !item.startsWith('正在生成第 ')
        ),
        '正在以原 PPT 页面固定画面合成讲解音轨',
      ],
    },
    executionAttempt,
    80,
    TaskExecutionPhase.DOWNLOADING
  );
  signal.throwIfAborted();
  const qualityRetriedSegments = new Set<string>();
  let finalizingProgress = 80;
  const composeCurrentSlides = () =>
    composeLocalPptExplainerVideo({
      slides: compositionSlides,
      width: 1920,
      height: 1080,
      transitionDurationMs: 0,
      signal,
      loadMediaBlob: (url, mediaSignal) => readInputBlob(url, mediaSignal),
      onProgress: async (progress, message) => {
        finalizingProgress = Math.max(
          finalizingProgress,
          Math.min(97, 80 + Math.round(progress * 0.17))
        );
        state = await persistStage(
          taskId,
          {
            ...state,
            stage: 'finalizing',
            diagnostics: [
              ...(state.diagnostics || []).filter(
                (item) =>
                  !item.startsWith('实时录制') &&
                  !item.startsWith('已完成') &&
                  !item.startsWith('正在校验')
              ),
              message,
            ],
          },
          executionAttempt,
          finalizingProgress,
          TaskExecutionPhase.DOWNLOADING
        );
      },
    });
  let composed:
    | Awaited<ReturnType<typeof composeLocalPptExplainerVideo>>
    | undefined;
  while (!composed) {
    try {
      composed = await composeCurrentSlides();
    } catch (error) {
      signal.throwIfAborted();
      if (
        !isPptExplainerNarrationQualityError(error) ||
        error.slideIndex === undefined ||
        error.turnIndex === undefined
      ) {
        throw error;
      }
      const retryKey = `${error.slideIndex}:${error.turnIndex}`;
      const plan = compositionPlans[error.slideIndex]?.[error.turnIndex];
      if (!plan || qualityRetriedSegments.has(retryKey)) throw error;
      qualityRetriedSegments.add(retryKey);
      state = await persistStage(
        taskId,
        {
          ...state,
          stage: 'submitting',
          diagnostics: [
            ...(state.diagnostics || []).filter(
              (item) => !item.includes('音轨质量不合格')
            ),
            `第 ${plan.slide.pageIndex} 页第 ${
              plan.timelineIndex + 1
            } 段音轨质量不合格，正在重试 1/1`,
          ],
        },
        executionAttempt,
        finalizingProgress,
        TaskExecutionPhase.SUBMITTING
      );
      signal.throwIfAborted();
      compositionSlides[error.slideIndex].turns[error.turnIndex] =
        await generateCompositionTurn(
          plan.slide,
          plan.segment,
          plan.timelineIndex
        );
    }
  }
  signal.throwIfAborted();
  const extension = composed.mimeType.includes('mp4') ? 'mp4' : 'webm';
  const stableUrl = `/__aitu_cache__/video/${taskId}.${extension}`;
  try {
    await unifiedCacheService.cacheMediaFromBlob(
      stableUrl,
      composed.blob,
      'video',
      { taskId, resultVisibility: 'user' }
    );
  } finally {
    if (
      composed.url.startsWith('blob:') &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      URL.revokeObjectURL(composed.url);
    }
  }
  await finalizeResult(
    taskId,
    state,
    executionAttempt,
    stableUrl,
    signal,
    composed.duration
  );
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

  signal.throwIfAborted();
  const result = await runPptExplainerBoardMutationExclusive(
    initialState.sourceBoardId,
    () =>
      generatePPT(
        {
          topic,
          pageCount: initialState.requestedPageCount,
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
    if (initialState.pptx?.cacheUrl) {
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
      let generatedSlideImages: Map<string, string>;
      try {
        generatedSlideImages = await prepareMissingPptSlideImages(board, {
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
      let frozenSelection = selection;
      if (generatedSlideImages.size > 0) {
        const materializedSelection =
          await runPptExplainerBoardMutationExclusive(state.sourceBoardId, () =>
            materializePptExplainerSlideImages(board, generatedSlideImages, {
              jobId: state.jobId,
              signal,
              selection,
            })
          );
        if (materializedSelection) {
          frozenSelection = materializedSelection;
          state = await persistStage(
            task.id,
            {
              ...state,
              outlineFrameIds: materializedSelection.frameIds,
              sourceFrameRevisions: materializedSelection.frameRevisions,
            },
            executionAttempt,
            20,
            TaskExecutionPhase.SUBMITTING
          );
        }
      }
      const frozen = await freezeCurrentPptSource(board, state.jobId, {
        signal,
        selection: frozenSelection,
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
          secondsPerSlide: state.secondsPerSlide,
          narrationInstruction: state.narrationInstruction,
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
