import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileArchive,
  FileText,
  FileUp,
  Image as ImageIcon,
  Play,
  Plus,
  RefreshCw,
  Square,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { MediaLibraryIcon } from '../icons';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { ParametersDropdown } from '../ai-input-bar/ParametersDropdown';
import {
  ModelVendor,
  getCompatibleParams,
  type ModelConfig,
  type ParamConfig,
} from '../../constants/model-config';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import {
  createModelRef,
  hasInvocationRouteCredentials,
  settingsManager,
  type ModelRef,
} from '../../utils/settings-manager';
import { promptForApiKey } from '../../utils/gemini-api';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
} from '../../utils/model-selection';
import { generateUUID } from '../../utils/runtime-helpers';
import { taskQueueService } from '../../services/task-queue';
import { unifiedCacheService } from '../../services/unified-cache-service';
import {
  TaskType,
  type KnowledgeContextRef,
  type Task,
} from '../../types/task.types';
import { createImageTask } from '../../mcp/tools/image-generation';
import { waitForTaskCompletion } from '../../services/media-executor';
import { MessagePlugin } from '../../utils/message-plugin';
import {
  analytics,
  getPromptAnalyticsSummary,
} from '../../utils/posthog-analytics';
import { MediaViewer } from '../shared/MediaViewer';
import {
  WorkflowNavBar,
  useWorkflowNavigation,
  useWorkflowRecords,
  readStoredModelSelection,
  writeStoredModelSelection,
  type WorkflowStepConfig,
} from '../shared/workflow';
import { PromptOptimizeButton } from '../shared/PromptOptimizeButton';
import { KnowledgeNoteContextSelector } from '../shared/KnowledgeNoteContextSelector';
import { HoverTip } from '../shared/hover';
import { RetryImage } from '../retry-image';
import { useWorkflowTaskSync } from '../shared/workflow/useWorkflowTaskSync';
import { useMediaViewer } from '../../hooks/useMediaViewer';
import { MediaLibraryModal } from '../media-library';
import { AssetType, SelectionMode, type Asset } from '../../types/asset.types';
import {
  ReferenceImageUpload,
  type ReferenceImage,
} from '../ttd-dialog/shared';
import { addRecord, deleteRecord, loadRecords, updateRecord } from './storage';
import {
  isComicCreatorTask,
  isComicCreatorTerminalTask,
  syncComicOutlineTask,
  syncComicPageImageTask,
} from './task-sync';
import {
  appendComicPageImageVariants,
  buildComicPageImageVariantsFromResult,
  buildComicImagePrompt,
  buildComicScriptPrompt,
  formatComicPromptPreview,
  getComicGenerationConcurrency,
  getComicGeneratedImageCount,
  getComicGeneratedPageCount,
  getComicPageImageVariants,
  getComicPagesForGeneration,
  normalizeComicPageTitle,
  sanitizeComicPageCount,
  selectComicPageImageVariant,
} from './utils';
import {
  COMIC_SCENARIO_PRESETS,
  DEFAULT_COMIC_SCENARIO_ID,
  getComicScenarioPreset,
  getComicScenarioPrompt,
  getComicScenarioPromptContext,
  isComicScenarioTemplatePrompt,
} from './scenario-presets';
import {
  exportComicAsPdf,
  exportComicAsPptx,
  exportComicAsZip,
} from './export-service';
import {
  DEFAULT_COMIC_IMAGE_SIZE,
  DEFAULT_COMIC_PAGE_COUNT,
  type ComicGenerationMode,
  type ComicImageExportSource,
  type ComicPage,
  type ComicPageImageVariant,
  type ComicPromptInputMode,
  type ComicRecord,
} from './types';
import { COMIC_CREATOR_TOOL_ID } from '../../tools/tool-ids';
import '../video-analyzer/VideoAnalyzer.scss';
import '../music-analyzer/MusicAnalyzer.scss';
import './ComicCreator.scss';

type PageId = 'plan' | 'generate' | 'history';
type WorkflowPageId = Exclude<PageId, 'history'>;

const STORAGE_KEY_TEXT_MODEL = 'comic-creator:text-model';
const STORAGE_KEY_IMAGE_MODEL = 'comic-creator:image-model';
const STORAGE_KEY_STORY_PROMPT = 'comic-creator:story-prompt';
const STORAGE_KEY_STORY_PROMPT_MODE = 'comic-creator:story-prompt-mode';
const STORAGE_KEY_SCENARIO_ID = 'comic-creator:scenario-id';
const MAX_COMIC_PDF_SIZE = 20 * 1024 * 1024;
const COMIC_ANALYTICS_AREA = 'multi_image_generation';
const COMIC_ANALYTICS_SURFACE = 'comic_creator_tool';
const COMIC_ANALYTICS_ACTION_EVENT = 'multi_image_generation_action';
const COMIC_ANALYTICS_PV_EVENT = 'multi_image_generation_page_view';
const COMIC_ANALYTICS_UV_EVENT = 'multi_image_generation_unique_view';
const COMIC_ANALYTICS_DAILY_UV_KEY =
  'comic-creator:analytics:daily-unique-view';
const COMIC_IMAGE_COUNT_OPTIONS = [1, 2, 3, 4];
const COMIC_DEFAULT_TEXT_MODEL_ID = 'gemini-2.5-pro-all';
const COMIC_DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2';
const LEGACY_COMIC_DEFAULT_TEXT_MODEL_ID = 'gpt-5.5';
const LEGACY_COMIC_DEFAULT_IMAGE_MODEL_ID = 'gpt-image-2-vip';

interface ComicPdfAttachment {
  cacheUrl: string;
  name: string;
  size: number;
  mimeType: string;
}

function getLocalDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shouldTrackDailyUniqueView(dayKey: string): boolean {
  try {
    if (localStorage.getItem(COMIC_ANALYTICS_DAILY_UV_KEY) === dayKey) {
      return false;
    }
    localStorage.setItem(COMIC_ANALYTICS_DAILY_UV_KEY, dayKey);
    return true;
  } catch {
    return false;
  }
}

function getFileSizeBucket(size?: number): string {
  if (!Number.isFinite(size || 0) || !size) return '0';
  if (size < 1024 * 1024) return '<1MB';
  if (size < 5 * 1024 * 1024) return '1-5MB';
  if (size < 10 * 1024 * 1024) return '5-10MB';
  return '10MB+';
}

function getComicRecordAnalytics(record?: ComicRecord | null) {
  const pageCount = record?.pages.length || 0;
  const generatedPageCount = getComicGeneratedPageCount(record);
  const generatedImageCount = getComicGeneratedImageCount(record);
  const failedCount =
    record?.pages.filter((pageItem) => pageItem.status === 'failed').length ||
    0;
  return {
    has_record: Boolean(record),
    page_count: pageCount,
    generated_count: generatedImageCount,
    generated_page_count: generatedPageCount,
    failed_count: failedCount,
    completion_rate: pageCount > 0 ? generatedPageCount / pageCount : 0,
  };
}

function trackComicCreatorEvent(
  action: string,
  data?: Record<string, unknown>
): void {
  analytics.track(COMIC_ANALYTICS_ACTION_EVENT, {
    category: 'ai_generation',
    area: COMIC_ANALYTICS_AREA,
    surface: COMIC_ANALYTICS_SURFACE,
    tool_id: COMIC_CREATOR_TOOL_ID,
    tool_name: '多图生成',
    action,
    ...(data || {}),
    timestamp: Date.now(),
  });
}

function trackComicCreatorClick(
  control: string,
  data?: Record<string, unknown>
): void {
  const metadata = data || {};
  analytics.trackUIInteraction({
    area: COMIC_ANALYTICS_AREA,
    action: 'click',
    control,
    source: COMIC_ANALYTICS_SURFACE,
    metadata,
  });
  trackComicCreatorEvent('click', {
    control,
    event_type: 'click',
    ...metadata,
  });
}

const COMIC_STEPS: Array<Omit<WorkflowStepConfig<WorkflowPageId>, 'disabled'>> =
  [
    { id: 'plan', label: '提示词' },
    { id: 'generate', label: '生成' },
  ];

function readSessionStoryPrompt(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY_STORY_PROMPT) || '';
  } catch {
    return '';
  }
}

function writeSessionStoryPrompt(value: string): void {
  try {
    if (value.trim()) {
      sessionStorage.setItem(STORAGE_KEY_STORY_PROMPT, value);
    } else {
      sessionStorage.removeItem(STORAGE_KEY_STORY_PROMPT);
    }
  } catch {
    // sessionStorage unavailable
  }
}

function readSessionPromptMode(): ComicPromptInputMode {
  try {
    return sessionStorage.getItem(STORAGE_KEY_STORY_PROMPT_MODE) === 'json'
      ? 'json'
      : 'text';
  } catch {
    return 'text';
  }
}

function writeSessionPromptMode(value: ComicPromptInputMode): void {
  try {
    sessionStorage.setItem(STORAGE_KEY_STORY_PROMPT_MODE, value);
  } catch {
    // sessionStorage unavailable
  }
}

function readSessionScenarioId(): string {
  try {
    return (
      sessionStorage.getItem(STORAGE_KEY_SCENARIO_ID) ||
      DEFAULT_COMIC_SCENARIO_ID
    );
  } catch {
    return DEFAULT_COMIC_SCENARIO_ID;
  }
}

function writeSessionScenarioId(value: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY_SCENARIO_ID, value);
  } catch {
    // sessionStorage unavailable
  }
}

function isGeminiTextModel(model: ModelConfig): boolean {
  const value = `${model.id} ${model.label} ${model.shortLabel || ''} ${
    model.sourceProfileName || ''
  }`.toLowerCase();
  return (
    model.vendor === ModelVendor.GEMINI ||
    model.vendor === ModelVendor.GOOGLE ||
    value.includes('gemini')
  );
}

function getModelRefForOption(model: ModelConfig): ModelRef | null {
  return model.sourceProfileId
    ? createModelRef(model.sourceProfileId, model.id)
    : null;
}

function getModelRefForSelection(model: ModelConfig): ModelRef | null {
  return getModelRefFromConfig(model);
}

function selectFallbackModel(
  models: ModelConfig[],
  fallbackModelId: string
): ModelConfig | undefined {
  return (
    findMatchingSelectableModel(models, fallbackModelId, null) ||
    models.find((model) => !model.isVip) ||
    models[0]
  );
}

function readComicModelSelection(
  storageKey: string,
  models: ModelConfig[],
  fallbackModelId: string,
  legacyFallbackModelId: string
): { modelId: string; modelRef: ModelRef | null } {
  const stored = readStoredModelSelection(storageKey, fallbackModelId);
  const isLegacyFallback =
    stored.modelId === legacyFallbackModelId && !stored.modelRef?.profileId;
  const matchedStored = findMatchingSelectableModel(
    models,
    stored.modelId,
    stored.modelRef
  );

  if (matchedStored && !isLegacyFallback) {
    return {
      modelId: matchedStored.id,
      modelRef: getModelRefForSelection(matchedStored),
    };
  }

  const fallback = selectFallbackModel(models, fallbackModelId);
  return {
    modelId: fallback?.id || fallbackModelId,
    modelRef: fallback ? getModelRefForSelection(fallback) : null,
  };
}

