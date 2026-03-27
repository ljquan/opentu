import React, { useState, useEffect, useCallback, useRef } from 'react';
import './ttd-dialog.scss';
import './ai-video-generation.scss';
import { useI18n } from '../../i18n';
import { type Language } from '../../constants/prompts';
import { useDeviceType } from '../../hooks/useDeviceType';
import { useGenerationHistory } from '../../hooks/useGenerationHistory';
import {
  useGenerationState,
  useKeyboardShortcuts,
  ActionButtons,
  ErrorDisplay,
  PromptInput,
  type ImageFile,
  getMergedPresetPrompts,
  savePromptToHistory as savePromptToHistoryUtil,
  VideoModelOptions,
  ReferenceImageUpload,
  type ReferenceImage,
  StoryboardEditor,
  ResizableDivider,
  loadSavedWidth,
  AutoInsertCheckbox,
  getAutoInsertValue,
} from './shared';
import {
  geminiSettings,
  resolveInvocationRoute,
  createModelRef,
  type ModelRef,
} from '../../utils/settings-manager';
import { useTaskQueue } from '../../hooks/useTaskQueue';
import { TaskType } from '../../types/task.types';
import { MessagePlugin } from 'tdesign-react';
import { DialogTaskList } from '../task-queue/DialogTaskList';
import { LS_KEYS } from '../../constants/storage-keys';
import type {
  VideoModel,
  UploadedVideoImage,
  StoryboardScene,
} from '../../types/video.types';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { ParametersDropdown } from '../ai-input-bar/ParametersDropdown';
import { type ModelConfig } from '../../constants/model-config';
import {
  supportsStoryboardMode,
  getStoryboardModeConfig,
  normalizeVideoModel,
} from '../../constants/video-model-config';
import {
  getDefaultVideoExtraParams,
  getEffectiveVideoCompatibleParams,
  getEffectiveVideoDefaultParams,
  getEffectiveVideoModelConfigForSelection,
} from '../../services/video-binding-utils';
import {
  formatStoryboardPrompt,
  parseStoryboardPrompt,
  isStoryboardPrompt,
  validateSceneDurations,
} from '../../utils/storyboard-utils';
import {
  loadAIVideoToolPreferences,
  saveAIVideoToolPreferences,
} from '../../services/ai-generation-preferences-service';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
} from '../../utils/model-selection';

interface AIVideoGenerationProps {
  initialPrompt?: string;
  initialImage?: ImageFile; // 保留单图片支持（向后兼容）
  initialImages?: UploadedVideoImage[]; // 新增：支持多图片
  initialDuration?: number;
  initialModel?: VideoModel; // 新增：模型选择
  initialSize?: string; // 新增：尺寸选择
  initialResultUrl?: string;
  selectedModel?: string;
  selectedModelRef?: ModelRef | null;
  onModelChange?: (value: string) => void;
  onModelRefChange?: (value: ModelRef | null) => void;
}

