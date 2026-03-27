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
import { TaskType } from '../../types/task.types';
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
  AspectRatioSelector,
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
  type AspectRatioOption,
  convertAspectRatioToSize,
} from '../../constants/image-aspect-ratios';
import { DialogTaskList } from '../task-queue/DialogTaskList';
import { LS_KEYS } from '../../constants/storage-keys';
import {
  geminiSettings,
  hasInvocationRouteCredentials,
  resolveInvocationRoute,
  createModelRef,
  type ModelRef,
} from '../../utils/settings-manager';
import { promptForApiKey } from '../../utils/gemini-api';
import { buildMJPromptSuffix } from '../../utils/mj-params';
import {
  getCompatibleParams,
  getSizeOptionsForModel,
  type ModelConfig,
} from '../../constants/model-config';
import {
  loadAIImageToolPreferences,
  saveAIImageToolPreferences,
} from '../../services/ai-generation-preferences-service';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
} from '../../utils/model-selection';

interface AIImageGenerationProps {
  initialPrompt?: string;
  initialImages?: ReferenceImage[];
  selectedElementIds?: string[];
  initialWidth?: number;
  initialHeight?: number;
  initialResultUrl?: string;
  initialAspectRatio?: string;
  targetFrameId?: string;
  targetFrameDimensions?: { width: number; height: number };
  selectedModel?: string;
  selectedModelRef?: ModelRef | null;
  onModelChange?: (value: string) => void;
  onModelRefChange?: (value: ModelRef | null) => void;
}

