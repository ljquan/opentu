import type { PlaitBoard } from '@plait/core';
import { materializePPTOutline } from '../../mcp/tools/ppt-generation';
import { isFrameElement } from '../../types/frame.types';
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
  createPptExplainerProviderRouteSnapshot,
  PptExplainerProviderPreflightError,
  preflightPptExplainerProviderFromSettings,
  type PptExplainerProviderPreflightResult,
} from './provider-contract';
import {
  applyPptxCheckpointToExplainerState,
  captureCurrentPptSourceSelection,
  currentPptNeedsGeneratedSlideImages,
  getCurrentPptExplainerDraftOwners,
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
  type PptExplainerTaskState,
} from './types';
import {
  PptExplainerValidationError,
  readPptExplainerState,
  validatePptExplainerSpeakers,
} from './validation';

type AuxiliaryOperation = 'text' | 'image';

interface CreationContext {
  board: PlaitBoard;
  imageRequired: boolean;
  requiresPptReplacementConfirmation: boolean;
  currentPptSelection?: CurrentPptSourceSelection;
}

interface PptExplainerUiConfirmations {
  skipOutlineReview: boolean;
  replaceExistingPpt: boolean;
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
  if (confirmations.replaceExistingPpt && input.source !== 'topic') {
    throw new PptExplainerValidationError('当前任务不会替换已有 PPT');
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
  const requiresPptReplacementConfirmation =
    input.source === 'topic' &&
    binding.board.children.some(
      (element) =>
        isFrameElement(element) &&
        Boolean((element as typeof element & { pptMeta?: unknown }).pptMeta)
    );

  return {
    board: binding.board,
    requiresPptReplacementConfirmation,
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
): void {
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
  if (
    context.requiresPptReplacementConfirmation &&
    !confirmations?.replaceExistingPpt
  ) {
    throw new PptExplainerValidationError(
      '主题生成将替换当前 PPT，请在配置界面确认后重试'
    );
  }
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

function preflightVideoProvider(
  input: PptExplainerCreateInput
): PptExplainerProviderPreflightResult {
  const presentationInputs =
    input.source === 'pptx'
      ? (['pptx', 'slide_images'] as const)
      : (['slide_images'] as const);
  let unsupportedError: unknown;
  for (const presentationInput of presentationInputs) {
    try {
      return preflightPptExplainerProviderFromSettings(
        input.videoModelRef,
        {
          source: input.source,
          presentationInput,
          presenterMode: input.presenterMode,
        },
        { bindingId: input.providerBindingId }
      );
    } catch (error) {
      if (
        error instanceof PptExplainerProviderPreflightError &&
        error.code === 'capability_unsupported'
      ) {
        unsupportedError = error;
        continue;
      }
      throw error;
    }
  }
  throw unsupportedError || new Error('供应商不支持所选 PPT 讲解方式');
}

function buildInitialState(options: {
  input: PptExplainerCreateInput;
  topic?: string;
  jobId: string;
  provider: PptExplainerProviderPreflightResult;
  textPlan: InvocationPlan;
  imagePlan?: InvocationPlan;
  outlineFrameIds?: string[];
  sourceFrameRevisions?: Record<string, string>;
  pptxCheckpoint?: PptxImportCheckpoint;
}): PptExplainerTaskState {
  const { input, provider, pptxCheckpoint } = options;
  const presentationInput = provider.requirements.presentationInput;
  const needsReview =
    input.source === 'topic' && input.reviewMode === 'confirm';
  const reviewAcceptedAt = needsReview ? undefined : Date.now();
  const initialState: PptExplainerTaskState = {
    schemaVersion: PPT_EXPLAINER_SCHEMA_VERSION,
    jobId: options.jobId,
    source: input.source,
    sourceBoardId: input.sourceBoardId,
    topic: options.topic,
    outlineFrameIds: options.outlineFrameIds,
    sourceFrameRevisions: options.sourceFrameRevisions,
    reviewMode: input.reviewMode,
    reviewAcceptedAt,
    presenterMode: input.presenterMode,
    speakers: input.speakers.map((speaker) => ({ ...speaker })),
    stage:
      input.source === 'topic' ||
      (input.source === 'pptx' && pptxCheckpoint?.status !== 'completed')
        ? 'preparing'
        : needsReview
        ? 'review_pending'
        : 'snapshotting',
    slides: [],
    idempotencyKey: options.jobId,
    presentationInput,
    originalRoute: createPptExplainerProviderRouteSnapshot(provider),
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
      videoModel: input.videoModel?.trim() || provider.modelRef.modelId,
      videoModelRef: { ...input.videoModelRef },
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

export async function createPptExplainerTask(
  input: PptExplainerCreateInput
): Promise<Task> {
  const topic = requireTopic(input);
  const pptxFile = validatePptxFile(input);
  validatePptExplainerSpeakers(input.presenterMode, input.speakers);
  const context = await requireCreationContext(input);
  consumeUiConfirmations(input, context);

  await settingsManager.waitForInitialization();

  // All credential/capability checks happen before outline generation, import,
  // upload, or any other operation that can incur cost or persist binary data.
  const provider = preflightVideoProvider(input);
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

  const jobId = generateTaskId();
  const createInitialState = (
    pptxCheckpoint?: PptxImportCheckpoint
  ): PptExplainerTaskState =>
    buildInitialState({
      input,
      topic,
      jobId,
      provider,
      textPlan,
      imagePlan,
      outlineFrameIds:
        input.source === 'current_ppt'
          ? context.currentPptSelection?.frameIds
          : undefined,
      sourceFrameRevisions: context.currentPptSelection?.frameRevisions,
      pptxCheckpoint,
    });

  const releasePptxInput = pptxFile
    ? registerPptExplainerPptxInput(jobId, pptxFile)
    : undefined;
  let stagedPptxUrl: string | undefined;
  try {
    if (pptxFile) {
      stagedPptxUrl = await putPptExplainerArtifact(
        jobId,
        'source.pptx',
        pptxFile
      );
    }
    const initialState = createInitialState();
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
    let acceptedSource:
      | { frameIds: string[]; frameRevisions: Record<string, string> }
      | undefined;
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
      acceptedSource = await runPptExplainerBoardMutationExclusive(
        existingState.sourceBoardId,
        async () => {
          const owners = getCurrentPptExplainerDraftOwners(binding.board);
          if (owners.length === 1 && owners[0] !== existingState.jobId) {
            if (
              !existingState.topicOutline ||
              !validateOutline(existingState.topicOutline)
            ) {
              throw new PptExplainerValidationError(
                '该任务的大纲快照已丢失，请重新创建任务'
              );
            }
            materializePPTOutline(
              binding.board,
              existingState.topicOutline,
              { topic: existingState.topic || 'PPT 讲解视频' },
              {
                pptExplainerJobId: existingState.jobId,
                focusFirstFrame: false,
                openEditor: false,
              }
            );
          } else if (owners.length !== 1 || owners[0] !== existingState.jobId) {
            throw new PptExplainerValidationError(
              '当前画板已不再显示该任务的大纲，请重新创建任务'
            );
          }
          const selection = await captureCurrentPptSourceSelection(
            binding.board
          );
          if (!selection.frameRevisions) {
            throw new PptExplainerValidationError('大纲版本快照保存失败');
          }
          return {
            frameIds: selection.frameIds,
            frameRevisions: selection.frameRevisions,
          };
        }
      );
    }
    task = await confirmPptExplainerOutline(taskId, acceptedSource);
  }
  const state = readPptExplainerState(task);
  if (state && !['completed', 'cancelled'].includes(state.stage)) {
    void runPptExplainerTask(task.id);
  }
  return task;
}
