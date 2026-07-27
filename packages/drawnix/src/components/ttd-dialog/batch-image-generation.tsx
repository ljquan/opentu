/**
 * Batch Image Generation Component
 *
 * 批量图片生成组件 - Excel 式批量 AI 图片生成
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { copyToClipboard } from '../../utils/runtime-helpers';
import { MessagePlugin, Dialog, Button, Checkbox } from 'tdesign-react';
import {
  DownloadIcon,
  FilePasteIcon,
  ImageIcon,
  CheckRectangleIcon,
  SwapIcon,
  DeleteIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowDownIcon,
  ViewListIcon,
  AddIcon,
} from 'tdesign-icons-react';
import { ImageUploadIcon, MediaLibraryIcon } from '../icons';
import { useI18n } from '../../i18n';
import { MediaViewer } from '../shared/MediaViewer';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { useMediaViewer, urlsToMediaItems } from '../../hooks/useMediaViewer';
import { smartDownload } from '../../utils/download-utils';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import {
  TaskType,
  TaskStatus,
  Task,
  type KnowledgeContextRef,
} from '../../types/task.types';
import {
  hasInvocationRouteCredentials,
  resolveInvocationRoute,
  createModelRef,
  type ModelRef,
} from '../../utils/settings-manager';
import { promptForApiKey } from '../../utils/gemini-api';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { ParametersDropdown } from '../ai-input-bar/ParametersDropdown';
import {
  getCompatibleParams,
  type ParamConfig,
} from '../../constants/model-config';
import { useAssets } from '../../contexts/AssetContext';
import { AssetType, AssetSource, SelectionMode } from '../../types/asset.types';
import type { Asset } from '../../types/asset.types';
import { MediaLibraryModal } from '../media-library/MediaLibraryModal';
import { LS_KEYS_TO_MIGRATE } from '../../constants/storage-keys';
import { kvStorageService } from '../../services/kv-storage-service';
import { useDeviceType } from '../../hooks/useDeviceType';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
} from '../../utils/model-selection';
import type { ModelConfig } from '../../constants/model-config';
import './batch-image-generation.scss';
import { trackMemory } from '../../utils/common';
import { HoverTip } from '../shared/hover';
import { KnowledgeNoteContextSelector, RetryImage } from '../shared';
import {
  loadScopedAIImageToolPreferences,
  sanitizeImageToolExtraParams,
} from '../../services/ai-generation-preferences-service';
import { buildMJPromptSuffix } from '../../utils/mj-params';

// 本地缓存 key
const BATCH_IMAGE_CACHE_KEY = LS_KEYS_TO_MIGRATE.BATCH_IMAGE_CACHE;

// 任务行数据
interface TaskRow {
  id: number;
  prompt: string;
  params: Record<string, string>;
  /** @deprecated 兼容旧缓存/旧 Excel 的尺寸字段，加载后会迁移到 params.size */
  size?: string;
  images: string[];
  count: number;
  // 预览相关 - 关联到任务队列的taskId
  taskIds: string[]; // 关联的任务队列ID列表（一行可能生成多个任务）
}

function getCompletedImageResults(
  tasks: Task[]
): Array<{ task: Task; url: string }> {
  return tasks.flatMap((task) => {
    const url = task.result?.url;
    return task.status === TaskStatus.COMPLETED && url ? [{ task, url }] : [];
  });
}

// 单元格位置
interface CellPosition {
  row: number;
  col: string;
}

// 可编辑列
const EDITABLE_COLS = ['prompt', 'params', 'images', 'count', 'preview'];

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function cloneCellValue<T>(value: T): T {
  if (Array.isArray(value)) return [...value] as T;
  if (isStringRecord(value)) return { ...value } as T;
  return value;
}

function areStringRecordsEqual(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key])
  );
}

function normalizeComparableText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[：:]/g, 'x')
    .replace(/×/g, 'x')
    .replace(/\s+/g, '');
}

function getParamLookupKey(value: string): string {
  return normalizeComparableText(value).replace(/[=_-]/g, '');
}

function normalizeEnumValue(
  param: ParamConfig,
  value: unknown
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const comparable = normalizeComparableText(trimmed);
  return param.options?.find((option) => {
    const optionValue = normalizeComparableText(option.value);
    const optionLabel = normalizeComparableText(option.label);
    const compactLabel = normalizeComparableText(option.label.split('(')[0]);
    return (
      comparable === optionValue ||
      comparable === optionLabel ||
      comparable === compactLabel
    );
  })?.value;
}

function findParamConfigByKey(
  compatibleParams: ParamConfig[],
  key: string
): ParamConfig | undefined {
  const lookupKey = getParamLookupKey(key);
  const aliases: Record<string, string> = {
    参数: 'params',
    尺寸: 'size',
    图片尺寸: 'size',
    宽高比: 'size',
    分辨率: 'resolution',
    图片分辨率: 'resolution',
    画质: 'quality',
    图片质量: 'quality',
    质量: 'quality',
  };
  const aliasedId = aliases[key.trim()] || aliases[lookupKey];

  return compatibleParams.find((param) => {
    if (param.id === key || param.id === aliasedId) return true;
    const candidates = [
      param.id,
      param.label,
      param.shortLabel || '',
      param.description || '',
    ].map(getParamLookupKey);
    return candidates.includes(lookupKey);
  });
}

function parseParamInputValue(
  param: ParamConfig,
  value: unknown
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (param.valueType === 'enum') {
    return normalizeEnumValue(param, trimmed);
  }

  return trimmed;
}

function normalizeRowParamsForModel(
  row: Partial<TaskRow>,
  modelId: string,
  defaultParams: Record<string, string>
): Record<string, string> {
  const compatibleParams = getCompatibleParams(modelId);
  const sizeParam = compatibleParams.find((param) => param.id === 'size');
  const rawParams = isStringRecord(row.params) ? row.params : {};
  const normalizedParams: Record<string, string> = {
    ...defaultParams,
    ...rawParams,
  };

  const rawSize = rawParams.size || row.size;
  const normalizedSize = sizeParam
    ? parseParamInputValue(sizeParam, rawSize)
    : undefined;
  if (normalizedSize) {
    normalizedParams.size = normalizedSize;
  }

  return sanitizeImageToolExtraParams(modelId, normalizedParams);
}

function parseParamsText(
  text: string,
  modelId: string,
  defaultParams: Record<string, string>
): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) return { ...defaultParams };

  const compatibleParams = getCompatibleParams(modelId);
  const parsedParams: Record<string, string> = {};

  try {
    const parsed = JSON.parse(trimmed);
    if (isStringRecord(parsed)) {
      return sanitizeImageToolExtraParams(modelId, {
        ...defaultParams,
        ...parsed,
      });
    }
  } catch {
    // 非 JSON 文本继续走宽松解析。
  }

  const sizeParam = compatibleParams.find((param) => param.id === 'size');
  const directSize = sizeParam
    ? parseParamInputValue(sizeParam, trimmed)
    : undefined;
  if (directSize) {
    return sanitizeImageToolExtraParams(modelId, {
      ...defaultParams,
      size: directSize,
    });
  }

  trimmed
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const match = part.match(/^([^:=：=]+)[:=：]\s*(.+)$/);
      if (!match) return;

      const param = findParamConfigByKey(compatibleParams, match[1]);
      if (!param) return;

      const value = parseParamInputValue(param, match[2]);
      if (value) {
        parsedParams[param.id] = value;
      }
    });

  return sanitizeImageToolExtraParams(modelId, {
    ...defaultParams,
    ...parsedParams,
  });
}

function serializeParamsForExcel(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function buildTaskAdapterParams(
  params: Record<string, string>
): Record<string, string> | undefined {
  const adapterParams = { ...params };
  if (adapterParams.size === 'auto') {
    delete adapterParams.size;
  }
  return Object.keys(adapterParams).length > 0 ? adapterParams : undefined;
}

function isEditableElementTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest('input, textarea, [contenteditable="true"]')
  );
}

// 默认初始任务
function getDefaultTasks(): TaskRow[] {
  const initialTasks: TaskRow[] = [];
  for (let i = 0; i < 5; i++) {
    initialTasks.push({
      id: i + 1,
      prompt: '',
      params: { size: 'auto' },
      images: [],
      count: 1,
      taskIds: [],
    });
  }
  return initialTasks;
}

interface BatchImageGenerationProps {
  onSwitchToSingle?: () => void;
  selectedModel?: string;
  selectedModelRef?: ModelRef | null;
  onModelChange?: (value: string) => void;
  onModelRefChange?: (value: ModelRef | null) => void;
}

