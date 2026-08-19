import type { PlaitBoard } from '@plait/core';
import {
  materializePPTOutline,
  removePptExplainerOwnedOutline,
} from '../../mcp/tools/ppt-generation';
import type { Task } from '../../types/task.types';
import { generateTaskId } from '../../utils/task-utils';
import { settingsManager, type ModelRef } from '../../utils/settings-manager';
import { getCanvasBoardBinding } from '../canvas-operations';
import {
  resolveInvocationPlanFromRoute,
  type InvocationPlan,
} from '../provider-routing';
import { createTaskInvocationRouteSnapshot } from '../task-invocation-route';
import { taskQueueService } from '../task-queue';
import { workspaceService } from '../workspace-service';
import { validateOutline } from '../ppt';
import type { PptxImportCheckpoint } from '../pptx-import';
import {
  applyPptxCheckpointToExplainerState,
  captureCurrentPptSourceSelection,
  currentPptNeedsGeneratedSlideImages,
  listCurrentPptFrameIds,
  type CurrentPptSourceSelection,
} from './source-resolver';
import {
  confirmPptExplainerOutline,
  createPptExplainerRootTask,
} from './task-state';
import {
  registerPptExplainerPptxInput,
  runPptExplainerBoardMutationExclusive,
  runPptExplainerTask,
} from './orchestrator';
import {
  deletePptExplainerArtifacts,
  putPptExplainerArtifact,
} from './internal-artifact-cache';
import {
  PPT_EXPLAINER_SCHEMA_VERSION,
  type PptExplainerCreateInput,
  type PptExplainerSpeaker,
  type PptExplainerTaskState,
} from './types';
import {
  PptExplainerValidationError,
  readPptExplainerState,
  validatePptExplainerSpeakers,
} from './validation';

type AuxiliaryOperation = 'text' | 'image' | 'video';

interface CreationContext {
  board: PlaitBoard;
  imageRequired: boolean;
  currentPptSelection?: CurrentPptSourceSelection;
}

interface PptExplainerUiConfirmations {
  skipOutlineReview: boolean;
}

const pendingUiConfirmations = new WeakMap<
  PptExplainerCreateInput,
  PptExplainerUiConfirmations
>();

/**
 * Records confirmations performed by the main-thread configuration dialog.
 * The grant is tied to this exact input object and consumed by one create call.
 */
export function authorizePptExplainerUiCreation(
  input: PptExplainerCreateInput,
  confirmations: PptExplainerUiConfirmations
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new PptExplainerValidationError('PPT 讲解确认只能在当前页面完成');
  }
  if (
    confirmations.skipOutlineReview &&
    (input.source !== 'topic' || input.reviewMode !== 'skip_after_warning')
  ) {
    throw new PptExplainerValidationError('当前任务不需要跳过大纲确认');
  }
  pendingUiConfirmations.set(input, { ...confirmations });
}

async function requireCreationContext(
  input: PptExplainerCreateInput
): Promise<CreationContext> {
  const binding = getCanvasBoardBinding();
  const currentBoardId = workspaceService.getState().currentBoardId;
  if (
    !binding?.boardId ||
    !input.sourceBoardId?.trim() ||
    binding.boardId !== input.sourceBoardId ||
    currentBoardId !== input.sourceBoardId
  ) {
    throw new PptExplainerValidationError(
      '任务只能从当前画板创建，请刷新画板状态后重试'
    );
  }

  const currentPptSelection =
    input.source === 'current_ppt'
      ? await captureCurrentPptSourceSelection(binding.board)
      : undefined;
  return {
    board: binding.board,
    imageRequired:
      input.source === 'topic' ||
      (input.source === 'current_ppt' &&
        currentPptNeedsGeneratedSlideImages(
          binding.board,
          currentPptSelection?.frameIds
        )),
    currentPptSelection,
  };
}

function requireTopic(input: PptExplainerCreateInput): string | undefined {
  if (input.source !== 'topic') return undefined;
  const topic = input.topic?.trim();
  if (!topic) {
    throw new PptExplainerValidationError('请输入 PPT 主题');
  }
  return topic;
}

