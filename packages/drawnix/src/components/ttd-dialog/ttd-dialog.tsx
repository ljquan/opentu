import { Dialog, DialogContent } from '../dialog/dialog';
import MermaidToDrawnix from './mermaid-to-drawnix';
import { DialogType, useDrawnix } from '../../hooks/use-drawnix';
import MarkdownToDrawnix from './markdown-to-drawnix';
import AIImageGeneration from './ai-image-generation';
import AIVideoGeneration from './ai-video-generation';
import type { ReferenceImage } from './shared/ReferenceImageUpload';
import { useI18n } from '../../i18n';
import { useBoard } from '@plait-board/react-board';
import React, {
  useState,
  useEffect,
  useRef,
  memo,
  useCallback,
  lazy,
  Suspense,
} from 'react';
import { useDeviceType } from '../../hooks/useDeviceType';
import {
  processSelectedContentForAI,
  extractSelectedContent,
} from '../../utils/selection-utils';
import { getSelectedElements, RectangleClient } from '@plait/core';
import { isFrameElement } from '../../types/frame.types';
import { matchFrameAspectRatio } from '../../utils/frame-size-matcher';
import {
  AI_IMAGE_GENERATION_PREVIEW_CACHE_KEY,
  AI_VIDEO_GENERATION_PREVIEW_CACHE_KEY,
  AI_IMAGE_MODE_CACHE_KEY,
} from '../../constants/storage';
import {
  createModelRef,
  geminiSettings,
  invocationPresetsSettings,
  resolveInvocationRoute,
  updateActiveInvocationRouteModel,
  type ModelRef,
} from '../../utils/settings-manager';
import { getSelectionKey } from '../../utils/model-selection';
import { WinBoxWindow } from '../winbox';
import type { VideoModel } from '../../types/video.types';

// 懒加载批量出图组件
const BatchImageGeneration = lazy(() => import('./batch-image-generation'));

// 图像生成模式类型
type ImageGenerationMode = 'single' | 'batch';