const AIVideoGeneration = ({
  initialPrompt = '',
  initialImage,
  initialImages,
  initialDuration,
  initialModel,
  initialSize,
  initialResultUrl,
  selectedModel,
  selectedModelRef,
  onModelChange,
  onModelRefChange,
}: AIVideoGenerationProps = {}) => {
  const initialRoute = resolveInvocationRoute('video');
  const persistedPreferencesRef = useRef<
    ReturnType<typeof loadAIVideoToolPreferences> | null
  >(null);
  if (!persistedPreferencesRef.current) {
    const fallbackModel = normalizeVideoModel(
      initialModel || selectedModel || initialRoute.modelId || 'veo3'
    );
    persistedPreferencesRef.current = loadAIVideoToolPreferences(fallbackModel);
  }
  const persistedPreferences = persistedPreferencesRef.current;
  const videoModels = useSelectableModels('video');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [error, setError] = useState<string | null>(null);

  // 任务列表面板状态 - 使用像素宽度
  const [isTaskListVisible, setIsTaskListVisible] = useState(true);
  const [taskListWidth, setTaskListWidth] = useState(() =>
    loadSavedWidth('video')
  );
  const [mobilePanel, setMobilePanel] = useState<'config' | 'tasks'>('config');
  const containerRef = useRef<HTMLDivElement>(null);
  const { viewportWidth } = useDeviceType();
  const isCompactLayout = viewportWidth <= 768;

  // Video model parameters - use state to support dynamic updates
  const initialPreferredModelId =
    initialModel ||
    selectedModel ||
    persistedPreferences.currentModel ||
    initialRoute.modelId;
  const initialPreferredModelRef =
    selectedModel && selectedModel !== initialRoute.modelId
      ? selectedModelRef || null
      : persistedPreferences.currentModel &&
        persistedPreferences.currentModel !== initialRoute.modelId
      ? null
      : createModelRef(initialRoute.profileId, initialRoute.modelId);
  const initialMatchedModel =
    findMatchingSelectableModel(
      videoModels,
      initialPreferredModelId,
      initialPreferredModelRef
    ) ||
    getPinnedSelectableModel(
      'video',
      initialPreferredModelId,
      initialPreferredModelRef
    );
  const [currentModel, setCurrentModel] = useState<VideoModel>(
    (initialMatchedModel?.id as VideoModel) ||
      videoModels[0]?.id ||
      normalizeVideoModel('veo3')
  );
  const [currentModelRef, setCurrentModelRef] = useState<ModelRef | null>(
    getModelRefFromConfig(initialMatchedModel) || initialPreferredModelRef
  );
  const visibleVideoModels = React.useMemo(() => {
    const currentMatch = findMatchingSelectableModel(
      videoModels,
      currentModel,
      currentModelRef
    );
    if (currentMatch || !currentModel) {
      return videoModels;
    }

    const pinnedModel = getPinnedSelectableModel(
      'video',
      currentModel,
      currentModelRef
    );
    return pinnedModel ? [pinnedModel, ...videoModels] : videoModels;
  }, [currentModel, currentModelRef, videoModels]);

  // Use useMemo to ensure modelConfig and defaultParams update when currentModel changes
  // 额外参数（如 aspect_ratio）
  const [videoSelectedParams, setVideoSelectedParams] = useState<
    Record<string, string>
  >(
    () =>
      persistedPreferences.extraParams ||
      getDefaultVideoExtraParams(currentModel, currentModelRef || currentModel)
  );
  const compatibleVideoParams = React.useMemo(
    () =>
      getEffectiveVideoCompatibleParams(
        currentModel,
        currentModelRef || currentModel,
        videoSelectedParams
      ),
    [currentModel, currentModelRef, videoSelectedParams]
  );
  const modelConfig = React.useMemo(
    () =>
      getEffectiveVideoModelConfigForSelection(
        currentModel,
        currentModelRef || currentModel,
        videoSelectedParams
      ),
    [currentModel, currentModelRef, videoSelectedParams]
  );
  const defaultParams = React.useMemo(
    () =>
      getEffectiveVideoDefaultParams(
        currentModel,
        currentModelRef || currentModel,
        videoSelectedParams
      ),
    [currentModel, currentModelRef, videoSelectedParams]
  );

  // Duration and size state
  const [duration, setDuration] = useState(
    initialDuration?.toString() || persistedPreferences.duration || defaultParams.duration
  );
  const [size, setSize] = useState(
    initialSize || persistedPreferences.size || defaultParams.size
  );
  const hasCompatibleParams = React.useMemo(() => {
    // 排除 size 和 duration（已有专用 UI），只看是否有额外参数
    return compatibleVideoParams.some(
      (p) => p.id !== 'size' && p.id !== 'duration'
    );
  }, [compatibleVideoParams]);
  const handleVideoParamChange = useCallback(
    (paramId: string, value: string) => {
      if (!value || value === 'default') {
        setVideoSelectedParams((prev) => {
          const next = { ...prev };
          delete next[paramId];
          return next;
        });
        return;
      }
      setVideoSelectedParams((prev) => ({
        ...prev,
        [paramId]: value,
      }));
    },
    []
  );

  // 保存所有原始选中的图片（不受模型切换影响）
  const [allSelectedImages, setAllSelectedImages] = useState<
    UploadedVideoImage[]
  >(() => {
    if (initialImages && initialImages.length > 0) {
      return initialImages;
    }
    if (initialImage) {
      return [
        {
          slot: 0,
          slotLabel: '参考图',
          url: initialImage.url || '',
          name: initialImage.name,
          file: initialImage.file,
        },
      ];
    }
    return [];
  });

  // 当前显示的图片（根据模型 maxCount 过滤）
  const [uploadedImages, setUploadedImages] = useState<UploadedVideoImage[]>(
    () => {
      const maxCount = modelConfig.imageUpload.maxCount;
      const labels = modelConfig.imageUpload.labels || [];

      // 从 allSelectedImages 初始值中截取
      let sourceImages: UploadedVideoImage[] = [];
      if (initialImages && initialImages.length > 0) {
        sourceImages = initialImages;
      } else if (initialImage) {
        sourceImages = [
          {
            slot: 0,
            slotLabel: labels[0] || '参考图',
            url: initialImage.url || '',
            name: initialImage.name,
            file: initialImage.file,
          },
        ];
      }

      // 按 maxCount 截取并更新 slot 和 label
      return sourceImages.slice(0, maxCount).map((img, index) => ({
        ...img,
        slot: index,
        slotLabel: labels[index] || `参考图${index + 1}`,
      }));
    }
  );

  // Storyboard mode state
  const [storyboardEnabled, setStoryboardEnabled] = useState(false);
  const [storyboardScenes, setStoryboardScenes] = useState<StoryboardScene[]>(
    []
  );
  const storyboardConfig = React.useMemo(
    () => getStoryboardModeConfig(currentModel),
    [currentModel]
  );
  const modelSupportsStoryboard = supportsStoryboardMode(currentModel);

  // Use generation history from task queue
  const { videoHistory } = useGenerationHistory();

  // 用于触发 presetPrompts 重新计算的计数器
  const [promptHistoryVersion, setPromptHistoryVersion] = useState(0);

  const { isGenerating } = useGenerationState('video');

  // 处理宽度变化
  const handleWidthChange = useCallback((width: number) => {
    setTaskListWidth(width);
  }, []);

  // 切换任务列表显示/隐藏
  const handleToggleTaskList = useCallback(() => {
    setIsTaskListVisible((prev) => !prev);
  }, []);

  const { language } = useI18n();
  const { createTask } = useTaskQueue();

  // Sync model from global settings changes (from header dropdown)
  useEffect(() => {
    const handleSettingsChange = (newSettings: any) => {
      const newModel = newSettings.videoModelName || 'veo3';
      if (newModel !== currentModel) {
        setCurrentModel(newModel);
        const matchedModel = findMatchingSelectableModel(
          visibleVideoModels,
          newModel,
          currentModelRef
        );
        setCurrentModelRef(getModelRefFromConfig(matchedModel) || null);
        setVideoSelectedParams(
          getDefaultVideoExtraParams(
            newModel,
            getModelRefFromConfig(matchedModel) || newModel
          )
        );
      }
    };
    geminiSettings.addListener(handleSettingsChange);
    return () => geminiSettings.removeListener(handleSettingsChange);
  }, [currentModel, currentModelRef, visibleVideoModels]);

  useEffect(() => {
    if (visibleVideoModels.length === 0) return;
    const matchedModel = findMatchingSelectableModel(
      visibleVideoModels,
      currentModel,
      currentModelRef
    );
    if (!matchedModel) {
      setCurrentModel(visibleVideoModels[0].id);
      setCurrentModelRef(getModelRefFromConfig(visibleVideoModels[0]));
    }
  }, [currentModel, currentModelRef, visibleVideoModels]);

  // Sync model from selectedModel prop (from parent component)
  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    const currentSelectionKey = getSelectionKey(currentModel, currentModelRef);
    const nextSelectionKey = getSelectionKey(selectedModel, selectedModelRef);

    if (currentSelectionKey !== nextSelectionKey) {
      setCurrentModel(selectedModel);
      const matchedModel = findMatchingSelectableModel(
        visibleVideoModels,
        selectedModel,
        selectedModelRef
      );
      setCurrentModelRef(
        getModelRefFromConfig(matchedModel) || selectedModelRef || null
      );
    }
  }, [
    currentModel,
    currentModelRef,
    selectedModel,
    selectedModelRef,
    visibleVideoModels,
  ]);

  // Track if we're in manual edit mode (from handleEditTask) to prevent props from overwriting
  const [isManualEdit, setIsManualEdit] = useState(false);

  // Reset parameters when model changes (智能过滤图片而不是清空)
  const [isEditMode, setIsEditMode] = useState(false);
  useEffect(() => {
    if (isEditMode) {
      // In edit mode, don't reset parameters automatically
      setIsEditMode(false);
      return;
    }

    const maxCount = modelConfig.imageUpload.maxCount;
    const labels = modelConfig.imageUpload.labels || [];

    // console.log('AIVideoGeneration - model changed, updating params:', {
    //   model: currentModel,
    //   duration: defaultParams.duration,
    //   size: defaultParams.size,
    //   maxCount,
    //   allSelectedImagesCount: allSelectedImages.length
    // });

    setDuration(defaultParams.duration);
    setSize(defaultParams.size);

    // 智能过滤图片：从原始选中的图片中截取前 N 张
    if (allSelectedImages.length > 0) {
      const filteredImages = allSelectedImages
        .slice(0, maxCount)
        .map((img, index) => ({
          ...img,
          slot: index,
          slotLabel: labels[index] || `参考图${index + 1}`,
        }));
      setUploadedImages(filteredImages);

      // 如果有图片被截断，输出提示日志
      // if (allSelectedImages.length > maxCount) {
      //   console.log(`AIVideoGeneration - 当前模型最多支持 ${maxCount} 张图片，已保留前 ${maxCount} 张`);
      // }
    } else {
      setUploadedImages([]);
    }

    // Disable storyboard mode if new model doesn't support it
    if (!supportsStoryboardMode(currentModel)) {
      setStoryboardEnabled(false);
      setStoryboardScenes([]);
    }
    // 仅在模型或默认参数变化时重置，避免上传图片触发重置
  }, [currentModel, defaultParams, isEditMode, modelConfig.imageUpload]);

  // Handle initial props - use ref to track if we've processed these props before
  const processedPropsRef = React.useRef<string>('');
  useEffect(() => {
    // Skip if we're in manual edit mode (user clicked edit in task list)
    if (isManualEdit) {
      // console.log('AIVideoGeneration - skipping props update in manual edit mode');
      return;
    }

    // Create a unique key from all initial props to detect real changes
    const propsKey = JSON.stringify({
      prompt: initialPrompt,
      image: initialImage?.url,
      images: initialImages?.map((img) => img.url),
      duration: initialDuration,
      model: initialModel,
      size: initialSize,
      result: initialResultUrl,
    });

    // Skip if we've already processed these exact props
    if (processedPropsRef.current === propsKey) {
      // console.log('AIVideoGeneration - skipping duplicate props processing');
      return;
    }

    // console.log('AIVideoGeneration - processing new props:', { propsKey });
    processedPropsRef.current = propsKey;

    setPrompt(initialPrompt);

    // 处理图片：保存所有原始图片，并按当前模型过滤显示
    const maxCount = modelConfig.imageUpload.maxCount;
    const labels = modelConfig.imageUpload.labels || [];

    let newAllImages: UploadedVideoImage[] = [];
    if (initialImages && initialImages.length > 0) {
      newAllImages = initialImages;
    } else if (initialImage) {
      newAllImages = [
        {
          slot: 0,
          slotLabel: '参考图',
          url: initialImage.url || '',
          name: initialImage.name,
          file: initialImage.file,
        },
      ];
    }

    // 更新原始图片列表
    setAllSelectedImages(newAllImages);

    // 按当前模型 maxCount 过滤显示
    const filteredImages = newAllImages
      .slice(0, maxCount)
      .map((img, index) => ({
        ...img,
        slot: index,
        slotLabel: labels[index] || `参考图${index + 1}`,
      }));
    setUploadedImages(filteredImages);

    // 更新 duration 和 size（如果有初始值）
    if (initialDuration !== undefined) {
      setDuration(initialDuration.toString());
    }
    if (initialSize) {
      setSize(initialSize);
    }

    setError(null);
  }, [
    initialPrompt,
    initialImage,
    initialImages,
    initialDuration,
    initialSize,
    initialResultUrl,
    modelConfig.imageUpload,
    isManualEdit,
  ]);

  // Clear errors on mount
  useEffect(() => {
    setError(null);
    return () => {
      setError(null);
    };
  }, []);

  useEffect(() => {
    saveAIVideoToolPreferences({
      currentModel,
      extraParams: videoSelectedParams,
      duration,
      size,
    });
  }, [currentModel, videoSelectedParams, duration, size]);

  const handleReset = () => {
    setPrompt('');
    setAllSelectedImages([]); // 清空原始图片
    setUploadedImages([]);
    setError(null);
    setMobilePanel('config');
    // Reset duration and size to defaults
    setDuration(defaultParams.duration);
    setSize(defaultParams.size);
    // Clear manual edit mode
    setIsManualEdit(false);
    // Clear storyboard mode
    setStoryboardEnabled(false);
    setStoryboardScenes([]);
    // Clear extra params
    setVideoSelectedParams(
      getDefaultVideoExtraParams(currentModel, currentModelRef || currentModel)
    );
    window.dispatchEvent(new CustomEvent('ai-video-clear'));
  };

  // Convert ReferenceImage[] to UploadedVideoImage[]
  const referenceImagesToUploadedImages = React.useCallback(
    (refImages: ReferenceImage[], labels: string[]): UploadedVideoImage[] => {
      return refImages.map((img, index) => ({
        slot: index,
        slotLabel: labels[index] || `参考图${index + 1}`,
        url: img.url,
        name: img.name,
        file: img.file,
      }));
    },
    []
  );

  // Convert UploadedVideoImage[] to ReferenceImage[]
  const uploadedImagesToReferenceImages = React.useCallback(
    (uploadedImgs: UploadedVideoImage[]): ReferenceImage[] => {
      return uploadedImgs.map((img) => ({
        url: img.url,
        name: img.name,
        file: img.file,
      }));
    },
    []
  );

  // 处理图片变化（用户手动上传/删除时同步更新原始图片列表）
  const handleImagesChange = React.useCallback(
    (newImages: ReferenceImage[]) => {
      const labels = modelConfig.imageUpload.labels || [];
      const convertedImages = referenceImagesToUploadedImages(
        newImages,
        labels
      );
      setUploadedImages(convertedImages);
      // 同步更新原始图片列表（用户手动操作后，原始列表以当前显示的为准）
      setAllSelectedImages(convertedImages);
    },
    [modelConfig.imageUpload.labels, referenceImagesToUploadedImages]
  );

  // 使用useMemo优化性能，当videoHistory、language或promptHistoryVersion变化时重新计算
  const presetPrompts = React.useMemo(
    () => getMergedPresetPrompts('video', language as Language, videoHistory),
    [videoHistory, language, promptHistoryVersion]
  );

  // 保存提示词到历史记录（去重）
  const savePromptToHistory = (promptText: string) => {
    savePromptToHistoryUtil('video', promptText, { width: 1280, height: 720 });
    // 触发 presetPrompts 重新计算
    setPromptHistoryVersion((v) => v + 1);
  };

  // 处理任务编辑（从弹窗内的任务列表点击编辑）
  const handleEditTask = (task: any) => {
    // console.log('Video handleEditTask - task params:', task.params);

    // 标记为手动编辑模式,防止 props 的 useEffect 覆盖我们的更改
    setIsManualEdit(true);
    setMobilePanel('config');

    // 标记为编辑模式,防止模型变化时重置参数
    setIsEditMode(true);

    // 更新模型选择（通过本地 state 和全局设置）- 先设置模型
    if (task.params.model) {
      // console.log('Updating model to:', task.params.model);
      setCurrentModel(task.params.model);
      setCurrentModelRef((task.params.modelRef as ModelRef | null) || null);
      const settings = geminiSettings.get();
      geminiSettings.update({
        ...settings,
        videoModelName: task.params.model,
      });
    }

    // 检查是否有故事场景配置
    if (task.params.storyboard?.enabled && task.params.storyboard?.scenes) {
      // console.log('Restoring storyboard mode:', task.params.storyboard);
      setStoryboardEnabled(true);
      setStoryboardScenes(task.params.storyboard.scenes);
      setPrompt(''); // 故事场景模式下清空普通提示词
    } else {
      // 尝试从提示词解析故事场景格式
      const prompt = task.params.prompt || '';
      const parsedScenes = parseStoryboardPrompt(prompt);
      if (parsedScenes && parsedScenes.length > 0) {
        // console.log('Parsed storyboard from prompt:', parsedScenes);
        setStoryboardEnabled(true);
        setStoryboardScenes(parsedScenes);
        setPrompt('');
      } else {
        // 普通模式
        setStoryboardEnabled(false);
        setStoryboardScenes([]);
        setPrompt(prompt);
      }
    }

    // 更新视频参数
    if (task.params.seconds !== undefined) {
      const durationValue =
        typeof task.params.seconds === 'string'
          ? task.params.seconds
          : task.params.seconds.toString();
      // console.log('Setting duration to:', durationValue);
      setDuration(durationValue);
    }

    const restoredParams =
      task.params.params && typeof task.params.params === 'object'
        ? Object.entries(task.params.params as Record<string, unknown>).reduce<
            Record<string, string>
          >((acc, [key, value]) => {
            if (value !== undefined && value !== null && String(value).trim()) {
              acc[key] = String(value);
            }
            return acc;
          }, {})
        : {};
    setVideoSelectedParams(restoredParams);

    if (task.params.size) {
      // console.log('Setting size to:', task.params.size);
      setSize(task.params.size);
    }

    // 更新上传的图片 - 保存原始图片并按模型过滤
    if (task.params.uploadedImages && task.params.uploadedImages.length > 0) {
      // console.log('Setting uploadedImages:', task.params.uploadedImages);
      // 保存原始图片
      setAllSelectedImages(task.params.uploadedImages);
      // 按当前模型过滤显示（这里使用任务中的模型配置）
      const taskModel = task.params.model || currentModel;
      const taskModelConfig = getEffectiveVideoModelConfigForSelection(
        taskModel,
        (task.params.modelRef as ModelRef | null) || taskModel,
        restoredParams
      );
      const maxCount = taskModelConfig.imageUpload.maxCount;
      const labels = taskModelConfig.imageUpload.labels || [];

      const filteredImages = task.params.uploadedImages
        .slice(0, maxCount)
        .map((img: UploadedVideoImage, index: number) => ({
          ...img,
          slot: index,
          slotLabel: labels[index] || `参考图${index + 1}`,
        }));
      setUploadedImages(filteredImages);
    } else {
      setAllSelectedImages([]);
      setUploadedImages([]);
    }

    setError(null);
  };

  const handleGenerate = async (count = 1) => {
    // 验证输入
    if (storyboardEnabled) {
      // 故事场景模式验证
      const validation = validateSceneDurations(
        storyboardScenes,
        parseFloat(duration),
        storyboardConfig.minSceneDuration
      );
      if (!validation.valid) {
        setError(validation.error || '场景配置无效');
        return;
      }
    } else {
      // 普通模式验证
      if (!prompt || !prompt.trim()) {
        setError(
          language === 'zh'
            ? '请输入视频描述'
            : 'Please enter video description'
        );
        return;
      }
    }

    try {
      // Convert uploaded images to serializable format
      const convertedImages: UploadedVideoImage[] = [];
      for (const img of uploadedImages) {
        if (img.file) {
          // Convert File to base64 data URL
          const base64Url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(img.file!);
          });
          convertedImages.push({
            ...img,
            url: base64Url,
            file: undefined, // Remove File object for serialization
          });
        } else {
          convertedImages.push({
            ...img,
            file: undefined,
          });
        }
      }

      // 构建最终提示词
      const finalPrompt = storyboardEnabled
        ? formatStoryboardPrompt(storyboardScenes)
        : (prompt || '').trim();

      // 批量生成逻辑
      const batchTaskIds: string[] = [];
      // 始终生成 batchId，即使 count=1，这样可以跳过 SW 的重复检测
      const batchId = `video_batch_${Date.now()}`;

      for (let i = 0; i < count; i++) {
        // 额外参数（如 aspect_ratio）透传给 adapter
        const extraParams =
          Object.keys(videoSelectedParams).length > 0
            ? videoSelectedParams
            : undefined;

        // 创建任务参数（包含新的 duration, size, uploadedImages）
        const taskParams = {
          prompt: finalPrompt,
          model: currentModel,
          modelRef: currentModelRef || null,
          seconds: duration,
          size: size,
          // 保存上传的图片（已转换为可序列化的格式）
          uploadedImages: convertedImages,
          // 故事场景配置（用于编辑恢复）
          ...(storyboardEnabled && {
            storyboard: {
              enabled: true,
              scenes: storyboardScenes,
              totalDuration: parseFloat(duration),
            },
          }),
          // 批量生成信息（始终包含 batchId 以跳过重复检测）
          batchId,
          batchIndex: i + 1,
          batchTotal: count,
          autoInsertToCanvas: getAutoInsertValue(LS_KEYS.AI_VIDEO_AUTO_INSERT),
          ...(extraParams ? { params: extraParams } : {}),
        };

        // 创建任务并添加到队列
        const task = createTask(taskParams, TaskType.VIDEO);

        if (task) {
          batchTaskIds.push(task.id);
        }
      }

      if (batchTaskIds.length > 0) {
        // 任务创建成功
        MessagePlugin.success(
          language === 'zh'
            ? count > 1
              ? `${batchTaskIds.length} 个视频任务已添加到队列，将在后台生成`
              : '视频任务已添加到队列，将在后台生成'
            : count > 1
            ? `${batchTaskIds.length} video tasks added to queue, will be generated in background`
            : 'Video task added to queue, will be generated in background'
        );

        // 保存提示词到历史记录
        savePromptToHistory(finalPrompt);

        // 清空表单（保留模型选择和尺寸设置）
        setPrompt('');
        setAllSelectedImages([]); // 清空原始图片
        setUploadedImages([]);
        setStoryboardEnabled(false);
        setStoryboardScenes([]);
        setError(null);
        setMobilePanel('tasks');
        // Clear manual edit mode after generating
        setIsManualEdit(false);
      } else {
        // 任务创建失败
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
  };

  useKeyboardShortcuts(isGenerating, prompt, handleGenerate);

  return (
    <div className="ai-video-generation-container">
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
        {/* AI 视频生成表单 */}
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
                    onSelect={(value) => {
                      const nextModel = value as VideoModel;
                      setCurrentModel(nextModel);
                      setCurrentModelRef(null);
                      setVideoSelectedParams(
                        getDefaultVideoExtraParams(nextModel, nextModel)
                      );
                      onModelChange(value);
                      onModelRefChange?.(null);
                    }}
                    onSelectModel={(model: ModelConfig) => {
                      const nextModel = model.id as VideoModel;
                      setCurrentModel(nextModel);
                      const nextModelRef = getModelRefFromConfig(model);
                      setCurrentModelRef(nextModelRef);
                      setVideoSelectedParams(
                        getDefaultVideoExtraParams(
                          nextModel,
                          nextModelRef || nextModel
                        )
                      );
                      onModelChange(model.id);
                      onModelRefChange?.(nextModelRef);
                    }}
                    language={language}
                    models={visibleVideoModels}
                    placement="down"
                    variant="form"
                    placeholder={
                      language === 'zh' ? '选择视频模型' : 'Select Video Model'
                    }
                    disabled={isGenerating}
                  />
                </div>
              </div>
            )}

            {/* 模型额外参数（排除 size 和 duration，已有 VideoModelOptions） */}
            {hasCompatibleParams && (
              <div className="model-params-row">
                <ParametersDropdown
                  selectedParams={videoSelectedParams}
                  onParamChange={handleVideoParamChange}
                  compatibleParams={compatibleVideoParams}
                  modelId={currentModel}
                  language={language}
                  disabled={isGenerating}
                  excludeParamIds={['size', 'duration']}
                />
              </div>
            )}

            {/* Video model options: duration & size */}
            <VideoModelOptions
              model={currentModel}
              configOverride={modelConfig}
              duration={duration}
              size={size}
              onDurationChange={setDuration}
              onSizeChange={setSize}
              disabled={isGenerating}
            />

            {/* Multi-image upload based on model config */}
            <ReferenceImageUpload
              images={uploadedImagesToReferenceImages(uploadedImages)}
              onImagesChange={handleImagesChange}
              language={language}
              disabled={isGenerating}
              multiple={modelConfig.imageUpload.maxCount > 1}
              maxCount={modelConfig.imageUpload.maxCount}
              slotLabels={
                modelConfig.imageUpload.mode === 'frames'
                  ? modelConfig.imageUpload.labels
                  : undefined
              }
              label={
                modelConfig.imageUpload.mode === 'frames'
                  ? language === 'zh'
                    ? '首尾帧图片 (可选)'
                    : 'Start/End Frames (Optional)'
                  : language === 'zh'
                  ? '参考图片 (可选)'
                  : 'Reference Images (Optional)'
              }
            />

            {/* Storyboard mode editor (only for supported models) */}
            {modelSupportsStoryboard && (
              <StoryboardEditor
                enabled={storyboardEnabled}
                onEnabledChange={setStoryboardEnabled}
                totalDuration={parseFloat(duration)}
                maxScenes={storyboardConfig.maxScenes}
                minSceneDuration={storyboardConfig.minSceneDuration}
                scenes={storyboardScenes}
                onScenesChange={setStoryboardScenes}
                disabled={isGenerating}
              />
            )}

            {/* Normal prompt input (hidden when storyboard mode is enabled) */}
            {!storyboardEnabled && (
              <PromptInput
                prompt={prompt}
                onPromptChange={setPrompt}
                presetPrompts={presetPrompts}
                language={language}
                type="video"
                disabled={isGenerating}
                onError={setError}
                videoProvider={modelConfig.provider}
              />
            )}

            <ErrorDisplay error={error} />
          </div>

          <ActionButtons
            language={language}
            type="video"
            isGenerating={isGenerating}
            hasGenerated={false}
            canGenerate={
              storyboardEnabled
                ? storyboardScenes.length > 0
                : !!(prompt && prompt.trim())
            }
            onGenerate={handleGenerate}
            onReset={handleReset}
            leftContent={
              <AutoInsertCheckbox
                storageKey={LS_KEYS.AI_VIDEO_AUTO_INSERT}
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
            storageKey="video"
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
              taskType={TaskType.VIDEO}
              onEditTask={handleEditTask}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default AIVideoGeneration;
