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
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { Send } from 'lucide-react';
import { MessagePlugin } from 'tdesign-react';
import { ImageUploadIcon, MediaLibraryIcon } from '../icons';
import { useBoard } from '@plait-board/react-board';
import { SelectedContentPreview } from '../shared/SelectedContentPreview';
import {
  getSelectedElements,
  ATTACHED_ELEMENT_CLASS_NAME,
  getRectangleByElements,
  PlaitBoard,
  PlaitElement,
  RectangleClient,
} from '@plait/core';
import { useI18n } from '../../i18n';
import { TaskStatus } from '../../types/task.types';
import { taskQueueService } from '../../services/task-queue';
import {
  processSelectedContentForAI,
  scrollToPointIfNeeded,
} from '../../utils/selection-utils';
import { useTextSelection } from '../../hooks/useTextSelection';
import { useChatDrawerControl } from '../../contexts/ChatDrawerContext';
import { useAssets } from '../../contexts/AssetContext';
import {
  AssetType,
  AssetSource,
  SelectionMode,
  Asset,
} from '../../types/asset.types';
import { MediaLibraryModal } from '../media-library/MediaLibraryModal';
import { ModelDropdown } from './ModelDropdown';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';
import { ParametersDropdown } from './ParametersDropdown';
import { PromptHistoryPopover } from './PromptHistoryPopover';
import { usePromptHistory } from '../../hooks/usePromptHistory';
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
import { BUILT_IN_TOOLS } from '../../constants/built-in-tools';
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
import { SkillDropdown } from './SkillDropdown';
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
import { analytics } from '../../utils/posthog-analytics';
import classNames from 'classnames';
import { InspirationBoard } from '../inspiration-board';
import { GenerationTypeDropdown } from './GenerationTypeDropdown';
import { CountDropdown } from './CountDropdown';
import './ai-input-bar.scss';

import type {
  WorkflowRetryContext,
  PostProcessingStatus,
} from '../../types/chat.types';
import { workflowCompletionService } from '../../services/workflow-completion-service';
import { BoardTransforms } from '@plait/core';
import { WorkZoneTransforms } from '../../plugins/with-workzone';
import type { PlaitWorkZone } from '../../types/workzone.types';
import { toolWindowService } from '../../services/tool-window-service';
import { useWorkflowSubmission } from '../../hooks/useWorkflowSubmission';
import { isFrameElement } from '../../types/frame.types';
import { matchFrameSizeForModel } from '../../utils/frame-size-matcher';
import { PlaitDrawElement } from '@plait/draw';
import { isPlaitVideo } from '../../interfaces/video';
import {
  loadAIInputPreferences,
  saveAIInputPreferences,
} from '../../services/ai-generation-preferences-service';
import { applyForcedSunoParams } from '../../utils/suno-model-aliases';

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
  text?: string; // 文字内容
  name: string; // 显示名称
  width?: number; // 图片/视频宽度
  height?: number; // 图片/视频高度
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
}

/**
 * 独立的选择内容监听组件
 * 将 useBoard 隔离在这个组件中，避免 board context 变化导致主组件重渲染
 */
const SelectionWatcher: React.FC<{
  language: string;
  onSelectionChange: (content: SelectedContent[]) => void;
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
    onSelectionChange,
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

    const onFrameSelectedRef = useRef(onFrameSelected);
    onFrameSelectedRef.current = onFrameSelected;

    useEffect(() => {
      const handleSelectionChange = async () => {
        const currentBoard = boardRef.current;
        if (!currentBoard) return;

        const selectedElements = getSelectedElements(currentBoard);

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

        try {
          const processedContent = await processSelectedContentForAI(
            currentBoard
          );
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
          console.error('Failed to process selected content:', error);
          onSelectionChangeRef.current([]);
        }
      };

      handleSelectionChange();

      const handleMouseUp = () => {
        setTimeout(handleSelectionChange, 50);
      };
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [language]);

    return null; // 这个组件不渲染任何内容
  }
);

SelectionWatcher.displayName = 'SelectionWatcher';