export function inferPptExplainerRequestedPageCount(
  topic: string | undefined
): number | undefined {
  const normalized = topic?.trim();
  if (!normalized) return undefined;
  const match =
    normalized.match(/(?:^|[^\d])(\d{1,6})\s*(?:页|张)(?=[^\d]|$)/) ||
    normalized.match(/\b(\d{1,6})\s*(?:pages?|slides?)\b/i);
  if (!match) return undefined;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

function resolveRequestedPageCount(
  input: PptExplainerCreateInput,
  topic: string | undefined
): number | undefined {
  if (input.source !== 'topic') return undefined;
  if (input.requestedPageCount !== undefined) {
    if (
      !Number.isSafeInteger(input.requestedPageCount) ||
      input.requestedPageCount <= 0
    ) {
      throw new PptExplainerValidationError('PPT 页数必须是正整数');
    }
    return input.requestedPageCount;
  }
  return inferPptExplainerRequestedPageCount(topic);
}

function validatePptxFile(input: PptExplainerCreateInput): File | undefined {
  if (input.source !== 'pptx') return undefined;
  const file = input.pptxFile;
  if (!file || file.size <= 0) {
    throw new PptExplainerValidationError('请选择非空的 PPTX 文件');
  }
  if (!file.name.toLowerCase().endsWith('.pptx')) {
    throw new PptExplainerValidationError('仅支持 .pptx 文件');
  }
  return file;
}

function consumeUiConfirmations(
  input: PptExplainerCreateInput,
  context: CreationContext
): PptExplainerUiConfirmations | undefined {
  const confirmations = pendingUiConfirmations.get(input);
  pendingUiConfirmations.delete(input);
  if (
    input.source === 'topic' &&
    input.reviewMode === 'skip_after_warning' &&
    !confirmations?.skipOutlineReview
  ) {
    throw new PptExplainerValidationError(
      '必须确认：跳过大纲审核只能在当前页面完成二次确认'
    );
  }
  return confirmations;
}

function preflightAuxiliaryModel(
  operation: AuxiliaryOperation,
  routeModel: ModelRef | string | null | undefined,
  label: string
): InvocationPlan {
  if (!routeModel) {
    throw new PptExplainerValidationError(`请选择${label}模型`);
  }
  const plan = resolveInvocationPlanFromRoute(operation, routeModel);
  if (!plan) {
    throw new PptExplainerValidationError(`${label}模型没有可执行路由`);
  }
  if (!plan.provider.baseUrl.trim()) {
    throw new PptExplainerValidationError(`${label}模型供应商地址未配置`);
  }
  if (!plan.provider.apiKey.trim()) {
    throw new PptExplainerValidationError(`${label}模型供应商 API Key 未配置`);
  }
  return plan;
}

function buildInitialState(options: {
  input: PptExplainerCreateInput;
  topic?: string;
  requestedPageCount?: number;
  jobId: string;
  textPlan: InvocationPlan;
  imagePlan?: InvocationPlan;
  outlineFrameIds?: string[];
  sourceFrameRevisions?: Record<string, string>;
  pptxCheckpoint?: PptxImportCheckpoint;
  speakers: PptExplainerSpeaker[];
}): PptExplainerTaskState {
  const { input, pptxCheckpoint } = options;
  const needsReview =
    input.source === 'topic' && input.reviewMode === 'confirm';
  const reviewAcceptedAt = needsReview ? undefined : Date.now();
  const initialState: PptExplainerTaskState = {
    schemaVersion: PPT_EXPLAINER_SCHEMA_VERSION,
    jobId: options.jobId,
    source: input.source,
    sourceBoardId: input.sourceBoardId,
    topic: options.topic,
    requestedPageCount: options.requestedPageCount,
    outlineFrameIds: options.outlineFrameIds,
    sourceFrameRevisions: options.sourceFrameRevisions,
    reviewMode: input.reviewMode,
    reviewAcceptedAt,
    presenterMode: input.presenterMode,
    executionMode: 'local',
    speakers: options.speakers.map((speaker) => ({ ...speaker })),
    stage:
      input.source === 'topic' ||
      (input.source === 'pptx' && pptxCheckpoint?.status !== 'completed')
        ? 'preparing'
        : needsReview
        ? 'review_pending'
        : 'snapshotting',
    slides: [],
    idempotencyKey: options.jobId,
    presentationInput: 'slide_images',
    models: {
      textModel: input.textModel,
      textModelRef: input.textModelRef,
      textRoute: createTaskInvocationRouteSnapshot(
        'text',
        options.textPlan.modelRef,
        {
          bindingId: options.textPlan.binding.id,
          metadataPolicy: 'capabilities-only',
        }
      ),
      imageModel: input.imageModel,
      imageModelRef: input.imageModelRef,
      imageRoute: options.imagePlan
        ? createTaskInvocationRouteSnapshot(
            'image',
            options.imagePlan.modelRef,
            {
              bindingId: options.imagePlan.binding.id,
              metadataPolicy: 'capabilities-only',
            }
          )
        : undefined,
      videoModel: input.videoModel?.trim() || undefined,
      videoModelRef: input.videoModelRef
        ? { ...input.videoModelRef }
        : undefined,
    },
    delivery: {
      resultSaved: false,
      canvasInserted: false,
    },
    executionAttempt: 0,
    diagnostics: [],
  };
  return pptxCheckpoint
    ? applyPptxCheckpointToExplainerState(initialState, pptxCheckpoint)
    : initialState;
}

function assertSupportedPptExplainerInput(
  input: PptExplainerCreateInput
): void {
  if (!input || typeof input !== 'object') {
    throw new PptExplainerValidationError('PPT 讲解任务参数无效');
  }
  const candidate = input as unknown as Record<string, unknown>;
  if ('executionMode' in candidate || 'providerBindingId' in candidate) {
    throw new PptExplainerValidationError('创建参数包含当前不支持的执行配置');
  }
  if (
    typeof candidate.sourceBoardId !== 'string' ||
    typeof candidate.textModel !== 'string' ||
    typeof candidate.videoModel !== 'string' ||
    (candidate.imageModel !== undefined &&
      typeof candidate.imageModel !== 'string')
  ) {
    throw new PptExplainerValidationError('模型或画板参数无效');
  }
  if (
    candidate.presenterMode !== 'single_voice' &&
    candidate.presenterMode !== 'dual_voice'
  ) {
    throw new PptExplainerValidationError('当前仅支持单人讲解和双人对谈');
  }
  if (!Array.isArray(candidate.speakers)) {
    throw new PptExplainerValidationError('讲解者配置无效');
  }
  if (
    candidate.speakers.some(
      (speaker) =>
        !speaker ||
        typeof speaker !== 'object' ||
        [
          'voiceSource',
          'voiceId',
          'referenceAudio',
          'avatarAssetId',
          'avatarSourceUrl',
        ].some((field) => field in (speaker as Record<string, unknown>))
    )
  ) {
    throw new PptExplainerValidationError('讲解者配置包含当前不支持的字段');
  }
  for (const speaker of candidate.speakers) {
    const value = speaker as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.displayName !== 'string') {
      throw new PptExplainerValidationError('讲解者名称和 ID 必须是文本');
    }
  }
}