const BatchImageGeneration: React.FC<BatchImageGenerationProps> = ({
  onSwitchToSingle,
  selectedModel: controlledSelectedModel,
  selectedModelRef: controlledSelectedModelRef,
  onModelChange,
  onModelRefChange,
}) => {
  const { language } = useI18n();
  const { confirm, confirmDialog } = useConfirmDialog();
  const imageModels = useSelectableModels('image');
  const { createTask, deleteTask, tasks: queueTasks } = useTaskQueue();
  const { addAsset, assets: libraryAssets, loadAssets } = useAssets();
  const { isMobile, isTablet } = useDeviceType();

  // 移动端/平板端隐藏素材库侧栏
  const hideLibrarySidebar = isMobile || isTablet;

  // 过滤出图片类型的素材
  const imageAssets = libraryAssets.filter(
    (asset) => asset.type === AssetType.IMAGE
  );

  // 组件初始化时加载素材库数据
  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  // 任务数据 - 初始化为默认值，异步从 IndexedDB 加载
  const [tasks, setTasks] = useState<TaskRow[]>(getDefaultTasks);
  const [taskIdCounter, setTaskIdCounter] = useState<number>(6);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const [knowledgeContextRefs, setKnowledgeContextRefs] = useState<
    KnowledgeContextRef[]
  >([]);

  // 从 IndexedDB 加载缓存
  useEffect(() => {
    let mounted = true;
    kvStorageService
      .get<{ tasks: TaskRow[]; taskIdCounter: number }>(BATCH_IMAGE_CACHE_KEY)
      .then((cached) => {
        if (!mounted) return;
        if (
          cached &&
          cached.tasks &&
          Array.isArray(cached.tasks) &&
          cached.tasks.length > 0
        ) {
          setTasks(cached.tasks);
          if (cached.taskIdCounter) {
            setTaskIdCounter(cached.taskIdCounter);
          }
        }
        setCacheLoaded(true);
      })
      .catch((e) => {
        console.warn('Failed to load batch image cache:', e);
        if (mounted) setCacheLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // 选中状态
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);
  const [selectedCells, setSelectedCells] = useState<CellPosition[]>([]);
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [openParamsCell, setOpenParamsCell] = useState<CellPosition | null>(
    null
  );
  // 独立的行选择状态（checkbox），与单元格选择分离
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // 派生状态：选中任务统计
  const { validSelectedRows, selectedTaskCount, selectedInfoText } =
    useMemo(() => {
      const validRows = [...selectedRows]
        .filter((idx) => {
          const task = tasks[idx];
          return task && task.prompt && task.prompt.trim() !== '';
        })
        .sort((a, b) => a - b);

      const count = validRows.reduce((sum, idx) => {
        const task = tasks[idx];
        return sum + (task?.count || 1);
      }, 0);

      const info =
        validRows.length > 0
          ? language === 'zh'
            ? `已选 ${validRows.length} 行 / ${count} 任务`
            : `${validRows.length} rows / ${count} tasks`
          : '';

      return {
        validSelectedRows: validRows,
        selectedTaskCount: count,
        selectedInfoText: info,
      };
    }, [selectedRows, tasks, language]);

  // 历史记录条目定义
  interface HistoryEntry {
    tasks: TaskRow[];
    selectedCells: CellPosition[];
    activeCell: CellPosition | null;
    selectedRows: number[]; // Set 转换为数组存储
  }

  // 撤销/重做历史
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const isUndoRedoRef = useRef<boolean>(false); // 标记是否正在撤销/重做，避免重复记录历史

  const [showLibrary, setShowLibrary] = useState(true); // 默认显示
  const [selectionTooltipVisible, setSelectionTooltipVisible] = useState(false); // 选中统计气泡可见性

  // 填充拖拽
  const [isDraggingFill, setIsDraggingFill] = useState(false);
  const [fillStartCell, setFillStartCell] = useState<CellPosition | null>(null);
  const [fillPreviewRows, setFillPreviewRows] = useState<number[]>([]);
  const [fillEndRow, setFillEndRow] = useState<number | null>(null);

  // 单元格选择拖拽（实现鼠标拖拽多选）
  const [isDraggingSelect, setIsDraggingSelect] = useState(false);
  const [selectStartCell, setSelectStartCell] = useState<CellPosition | null>(
    null
  );

  // 图片拖拽到行的高亮
  const [dragOverRowIndex, setDragOverRowIndex] = useState<number | null>(null);

  // 批量导入设置
  const [imagesPerRow, setImagesPerRow] = useState<number>(1);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [pendingImportFiles, setPendingImportFiles] = useState<File[]>([]);
  const [importStartRow, setImportStartRow] = useState<number>(1); // 从第几行开始插入（1-based）
  const normalizedImagesPerRow = Math.min(
    5,
    Math.max(1, Math.floor(Number.isFinite(imagesPerRow) ? imagesPerRow : 1))
  );
  const pendingImportRowCount =
    pendingImportFiles.length > 0
      ? Math.ceil(pendingImportFiles.length / normalizedImagesPerRow)
      : 0;
  const maxImportStartRow = Math.max(1, tasks.length + pendingImportRowCount);

  // 创建预览图片的 Blob URL（防止渲染时重复创建导致内存泄漏）
  const previewUrls = useMemo(() => {
    return pendingImportFiles
      .slice(0, 12)
      .map((file) => URL.createObjectURL(file));
  }, [pendingImportFiles]);

  // 清理 Blob URL 防止内存泄漏
  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  // 模型选择
  const initialRoute = resolveInvocationRoute('image');
  const initialMatchedModel =
    findMatchingSelectableModel(
      imageModels,
      initialRoute.modelId,
      createModelRef(initialRoute.profileId, initialRoute.modelId)
    ) ||
    getPinnedSelectableModel(
      'image',
      initialRoute.modelId,
      createModelRef(initialRoute.profileId, initialRoute.modelId)
    );
  const [selectedModel, setSelectedModel] = useState<string>(
    initialMatchedModel?.id ||
      imageModels[0]?.id ||
      'gemini-2.5-flash-image-vip'
  );
  const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
    getModelRefFromConfig(initialMatchedModel) ||
      createModelRef(initialRoute.profileId, initialRoute.modelId)
  );
  const visibleImageModels = useMemo(() => {
    const currentMatch = findMatchingSelectableModel(
      imageModels,
      selectedModel,
      selectedModelRef
    );
    if (currentMatch || !selectedModel) {
      return imageModels;
    }

    const pinnedModel = getPinnedSelectableModel(
      'image',
      selectedModel,
      selectedModelRef
    );
    return pinnedModel ? [pinnedModel, ...imageModels] : imageModels;
  }, [imageModels, selectedModel, selectedModelRef]);
  const selectedSelectionKey = useMemo(
    () => getSelectionKey(selectedModel, selectedModelRef),
    [selectedModel, selectedModelRef]
  );
  const compatibleParams = useMemo(
    () => getCompatibleParams(selectedModel),
    [selectedModel]
  );
  const defaultModelParams = useMemo(() => {
    return loadScopedAIImageToolPreferences(selectedModel, selectedSelectionKey)
      .extraParams;
  }, [selectedModel, selectedSelectionKey]);

  useEffect(() => {
    setTasks((prev) => {
      let changed = false;
      const nextTasks = prev.map((task) => {
        const nextParams = normalizeRowParamsForModel(
          task,
          selectedModel,
          defaultModelParams
        );
        const hasLegacySize = typeof task.size === 'string';
        const currentParams = isStringRecord(task.params) ? task.params : {};
        if (
          !hasLegacySize &&
          areStringRecordsEqual(currentParams, nextParams)
        ) {
          return task;
        }
        changed = true;
        const { size: _legacySize, ...restTask } = task;
        return {
          ...restTask,
          params: nextParams,
        };
      });
      return changed ? nextTasks : prev;
    });
  }, [cacheLoaded, defaultModelParams, selectedModel]);

  useEffect(() => {
    if (visibleImageModels.length === 0) return;
    const matchedModel = findMatchingSelectableModel(
      visibleImageModels,
      selectedModel,
      selectedModelRef
    );
    if (!matchedModel) {
      setSelectedModel(visibleImageModels[0].id);
      setSelectedModelRef(getModelRefFromConfig(visibleImageModels[0]));
    }
  }, [selectedModel, selectedModelRef, visibleImageModels]);

  useEffect(() => {
    if (!controlledSelectedModel) {
      return;
    }

    const currentSelectionKey = getSelectionKey(
      selectedModel,
      selectedModelRef
    );
    const nextSelectionKey = getSelectionKey(
      controlledSelectedModel,
      controlledSelectedModelRef
    );

    if (currentSelectionKey !== nextSelectionKey) {
      setSelectedModel(controlledSelectedModel);
      const matchedModel = findMatchingSelectableModel(
        visibleImageModels,
        controlledSelectedModel,
        controlledSelectedModelRef
      );
      setSelectedModelRef(
        getModelRefFromConfig(matchedModel) ||
          controlledSelectedModelRef ||
          null
      );
    }
  }, [
    controlledSelectedModel,
    controlledSelectedModelRef,
    selectedModel,
    selectedModelRef,
    visibleImageModels,
  ]);

  // 图片预览（使用 MediaViewer）
  const { openViewer, viewerProps } = useMediaViewer();
  // 行图片画廊弹窗（显示某行所有生成的图片）
  const [galleryRowIndex, setGalleryRowIndex] = useState<number | null>(null);

  // 添加行弹窗
  const [showAddRowsModal, setShowAddRowsModal] = useState(false);
  const [addRowsCount, setAddRowsCount] = useState(5);

  // 素材库弹窗（用于参考图选择）
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [mediaLibraryTargetRow, setMediaLibraryTargetRow] = useState<
    number | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchImportInputRef = useRef<HTMLInputElement>(null);
  const excelImportInputRef = useRef<HTMLInputElement>(null);
  const rowImageInputRef = useRef<HTMLInputElement>(null); // 行内图片上传
  const lastSelectedRowRef = useRef<number | null>(null); // 上次选择的行（单元格），用于单元格 Shift 多选
  const lastCheckedRowRef = useRef<number | null>(null); // 上次勾选的行（checkbox），用于 checkbox Shift 多选
  const uploadTargetRowRef = useRef<number | null>(null); // 正在上传图片的目标行
  const batchRootRef = useRef<HTMLDivElement>(null);

  const focusBatchKeyboardScope = useCallback(() => {
    batchRootRef.current?.focus({ preventScroll: true });
  }, []);

  const isBatchKeyboardScopeActive = useCallback((event: Event) => {
    const rootElement = batchRootRef.current;
    if (!rootElement) return false;

    const targetElement = event.target instanceof Element ? event.target : null;
    if (targetElement && rootElement.contains(targetElement)) {
      return true;
    }

    const activeElement = document.activeElement;
    return (
      activeElement instanceof Element && rootElement.contains(activeElement)
    );
  }, []);

  // 保存到 IndexedDB（异步）
  useEffect(() => {
    // 等待缓存加载完成后再保存，避免覆盖
    if (!cacheLoaded) return;

    const cacheData = {
      tasks,
      taskIdCounter,
      timestamp: Date.now(),
    };
    kvStorageService.set(BATCH_IMAGE_CACHE_KEY, cacheData).catch((e) => {
      console.warn('Failed to save batch image cache:', e);
    });
  }, [tasks, taskIdCounter, cacheLoaded]);

  // 记录历史（用于撤销/重做）
  const saveHistory = useCallback(
    (
      newTasks: TaskRow[],
      currentSelectedCells: CellPosition[],
      currentActiveCell: CellPosition | null,
      currentSelectedRows: Set<number>
    ) => {
      if (isUndoRedoRef.current) {
        isUndoRedoRef.current = false;
        return;
      }
      // 截断当前位置之后的历史
      historyRef.current = historyRef.current.slice(
        0,
        historyIndexRef.current + 1
      );

      // 创建新状态条目
      const newEntry: HistoryEntry = {
        tasks: JSON.parse(JSON.stringify(newTasks)),
        selectedCells: [...currentSelectedCells],
        activeCell: currentActiveCell ? { ...currentActiveCell } : null,
        selectedRows: Array.from(currentSelectedRows),
      };

      // 添加新状态
      historyRef.current.push(newEntry);
      historyIndexRef.current = historyRef.current.length - 1;
      // 限制历史记录数量（最多50条）
      if (historyRef.current.length > 50) {
        historyRef.current.shift();
        historyIndexRef.current--;
      }
    },
    []
  );

  // 监听 tasks 变化，记录历史
  useEffect(() => {
    if (tasks.length > 0) {
      saveHistory(tasks, selectedCells, activeCell, selectedRows);
    }
  }, [tasks, saveHistory]);

  // 当选中态变化时，实时更新当前历史记录中的选中状态（不产生新的历史条目）
  // 这样在撤销时，能恢复到该任务状态下的最后一次选中态
  useEffect(() => {
    if (
      historyRef.current.length > 0 &&
      historyIndexRef.current >= 0 &&
      !isUndoRedoRef.current
    ) {
      const currentEntry = historyRef.current[historyIndexRef.current];
      if (currentEntry) {
        currentEntry.selectedCells = [...selectedCells];
        currentEntry.activeCell = activeCell ? { ...activeCell } : null;
        currentEntry.selectedRows = Array.from(selectedRows);
      }
    }
  }, [selectedCells, activeCell, selectedRows]);

  // 撤销
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      isUndoRedoRef.current = true;
      const previousEntry = historyRef.current[historyIndexRef.current];

      // 恢复任务数据
      setTasks(JSON.parse(JSON.stringify(previousEntry.tasks)));

      // 恢复选中态
      setSelectedCells([...previousEntry.selectedCells]);
      setActiveCell(
        previousEntry.activeCell ? { ...previousEntry.activeCell } : null
      );
      setSelectedRows(new Set(previousEntry.selectedRows));

      MessagePlugin.info(language === 'zh' ? '已撤销' : 'Undone');
    } else {
      MessagePlugin.warning(
        language === 'zh' ? '没有可撤销的操作' : 'Nothing to undo'
      );
    }
  }, [language]);

  // 重做
  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      isUndoRedoRef.current = true;
      const nextEntry = historyRef.current[historyIndexRef.current];

      // 恢复任务数据
      setTasks(JSON.parse(JSON.stringify(nextEntry.tasks)));

      // 恢复选中态
      setSelectedCells([...nextEntry.selectedCells]);
      setActiveCell(nextEntry.activeCell ? { ...nextEntry.activeCell } : null);
      setSelectedRows(new Set(nextEntry.selectedRows));

      MessagePlugin.info(language === 'zh' ? '已重做' : 'Redone');
    } else {
      MessagePlugin.warning(
        language === 'zh' ? '没有可重做的操作' : 'Nothing to redo'
      );
    }
  }, [language]);

  // 添加行
  const addRows = useCallback(
    (count: number) => {
      setTasks((prev) => {
        const newTasks = [...prev];
        for (let i = 0; i < count; i++) {
          newTasks.push({
            id: taskIdCounter + i,
            prompt: '',
            params: { ...defaultModelParams },
            images: [],
            count: 1,
            taskIds: [],
          });
        }
        return newTasks;
      });
      setTaskIdCounter((prev) => prev + count);
    },
    [defaultModelParams, taskIdCounter]
  );

  // 删除选中行（基于 checkbox 选中状态）
  const deleteSelected = useCallback(() => {
    if (selectedRows.size === 0) {
      MessagePlugin.warning(
        language === 'zh' ? '请先勾选要删除的行' : 'Please check rows to delete'
      );
      return;
    }

    setTasks((prev) => prev.filter((_, index) => !selectedRows.has(index)));
    setSelectedRows(new Set());
    setSelectedCells([]);
    setActiveCell(null);
  }, [selectedRows, language]);

  // 选中单元格
  const selectCell = useCallback(
    (row: number, col: string) => {
      focusBatchKeyboardScope();
      setActiveCell({ row, col });
      setSelectedCells([{ row, col }]);
      setEditingCell(null);
      setOpenParamsCell(null);
    },
    [focusBatchKeyboardScope]
  );

  // 进入编辑模式（双击进入，追加编辑）
  const enterEditMode = useCallback(
    (row: number, col: string) => {
      selectCell(row, col);
      if (col === 'params') {
        setOpenParamsCell({ row, col });
        return;
      }
      if (EDITABLE_COLS.includes(col) && col !== 'images') {
        setEditingCell({ row, col });
      }
    },
    [selectCell]
  );

  // 更新单元格值
  const updateCellValue = useCallback(
    (row: number, col: string, value: any) => {
      setTasks((prev) => {
        if (!prev[row]) return prev;
        const newTasks = [...prev];
        if (col === 'params') {
          newTasks[row] = {
            ...newTasks[row],
            params: normalizeRowParamsForModel(
              { ...newTasks[row], params: isStringRecord(value) ? value : {} },
              selectedModel,
              defaultModelParams
            ),
          };
          return newTasks;
        }
        if (col === 'size') {
          newTasks[row] = {
            ...newTasks[row],
            params: normalizeRowParamsForModel(
              { ...newTasks[row], size: String(value || '') },
              selectedModel,
              defaultModelParams
            ),
          };
          return newTasks;
        }
        newTasks[row] = {
          ...newTasks[row],
          [col]: value,
        };
        return newTasks;
      });
    },
    [defaultModelParams, selectedModel]
  );

  const applyPastedTextToCells = useCallback(
    (text: string, originCell: CellPosition, targetCells: CellPosition[]) => {
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length === 0) return;

      const updatePastedValue = (row: number, col: string, value: string) => {
        if (row < 0 || row >= tasks.length) return;

        if (col === 'prompt') {
          updateCellValue(row, col, value);
        } else if (col === 'count') {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 1) {
            updateCellValue(row, col, num);
          }
        } else if (col === 'params' || col === 'size') {
          updateCellValue(
            row,
            'params',
            parseParamsText(value, selectedModel, defaultModelParams)
          );
        }
      };

      if (lines.length === 1 || targetCells.length > 1) {
        const value = lines[0];
        targetCells.forEach((cell) =>
          updatePastedValue(cell.row, cell.col, value)
        );
        return;
      }

      lines.forEach((line, index) => {
        updatePastedValue(originCell.row + index, originCell.col, line);
      });
    },
    [defaultModelParams, selectedModel, tasks.length, updateCellValue]
  );

  const pasteCopiedCells = useCallback(
    (originCell: CellPosition, targetCells: CellPosition[]) => {
      const copiedCells = (window as any).__copiedCells as
        | Array<{ row: number; col: string; value: any }>
        | undefined;

      if (!copiedCells || copiedCells.length === 0) {
        return false;
      }

      if (copiedCells.length === 1) {
        const copied = copiedCells[0];
        targetCells.forEach((cell) => {
          if (cell.col === copied.col) {
            updateCellValue(cell.row, cell.col, copied.value);
          }
        });
        return true;
      }

      copiedCells.forEach((copied, index) => {
        const targetRow = originCell.row + index;
        if (targetRow < tasks.length) {
          updateCellValue(targetRow, originCell.col, copied.value);
        }
      });
      return true;
    },
    [tasks.length, updateCellValue]
  );

  // 处理单元格点击
  const handleCellClick = useCallback(
    (e: React.MouseEvent, row: number, col: string) => {
      if (e.shiftKey && activeCell) {
        // Shift + 点击：选择范围内的行（checkbox）
        const minRow = Math.min(activeCell.row, row);
        const maxRow = Math.max(activeCell.row, row);

        // 同时勾选范围内所有行的checkbox
        setSelectedRows((prev) => {
          const newSet = new Set(prev);
          for (let r = minRow; r <= maxRow; r++) {
            newSet.add(r);
          }
          return newSet;
        });

        // 同时选择单元格范围
        const newSelected: CellPosition[] = [];
        for (let r = minRow; r <= maxRow; r++) {
          newSelected.push({ row: r, col: activeCell.col });
        }
        setSelectedCells(newSelected);

        // 记录最后选择的行
        lastSelectedRowRef.current = row;
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl + 点击：添加到选区
        setSelectedCells((prev) => {
          const exists = prev.some((c) => c.row === row && c.col === col);
          if (exists) {
            return prev.filter((c) => !(c.row === row && c.col === col));
          }
          return [...prev, { row, col }];
        });
      } else {
        selectCell(row, col);
        // 记录最后选择的行（用于后续Shift选择）
        lastSelectedRowRef.current = row;
      }
    },
    [activeCell, selectCell]
  );

  // 批量填充列
  const fillColumn = useCallback(
    (colName: string) => {
      if (!activeCell) {
        MessagePlugin.warning(
          language === 'zh'
            ? '请先选中一个单元格作为填充源'
            : 'Please select a cell as fill source'
        );
        return;
      }

      const sourceValue = (tasks[activeCell.row] as any)?.[colName];
      if (
        sourceValue === undefined ||
        sourceValue === null ||
        (typeof sourceValue === 'string' && sourceValue.trim() === '') ||
        (Array.isArray(sourceValue) && sourceValue.length === 0)
      ) {
        MessagePlugin.warning(
          language === 'zh'
            ? '选中的单元格没有数据'
            : 'Selected cell has no data'
        );
        return;
      }

      setTasks((prev) =>
        prev.map((task) => ({
          ...task,
          [colName]: cloneCellValue(sourceValue),
        }))
      );

      MessagePlugin.success(language === 'zh' ? '已填充整列' : 'Column filled');
    },
    [activeCell, tasks, language]
  );

  // 开始填充拖拽
  const startFillDrag = useCallback((row: number, col: string) => {
    // 确保不会同时触发选择拖拽
    setIsDraggingSelect(false);
    setSelectStartCell(null);

    setIsDraggingFill(true);
    setFillStartCell({ row, col });
    setFillEndRow(row);
  }, []);

  // 开始单元格选择拖拽
  const startSelectDrag = useCallback(
    (row: number, col: string) => {
      // 如果正在填充拖拽，不启动选择拖拽
      if (isDraggingFill) return;
      focusBatchKeyboardScope();
      setIsDraggingSelect(true);
      setSelectStartCell({ row, col });
      setActiveCell({ row, col });
      setSelectedCells([{ row, col }]);
    },
    [focusBatchKeyboardScope, isDraggingFill]
  );

  // 处理拖拽过程中的鼠标移动
  const handleTableMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // 没有拖拽状态则不处理
      if (!isDraggingFill && !isDraggingSelect) return;

      // 获取鼠标下的行
      const target = e.target as HTMLElement;
      const rowElement = target.closest('tr[data-row-index]');
      if (!rowElement) return;

      const rowIndex = parseInt(
        (rowElement as HTMLElement).dataset.rowIndex || '-1'
      );
      if (rowIndex < 0) return;

      // 填充拖拽
      if (isDraggingFill && fillStartCell) {
        setFillEndRow(rowIndex);
        // 计算预览行
        const startRow = fillStartCell.row;
        const endRow = rowIndex;
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const previewRows: number[] = [];
        for (let r = minRow; r <= maxRow; r++) {
          if (r !== startRow) {
            previewRows.push(r);
          }
        }
        setFillPreviewRows(previewRows);
      }

      // 选择拖拽
      if (isDraggingSelect && selectStartCell) {
        const col = selectStartCell.col;
        const startRow = selectStartCell.row;
        const endRow = rowIndex;
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const newSelected: CellPosition[] = [];
        for (let r = minRow; r <= maxRow; r++) {
          newSelected.push({ row: r, col });
        }
        setSelectedCells(newSelected);
      }
    },
    [isDraggingFill, fillStartCell, isDraggingSelect, selectStartCell]
  );

  // 处理拖拽结束
  const handleTableMouseUp = useCallback(() => {
    // 填充拖拽结束 - 执行填充
    if (
      isDraggingFill &&
      fillStartCell &&
      fillEndRow !== null &&
      fillEndRow !== fillStartCell.row
    ) {
      const sourceValue = (tasks[fillStartCell.row] as any)?.[
        fillStartCell.col
      ];
      const startRow = fillStartCell.row;
      const endRow = fillEndRow;
      const minRow = Math.min(startRow, endRow);
      const maxRow = Math.max(startRow, endRow);

      setTasks((prev) => {
        const newTasks = [...prev];
        for (let r = minRow; r <= maxRow; r++) {
          if (r !== startRow && newTasks[r]) {
            newTasks[r] = {
              ...newTasks[r],
              [fillStartCell.col]: cloneCellValue(sourceValue),
            };
          }
        }
        return newTasks;
      });

      // 扩展选中范围，对齐 Excel 交互
      const newSelectedCells: CellPosition[] = [];
      for (let r = minRow; r <= maxRow; r++) {
        newSelectedCells.push({ row: r, col: fillStartCell.col });
      }
      setSelectedCells(newSelectedCells);

      MessagePlugin.success(
        language === 'zh'
          ? `已填充 ${Math.abs(endRow - startRow)} 行`
          : `Filled ${Math.abs(endRow - startRow)} rows`
      );
    }

    // 重置状态
    setIsDraggingFill(false);
    setFillStartCell(null);
    setFillEndRow(null);
    setFillPreviewRows([]);
    setIsDraggingSelect(false);
    setSelectStartCell(null);
  }, [isDraggingFill, fillStartCell, fillEndRow, tasks, language]);

  // 处理图片上传到素材库
  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      Array.from(files).forEach((file) => {
        if (!file.type.startsWith('image/')) return;

        // 添加到素材库
        addAsset(file, AssetType.IMAGE, AssetSource.LOCAL, file.name).catch(
          (err) => {
            console.warn(
              '[BatchImageGeneration] Failed to add asset to library:',
              err
            );
          }
        );
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [addAsset]
  );

  // 从图片库添加图片到选中行（支持 checkbox 选中、单元格选中或当前活动单元格所在行）
  const addImageToSelectedRows = useCallback(
    (imageUrl: string) => {
      // 优先使用 checkbox 选中的行
      let rowIndices: number[] = [];
      if (selectedRows.size > 0) {
        rowIndices = [...selectedRows];
      } else if (selectedCells.length > 0) {
        // 其次使用单元格选中的行（去重）
        rowIndices = [...new Set(selectedCells.map((c) => c.row))];
      } else if (activeCell) {
        // 最后使用当前活动单元格所在行
        rowIndices = [activeCell.row];
      }

      if (rowIndices.length === 0) {
        MessagePlugin.warning(
          language === 'zh'
            ? '请先选中要添加图片的行'
            : 'Please select a row first'
        );
        return;
      }

      setTasks((prev) => {
        const newTasks = [...prev];
        rowIndices.forEach((rowIndex) => {
          if (
            newTasks[rowIndex] &&
            !newTasks[rowIndex].images.includes(imageUrl)
          ) {
            newTasks[rowIndex] = {
              ...newTasks[rowIndex],
              images: [...newTasks[rowIndex].images, imageUrl],
            };
          }
        });
        return newTasks;
      });
    },
    [selectedRows, selectedCells, activeCell, language]
  );

  // 添加图片到指定行
  const addImageToRow = useCallback((rowIndex: number, imageUrl: string) => {
    setTasks((prev) => {
      const newTasks = [...prev];
      if (newTasks[rowIndex] && !newTasks[rowIndex].images.includes(imageUrl)) {
        newTasks[rowIndex] = {
          ...newTasks[rowIndex],
          images: [...newTasks[rowIndex].images, imageUrl],
        };
      }
      return newTasks;
    });
  }, []);

  // 从行中移除图片
  const removeImageFromRow = useCallback(
    (rowIndex: number, imageUrl: string) => {
      setTasks((prev) => {
        const newTasks = [...prev];
        if (newTasks[rowIndex]) {
          newTasks[rowIndex] = {
            ...newTasks[rowIndex],
            images: newTasks[rowIndex].images.filter((url) => url !== imageUrl),
          };
        }
        return newTasks;
      });
    },
    []
  );

  // 处理行内图片上传（点击 + 按钮触发）
  const handleRowImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      const targetRow = uploadTargetRowRef.current;
      if (!files || files.length === 0 || targetRow === null) return;

      Array.from(files).forEach((file) => {
        if (!file.type.startsWith('image/')) return;

        // 添加到素材库
        addAsset(file, AssetType.IMAGE, AssetSource.LOCAL, file.name).catch(
          (err) => {
            console.warn(
              '[BatchImageGeneration] Failed to add asset to library:',
              err
            );
          }
        );

        // 读取并添加到目标行
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          addImageToRow(targetRow, dataUrl);
        };
        reader.readAsDataURL(file);
      });

      // 清空 input
      if (rowImageInputRef.current) {
        rowImageInputRef.current.value = '';
      }
      uploadTargetRowRef.current = null;
    },
    [addImageToRow, addAsset]
  );

  // 触发行内图片上传
  const triggerRowImageUpload = useCallback((rowIndex: number) => {
    uploadTargetRowRef.current = rowIndex;
    setShowLibrary(true); // 展开图片库
    rowImageInputRef.current?.click(); // 打开文件选择
  }, []);

  // 打开素材库选择图片
  const openMediaLibraryForRow = useCallback((rowIndex: number) => {
    setMediaLibraryTargetRow(rowIndex);
    setShowMediaLibrary(true);
  }, []);

  // 处理素材库选择
  const handleMediaLibrarySelect = useCallback(
    (asset: Asset) => {
      if (mediaLibraryTargetRow === null) return;

      if (asset.url) {
        addImageToRow(mediaLibraryTargetRow, asset.url);
      }

      setShowMediaLibrary(false);
      setMediaLibraryTargetRow(null);
    },
    [mediaLibraryTargetRow, addImageToRow]
  );

  // 处理行拖放
  const handleRowDragOver = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>, rowIndex: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOverRowIndex(rowIndex);
    },
    []
  );

  const handleRowDragLeave = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>) => {
      // 检查是否真的离开了行（而不是进入子元素）
      const relatedTarget = e.relatedTarget as HTMLElement;
      if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
        setDragOverRowIndex(null);
      }
    },
    []
  );

  const handleRowDrop = useCallback(
    (e: React.DragEvent<HTMLTableRowElement>, rowIndex: number) => {
      e.preventDefault();
      setDragOverRowIndex(null);

      // 优先检查是否是从图片库拖拽的图片
      const libraryImageUrl = e.dataTransfer.getData('text/library-image');
      if (libraryImageUrl) {
        addImageToRow(rowIndex, libraryImageUrl);
        MessagePlugin.success(
          language === 'zh'
            ? `已添加图片到第 ${rowIndex + 1} 行`
            : `Added image to row ${rowIndex + 1}`
        );
        return;
      }

      // 处理从文件管理器拖入的文件
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      let addedCount = 0;
      Array.from(files).forEach((file) => {
        if (!file.type.startsWith('image/')) return;

        // 添加到素材库
        addAsset(file, AssetType.IMAGE, AssetSource.LOCAL, file.name).catch(
          (err) => {
            console.warn(
              '[BatchImageGeneration] Failed to add asset to library:',
              err
            );
          }
        );

        // 读取并添加到目标行
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          addImageToRow(rowIndex, dataUrl);
        };
        reader.readAsDataURL(file);
        addedCount++;
      });

      if (addedCount > 0) {
        MessagePlugin.success(
          language === 'zh'
            ? `已添加 ${addedCount} 张图片到第 ${rowIndex + 1} 行`
            : `Added ${addedCount} images to row ${rowIndex + 1}`
        );
      }
    },
    [addImageToRow, language, addAsset]
  );

  // 图片库图片拖拽开始
  const handleLibraryImageDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, imageUrl: string) => {
      e.dataTransfer.setData('text/library-image', imageUrl);
      e.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  // 处理批量导入文件选择
  const handleBatchImportSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // 过滤出图片文件
      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith('image/')
      );
      if (imageFiles.length === 0) {
        MessagePlugin.warning(
          language === 'zh' ? '请选择图片文件' : 'Please select image files'
        );
        return;
      }

      setPendingImportFiles(imageFiles);
      // 默认从当前选中行或第1行开始
      const defaultStartRow = activeCell ? activeCell.row + 1 : 1;
      setImportStartRow(Math.min(defaultStartRow, tasks.length));
      setShowBatchImportModal(true);

      // 清空 input
      if (batchImportInputRef.current) {
        batchImportInputRef.current.value = '';
      }
    },
    [language, activeCell, tasks.length]
  );

  // 执行批量导入
  const executeBatchImport = useCallback(async () => {
    if (pendingImportFiles.length === 0) return;
    const endTrack = trackMemory(`批量导入(${pendingImportFiles.length}张)`);

    const perRow = normalizedImagesPerRow;
    const totalImages = pendingImportFiles.length;
    const rowsNeeded = Math.ceil(totalImages / perRow);
    const startIndex = importStartRow - 1; // 转为 0-based index

    // 读取所有图片为 DataURL，同时添加到素材库
    const imageDataUrls: string[] = [];
    for (const file of pendingImportFiles) {
      // Add to asset library (async, don't block UI)
      addAsset(file, AssetType.IMAGE, AssetSource.LOCAL, file.name).catch(
        (err) => {
          console.warn(
            '[BatchImageGeneration] Failed to add asset to library:',
            err
          );
        }
      );

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      imageDataUrls.push(dataUrl);
    }

    // 分配图片到行
    setTasks((prev) => {
      const newTasks = [...prev];
      let imageIndex = 0;
      let newRowsCreated = 0;

      for (let i = 0; i < rowsNeeded; i++) {
        const targetRowIndex = startIndex + i;
        const rowImages: string[] = [];

        // 收集本行的图片
        for (let j = 0; j < perRow && imageIndex < totalImages; j++) {
          rowImages.push(imageDataUrls[imageIndex]);
          imageIndex++;
        }

        if (targetRowIndex < newTasks.length) {
          // 插入到已有行：追加图片到现有行
          newTasks[targetRowIndex] = {
            ...newTasks[targetRowIndex],
            images: [...newTasks[targetRowIndex].images, ...rowImages],
          };
        } else {
          // 超出现有行：创建新行
          newTasks.push({
            id: taskIdCounter + newRowsCreated,
            prompt: '',
            params: { ...defaultModelParams },
            images: rowImages,
            count: 1,
            taskIds: [],
          });
          newRowsCreated++;
        }
      }

      return newTasks;
    });

    // 更新 ID 计数器（仅当创建了新行时）
    const existingRowsUsed = Math.min(rowsNeeded, tasks.length - startIndex);
    const newRowsCreated = Math.max(0, rowsNeeded - existingRowsUsed);
    if (newRowsCreated > 0) {
      setTaskIdCounter((prev) => prev + newRowsCreated);
    }

    // 清理状态
    setPendingImportFiles([]);
    setShowBatchImportModal(false);
    endTrack();

    const message =
      language === 'zh'
        ? `已导入 ${totalImages} 张图片，从第 ${importStartRow} 行开始`
        : `Imported ${totalImages} images starting from row ${importStartRow}`;
    MessagePlugin.success(message);
  }, [
    pendingImportFiles,
    normalizedImagesPerRow,
    importStartRow,
    taskIdCounter,
    tasks.length,
    language,
    addAsset,
    defaultModelParams,
  ]);

  // 取消批量导入
  const cancelBatchImport = useCallback(() => {
    setPendingImportFiles([]);
    setShowBatchImportModal(false);
  }, []);

  // 下载 Excel 模板
  const downloadExcelTemplate = useCallback(async () => {
    try {
      // 动态导入 xlsx 库
      const XLSX = await import('xlsx');

      // 预制模板数据（示例行）
      const templateData = [
        {
          提示词: '一只可爱的橘猫在阳光下睡觉',
          参数: serializeParamsForExcel({ ...defaultModelParams, size: '1x1' }),
          数量: 1,
        },
        {
          提示词: '未来城市的夜景，霓虹灯闪烁',
          参数: serializeParamsForExcel({
            ...defaultModelParams,
            size: '16x9',
          }),
          数量: 2,
        },
        {
          提示词: '古风美女，水墨画风格',
          参数: serializeParamsForExcel({ ...defaultModelParams, size: '3x4' }),
          数量: 1,
        },
        {
          提示词: '',
          参数: serializeParamsForExcel(defaultModelParams),
          数量: 1,
        },
        {
          提示词: '',
          参数: serializeParamsForExcel(defaultModelParams),
          数量: 1,
        },
      ];

      // 创建工作簿和工作表
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(templateData);

      // 设置列宽
      ws['!cols'] = [
        { wch: 60 }, // 提示词
        { wch: 24 }, // 参数
        { wch: 8 }, // 数量
      ];

      XLSX.utils.book_append_sheet(wb, ws, '批量出图模板');

      // 导出文件
      XLSX.writeFile(wb, 'batch-image-template.xlsx');

      MessagePlugin.success(
        language === 'zh'
          ? '模板下载成功，填写后可导入使用'
          : 'Template downloaded, fill and import to use'
      );
    } catch (error) {
      console.error('Excel template download error:', error);
      MessagePlugin.error(
        language === 'zh'
          ? '下载失败，请稍后重试'
          : 'Download failed, please try again'
      );
    }
  }, [defaultModelParams, language]);

  // 导入 Excel
  const handleExcelImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        // 动态导入 xlsx 库
        const XLSX = await import('xlsx');

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = new Uint8Array(event.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });

            // 读取第一个工作表
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // 转换为 JSON
            const jsonData =
              XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

            if (jsonData.length === 0) {
              MessagePlugin.warning(
                language === 'zh' ? 'Excel 文件为空' : 'Excel file is empty'
              );
              return;
            }

            // 解析数据并创建任务行
            const newTasks: TaskRow[] = jsonData.map(
              (row: Record<string, unknown>, index: number) => {
                // 支持多种列名格式
                const prompt = (row['提示词'] ||
                  row['prompt'] ||
                  row['Prompt'] ||
                  '') as string;
                const paramsText = (row['参数'] ||
                  row['params'] ||
                  row['Params'] ||
                  '') as string;
                const legacySize = (row['尺寸'] ||
                  row['size'] ||
                  row['Size'] ||
                  '') as string;
                const params = paramsText
                  ? parseParamsText(
                      String(paramsText),
                      selectedModel,
                      defaultModelParams
                    )
                  : normalizeRowParamsForModel(
                      { params: defaultModelParams, size: String(legacySize) },
                      selectedModel,
                      defaultModelParams
                    );
                const count =
                  parseInt(
                    String(row['数量'] || row['count'] || row['Count'] || '1')
                  ) || 1;

                // 解析参考图（支持换行分隔的多张图片URL）
                // 过滤掉占位符（如 [本地图片1]、[已截断] 等）
                const imagesStr = (row['参考图'] ||
                  row['images'] ||
                  row['Images'] ||
                  '') as string;
                const images = imagesStr
                  ? imagesStr
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(
                        (s) =>
                          s.length > 0 && !s.startsWith('[') && !s.endsWith(']')
                      )
                  : [];

                return {
                  id: taskIdCounter + index,
                  prompt: String(prompt).trim(),
                  params,
                  images,
                  count: Math.max(1, count),
                  taskIds: [],
                };
              }
            );

            // 更新任务列表
            setTasks((prev) => [...prev, ...newTasks]);
            setTaskIdCounter((prev) => prev + newTasks.length);

            MessagePlugin.success(
              language === 'zh'
                ? `已导入 ${newTasks.length} 行数据`
                : `Imported ${newTasks.length} rows`
            );
          } catch (error) {
            console.error('Excel import error:', error);
            MessagePlugin.error(
              language === 'zh'
                ? '导入失败，请检查文件格式'
                : 'Import failed, please check file format'
            );
          }
        };

        reader.readAsArrayBuffer(file);
      } catch (error) {
        console.error('Excel library load error:', error);
        MessagePlugin.error(
          language === 'zh'
            ? '加载 Excel 处理库失败'
            : 'Failed to load Excel library'
        );
      }

      // 清空 input
      if (excelImportInputRef.current) {
        excelImportInputRef.current.value = '';
      }
    },
    [defaultModelParams, language, selectedModel, taskIdCounter]
  );

  // 获取行的关联任务状态
  const getRowTasksInfo = useCallback(
    (
      taskRow: TaskRow
    ): {
      status: 'idle' | 'generating' | 'completed' | 'failed' | 'partial';
      tasks: Task[];
      completedCount: number;
      failedCount: number;
    } => {
      if (taskRow.taskIds.length === 0) {
        return { status: 'idle', tasks: [], completedCount: 0, failedCount: 0 };
      }

      const relatedTasks = queueTasks.filter((t) =>
        taskRow.taskIds.includes(t.id)
      );
      const completedCount = relatedTasks.filter(
        (t) => t.status === TaskStatus.COMPLETED
      ).length;
      const failedCount = relatedTasks.filter(
        (t) => t.status === TaskStatus.FAILED
      ).length;
      const processingCount = relatedTasks.filter(
        (t) =>
          t.status === TaskStatus.PENDING || t.status === TaskStatus.PROCESSING
      ).length;

      let status: 'idle' | 'generating' | 'completed' | 'failed' | 'partial' =
        'idle';
      if (processingCount > 0) {
        status = 'generating';
      } else if (failedCount > 0 && completedCount > 0) {
        status = 'partial';
      } else if (failedCount > 0) {
        status = 'failed';
      } else if (completedCount > 0) {
        status = 'completed';
      }

      return { status, tasks: relatedTasks, completedCount, failedCount };
    },
    [queueTasks]
  );

  // 删除单张已生成图片：同步移除任务记录与当前行关联，避免刷新后恢复预览。
  const deleteGeneratedImage = useCallback(
    async (rowId: number, generatedTask: Task) => {
      const confirmed = await confirm({
        title: language === 'zh' ? '删除生成图片' : 'Delete Generated Image',
        description:
          language === 'zh'
            ? '删除后将从批量预览和任务记录中移除，已插入画布的图片不受影响。'
            : 'This removes the image from the batch preview and task history. Images already inserted on the canvas are not affected.',
        confirmText: language === 'zh' ? '删除' : 'Delete',
        cancelText: language === 'zh' ? '取消' : 'Cancel',
        confirmTheme: 'danger',
      });
      if (!confirmed) return;

      setTasks((prev) => {
        const rowIndex = prev.findIndex((row) => row.id === rowId);
        const currentRow = prev[rowIndex];
        if (!currentRow?.taskIds.includes(generatedTask.id)) {
          return prev;
        }

        const nextTasks = [...prev];
        nextTasks[rowIndex] = {
          ...currentRow,
          taskIds: currentRow.taskIds.filter((id) => id !== generatedTask.id),
        };
        return nextTasks;
      });

      deleteTask(generatedTask.id);
      MessagePlugin.success(
        language === 'zh' ? '已删除生成图片' : 'Generated image deleted'
      );
    },
    [confirm, deleteTask, language]
  );

  const renderGeneratedImageDeleteButton = (
    rowId: number,
    generatedTask: Task,
    className = ''
  ) => (
    <button
      type="button"
      className={`generated-image-delete-button ${className}`.trim()}
      aria-label={language === 'zh' ? '删除生成图片' : 'Delete generated image'}
      title={language === 'zh' ? '删除生成图片' : 'Delete generated image'}
      onClick={(e) => {
        e.stopPropagation();
        void deleteGeneratedImage(rowId, generatedTask);
      }}
    >
      <DeleteIcon size={className ? '14px' : '12px'} />
    </button>
  );

  // 导出 Excel（包含参考图和预览图）
  const exportToExcel = useCallback(async () => {
    try {
      const XLSX = await import('xlsx');

      // Excel单元格最大字符数限制
      const MAX_CELL_LENGTH = 32000;

      // 处理图片URL：base64转为标记，HTTP URL保留，超长截断
      const processImageUrls = (urls: string[]): string => {
        const processed = urls.map((url, idx) => {
          if (url.startsWith('data:')) {
            // base64数据无法存储到Excel，标记为本地图片
            return `[本地图片${idx + 1}]`;
          }
          return url;
        });
        const result = processed.join('\n');
        // 截断超长内容
        if (result.length > MAX_CELL_LENGTH) {
          return result.substring(0, MAX_CELL_LENGTH - 20) + '\n...[已截断]';
        }
        return result;
      };

      // 构建导出数据
      const exportData = tasks.map((task) => {
        const rowInfo = getRowTasksInfo(task);
        // 获取已完成任务的预览图URL
        const previewUrls = rowInfo.tasks
          .filter((t) => t.status === TaskStatus.COMPLETED && t.result?.url)
          .map((t) => t.result!.url);

        return {
          提示词: task.prompt,
          参数: serializeParamsForExcel(
            normalizeRowParamsForModel(task, selectedModel, defaultModelParams)
          ),
          参考图: processImageUrls(task.images),
          数量: task.count,
          预览图: processImageUrls(previewUrls),
          状态:
            rowInfo.status === 'idle'
              ? '未生成'
              : rowInfo.status === 'generating'
              ? '生成中'
              : rowInfo.status === 'completed'
              ? '已完成'
              : rowInfo.status === 'failed'
              ? '失败'
              : rowInfo.status === 'partial'
              ? '部分完成'
              : '',
        };
      });

      // 创建工作簿和工作表
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);

      // 设置列宽
      ws['!cols'] = [
        { wch: 60 }, // 提示词
        { wch: 24 }, // 参数
        { wch: 80 }, // 参考图
        { wch: 8 }, // 数量
        { wch: 80 }, // 预览图
        { wch: 12 }, // 状态
      ];

      XLSX.utils.book_append_sheet(wb, ws, '批量出图数据');

      // 生成文件名
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(
        now.getMonth() + 1
      ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(
        now.getMinutes()
      ).padStart(2, '0')}`;
      const filename = `batch-image-export_${dateStr}_${timeStr}.xlsx`;

      // 导出文件
      XLSX.writeFile(wb, filename);

      MessagePlugin.success(
        language === 'zh'
          ? `已导出 ${tasks.length} 行数据`
          : `Exported ${tasks.length} rows`
      );
    } catch (error) {
      console.error('Excel export error:', error);
      MessagePlugin.error(
        language === 'zh'
          ? '导出失败，请稍后重试'
          : 'Export failed, please try again'
      );
    }
  }, [defaultModelParams, getRowTasksInfo, language, selectedModel, tasks]);

  // 选择失败的行
  const selectFailedRows = useCallback(() => {
    const failedRowIndices: number[] = [];
    tasks.forEach((task, rowIndex) => {
      const { status } = getRowTasksInfo(task);
      if (status === 'failed' || status === 'partial') {
        failedRowIndices.push(rowIndex);
      }
    });

    if (failedRowIndices.length === 0) {
      MessagePlugin.info(language === 'zh' ? '没有失败的行' : 'No failed rows');
      return;
    }

    // 选中失败行的 checkbox
    setSelectedRows(new Set(failedRowIndices));
    MessagePlugin.success(
      language === 'zh'
        ? `已选中 ${failedRowIndices.length} 个失败行`
        : `Selected ${failedRowIndices.length} failed rows`
    );
  }, [tasks, getRowTasksInfo, language]);

  // 反选行（checkbox）
  const invertSelection = useCallback(() => {
    const newSelectedRows = new Set<number>();

    tasks.forEach((_, rowIndex) => {
      if (!selectedRows.has(rowIndex)) {
        newSelectedRows.add(rowIndex);
      }
    });

    setSelectedRows(newSelectedRows);
  }, [tasks, selectedRows]);

  // 打开图片预览（使用 MediaViewer）
  const openImagePreview = useCallback(
    (images: string[], startIndex = 0) => {
      openViewer(urlsToMediaItems(images, 'image'), startIndex);
    },
    [openViewer]
  );

  // 切换单行选择（checkbox），支持 Shift 多选
  const toggleRowSelection = useCallback(
    (rowIndex: number, shiftKey = false) => {
      setSelectedRows((prev) => {
        const newSet = new Set(prev);

        if (shiftKey && lastCheckedRowRef.current !== null) {
          // Shift + 点击：选择范围内的所有行
          const start = Math.min(lastCheckedRowRef.current, rowIndex);
          const end = Math.max(lastCheckedRowRef.current, rowIndex);
          for (let i = start; i <= end; i++) {
            newSet.add(i);
          }
        } else {
          // 普通点击：切换选择
          if (newSet.has(rowIndex)) {
            newSet.delete(rowIndex);
          } else {
            newSet.add(rowIndex);
          }
        }

        return newSet;
      });
      // 记录本次勾选的行（用于 checkbox Shift 多选）
      lastCheckedRowRef.current = rowIndex;
    },
    []
  );

  // 全选/取消全选（checkbox）
  const toggleSelectAll = useCallback(() => {
    if (selectedRows.size === tasks.length && tasks.length > 0) {
      // 全部取消
      setSelectedRows(new Set());
    } else {
      // 全选
      setSelectedRows(new Set(tasks.map((_, index) => index)));
    }
  }, [tasks, selectedRows.size]);

  // 批量下载已选行的预览图（单张直接下载，多张打包zip）
  const downloadSelectedImages = useCallback(async () => {
    const selectedRowIndices = [...selectedRows].sort((a, b) => a - b);

    if (selectedRowIndices.length === 0) {
      MessagePlugin.warning(
        language === 'zh'
          ? '请先勾选要下载的行'
          : 'Please check rows to download'
      );
      return;
    }

    // 收集所有已完成任务的图片URL
    const imageUrls: { url: string; filename: string }[] = [];
    selectedRowIndices.forEach((rowIndex) => {
      const taskRow = tasks[rowIndex];
      if (!taskRow) return;

      // 找到该行关联的已完成任务
      taskRow.taskIds.forEach((taskId, taskIdx) => {
        const queueTask = queueTasks.find((t) => t.id === taskId);
        if (
          queueTask?.status === TaskStatus.COMPLETED &&
          queueTask.result?.url
        ) {
          imageUrls.push({
            url: queueTask.result.url,
            filename: `row${rowIndex + 1}_${taskIdx + 1}_${taskRow.prompt
              .slice(0, 20)
              .replace(/[^\w\u4e00-\u9fa5]/g, '_')}.png`,
          });
        }
      });
    });

    if (imageUrls.length === 0) {
      MessagePlugin.warning(
        language === 'zh'
          ? '选中的行没有已生成的图片'
          : 'No generated images in selected rows'
      );
      return;
    }

    // 智能下载（单张直接下载，多张打包zip）
    try {
      MessagePlugin.info(
        language === 'zh' ? '正在准备下载...' : 'Preparing download...'
      );

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(
        now.getMonth() + 1
      ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(
        now.getMinutes()
      ).padStart(2, '0')}`;
      const zipFilename = `aitu_images_${imageUrls.length}pics_${dateStr}_${timeStr}.zip`;

      const downloadItems = imageUrls.map((item) => ({
        url: item.url,
        type: 'image' as const,
        filename: item.filename,
      }));

      const result = await smartDownload(downloadItems, zipFilename);

      if (result.openedCount > 0 && result.downloadedCount === 0) {
        MessagePlugin.success(
          language === 'zh'
            ? result.openedCount > 1
              ? `已打开 ${result.openedCount} 个链接，请在新标签页下载`
              : '资源不支持直接下载，已打开链接'
            : result.openedCount > 1
            ? `Opened ${result.openedCount} links for download`
            : 'Opened link for download'
        );
      } else {
        MessagePlugin.success(
          language === 'zh' ? '下载成功' : 'Download complete'
        );
      }
    } catch (error) {
      console.error('Download failed:', error);
      MessagePlugin.error(language === 'zh' ? '下载失败' : 'Download failed');
    }
  }, [selectedRows, tasks, queueTasks, language]);

  // 执行实际的任务提交
  const executeSubmit = useCallback(
    async (validTasks: { task: TaskRow; rowIndex: number }[]) => {
      setIsSubmitting(true);
      try {
        // 先检查 API Key，没有则弹窗获取（只弹一次）
        if (
          !hasInvocationRouteCredentials(
            'image',
            selectedModelRef || selectedModel
          )
        ) {
          // 退出编辑模式，防止输入被捕获到表格
          setEditingCell(null);
          setActiveCell(null);

          const newApiKey = await promptForApiKey();
          if (!newApiKey) {
            MessagePlugin.warning(
              language === 'zh'
                ? '需要 API Key 才能生成图片'
                : 'API Key is required to generate images'
            );
            return;
          }
          // promptForApiKey 内部已经更新了 settings 并同步到 SW
        }
        const globalBatchTimestamp = Date.now();
        let subTaskCounter = 0;
        let submittedCount = 0;

        for (const { task, rowIndex } of validTasks) {
          const generateCount = task.count || 1;
          const batchId = `batch_${task.id}_${globalBatchTimestamp}`;
          const rowParams = normalizeRowParamsForModel(
            task,
            selectedModel,
            defaultModelParams
          );
          const normalizedAspectRatio =
            rowParams.size || defaultModelParams.size || 'auto';
          const normalizedSize =
            normalizedAspectRatio === 'auto'
              ? undefined
              : normalizedAspectRatio;
          const currentImageModel =
            selectedModel ||
            resolveInvocationRoute('image').modelId ||
            'gemini-2.5-flash-image-vip';
          const isMJModel = currentImageModel.startsWith('mj');
          const finalPrompt = isMJModel
            ? [task.prompt.trim(), buildMJPromptSuffix(rowParams)]
                .filter(Boolean)
                .join(' ')
            : task.prompt.trim();
          const adapterParams = isMJModel
            ? undefined
            : buildTaskAdapterParams(rowParams);

          const uploadedImages = task.images.map((url, index) => ({
            type: 'url',
            url,
            name: `reference_${index + 1}`,
          }));

          const newTaskIds: string[] = [];

          for (let i = 0; i < generateCount; i++) {
            subTaskCounter++;

            const taskParams = {
              prompt: finalPrompt,
              knowledgeContextRefs,
              aspectRatio: normalizedAspectRatio,
              size: normalizedSize,
              model: currentImageModel,
              modelRef: selectedModelRef || null,
              uploadedImages,
              batchId,
              batchIndex: i + 1,
              batchTotal: generateCount,
              globalIndex: subTaskCounter,
              autoInsertToCanvas: true,
              ...(adapterParams ? { params: adapterParams } : {}),
            };

            const createdTask = createTask(taskParams, TaskType.IMAGE);
            if (createdTask) {
              submittedCount++;
              newTaskIds.push(createdTask.id);
            }
          }

          // 更新行的关联任务ID
          if (newTaskIds.length > 0) {
            setTasks((prev) => {
              const newTasks = [...prev];
              if (newTasks[rowIndex]) {
                newTasks[rowIndex] = {
                  ...newTasks[rowIndex],
                  taskIds: [...newTasks[rowIndex].taskIds, ...newTaskIds],
                };
              }
              return newTasks;
            });
          }
        }

        if (submittedCount > 0) {
          MessagePlugin.success(
            language === 'zh'
              ? `已提交 ${submittedCount} 个任务到队列`
              : `Submitted ${submittedCount} tasks to queue`
          );
        }
      } finally {
        submitLockRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      createTask,
      defaultModelParams,
      knowledgeContextRefs,
      language,
      selectedModel,
      selectedModelRef,
      setTasks,
      setEditingCell,
      setActiveCell,
    ]
  );

  // 提交到任务队列 - 只提交选中的行
  const submitToQueue = useCallback(async () => {
    if (submitLockRef.current || isSubmitting) {
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);

    // 获取选中的行索引（从 checkbox 选中状态获取）
    const selectedRowIndices = [...selectedRows].sort((a, b) => a - b);

    // 如果没有选中行，提示用户
    if (selectedRowIndices.length === 0) {
      MessagePlugin.warning(
        language === 'zh'
          ? '请先勾选要生成的行'
          : 'Please check rows to generate'
      );
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    // 获取选中行中有提示词的任务
    const validTasks = selectedRowIndices
      .map((idx) => ({ task: tasks[idx], rowIndex: idx }))
      .filter(({ task }) => task && task.prompt && task.prompt.trim() !== '');

    if (validTasks.length === 0) {
      MessagePlugin.warning(
        language === 'zh'
          ? '选中的行没有填写提示词'
          : 'Selected rows have no prompts'
      );
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    // 检查是否有正在生成中的行
    const generatingRows = validTasks.filter(({ task }) => {
      const rowInfo = getRowTasksInfo(task);
      return rowInfo.status === 'generating';
    });

    // 检查是否有大于等于 100 的行
    const overLimitRows = validTasks.filter(
      ({ task }) => (task.count || 1) >= 100
    );
    // 计算总任务数
    const totalTaskCount = validTasks.reduce(
      (sum, { task }) => sum + (task.count || 1),
      0
    );
    const isTotalOverLimit = totalTaskCount >= 100;

    // 如果有警告情况，弹窗确认
    if (
      generatingRows.length > 0 ||
      overLimitRows.length > 0 ||
      isTotalOverLimit
    ) {
      const warnings: string[] = [];

      // 生成中的行警告
      if (generatingRows.length > 0) {
        const rowNumbers = generatingRows
          .map(({ rowIndex }) => rowIndex + 1)
          .join('、');
        warnings.push(
          language === 'zh'
            ? `第 ${rowNumbers} 行正在生成中`
            : `Row ${rowNumbers} is generating`
        );
      }

      // 单行超限警告
      if (overLimitRows.length > 0) {
        const rowWarnings = overLimitRows
          .map(({ task, rowIndex }) =>
            language === 'zh'
              ? `第 ${rowIndex + 1} 行数量为 ${task.count}`
              : `Row ${rowIndex + 1} count is ${task.count}`
          )
          .join('、');
        warnings.push(rowWarnings);
      }

      // 总数超限警告
      if (isTotalOverLimit) {
        warnings.push(
          language === 'zh'
            ? `总任务数为 ${totalTaskCount}`
            : `Total task count is ${totalTaskCount}`
        );
      }

      const warningMessage = warnings.join(language === 'zh' ? '；' : '; ');
      const confirmMessage =
        language === 'zh'
          ? `${warningMessage}，是否继续？`
          : `${warningMessage}. Continue?`;

      void confirm({
        title: language === 'zh' ? '生成提醒' : 'Generation Warning',
        description: confirmMessage,
        confirmText: language === 'zh' ? '继续生成' : 'Continue',
        cancelText: language === 'zh' ? '取消' : 'Cancel',
        confirmTheme: 'warning',
      })
        .then((confirmed) => {
          if (confirmed) {
            executeSubmit(validTasks);
          } else {
            submitLockRef.current = false;
            setIsSubmitting(false);
          }
        })
        .catch(() => {
          submitLockRef.current = false;
          setIsSubmitting(false);
        });
      return;
    }

    // 没有超限，直接提交
    executeSubmit(validTasks);
  }, [
    confirm,
    tasks,
    selectedRows,
    language,
    executeSubmit,
    getRowTasksInfo,
    isSubmitting,
  ]);

  // 键盘导航和直接输入
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 图片预览由 MediaViewer 自己处理键盘事件，无需在此处理

      if (isEditableElementTarget(e.target) || !isBatchKeyboardScopeActive(e)) {
        return;
      }

      if (!activeCell || editingCell || openParamsCell) return;

      const { row, col } = activeCell;
      const colIndex = EDITABLE_COLS.indexOf(col);

      // 检查是否是可打印字符（用于覆盖写入）
      const isPrintableKey =
        e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

      // 如果是可编辑列且按下可打印字符，进入覆盖写入模式
      if (
        isPrintableKey &&
        EDITABLE_COLS.includes(col) &&
        col !== 'images' &&
        col !== 'params'
      ) {
        e.preventDefault();
        // 先清空内容，再进入编辑模式
        if (col === 'count') {
          // 数量列：设置为输入的数字或清空
          const num = parseInt(e.key);
          if (!isNaN(num)) {
            updateCellValue(row, col, num);
          } else {
            updateCellValue(row, col, 0);
          }
        } else if (col === 'prompt') {
          // 提示词列：设置为输入的字符
          updateCellValue(row, col, e.key);
        }
        setEditingCell({ row, col });
        // 标记不需要选中全部（因为已经覆盖了，光标应该在末尾）
        (window as any).__cellEditSelectAll = false;
        return;
      }

      // Ctrl+Z 撤销
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z 重做
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+C 复制（支持多行）
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        // 收集所有选中单元格的值（按行排序）
        const sortedCells = [...selectedCells].sort((a, b) => a.row - b.row);
        const values = sortedCells.map((cell) => {
          const cellValue = (tasks[cell.row] as any)?.[cell.col];
          return { row: cell.row, col: cell.col, value: cellValue };
        });

        if (values.length > 0) {
          // 生成文本用于系统剪贴板（每行一个值）
          const textToCopy = values
            .map((v) =>
              v.col === 'images'
                ? JSON.stringify(v.value)
                : v.col === 'params' && isStringRecord(v.value)
                ? serializeParamsForExcel(v.value)
                : String(v.value ?? '')
            )
            .join('\n');

          copyToClipboard(textToCopy).then(() => {
            // 存储复制的单元格信息用于内部粘贴
            (window as any).__copiedCells = values;
            (window as any).__copiedCellsText = textToCopy;
          });
        }
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (row > 0) selectCell(row - 1, col);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (row < tasks.length - 1) selectCell(row + 1, col);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (colIndex > 0) selectCell(row, EDITABLE_COLS[colIndex - 1]);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (colIndex < EDITABLE_COLS.length - 1)
            selectCell(row, EDITABLE_COLS[colIndex + 1]);
          break;
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+Tab: 向前移动
            if (colIndex > 0) {
              selectCell(row, EDITABLE_COLS[colIndex - 1]);
            } else if (row > 0) {
              // 移动到上一行的最后一列
              selectCell(row - 1, EDITABLE_COLS[EDITABLE_COLS.length - 1]);
            }
          } else {
            // Tab: 向后移动
            if (colIndex < EDITABLE_COLS.length - 1) {
              selectCell(row, EDITABLE_COLS[colIndex + 1]);
            } else if (row < tasks.length - 1) {
              // 移动到下一行的第一列
              selectCell(row + 1, EDITABLE_COLS[0]);
            }
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (col !== 'images') enterEditMode(row, col);
          break;
        case 'Escape':
          e.preventDefault();
          setEditingCell(null);
          break;
        case 'Delete':
        case 'Backspace': {
          e.preventDefault();
          // 删除键清空所有选中单元格内容
          const cellsToClear =
            selectedCells.length > 0 ? selectedCells : [{ row, col }];
          cellsToClear.forEach((cell) => {
            if (cell.col === 'prompt') {
              updateCellValue(cell.row, cell.col, '');
            } else if (cell.col === 'count') {
              updateCellValue(cell.row, cell.col, 0);
            } else if (cell.col === 'images') {
              updateCellValue(cell.row, cell.col, []);
            } else if (cell.col === 'params') {
              updateCellValue(cell.row, cell.col, defaultModelParams);
            }
          });
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    activeCell,
    defaultModelParams,
    editingCell,
    openParamsCell,
    tasks,
    selectedCells,
    selectCell,
    enterEditMode,
    updateCellValue,
    undo,
    redo,
    isBatchKeyboardScopeActive,
  ]);

  // 使用 paste 事件自带数据，避免 iframe 权限策略阻止 navigator.clipboard.readText。
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (!activeCell || editingCell) return;

      if (
        isEditableElementTarget(event.target) ||
        !isBatchKeyboardScopeActive(event)
      ) {
        return;
      }

      const text =
        event.clipboardData?.getData('text/plain') ||
        event.clipboardData?.getData('text') ||
        '';
      if (!text) return;

      event.preventDefault();
      const targetCells =
        selectedCells.length > 0 ? selectedCells : [activeCell];

      const copiedCellsText = (window as any).__copiedCellsText as
        | string
        | undefined;
      if (
        typeof copiedCellsText === 'string' &&
        copiedCellsText.replace(/\r\n/g, '\n') ===
          text.replace(/\r\n/g, '\n') &&
        pasteCopiedCells(activeCell, targetCells)
      ) {
        return;
      }

      applyPastedTextToCells(text, activeCell, targetCells);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [
    activeCell,
    applyPastedTextToCells,
    editingCell,
    isBatchKeyboardScopeActive,
    pasteCopiedCells,
    selectedCells,
  ]);

  useEffect(() => {
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const rootElement = batchRootRef.current;
      const targetNode = event.target instanceof Node ? event.target : null;
      if (!rootElement || !targetNode || rootElement.contains(targetNode)) {
        return;
      }

      if (document.activeElement === rootElement) {
        rootElement.blur();
      }
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () =>
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
  }, []);

  // 全局鼠标释放监听 - 确保拖拽在任何地方释放都能结束
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingFill || isDraggingSelect) {
        handleTableMouseUp();
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isDraggingFill, isDraggingSelect, handleTableMouseUp]);

  // 渲染单元格内容
  const renderCellContent = (task: TaskRow, rowIndex: number, col: string) => {
    const isEditing = editingCell?.row === rowIndex && editingCell?.col === col;
    const isActive = activeCell?.row === rowIndex && activeCell?.col === col;
    const isSelected = selectedCells.some(
      (c) => c.row === rowIndex && c.col === col
    );
    const isFilling =
      isDraggingFill &&
      fillStartCell?.col === col &&
      fillPreviewRows.includes(rowIndex);

    const cellClassName = `excel-cell cell-${col} ${isActive ? 'active' : ''} ${
      isSelected ? 'selected' : ''
    } ${isFilling ? 'filling' : ''}`;

    switch (col) {
      case 'prompt':
        return (
          <div
            className={cellClassName}
            onMouseDown={(e) => {
              // 如果点击的是填充柄，不处理
              if ((e.target as HTMLElement).classList.contains('fill-handle'))
                return;
              // 如果已经在编辑当前单元格，不处理
              if (isEditing) return;
              // 左键开始选择拖拽
              if (e.button === 0 && !e.shiftKey) {
                startSelectDrag(rowIndex, col);
              }
            }}
            onClick={(e) => {
              // 如果已经在编辑当前单元格，不处理点击事件
              if (isEditing) return;
              handleCellClick(e, rowIndex, col);
            }}
            onDoubleClick={() => enterEditMode(rowIndex, col)}
          >
            {isEditing ? (
              <textarea
                className="cell-textarea"
                autoFocus
                value={task.prompt}
                placeholder={
                  language === 'zh' ? '输入提示词...' : 'Enter prompt...'
                }
                onChange={(e) => {
                  updateCellValue(rowIndex, col, e.target.value);
                }}
                onFocus={(e) => {
                  // 光标移到末尾
                  const len = e.target.value.length;
                  e.target.setSelectionRange(len, len);

                  // 自动调整高度
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onInput={(e) => {
                  // 实时调整高度
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = target.scrollHeight + 'px';
                }}
                onBlur={() => setEditingCell(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditingCell(null);
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    setEditingCell(null);
                    // 移动到下一行
                    if (rowIndex < tasks.length - 1) {
                      selectCell(rowIndex + 1, col);
                    }
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    setEditingCell(null);
                    const colIndex = EDITABLE_COLS.indexOf(col);
                    if (e.shiftKey) {
                      // Shift+Tab: 向前移动
                      if (colIndex > 0) {
                        selectCell(rowIndex, EDITABLE_COLS[colIndex - 1]);
                      } else if (rowIndex > 0) {
                        selectCell(
                          rowIndex - 1,
                          EDITABLE_COLS[EDITABLE_COLS.length - 1]
                        );
                      }
                    } else {
                      // Tab: 向后移动
                      if (colIndex < EDITABLE_COLS.length - 1) {
                        selectCell(rowIndex, EDITABLE_COLS[colIndex + 1]);
                      } else if (rowIndex < tasks.length - 1) {
                        selectCell(rowIndex + 1, EDITABLE_COLS[0]);
                      }
                    }
                  }
                }}
              />
            ) : (
              <span className="cell-text">{task.prompt || ''}</span>
            )}
            {isActive && (
              <div
                className="fill-handle"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  startFillDrag(rowIndex, col);
                }}
              />
            )}
          </div>
        );

      case 'params': {
        const rowParams = normalizeRowParamsForModel(
          task,
          selectedModel,
          defaultModelParams
        );
        const isParamsOpen =
          openParamsCell?.row === rowIndex && openParamsCell?.col === col;
        return (
          <div
            className={cellClassName}
            onMouseDown={(e) => {
              // 如果点击的是填充柄，不处理
              if ((e.target as HTMLElement).classList.contains('fill-handle'))
                return;
              if (
                (e.target as HTMLElement).closest('.batch-params-cell-control')
              )
                return;
              if (e.button === 0 && !e.shiftKey) {
                startSelectDrag(rowIndex, col);
              }
            }}
            onClick={(e) => handleCellClick(e, rowIndex, col)}
            onDoubleClick={() => {
              selectCell(rowIndex, col);
              setOpenParamsCell({ row: rowIndex, col });
            }}
          >
            <div
              className="batch-params-cell-control"
              onMouseDown={(e) => {
                setActiveCell({ row: rowIndex, col });
                setSelectedCells([{ row: rowIndex, col }]);
                setEditingCell(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {compatibleParams.length > 0 ? (
                <ParametersDropdown
                  key={`${selectedModel}-${task.id}`}
                  selectedParams={rowParams}
                  onParamChange={(paramId, value, options) => {
                    const nextParams = { ...rowParams };
                    if (!value || value === 'default') {
                      delete nextParams[paramId];
                    } else {
                      nextParams[paramId] = value;
                    }
                    updateCellValue(rowIndex, col, nextParams);
                    if (!options?.keepOpen) {
                      setOpenParamsCell(null);
                    }
                  }}
                  compatibleParams={compatibleParams}
                  modelId={selectedModel}
                  language={language}
                  disabled={isSubmitting}
                  isOpen={isParamsOpen}
                  onOpenChange={(open) => {
                    setOpenParamsCell(open ? { row: rowIndex, col } : null);
                  }}
                  placement="auto"
                />
              ) : (
                <span className="cell-text">-</span>
              )}
            </div>
            {isActive && (
              <div
                className="fill-handle"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  startFillDrag(rowIndex, col);
                }}
              />
            )}
          </div>
        );
      }

      case 'images':
        return (
          <div
            className={cellClassName}
            onClick={(e) => handleCellClick(e, rowIndex, col)}
          >
            <div className="image-cell-content">
              {task.images.map((url, idx) => (
                <div key={idx} className="cell-image-thumb">
                  <img src={url} alt="" />
                  <button
                    className="remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImageFromRow(rowIndex, url);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="add-image-buttons">
                <Button
                  variant="text"
                  shape="square"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectCell(rowIndex, col);
                    triggerRowImageUpload(rowIndex);
                  }}
                  title={language === 'zh' ? '上传图片' : 'Upload image'}
                  icon={<ImageUploadIcon size={16} />}
                  className="add-image-btn"
                  data-track="batch_row_upload_image_click"
                />
                <Button
                  variant="text"
                  shape="square"
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectCell(rowIndex, col);
                    openMediaLibraryForRow(rowIndex);
                  }}
                  title={
                    language === 'zh' ? '从素材库选择' : 'Select from library'
                  }
                  icon={<MediaLibraryIcon size={16} />}
                  className="add-image-btn"
                  data-track="batch_row_select_from_library_click"
                />
              </div>
            </div>
            {isActive && (
              <div
                className="fill-handle"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  startFillDrag(rowIndex, col);
                }}
              />
            )}
          </div>
        );

      case 'count':
        return (
          <div
            className={cellClassName}
            onMouseDown={(e) => {
              // 如果点击的是填充柄，不处理
              if ((e.target as HTMLElement).classList.contains('fill-handle'))
                return;
              if (isEditing) return;
              if (e.button === 0 && !e.shiftKey) {
                startSelectDrag(rowIndex, col);
              }
            }}
            onClick={(e) => {
              // 如果已经在编辑当前单元格，不处理点击事件
              if (isEditing) return;
              handleCellClick(e, rowIndex, col);
            }}
            onDoubleClick={() => enterEditMode(rowIndex, col)}
          >
            {isEditing ? (
              <input
                type="number"
                autoFocus
                min={1}
                max={10}
                value={task.count === 0 ? '' : task.count}
                className="cell-count-input"
                onChange={(e) => {
                  const valStr = e.target.value;
                  if (valStr === '') {
                    updateCellValue(rowIndex, col, 0);
                    return;
                  }
                  const val = parseInt(valStr);
                  if (!isNaN(val)) {
                    updateCellValue(rowIndex, col, val);
                  }
                }}
                onBlur={() => {
                  if (!task.count || task.count < 1) {
                    updateCellValue(rowIndex, col, 1);
                  } else if (task.count > 10) {
                    updateCellValue(rowIndex, col, 10);
                  }
                  setEditingCell(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditingCell(null);
                  } else if (e.key === 'Enter') {
                    setEditingCell(null);
                    if (rowIndex < tasks.length - 1) {
                      selectCell(rowIndex + 1, col);
                    }
                  }
                }}
              />
            ) : (
              <span className="cell-text">{task.count}</span>
            )}
            {isActive && (
              <div
                className="fill-handle"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  startFillDrag(rowIndex, col);
                }}
              />
            )}
          </div>
        );

      case 'preview': {
        const rowInfo = getRowTasksInfo(task);
        return (
          <div
            className={`${cellClassName} preview-cell preview-${rowInfo.status}`}
            onClick={(e) => {
              // 有已完成的图片时，打开画廊
              if (
                rowInfo.status === 'completed' ||
                rowInfo.status === 'partial'
              ) {
                setGalleryRowIndex(rowIndex);
              } else if (rowInfo.status === 'failed') {
                // 失败状态下点击选中该行的复选框
                if (!selectedRows.has(rowIndex)) {
                  toggleRowSelection(rowIndex);
                }
              } else {
                handleCellClick(e, rowIndex, col);
              }
            }}
          >
            {rowInfo.status === 'idle' && (
              <span className="preview-idle">-</span>
            )}
            {(rowInfo.status === 'generating' ||
              rowInfo.status === 'completed') &&
              (() => {
                const completedResults = getCompletedImageResults(
                  rowInfo.tasks
                );
                const completedUrls = completedResults.map(({ url }) => url);
                const isGenerating = rowInfo.status === 'generating';
                const processingCount = rowInfo.tasks.filter(
                  (t) =>
                    t.status === TaskStatus.PENDING ||
                    t.status === TaskStatus.PROCESSING
                ).length;

                // 没有已完成的图片，只显示生成中
                if (completedUrls.length === 0 && isGenerating) {
                  return (
                    <span className="preview-generating">
                      <span className="loading-spinner" />
                      {language === 'zh' ? '生成中...' : 'Generating...'}
                    </span>
                  );
                }

                // 有已完成的图片
                return (
                  <div className="preview-images">
                    {completedResults
                      .slice(0, isGenerating ? 2 : 3)
                      .map(({ task: completedTask, url }, idx) => (
                        <HoverTip
                          key={completedTask.id}
                          content={
                            language === 'zh'
                              ? '点击放大，左右切换'
                              : 'Click to enlarge, swipe to navigate'
                          }
                          showArrow={false}
                        >
                          <div
                            className="preview-thumb clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              openImagePreview(completedUrls, idx);
                            }}
                          >
                            <RetryImage
                              src={url}
                              alt={`Result ${idx + 1}`}
                              showSkeleton={false}
                              eager
                            />
                            {renderGeneratedImageDeleteButton(
                              task.id,
                              completedTask
                            )}
                          </div>
                        </HoverTip>
                      ))}
                    {/* 生成中状态：显示加载动画 */}
                    {isGenerating && (
                      <HoverTip
                        content={
                          language === 'zh'
                            ? `还有 ${processingCount} 张生成中`
                            : `${processingCount} more generating`
                        }
                        showArrow={false}
                      >
                        <span className="preview-generating-inline">
                          <span className="loading-spinner" />+{processingCount}
                        </span>
                      </HoverTip>
                    )}
                    {/* 完成状态：超过3张显示更多 */}
                    {!isGenerating && rowInfo.completedCount > 3 && (
                      <HoverTip
                        content={
                          language === 'zh' ? '查看全部图片' : 'View all images'
                        }
                        showArrow={false}
                      >
                        <span
                          className="preview-more clickable"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGalleryRowIndex(rowIndex);
                          }}
                        >
                          +{rowInfo.completedCount - 3}
                        </span>
                      </HoverTip>
                    )}
                  </div>
                );
              })()}
            {rowInfo.status === 'failed' && rowInfo.tasks[0]?.error && (
              <div className="preview-error">
                <span className="preview-error-message">
                  {rowInfo.tasks[0].error.message}
                </span>
                {rowInfo.tasks[0].error.details?.originalError && (
                  <HoverTip
                    content={
                      <div className="error-details-tooltip">
                        <div className="error-details-title">原始错误信息:</div>
                        <div className="error-details-content">
                          {rowInfo.tasks[0].error.details.originalError}
                        </div>
                      </div>
                    }
                    theme="light"
                    placement="bottom"
                    showArrow={false}
                  >
                    <span className="preview-error-details-link">[详情]</span>
                  </HoverTip>
                )}
              </div>
            )}
            {rowInfo.status === 'partial' &&
              (() => {
                const completedResults = getCompletedImageResults(
                  rowInfo.tasks
                );
                const partialUrls = completedResults.map(({ url }) => url);
                return (
                  <div className="preview-partial">
                    <div className="preview-images">
                      {completedResults
                        .slice(0, 2)
                        .map(({ task: completedTask, url }, idx) => (
                          <HoverTip
                            key={completedTask.id}
                            content={
                              language === 'zh'
                                ? '点击放大，左右切换'
                                : 'Click to enlarge, swipe to navigate'
                            }
                            showArrow={false}
                          >
                            <div
                              className="preview-thumb clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                openImagePreview(partialUrls, idx);
                              }}
                            >
                              <RetryImage
                                src={url}
                                alt={`Result ${idx + 1}`}
                                showSkeleton={false}
                                eager
                              />
                              {renderGeneratedImageDeleteButton(
                                task.id,
                                completedTask
                              )}
                            </div>
                          </HoverTip>
                        ))}
                    </div>
                    <span className="preview-partial-info">
                      ⚠️ {rowInfo.completedCount}/{rowInfo.tasks.length}
                    </span>
                  </div>
                );
              })()}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div ref={batchRootRef} className="batch-image-generation" tabIndex={-1}>
      <div className="batch-main-content">
        {/* 工具栏 - 按用户动线排列：导入数据 → 选择操作 → 删除 → 下载 */}
        <div className="batch-toolbar">
          {/* 隐藏的文件输入 */}
          <input
            ref={batchImportInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleBatchImportSelect}
            style={{ display: 'none' }}
          />
          <input
            ref={rowImageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleRowImageUpload}
            style={{ display: 'none' }}
          />
          <input
            ref={excelImportInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleExcelImport}
            style={{ display: 'none' }}
          />

          <div className="toolbar-left">
            {/* 1. 数据导入区 - 先下载模板 → 导入Excel → 批量导入图片 */}
            <HoverTip
              content={language === 'zh' ? '下载模板' : 'Download Template'}
              theme="light"
            >
              <Button
                variant="outline"
                theme="default"
                icon={<DownloadIcon />}
                onClick={downloadExcelTemplate}
                data-track="batch_download_template_click"
              />
            </HoverTip>
            <HoverTip
              content={language === 'zh' ? '导入 Excel' : 'Import Excel'}
              theme="light"
            >
              <Button
                variant="outline"
                theme="default"
                icon={<FilePasteIcon />}
                onClick={() => excelImportInputRef.current?.click()}
                data-track="batch_import_excel_click"
              />
            </HoverTip>
            <HoverTip
              content={
                language === 'zh' ? '批量导入图片' : 'Batch Import Images'
              }
              theme="light"
            >
              <Button
                variant="outline"
                theme="default"
                icon={<ImageIcon />}
                onClick={() => batchImportInputRef.current?.click()}
                data-track="batch_import_images_click"
                data-track-params={JSON.stringify({ source: 'toolbar' })}
              />
            </HoverTip>

            <span className="toolbar-divider"></span>

            {/* 2. 选择操作区 - 导入后选择要处理的行 */}
            <HoverTip
              content={language === 'zh' ? '选择失败行' : 'Select Failed Rows'}
              theme="light"
            >
              <Button
                variant="text"
                theme="default"
                icon={<CheckRectangleIcon />}
                onClick={selectFailedRows}
                data-track="batch_select_failed_click"
              />
            </HoverTip>
            <HoverTip
              content={language === 'zh' ? '反选' : 'Invert Selection'}
              theme="light"
            >
              <Button
                variant="text"
                theme="default"
                icon={<SwapIcon />}
                onClick={invertSelection}
                data-track="batch_invert_selection_click"
              />
            </HoverTip>

            <span className="toolbar-divider"></span>

            {/* 3. 删除操作 - 清理不需要的行 */}
            <Button
              variant="text"
              theme="default"
              icon={<DeleteIcon />}
              onClick={deleteSelected}
              className="batch-delete-btn"
              data-track="batch_delete_selected_click"
              data-track-params={JSON.stringify({ count: selectedRows.size })}
            >
              {language === 'zh' ? '删除选中' : 'Delete Selected'}
            </Button>

            <span className="toolbar-divider"></span>

            {/* 4. 下载结果 - 生成完成后下载 */}
            <Button
              variant="outline"
              theme="default"
              icon={<DownloadIcon />}
              onClick={downloadSelectedImages}
              className="batch-download-btn"
              data-track="batch_download_images_click"
              data-track-params={JSON.stringify({ count: selectedRows.size })}
            >
              {language === 'zh' ? '下载选中图片' : 'Download'}
            </Button>
          </div>

          <div className="toolbar-right">
            <div className="batch-knowledge-context-wrapper">
              <KnowledgeNoteContextSelector
                value={knowledgeContextRefs}
                onChange={setKnowledgeContextRefs}
                disabled={isSubmitting}
                language={language}
                label={language === 'zh' ? '上下文' : 'Context'}
              />
            </div>

            {/* 模型选择器 */}
            <div
              className="model-selector-wrapper"
              data-track="batch_model_select"
            >
              <ModelDropdown
                selectedModel={selectedModel}
                selectedSelectionKey={selectedSelectionKey}
                onSelect={(value) => {
                  setSelectedModel(value);
                  setSelectedModelRef(null);
                  onModelChange?.(value);
                  onModelRefChange?.(null);
                }}
                onSelectModel={(model: ModelConfig) => {
                  setSelectedModel(model.id);
                  const nextModelRef = getModelRefFromConfig(model);
                  setSelectedModelRef(nextModelRef);
                  onModelChange?.(model.id);
                  onModelRefChange?.(nextModelRef);
                }}
                language={language}
                models={visibleImageModels}
                placement="down"
                variant="form"
                disabled={isSubmitting}
              />
            </div>

            <Button
              theme="primary"
              onClick={submitToQueue}
              loading={isSubmitting}
              disabled={isSubmitting}
              className="batch-generate-btn"
              data-track="batch_generate_click"
              data-track-params={JSON.stringify({
                selectedRows: selectedRows.size,
                model: selectedModel,
              })}
            >
              {isSubmitting
                ? language === 'zh'
                  ? '提交中...'
                  : 'Submitting...'
                : language === 'zh'
                ? '生成选中行'
                : 'Generate Selected'}
            </Button>

            <span className="toolbar-divider"></span>

            {!hideLibrarySidebar && !showLibrary && (
              <HoverTip
                content={language === 'zh' ? '显示素材库' : 'Show Library'}
                theme="light"
              >
                <Button
                  variant="outline"
                  theme="default"
                  icon={<MediaLibraryIcon size={16} />}
                  onClick={() => setShowLibrary(true)}
                  data-track="batch_library_show_click"
                />
              </HoverTip>
            )}
          </div>
        </div>

        {/* 表格 */}
        <div
          className={`excel-table-container ${
            isDraggingFill ? 'is-filling' : ''
          } ${isDraggingSelect ? 'is-selecting' : ''}`}
          onMouseMove={handleTableMouseMove}
          onMouseUp={handleTableMouseUp}
          onMouseLeave={handleTableMouseUp}
        >
          <table className="excel-table">
            <thead>
              <tr>
                <th className="col-checkbox">
                  <HoverTip
                    content={
                      selectedInfoText ||
                      (language === 'zh'
                        ? '全选/取消全选'
                        : 'Select All / Deselect All')
                    }
                    theme="light"
                    showArrow={false}
                    visible={selectionTooltipVisible}
                    onVisibleChange={(visible) =>
                      setSelectionTooltipVisible(visible)
                    }
                  >
                    <div className="checkbox-wrapper">
                      <Checkbox
                        checked={
                          tasks.length > 0 && selectedRows.size === tasks.length
                        }
                        indeterminate={
                          selectedRows.size > 0 &&
                          selectedRows.size < tasks.length
                        }
                        onChange={toggleSelectAll}
                      />
                    </div>
                  </HoverTip>
                </th>
                <th className="row-number">#</th>
                <th className="col-prompt">
                  <div className="th-content">
                    {language === 'zh' ? '提示词' : 'Prompt'}
                    <HoverTip
                      content={language === 'zh' ? '向下填充' : 'Fill down'}
                      theme="light"
                    >
                      <Button
                        variant="text"
                        shape="circle"
                        size="small"
                        icon={<ArrowDownIcon />}
                        className="column-fill-btn"
                        onClick={() => fillColumn('prompt')}
                        data-track="batch_fill_column_click"
                        data-track-params={JSON.stringify({ column: 'prompt' })}
                      />
                    </HoverTip>
                  </div>
                </th>
                <th className="col-params">
                  <div className="th-content">
                    {language === 'zh' ? '参数' : 'Params'}
                    <HoverTip
                      content={language === 'zh' ? '向下填充' : 'Fill down'}
                      theme="light"
                    >
                      <Button
                        variant="text"
                        shape="circle"
                        size="small"
                        icon={<ArrowDownIcon />}
                        className="column-fill-btn"
                        onClick={() => fillColumn('params')}
                        data-track="batch_fill_column_click"
                        data-track-params={JSON.stringify({ column: 'params' })}
                      />
                    </HoverTip>
                  </div>
                </th>
                <th className="col-images">
                  <div className="th-content">
                    {language === 'zh' ? '参考图片' : 'Ref Images'}
                    <HoverTip
                      content={language === 'zh' ? '向下填充' : 'Fill down'}
                      theme="light"
                    >
                      <Button
                        variant="text"
                        shape="circle"
                        size="small"
                        icon={<ArrowDownIcon />}
                        className="column-fill-btn"
                        onClick={() => fillColumn('images')}
                        data-track="batch_fill_column_click"
                        data-track-params={JSON.stringify({ column: 'images' })}
                      />
                    </HoverTip>
                  </div>
                </th>
                <th className="col-count">
                  <div className="th-content">
                    {language === 'zh' ? '数量' : 'Count'}
                    <HoverTip
                      content={language === 'zh' ? '向下填充' : 'Fill down'}
                      theme="light"
                    >
                      <Button
                        variant="text"
                        shape="circle"
                        size="small"
                        icon={<ArrowDownIcon />}
                        className="column-fill-btn"
                        onClick={() => fillColumn('count')}
                        data-track="batch_fill_column_click"
                        data-track-params={JSON.stringify({ column: 'count' })}
                      />
                    </HoverTip>
                  </div>
                </th>
                <th className="col-preview">
                  <div className="th-content">
                    {language === 'zh' ? '预览' : 'Preview'}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task, rowIndex) => (
                <tr
                  key={task.id}
                  data-row-index={rowIndex}
                  className={`${
                    selectedRows.has(rowIndex) ? 'row-selected' : ''
                  } ${dragOverRowIndex === rowIndex ? 'row-drag-over' : ''} ${
                    fillPreviewRows.includes(rowIndex) ? 'fill-preview' : ''
                  }`}
                  onDragOver={(e) => handleRowDragOver(e, rowIndex)}
                  onDragLeave={handleRowDragLeave}
                  onDrop={(e) => handleRowDrop(e, rowIndex)}
                >
                  <td
                    className="col-checkbox"
                    onClick={(e) => {
                      toggleRowSelection(rowIndex, e.shiftKey);
                    }}
                  >
                    <div
                      className="checkbox-wrapper"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRowSelection(rowIndex, e.shiftKey);
                      }}
                      onMouseEnter={() =>
                        selectedRows.size > 0 &&
                        setSelectionTooltipVisible(true)
                      }
                      onMouseLeave={() => setSelectionTooltipVisible(false)}
                    >
                      <Checkbox checked={selectedRows.has(rowIndex)} />
                    </div>
                  </td>
                  <td
                    className="row-number"
                    onClick={(e) => toggleRowSelection(rowIndex, e.shiftKey)}
                    style={{ cursor: 'pointer' }}
                  >
                    {rowIndex + 1}
                  </td>
                  <td>{renderCellContent(task, rowIndex, 'prompt')}</td>
                  <td>{renderCellContent(task, rowIndex, 'params')}</td>
                  <td>{renderCellContent(task, rowIndex, 'images')}</td>
                  <td>{renderCellContent(task, rowIndex, 'count')}</td>
                  <td>{renderCellContent(task, rowIndex, 'preview')}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 添加行按钮和导出按钮 */}
          <div className="add-rows-section">
            <Button
              variant="dashed"
              shape="circle"
              onClick={() => setShowAddRowsModal(true)}
              title={language === 'zh' ? '添加行' : 'Add Rows'}
              icon={<AddIcon />}
              className="add-rows-btn"
              data-track="batch_add_rows_click"
            />
            <Button
              variant="outline"
              theme="default"
              icon={<ViewListIcon />}
              onClick={exportToExcel}
              className="export-excel-btn"
              data-track="batch_export_excel_click"
              data-track-params={JSON.stringify({ rowCount: tasks.length })}
            >
              {language === 'zh' ? '导出Excel' : 'Export Excel'}
            </Button>
          </div>
        </div>

        <p className="hint-text">
          {language === 'zh'
            ? '提示：Enter 编辑/确认 | Tab 移动 | Ctrl+Z 撤销 | Ctrl+Y 重做 | 拖拽图片到行'
            : 'Tip: Enter to edit/confirm | Tab to move | Ctrl+Z undo | Ctrl+Y redo | Drag images to rows'}
        </p>
      </div>

      {/* 素材库侧栏 - 移动端/平板端隐藏 */}
      {!hideLibrarySidebar && (
        <div
          className={`image-library-sidebar ${!showLibrary ? 'hidden' : ''}`}
        >
          <div className="library-header">
            <h3>{language === 'zh' ? '素材库' : 'Library'}</h3>
            <Button
              variant="text"
              shape="square"
              size="small"
              className="close-btn"
              onClick={() => setShowLibrary(false)}
              icon={<ChevronRightIcon />}
              data-track="batch_library_close_click"
            />
          </div>
          <div className="library-content">
            <div className="upload-section">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
              <Button
                block
                theme="default"
                variant="outline"
                icon={<ImageUploadIcon size={16} />}
                onClick={() => fileInputRef.current?.click()}
                data-track="batch_library_upload_click"
              >
                {language === 'zh' ? '上传图片' : 'Upload'}
              </Button>
            </div>
            <div className="library-grid">
              {imageAssets.length === 0 ? (
                <div className="empty-library">
                  {language === 'zh'
                    ? '暂无图片，请上传'
                    : 'No images, please upload'}
                </div>
              ) : (
                imageAssets.map((asset) => (
                  <HoverTip
                    key={asset.id}
                    content={
                      language === 'zh'
                        ? '点击添加到选中行，或拖拽到指定行'
                        : 'Click to add to selected rows, or drag to a specific row'
                    }
                    showArrow={false}
                  >
                    <div
                      className="library-image"
                      onClick={() => addImageToSelectedRows(asset.url)}
                      draggable
                      onDragStart={(e) =>
                        handleLibraryImageDragStart(e, asset.url)
                      }
                      data-track="batch_library_image_click"
                    >
                      <img src={asset.url} alt={asset.name} draggable={false} />
                    </div>
                  </HoverTip>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 批量导入弹窗 */}
      {showBatchImportModal && (
        <div className="batch-import-modal-overlay" onClick={cancelBatchImport}>
          <div
            className="batch-import-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                {language === 'zh' ? '批量导入图片' : 'Batch Import Images'}
              </h3>
              <button className="close-btn" onClick={cancelBatchImport}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="import-info">
                {language === 'zh'
                  ? `已选择 ${pendingImportFiles.length} 张图片`
                  : `${pendingImportFiles.length} images selected`}
              </p>

              <div className="import-settings-row">
                <div className="import-setting-item">
                  <label>
                    {language === 'zh' ? '从第几行开始：' : 'Start from row:'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={maxImportStartRow}
                    value={importStartRow}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value, 10);
                      const val = Math.min(
                        maxImportStartRow,
                        Math.max(1, Number.isFinite(parsed) ? parsed : 1)
                      );
                      setImportStartRow(val);
                    }}
                    className="start-row-input"
                  />
                </div>

                <div className="import-setting-item">
                  <label>
                    {language === 'zh' ? '每行图片数：' : 'Images per row:'}
                  </label>
                  <div className="per-row-options">
                    {[1, 2, 3, 4, 5].map((num) => (
                      <button
                        type="button"
                        key={num}
                        className={`per-row-btn ${
                          normalizedImagesPerRow === num ? 'active' : ''
                        }`}
                        onClick={() => setImagesPerRow(num)}
                        aria-pressed={normalizedImagesPerRow === num}
                        aria-label={
                          language === 'zh'
                            ? `每行 ${num} 张图片`
                            : `${num} image${num > 1 ? 's' : ''} per row`
                        }
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p className="import-preview">
                {language === 'zh'
                  ? `从第 ${importStartRow} 行开始，填充 ${pendingImportRowCount} 行，每行 ${normalizedImagesPerRow} 张图片`
                  : `Starting from row ${importStartRow}, filling ${pendingImportRowCount} rows with ${normalizedImagesPerRow} image(s) each`}
              </p>

              {/* 图片预览（使用预创建的 Blob URL 避免内存泄漏） */}
              <div className="import-preview-grid">
                {previewUrls.map((url, index) => (
                  <div key={index} className="preview-item">
                    <img
                      src={url}
                      alt={pendingImportFiles[index]?.name || ''}
                    />
                  </div>
                ))}
                {pendingImportFiles.length > 12 && (
                  <div className="preview-more">
                    +{pendingImportFiles.length - 12}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <Button
                variant="outline"
                theme="default"
                onClick={cancelBatchImport}
                data-track="batch_import_modal_cancel_click"
              >
                {language === 'zh' ? '取消' : 'Cancel'}
              </Button>
              <Button
                theme="default"
                variant="outline"
                onClick={executeBatchImport}
                data-track="batch_import_modal_confirm_click"
                data-track-params={JSON.stringify({
                  imageCount: pendingImportFiles.length,
                  imagesPerRow: normalizedImagesPerRow,
                  startRow: importStartRow,
                })}
              >
                {language === 'zh' ? '确认导入' : 'Import'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 图片预览（使用 MediaViewer） */}
      <MediaViewer {...viewerProps} />

      {/* 添加行弹窗 */}
      <Dialog
        visible={showAddRowsModal}
        onClose={() => setShowAddRowsModal(false)}
        header={language === 'zh' ? '添加行' : 'Add Rows'}
        confirmBtn={{
          content: language === 'zh' ? '添加' : 'Add',
          theme: 'default',
          variant: 'outline',
          onClick: () => {
            addRows(addRowsCount);
            setShowAddRowsModal(false);
            MessagePlugin.success(
              language === 'zh'
                ? `已添加 ${addRowsCount} 行`
                : `Added ${addRowsCount} rows`
            );
          },
        }}
        cancelBtn={{
          content: language === 'zh' ? '取消' : 'Cancel',
          onClick: () => setShowAddRowsModal(false),
        }}
        width={360}
        className="add-rows-dialog"
        destroyOnClose
      >
        <div className="add-rows-content">
          <label>{language === 'zh' ? '添加行数：' : 'Number of rows:'}</label>
          <input
            type="number"
            min={1}
            max={100}
            value={addRowsCount}
            onChange={(e) =>
              setAddRowsCount(
                Math.max(1, Math.min(100, parseInt(e.target.value) || 1))
              )
            }
            className="add-rows-input"
            autoFocus
          />
        </div>
      </Dialog>

      {/* 行图片画廊弹窗 */}
      <Dialog
        visible={galleryRowIndex !== null}
        onClose={() => setGalleryRowIndex(null)}
        header={
          language === 'zh'
            ? `第 ${(galleryRowIndex ?? 0) + 1} 行生成结果`
            : `Row ${(galleryRowIndex ?? 0) + 1} Results`
        }
        footer={null}
        width="70vw"
        className="row-gallery-dialog"
        destroyOnClose
      >
        {galleryRowIndex !== null &&
          (() => {
            const taskRow = tasks[galleryRowIndex];
            if (!taskRow) return null;
            const rowInfo = getRowTasksInfo(taskRow);
            const completedResults = getCompletedImageResults(rowInfo.tasks);
            const galleryUrls = completedResults.map(({ url }) => url);

            return (
              <div className="row-gallery-content">
                <div className="gallery-grid">
                  {completedResults.map(({ task: completedTask, url }, idx) => (
                    <div
                      key={completedTask.id}
                      className="gallery-item"
                      onClick={() => openImagePreview(galleryUrls, idx)}
                    >
                      <RetryImage
                        src={url}
                        alt={`Result ${idx + 1}`}
                        showSkeleton={false}
                        eager
                      />
                      <span className="gallery-item-index">{idx + 1}</span>
                      {renderGeneratedImageDeleteButton(
                        taskRow.id,
                        completedTask,
                        'gallery-delete-button'
                      )}
                    </div>
                  ))}
                </div>
                {completedResults.length === 0 && (
                  <div className="gallery-empty">
                    {language === 'zh' ? '暂无生成结果' : 'No results yet'}
                  </div>
                )}
              </div>
            );
          })()}
      </Dialog>

      {/* 素材库选择弹窗 */}
      {showMediaLibrary && (
        <MediaLibraryModal
          isOpen={showMediaLibrary}
          onClose={() => {
            setShowMediaLibrary(false);
            setMediaLibraryTargetRow(null);
          }}
          mode={SelectionMode.SELECT}
          filterType={AssetType.IMAGE}
          onSelect={handleMediaLibrarySelect}
        />
      )}
      {confirmDialog}
    </div>
  );
};

export default BatchImageGeneration;
