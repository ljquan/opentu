import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import './ttd-dialog.scss';
import './ai-image-generation.scss';
import { useI18n } from '../../i18n';
import { type Language } from '../../constants/prompts';
import { useDeviceType } from '../../hooks/useDeviceType';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import {
  TaskType,
  type GenerationParams,
  type KnowledgeContextRef,
} from '../../types/task.types';
import { MessagePlugin } from 'tdesign-react';
import { useGenerationHistory } from '../../hooks/useGenerationHistory';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { ParametersDropdown } from '../ai-input-bar/ParametersDropdown';
import {
  useGenerationState,
  useKeyboardShortcuts,
  ActionButtons,
  ErrorDisplay,
  ReferenceImageUpload,
  type ReferenceImage,
  PromptInput,
  getMergedPresetPrompts,
  savePromptToHistory as savePromptToHistoryUtil,
  ResizableDivider,
  loadSavedWidth,
  AutoInsertCheckbox,
  getAutoInsertValue,
} from './shared';
import {
  DEFAULT_ASPECT_RATIO,
  ASPECT_RATIO_OPTIONS,
  convertAspectRatioToSize,
} from '../../constants/image-aspect-ratios';
import { DialogTaskList } from '../task-queue/DialogTaskList';
import { LS_KEYS } from '../../constants/storage-keys';
import {
  loadScopedAIImageToolPreferences,
  sanitizeImageToolExtraParams,
  saveAIImageToolPreferences,
} from '../../services/ai-generation-preferences-service';
import { promptStorageService } from '../../services/prompt-storage-service';
import {
  clearAIImageDraftState,
  setAIImageDraftState,
} from '../../utils/ai-image-draft-state';
import {
  getImageTaskKnowledgeContextRefs,
  getImageTaskReferenceImages,
} from '../../utils/image-task-prefill';
import {
  geminiSettings,
  invocationPresetsSettings,
  hasInvocationRouteCredentials,
  type ModelRef,
} from '../../utils/settings-manager';
import { promptForApiKey } from '../../utils/gemini-api';
import { buildMJPromptSuffix } from '../../utils/mj-params';
import {
  getCompatibleParams,
  getSizeOptionsForModel,
} from '../../constants/model-config';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
  resolveActiveImageModelSelection,
  resolveImageSubmissionModelSelection,
  type ResolvedModelSelection,
} from '../../utils/model-selection';
import { KnowledgeNoteContextSelector } from '../shared';

interface AIImageGenerationProps {
  initialPrompt?: string;
  initialImages?: ReferenceImage[];
  initialKnowledgeContextRefs?: KnowledgeContextRef[];
  selectedElementIds?: string[];
  initialWidth?: number;
  initialHeight?: number;
  initialResultUrl?: string;
  initialAspectRatio?: string;
  targetFrameId?: string;
  targetFrameDimensions?: { width: number; height: number };
  pptSlideImage?: boolean;
  pptSlidePrompt?: string;
  pptReplaceElementId?: string;
  replaceElementId?: string;
  targetElementId?: string;
  anchorId?: string;
  sourceTaskId?: string;
  sourcePrompt?: string;
  promptMeta?: GenerationParams['promptMeta'];
  selectedModel?: string;
  selectedModelRef?: ModelRef | null;
  onModelChange?: (value: string) => void;
  onModelRefChange?: (value: ModelRef | null) => void;
  /** 外部传入的 batchId，用于任务关联（如视频分析器帧生成） */
  externalBatchId?: string;
  assetMetadata?: GenerationParams['assetMetadata'];
  initialAutoInsertToCanvas?: boolean;
  onDraftChange?: (draft: {
    prompt: string;
    images: Array<{ url: string; name: string }>;
    aspectRatio?: string;
  }) => void | Promise<void>;
}

function getAspectRatioFromSizeParam(size?: string): string | undefined {
  if (!size) return undefined;
  if (size === 'auto') return DEFAULT_ASPECT_RATIO;

  const aspectRatio = size.replace(/[xX]/g, ':');
  return ASPECT_RATIO_OPTIONS.some((option) => option.value === aspectRatio)
    ? aspectRatio
    : undefined;
}

function getAspectRatioFromParams(
  params: Record<string, string>,
  fallbackAspectRatio?: string
): string {
  return (
    getAspectRatioFromSizeParam(params.size) ||
    fallbackAspectRatio ||
    DEFAULT_ASPECT_RATIO
  );
}