export async function createPptExplainerTask(
  input: PptExplainerCreateInput
): Promise<Task> {
  assertSupportedPptExplainerInput(input);
  const topic = requireTopic(input);
  const requestedPageCount = resolveRequestedPageCount(input, topic);
  const pptxFile = validatePptxFile(input);
  validatePptExplainerSpeakers(input.presenterMode, input.speakers, {
    requireVoice: false,
  });
  const context = await requireCreationContext(input);
  consumeUiConfirmations(input, context);

  await settingsManager.waitForInitialization();

  // All credential/capability checks happen before outline generation, import,
  // upload, or any other operation that can incur cost or persist binary data.
  const textPlan = preflightAuxiliaryModel(
    'text',
    input.textModelRef ?? input.textModel,
    '讲稿文本'
  );
  const imagePlan = context.imageRequired
    ? preflightAuxiliaryModel(
        'image',
        input.imageModelRef ?? input.imageModel,
        'PPT 页面图片'
      )
    : undefined;
  preflightAuxiliaryModel(
    'video',
    input.videoModelRef ?? input.videoModel,
    '讲解视频'
  );

  const jobId = generateTaskId();
  const createInitialState = (
    speakers: PptExplainerSpeaker[],
    pptxCheckpoint?: PptxImportCheckpoint
  ): PptExplainerTaskState =>
    buildInitialState({
      input,
      topic,
      requestedPageCount,
      jobId,
      textPlan,
      imagePlan,
      outlineFrameIds:
        input.source === 'current_ppt'
          ? context.currentPptSelection?.frameIds
          : undefined,
      sourceFrameRevisions: context.currentPptSelection?.frameRevisions,
      pptxCheckpoint,
      speakers,
    });

  const releasePptxInput = pptxFile
    ? registerPptExplainerPptxInput(jobId, pptxFile)
    : undefined;
  let stagedPptxUrl: string | undefined;
  try {
    const stagedSpeakers = input.speakers.map((speaker) => ({
      id: speaker.id.trim(),
      displayName: speaker.displayName.trim(),
    }));
    if (pptxFile) {
      stagedPptxUrl = await putPptExplainerArtifact(
        jobId,
        'source.pptx',
        pptxFile
      );
    }
    const initialState = createInitialState(stagedSpeakers);
    if (pptxFile && stagedPptxUrl) {
      initialState.pptx = {
        filename: pptxFile.name,
        mimeType: pptxFile.type || 'application/octet-stream',
        cacheUrl: stagedPptxUrl,
        fingerprint: `pending-${jobId}`,
      };
    }
    // Source preparation is part of the persisted state machine. The root is
    // visible and cancellable before PPTX parsing or page rendering begins.
    const task = await createPptExplainerRootTask(initialState);
    void runPptExplainerTask(task.id);
    return task;
  } catch (error) {
    releasePptxInput?.();
    await deletePptExplainerArtifacts(jobId).catch(() => undefined);
    throw error;
  }
}

