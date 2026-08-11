/**
 * AI Input Bar Component
 *
 * A floating input bar at the bottom center of the canvas for AI generation.
 * Similar to mixboard.google.com's interaction pattern.
 *
 * Features:
 * - Single row horizontal layout
 * - Orange theme border
 * - Text input for prompts
 * - Selected images display
 * - Model dropdown selector in bottom-left corner
 * - Send button to trigger generation
 * - Integration with ChatDrawer for conversation display
 * - Agent mode: AI decides which MCP tool to use (image/video generation)
 * - Smart Suggestion Panel for #model
 */

import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  PinOff,
  Send,
  Unlink,
  X,
} from 'lucide-react';
import {
  Dropdown,
  MessagePlugin,
  Switch,
  type DropdownOption,
} from 'tdesign-react';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { ImageUploadIcon, MediaLibraryIcon } from '../icons';
import { useBoard } from '@plait-board/react-board';
import { SelectedContentPreview } from '../shared/SelectedContentPreview';
import { PromptOptimizeButton } from '../shared/PromptOptimizeButton';
import { KnowledgeNoteContextSelector } from '../shared/KnowledgeNoteContextSelector';
import {
  getSelectedElements,
  addSelectedElement,
  ATTACHED_ELEMENT_CLASS_NAME,
  getRectangleByElements,
  PlaitBoard,
  PlaitElement,
  RectangleClient,
  getViewportOrigination,
  Transforms,
} from '@plait/core';
import { useI18n } from '../../i18n';
import { TaskStatus, type KnowledgeContextRef } from '../../types/task.types';
import { taskQueueService } from '../../services/task-queue';
import {
  AI_SELECTION_CONTENT_REFRESH_EVENT,
  extractTextFromElement,
  processSelectedContentForAI,
  scrollToPointIfNeeded,
} from '../../utils/selection-utils';
import { useTextSelection } from '../../hooks/useTextSelection';
import {
  useChatDrawerControl,
  type DrawerGenerationSubmitParams,
} from '../../contexts/ChatDrawerContext';
import { useAssets } from '../../contexts/AssetContext';
import { useModelHealthContext } from '../../contexts/ModelHealthContext';
import {
  AssetType,
  AssetSource,
  SelectionMode,
  Asset,
} from '../../types/asset.types';
import { MediaLibraryModal } from '../media-library/MediaLibraryModal';
import { ModelDropdown } from './ModelDropdown';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { HoverTip } from '../shared/hover';
import { ParametersDropdown } from './ParametersDropdown';
import { PromptHistoryPopover } from './PromptHistoryPopover';
import { usePromptHistory } from '../../hooks/usePromptHistory';
import {
  addImagePromptHistory,
  addVideoPromptHistory,
  type PromptType,
} from '../../services/prompt-storage-service';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';
import {
  getDefaultAudioModel,
  getDefaultImageModel,
  getModelConfig,
  getDefaultSizeForModel,
  getDefaultVideoModel,
  getDefaultTextModel,
  getCompatibleParams,
  type ModelConfig,
} from '../../constants/model-config';
import { getEffectiveVideoCompatibleParams } from '../../services/video-binding-utils';
import { initializeMCP, mcpRegistry } from '../../mcp';
import { setCanvasBoard } from '../../services/canvas-operations/canvas-insertion';
import { setCanvasBoard as setMcpCanvasBoard } from '../../mcp/tools/canvas-insertion';
import { setBoard } from '../../mcp/tools/shared';
import { setCapabilitiesBoard } from '../../services/sw-capabilities/handler';
import { initializeLongVideoChainService } from '../../services/long-video-chain-service';
import { gridImageService } from '../../services/photo-wall';
import type { MCPTaskResult } from '../../mcp/types';
import { parseAIInput, type GenerationType } from '../../utils/ai-input-parser';
import {
  convertToWorkflow,
  convertSkillFlowToWorkflow,
  type WorkflowDefinition,
  type WorkflowStepOptions,
} from './workflow-converter';
import { getBoundTaskbarWidth } from './bound-taskbar-layout';
import { SkillDropdown, type SkillOption } from './SkillDropdown';
import {
  inferSkillMediaTypes,
  type SkillMediaType,
  type SkillOutputType,
} from './skill-media-type';
import {
  SKILL_AUTO_ID,
  findSystemSkillById,
  findExternalSkillById,
} from '../../constants/skills';
import { knowledgeBaseService } from '../../services/knowledge-base-service';
import { externalSkillService } from '../../services/external-skill-service';
import { useWorkflowControl } from '../../contexts/WorkflowContext';
import {
  hasInvocationRouteCredentials,
  resolveInvocationRoute,
  createModelRef,
  type ModelRef,
} from '../../utils/settings-manager';
import { promptForApiKey } from '../../utils/gemini-api/auth';
import type { WorkflowMessageData } from '../../types/chat.types';
import type { GenerationParams } from '../../types/shared/core.types';
import {
  analytics,
  type PromptAnalyticsType,
} from '../../utils/posthog-analytics';
import classNames from 'classnames';
import { InspirationBoard } from '../inspiration-board';
import { AIInputComposerShell } from './AIInputComposerShell';
import { GenerationTypeDropdown } from './GenerationTypeDropdown';
import { CountDropdown } from './CountDropdown';
import './ai-input-bar.scss';

import type {
  WorkflowRetryContext,
  PostProcessingStatus,
} from '../../types/chat.types';
import { workflowCompletionService } from '../../services/workflow-completion-service';
import { BoardTransforms } from '@plait/core';
import { ImageGenerationAnchorTransforms } from '../../plugins/with-image-generation-anchor';
import { buildImageGenerationAnchorCreateOptions } from '../../utils/image-generation-anchor-submission';
import { resolveImageGenerationBatchAnchorPositions } from '../../utils/image-generation-anchor-placement';
import {
  buildImageGenerationAnchorPresentationPatch,
  type ImageGenerationAnchorPresentationState,
} from '../../utils/image-generation-anchor-state';
import { WorkZoneTransforms } from '../../plugins/with-workzone';
import { useWorkflowSubmission } from '../../hooks/useWorkflowSubmission';
import { isFrameElement } from '../../types/frame.types';
import { matchFrameSizeForModel } from '../../utils/frame-size-matcher';
import { PlaitDrawElement } from '@plait/draw';
import { isPlaitVideo } from '../../interfaces/video';
import { isCardElement } from '../../types/card.types';
import { isAudioNodeElement } from '../../types/audio-node.types';
import {
  loadAIInputPreferences,
  loadScopedAIInputModelParams,
  saveAIInputPreferences,
  saveScopedAIInputModelParams,
} from '../../services/ai-generation-preferences-service';
import { applyForcedSunoParams } from '../../utils/suno-model-aliases';
import {
  clearPersistedModelSelection,
  getPersistedModelSelection,
  setPersistedModelSelection,
  type PersistedGenerationType,
} from '../../utils/ai-model-selection-storage';
import {
  AI_INPUT_FOCUS_EVENT,
  AI_INPUT_PREFILL_EVENT,
  type AIInputFocusEventDetail,
  type AIInputPrefillEventDetail,
} from '../../services/ai-input-ui-events';
import { normalizeKnowledgeContextRefs } from '../../services/generation-context-service';
import { isAssetLibraryUrl } from '../../utils/virtual-media-url';
import {
  ensureTaskIdInStepResult,
  extractTaskIdFromStepResult,
  findWorkflowStepByTaskId,
  findWorkflowStepForTask,
} from '../../utils/workflow-task-linking';
import {
  BOUND_TARGET_DISMISS_HINT_LIMIT,
  areBoundTargetTaskbarDraftsEqual,
  buildBoundTargetGenerationParams,
  collectBoundTargetElementIds,
  createBoundImageTargetStateKey,
  findBoundTargetElement,
  formatBoundTargetPromptSuggestion,
  isBoundTargetReferenceOnly,
  pinBoundTargetReferenceContent,
  pruneStaleBoundTargetTaskbarDrafts,
  readBoundTargetDismissHintCount,
  readBoundTargetFollowEnabled,
  readBoundTargetGenerationPrompt,
  recordBoundTargetDismiss,
  persistBoundTargetFollowEnabled,
  resolveBoundTargetForPosition,
  resolveBoundTargetPromptSuggestion,
  resolveBoundTargetPromptSuggestionAction,
  resolveBoundTargetTaskbarDraft,
  resolveBoundTargetSuppression,
  resolveTaskbarDraftAfterSubmission,
  shouldBindGenerationTarget,
  shouldReleaseBoundTargetPromptDismissal,
  shouldUseBoundTargetForSubmission,
  supportsBoundTargetFollowControls,
  storeBoundTargetTaskbarDraft,
  type BoundGenerationTargetType,
  type BoundTargetTaskbarDraft,
  type BoundTargetTaskbarDraftEntry,
  type BoundImageTargetMode,
} from './target-bound-taskbar-state';

/**
 * 将 WorkflowDefinition 转换为 WorkflowMessageData
 * @param workflow 工作流定义
 * @param retryContext 可选的重试上下文
 * @param postProcessingStatus 后处理状态
 * @param insertedCount 插入数量
 */
function toWorkflowMessageData(
  workflow: WorkflowDefinition,
  retryContext?: WorkflowRetryContext,
  postProcessingStatus?: PostProcessingStatus,
  insertedCount?: number
): WorkflowMessageData {
  // Safely access metadata with defaults
  const metadata = workflow.metadata || {};

  return {
    id: workflow.id,
    name: workflow.name,
    generationType: workflow.generationType,
    prompt: metadata.prompt || retryContext?.aiContext?.finalPrompt || '',
    aiAnalysis: workflow.aiAnalysis,
    count: metadata.count,
    createdAt: workflow.createdAt,
    status: workflow.status,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      description: step.description,
      status: step.status,
      mcp: step.mcp,
      args: step.args,
      result: step.result,
      error: step.error,
      duration: step.duration,
      options: step.options,
    })),
    retryContext,
    postProcessingStatus,
    insertedCount,
  };
}

function areAllWorkflowStepsCompleted(workflow: WorkflowDefinition): boolean {
  return (
    workflow.steps.length > 0 &&
    workflow.steps.every((step) => step.status === 'completed')
  );
}

function toPromptAnalyticsType(
  type?: PromptType
): PromptAnalyticsType | undefined {
  return type as PromptAnalyticsType | undefined;
}

type PromptLineageMeta = NonNullable<GenerationParams['promptMeta']>;
const KNOWLEDGE_CONTEXT_MCP_TOOLS = new Set([
  'generate_image',
  'generate_video',
  'generate_long_video',
  'generate_audio',
  'generate_text',
]);

function getPromptHistoryCategoryForStep(
  mcp: string,
  workflow: WorkflowDefinition
): PromptLineageMeta['category'] {
  if (mcp === 'generate_image') return 'image';
  if (mcp === 'generate_video' || mcp === 'generate_long_video') return 'video';
  if (mcp === 'generate_audio') return 'audio';
  if (mcp === 'generate_text') return 'text';
  return workflow.scenarioType === 'skill_flow' ||
    workflow.generationType === 'agent'
    ? 'agent'
    : workflow.generationType === 'image' ||
      workflow.generationType === 'video' ||
      workflow.generationType === 'audio' ||
      workflow.generationType === 'text'
    ? workflow.generationType
    : 'agent';
}

function normalizeAIInputImageDataUrl(value: string): string {
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

  return `data:image/png;base64,${normalized}`;
}

