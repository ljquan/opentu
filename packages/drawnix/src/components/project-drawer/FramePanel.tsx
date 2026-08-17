/**
 * FramePanel Component
 *
 * 在项目抽屉中展示当前画布的 Frame 列表
 * 支持点击聚焦到对应 Frame 视图
 */

import React, {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
} from 'react';
import classNames from 'classnames';
import {
  Input,
  Button,
  MessagePlugin,
  Loading,
  Dropdown,
  Textarea,
  Checkbox,
} from 'tdesign-react';
import {
  AlignHorizontalDistributeCenter,
  Check,
  History,
  List,
  Presentation,
  Sparkles,
  Video,
} from 'lucide-react';
import {
  SearchIcon,
  EditIcon,
  DeleteIcon,
  AddIcon,
  PlayCircleIcon,
  ImageIcon,
  FileCopyIcon,
  StopCircleIcon,
} from 'tdesign-icons-react';
import {
  PlaitBoard,
  PlaitElement,
  Path,
  BoardTransforms,
  RectangleClient,
  Transforms,
  clearSelectedElement,
  addSelectedElement,
  getSelectedElements,
} from '@plait/core';
import {
  PlaitFrame,
  getFrameDisplayName,
  isFrameElement,
} from '../../types/frame.types';
import { FrameTransforms } from '../../plugins/with-frame';
import { DialogType, useDrawnix } from '../../hooks/use-drawnix';
import { useDragSort } from '../../hooks/use-drag-sort';
import { AddFrameDialog } from './AddFrameDialog';
import { FrameSlideshow } from './FrameSlideshow';
import {
  findPreviousPPTSlideImage,
  findPPTSlideImage,
  getPPTSlidePrompt,
  insertMediaIntoFrame,
  removePPTImagePlaceholder,
  replacePPTSlideImage,
  setFramePPTMeta,
} from '../../utils/frame-insertion-utils';
import {
  createDefaultPPTStyleSpec,
  type PPTFrameMeta,
  type PPTOutline,
  type PPTPageSpec,
  type PPTSlideImageHistoryItem,
  type PPTStyleSpec,
  buildPPTImageGenerationPrompt,
  formatPPTCommonPrompt,
  generateSlideImagePrompt,
  getPPTFrameGridPosition,
  loadPPTFrameLayoutColumns,
  loadPPTEditorViewMode,
  normalizePPTStyleSpec,
  normalizePPTReferenceImages,
  PPT_EDITOR_OPEN_EVENT,
  PPT_TRANSITION_OPTIONS,
  getPPTSlideTransition,
  getPPTTransitionOption,
  savePPTEditorViewMode,
  sanitizePPTFrameLayoutColumns,
  savePPTFrameLayoutColumns,
  type PPTEditorOpenEventDetail,
  type PPTEditorViewMode,
  type PPTSlideTransitionType,
} from '../../services/ppt';
import { createImageTask } from '../../mcp/tools/image-generation';
import { waitForTaskCompletion } from '../../services/media-executor';
import { taskQueueService } from '../../services/task-queue';
import { useSharedTaskState } from '../../hooks/useTaskQueue';
import { usePromptHistory } from '../../hooks/usePromptHistory';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { AI_GENERATION_CONCURRENCY_LIMIT } from '../../constants/TASK_CONSTANTS';
import { duplicateFrame, focusFrame } from '../../utils/frame-duplicate';
import {
  getFrameAwareSelection,
  moveElementWithFrameRelations,
} from '../../transforms/frame-aware';
import { useI18n } from '../../i18n';
import { AIImageIcon, DownloadIcon, MediaLibraryIcon } from '../icons';
import { exportAllPPTFrames } from '../../services/ppt/ppt-export-service';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import {
  ContextMenu,
  HoverCard,
  HoverTip,
  PromptListPanel,
  RetryImage,
  useContextMenuState,
  type ContextMenuEntry,
  type PromptItem,
} from '../shared';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { PromptOptimizeDialog } from '../shared/PromptOptimizeDialog';
import { useThumbnailUrl } from '../../hooks/useThumbnailUrl';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
} from '../../utils/model-selection';
import {
  createModelRef,
  resolveInvocationRoute,
  type ModelRef,
} from '../../utils/settings-manager';
import { analytics } from '../../utils/posthog-analytics';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';
import type { ModelConfig } from '../../constants/model-config';
import { AssetType, SelectionMode, type Asset } from '../../types/asset.types';
import {
  insertAudioFromUrl,
  resolveAudioCardDimensions,
} from '../../data/audio';
import { requestAIInputFocus } from '../../services/ai-input-ui-events';
import {
  createPPTFrameSnapshotDataUrl,
  createPPTFrameSnapshotKey,
  getPPTFrameSnapshotElements,
  resolvePPTFramePreviewUrl,
} from '../../utils/frame-preview-snapshot';
import { confirmAndRunPptExplainerTask } from '../../services/ppt-explainer/creation-service';
import { readPptExplainerState } from '../../services/ppt-explainer/validation';

interface FrameInfo {
  frame: PlaitFrame;
  path: Path;
  listKey: string;
  isRoot: boolean;
  childCount: number;
  width: number;
  height: number;
  /** PPT 元数据（如果有） */
  pptMeta?: PPTFrameMeta;
  slideImageUrl?: string;
  slideImageElementId?: string;
  slidePrompt?: string;
}

interface FramePanelProps {
  currentBoardId?: string;
  currentBoardName?: string;
  onOpenMediaLibrary?: (config?: {
    mode?: SelectionMode;
    onSelect?: (asset: Asset) => void | Promise<void>;
    selectButtonText?: string;
    batchSelectButtonText?: string;
    keepProjectDrawerOpen?: boolean;
  }) => void;
}

type OutlinePromptOptimizeTarget =
  | { type: 'common' }
  | { type: 'slide'; frameId: string };

const PPT_HISTORY_PROMPT_PREVIEW_LENGTH = 36;
const PPT_COMMON_PROMPT_HISTORY_DISPLAY_LIMIT = 60;
const PPT_PARALLEL_GENERATION_LIMIT = AI_GENERATION_CONCURRENCY_LIMIT;
const PPT_TASK_WAIT_TIMEOUT_MS = IMAGE_GENERATION_TIMEOUT_MS;
const PPT_OUTLINE_BATCH_PREFIX = 'ppt_outline_';
const PPT_OUTLINE_CANCELLED_ERROR = 'PPT_OUTLINE_GENERATION_CANCELLED';
const PPT_DEFAULT_IMAGE_SIZE = '16x9';
const PPT_DEFAULT_IMAGE_PIXEL_SIZE = '1360x768';
const PPT_FRAME_SNAPSHOT_DEBOUNCE_MS = 120;

function mergePPTReferenceImages(
  ...imageGroups: Array<Array<string | undefined> | undefined>
): string[] | undefined {
  const merged = normalizePPTReferenceImages(
    imageGroups.flatMap((group) => group || []).filter(Boolean) as string[]
  );

  return merged.length > 0 ? merged : undefined;
}

function appendInitialReferenceImages(
  initialImages: Array<{ url: string; name: string }>,
  referenceImages?: string[],
  namePrefix = 'deck-reference'
): void {
  const existingUrls = new Set(initialImages.map((image) => image.url));
  normalizePPTReferenceImages(referenceImages).forEach((url, index) => {
    if (existingUrls.has(url)) {
      return;
    }
    existingUrls.add(url);
    initialImages.push({
      url,
      name: `${namePrefix}-${index + 1}.png`,
    });
  });
}
const INVALID_PPT_EXPORT_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;
const PPT_LAYOUT_COLUMN_OPTIONS = Array.from(
  { length: 10 },
  (_, index) => index + 1
);
const DEFAULT_FRAME_NAME_REGEXP = /^(?:Frame|Slide|PPT\s*页面)\s*\d+$/i;

function getAnalyticsErrorName(error: unknown): string {
  return error instanceof Error ? error.name || 'Error' : typeof error;
}
type PPTPageInsertPlacement = 'before' | 'after';

const PPT_IMAGE_SIZE_CANDIDATES = [
  { size: '1024x1024', width: 1024, height: 1024 },
  { size: '832x1248', width: 832, height: 1248 },
  { size: '1248x832', width: 1248, height: 832 },
  { size: '880x1184', width: 880, height: 1184 },
  { size: '1184x880', width: 1184, height: 880 },
  { size: '912x1152', width: 912, height: 1152 },
  { size: '1152x912', width: 1152, height: 912 },
  { size: '768x1360', width: 768, height: 1360 },
  { size: '1360x768', width: 1360, height: 768 },
  { size: '1568x672', width: 1568, height: 672 },
  { size: '2048x2048', width: 2048, height: 2048 },
  { size: '1680x2512', width: 1680, height: 2512 },
  { size: '2512x1680', width: 2512, height: 1680 },
  { size: '1776x2368', width: 1776, height: 2368 },
  { size: '2368x1776', width: 2368, height: 1776 },
  { size: '1824x2288', width: 1824, height: 2288 },
  { size: '2288x1824', width: 2288, height: 1824 },
  { size: '1536x2736', width: 1536, height: 2736 },
  { size: '2736x1536', width: 2736, height: 1536 },
  { size: '3136x1344', width: 3136, height: 1344 },
  { size: '2880x2880', width: 2880, height: 2880 },
  { size: '2352x3520', width: 2352, height: 3520 },
  { size: '3520x2352', width: 3520, height: 2352 },
  { size: '2480x3312', width: 2480, height: 3312 },
  { size: '3312x2480', width: 3312, height: 2480 },
  { size: '2576x3216', width: 2576, height: 3216 },
  { size: '3216x2576', width: 3216, height: 2576 },
  { size: '2160x3840', width: 2160, height: 3840 },
  { size: '3840x2160', width: 3840, height: 2160 },
  { size: '3840x1632', width: 3840, height: 1632 },
] as const;

interface PPTOutlineGenerationRuntime {
  batchId: string;
  frameIds: string[];
  submittedTaskIds: Set<string>;
  activeTaskIds: Set<string>;
  controller: AbortController;
  total: number;
  successCount: number;
  failedCount: number;
  status: string;
  cancelRequested: boolean;
}

interface PPTOutlineGenerationSnapshot {
  batchId: string;
  frameIds: string[];
  taskIds: string[];
  activeTaskIds: string[];
  status: string;
}

let activePPTOutlineRuntime: PPTOutlineGenerationRuntime | null = null;
const pptOutlineRuntimeListeners = new Set<() => void>();

function isTaskActive(task: Task): boolean {
  return (
    task.status === TaskStatus.PENDING || task.status === TaskStatus.PROCESSING
  );
}

function isTaskForPPTOutlineFrame(task: Task, frameIds: Set<string>): boolean {
  const batchId = task.params?.batchId;
  const targetFrameId = task.params?.targetFrameId;
  return (
    task.type === TaskType.IMAGE &&
    task.params?.pptSlideImage === true &&
    typeof batchId === 'string' &&
    batchId.startsWith(PPT_OUTLINE_BATCH_PREFIX) &&
    typeof targetFrameId === 'string' &&
    frameIds.has(targetFrameId)
  );
}

function emitPPTOutlineRuntimeChange(): void {
  pptOutlineRuntimeListeners.forEach((listener) => listener());
}

function subscribePPTOutlineRuntime(listener: () => void): () => void {
  pptOutlineRuntimeListeners.add(listener);
  return () => {
    pptOutlineRuntimeListeners.delete(listener);
  };
}

function runtimeMatchesFrameIds(
  runtime: PPTOutlineGenerationRuntime,
  frameIds: Set<string>
): boolean {
  return runtime.frameIds.some((frameId) => frameIds.has(frameId));
}

function getPPTOutlineRuntimeSnapshot(
  frameIds: Set<string>
): PPTOutlineGenerationSnapshot | null {
  const runtime = activePPTOutlineRuntime;
  if (!runtime || !runtimeMatchesFrameIds(runtime, frameIds)) {
    return null;
  }

  return {
    batchId: runtime.batchId,
    frameIds: runtime.frameIds,
    taskIds: Array.from(runtime.submittedTaskIds),
    activeTaskIds: Array.from(runtime.activeTaskIds),
    status: runtime.status,
  };
}

function updatePPTOutlineRuntimeStatus(
  runtime: PPTOutlineGenerationRuntime
): void {
  const finished = runtime.successCount + runtime.failedCount;
  runtime.status = runtime.cancelRequested
    ? `正在停止 ${finished}/${runtime.total}`
    : `已完成 ${finished}/${runtime.total}`;
  emitPPTOutlineRuntimeChange();
}

function finishPPTOutlineRuntime(runtime: PPTOutlineGenerationRuntime): void {
  if (activePPTOutlineRuntime === runtime) {
    activePPTOutlineRuntime = null;
    emitPPTOutlineRuntimeChange();
  }
}

function isPPTOutlineCancelledError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message === PPT_OUTLINE_CANCELLED_ERROR;
  }
  return false;
}

function throwIfPPTOutlineCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(PPT_OUTLINE_CANCELLED_ERROR);
  }
}

function cancelActivePPTOutlineTasks(taskIds: string[]): number {
  let cancelledCount = 0;
  taskIds.forEach((taskId) => {
    const task = taskQueueService.getTask(taskId);
    if (task && isTaskActive(task)) {
      taskQueueService.cancelTask(taskId);
      cancelledCount++;
    }
  });
  return cancelledCount;
}

function getPPTImageElementDimensions(
  element?: any
): { width: number; height: number } | undefined {
  const width =
    typeof element?.width === 'number' && Number.isFinite(element.width)
      ? element.width
      : undefined;
  const height =
    typeof element?.height === 'number' && Number.isFinite(element.height)
      ? element.height
      : undefined;
  if (width && height) {
    return { width, height };
  }

  if (Array.isArray(element?.points)) {
    const rect = RectangleClient.getRectangleByPoints(element.points);
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
  }

  return undefined;
}