const TTDDialogComponent = ({
  container,
}: {
  container: HTMLElement | null;
}) => {
  const { appState, setAppState, openDialog, closeDialog } = useDrawnix();
  const { language } = useI18n();
  const board = useBoard();
  const { isMobile, isTablet } = useDeviceType();
  const dialogInitialDataByType = appState.dialogInitialDataByType;
  const imageDialogInitialData =
    dialogInitialDataByType?.[DialogType.aiImageGeneration] ?? null;
  const videoDialogInitialData =
    dialogInitialDataByType?.[DialogType.aiVideoGeneration] ?? null;

  // 移动端和平板端不显示批量出图
  const showBatchTab = !isMobile && !isTablet;

  // 使用ref来防止多次并发处理
  const isProcessingRef = useRef(false);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 模型选择状态
  const [selectedImageModel, setSelectedImageModel] = useState<string>('');
  const [selectedImageModelRef, setSelectedImageModelRef] =
    useState<ModelRef | null>(null);
  const [selectedVideoModel, setSelectedVideoModel] = useState<string>('');
  const [selectedVideoModelRef, setSelectedVideoModelRef] =
    useState<ModelRef | null>(null);
  const lastPersistedImageSelectionRef = useRef<string | null>(null);
  const lastPersistedVideoSelectionRef = useRef<string | null>(null);

  const syncSelectedModelsFromRoutes = useCallback(() => {
    const imageRoute = resolveInvocationRoute('image');
    const videoRoute = resolveInvocationRoute('video');

    const nextImageModel =
      imageRoute.modelId || 'gemini-3-pro-image-preview-vip';
    const nextImageModelRef = createModelRef(
      imageRoute.profileId,
      nextImageModel
    );
    const nextVideoModel = videoRoute.modelId || 'veo3';
    const nextVideoModelRef = createModelRef(
      videoRoute.profileId,
      nextVideoModel
    );

    setSelectedImageModel((prev) =>
      prev === nextImageModel ? prev : nextImageModel
    );
    setSelectedImageModelRef((prev) =>
      getSelectionKey(nextImageModel, prev) ===
      getSelectionKey(nextImageModel, nextImageModelRef)
        ? prev
        : nextImageModelRef
    );
    setSelectedVideoModel((prev) =>
      prev === nextVideoModel ? prev : nextVideoModel
    );
    setSelectedVideoModelRef((prev) =>
      getSelectionKey(nextVideoModel, prev) ===
      getSelectionKey(nextVideoModel, nextVideoModelRef)
        ? prev
        : nextVideoModelRef
    );
  }, []);

  // 加载当前模型设置
  useEffect(() => {
    syncSelectedModelsFromRoutes();
  }, [syncSelectedModelsFromRoutes]);

  // 监听设置变化,同步更新模型选择器
  useEffect(() => {
    const handleSettingsChange = () => {
      syncSelectedModelsFromRoutes();
    };

    geminiSettings.addListener(handleSettingsChange);
    invocationPresetsSettings.addListener(handleSettingsChange);

    return () => {
      geminiSettings.removeListener(handleSettingsChange);
      invocationPresetsSettings.removeListener(handleSettingsChange);
    };
  }, [syncSelectedModelsFromRoutes]);

  // 图片模型变更处理（同步更新到全局设置）
  const handleImageModelChange = (value: string) => {
    setSelectedImageModel(value);
  };

  // 视频模型变更处理（同步更新到全局设置）
  const handleVideoModelChange = (value: string) => {
    setSelectedVideoModel(value);
  };

  const handleImageModelRefChange = (value: ModelRef | null) => {
    setSelectedImageModelRef(value);
  };

  const handleVideoModelRefChange = (value: ModelRef | null) => {
    setSelectedVideoModelRef(value);
  };

  useEffect(() => {
    if (!selectedImageModel) {
      return;
    }

    const selectionKey = getSelectionKey(
      selectedImageModel,
      selectedImageModelRef
    );
    if (lastPersistedImageSelectionRef.current === selectionKey) {
      return;
    }
    lastPersistedImageSelectionRef.current = selectionKey;

    void updateActiveInvocationRouteModel(
      'image',
      createModelRef(selectedImageModelRef?.profileId, selectedImageModel)
    );
  }, [selectedImageModel, selectedImageModelRef]);

  useEffect(() => {
    if (!selectedVideoModel) {
      return;
    }

    const selectionKey = getSelectionKey(
      selectedVideoModel,
      selectedVideoModelRef
    );
    if (lastPersistedVideoSelectionRef.current === selectionKey) {
      return;
    }
    lastPersistedVideoSelectionRef.current = selectionKey;

    void updateActiveInvocationRouteModel(
      'video',
      createModelRef(selectedVideoModelRef?.profileId, selectedVideoModel)
    );
  }, [selectedVideoModel, selectedVideoModelRef]);

  // AI 图片生成的初始数据
  const [aiImageData, setAiImageData] = useState<{
    initialPrompt: string;
    initialImages: ReferenceImage[];
    selectedElementIds: string[]; // 保存选中元素的IDs
    initialResultUrl?: string; // 初始结果URL,用于显示预览
    initialAspectRatio?: string; // 选中 Frame 时自动匹配的宽高比
    targetFrameId?: string; // 目标 Frame ID（用于将生成结果插入到 Frame 内部）
    targetFrameDimensions?: { width: number; height: number }; // Frame 尺寸
  }>({
    initialPrompt: '',
    initialImages: [],
    selectedElementIds: [],
  });

  // AI 视频生成的初始数据
  const [aiVideoData, setAiVideoData] = useState<{
    initialPrompt: string;
    initialImage?: File | { url: string; name: string };
    initialImages?: any[]; // 支持多图片格式
    initialDuration?: number;
    initialModel?: VideoModel;
    initialSize?: string;
    initialResultUrl?: string;
  }>({
    initialPrompt: '',
    initialImage: undefined,
  });

  // 图片生成窗口是否需要最大化（批量模式时自动最大化）
  const [imageDialogAutoMaximize, setImageDialogAutoMaximize] = useState(false);

  // 图片生成模式状态（单图 / 批量）
  const [imageGenerationMode, setImageGenerationMode] =
    useState<ImageGenerationMode>(() => {
      try {
        const savedMode = localStorage.getItem(AI_IMAGE_MODE_CACHE_KEY);
        return savedMode === 'batch' ? 'batch' : 'single';
      } catch (e) {
        return 'single';
      }
    });

  // 移动端/平板端自动切换回单图模式
  useEffect(() => {
    if (!showBatchTab && imageGenerationMode === 'batch') {
      setImageGenerationMode('single');
    }
  }, [showBatchTab, imageGenerationMode]);

  // 处理图片生成模式变化
  const handleImageModeChange = useCallback((mode: ImageGenerationMode) => {
    setImageGenerationMode(mode);
    // 切换到批量模式时触发一次性全屏，切回时不调整尺寸（保持当前状态）
    if (mode === 'batch') {
      setImageDialogAutoMaximize(true);
      // 瞬间重置标识位，使其成为一个“脉冲”触发信号
      // 这样用户如果手动还原了窗口，再次点批量还能触发全屏
      setTimeout(() => setImageDialogAutoMaximize(false), 50);
    }
    try {
      localStorage.setItem(AI_IMAGE_MODE_CACHE_KEY, mode);
    } catch (e) {
      console.warn('Failed to save image mode:', e);
    }
  }, []);

  // 当对话框将要打开时，预先计算是否需要自动放大
  // 这需要在 WinBox 组件渲染前确定，且逻辑需要与 AIImageGeneration 的模式判断一致
  useEffect(() => {
    if (appState.openDialogTypes.has(DialogType.aiImageGeneration)) {
      // 如果有初始图片或初始提示词，说明是带内容进入，不自动放大（强制单图模式）
      const hasInitialContent =
        (aiImageData.initialImages && aiImageData.initialImages.length > 0) ||
        (aiImageData.initialPrompt && aiImageData.initialPrompt.trim() !== '');

      if (hasInitialContent) {
        setImageDialogAutoMaximize(false);
        return;
      }
      // 否则读取 localStorage 中保存的模式
      try {
        const savedMode = localStorage.getItem(AI_IMAGE_MODE_CACHE_KEY);
        if (savedMode === 'batch') {
          setImageDialogAutoMaximize(true);
          setTimeout(() => setImageDialogAutoMaximize(false), 50);
        }
      } catch (e) {
        setImageDialogAutoMaximize(false);
      }
    }
  }, [
    appState.openDialogTypes,
    aiImageData.initialImages,
    aiImageData.initialPrompt,
  ]);

  const prevImageDialogOpenRef = useRef(false);
  const prevImageDialogInitialDataRef = useRef(imageDialogInitialData);
  const prevVideoDialogOpenRef = useRef(false);
  const prevVideoDialogInitialDataRef = useRef(videoDialogInitialData);

  useEffect(() => {
    if (!board) {
      return;
    }

    const isImageDialogOpen = appState.openDialogTypes.has(
      DialogType.aiImageGeneration
    );
    const isImageDialogNewlyOpened =
      isImageDialogOpen && !prevImageDialogOpenRef.current;
    const imageDialogDataChanged =
      prevImageDialogInitialDataRef.current !== imageDialogInitialData;

    prevImageDialogOpenRef.current = isImageDialogOpen;
    prevImageDialogInitialDataRef.current = imageDialogInitialData;

    if (
      !isImageDialogOpen ||
      (!isImageDialogNewlyOpened && !imageDialogDataChanged) ||
      isProcessingRef.current
    ) {
      return;
    }

    const processSelection = async () => {
      isProcessingRef.current = true;

      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      processingTimeoutRef.current = setTimeout(() => {
        console.warn('Processing timeout, resetting processing state');
        isProcessingRef.current = false;
      }, 10000);

      try {
        if (imageDialogInitialData) {
          setAiImageData({
            initialPrompt:
              imageDialogInitialData.initialPrompt ||
              imageDialogInitialData.prompt ||
              '',
            initialImages:
              imageDialogInitialData.initialImages ||
              imageDialogInitialData.uploadedImages ||
              [],
            selectedElementIds: [],
            initialResultUrl:
              imageDialogInitialData.initialResultUrl ||
              imageDialogInitialData.resultUrl,
            initialAspectRatio: imageDialogInitialData.initialAspectRatio,
            targetFrameId: imageDialogInitialData.targetFrameId,
            targetFrameDimensions:
              imageDialogInitialData.targetFrameDimensions,
          });
          return;
        }

        const selectedElementIds = appState.lastSelectedElementIds || [];
        let frameAspectRatio: string | undefined;
        let detectedFrameId: string | undefined;
        let detectedFrameDimensions:
          | { width: number; height: number }
          | undefined;
        const selectedElements = getSelectedElements(board);
        if (
          selectedElements.length === 1 &&
          isFrameElement(selectedElements[0])
        ) {
          const frame = selectedElements[0];
          const rect = RectangleClient.getRectangleByPoints(frame.points);
          frameAspectRatio = matchFrameAspectRatio(rect.width, rect.height);
          detectedFrameId = frame.id;
          detectedFrameDimensions = {
            width: rect.width,
            height: rect.height,
          };
        }

        const processedContent = await processSelectedContentForAI(
          board,
          selectedElementIds
        );
        const imageItems: ReferenceImage[] = [];

        processedContent.remainingImages.forEach((image) => {
          imageItems.push({
            url: image.url,
            name: image.name || `selected-image-${Date.now()}.png`,
          });
        });

        if (processedContent.graphicsImage) {
          imageItems.push({
            url: processedContent.graphicsImage,
            name: `graphics-combined-${Date.now()}.png`,
          });
        }

        setAiImageData({
          initialPrompt: processedContent.remainingText || '',
          initialImages: imageItems,
          selectedElementIds,
          initialAspectRatio: frameAspectRatio,
          targetFrameId: detectedFrameId,
          targetFrameDimensions: detectedFrameDimensions,
        });
      } catch (error) {
        console.warn('Error processing selected content for AI:', error);

        const selectedContent = extractSelectedContent(board);
        const imageItems = selectedContent.images.map((image) => ({
          url: image.url,
          name: image.name || `selected-image-${Date.now()}.png`,
        }));

        setAiImageData({
          initialPrompt: selectedContent.text || '',
          initialImages: imageItems,
          selectedElementIds: [],
        });
      } finally {
        isProcessingRef.current = false;
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
      }
    };

    void processSelection();
  }, [
    appState.lastSelectedElementIds,
    appState.openDialogTypes,
    board,
    imageDialogInitialData,
  ]);

  useEffect(() => {
    if (!board) {
      return;
    }

    const isVideoDialogOpen = appState.openDialogTypes.has(
      DialogType.aiVideoGeneration
    );
    const isVideoDialogNewlyOpened =
      isVideoDialogOpen && !prevVideoDialogOpenRef.current;
    const videoDialogDataChanged =
      prevVideoDialogInitialDataRef.current !== videoDialogInitialData;

    prevVideoDialogOpenRef.current = isVideoDialogOpen;
    prevVideoDialogInitialDataRef.current = videoDialogInitialData;

    if (
      !isVideoDialogOpen ||
      (!isVideoDialogNewlyOpened && !videoDialogDataChanged) ||
      isProcessingRef.current
    ) {
      return;
    }

    const processVideoSelection = async () => {
      isProcessingRef.current = true;

      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      processingTimeoutRef.current = setTimeout(() => {
        console.warn('Video processing timeout, resetting processing state');
        isProcessingRef.current = false;
      }, 10000);

      try {
        if (videoDialogInitialData) {
          setAiVideoData({
            initialPrompt:
              videoDialogInitialData.initialPrompt ||
              videoDialogInitialData.prompt ||
              '',
            initialImage:
              videoDialogInitialData.initialImage ||
              videoDialogInitialData.uploadedImage,
            initialImages:
              videoDialogInitialData.initialImages ||
              videoDialogInitialData.uploadedImages,
            initialDuration:
              videoDialogInitialData.initialDuration ||
              videoDialogInitialData.duration,
            initialModel:
              videoDialogInitialData.initialModel ||
              videoDialogInitialData.model,
            initialSize:
              videoDialogInitialData.initialSize ||
              videoDialogInitialData.size,
            initialResultUrl:
              videoDialogInitialData.initialResultUrl ||
              videoDialogInitialData.resultUrl,
          });
          return;
        }

        const selectedElementIds = appState.lastSelectedElementIds || [];
        const processedContent = await processSelectedContentForAI(
          board,
          selectedElementIds
        );
        const allImages: Array<{ url: string; name: string }> = [];

        if (processedContent.remainingImages.length > 0) {
          processedContent.remainingImages.forEach((image, index) => {
            allImages.push({
              url: image.url,
              name:
                image.name || `selected-image-${index + 1}-${Date.now()}.png`,
            });
          });
        } else if (processedContent.graphicsImage) {
          allImages.push({
            url: processedContent.graphicsImage,
            name: `graphics-combined-${Date.now()}.png`,
          });
        }

        setAiVideoData({
          initialPrompt: processedContent.remainingText || '',
          initialImage: allImages.length > 0 ? allImages[0] : undefined,
          initialImages: allImages.map((img, index) => ({
            slot: index,
            slotLabel: `参考图${index + 1}`,
            url: img.url,
            name: img.name,
          })),
        });
      } catch (error) {
        console.warn('Error processing selected content for AI video:', error);

        const selectedContent = extractSelectedContent(board);
        const fallbackImages = selectedContent.images.map((image, index) => ({
          url: image.url,
          name: image.name || `selected-image-${index + 1}-${Date.now()}.png`,
        }));

        setAiVideoData({
          initialPrompt: selectedContent.text || '',
          initialImage:
            fallbackImages.length > 0 ? fallbackImages[0] : undefined,
          initialImages: fallbackImages.map((img, index) => ({
            slot: index,
            slotLabel: `参考图${index + 1}`,
            url: img.url,
            name: img.name,
          })),
        });
      } finally {
        isProcessingRef.current = false;
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }
      }
    };

    void processVideoSelection();
  }, [
    appState.lastSelectedElementIds,
    appState.openDialogTypes,
    board,
    videoDialogInitialData,
  ]);

  useEffect(() => {
    if (appState.openDialogTypes.size === 0) {
      isProcessingRef.current = false;
      prevImageDialogOpenRef.current = false;
      prevImageDialogInitialDataRef.current = null;
      prevVideoDialogOpenRef.current = false;
      prevVideoDialogInitialDataRef.current = null;
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
    }
  }, [appState.openDialogTypes]);

  // WinBox 关闭回调
  const handleImageDialogClose = useCallback(() => {
    // 在关闭前保存AI图片生成的缓存
    const cached = localStorage.getItem(AI_IMAGE_GENERATION_PREVIEW_CACHE_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        data.timestamp = Date.now();
        localStorage.setItem(
          AI_IMAGE_GENERATION_PREVIEW_CACHE_KEY,
          JSON.stringify(data)
        );
      } catch (error) {
        console.warn('Failed to update cache timestamp:', error);
      }
    }
    closeDialog(DialogType.aiImageGeneration);
  }, [closeDialog]);

  const handleVideoDialogClose = useCallback(() => {
    // 在关闭前保存AI视频生成的缓存
    const cached = localStorage.getItem(AI_VIDEO_GENERATION_PREVIEW_CACHE_KEY);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        data.timestamp = Date.now();
        localStorage.setItem(
          AI_VIDEO_GENERATION_PREVIEW_CACHE_KEY,
          JSON.stringify(data)
        );
      } catch (error) {
        console.warn('Failed to update cache timestamp:', error);
      }
    }
    closeDialog(DialogType.aiVideoGeneration);
  }, [closeDialog]);

  return (
    <>
      <Dialog
        open={appState.openDialogTypes.has(DialogType.mermaidToDrawnix)}
        onOpenChange={(open) => {
          if (open) {
            openDialog(DialogType.mermaidToDrawnix);
          } else {
            closeDialog(DialogType.mermaidToDrawnix);
          }
        }}
      >
        <DialogContent className="Dialog ttd-dialog" container={container}>
          <MermaidToDrawnix></MermaidToDrawnix>
        </DialogContent>
      </Dialog>
      <Dialog
        open={appState.openDialogTypes.has(DialogType.markdownToDrawnix)}
        onOpenChange={(open) => {
          if (open) {
            openDialog(DialogType.markdownToDrawnix);
          } else {
            closeDialog(DialogType.markdownToDrawnix);
          }
        }}
      >
        <DialogContent className="Dialog ttd-dialog" container={container}>
          <MarkdownToDrawnix></MarkdownToDrawnix>
        </DialogContent>
      </Dialog>
      {/* AI 图片生成窗口 - 使用 WinBox */}
      <WinBoxWindow
        id="ai-image-dialog"
        visible={appState.openDialogTypes.has(DialogType.aiImageGeneration)}
        title={
          imageGenerationMode === 'batch'
            ? language === 'zh'
              ? '批量出图'
              : 'Batch Generation'
            : language === 'zh'
            ? 'AI 图片生成'
            : 'AI Image Generation'
        }
        headerContent={
          showBatchTab ? (
            <div
              className="image-generation-mode-tabs"
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`mode-tab ${
                  imageGenerationMode === 'single' ? 'active' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleImageModeChange('single');
                }}
              >
                {language === 'zh' ? 'AI 图片生成' : 'AI Image'}
              </button>
              <button
                type="button"
                className={`mode-tab ${
                  imageGenerationMode === 'batch' ? 'active' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleImageModeChange('batch');
                }}
              >
                {language === 'zh' ? '批量出图' : 'Batch'}
              </button>
            </div>
          ) : undefined
        }
        onClose={handleImageDialogClose}
        width="80%"
        height="60%"
        minWidth={800}
        minHeight={500}
        x="center"
        y="center"
        modal={false}
        minimizable={false}
        className="winbox-ai-generation winbox-ai-image-generation"
        container={container}
        autoMaximize={imageDialogAutoMaximize || isMobile}
      >
        {appState.openDialogTypes.has(DialogType.aiImageGeneration) &&
          (imageGenerationMode === 'batch' ? (
            <Suspense
              fallback={
                <div className="loading-fallback">
                  {language === 'zh' ? '加载中...' : 'Loading...'}
                </div>
              }
            >
              <BatchImageGeneration
                onSwitchToSingle={() => handleImageModeChange('single')}
                selectedModel={selectedImageModel}
                selectedModelRef={selectedImageModelRef}
                onModelChange={handleImageModelChange}
                onModelRefChange={handleImageModelRefChange}
              />
            </Suspense>
          ) : (
            <AIImageGeneration
              key={imageDialogInitialData?.batchId || 'ai-image-dialog'}
              initialPrompt={aiImageData.initialPrompt}
              initialImages={aiImageData.initialImages}
              selectedElementIds={aiImageData.selectedElementIds}
              initialWidth={
                imageDialogInitialData?.initialWidth ||
                imageDialogInitialData?.width
              }
              initialHeight={
                imageDialogInitialData?.initialHeight ||
                imageDialogInitialData?.height
              }
              initialResultUrl={aiImageData.initialResultUrl}
              initialAspectRatio={aiImageData.initialAspectRatio}
              targetFrameId={aiImageData.targetFrameId}
              targetFrameDimensions={aiImageData.targetFrameDimensions}
              selectedModel={selectedImageModel}
              selectedModelRef={selectedImageModelRef}
              onModelChange={handleImageModelChange}
              onModelRefChange={handleImageModelRefChange}
              externalBatchId={imageDialogInitialData?.batchId}
              onDraftChange={imageDialogInitialData?.onDraftChange}
            />
          ))}
      </WinBoxWindow>
      {/* AI 视频生成窗口 - 使用 WinBox */}
      <WinBoxWindow
        id="ai-video-dialog"
        visible={appState.openDialogTypes.has(DialogType.aiVideoGeneration)}
        title={language === 'zh' ? 'AI 视频生成' : 'AI Video Generation'}
        onClose={handleVideoDialogClose}
        width="70%"
        height="60%"
        minWidth={800}
        minHeight={600}
        x="center"
        y="center"
        modal={false}
        minimizable={false}
        className="winbox-ai-generation winbox-ai-video-generation"
        container={container}
        autoMaximize={isMobile}
      >
        {appState.openDialogTypes.has(DialogType.aiVideoGeneration) && (
          <AIVideoGeneration
            key={videoDialogInitialData?.batchId || 'ai-video-dialog'}
            initialPrompt={aiVideoData.initialPrompt}
            initialImage={aiVideoData.initialImage}
            initialImages={aiVideoData.initialImages}
            initialDuration={aiVideoData.initialDuration}
            initialModel={aiVideoData.initialModel}
            initialSize={aiVideoData.initialSize}
            initialResultUrl={aiVideoData.initialResultUrl}
            selectedModel={selectedVideoModel}
            selectedModelRef={selectedVideoModelRef}
            onModelChange={handleVideoModelChange}
            onModelRefChange={handleVideoModelRefChange}
            externalBatchId={videoDialogInitialData?.batchId}
            onDraftChange={videoDialogInitialData?.onDraftChange}
          />
        )}
      </WinBoxWindow>
    </>
  );
};

// 使用 React.memo 优化组件，只有当关键属性变化时才重新渲染
export const TTDDialog = memo(TTDDialogComponent, (prevProps, nextProps) => {
  // 只有当 container 变化时才重新渲染
  return prevProps.container === nextProps.container;
});