function applyAspectRatioToParams(
  modelId: string,
  params: Record<string, string>,
  nextAspectRatio?: string
): Record<string, string> {
  if (modelId.startsWith('mj') || !nextAspectRatio) {
    return params;
  }

  const nextSize =
    nextAspectRatio === DEFAULT_ASPECT_RATIO
      ? 'auto'
      : convertAspectRatioToSize(nextAspectRatio);
  if (
    !nextSize ||
    !getSizeOptionsForModel(modelId).some((option) => option.value === nextSize)
  ) {
    return params;
  }

  return params.size === nextSize ? params : { ...params, size: nextSize };
}

function buildMaskEditTaskParams(images: ReferenceImage[]) {
  const maskImage = images.length === 1 ? images[0].maskImage?.trim() : '';
  if (!maskImage) {
    return {};
  }

  return {
    referenceImages: [images[0].url],
    generationMode: 'image_edit' as const,
    maskImage,
  };
}

function stripMaskFromReferenceImages(images: ReferenceImage[]) {
  return images.map(({ maskImage: _maskImage, ...image }) => image);
}

const AIImageGeneration = ({
  initialPrompt = '',
  initialImages = [],
  initialKnowledgeContextRefs = [],
  selectedElementIds: initialSelectedElementIds = [],
  initialWidth,
  initialHeight,
  initialResultUrl,
  initialAspectRatio,
  targetFrameId,
  targetFrameDimensions,
  pptSlideImage,
  pptSlidePrompt,
  pptReplaceElementId,
  replaceElementId,
  targetElementId,
  anchorId,
  sourceTaskId,
  sourcePrompt,
  promptMeta,
  selectedModel,
  selectedModelRef,
  onModelChange,
  onModelRefChange,
  externalBatchId,
  assetMetadata,
  initialAutoInsertToCanvas,
  onDraftChange,
}: AIImageGenerationProps = {}) => {
  const imageModels = useSelectableModels('image');
  const initialActiveSelection = resolveActiveImageModelSelection(imageModels);
  const initialMatchedModel =
    findMatchingSelectableModel(
      imageModels,
      initialActiveSelection.modelId,
      initialActiveSelection.modelRef
    ) ||
    getPinnedSelectableModel(
      'image',
      initialActiveSelection.modelId,
      initialActiveSelection.modelRef
    );
  const [currentModel, setCurrentModel] = useState(
    initialMatchedModel?.id || initialActiveSelection.modelId
  );
  const [currentModelRef, setCurrentModelRef] = useState<ModelRef | null>(
    getModelRefFromConfig(initialMatchedModel) ||
      initialActiveSelection.modelRef
  );
  const initialSelectionKey = getSelectionKey(
    initialMatchedModel?.id || initialActiveSelection.modelId,
    getModelRefFromConfig(initialMatchedModel) ||
      initialActiveSelection.modelRef
  );
  const initialScopedPreferences = loadScopedAIImageToolPreferences(
    initialMatchedModel?.id || initialActiveSelection.modelId,
    initialSelectionKey
  );
  const [prompt, setPrompt] = useState(initialPrompt);
  const [knowledgeContextRefs, setKnowledgeContextRefs] = useState<
    KnowledgeContextRef[]
  >(initialKnowledgeContextRefs);
  const [mjSelectedParams, setMjSelectedParams] = useState<
    Record<string, string>
  >(initialScopedPreferences.extraParams);
  const visibleImageModels = useMemo(() => {
    const currentMatch = findMatchingSelectableModel(
      imageModels,
      currentModel,
      currentModelRef
    );
    if (currentMatch || !currentModel) {
      return imageModels;
    }

    const pinnedModel = getPinnedSelectableModel(
      'image',
      currentModel,
      currentModelRef
    );
    return pinnedModel ? [pinnedModel, ...imageModels] : imageModels;
  }, [currentModel, currentModelRef, imageModels]);
  const [width, setWidth] = useState<number | string>(initialWidth || 1024);
  const [height, setHeight] = useState<number | string>(initialHeight || 1024);
  const [aspectRatio, setAspectRatio] = useState<string>(
    initialAspectRatio ||
      getAspectRatioFromParams(
        initialScopedPreferences.extraParams,
        initialScopedPreferences.aspectRatio
      )
  );
  const [error, setError] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] =
    useState<ReferenceImage[]>(initialImages);

  // 任务列表面板状态 - 使用像素宽度
  const [isTaskListVisible, setIsTaskListVisible] = useState(true);
  const [taskListWidth, setTaskListWidth] = useState(() =>
    loadSavedWidth('image')
  );
  const [mobilePanel, setMobilePanel] = useState<'config' | 'tasks'>('config');
  const containerRef = useRef<HTMLDivElement>(null);
  const promptPasteScopeRef = useRef<HTMLDivElement>(null);
  const { viewportWidth } = useDeviceType();
  const isCompactLayout = viewportWidth <= 768;

  // Use generation history from task queue
  const { imageHistory } = useGenerationHistory();
  const [promptHistoryVersion, setPromptHistoryVersion] = useState(0);
  const { isGenerating } = useGenerationState('image');
  const { language } = useI18n();
  const { createTask } = useTaskQueue();
  const generatingLockRef = useRef(false);

  const applyCurrentModelSelection = useCallback(
    (selection: ResolvedModelSelection) => {
      setCurrentModel((prev) =>
        prev === selection.modelId ? prev : selection.modelId
      );
      setCurrentModelRef((prev) => {
        if (
          prev?.profileId === selection.modelRef?.profileId &&
          prev?.modelId === selection.modelRef?.modelId
        ) {
          return prev;
        }
        return selection.modelRef;
      });
    },
    []
  );

  useEffect(() => {
    return promptStorageService.subscribeChanges(() => {
      setPromptHistoryVersion((version) => version + 1);
    });
  }, []);

  const isMJModel = currentModel.startsWith('mj');
  const hasCompatibleParams = React.useMemo(() => {
    return getCompatibleParams(currentModel).length > 0;
  }, [currentModel]);

  // Track if we're in manual edit mode (from handleEditTask) to prevent props from overwriting
  const [isManualEdit, setIsManualEdit] = useState(false);

  // 模型切换时恢复该模型上次使用的偏好
  useEffect(() => {
    if (isManualEdit) {
      return;
    }

    const scopedPreferences = loadScopedAIImageToolPreferences(
      currentModel,
      getSelectionKey(currentModel, currentModelRef)
    );
    const nextParams = initialAspectRatio
      ? applyAspectRatioToParams(
          currentModel,
          scopedPreferences.extraParams,
          initialAspectRatio
        )
      : scopedPreferences.extraParams;
    setMjSelectedParams(nextParams);
    setAspectRatio(
      getAspectRatioFromParams(
        nextParams,
        initialAspectRatio || scopedPreferences.aspectRatio
      )
    );
  }, [currentModel, currentModelRef, initialAspectRatio, isManualEdit]);

  const handleMJParamChange = useCallback((paramId: string, value: string) => {
    if (!value || value === 'default') {
      if (paramId === 'size') {
        setAspectRatio(DEFAULT_ASPECT_RATIO);
      }
      setMjSelectedParams((prev) => {
        const next = { ...prev };
        delete next[paramId];
        return next;
      });
      return;
    }
    if (paramId === 'size') {
      setAspectRatio(
        getAspectRatioFromSizeParam(value) || DEFAULT_ASPECT_RATIO
      );
    }
    setMjSelectedParams((prev) => ({
      ...prev,
      [paramId]: value,
    }));
  }, []);

  // 处理宽度变化
  const handleWidthChange = useCallback((width: number) => {
    setTaskListWidth(width);
  }, []);

  // 切换任务列表显示/隐藏
  const handleToggleTaskList = useCallback(() => {
    setIsTaskListVisible((prev) => !prev);
  }, []);

  // 处理 props 变化，更新内部状态
  const processedPropsRef = React.useRef<string>('');
  useEffect(() => {
    // Skip if we're in manual edit mode (user clicked edit in task list)
    if (isManualEdit) {
      // console.log('AIImageGeneration - skipping props update in manual edit mode');
      return;
    }

    // Create a unique key from all initial props to detect real changes
    const propsKey = JSON.stringify({
      prompt: initialPrompt,
      images: initialImages?.map((img) => img.url),
      knowledgeContextRefs: initialKnowledgeContextRefs.map(
        (ref) => ref.noteId
      ),
      elementIds: initialSelectedElementIds,
      width: initialWidth,
      height: initialHeight,
      result: initialResultUrl,
      aspectRatio: initialAspectRatio,
      targetFrameId,
      pptSlideImage,
      pptSlidePrompt,
      pptReplaceElementId,
    });

    // Skip if we've already processed these exact props
    if (processedPropsRef.current === propsKey) {
      // console.log('AIImageGeneration - skipping duplicate props processing');
      return;
    }

    // console.log('AIImageGeneration - processing new props:', { propsKey });
    processedPropsRef.current = propsKey;

    setPrompt(initialPrompt);
    setKnowledgeContextRefs(initialKnowledgeContextRefs);
    // 使用 initialImages 的值,如果是 undefined 则使用空数组(确保清空)
    setUploadedImages(initialImages || []);
    if (initialWidth) setWidth(initialWidth);
    if (initialHeight) setHeight(initialHeight);
    // 如果有 Frame 匹配的宽高比，自动设置
    if (initialAspectRatio) {
      setAspectRatio(initialAspectRatio);
      setMjSelectedParams((prev) =>
        applyAspectRatioToParams(currentModel, prev, initialAspectRatio)
      );
    }
  }, [
    initialPrompt,
    initialImages,
    initialKnowledgeContextRefs,
    initialSelectedElementIds,
    initialWidth,
    initialHeight,
    initialResultUrl,
    initialAspectRatio,
    targetFrameId,
    pptSlideImage,
    pptSlidePrompt,
    pptReplaceElementId,
    isManualEdit,
    currentModel,
  ]);

  const lastDraftRef = useRef('');
  useEffect(() => {
    setAIImageDraftState({
      prompt,
      imageCount: uploadedImages.length,
      knowledgeContextCount: knowledgeContextRefs.length,
    });

    return clearAIImageDraftState;
  }, [knowledgeContextRefs.length, prompt, uploadedImages.length]);

  useEffect(() => {
    if (!onDraftChange) {
      return;
    }

    const draft = {
      prompt,
      images: uploadedImages.map((image) => ({
        url: image.url,
        name: image.name,
      })),
      aspectRatio,
    };
    const draftKey = JSON.stringify(draft);
    if (lastDraftRef.current === draftKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (lastDraftRef.current === draftKey) {
        return;
      }
      lastDraftRef.current = draftKey;
      void onDraftChange(draft);
    }, 200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [aspectRatio, onDraftChange, prompt, uploadedImages]);

  useEffect(() => {
    const handleSettingsChange = () => {
      // 受控模式由父组件统一同步，避免 route 监听与 props 双向抢写。
      if (selectedModel !== undefined) {
        return;
      }
      const nextSelection =
        resolveActiveImageModelSelection(visibleImageModels);
      if (
        getSelectionKey(currentModel, currentModelRef) !==
        nextSelection.selectionKey
      ) {
        applyCurrentModelSelection(nextSelection);
      }
    };
    geminiSettings.addListener(handleSettingsChange);
    invocationPresetsSettings.addListener(handleSettingsChange);
    return () => {
      geminiSettings.removeListener(handleSettingsChange);
      invocationPresetsSettings.removeListener(handleSettingsChange);
    };
  }, [
    applyCurrentModelSelection,
    currentModel,
    currentModelRef,
    selectedModel,
    visibleImageModels,
  ]);

  useEffect(() => {
    if (visibleImageModels.length === 0) return;
    const matchedModel = findMatchingSelectableModel(
      visibleImageModels,
      currentModel,
      currentModelRef
    );
    if (!matchedModel) {
      const fallback = visibleImageModels[0];
      setCurrentModel(fallback.id);
      // 避免每次创建新对象引用导致级联重渲染
      const nextRef = getModelRefFromConfig(fallback);
      setCurrentModelRef((prev) => {
        if (
          prev &&
          nextRef &&
          prev.profileId === nextRef.profileId &&
          prev.modelId === nextRef.modelId
        ) {
          return prev;
        }
        return nextRef;
      });
    }
  }, [currentModel, currentModelRef, visibleImageModels]);

  // 受控模型只允许从父组件单向同步，提交期的 route 纠偏不能反写交互状态。
  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    const matchedModel = findMatchingSelectableModel(
      visibleImageModels,
      selectedModel,
      selectedModelRef
    );
    if (!matchedModel) {
      return;
    }

    const nextModelRef = getModelRefFromConfig(matchedModel);
    applyCurrentModelSelection({
      modelId: matchedModel.id,
      modelRef: nextModelRef,
      selectionKey: getSelectionKey(matchedModel.id, nextModelRef),
    });
  }, [
    applyCurrentModelSelection,
    selectedModel,
    selectedModelRef,
    visibleImageModels,
  ]);

  useEffect(() => {
    if (!hasCompatibleParams && Object.keys(mjSelectedParams).length > 0) {
      setMjSelectedParams({});
    }
  }, [hasCompatibleParams, mjSelectedParams]);

  useEffect(() => {
    saveAIImageToolPreferences({
      currentModel,
      currentSelectionKey: getSelectionKey(currentModel, currentModelRef),
      extraParams: mjSelectedParams,
      aspectRatio,
    });
  }, [currentModel, currentModelRef, mjSelectedParams, aspectRatio]);

  // 清除错误状态当组件挂载时（对话框打开时）
  useEffect(() => {
    // 组件挂载时清除之前的错误状态
    setError(null);

    // 清理函数：组件卸载时也清除错误状态
    return () => {
      setError(null);
    };
  }, []); // 空依赖数组，只在组件挂载/卸载时执行

  // 重置所有状态
  const handleReset = () => {
    const resetParams = sanitizeImageToolExtraParams(currentModel, {});
    setPrompt('');
    setMjSelectedParams(resetParams);
    setUploadedImages([]);
    setKnowledgeContextRefs([]);
    setError(null);
    setAspectRatio(getAspectRatioFromParams(resetParams));
    setMobilePanel('config');
    // Clear manual edit mode
    setIsManualEdit(false);
    // 触发Footer组件更新
    window.dispatchEvent(new CustomEvent('ai-image-clear'));
  };

  // 使用useMemo优化性能，当imageHistory、language或promptHistoryVersion变化时重新计算
  const presetPrompts = React.useMemo(
    () => getMergedPresetPrompts('image', language as Language, imageHistory),
    [imageHistory, language, promptHistoryVersion]
  );

  const isPptSlidePromptContext = Boolean(
    pptSlideImage || pptSlidePrompt?.trim()
  );

  // 保存提示词到历史记录（去重）
  const savePromptToHistory = (promptText: string) => {
    if (isPptSlidePromptContext) {
      return;
    }

    const dimensions = {
      width: typeof width === 'string' ? parseInt(width) || 1024 : width,
      height: typeof height === 'string' ? parseInt(height) || 1024 : height,
    };
    savePromptToHistoryUtil('image', promptText, dimensions);
    setPromptHistoryVersion((version) => version + 1);
  };

  // 处理任务编辑（从弹窗内的任务列表点击编辑）
  const handleEditTask = (task: any) => {
    // console.log('Image handleEditTask - task params:', task.params);
    const taskModel = task.params.model || currentModel;
    const taskExtraParams = {
      ...(task.params.params || {}),
      ...(task.params.size !== undefined ? { size: task.params.size } : {}),
      ...(task.params.resolution !== undefined
        ? { resolution: task.params.resolution }
        : {}),
      ...(task.params.quality !== undefined
        ? { quality: task.params.quality }
        : {}),
    };
    const sanitizedTaskParams =
      Object.keys(taskExtraParams).length > 0
        ? sanitizeImageToolExtraParams(taskModel, taskExtraParams)
        : sanitizeImageToolExtraParams(taskModel, {});

    // 标记为手动编辑模式,防止 props 的 useEffect 覆盖我们的更改
    setIsManualEdit(true);
    setMobilePanel('config');

    // 直接更新表单状态
    setPrompt(task.params.prompt || '');
    setMjSelectedParams(sanitizedTaskParams);
    setWidth(task.params.width || 1024);
    setHeight(task.params.height || 1024);

    setUploadedImages(getImageTaskReferenceImages(task));
    setKnowledgeContextRefs(getImageTaskKnowledgeContextRefs(task));

    // 更新模型选择（通过全局设置）
    if (task.params.model) {
      setCurrentModel(task.params.model);
      setCurrentModelRef((task.params.modelRef as ModelRef | null) || null);
      // console.log('Updating image model to:', task.params.model);
      const settings = geminiSettings.get();
      // console.log('Current settings:', settings);
      geminiSettings.update({
        ...settings,
        imageModelName: task.params.model,
      });
      // console.log('Updated settings:', geminiSettings.get());
    }

    setAspectRatio(
      getAspectRatioFromParams(sanitizedTaskParams, task.params.aspectRatio)
    );

    setError(null);
  };

  // 转换图片为可序列化格式
  const convertImagesToSerializable = async () => {
    return Promise.all(
      uploadedImages.map(async (img) => {
        if (img.file) {
          return new Promise<{
            type: 'url';
            url: string;
            name: string;
            maskImage?: string;
          }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                type: 'url',
                url: reader.result as string,
                name: img.name,
                maskImage: img.maskImage,
              });
            };
            reader.onerror = reject;
            reader.readAsDataURL(img.file!);
          });
        } else if (img.url) {
          return {
            type: 'url' as const,
            url: img.url,
            name: img.name,
            maskImage: img.maskImage,
          };
        }
        throw new Error('Invalid image data');
      })
    );
  };

  const handleGenerate = async (count = 1) => {
    const effectiveCount = count;
    // 防止快速双击/重复触发导致多次创建任务
    if (generatingLockRef.current) return;
    generatingLockRef.current = true;
    try {
      if (!prompt || !prompt.trim()) {
        setError(
          language === 'zh'
            ? '请输入图像描述'
            : 'Please enter image description'
        );
        return;
      }

      const activeSelection =
        resolveActiveImageModelSelection(visibleImageModels);
      const submissionSelection = resolveImageSubmissionModelSelection({
        models: visibleImageModels,
        currentModel,
        currentModelRef,
        controlledModel: selectedModel,
        controlledModelRef: selectedModelRef,
        activeSelection,
      });
      if (
        getSelectionKey(currentModel, currentModelRef) !==
        submissionSelection.selectionKey
      ) {
        applyCurrentModelSelection(submissionSelection);
      }

      // 先检查 API Key，没有则弹窗获取（只弹一次，避免批量生成时多次弹窗）
      if (
        !hasInvocationRouteCredentials(
          'image',
          submissionSelection.modelRef || submissionSelection.modelId
        )
      ) {
        const newApiKey = await promptForApiKey();
        if (!newApiKey) {
          setError(
            language === 'zh'
              ? '需要 API Key 才能生成图片'
              : 'API Key is required to generate images'
          );
          return;
        }
      }

      if (isMJModel) {
        setError(null);
      }

      try {
        const finalWidth =
          typeof width === 'string' ? parseInt(width) || 1024 : width;
        const finalHeight =
          typeof height === 'string' ? parseInt(height) || 1024 : height;
        // Convert File objects to base64 data URLs for serialization
        const convertedImages = await convertImagesToSerializable();
        const uploadedImageParams =
          stripMaskFromReferenceImages(convertedImages);

        // 如果数量大于1，使用批量生成
        if (effectiveCount > 1) {
          const batchTaskIds: string[] = [];
          const batchId = `batch_${Date.now()}`;

          const currentImageModel = submissionSelection.modelId;
          const submissionModelRef = submissionSelection.modelRef;

          const finalPrompt = currentImageModel.startsWith('mj')
            ? [prompt.trim(), buildMJPromptSuffix(mjSelectedParams)]
                .filter(Boolean)
                .join(' ')
            : (prompt || '').trim();

          // 非 MJ 模型的额外参数（如 seedream_quality）透传给 adapter
          const extraParams =
            !currentImageModel.startsWith('mj') &&
            Object.keys(mjSelectedParams).length > 0
              ? mjSelectedParams
              : undefined;

          // 如果参数中有 size，优先使用参数中的 size
          const finalSize = extraParams?.size
            ? extraParams.size
            : convertAspectRatioToSize(aspectRatio);
          const maskEditParams = buildMaskEditTaskParams(convertedImages);

          for (let i = 0; i < effectiveCount; i++) {
            const taskParams = {
              prompt: finalPrompt,
              knowledgeContextRefs,
              width: finalWidth,
              height: finalHeight,
              aspectRatio,
              size: finalSize,
              model: currentImageModel,
              modelRef: submissionModelRef,
              uploadedImages: uploadedImageParams,
              batchId,
              batchIndex: i + 1,
              batchTotal: effectiveCount,
              assetMetadata,
              autoInsertToCanvas:
                initialAutoInsertToCanvas ??
                getAutoInsertValue(LS_KEYS.AI_IMAGE_AUTO_INSERT),
              targetFrameId,
              targetFrameDimensions,
              pptSlideImage,
              pptSlidePrompt,
              pptReplaceElementId,
              replaceElementId,
              targetElementId,
              anchorId,
              sourceTaskId,
              sourcePrompt,
              promptMeta,
              ...maskEditParams,
              ...(extraParams ? { params: extraParams } : {}),
            };

            const task = createTask(taskParams, TaskType.IMAGE);
            if (task) {
              batchTaskIds.push(task.id);
            }
          }

          if (batchTaskIds.length > 0) {
            MessagePlugin.success(
              language === 'zh'
                ? `已添加 ${batchTaskIds.length} 个任务到队列`
                : `Added ${batchTaskIds.length} tasks to queue`
            );

            savePromptToHistory(finalPrompt);
            setError(null);
            setMobilePanel('tasks');
            // Clear manual edit mode after batch generating
            setIsManualEdit(false);
          } else {
            setError(
              language === 'zh'
                ? '批量任务创建失败，请稍后重试'
                : 'Failed to create batch tasks, please try again later'
            );
          }
          return;
        }

        // 单个任务生成

        // Get current image model from settings
        const currentImageModel = submissionSelection.modelId;
        const submissionModelRef = submissionSelection.modelRef;

        const finalPrompt = currentImageModel.startsWith('mj')
          ? [prompt.trim(), buildMJPromptSuffix(mjSelectedParams)]
              .filter(Boolean)
              .join(' ')
          : (prompt || '').trim();

        // 非 MJ 模型的额外参数（如 seedream_quality）透传给 adapter
        const extraParams =
          !currentImageModel.startsWith('mj') &&
          Object.keys(mjSelectedParams).length > 0
            ? mjSelectedParams
            : undefined;

        // 如果参数中有 size，优先使用参数中的 size
        const finalSize = extraParams?.size
          ? extraParams.size
          : convertAspectRatioToSize(aspectRatio);
        const maskEditParams = buildMaskEditTaskParams(convertedImages);

        // 创建任务参数（单个任务也需要 batchId 以跳过 SW 重复检测）
        const taskParams = {
          prompt: finalPrompt,
          knowledgeContextRefs,
          width: finalWidth,
          height: finalHeight,
          aspectRatio,
          size: finalSize,
          model: currentImageModel,
          modelRef: submissionModelRef,
          // 保存上传的图片（已转换为可序列化的格式）
          uploadedImages: uploadedImageParams,
          autoInsertToCanvas:
            initialAutoInsertToCanvas ??
            getAutoInsertValue(LS_KEYS.AI_IMAGE_AUTO_INSERT),
          // 始终包含 batchId 以跳过重复检测
          batchId: externalBatchId || `image_single_${Date.now()}`,
          batchIndex: 1,
          batchTotal: 1,
          assetMetadata,
          targetFrameId,
          targetFrameDimensions,
          pptSlideImage,
          pptSlidePrompt,
          pptReplaceElementId,
          replaceElementId,
          targetElementId,
          anchorId,
          sourceTaskId,
          sourcePrompt,
          promptMeta,
          ...maskEditParams,
          ...(extraParams ? { params: extraParams } : {}),
        };

        // 创建任务并添加到队列
        const task = createTask(taskParams, TaskType.IMAGE);

        if (task) {
          // 任务创建成功
          MessagePlugin.success(
            language === 'zh'
              ? '任务已添加到队列，将在后台生成'
              : 'Task added to queue, will be generated in background'
          );

          // 保存提示词到历史记录
          savePromptToHistory(finalPrompt);

          // 只清除预览和错误，保留表单数据（prompt和参考图）
          setError(null);
          setMobilePanel('tasks');
          // Clear manual edit mode after generating
          setIsManualEdit(false);
        } else {
          // 任务创建失败（可能是重复提交）
          setError(
            language === 'zh'
              ? '任务创建失败，请检查参数或稍后重试'
              : 'Failed to create task, please check parameters or try again later'
          );
        }
      } catch (err: any) {
        console.error('Failed to create task:', err);

        // 提取更友好的错误信息
        let errorMessage =
          language === 'zh'
            ? '任务创建失败，请检查参数或稍后重试'
            : 'Failed to create task, please check parameters or try again later';

        if (err.message) {
          if (err.message.includes('exceed 5000 characters')) {
            errorMessage =
              language === 'zh'
                ? '提示词不能超过 5000 字符'
                : 'Prompt must not exceed 5000 characters';
          } else if (err.message.includes('Duplicate submission')) {
            errorMessage =
              language === 'zh'
                ? '请勿重复提交，请等待 5 秒后再试'
                : 'Duplicate submission. Please wait 5 seconds.';
          } else if (err.message.includes('Invalid parameters')) {
            errorMessage =
              language === 'zh'
                ? `参数错误: ${err.message.replace('Invalid parameters: ', '')}`
                : err.message;
          }
        }

        setError(errorMessage);
      }
    } finally {
      generatingLockRef.current = false;
    }
  };

  useKeyboardShortcuts(isGenerating, prompt, () => handleGenerate(1));

  return (
    <div className="ai-image-generation-container">
      {isCompactLayout ? (
        <div className="ai-generation-mobile-switcher" role="tablist">
          <button
            type="button"
            className={`ai-generation-mobile-switcher__tab ${
              mobilePanel === 'config'
                ? 'ai-generation-mobile-switcher__tab--active'
                : ''
            }`}
            onClick={() => setMobilePanel('config')}
          >
            生成设置
          </button>
          <button
            type="button"
            className={`ai-generation-mobile-switcher__tab ${
              mobilePanel === 'tasks'
                ? 'ai-generation-mobile-switcher__tab--active'
                : ''
            }`}
            onClick={() => setMobilePanel('tasks')}
          >
            生成任务
          </button>
        </div>
      ) : null}

      <div
        className={`main-content ${
          isCompactLayout ? 'main-content--mobile-panels' : ''
        }`}
        ref={containerRef}
      >
        {/* AI 图片生成表单 */}
        <div
          className={`ai-image-generation-section ${
            isCompactLayout && mobilePanel !== 'config'
              ? 'ai-generation-mobile-panel--hidden'
              : ''
          }`}
        >
          <div className="ai-image-generation-form">
            {/* 模型选择器 */}
            {selectedModel !== undefined && onModelChange && (
              <div className="form-header-row">
                <div className="model-selector-wrapper">
                  <ModelDropdown
                    selectedModel={currentModel}
                    selectedSelectionKey={getSelectionKey(
                      currentModel,
                      currentModelRef
                    )}
                    onSelect={(value, modelRef) => {
                      setCurrentModel(value);
                      setCurrentModelRef(modelRef || null);
                      onModelChange(value);
                      onModelRefChange?.(modelRef || null);
                    }}
                    language={language}
                    models={visibleImageModels}
                    placement="down"
                    variant="form"
                    disabled={isGenerating}
                  />
                </div>
              </div>
            )}

            {/* 模型参数：与底部 AI 输入框保持同一套 size / resolution / quality 逻辑 */}
            {hasCompatibleParams && (
              <div className="model-params-row">
                <ParametersDropdown
                  selectedParams={mjSelectedParams}
                  onParamChange={handleMJParamChange}
                  modelId={currentModel}
                  language={language}
                  disabled={isGenerating}
                  placement="down"
                />
              </div>
            )}

            {/* 参考图片区域 */}
            <ReferenceImageUpload
              images={uploadedImages}
              onImagesChange={setUploadedImages}
              language={language}
              disabled={isGenerating}
              multiple={true}
              label={
                language === 'zh'
                  ? '参考图片 (可选)'
                  : 'Reference Images (Optional)'
              }
              onError={setError}
              pasteScopeRef={promptPasteScopeRef}
            />

            <PromptInput
              prompt={prompt}
              onPromptChange={setPrompt}
              presetPrompts={presetPrompts}
              language={language}
              type="image"
              disabled={isGenerating}
              onError={setError}
              rootRef={promptPasteScopeRef}
            />

            <KnowledgeNoteContextSelector
              value={knowledgeContextRefs}
              onChange={setKnowledgeContextRefs}
              disabled={isGenerating}
              language={language}
            />

            <ErrorDisplay error={error} />
          </div>

          <ActionButtons
            language={language}
            type="image"
            isGenerating={isGenerating}
            hasGenerated={false}
            canGenerate={!!(prompt && prompt.trim())}
            onGenerate={handleGenerate}
            onReset={handleReset}
            leftContent={
              <AutoInsertCheckbox
                storageKey={LS_KEYS.AI_IMAGE_AUTO_INSERT}
                language={language}
              />
            }
          />
        </div>

        {!isCompactLayout ? (
          <ResizableDivider
            isRightPanelVisible={isTaskListVisible}
            onToggleRightPanel={handleToggleTaskList}
            onWidthChange={handleWidthChange}
            rightPanelWidth={taskListWidth}
            language={language}
            storageKey="image"
          />
        ) : null}

        {/* 任务列表侧栏 */}
        {(isCompactLayout || isTaskListVisible) && (
          <div
            className={`task-sidebar ${
              isCompactLayout ? 'task-sidebar--mobile-panel' : ''
            } ${
              isCompactLayout && mobilePanel !== 'tasks'
                ? 'ai-generation-mobile-panel--hidden'
                : ''
            }`}
            style={
              isCompactLayout
                ? undefined
                : { width: taskListWidth, flexShrink: 0 }
            }
          >
            <DialogTaskList
              taskType={TaskType.IMAGE}
              onEditTask={handleEditTask}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default AIImageGeneration;