function resolveClosestPPTImageTaskSize(dimensions?: {
  width: number;
  height: number;
}): string | undefined {
  if (!dimensions?.width || !dimensions.height) {
    return undefined;
  }

  let best: (typeof PPT_IMAGE_SIZE_CANDIDATES)[number] =
    PPT_IMAGE_SIZE_CANDIDATES[0];
  let bestScore = Infinity;
  PPT_IMAGE_SIZE_CANDIDATES.forEach((candidate) => {
    const widthRatio = dimensions.width / candidate.width;
    const heightRatio = dimensions.height / candidate.height;
    const score =
      Math.log(widthRatio) * Math.log(widthRatio) +
      Math.log(heightRatio) * Math.log(heightRatio);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best?.size;
}

function getPPTReferenceImageTaskSize(
  slideImage: ReturnType<typeof findPPTSlideImage>,
  fallbackDimensions?: { width: number; height: number }
): string | undefined {
  return resolveClosestPPTImageTaskSize(
    getPPTImageElementDimensions(slideImage?.element) || fallbackDimensions
  );
}

function requestCancelPPTOutlineRuntime(batchId?: string): {
  frameIds: string[];
  taskIds: string[];
  cancelledCount: number;
} {
  const runtime = activePPTOutlineRuntime;
  if (!runtime || (batchId && runtime.batchId !== batchId)) {
    return { frameIds: [], taskIds: [], cancelledCount: 0 };
  }

  runtime.cancelRequested = true;
  runtime.controller.abort();
  updatePPTOutlineRuntimeStatus(runtime);

  const taskIds = Array.from(runtime.submittedTaskIds);
  return {
    frameIds: runtime.frameIds,
    taskIds,
    cancelledCount: cancelActivePPTOutlineTasks(taskIds),
  };
}

function getRecoveredPPTOutlineSnapshot(
  tasks: Task[],
  frameIds: Set<string>
): PPTOutlineGenerationSnapshot | null {
  const groups = new Map<string, Task[]>();
  tasks.forEach((task) => {
    if (!isTaskForPPTOutlineFrame(task, frameIds)) {
      return;
    }
    const batchId = task.params.batchId as string;
    const group = groups.get(batchId) || [];
    group.push(task);
    groups.set(batchId, group);
  });

  const activeGroups = Array.from(groups.entries())
    .map(([batchId, batchTasks]) => ({
      batchId,
      tasks: batchTasks,
      activeTasks: batchTasks.filter(isTaskActive),
      latestUpdatedAt: Math.max(
        ...batchTasks.map((task) => task.updatedAt || 0)
      ),
    }))
    .filter((group) => group.activeTasks.length > 0)
    .sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt);

  const latestGroup = activeGroups[0];
  if (!latestGroup) {
    return null;
  }

  const total =
    latestGroup.tasks.reduce((max, task) => {
      const batchTotal = task.params.batchTotal;
      return typeof batchTotal === 'number' ? Math.max(max, batchTotal) : max;
    }, 0) || latestGroup.tasks.length;
  const finished = latestGroup.tasks.filter(
    (task) =>
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELLED
  ).length;

  return {
    batchId: latestGroup.batchId,
    frameIds: latestGroup.tasks
      .map((task) => task.params.targetFrameId)
      .filter((frameId): frameId is string => typeof frameId === 'string'),
    taskIds: latestGroup.tasks.map((task) => task.id),
    activeTaskIds: latestGroup.activeTasks.map((task) => task.id),
    status: `已完成 ${finished}/${total}`,
  };
}

function getPPTPageFrameName(pageIndex: number): string {
  return `PPT 页面 ${pageIndex}`;
}

function isDefaultFrameName(name?: string): boolean {
  return DEFAULT_FRAME_NAME_REGEXP.test((name || '').trim());
}

function getFramePromptTitle(frame: PlaitFrame, fallback: string): string {
  const displayName = getFrameDisplayName(frame).trim();
  return displayName || fallback;
}

function getPPTDeckTitleFromFrameInfos(frameInfos: FrameInfo[]): string {
  for (const info of frameInfos) {
    const title = info.pptMeta?.deckTitle?.trim();
    if (title) {
      return title;
    }
  }
  return '';
}

function resolvePPTExportFileName(
  deckTitle: string,
  canvasTitle?: string
): string {
  const rawName = deckTitle.trim() || canvasTitle?.trim() || 'aitu-ppt';
  const safeName = Array.from(rawName, (char) =>
    char.charCodeAt(0) < 32 ? '_' : char
  ).join('');
  return (
    safeName
      .replace(INVALID_PPT_EXPORT_FILE_NAME_CHARS, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'aitu-ppt'
  );
}

function frameInfoToPPTPageSpec(
  frameInfo: FrameInfo,
  index: number
): PPTPageSpec {
  return {
    layout: frameInfo.pptMeta?.layout || 'title-body',
    title: getFramePromptTitle(frameInfo.frame, getPPTPageFrameName(index + 1)),
  };
}

function pickPPTStyleSpec(
  frameInfos: FrameInfo[],
  preferredFrameInfo?: FrameInfo
): PPTStyleSpec {
  if (preferredFrameInfo?.pptMeta?.styleSpec) {
    return normalizePPTStyleSpec(preferredFrameInfo.pptMeta.styleSpec);
  }

  const frameWithStyle = frameInfos.find((info) => info.pptMeta?.styleSpec);
  if (frameWithStyle?.pptMeta?.styleSpec) {
    return normalizePPTStyleSpec(frameWithStyle.pptMeta.styleSpec);
  }

  return createDefaultPPTStyleSpec();
}

function buildPPTFramePrompt(
  frameInfos: FrameInfo[],
  pageSpec: PPTPageSpec,
  pageIndex: number,
  styleSpec: PPTStyleSpec
): string {
  const pages = frameInfos.map(frameInfoToPPTPageSpec);
  const insertAt = Math.max(0, Math.min(pageIndex - 1, pages.length));
  pages.splice(insertAt, 0, pageSpec);
  const outline: PPTOutline = {
    title: pages[0]?.title || pageSpec.title,
    styleSpec,
    pages,
  };
  return generateSlideImagePrompt(outline, pageSpec, insertAt + 1);
}

function getPPTCommonPromptFromFrameInfos(frameInfos: FrameInfo[]): string {
  const frameWithCommonPrompt = frameInfos.find((info) =>
    info.pptMeta?.commonPrompt?.trim()
  );
  if (frameWithCommonPrompt?.pptMeta?.commonPrompt) {
    return frameWithCommonPrompt.pptMeta.commonPrompt.trim();
  }

  const frameWithStyle = frameInfos.find((info) => info.pptMeta?.styleSpec);
  return formatPPTCommonPrompt(frameWithStyle?.pptMeta?.styleSpec);
}

function getTaskResultImageUrl(task: any): string | undefined {
  const result = task?.result;
  if (typeof result?.url === 'string' && result.url) {
    return result.url;
  }
  if (Array.isArray(result?.urls) && typeof result.urls[0] === 'string') {
    return result.urls[0];
  }
  return undefined;
}

function getOrderedPPTFrameInfos(frameInfos: FrameInfo[]): FrameInfo[] {
  const sourceOrder = new Map(
    frameInfos.map((info, index) => [info.frame.id, index])
  );

  return [...frameInfos].sort((left, right) => {
    const leftIndex = left.pptMeta?.pageIndex;
    const rightIndex = right.pptMeta?.pageIndex;
    const hasLeftIndex =
      typeof leftIndex === 'number' && !Number.isNaN(leftIndex);
    const hasRightIndex =
      typeof rightIndex === 'number' && !Number.isNaN(rightIndex);

    if (hasLeftIndex && hasRightIndex && leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    if (hasLeftIndex !== hasRightIndex) {
      return hasLeftIndex ? -1 : 1;
    }
    return (
      (sourceOrder.get(left.frame.id) ?? 0) -
      (sourceOrder.get(right.frame.id) ?? 0)
    );
  });
}

function areStringSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function getSlideImageHistory(
  frameInfo: FrameInfo
): PPTSlideImageHistoryItem[] {
  const history = (frameInfo.pptMeta?.slideImageHistory || []).filter(
    (item) => !!item.imageUrl
  );

  if (!frameInfo.slideImageUrl) {
    return history;
  }

  const hasCurrentImage = history.some((item) => {
    if (
      frameInfo.slideImageElementId &&
      item.elementId === frameInfo.slideImageElementId
    ) {
      return true;
    }
    return item.imageUrl === frameInfo.slideImageUrl;
  });

  if (hasCurrentImage) {
    return history;
  }

  return [
    {
      id: `current-${frameInfo.frame.id}-${
        frameInfo.slideImageElementId || frameInfo.slideImageUrl
      }`,
      imageUrl: frameInfo.slideImageUrl,
      ...(frameInfo.slideImageElementId
        ? { elementId: frameInfo.slideImageElementId }
        : {}),
      ...(frameInfo.slidePrompt ? { prompt: frameInfo.slidePrompt } : {}),
      createdAt: 0,
    },
    ...history,
  ];
}

function isSlideHistoryCurrentImage(
  frameInfo: FrameInfo,
  item: PPTSlideImageHistoryItem
): boolean {
  if (!frameInfo.slideImageUrl) {
    return false;
  }
  if (
    frameInfo.slideImageElementId &&
    item.elementId === frameInfo.slideImageElementId
  ) {
    return true;
  }
  return item.imageUrl === frameInfo.slideImageUrl;
}

function formatHistoryCreatedAt(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return '';
  }
  return new Date(createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PPTSlideHistoryMenuLabel: React.FC<{
  item: PPTSlideImageHistoryItem;
  index: number;
  isCurrent: boolean;
}> = ({ item, index, isCurrent }) => {
  const prompt = item.prompt?.trim();
  const promptPreview =
    prompt && prompt.length > PPT_HISTORY_PROMPT_PREVIEW_LENGTH
      ? `${prompt.slice(0, PPT_HISTORY_PROMPT_PREVIEW_LENGTH)}…`
      : prompt;
  const createdAtText = formatHistoryCreatedAt(item.createdAt);

  return (
    <span
      className={classNames('frame-panel__history-menu-item', {
        'frame-panel__history-menu-item--active': isCurrent,
      })}
    >
      <RetryImage
        src={item.imageUrl}
        alt={`图片 ${index + 1}`}
        className="frame-panel__history-menu-thumb"
        showSkeleton={false}
      />
      <span className="frame-panel__history-menu-text">
        <span className="frame-panel__history-menu-title">
          <span className="frame-panel__history-menu-title-main">
            {index + 1}
            {' · '}
            {createdAtText || '生成时间未知'}
          </span>
          {isCurrent ? (
            <span className="frame-panel__history-menu-current">当前</span>
          ) : null}
        </span>
        {promptPreview ? (
          <span className="frame-panel__history-menu-prompt">
            {promptPreview}
          </span>
        ) : null}
      </span>
      <span className="frame-panel__history-menu-preview">
        <RetryImage
          src={item.imageUrl}
          alt={`图片 ${index + 1} 预览`}
          showSkeleton={false}
        />
      </span>
    </span>
  );
};

const PPTTransitionMenuLabel: React.FC<{
  label: string;
  description: string;
  active: boolean;
}> = ({ label, description, active }) => (
  <span
    className={classNames('frame-panel__transition-menu-item', {
      'frame-panel__transition-menu-item--active': active,
    })}
  >
    <span className="frame-panel__transition-menu-check">
      {active ? <Check size={14} /> : null}
    </span>
    <span className="frame-panel__transition-menu-text">
      <span className="frame-panel__transition-menu-title">{label}</span>
      <span className="frame-panel__transition-menu-desc">{description}</span>
    </span>
  </span>
);

const PPTTransitionBadge: React.FC<{
  transitionType: PPTSlideTransitionType;
  onContextMenu: (event: React.MouseEvent) => void;
}> = ({ transitionType, onContextMenu }) => {
  const option = getPPTTransitionOption(transitionType);
  return (
    <HoverTip content={`转场：${option.label}`} placement="bottom">
      <button
        type="button"
        className="frame-panel__transition-badge"
        aria-label={`转场：${option.label}`}
        onClick={(event) => {
          event.preventDefault();
          onContextMenu(event);
        }}
        onContextMenu={onContextMenu}
      >
        <Sparkles size={12} strokeWidth={2} />
        <span>{option.label}</span>
      </button>
    </HoverTip>
  );
};

const PPTSlidePreview: React.FC<{
  imageUrl?: string;
  title: string;
  status?: PPTFrameMeta['slideImageStatus'] | PPTFrameMeta['imageStatus'];
}> = ({ imageUrl, title, status }) => {
  const thumbnailUrl = useThumbnailUrl(imageUrl, 'image', 'small');
  const emptyText =
    status === 'loading'
      ? '生成中'
      : status === 'failed'
      ? '生成失败'
      : '空白页';

  return (
    <div className="frame-panel__slide-preview">
      {thumbnailUrl ? (
        <RetryImage
          src={thumbnailUrl}
          alt={title}
          className="frame-panel__slide-preview-img"
          showSkeleton={false}
        />
      ) : (
        <div className="frame-panel__slide-preview-empty">{emptyText}</div>
      )}
    </div>
  );
};

const PPTOutlineSlideImageAction: React.FC<{
  imageUrl?: string;
  title: string;
  status?: PPTFrameMeta['slideImageStatus'] | PPTFrameMeta['imageStatus'];
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}> = ({ imageUrl, title, status, disabled = false, onClick }) => {
  const thumbnailUrl = useThumbnailUrl(imageUrl, 'image', 'small');
  const hasImage = Boolean(imageUrl);
  const label = hasImage ? '重新生成 PPT 图片' : 'AI 图片生成';
  const isLoading = status === 'loading';
  const isFailed = status === 'failed';

  const button = (
    <button
      type="button"
      className={classNames('frame-panel__outline-image-action', {
        'frame-panel__outline-image-action--with-image': hasImage,
        'frame-panel__outline-image-action--loading': isLoading,
        'frame-panel__outline-image-action--failed': isFailed,
        'frame-panel__outline-image-action--disabled': disabled,
      })}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) {
          return;
        }
        onClick(event);
      }}
    >
      {thumbnailUrl ? (
        <RetryImage
          src={thumbnailUrl}
          alt={`${title} 当前图片`}
          className="frame-panel__outline-image-thumb"
          showSkeleton={false}
        />
      ) : (
        <AIImageIcon size={16} />
      )}
    </button>
  );

  if (!imageUrl) {
    return (
      <HoverTip content={label} placement="top">
        {button}
      </HoverTip>
    );
  }

  return (
    <HoverCard
      content={
        <div className="frame-panel__outline-image-preview">
          <RetryImage
            src={imageUrl}
            alt={`${title} 大图预览`}
            showSkeleton={false}
            eager
          />
        </div>
      }
      placement="left"
      sideOffset={12}
      contentClassName="frame-panel__outline-image-preview-popover"
      openDelay={80}
      closeDelay={80}
    >
      {button}
    </HoverCard>
  );
};

function usePPTFramePreviewSnapshots(
  board: PlaitBoard | null | undefined,
  frameInfos: FrameInfo[],
  refreshKey: number
): Record<string, string> {
  const [snapshotUrls, setSnapshotUrls] = useState<Record<string, string>>({});
  const snapshotUrlsRef = useRef<Record<string, string>>({});
  const snapshotKeysRef = useRef<Map<string, string>>(new Map());

  const frameIdsKey = useMemo(
    () => frameInfos.map((info) => info.frame.id).join('|'),
    [frameInfos]
  );

  const updateSnapshotUrl = useCallback((frameId: string, url?: string) => {
    setSnapshotUrls((current) => {
      const next = { ...current };
      if (url) {
        if (next[frameId] === url) {
          return current;
        }
        next[frameId] = url;
      } else {
        if (!(frameId in next)) {
          return current;
        }
        delete next[frameId];
      }
      snapshotUrlsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    snapshotUrlsRef.current = snapshotUrls;
  }, [snapshotUrls]);

  useEffect(() => {
    const activeFrameIds = new Set(frameInfos.map((info) => info.frame.id));
    let changed = false;
    snapshotKeysRef.current.forEach((_, frameId) => {
      if (!activeFrameIds.has(frameId)) {
        snapshotKeysRef.current.delete(frameId);
        changed = true;
      }
    });
    setSnapshotUrls((current) => {
      const next = { ...current };
      Object.keys(next).forEach((frameId) => {
        if (!activeFrameIds.has(frameId)) {
          delete next[frameId];
          changed = true;
        }
      });
      if (!changed) {
        return current;
      }
      snapshotUrlsRef.current = next;
      return next;
    });
  }, [frameIdsKey, frameInfos]);

  useEffect(() => {
    if (!board || frameInfos.length === 0) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        for (const info of frameInfos) {
          if (cancelled || !info.pptMeta) {
            continue;
          }

          const latestFrame = board.children.find(
            (element) => element.id === info.frame.id && isFrameElement(element)
          ) as PlaitFrame | undefined;
          if (!latestFrame) {
            snapshotKeysRef.current.delete(info.frame.id);
            updateSnapshotUrl(info.frame.id);
            continue;
          }

          try {
            const snapshotElements = getPPTFrameSnapshotElements(
              board,
              latestFrame
            );
            const snapshotKey = createPPTFrameSnapshotKey(snapshotElements);
            if (
              snapshotKeysRef.current.get(info.frame.id) === snapshotKey &&
              snapshotUrlsRef.current[info.frame.id]
            ) {
              continue;
            }

            const snapshotUrl = await createPPTFrameSnapshotDataUrl(
              board,
              latestFrame
            );
            if (cancelled) {
              return;
            }

            if (snapshotUrl) {
              snapshotKeysRef.current.set(info.frame.id, snapshotKey);
              updateSnapshotUrl(info.frame.id, snapshotUrl);
            } else {
              snapshotKeysRef.current.delete(info.frame.id);
              updateSnapshotUrl(info.frame.id);
            }
          } catch (error) {
            console.warn('[FramePanel] Failed to render PPT frame snapshot:', {
              frameId: info.frame.id,
              error,
            });
            snapshotKeysRef.current.delete(info.frame.id);
            updateSnapshotUrl(info.frame.id);
          }

          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => resolve());
          });
        }
      })();
    }, PPT_FRAME_SNAPSHOT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [board, frameIdsKey, frameInfos, refreshKey, updateSnapshotUrl]);

  return snapshotUrls;
}