export const AIInputBar: React.FC<AIInputBarProps> = React.memo(
  ({ className, isDataReady }) => {
    // console.log('[AIInputBar] Component rendering');

    const { language } = useI18n();
    const imageModels = useSelectableModels('image');
    const videoModels = useSelectableModels('video');
    const audioModels = useSelectableModels('audio');
    const textModels = useSelectableModels('text');

    const chatDrawerControl = useChatDrawerControl();
    const workflowControl = useWorkflowControl();
    const {
      addHistory: addPromptHistory,
      history: promptHistory,
      removeHistory: deletePromptHistory,
    } = usePromptHistory();
    const { addAsset } = useAssets();
    // 使用 ref 存储，避免依赖变化
    const sendWorkflowMessageRef = useRef(
      chatDrawerControl.sendWorkflowMessage
    );
    sendWorkflowMessageRef.current = chatDrawerControl.sendWorkflowMessage;
    const updateWorkflowMessageRef = useRef(
      chatDrawerControl.updateWorkflowMessage
    );
    updateWorkflowMessageRef.current = chatDrawerControl.updateWorkflowMessage;
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

    // 当前工作流的重试上下文（用于在更新时保持 retryContext）
    const currentRetryContextRef = useRef<WorkflowRetryContext | null>(null);

    // 当前 WorkZone 元素 ID（用于在画布上显示工作流进度）
    const currentWorkZoneIdRef = useRef<string | null>(null);

    const resolvePreferredModelSelection = useCallback(
      (
        type: GenerationType,
        models: ModelConfig[]
      ): ModelConfig | undefined => {
        const routeType =
          type === 'video'
            ? 'video'
            : type === 'audio'
            ? 'audio'
            : type === 'text'
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
            : type === 'text'
            ? getDefaultTextModel()
            : getDefaultImageModel();

        return (
          findMatchingSelectableModel(models, fallbackModelId, null) ||
          models[0]
        );
      },
      []
    );

    const initialImageRoute = resolveInvocationRoute('image');
    const initialSelectedModelId =
      initialImageRoute.modelId || getDefaultImageModel();
    const initialSelectedModelRef = createModelRef(
      initialImageRoute.profileId,
      initialImageRoute.modelId
    );

    // State
    const [prompt, setPrompt] = useState('');
    const [selectedContent, setSelectedContent] = useState<SelectedContent[]>(
      []
    ); // 画布选中内容
    const [uploadedContent, setUploadedContent] = useState<SelectedContent[]>(
      []
    ); // 用户上传内容
    const [isSubmitting, setIsSubmitting] = useState(false); // 防止快速重复点击（3秒防抖）
    const submitCooldownRef = useRef<NodeJS.Timeout | null>(null); // 提交冷却定时器
    const [isFocused, setIsFocused] = useState(false);
    const [isCanvasEmpty, setIsCanvasEmpty] = useState<boolean | null>(null); // null=加载中, true=空, false=有内容
    // 当前选中的生成类型（图片、视频、Agent）
    const [generationType, setGenerationType] =
      useState<GenerationType>('image');
    // 当前选中的 Skill ID（仅在 Agent/text 模式下有效）
    const [selectedSkillId, setSelectedSkillId] =
      useState<string>(SKILL_AUTO_ID);
    // 当前选中的图片/视频/文本模型
    const [selectedModel, setSelectedModel] = useState(initialSelectedModelId);
    const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
      initialSelectedModelRef
    );
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
      if (generationType !== 'text') {
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
    // 当前选中的参数映射 (id -> value)
    const [selectedParams, setSelectedParams] = useState<
      Record<string, string>
    >(() => ({
      ...(initialSelectedModelId.startsWith('mj')
        ? {}
        : { size: getDefaultSizeForModel(initialSelectedModelId) }),
    }));
    const selectedParamsRef = useRef<Record<string, string>>(selectedParams);
    useEffect(() => {
      selectedParamsRef.current = selectedParams;
    }, [selectedParams]);
    // 当前选中的生成数量
    const [selectedCount, setSelectedCount] = useState(1);

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
          : generationType === 'text'
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

      // 切换离开 text 模式时重置 Skill 选择
      if (generationType !== 'text') {
        setSelectedSkillId(SKILL_AUTO_ID);
      }
      // Agent / audio 模式默认单结果
      if (generationType === 'text' || generationType === 'audio') {
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

    // 根据当前生成类型获取模型列表
    const currentModels = useMemo(() => {
      if (generationType === 'video') return visibleVideoModels;
      if (generationType === 'audio') return visibleAudioModels;
      if (generationType === 'text') return visibleTextModels;
      return visibleImageModels;
    }, [
      visibleAudioModels,
      generationType,
      visibleImageModels,
      visibleTextModels,
      visibleVideoModels,
    ]);

    // 预计算当前模型的可用参数，避免子组件内部 stale 计算
    const compatibleParams = useMemo(() => {
      if (generationType === 'text') return [];
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
      if (sunoAction !== 'lyrics') {
        return params;
      }

      return params.filter((param) => param.id === 'sunoAction');
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
      };
    }, []);

    // 监听 AI 生成完成事件（思维导图、流程图等同步操作）
    useEffect(() => {
      const handleGenerationComplete = (event: CustomEvent) => {
        // console.log('[AIInputBar] ai-generation-complete event received:', event.detail);
        // 立即重置提交状态，允许用户继续输入
        if (submitCooldownRef.current) {
          clearTimeout(submitCooldownRef.current);
          submitCooldownRef.current = null;
        }
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
          const workflow = workflowControl.getWorkflow();

          if (!workflow) return;

          // 查找与此任务关联的步骤
          const step = workflow.steps.find((s) => {
            const result = s.result as { taskId?: string } | undefined;
            return result?.taskId === task.id;
          });

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
              newStatus = 'running';
              break;
            case TaskStatus.COMPLETED:
              newStatus = 'completed';
              // 添加任务结果信息
              stepResult = {
                ...(typeof stepResult === 'object' ? stepResult : {}),
                taskId: task.id,
                result: task.result,
              };
              break;
            case TaskStatus.FAILED:
              newStatus = 'failed';
              stepError = task.error?.message || '任务执行失败';
              break;
            case TaskStatus.CANCELLED:
              newStatus = 'skipped';
              break;
          }

          // 只有状态变化时才更新
          if (newStatus !== step.status) {
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
              const workflowData = toWorkflowMessageData(
                updatedWorkflow,
                currentRetryContextRef.current || undefined
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
    }, [workflowControl]);

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
          const step = workflow?.steps.find((s) => {
            const result = s.result as { taskId?: string } | undefined;
            return result?.taskId === event.taskId;
          });

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
            const updatedWorkflow = workflowControl.getWorkflow();
            if (updatedWorkflow) {
              const workflowData = toWorkflowMessageData(
                updatedWorkflow,
                currentRetryContextRef.current || undefined,
                newPostProcessingStatus,
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
    }, [workflowControl, chatDrawerControl]);

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

    // 处理灵感模版选择：将提示词替换到输入框并切换到 Agent 模式
    const handleSelectInspirationPrompt = useCallback(
      (info: { prompt: string; modelType: 'agent' }) => {
        setPrompt(info.prompt);
        setGenerationType('text'); // agent 对应 text 生成类型
        inputRef.current?.focus();

        // 埋点：灵感模板选择（用于追踪转化率）
        analytics.track('inspiration_selected', {
          promptLength: info.prompt.length,
          modelType: info.modelType,
        });
      },
      []
    );

    // 处理历史提示词选择：将提示词回填到输入框并切换生成类型
    const handleSelectHistoryPrompt = useCallback(
      (info: {
        content: string;
        modelType?: 'image' | 'video' | 'audio' | 'agent';
      }) => {
        setPrompt(info.content);

        // 根据 modelType 自动切换生成类型
        if (info.modelType) {
          if (info.modelType === 'image') {
            setGenerationType('image');
          } else if (info.modelType === 'video') {
            setGenerationType('video');
          } else if (info.modelType === 'audio') {
            setGenerationType('audio');
          } else if (info.modelType === 'agent') {
            setGenerationType('text');
          }
        }

        inputRef.current?.focus();
      },
      []
    );

    // 处理添加 Skill：打开知识库并定位到 Skill 目录，自动新建笔记
    const handleAddSkill = useCallback(() => {
      const tool = BUILT_IN_TOOLS.find((t) => t.id === 'knowledge-base');
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
    const handleOpenPromptTool = useCallback(() => {
      // 从内置工具列表中获取香蕉提示词工具配置
      const tool = BUILT_IN_TOOLS.find((t) => t.id === 'banana-prompt');
      if (!tool) {
        console.warn('[AIInputBar] Banana prompt tool not found');
        return;
      }

      // 通过 toolWindowService 打开 WinBox 弹窗
      toolWindowService.openTool(tool);
    }, []);

    // 处理素材库选择
    const handleMediaLibrarySelect = useCallback(async (asset: Asset) => {
      try {
        // 创建 Image 对象获取尺寸
        const img = new Image();
        img.onload = () => {
          const newContent: SelectedContent = {
            type: 'image',
            url: asset.url,
            name: asset.name || `素材-${Date.now()}`,
            width: img.naturalWidth || undefined,
            height: img.naturalHeight || undefined,
          };
          setUploadedContent((prev) => [...prev, newContent]);
          setShowMediaLibrary(false);
        };
        img.onerror = () => {
          const newContent: SelectedContent = {
            type: 'image',
            url: asset.url,
            name: asset.name || `素材-${Date.now()}`,
          };
          setUploadedContent((prev) => [...prev, newContent]);
          setShowMediaLibrary(false);
        };
        img.src = asset.url;
      } catch (error) {
        console.error('Failed to select asset from library:', error);
        setShowMediaLibrary(false);
      }
    }, []);

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
          setUploadedContent((prev) => [...prev, ...newContent]);
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
      setSelectedContent(content);
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

    // 处理删除上传的图片（index 是在 allContent 中的索引）
    const handleRemoveUploadedContent = useCallback(
      (index: number) => {
        // allContent = [...uploadedContent, ...selectedContent]
        // 所以 index < uploadedContent.length 表示是上传的内容
        if (index < uploadedContent.length) {
          setUploadedContent((prev) => prev.filter((_, i) => i !== index));
        }
      },
      [uploadedContent.length]
    );

    // 同步 allContent 到 ChatDrawer Context
    useEffect(() => {
      setSelectedContentRef.current(
        allContent.map((c) => ({
          type: c.type,
          url: c.url,
          text: c.text,
          name: c.name,
        }))
      );
    }, [allContent]);

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
        setPrompt((prev) => prev.substring(0, pos) + prev.substring(pos + 1));
        triggerPositionRef.current = null;
      }
    }, []);

    const applyModelSelection = useCallback(
      (model: ModelConfig) => {
        analytics.track('ai_input_change_model', {
          model: model.id,
          type: model.type,
          profileId: model.sourceProfileId || null,
        });

        // 清除触发符号
        clearTriggerSymbol();

        // 更新状态（反显到下方下拉框）
        setGenerationType(model.type as GenerationType);
        setSelectedModel(model.id);
        const nextModelRef = getModelRefFromConfig(model);
        setSelectedModelRef(nextModelRef);
        // 仅保留新模型兼容的参数，并设置默认值
        const compatibleParams =
          model.type === 'video'
            ? getEffectiveVideoCompatibleParams(
                model.id,
                nextModelRef || model.id,
                selectedParamsRef.current
              )
            : getCompatibleParams(model.id);
        const nextParams: Record<string, string> = {};

        // 默认 size
        const sizeParam = compatibleParams.find((p) => p.id === 'size');
        const prevSize = selectedParamsRef.current?.size;
        const prevSizeIsValid =
          !prevSize ||
          !sizeParam?.options ||
          sizeParam.options.some((option) => option.value === prevSize);
        if (!model.id.startsWith('mj') && sizeParam) {
          nextParams.size =
            prevSize && prevSizeIsValid
              ? prevSize
              : sizeParam.defaultValue || getDefaultSizeForModel(model.id);
        }

        // 其他参数：沿用同 id 已选值，否则用默认值
        compatibleParams.forEach((p) => {
          if (p.id === 'size') return;
          const prevVal = selectedParamsRef.current?.[p.id];
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

        setSelectedParams(applyForcedSunoParams(model.id, nextParams));

        // 关闭下拉菜单并保持焦点
        setModelDropdownOpen(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      },
      [clearTriggerSymbol]
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

      const nextParams: Record<string, string> = {};

      const sizeParam = compatibleParams.find((p) => p.id === 'size');
      const prevSize = selectedParamsRef.current?.size;
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
        const prevVal = selectedParamsRef.current?.[p.id];
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
      // 仅在模型或兼容参数变动时运行，避免用户选择被覆盖
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedModel, compatibleParams]);

    // 处理参数选择
    const handleParamSelect = useCallback(
      (
        paramId: string,
        value?: string,
        options?: { keepOpen?: boolean }
      ) => {
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
    const handleGenerate = useCallback(async () => {
      if (!prompt.trim() && allContent.length === 0) {
        return;
      }
      if (isSubmitting) {
        return; // 仅防止快速重复点击
      }

      setIsSubmitting(true);

      try {
        // 检查 API key，如果没有配置则弹窗获取
        const currentRouteType =
          generationType === 'video'
            ? 'video'
            : generationType === 'audio'
            ? 'audio'
            : generationType === 'text'
            ? 'text'
            : 'image';
        const hasRouteCredentials = hasInvocationRouteCredentials(
          currentRouteType,
          selectedModelRef || selectedModel
        );
        console.log('[AIInputBar][handleGenerate] API Key 检查:', {
          hasApiKey: hasRouteCredentials,
        });
        if (!hasRouteCredentials) {
          console.log('[AIInputBar][handleGenerate] 弹窗获取 API Key...');
          const newApiKey = await promptForApiKey();
          console.log('[AIInputBar][handleGenerate] API Key 输入完成:', {
            hasNewKey: !!newApiKey,
          });
          if (!newApiKey) {
            setIsSubmitting(false);
            return;
          }
          console.log('[AIInputBar][handleGenerate] API Key 输入后设置状态:', {
            hasApiKey: hasInvocationRouteCredentials(
              currentRouteType,
              selectedModelRef || selectedModel
            ),
          });
        }

        // 构建选中元素的分类信息（使用合并后的 allContent）
        // 收集图片和图形的尺寸信息（按顺序：先 images，后 graphics）
        const imageItems = allContent.filter(
          (item) => item.type === 'image' && item.url
        );
        const graphicsItems = allContent.filter(
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
            (dim): dim is { width: number; height: number } => dim !== undefined
          );

        const selection = {
          texts: allContent
            .filter((item) => item.type === 'text' && item.text)
            .map((item) => item.text!),
          images: imageItems.map((item) => item.url!),
          videos: allContent
            .filter((item) => item.type === 'video' && item.url)
            .map((item) => item.url!),
          graphics: graphicsItems.map((item) => item.url!),
          // 添加图片尺寸信息（始终传递数组，避免下游处理 undefined）
          imageDimensions: imageDimensions,
        };

        // 解析输入内容，使用选中的模型和尺寸
        const parsedParams = parseAIInput(prompt, selection, {
          modelId: selectedModel,
          modelRef: selectedModelRef,
          params: selectedParams,
          generationType: generationType,
          count: selectedCount,
        });

        // 收集所有参考媒体（图片 + 图形 + 视频）
        const referenceImages = [...selection.images, ...selection.graphics];

        // 创建工作流定义（仅用于 WorkZone 显示，实际工作流由 submitWorkflowToSW 创建）
        let workflow: WorkflowDefinition;
        if (generationType === 'text' && selectedSkillId !== SKILL_AUTO_ID) {
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
              console.log(
                `[AIInputBar] 外部 Skill: id=${externalSkill.id} name=${
                  externalSkill.name
                } outputType=${externalSkill.outputType} contentLen=${
                  externalSkill.content?.length || 0
                }`
              );
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
                  referenceImages,
                  () => {
                    console.log('[AIInputBar] AI 正在解析外部 Skill 工作流...');
                  }
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
                ).catch(() => convertToWorkflow(parsedParams, referenceImages));
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
                    referenceImages,
                    () => {
                      // LLM 解析路径触发时，通知 UI 显示加载状态
                      console.log('[AIInputBar] AI 正在解析工作流...');
                    }
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
            console.warn('[AIInputBar] Skill 工作流未能生成，降级到通用工作流');
            workflow = convertToWorkflow(parsedParams, referenceImages);
          }
        } else {
          workflow = convertToWorkflow(parsedParams, referenceImages);
        }

        // 在画布上创建 WorkZone 显示工作流进度
        console.log(
          '[AIInputBar][handleGenerate] 即将创建 WorkZone, workflow.steps:',
          workflow.steps.length
        );
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
                  expectedInsertY = selectedRect.y + selectedRect.height + GAP;
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

          const workflowMessageData = toWorkflowMessageData(workflow);

          // 如果选中了 Frame，将 Frame 信息传递给 WorkZone
          // 生成完成后媒体将插入到 Frame 内部并缩放到 Frame 尺寸
          const frameInfo = selectedFrameRef.current;
          let targetFrameId: string | undefined;
          let targetFrameDimensions:
            | { width: number; height: number }
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
              expectedInsertLeftX = frameRect.x;
              expectedInsertY = frameRect.y;
            }
          }

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
          console.log(
            '[AIInputBar][handleGenerate] WorkZone 已创建:',
            workzoneElement.id
          );

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

        const aiContext = {
          rawInput: prompt,
          userInstruction: parsedParams.userInstruction,
          model: {
            id: parsedParams.modelId,
            type: parsedParams.generationType,
            isExplicit: parsedParams.isModelExplicit,
          },
          defaultModels: {
            audio:
              resolveInvocationRoute('audio').modelId || getDefaultAudioModel(),
            image:
              resolveInvocationRoute('image').modelId ||
              'gemini-3-pro-image-preview-vip',
            video: resolveInvocationRoute('video').modelId || 'veo3.1',
          },
          params: {
            count: parsedParams.count,
            size: parsedParams.size,
            duration: parsedParams.duration,
          },
          selection,
          finalPrompt: parsedParams.prompt,
        };

        const textModel = resolveInvocationRoute('text').modelId;

        const retryContext: WorkflowRetryContext = {
          aiContext,
          referenceImages,
          textModel,
        };
        currentRetryContextRef.current = retryContext;

        try {
          console.log(
            '[AIInputBar][handleGenerate] 开始提交工作流 submitWorkflowToSW...'
          );
          const t0 = Date.now();
          const { usedSW } = await submitWorkflowToSW(
            parsedParams,
            referenceImages,
            retryContext,
            workflow
          );
          console.log('[AIInputBar][handleGenerate] submitWorkflowToSW 返回:', {
            usedSW,
            耗时ms: Date.now() - t0,
          });
          if (usedSW) {
            if (prompt.trim()) {
              const hasSelection = allContent.length > 0;
              // 将 generationType 'text' 映射为 'agent' 用于历史记录
              const modelType =
                generationType === 'text' ? 'agent' : generationType;
              addPromptHistory(prompt.trim(), hasSelection, modelType);
            }
            setPrompt('');
            setSelectedContent([]);
            setUploadedContent([]);

            if (submitCooldownRef.current) {
              clearTimeout(submitCooldownRef.current);
            }
            submitCooldownRef.current = setTimeout(() => {
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

        // Fallback: 主线程执行（仅当 SW 不可用时）
        console.log(
          '[AIInputBar] Fallback: Executing workflow in main thread:',
          workflow.steps.length,
          'steps'
        );

        // 工作流已提交，立即保存历史、清空输入并解锁，步骤执行在后台继续
        if (prompt.trim()) {
          const hasSelection = allContent.length > 0;
          const modelTypeForHistory =
            generationType === 'text' ? 'agent' : generationType;
          addPromptHistory(prompt.trim(), hasSelection, modelTypeForHistory);
        }
        setPrompt('');
        setSelectedContent([]);
        setUploadedContent([]);
        if (submitCooldownRef.current) {
          clearTimeout(submitCooldownRef.current);
        }
        submitCooldownRef.current = setTimeout(() => {
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
            const stepsWithOptions = newSteps.map((s, index) => ({
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
            }));

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
          console.log(
            '[AIInputBar] Executing step:',
            step.mcp,
            'with mode:',
            step.options?.mode
          );
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
            };

            console.log(
              '[AIInputBar] Calling mcpRegistry.executeTool for:',
              step.mcp
            );
            // 通过 MCP Registry 执行工具
            const result = (await mcpRegistry.executeTool(
              { name: step.mcp, arguments: step.args },
              executeOptions
            )) as MCPTaskResult;
            console.log('[AIInputBar] Tool result:', {
              success: result.success,
              taskId: result.taskId,
              error: result.error,
            });

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
            } else if (currentStepStatus === 'running') {
              // 同步模式且未被回调更新：标记为完成
              workflowControl.updateStep(
                step.id,
                'completed',
                result.data,
                undefined,
                Date.now() - stepStartTime
              );

              // 路径 C（角色扮演模式）：ai_analyze 返回纯文本，onAddSteps 未被调用
              // 自动添加 insert_to_canvas 步骤，将文本以 markdown 方式插入画布
              if (step.mcp === 'ai_analyze') {
                const responseText = (result.data as { response?: string })
                  ?.response;
                // 只有当 onAddSteps 没有被调用（没有新增步骤）且有文本内容时才插入
                if (
                  responseText &&
                  responseText.trim() &&
                  pendingNewSteps.length === pendingStepsBeforeExec
                ) {
                  const insertStepId = `${step.id}-insert-text`;
                  // 将用户输入的 prompt 作为一级标题，拼接在 AI 回复内容前面
                  const titlePrefix =
                    prompt && prompt.trim() ? `# ${prompt.trim()}\n\n` : '';
                  const insertStep = {
                    id: insertStepId,
                    mcp: 'insert_to_canvas',
                    args: {
                      items: [
                        {
                          type: 'text',
                          content: titlePrefix + responseText,
                        },
                      ],
                    },
                    description: '将 AI 回复插入画布',
                    status: 'pending' as const,
                  };
                  workflowControl.addSteps([insertStep]);
                  pendingNewSteps.push(insertStep);
                }
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
          const board = SelectionWatcherBoardRef.current;
          if (workZoneId && board) {
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
              // 延迟删除，让用户看到完成状态
              setTimeout(() => {
                WorkZoneTransforms.removeWorkZone(board, workZoneId);
                currentWorkZoneIdRef.current = null;
                // console.log('[AIInputBar] Removed WorkZone after all steps completed (no tasks):', workZoneId);
              }, 1500);
            }
          }
        }
      } catch (error) {
        console.error('Failed to create generation task:', error);
        workflowControl.abortWorkflow();
        setIsSubmitting(false);
      }
    }, [
      prompt,
      allContent,
      isSubmitting,
      selectedModel,
      selectedModelRef,
      workflowControl,
      submitWorkflowToSW,
      addPromptHistory,
      selectedParams,
      generationType,
      selectedCount,
    ]);

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
            isModelExplicit: retryContext.aiContext.model.isExplicit,
            count: workflowMessageData.count,
            size: retryContext.aiContext.params.size,
            duration: retryContext.aiContext.params.duration,
            referenceImages: retryContext.referenceImages,
            selection: retryContext.aiContext.selection,
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
            const stepsWithOptions = newSteps.map((s, index) => ({
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
            }));
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
            const result = (await mcpRegistry.executeTool(
              { name: step.mcp, arguments: step.args },
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
            } else if (currentStepStatus === 'running') {
              workflowControl.updateStep(
                step.id,
                'completed',
                result.data,
                undefined,
                Date.now() - stepStartTime
              );

              // 路径 C（角色扮演模式）：ai_analyze 返回纯文本，onAddSteps 未被调用
              // 自动添加 insert_to_canvas 步骤，将文本以 markdown 方式插入画布
              if (step.mcp === 'ai_analyze') {
                const responseText = (result.data as { response?: string })
                  ?.response;
                // 只有当 onAddSteps 没有被调用（没有新增步骤）且有文本内容时才插入
                if (
                  responseText &&
                  responseText.trim() &&
                  pendingNewStepsForRetry.length === pendingStepsBeforeExec
                ) {
                  const insertStepId = `${step.id}-insert-text`;
                  // 将用户输入的 prompt 作为一级标题，拼接在 AI 回复内容前面
                  const retryPrompt = retryContext?.aiContext?.rawInput || '';
                  const titlePrefix =
                    retryPrompt && retryPrompt.trim()
                      ? `# ${retryPrompt.trim()}\n\n`
                      : '';
                  const insertStep = {
                    id: insertStepId,
                    mcp: 'insert_to_canvas',
                    args: {
                      items: [
                        {
                          type: 'text',
                          content: titlePrefix + responseText,
                        },
                      ],
                    },
                    description: '将 AI 回复插入画布',
                    status: 'pending' as const,
                  };
                  workflowControl.addSteps([insertStep]);
                  pendingNewStepsForRetry.push(insertStep);
                }
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
      [workflowControl]
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

        if (event.key === 'Enter' && (event.shiftKey || event.altKey)) {
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

        if (event.key === 'Enter') {
          event.preventDefault();
          analytics.track('ai_input_submit_keyboard');
          handleGenerate();
          return;
        }

        if (event.key === 'Escape') {
          setIsFocused(false);
          inputRef.current?.blur();
          return;
        }
      },
      [handleGenerate]
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

    // 处理输入变化，检测特殊符号触发下拉菜单
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const cursorPos = e.target.selectionStart || newValue.length;
        setPrompt(newValue);

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
      []
    );

    const canGenerate = prompt.trim().length > 0 || allContent.length > 0;
    const showInspirationBoard = isCanvasEmpty === true;

    return (
      <div
        ref={containerRef}
        className={classNames(
          'ai-input-bar',
          ATTACHED_ELEMENT_CLASS_NAME,
          className,
          {
            'ai-input-bar--with-inspiration': showInspirationBoard,
          }
        )}
        data-testid="ai-input-bar"
      >
        <SelectionWatcher
          language={language}
          onSelectionChange={handleSelectionChange}
          externalBoardRef={SelectionWatcherBoardRef}
          onCanvasEmptyChange={setIsCanvasEmpty}
          isDataReady={isDataReady}
          onFrameSelected={handleFrameSelected}
        />

        <InspirationBoard
          isCanvasEmpty={showInspirationBoard}
          onSelectPrompt={handleSelectInspirationPrompt}
          onOpenPromptTool={handleOpenPromptTool}
        />

        <div
          className={classNames('ai-input-bar__container', {
            'ai-input-bar__container--expanded':
              isFocused || allContent.length > 0,
          })}
        >
          <div className="ai-input-bar__bottom-bar">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            <button
              className="ai-input-bar__upload-btn"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={handleUploadClick}
              title={language === 'zh' ? '上传图片' : 'Upload images'}
              data-track="ai_input_click_upload"
            >
              <ImageUploadIcon size={18} />
            </button>

            <button
              className="ai-input-bar__library-btn"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={() => setShowMediaLibrary(true)}
              title={language === 'zh' ? '从素材库选择' : 'Select from library'}
              data-track="ai_input_click_library"
            >
              <MediaLibraryIcon size={18} />
            </button>

            <GenerationTypeDropdown
              value={generationType}
              onSelect={setGenerationType}
              disabled={isSubmitting}
            />

            {/* Skill 下拉框：仅在 Agent 模式下显示 */}
            {generationType === 'text' && (
              <SkillDropdown
                value={selectedSkillId}
                onSelect={setSelectedSkillId}
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
                  ? '选择模型 (↑↓ Tab)'
                  : 'Select model (↑↓ Tab)'
              }
              isOpen={modelDropdownOpen}
              onOpenChange={handleModelDropdownChange}
            />

            {/* Parameters dropdown selector - Hidden for Agent mode */}
            {generationType !== 'text' && compatibleParams.length > 0 && (
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

            {generationType !== 'text' && generationType !== 'audio' && (
              <CountDropdown
                value={selectedCount}
                onSelect={handleCountSelect}
                disabled={isSubmitting}
                isOpen={countDropdownOpen}
                onOpenChange={handleCountDropdownChange}
              />
            )}

            <div className="ai-input-bar__bottom-spacer" />

            <button
              className={`ai-input-bar__send-btn ${
                canGenerate ? 'active' : ''
              } ${isSubmitting ? 'loading' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={() => handleGenerate()}
              disabled={!canGenerate || isSubmitting}
              data-track="ai_input_click_send"
              data-testid="ai-send-btn"
            >
              <Send size={18} />
            </button>
          </div>

          <div
            className={classNames('ai-input-bar__input-area', {
              'ai-input-bar__input-area--expanded': isFocused,
            })}
          >
            {allContent.length > 0 && (
              <div className="ai-input-bar__content-preview">
                <SelectedContentPreview
                  items={allContent}
                  language={language}
                  enableHoverPreview={true}
                  onRemove={handleRemoveUploadedContent}
                  removableStartIndex={uploadedContent.length}
                />
              </div>
            )}

            <PromptHistoryPopover
              onSelectPrompt={handleSelectHistoryPrompt}
              language={language}
            />

            <div className="ai-input-bar__rich-input">
              <textarea
                ref={inputRef}
                className={classNames('ai-input-bar__input', {
                  'ai-input-bar__input--focused': isFocused,
                })}
                value={prompt}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={
                  generationType === 'text'
                    ? language === 'zh'
                      ? '输入指令，让 Agent 为你工作...'
                      : 'Type instructions for Agent...'
                    : generationType === 'audio'
                    ? language === 'zh'
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
                rows={isFocused ? 4 : 1}
                disabled={isSubmitting}
                data-testid="ai-input-textarea"
              />
            </div>
          </div>
        </div>

        <MediaLibraryModal
          isOpen={showMediaLibrary}
          onClose={() => setShowMediaLibrary(false)}
          mode={SelectionMode.SELECT}
          filterType={AssetType.IMAGE}
          onSelect={handleMediaLibrarySelect}
        />
      </div>
    );
  }
);

AIInputBar.displayName = 'AIInputBar';

export default AIInputBar;