const AIImageGeneration = ({
  initialPrompt = '',
  initialImages = [],
  selectedElementIds: initialSelectedElementIds = [],
  initialWidth,
  initialHeight,
  initialResultUrl,
  initialAspectRatio,
  targetFrameId,
  targetFrameDimensions,
  selectedModel,
  selectedModelRef,
  onModelChange,
  onModelRefChange,
}: AIImageGenerationProps = {}) => {
  const initialRoute = resolveInvocationRoute('image');
  const persistedPreferencesRef = useRef<
    ReturnType<typeof loadAIImageToolPreferences> | null
  >(null);
  if (!persistedPreferencesRef.current) {
    const fallbackModel =
      selectedModel || initialRoute.modelId || 'gemini-2.5-flash-image-vip';
    persistedPreferencesRef.current = loadAIImageToolPreferences(fallbackModel);
  }
  const persistedPreferences = persistedPreferencesRef.current;
  const imageModels = useSelectableModels('image');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [mjSelectedParams, setMjSelectedParams] = useState<
    Record<string, string>
  >(persistedPreferences.extraParams);
  const initialPreferredModelId =
    selectedModel || persistedPreferences.currentModel || initialRoute.modelId;
  const initialPreferredModelRef =
    selectedModel && selectedModel !== initialRoute.modelId
      ? selectedModelRef || null
      : persistedPreferences.currentModel &&
        persistedPreferences.currentModel !== initialRoute.modelId
      ? null
      : createModelRef(initialRoute.profileId, initialRoute.modelId);
  const initialMatchedModel =
    findMatchingSelectableModel(
      imageModels,
      initialPreferredModelId,
      initialPreferredModelRef
    ) ||
    getPinnedSelectableModel(
      'image',
      initialPreferredModelId,
      initialPreferredModelRef
    );
  const [currentModel, setCurrentModel] = useState(
    initialMatchedModel?.id ||
      initialPreferredModelId ||
      imageModels[0]?.id ||
      'gemini-2.5-flash-image-vip'
  );
  const [currentModelRef, setCurrentModelRef] = useState<ModelRef | null>(
    getModelRefFromConfig(initialMatchedModel) || initialPreferredModelRef
  );
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
    initialAspectRatio || persistedPreferences.aspectRatio || DEFAULT_ASPECT_RATIO
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
  const { viewportWidth } = useDeviceType();
  const isCompactLayout = viewportWidth <= 768;

  // Use generation history from task queue
  const { imageHistory } = useGenerationHistory();
  const { isGenerating } = useGenerationState('image');
  const { language } = useI18n();
  const { createTask } = useTaskQueue();

  const isMJModel = currentModel.startsWith('mj');
  const modelAspectRatioOptions = React.useMemo<AspectRatioOption[]>(() => {
    if (isMJModel) return [];

    const sizeOptions = getSizeOptionsForModel(currentModel);
    if (sizeOptions.length === 0) return ASPECT_RATIO_OPTIONS;

    const byValue = new Map(
      ASPECT_RATIO_OPTIONS.map((option) => [option.value, option])
    );
    const mapped: AspectRatioOption[] = [];

    sizeOptions.forEach((sizeOption) => {
      const normalized =
        sizeOption.value === 'auto'
          ? 'auto'
          : sizeOption.value.replace('x', ':');
      const option = byValue.get(normalized);
      if (option && !mapped.some((item) => item.value === option.value)) {
        mapped.push(option);
      }
    });

    return mapped.length > 0 ? mapped : ASPECT_RATIO_OPTIONS;
  }, [currentModel, isMJModel]);

  const hasCompatibleParams = React.useMemo(() => {
    const params = getCompatibleParams(currentModel);
    // MJ 模型所有参数都走 dropdown；非 MJ 模型排除 size（已有 AspectRatioSelector）
    if (isMJModel) return params.length > 0;
    return params.some((p) => p.id !== 'size');
  }, [currentModel, isMJModel]);

  // 模型切换时清空已选参数，避免跨模型残留不兼容配置
  useEffect(() => {
    setMjSelectedParams({});
  }, [currentModel]);

  const handleMJParamChange = useCallback((paramId: string, value: string) => {
    if (!value || value === 'default') {
      setMjSelectedParams((prev) => {
        const next = { ...prev };
        delete next[paramId];
        return next;
      });
      return;
    }
    setMjSelectedParams((prev) => ({
      ...prev,
      [paramId]: value,
    }));
  }, []);

  // Track if we're in manual edit mode (from handleEditTask) to prevent props from overwriting
  const [isManualEdit, setIsManualEdit] = useState(false);

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
      elementIds: initialSelectedElementIds,
      width: initialWidth,
      height: initialHeight,
      result: initialResultUrl,
      aspectRatio: initialAspectRatio,
    });

    // Skip if we've already processed these exact props
    if (processedPropsRef.current === propsKey) {
      // console.log('AIImageGeneration - skipping duplicate props processing');
      return;
    }

    // console.log('AIImageGeneration - processing new props:', { propsKey });
    processedPropsRef.current = propsKey;

    setPrompt(initialPrompt);
    // 使用 initialImages 的值,如果是 undefined 则使用空数组(确保清空)
    setUploadedImages(initialImages || []);
    if (initialWidth) setWidth(initialWidth);
    if (initialHeight) setHeight(initialHeight);
    // 如果有 Frame 匹配的宽高比，自动设置
    if (initialAspectRatio) setAspectRatio(initialAspectRatio);
  }, [
    initialPrompt,
    initialImages,
    initialSelectedElementIds,
    initialWidth,
    initialHeight,
    initialResultUrl,
    initialAspectRatio,
    isManualEdit,
  ]);

  useEffect(() => {
    const handleSettingsChange = (newSettings: any) => {
      const nextModel =
        newSettings.imageModelName ||
        visibleImageModels[0]?.id ||
        'gemini-2.5-flash-image-vip';
      if (nextModel !== currentModel) {
        setCurrentModel(nextModel);
        const matchedModel = findMatchingSelectableModel(
          visibleImageModels,
          nextModel,
          currentModelRef
        );
        setCurrentModelRef(getModelRefFromConfig(matchedModel) || null);
      }
    };
    geminiSettings.addListener(handleSettingsChange);
    return () => geminiSettings.removeListener(handleSettingsChange);
  }, [currentModel, currentModelRef, visibleImageModels]);

  useEffect(() => {
    if (visibleImageModels.length === 0) return;
    const matchedModel = findMatchingSelectableModel(
      visibleImageModels,
      currentModel,
      currentModelRef
    );
    if (!matchedModel) {
      setCurrentModel(visibleImageModels[0].id);
      setCurrentModelRef(getModelRefFromConfig(visibleImageModels[0]));
    }
  }, [currentModel, currentModelRef, visibleImageModels]);

  // Keep local模型状态与头部下拉（受控 selectedModel）同步，避免展示过期的参数列表
  useEffect(() => {
    if (!selectedModel) {
      return;
    }

    const currentSelectionKey = getSelectionKey(currentModel, currentModelRef);
    const nextSelectionKey = getSelectionKey(selectedModel, selectedModelRef);

    if (currentSelectionKey !== nextSelectionKey) {
      setCurrentModel(selectedModel);
      const matchedModel = findMatchingSelectableModel(
        visibleImageModels,
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
    visibleImageModels,
  ]);

  useEffect(() => {
    if (!hasCompatibleParams && Object.keys(mjSelectedParams).length > 0) {
      setMjSelectedParams({});
    }
  }, [hasCompatibleParams, mjSelectedParams]);

  useEffect(() => {
    if (isMJModel || modelAspectRatioOptions.length === 0) return;
    const supportedValues = new Set(
      modelAspectRatioOptions.map((option) => option.value)
    );
    if (!supportedValues.has(aspectRatio)) {
      const nextValue = supportedValues.has('auto')
        ? 'auto'
        : modelAspectRatioOptions[0]?.value || DEFAULT_ASPECT_RATIO;
      setAspectRatio(nextValue);
    }
  }, [aspectRatio, isMJModel, modelAspectRatioOptions]);

  useEffect(() => {
    saveAIImageToolPreferences({
      currentModel,
      extraParams: mjSelectedParams,
      aspectRatio,
    });
  }, [currentModel, mjSelectedParams, aspectRatio]);

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
    setPrompt('');
    setMjSelectedParams({});
    setUploadedImages([]);
    setError(null);
    setAspectRatio(DEFAULT_ASPECT_RATIO); // 重置比例
    setMobilePanel('config');
    // Clear manual edit mode
    setIsManualEdit(false);
    // 触发Footer组件更新
    window.dispatchEvent(new CustomEvent('ai-image-clear'));
  };

  // 使用useMemo优化性能，当imageHistory或language变化时重新计算
  const presetPrompts = React.useMemo(
    () => getMergedPresetPrompts('image', language as Language, imageHistory),
    [imageHistory, language]
  );

  // 保存提示词到历史记录（去重）
  const savePromptToHistory = (promptText: string) => {
    const dimensions = {
      width: typeof width === 'string' ? parseInt(width) || 1024 : width,
      height: typeof height === 'string' ? parseInt(height) || 1024 : height,
    };
    savePromptToHistoryUtil('image', promptText, dimensions);
  };

  // 处理任务编辑（从弹窗内的任务列表点击编辑）
  const handleEditTask = (task: any) => {
    // console.log('Image handleEditTask - task params:', task.params);

    // 标记为手动编辑模式,防止 props 的 useEffect 覆盖我们的更改
    setIsManualEdit(true);
    setMobilePanel('config');

    // 直接更新表单状态
    setPrompt(task.params.prompt || '');
    setMjSelectedParams({});
    setWidth(task.params.width || 1024);
    setHeight(task.params.height || 1024);

    // 更新上传的图片 - 确保格式正确
    if (task.params.uploadedImages && task.params.uploadedImages.length > 0) {
      // console.log('Setting uploadedImages:', task.params.uploadedImages);
      setUploadedImages(task.params.uploadedImages);
    } else {
      setUploadedImages([]);
    }

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

    // 更新宽高比（如果有）
    if (task.params.aspectRatio) {
      // console.log('Setting aspectRatio to:', task.params.aspectRatio);
      setAspectRatio(task.params.aspectRatio);
    }

    setError(null);
  };

  // 转换图片为可序列化格式
  const convertImagesToSerializable = async () => {
    return Promise.all(
      uploadedImages.map(async (img) => {
        if (img.file) {
          return new Promise<{ type: 'url'; url: string; name: string }>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                resolve({
                  type: 'url',
                  url: reader.result as string,
                  name: img.name,
                });
              };
              reader.onerror = reject;
              reader.readAsDataURL(img.file!);
            }
          );
        } else if (img.url) {
          return { type: 'url', url: img.url, name: img.name };
        }
        throw new Error('Invalid image data');
      })
    );
  };

  const handleGenerate = async (count = 1) => {
    if (!prompt || !prompt.trim()) {
      setError(
        language === 'zh' ? '请输入图像描述' : 'Please enter image description'
      );
      return;
    }

    // 先检查 API Key，没有则弹窗获取（只弹一次，避免批量生成时多次弹窗）
    if (
      !hasInvocationRouteCredentials('image', currentModelRef || currentModel)
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

      // 如果数量大于1，使用批量生成
      if (count > 1) {
        const batchTaskIds: string[] = [];
        const batchId = `batch_${Date.now()}`;

        const currentImageModel =
          currentModel || resolveInvocationRoute('image').modelId;

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

        for (let i = 0; i < count; i++) {
          const taskParams = {
            prompt: finalPrompt,
            width: finalWidth,
            height: finalHeight,
            aspectRatio,
            size: finalSize,
            model: currentImageModel,
            modelRef: currentModelRef || null,
            uploadedImages: convertedImages,
            batchId,
            batchIndex: i + 1,
            batchTotal: count,
            autoInsertToCanvas: getAutoInsertValue(
              LS_KEYS.AI_IMAGE_AUTO_INSERT
            ),
            targetFrameId,
            targetFrameDimensions,
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
      const currentImageModel =
        currentModel || resolveInvocationRoute('image').modelId;

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

      // 创建任务参数（单个任务也需要 batchId 以跳过 SW 重复检测）
      const taskParams = {
        prompt: finalPrompt,
        width: finalWidth,
        height: finalHeight,
        aspectRatio,
        size: finalSize,
        model: currentImageModel,
        modelRef: currentModelRef || null,
        // 保存上传的图片（已转换为可序列化的格式）
        uploadedImages: convertedImages,
        autoInsertToCanvas: getAutoInsertValue(LS_KEYS.AI_IMAGE_AUTO_INSERT),
        // 始终包含 batchId 以跳过重复检测
        batchId: `image_single_${Date.now()}`,
        batchIndex: 1,
        batchTotal: 1,
        targetFrameId,
        targetFrameDimensions,
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
                    onSelect={(value) => {
                      setCurrentModel(value);
                      setCurrentModelRef(null);
                      onModelChange(value);
                      onModelRefChange?.(null);
                    }}
                    onSelectModel={(model: ModelConfig) => {
                      setCurrentModel(model.id);
                      const nextModelRef = getModelRefFromConfig(model);
                      setCurrentModelRef(nextModelRef);
                      onModelChange(model.id);
                      onModelRefChange?.(nextModelRef);
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

            {/* 模型参数（排除 size，已有 AspectRatioSelector） */}
            {hasCompatibleParams && (
              <div className="model-params-row">
                <ParametersDropdown
                  selectedParams={mjSelectedParams}
                  onParamChange={handleMJParamChange}
                  modelId={currentModel}
                  language={language}
                  disabled={isGenerating}
                  excludeParamIds={isMJModel ? undefined : ['size']}
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
            />

            <PromptInput
              prompt={prompt}
              onPromptChange={setPrompt}
              presetPrompts={presetPrompts}
              language={language}
              type="image"
              disabled={isGenerating}
              onError={setError}
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
              <>
                <AutoInsertCheckbox
                  storageKey={LS_KEYS.AI_IMAGE_AUTO_INSERT}
                  language={language}
                />
                {!isMJModel && (
                  <AspectRatioSelector
                    value={aspectRatio}
                    onChange={setAspectRatio}
                    compact={true}
                    options={modelAspectRatioOptions}
                  />
                )}
              </>
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