export const FramePanel: React.FC<FramePanelProps> = ({
  currentBoardId,
  currentBoardName,
  onOpenMediaLibrary,
}) => {
  const { board, openDialog } = useDrawnix();
  const { language } = useI18n();
  const { tasks } = useSharedTaskState();
  const {
    history: commonPromptHistory,
    addHistory: addCommonPromptHistory,
    removeHistory: removeCommonPromptHistory,
    refreshHistory: refreshCommonPromptHistory,
    togglePinHistory: togglePinCommonPromptHistory,
  } = usePromptHistory({
    deduplicateWithPresets: false,
    modelTypeFilter: 'ppt-common',
  });
  const imageModels = useSelectableModels('image');
  const initialOutlineImageRoute = useMemo(
    () => resolveInvocationRoute('image'),
    []
  );
  const { confirm, confirmDialog } = useConfirmDialog({
    container: board ? PlaitBoard.getBoardContainer(board) : null,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(
    () => new Set()
  );
  const [lastSelectedFrameId, setLastSelectedFrameId] = useState<string | null>(
    null
  );
  const [addDialogVisible, setAddDialogVisible] = useState(false);
  const [slideshowVisible, setSlideshowVisible] = useState(false);
  const {
    contextMenu,
    open: openContextMenu,
    close: closeContextMenu,
  } = useContextMenuState<FrameInfo>();
  const [isExportingAllPPT, setIsExportingAllPPT] = useState(false);
  const [confirmingPptExplainerTaskIds, setConfirmingPptExplainerTaskIds] =
    useState<Set<string>>(() => new Set());
  const [pptExplainerConfirmErrors, setPptExplainerConfirmErrors] = useState<
    Record<string, string>
  >({});
  const [pptLayoutColumns, setPPTLayoutColumns] = useState(() =>
    loadPPTFrameLayoutColumns()
  );
  const [pptViewMode, setPPTViewMode] = useState<PPTEditorViewMode>(() =>
    loadPPTEditorViewMode()
  );
  const [outlineSelectedFrameIds, setOutlineSelectedFrameIds] = useState<
    Set<string>
  >(() => new Set());
  const [outlineSerialMode, setOutlineSerialMode] = useState(true);
  const [outlineRuntimeVersion, setOutlineRuntimeVersion] = useState(0);
  const [pptTitleDraft, setPPTTitleDraft] = useState('');
  const [commonPromptDraft, setCommonPromptDraft] = useState('');
  const [slidePromptDrafts, setSlidePromptDrafts] = useState<
    Record<string, string>
  >({});
  const [outlinePromptOptimizeTarget, setOutlinePromptOptimizeTarget] =
    useState<OutlinePromptOptimizeTarget | null>(null);
  const [outlineImageModel, setOutlineImageModel] = useState(
    () => initialOutlineImageRoute.modelId || ''
  );
  const [outlineImageModelRef, setOutlineImageModelRef] =
    useState<ModelRef | null>(() =>
      createModelRef(
        initialOutlineImageRoute.profileId,
        initialOutlineImageRoute.modelId
      )
    );
  const outlineSelectionInitializedRef = useRef(false);
  const [commonPromptHistoryOpen, setCommonPromptHistoryOpen] = useState(false);
  const commonPromptHistoryPanelRef = useRef<HTMLDivElement>(null);
  const frameItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setFrameItemRef = useCallback(
    (frameId: string, node: HTMLDivElement | null) => {
      if (node) {
        frameItemRefs.current.set(frameId, node);
      } else {
        frameItemRefs.current.delete(frameId);
      }
    },
    []
  );

  useEffect(() => {
    return subscribePPTOutlineRuntime(() => {
      setOutlineRuntimeVersion((version) => version + 1);
    });
  }, []);

  useEffect(() => {
    if (!commonPromptHistoryOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        commonPromptHistoryPanelRef.current?.contains(target)
      ) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest('.frame-panel__outline-history-trigger')
      ) {
        return;
      }
      setCommonPromptHistoryOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [commonPromptHistoryOpen]);

  // 监听画布变化，强制刷新 Frame 列表
  // FramePanel 在 BoardContext（Wrapper）外部渲染，无法通过 BoardContext 的 v 版本号触发重渲染
  // 因此需要通过包装 board.afterChange 来检测 children 变化
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!board) return;
    const originalAfterChange = board.afterChange;
    board.afterChange = () => {
      originalAfterChange();
      setRefreshKey((k) => k + 1);
    };
    return () => {
      board.afterChange = originalAfterChange;
    };
  }, [board]);

  const handlePPTViewModeChange = useCallback((mode: PPTEditorViewMode) => {
    analytics.trackPPTAction({
      action: 'view_mode_change',
      source: 'project_drawer',
      metadata: { mode },
    });
    setPPTViewMode(mode);
    savePPTEditorViewMode(mode);
  }, []);

  useEffect(() => {
    const handleOpenPPTEditor = (
      event: Event | CustomEvent<PPTEditorOpenEventDetail>
    ) => {
      const viewMode = (event as CustomEvent<PPTEditorOpenEventDetail>).detail
        ?.viewMode;
      if (viewMode) {
        handlePPTViewModeChange(viewMode);
      }
    };

    window.addEventListener(PPT_EDITOR_OPEN_EVENT, handleOpenPPTEditor);
    return () =>
      window.removeEventListener(PPT_EDITOR_OPEN_EVENT, handleOpenPPTEditor);
  }, [handlePPTViewModeChange]);

  useEffect(() => {
    if (!board) return;

    let animationFrameId = 0;
    let lastRawSelectionKey = '';
    let lastSelectedFrameKey = '';

    const syncCanvasSelection = () => {
      const rawSelectionKey = JSON.stringify(board.selection) || '';
      if (rawSelectionKey === lastRawSelectionKey) {
        animationFrameId = requestAnimationFrame(syncCanvasSelection);
        return;
      }
      lastRawSelectionKey = rawSelectionKey;

      const selectedFrameIdsFromCanvas = getSelectedElements(board)
        .filter(isFrameElement)
        .map((frame) => frame.id);
      const nextSelectionKey = selectedFrameIdsFromCanvas.join('|');

      if (nextSelectionKey !== lastSelectedFrameKey) {
        lastSelectedFrameKey = nextSelectionKey;
        const nextSelectedFrameIds = new Set(selectedFrameIdsFromCanvas);

        setSelectedFrameIds((current) =>
          areStringSetsEqual(current, nextSelectedFrameIds)
            ? current
            : nextSelectedFrameIds
        );

        setLastSelectedFrameId((current) => {
          const nextLastSelectedFrameId =
            selectedFrameIdsFromCanvas[selectedFrameIdsFromCanvas.length - 1] ||
            null;
          return current === nextLastSelectedFrameId
            ? current
            : nextLastSelectedFrameId;
        });
      }

      animationFrameId = requestAnimationFrame(syncCanvasSelection);
    };

    animationFrameId = requestAnimationFrame(syncCanvasSelection);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [board]);

  // 收集画布中的所有 Frame 及其信息（支持嵌套结构）
  const frames: FrameInfo[] = useMemo(() => {
    if (!board || !board.children) return [];

    const result: FrameInfo[] = [];
    const childCountMap = new Map<string, number>();

    const walk = (elements: PlaitElement[], parentPath: Path = []) => {
      elements.forEach((element, index) => {
        const path: Path = [...parentPath, index];
        const frameId = (element as PlaitElement & { frameId?: string })
          .frameId;
        if (frameId) {
          childCountMap.set(frameId, (childCountMap.get(frameId) ?? 0) + 1);
        }

        if (isFrameElement(element)) {
          const frame = element as PlaitFrame;
          const rect = RectangleClient.getRectangleByPoints(frame.points);
          const pptMeta = (frame as any).pptMeta as PPTFrameMeta | undefined;
          const slideImage = findPPTSlideImage(board, frame.id);
          result.push({
            frame,
            path,
            listKey: `${frame.id}-${path.join('.')}`,
            isRoot: parentPath.length === 0,
            childCount: 0,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            pptMeta,
            slideImageUrl: slideImage?.url,
            slideImageElementId: slideImage?.elementId,
            slidePrompt: getPPTSlidePrompt(pptMeta),
          });
        }

        if (element.children && element.children.length > 0) {
          walk(element.children as PlaitElement[], path);
        }
      });
    };

    walk(board.children as PlaitElement[]);

    result.forEach((info) => {
      info.childCount = childCountMap.get(info.frame.id) ?? 0;
    });

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, refreshKey]);

  const handleCreatePPTOutlineClick = useCallback(() => {
    analytics.trackPPTAction({
      action: 'focus_generate_outline_skill',
      source: 'project_drawer_empty',
      pageCount: frames.length,
    });
    requestAIInputFocus({
      generationType: 'agent',
      skillId: 'generate_ppt',
    });
  }, [frames.length]);

  // 过滤 PPT 页面
  const filteredFrames = useMemo(() => {
    if (!searchQuery.trim()) return frames;
    const query = searchQuery.toLowerCase().trim();
    return frames.filter((f) =>
      getFrameDisplayName(f.frame).toLowerCase().includes(query)
    );
  }, [frames, searchQuery]);
  const filteredFrameIdsKey = useMemo(
    () => filteredFrames.map((info) => info.frame.id).join('|'),
    [filteredFrames]
  );

  useEffect(() => {
    const existingFrameIds = new Set(frames.map((info) => info.frame.id));
    setSelectedFrameIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) => existingFrameIds.has(id))
      );
      return next.size === current.size ? current : next;
    });
    if (lastSelectedFrameId && !existingFrameIds.has(lastSelectedFrameId)) {
      setLastSelectedFrameId(null);
    }
  }, [frames, lastSelectedFrameId]);

  const rootFrames = useMemo(() => {
    return frames.filter((item) => item.isRoot);
  }, [frames]);

  const orderedPPTFrames = useMemo(() => {
    const sourceFrames = rootFrames.length > 0 ? rootFrames : frames;
    return getOrderedPPTFrameInfos(sourceFrames);
  }, [frames, rootFrames]);

  const reviewPendingPptExplainerTasks = useMemo(() => {
    if (!currentBoardId) return [];
    return tasks
      .map((task) => ({ task, state: readPptExplainerState(task) }))
      .filter(
        (
          item
        ): item is {
          task: Task;
          state: NonNullable<ReturnType<typeof readPptExplainerState>>;
        } =>
          item.state?.stage === 'review_pending' &&
          item.state.sourceBoardId === currentBoardId &&
          item.task.status === TaskStatus.PENDING
      )
      .sort((a, b) => a.task.createdAt - b.task.createdAt);
  }, [currentBoardId, tasks]);

  const handleConfirmPptExplainerTask = useCallback(async (taskId: string) => {
    setConfirmingPptExplainerTaskIds((current) => {
      if (current.has(taskId)) return current;
      const next = new Set(current);
      next.add(taskId);
      return next;
    });
    setPptExplainerConfirmErrors((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
    try {
      await confirmAndRunPptExplainerTask(taskId);
      MessagePlugin.success('已确认大纲，开始生成 PPT 讲解视频');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '大纲确认失败，请重试';
      setPptExplainerConfirmErrors((current) => ({
        ...current,
        [taskId]: message,
      }));
    } finally {
      setConfirmingPptExplainerTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  const filteredOutlineFrames = useMemo(() => {
    if (!searchQuery.trim()) {
      return orderedPPTFrames;
    }
    const query = searchQuery.toLowerCase().trim();
    return orderedPPTFrames.filter((info) =>
      getFrameDisplayName(info.frame).toLowerCase().includes(query)
    );
  }, [orderedPPTFrames, searchQuery]);

  const previewFrameInfos = useMemo(
    () => (pptViewMode === 'outline' ? filteredOutlineFrames : filteredFrames),
    [filteredFrames, filteredOutlineFrames, pptViewMode]
  );
  const frameSnapshotUrls = usePPTFramePreviewSnapshots(
    board,
    previewFrameInfos,
    refreshKey
  );

  useEffect(() => {
    if (pptViewMode !== 'slides' || !lastSelectedFrameId) {
      return;
    }
    if (!filteredFrameIdsKey.split('|').includes(lastSelectedFrameId)) {
      return;
    }

    let firstAnimationFrame = 0;
    let secondAnimationFrame = 0;
    firstAnimationFrame = window.requestAnimationFrame(() => {
      secondAnimationFrame = window.requestAnimationFrame(() => {
        frameItemRefs.current
          .get(lastSelectedFrameId)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstAnimationFrame);
      window.cancelAnimationFrame(secondAnimationFrame);
    };
  }, [filteredFrameIdsKey, lastSelectedFrameId, pptViewMode]);

  const orderedPPTFrameIdsKey = useMemo(
    () => orderedPPTFrames.map((info) => info.frame.id).join('|'),
    [orderedPPTFrames]
  );

  const orderedPPTFrameIdSet = useMemo(
    () => new Set(orderedPPTFrames.map((info) => info.frame.id)),
    [orderedPPTFrameIdsKey, orderedPPTFrames]
  );

  const outlineRuntimeSnapshot = useMemo(
    () => getPPTOutlineRuntimeSnapshot(orderedPPTFrameIdSet),
    [orderedPPTFrameIdSet, outlineRuntimeVersion]
  );

  const recoveredOutlineSnapshot = useMemo(
    () => getRecoveredPPTOutlineSnapshot(tasks, orderedPPTFrameIdSet),
    [orderedPPTFrameIdSet, tasks]
  );

  const activeOutlineGeneration =
    outlineRuntimeSnapshot || recoveredOutlineSnapshot;
  const isOutlineGenerating = Boolean(activeOutlineGeneration);
  const outlineGenerationStatus = activeOutlineGeneration?.status || '';
  const commonPromptHistoryItems = useMemo<PromptItem[]>(
    () =>
      commonPromptHistory
        .slice(0, PPT_COMMON_PROMPT_HISTORY_DISPLAY_LIMIT)
        .map((item) => ({
          id: item.id,
          content: item.content,
          pinned: item.pinned,
          modelType: item.modelType,
          scene: language === 'zh' ? '记住历史' : 'History',
        })),
    [commonPromptHistory, language]
  );

  const outlinePromptSourceKey = useMemo(
    () =>
      orderedPPTFrames
        .map((info) =>
          [
            info.frame.id,
            info.pptMeta?.deckTitle || '',
            info.pptMeta?.commonPrompt || '',
            info.slidePrompt || '',
            info.pptMeta?.styleSpec
              ? JSON.stringify(info.pptMeta.styleSpec)
              : '',
          ].join(':')
        )
        .join('\n'),
    [orderedPPTFrames]
  );

  const rootIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    rootFrames.forEach((item, index) => {
      map.set(item.listKey, index);
    });
    return map;
  }, [rootFrames]);

  useEffect(() => {
    const existingFrameIds = new Set(
      orderedPPTFrames.map((info) => info.frame.id)
    );
    setOutlineSelectedFrameIds((current) => {
      if (!outlineSelectionInitializedRef.current) {
        outlineSelectionInitializedRef.current = true;
        return new Set(existingFrameIds);
      }

      const next = new Set(
        Array.from(current).filter((id) => existingFrameIds.has(id))
      );
      return areStringSetsEqual(current, next) ? current : next;
    });
  }, [orderedPPTFrameIdsKey, orderedPPTFrames]);

  useEffect(() => {
    setPPTTitleDraft(getPPTDeckTitleFromFrameInfos(orderedPPTFrames));
    setCommonPromptDraft(getPPTCommonPromptFromFrameInfos(orderedPPTFrames));

    const nextDrafts: Record<string, string> = {};
    orderedPPTFrames.forEach((info) => {
      nextDrafts[info.frame.id] = info.slidePrompt || '';
    });
    setSlidePromptDrafts(nextDrafts);
  }, [outlinePromptSourceKey, orderedPPTFrames]);

  useEffect(() => {
    if (imageModels.length === 0) {
      return;
    }

    const currentMatch = findMatchingSelectableModel(
      imageModels,
      outlineImageModel,
      outlineImageModelRef
    );
    if (currentMatch) {
      return;
    }

    const route = resolveInvocationRoute('image');
    const routeRef = createModelRef(route.profileId, route.modelId);
    const routeMatch = findMatchingSelectableModel(
      imageModels,
      route.modelId,
      routeRef
    );
    const fallbackModel = routeMatch || imageModels[0];
    setOutlineImageModel(fallbackModel.id);
    setOutlineImageModelRef(getModelRefFromConfig(fallbackModel));
  }, [imageModels, outlineImageModel, outlineImageModelRef]);

  const visibleOutlineImageModels = useMemo(() => {
    const currentMatch = findMatchingSelectableModel(
      imageModels,
      outlineImageModel,
      outlineImageModelRef
    );
    if (currentMatch) {
      return imageModels;
    }

    const pinnedModel = getPinnedSelectableModel(
      'image',
      outlineImageModel,
      outlineImageModelRef
    );
    return pinnedModel ? [pinnedModel, ...imageModels] : imageModels;
  }, [imageModels, outlineImageModel, outlineImageModelRef]);

  const handleOutlineImageModelSelect = useCallback(
    (modelId: string, modelRef?: ModelRef | null) => {
      analytics.trackPPTAction({
        action: 'image_model_select',
        source: 'project_drawer_outline',
        model: modelId,
      });
      setOutlineImageModel(modelId);
      setOutlineImageModelRef(modelRef || null);
    },
    []
  );

  const handleOutlineImageModelConfigSelect = useCallback(
    (model: ModelConfig) => {
      analytics.trackPPTAction({
        action: 'image_model_select',
        source: 'project_drawer_outline',
        model: model.id,
      });
      setOutlineImageModel(model.id);
      setOutlineImageModelRef(getModelRefFromConfig(model));
    },
    []
  );

  const focusFrameViewport = useCallback(
    (frame: PlaitFrame) => {
      if (!board) return;

      // 计算 Frame 矩形
      const rect = RectangleClient.getRectangleByPoints(frame.points);
      const padding = 80;

      // 获取画布容器尺寸
      const container = PlaitBoard.getBoardContainer(board);
      const viewportWidth = container.clientWidth;
      const viewportHeight = container.clientHeight;

      // 获取左侧抽屉宽度（如果存在）
      const drawer = document.querySelector('.project-drawer');
      const drawerWidth = drawer ? (drawer as HTMLElement).offsetWidth : 0;

      // 获取底部输入框高度（如果存在）
      const inputBar = document.querySelector('.ai-input-bar');
      const inputBarHeight = inputBar
        ? (inputBar as HTMLElement).offsetHeight
        : 0;

      // 计算实际可见区域尺寸
      const visibleWidth = viewportWidth - drawerWidth;
      const visibleHeight = viewportHeight - inputBarHeight;

      // 计算缩放比例，让 Frame 适应可见区域
      const scaleX = visibleWidth / (rect.width + padding * 2);
      const scaleY = visibleHeight / (rect.height + padding * 2);
      const zoom = Math.min(scaleX, scaleY, 2);

      // 计算 Frame 中心点
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;

      // 计算可见区域的中心点（考虑抽屉和输入框的偏移）
      const visibleCenterX = drawerWidth + visibleWidth / 2;
      const visibleCenterY = visibleHeight / 2;

      // 计算 origination：使 Frame 中心对齐可见区域中心
      const origination: [number, number] = [
        centerX - visibleCenterX / zoom,
        centerY - visibleCenterY / zoom,
      ];

      BoardTransforms.updateViewport(board, origination, zoom);
    },
    [board]
  );

  const syncCanvasSelectedFrames = useCallback(
    (frameInfos: FrameInfo[]) => {
      if (!board) return;
      clearSelectedElement(board);
      for (const info of frameInfos) {
        addSelectedElement(board, info.frame);
      }
    },
    [board]
  );

  // 点击 Frame：选中并聚焦视图，Shift 连续选择
  const handleFrameClick = useCallback(
    (frameInfo: FrameInfo, e: React.MouseEvent) => {
      if (!board) return;

      const isShift = e.shiftKey;
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      let nextSelectedFrameIds = new Set<string>();
      let selectedInfos: FrameInfo[] = [frameInfo];

      if (isShift && lastSelectedFrameId) {
        const startIndex = filteredFrames.findIndex(
          (info) => info.frame.id === lastSelectedFrameId
        );
        const endIndex = filteredFrames.findIndex(
          (info) => info.frame.id === frameInfo.frame.id
        );
        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] =
            startIndex < endIndex
              ? [startIndex, endIndex]
              : [endIndex, startIndex];
          nextSelectedFrameIds = new Set(selectedFrameIds);
          filteredFrames
            .slice(from, to + 1)
            .forEach((info) => nextSelectedFrameIds.add(info.frame.id));
          selectedInfos = frames.filter((info) =>
            nextSelectedFrameIds.has(info.frame.id)
          );
        } else {
          nextSelectedFrameIds.add(frameInfo.frame.id);
        }
      } else if (isCtrlOrCmd) {
        nextSelectedFrameIds = new Set(selectedFrameIds);
        if (nextSelectedFrameIds.has(frameInfo.frame.id)) {
          nextSelectedFrameIds.delete(frameInfo.frame.id);
        } else {
          nextSelectedFrameIds.add(frameInfo.frame.id);
        }
        selectedInfos = frames.filter((info) =>
          nextSelectedFrameIds.has(info.frame.id)
        );
        setLastSelectedFrameId(frameInfo.frame.id);
      } else {
        nextSelectedFrameIds.add(frameInfo.frame.id);
        setLastSelectedFrameId(frameInfo.frame.id);
      }

      setSelectedFrameIds(nextSelectedFrameIds);
      syncCanvasSelectedFrames(selectedInfos);
      focusFrameViewport(frameInfo.frame);
    },
    [
      board,
      filteredFrames,
      focusFrameViewport,
      frames,
      lastSelectedFrameId,
      selectedFrameIds,
      syncCanvasSelectedFrames,
    ]
  );

  // 完成重命名
  const handleFinishRename = useCallback(
    (frameInfo: FrameInfo) => {
      if (!board) return;
      const newName = editingName.trim();
      if (newName && newName !== frameInfo.frame.name) {
        Transforms.setNode(board, { name: newName } as any, frameInfo.path);
      }
      setEditingKey(null);
      setEditingName('');
    },
    [board, editingName]
  );

  const getFrameDeleteTargets = useCallback(
    (frameInfo: FrameInfo) => {
      if (
        selectedFrameIds.size > 1 &&
        selectedFrameIds.has(frameInfo.frame.id)
      ) {
        const selectedInfos = frames.filter((info) =>
          selectedFrameIds.has(info.frame.id)
        );
        if (selectedInfos.length > 0) {
          return selectedInfos;
        }
      }
      return [frameInfo];
    },
    [frames, selectedFrameIds]
  );

  // 删除 Frame，并删除绑定到 Frame 的画布内容
  const handleDelete = useCallback(
    async (frameInfo: FrameInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!board) return;

      const targets = getFrameDeleteTargets(frameInfo);
      const targetFrameIds = new Set(targets.map((info) => info.frame.id));
      const isBatchDelete = targetFrameIds.size > 1;

      const confirmed = await confirm({
        title: isBatchDelete ? '确认删除选中的 PPT 页面' : '确认删除 PPT 页面',
        description: isBatchDelete
          ? `确定要删除选中的 ${targetFrameIds.size} 个 PPT 页面及其内容吗？此操作不可撤销。`
          : `确定要删除 PPT 页面「${getFrameDisplayName(
              frameInfo.frame
            )}」及其内容吗？此操作不可撤销。`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });

      if (!confirmed) {
        return;
      }

      const elementsToDelete = FrameTransforms.getFrameContents(
        board,
        targetFrameIds
      );
      if (elementsToDelete.length === 0) {
        MessagePlugin.warning('未找到可删除的 PPT 页面');
        return;
      }

      board.deleteFragment(elementsToDelete);
      setSelectedFrameIds((current) => {
        const next = new Set(current);
        targetFrameIds.forEach((id) => next.delete(id));
        return next;
      });
      setLastSelectedFrameId((current) =>
        current && targetFrameIds.has(current) ? null : current
      );
      MessagePlugin.success(
        isBatchDelete
          ? `已删除 ${targetFrameIds.size} 个 PPT 页面及其内容`
          : '已删除 PPT 页面及其内容'
      );
    },
    [board, confirm, getFrameDeleteTargets]
  );

  // 复制 Frame
  const handleDuplicate = useCallback(
    (frameInfo: FrameInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!board) return;

      const clonedFrame = duplicateFrame(
        board,
        frameInfo.frame,
        language as 'zh' | 'en'
      );

      // 如果复制成功，自动聚焦到新 Frame
      if (clonedFrame) {
        focusFrame(board, clonedFrame);
      }
    },
    [board, language]
  );

  const reorderFrames = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!board) return;

      const framePositions: number[] = [];
      const orderedFrames: PlaitFrame[] = [];

      board.children.forEach((element, index) => {
        if (isFrameElement(element)) {
          framePositions.push(index);
          orderedFrames.push(element as PlaitFrame);
        }
      });

      if (framePositions.length <= 1) return;

      const nextFrames = [...orderedFrames];
      const [moved] = nextFrames.splice(fromIndex, 1);
      nextFrames.splice(toIndex, 0, moved);

      for (let i = framePositions.length - 1; i >= 0; i -= 1) {
        Transforms.removeNode(board, [framePositions[i]]);
      }

      for (let i = 0; i < framePositions.length; i += 1) {
        Transforms.insertNode(board, nextFrames[i], [framePositions[i]]);
      }
    },
    [board]
  );

  const { getDragProps } = useDragSort({
    items: rootFrames,
    getId: (item) => item.listKey,
    onReorder: reorderFrames,
    enabled: !searchQuery.trim() && rootFrames.length > 1,
  });

  const noop = useCallback(() => undefined, []);
  const getFrameDragProps = useCallback(
    (info: FrameInfo) => {
      if (!info.isRoot) {
        return {
          draggable: false,
          onDragStart: noop,
          onDragEnd: noop,
          onDragOver: noop,
          onDragEnter: noop,
          onDragLeave: noop,
          onDrop: noop,
          'data-dragging': false,
          'data-drag-over': false,
          'data-drag-position': undefined,
        };
      }
      const index = rootIndexMap.get(info.listKey) ?? 0;
      return getDragProps(info.listKey, index);
    },
    [getDragProps, rootIndexMap, noop]
  );

  const handleArrangePPTFrames = useCallback(
    (columns = pptLayoutColumns) => {
      if (!board) return;

      const targetFrames = rootFrames.length > 0 ? rootFrames : frames;
      if (targetFrames.length === 0) {
        MessagePlugin.info('当前没有可排列的 PPT 页面');
        return;
      }

      const safeColumns = sanitizePPTFrameLayoutColumns(columns);
      const sortedFrames = getOrderedPPTFrameInfos(targetFrames);
      const frameRects = sortedFrames.map((info) =>
        RectangleClient.getRectangleByPoints(info.frame.points)
      );
      const startPosition: [number, number] = [
        Math.min(...frameRects.map((rect) => rect.x)),
        Math.min(...frameRects.map((rect) => rect.y)),
      ];
      const frameAwareSelection = getFrameAwareSelection(
        board,
        sortedFrames.map((info) => info.frame)
      );
      const movedElementIds = new Set<string>();

      sortedFrames.forEach((info, index) => {
        const rect = RectangleClient.getRectangleByPoints(info.frame.points);
        const targetPosition = getPPTFrameGridPosition(
          startPosition,
          index,
          safeColumns
        );
        moveElementWithFrameRelations(
          board,
          info.frame,
          targetPosition[0] - rect.x,
          targetPosition[1] - rect.y,
          frameAwareSelection.relatedByFrameId,
          movedElementIds
        );
      });

      sortedFrames.forEach((info) => {
        const frame = board.children.find(
          (element) => element.id === info.frame.id && isFrameElement(element)
        );
        if (frame && isFrameElement(frame)) {
          FrameTransforms.updateFrameMembers(board, frame);
        }
      });

      analytics.trackPPTAction({
        action: 'arrange_frames',
        source: 'project_drawer',
        frameCount: sortedFrames.length,
        metadata: { columns: safeColumns },
      });
      MessagePlugin.success(`已按每行 ${safeColumns} 个排列 PPT 页面`);
    },
    [board, frames, pptLayoutColumns, rootFrames]
  );

  const pptLayoutMenuOptions = useMemo(
    () =>
      PPT_LAYOUT_COLUMN_OPTIONS.map((columns) => ({
        content: `每行 ${columns} 个`,
        value: columns,
        prefixIcon:
          columns === pptLayoutColumns ? (
            <Check size={14} />
          ) : (
            <span className="frame-panel__layout-menu-placeholder" />
          ),
      })),
    [pptLayoutColumns]
  );

  const handlePPTLayoutMenuClick = useCallback(
    (data: { value?: unknown }) => {
      const columns = sanitizePPTFrameLayoutColumns(data.value);
      analytics.trackPPTAction({
        action: 'layout_columns_select',
        source: 'project_drawer',
        frameCount: orderedPPTFrames.length,
        metadata: { columns },
      });
      setPPTLayoutColumns(columns);
      savePPTFrameLayoutColumns(columns);
      handleArrangePPTFrames(columns);
    },
    [handleArrangePPTFrames, orderedPPTFrames.length]
  );

  const reorderRootFramesByIds = useCallback(
    (orderedFrameIds: string[]) => {
      if (!board) return;

      const framePositions: number[] = [];
      const frameById = new Map<string, PlaitFrame>();
      const existingFrameIds: string[] = [];
      board.children.forEach((element, index) => {
        if (!isFrameElement(element)) return;
        framePositions.push(index);
        frameById.set(element.id, element as PlaitFrame);
        existingFrameIds.push(element.id);
      });

      if (framePositions.length <= 1) return;

      const orderedIdSet = new Set(orderedFrameIds);
      const nextFrames: PlaitFrame[] = [];
      for (const id of orderedFrameIds) {
        const frame = frameById.get(id);
        if (frame) {
          nextFrames.push(frame);
        }
      }
      for (const id of existingFrameIds) {
        if (orderedIdSet.has(id)) continue;
        const frame = frameById.get(id);
        if (frame) {
          nextFrames.push(frame);
        }
      }

      if (nextFrames.length !== framePositions.length) return;

      for (let i = framePositions.length - 1; i >= 0; i -= 1) {
        Transforms.removeNode(board, [framePositions[i]]);
      }
      for (let i = 0; i < framePositions.length; i += 1) {
        Transforms.insertNode(board, nextFrames[i], [framePositions[i]]);
      }
    },
    [board]
  );

  const renumberPPTFrames = useCallback(
    (orderedFrameIds: string[]) => {
      if (!board) return;

      orderedFrameIds.forEach((frameId, index) => {
        const frameIndex = board.children.findIndex(
          (element) => element.id === frameId && isFrameElement(element)
        );
        if (frameIndex === -1) return;

        const pageIndex = index + 1;
        const frame = board.children[frameIndex] as PlaitFrame & {
          pptMeta?: PPTFrameMeta;
        };
        setFramePPTMeta(board, frameId, {
          pageIndex,
          ...(!frame.pptMeta
            ? { slideImageStatus: 'placeholder' as const }
            : {}),
        });

        if (isDefaultFrameName(frame.name)) {
          Transforms.setNode(
            board,
            { name: getPPTPageFrameName(pageIndex) } as any,
            [frameIndex]
          );
        }
      });
    },
    [board]
  );

  const arrangePPTFramesByIds = useCallback(
    (
      orderedFrameIds: string[],
      startPosition: [number, number],
      columns: number
    ) => {
      if (!board) return;

      const orderedFrames: PlaitFrame[] = [];
      for (const frameId of orderedFrameIds) {
        const frame = board.children.find(
          (element) => element.id === frameId && isFrameElement(element)
        );
        if (frame && isFrameElement(frame)) {
          orderedFrames.push(frame);
        }
      }

      if (orderedFrames.length === 0) return;

      const safeColumns = sanitizePPTFrameLayoutColumns(columns);
      const frameAwareSelection = getFrameAwareSelection(board, orderedFrames);
      const movedElementIds = new Set<string>();

      orderedFrames.forEach((frame, index) => {
        const currentFrame = board.children.find(
          (element) => element.id === frame.id && isFrameElement(element)
        );
        if (!currentFrame || !isFrameElement(currentFrame)) return;

        const rect = RectangleClient.getRectangleByPoints(currentFrame.points);
        const targetPosition = getPPTFrameGridPosition(
          startPosition,
          index,
          safeColumns
        );
        moveElementWithFrameRelations(
          board,
          currentFrame,
          targetPosition[0] - rect.x,
          targetPosition[1] - rect.y,
          frameAwareSelection.relatedByFrameId,
          movedElementIds
        );
      });

      orderedFrameIds.forEach((frameId) => {
        const frame = board.children.find(
          (element) => element.id === frameId && isFrameElement(element)
        );
        if (frame && isFrameElement(frame)) {
          FrameTransforms.updateFrameMembers(board, frame);
        }
      });
    },
    [board]
  );

  const handleInsertPPTPage = useCallback(
    (frameInfo: FrameInfo, placement: PPTPageInsertPlacement) => {
      if (!board) return;
      if (!frameInfo.isRoot) {
        MessagePlugin.warning('暂不支持在嵌套 PPT 页面前后插入新页');
        return;
      }

      const orderedFrames = getOrderedPPTFrameInfos(rootFrames);
      const targetIndex = orderedFrames.findIndex(
        (info) => info.frame.id === frameInfo.frame.id
      );
      if (targetIndex === -1) {
        MessagePlugin.warning('未找到目标 PPT 页');
        return;
      }

      const insertIndex =
        placement === 'before' ? targetIndex : targetIndex + 1;
      const frameRects = orderedFrames.map((info) =>
        RectangleClient.getRectangleByPoints(info.frame.points)
      );
      const targetRect = RectangleClient.getRectangleByPoints(
        frameInfo.frame.points
      );
      const startPosition: [number, number] = [
        Math.min(...frameRects.map((rect) => rect.x)),
        Math.min(...frameRects.map((rect) => rect.y)),
      ];
      const insertPosition = getPPTFrameGridPosition(
        startPosition,
        insertIndex,
        pptLayoutColumns
      );
      const frame = FrameTransforms.insertFrame(
        board,
        [
          insertPosition,
          [
            insertPosition[0] + targetRect.width,
            insertPosition[1] + targetRect.height,
          ],
        ],
        getPPTPageFrameName(insertIndex + 1)
      );
      const styleSpec = pickPPTStyleSpec(orderedFrames, frameInfo);
      const pageSpec: PPTPageSpec = {
        layout: 'title-body',
        title: getPPTPageFrameName(insertIndex + 1),
      };
      setFramePPTMeta(board, frame.id, {
        layout: pageSpec.layout,
        pageIndex: insertIndex + 1,
        styleSpec,
        commonPrompt: formatPPTCommonPrompt(styleSpec),
        slidePrompt: buildPPTFramePrompt(
          orderedFrames,
          pageSpec,
          insertIndex + 1,
          styleSpec
        ),
        slideImageStatus: 'placeholder',
      });

      const orderedFrameIds = orderedFrames.map((info) => info.frame.id);
      orderedFrameIds.splice(insertIndex, 0, frame.id);
      reorderRootFramesByIds(orderedFrameIds);
      renumberPPTFrames(orderedFrameIds);
      arrangePPTFramesByIds(orderedFrameIds, startPosition, pptLayoutColumns);

      const insertedFrame =
        (board.children.find(
          (element) => element.id === frame.id && isFrameElement(element)
        ) as PlaitFrame | undefined) || frame;
      setSelectedFrameIds(new Set([frame.id]));
      setLastSelectedFrameId(frame.id);
      focusFrame(board, insertedFrame);
      analytics.trackPPTAction({
        action: 'insert_page',
        source: 'project_drawer_context_menu',
        pageCount: orderedFrameIds.length,
        prompt: buildPPTFramePrompt(
          orderedFrames,
          pageSpec,
          insertIndex + 1,
          styleSpec
        ),
        metadata: { placement },
      });
      MessagePlugin.success(
        placement === 'before'
          ? '已在前面插入新 PPT 页'
          : '已在后面插入新 PPT 页'
      );
    },
    [
      arrangePPTFramesByIds,
      board,
      pptLayoutColumns,
      renumberPPTFrames,
      reorderRootFramesByIds,
      rootFrames,
    ]
  );

  const handleFrameAdded = useCallback(
    (frame: PlaitFrame) => {
      if (!board) return;
      const pageIndex = board.children.filter((element) =>
        isFrameElement(element)
      ).length;
      const orderedFrames = getOrderedPPTFrameInfos(rootFrames);
      const styleSpec = pickPPTStyleSpec(orderedFrames);
      const pageSpec: PPTPageSpec = {
        layout: 'title-body',
        title: getFramePromptTitle(frame, getPPTPageFrameName(pageIndex)),
      };
      setFramePPTMeta(board, frame.id, {
        layout: pageSpec.layout,
        pageIndex,
        styleSpec,
        commonPrompt: formatPPTCommonPrompt(styleSpec),
        slidePrompt: buildPPTFramePrompt(
          orderedFrames,
          pageSpec,
          pageIndex,
          styleSpec
        ),
        slideImageStatus: 'placeholder',
      });
      analytics.trackPPTAction({
        action: 'add_page',
        source: 'project_drawer_add_dialog',
        pageCount: pageIndex,
        prompt: buildPPTFramePrompt(
          orderedFrames,
          pageSpec,
          pageIndex,
          styleSpec
        ),
      });
    },
    [board, rootFrames]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, frameInfo: FrameInfo) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedFrameIds.has(frameInfo.frame.id)) {
        setSelectedFrameIds(new Set([frameInfo.frame.id]));
        setLastSelectedFrameId(frameInfo.frame.id);
        syncCanvasSelectedFrames([frameInfo]);
      }
      openContextMenu(e, frameInfo);
    },
    [openContextMenu, selectedFrameIds, syncCanvasSelectedFrames]
  );

  const handleContextMenuAction = useCallback(
    (
      action:
        | 'rename'
        | 'duplicate'
        | 'insert-before'
        | 'insert-after'
        | 'delete',
      frameInfo: FrameInfo
    ) => {
      analytics.trackPPTAction({
        action: `context_${action}`,
        source: 'project_drawer',
        pageCount: orderedPPTFrames.length,
        selectedCount: selectedFrameIds.size,
        prompt: frameInfo.slidePrompt,
        metadata: {
          has_slide_image: Boolean(frameInfo.slideImageUrl),
          slide_status:
            frameInfo.pptMeta?.slideImageStatus ||
            frameInfo.pptMeta?.imageStatus,
        },
      });
      if (action === 'rename') {
        setEditingKey(frameInfo.listKey);
        setEditingName(getFrameDisplayName(frameInfo.frame));
      }
      if (action === 'duplicate') {
        handleDuplicate(frameInfo);
      }
      if (action === 'insert-before') {
        handleInsertPPTPage(frameInfo, 'before');
      }
      if (action === 'insert-after') {
        handleInsertPPTPage(frameInfo, 'after');
      }
      if (action === 'delete') {
        void handleDelete(frameInfo);
      }
      closeContextMenu();
    },
    [
      closeContextMenu,
      handleDelete,
      handleDuplicate,
      handleInsertPPTPage,
      orderedPPTFrames.length,
      selectedFrameIds.size,
    ]
  );

  const handleSelectPPTTransition = useCallback(
    (frameInfo: FrameInfo, type: PPTSlideTransitionType) => {
      if (!board) return;

      const option =
        PPT_TRANSITION_OPTIONS.find((item) => item.type === type) ||
        PPT_TRANSITION_OPTIONS[0];
      const transition = getPPTSlideTransition({
        type,
        durationMs: option.durationMs,
      });

      setFramePPTMeta(board, frameInfo.frame.id, { transition });
      analytics.trackPPTAction({
        action: 'set_transition',
        source: 'project_drawer_context_menu',
        pageCount: orderedPPTFrames.length,
        selectedCount: selectedFrameIds.size,
        metadata: {
          transition_type: transition.type,
          transition_duration_ms: transition.durationMs,
        },
      });
      MessagePlugin.success(
        transition.type === 'none'
          ? '已清除 PPT 页面转场'
          : `已设置「${option.label}」转场`
      );
    },
    [board, orderedPPTFrames.length, selectedFrameIds.size]
  );

  const handleUseHistoryImage = useCallback(
    async (frameInfo: FrameInfo, historyItem: PPTSlideImageHistoryItem) => {
      if (!board) return;

      const currentSlideImage = findPPTSlideImage(board, frameInfo.frame.id);
      const historyElementIndex = historyItem.elementId
        ? board.children.findIndex(
            (element: any) =>
              element.id === historyItem.elementId && element.type === 'image'
          )
        : -1;

      try {
        if (historyItem.elementId && historyElementIndex !== -1) {
          replacePPTSlideImage(
            board,
            frameInfo.frame.id,
            historyItem.elementId,
            historyItem.imageUrl,
            {
              replaceElementId: currentSlideImage?.elementId,
              prompt: historyItem.prompt || frameInfo.slidePrompt,
              slidePrompt: frameInfo.slidePrompt,
              imageCreatedAt: historyItem.createdAt,
            }
          );
        } else {
          const insertResult = await insertMediaIntoFrame(
            board,
            historyItem.imageUrl,
            'image',
            frameInfo.frame.id,
            {
              width: frameInfo.width,
              height: frameInfo.height,
            }
          );

          if (!insertResult?.elementId) {
            MessagePlugin.error('历史图片插入失败');
            return;
          }

          replacePPTSlideImage(
            board,
            frameInfo.frame.id,
            insertResult.elementId,
            historyItem.imageUrl,
            {
              replaceElementId: currentSlideImage?.elementId,
              prompt: historyItem.prompt || frameInfo.slidePrompt,
              slidePrompt: frameInfo.slidePrompt,
              imageCreatedAt: historyItem.createdAt,
            }
          );
        }

        MessagePlugin.success('已切换到历史图片');
        analytics.trackPPTAction({
          action: 'use_history_image',
          source: 'project_drawer_context_menu',
          status: 'success',
          pageCount: orderedPPTFrames.length,
          prompt: historyItem.prompt || frameInfo.slidePrompt,
        });
      } catch (error) {
        console.error('[FramePanel] Failed to use history image:', error);
        analytics.trackPPTAction({
          action: 'use_history_image',
          source: 'project_drawer_context_menu',
          status: 'failed',
          pageCount: orderedPPTFrames.length,
          prompt: historyItem.prompt || frameInfo.slidePrompt,
          error: getAnalyticsErrorName(error),
        });
        MessagePlugin.error('切换历史图片失败');
      }
    },
    [board, orderedPPTFrames.length]
  );

  const handleInsertAssetIntoFrame = useCallback(
    async (frameInfo: FrameInfo, asset: Asset) => {
      if (!board) return;

      try {
        const targetFrame = board.children.find(
          (element) =>
            element.id === frameInfo.frame.id && isFrameElement(element)
        ) as PlaitFrame | undefined;
        if (!targetFrame) {
          MessagePlugin.warning('目标 PPT 页面不存在');
          return;
        }

        const frameRect = RectangleClient.getRectangleByPoints(
          targetFrame.points
        );
        const frameSize = {
          width: frameRect.width,
          height: frameRect.height,
        };

        if (asset.type === AssetType.IMAGE) {
          const currentSlideImage = findPPTSlideImage(board, targetFrame.id);
          const insertResult = await insertMediaIntoFrame(
            board,
            asset.url,
            'image',
            targetFrame.id,
            frameSize
          );

          if (!insertResult?.elementId) {
            MessagePlugin.error('素材替换 PPT 页面图片失败');
            return;
          }

          const targetPPTMeta = (
            targetFrame as PlaitFrame & {
              pptMeta?: PPTFrameMeta;
            }
          ).pptMeta;
          replacePPTSlideImage(
            board,
            targetFrame.id,
            insertResult.elementId,
            asset.url,
            {
              replaceElementId: currentSlideImage?.elementId,
              prompt: asset.prompt || getPPTSlidePrompt(targetPPTMeta),
              slidePrompt: getPPTSlidePrompt(targetPPTMeta),
              historyItems: currentSlideImage?.url
                ? [
                    {
                      imageUrl: currentSlideImage.url,
                      ...(currentSlideImage.elementId
                        ? { elementId: currentSlideImage.elementId }
                        : {}),
                      prompt: getPPTSlidePrompt(targetPPTMeta),
                      source: 'manual',
                    },
                  ]
                : undefined,
              imageCreatedAt: asset.createdAt,
            }
          );
          removePPTImagePlaceholder(board, targetFrame.id);

          MessagePlugin.success('已替换 PPT 页面图片');
          analytics.trackPPTAction({
            action: 'insert_asset',
            source: 'project_drawer_media_library',
            status: 'success',
            pageCount: orderedPPTFrames.length,
            prompt: asset.prompt || getPPTSlidePrompt(targetPPTMeta),
            metadata: {
              asset_type: asset.type,
              replaced_existing_image: Boolean(currentSlideImage?.url),
            },
          });
          return;
        }

        if (asset.type === AssetType.VIDEO) {
          await insertMediaIntoFrame(
            board,
            asset.url,
            'video',
            targetFrame.id,
            frameSize
          );
        } else if (asset.type === AssetType.AUDIO) {
          const metadata = {
            title: asset.name,
            duration: asset.duration,
            previewImageUrl: asset.thumbnail,
            prompt: asset.prompt,
            mv: asset.modelName,
            clipId: asset.clipId,
            providerTaskId: asset.providerTaskId,
          };
          const baseSize = resolveAudioCardDimensions(metadata);
          const scale = Math.min(
            1,
            (frameRect.width * 0.8) / baseSize.width,
            (frameRect.height * 0.5) / baseSize.height
          );
          const size = {
            width: Math.max(120, Math.round(baseSize.width * scale)),
            height: Math.max(72, Math.round(baseSize.height * scale)),
          };
          const insertionPoint: [number, number] = [
            frameRect.x + (frameRect.width - size.width) / 2,
            frameRect.y + (frameRect.height - size.height) / 2,
          ];
          const existingIds = new Set(
            board.children
              .map((element) => element.id)
              .filter((id): id is string => typeof id === 'string')
          );

          await insertAudioFromUrl(
            board,
            asset.url,
            {
              ...metadata,
              width: size.width,
              height: size.height,
            },
            insertionPoint,
            false,
            true
          );

          const insertedElement = board.children.find(
            (element) =>
              typeof element.id === 'string' && !existingIds.has(element.id)
          );
          if (insertedElement) {
            FrameTransforms.bindToFrame(board, insertedElement, targetFrame);
          }
        }

        MessagePlugin.success('素材已插入到 PPT 页面');
        analytics.trackPPTAction({
          action: 'insert_asset',
          source: 'project_drawer_media_library',
          status: 'success',
          pageCount: orderedPPTFrames.length,
          prompt: asset.prompt,
          metadata: { asset_type: asset.type },
        });
      } catch (error) {
        console.error('[FramePanel] Failed to insert asset into frame:', error);
        analytics.trackPPTAction({
          action: 'insert_asset',
          source: 'project_drawer_media_library',
          status: 'failed',
          pageCount: orderedPPTFrames.length,
          prompt: asset.prompt,
          error: getAnalyticsErrorName(error),
          metadata: { asset_type: asset.type },
        });
        MessagePlugin.error('素材插入 PPT 页面失败');
        throw error;
      }
    },
    [board, orderedPPTFrames.length]
  );

  const handleOpenFrameMediaLibrary = useCallback(
    (frameInfo: FrameInfo, e: React.MouseEvent) => {
      e.stopPropagation();

      if (!onOpenMediaLibrary) {
        MessagePlugin.warning('素材库暂不可用');
        return;
      }

      setSelectedFrameIds(new Set([frameInfo.frame.id]));
      setLastSelectedFrameId(frameInfo.frame.id);
      syncCanvasSelectedFrames([frameInfo]);
      focusFrameViewport(frameInfo.frame);
      analytics.trackPPTAction({
        action: 'open_media_library',
        source: 'project_drawer',
        pageCount: orderedPPTFrames.length,
        prompt: frameInfo.slidePrompt,
      });
      onOpenMediaLibrary({
        mode: SelectionMode.SELECT,
        onSelect: (asset) => handleInsertAssetIntoFrame(frameInfo, asset),
        selectButtonText: '插入到 PPT 页',
        keepProjectDrawerOpen: true,
      });
    },
    [
      focusFrameViewport,
      handleInsertAssetIntoFrame,
      onOpenMediaLibrary,
      orderedPPTFrames.length,
      syncCanvasSelectedFrames,
    ]
  );

  const contextMenuItems = useMemo<ContextMenuEntry<FrameInfo>[]>(
    () => [
      {
        key: 'rename',
        label: '重命名',
        icon: <EditIcon />,
        onSelect: (frameInfo) => handleContextMenuAction('rename', frameInfo),
      },
      {
        key: 'duplicate',
        label: '复制',
        icon: <FileCopyIcon />,
        onSelect: (frameInfo) =>
          handleContextMenuAction('duplicate', frameInfo),
      },
      {
        key: 'insert-before',
        label: '在前面插入新页',
        icon: <AddIcon />,
        disabled: (frameInfo) => !frameInfo.isRoot,
        onSelect: (frameInfo) =>
          handleContextMenuAction('insert-before', frameInfo),
      },
      {
        key: 'insert-after',
        label: '在后面插入新页',
        icon: <AddIcon />,
        disabled: (frameInfo) => !frameInfo.isRoot,
        onSelect: (frameInfo) =>
          handleContextMenuAction('insert-after', frameInfo),
      },
      {
        key: 'image-history',
        type: 'submenu',
        label: '生图历史',
        icon: <ImageIcon />,
        disabled: (frameInfo) => getSlideImageHistory(frameInfo).length === 0,
        children: (frameInfo) =>
          getSlideImageHistory(frameInfo).map((historyItem, index) => ({
            key: historyItem.id || `history-${index}`,
            label: (
              <PPTSlideHistoryMenuLabel
                item={historyItem}
                index={index}
                isCurrent={isSlideHistoryCurrentImage(frameInfo, historyItem)}
              />
            ),
            onSelect: () => {
              void handleUseHistoryImage(frameInfo, historyItem);
            },
          })),
      },
      {
        key: 'transition',
        type: 'submenu',
        label: '动画/转场',
        icon: <Sparkles size={14} />,
        children: (frameInfo) => {
          const current = getPPTSlideTransition(frameInfo.pptMeta?.transition);
          return PPT_TRANSITION_OPTIONS.map((option) => ({
            key: `transition-${option.type}`,
            label: (
              <PPTTransitionMenuLabel
                label={option.label}
                description={option.description}
                active={current.type === option.type}
              />
            ),
            onSelect: () => {
              handleSelectPPTTransition(frameInfo, option.type);
            },
          }));
        },
      },
      { key: 'divider-1', type: 'divider' },
      {
        key: 'delete',
        label: (frameInfo) =>
          selectedFrameIds.size > 1 && selectedFrameIds.has(frameInfo.frame.id)
            ? `删除选中 ${selectedFrameIds.size} 项`
            : '删除',
        icon: <DeleteIcon />,
        danger: true,
        onSelect: (frameInfo) => handleContextMenuAction('delete', frameInfo),
      },
    ],
    [
      handleContextMenuAction,
      handleSelectPPTTransition,
      handleUseHistoryImage,
      selectedFrameIds,
    ]
  );

  const handleRegenerateSlide = useCallback(
    (frameInfo: FrameInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      const slidePrompt = frameInfo.slidePrompt || '';
      const commonPrompt =
        frameInfo.pptMeta?.commonPrompt?.trim() ||
        getPPTCommonPromptFromFrameInfos(orderedPPTFrames);
      const previousSlideImage = board
        ? findPreviousPPTSlideImage(board, frameInfo.frame.id)
        : null;
      const initialImages: Array<{ url: string; name: string }> = [];
      if (frameInfo.slideImageUrl) {
        initialImages.push({
          url: frameInfo.slideImageUrl,
          name: `${frameInfo.frame.name || 'slide'}-reference.png`,
        });
      }
      if (
        previousSlideImage?.url &&
        previousSlideImage.url !== frameInfo.slideImageUrl
      ) {
        initialImages.push({
          url: previousSlideImage.url,
          name: `${frameInfo.frame.name || 'slide'}-previous-reference.png`,
        });
      }
      appendInitialReferenceImages(
        initialImages,
        frameInfo.pptMeta?.referenceImages,
        `${frameInfo.frame.name || 'slide'}-deck-reference`
      );

      analytics.trackPPTAction({
        action: 'open_slide_regenerate',
        source: pptViewMode === 'outline' ? 'outline_view' : 'slides_view',
        pageCount: orderedPPTFrames.length,
        prompt: slidePrompt,
        metadata: {
          has_current_image: Boolean(frameInfo.slideImageUrl),
          has_previous_reference: Boolean(previousSlideImage?.url),
          has_deck_reference: Boolean(
            frameInfo.pptMeta?.referenceImages?.length
          ),
          replace_existing_image: Boolean(frameInfo.slideImageElementId),
        },
      });
      openDialog(DialogType.aiImageGeneration, {
        initialPrompt: buildPPTImageGenerationPrompt(commonPrompt, slidePrompt),
        initialImages,
        initialAspectRatio: '16x9',
        initialWidth: frameInfo.width,
        initialHeight: frameInfo.height,
        targetFrameId: frameInfo.frame.id,
        targetFrameDimensions: {
          width: frameInfo.width,
          height: frameInfo.height,
        },
        autoInsertToCanvas: true,
        pptSlideImage: true,
        pptSlidePrompt: slidePrompt,
        pptReplaceElementId: frameInfo.slideImageElementId,
      });
    },
    [board, openDialog, orderedPPTFrames, pptViewMode]
  );

  const handleToggleOutlineSelection = useCallback(
    (checked: boolean) => {
      analytics.trackPPTAction({
        action: checked
          ? 'select_all_outline_slides'
          : 'clear_outline_selection',
        source: 'project_drawer_outline',
        pageCount: orderedPPTFrames.length,
        selectedCount: checked ? orderedPPTFrames.length : 0,
      });
      setOutlineSelectedFrameIds(
        checked
          ? new Set(orderedPPTFrames.map((info) => info.frame.id))
          : new Set()
      );
    },
    [orderedPPTFrames]
  );

  const handleToggleOutlineSlide = useCallback(
    (frameId: string, checked: boolean) => {
      analytics.trackPPTAction({
        action: checked ? 'select_outline_slide' : 'deselect_outline_slide',
        source: 'project_drawer_outline',
        pageCount: orderedPPTFrames.length,
      });
      setOutlineSelectedFrameIds((current) => {
        const next = new Set(current);
        if (checked) {
          next.add(frameId);
        } else {
          next.delete(frameId);
        }
        return next;
      });
    },
    [orderedPPTFrames.length]
  );

  const handleSlidePromptDraftChange = useCallback(
    (frameId: string, value: string) => {
      setSlidePromptDrafts((current) => ({
        ...current,
        [frameId]: value,
      }));
    },
    []
  );

  const persistPPTTitleDraft = useCallback(
    (title = pptTitleDraft) => {
      if (!board) return;
      const normalizedTitle = title.trim();
      orderedPPTFrames.forEach((info) => {
        setFramePPTMeta(board, info.frame.id, {
          deckTitle: normalizedTitle || undefined,
        });
      });
      analytics.trackPPTAction({
        action: 'save_deck_title',
        source: 'project_drawer_outline',
        pageCount: orderedPPTFrames.length,
        prompt: normalizedTitle,
      });
    },
    [board, orderedPPTFrames, pptTitleDraft]
  );

  const rememberCommonPromptHistory = useCallback(
    (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) {
        return;
      }
      addCommonPromptHistory(trimmedPrompt, false, 'ppt-common');
    },
    [addCommonPromptHistory]
  );

  const persistCommonPromptDraft = useCallback(
    (prompt = commonPromptDraft) => {
      if (!board) return;
      rememberCommonPromptHistory(prompt);
      orderedPPTFrames.forEach((info) => {
        setFramePPTMeta(board, info.frame.id, {
          commonPrompt: prompt,
        });
      });
      analytics.trackPPTAction({
        action: 'save_common_prompt',
        source: 'project_drawer_outline',
        pageCount: orderedPPTFrames.length,
        prompt,
      });
    },
    [board, commonPromptDraft, orderedPPTFrames, rememberCommonPromptHistory]
  );

  const handleToggleCommonPromptHistory = useCallback(() => {
    refreshCommonPromptHistory();
    analytics.trackPromptAction({
      action: 'toggle_history',
      surface: 'ppt_common_prompt',
      promptType: 'ppt-common',
      itemCount: commonPromptHistory.length,
    });
    setCommonPromptHistoryOpen((current) => !current);
  }, [commonPromptHistory.length, refreshCommonPromptHistory]);

  const handleSelectCommonPromptHistory = useCallback(
    (item: PromptItem) => {
      setCommonPromptDraft(item.content);
      persistCommonPromptDraft(item.content);
      setCommonPromptHistoryOpen(false);
      analytics.trackPPTAction({
        action: 'select_common_prompt_history',
        source: 'project_drawer_outline',
        pageCount: orderedPPTFrames.length,
        prompt: item.content,
      });
    },
    [orderedPPTFrames.length, persistCommonPromptDraft]
  );

  const handleToggleCommonPromptHistoryPin = useCallback(
    (id: string) => {
      analytics.trackPromptAction({
        action: 'toggle_pin',
        surface: 'ppt_common_prompt',
        promptType: 'ppt-common',
      });
      togglePinCommonPromptHistory(id);
    },
    [togglePinCommonPromptHistory]
  );

  const handleDeleteCommonPromptHistory = useCallback(
    async (id: string) => {
      const confirmed = await confirm({
        title: '确认删除公共提示词历史',
        description: '确定要删除这条公共提示词历史吗？此操作不可撤销。',
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      removeCommonPromptHistory(id);
      analytics.trackPromptAction({
        action: 'delete_confirmed',
        surface: 'ppt_common_prompt',
        promptType: 'ppt-common',
      });
    },
    [confirm, removeCommonPromptHistory]
  );

  const persistSlidePromptDraft = useCallback(
    (frameId: string, prompt: string) => {
      if (!board) return;
      setFramePPTMeta(board, frameId, {
        slidePrompt: prompt,
      });
      analytics.trackPPTAction({
        action: 'save_slide_prompt',
        source: 'project_drawer_outline',
        pageCount: orderedPPTFrames.length,
        prompt,
      });
    },
    [board, orderedPPTFrames.length]
  );

  const persistOutlineDrafts = useCallback(() => {
    if (!board) return;
    const normalizedTitle = pptTitleDraft.trim();
    orderedPPTFrames.forEach((info) => {
      setFramePPTMeta(board, info.frame.id, {
        deckTitle: normalizedTitle || undefined,
        commonPrompt: commonPromptDraft,
        slidePrompt: slidePromptDrafts[info.frame.id] ?? info.slidePrompt ?? '',
      });
    });
    rememberCommonPromptHistory(commonPromptDraft);
    analytics.trackPPTAction({
      action: 'persist_outline_drafts',
      source: 'project_drawer_outline',
      pageCount: orderedPPTFrames.length,
      prompt: commonPromptDraft,
    });
  }, [
    board,
    commonPromptDraft,
    orderedPPTFrames,
    pptTitleDraft,
    rememberCommonPromptHistory,
    slidePromptDrafts,
  ]);

  const outlinePromptOptimizeOriginalPrompt = useMemo(() => {
    if (!outlinePromptOptimizeTarget) {
      return '';
    }
    if (outlinePromptOptimizeTarget.type === 'common') {
      return commonPromptDraft;
    }

    const frameId = outlinePromptOptimizeTarget.frameId;
    return (
      slidePromptDrafts[frameId] ??
      orderedPPTFrames.find((info) => info.frame.id === frameId)?.slidePrompt ??
      ''
    );
  }, [
    commonPromptDraft,
    orderedPPTFrames,
    outlinePromptOptimizeTarget,
    slidePromptDrafts,
  ]);

  const handleApplyOptimizedOutlinePrompt = useCallback(
    (optimizedPrompt: string) => {
      if (!outlinePromptOptimizeTarget) {
        return;
      }

      if (outlinePromptOptimizeTarget.type === 'common') {
        setCommonPromptDraft(optimizedPrompt);
        persistCommonPromptDraft(optimizedPrompt);
        analytics.trackPPTAction({
          action: 'apply_optimized_prompt',
          source: 'project_drawer_outline',
          pageCount: orderedPPTFrames.length,
          prompt: optimizedPrompt,
          metadata: { prompt_scope: 'common' },
        });
        return;
      }

      const { frameId } = outlinePromptOptimizeTarget;
      setSlidePromptDrafts((current) => ({
        ...current,
        [frameId]: optimizedPrompt,
      }));
      persistSlidePromptDraft(frameId, optimizedPrompt);
      analytics.trackPPTAction({
        action: 'apply_optimized_prompt',
        source: 'project_drawer_outline',
        pageCount: orderedPPTFrames.length,
        prompt: optimizedPrompt,
        metadata: { prompt_scope: 'slide' },
      });
    },
    [
      outlinePromptOptimizeTarget,
      orderedPPTFrames.length,
      persistCommonPromptDraft,
      persistSlidePromptDraft,
    ]
  );

  const generateOneOutlineSlide = useCallback(
    async (
      frameInfo: FrameInfo,
      slidePrompt: string,
      runtime: PPTOutlineGenerationRuntime,
      batchIndex: number,
      referenceImages?: string[],
      referenceSize?: string
    ): Promise<string> => {
      if (!board) {
        throw new Error('画布未初始化');
      }
      throwIfPPTOutlineCancelled(runtime.controller.signal);

      const currentSlideImage = findPPTSlideImage(board, frameInfo.frame.id);
      const prompt = buildPPTImageGenerationPrompt(
        commonPromptDraft,
        slidePrompt
      );
      setFramePPTMeta(board, frameInfo.frame.id, {
        commonPrompt: commonPromptDraft,
        slidePrompt,
        slideImageStatus: 'loading',
        imageStatus: 'loading',
      });

      const result = await createImageTask({
        prompt,
        size: referenceImages?.length
          ? referenceSize || PPT_DEFAULT_IMAGE_SIZE
          : PPT_DEFAULT_IMAGE_SIZE,
        model: outlineImageModel || undefined,
        modelRef: outlineImageModelRef,
        referenceImages:
          referenceImages && referenceImages.length > 0
            ? referenceImages
            : undefined,
        autoInsertToCanvas: true,
        targetFrameId: frameInfo.frame.id,
        targetFrameDimensions: {
          width: frameInfo.width,
          height: frameInfo.height,
        },
        pptSlideImage: true,
        pptSlidePrompt: slidePrompt,
        pptReplaceElementId: currentSlideImage?.elementId,
        batchId: runtime.batchId,
        batchIndex,
        batchTotal: runtime.total,
      });

      if (!result.success || !result.taskId) {
        throwIfPPTOutlineCancelled(runtime.controller.signal);
        setFramePPTMeta(board, frameInfo.frame.id, {
          slideImageStatus: 'failed',
          imageStatus: 'failed',
        });
        throw new Error(result.error || '创建图片任务失败');
      }

      runtime.submittedTaskIds.add(result.taskId);
      runtime.activeTaskIds.add(result.taskId);
      emitPPTOutlineRuntimeChange();
      if (runtime.controller.signal.aborted) {
        taskQueueService.cancelTask(result.taskId);
        throw new Error(PPT_OUTLINE_CANCELLED_ERROR);
      }

      let completion: Awaited<ReturnType<typeof waitForTaskCompletion>> | null =
        null;
      try {
        completion = await waitForTaskCompletion(result.taskId, {
          timeout: PPT_TASK_WAIT_TIMEOUT_MS,
          signal: runtime.controller.signal,
        });
      } finally {
        runtime.activeTaskIds.delete(result.taskId);
        emitPPTOutlineRuntimeChange();
      }

      if (
        !completion ||
        runtime.controller.signal.aborted ||
        completion.task?.status === TaskStatus.CANCELLED
      ) {
        throw new Error(PPT_OUTLINE_CANCELLED_ERROR);
      }

      const imageUrl = getTaskResultImageUrl(completion.task);
      if (!completion.success || !imageUrl) {
        setFramePPTMeta(board, frameInfo.frame.id, {
          slideImageStatus: 'failed',
          imageStatus: 'failed',
        });
        throw new Error(completion.error || '图片生成失败');
      }

      return imageUrl;
    },
    [board, commonPromptDraft, outlineImageModel, outlineImageModelRef]
  );

  const resetStoppedOutlineFrames = useCallback(
    (frameIds: string[]) => {
      if (!board) return;
      const uniqueFrameIds = Array.from(new Set(frameIds));
      uniqueFrameIds.forEach((frameId) => {
        const frameInfo = orderedPPTFrames.find(
          (info) => info.frame.id === frameId
        );
        const currentSlideImage = findPPTSlideImage(board, frameId);
        const hasSlideImage = Boolean(
          currentSlideImage?.url ||
            frameInfo?.slideImageUrl ||
            frameInfo?.pptMeta?.slideImageUrl
        );
        const nextStatus = hasSlideImage ? 'generated' : 'placeholder';
        setFramePPTMeta(board, frameId, {
          slideImageStatus: nextStatus,
          imageStatus: nextStatus,
        });
      });
    },
    [board, orderedPPTFrames]
  );

  const handleStopOutlineGeneration = useCallback(() => {
    if (!activeOutlineGeneration) {
      return;
    }

    const runtimeCancelResult = requestCancelPPTOutlineRuntime(
      activeOutlineGeneration.batchId
    );
    const taskIds = Array.from(
      new Set([
        ...activeOutlineGeneration.activeTaskIds,
        ...activeOutlineGeneration.taskIds,
        ...runtimeCancelResult.taskIds,
      ])
    );
    const frameIds = Array.from(
      new Set([
        ...activeOutlineGeneration.frameIds,
        ...runtimeCancelResult.frameIds,
      ])
    );
    const cancelledCount =
      runtimeCancelResult.cancelledCount + cancelActivePPTOutlineTasks(taskIds);

    resetStoppedOutlineFrames(frameIds);
    analytics.trackPPTAction({
      action: 'stop_outline_generation',
      source: 'project_drawer_outline',
      status: 'cancelled',
      pageCount: orderedPPTFrames.length,
      selectedCount: frameIds.length,
      metadata: {
        cancelled_count: cancelledCount,
        active_task_count: taskIds.length,
      },
    });
    MessagePlugin.success(
      cancelledCount > 0
        ? `已停止 ${cancelledCount} 个 PPT 生图任务`
        : '已停止 PPT 生图流程'
    );
  }, [
    activeOutlineGeneration,
    orderedPPTFrames.length,
    resetStoppedOutlineFrames,
  ]);

  const handleGenerateOutlineSlides = useCallback(async () => {
    if (!board || isOutlineGenerating || activePPTOutlineRuntime) return;

    const selectedFrames = orderedPPTFrames.filter((info) =>
      outlineSelectedFrameIds.has(info.frame.id)
    );

    if (selectedFrames.length === 0) {
      MessagePlugin.warning('请先选择要生成的 PPT 页面');
      return;
    }

    const missingPromptFrame = selectedFrames.find((info) => {
      const prompt = slidePromptDrafts[info.frame.id] ?? info.slidePrompt ?? '';
      return !prompt.trim();
    });
    if (missingPromptFrame) {
      MessagePlugin.warning(
        `请先填写「${getFrameDisplayName(missingPromptFrame.frame)}」的提示词`
      );
      return;
    }

    const generationStartTime = Date.now();
    const runtime: PPTOutlineGenerationRuntime = {
      batchId: `${PPT_OUTLINE_BATCH_PREFIX}${Date.now()}`,
      frameIds: selectedFrames.map((info) => info.frame.id),
      submittedTaskIds: new Set(),
      activeTaskIds: new Set(),
      controller: new AbortController(),
      total: selectedFrames.length,
      successCount: 0,
      failedCount: 0,
      status: `准备生成 0/${selectedFrames.length}`,
      cancelRequested: false,
    };
    activePPTOutlineRuntime = runtime;
    emitPPTOutlineRuntimeChange();

    persistOutlineDrafts();
    analytics.trackPPTAction({
      action: 'generate_outline_slides',
      source: 'project_drawer_outline',
      status: 'start',
      pageCount: orderedPPTFrames.length,
      selectedCount: selectedFrames.length,
      serialMode: outlineSerialMode,
      model: outlineImageModel || undefined,
      prompt: commonPromptDraft,
    });
    const generatedUrls = new Map<string, string>();
    const generatedTaskSizes = new Map<string, string>();

    const generateFrame = async (
      frameInfo: FrameInfo,
      selectedIndex: number,
      referenceImages?: string[],
      referenceSize?: string
    ) => {
      throwIfPPTOutlineCancelled(runtime.controller.signal);
      const prompt =
        slidePromptDrafts[frameInfo.frame.id] ?? frameInfo.slidePrompt ?? '';
      const finalReferenceImages = mergePPTReferenceImages(
        referenceImages,
        frameInfo.pptMeta?.referenceImages
      );
      try {
        const imageUrl = await generateOneOutlineSlide(
          frameInfo,
          prompt,
          runtime,
          selectedIndex + 1,
          finalReferenceImages,
          referenceSize
        );
        generatedUrls.set(frameInfo.frame.id, imageUrl);
        generatedTaskSizes.set(
          frameInfo.frame.id,
          finalReferenceImages?.length && referenceSize
            ? referenceSize
            : PPT_DEFAULT_IMAGE_PIXEL_SIZE
        );
        runtime.successCount++;
      } catch (error) {
        if (isPPTOutlineCancelledError(error)) {
          runtime.cancelRequested = true;
          runtime.controller.abort();
          throw error;
        }
        console.error(
          '[FramePanel] PPT outline slide generation failed:',
          error
        );
        runtime.failedCount++;
      } finally {
        updatePPTOutlineRuntimeStatus(runtime);
      }
    };

    try {
      if (outlineSerialMode) {
        for (
          let selectedIndex = 0;
          selectedIndex < selectedFrames.length;
          selectedIndex++
        ) {
          throwIfPPTOutlineCancelled(runtime.controller.signal);
          const frameInfo = selectedFrames[selectedIndex];
          const frameIndex = orderedPPTFrames.findIndex(
            (info) => info.frame.id === frameInfo.frame.id
          );
          const previousFrameInfo =
            frameIndex > 0 ? orderedPPTFrames[frameIndex - 1] : undefined;
          const previousSlideImage = previousFrameInfo
            ? findPPTSlideImage(board, previousFrameInfo.frame.id)
            : null;
          const previousReferenceUrl = previousFrameInfo
            ? generatedUrls.get(previousFrameInfo.frame.id) ||
              previousSlideImage?.url ||
              previousFrameInfo.slideImageUrl
            : undefined;
          const previousReferenceSize = previousFrameInfo
            ? generatedTaskSizes.get(previousFrameInfo.frame.id) ||
              getPPTReferenceImageTaskSize(previousSlideImage, {
                width: previousFrameInfo.width,
                height: previousFrameInfo.height,
              })
            : undefined;

          await generateFrame(
            frameInfo,
            selectedIndex,
            previousReferenceUrl ? [previousReferenceUrl] : undefined,
            previousReferenceUrl ? previousReferenceSize : undefined
          );
        }
      } else {
        let nextIndex = 0;
        const workerCount = Math.min(
          PPT_PARALLEL_GENERATION_LIMIT,
          selectedFrames.length
        );
        const workers = Array.from({ length: workerCount }, async () => {
          while (
            nextIndex < selectedFrames.length &&
            !runtime.controller.signal.aborted
          ) {
            throwIfPPTOutlineCancelled(runtime.controller.signal);
            const selectedIndex = nextIndex;
            const frameInfo = selectedFrames[nextIndex];
            nextIndex++;
            await generateFrame(frameInfo, selectedIndex);
          }
        });
        const workerResults = await Promise.allSettled(workers);
        if (
          workerResults.some(
            (result) =>
              result.status === 'rejected' &&
              isPPTOutlineCancelledError(result.reason)
          )
        ) {
          throw new Error(PPT_OUTLINE_CANCELLED_ERROR);
        }
      }

      if (runtime.cancelRequested) {
        resetStoppedOutlineFrames(runtime.frameIds);
        analytics.trackPPTAction({
          action: 'generate_outline_slides',
          source: 'project_drawer_outline',
          status: 'cancelled',
          pageCount: orderedPPTFrames.length,
          selectedCount: selectedFrames.length,
          successCount: runtime.successCount,
          failedCount: runtime.failedCount,
          durationMs: Date.now() - generationStartTime,
          serialMode: outlineSerialMode,
          model: outlineImageModel || undefined,
          prompt: commonPromptDraft,
        });
      } else if (runtime.failedCount > 0) {
        analytics.trackPPTAction({
          action: 'generate_outline_slides',
          source: 'project_drawer_outline',
          status: 'failed',
          pageCount: orderedPPTFrames.length,
          selectedCount: selectedFrames.length,
          successCount: runtime.successCount,
          failedCount: runtime.failedCount,
          durationMs: Date.now() - generationStartTime,
          serialMode: outlineSerialMode,
          model: outlineImageModel || undefined,
          prompt: commonPromptDraft,
        });
        MessagePlugin.warning(
          `已生成 ${runtime.successCount} 页，${runtime.failedCount} 页失败`
        );
      } else {
        analytics.trackPPTAction({
          action: 'generate_outline_slides',
          source: 'project_drawer_outline',
          status: 'success',
          pageCount: orderedPPTFrames.length,
          selectedCount: selectedFrames.length,
          successCount: runtime.successCount,
          failedCount: runtime.failedCount,
          durationMs: Date.now() - generationStartTime,
          serialMode: outlineSerialMode,
          model: outlineImageModel || undefined,
          prompt: commonPromptDraft,
        });
        MessagePlugin.success(
          `已提交并完成 ${runtime.successCount} 页 PPT 生图`
        );
      }
    } catch (error) {
      if (isPPTOutlineCancelledError(error)) {
        resetStoppedOutlineFrames(runtime.frameIds);
        analytics.trackPPTAction({
          action: 'generate_outline_slides',
          source: 'project_drawer_outline',
          status: 'cancelled',
          pageCount: orderedPPTFrames.length,
          selectedCount: selectedFrames.length,
          successCount: runtime.successCount,
          failedCount: runtime.failedCount,
          durationMs: Date.now() - generationStartTime,
          serialMode: outlineSerialMode,
          model: outlineImageModel || undefined,
          prompt: commonPromptDraft,
        });
      } else {
        analytics.trackPPTAction({
          action: 'generate_outline_slides',
          source: 'project_drawer_outline',
          status: 'failed',
          pageCount: orderedPPTFrames.length,
          selectedCount: selectedFrames.length,
          successCount: runtime.successCount,
          failedCount: runtime.failedCount,
          durationMs: Date.now() - generationStartTime,
          serialMode: outlineSerialMode,
          model: outlineImageModel || undefined,
          prompt: commonPromptDraft,
          error: getAnalyticsErrorName(error),
        });
        throw error;
      }
    } finally {
      finishPPTOutlineRuntime(runtime);
    }
  }, [
    board,
    generateOneOutlineSlide,
    isOutlineGenerating,
    orderedPPTFrames,
    outlineSelectedFrameIds,
    outlineSerialMode,
    outlineImageModel,
    persistOutlineDrafts,
    resetStoppedOutlineFrames,
    slidePromptDrafts,
    commonPromptDraft,
  ]);

  // 导出所有 PPT 页面为一个 PPT 文件
  const handleExportAllPPT = useCallback(async () => {
    if (!board) return;
    if (frames.length === 0) {
      MessagePlugin.info('当前没有可导出的 PPT 页面');
      return;
    }

    if (isExportingAllPPT) return;
    setIsExportingAllPPT(true);
    const exportStartTime = Date.now();
    analytics.trackPPTAction({
      action: 'export_all',
      source: 'project_drawer',
      status: 'start',
      pageCount: frames.length,
    });
    try {
      const fileName = resolvePPTExportFileName(
        pptTitleDraft,
        currentBoardName
      );
      persistPPTTitleDraft(pptTitleDraft);
      await exportAllPPTFrames(board, { fileName });
      analytics.trackPPTAction({
        action: 'export_all',
        source: 'project_drawer',
        status: 'success',
        pageCount: frames.length,
        durationMs: Date.now() - exportStartTime,
      });
      MessagePlugin.success(`已导出 ${frames.length} 页 PPT`);
    } catch (error) {
      console.error('[FramePanel] Export all PPT failed:', error);
      analytics.trackPPTAction({
        action: 'export_all',
        source: 'project_drawer',
        status: 'failed',
        pageCount: frames.length,
        durationMs: Date.now() - exportStartTime,
        error: getAnalyticsErrorName(error),
      });
      MessagePlugin.error('PPT 导出失败');
    } finally {
      setIsExportingAllPPT(false);
    }
  }, [
    board,
    currentBoardName,
    frames,
    isExportingAllPPT,
    persistPPTTitleDraft,
    pptTitleDraft,
  ]);

  const allOutlineSlidesSelected =
    orderedPPTFrames.length > 0 &&
    orderedPPTFrames.every((info) =>
      outlineSelectedFrameIds.has(info.frame.id)
    );
  const selectedOutlineSlideCount = orderedPPTFrames.filter((info) =>
    outlineSelectedFrameIds.has(info.frame.id)
  ).length;
  const outlineSelectionLabel = `${
    allOutlineSlidesSelected ? '取消' : '全选'
  }${selectedOutlineSlideCount}/${orderedPPTFrames.length}`;

  if (!board) {
    return (
      <div className="frame-panel__empty">
        <p>画布未初始化</p>
      </div>
    );
  }

  return (
    <div className="frame-panel">
      {/* 搜索 */}
      <div className="frame-panel__filter">
        <Input
          placeholder="搜索 PPT 页面..."
          value={searchQuery}
          onChange={setSearchQuery}
          prefixIcon={<SearchIcon />}
          size="small"
        />
      </div>

      <div className="frame-panel__toolbar">
        <div className="frame-panel__view-switch" aria-label="PPT 视图切换">
          <HoverTip content="PPT 页面视图">
            <Button
              variant={pptViewMode === 'slides' ? 'base' : 'outline'}
              size="small"
              shape="square"
              icon={<Presentation size={16} strokeWidth={1.8} />}
              onClick={() => handlePPTViewModeChange('slides')}
            />
          </HoverTip>
          <HoverTip content="大纲视图">
            <Button
              variant={pptViewMode === 'outline' ? 'base' : 'outline'}
              size="small"
              shape="square"
              icon={<List size={16} strokeWidth={1.8} />}
              onClick={() => handlePPTViewModeChange('outline')}
            />
          </HoverTip>
        </div>

        {/* 操作栏：icon + hover 文字 */}
        <div className="frame-panel__actions">
          <HoverTip content="添加 PPT 页面">
            <Button
              variant="outline"
              size="small"
              shape="square"
              icon={<AddIcon />}
              onClick={() => {
                analytics.trackPPTAction({
                  action: 'open_add_page_dialog',
                  source: 'project_drawer',
                  pageCount: frames.length,
                });
                setAddDialogVisible(true);
              }}
            />
          </HoverTip>
          <HoverTip
            content={frames.length === 0 ? '没有 PPT 页面可播放' : '播放 PPT'}
          >
            <Button
              variant="outline"
              size="small"
              shape="square"
              icon={<PlayCircleIcon />}
              disabled={frames.length === 0}
              onClick={() => {
                analytics.trackPPTAction({
                  action: 'open_slideshow',
                  source: 'project_drawer',
                  pageCount: frames.length,
                });
                setSlideshowVisible(true);
              }}
            />
          </HoverTip>
          {frames.length > 0 && (
            <HoverTip
              content={
                isExportingAllPPT ? '正在导出 PPT...' : '导出所有 PPT 页面'
              }
            >
              <Button
                variant="outline"
                size="small"
                shape="square"
                icon={
                  isExportingAllPPT ? (
                    <Loading size="small" />
                  ) : (
                    <DownloadIcon size={16} />
                  )
                }
                disabled={isExportingAllPPT}
                onClick={handleExportAllPPT}
              />
            </HoverTip>
          )}
          {frames.length > 0 && (
            <Dropdown
              trigger="click"
              options={pptLayoutMenuOptions}
              onClick={handlePPTLayoutMenuClick}
              minColumnWidth={120}
            >
              <HoverTip
                content={`排列 PPT 页面（当前每行 ${pptLayoutColumns} 个）`}
              >
                <Button
                  variant="outline"
                  size="small"
                  shape="square"
                  icon={<AlignHorizontalDistributeCenter size={16} />}
                  onClick={() => handleArrangePPTFrames(pptLayoutColumns)}
                />
              </HoverTip>
            </Dropdown>
          )}
        </div>
      </div>

      {pptViewMode === 'outline' ? (
        orderedPPTFrames.length === 0 || filteredOutlineFrames.length === 0 ? (
          <div className="frame-panel__empty">
            <div className="frame-panel__empty-icon" aria-hidden="true">
              {orderedPPTFrames.length === 0 ? (
                <List size={24} strokeWidth={1.8} />
              ) : (
                <SearchIcon />
              )}
            </div>
            <div className="frame-panel__empty-copy">
              {orderedPPTFrames.length === 0 ? (
                <>
                  <p className="frame-panel__empty-title">
                    当前画布没有 PPT 大纲
                  </p>
                  <p className="frame-panel__empty-hint">
                    可以通过“生成PPT大纲”的 SKILL 进行创建
                  </p>
                  <Button
                    className="frame-panel__empty-action"
                    theme="primary"
                    size="small"
                    icon={<Sparkles size={14} strokeWidth={1.9} />}
                    onClick={handleCreatePPTOutlineClick}
                  >
                    生成 PPT 大纲
                  </Button>
                </>
              ) : (
                <p className="frame-panel__empty-title">
                  未找到匹配的 PPT 页面
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="frame-panel__outline">
            <div className="frame-panel__outline-body">
              {reviewPendingPptExplainerTasks.map(({ task, state }) => (
                <div
                  className="frame-panel__explainer-review"
                  key={task.id}
                  data-testid="ppt-explainer-review-pending"
                >
                  <div className="frame-panel__explainer-review-copy">
                    <span className="frame-panel__explainer-review-title">
                      PPT 讲解视频
                    </span>
                    <span className="frame-panel__explainer-review-topic">
                      {state.topic?.trim() || '当前大纲'}
                    </span>
                    {pptExplainerConfirmErrors[task.id] ? (
                      <span
                        className="frame-panel__explainer-review-error"
                        role="alert"
                      >
                        {pptExplainerConfirmErrors[task.id]}
                      </span>
                    ) : null}
                  </div>
                  <Button
                    theme="primary"
                    size="small"
                    icon={<Video size={15} strokeWidth={1.8} />}
                    loading={confirmingPptExplainerTaskIds.has(task.id)}
                    disabled={confirmingPptExplainerTaskIds.has(task.id)}
                    onClick={() => void handleConfirmPptExplainerTask(task.id)}
                  >
                    确认并生成
                  </Button>
                </div>
              ))}
              <div className="frame-panel__outline-title">
                <span className="frame-panel__outline-label">PPT 标题</span>
                <Input
                  value={pptTitleDraft}
                  onChange={setPPTTitleDraft}
                  onBlur={() => persistPPTTitleDraft()}
                  placeholder={currentBoardName?.trim() || 'PPT 标题'}
                  size="small"
                  disabled={isOutlineGenerating}
                />
              </div>

              <div className="frame-panel__outline-common">
                <div className="frame-panel__outline-common-header">
                  <span className="frame-panel__outline-label">公共提示词</span>
                  <div className="frame-panel__outline-common-actions">
                    <HoverTip content="公共提示词历史" placement="top">
                      <Button
                        className="frame-panel__outline-history-trigger"
                        variant="outline"
                        size="small"
                        shape="square"
                        icon={<History size={15} />}
                        disabled={isOutlineGenerating}
                        onClick={handleToggleCommonPromptHistory}
                      />
                    </HoverTip>
                    <HoverTip content="提示词优化" placement="top">
                      <Button
                        className="frame-panel__outline-optimize"
                        variant="outline"
                        size="small"
                        shape="square"
                        icon={<Sparkles size={15} />}
                        disabled={isOutlineGenerating}
                        onClick={() =>
                          setOutlinePromptOptimizeTarget({ type: 'common' })
                        }
                      />
                    </HoverTip>
                  </div>
                </div>
                {commonPromptHistoryOpen && (
                  <div
                    ref={commonPromptHistoryPanelRef}
                    className="frame-panel__outline-history-panel"
                  >
                    {commonPromptHistoryItems.length > 0 ? (
                      <PromptListPanel
                        title="公共提示词历史"
                        items={commonPromptHistoryItems}
                        onSelect={handleSelectCommonPromptHistory}
                        onTogglePin={handleToggleCommonPromptHistoryPin}
                        onDelete={handleDeleteCommonPromptHistory}
                        language={language as 'zh' | 'en'}
                        analyticsSurface="ppt_common_prompt"
                        analyticsPromptType="ppt-common"
                        showCount
                      />
                    ) : (
                      <div className="frame-panel__outline-history-empty">
                        暂无公共提示词历史
                      </div>
                    )}
                  </div>
                )}
                <Textarea
                  value={commonPromptDraft}
                  onChange={(value) => setCommonPromptDraft(value)}
                  onBlur={() => persistCommonPromptDraft()}
                  autosize={{ minRows: 4, maxRows: 8 }}
                  disabled={isOutlineGenerating}
                />
              </div>

              <div className="frame-panel__outline-list">
                {filteredOutlineFrames.map((info) => {
                  const pageIndex = Math.max(
                    0,
                    orderedPPTFrames.findIndex(
                      (item) => item.frame.id === info.frame.id
                    )
                  );
                  const slidePrompt =
                    slidePromptDrafts[info.frame.id] ?? info.slidePrompt ?? '';
                  const previewImageUrl = info.slideImageElementId
                    ? resolvePPTFramePreviewUrl(
                        frameSnapshotUrls[info.frame.id],
                        info.slideImageUrl
                      )
                    : undefined;
                  return (
                    <div
                      key={info.listKey}
                      className="frame-panel__outline-item"
                    >
                      <div className="frame-panel__outline-item-top">
                        <Checkbox
                          checked={outlineSelectedFrameIds.has(info.frame.id)}
                          disabled={isOutlineGenerating}
                          onChange={(checked) =>
                            handleToggleOutlineSlide(
                              info.frame.id,
                              checked as boolean
                            )
                          }
                        />
                        <div className="frame-panel__outline-item-header">
                          <div className="frame-panel__outline-item-title">
                            <span className="frame-panel__outline-page-index">
                              {pageIndex + 1}
                            </span>
                            <span className="frame-panel__outline-page-title">
                              {getFrameDisplayName(info.frame)}
                            </span>
                          </div>
                          <div className="frame-panel__outline-item-actions">
                            <PPTOutlineSlideImageAction
                              imageUrl={previewImageUrl}
                              title={getFrameDisplayName(info.frame)}
                              status={
                                info.pptMeta?.slideImageStatus ||
                                info.pptMeta?.imageStatus
                              }
                              disabled={isOutlineGenerating}
                              onClick={(event) =>
                                handleRegenerateSlide(info, event)
                              }
                            />
                            <HoverTip content="提示词优化" placement="top">
                              <Button
                                className="frame-panel__outline-optimize"
                                variant="outline"
                                size="small"
                                shape="square"
                                icon={<Sparkles size={15} />}
                                disabled={isOutlineGenerating}
                                onClick={() =>
                                  setOutlinePromptOptimizeTarget({
                                    type: 'slide',
                                    frameId: info.frame.id,
                                  })
                                }
                              />
                            </HoverTip>
                          </div>
                        </div>
                      </div>
                      <div className="frame-panel__outline-slide-prompt">
                        <Textarea
                          value={slidePrompt}
                          onChange={(value) =>
                            handleSlidePromptDraftChange(info.frame.id, value)
                          }
                          onBlur={() =>
                            persistSlidePromptDraft(info.frame.id, slidePrompt)
                          }
                          autosize={{ minRows: 4, maxRows: 12 }}
                          disabled={isOutlineGenerating}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="frame-panel__outline-footer">
              <div className="frame-panel__outline-footer-main">
                <div className="frame-panel__outline-footer-controls">
                  <div className="frame-panel__outline-selection-summary">
                    <Checkbox
                      className="frame-panel__outline-control"
                      checked={allOutlineSlidesSelected}
                      disabled={
                        isOutlineGenerating || orderedPPTFrames.length === 0
                      }
                      onChange={(checked) =>
                        handleToggleOutlineSelection(checked as boolean)
                      }
                    >
                      {outlineSelectionLabel}
                    </Checkbox>
                    {outlineGenerationStatus && (
                      <span className="frame-panel__outline-status">
                        {outlineGenerationStatus}
                      </span>
                    )}
                  </div>
                  <Checkbox
                    className="frame-panel__outline-control"
                    checked={outlineSerialMode}
                    disabled={isOutlineGenerating}
                    onChange={(checked) => {
                      const nextSerialMode = checked as boolean;
                      analytics.trackPPTAction({
                        action: 'generation_mode_change',
                        source: 'project_drawer_outline',
                        serialMode: nextSerialMode,
                        pageCount: orderedPPTFrames.length,
                        selectedCount: selectedOutlineSlideCount,
                      });
                      setOutlineSerialMode(nextSerialMode);
                    }}
                  >
                    {outlineSerialMode ? '串行' : '并行'}
                  </Checkbox>
                </div>
              </div>
              <div className="frame-panel__outline-generate-actions">
                <ModelDropdown
                  selectedModel={outlineImageModel}
                  selectedSelectionKey={getSelectionKey(
                    outlineImageModel,
                    outlineImageModelRef
                  )}
                  onSelect={handleOutlineImageModelSelect}
                  onSelectModel={handleOutlineImageModelConfigSelect}
                  language={language as 'zh' | 'en'}
                  models={visibleOutlineImageModels}
                  header={
                    language === 'zh'
                      ? '选择图片模型 (↑↓ Tab)'
                      : 'Select image model (↑↓ Tab)'
                  }
                  disabled={isOutlineGenerating}
                  placement="up"
                />
                <Button
                  className="frame-panel__outline-generate"
                  theme={isOutlineGenerating ? 'danger' : 'primary'}
                  size="small"
                  icon={isOutlineGenerating ? <StopCircleIcon /> : undefined}
                  disabled={
                    !isOutlineGenerating && selectedOutlineSlideCount === 0
                  }
                  onClick={() =>
                    isOutlineGenerating
                      ? handleStopOutlineGeneration()
                      : void handleGenerateOutlineSlides()
                  }
                >
                  {isOutlineGenerating ? '停止' : '生成'}
                </Button>
              </div>
            </div>
          </div>
        )
      ) : filteredFrames.length === 0 ? (
        <div className="frame-panel__empty">
          <div className="frame-panel__empty-icon" aria-hidden="true">
            {frames.length === 0 ? (
              <Presentation size={24} strokeWidth={1.8} />
            ) : (
              <SearchIcon />
            )}
          </div>
          <div className="frame-panel__empty-copy">
            {frames.length === 0 ? (
              <>
                <p className="frame-panel__empty-title">
                  当前画布没有 PPT 页面
                </p>
                <p className="frame-panel__empty-hint">
                  可以通过“生成PPT大纲”的 SKILL 进行创建
                </p>
                <Button
                  className="frame-panel__empty-action"
                  theme="primary"
                  size="small"
                  icon={<Sparkles size={14} strokeWidth={1.9} />}
                  onClick={handleCreatePPTOutlineClick}
                >
                  生成 PPT 大纲
                </Button>
              </>
            ) : (
              <p className="frame-panel__empty-title">未找到匹配的 PPT 页面</p>
            )}
          </div>
        </div>
      ) : (
        <div className="frame-panel__list">
          {filteredFrames.map((info) => {
            const dragProps = getFrameDragProps(info);
            const pptTransition = getPPTSlideTransition(
              info.pptMeta?.transition
            );
            const hasPPTTransition = pptTransition.type !== 'none';
            const previewImageUrl = resolvePPTFramePreviewUrl(
              frameSnapshotUrls[info.frame.id],
              info.slideImageUrl
            );
            return (
              <div
                key={info.listKey}
                ref={(node) => setFrameItemRef(info.frame.id, node)}
                className={classNames('frame-panel__item', {
                  'frame-panel__item--active': selectedFrameIds.has(
                    info.frame.id
                  ),
                  'frame-panel__item--dragging': dragProps['data-dragging'],
                  'frame-panel__item--drag-over': dragProps['data-drag-over'],
                  'frame-panel__item--drag-before':
                    dragProps['data-drag-position'] === 'before',
                  'frame-panel__item--drag-after':
                    dragProps['data-drag-position'] === 'after',
                  'frame-panel__item--with-transition': hasPPTTransition,
                })}
                onClick={(e) => handleFrameClick(info, e)}
                onContextMenu={(e) => handleContextMenu(e, info)}
                {...dragProps}
              >
                {info.pptMeta ? (
                  <PPTSlidePreview
                    imageUrl={previewImageUrl}
                    title={getFrameDisplayName(info.frame)}
                    status={
                      info.pptMeta.slideImageStatus || info.pptMeta.imageStatus
                    }
                  />
                ) : (
                  <div className="frame-panel__item-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect
                        x="1.5"
                        y="1.5"
                        width="13"
                        height="13"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeDasharray="3 2"
                        fill="none"
                      />
                    </svg>
                  </div>
                )}

                <div className="frame-panel__item-content">
                  {editingKey === info.listKey ? (
                    <Input
                      value={editingName}
                      onChange={setEditingName}
                      size="small"
                      autofocus
                      onBlur={() => handleFinishRename(info)}
                      onEnter={() => handleFinishRename(info)}
                      onClick={(context: { e: React.MouseEvent }) =>
                        context.e.stopPropagation()
                      }
                    />
                  ) : (
                    <>
                      <span className="frame-panel__item-name">
                        {getFrameDisplayName(info.frame)}
                      </span>
                      <span className="frame-panel__item-meta">
                        {info.width} × {info.height}
                        {info.childCount > 0 && ` · ${info.childCount} 个元素`}
                      </span>
                    </>
                  )}
                </div>

                <div
                  className={classNames('frame-panel__item-actions', {
                    'frame-panel__item-actions--with-transition':
                      hasPPTTransition,
                  })}
                >
                  <div className="frame-panel__item-action-buttons">
                    {info.pptMeta && (
                      <HoverTip
                        content={info.slidePrompt ? '重新生成' : 'AI 图片生成'}
                      >
                        <Button
                          variant="text"
                          size="small"
                          shape="square"
                          icon={<AIImageIcon size={16} />}
                          onClick={(e) =>
                            handleRegenerateSlide(
                              info,
                              e as unknown as React.MouseEvent
                            )
                          }
                        />
                      </HoverTip>
                    )}
                    <HoverTip content="素材库" showArrow={false}>
                      <Button
                        variant="text"
                        size="small"
                        shape="square"
                        icon={<MediaLibraryIcon size={16} />}
                        onClick={(e) =>
                          handleOpenFrameMediaLibrary(
                            info,
                            e as unknown as React.MouseEvent
                          )
                        }
                      />
                    </HoverTip>
                    <HoverTip
                      content={
                        selectedFrameIds.size > 1 &&
                        selectedFrameIds.has(info.frame.id)
                          ? `删除选中 ${selectedFrameIds.size} 项`
                          : '删除'
                      }
                      showArrow={false}
                    >
                      <Button
                        variant="text"
                        size="small"
                        shape="square"
                        theme="danger"
                        icon={<DeleteIcon />}
                        onClick={(e) =>
                          void handleDelete(
                            info,
                            e as unknown as React.MouseEvent
                          )
                        }
                      />
                    </HoverTip>
                  </div>
                  {hasPPTTransition ? (
                    <PPTTransitionBadge
                      transitionType={pptTransition.type}
                      onContextMenu={(event) => handleContextMenu(event, info)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ContextMenu
        state={contextMenu}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />

      {/* 添加 PPT 页面弹窗 */}
      <AddFrameDialog
        visible={addDialogVisible}
        board={board}
        onClose={() => setAddDialogVisible(false)}
        onFrameAdded={handleFrameAdded}
      />

      {/* 幻灯片播放 */}
      <FrameSlideshow
        visible={slideshowVisible}
        board={board}
        onClose={() => setSlideshowVisible(false)}
      />
      {outlinePromptOptimizeTarget && (
        <PromptOptimizeDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setOutlinePromptOptimizeTarget(null);
            }
          }}
          originalPrompt={outlinePromptOptimizeOriginalPrompt}
          language={language as 'zh' | 'en'}
          scenarioId={
            outlinePromptOptimizeTarget.type === 'common'
              ? 'ppt.common'
              : 'ppt.slide'
          }
          historyType={
            outlinePromptOptimizeTarget.type === 'common'
              ? 'ppt-common'
              : 'image'
          }
          allowStructuredMode={true}
          onApply={handleApplyOptimizedOutlinePrompt}
        />
      )}
      {confirmDialog}
    </div>
  );
};