export async function confirmAndRunPptExplainerTask(
  taskId: string
): Promise<Task> {
  const existing = taskQueueService.getTask(taskId);
  const existingState = existing ? readPptExplainerState(existing) : null;
  if (!existing || !existingState) {
    throw new PptExplainerValidationError('PPT 讲解任务不存在');
  }

  let task = existing;
  if (existingState.stage === 'review_pending') {
    if (existingState.source === 'topic') {
      const binding = getCanvasBoardBinding();
      const currentBoardId = workspaceService.getState().currentBoardId;
      if (
        !binding?.boardId ||
        binding.boardId !== existingState.sourceBoardId ||
        currentBoardId !== existingState.sourceBoardId
      ) {
        throw new PptExplainerValidationError(
          '请切回任务创建时的画板再确认大纲'
        );
      }
      task = await runPptExplainerBoardMutationExclusive(
        existingState.sourceBoardId,
        async () => {
          const currentTask = taskQueueService.getTask(taskId);
          const currentState = currentTask
            ? readPptExplainerState(currentTask)
            : null;
          if (!currentTask || !currentState) {
            throw new PptExplainerValidationError('PPT 讲解任务不存在');
          }
          if (currentState.stage !== 'review_pending') return currentTask;

          const outline = validateOutline(currentState.topicOutline)
            ? currentState.topicOutline
            : undefined;
          const currentFrameIds = listCurrentPptFrameIds(
            binding.board,
            currentState.jobId
          );
          if (outline && currentFrameIds.length !== outline.pages.length) {
            removePptExplainerOwnedOutline(binding.board, currentState.jobId);
            materializePPTOutline(
              binding.board,
              outline,
              { topic: currentState.topic || 'PPT 讲解视频' },
              {
                pptExplainerJobId: currentState.jobId,
                replaceExistingPpt: false,
                focusFirstFrame: false,
                openEditor: false,
              }
            );
          } else if (currentFrameIds.length === 0) {
            throw new PptExplainerValidationError(
              '该任务的大纲快照已丢失，请重新创建任务'
            );
          }
          const selection = await captureCurrentPptSourceSelection(
            binding.board,
            currentState.jobId
          );
          if (!selection.frameRevisions) {
            throw new PptExplainerValidationError('大纲版本快照保存失败');
          }
          return confirmPptExplainerOutline(taskId, {
            frameIds: selection.frameIds,
            frameRevisions: selection.frameRevisions,
          });
        }
      );
    } else {
      task = await confirmPptExplainerOutline(taskId);
    }
  }
  const state = readPptExplainerState(task);
  if (state && !['completed', 'cancelled'].includes(state.stage)) {
    void runPptExplainerTask(task.id);
  }
  return task;
}