function isSelectedModelInList(
  models: ModelConfig[],
  modelId: string,
  modelRef?: ModelRef | null
): boolean {
  return Boolean(findMatchingSelectableModel(models, modelId, modelRef));
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getDefaultParamValues(params: ParamConfig[]): Record<string, string> {
  return params.reduce<Record<string, string>>((acc, param) => {
    if (param.id === 'size') {
      const hasDefaultSize = param.options?.some(
        (option) => option.value === DEFAULT_COMIC_IMAGE_SIZE
      );
      acc[param.id] = hasDefaultSize
        ? DEFAULT_COMIC_IMAGE_SIZE
        : param.defaultValue ||
          param.options?.[0]?.value ||
          DEFAULT_COMIC_IMAGE_SIZE;
      return acc;
    }

    if (param.defaultValue) {
      acc[param.id] = param.defaultValue;
    }
    return acc;
  }, {});
}

function normalizeParamsForConfigs(
  params: Record<string, string> | undefined,
  compatibleParams: ParamConfig[]
): Record<string, string> {
  const defaults = getDefaultParamValues(compatibleParams);
  const next: Record<string, string> = { ...defaults };
  const source = params || {};

  for (const param of compatibleParams) {
    const value = source[param.id];
    if (!value) continue;

    if (
      param.valueType === 'enum' &&
      param.options?.length &&
      !param.options.some((option) => option.value === value)
    ) {
      continue;
    }

    next[param.id] = value;
  }

  if (!next.size) {
    next.size = DEFAULT_COMIC_IMAGE_SIZE;
  }
  return next;
}

function renumberPages(pages: ComicPage[]): ComicPage[] {
  return pages.map((page, index) => ({
    ...page,
    pageNumber: index + 1,
  }));
}

function createBlankPage(pageNumber: number): ComicPage {
  return {
    id: generateUUID(),
    pageNumber,
    title: `第 ${pageNumber} 页`,
    script: '',
    prompt: '',
    status: 'draft',
  };
}

function getPageHeaderTitle(page: ComicPage): string {
  const title = normalizeComicPageTitle(page.title, page.pageNumber);
  return title === `第 ${page.pageNumber} 页` ? '' : title;
}

function renderOutlinePromptPreview(value: unknown, fallback?: string) {
  const preview = formatComicPromptPreview(value, fallback);
  const className = [
    'comic-outline-preview__content',
    preview.isJson ? 'comic-outline-preview__content--json' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return <pre className={className}>{preview.text}</pre>;
}

function getImageSources(record: ComicRecord): ComicImageExportSource[] {
  const aspectRatio = getAspectRatioFromSize(record.imageParams?.size);
  return record.pages
    .filter((page) => !!page.imageUrl)
    .map((page) => ({
      pageId: page.id,
      pageNumber: page.pageNumber,
      url: page.imageUrl as string,
      mimeType: page.imageMimeType,
      aspectRatio,
    }));
}

function getZipImageSources(record: ComicRecord): ComicImageExportSource[] {
  const aspectRatio = getAspectRatioFromSize(record.imageParams?.size);

  return record.pages.flatMap((page) => {
    const variants = getComicPageImageVariants(page);
    if (variants.length === 0) return [];

    const selectedIndex = page.imageUrl
      ? variants.findIndex((variant) => variant.url === page.imageUrl)
      : -1;
    const selectedVariant =
      variants[selectedIndex >= 0 ? selectedIndex : variants.length - 1];
    let unselectedVariantNumber = 1;

    return [
      selectedVariant,
      ...variants.filter((variant) => variant.url !== selectedVariant.url),
    ].map((variant) => {
      const isSelected = variant.url === selectedVariant.url;
      const source: ComicImageExportSource = {
        pageId: page.id,
        pageNumber: page.pageNumber,
        url: variant.url,
        mimeType: variant.mimeType || page.imageMimeType,
        aspectRatio,
      };

      if (!isSelected) {
        source.variantNumber = unselectedVariantNumber;
        unselectedVariantNumber += 1;
      }

      return source;
    });
  });
}

function getCreatedImageTaskIds(result: {
  taskId?: string;
  task?: unknown;
  data?: unknown;
}): string[] {
  const data = result.data as
    | { taskId?: unknown; taskIds?: unknown }
    | undefined;
  const task = result.task as { id?: unknown } | undefined;
  const ids = [
    ...(Array.isArray(data?.taskIds) ? data.taskIds : []),
    data?.taskId,
    result.taskId,
    task?.id,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);

  return Array.from(new Set(ids));
}

function getImageCountPerPage(value: number): number {
  return COMIC_IMAGE_COUNT_OPTIONS.includes(value) ? value : 1;
}

function getAspectRatioFromSize(size?: string): string | undefined {
  const normalized = String(size || '')
    .trim()
    .replace(/[xX]/g, ':');
  return /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(normalized)
    ? normalized
    : undefined;
}

function getRecordStatus(record: ComicRecord): string {
  if (record.pendingOutlineTaskId) return '规划中';
  if (
    record.pages.some(
      (page) => page.status === 'running' || page.status === 'queued'
    )
  ) {
    return '生成中';
  }
  if (record.pages.some((page) => page.status === 'failed')) return '有失败';
  if (
    record.pages.length > 0 &&
    record.pages.every((page) => getComicPageImageVariants(page).length > 0)
  )
    return '已完成';
  if (record.pages.length > 0) return '已规划';
  return '草稿';
}

function formatRecordCreatedAt(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return '时间未知';
  }

  return new Date(createdAt).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ComicCreator: React.FC = () => {
  const {
    records,
    setRecords,
    currentRecord,
    showStarred,
    setShowStarred,
    starredCount,
    selectRecord,
    updateCurrentRecord,
    restart,
    applySyncedRecord,
  } = useWorkflowRecords<ComicRecord>({
    loadRecords,
    logPrefix: '[ComicCreator]',
  });
  const {
    page,
    setPage,
    navigateToStep,
    goToDefaultPage,
    openHistory,
    openStarred,
    toggleStarred,
  } = useWorkflowNavigation<PageId, WorkflowPageId>({
    initialPage: 'plan',
    defaultPage: 'plan',
    historyPage: 'history',
    setShowStarred,
  });
  const { openViewer, viewerProps } = useMediaViewer({
    showNavbar: true,
    showToolbar: true,
    showTitle: true,
  });

  const latestRecordRef = useRef<ComicRecord | null>(null);
  const activeTaskIdsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const outlineSubmittingRef = useRef(false);
  const generationRunningRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const outlineResultRef = useRef<HTMLDivElement | null>(null);
  const outlineScrollRequestedRef = useRef<string | null>(null);
  const hasTrackedViewRef = useRef(false);
  const lastTrackedPageRef = useRef<PageId | null>(null);

  const textModels = useSelectableModels('text');
  const imageModels = useSelectableModels('image');
  const geminiTextModels = useMemo(
    () => textModels.filter(isGeminiTextModel),
    [textModels]
  );
  const initialTextSelection = useMemo(
    () =>
      readComicModelSelection(
        STORAGE_KEY_TEXT_MODEL,
        textModels,
        COMIC_DEFAULT_TEXT_MODEL_ID,
        LEGACY_COMIC_DEFAULT_TEXT_MODEL_ID
      ),
    [textModels]
  );
  const initialImageSelection = useMemo(
    () =>
      readComicModelSelection(
        STORAGE_KEY_IMAGE_MODEL,
        imageModels,
        COMIC_DEFAULT_IMAGE_MODEL_ID,
        LEGACY_COMIC_DEFAULT_IMAGE_MODEL_ID
      ),
    [imageModels]
  );
  const initialPromptMode = useMemo(
    () => currentRecord?.sourcePromptMode || readSessionPromptMode(),
    []
  );
  const initialScenarioId = useMemo(
    () =>
      getComicScenarioPreset(
        currentRecord?.scenarioId || readSessionScenarioId()
      ).id,
    []
  );

  const [storyPrompt, setStoryPrompt] = useState(
    () =>
      currentRecord?.sourcePrompt ||
      readSessionStoryPrompt() ||
      getComicScenarioPrompt(initialScenarioId, 'text')
  );
  const [knowledgeContextRefs, setKnowledgeContextRefs] = useState<
    KnowledgeContextRef[]
  >([]);
  const [promptInputMode, setPromptInputMode] = useState<ComicPromptInputMode>(
    () => initialPromptMode
  );
  const [scenarioId, setScenarioId] = useState(initialScenarioId);
  const [pageCountInput, setPageCountInput] = useState(
    String(DEFAULT_COMIC_PAGE_COUNT)
  );
  const [textModel, setTextModelState] = useState(initialTextSelection.modelId);
  const [textModelRef, setTextModelRef] = useState<ModelRef | null>(
    initialTextSelection.modelRef
  );
  const [pdfAttachment, setPdfAttachment] = useState<ComicPdfAttachment | null>(
    null
  );
  const [imageModel, setImageModelState] = useState(
    initialImageSelection.modelId
  );
  const [imageModelRef, setImageModelRef] = useState<ModelRef | null>(
    initialImageSelection.modelRef
  );
  const compatibleImageParams = useMemo(
    () => getCompatibleParams(imageModel),
    [imageModel]
  );
  const [imageParams, setImageParams] = useState<Record<string, string>>(() =>
    normalizeParamsForConfigs(
      undefined,
      getCompatibleParams(initialImageSelection.modelId)
    )
  );
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [generationMode, setGenerationMode] =
    useState<ComicGenerationMode>('serial');
  const [imageCountPerPage, setImageCountPerPage] = useState(1);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(
    new Set()
  );
  const [submittingOutline, setSubmittingOutline] = useState(false);
  const [generationState, setGenerationState] = useState<{
    running: boolean;
    stopping: boolean;
    current: number;
    total: number;
    message: string;
  }>({ running: false, stopping: false, current: 0, total: 0, message: '' });
  const [exporting, setExporting] = useState<'zip' | 'pptx' | 'pdf' | null>(
    null
  );
  const [libraryTargetPageId, setLibraryTargetPageId] = useState<string | null>(
    null
  );
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const selectedScenario = useMemo(
    () => getComicScenarioPreset(scenarioId),
    [scenarioId]
  );
  const selectableTextModels = pdfAttachment ? geminiTextModels : textModels;
  const referenceImageUrls = useMemo(() => {
    const urls = referenceImages
      .map((image) => image.url.trim())
      .filter(Boolean);
    return Array.from(new Set(urls));
  }, [referenceImages]);
  const scenarioGroups = useMemo(() => {
    const groups = new Map<string, typeof COMIC_SCENARIO_PRESETS>();
    for (const preset of COMIC_SCENARIO_PRESETS) {
      const items = groups.get(preset.category) || [];
      items.push(preset);
      groups.set(preset.category, items);
    }
    return Array.from(groups.entries());
  }, []);
  const canApplyScenarioTemplate = !isComicScenarioTemplatePrompt(storyPrompt);

  useEffect(() => {
    latestRecordRef.current = currentRecord;
  }, [currentRecord]);

  useEffect(() => {
    if (hasTrackedViewRef.current) return;
    hasTrackedViewRef.current = true;

    const viewDate = getLocalDayKey();
    const viewPayload = {
      category: 'ai_generation',
      area: COMIC_ANALYTICS_AREA,
      surface: COMIC_ANALYTICS_SURFACE,
      tool_id: COMIC_CREATOR_TOOL_ID,
      tool_name: '多图生成',
      metric: 'pv',
      active_page: page,
      records_count: records.length,
      starred_count: starredCount,
      view_date: viewDate,
      ...getComicRecordAnalytics(currentRecord),
      timestamp: Date.now(),
    };

    analytics.track(COMIC_ANALYTICS_PV_EVENT, viewPayload);

    if (
      analytics.isAnalyticsEnabled() &&
      shouldTrackDailyUniqueView(viewDate)
    ) {
      analytics.track(COMIC_ANALYTICS_UV_EVENT, {
        ...viewPayload,
        metric: 'uv',
        unique_period: 'daily',
      });
    }
  }, [currentRecord, page, records.length, starredCount]);

  useEffect(() => {
    if (lastTrackedPageRef.current === page) return;
    lastTrackedPageRef.current = page;
    trackComicCreatorEvent('step_view', {
      active_page: page,
      records_count: records.length,
      starred_count: starredCount,
      ...getComicRecordAnalytics(currentRecord),
    });
  }, [currentRecord, page, records.length, starredCount]);

  useEffect(() => {
    if (
      !currentRecord ||
      currentRecord.pendingOutlineTaskId ||
      currentRecord.pages.length === 0 ||
      outlineScrollRequestedRef.current !== currentRecord.id
    ) {
      return;
    }

    outlineScrollRequestedRef.current = null;
    requestAnimationFrame(() => {
      outlineResultRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, [
    currentRecord?.id,
    currentRecord?.pages.length,
    currentRecord?.pendingOutlineTaskId,
  ]);

  useEffect(() => {
    setImageParams((prev) =>
      normalizeParamsForConfigs(prev, compatibleImageParams)
    );
  }, [compatibleImageParams]);

  useEffect(() => {
    if (!currentRecord) return;
    setStoryPrompt(currentRecord.sourcePrompt || '');
    setPromptInputMode(currentRecord.sourcePromptMode || 'text');
    setScenarioId(getComicScenarioPreset(currentRecord.scenarioId).id);
    setPageCountInput(
      String(currentRecord.pageCount || DEFAULT_COMIC_PAGE_COUNT)
    );
    setGenerationMode(currentRecord.generationMode || 'serial');
    if (currentRecord.textModel) {
      setTextModelState(currentRecord.textModel);
      setTextModelRef(currentRecord.textModelRef || null);
    }
    if (currentRecord.imageModel) {
      setImageModelState(currentRecord.imageModel);
      setImageModelRef(currentRecord.imageModelRef || null);
    }
    if (currentRecord.imageParams) {
      setImageParams((prev) =>
        normalizeParamsForConfigs(
          { ...prev, ...currentRecord.imageParams },
          getCompatibleParams(currentRecord.imageModel || imageModel)
        )
      );
    }
  }, [currentRecord?.id]);

  useEffect(() => {
    setReferenceImages([]);
  }, [currentRecord?.id]);

  useEffect(() => {
    if (!currentRecord) {
      writeSessionStoryPrompt(storyPrompt);
      writeSessionPromptMode(promptInputMode);
      writeSessionScenarioId(scenarioId);
    }
  }, [currentRecord, promptInputMode, scenarioId, storyPrompt]);

  useEffect(() => {
    const pageIds = currentRecord?.pages.map((item) => item.id) || [];
    setSelectedPageIds((prev) => {
      if (pageIds.length === 0) return new Set();
      const next = new Set([...prev].filter((id) => pageIds.includes(id)));
      if (next.size === 0) {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [currentRecord?.pages]);

  const syncTask = useCallback(async (task: Task) => {
    if (!isComicCreatorTask(task)) return null;
    return (await syncComicOutlineTask(task)) || syncComicPageImageTask(task);
  }, []);

  useWorkflowTaskSync<ComicRecord>({
    syncTask,
    applySyncedRecord,
    shouldHandleTask: isComicCreatorTerminalTask,
    logPrefix: '[ComicCreator]',
  });

  const setTextModel = useCallback((model: string, ref?: ModelRef | null) => {
    setTextModelState(model);
    setTextModelRef(ref || null);
    writeStoredModelSelection(STORAGE_KEY_TEXT_MODEL, model, ref);
  }, []);

  const setImageModel = useCallback(
    (model: string, ref?: ModelRef | null) => {
      trackComicCreatorEvent('image_model_changed', {
        event_type: 'select',
        image_model: model,
        previous_image_model: imageModel,
      });
      setImageModelState(model);
      setImageModelRef(ref || null);
      writeStoredModelSelection(STORAGE_KEY_IMAGE_MODEL, model, ref);
    },
    [imageModel]
  );

  useEffect(() => {
    if (selectableTextModels.length === 0) return;
    const isLegacyFallback =
      textModel === LEGACY_COMIC_DEFAULT_TEXT_MODEL_ID &&
      !textModelRef?.profileId;
    const matchedModel = findMatchingSelectableModel(
      selectableTextModels,
      textModel,
      textModelRef
    );
    if (matchedModel && !isLegacyFallback) return;

    const fallback = selectFallbackModel(
      selectableTextModels,
      COMIC_DEFAULT_TEXT_MODEL_ID
    );
    if (!fallback) return;

    const nextRef = getModelRefForSelection(fallback);
    if (
      getSelectionKey(textModel, textModelRef) !==
      getSelectionKey(fallback.id, nextRef)
    ) {
      setTextModel(fallback.id, nextRef);
    }
  }, [selectableTextModels, setTextModel, textModel, textModelRef]);

  useEffect(() => {
    if (imageModels.length === 0) return;
    const isLegacyFallback =
      imageModel === LEGACY_COMIC_DEFAULT_IMAGE_MODEL_ID &&
      !imageModelRef?.profileId;
    const matchedModel = findMatchingSelectableModel(
      imageModels,
      imageModel,
      imageModelRef
    );
    if (matchedModel && !isLegacyFallback) return;

    const fallback = selectFallbackModel(
      imageModels,
      COMIC_DEFAULT_IMAGE_MODEL_ID
    );
    if (!fallback) return;

    const nextRef = getModelRefForSelection(fallback);
    if (
      getSelectionKey(imageModel, imageModelRef) !==
      getSelectionKey(fallback.id, nextRef)
    ) {
      setImageModel(fallback.id, nextRef);
    }
  }, [imageModel, imageModelRef, imageModels, setImageModel]);

  const handleImageParamChange = useCallback(
    (paramId: string, value: string) => {
      trackComicCreatorEvent('image_param_changed', {
        event_type: 'change',
        image_model: imageModel,
        param_id: paramId,
        param_value: value,
      });
      setImageParams((prev) => ({ ...prev, [paramId]: value }));
    },
    [imageModel]
  );

  useEffect(() => {
    if (!pdfAttachment || geminiTextModels.length === 0) return;
    if (isSelectedModelInList(geminiTextModels, textModel, textModelRef))
      return;

    const nextModel = geminiTextModels[0];
    setTextModel(nextModel.id, getModelRefForOption(nextModel));
  }, [geminiTextModels, pdfAttachment, setTextModel, textModel, textModelRef]);

  const applyScenarioTemplate = useCallback(
    (nextScenarioId = scenarioId) => {
      setStoryPrompt(getComicScenarioPrompt(nextScenarioId, 'text'));
    },
    [scenarioId]
  );

  const handleScenarioChange = useCallback(
    (nextScenarioId: string) => {
      const shouldApplyTemplate = isComicScenarioTemplatePrompt(storyPrompt);
      trackComicCreatorEvent('scenario_changed', {
        event_type: 'change',
        scenario_id: nextScenarioId,
        previous_scenario_id: scenarioId,
        auto_apply_template: shouldApplyTemplate,
        has_record: Boolean(latestRecordRef.current),
      });
      setScenarioId(nextScenarioId);
      if (shouldApplyTemplate) {
        applyScenarioTemplate(nextScenarioId);
      }
    },
    [applyScenarioTemplate, scenarioId, storyPrompt]
  );

  const handlePromptModeChange = useCallback(
    (nextMode: ComicPromptInputMode) => {
      trackComicCreatorEvent('prompt_mode_changed', {
        event_type: 'click',
        prompt_input_mode: nextMode,
        previous_prompt_input_mode: promptInputMode,
        has_record: Boolean(latestRecordRef.current),
      });
      setPromptInputMode(nextMode);
    },
    [promptInputMode]
  );

  const clearPdfAttachment = useCallback(() => {
    const shouldDeleteCache = !latestRecordRef.current?.pendingOutlineTaskId;
    trackComicCreatorClick('remove_pdf_attachment', {
      has_pdf_attachment: Boolean(pdfAttachment),
      pdf_size_bucket: getFileSizeBucket(pdfAttachment?.size),
      should_delete_cache: shouldDeleteCache,
    });
    setPdfAttachment((prev) => {
      if (shouldDeleteCache && prev?.cacheUrl) {
        void unifiedCacheService
          .deleteCache(prev.cacheUrl)
          .catch(() => undefined);
      }
      return null;
    });
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  }, [pdfAttachment]);

  const handlePdfFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const isPdf =
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        trackComicCreatorEvent('pdf_upload', {
          status: 'failed',
          reason: 'invalid_type',
          file_size_bucket: getFileSizeBucket(file.size),
        });
        MessagePlugin.warning('请上传 PDF 文件');
        return;
      }
      if (file.size > MAX_COMIC_PDF_SIZE) {
        trackComicCreatorEvent('pdf_upload', {
          status: 'failed',
          reason: 'too_large',
          file_size_bucket: getFileSizeBucket(file.size),
        });
        MessagePlugin.warning('PDF 不能超过 20MB');
        return;
      }
      if (geminiTextModels.length === 0) {
        trackComicCreatorEvent('pdf_upload', {
          status: 'failed',
          reason: 'no_gemini_text_model',
          file_size_bucket: getFileSizeBucket(file.size),
        });
        MessagePlugin.warning(
          'PDF 入参需要 Gemini 文本模型，请先配置 Gemini 模型'
        );
        return;
      }

      try {
        const cacheUrl = `comic-pdf-${generateUUID()}.pdf`;
        await unifiedCacheService.cacheToCacheStorageOnly(cacheUrl, file);
        setPdfAttachment((prev) => {
          if (prev?.cacheUrl) {
            void unifiedCacheService
              .deleteCache(prev.cacheUrl)
              .catch(() => undefined);
          }
          return {
            cacheUrl,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/pdf',
          };
        });
        trackComicCreatorEvent('pdf_upload', {
          status: 'success',
          file_size_bucket: getFileSizeBucket(file.size),
          switched_text_model: !isSelectedModelInList(
            geminiTextModels,
            textModel,
            textModelRef
          ),
        });

        if (!isSelectedModelInList(geminiTextModels, textModel, textModelRef)) {
          const nextModel = geminiTextModels[0];
          setTextModel(nextModel.id, getModelRefForOption(nextModel));
        }
        MessagePlugin.success('PDF 已添加，将随提示词一起提交给 Gemini');
      } catch (error) {
        trackComicCreatorEvent('pdf_upload', {
          status: 'failed',
          reason: 'cache_failed',
          file_size_bucket: getFileSizeBucket(file.size),
        });
        MessagePlugin.error(
          error instanceof Error ? error.message : 'PDF 上传失败'
        );
      }
    },
    [geminiTextModels, setTextModel, textModel, textModelRef]
  );

  const persistPatch = useCallback(
    async (
      patch: Partial<ComicRecord>,
      baseRecord = latestRecordRef.current
    ) => {
      if (!baseRecord) return null;
      const nextPatch = { ...patch, updatedAt: Date.now() };
      const optimistic = { ...baseRecord, ...nextPatch };
      latestRecordRef.current = optimistic;
      updateCurrentRecord(optimistic);
      setRecords((prev) =>
        prev.map((record) =>
          record.id === optimistic.id ? optimistic : record
        )
      );

      const writePromise = persistQueueRef.current.then(async () => {
        const nextRecords = await updateRecord(baseRecord.id, nextPatch);
        const savedRecord =
          nextRecords.find((record) => record.id === baseRecord.id) ||
          optimistic;
        latestRecordRef.current = savedRecord;
        setRecords(nextRecords);
        updateCurrentRecord(savedRecord);
        return savedRecord;
      });

      persistQueueRef.current = writePromise.then(
        () => undefined,
        () => undefined
      );
      return writePromise;
    },
    [setRecords, updateCurrentRecord]
  );

  const createOrReuseRecord = useCallback(
    async (params: {
      sourcePrompt: string;
      pageCount: number;
      sourcePromptMode: ComicPromptInputMode;
      scenarioId: string;
    }): Promise<ComicRecord> => {
      const trimmedPrompt = params.sourcePrompt.trim();
      const safePageCount = params.pageCount;
      const now = Date.now();

      if (latestRecordRef.current) {
        const updated = await persistPatch({
          sourcePrompt: trimmedPrompt,
          sourcePromptMode: params.sourcePromptMode,
          scenarioId: params.scenarioId,
          pageCount: safePageCount,
          textModel,
          textModelRef,
        });
        return updated || latestRecordRef.current;
      }

      const record: ComicRecord = {
        id: generateUUID(),
        starred: false,
        title: trimmedPrompt.slice(0, 28) || '未命名连环画',
        sourcePrompt: trimmedPrompt,
        commonPrompt: '',
        pageCount: safePageCount,
        pages: [],
        textModel,
        textModelRef,
        imageModel,
        imageModelRef,
        imageParams,
        generationMode,
        sourcePromptMode: params.sourcePromptMode,
        scenarioId: params.scenarioId,
        pendingOutlineTaskId: null,
        createdAt: now,
        updatedAt: now,
      };
      const nextRecords = await addRecord(record);
      const savedRecord =
        nextRecords.find((item) => item.id === record.id) || record;
      setRecords(nextRecords);
      updateCurrentRecord(savedRecord);
      latestRecordRef.current = savedRecord;
      return savedRecord;
    },
    [
      generationMode,
      imageModel,
      imageModelRef,
      imageParams,
      persistPatch,
      setRecords,
      textModel,
      textModelRef,
      updateCurrentRecord,
    ]
  );

  const handleGenerateOutline = useCallback(async () => {
    if (outlineSubmittingRef.current || submittingOutline) return;
    if (!storyPrompt.trim()) {
      MessagePlugin.warning('请输入创作需求');
      return;
    }
    if (
      pdfAttachment &&
      !isSelectedModelInList(geminiTextModels, textModel, textModelRef)
    ) {
      MessagePlugin.warning('PDF 入参仅支持 Gemini 文本模型');
      return;
    }

    outlineSubmittingRef.current = true;
    setSubmittingOutline(true);
    try {
      const sourcePrompt = storyPrompt.trim();
      const safePageCount = sanitizeComicPageCount(pageCountInput);
      await settingsManager.waitForInitialization();

      if (!hasInvocationRouteCredentials('text', textModelRef || textModel)) {
        const newApiKey = await promptForApiKey();
        if (!newApiKey) {
          trackComicCreatorEvent('generate_outline', {
            status: 'cancelled',
            reason: 'missing_api_key',
            scenario_id: scenarioId,
            prompt_input_mode: promptInputMode,
            text_model: textModel,
            has_pdf_attachment: Boolean(pdfAttachment),
          });
          MessagePlugin.warning('需要 API Key 才能生成提示词');
          return;
        }
      }

      trackComicCreatorClick('generate_outline', {
        status: 'start',
        scenario_id: scenarioId,
        prompt_input_mode: promptInputMode,
        page_count: safePageCount,
        text_model: textModel,
        has_pdf_attachment: Boolean(pdfAttachment),
        pdf_size_bucket: getFileSizeBucket(pdfAttachment?.size),
        ...getPromptAnalyticsSummary(sourcePrompt),
      });
      const record = await createOrReuseRecord({
        sourcePrompt,
        pageCount: safePageCount,
        sourcePromptMode: promptInputMode,
        scenarioId,
      });
      const prompt = buildComicScriptPrompt({
        userPrompt: sourcePrompt,
        pageCount: safePageCount,
        inputMode: promptInputMode,
        scenarioContext: getComicScenarioPromptContext(scenarioId),
        pdfAttachmentName: pdfAttachment?.name,
      });
      outlineScrollRequestedRef.current = record.id;
      const task = taskQueueService.createTask(
        {
          prompt,
          knowledgeContextRefs,
          model: textModel,
          modelRef: textModelRef,
          params: {
            response_mime_type: 'application/json',
            response_format: { type: 'json_object' },
          },
          comicCreatorAction: 'outline',
          comicCreatorRecordId: record.id,
          comicCreatorScenarioId: scenarioId,
          comicCreatorPageCount: safePageCount,
          ...(pdfAttachment
            ? {
                pdfCacheUrl: pdfAttachment.cacheUrl,
                pdfMimeType: pdfAttachment.mimeType,
                pdfName: pdfAttachment.name,
              }
            : {}),
        },
        TaskType.CHAT
      );
      await persistPatch(
        {
          sourcePrompt,
          sourcePromptMode: promptInputMode,
          scenarioId,
          pageCount: safePageCount,
          textModel,
          textModelRef,
          pendingOutlineTaskId: task.id,
          outlineError: undefined,
        },
        record
      );
      trackComicCreatorEvent('generate_outline', {
        status: 'success',
        scenario_id: scenarioId,
        prompt_input_mode: promptInputMode,
        page_count: safePageCount,
        text_model: textModel,
        has_pdf_attachment: Boolean(pdfAttachment),
      });
      MessagePlugin.success('提示词规划任务已提交');
    } catch (error) {
      trackComicCreatorEvent('generate_outline', {
        status: 'failed',
        scenario_id: scenarioId,
        prompt_input_mode: promptInputMode,
        text_model: textModel,
        has_pdf_attachment: Boolean(pdfAttachment),
        error_type: error instanceof Error ? error.name : 'unknown',
      });
      MessagePlugin.error(error instanceof Error ? error.message : '提交失败');
    } finally {
      outlineSubmittingRef.current = false;
      setSubmittingOutline(false);
    }
  }, [
    createOrReuseRecord,
    pageCountInput,
    persistPatch,
    promptInputMode,
    pdfAttachment,
    scenarioId,
    storyPrompt,
    submittingOutline,
    textModel,
    geminiTextModels,
    textModelRef,
  ]);

  const handleRecordPagePatch = useCallback(
    (pageId: string, patch: Partial<ComicPage>) => {
      const record = latestRecordRef.current;
      if (!record) return;
      const pages = record.pages.map((item) =>
        item.id === pageId ? { ...item, ...patch } : item
      );
      void persistPatch({ pages });
    },
    [persistPatch]
  );

  const handleCommonPromptChange = useCallback(
    (value: string) => {
      void persistPatch({ commonPrompt: value });
    },
    [persistPatch]
  );

  const handleAddPageAfter = useCallback(
    (pageId: string) => {
      const record = latestRecordRef.current;
      if (!record) return;
      const index = record.pages.findIndex((item) => item.id === pageId);
      const insertIndex = index >= 0 ? index + 1 : record.pages.length;
      const pages = [...record.pages];
      pages.splice(insertIndex, 0, createBlankPage(insertIndex + 1));
      trackComicCreatorClick('add_page', {
        insert_index: insertIndex,
        page_count_before: record.pages.length,
        page_count_after: pages.length,
        ...getComicRecordAnalytics(record),
      });
      void persistPatch({
        pages: renumberPages(pages),
        pageCount: pages.length,
      });
    },
    [persistPatch]
  );

  const handleDeletePage = useCallback(
    (pageId: string) => {
      const record = latestRecordRef.current;
      if (!record || record.pages.length <= 1) return;
      const pages = renumberPages(
        record.pages.filter((item) => item.id !== pageId)
      );
      trackComicCreatorClick('delete_page', {
        page_count_before: record.pages.length,
        page_count_after: pages.length,
        ...getComicRecordAnalytics(record),
      });
      setSelectedPageIds((prev) => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
      void persistPatch({ pages, pageCount: pages.length });
    },
    [persistPatch]
  );

  const handleMovePage = useCallback(
    (pageId: string, offset: -1 | 1) => {
      const record = latestRecordRef.current;
      if (!record) return;
      const index = record.pages.findIndex((item) => item.id === pageId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= record.pages.length)
        return;
      const pages = [...record.pages];
      const [pageItem] = pages.splice(index, 1);
      pages.splice(nextIndex, 0, pageItem);
      trackComicCreatorClick('move_page', {
        direction: offset < 0 ? 'up' : 'down',
        from_index: index,
        to_index: nextIndex,
        page_count: record.pages.length,
      });
      void persistPatch({ pages: renumberPages(pages) });
    },
    [persistPatch]
  );

  const togglePageSelection = useCallback(
    (pageId: string) => {
      const willSelect = !selectedPageIds.has(pageId);
      trackComicCreatorClick('toggle_page_selection', {
        selected: willSelect,
        selected_page_count: willSelect
          ? selectedPageIds.size + 1
          : Math.max(0, selectedPageIds.size - 1),
        page_count: latestRecordRef.current?.pages.length || 0,
      });
      setSelectedPageIds((prev) => {
        const next = new Set(prev);
        if (next.has(pageId)) next.delete(pageId);
        else next.add(pageId);
        return next;
      });
    },
    [selectedPageIds]
  );

  const selectAllPages = useCallback(() => {
    const ids = latestRecordRef.current?.pages.map((item) => item.id) || [];
    trackComicCreatorClick('select_all_pages', {
      selected_page_count: ids.length,
      page_count: ids.length,
    });
    setSelectedPageIds(new Set(ids));
  }, []);

  const clearPageSelection = useCallback(() => {
    trackComicCreatorClick('clear_page_selection', {
      selected_page_count: selectedPageIds.size,
      page_count: latestRecordRef.current?.pages.length || 0,
    });
    setSelectedPageIds(new Set());
  }, [selectedPageIds.size]);

  const handleGenerationModeChange = useCallback(
    (nextMode: ComicGenerationMode) => {
      if (nextMode === generationMode) return;
      trackComicCreatorEvent('generation_mode_changed', {
        event_type: 'click',
        generation_mode: nextMode,
        previous_generation_mode: generationMode,
        ...getComicRecordAnalytics(latestRecordRef.current),
      });
      setGenerationMode(nextMode);
    },
    [generationMode]
  );

  const handleImageCountPerPageChange = useCallback((value: string) => {
    const nextCount = getImageCountPerPage(Number(value));
    trackComicCreatorEvent('image_count_per_page_changed', {
      event_type: 'change',
      image_count_per_page: nextCount,
      ...getComicRecordAnalytics(latestRecordRef.current),
    });
    setImageCountPerPage(nextCount);
  }, []);

  const handlePreviewPageImage = useCallback(
    (pageId: string) => {
      const record = latestRecordRef.current;
      if (!record) return;

      const imageItems = record.pages
        .slice()
        .sort((left, right) => left.pageNumber - right.pageNumber)
        .flatMap((pageItem) => {
          const variants = getComicPageImageVariants(pageItem);
          return variants.map((variant, variantIndex) => ({
            pageItem,
            variant,
            variantIndex,
            variantCount: variants.length,
          }));
        });
      const targetPage = record.pages.find(
        (pageItem) => pageItem.id === pageId
      );
      const initialIndex = imageItems.findIndex(
        (item) =>
          item.pageItem.id === pageId &&
          (!targetPage?.imageUrl || item.variant.url === targetPage.imageUrl)
      );

      if (imageItems.length === 0 || initialIndex < 0) return;

      trackComicCreatorClick('preview_page_image', {
        image_count: imageItems.length,
        initial_index: initialIndex,
        ...getComicRecordAnalytics(record),
      });
      openViewer(
        imageItems.map(({ pageItem, variantIndex, variantCount, variant }) => ({
          url: variant.url,
          type: 'image',
          title: `第 ${pageItem.pageNumber} 页：${normalizeComicPageTitle(
            pageItem.title,
            pageItem.pageNumber
          )}${variantCount > 1 ? `（图 ${variantIndex + 1}）` : ''}`,
          alt: pageItem.title || `第 ${pageItem.pageNumber} 页`,
          prompt: pageItem.prompt,
        })),
        initialIndex
      );
    },
    [openViewer]
  );

  const handleSelectPageImageVariant = useCallback(
    (pageId: string, variantId: string) => {
      const record = latestRecordRef.current;
      if (!record) return;
      const pages = record.pages.map((pageItem) =>
        pageItem.id === pageId
          ? selectComicPageImageVariant(pageItem, variantId)
          : pageItem
      );
      trackComicCreatorClick('select_page_image_variant', {
        page_id: pageId,
        ...getComicRecordAnalytics(record),
      });
      void persistPatch({ pages });
    },
    [persistPatch]
  );

  const handleOpenPageMediaLibrary = useCallback((pageId: string) => {
    const record = latestRecordRef.current;
    const pageItem = record?.pages.find((item) => item.id === pageId);
    trackComicCreatorClick('open_page_media_library', {
      page_id: pageId,
      page_number: pageItem?.pageNumber,
      ...getComicRecordAnalytics(record),
    });
    setLibraryTargetPageId(pageId);
  }, []);

  const handleSelectPageLibraryAsset = useCallback(
    async (asset: Asset) => {
      const record = latestRecordRef.current;
      if (!record || !libraryTargetPageId) return;

      if (asset.type !== AssetType.IMAGE || !asset.url) {
        MessagePlugin.warning('请选择图片素材');
        return;
      }

      const targetPage = record.pages.find(
        (pageItem) => pageItem.id === libraryTargetPageId
      );
      if (!targetPage) return;

      const pages = record.pages.map((pageItem) =>
        pageItem.id === libraryTargetPageId
          ? {
              ...appendComicPageImageVariants(pageItem, [
                {
                  url: asset.url,
                  mimeType: asset.mimeType,
                  generatedAt: asset.createdAt || Date.now(),
                  taskId: asset.taskId,
                },
              ]),
              status: 'succeeded' as const,
              error: undefined,
            }
          : pageItem
      );

      await persistPatch({ pages });
      trackComicCreatorClick('select_page_media_library_asset', {
        page_id: libraryTargetPageId,
        page_number: targetPage.pageNumber,
        asset_id: asset.id,
        asset_source: asset.source,
        ...getComicRecordAnalytics({ ...record, pages }),
      });
      MessagePlugin.success('已从素材库补回当前页图片');
      setLibraryTargetPageId(null);
    },
    [libraryTargetPageId, persistPatch]
  );

  const updatePageStatus = useCallback(
    async (pageId: string, patch: Partial<ComicPage>) => {
      const record = latestRecordRef.current;
      if (!record) return null;
      const pages = record.pages.map((pageItem) =>
        pageItem.id === pageId ? { ...pageItem, ...patch } : pageItem
      );
      return persistPatch({ pages });
    },
    [persistPatch]
  );

  const appendPageImageVariants = useCallback(
    async (
      pageId: string,
      variants: ComicPageImageVariant[],
      patch: Partial<ComicPage>
    ) => {
      const record = latestRecordRef.current;
      if (!record) return null;
      const pages = record.pages.map((pageItem) =>
        pageItem.id === pageId
          ? { ...appendComicPageImageVariants(pageItem, variants), ...patch }
          : pageItem
      );
      return persistPatch({ pages });
    },
    [persistPatch]
  );

  const generateOnePage = useCallback(
    async (
      pageItem: ComicPage,
      previousImageUrl?: string
    ): Promise<string | null> => {
      const record = latestRecordRef.current;
      if (!record || abortControllerRef.current?.signal.aborted) return null;

      await updatePageStatus(pageItem.id, {
        status: 'running',
        error: undefined,
      });

      const size = imageParams.size || DEFAULT_COMIC_IMAGE_SIZE;
      const prompt = buildComicImagePrompt({
        commonPrompt: record.commonPrompt,
        pagePrompt: pageItem.prompt,
        script: pageItem.script,
        title: pageItem.title,
        pageNumber: pageItem.pageNumber,
        pageCount: record.pages.length,
        size,
      });
      const taskReferenceImages = previousImageUrl
        ? Array.from(new Set([...referenceImageUrls, previousImageUrl]))
        : referenceImageUrls;
      trackComicCreatorEvent('page_image_generation', {
        status: 'start',
        page_number: pageItem.pageNumber,
        page_count: record.pages.length,
        image_count_per_page: imageCountPerPage,
        image_model: imageModel,
        image_size: size,
        reference_image_count: taskReferenceImages.length,
        has_previous_page_reference: Boolean(previousImageUrl),
      });

      const result = await createImageTask({
        prompt,
        knowledgeContextRefs,
        size,
        count: imageCountPerPage,
        model: imageModel,
        modelRef: imageModelRef,
        params: imageParams,
        referenceImages:
          taskReferenceImages.length > 0 ? taskReferenceImages : undefined,
        autoInsertToCanvas: false,
        comicCreatorAction: 'page-image',
        comicCreatorRecordId: record.id,
        comicCreatorPageId: pageItem.id,
      });

      const taskIds = getCreatedImageTaskIds(result);
      const taskId = taskIds[0];

      if (!result.success || !taskId) {
        await updatePageStatus(pageItem.id, {
          status: 'failed',
          error: result.error || '图片任务创建失败',
        });
        trackComicCreatorEvent('page_image_generation', {
          status: 'failed',
          reason: 'task_create_failed',
          page_number: pageItem.pageNumber,
          image_count_per_page: imageCountPerPage,
          image_model: imageModel,
          image_size: size,
        });
        return null;
      }

      taskIds.forEach((id) => activeTaskIdsRef.current.add(id));
      await updatePageStatus(pageItem.id, {
        taskId,
        taskIds,
        status: 'running',
      });

      const waitResults = await Promise.all(
        taskIds.map(async (id) => {
          const waitResult = await waitForTaskCompletion(id, {
            signal: abortControllerRef.current?.signal,
            interval: 1200,
          });
          activeTaskIdsRef.current.delete(id);
          return { taskId: id, waitResult };
        })
      );
      const isCancelled = abortControllerRef.current?.signal.aborted;
      const generatedVariants = waitResults.flatMap(
        ({ taskId: completedTaskId, waitResult }) => {
          if (!waitResult.success) return [];
          const task =
            waitResult.task || taskQueueService.getTask(completedTaskId);
          if (!task?.result?.url) return [];
          return buildComicPageImageVariantsFromResult({
            taskId: completedTaskId,
            url: task.result.url,
            urls: task.result.urls,
            format: task.result.format,
            generatedAt: task.completedAt || Date.now(),
          });
        }
      );
      const firstError = waitResults.find(
        ({ waitResult }) => !waitResult.success
      )?.waitResult.error;

      if (generatedVariants.length === 0) {
        await updatePageStatus(pageItem.id, {
          status: isCancelled ? 'cancelled' : 'failed',
          error:
            firstError ||
            (isCancelled ? '图片生成已取消' : '图片任务完成但缺少图片 URL'),
        });
        trackComicCreatorEvent('page_image_generation', {
          status: isCancelled ? 'cancelled' : 'failed',
          reason: isCancelled ? 'user_cancelled' : 'task_failed',
          page_number: pageItem.pageNumber,
          image_count_per_page: imageCountPerPage,
          image_model: imageModel,
          image_size: size,
        });
        return null;
      }

      await appendPageImageVariants(pageItem.id, generatedVariants, {
        status: 'succeeded',
        error: firstError ? '部分图片生成失败' : undefined,
      });
      trackComicCreatorEvent('page_image_generation', {
        status: 'success',
        page_number: pageItem.pageNumber,
        image_count_per_page: imageCountPerPage,
        generated_image_count: generatedVariants.length,
        image_model: imageModel,
        image_size: size,
      });
      return generatedVariants[generatedVariants.length - 1]?.url || null;
    },
    [
      appendPageImageVariants,
      imageCountPerPage,
      imageModel,
      imageModelRef,
      imageParams,
      knowledgeContextRefs,
      referenceImageUrls,
      updatePageStatus,
    ]
  );

  const markSelectedQueued = useCallback(
    async (pagesToGenerate: ComicPage[]) => {
      const record = latestRecordRef.current;
      if (!record) return null;
      const idSet = new Set(pagesToGenerate.map((item) => item.id));
      const pages = record.pages.map((item) =>
        idSet.has(item.id)
          ? {
              ...item,
              status: 'queued' as const,
              error: undefined,
              taskId: null,
              taskIds: null,
            }
          : item
      );
      return persistPatch({
        pages,
        imageModel,
        imageModelRef,
        imageParams,
        generationMode,
      });
    },
    [generationMode, imageModel, imageModelRef, imageParams, persistPatch]
  );

  const handleGenerateImages = useCallback(
    async (singlePageId?: string) => {
      const record = latestRecordRef.current;
      if (!record || generationRunningRef.current || generationState.running)
        return;
      generationRunningRef.current = true;

      const selectedPages = getComicPagesForGeneration({
        pages: record.pages,
        selectedPageIds,
        singlePageId,
      });
      const pagesToGenerate = selectedPages;

      if (selectedPages.length === 0) {
        trackComicCreatorEvent('generate_images', {
          status: 'failed',
          reason: 'no_selection',
          generation_mode: generationMode,
          single_page: Boolean(singlePageId),
          selected_page_count: selectedPageIds.size,
          ...getComicRecordAnalytics(record),
        });
        MessagePlugin.warning('请选择要生成的页面');
        generationRunningRef.current = false;
        return;
      }
      const generationStartedAt = Date.now();
      trackComicCreatorClick(
        singlePageId ? 'regenerate_page_image' : 'generate_selected_pages',
        {
          status: 'start',
          generation_mode: generationMode,
          single_page: Boolean(singlePageId),
          selected_page_count: selectedPages.length,
          task_page_count: pagesToGenerate.length,
          image_count_per_page: imageCountPerPage,
          total_image_task_count: pagesToGenerate.length * imageCountPerPage,
          image_model: imageModel,
          image_size: imageParams.size || DEFAULT_COMIC_IMAGE_SIZE,
          reference_image_count: referenceImageUrls.length,
          ...getComicRecordAnalytics(record),
        }
      );

      abortControllerRef.current = new AbortController();
      activeTaskIdsRef.current = new Set();
      setGenerationState({
        running: true,
        stopping: false,
        current: 0,
        total: pagesToGenerate.length,
        message: `准备生成（每页 ${imageCountPerPage} 张）`,
      });

      try {
        const queuedRecord = await markSelectedQueued(pagesToGenerate);
        if (!queuedRecord) return;

        if (generationMode === 'serial') {
          const sortedPages = pagesToGenerate;

          for (let index = 0; index < sortedPages.length; index += 1) {
            if (abortControllerRef.current.signal.aborted) break;
            const pageItem = sortedPages[index];
            const previousPage = latestRecordRef.current?.pages.find(
              (item) => item.pageNumber === pageItem.pageNumber - 1
            );
            const previousImageUrl = previousPage?.imageUrl;
            setGenerationState((state) => ({
              ...state,
              current: index + 1,
              message: `生成第 ${pageItem.pageNumber} 页（${imageCountPerPage} 张）`,
            }));
            await generateOnePage(pageItem, previousImageUrl);
          }
        } else {
          let cursor = 0;
          let completed = 0;
          const workers = Array.from({
            length: getComicGenerationConcurrency(
              generationMode,
              pagesToGenerate.length
            ),
          }).map(async () => {
            while (cursor < pagesToGenerate.length) {
              if (abortControllerRef.current?.signal.aborted) return;
              const pageItem = pagesToGenerate[cursor];
              cursor += 1;
              setGenerationState((state) => ({
                ...state,
                message: `生成第 ${pageItem.pageNumber} 页（${imageCountPerPage} 张）`,
              }));
              await generateOnePage(pageItem);
              completed += 1;
              setGenerationState((state) => ({
                ...state,
                current: completed,
              }));
            }
          });
          await Promise.all(workers);
        }

        if (abortControllerRef.current.signal.aborted) {
          const latest = latestRecordRef.current;
          if (latest) {
            const selected = new Set(pagesToGenerate.map((item) => item.id));
            await persistPatch({
              pages: latest.pages.map((pageItem) =>
                selected.has(pageItem.id) &&
                (pageItem.status === 'queued' || pageItem.status === 'running')
                  ? {
                      ...pageItem,
                      status: 'cancelled',
                      error: '图片生成已取消',
                    }
                  : pageItem
              ),
            });
          }
          trackComicCreatorEvent('generate_images', {
            status: 'cancelled',
            duration_ms: Date.now() - generationStartedAt,
            generation_mode: generationMode,
            single_page: Boolean(singlePageId),
            task_page_count: pagesToGenerate.length,
            image_count_per_page: imageCountPerPage,
            total_image_task_count: pagesToGenerate.length * imageCountPerPage,
            ...getComicRecordAnalytics(latestRecordRef.current),
          });
          MessagePlugin.info('已停止生成');
        } else {
          trackComicCreatorEvent('generate_images', {
            status: 'success',
            duration_ms: Date.now() - generationStartedAt,
            generation_mode: generationMode,
            single_page: Boolean(singlePageId),
            task_page_count: pagesToGenerate.length,
            image_count_per_page: imageCountPerPage,
            total_image_task_count: pagesToGenerate.length * imageCountPerPage,
            ...getComicRecordAnalytics(latestRecordRef.current),
          });
          MessagePlugin.success('图片生成完成');
        }
      } catch (error) {
        trackComicCreatorEvent('generate_images', {
          status: 'failed',
          duration_ms: Date.now() - generationStartedAt,
          generation_mode: generationMode,
          single_page: Boolean(singlePageId),
          task_page_count: pagesToGenerate.length,
          image_count_per_page: imageCountPerPage,
          total_image_task_count: pagesToGenerate.length * imageCountPerPage,
          error_type: error instanceof Error ? error.name : 'unknown',
          ...getComicRecordAnalytics(latestRecordRef.current),
        });
        MessagePlugin.error(
          error instanceof Error ? error.message : '生成失败'
        );
      } finally {
        activeTaskIdsRef.current.clear();
        abortControllerRef.current = null;
        generationRunningRef.current = false;
        setGenerationState({
          running: false,
          stopping: false,
          current: 0,
          total: 0,
          message: '',
        });
      }
    },
    [
      generateOnePage,
      generationMode,
      generationState.running,
      imageCountPerPage,
      imageModel,
      imageParams.size,
      markSelectedQueued,
      persistPatch,
      referenceImageUrls.length,
      selectedPageIds,
    ]
  );

  const handleStopGeneration = useCallback(() => {
    trackComicCreatorClick('stop_generation', {
      active_task_count: activeTaskIdsRef.current.size,
      generation_mode: generationMode,
      ...getComicRecordAnalytics(latestRecordRef.current),
    });
    abortControllerRef.current?.abort();
    activeTaskIdsRef.current.forEach((taskId) => {
      taskQueueService.cancelTask(taskId);
    });
    setGenerationState((state) => ({
      ...state,
      stopping: true,
      message: '正在停止',
    }));
  }, [generationMode]);

  const handleExport = useCallback(async (kind: 'zip' | 'pptx' | 'pdf') => {
    const record = latestRecordRef.current;
    if (!record) return;
    const imageSources =
      kind === 'zip' ? getZipImageSources(record) : getImageSources(record);
    if (imageSources.length === 0) {
      trackComicCreatorEvent('export', {
        status: 'failed',
        reason: 'no_generated_images',
        export_kind: kind,
        ...getComicRecordAnalytics(record),
      });
      MessagePlugin.warning('请先生成至少一页图片');
      return;
    }

    const exportStartedAt = Date.now();
    trackComicCreatorClick('export', {
      status: 'start',
      export_kind: kind,
      export_image_count: imageSources.length,
      ...getComicRecordAnalytics(record),
    });
    setExporting(kind);
    try {
      const options = { imageSources };
      if (kind === 'zip') await exportComicAsZip(record, options);
      if (kind === 'pptx') await exportComicAsPptx(record, options);
      if (kind === 'pdf') await exportComicAsPdf(record, options);
      trackComicCreatorEvent('export', {
        status: 'success',
        export_kind: kind,
        export_image_count: imageSources.length,
        duration_ms: Date.now() - exportStartedAt,
        ...getComicRecordAnalytics(record),
      });
      MessagePlugin.success('导出完成');
    } catch (error) {
      trackComicCreatorEvent('export', {
        status: 'failed',
        export_kind: kind,
        export_image_count: imageSources.length,
        duration_ms: Date.now() - exportStartedAt,
        error_type: error instanceof Error ? error.name : 'unknown',
        ...getComicRecordAnalytics(record),
      });
      MessagePlugin.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(null);
    }
  }, []);

  const handleRestart = useCallback(() => {
    trackComicCreatorClick('restart_project', {
      ...getComicRecordAnalytics(latestRecordRef.current),
    });
    restart();
    clearPdfAttachment();
    setScenarioId(DEFAULT_COMIC_SCENARIO_ID);
    setPromptInputMode('text');
    setStoryPrompt(getComicScenarioPrompt(DEFAULT_COMIC_SCENARIO_ID, 'text'));
    setPageCountInput(String(DEFAULT_COMIC_PAGE_COUNT));
    setSelectedPageIds(new Set());
    goToDefaultPage();
  }, [clearPdfAttachment, goToDefaultPage, restart]);

  const handleHistorySelect = useCallback(
    (record: ComicRecord) => {
      trackComicCreatorClick('select_history_record', {
        ...getComicRecordAnalytics(record),
      });
      selectRecord(record);
      setPage(record.pages.length > 0 ? 'generate' : 'plan');
    },
    [selectRecord, setPage]
  );

  const handleToggleStarRecord = useCallback(
    async (record: ComicRecord) => {
      trackComicCreatorClick('toggle_star_record', {
        starred: !record.starred,
        ...getComicRecordAnalytics(record),
      });
      const nextRecords = await updateRecord(record.id, {
        starred: !record.starred,
        updatedAt: Date.now(),
      });
      setRecords(nextRecords);
      const nextRecord = nextRecords.find((item) => item.id === record.id);
      if (nextRecord && currentRecord?.id === record.id) {
        updateCurrentRecord(nextRecord);
      }
    },
    [currentRecord?.id, setRecords, updateCurrentRecord]
  );

  const handleDeleteRecord = useCallback(
    async (recordId: string) => {
      const record = records.find((item) => item.id === recordId);
      trackComicCreatorClick('delete_history_record', {
        ...getComicRecordAnalytics(record),
      });
      const nextRecords = await deleteRecord(recordId);
      setRecords(nextRecords);
      if (currentRecord?.id === recordId) {
        restart();
        goToDefaultPage();
      }
    },
    [currentRecord?.id, goToDefaultPage, records, restart, setRecords]
  );

  const hasOutline = !!(currentRecord?.pages && currentRecord.pages.length > 0);
  const generatedPageCount = getComicGeneratedPageCount(currentRecord);
  const generatedImageCount = getComicGeneratedImageCount(currentRecord);
  const steps = useMemo<WorkflowStepConfig<WorkflowPageId>[]>(
    () =>
      COMIC_STEPS.map((step) => ({
        ...step,
        disabled: step.id === 'generate' && !hasOutline,
      })),
    [hasOutline]
  );

  const handleStepNavigate = useCallback(
    (step: WorkflowPageId) => {
      trackComicCreatorClick('navigate_step', {
        from_page: page,
        to_page: step,
        ...getComicRecordAnalytics(currentRecord),
      });
      navigateToStep(step);
    },
    [currentRecord, navigateToStep, page]
  );

  const handleBackFromHistory = useCallback(() => {
    trackComicCreatorClick('back_from_history', {
      show_starred: showStarred,
      records_count: records.length,
    });
    goToDefaultPage();
  }, [goToDefaultPage, records.length, showStarred]);

  const handleOpenHistory = useCallback(() => {
    trackComicCreatorClick('open_history', {
      records_count: records.length,
      starred_count: starredCount,
    });
    openHistory();
  }, [openHistory, records.length, starredCount]);

  const handleOpenStarred = useCallback(() => {
    trackComicCreatorClick('open_starred_history', {
      records_count: records.length,
      starred_count: starredCount,
    });
    openStarred();
  }, [openStarred, records.length, starredCount]);

  const handleToggleStarredFilter = useCallback(() => {
    trackComicCreatorClick('toggle_starred_filter', {
      show_starred: !showStarred,
      records_count: records.length,
      starred_count: starredCount,
    });
    toggleStarred();
  }, [records.length, showStarred, starredCount, toggleStarred]);

  const filteredRecords = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return records
      .filter((record) => (showStarred ? record.starred : true))
      .filter((record) => {
        if (!query) return true;
        return (
          record.title.toLowerCase().includes(query) ||
          record.sourcePrompt.toLowerCase().includes(query)
        );
      })
      .filter((record) => {
        if (historyStatus === 'all') return true;
        if (historyStatus === 'done') {
          return (
            record.pages.length > 0 &&
            record.pages.every(
              (item) => getComicPageImageVariants(item).length > 0
            )
          );
        }
        if (historyStatus === 'failed') {
          return (
            record.pages.some((item) => item.status === 'failed') ||
            !!record.outlineError
          );
        }
        if (historyStatus === 'planned') {
          return (
            record.pages.length > 0 &&
            !record.pages.every(
              (item) => getComicPageImageVariants(item).length > 0
            )
          );
        }
        return true;
      })
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [historyQuery, historyStatus, records, showStarred]);

  const handleHistorySearchBlur = useCallback(() => {
    const query = historyQuery.trim();
    if (!query) return;
    trackComicCreatorEvent('history_search', {
      event_type: 'input',
      query_length: query.length,
      result_count: filteredRecords.length,
      history_status: historyStatus,
      show_starred: showStarred,
    });
  }, [filteredRecords.length, historyQuery, historyStatus, showStarred]);

  const handleHistoryStatusChange = useCallback(
    (nextStatus: string) => {
      trackComicCreatorEvent('history_status_filter_changed', {
        event_type: 'change',
        history_status: nextStatus,
        previous_history_status: historyStatus,
        show_starred: showStarred,
      });
      setHistoryStatus(nextStatus);
    },
    [historyStatus, showStarred]
  );

  const renderPlanPage = () => (
    <div className="va-page comic-page">
      <div className="ma-card comic-plan-card">
        <div className="ma-card-header">
          <span>创作需求</span>
          <div className="comic-header-actions">
            {canApplyScenarioTemplate && (
              <button
                className="comic-link-btn"
                onClick={() => {
                  trackComicCreatorClick('apply_scenario_template', {
                    scenario_id: scenarioId,
                    prompt_input_mode: promptInputMode,
                    has_record: Boolean(currentRecord),
                  });
                  applyScenarioTemplate();
                }}
              >
                套用模板
              </button>
            )}
            {currentRecord && (
              <button className="comic-link-btn" onClick={handleRestart}>
                新建
              </button>
            )}
          </div>
        </div>
        <div className="comic-config-grid">
          <label className="comic-field comic-field--scenario">
            <span>创作场景</span>
            <select
              className="ma-select"
              value={scenarioId}
              onChange={(event) => handleScenarioChange(event.target.value)}
              disabled={
                submittingOutline || !!currentRecord?.pendingOutlineTaskId
              }
            >
              {scenarioGroups.map(([category, presets]) => (
                <optgroup key={category} label={category}>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="comic-field">
            <span>页数</span>
            <input
              className="ma-input"
              type="number"
              min={1}
              max={60}
              value={pageCountInput}
              onChange={(event) => setPageCountInput(event.target.value)}
              onBlur={() =>
                setPageCountInput(
                  String(sanitizeComicPageCount(pageCountInput))
                )
              }
            />
          </label>
        </div>
        <div className="comic-scenario-note">
          <strong>
            {selectedScenario.category} / {selectedScenario.label}
          </strong>
          <span>{selectedScenario.description}</span>
        </div>
        <div className="comic-pdf-row">
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={handlePdfFileChange}
          />
          <button
            type="button"
            className="comic-pdf-upload-btn"
            onClick={() => {
              trackComicCreatorClick('upload_pdf', {
                has_pdf_attachment: Boolean(pdfAttachment),
                gemini_text_model_count: geminiTextModels.length,
              });
              pdfInputRef.current?.click();
            }}
            disabled={
              submittingOutline || !!currentRecord?.pendingOutlineTaskId
            }
          >
            <FileUp size={14} />
            {pdfAttachment ? '更换 PDF' : '上传 PDF'}
          </button>
          {pdfAttachment ? (
            <div className="comic-pdf-file">
              <FileText size={14} />
              <HoverTip content={pdfAttachment.name} showArrow={false}>
                <span>
                  {pdfAttachment.name} · {formatFileSize(pdfAttachment.size)}
                </span>
              </HoverTip>
              <button
                type="button"
                className="comic-icon-btn"
                onClick={clearPdfAttachment}
                aria-label="移除 PDF"
                disabled={
                  submittingOutline || !!currentRecord?.pendingOutlineTaskId
                }
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <span className="comic-pdf-hint">
              可选，上传后文本模型仅可选择 Gemini
            </span>
          )}
        </div>
        <textarea
          className="ma-textarea comic-story-input"
          value={storyPrompt}
          onChange={(event) => setStoryPrompt(event.target.value)}
          placeholder={getComicScenarioPrompt(scenarioId, 'text')}
          spellCheck
        />
        <KnowledgeNoteContextSelector
          value={knowledgeContextRefs}
          onChange={setKnowledgeContextRefs}
          disabled={submittingOutline || !!currentRecord?.pendingOutlineTaskId}
          language="zh"
        />
        {currentRecord?.outlineError && (
          <div className="ma-error">{currentRecord.outlineError}</div>
        )}
        {currentRecord?.pendingOutlineTaskId && (
          <div className="ma-progress comic-plan-progress">提示词规划中...</div>
        )}
        <div className="comic-plan-control-row">
          <div className="comic-mode-control">
            <span>生成的提示词类型</span>
            <div className="comic-segmented comic-segmented--mode">
              <button
                className={promptInputMode === 'text' ? 'active' : ''}
                type="button"
                onClick={() => handlePromptModeChange('text')}
                disabled={
                  submittingOutline || !!currentRecord?.pendingOutlineTaskId
                }
              >
                文本提示词
              </button>
              <button
                className={promptInputMode === 'json' ? 'active' : ''}
                type="button"
                onClick={() => handlePromptModeChange('json')}
                disabled={
                  submittingOutline || !!currentRecord?.pendingOutlineTaskId
                }
              >
                结构化 JSON
              </button>
            </div>
          </div>
          <label className="comic-field comic-field--model comic-field--inline-model">
            <ModelDropdown
              variant="form"
              selectedModel={textModel}
              selectedSelectionKey={getSelectionKey(textModel, textModelRef)}
              onSelect={setTextModel}
              models={selectableTextModels}
              placement="down"
              placeholder={pdfAttachment ? '选择 Gemini 模型' : '选择文本模型'}
              disabled={
                submittingOutline ||
                !!currentRecord?.pendingOutlineTaskId ||
                selectableTextModels.length === 0
              }
            />
          </label>
        </div>
        <div className="va-page-actions comic-plan-actions">
          <button
            className="va-btn-primary"
            disabled={
              submittingOutline ||
              !!currentRecord?.pendingOutlineTaskId ||
              (Boolean(pdfAttachment) && selectableTextModels.length === 0)
            }
            onClick={handleGenerateOutline}
          >
            <RefreshCw size={14} />
            生成提示词
          </button>
        </div>
      </div>

      {hasOutline && currentRecord && (
        <div className="ma-card" ref={outlineResultRef}>
          <div className="ma-card-header">
            <span>{currentRecord.title}</span>
            <span className="ma-muted">
              已规划 {currentRecord.pages.length}/
              {currentRecord.pageCount || currentRecord.pages.length} 页
            </span>
          </div>
          <div className="comic-outline-preview">
            <div className="comic-outline-preview__item comic-outline-preview__item--common">
              <strong>公共提示词</strong>
              {renderOutlinePromptPreview(currentRecord.commonPrompt)}
            </div>
            {currentRecord.pages.map((pageItem) => (
              <div key={pageItem.id} className="comic-outline-preview__item">
                <strong>
                  第 {pageItem.pageNumber} 页：
                  {normalizeComicPageTitle(pageItem.title, pageItem.pageNumber)}
                </strong>
                {renderOutlinePromptPreview(
                  pageItem.prompt || pageItem.script,
                  '待补全'
                )}
              </div>
            ))}
          </div>
          <div className="va-page-actions comic-plan-actions comic-outline-actions">
            <button
              className="va-btn-primary"
              onClick={() => {
                trackComicCreatorClick('go_to_generate_step', {
                  ...getComicRecordAnalytics(currentRecord),
                });
                setPage('generate');
              }}
            >
              <Play size={14} />
              去生成
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderGeneratePage = () => {
    if (!currentRecord)
      return <div className="va-page va-empty">暂无连环画记录</div>;

    const allSelected =
      currentRecord.pages.length > 0 &&
      currentRecord.pages.every((pageItem) => selectedPageIds.has(pageItem.id));

    return (
      <div className="va-page comic-page">
        <div className="ma-card comic-reference-card">
          <ReferenceImageUpload
            images={referenceImages}
            onImagesChange={setReferenceImages}
            multiple
            label="参考图片（可选）"
            disabled={generationState.running}
          />
        </div>

        <div className="ma-card">
          <div className="ma-card-header">
            <span>公共提示词</span>
            <div className="comic-header-actions">
              <PromptOptimizeButton
                className="ma-icon-btn comic-prompt-optimize-btn"
                originalPrompt={currentRecord.commonPrompt}
                language="zh"
                scenarioId="tool.image"
                historyType="image"
                defaultMode="polish"
                disabled={generationState.running}
                tooltipPlacement="top"
                onApply={handleCommonPromptChange}
              />
              <span className="ma-muted">
                {generatedPageCount}/{currentRecord.pages.length} 页已生成 ·{' '}
                {generatedImageCount} 张图
              </span>
            </div>
          </div>
          <textarea
            className="ma-textarea comic-common-prompt"
            value={currentRecord.commonPrompt}
            onChange={(event) => handleCommonPromptChange(event.target.value)}
          />
        </div>

        {generationState.running && (
          <div className="ma-progress">
            {generationState.message} {generationState.current}/
            {generationState.total}
          </div>
        )}

        <div className="comic-batch-bar comic-batch-bar--generation">
          <KnowledgeNoteContextSelector
            value={knowledgeContextRefs}
            onChange={setKnowledgeContextRefs}
            disabled={generationState.running}
            language="zh"
            className="comic-knowledge-context-selector"
          />
          <HoverTip content="选择或取消选择全部页面" showArrow={false}>
            <label className="comic-check comic-selection-check">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  allSelected ? clearPageSelection() : selectAllPages()
                }
              />
              <span>已选 {selectedPageIds.size} 页</span>
            </label>
          </HoverTip>

          <HoverTip content="选择图片模型" showArrow={false}>
            <div className="comic-generation-model">
              <ModelDropdown
                selectedModel={imageModel}
                selectedSelectionKey={getSelectionKey(
                  imageModel,
                  imageModelRef
                )}
                onSelect={setImageModel}
                models={imageModels}
                placement="down"
                header="选择图片模型 (↑↓ Tab)"
              />
            </div>
          </HoverTip>

          {compatibleImageParams.length > 0 && (
            <HoverTip content="图片生成参数" showArrow={false}>
              <div className="comic-generation-params">
                <ParametersDropdown
                  selectedParams={imageParams}
                  onParamChange={handleImageParamChange}
                  compatibleParams={compatibleImageParams}
                  modelId={imageModel}
                  placement="down"
                />
              </div>
            </HoverTip>
          )}

          <HoverTip
            content={
              generationMode === 'parallel'
                ? '已启用并行：同时生成多页，速度更快'
                : '当前串行：逐页生成，更稳更省并发'
            }
            showArrow={false}
          >
            <label
              className={`comic-generation-mode-check${
                generationState.running ? ' is-disabled' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={generationMode === 'parallel'}
                onChange={(event) =>
                  handleGenerationModeChange(
                    event.target.checked ? 'parallel' : 'serial'
                  )
                }
                disabled={generationState.running}
                aria-label="并行生成"
              />
              <span>并行</span>
            </label>
          </HoverTip>

          <HoverTip content="每页并发生成图片数量" showArrow={false}>
            <label className="comic-generation-count">
              <span>每页</span>
              <select
                className="comic-generation-count-select"
                value={imageCountPerPage}
                onChange={(event) =>
                  handleImageCountPerPageChange(event.target.value)
                }
                disabled={generationState.running}
                aria-label="每页生成图片数量"
              >
                {COMIC_IMAGE_COUNT_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count} 张
                  </option>
                ))}
              </select>
            </label>
          </HoverTip>

          {generationState.running ? (
            <HoverTip content="停止生成" showArrow={false}>
              <button
                onClick={handleStopGeneration}
                disabled={generationState.stopping}
                aria-label="停止生成"
              >
                <Square size={14} />
                停止
              </button>
            </HoverTip>
          ) : (
            <HoverTip content="生成已选页面" showArrow={false}>
              <button
                className="comic-primary-btn"
                onClick={() => void handleGenerateImages()}
                aria-label="生成"
              >
                <Play size={14} />
                生成
              </button>
            </HoverTip>
          )}
        </div>

        <div className="comic-page-list">
          {currentRecord.pages.map((pageItem, index) => {
            const pageHeaderTitle = getPageHeaderTitle(pageItem);
            const imageVariants = getComicPageImageVariants(pageItem);
            const currentImageVariant =
              imageVariants.find(
                (variant) => variant.url === pageItem.imageUrl
              ) || imageVariants[imageVariants.length - 1];

            return (
              <div key={pageItem.id} className="comic-page-card">
                <div className="comic-page-card__head">
                  <div className="comic-page-title-row">
                    <label className="comic-check">
                      <input
                        type="checkbox"
                        checked={selectedPageIds.has(pageItem.id)}
                        onChange={() => togglePageSelection(pageItem.id)}
                      />
                      <span>第 {pageItem.pageNumber} 页</span>
                    </label>
                    {pageHeaderTitle && (
                      <HoverTip content={pageHeaderTitle} showArrow={false}>
                        <span className="comic-page-title-label">
                          {pageHeaderTitle}
                        </span>
                      </HoverTip>
                    )}
                    <PromptOptimizeButton
                      className="comic-icon-btn comic-prompt-optimize-btn"
                      iconSize={14}
                      originalPrompt={pageItem.prompt}
                      language="zh"
                      scenarioId="tool.image"
                      historyType="image"
                      allowStructuredMode={true}
                      defaultMode="structured"
                      disabled={generationState.running}
                      tooltipPlacement="top"
                      onApply={(optimizedPrompt) =>
                        handleRecordPagePatch(pageItem.id, {
                          prompt: optimizedPrompt,
                        })
                      }
                    />
                    <HoverTip
                      content={`在第 ${pageItem.pageNumber} 页后新增页`}
                      showArrow={false}
                    >
                      <button
                        className="comic-icon-btn comic-page-add-btn"
                        onClick={() => handleAddPageAfter(pageItem.id)}
                        disabled={generationState.running}
                        aria-label={`在第 ${pageItem.pageNumber} 页后新增页`}
                      >
                        <Plus size={14} />
                      </button>
                    </HoverTip>
                  </div>
                  <span
                    className={`comic-status comic-status--${
                      pageItem.status || 'draft'
                    }`}
                  >
                    {pageItem.status || 'draft'}
                  </span>
                  {index > 0 && (
                    <HoverTip content="上移" showArrow={false}>
                      <button
                        className="ma-icon-btn"
                        onClick={() => handleMovePage(pageItem.id, -1)}
                        disabled={generationState.running}
                        aria-label="上移页面"
                      >
                        <ArrowUp size={14} />
                      </button>
                    </HoverTip>
                  )}
                  {index < currentRecord.pages.length - 1 && (
                    <HoverTip content="下移" showArrow={false}>
                      <button
                        className="ma-icon-btn"
                        onClick={() => handleMovePage(pageItem.id, 1)}
                        disabled={generationState.running}
                        aria-label="下移页面"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </HoverTip>
                  )}
                  <HoverTip content="删除" showArrow={false}>
                    <button
                      className="ma-icon-btn"
                      onClick={() => handleDeletePage(pageItem.id)}
                      disabled={
                        currentRecord.pages.length <= 1 ||
                        generationState.running
                      }
                      aria-label="删除页面"
                    >
                      <Trash2 size={14} />
                    </button>
                  </HoverTip>
                </div>

                <div className="comic-page-card__body">
                  <div className="comic-page-preview-pane">
                    <div className="comic-page-preview">
                      {currentImageVariant ? (
                        <button
                          type="button"
                          className="comic-page-preview-image-btn"
                          onClick={() => handlePreviewPageImage(pageItem.id)}
                          aria-label={`预览第 ${pageItem.pageNumber} 页`}
                        >
                          <RetryImage
                            src={currentImageVariant.url}
                            alt={pageItem.title}
                            showSkeleton={false}
                            eager
                          />
                        </button>
                      ) : (
                        <div className="comic-page-placeholder">
                          <ImageIcon size={22} />
                        </div>
                      )}
                      <HoverTip content="重新生成当前页" showArrow={false}>
                        <button
                          className="comic-page-preview-action"
                          onClick={() => void handleGenerateImages(pageItem.id)}
                          disabled={generationState.running}
                          aria-label="重新生成当前页"
                        >
                          <RefreshCw size={14} />
                          <span>重生</span>
                        </button>
                      </HoverTip>
                    </div>
                    <div className="comic-page-assets-row">
                      {imageVariants.length > 0 ? (
                        <div
                          className="comic-page-variant-strip"
                          aria-label={`第 ${pageItem.pageNumber} 页历史图片`}
                        >
                          {imageVariants.map((variant, variantIndex) => {
                            const selected = variant.url === pageItem.imageUrl;
                            return (
                              <HoverTip
                                key={variant.id}
                                content={
                                  selected
                                    ? `当前图片 ${variantIndex + 1}`
                                    : `设为第 ${variantIndex + 1} 张图片`
                                }
                                showArrow={false}
                              >
                                <button
                                  type="button"
                                  className={`comic-page-variant-thumb${
                                    selected
                                      ? ' comic-page-variant-thumb--active'
                                      : ''
                                  }`}
                                  onClick={() =>
                                    handleSelectPageImageVariant(
                                      pageItem.id,
                                      variant.id
                                    )
                                  }
                                  disabled={generationState.running}
                                  aria-label={`选择第 ${
                                    pageItem.pageNumber
                                  } 页第 ${variantIndex + 1} 张图片`}
                                >
                                  <RetryImage
                                    src={variant.url}
                                    alt={`${pageItem.title} ${
                                      variantIndex + 1
                                    }`}
                                    showSkeleton={false}
                                    eager
                                  />
                                  <span>{variantIndex + 1}</span>
                                </button>
                              </HoverTip>
                            );
                          })}
                        </div>
                      ) : (
                        <div
                          className="comic-page-variant-strip comic-page-variant-strip--empty"
                          aria-hidden="true"
                        />
                      )}
                      <div className="comic-page-library-fallback">
                        <HoverTip content="从素材库补回图片" showArrow={false}>
                          <button
                            type="button"
                            className="comic-page-library-btn"
                            onClick={() =>
                              handleOpenPageMediaLibrary(pageItem.id)
                            }
                            aria-label={`从素材库补回第 ${pageItem.pageNumber} 页图片`}
                          >
                            <MediaLibraryIcon size={18} />
                          </button>
                        </HoverTip>
                      </div>
                    </div>
                  </div>
                  <div className="comic-page-editor">
                    <textarea
                      className="ma-textarea comic-page-unified-prompt"
                      value={pageItem.prompt}
                      onChange={(event) =>
                        handleRecordPagePatch(pageItem.id, {
                          prompt: event.target.value,
                        })
                      }
                      placeholder="本页完整图片提示词：写清主题、画面主体、构图、必要文案、风格和色彩"
                    />
                    {pageItem.error && (
                      <div className="ma-error">{pageItem.error}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="ma-card comic-export-inline">
          <div className="ma-card-header">
            <span>导出</span>
            <span className="ma-muted">
              已生成 {generatedImageCount} 张，至少 1 张即可导出
            </span>
          </div>
          <div className="comic-export-grid">
            <button
              className="comic-export-card"
              disabled={!!exporting || generatedImageCount === 0}
              onClick={() => void handleExport('zip')}
            >
              <FileArchive size={24} />
              <span>{exporting === 'zip' ? '导出中...' : 'ZIP'}</span>
            </button>
            <button
              className="comic-export-card"
              disabled={!!exporting || generatedImageCount === 0}
              onClick={() => void handleExport('pptx')}
            >
              <Download size={24} />
              <span>{exporting === 'pptx' ? '导出中...' : 'PPTX'}</span>
            </button>
            <button
              className="comic-export-card"
              disabled={!!exporting || generatedImageCount === 0}
              onClick={() => void handleExport('pdf')}
            >
              <FileText size={24} />
              <span>{exporting === 'pdf' ? '导出中...' : 'PDF'}</span>
            </button>
          </div>
        </div>
        <MediaLibraryModal
          isOpen={!!libraryTargetPageId}
          onClose={() => setLibraryTargetPageId(null)}
          mode={SelectionMode.SELECT}
          filterType={AssetType.IMAGE}
          onSelect={handleSelectPageLibraryAsset}
          selectButtonText="补回此页"
        />
      </div>
    );
  };

  const renderHistoryPage = () => (
    <div className="va-page comic-page">
      <div className="comic-history-filters">
        <input
          className="ma-input"
          value={historyQuery}
          onChange={(event) => setHistoryQuery(event.target.value)}
          onBlur={handleHistorySearchBlur}
          placeholder="搜索标题或提示词"
        />
        <select
          className="ma-select"
          value={historyStatus}
          onChange={(event) => handleHistoryStatusChange(event.target.value)}
        >
          <option value="all">全部</option>
          <option value="planned">已规划</option>
          <option value="done">已完成</option>
          <option value="failed">有失败</option>
        </select>
      </div>
      {filteredRecords.length === 0 ? (
        <div className="va-empty comic-history-empty">暂无记录</div>
      ) : (
        <div className="comic-history-list">
          {filteredRecords.map((record) => (
            <div key={record.id} className="comic-history-item">
              <button
                className="comic-history-main"
                onClick={() => handleHistorySelect(record)}
              >
                <strong>{record.title || '未命名连环画'}</strong>
                <span>创建时间 {formatRecordCreatedAt(record.createdAt)}</span>
                <span>
                  {getRecordStatus(record)} · {record.pageCount} 页 ·{' '}
                  {getComicGeneratedImageCount(record)} 张图
                </span>
                <p>{record.sourcePrompt}</p>
              </button>
              <div className="comic-history-actions">
                <button
                  className={`comic-history-action comic-history-star ${
                    record.starred ? 'is-starred' : ''
                  }`}
                  aria-label={record.starred ? '取消收藏' : '收藏'}
                  title={record.starred ? '取消收藏' : '收藏'}
                  onClick={() => void handleToggleStarRecord(record)}
                >
                  <Star
                    size={15}
                    strokeWidth={2.1}
                    fill={record.starred ? 'currentColor' : 'none'}
                    aria-hidden="true"
                  />
                </button>
                <button
                  className="comic-history-action comic-history-delete"
                  aria-label="删除历史"
                  title="删除历史"
                  onClick={() => void handleDeleteRecord(record.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="video-analyzer music-analyzer comic-creator">
      <WorkflowNavBar
        isHistoryPage={page === 'history'}
        showStarred={showStarred}
        recordsCount={records.length}
        starredCount={starredCount}
        currentStep={page}
        steps={steps}
        onStepNavigate={handleStepNavigate}
        onBackFromHistory={handleBackFromHistory}
        onOpenHistory={handleOpenHistory}
        onOpenStarred={handleOpenStarred}
        onToggleStarred={handleToggleStarredFilter}
      />

      {page === 'plan' && renderPlanPage()}
      {page === 'generate' && renderGeneratePage()}
      {page === 'history' && renderHistoryPage()}

      <MediaViewer {...viewerProps} />
    </div>
  );
};

export default ComicCreator;