function normalizeAIInputImageUrl(url: string): string {
  const normalized = normalizeAIInputImageDataUrl(url);
  try {
    const parsed = new URL(normalized, window.location.origin);
    parsed.searchParams.delete('_retry');
    parsed.searchParams.delete('bypass_sw');
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function buildPromptLineageMeta(
  workflow: WorkflowDefinition,
  step: Pick<WorkflowDefinition['steps'][number], 'mcp' | 'args'>
): PromptLineageMeta {
  const sentPrompt =
    typeof step.args.prompt === 'string'
      ? step.args.prompt.trim()
      : workflow.metadata.prompt.trim();
  const initialPrompt = (
    workflow.metadata.rawInput ||
    workflow.metadata.userInstruction ||
    workflow.metadata.prompt ||
    sentPrompt
  )
    .trim()
    .slice(0, 2000);
  const skillName =
    workflow.scenarioType === 'skill_flow' ? workflow.name.trim() : undefined;
  const category = getPromptHistoryCategoryForStep(step.mcp, workflow);
  const knowledgeContextRefs = normalizeKnowledgeContextRefs(
    workflow.metadata.knowledgeContextRefs
  );

  return {
    initialPrompt,
    sentPrompt: sentPrompt.slice(0, 2000),
    category,
    skillId: workflow.skillId,
    skillName,
    tags: [category, skillName].filter(Boolean) as string[],
    knowledgeContextRefs:
      knowledgeContextRefs.length > 0 ? knowledgeContextRefs : undefined,
  };
}

function enrichStepArgsWithPromptMeta<
  T extends { mcp: string; args: Record<string, unknown> }
>(workflow: WorkflowDefinition, step: T): T {
  const knowledgeContextRefs = normalizeKnowledgeContextRefs(
    workflow.metadata.knowledgeContextRefs
  );
  const argsWithKnowledgeContext =
    knowledgeContextRefs.length > 0 &&
    KNOWLEDGE_CONTEXT_MCP_TOOLS.has(step.mcp) &&
    !step.args.knowledgeContextRefs
      ? {
          ...step.args,
          knowledgeContextRefs,
        }
      : step.args;

  if (
    argsWithKnowledgeContext.promptMeta ||
    ![
      'generate_image',
      'generate_video',
      'generate_long_video',
      'generate_audio',
      'generate_text',
    ].includes(step.mcp)
  ) {
    return {
      ...step,
      args: argsWithKnowledgeContext,
    };
  }

  return {
    ...step,
    args: {
      ...argsWithKnowledgeContext,
      promptMeta: buildPromptLineageMeta(workflow, step),
    },
  };
}

function bindWorkflowImageStepsToAnchors(
  workflow: WorkflowDefinition,
  anchors: Array<
    ReturnType<typeof ImageGenerationAnchorTransforms.insertAnchor>
  >
): void {
  let imageStepIndex = 0;
  workflow.steps = workflow.steps.map((step) => {
    if (step.mcp !== 'generate_image') {
      return step;
    }

    const anchor =
      anchors.find(
        (item) =>
          step.options?.batchId &&
          item.batchId === step.options.batchId &&
          item.batchIndex === step.options.batchIndex
      ) ||
      anchors[imageStepIndex] ||
      anchors[0];
    imageStepIndex += 1;

    return anchor
      ? { ...step, args: { ...step.args, anchorId: anchor.id } }
      : step;
  });
}

// 初始化 MCP 模块和长视频链服务
let mcpInitialized = false;
if (!mcpInitialized) {
  initializeMCP();
  initializeLongVideoChainService();
  // 初始化外部 Skill 服务（异步，会自动加载预构建 bundle）
  externalSkillService.initialize().catch((err) => {
    console.warn('[AIInputBar] 外部 Skill 服务初始化失败（非致命）:', err);
  });
  mcpInitialized = true;
}

// 选中内容类型：图片、视频、图形、文字
type SelectedContentType = 'image' | 'video' | 'graphics' | 'text';

interface SelectedContent {
  type: SelectedContentType;
  url?: string; // 图片/视频/图形的 URL
  maskImage?: string; // 单图局部编辑蒙版 URL
  text?: string; // 文字内容
  name: string; // 显示名称
  width?: number; // 图片/视频宽度
  height?: number; // 图片/视频高度
}

interface GenerationRequestOverride {
  prompt: string;
  content: SelectedContent[];
  generationType: GenerationType;
  selectedModel: string;
  selectedModelRef?: ModelRef | null;
  selectedParams: Record<string, string>;
  selectedCount: number;
  appendToCurrentChatSession?: boolean;
}

function getSelectionKeyForModel(
  model: Pick<ModelConfig, 'id' | 'selectionKey' | 'sourceProfileId'>
): string {
  return (
    model.selectionKey ||
    (model.sourceProfileId ? `${model.sourceProfileId}::${model.id}` : model.id)
  );
}

function getSelectionKey(modelId: string, modelRef?: ModelRef | null): string {
  return modelRef?.profileId ? `${modelRef.profileId}::${modelId}` : modelId;
}

function getModelRefFromConfig(model?: ModelConfig | null): ModelRef | null {
  if (!model) {
    return null;
  }

  return createModelRef(model.sourceProfileId || null, model.id);
}

function getPromptLengthBucket(length: number): string {
  if (length <= 0) return '0';
  if (length <= 20) return '1-20';
  if (length <= 100) return '21-100';
  if (length <= 300) return '101-300';
  if (length <= 800) return '301-800';
  return '800+';
}

const AI_INPUT_COLLAPSED_ROWS = 1;
const AI_INPUT_EXPANDED_ROWS = 4;
const AI_INPUT_MAX_ROWS = 6;
const AI_INPUT_PROMPT_EXPAND_TRIGGER_ROWS = 5;
const AI_INPUT_LONG_TEXT_ROWS = 8;
const AI_INPUT_LONG_TEXT_MAX_VIEWPORT_RATIO = 0.65;
const AI_INPUT_LONG_TEXT_MIN_MAX_HEIGHT = 320;
const AI_INPUT_LONG_TEXT_MAX_HEIGHT = 680;
const AI_INPUT_LINE_HEIGHT = 1.5;
type AIInputResizeMode = 'collapsed' | 'expanded' | 'long-text';
type AIInputSubmitTrigger = 'button' | 'keyboard';

function getTextareaMetrics(textarea: HTMLTextAreaElement) {
  const styles = window.getComputedStyle(textarea);
  const fontSize = Number.parseFloat(styles.fontSize) || 15;
  const lineHeight =
    Number.parseFloat(styles.lineHeight) || fontSize * AI_INPUT_LINE_HEIGHT;
  const verticalPadding =
    Number.parseFloat(styles.paddingTop) +
    Number.parseFloat(styles.paddingBottom);
  const verticalBorder =
    Number.parseFloat(styles.borderTopWidth) +
    Number.parseFloat(styles.borderBottomWidth);

  return { lineHeight, verticalPadding, verticalBorder };
}

function getTextareaHeightForRows(textarea: HTMLTextAreaElement, rows: number) {
  const { lineHeight, verticalPadding, verticalBorder } =
    getTextareaMetrics(textarea);
  return Math.ceil(lineHeight * rows + verticalPadding + verticalBorder);
}

function getTextareaContentRows(textarea: HTMLTextAreaElement): number {
  const { lineHeight, verticalPadding } = getTextareaMetrics(textarea);
  let explicitRows = 1;
  for (let i = 0; i < textarea.value.length; i += 1) {
    if (textarea.value.charCodeAt(i) === 10) {
      explicitRows += 1;
    }
  }
  const previousHeight = textarea.style.height;
  textarea.style.height = 'auto';
  const contentHeight = textarea.scrollHeight;
  textarea.style.height = previousHeight;
  const visualRows = Math.ceil(
    Math.max(0, contentHeight - verticalPadding) / lineHeight
  );
  return Math.max(explicitRows, visualRows);
}

function getAIInputLongTextMaxHeight() {
  return Math.min(
    Math.max(
      Math.floor(window.innerHeight * AI_INPUT_LONG_TEXT_MAX_VIEWPORT_RATIO),
      AI_INPUT_LONG_TEXT_MIN_MAX_HEIGHT
    ),
    AI_INPUT_LONG_TEXT_MAX_HEIGHT
  );
}

function resizeAIInputTextarea(
  textarea: HTMLTextAreaElement | null,
  resizeMode: AIInputResizeMode
) {
  if (!textarea) return;

  if (resizeMode === 'collapsed') {
    textarea.style.height = '';
    textarea.style.overflowY = '';
    return;
  }

  textarea.style.height = 'auto';
  const contentHeight = textarea.scrollHeight;

  if (resizeMode === 'long-text') {
    const maxHeight = getAIInputLongTextMaxHeight();
    textarea.style.height = `${maxHeight}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    return;
  }

  const minHeight = getTextareaHeightForRows(textarea, AI_INPUT_EXPANDED_ROWS);
  const maxHeight = getTextareaHeightForRows(textarea, AI_INPUT_MAX_ROWS);
  const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
}

function findMatchingSelectableModel(
  models: ModelConfig[],
  modelId?: string | null,
  modelRef?: ModelRef | null
): ModelConfig | undefined {
  if (!modelId) {
    return undefined;
  }

  const expectedKey = getSelectionKey(modelId, modelRef);
  const expectedProfileId = modelRef?.profileId || null;

  return (
    models.find((model) => getSelectionKeyForModel(model) === expectedKey) ||
    models.find(
      (model) =>
        model.id === modelId &&
        (model.sourceProfileId || null) === expectedProfileId
    ) ||
    (expectedProfileId === null
      ? models.find((model) => model.id === modelId && !model.sourceProfileId)
      : undefined) ||
    models.find((model) => model.id === modelId)
  );
}

function resolveGenerationTypeForModelSelection(
  currentGenerationType: GenerationType,
  modelType: ModelConfig['type']
): GenerationType {
  if (currentGenerationType === 'agent' && modelType === 'text') {
    return 'agent';
  }

  return modelType as GenerationType;
}

/**
 * 检查 URL 是否为视频
 */
function isVideoUrl(url: string): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();

  // 检查 #video 标识符
  if (lowerUrl.includes('#video')) {
    return true;
  }

  // 检查视频扩展名
  const videoExtensions = [
    '.mp4',
    '.webm',
    '.mov',
    '.avi',
    '.mkv',
    '.m4v',
    '.flv',
    '.wmv',
  ];
  return videoExtensions.some((ext) => lowerUrl.includes(ext));
}

interface AIInputBarProps {
  className?: string;
  /** 数据是否已准备好（用于判断画布是否为空） */
  isDataReady?: boolean;
  /** 当前画板 ID，用于隔离不同画板中可能重复的元素 ID */
  currentBoardId?: string | null;
  /** 确保工具窗口管理器已启用 */
  onEnableToolWindows?: () => void;
  /** 确保生成任务后台运行时已启用 */
  onEnableRuntime?: () => void;
}

interface BoundImageTarget {
  type: BoundGenerationTargetType;
  elementId: string;
  prompt: string;
  rect: { x: number; y: number; width: number; height: number };
  url: string;
  text?: string;
  generationTaskId?: string;
  generationAnchorId?: string;
  referenceOnly: boolean;
}

type BoundTargetDismissMode = 'once' | 'always';

type BoundImageInputDraft = BoundTargetTaskbarDraft<
  SelectedContent,
  KnowledgeContextRef
>;

function createBoundImageInputDraft(prompt = ''): BoundImageInputDraft {
  return {
    prompt,
    uploadedContent: [],
    knowledgeContextRefs: [],
  };
}

function readImageUrl(element: unknown): string {
  const record = element as Record<string, unknown> | null;
  const url = record?.url;
  if (typeof url === 'string' && url.trim()) {
    return url.trim();
  }
  const imageItem = record?.imageItem as Record<string, unknown> | undefined;
  if (typeof imageItem?.url === 'string' && imageItem.url.trim()) {
    return imageItem.url.trim();
  }
  return typeof record?.audioUrl === 'string' ? record.audioUrl.trim() : '';
}

function isLegacyAudioImageElement(element: unknown): boolean {
  const record = element as Record<string, unknown> | null;
  return Boolean(
    record &&
      (record.isAudio === true ||
        record.audioType === 'music-card' ||
        typeof record.audioUrl === 'string')
  );
}

function resolveGenerationTargetType(
  element: PlaitElement
): BoundGenerationTargetType | null {
  if (isAudioNodeElement(element) || isLegacyAudioImageElement(element)) {
    return 'audio';
  }
  if (isPlaitVideo(element)) {
    return 'video';
  }
  if (PlaitDrawElement.isImage(element)) {
    const record = element as Record<string, unknown>;
    return record.isVideo === true ||
      record.videoType ||
      isVideoUrl(readImageUrl(element))
      ? 'video'
      : 'image';
  }
  if (isCardElement(element) || PlaitDrawElement.isText?.(element)) {
    return 'text';
  }
  return null;
}

function resolveImageAnchorForElement(
  board: PlaitBoard,
  element: PlaitElement
) {
  const record = element as Record<string, unknown>;
  const anchorId = record.generationAnchorId;
  if (typeof anchorId === 'string' && anchorId.trim()) {
    const anchor = ImageGenerationAnchorTransforms.getAnchorById(
      board,
      anchorId.trim()
    );
    if (anchor) return anchor;
  }

  const taskId = record.generationTaskId;
  if (typeof taskId === 'string' && taskId.trim()) {
    const anchor = ImageGenerationAnchorTransforms.getAnchorByTaskId(
      board,
      taskId.trim()
    );
    if (anchor) return anchor;
  }

  const elementId = String((element as { id?: string }).id || '');
  return ImageGenerationAnchorTransforms.getAllAnchors(board).find(
    (anchor) =>
      anchor.resultElementId === elementId ||
      anchor.targetElementId === elementId
  );
}

async function resolveBoundImageTarget(
  board: PlaitBoard,
  selectedElements: PlaitElement[]
): Promise<BoundImageTarget | null> {
  if (selectedElements.length !== 1) return null;

  const [element] = selectedElements;
  const targetType = resolveGenerationTargetType(element);
  if (!targetType) return null;
  const url = readImageUrl(element);
  const record = element as Record<string, unknown>;
  const anchor =
    targetType === 'image'
      ? resolveImageAnchorForElement(board, element)
      : null;
  let prompt =
    readBoundTargetGenerationPrompt(element, targetType) ||
    anchor?.prompt ||
    '';
  let generationTaskId =
    typeof record.generationTaskId === 'string'
      ? record.generationTaskId
      : anchor?.latestTaskId || anchor?.primaryTaskId;

  if (!prompt && generationTaskId) {
    const task =
      (await taskQueueService.getCompleteTask(generationTaskId)) ||
      taskQueueService.getTask(generationTaskId);
    prompt = typeof task?.params?.prompt === 'string' ? task.params.prompt : '';
  }

  if (!prompt && targetType === 'image' && url && !isAssetLibraryUrl(url)) {
    const task = await taskQueueService.findImageTaskByResultUrl(url);
    prompt = typeof task?.params?.prompt === 'string' ? task.params.prompt : '';
    generationTaskId = generationTaskId || task?.id;
  }

  if (!shouldBindGenerationTarget(targetType, prompt)) {
    return null;
  }

  if (!readBoundTargetGenerationPrompt(element, targetType) && prompt) {
    try {
      Transforms.setNode(
        board,
        {
          aiPrompt: prompt,
          generationPrompt: prompt,
        } as Partial<PlaitElement>,
        PlaitBoard.findPath(board, element)
      );
    } catch {
      // 元数据回写失败不应阻断本次目标绑定。
    }
  }

  try {
    return {
      type: targetType,
      elementId: String((element as { id?: string }).id || ''),
      prompt: prompt.trim(),
      rect: getRectangleByElements(board, [element], false),
      url,
      text:
        targetType === 'text'
          ? extractTextFromElement(element, board).trim() || undefined
          : undefined,
      generationTaskId,
      generationAnchorId:
        typeof record.generationAnchorId === 'string'
          ? record.generationAnchorId
          : anchor?.id,
      referenceOnly:
        supportsBoundTargetFollowControls(targetType) &&
        isBoundTargetReferenceOnly(record),
    };
  } catch {
    return null;
  }
}

function selectedContentFromBoundTarget(
  target: BoundImageTarget | null,
  language: string,
  referenceOnly = false
): SelectedContent | null {
  if (!target) {
    return null;
  }

  if (target.type === 'text') {
    const text = target.text?.trim();
    return text
      ? {
          type: 'text',
          text,
          name:
            language === 'zh'
              ? referenceOnly
                ? '参考文本'
                : '目标文本'
              : referenceOnly
              ? 'Reference text'
              : 'Target text',
        }
      : null;
  }

  if (!target.url || !['image', 'video'].includes(target.type)) return null;

  const isVideo = target.type === 'video';

  return {
    type: target.type as 'image' | 'video',
    url: target.url,
    name:
      language === 'zh'
        ? referenceOnly
          ? isVideo
            ? '参考视频'
            : '参考图'
          : isVideo
          ? '目标视频'
          : '目标图片'
        : referenceOnly
        ? isVideo
          ? 'Reference video'
          : 'Reference image'
        : isVideo
        ? 'Target video'
        : 'Target image',
    width: target.rect.width,
    height: target.rect.height,
  };
}

/**
 * 独立的选择内容监听组件
 * 将 useBoard 隔离在这个组件中，避免 board context 变化导致主组件重渲染
 */
const SelectionWatcher: React.FC<{
  language: string;
  currentBoardId?: string | null;
  onSelectionChange: (content: SelectedContent[]) => void;
  onBoundImageTargetChange?: (target: BoundImageTarget | null) => void;
  onBoundInputViewportChange?: () => void;
  /** 用于存储 board 引用的 ref，供父组件使用 */
  externalBoardRef?: React.MutableRefObject<any>;
  /** 画板空状态变化回调 */
  onCanvasEmptyChange?: (isEmpty: boolean) => void;
  /** 数据是否已准备好 */
  isDataReady?: boolean;
  /** 选中单个 Frame 时回调（传递 Frame ID 和宽高），取消选中或选中非 Frame 时传 null */
  onFrameSelected?: (
    frameInfo: { id: string; width: number; height: number } | null
  ) => void;
}> = React.memo(
  ({
    language,
    currentBoardId,
    onSelectionChange,
    onBoundImageTargetChange,
    onBoundInputViewportChange,
    externalBoardRef,
    onCanvasEmptyChange,
    isDataReady,
    onFrameSelected,
  }) => {
    const board = useBoard();
    const boardRef = useRef(board);
    boardRef.current = board;

    // 设置 canvas board 引用给 MCP 工具使用
    useEffect(() => {
      setCanvasBoard(board);
      setMcpCanvasBoard(board);
      setBoard(board);
      setCapabilitiesBoard(board);
      gridImageService.setBoard(board);
      // 同时设置外部 ref
      if (externalBoardRef) {
        externalBoardRef.current = board;
      }
      return () => {
        setCanvasBoard(null);
        setMcpCanvasBoard(null);
        setBoard(null);
        setCapabilitiesBoard(null);
        gridImageService.setBoard(null);
        if (externalBoardRef) {
          externalBoardRef.current = null;
        }
      };
    }, [board, externalBoardRef]);

    // 监听画板元素数量变化，通知父组件画板是否为空
    const onCanvasEmptyChangeRef = useRef(onCanvasEmptyChange);
    onCanvasEmptyChangeRef.current = onCanvasEmptyChange;

    useEffect(() => {
      if (!board || !onCanvasEmptyChangeRef.current) return;

      // 只有在数据准备好后才检查是否为空
      if (!isDataReady) {
        return;
      }

      // 检查画布是否为空
      const checkEmpty = () => {
        const elements = board.children || [];
        onCanvasEmptyChangeRef.current?.(elements.length === 0);
      };

      // 定期检查（因为 Plait 的数据变化可能不会触发 DOM 变化）
      const interval = setInterval(checkEmpty, 500);

      return () => {
        clearInterval(interval);
      };
    }, [board, isDataReady]);

    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;

    const onBoundImageTargetChangeRef = useRef(onBoundImageTargetChange);
    onBoundImageTargetChangeRef.current = onBoundImageTargetChange;

    const onBoundInputViewportChangeRef = useRef(onBoundInputViewportChange);
    onBoundInputViewportChangeRef.current = onBoundInputViewportChange;

    const onFrameSelectedRef = useRef(onFrameSelected);
    onFrameSelectedRef.current = onFrameSelected;
    const selectionRunIdRef = useRef(0);
    const currentBoardIdRef = useRef(currentBoardId);
    currentBoardIdRef.current = currentBoardId;

    useEffect(() => {
      const handleSelectionChange = async () => {
        const currentBoard = boardRef.current;
        if (!currentBoard) return;
        const selectionBoardId = currentBoardIdRef.current;
        const runId = selectionRunIdRef.current + 1;
        selectionRunIdRef.current = runId;

        const selectedElements = getSelectedElements(currentBoard);
        onBoundInputViewportChangeRef.current?.();
        const boundImageTarget = await resolveBoundImageTarget(
          currentBoard,
          selectedElements
        );
        if (
          runId !== selectionRunIdRef.current ||
          selectionBoardId !== currentBoardIdRef.current
        ) {
          return;
        }
        onBoundImageTargetChangeRef.current?.(boundImageTarget);

        // 检测是否选中了单个 Frame，通知父组件
        if (
          selectedElements.length === 1 &&
          isFrameElement(selectedElements[0])
        ) {
          const frame = selectedElements[0];
          const rect = RectangleClient.getRectangleByPoints(frame.points);
          onFrameSelectedRef.current?.({
            id: frame.id,
            width: rect.width,
            height: rect.height,
          });
        } else {
          onFrameSelectedRef.current?.(null);
        }

        if (selectedElements.length === 0) {
          onSelectionChangeRef.current([]);
          return;
        }

        if (boundImageTarget) {
          onSelectionChangeRef.current([]);
          return;
        }

        try {
          const processedContent = await processSelectedContentForAI(
            currentBoard
          );
          if (
            runId !== selectionRunIdRef.current ||
            selectionBoardId !== currentBoardIdRef.current
          ) {
            return;
          }
          const content: SelectedContent[] = [];

          if (processedContent.graphicsImage) {
            content.push({
              url: processedContent.graphicsImage,
              name: language === 'zh' ? '图形元素' : 'Graphics',
              type: 'graphics',
              // 使用异步获取的图形图片尺寸
              width: processedContent.graphicsImageDimensions?.width,
              height: processedContent.graphicsImageDimensions?.height,
            });
          }

          for (const img of processedContent.remainingImages) {
            const imgUrl = img.url || '';
            const isVideo = isVideoUrl(imgUrl);

            content.push({
              url: imgUrl,
              maskImage: !isVideo ? processedContent.maskImage : undefined,
              name:
                img.name ||
                (isVideo ? `video-${Date.now()}` : `image-${Date.now()}`),
              type: isVideo ? 'video' : 'image',
              width: img.width,
              height: img.height,
            });
          }

          if (
            processedContent.remainingText &&
            processedContent.remainingText.trim()
          ) {
            content.push({
              type: 'text',
              text: processedContent.remainingText.trim(),
              name: language === 'zh' ? '文字内容' : 'Text Content',
            });
          }

          onSelectionChangeRef.current(content);
        } catch (error) {
          if (
            runId !== selectionRunIdRef.current ||
            selectionBoardId !== currentBoardIdRef.current
          ) {
            return;
          }
          console.error('Failed to process selected content:', error);
          onSelectionChangeRef.current([]);
        }
      };

      handleSelectionChange();

      let selectionChangeTimer: ReturnType<typeof setTimeout> | null = null;
      const handleMouseUp = () => {
        selectionRunIdRef.current += 1;
        if (selectionChangeTimer) {
          clearTimeout(selectionChangeTimer);
        }
        selectionChangeTimer = setTimeout(() => {
          selectionChangeTimer = null;
          void handleSelectionChange();
        }, 50);
      };
      let viewportRaf: number | null = null;
      const handleViewportChange = () => {
        if (viewportRaf !== null) return;
        viewportRaf = requestAnimationFrame(() => {
          viewportRaf = null;
          onBoundInputViewportChangeRef.current?.();
          const currentBoard = boardRef.current;
          if (!currentBoard) return;
          const selectionBoardId = currentBoardIdRef.current;
          const runId = selectionRunIdRef.current + 1;
          selectionRunIdRef.current = runId;
          void resolveBoundImageTarget(
            currentBoard,
            getSelectedElements(currentBoard)
          ).then((target) => {
            if (
              runId === selectionRunIdRef.current &&
              selectionBoardId === currentBoardIdRef.current
            ) {
              onBoundImageTargetChangeRef.current?.(target);
            }
          });
        });
      };
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('keyup', handleViewportChange);
      document.addEventListener('pointermove', handleViewportChange);
      document.addEventListener('wheel', handleViewportChange, {
        passive: true,
      });
      window.addEventListener('resize', handleViewportChange);
      window.visualViewport?.addEventListener('resize', handleViewportChange);
      window.visualViewport?.addEventListener('scroll', handleViewportChange);
      document.addEventListener(
        AI_SELECTION_CONTENT_REFRESH_EVENT,
        handleSelectionChange
      );

      return () => {
        document.removeEventListener('mouseup', handleMouseUp);
        if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
        document.removeEventListener('keyup', handleViewportChange);
        document.removeEventListener('pointermove', handleViewportChange);
        document.removeEventListener('wheel', handleViewportChange);
        if (viewportRaf !== null) cancelAnimationFrame(viewportRaf);
        window.removeEventListener('resize', handleViewportChange);
        window.visualViewport?.removeEventListener(
          'resize',
          handleViewportChange
        );
        window.visualViewport?.removeEventListener(
          'scroll',
          handleViewportChange
        );
        document.removeEventListener(
          AI_SELECTION_CONTENT_REFRESH_EVENT,
          handleSelectionChange
        );
      };
    }, [currentBoardId, language]);

    return null; // 这个组件不渲染任何内容
  }
);

SelectionWatcher.displayName = 'SelectionWatcher';

export const AIInputBar: React.FC<AIInputBarProps> = React.memo(
  ({
    className,
    isDataReady,
    currentBoardId,
    onEnableToolWindows,
    onEnableRuntime,
  }) => {
    // console.log('[AIInputBar] Component rendering');

    const { language } = useI18n();
    const imageModels = useSelectableModels('image');
    const videoModels = useSelectableModels('video');
    const audioModels = useSelectableModels('audio');
    const textModels = useSelectableModels('text');

    const chatDrawerControl = useChatDrawerControl();
    const workflowControl = useWorkflowControl();
    const { setActiveSelections: setActiveHealthSelections } =
      useModelHealthContext();
    const {
      addHistory: addPromptHistory,
      history: promptHistory,
      removeHistory: deletePromptHistory,
    } = usePromptHistory();
    const { addAsset } = useAssets();
    const { confirm, confirmDialog } = useConfirmDialog();
    // 使用 ref 存储，避免依赖变化
    const sendWorkflowMessageRef = useRef(
      chatDrawerControl.sendWorkflowMessage
    );
    sendWorkflowMessageRef.current = chatDrawerControl.sendWorkflowMessage;
    const updateWorkflowMessageRef = useRef(
      chatDrawerControl.updateWorkflowMessage
    );
    updateWorkflowMessageRef.current = chatDrawerControl.updateWorkflowMessage;
    const syncWorkflowTaskUpdateRef = useRef(
      chatDrawerControl.syncWorkflowTaskUpdate
    );
    syncWorkflowTaskUpdateRef.current =
      chatDrawerControl.syncWorkflowTaskUpdate;
    const appendAgentLogRef = useRef(chatDrawerControl.appendAgentLog);
    appendAgentLogRef.current = chatDrawerControl.appendAgentLog;
    const updateThinkingContentRef = useRef(
      chatDrawerControl.updateThinkingContent
    );
    updateThinkingContentRef.current = chatDrawerControl.updateThinkingContent;
    const setSelectedContentRef = useRef(chatDrawerControl.setSelectedContent);
    setSelectedContentRef.current = chatDrawerControl.setSelectedContent;
    const registerRetryHandlerRef = useRef(
      chatDrawerControl.registerRetryHandler
    );
    registerRetryHandlerRef.current = chatDrawerControl.registerRetryHandler;
    const registerGenerationSubmitterRef = useRef(
      chatDrawerControl.registerGenerationSubmitter
    );
    registerGenerationSubmitterRef.current =
      chatDrawerControl.registerGenerationSubmitter;

    // 当前工作流的重试上下文（用于在更新时保持 retryContext）
    const currentRetryContextRef = useRef<WorkflowRetryContext | null>(null);

    // 当前图片生成锚点集合（单图时只有一个，多图时对应多个独立对象）
    const currentImageAnchorIdsRef = useRef<string[]>([]);

    // 当前 WorkZone 元素 ID（用于在画布上显示工作流进度）
    const currentWorkZoneIdRef = useRef<string | null>(null);
    const lastBoundImageTargetKeyRef = useRef<string | null>(null);
    const suppressedBoundImageElementIdRef = useRef<string | null>(null);
    const boundTargetDraftsRef = useRef(
      new Map<string, BoundTargetTaskbarDraftEntry<BoundImageInputDraft>>()
    );
    const unboundTaskbarDraftRef = useRef(createBoundImageInputDraft());
    const activeDraftElementIdRef = useRef<string | null>(null);
    const activeDraftBaselineRef = useRef<BoundImageInputDraft | null>(null);
    const activeTaskbarBoardIdRef = useRef(currentBoardId ?? null);
    const lastPrunedBoardChildrenRef = useRef<readonly unknown[] | null>(null);
    const initialPreferences = loadAIInputPreferences();

    const bindCurrentImageAnchorTask = useCallback(
      (
        boardInstance: PlaitBoard | null,
        taskId: string,
        options?: {
          workflowId?: string;
          batchId?: string;
          batchIndex?: number;
        }
      ) => {
        if (!boardInstance) {
          return;
        }

        const currentAnchorIds = currentImageAnchorIdsRef.current;
        const currentAnchor =
          (options?.workflowId &&
          options?.batchId &&
          typeof options.batchIndex === 'number'
            ? ImageGenerationAnchorTransforms.getAnchorByBatchSlot(
                boardInstance,
                {
                  workflowId: options.workflowId,
                  batchId: options.batchId,
                  batchIndex: options.batchIndex,
                }
              )
            : null) ||
          (options?.workflowId
            ? ImageGenerationAnchorTransforms.getAnchorByWorkflowId(
                boardInstance,
                options.workflowId
              )
            : null) ||
          (currentAnchorIds[0]
            ? ImageGenerationAnchorTransforms.getAnchorById(
                boardInstance,
                currentAnchorIds[0]
              )
            : null);
        if (!currentAnchor) {
          return;
        }

        const nextTaskIds = currentAnchor.taskIds.includes(taskId)
          ? currentAnchor.taskIds
          : [...currentAnchor.taskIds, taskId];

        ImageGenerationAnchorTransforms.updateAnchor(
          boardInstance,
          currentAnchor.id,
          {
            taskIds: nextTaskIds,
            primaryTaskId: currentAnchor.primaryTaskId || taskId,
          }
        );
      },
      []
    );

    const applyCurrentImageAnchorPresentationState = useCallback(
      (
        boardInstance: PlaitBoard | null,
        state: ImageGenerationAnchorPresentationState,
        options?: {
          error?: string;
          subtitle?: string;
        }
      ) => {
        const anchorIds = currentImageAnchorIdsRef.current;
        if (anchorIds.length === 0 || !boardInstance) {
          return;
        }

        anchorIds.forEach((anchorId) => {
          ImageGenerationAnchorTransforms.updateAnchor(
            boardInstance,
            anchorId,
            buildImageGenerationAnchorPresentationPatch(state, options)
          );
        });
      },
      []
    );

    const removeCurrentImageAnchor = useCallback(
      (boardInstance: PlaitBoard | null) => {
        const anchorIds = currentImageAnchorIdsRef.current;
        if (anchorIds.length === 0 || !boardInstance) {
          return;
        }

        anchorIds.forEach((anchorId) => {
          ImageGenerationAnchorTransforms.removeAnchor(boardInstance, anchorId);
        });
        currentImageAnchorIdsRef.current = [];
      },
      []
    );

    const resolvePersistedModelSelection = useCallback(
      (
        type: PersistedGenerationType,
        models: ModelConfig[]
      ): ModelConfig | undefined => {
        const persisted = getPersistedModelSelection(type);
        if (!persisted) {
          return undefined;
        }

        const matchedModel = findMatchingSelectableModel(
          models,
          persisted.modelId,
          createModelRef(persisted.profileId, persisted.modelId)
        );

        if (matchedModel) {
          return matchedModel;
        }

        clearPersistedModelSelection(type);
        return undefined;
      },
      []
    );

    const resolvePreferredModelSelection = useCallback(
      (
        type: GenerationType,
        models: ModelConfig[]
      ): ModelConfig | undefined => {
        const persistedModel = resolvePersistedModelSelection(type, models);
        if (persistedModel) {
          return persistedModel;
        }

        const routeType =
          type === 'video'
            ? 'video'
            : type === 'audio'
            ? 'audio'
            : type === 'text' || type === 'agent'
            ? 'text'
            : 'image';
        const route = resolveInvocationRoute(routeType);
        const routeModel = findMatchingSelectableModel(
          models,
          route.modelId,
          createModelRef(route.profileId, route.modelId)
        );
        if (routeModel) {
          return routeModel;
        }

        const fallbackModelId =
          type === 'video'
            ? getDefaultVideoModel()
            : type === 'audio'
            ? getDefaultAudioModel()
            : type === 'text' || type === 'agent'
            ? getDefaultTextModel()
            : getDefaultImageModel();

        return (
          findMatchingSelectableModel(models, fallbackModelId, null) ||
          models[0]
        );
      },
      [resolvePersistedModelSelection]
    );

    const initialGenerationType = initialPreferences.generationType;
    const initialModelsForType =
      initialGenerationType === 'video'
        ? videoModels
        : initialGenerationType === 'audio'
        ? audioModels
        : initialGenerationType === 'text' || initialGenerationType === 'agent'
        ? textModels
        : imageModels;
    const initialSelectedModelConfig =
      resolvePreferredModelSelection(
        initialGenerationType,
        initialModelsForType
      ) ||
      getModelConfig(initialPreferences.selectedModel) ||
      getModelConfig(
        initialGenerationType === 'video'
          ? getDefaultVideoModel()
          : initialGenerationType === 'audio'
          ? getDefaultAudioModel()
          : initialGenerationType === 'text' ||
            initialGenerationType === 'agent'
          ? getDefaultTextModel()
          : getDefaultImageModel()
      );
    const initialImageModel =
      resolvePreferredModelSelection('image', imageModels) ||
      getModelConfig(getDefaultImageModel());
    const initialVideoModel =
      resolvePreferredModelSelection('video', videoModels) ||
      getModelConfig(getDefaultVideoModel());
    const initialAudioModel =
      resolvePreferredModelSelection('audio', audioModels) ||
      getModelConfig(getDefaultAudioModel());
    const initialImageRoute = resolveInvocationRoute('image');
    const initialSelectedModelId =
      initialImageModel?.id ||
      initialImageRoute.modelId ||
      getDefaultImageModel();
    const initialSelectedModelRef =
      getModelRefFromConfig(initialImageModel) ||
      createModelRef(initialImageRoute.profileId, initialImageRoute.modelId);
    const initialSelectedModelKey = getSelectionKey(
      initialSelectedModelConfig?.id || initialSelectedModelId,
      getModelRefFromConfig(initialSelectedModelConfig) ||
        initialSelectedModelRef
    );
    const initialScopedSelectedParams =
      initialGenerationType === 'agent'
        ? {}
        : loadScopedAIInputModelParams(
            initialGenerationType,
            initialSelectedModelConfig?.id || initialSelectedModelId,
            initialSelectedModelKey,
            initialPreferences.selectedParams
          );

    // State
    const [prompt, setPrompt] = useState('');
    const [promptSuggestion, setPromptSuggestion] = useState<string | null>(
      null
    );
    const [isInspirationSendGuideActive, setIsInspirationSendGuideActive] =
      useState(false);
    const [isPromptOptimizeOpen, setIsPromptOptimizeOpen] = useState(false);
    const [selectedContent, setSelectedContent] = useState<SelectedContent[]>(
      []
    ); // 画布选中内容
    const [boundImageTarget, setBoundImageTarget] =
      useState<BoundImageTarget | null>(null);
    const [boundImageTargetMode, setBoundImageTargetMode] =
      useState<BoundImageTargetMode>('follow');
    const boundImageTargetRef = useRef<BoundImageTarget | null>(null);
    const dismissedPromptElementIdRef = useRef<string | null>(null);
    const dismissedPromptGenerationTaskIdRef = useRef<string | null>(null);
    const [boundTargetDismissHintCount, setBoundTargetDismissHintCount] =
      useState(() => readBoundTargetDismissHintCount());
    const [boundTargetFollowEnabled, setBoundTargetFollowEnabled] = useState(
      () => readBoundTargetFollowEnabled()
    );
    const [boundTargetError, setBoundTargetError] = useState<string | null>(
      null
    );
    const [boundInputLayoutTick, setBoundInputLayoutTick] = useState(0);
    const [uploadedContent, setUploadedContent] = useState<SelectedContent[]>(
      []
    ); // 用户上传内容
    const [knowledgeContextRefs, setKnowledgeContextRefs] = useState<
      KnowledgeContextRef[]
    >([]);
    const [isSubmitting, setIsSubmitting] = useState(false); // 防止快速重复点击（3秒防抖）
    const submitLockRef = useRef(false);
    const submitCooldownRef = useRef<NodeJS.Timeout | null>(null); // 提交冷却定时器
    const [isFocused, setIsFocused] = useState(false);
    const [isPromptManuallyExpanded, setIsPromptManuallyExpanded] =
      useState(false);
    const [canPromptManuallyExpand, setCanPromptManuallyExpand] =
      useState(false);
    const [isCanvasEmpty, setIsCanvasEmpty] = useState<boolean | null>(null); // null=加载中, true=空, false=有内容
    // 当前选中的生成类型（图片、视频、Agent）
    const [generationType, setGenerationType] = useState<GenerationType>(
      initialGenerationType
    );
    // 当前选中的 Skill ID（仅在 Agent 模式下有效）
    const [selectedSkillId, setSelectedSkillId] = useState<string>(
      initialPreferences.selectedSkillId || SKILL_AUTO_ID
    );
    // 当前选中的图片/视频/文本模型
    const [selectedModel, setSelectedModel] = useState(
      initialSelectedModelConfig?.id || initialSelectedModelId
    );
    const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
      getModelRefFromConfig(initialSelectedModelConfig) ||
        initialSelectedModelRef
    );
    const [selectedAgentImageModel, setSelectedAgentImageModel] = useState(
      initialImageModel?.id || getDefaultImageModel()
    );
    const [selectedAgentImageModelRef, setSelectedAgentImageModelRef] =
      useState<ModelRef | null>(getModelRefFromConfig(initialImageModel));
    const [selectedAgentVideoModel, setSelectedAgentVideoModel] = useState(
      initialVideoModel?.id || getDefaultVideoModel()
    );
    const [selectedAgentVideoModelRef, setSelectedAgentVideoModelRef] =
      useState<ModelRef | null>(getModelRefFromConfig(initialVideoModel));
    const [selectedAgentAudioModel, setSelectedAgentAudioModel] = useState(
      initialAudioModel?.id || getDefaultAudioModel()
    );
    const [selectedAgentAudioModelRef, setSelectedAgentAudioModelRef] =
      useState<ModelRef | null>(getModelRefFromConfig(initialAudioModel));
    const [selectedSkillMediaTypes, setSelectedSkillMediaTypes] = useState<
      SkillMediaType[]
    >([]);
    const visibleImageModels = useMemo(() => {
      if (generationType !== 'image') {
        return imageModels;
      }

      const currentMatch = findMatchingSelectableModel(
        imageModels,
        selectedModel,
        selectedModelRef
      );
      if (currentMatch) {
        return imageModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'image',
        selectedModel,
        selectedModelRef
      );
      return pinnedModel ? [pinnedModel, ...imageModels] : imageModels;
    }, [generationType, imageModels, selectedModel, selectedModelRef]);
    const visibleVideoModels = useMemo(() => {
      if (generationType !== 'video') {
        return videoModels;
      }

      const currentMatch = findMatchingSelectableModel(
        videoModels,
        selectedModel,
        selectedModelRef
      );
      if (currentMatch) {
        return videoModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'video',
        selectedModel,
        selectedModelRef
      );
      return pinnedModel ? [pinnedModel, ...videoModels] : videoModels;
    }, [generationType, selectedModel, selectedModelRef, videoModels]);
    const visibleAudioModels = useMemo(() => {
      if (generationType !== 'audio') {
        return audioModels;
      }

      const currentMatch = findMatchingSelectableModel(
        audioModels,
        selectedModel,
        selectedModelRef
      );
      if (currentMatch) {
        return audioModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'audio',
        selectedModel,
        selectedModelRef
      );
      return pinnedModel ? [pinnedModel, ...audioModels] : audioModels;
    }, [audioModels, generationType, selectedModel, selectedModelRef]);
    const visibleTextModels = useMemo(() => {
      if (generationType !== 'text' && generationType !== 'agent') {
        return textModels;
      }

      const currentMatch = findMatchingSelectableModel(
        textModels,
        selectedModel,
        selectedModelRef
      );
      if (currentMatch) {
        return textModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'text',
        selectedModel,
        selectedModelRef
      );
      return pinnedModel ? [pinnedModel, ...textModels] : textModels;
    }, [generationType, selectedModel, selectedModelRef, textModels]);
    const visibleAgentImageModels = useMemo(() => {
      const currentMatch = findMatchingSelectableModel(
        imageModels,
        selectedAgentImageModel,
        selectedAgentImageModelRef
      );
      if (currentMatch) {
        return imageModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'image',
        selectedAgentImageModel,
        selectedAgentImageModelRef
      );
      return pinnedModel ? [pinnedModel, ...imageModels] : imageModels;
    }, [imageModels, selectedAgentImageModel, selectedAgentImageModelRef]);
    const visibleAgentVideoModels = useMemo(() => {
      const currentMatch = findMatchingSelectableModel(
        videoModels,
        selectedAgentVideoModel,
        selectedAgentVideoModelRef
      );
      if (currentMatch) {
        return videoModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'video',
        selectedAgentVideoModel,
        selectedAgentVideoModelRef
      );
      return pinnedModel ? [pinnedModel, ...videoModels] : videoModels;
    }, [selectedAgentVideoModel, selectedAgentVideoModelRef, videoModels]);
    const visibleAgentAudioModels = useMemo(() => {
      const currentMatch = findMatchingSelectableModel(
        audioModels,
        selectedAgentAudioModel,
        selectedAgentAudioModelRef
      );
      if (currentMatch) {
        return audioModels;
      }

      const pinnedModel = getPinnedSelectableModel(
        'audio',
        selectedAgentAudioModel,
        selectedAgentAudioModelRef
      );
      return pinnedModel ? [pinnedModel, ...audioModels] : audioModels;
    }, [audioModels, selectedAgentAudioModel, selectedAgentAudioModelRef]);
    // 当前选中的参数映射 (id -> value)
    const [selectedParams, setSelectedParams] = useState<
      Record<string, string>
    >(() => {
      if (initialGenerationType === 'agent') {
        return {};
      }

      const initialModelId =
        initialSelectedModelConfig?.id || initialSelectedModelId;
      const sizeParam = getCompatibleParams(initialModelId).find(
        (param) => param.id === 'size'
      );

      return {
        ...initialScopedSelectedParams,
        ...(initialModelId.startsWith('mj') || !sizeParam
          ? {}
          : {
              size:
                initialScopedSelectedParams.size ||
                getDefaultSizeForModel(initialModelId),
            }),
      };
    });
    const selectedParamsRef = useRef<Record<string, string>>(selectedParams);
    const selectedParamScopeRef = useRef<string>(
      initialGenerationType === 'agent'
        ? 'agent'
        : `${initialGenerationType}:${initialSelectedModelKey}`
    );
    const promptRef = useRef(prompt);
    const promptSuggestionRef = useRef<string | null>(null);
    const selectedContentRef = useRef<SelectedContent[]>(selectedContent);
    const uploadedContentRef = useRef<SelectedContent[]>(uploadedContent);
    const knowledgeContextRefsRef = useRef(knowledgeContextRefs);
    const suppressSelectionContentUrlsRef = useRef<Set<string>>(new Set());
    const readCurrentTaskbarDraft = useCallback((): BoundImageInputDraft => {
      return {
        prompt: promptRef.current,
        uploadedContent: [...uploadedContentRef.current],
        knowledgeContextRefs: [...knowledgeContextRefsRef.current],
      };
    }, []);
    const applyTaskbarDraft = useCallback((draft: BoundImageInputDraft) => {
      promptRef.current = draft.prompt;
      uploadedContentRef.current = draft.uploadedContent;
      knowledgeContextRefsRef.current = draft.knowledgeContextRefs;
      setPrompt(draft.prompt);
      setUploadedContent(draft.uploadedContent);
      setKnowledgeContextRefs(draft.knowledgeContextRefs);
    }, []);
    const saveActiveTaskbarDraft = useCallback(() => {
      const draft = readCurrentTaskbarDraft();
      const elementId = activeDraftElementIdRef.current;
      const baseline = activeDraftBaselineRef.current;
      if (elementId && baseline) {
        storeBoundTargetTaskbarDraft(
          boundTargetDraftsRef.current,
          elementId,
          draft,
          baseline
        );
      } else {
        unboundTaskbarDraftRef.current = draft;
      }
      return draft;
    }, [readCurrentTaskbarDraft]);
    const detachTaskbarDraft = useCallback(
      (copyCurrentToUnbound = false) => {
        const draft = saveActiveTaskbarDraft();
        activeDraftElementIdRef.current = null;
        activeDraftBaselineRef.current = null;
        if (copyCurrentToUnbound) {
          unboundTaskbarDraftRef.current = draft;
          return draft;
        }
        applyTaskbarDraft(unboundTaskbarDraftRef.current);
        return unboundTaskbarDraftRef.current;
      },
      [applyTaskbarDraft, saveActiveTaskbarDraft]
    );
    const pruneBoundTargetTaskbarDrafts = useCallback(() => {
      const board = SelectionWatcherBoardRef.current;
      if (!isDataReady || !board || boundTargetDraftsRef.current.size === 0) {
        return;
      }

      const children = board.children as readonly unknown[];
      if (lastPrunedBoardChildrenRef.current === children) {
        return;
      }
      lastPrunedBoardChildrenRef.current = children;
      pruneStaleBoundTargetTaskbarDrafts(
        boundTargetDraftsRef.current,
        collectBoundTargetElementIds(children)
      );
    }, [isDataReady]);
    const updatePromptSuggestion = useCallback((suggestion: string | null) => {
      promptSuggestionRef.current = suggestion;
      setPromptSuggestion(suggestion);
    }, []);
    const dismissPromptSuggestion = useCallback(() => {
      const target = boundImageTargetRef.current;
      dismissedPromptElementIdRef.current = target?.elementId || null;
      dismissedPromptGenerationTaskIdRef.current =
        target?.generationTaskId || null;
      updatePromptSuggestion(null);
    }, [updatePromptSuggestion]);
    const resetBoundTaskbarDraftsForBoard = useCallback(
      (nextBoardId: string | null) => {
        if (activeTaskbarBoardIdRef.current === nextBoardId) return false;

        if (activeDraftElementIdRef.current === null) {
          unboundTaskbarDraftRef.current = readCurrentTaskbarDraft();
        }
        activeTaskbarBoardIdRef.current = nextBoardId;
        boundTargetDraftsRef.current.clear();
        activeDraftElementIdRef.current = null;
        activeDraftBaselineRef.current = null;
        lastBoundImageTargetKeyRef.current = null;
        suppressedBoundImageElementIdRef.current = null;
        dismissedPromptElementIdRef.current = null;
        dismissedPromptGenerationTaskIdRef.current = null;
        lastPrunedBoardChildrenRef.current = null;
        boundImageTargetRef.current = null;
        selectedContentRef.current = [];
        selectedFrameRef.current = null;
        suppressSelectionContentUrlsRef.current = new Set();
        setBoundImageTarget(null);
        setBoundImageTargetMode('follow');
        setBoundTargetError(null);
        updatePromptSuggestion(null);
        setSelectedContent([]);
        applyTaskbarDraft(unboundTaskbarDraftRef.current);
        return true;
      },
      [applyTaskbarDraft, readCurrentTaskbarDraft, updatePromptSuggestion]
    );
    useEffect(() => {
      resetBoundTaskbarDraftsForBoard(currentBoardId ?? null);
    }, [currentBoardId, resetBoundTaskbarDraftsForBoard]);
    useEffect(() => {
      selectedParamsRef.current = selectedParams;
    }, [selectedParams]);
    useEffect(() => {
      promptRef.current = prompt;
    }, [prompt]);
    useEffect(() => {
      promptSuggestionRef.current = promptSuggestion;
    }, [promptSuggestion]);
    useEffect(() => {
      selectedContentRef.current = selectedContent;
    }, [selectedContent]);
    useEffect(() => {
      boundImageTargetRef.current = boundImageTarget;
    }, [boundImageTarget]);
    useEffect(() => {
      uploadedContentRef.current = uploadedContent;
    }, [uploadedContent]);
    useEffect(() => {
      knowledgeContextRefsRef.current = knowledgeContextRefs;
    }, [knowledgeContextRefs]);
    // 当前选中的生成数量
    const [selectedCount, setSelectedCount] = useState(
      initialPreferences.selectedCount
    );

    // 下拉菜单的打开状态（用于特殊符号触发）
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [paramsDropdownOpen, setParamsDropdownOpen] = useState(false);
    const [countDropdownOpen, setCountDropdownOpen] = useState(false);
    // 记录触发符号的位置，用于选择后清除
    const triggerPositionRef = useRef<number | null>(null);

    // 下拉菜单状态变化处理（关闭时清除触发位置）
    const handleModelDropdownChange = useCallback((open: boolean) => {
      setModelDropdownOpen(open);
      if (!open) triggerPositionRef.current = null;
    }, []);
    const handleParamsDropdownChange = useCallback((open: boolean) => {
      setParamsDropdownOpen(open);
      if (!open) triggerPositionRef.current = null;
    }, []);
    const handleCountDropdownChange = useCallback((open: boolean) => {
      setCountDropdownOpen(open);
      if (!open) triggerPositionRef.current = null;
    }, []);

    // 素材库弹窗状态
    const [showMediaLibrary, setShowMediaLibrary] = useState(false);

    // 合并画布选中内容和用户上传内容
    const allContent = useMemo(() => {
      return [...uploadedContent, ...selectedContent];
    }, [uploadedContent, selectedContent]);
    const boundTargetContent = useMemo(
      () =>
        selectedContentFromBoundTarget(
          boundImageTarget,
          language,
          boundImageTargetMode === 'reference'
        ),
      [boundImageTarget, boundImageTargetMode, language]
    );
    const followedBoundImageTarget =
      boundImageTargetMode === 'follow' ? boundImageTarget : null;
    const displayContent = useMemo(
      () =>
        boundTargetContent
          ? [...uploadedContent, boundTargetContent]
          : allContent,
      [allContent, boundTargetContent, uploadedContent]
    );
    const generationContent = useMemo(
      () =>
        boundTargetContent
          ? [boundTargetContent, ...uploadedContent]
          : allContent,
      [allContent, boundTargetContent, uploadedContent]
    );
    const localImageMessages = useMemo(
      () => ({
        invalidFile:
          language === 'zh' ? '请上传图片文件' : 'Please upload image files',
        fileTooLarge:
          language === 'zh'
            ? '图片大小不能超过 25MB'
            : 'Image size cannot exceed 25MB',
        loadFailed: language === 'zh' ? '加载图片失败' : 'Failed to load image',
        compressionFailed:
          language === 'zh' ? '图片压缩失败' : 'Image compression failed',
        compressing: (sizeMb: number) =>
          language === 'zh'
            ? `正在压缩图片 (${sizeMb.toFixed(1)}MB)...`
            : `Compressing image (${sizeMb.toFixed(1)}MB)...`,
        compressed: (fromMb: number, toMb: number) =>
          language === 'zh'
            ? `压缩完成: ${fromMb.toFixed(1)}MB → ${toMb.toFixed(1)}MB`
            : `Compressed: ${fromMb.toFixed(1)}MB → ${toMb.toFixed(1)}MB`,
      }),
      [language]
    );

    // 监听生成类型变化，自动切换模型和尺寸
    useEffect(() => {
      const modelsForType =
        generationType === 'video'
          ? visibleVideoModels
          : generationType === 'audio'
          ? visibleAudioModels
          : generationType === 'text' || generationType === 'agent'
          ? visibleTextModels
          : visibleImageModels;
      const currentModelConfig = findMatchingSelectableModel(
        modelsForType,
        selectedModel,
        selectedModelRef
      );
      const nextModelConfig =
        currentModelConfig ||
        resolvePreferredModelSelection(generationType, modelsForType);

      if (nextModelConfig) {
        const currentSelectionKey = getSelectionKey(
          selectedModel,
          selectedModelRef
        );
        const nextSelectionKey = getSelectionKeyForModel(nextModelConfig);
        if (currentSelectionKey !== nextSelectionKey) {
          setSelectedModel(nextModelConfig.id);
          setSelectedModelRef(getModelRefFromConfig(nextModelConfig));
        }
      }

      // 切换离开 Agent 模式时重置 Skill 选择
      if (generationType !== 'agent') {
        setSelectedSkillId(SKILL_AUTO_ID);
      }
      // Agent / 文本 / 音频模式默认单结果
      if (
        generationType === 'agent' ||
        generationType === 'text' ||
        generationType === 'audio'
      ) {
        setSelectedCount(1);
      }
    }, [
      visibleAudioModels,
      generationType,
      visibleImageModels,
      resolvePreferredModelSelection,
      selectedModel,
      selectedModelRef,
      visibleTextModels,
      visibleVideoModels,
    ]);

    useEffect(() => {
      const syncAgentMediaModel = (
        type: 'image' | 'video' | 'audio',
        models: ModelConfig[],
        selectedModelId: string,
        selectedRef: ModelRef | null,
        setModelId: (modelId: string) => void,
        setModelRef: (modelRef: ModelRef | null) => void
      ) => {
        const currentModelConfig = findMatchingSelectableModel(
          models,
          selectedModelId,
          selectedRef
        );
        if (currentModelConfig) {
          return;
        }

        const nextModelConfig = resolvePreferredModelSelection(type, models);
        if (nextModelConfig) {
          setModelId(nextModelConfig.id);
          setModelRef(getModelRefFromConfig(nextModelConfig));
        }
      };

      syncAgentMediaModel(
        'image',
        visibleAgentImageModels,
        selectedAgentImageModel,
        selectedAgentImageModelRef,
        setSelectedAgentImageModel,
        setSelectedAgentImageModelRef
      );
      syncAgentMediaModel(
        'video',
        visibleAgentVideoModels,
        selectedAgentVideoModel,
        selectedAgentVideoModelRef,
        setSelectedAgentVideoModel,
        setSelectedAgentVideoModelRef
      );
      syncAgentMediaModel(
        'audio',
        visibleAgentAudioModels,
        selectedAgentAudioModel,
        selectedAgentAudioModelRef,
        setSelectedAgentAudioModel,
        setSelectedAgentAudioModelRef
      );
    }, [
      resolvePreferredModelSelection,
      selectedAgentAudioModel,
      selectedAgentAudioModelRef,
      selectedAgentImageModel,
      selectedAgentImageModelRef,
      selectedAgentVideoModel,
      selectedAgentVideoModelRef,
      visibleAgentAudioModels,
      visibleAgentImageModels,
      visibleAgentVideoModels,
    ]);

    // 根据当前生成类型获取模型列表
    const currentModels = useMemo(() => {
      if (generationType === 'video') return visibleVideoModels;
      if (generationType === 'audio') return visibleAudioModels;
      if (generationType === 'text' || generationType === 'agent')
        return visibleTextModels;
      return visibleImageModels;
    }, [
      visibleAudioModels,
      generationType,
      visibleImageModels,
      visibleTextModels,
      visibleVideoModels,
    ]);

    useEffect(() => {
      let cancelled = false;

      const resolveSelectedSkillMediaTypes = async () => {
        if (generationType !== 'agent' || selectedSkillId === SKILL_AUTO_ID) {
          setSelectedSkillMediaTypes([]);
          return;
        }

        const systemSkill = findSystemSkillById(selectedSkillId);
        if (systemSkill) {
          setSelectedSkillMediaTypes(inferSkillMediaTypes(systemSkill));
          return;
        }

        const registeredExternalSkill = findExternalSkillById(selectedSkillId);
        if (registeredExternalSkill) {
          setSelectedSkillMediaTypes(
            inferSkillMediaTypes(registeredExternalSkill)
          );
          return;
        }

        const externalSkill = await externalSkillService.getSkillById(
          selectedSkillId
        );
        if (cancelled) return;
        if (externalSkill) {
          setSelectedSkillMediaTypes(inferSkillMediaTypes(externalSkill));
          return;
        }

        const userNote = await knowledgeBaseService.getNoteById(
          selectedSkillId
        );
        if (cancelled) return;
        setSelectedSkillMediaTypes(
          userNote
            ? inferSkillMediaTypes({
                id: userNote.id,
                name: userNote.title,
                content: userNote.content,
                outputType: userNote.metadata?.outputType as
                  | SkillOutputType
                  | undefined,
              })
            : []
        );
      };

      resolveSelectedSkillMediaTypes().catch(() => {
        if (!cancelled) {
          setSelectedSkillMediaTypes([]);
        }
      });

      return () => {
        cancelled = true;
      };
    }, [generationType, selectedSkillId]);

    // 预计算当前模型的可用参数，避免子组件内部 stale 计算
    const compatibleParams = useMemo(() => {
      if (generationType === 'agent') return [];
      if (generationType === 'video') {
        return getEffectiveVideoCompatibleParams(
          selectedModel,
          selectedModelRef || selectedModel,
          selectedParams
        );
      }
      const params = getCompatibleParams(selectedModel);
      if (generationType !== 'audio') {
        return params;
      }

      const sunoAction =
        selectedParams.sunoAction ||
        params.find((param) => param.id === 'sunoAction')?.defaultValue ||
        'music';
      if (sunoAction === 'lyrics') {
        // 歌词模式：只保留动作选择和版本，隐藏续写相关参数
        return params.filter(
          (param) =>
            param.id === 'sunoAction' ||
            param.id === 'mv' ||
            param.id === 'title' ||
            param.id === 'tags'
        );
      }

      return params;
    }, [generationType, selectedModel, selectedModelRef, selectedParams]);

    // 点击外部关闭输入框的展开状态
    useEffect(() => {
      if (!isFocused) return;

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        // 检查点击是否在 AIInputBar 容器外部
        if (containerRef.current && !containerRef.current.contains(target)) {
          setIsFocused(false);
        }
      };

      // 使用 mousedown 而不是 click，以便在失焦前处理
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }, [isFocused]);

    // 清理提交冷却定时器
    useEffect(() => {
      return () => {
        if (submitCooldownRef.current) {
          clearTimeout(submitCooldownRef.current);
        }
        submitLockRef.current = false;
      };
    }, []);

    // 监听 AI 生成完成事件（思维导图、流程图等同步操作）
    useEffect(() => {
      const handleGenerationComplete = (event: CustomEvent) => {
        if (event.detail?.type === 'image') {
          return;
        }

        // console.log('[AIInputBar] ai-generation-complete event received:', event.detail);
        // 立即重置提交状态，允许用户继续输入
        if (submitCooldownRef.current) {
          clearTimeout(submitCooldownRef.current);
          submitCooldownRef.current = null;
        }
        submitLockRef.current = false;
        setIsSubmitting(false);
      };

      window.addEventListener(
        'ai-generation-complete',
        handleGenerationComplete as EventListener
      );
      return () => {
        window.removeEventListener(
          'ai-generation-complete',
          handleGenerationComplete as EventListener
        );
      };
    }, []);

    // 监听任务状态变化，同步更新工作流步骤状态
    useEffect(() => {
      const subscription = taskQueueService
        .observeTaskUpdates()
        .subscribe((event) => {
          const task = event.task;
          syncWorkflowTaskUpdateRef.current(task);

          const currentBoundTarget = boundImageTargetRef.current;
          if (
            currentBoundTarget &&
            task.params?.replaceElementId === currentBoundTarget.elementId
          ) {
            if (task.status === TaskStatus.FAILED) {
              setBoundTargetError(
                task.error?.message ||
                  (language === 'zh'
                    ? '生成失败，原内容已保留'
                    : 'Generation failed. Original kept.')
              );
            } else {
              setBoundTargetError(null);
              if (task.status === TaskStatus.COMPLETED) {
                const nextTargetPrompt =
                  task.params.prompt || currentBoundTarget.prompt;
                if (
                  shouldReleaseBoundTargetPromptDismissal(
                    currentBoundTarget.elementId,
                    task.id,
                    dismissedPromptElementIdRef.current,
                    dismissedPromptGenerationTaskIdRef.current
                  )
                ) {
                  dismissedPromptElementIdRef.current = null;
                  dismissedPromptGenerationTaskIdRef.current = null;
                }
                setBoundImageTarget((current) =>
                  current?.elementId === currentBoundTarget.elementId
                    ? {
                        ...current,
                        prompt: task.params.prompt || current.prompt,
                        generationTaskId: task.id,
                        generationAnchorId:
                          typeof task.params.anchorId === 'string'
                            ? task.params.anchorId
                            : current.generationAnchorId,
                        url:
                          task.result?.url ||
                          task.result?.urls?.[0] ||
                          current.url,
                      }
                    : current
                );
                if (
                  activeDraftElementIdRef.current ===
                    currentBoundTarget.elementId &&
                  promptRef.current.length === 0
                ) {
                  updatePromptSuggestion(
                    resolveBoundTargetPromptSuggestion(
                      nextTargetPrompt,
                      currentBoundTarget.elementId,
                      dismissedPromptElementIdRef.current
                    )
                  );
                }
              }
            }
          }

          const workflow = workflowControl.getWorkflow();

          if (!workflow) return;

          // 查找与此任务关联的步骤。图片锚点链路里，任务完成事件可能先于
          // taskId 写入步骤抵达，所以除 result.taskId 外还按 workflowId/batchIndex 兜底。
          const step = findWorkflowStepForTask(workflow, task);

          if (!step) return;

          // 根据任务状态更新步骤状态
          let newStatus:
            | 'pending'
            | 'running'
            | 'completed'
            | 'failed'
            | 'skipped' = step.status;
          let stepResult = step.result;
          let stepError = step.error;

          switch (task.status) {
            case TaskStatus.PENDING:
            case TaskStatus.PROCESSING:
              workflowControl.resumeWorkflow();
              newStatus = 'running';
              stepResult = ensureTaskIdInStepResult(stepResult, task.id);
              stepError = undefined;
              break;
            case TaskStatus.COMPLETED:
              newStatus = 'completed';
              // 添加任务结果信息
              stepResult = {
                ...(stepResult && typeof stepResult === 'object'
                  ? stepResult
                  : {}),
                taskId: task.id,
                result: task.result,
              };
              stepError = undefined;
              break;
            case TaskStatus.FAILED:
              newStatus = 'failed';
              stepResult = ensureTaskIdInStepResult(stepResult, task.id);
              stepError = task.error?.message || '任务执行失败';
              break;
            case TaskStatus.CANCELLED:
              newStatus = 'skipped';
              break;
          }

          // 只有状态变化时才更新
          const nextTaskId = extractTaskIdFromStepResult(stepResult);
          const previousTaskId = extractTaskIdFromStepResult(step.result);
          const shouldForceImageCompletionSync =
            workflow.generationType === 'image' &&
            task.status === TaskStatus.COMPLETED;
          if (
            newStatus !== step.status ||
            nextTaskId !== previousTaskId ||
            stepError !== step.error ||
            shouldForceImageCompletionSync
          ) {
            workflowControl.updateStep(
              step.id,
              newStatus,
              stepResult,
              stepError
            );

            // 如果步骤失败，将同批次中其他 running 状态的步骤标记为 skipped
            if (newStatus === 'failed') {
              const stepBatchId = step.options?.batchId;
              if (stepBatchId) {
                workflow.steps.forEach((s) => {
                  if (
                    s.id !== step.id &&
                    s.options?.batchId === stepBatchId &&
                    s.status === 'running'
                  ) {
                    workflowControl.updateStep(
                      s.id,
                      'skipped',
                      undefined,
                      '前置任务失败'
                    );
                  }
                });
              }
            }

            // 同步更新 ChatDrawer 中的工作流消息
            const updatedWorkflow = workflowControl.getWorkflow();
            if (updatedWorkflow) {
              const shouldMarkImageWorkflowCompleted =
                updatedWorkflow.generationType === 'image' &&
                areAllWorkflowStepsCompleted(updatedWorkflow);
              if (shouldMarkImageWorkflowCompleted) {
                postProcessingStatusRef.current = 'completed';
              }
              const workflowData = toWorkflowMessageData(
                updatedWorkflow,
                currentRetryContextRef.current || undefined,
                shouldMarkImageWorkflowCompleted
                  ? 'completed'
                  : postProcessingStatusRef.current,
                insertedCountRef.current
              );
              updateWorkflowMessageRef.current(workflowData);

              // 同步更新 WorkZone（如果存在）
              const workZoneId = currentWorkZoneIdRef.current;
              const board = SelectionWatcherBoardRef.current;
              if (workZoneId && board) {
                WorkZoneTransforms.updateWorkflow(
                  board,
                  workZoneId,
                  workflowData
                );
              }
            }
          }
        });

      return () => subscription.unsubscribe();
    }, [language, updatePromptSuggestion, workflowControl]);

    // 当前后处理状态 ref
    const postProcessingStatusRef = useRef<PostProcessingStatus | undefined>(
      undefined
    );
    const insertedCountRef = useRef<number | undefined>(undefined);

    // 监听后处理完成事件（图片拆分、插入画布等）
    useEffect(() => {
      const subscription = workflowCompletionService
        .observeCompletionEvents()
        .subscribe((event) => {
          const workflow = workflowControl.getWorkflow();

          // 查找与此任务关联的步骤（即使 workflow 为 null 也继续处理 postProcessingCompleted）
          const eventTask = taskQueueService.getTask(event.taskId);
          const step = eventTask
            ? findWorkflowStepForTask(workflow, eventTask)
            : findWorkflowStepByTaskId(workflow, event.taskId);

          // 更新后处理状态
          let newPostProcessingStatus: PostProcessingStatus | undefined;
          let newInsertedCount: number | undefined;

          switch (event.type) {
            case 'postProcessingStarted':
              newPostProcessingStatus = 'processing';
              break;
            case 'postProcessingCompleted':
              newPostProcessingStatus = 'completed';
              newInsertedCount = event.result.insertedCount;
              break;
            case 'postProcessingFailed':
              newPostProcessingStatus = 'failed';
              if (
                eventTask?.params?.replaceElementId ===
                boundImageTargetRef.current?.elementId
              ) {
                setBoundTargetError(
                  event.result.error ||
                    (language === 'zh'
                      ? '目标内容已不存在，未插入新内容'
                      : 'Target is unavailable. No new content inserted.')
                );
              }
              break;
          }

          // 保存状态到 ref
          postProcessingStatusRef.current = newPostProcessingStatus;
          if (newInsertedCount !== undefined) {
            insertedCountRef.current =
              (insertedCountRef.current || 0) + newInsertedCount;
          }

          // 同步更新 ChatDrawer 中的工作流消息（仅当 workflow 和 step 都存在时）
          if (workflow && step) {
            const stepTaskId = extractTaskIdFromStepResult(step.result);
            if (!stepTaskId && eventTask) {
              workflowControl.updateStep(
                step.id,
                step.status,
                ensureTaskIdInStepResult(step.result, event.taskId),
                step.error,
                step.duration
              );
            }

            if (
              event.type === 'postProcessingCompleted' &&
              step.status !== 'completed' &&
              eventTask?.status === TaskStatus.COMPLETED
            ) {
              workflowControl.updateStep(
                step.id,
                'completed',
                {
                  ...ensureTaskIdInStepResult(step.result, event.taskId),
                  result: eventTask.result,
                },
                undefined,
                step.duration
              );
            }

            const updatedWorkflow = workflowControl.getWorkflow();
            if (updatedWorkflow) {
              const shouldKeepImageWorkflowCompleted =
                updatedWorkflow.generationType === 'image' &&
                areAllWorkflowStepsCompleted(updatedWorkflow);
              const workflowPostProcessingStatus =
                shouldKeepImageWorkflowCompleted
                  ? 'completed'
                  : newPostProcessingStatus;
              if (workflowPostProcessingStatus === 'completed') {
                postProcessingStatusRef.current = 'completed';
              }
              const workflowData = toWorkflowMessageData(
                updatedWorkflow,
                currentRetryContextRef.current || undefined,
                workflowPostProcessingStatus,
                insertedCountRef.current
              );
              updateWorkflowMessageRef.current(workflowData);

              // 同步更新 WorkZone（如果存在）
              const workZoneId = currentWorkZoneIdRef.current;
              const board = SelectionWatcherBoardRef.current;
              if (workZoneId && board) {
                WorkZoneTransforms.updateWorkflow(
                  board,
                  workZoneId,
                  workflowData
                );
              }
            }
          }

          // 如果后处理完成，执行后续操作
          // 注意：即使找不到 workflow 或 step，也要删除 WorkZone（通过 currentWorkZoneIdRef）
          if (event.type === 'postProcessingCompleted') {
            const position = event.result.firstElementPosition;

            // 立即重置提交状态，允许用户继续输入
            // console.log('[AIInputBar] postProcessingCompleted: resetting isSubmitting');
            if (submitCooldownRef.current) {
              clearTimeout(submitCooldownRef.current);
              submitCooldownRef.current = null;
            }
            submitLockRef.current = false;
            setIsSubmitting(false);

            // 关闭 ChatDrawer（如果是由 AIInputBar 触发的对话）
            // 注意：这里使用 setTimeout 确保消息更新后再关闭
            setTimeout(async () => {
              chatDrawerControl.closeChatDrawer();

              // 删除 WorkZone（因为图片已经插入画布）
              const workZoneId = currentWorkZoneIdRef.current;
              const board = SelectionWatcherBoardRef.current;
              if (workZoneId && board) {
                // 只有当所有步骤都完成后才删除
                const workflow = workflowControl.getWorkflow();
                const allStepsFinished = workflow?.steps.every(
                  (s) =>
                    s.status === 'completed' ||
                    s.status === 'failed' ||
                    s.status === 'skipped'
                );

                if (allStepsFinished) {
                  const { workflowCompletionService } = await import(
                    '../../services/workflow-completion-service'
                  );
                  const allPostProcessingFinished = workflow?.steps.every(
                    (step) => {
                      const stepResult = step.result as
                        | { taskId?: string }
                        | undefined;
                      if (stepResult?.taskId) {
                        return workflowCompletionService.isPostProcessingCompleted(
                          stepResult.taskId
                        );
                      }
                      return true;
                    }
                  );

                  if (allPostProcessingFinished) {
                    WorkZoneTransforms.removeWorkZone(board, workZoneId);
                    currentWorkZoneIdRef.current = null;
                    // console.log('[AIInputBar] Removed WorkZone after completion:', workZoneId);
                  }
                }
              }

              // 滚动画布到插入元素的位置
              if (position) {
                if (board) {
                  // 计算新的视口原点，使元素位于视口中心
                  const containerRect = board.host?.getBoundingClientRect();
                  if (containerRect) {
                    const zoom = board.viewport.zoom;
                    const newOriginationX =
                      position[0] - containerRect.width / (2 * zoom);
                    const newOriginationY =
                      position[1] - containerRect.height / (2 * zoom);
                    BoardTransforms.updateViewport(
                      board,
                      [newOriginationX, newOriginationY],
                      zoom
                    );
                  }
                }
              }
            }, 500);

            // 重置状态
            postProcessingStatusRef.current = undefined;
            insertedCountRef.current = undefined;
          }
        });

      return () => subscription.unsubscribe();
    }, [workflowControl, chatDrawerControl, language]);

    // 保存 board 引用供后处理完成后使用
    const SelectionWatcherBoardRef = useRef<any>(null);

    // 使用工作流提交 Hook
    const { submitWorkflow: submitWorkflowToSW } = useWorkflowSubmission({
      boardRef: SelectionWatcherBoardRef,
      workZoneIdRef: currentWorkZoneIdRef,
    });

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 使用自定义 hook 处理文本选择和复制，同时阻止事件冒泡
    useTextSelection(inputRef, {
      enableCopy: true,
      stopPropagation: true,
    });

    const focusInput = useCallback(() => {
      setIsFocused(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }, []);

    const confirmOverwriteInputIfNeeded = useCallback(
      async (source?: AIInputPrefillEventDetail['source']) => {
        const hasPrompt = promptRef.current.trim().length > 0;
        const hasUploadedContent = uploadedContentRef.current.length > 0;
        const hasSelectedContent = selectedContentRef.current.length > 0;
        const hasKnowledgeContext = knowledgeContextRefs.length > 0;
        const shouldConfirm =
          source === 'canvas-toolbar'
            ? hasPrompt || hasUploadedContent || hasKnowledgeContext
            : hasPrompt ||
              hasUploadedContent ||
              hasSelectedContent ||
              hasKnowledgeContext;

        if (!shouldConfirm) {
          return true;
        }

        return confirm({
          title:
            language === 'zh' ? '覆盖当前输入？' : 'Overwrite current input?',
          description:
            language === 'zh'
              ? '底部输入框已有提示词或参考图，继续会覆盖当前输入。'
              : 'The bottom input already has a prompt or reference images. Continuing will overwrite it.',
          confirmText: language === 'zh' ? '覆盖当前输入' : 'Overwrite input',
          cancelText: language === 'zh' ? '取消' : 'Cancel',
          confirmTheme: 'warning',
        });
      },
      [confirm, knowledgeContextRefs.length, language]
    );

    useEffect(() => {
      const handleAIInputFocus = (
        event: Event | CustomEvent<AIInputFocusEventDetail>
      ) => {
        const detail = (event as CustomEvent<AIInputFocusEventDetail>).detail;

        if (detail?.generationType) {
          setGenerationType(detail.generationType);
        }
        if (detail?.skillId) {
          setSelectedSkillId(detail.skillId);
          const systemSkill = findSystemSkillById(detail.skillId);
          if (systemSkill) {
            setSelectedSkillMediaTypes(inferSkillMediaTypes(systemSkill));
          }
        }

        focusInput();
      };

      window.addEventListener(AI_INPUT_FOCUS_EVENT, handleAIInputFocus);
      return () => {
        window.removeEventListener(AI_INPUT_FOCUS_EVENT, handleAIInputFocus);
      };
    }, [focusInput]);

    useEffect(() => {
      const handleAIInputPrefill = async (
        event: Event | CustomEvent<AIInputPrefillEventDetail>
      ) => {
        const detail = (event as CustomEvent<AIInputPrefillEventDetail>).detail;
        if (!detail || !(await confirmOverwriteInputIfNeeded(detail.source))) {
          return;
        }

        const nextGenerationType = detail.generationType;
        const modelsForType =
          nextGenerationType === 'video'
            ? videoModels
            : nextGenerationType === 'audio'
            ? audioModels
            : nextGenerationType === 'text' || nextGenerationType === 'agent'
            ? textModels
            : imageModels;
        const nextModel =
          findMatchingSelectableModel(
            modelsForType,
            detail.model,
            detail.modelRef || null
          ) ||
          findMatchingSelectableModel(modelsForType, detail.model, null) ||
          resolvePreferredModelSelection(nextGenerationType, modelsForType);
        const nextModelRef = getModelRefFromConfig(nextModel);
        const nextModelId = nextModel?.id || detail.model || selectedModel;
        const nextScopeKey = getSelectionKey(nextModelId, nextModelRef);
        const nextParams =
          nextGenerationType === 'agent'
            ? {}
            : {
                ...loadScopedAIInputModelParams(
                  nextGenerationType,
                  nextModelId,
                  nextScopeKey
                ),
                ...(detail.params || {}),
              };

        if (detail.source === 'canvas-toolbar') {
          const suppressedUrls = selectedContentRef.current
            .filter(
              (content): content is SelectedContent & { url: string } =>
                content.type === 'image' && typeof content.url === 'string'
            )
            .map((content) => normalizeAIInputImageUrl(content.url));
          suppressSelectionContentUrlsRef.current = new Set(suppressedUrls);
          setSelectedContent((prev) =>
            prev.filter((item) => {
              if (item.type !== 'image' || typeof item.url !== 'string') {
                return true;
              }
              return !suppressSelectionContentUrlsRef.current.has(
                normalizeAIInputImageUrl(item.url)
              );
            })
          );
        } else {
          suppressSelectionContentUrlsRef.current = new Set();
          setSelectedContent([]);
          selectedFrameRef.current = null;
        }

        const nextPrompt = detail.prompt || '';
        const nextUploadedContent: SelectedContent[] = (
          detail.images || []
        ).map((image, index) => ({
          type: 'image',
          url: image.url,
          name: image.name || `参考图 ${index + 1}`,
          width: image.width,
          height: image.height,
          maskImage: image.maskImage,
        }));
        const nextKnowledgeContextRefs = normalizeKnowledgeContextRefs(
          detail.knowledgeContextRefs
        );
        dismissPromptSuggestion();
        promptRef.current = nextPrompt;
        uploadedContentRef.current = nextUploadedContent;
        knowledgeContextRefsRef.current = nextKnowledgeContextRefs;
        setGenerationType(nextGenerationType);
        setPrompt(nextPrompt);
        setUploadedContent(nextUploadedContent);
        setSelectedModel(nextModelId);
        setSelectedModelRef(nextModelRef);
        setKnowledgeContextRefs(nextKnowledgeContextRefs);
        setSelectedParams(nextParams);
        selectedParamsRef.current = nextParams;
        selectedParamScopeRef.current =
          nextGenerationType === 'agent'
            ? 'agent'
            : `${nextGenerationType}:${nextScopeKey}`;
        if (typeof detail.count === 'number' && detail.count > 0) {
          setSelectedCount(detail.count);
        }
        MessagePlugin.success(
          language === 'zh'
            ? '已回填到底部输入框，请手动发送'
            : 'Loaded into the bottom input. Send manually when ready.'
        );
        focusInput();
      };

      window.addEventListener(AI_INPUT_PREFILL_EVENT, handleAIInputPrefill);
      return () => {
        window.removeEventListener(
          AI_INPUT_PREFILL_EVENT,
          handleAIInputPrefill
        );
      };
    }, [
      audioModels,
      confirmOverwriteInputIfNeeded,
      dismissPromptSuggestion,
      focusInput,
      imageModels,
      language,
      resolvePreferredModelSelection,
      selectedModel,
      textModels,
      videoModels,
    ]);

    // 处理灵感模版选择：将提示词替换到输入框并切换到 Agent 模式
    const handleSelectInspirationPrompt = useCallback(
      (info: {
        prompt: string;
        modelType: 'agent';
        skillId?: string;
        templateId?: string;
        title?: string;
        category?: string;
      }) => {
        dismissPromptSuggestion();
        promptRef.current = info.prompt;
        setPrompt(info.prompt);
        setIsInspirationSendGuideActive(true);
        setGenerationType('agent');
        if (info.skillId) {
          setSelectedSkillId(info.skillId);
          const systemSkill = findSystemSkillById(info.skillId);
          if (systemSkill) {
            setSelectedSkillMediaTypes(inferSkillMediaTypes(systemSkill));
          }
        }
        inputRef.current?.focus();

        // 埋点：灵感模板选择（用于追踪转化率）
        analytics.track('inspiration_selected', {
          promptLength: info.prompt.length,
          modelType: info.modelType,
          skillId: info.skillId,
          templateId: info.templateId,
          title: info.title,
          category: info.category,
        });
      },
      [dismissPromptSuggestion]
    );

    // 处理历史提示词选择：将提示词回填到输入框并切换生成类型
    const handleSelectHistoryPrompt = useCallback(
      (info: { content: string; modelType?: PromptType }) => {
        dismissPromptSuggestion();
        promptRef.current = info.content;
        setPrompt(info.content);
        setIsInspirationSendGuideActive(false);

        // 根据 modelType 自动切换生成类型
        if (info.modelType) {
          if (info.modelType === 'image') {
            setGenerationType('image');
          } else if (info.modelType === 'video') {
            setGenerationType('video');
          } else if (info.modelType === 'audio') {
            setGenerationType('audio');
          } else if (info.modelType === 'text') {
            setGenerationType('text');
          } else if (info.modelType === 'agent') {
            setGenerationType('agent');
          }
        }

        inputRef.current?.focus();
      },
      [dismissPromptSuggestion]
    );

    // 处理添加 Skill：打开知识库并定位到 Skill 目录，自动新建笔记
    const handleAddSkill = useCallback(async () => {
      const [{ toolRegistry }, { toolWindowService }] = await Promise.all([
        import('../../tools/registry'),
        import('../../services/tool-window-service'),
      ]);
      const tool = toolRegistry.getManifestById('knowledge-base');
      if (!tool) return;

      // 先存储待处理的导航意图（防止组件还未挂载时事件丢失）
      (window as any).__kbPendingNavigation = {
        directoryName: 'Skill',
        autoCreateNote: true,
      };

      toolWindowService.openTool(tool);

      // 同时尝试直接发送事件（如果组件已挂载则立即响应）
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('kb:navigate', {
            detail: { directoryName: 'Skill', autoCreateNote: true },
          })
        );
      }, 300);
    }, []);

    // 处理打开提示词工具（香蕉提示词）- 通过 WinBox 弹窗方式打开
    const handleOpenPromptTool = useCallback(
      async (source = 'ai_input_bar') => {
        const [{ toolRegistry }, { toolWindowService }] = await Promise.all([
          import('../../tools/registry'),
          import('../../services/tool-window-service'),
        ]);
        // 从内置工具列表中获取香蕉提示词工具配置
        const tool = toolRegistry.getManifestById('banana-prompt');
        if (!tool) {
          console.warn('[AIInputBar] Banana prompt tool not found');
          analytics.trackPromptAction({
            action: 'open_tool',
            surface: source,
            promptType: toPromptAnalyticsType(generationType),
            prompt,
            source,
            status: 'failed',
            metadata: {
              tool_id: 'banana-prompt',
              reason: 'tool_not_found',
            },
          });
          return;
        }

        analytics.trackPromptAction({
          action: 'open_tool',
          surface: source,
          promptType: toPromptAnalyticsType(generationType),
          prompt,
          source,
          status: 'success',
          metadata: {
            tool_id: tool.id,
            tool_type: 'external_prompt_library',
          },
        });

        // 通过 toolWindowService 打开 WinBox 弹窗
        toolWindowService.openTool(tool);
      },
      [generationType, prompt]
    );

    const handleOpenPromptToolFromInspiration = useCallback(() => {
      handleOpenPromptTool('inspiration_board');
    }, [handleOpenPromptTool]);

    const assetToSelectedContent = useCallback(
      (asset: Asset): Promise<SelectedContent> =>
        new Promise((resolve) => {
          try {
            const img = new Image();
            img.onload = () => {
              resolve({
                type: 'image',
                url: asset.url,
                name: asset.name || `素材-${Date.now()}`,
                width: img.naturalWidth || undefined,
                height: img.naturalHeight || undefined,
              });
            };
            img.onerror = () => {
              resolve({
                type: 'image',
                url: asset.url,
                name: asset.name || `素材-${Date.now()}`,
              });
            };
            img.src = asset.url;
          } catch {
            resolve({
              type: 'image',
              url: asset.url,
              name: asset.name || `素材-${Date.now()}`,
            });
          }
        }),
      []
    );

    // 处理素材库选择
    const handleMediaLibrarySelect = useCallback(
      async (asset: Asset) => {
        try {
          const newContent = await assetToSelectedContent(asset);
          const nextUploadedContent = [
            ...uploadedContentRef.current,
            newContent,
          ];
          uploadedContentRef.current = nextUploadedContent;
          setUploadedContent(nextUploadedContent);
          setShowMediaLibrary(false);
        } catch (error) {
          console.error('Failed to select asset from library:', error);
          setShowMediaLibrary(false);
        }
      },
      [assetToSelectedContent]
    );

    const handleMediaLibrarySelectMultiple = useCallback(
      async (assets: Asset[]) => {
        if (assets.length === 0) return;

        try {
          const newContents = await Promise.all(
            assets.map(assetToSelectedContent)
          );
          const nextUploadedContent = [
            ...uploadedContentRef.current,
            ...newContents,
          ];
          uploadedContentRef.current = nextUploadedContent;
          setUploadedContent(nextUploadedContent);
          setShowMediaLibrary(false);
        } catch (error) {
          console.error('Failed to batch select assets from library:', error);
          setShowMediaLibrary(false);
        }
      },
      [assetToSelectedContent]
    );

    const handleKnowledgeContextChange = useCallback(
      (refs: KnowledgeContextRef[]) => {
        const nextRefs = normalizeKnowledgeContextRefs(refs);
        knowledgeContextRefsRef.current = nextRefs;
        setKnowledgeContextRefs(nextRefs);
      },
      []
    );

    // 处理上传按钮点击
    const handleUploadClick = useCallback(() => {
      fileInputRef.current?.click();
    }, []);

    // 将文件转换为 base64 data URL 并获取尺寸
    const fileToBase64WithDimensions = useCallback(
      (file: Blob): Promise<{ url: string; width: number; height: number }> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64Url = reader.result as string;
            // 创建 Image 对象获取尺寸
            const img = new Image();
            img.onload = () => {
              resolve({
                url: base64Url,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            };
            img.onerror = () => {
              // 即使获取尺寸失败，也返回 URL（尺寸为 0）
              resolve({ url: base64Url, width: 0, height: 0 });
            };
            img.src = base64Url;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      },
      []
    );

    const importLocalImages = useCallback(
      async (files: File[] | FileList) => {
        const fileList = Array.from(files);
        if (fileList.length === 0) return;

        const newContent: SelectedContent[] = [];

        for (const [index, file] of fileList.entries()) {
          if (!file.type.startsWith('image/')) {
            MessagePlugin.error(localImageMessages.invalidFile);
            continue;
          }

          if (file.size > 25 * 1024 * 1024) {
            MessagePlugin.error(localImageMessages.fileTooLarge);
            continue;
          }

          try {
            let processedBlob: Blob = file;

            if (file.size > 10 * 1024 * 1024) {
              const { compressImageBlob, getCompressionStrategy } =
                await import('@aitu/utils');
              const strategy = getCompressionStrategy(
                file.size / (1024 * 1024)
              );
              const messageId = MessagePlugin.loading({
                content: localImageMessages.compressing(
                  file.size / (1024 * 1024)
                ),
                duration: 0,
                placement: 'top',
              });

              try {
                processedBlob = await compressImageBlob(
                  file,
                  strategy.targetSizeMB
                );
                MessagePlugin.close(messageId);
                MessagePlugin.success({
                  content: localImageMessages.compressed(
                    file.size / (1024 * 1024),
                    processedBlob.size / (1024 * 1024)
                  ),
                  duration: 2,
                });
              } catch (compressionError) {
                MessagePlugin.close(messageId);
                console.error(
                  '[AIInputBar] Failed to compress image:',
                  compressionError
                );
                MessagePlugin.error(localImageMessages.compressionFailed);
                continue;
              }
            }

            const normalizedFile =
              processedBlob instanceof File
                ? processedBlob
                : new File(
                    [processedBlob],
                    file.name || `pasted-image-${Date.now()}.png`,
                    {
                      type: processedBlob.type || file.type || 'image/png',
                    }
                  );

            addAsset(
              normalizedFile,
              AssetType.IMAGE,
              AssetSource.LOCAL,
              normalizedFile.name
            ).catch((err) => {
              console.warn('[AIInputBar] Failed to add asset to library:', err);
            });

            const { url, width, height } = await fileToBase64WithDimensions(
              normalizedFile
            );
            newContent.push({
              type: 'image',
              url,
              name: normalizedFile.name || `上传图片 ${index + 1}`,
              width: width || undefined,
              height: height || undefined,
            });
          } catch (error) {
            console.error('[AIInputBar] Failed to import local image:', error);
            MessagePlugin.error(localImageMessages.loadFailed);
          }
        }

        if (newContent.length > 0) {
          const nextUploadedContent = [
            ...uploadedContentRef.current,
            ...newContent,
          ];
          uploadedContentRef.current = nextUploadedContent;
          setUploadedContent(nextUploadedContent);
        }
      },
      [addAsset, fileToBase64WithDimensions, localImageMessages]
    );

    // 处理文件选择
    const handleFileChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        await importLocalImages(files);

        // 重置 input 以便可以再次选择相同文件
        e.target.value = '';
      },
      [importLocalImages]
    );

    // 处理选择变化的回调（由 SelectionWatcher 调用）
    const handleSelectionChange = useCallback((content: SelectedContent[]) => {
      const suppressedUrls = suppressSelectionContentUrlsRef.current;
      if (suppressedUrls.size === 0) {
        setSelectedContent(content);
        return;
      }

      const containsSuppressedSelection = content.some((item) => {
        if (item.type !== 'image' || typeof item.url !== 'string') {
          return false;
        }
        return suppressedUrls.has(normalizeAIInputImageUrl(item.url));
      });

      if (!containsSuppressedSelection) {
        suppressSelectionContentUrlsRef.current = new Set();
        setSelectedContent(content);
        return;
      }

      setSelectedContent(
        content.filter((item) => {
          if (item.type !== 'image' || typeof item.url !== 'string') {
            return true;
          }
          return !suppressedUrls.has(normalizeAIInputImageUrl(item.url));
        })
      );
    }, []);

    // 当选中单个 Frame 时，自动切换 size 参数为最接近 Frame 比例的选项
    // 同时保存 Frame 信息供生成时使用（插入到 Frame 内部并缩放）
    const selectedFrameRef = useRef<{
      id: string;
      width: number;
      height: number;
    } | null>(null);

    const handleFrameSelected = useCallback(
      (frameInfo: { id: string; width: number; height: number } | null) => {
        selectedFrameRef.current = frameInfo;
        if (!frameInfo) return;
        const matchedSize = matchFrameSizeForModel(
          frameInfo.width,
          frameInfo.height,
          selectedModel
        );
        if (matchedSize) {
          setSelectedParams((prev) => ({ ...prev, size: matchedSize }));
        }
      },
      [selectedModel]
    );

    const handleBoundImageTargetChange = useCallback(
      (target: BoundImageTarget | null) => {
        resetBoundTaskbarDraftsForBoard(currentBoardId ?? null);
        const targetSupportsFollowControls = Boolean(
          target && supportsBoundTargetFollowControls(target.type)
        );
        const suppression = resolveBoundTargetSuppression(
          targetSupportsFollowControls ? target?.elementId || null : null,
          suppressedBoundImageElementIdRef.current
        );
        suppressedBoundImageElementIdRef.current =
          suppression.nextSuppressedElementId;
        if (
          target &&
          targetSupportsFollowControls &&
          (suppression.suppressTarget || target.referenceOnly)
        ) {
          const referenceTarget =
            suppression.suppressTarget &&
            boundImageTargetRef.current?.elementId === target.elementId &&
            boundImageTargetRef.current.referenceOnly
              ? { ...target, referenceOnly: true }
              : target;
          const targetKey = createBoundImageTargetStateKey(
            referenceTarget,
            'reference'
          );
          if (
            lastBoundImageTargetKeyRef.current === targetKey &&
            boundImageTargetRef.current?.text === referenceTarget.text
          ) {
            return;
          }
          lastBoundImageTargetKeyRef.current = targetKey;
          if (activeDraftElementIdRef.current) {
            detachTaskbarDraft();
          } else {
            saveActiveTaskbarDraft();
          }
          boundImageTargetRef.current = referenceTarget;
          setBoundImageTarget(referenceTarget);
          setBoundImageTargetMode('reference');
          setBoundTargetError(null);
          updatePromptSuggestion(null);
          setSelectedContent([]);
          selectedFrameRef.current = null;
          suppressSelectionContentUrlsRef.current = new Set();
          setBoundInputLayoutTick((tick) => tick + 1);
          return;
        }

        boundImageTargetRef.current = target;
        setBoundImageTarget(target);
        setBoundImageTargetMode('follow');
        setBoundInputLayoutTick((tick) => tick + 1);
        if (!target) {
          if (activeDraftElementIdRef.current) {
            detachTaskbarDraft();
          } else {
            saveActiveTaskbarDraft();
          }
          pruneBoundTargetTaskbarDrafts();
          lastBoundImageTargetKeyRef.current = null;
          setBoundTargetError(null);
          dismissedPromptElementIdRef.current = null;
          dismissedPromptGenerationTaskIdRef.current = null;
          updatePromptSuggestion(null);
          return;
        }

        const targetKey = createBoundImageTargetStateKey(target, 'follow');
        if (
          lastBoundImageTargetKeyRef.current === targetKey &&
          boundImageTargetRef.current?.text === target.text
        ) {
          return;
        }

        lastBoundImageTargetKeyRef.current = targetKey;
        setBoundTargetError(null);
        setGenerationType(target.type);
        if (activeDraftElementIdRef.current !== target.elementId) {
          saveActiveTaskbarDraft();
          dismissedPromptElementIdRef.current = null;
          dismissedPromptGenerationTaskIdRef.current = null;
          const fallback = createBoundImageInputDraft();
          const restored = resolveBoundTargetTaskbarDraft(
            boundTargetDraftsRef.current,
            target.elementId,
            fallback
          );
          activeDraftElementIdRef.current = target.elementId;
          activeDraftBaselineRef.current = restored.baseline;
          applyTaskbarDraft(restored.draft);
          updatePromptSuggestion(
            restored.draft.prompt
              ? null
              : resolveBoundTargetPromptSuggestion(
                  target.prompt,
                  target.elementId,
                  dismissedPromptElementIdRef.current
                )
          );
        } else if (activeDraftBaselineRef.current) {
          updatePromptSuggestion(
            promptRef.current
              ? null
              : resolveBoundTargetPromptSuggestion(
                  target.prompt,
                  target.elementId,
                  dismissedPromptElementIdRef.current
                )
          );
        }
        pruneBoundTargetTaskbarDrafts();
        setSelectedContent([]);
        selectedFrameRef.current = null;
        suppressSelectionContentUrlsRef.current = new Set();
      },
      [
        applyTaskbarDraft,
        detachTaskbarDraft,
        pruneBoundTargetTaskbarDrafts,
        readCurrentTaskbarDraft,
        currentBoardId,
        resetBoundTaskbarDraftsForBoard,
        saveActiveTaskbarDraft,
        updatePromptSuggestion,
      ]
    );

    const handleDismissBoundTarget = useCallback(
      (mode: BoundTargetDismissMode) => {
        const target = boundImageTarget;
        const board = SelectionWatcherBoardRef.current;
        if (
          !target ||
          !supportsBoundTargetFollowControls(target.type) ||
          !board
        ) {
          return;
        }

        const selectedElement =
          getSelectedElements(board).find(
            (element) => element.id === target.elementId
          ) ||
          (findBoundTargetElement(
            board.children,
            target.elementId
          ) as PlaitElement | null);
        if (!selectedElement) {
          MessagePlugin.error(
            language === 'zh'
              ? `无法读取当前${
                  target.type === 'text'
                    ? '文本'
                    : target.type === 'video'
                    ? '视频'
                    : '图片'
                }的跟随设置`
              : `Failed to read the follow setting for this ${
                  target.type === 'text'
                    ? 'text'
                    : target.type === 'video'
                    ? 'video'
                    : 'image'
                }`
          );
          return;
        }

        detachTaskbarDraft(true);
        let nextTarget = target;
        if (mode === 'always') {
          Transforms.setNode(
            board,
            { aiTaskbarReferenceOnly: true } as Partial<PlaitElement>,
            PlaitBoard.findPath(board, selectedElement)
          );
          nextTarget = { ...target, referenceOnly: true };
        }
        suppressedBoundImageElementIdRef.current = target.elementId;

        const currentElement = findBoundTargetElement(
          board.children,
          target.elementId
        ) as PlaitElement | null;
        if (
          currentElement &&
          !getSelectedElements(board).some(
            (element) => element.id === target.elementId
          )
        ) {
          addSelectedElement(board, currentElement);
        }

        lastBoundImageTargetKeyRef.current = createBoundImageTargetStateKey(
          nextTarget,
          'reference'
        );
        boundImageTargetRef.current = nextTarget;
        setBoundImageTarget(nextTarget);
        setBoundImageTargetMode('reference');
        setBoundTargetError(null);
        dismissPromptSuggestion();
        setBoundInputLayoutTick((tick) => tick + 1);
        setBoundTargetDismissHintCount(
          recordBoundTargetDismiss(boundTargetDismissHintCount)
        );
      },
      [
        boundImageTarget,
        boundTargetDismissHintCount,
        detachTaskbarDraft,
        dismissPromptSuggestion,
        language,
      ]
    );

    const handleBoundTargetFollowChange = useCallback((enabled: boolean) => {
      setBoundTargetFollowEnabled(persistBoundTargetFollowEnabled(enabled));
      setBoundInputLayoutTick((tick) => tick + 1);
    }, []);

    const handleBoundInputViewportChange = useCallback(() => {
      setBoundInputLayoutTick((tick) => tick + 1);
    }, []);

    // 处理删除上传的图片（index 是在 allContent 中的索引）
    const handleRemoveUploadedContent = useCallback(
      (index: number) => {
        // allContent = [...uploadedContent, ...selectedContent]
        // 所以 index < uploadedContent.length 表示是上传的内容
        if (index < uploadedContent.length) {
          const nextUploadedContent = uploadedContent.filter(
            (_, i) => i !== index
          );
          uploadedContentRef.current = nextUploadedContent;
          setUploadedContent(nextUploadedContent);
        }
      },
      [uploadedContent]
    );

    const chatDrawerContent =
      boundImageTargetMode === 'reference' ? generationContent : allContent;

    // 仅作参考模式与生成请求使用同一份内容，确保目标图不会在抽屉中丢失。
    useEffect(() => {
      setSelectedContentRef.current(
        chatDrawerContent.map((c) => ({
          type: c.type,
          url: c.url,
          maskImage: c.maskImage,
          text: c.text,
          name: c.name,
          width: c.width,
          height: c.height,
        }))
      );
    }, [chatDrawerContent]);

    // 处理粘贴图片，仅在 AIInputBar 处于激活状态时接管
    useEffect(() => {
      const handlePaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items || items.length === 0) return;

        const hasImage = Array.from(items).some((item) =>
          item.type.startsWith('image/')
        );
        if (!hasImage) return;

        const activeElement = document.activeElement;
        const container = containerRef.current;
        const isInputBarActive =
          !!container &&
          (container.contains(activeElement) ||
            (isFocused &&
              (activeElement === document.body ||
                activeElement?.tagName === 'BODY')));

        if (!isInputBarActive) return;

        const imageFiles: File[] = [];
        for (const item of Array.from(items)) {
          if (!item.type.startsWith('image/')) continue;
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }

        if (imageFiles.length === 0) return;

        e.preventDefault();
        void importLocalImages(imageFiles);
        inputRef.current?.focus();
      };

      document.addEventListener('paste', handlePaste);
      return () => {
        document.removeEventListener('paste', handlePaste);
      };
    }, [importLocalImages, isFocused]);

    // 清除输入框中的触发符号
    const clearTriggerSymbol = useCallback(() => {
      if (triggerPositionRef.current !== null) {
        const pos = triggerPositionRef.current;
        setPrompt((prev) => {
          const nextPrompt = prev.substring(0, pos) + prev.substring(pos + 1);
          promptRef.current = nextPrompt;
          return nextPrompt;
        });
        triggerPositionRef.current = null;
      }
    }, []);

    const applyModelSelection = useCallback(
      (model: ModelConfig) => {
        const nextGenerationType = resolveGenerationTypeForModelSelection(
          generationType,
          model.type
        );

        analytics.track('ai_input_change_model', {
          model: model.id,
          type: model.type,
          profileId: model.sourceProfileId || null,
        });

        // 清除触发符号
        clearTriggerSymbol();

        // 更新状态（反显到下方下拉框）
        setGenerationType(nextGenerationType);
        setSelectedModel(model.id);
        const nextModelRef = getModelRefFromConfig(model);
        setSelectedModelRef(nextModelRef);
        setPersistedModelSelection(
          nextGenerationType as PersistedGenerationType,
          {
            modelId: model.id,
            modelRef: nextModelRef,
            providerIdHint: model.sourceProfileId || nextModelRef?.profileId,
            vendorHint: model.vendor,
          }
        );
        setSelectedParams(
          nextGenerationType === 'agent'
            ? {}
            : loadScopedAIInputModelParams(
                nextGenerationType,
                model.id,
                getSelectionKey(model.id, nextModelRef)
              )
        );

        // 关闭下拉菜单并保持焦点
        setModelDropdownOpen(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      },
      [clearTriggerSymbol, generationType]
    );

    // 处理模型选择（从下拉菜单）
    const handleModelSelect = useCallback(
      (modelId: string) => {
        const model =
          findMatchingSelectableModel(
            currentModels,
            modelId,
            selectedModelRef
          ) ||
          findMatchingSelectableModel(currentModels, modelId, null) ||
          getModelConfig(modelId);
        if (!model) return;
        applyModelSelection(model);
      },
      [applyModelSelection, currentModels, selectedModelRef]
    );

    const handleModelConfigSelect = useCallback(
      (model: ModelConfig) => {
        applyModelSelection(model);
      },
      [applyModelSelection]
    );

    const applyAgentMediaModelSelection = useCallback(
      (type: SkillMediaType, model: ModelConfig) => {
        const modelRef = getModelRefFromConfig(model);
        if (type === 'image') {
          setSelectedAgentImageModel(model.id);
          setSelectedAgentImageModelRef(modelRef);
        } else if (type === 'video') {
          setSelectedAgentVideoModel(model.id);
          setSelectedAgentVideoModelRef(modelRef);
        } else {
          setSelectedAgentAudioModel(model.id);
          setSelectedAgentAudioModelRef(modelRef);
        }

        setPersistedModelSelection(type, {
          modelId: model.id,
          modelRef,
          providerIdHint: model.sourceProfileId || modelRef?.profileId,
          vendorHint: model.vendor,
        });

        analytics.track('ai_input_change_agent_media_model', {
          model: model.id,
          type,
          profileId: model.sourceProfileId || null,
        });
      },
      []
    );

    const handleAgentMediaModelSelect = useCallback(
      (type: SkillMediaType, modelId: string, modelRef?: ModelRef | null) => {
        const models =
          type === 'image'
            ? visibleAgentImageModels
            : type === 'video'
            ? visibleAgentVideoModels
            : visibleAgentAudioModels;
        const model =
          findMatchingSelectableModel(models, modelId, modelRef || null) ||
          findMatchingSelectableModel(models, modelId, null) ||
          getModelConfig(modelId);
        if (!model) return;
        applyAgentMediaModelSelection(type, model);
      },
      [
        applyAgentMediaModelSelection,
        visibleAgentAudioModels,
        visibleAgentImageModels,
        visibleAgentVideoModels,
      ]
    );

    const handleAgentMediaModelConfigSelect = useCallback(
      (type: SkillMediaType, model: ModelConfig) => {
        applyAgentMediaModelSelection(type, model);
      },
      [applyAgentMediaModelSelection]
    );

    const handleSkillOptionSelect = useCallback((skill: SkillOption) => {
      setSelectedSkillMediaTypes(inferSkillMediaTypes(skill));
    }, []);

    const agentMediaDefaultModels = useMemo(
      () => ({
        image: selectedAgentImageModel,
        video: selectedAgentVideoModel,
        audio: selectedAgentAudioModel,
      }),
      [
        selectedAgentAudioModel,
        selectedAgentImageModel,
        selectedAgentVideoModel,
      ]
    );

    const agentMediaDefaultModelRefs = useMemo(
      () => ({
        image: selectedAgentImageModelRef,
        video: selectedAgentVideoModelRef,
        audio: selectedAgentAudioModelRef,
      }),
      [
        selectedAgentAudioModelRef,
        selectedAgentImageModelRef,
        selectedAgentVideoModelRef,
      ]
    );

    useEffect(() => {
      const selections = [
        {
          modelId: selectedModel,
          profileId: selectedModelRef?.profileId || null,
        },
      ];

      if (generationType === 'agent' && selectedSkillId !== SKILL_AUTO_ID) {
        if (selectedSkillMediaTypes.includes('image')) {
          selections.push({
            modelId: selectedAgentImageModel,
            profileId: selectedAgentImageModelRef?.profileId || null,
          });
        }
        if (selectedSkillMediaTypes.includes('video')) {
          selections.push({
            modelId: selectedAgentVideoModel,
            profileId: selectedAgentVideoModelRef?.profileId || null,
          });
        }
        if (selectedSkillMediaTypes.includes('audio')) {
          selections.push({
            modelId: selectedAgentAudioModel,
            profileId: selectedAgentAudioModelRef?.profileId || null,
          });
        }
      }

      setActiveHealthSelections(selections);
    }, [
      generationType,
      selectedAgentAudioModel,
      selectedAgentAudioModelRef,
      selectedAgentImageModel,
      selectedAgentImageModelRef,
      selectedAgentVideoModel,
      selectedAgentVideoModelRef,
      selectedModel,
      selectedModelRef,
      selectedSkillId,
      selectedSkillMediaTypes,
      setActiveHealthSelections,
    ]);

    // 当 selectedModel 被外部逻辑更新时（如生成类型切换、设置变更），重新对齐参数
    // 避免无限循环：只有在参数实际变化时才更新 state
    // 当模型或可用参数变化时同步默认参数，保留用户已选值
    useEffect(() => {
      const isSameParams = (
        a: Record<string, string>,
        b: Record<string, string>
      ) => {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every((k) => a[k] === b[k]);
      };

      const currentScopeKey =
        generationType === 'agent'
          ? 'agent'
          : `${generationType}:${getSelectionKey(
              selectedModel,
              selectedModelRef
            )}`;
      const loadedParams =
        generationType === 'agent'
          ? {}
          : selectedParamScopeRef.current === currentScopeKey
          ? selectedParamsRef.current || {}
          : loadScopedAIInputModelParams(
              generationType,
              selectedModel,
              getSelectionKey(selectedModel, selectedModelRef),
              selectedParamsRef.current
            );
      const baseParams = { ...loadedParams };
      if (
        selectedModel.startsWith('doubao-seedance-2-0-') &&
        baseParams.size?.includes('@')
      ) {
        const [resolution, legacyRatio] = baseParams.size.split('@');
        baseParams.size = resolution;
        if (legacyRatio && !baseParams.ratio) {
          baseParams.ratio = legacyRatio;
        }
      }
      const nextParams: Record<string, string> = {};

      const sizeParam = compatibleParams.find((p) => p.id === 'size');
      const prevSize = baseParams.size;
      const prevSizeIsValid =
        !prevSize ||
        !sizeParam?.options ||
        sizeParam.options.some((option) => option.value === prevSize);
      if (!selectedModel.startsWith('mj') && sizeParam) {
        nextParams.size =
          prevSize && prevSizeIsValid
            ? prevSize
            : sizeParam.defaultValue || getDefaultSizeForModel(selectedModel);
      }

      compatibleParams.forEach((p) => {
        if (p.id === 'size') return;
        const prevVal = baseParams[p.id];
        const prevValIsValid =
          !prevVal ||
          p.valueType !== 'enum' ||
          !p.options ||
          p.options.some((option) => option.value === prevVal);
        if (prevVal && prevValIsValid) {
          nextParams[p.id] = prevVal;
        } else if (p.defaultValue) {
          nextParams[p.id] = p.defaultValue;
        }
      });

      const normalizedParams = applyForcedSunoParams(selectedModel, nextParams);
      if (!isSameParams(selectedParamsRef.current || {}, normalizedParams)) {
        setSelectedParams(normalizedParams);
        selectedParamsRef.current = normalizedParams;
      }
      selectedParamScopeRef.current = currentScopeKey;
      // 仅在模型或兼容参数变动时运行，避免用户选择被覆盖
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [generationType, selectedModel, selectedModelRef, compatibleParams]);

    useEffect(() => {
      saveAIInputPreferences({
        generationType,
        selectedModel,
        selectedParams,
        selectedCount,
        selectedSkillId,
      });
      if (generationType !== 'agent') {
        saveScopedAIInputModelParams(
          generationType,
          selectedModel,
          selectedParams,
          getSelectionKey(selectedModel, selectedModelRef)
        );
      }
    }, [
      generationType,
      selectedModel,
      selectedModelRef,
      selectedParams,
      selectedCount,
      selectedSkillId,
    ]);

    // 处理参数选择
    const handleParamSelect = useCallback(
      (paramId: string, value?: string, options?: { keepOpen?: boolean }) => {
        // 清除触发符号
        clearTriggerSymbol();

        // 更新参数对象
        setSelectedParams((prev) => {
          const next = { ...prev };
          if (value === undefined || value === '') {
            delete next[paramId];
          } else {
            next[paramId] = value;
          }
          return next;
        });

        // 关闭下拉菜单并保持焦点
        if (!options?.keepOpen) {
          setParamsDropdownOpen(false);
          setTimeout(() => inputRef.current?.focus(), 0);
        }
      },
      [clearTriggerSymbol]
    );

    // 处理个数选择
    const handleCountSelect = useCallback(
      (count: number) => {
        // 清除触发符号
        clearTriggerSymbol();

        setSelectedCount(count);

        // 关闭下拉菜单并保持焦点
        setCountDropdownOpen(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      },
      [clearTriggerSymbol]
    );

    // Handle generation
    const handleGenerate = useCallback(
      async (
        triggerOrOverride:
          | AIInputSubmitTrigger
          | GenerationRequestOverride = 'button'
      ) => {
        const override =
          typeof triggerOrOverride === 'string' ? undefined : triggerOrOverride;
        const trigger =
          typeof triggerOrOverride === 'string' ? triggerOrOverride : 'button';
        const effectivePrompt = override?.prompt ?? prompt;
        const shouldUseActiveBoundTarget =
          !override &&
          shouldUseBoundTargetForSubmission(
            generationType,
            boundImageTargetMode
          ) &&
          boundImageTarget?.type === generationType;
        const activeBoundImageTarget = shouldUseActiveBoundTarget
          ? boundImageTarget
          : null;
        const effectiveContent = override
          ? pinBoundTargetReferenceContent(
              override.content,
              boundTargetContent,
              boundImageTargetMode
            )
          : generationContent;
        const effectiveGenerationType = activeBoundImageTarget
          ? activeBoundImageTarget.type
          : override?.generationType ?? generationType;
        const effectiveSelectedModel = override?.selectedModel ?? selectedModel;
        const effectiveSelectedModelRef =
          override?.selectedModelRef ?? selectedModelRef;
        const effectiveSelectedParams =
          override?.selectedParams ?? selectedParams;
        const effectiveSelectedCount =
          activeBoundImageTarget?.type === 'text' ||
          activeBoundImageTarget?.type === 'audio'
            ? 1
            : override?.selectedCount ?? selectedCount;
        const appendToCurrentChatSession =
          override?.appendToCurrentChatSession ?? false;
        const shouldClearLocalInput = !override && !activeBoundImageTarget;
        const submittedTaskbarDraft = override
          ? null
          : readCurrentTaskbarDraft();
        const submittedDraftElementId = override
          ? null
          : activeDraftElementIdRef.current;
        const submittedDraftBoardId = activeTaskbarBoardIdRef.current;
        const finalizeSubmittedBoundDraft = (clearSubmittedInput: boolean) => {
          if (!submittedDraftElementId || !submittedTaskbarDraft) return false;
          if (activeTaskbarBoardIdRef.current !== submittedDraftBoardId) {
            return true;
          }

          const isCurrentDraft =
            activeDraftElementIdRef.current === submittedDraftElementId;
          const storedDraft = boundTargetDraftsRef.current.get(
            submittedDraftElementId
          )?.draft;
          const currentDraft = isCurrentDraft
            ? readCurrentTaskbarDraft()
            : storedDraft || submittedTaskbarDraft;
          const resolvedDraft = resolveTaskbarDraftAfterSubmission(
            currentDraft,
            submittedTaskbarDraft,
            createBoundImageInputDraft(),
            clearSubmittedInput
          );

          storeBoundTargetTaskbarDraft(
            boundTargetDraftsRef.current,
            submittedDraftElementId,
            resolvedDraft.draft,
            resolvedDraft.baseline
          );

          if (isCurrentDraft) {
            activeDraftBaselineRef.current = resolvedDraft.baseline;
            if (clearSubmittedInput && !resolvedDraft.hasNewerInput) {
              applyTaskbarDraft(resolvedDraft.draft);
              setSelectedContent([]);
            }
          }
          return true;
        };
        const clearSubmittedLocalInput = () => {
          if (activeTaskbarBoardIdRef.current !== submittedDraftBoardId) return;
          if (finalizeSubmittedBoundDraft(true)) return;

          if (
            submittedTaskbarDraft &&
            areBoundTargetTaskbarDraftsEqual(
              unboundTaskbarDraftRef.current,
              submittedTaskbarDraft
            )
          ) {
            unboundTaskbarDraftRef.current = createBoundImageInputDraft();
          }
          if (
            !shouldClearLocalInput ||
            !submittedTaskbarDraft ||
            activeDraftElementIdRef.current !== null ||
            !areBoundTargetTaskbarDraftsEqual(
              readCurrentTaskbarDraft(),
              submittedTaskbarDraft
            )
          ) {
            return;
          }
          const emptyDraft = createBoundImageInputDraft();
          unboundTaskbarDraftRef.current = emptyDraft;
          applyTaskbarDraft(emptyDraft);
          setSelectedContent([]);
        };
        const effectiveKnowledgeContextRefs = override
          ? []
          : knowledgeContextRefs;
        const trimmedPrompt = effectivePrompt.trim();

        if (!trimmedPrompt && effectiveContent.length === 0) {
          return;
        }
        if (submitLockRef.current || isSubmitting) {
          return; // 仅防止快速重复点击
        }
        submitLockRef.current = true;
        setIsInspirationSendGuideActive(false);
        onEnableRuntime?.();

        const submitStartTime = Date.now();
        const promptLength = trimmedPrompt.length;
        const submitAnalyticsBase = {
          trigger,
          source: override ? 'chat_drawer' : 'ai_input_bar',
          generationType: effectiveGenerationType,
          generation_type: effectiveGenerationType,
          model: effectiveSelectedModel,
          profileId: effectiveSelectedModelRef?.profileId || null,
          profile_id: effectiveSelectedModelRef?.profileId || null,
          hasAttachedContent: effectiveContent.length > 0,
          has_attached_content: effectiveContent.length > 0,
          attachedCount: effectiveContent.length,
          attached_count: effectiveContent.length,
          knowledgeContextCount: effectiveKnowledgeContextRefs.length,
          knowledge_context_count: effectiveKnowledgeContextRefs.length,
          promptLength,
          prompt_length: promptLength,
          promptLengthBucket: getPromptLengthBucket(promptLength),
          prompt_length_bucket: getPromptLengthBucket(promptLength),
        };
        const trackSubmitStatus = (
          status: 'start' | 'success' | 'failed' | 'cancelled',
          extras: Record<string, unknown> = {}
        ) => {
          const durationMs = Date.now() - submitStartTime;
          analytics.track('ai_input_submit', {
            ...submitAnalyticsBase,
            status,
            durationMs,
            duration_ms: durationMs,
            ...extras,
          });
        };

        setIsSubmitting(true);
        trackSubmitStatus('start');

        try {
          // 检查 API key，如果没有配置则弹窗获取
          const currentRouteType =
            effectiveGenerationType === 'video'
              ? 'video'
              : effectiveGenerationType === 'audio'
              ? 'audio'
              : effectiveGenerationType === 'text' ||
                effectiveGenerationType === 'agent'
              ? 'text'
              : 'image';
          const hasRouteCredentials = hasInvocationRouteCredentials(
            currentRouteType,
            effectiveSelectedModelRef || effectiveSelectedModel
          );
          if (!hasRouteCredentials) {
            const newApiKey = await promptForApiKey();
            if (!newApiKey) {
              trackSubmitStatus('cancelled', {
                reason: 'missing_api_key',
                submitMode: 'preflight',
                submit_mode: 'preflight',
              });
              submitLockRef.current = false;
              setIsSubmitting(false);
              return;
            }
          }

          // 构建选中元素的分类信息（使用合并后的 allContent）
          // 收集图片和图形的尺寸信息（按顺序：先 images，后 graphics）
          const imageItems = effectiveContent.filter(
            (item) => item.type === 'image' && item.url
          );
          const graphicsItems = effectiveContent.filter(
            (item) => item.type === 'graphics' && item.url
          );
          const imageDimensions = [...imageItems, ...graphicsItems]
            .map((item) => {
              if (item.width && item.height) {
                return { width: item.width, height: item.height };
              }
              return undefined;
            })
            .filter(
              (dim): dim is { width: number; height: number } =>
                dim !== undefined
            );

          const selection = {
            texts: effectiveContent
              .filter((item) => item.type === 'text' && item.text)
              .map((item) => item.text!),
            images: imageItems.map((item) => item.url!),
            videos: effectiveContent
              .filter((item) => item.type === 'video' && item.url)
              .map((item) => item.url!),
            graphics: graphicsItems.map((item) => item.url!),
            // 添加图片尺寸信息（始终传递数组，避免下游处理 undefined）
            imageDimensions: imageDimensions,
            maskImage:
              imageItems.length === 1 && graphicsItems.length === 0
                ? imageItems[0].maskImage
                : undefined,
          };

          // 解析输入内容，使用选中的模型和尺寸
          const parsedParams = parseAIInput(effectivePrompt, selection, {
            modelId: effectiveSelectedModel,
            modelRef: effectiveSelectedModelRef,
            params: effectiveSelectedParams,
            generationType: effectiveGenerationType,
            count: effectiveSelectedCount,
            knowledgeContextRefs: effectiveKnowledgeContextRefs,
            defaultModels:
              effectiveGenerationType === 'agent'
                ? agentMediaDefaultModels
                : undefined,
            defaultModelRefs:
              effectiveGenerationType === 'agent'
                ? agentMediaDefaultModelRefs
                : undefined,
          });
          const boundTargetGenerationParams = activeBoundImageTarget
            ? activeBoundImageTarget.type === 'image'
              ? buildBoundTargetGenerationParams(
                  activeBoundImageTarget,
                  effectiveSelectedCount
                )
              : effectiveSelectedCount === 1
              ? {
                  replaceElementId: activeBoundImageTarget.elementId,
                  sourcePrompt: activeBoundImageTarget.prompt,
                }
              : null
            : null;
          const replacementBoundImageTarget = boundTargetGenerationParams
            ? activeBoundImageTarget?.type === 'image'
              ? activeBoundImageTarget
              : null
            : null;
          if (boundTargetGenerationParams) {
            parsedParams.extraParams = {
              ...(parsedParams.extraParams || {}),
              ...boundTargetGenerationParams,
            };
          }

          // 收集所有参考媒体（图片 + 图形 + 视频）
          const referenceImages = [...selection.images, ...selection.graphics];

          // 创建工作流定义（仅用于 WorkZone 显示，实际工作流由 submitWorkflowToSW 创建）
          let workflow: WorkflowDefinition;
          if (
            effectiveGenerationType === 'agent' &&
            selectedSkillId !== SKILL_AUTO_ID
          ) {
            // Skill 模式：根据 skillId 决定使用系统内置 Skill 还是用户自定义 Skill
            const systemSkill = findSystemSkillById(selectedSkillId);
            if (systemSkill) {
              // 系统内置 Skill：直接转换，失败时降级到通用工作流
              try {
                workflow = await convertSkillFlowToWorkflow(
                  parsedParams,
                  systemSkill,
                  referenceImages
                );
              } catch (e) {
                console.warn(
                  '[AIInputBar] 系统 Skill 工作流转换失败，降级到通用工作流:',
                  e
                );
                workflow = convertToWorkflow(parsedParams, referenceImages);
              }
            } else {
              // 尝试外部 Skill
              const externalSkill = findExternalSkillById(selectedSkillId);
              if (externalSkill) {
                // 外部 Skill：使用 content（SKILL.md 文档体）走三条路径
                try {
                  workflow = await convertSkillFlowToWorkflow(
                    parsedParams,
                    {
                      id: externalSkill.id,
                      name: externalSkill.name,
                      type: 'external' as const,
                      content: externalSkill.content,
                      outputType: externalSkill.outputType,
                    },
                    referenceImages
                  );
                } catch (e) {
                  console.warn(
                    '[AIInputBar] 外部 Skill 工作流转换失败，降级到角色扮演:',
                    e
                  );
                  // 外部 Skill 降级时，使用 content 作为 systemPrompt
                  workflow = await convertSkillFlowToWorkflow(
                    parsedParams,
                    {
                      id: externalSkill.id,
                      name: externalSkill.name,
                      type: 'external' as const,
                      content: externalSkill.content,
                      outputType: externalSkill.outputType,
                    },
                    referenceImages
                  ).catch(() =>
                    convertToWorkflow(parsedParams, referenceImages)
                  );
                }
              } else {
                // 用户自定义 Skill：从知识库读取笔记内容
                try {
                  const userNote = await knowledgeBaseService.getNoteById(
                    selectedSkillId
                  );
                  if (userNote) {
                    const userOutputType =
                      (userNote.metadata?.outputType as
                        | 'image'
                        | 'text'
                        | 'video'
                        | 'audio'
                        | 'ppt') || undefined;
                    workflow = await convertSkillFlowToWorkflow(
                      parsedParams,
                      {
                        id: userNote.id,
                        name: userNote.title,
                        type: 'user',
                        content: userNote.content,
                        outputType: userOutputType,
                      },
                      referenceImages
                    );
                  } else {
                    workflow = convertToWorkflow(parsedParams, referenceImages);
                  }
                } catch {
                  workflow = convertToWorkflow(parsedParams, referenceImages);
                }
              }
            }
            // 兜底：若上述所有路径均未赋值（理论上不应发生），降级到通用工作流
            if (!workflow) {
              console.warn(
                '[AIInputBar] Skill 工作流未能生成，降级到通用工作流'
              );
              workflow = convertToWorkflow(parsedParams, referenceImages);
            }
          } else {
            workflow = convertToWorkflow(parsedParams, referenceImages);
          }
          const board = SelectionWatcherBoardRef.current;
          if (board) {
            // WorkZone 固定尺寸
            const WORKZONE_WIDTH = 360;
            const WORKZONE_HEIGHT = 240;
            const GAP = 50;

            const containerRect = board.host?.getBoundingClientRect();
            const zoom = board.viewport?.zoom || 1;
            const originX = board.viewport?.origination?.[0] || 0;
            const originY = board.viewport?.origination?.[1] || 0;

            const allElements = board.children.filter(
              (el: { type?: string }) => el.type !== 'workzone'
            );

            const viewportCenterX =
              originX + (containerRect?.width || 0) / 2 / zoom;
            const viewportCenterY =
              originY + (containerRect?.height || 0) / 2 / zoom;

            let expectedInsertLeftX: number = viewportCenterX - 200;
            let expectedInsertY: number = viewportCenterY;
            let workzoneX: number = expectedInsertLeftX;
            let workzoneY: number = viewportCenterY - WORKZONE_HEIGHT / 2;

            if (allElements.length > 0) {
              const selectedElements = getSelectedElements(board);
              let positionCalculated = false;

              if (selectedElements.length > 0) {
                try {
                  const selectedRect = getRectangleByElements(
                    board,
                    selectedElements,
                    false
                  );

                  // 检测选中元素是否全部为图片/视频
                  const allMediaElements = selectedElements.every(
                    (el) =>
                      (PlaitDrawElement.isDrawElement(el) &&
                        PlaitDrawElement.isImage(el)) ||
                      isPlaitVideo(el)
                  );

                  if (
                    allMediaElements &&
                    selectedRect.width > selectedRect.height
                  ) {
                    // 横屏：插入到右侧，顶部对齐
                    expectedInsertLeftX =
                      selectedRect.x + selectedRect.width + GAP;
                    expectedInsertY = selectedRect.y;
                  } else {
                    // 竖屏或非媒体元素：插入到下方
                    expectedInsertLeftX = selectedRect.x;
                    expectedInsertY =
                      selectedRect.y + selectedRect.height + GAP;
                  }

                  workzoneX = expectedInsertLeftX;
                  workzoneY = expectedInsertY;
                  positionCalculated = true;
                } catch (error) {
                  console.warn(
                    '[AIInputBar] Failed to calculate position for selected elements:',
                    error
                  );
                }
              }

              if (!positionCalculated) {
                let bottommostElement: PlaitElement | null = null;
                let maxBottomY = -Infinity;

                for (const element of allElements) {
                  try {
                    const rect = getRectangleByElements(
                      board,
                      [element as PlaitElement],
                      false
                    );
                    const bottomY = rect.y + rect.height;
                    if (bottomY > maxBottomY) {
                      maxBottomY = bottomY;
                      bottommostElement = element as PlaitElement;
                    }
                  } catch (error) {
                    console.warn(
                      '[AIInputBar] Failed to get rectangle for element:',
                      error
                    );
                  }
                }

                if (bottommostElement) {
                  const bottommostRect = getRectangleByElements(
                    board,
                    [bottommostElement],
                    false
                  );
                  expectedInsertLeftX = bottommostRect.x;
                  expectedInsertY =
                    bottommostRect.y + bottommostRect.height + GAP;
                  workzoneX = expectedInsertLeftX;
                  workzoneY = expectedInsertY;
                }
              }
            }

            let workflowMessageData = toWorkflowMessageData(workflow);

            // 如果选中了 Frame，将 Frame 信息传递给 WorkZone
            // 生成完成后媒体将插入到 Frame 内部并缩放到 Frame 尺寸
            const frameInfo = selectedFrameRef.current;
            let targetFrameId: string | undefined;
            let targetFrameDimensions:
              | { width: number; height: number }
              | undefined;
            let targetFrameRect:
              | { x: number; y: number; width: number; height: number }
              | undefined;

            if (frameInfo) {
              // 验证 Frame 仍然存在
              const frameElement = board.children.find(
                (el: { id: string }) => el.id === frameInfo.id
              );
              if (frameElement && isFrameElement(frameElement)) {
                targetFrameId = frameInfo.id;
                targetFrameDimensions = {
                  width: frameInfo.width,
                  height: frameInfo.height,
                };
                // Frame 选中时，插入位置设为 Frame 左上角（后续由插入逻辑居中处理）
                const frameRect = RectangleClient.getRectangleByPoints(
                  frameElement.points
                );
                targetFrameRect = frameRect;
                expectedInsertLeftX = frameRect.x;
                expectedInsertY = frameRect.y;
              }
            }

            const isImageGeneration = parsedParams.generationType === 'image';

            if (isImageGeneration) {
              const requestedCount = Math.max(parsedParams.count ?? 1, 1);
              const shouldCreateIndependentBatchAnchors = requestedCount > 1;
              const anchorTargetFrameId = shouldCreateIndependentBatchAnchors
                ? undefined
                : targetFrameId;
              const anchorTargetFrameDimensions =
                shouldCreateIndependentBatchAnchors
                  ? undefined
                  : targetFrameDimensions;
              const imageAnchorElements: Array<
                ReturnType<typeof ImageGenerationAnchorTransforms.insertAnchor>
              > = [];
              const workflowBatchId = `wf_batch_${workflow.id}`;
              const plannedAnchorPositions = !anchorTargetFrameId
                ? resolveImageGenerationBatchAnchorPositions(
                    board,
                    [expectedInsertLeftX, expectedInsertY],
                    buildImageGenerationAnchorCreateOptions({
                      workflowId: workflow.id,
                      expectedInsertPosition: [
                        expectedInsertLeftX,
                        expectedInsertY,
                      ],
                      requestedSize: parsedParams.size,
                      requestedCount: 1,
                      zoom,
                      prompt: parsedParams.prompt,
                      targetElementId: replacementBoundImageTarget?.elementId,
                      sourceTaskId:
                        replacementBoundImageTarget?.generationTaskId,
                      title: workflowMessageData.name || '图片生成',
                      ...buildImageGenerationAnchorPresentationPatch(
                        'submitted'
                      ),
                    }).size ?? {
                      width: 320,
                      height: 180,
                    },
                    requestedCount,
                    {
                      frameRect: shouldCreateIndependentBatchAnchors
                        ? targetFrameRect
                        : undefined,
                    }
                  )
                : null;

              for (let index = 0; index < requestedCount; index += 1) {
                let anchorCreateOptions =
                  buildImageGenerationAnchorCreateOptions({
                    workflowId: workflow.id,
                    expectedInsertPosition: [
                      expectedInsertLeftX,
                      expectedInsertY,
                    ],
                    targetFrameId: anchorTargetFrameId,
                    targetFrameDimensions: anchorTargetFrameDimensions,
                    frameAffinityId: shouldCreateIndependentBatchAnchors
                      ? targetFrameId
                      : undefined,
                    frameAffinityDimensions: shouldCreateIndependentBatchAnchors
                      ? targetFrameDimensions
                      : undefined,
                    requestedSize: parsedParams.size,
                    requestedCount: shouldCreateIndependentBatchAnchors
                      ? 1
                      : requestedCount,
                    prompt: parsedParams.prompt,
                    targetElementId: replacementBoundImageTarget?.elementId,
                    sourceTaskId: replacementBoundImageTarget?.generationTaskId,
                    batchId: shouldCreateIndependentBatchAnchors
                      ? workflowBatchId
                      : undefined,
                    batchIndex: shouldCreateIndependentBatchAnchors
                      ? index + 1
                      : undefined,
                    batchTotal: shouldCreateIndependentBatchAnchors
                      ? requestedCount
                      : undefined,
                    zoom,
                    title: workflowMessageData.name || '图片生成',
                    ...buildImageGenerationAnchorPresentationPatch('submitted'),
                  });

                if (!anchorTargetFrameId) {
                  const resolvedAnchorPosition = plannedAnchorPositions
                    ? plannedAnchorPositions[index] ??
                      anchorCreateOptions.position
                    : anchorCreateOptions.position;

                  anchorCreateOptions = {
                    ...anchorCreateOptions,
                    position: resolvedAnchorPosition,
                    expectedInsertPosition: resolvedAnchorPosition,
                  };
                }

                const anchorElement =
                  ImageGenerationAnchorTransforms.insertAnchor(
                    board,
                    anchorCreateOptions
                  );
                imageAnchorElements.push(anchorElement);
              }

              currentImageAnchorIdsRef.current = imageAnchorElements.map(
                (anchor) => anchor.id
              );
              bindWorkflowImageStepsToAnchors(workflow, imageAnchorElements);
              workflowMessageData = toWorkflowMessageData(workflow);
              currentWorkZoneIdRef.current = null;
              const [firstAnchor] = imageAnchorElements;
              if (firstAnchor) {
                setTimeout(() => {
                  const anchorRect = RectangleClient.getRectangleByPoints(
                    firstAnchor.points
                  );
                  scrollToPointIfNeeded(
                    board,
                    [
                      anchorRect.x + anchorRect.width / 2,
                      anchorRect.y + anchorRect.height / 2,
                    ],
                    100
                  );
                }, 100);
              }
            } else {
              const workzoneElement = WorkZoneTransforms.insertWorkZone(board, {
                workflow: workflowMessageData,
                position: [workzoneX, workzoneY],
                size: { width: WORKZONE_WIDTH, height: WORKZONE_HEIGHT },
                expectedInsertPosition: [expectedInsertLeftX, expectedInsertY],
                targetFrameId,
                targetFrameDimensions,
                zoom,
              });

              currentWorkZoneIdRef.current = workzoneElement.id;
              currentImageAnchorIdsRef.current = [];
              setTimeout(() => {
                const workzoneCenterX = workzoneX + WORKZONE_WIDTH / 2;
                const workzoneCenterY = workzoneY + WORKZONE_HEIGHT / 2;
                scrollToPointIfNeeded(
                  board,
                  [workzoneCenterX, workzoneCenterY],
                  100
                );
              }, 100);
            }
          }

          const imageRoute = resolveInvocationRoute('image');
          const videoRoute = resolveInvocationRoute('video');
          const audioRoute = resolveInvocationRoute('audio');
          const aiContext = {
            rawInput: effectivePrompt,
            userInstruction: parsedParams.userInstruction,
            model: {
              id: parsedParams.modelId,
              type: parsedParams.generationType,
              isExplicit: parsedParams.isModelExplicit,
            },
            modelRef: parsedParams.modelRef,
            defaultModels: parsedParams.defaultModels || {
              audio: audioRoute.modelId || getDefaultAudioModel(),
              image: imageRoute.modelId || getDefaultImageModel(),
              video: videoRoute.modelId || getDefaultVideoModel(),
            },
            defaultModelRefs: parsedParams.defaultModelRefs || {
              audio: createModelRef(audioRoute.profileId, audioRoute.modelId),
              image: createModelRef(imageRoute.profileId, imageRoute.modelId),
              video: createModelRef(videoRoute.profileId, videoRoute.modelId),
            },
            params: {
              count: parsedParams.count,
              size: parsedParams.size,
              duration: parsedParams.duration,
            },
            selection,
            finalPrompt: parsedParams.prompt,
            knowledgeContextRefs: parsedParams.knowledgeContextRefs,
          };

          const textModel = resolveInvocationRoute('text').modelId;

          const retryContext: WorkflowRetryContext = {
            aiContext,
            referenceImages,
            textModel,
          };
          currentRetryContextRef.current = retryContext;

          try {
            const { usedSW } = await submitWorkflowToSW(
              parsedParams,
              referenceImages,
              retryContext,
              workflow,
              {
                appendToCurrentChatSession,
              }
            );
            if (usedSW) {
              finalizeSubmittedBoundDraft(false);
              trackSubmitStatus('success', {
                submitMode: 'service_worker',
                submit_mode: 'service_worker',
                workflowId: workflow.id,
                workflow_id: workflow.id,
                stepCount: workflow.steps.length,
                step_count: workflow.steps.length,
              });
              if (effectiveGenerationType === 'image') {
                applyCurrentImageAnchorPresentationState(board, 'accepted');
              }
              if (effectivePrompt.trim()) {
                const trimmedPrompt = effectivePrompt.trim();
                const hasSelection = effectiveContent.length > 0;
                addPromptHistory(
                  trimmedPrompt,
                  hasSelection,
                  effectiveGenerationType
                );
                if (effectiveGenerationType === 'image') {
                  addImagePromptHistory(trimmedPrompt);
                } else if (effectiveGenerationType === 'video') {
                  addVideoPromptHistory(trimmedPrompt);
                }
              }
              if (shouldClearLocalInput) {
                clearSubmittedLocalInput();
              }

              if (submitCooldownRef.current) {
                clearTimeout(submitCooldownRef.current);
              }
              submitCooldownRef.current = setTimeout(() => {
                submitLockRef.current = false;
                setIsSubmitting(false);
                submitCooldownRef.current = null;
              }, 1000);

              return;
            }
          } catch (swError) {
            console.warn(
              '[AIInputBar] SW execution failed, falling back to main thread:',
              swError
            );
          }
          if (effectiveGenerationType === 'image') {
            applyCurrentImageAnchorPresentationState(board, 'handoff');
          }

          // 工作流已提交，立即保存历史、清空输入并解锁，步骤执行在后台继续
          if (effectivePrompt.trim()) {
            const trimmedPrompt = effectivePrompt.trim();
            const hasSelection = effectiveContent.length > 0;
            addPromptHistory(
              trimmedPrompt,
              hasSelection,
              effectiveGenerationType
            );
            if (effectiveGenerationType === 'image') {
              addImagePromptHistory(trimmedPrompt);
            } else if (effectiveGenerationType === 'video') {
              addVideoPromptHistory(trimmedPrompt);
            }
          }
          if (shouldClearLocalInput) {
            clearSubmittedLocalInput();
          }
          if (submitCooldownRef.current) {
            clearTimeout(submitCooldownRef.current);
          }
          submitCooldownRef.current = setTimeout(() => {
            submitLockRef.current = false;
            setIsSubmitting(false);
            submitCooldownRef.current = null;
          }, 1000);

          const createdTaskIds: string[] = [];

          // 收集动态添加的步骤（用于后续执行）
          const pendingNewSteps: Array<{
            id: string;
            mcp: string;
            args: Record<string, unknown>;
            description: string;
            options?: WorkflowStepOptions;
          }> = [];

          // 创建标准回调（所有工具都可使用，不需要的会忽略）
          const createStepCallbacks = (
            currentStep: (typeof workflow.steps)[0],
            stepStartTime: number
          ) => ({
            // 流式输出回调
            onChunk: (chunk: string) => {
              updateThinkingContentRef.current(chunk);
            },
            // 动态添加步骤回调
            onAddSteps: (
              newSteps: Array<{
                id: string;
                mcp: string;
                args: Record<string, unknown>;
                description: string;
                status: string;
              }>
            ) => {
              // 当前步骤完成
              workflowControl.updateStep(
                currentStep.id,
                'completed',
                { analysis: 'completed' },
                undefined,
                Date.now() - stepStartTime
              );

              // 为新步骤添加 queue 模式选项（尊重传入的 status，若为 completed 则保留）
              const stepsWithOptions = newSteps.map((s, index) =>
                enrichStepArgsWithPromptMeta(workflow, {
                  ...s,
                  status: (s.status === 'completed'
                    ? 'completed'
                    : 'pending') as 'pending' | 'completed',
                  options: {
                    mode: 'queue' as const,
                    batchId: `agent_${Date.now()}`,
                    batchIndex: index + 1,
                    batchTotal: newSteps.length,
                    globalIndex: index + 1,
                  },
                })
              );

              // 添加新步骤到工作流
              workflowControl.addSteps(stepsWithOptions);

              // 收集待执行的步骤
              pendingNewSteps.push(...stepsWithOptions);

              // 追加工具调用日志
              newSteps.forEach((s) => {
                appendAgentLogRef.current({
                  type: 'tool_call',
                  timestamp: Date.now(),
                  toolName: s.mcp,
                  args: s.args,
                });
              });

              const workflowData = toWorkflowMessageData(
                workflowControl.getWorkflow()!,
                currentRetryContextRef.current || undefined
              );
              updateWorkflowMessageRef.current(workflowData);
              // 同步更新 WorkZone
              if (currentWorkZoneIdRef.current && board) {
                WorkZoneTransforms.updateWorkflow(
                  board,
                  currentWorkZoneIdRef.current,
                  workflowData
                );
              }
            },
            // 更新步骤状态回调
            onUpdateStep: (
              stepId: string,
              status: string,
              result?: unknown,
              error?: string
            ) => {
              workflowControl.updateStep(
                stepId,
                status as
                  | 'pending'
                  | 'running'
                  | 'completed'
                  | 'failed'
                  | 'skipped',
                result,
                error
              );

              // 追加工具结果日志
              appendAgentLogRef.current({
                type: 'tool_result',
                timestamp: Date.now(),
                toolName: stepId,
                success: status === 'completed',
                data: result,
                error,
              });

              const workflowData = toWorkflowMessageData(
                workflowControl.getWorkflow()!,
                currentRetryContextRef.current || undefined
              );
              updateWorkflowMessageRef.current(workflowData);
              // 同步更新 WorkZone
              if (currentWorkZoneIdRef.current && board) {
                WorkZoneTransforms.updateWorkflow(
                  board,
                  currentWorkZoneIdRef.current,
                  workflowData
                );
              }
            },
          });

          let workflowFailed = false;

          // 辅助函数：同步更新 ChatDrawer 和 WorkZone
          const syncWorkflowUpdates = () => {
            const workflowData = toWorkflowMessageData(
              workflowControl.getWorkflow()!,
              currentRetryContextRef.current || undefined
            );
            updateWorkflowMessageRef.current(workflowData);
            if (currentWorkZoneIdRef.current && board) {
              WorkZoneTransforms.updateWorkflow(
                board,
                currentWorkZoneIdRef.current,
                workflowData
              );
            }
          };

          // 执行单个步骤的函数
          const executeStep = async (step: (typeof workflow.steps)[0]) => {
            const stepStartTime = Date.now();
            // 记录执行前的动态步骤数量，用于判断 ai_analyze 是否触发了 onAddSteps
            const pendingStepsBeforeExec = pendingNewSteps.length;

            // 更新步骤为运行中
            workflowControl.updateStep(step.id, 'running');
            syncWorkflowUpdates();

            try {
              // 合并步骤选项和标准回调（工具自行决定是否使用回调）
              const executeOptions = {
                ...step.options,
                ...createStepCallbacks(step, stepStartTime),
              }; // 通过 MCP Registry 执行工具
              const executableStep = enrichStepArgsWithPromptMeta(
                workflow,
                step
              );
              const result = (await mcpRegistry.executeTool(
                { name: executableStep.mcp, arguments: executableStep.args },
                executeOptions
              )) as MCPTaskResult;
              // 根据结果更新步骤状态
              const currentStepStatus = workflowControl
                .getWorkflow()
                ?.steps.find((s) => s.id === step.id)?.status;

              if (!result.success) {
                // 执行失败，标记工作流失败
                workflowControl.updateStep(
                  step.id,
                  'failed',
                  undefined,
                  result.error || '执行失败',
                  Date.now() - stepStartTime
                );
                return false; // 返回失败
              } else if (result.taskId) {
                // 队列模式：记录任务 ID（状态保持 running，等任务完成后更新）
                createdTaskIds.push(result.taskId);
                workflowControl.updateStep(step.id, 'running', {
                  taskId: result.taskId,
                });

                bindCurrentImageAnchorTask(board, result.taskId, {
                  workflowId: workflow.id,
                  batchId: step.options?.batchId,
                  batchIndex: step.options?.batchIndex,
                });
              } else if (currentStepStatus === 'running') {
                const normalizedResultData =
                  result.type === 'text' &&
                  result.data &&
                  typeof result.data === 'object' &&
                  'content' in result.data
                    ? { content: (result.data as { content?: string }).content }
                    : result.data;
                // 同步模式且未被回调更新：标记为完成
                workflowControl.updateStep(
                  step.id,
                  'completed',
                  normalizedResultData,
                  undefined,
                  Date.now() - stepStartTime
                );

                const responseText =
                  step.mcp === 'generate_text'
                    ? (result.data as { content?: string })?.content
                    : step.mcp === 'ai_analyze'
                    ? (result.data as { response?: string })?.response
                    : undefined;

                const shouldInsertReturnedText =
                  (step.mcp === 'generate_text' || step.mcp === 'ai_analyze') &&
                  responseText &&
                  responseText.trim() &&
                  pendingNewSteps.length === pendingStepsBeforeExec;

                if (shouldInsertReturnedText) {
                  const insertStepId = `${step.id}-insert-text`;
                  const insertStep = {
                    id: insertStepId,
                    mcp: 'insert_to_canvas',
                    args: {
                      items: [
                        {
                          type: 'text',
                          content: responseText,
                        },
                      ],
                    },
                    description:
                      step.mcp === 'generate_text'
                        ? '将生成文本插入画布'
                        : '将 AI 回复插入画布',
                    status: 'pending' as const,
                  };
                  workflowControl.addSteps([insertStep]);
                  pendingNewSteps.push(insertStep);
                }
              }

              return true; // 返回成功
            } catch (stepError) {
              // 更新步骤为失败
              workflowControl.updateStep(
                step.id,
                'failed',
                undefined,
                String(stepError)
              );
              return false; // 返回失败
            } finally {
              // 同步更新 ChatDrawer 和 WorkZone
              syncWorkflowUpdates();
            }
          };

          // 执行初始步骤
          for (const step of workflow.steps) {
            // 如果工作流已失败，跳过剩余步骤
            if (workflowFailed) {
              workflowControl.updateStep(step.id, 'skipped');
              syncWorkflowUpdates();
              continue;
            }

            const success = await executeStep(step);
            if (!success) {
              workflowFailed = true;
            }
          }

          // 执行动态添加的步骤（由 ai_analyze 通过 onAddSteps 添加）
          if (!workflowFailed && pendingNewSteps.length > 0) {
            // console.log(`[AIInputBar] Executing ${pendingNewSteps.length} dynamically added steps`);

            // 获取当前工作流状态用于调试
            const currentWorkflow = workflowControl.getWorkflow();
            // console.log(`[AIInputBar] Current workflow steps:`, currentWorkflow?.steps.map(s => ({ id: s.id, mcp: s.mcp, status: s.status })));
            // console.log(`[AIInputBar] Pending steps to execute:`, pendingNewSteps.map(s => ({ id: s.id, mcp: s.mcp })));

            for (const newStep of pendingNewSteps) {
              if (workflowFailed) {
                workflowControl.updateStep(newStep.id, 'skipped');
                syncWorkflowUpdates();
                continue;
              }

              // 从 workflowControl 获取完整的步骤信息
              const fullStep = workflowControl
                .getWorkflow()
                ?.steps.find((s) => s.id === newStep.id);
              // console.log(`[AIInputBar] Looking for step ${newStep.id}, found:`, fullStep ? 'yes' : 'no', 'status:', fullStep?.status);

              if (!fullStep) {
                console.warn(
                  `[AIInputBar] Step ${newStep.id} not found in workflow!`
                );
                continue;
              }

              // 如果步骤已标记为 completed（如 long-video-generation 预创建的任务），跳过执行
              if (fullStep.status === 'completed') {
                // console.log(`[AIInputBar] Skipping already completed step: ${fullStep.mcp}`);
                continue;
              }

              // console.log(`[AIInputBar] Executing dynamic step: ${fullStep.mcp}`, fullStep.args);
              const success = await executeStep(fullStep);
              if (!success) {
                workflowFailed = true;
              }
            }
          }
          // 检查工作流是否已完成（所有步骤都是 completed 或 failed/skipped）
          // 如果没有创建任务（createdTaskIds 为空），则立即删除 WorkZone
          const finalWorkflow = workflowControl.getWorkflow();
          const allStepsFinished = finalWorkflow?.steps.every(
            (s) =>
              s.status === 'completed' ||
              s.status === 'failed' ||
              s.status === 'skipped'
          );
          const hasCreatedTasks = createdTaskIds.length > 0;

          if (allStepsFinished && !hasCreatedTasks) {
            // 所有步骤都已完成且没有创建任务，立即删除 WorkZone
            const workZoneId = currentWorkZoneIdRef.current;
            const imageAnchorIds = currentImageAnchorIdsRef.current;
            const board = SelectionWatcherBoardRef.current;
            if ((workZoneId || imageAnchorIds.length > 0) && board) {
              // 检查是否所有后处理都已完成
              const allPostProcessingFinished = finalWorkflow?.steps.every(
                (step) => {
                  const stepResult = step.result as
                    | { taskId?: string }
                    | undefined;
                  if (stepResult?.taskId) {
                    const isCompleted =
                      workflowCompletionService.isPostProcessingCompleted(
                        stepResult.taskId
                      );
                    // console.log(`[AIInputBar] Task ${stepResult.taskId} post-processing finished:`, isCompleted);
                    return isCompleted;
                  }
                  return true;
                }
              );

              // console.log(`[AIInputBar] WorkZone ${workZoneId} allStepsFinished: ${allStepsFinished}, hasCreatedTasks: ${hasCreatedTasks}, allPostProcessingFinished: ${allPostProcessingFinished}`);

              if (allPostProcessingFinished) {
                // 无队列任务的 image 仍走这里做一次兜底收口；
                // 常规 image anchor 的删除由 useImageGenerationAnchorSync 统一处理。
                setTimeout(() => {
                  if (workZoneId) {
                    WorkZoneTransforms.removeWorkZone(board, workZoneId);
                    currentWorkZoneIdRef.current = null;
                  }
                  if (imageAnchorIds.length > 0) {
                    applyCurrentImageAnchorPresentationState(
                      board,
                      'completed'
                    );
                    removeCurrentImageAnchor(board);
                  }
                }, 1500);
              }
            }
          }
          if (!workflowFailed) {
            finalizeSubmittedBoundDraft(false);
          }
          trackSubmitStatus(workflowFailed ? 'failed' : 'success', {
            submitMode: 'main_thread',
            submit_mode: 'main_thread',
            workflowId: workflow.id,
            workflow_id: workflow.id,
            stepCount: finalWorkflow?.steps.length || workflow.steps.length,
            step_count: finalWorkflow?.steps.length || workflow.steps.length,
            createdTaskCount: createdTaskIds.length,
            created_task_count: createdTaskIds.length,
            failureReason: workflowFailed ? 'workflow_step_failed' : undefined,
            failure_reason: workflowFailed ? 'workflow_step_failed' : undefined,
          });
        } catch (error) {
          console.error('Failed to create generation task:', error);
          trackSubmitStatus('failed', {
            submitMode: 'setup',
            submit_mode: 'setup',
            error: error instanceof Error ? error.message : String(error),
          });
          if (effectiveGenerationType === 'image') {
            applyCurrentImageAnchorPresentationState(
              SelectionWatcherBoardRef.current,
              'failed',
              {
                error:
                  error instanceof Error ? error.message : '创建图片任务失败',
              }
            );
          }
          workflowControl.abortWorkflow();
          submitLockRef.current = false;
          setIsSubmitting(false);
        }
      },
      [
        prompt,
        boundImageTarget,
        boundImageTargetMode,
        boundTargetContent,
        generationContent,
        isSubmitting,
        selectedModel,
        selectedModelRef,
        workflowControl,
        submitWorkflowToSW,
        addPromptHistory,
        selectedParams,
        knowledgeContextRefs,
        agentMediaDefaultModels,
        agentMediaDefaultModelRefs,
        generationType,
        selectedCount,
        selectedSkillId,
        bindCurrentImageAnchorTask,
        applyCurrentImageAnchorPresentationState,
        removeCurrentImageAnchor,
        onEnableRuntime,
        applyTaskbarDraft,
        readCurrentTaskbarDraft,
      ]
    );

    useEffect(() => {
      const submitFromDrawer = async (params: DrawerGenerationSubmitParams) => {
        await handleGenerate({
          prompt: params.prompt,
          content: params.selectedContent.map((item) => ({
            type: item.type,
            url: item.url,
            maskImage: item.maskImage,
            text: item.text,
            name: item.name,
            width: item.width,
            height: item.height,
          })),
          generationType: params.generationType,
          selectedModel: params.selectedModel,
          selectedModelRef: params.selectedModelRef,
          selectedParams: params.selectedParams,
          selectedCount: params.selectedCount,
          appendToCurrentChatSession: true,
        });
      };

      registerGenerationSubmitterRef.current(submitFromDrawer);
      return () => {
        registerGenerationSubmitterRef.current(null);
      };
    }, [handleGenerate]);

    // 处理工作流重试（从指定步骤开始）
    // workZoneId: 从 WorkZone 按钮发起重试时传入的 WorkZone 元素 ID
    const handleWorkflowRetry = useCallback(
      async (
        workflowMessageData: WorkflowMessageData,
        startStepIndex: number,
        workZoneId?: string
      ) => {
        const retryContext = workflowMessageData.retryContext;
        if (!retryContext) {
          console.error('[AIInputBar] No retry context available for workflow');
          return;
        }

        // 关联 WorkZone ID（从 WorkZone 按钮发起的重试需要设置）
        if (workZoneId) {
          currentWorkZoneIdRef.current = workZoneId;
        }

        // console.log(`[AIInputBar] Retrying workflow from step ${startStepIndex}, workZoneId:`, currentWorkZoneIdRef.current);

        // 将 WorkflowMessageData 转换为 WorkflowDefinition（用于内部状态管理）
        const workflowDefinition: WorkflowDefinition = {
          id: workflowMessageData.id,
          name: workflowMessageData.name,
          description: `重试: ${workflowMessageData.name}`,
          scenarioType: workflowMessageData.steps.some(
            (s) => s.mcp === 'ai_analyze'
          )
            ? 'agent_flow'
            : 'direct_generation',
          generationType: workflowMessageData.generationType as GenerationType,
          steps: workflowMessageData.steps.map((step, index) => ({
            id: step.id,
            mcp: step.mcp,
            args: step.args,
            description: step.description,
            // 重置从 startStepIndex 开始的步骤状态
            status: index < startStepIndex ? step.status : 'pending',
            // 保留已完成步骤的结果，清除失败步骤的结果
            result: index < startStepIndex ? step.result : undefined,
            error: index < startStepIndex ? step.error : undefined,
            duration: index < startStepIndex ? step.duration : undefined,
            options: step.options,
          })),
          metadata: {
            prompt: workflowMessageData.prompt,
            userInstruction: retryContext.aiContext.userInstruction,
            rawInput: retryContext.aiContext.rawInput,
            modelId: retryContext.aiContext.model.id,
            modelRef: retryContext.aiContext.modelRef,
            defaultModels: retryContext.aiContext.defaultModels,
            defaultModelRefs: retryContext.aiContext.defaultModelRefs,
            isModelExplicit: retryContext.aiContext.model.isExplicit,
            count: workflowMessageData.count,
            size: retryContext.aiContext.params.size,
            duration: retryContext.aiContext.params.duration,
            referenceImages: retryContext.referenceImages,
            selection: retryContext.aiContext.selection,
            knowledgeContextRefs: retryContext.aiContext.knowledgeContextRefs,
          },
          createdAt: Date.now(),
        };

        // 启动工作流（内部状态管理）
        workflowControl.startWorkflow(workflowDefinition);

        // 添加重试日志
        appendAgentLogRef.current({
          type: 'retry',
          timestamp: Date.now(),
          reason: `从步骤 ${startStepIndex + 1} 开始重试`,
          attempt: 1,
        });

        const board = SelectionWatcherBoardRef.current;

        // 辅助函数：同步更新 ChatDrawer 和 WorkZone
        const syncRetryUpdates = () => {
          const workflowData = toWorkflowMessageData(
            workflowControl.getWorkflow()!,
            retryContext
          );
          updateWorkflowMessageRef.current(workflowData);
          if (currentWorkZoneIdRef.current && board) {
            WorkZoneTransforms.updateWorkflow(
              board,
              currentWorkZoneIdRef.current,
              workflowData
            );
          }
        };

        // 初次更新 ChatDrawer + WorkZone 显示
        const initialWorkflowData = toWorkflowMessageData(
          workflowDefinition,
          retryContext
        );
        updateWorkflowMessageRef.current(initialWorkflowData);
        if (currentWorkZoneIdRef.current && board) {
          WorkZoneTransforms.updateWorkflow(
            board,
            currentWorkZoneIdRef.current,
            initialWorkflowData
          );
        }

        // 创建标准回调
        const createStepCallbacks = (
          currentStep: (typeof workflowDefinition.steps)[0],
          stepStartTime: number
        ) => ({
          onChunk: (chunk: string) => {
            updateThinkingContentRef.current(chunk);
          },
          onAddSteps: (
            newSteps: Array<{
              id: string;
              mcp: string;
              args: Record<string, unknown>;
              description: string;
              status: string;
            }>
          ) => {
            workflowControl.updateStep(
              currentStep.id,
              'completed',
              { analysis: 'completed' },
              undefined,
              Date.now() - stepStartTime
            );
            const stepsWithOptions = newSteps.map((s, index) =>
              enrichStepArgsWithPromptMeta(workflowDefinition, {
                ...s,
                status: (s.status === 'completed' ? 'completed' : 'pending') as
                  | 'pending'
                  | 'completed',
                options: {
                  mode: 'queue' as const,
                  batchId: `agent_${Date.now()}`,
                  batchIndex: index + 1,
                  batchTotal: newSteps.length,
                  globalIndex: index + 1,
                },
              })
            );
            workflowControl.addSteps(stepsWithOptions);
            pendingNewStepsForRetry.push(...stepsWithOptions);
            newSteps.forEach((s) => {
              appendAgentLogRef.current({
                type: 'tool_call',
                timestamp: Date.now(),
                toolName: s.mcp,
                args: s.args,
              });
            });
            syncRetryUpdates();
          },
          onUpdateStep: (
            stepId: string,
            status: string,
            result?: unknown,
            error?: string
          ) => {
            workflowControl.updateStep(
              stepId,
              status as
                | 'pending'
                | 'running'
                | 'completed'
                | 'failed'
                | 'skipped',
              result,
              error
            );
            appendAgentLogRef.current({
              type: 'tool_result',
              timestamp: Date.now(),
              toolName: stepId,
              success: status === 'completed',
              data: result,
              error,
            });
            syncRetryUpdates();
          },
        });

        // 收集动态添加的步骤
        const pendingNewStepsForRetry: Array<{
          id: string;
          mcp: string;
          args: Record<string, unknown>;
          description: string;
          options?: WorkflowStepOptions;
        }> = [];

        let workflowFailed = false;

        // 从原始步骤中获取任务 ID 的映射（用于重试时复用任务）
        const stepTaskIdMap = new Map<string, string>();
        workflowMessageData.steps.forEach((step) => {
          const taskId = (step.result as { taskId?: string })?.taskId;
          if (taskId) {
            stepTaskIdMap.set(step.id, taskId);
          }
        });

        // 执行单个步骤
        const executeStep = async (
          step: (typeof workflowDefinition.steps)[0]
        ) => {
          const stepStartTime = Date.now();
          // 记录执行前的动态步骤数量，用于判断 ai_analyze 是否触发了 onAddSteps
          const pendingStepsBeforeExec = pendingNewStepsForRetry.length;
          workflowControl.updateStep(step.id, 'running');
          syncRetryUpdates();

          try {
            // 获取原始步骤的任务 ID（如果有的话，用于重试时复用任务）
            const retryTaskId = stepTaskIdMap.get(step.id);

            const executeOptions = {
              ...step.options,
              ...createStepCallbacks(step, stepStartTime),
              // 如果有原始任务 ID，传递给 MCP 工具以复用任务
              ...(retryTaskId ? { retryTaskId } : {}),
            };
            const executableStep = enrichStepArgsWithPromptMeta(
              workflowDefinition,
              step
            );
            const result = (await mcpRegistry.executeTool(
              { name: executableStep.mcp, arguments: executableStep.args },
              executeOptions
            )) as MCPTaskResult;

            const currentStepStatus = workflowControl
              .getWorkflow()
              ?.steps.find((s) => s.id === step.id)?.status;

            if (!result.success) {
              workflowControl.updateStep(
                step.id,
                'failed',
                undefined,
                result.error || '执行失败',
                Date.now() - stepStartTime
              );
              return false;
            } else if (result.taskId) {
              workflowControl.updateStep(step.id, 'running', {
                taskId: result.taskId,
              });

              bindCurrentImageAnchorTask(board, result.taskId, {
                workflowId: workflowMessageData.id,
                batchId: step.options?.batchId,
                batchIndex: step.options?.batchIndex,
              });
            } else if (currentStepStatus === 'running') {
              const normalizedResultData =
                result.type === 'text' &&
                result.data &&
                typeof result.data === 'object' &&
                'content' in result.data
                  ? { content: (result.data as { content?: string }).content }
                  : result.data;
              workflowControl.updateStep(
                step.id,
                'completed',
                normalizedResultData,
                undefined,
                Date.now() - stepStartTime
              );

              const responseText =
                step.mcp === 'generate_text'
                  ? (result.data as { content?: string })?.content
                  : step.mcp === 'ai_analyze'
                  ? (result.data as { response?: string })?.response
                  : undefined;

              const shouldInsertReturnedText =
                (step.mcp === 'generate_text' || step.mcp === 'ai_analyze') &&
                responseText &&
                responseText.trim() &&
                pendingNewStepsForRetry.length === pendingStepsBeforeExec;

              if (shouldInsertReturnedText) {
                const insertStepId = `${step.id}-insert-text`;
                const insertStep = {
                  id: insertStepId,
                  mcp: 'insert_to_canvas',
                  args: {
                    items: [
                      {
                        type: 'text',
                        content: responseText,
                      },
                    ],
                  },
                  description:
                    step.mcp === 'generate_text'
                      ? '将生成文本插入画布'
                      : '将 AI 回复插入画布',
                  status: 'pending' as const,
                };
                workflowControl.addSteps([insertStep]);
                pendingNewStepsForRetry.push(insertStep);
              }
            }
            return true;
          } catch (stepError) {
            workflowControl.updateStep(
              step.id,
              'failed',
              undefined,
              String(stepError)
            );
            return false;
          } finally {
            syncRetryUpdates();
          }
        };

        // 执行步骤（从 startStepIndex 开始）
        const stepsToExecute = workflowDefinition.steps.slice(startStepIndex);
        for (const step of stepsToExecute) {
          if (workflowFailed) {
            workflowControl.updateStep(step.id, 'skipped');
            syncRetryUpdates();
            continue;
          }
          const success = await executeStep(step);
          if (!success) {
            workflowFailed = true;
          }
        }

        // 执行动态添加的步骤
        if (!workflowFailed && pendingNewStepsForRetry.length > 0) {
          // console.log(`[AIInputBar] Executing ${pendingNewStepsForRetry.length} dynamically added steps during retry`);
          for (const newStep of pendingNewStepsForRetry) {
            if (workflowFailed) {
              workflowControl.updateStep(newStep.id, 'skipped');
              syncRetryUpdates();
              continue;
            }
            const fullStep = workflowControl
              .getWorkflow()
              ?.steps.find((s) => s.id === newStep.id);
            if (!fullStep) {
              continue;
            }
            // 如果步骤已标记为 completed（如 long-video-generation 预创建的任务），跳过执行
            if (fullStep.status === 'completed') {
              // console.log(`[AIInputBar] Skipping already completed step during retry: ${fullStep.mcp}`);
              continue;
            }
            const success = await executeStep(fullStep);
            if (!success) {
              workflowFailed = true;
            }
          }
        }

        // 检查工作流是否已完成（所有步骤都是 completed 或 failed/skipped）
        // 如果没有创建任务，则立即删除 WorkZone
        const finalWorkflow = workflowControl.getWorkflow();
        const allStepsFinished = finalWorkflow?.steps.every(
          (s) =>
            s.status === 'completed' ||
            s.status === 'failed' ||
            s.status === 'skipped'
        );
        // 检查是否有任何步骤创建了任务（通过检查 result.taskId）
        const hasCreatedTasks = finalWorkflow?.steps.some(
          (s) => (s.result as { taskId?: string })?.taskId
        );

        if (allStepsFinished && !hasCreatedTasks) {
          // 所有步骤都已完成且没有创建任务，立即删除 WorkZone
          const retryWorkZoneId = currentWorkZoneIdRef.current;
          const retryBoard = SelectionWatcherBoardRef.current;
          if (retryWorkZoneId && retryBoard) {
            // 检查是否所有后处理都已完成
            const allPostProcessingFinished = finalWorkflow?.steps.every(
              (step) => {
                const stepResult = step.result as
                  | { taskId?: string }
                  | undefined;
                if (stepResult?.taskId) {
                  const isCompleted =
                    workflowCompletionService.isPostProcessingCompleted(
                      stepResult.taskId
                    );
                  return isCompleted;
                }
                return true;
              }
            );

            if (allPostProcessingFinished) {
              // 延迟删除，让用户看到完成状态
              setTimeout(() => {
                WorkZoneTransforms.removeWorkZone(retryBoard, retryWorkZoneId);
                currentWorkZoneIdRef.current = null;
              }, 1500);
            }
          }
        }

        // console.log('[AIInputBar] Retry workflow completed, failed:', workflowFailed);
      },
      [workflowControl, bindCurrentImageAnchorTask]
    );

    useEffect(() => {
      registerRetryHandlerRef.current(handleWorkflowRetry);
      // 同时挂载到 board 上，供 WorkZoneComponent 使用
      const board = SelectionWatcherBoardRef.current;
      if (board) {
        (board as any).__executeWorkflowRetry = handleWorkflowRetry;
      }
    }, [handleWorkflowRetry]);

    // Handle key press
    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent) => {
        if (event.nativeEvent.isComposing) {
          return;
        }

        if (
          (modelDropdownOpen || paramsDropdownOpen || countDropdownOpen) &&
          (event.key === 'Enter' || event.key === 'Tab')
        ) {
          // 下拉菜单打开时，回车交由菜单处理，避免触发表单提交
          event.preventDefault();
          return;
        }

        const suggestion = promptSuggestionRef.current;
        const suggestionAction = resolveBoundTargetPromptSuggestionAction({
          suggestion,
          currentPrompt: promptRef.current,
          key: event.key,
          code: event.code,
          isComposing: event.nativeEvent.isComposing,
          hasModifier:
            event.shiftKey || event.altKey || event.ctrlKey || event.metaKey,
        });
        if (suggestionAction === 'reuse') {
          event.preventDefault();
          const nextPrompt = suggestion || '';
          promptRef.current = nextPrompt;
          setPrompt(nextPrompt);
          dismissPromptSuggestion();
          setIsInspirationSendGuideActive(false);
          requestAnimationFrame(() => {
            const input = inputRef.current;
            if (!input) return;
            input.selectionStart = input.value.length;
            input.selectionEnd = input.value.length;
          });
          return;
        }
        if (suggestionAction === 'dismiss') {
          dismissPromptSuggestion();
        }

        if (event.key === 'Enter' && (event.shiftKey || event.altKey)) {
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          analytics.track('ai_input_submit_keyboard');
          handleGenerate('keyboard');
          return;
        }

        if (event.key === 'Escape') {
          setIsFocused(false);
          inputRef.current?.blur();
          return;
        }
      },
      [
        countDropdownOpen,
        dismissPromptSuggestion,
        handleGenerate,
        modelDropdownOpen,
        paramsDropdownOpen,
      ]
    );

    // Handle input focus
    const handleFocus = useCallback(() => {
      analytics.track('ai_input_focus_textarea');
      setIsFocused(true);
    }, []);

    // Handle input blur
    const handleBlur = useCallback(() => {
      analytics.track('ai_input_blur_textarea');
      setIsFocused(false);
    }, []);

    const handleTogglePromptExpanded = useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsPromptManuallyExpanded((expanded) => !expanded);
        setIsFocused(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      },
      []
    );

    // 处理输入变化，检测特殊符号触发下拉菜单
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const cursorPos = e.target.selectionStart || newValue.length;
        dismissPromptSuggestion();
        promptRef.current = newValue;
        setPrompt(newValue);
        setIsInspirationSendGuideActive(false);

        // 检测光标前最后一个字符
        if (cursorPos > 0) {
          const lastChar = newValue[cursorPos - 1];
          // 检查前一个字符是否为空格或在行首（即符号前没有其他字母）
          const charBefore = cursorPos > 1 ? newValue[cursorPos - 2] : ' ';
          const isValidTrigger =
            charBefore === ' ' || charBefore === '\n' || cursorPos === 1;

          if (lastChar === '#' && isValidTrigger) {
            triggerPositionRef.current = cursorPos - 1;
            setModelDropdownOpen(true);
            setParamsDropdownOpen(false);
            setCountDropdownOpen(false);
          }
        }
      },
      [dismissPromptSuggestion]
    );

    const handleTaskbarControlPointerDown = useCallback(
      (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest('textarea')) return;
        if (target.closest('button, [role="button"], input, select')) {
          dismissPromptSuggestion();
        }
      },
      [dismissPromptSuggestion]
    );

    const sendButtonTrackParams = useMemo(
      () =>
        JSON.stringify({
          generationType,
          model: selectedModel,
          profileId: selectedModelRef?.profileId || null,
          hasAttachedContent: displayContent.length > 0,
          attachedCount: displayContent.length,
          knowledgeContextCount: knowledgeContextRefs.length,
          promptLengthBucket: getPromptLengthBucket(prompt.trim().length),
        }),
      [
        displayContent.length,
        generationType,
        knowledgeContextRefs.length,
        prompt,
        selectedModel,
        selectedModelRef?.profileId,
      ]
    );
    const canGenerate =
      prompt.trim().length > 0 || generationContent.length > 0;
    const shouldHighlightInspirationSend =
      isInspirationSendGuideActive && canGenerate && !isSubmitting;
    const showInspirationBoard = isCanvasEmpty === true;
    const hasSelectedTextContent = selectedContent.some(
      (item) => item.type === 'text' && item.text?.trim()
    );
    const hasUnsubmittedInputContent =
      prompt.length > 0 ||
      Boolean(promptSuggestion) ||
      displayContent.length > 0 ||
      knowledgeContextRefs.length > 0;
    const shouldKeepExpanded =
      isPromptManuallyExpanded ||
      isFocused ||
      hasUnsubmittedInputContent ||
      isPromptOptimizeOpen;
    const inputResizeMode: AIInputResizeMode = isPromptManuallyExpanded
      ? 'long-text'
      : shouldKeepExpanded
      ? 'expanded'
      : 'collapsed';
    const promptExpandLabel = isPromptManuallyExpanded
      ? language === 'zh'
        ? '收起提示词输入框'
        : 'Collapse prompt input'
      : language === 'zh'
      ? '展开提示词输入框'
      : 'Expand prompt input';

    useLayoutEffect(() => {
      const textarea = inputRef.current;
      if (!textarea) return;

      const shouldShowExpandButton =
        getTextareaContentRows(textarea) > AI_INPUT_PROMPT_EXPAND_TRIGGER_ROWS;
      setCanPromptManuallyExpand(shouldShowExpandButton);
      if (!shouldShowExpandButton && isPromptManuallyExpanded) {
        setIsPromptManuallyExpanded(false);
        resizeAIInputTextarea(
          textarea,
          shouldKeepExpanded ? 'expanded' : 'collapsed'
        );
        return;
      }

      resizeAIInputTextarea(textarea, inputResizeMode);
    }, [inputResizeMode, isPromptManuallyExpanded, prompt, shouldKeepExpanded]);

    const positionedBoundImageTarget = resolveBoundTargetForPosition(
      followedBoundImageTarget,
      boundTargetFollowEnabled
    );
    const boundInputPosition = useMemo(() => {
      if (!positionedBoundImageTarget) return null;

      const board = SelectionWatcherBoardRef.current;
      const boardContainer = board
        ? board.host || PlaitBoard.getBoardContainer(board)
        : null;
      const boardRect = boardContainer?.getBoundingClientRect();
      if (!boardRect) return null;

      const zoom = board?.viewport?.zoom || 1;
      const origination = getViewportOrigination(board);
      const originX = origination?.[0] || 0;
      const originY = origination?.[1] || 0;
      const targetCenterX =
        boardRect.left +
        (positionedBoundImageTarget.rect.x +
          positionedBoundImageTarget.rect.width / 2 -
          originX) *
          zoom;
      const targetBottom =
        boardRect.top +
        (positionedBoundImageTarget.rect.y +
          positionedBoundImageTarget.rect.height -
          originY) *
          zoom;
      const targetTop =
        boardRect.top + (positionedBoundImageTarget.rect.y - originY) * zoom;
      const viewportMargin = 12;
      const barWidth = getBoundTaskbarWidth(
        containerRef.current?.getBoundingClientRect().width,
        window.innerWidth
      );
      const left = Math.min(
        Math.max(targetCenterX, viewportMargin + barWidth / 2),
        window.innerWidth - viewportMargin - barWidth / 2
      );
      const estimatedHeight = shouldKeepExpanded ? 112 : 76;
      const belowTop = targetBottom + 8;
      const top =
        belowTop + estimatedHeight <= window.innerHeight - viewportMargin
          ? belowTop
          : Math.max(viewportMargin, targetTop - estimatedHeight - 8);

      return { left, top };
    }, [boundInputLayoutTick, positionedBoundImageTarget, shouldKeepExpanded]);

    const followControlsTarget =
      followedBoundImageTarget &&
      supportsBoundTargetFollowControls(followedBoundImageTarget.type)
        ? followedBoundImageTarget
        : null;
    const followControlsTargetType = followControlsTarget?.type;
    const boundTargetFollowCopy = useMemo(() => {
      if (language === 'zh') {
        if (followControlsTargetType === 'text') {
          return {
            hint: '关闭跟随，当前文本仍作上下文',
            once: '本次只作上下文',
            always: '对此文本始终只作上下文',
            stop: '关闭任务栏跟随',
          };
        }
        if (followControlsTargetType === 'video') {
          return {
            hint: '关闭跟随，当前视频仍作参考视频',
            once: '本次只作参考视频',
            always: '对此视频始终只作参考视频',
            stop: '关闭任务栏跟随',
          };
        }
        return {
          hint: '关闭跟随，当前图仍作参考图',
          once: '本次只作参考图',
          always: '对此图始终只作参考图',
          stop: '关闭任务栏跟随',
        };
      }

      if (followControlsTargetType === 'text') {
        return {
          hint: 'Stop following; keep this text as context',
          once: 'Use as context this time',
          always: 'Always use this text as context',
          stop: 'Stop following this text',
        };
      }
      if (followControlsTargetType === 'video') {
        return {
          hint: 'Stop following; keep this video as a reference',
          once: 'Use this video as a reference this time',
          always: 'Always use this video as reference',
          stop: 'Stop following this video',
        };
      }
      return {
        hint: 'Stop following; keep this reference',
        once: 'Use as reference this time',
        always: 'Always use this image as reference',
        stop: 'Stop following this image',
      };
    }, [followControlsTargetType, language]);
    const boundTargetDismissOptions = useMemo<DropdownOption[]>(
      () => [
        {
          content: boundTargetFollowCopy.once,
          value: 'once',
          prefixIcon: <Unlink size={14} aria-hidden="true" />,
        },
        {
          content: boundTargetFollowCopy.always,
          value: 'always',
          prefixIcon: <PinOff size={14} aria-hidden="true" />,
        },
      ],
      [boundTargetFollowCopy]
    );

    const boundInputStyle = boundInputPosition
      ? ({
          left: `${boundInputPosition.left}px`,
          top: `${boundInputPosition.top}px`,
          bottom: 'auto',
        } as React.CSSProperties)
      : undefined;

    const selectedContentPreview =
      displayContent.length > 0 ? (
        <SelectedContentPreview
          items={displayContent}
          language={language}
          enableHoverPreview={true}
          onRemove={handleRemoveUploadedContent}
          removableStartIndex={uploadedContent.length}
        />
      ) : null;
    const composerPreview = boundTargetError ? (
      <>
        <div className="ai-input-bar__bound-status ai-input-bar__bound-status--failed">
          {boundTargetError}
        </div>
        {selectedContentPreview}
      </>
    ) : (
      selectedContentPreview
    );

    return (
      <>
        {confirmDialog}
        <div
          ref={containerRef}
          className={classNames(
            'ai-input-bar',
            ATTACHED_ELEMENT_CLASS_NAME,
            className,
            {
              'ai-input-bar--with-inspiration': showInspirationBoard,
              'ai-input-bar--bound-image': Boolean(boundInputPosition),
            }
          )}
          style={boundInputStyle}
          onPointerDownCapture={handleTaskbarControlPointerDown}
          data-testid="ai-input-bar"
        >
          <SelectionWatcher
            language={language}
            currentBoardId={currentBoardId}
            onSelectionChange={handleSelectionChange}
            onBoundImageTargetChange={handleBoundImageTargetChange}
            onBoundInputViewportChange={handleBoundInputViewportChange}
            externalBoardRef={SelectionWatcherBoardRef}
            onCanvasEmptyChange={setIsCanvasEmpty}
            isDataReady={isDataReady}
            onFrameSelected={handleFrameSelected}
          />

          <InspirationBoard
            isCanvasEmpty={showInspirationBoard}
            onSelectPrompt={handleSelectInspirationPrompt}
            onOpenPromptTool={handleOpenPromptToolFromInspiration}
          />

          {followControlsTarget ? (
            <div className="ai-input-bar__bound-dismiss">
              {boundTargetFollowEnabled &&
              boundTargetDismissHintCount < BOUND_TARGET_DISMISS_HINT_LIMIT ? (
                <div className="ai-input-bar__bound-dismiss-hint" role="status">
                  {boundTargetFollowCopy.hint}
                </div>
              ) : null}
              <div className="ai-input-bar__bound-dismiss-actions">
                <HoverTip
                  content={
                    boundTargetFollowEnabled
                      ? language === 'zh'
                        ? '任务栏跟随已开启'
                        : 'Taskbar follow is on'
                      : language === 'zh'
                      ? '任务栏跟随已关闭'
                      : 'Taskbar follow is off'
                  }
                  showArrow={false}
                >
                  <span
                    className="ai-input-bar__bound-follow-toggle"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <Switch
                      size="small"
                      value={boundTargetFollowEnabled}
                      label={
                        <span className="ai-input-bar__bound-follow-label">
                          {language === 'zh' ? '任务栏跟随' : 'Taskbar follow'}
                        </span>
                      }
                      onChange={(checked) =>
                        handleBoundTargetFollowChange(checked as boolean)
                      }
                    />
                  </span>
                </HoverTip>
                {boundTargetFollowEnabled ? (
                  <>
                    <HoverTip
                      content={boundTargetFollowCopy.stop}
                      showArrow={false}
                    >
                      <button
                        type="button"
                        className="ai-input-bar__bound-dismiss-btn"
                        aria-label={boundTargetFollowCopy.once}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={() => handleDismissBoundTarget('once')}
                        disabled={isSubmitting}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </HoverTip>
                    <Dropdown
                      options={boundTargetDismissOptions}
                      trigger="click"
                      placement="top-right"
                      minColumnWidth={190}
                      onClick={(data) =>
                        handleDismissBoundTarget(
                          data.value as BoundTargetDismissMode
                        )
                      }
                    >
                      <button
                        type="button"
                        className="ai-input-bar__bound-dismiss-menu-btn"
                        aria-label={
                          language === 'zh'
                            ? '选择跟随方式'
                            : 'Choose follow behavior'
                        }
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        disabled={isSubmitting}
                      >
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                    </Dropdown>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <AIInputComposerShell
            variant="canvas"
            expanded={shouldKeepExpanded}
            longText={isPromptManuallyExpanded}
            disabled={isSubmitting}
            leftTools={
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />

                <HoverTip
                  content={language === 'zh' ? '上传图片' : 'Upload images'}
                  showArrow={false}
                >
                  <button
                    className="ai-input-bar__upload-btn"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={handleUploadClick}
                    data-track="ai_input_click_upload"
                  >
                    <ImageUploadIcon size={18} />
                  </button>
                </HoverTip>

                <HoverTip
                  content={
                    language === 'zh' ? '从素材库选择' : 'Select from library'
                  }
                  showArrow={false}
                >
                  <button
                    className="ai-input-bar__library-btn"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => setShowMediaLibrary(true)}
                    data-track="ai_input_click_library"
                  >
                    <MediaLibraryIcon size={18} />
                  </button>
                </HoverTip>

                <KnowledgeNoteContextSelector
                  value={knowledgeContextRefs}
                  onChange={handleKnowledgeContextChange}
                  disabled={isSubmitting}
                  language={language}
                  variant="compact"
                  className="ai-input-bar__knowledge-selector"
                />
              </>
            }
            controls={
              <>
                <GenerationTypeDropdown
                  value={generationType}
                  onSelect={setGenerationType}
                  disabled={isSubmitting}
                />

                {/* Skill 下拉框：仅在 Agent 模式下显示 */}
                {generationType === 'agent' && (
                  <SkillDropdown
                    value={selectedSkillId}
                    onSelect={setSelectedSkillId}
                    onSelectSkill={handleSkillOptionSelect}
                    onAddSkill={handleAddSkill}
                    disabled={isSubmitting}
                  />
                )}

                <ModelDropdown
                  selectedModel={selectedModel}
                  selectedSelectionKey={getSelectionKey(
                    selectedModel,
                    selectedModelRef
                  )}
                  onSelect={handleModelSelect}
                  onSelectModel={handleModelConfigSelect}
                  language={language}
                  models={currentModels}
                  header={
                    language === 'zh'
                      ? generationType === 'agent'
                        ? '选择文本模型 (↑↓ Tab)'
                        : '选择模型 (↑↓ Tab)'
                      : generationType === 'agent'
                      ? 'Select text model (↑↓ Tab)'
                      : 'Select model (↑↓ Tab)'
                  }
                  isOpen={modelDropdownOpen}
                  onOpenChange={handleModelDropdownChange}
                />

                {generationType === 'agent' &&
                  selectedSkillId !== SKILL_AUTO_ID &&
                  selectedSkillMediaTypes.includes('image') && (
                    <ModelDropdown
                      selectedModel={selectedAgentImageModel}
                      selectedSelectionKey={getSelectionKey(
                        selectedAgentImageModel,
                        selectedAgentImageModelRef
                      )}
                      onSelect={(modelId, modelRef) =>
                        handleAgentMediaModelSelect('image', modelId, modelRef)
                      }
                      onSelectModel={(model) =>
                        handleAgentMediaModelConfigSelect('image', model)
                      }
                      language={language}
                      models={visibleAgentImageModels}
                      header={
                        language === 'zh'
                          ? '选择图片模型 (↑↓ Tab)'
                          : 'Select image model (↑↓ Tab)'
                      }
                    />
                  )}

                {generationType === 'agent' &&
                  selectedSkillId !== SKILL_AUTO_ID &&
                  selectedSkillMediaTypes.includes('video') && (
                    <ModelDropdown
                      selectedModel={selectedAgentVideoModel}
                      selectedSelectionKey={getSelectionKey(
                        selectedAgentVideoModel,
                        selectedAgentVideoModelRef
                      )}
                      onSelect={(modelId, modelRef) =>
                        handleAgentMediaModelSelect('video', modelId, modelRef)
                      }
                      onSelectModel={(model) =>
                        handleAgentMediaModelConfigSelect('video', model)
                      }
                      language={language}
                      models={visibleAgentVideoModels}
                      header={
                        language === 'zh'
                          ? '选择视频模型 (↑↓ Tab)'
                          : 'Select video model (↑↓ Tab)'
                      }
                    />
                  )}

                {generationType === 'agent' &&
                  selectedSkillId !== SKILL_AUTO_ID &&
                  selectedSkillMediaTypes.includes('audio') && (
                    <ModelDropdown
                      selectedModel={selectedAgentAudioModel}
                      selectedSelectionKey={getSelectionKey(
                        selectedAgentAudioModel,
                        selectedAgentAudioModelRef
                      )}
                      onSelect={(modelId, modelRef) =>
                        handleAgentMediaModelSelect('audio', modelId, modelRef)
                      }
                      onSelectModel={(model) =>
                        handleAgentMediaModelConfigSelect('audio', model)
                      }
                      language={language}
                      models={visibleAgentAudioModels}
                      header={
                        language === 'zh'
                          ? '选择音频模型 (↑↓ Tab)'
                          : 'Select audio model (↑↓ Tab)'
                      }
                    />
                  )}

                {/* Parameters dropdown selector - Hidden for Agent mode */}
                {generationType !== 'agent' && compatibleParams.length > 0 && (
                  <ParametersDropdown
                    key={selectedModel} // 强制在模型切换时重新挂载以刷新可配置参数
                    selectedParams={selectedParams}
                    onParamChange={handleParamSelect}
                    compatibleParams={compatibleParams}
                    modelId={selectedModel}
                    language={language}
                    isOpen={paramsDropdownOpen}
                    onOpenChange={handleParamsDropdownChange}
                  />
                )}

                {generationType !== 'agent' &&
                  generationType !== 'text' &&
                  generationType !== 'audio' && (
                    <CountDropdown
                      value={selectedCount}
                      onSelect={handleCountSelect}
                      disabled={isSubmitting}
                      isOpen={countDropdownOpen}
                      onOpenChange={handleCountDropdownChange}
                    />
                  )}
              </>
            }
            sendButton={
              <button
                className={classNames('ai-input-bar__send-btn', {
                  active: canGenerate,
                  loading: isSubmitting,
                  'ai-input-bar__send-btn--guide':
                    shouldHighlightInspirationSend,
                })}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={() => handleGenerate('button')}
                disabled={!canGenerate || isSubmitting}
                data-track="ai_input_click_send"
                data-track-params={sendButtonTrackParams}
                data-testid="ai-send-btn"
              >
                <Send size={18} />
              </button>
            }
            preview={composerPreview}
            textarea={
              <>
                <div className="ai-input-bar__rich-input">
                  {canPromptManuallyExpand ? (
                    <HoverTip content={promptExpandLabel} showArrow={false}>
                      <button
                        type="button"
                        className={classNames(
                          'ai-input-bar__prompt-expand-btn',
                          {
                            'ai-input-bar__prompt-expand-btn--active':
                              isPromptManuallyExpanded,
                          }
                        )}
                        aria-label={promptExpandLabel}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={handleTogglePromptExpanded}
                        disabled={isSubmitting}
                      >
                        {isPromptManuallyExpanded ? (
                          <Minimize2 size={13} aria-hidden="true" />
                        ) : (
                          <Maximize2 size={13} aria-hidden="true" />
                        )}
                      </button>
                    </HoverTip>
                  ) : null}
                  <textarea
                    ref={inputRef}
                    className={classNames('ai-input-bar__input', {
                      'ai-input-bar__input--focused': shouldKeepExpanded,
                      'ai-input-bar__input--long-text':
                        isPromptManuallyExpanded,
                      'ai-input-bar__input--suggestion':
                        Boolean(promptSuggestion),
                    })}
                    value={prompt}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    placeholder={
                      promptSuggestion
                        ? formatBoundTargetPromptSuggestion(
                            promptSuggestion,
                            language === 'zh' ? 'zh' : 'en'
                          )
                        : generationType === 'agent'
                        ? language === 'zh'
                          ? '输入指令，让 Agent 为你工作...'
                          : 'Type instructions for Agent...'
                        : generationType === 'text'
                        ? language === 'zh'
                          ? '输入你想生成的文本内容、文章、摘要或 Markdown'
                          : 'Describe the text, article, summary, or markdown you want'
                        : generationType === 'audio'
                        ? hasSelectedTextContent
                          ? language === 'zh'
                            ? '已有文本，无需额外提示词，直接发送'
                            : 'Text already selected. No extra prompt needed, just send'
                          : language === 'zh'
                          ? '描述你想要生成的音乐、风格、歌词或情绪'
                          : 'Describe the music, style, lyrics, or mood you want'
                        : language === 'zh'
                        ? `描述你想要创建的${
                            generationType === 'image' ? '图片' : '视频'
                          }`
                        : `Describe the ${
                            generationType === 'image' ? 'image' : 'video'
                          } you want to create`
                    }
                    rows={
                      isPromptManuallyExpanded
                        ? AI_INPUT_LONG_TEXT_ROWS
                        : shouldKeepExpanded
                        ? AI_INPUT_EXPANDED_ROWS
                        : AI_INPUT_COLLAPSED_ROWS
                    }
                    disabled={isSubmitting}
                    data-testid="ai-input-textarea"
                  />
                </div>

                <PromptHistoryPopover
                  generationType={generationType}
                  onSelectPrompt={handleSelectHistoryPrompt}
                  language={language}
                  onBeforeOpenMyPrompts={onEnableToolWindows}
                  extraActions={
                    shouldKeepExpanded ? (
                      <PromptOptimizeButton
                        className="prompt-history-popover__action-btn"
                        originalPrompt={prompt}
                        language={language}
                        scenarioId={`ai-input.${generationType}` as const}
                        disabled={isSubmitting}
                        allowStructuredMode={true}
                        onOpenChange={setIsPromptOptimizeOpen}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setIsFocused(true);
                        }}
                        onApply={(optimizedPrompt) => {
                          dismissPromptSuggestion();
                          promptRef.current = optimizedPrompt;
                          setPrompt(optimizedPrompt);
                          setIsFocused(true);
                          requestAnimationFrame(() => {
                            inputRef.current?.focus();
                          });
                        }}
                      />
                    ) : null
                  }
                />
              </>
            }
          />

          {showMediaLibrary && (
            <MediaLibraryModal
              isOpen={showMediaLibrary}
              onClose={() => setShowMediaLibrary(false)}
              mode={SelectionMode.SELECT}
              filterType={AssetType.IMAGE}
              onSelect={handleMediaLibrarySelect}
              onSelectMultiple={handleMediaLibrarySelectMultiple}
              batchSelectButtonText="批量插入对话框"
            />
          )}
        </div>
      </>
    );
  }
);

AIInputBar.displayName = 'AIInputBar';

export default AIInputBar;
