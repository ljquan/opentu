import Stack from '../../stack';
import { FontColorIcon, PropertySettingsIcon } from '../../icons';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  getRectangleByElements,
  getSelectedElements,
  isDragging,
  isMovingElements,
  isSelectionMoving,
  PlaitBoard,
  PlaitElement,
  RectangleClient,
  toHostPointFromViewBoxPoint,
  toScreenPointFromHostPoint,
  duplicateElements,
  deleteFragment,
  addSelectedElement,
  clearSelectedElement,
  Transforms,
  getViewportOrigination,
} from '@plait/core';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBoard } from '@plait-board/react-board';
import { flip, offset, shift, useFloating } from '@floating-ui/react';
import { Island } from '../../island';
import classNames from 'classnames';
import {
  getStrokeColorByElement as getStrokeColorByMindElement,
  MindElement,
} from '@plait/mind';
import './popup-toolbar.scss';
import { safeToImage, trackMemory } from '../../../utils/common';
import {
  getStrokeColorByElement as getStrokeColorByDrawElement,
  isClosedCustomGeometry,
  isClosedDrawElement,
  isClosedPoints,
  isDrawElementsIncludeText,
  PlaitDrawElement,
  DrawTransforms,
} from '@plait/draw';
import { CustomText } from '@plait/common';
import { getTextMarksByElement } from '@plait/text-plugins';
import { PopupFontColorButton } from './font-color-button';
import { PopupFontSizeButton } from './font-size-button';
import { PopupStrokeButton } from './stroke-button';
import { PopupFillButton } from './fill-button';
import { PopupCornerRadiusButton } from './corner-radius-button';
import { SizeInput } from './size-input';
import {
  isWhite,
  removeHexAlpha,
  NO_COLOR,
  trimCanvasWhiteAndTransparentBorderWithInfo,
} from '@aitu/utils';
import { copyToClipboard } from '../../../utils/runtime-helpers';
import { Freehand } from '../../../plugins/freehand/type';
import { PenPath } from '../../../plugins/pen/type';
import { getStrokeColorByElement as getStrokeColorByFreehandElement } from '../../../plugins/freehand/utils';
import { PopupLinkButton } from './link-button';
import { PopupPromptButton } from './prompt-button';
import { PopupLayerControlButton } from './layer-control-button';
import { PopupAlignmentButton } from './alignment-button';
import { PopupDistributeButton } from './distribute-button';
import { PopupBooleanButton } from './boolean-button';
import { TextPropertyPanel } from './text-property-panel';
import { PopupImage3DTransformButton } from './image-3d-transform-button';
import {
  AIImageIcon,
  AIVideoIcon,
  VideoFrameIcon,
  DuplicateIcon,
  TrashIcon,
  SplitImageIcon,
  DownloadIcon,
  MergeIcon,
  VideoMergeIcon,
  SaveFileIcon,
} from '../../icons';
import {
  Pencil,
  Presentation,
  Copy,
  Play,
  Volume2,
  VolumeX,
  Scaling,
  RefreshCw,
  PaintBucket,
  Layers3,
} from 'lucide-react';
import { useDrawnix, DialogType } from '../../../hooks/use-drawnix';
import { useI18n } from '../../../i18n';
import { ToolButton } from '../../tool-button';
import { useGlobalMousePosition } from '../../../hooks/use-global-mouse-position';
import type { FillConfig } from '../../../types/fill.types';
import {
  isSolidFill,
  isFillConfig,
  getElementFillValue,
} from '../../../types/fill.types';
import { gradientToCSS } from '../../../utils/fill-renderer';
import { isVideoElement } from '../../../plugins/with-video';
import { VideoFrameSelector } from '../../video-frame-selector/video-frame-selector';
import { insertVideoFrame } from '../../../utils/video-frame';
import { isToolElement } from '../../../plugins/with-tool';
import { isWorkZoneElement } from '../../../plugins/with-workzone';
import { splitAndInsertImages } from '../../../utils/image-splitter';
import {
  LayerDecompositionCorrectionRequiredError,
  startAutomaticLayerDecomposition,
} from '../../../services/layer-decomposition';
import {
  smartDownload,
  BatchDownloadItem,
  buildDownloadFilename,
} from '../../../utils/download-utils';
import { MessagePlugin } from 'tdesign-react';
import { taskQueueService } from '../../../services/task-queue';
import { mergeVideos } from '../../../services/video-merge-webcodecs';
import { insertImageFromUrl } from '../../../data/image';
import { calculateEditedImagePoints } from '../../../utils/image';
import { isFrameElement } from '../../../types/frame.types';
import { isCardElement } from '../../../types/card.types';
import { duplicateFrame, focusFrame } from '../../../utils/frame-duplicate';
import {
  buildPPTImageGenerationPrompt,
  findMindRootFromSelection,
  formatPPTCommonPrompt,
  isPlaitMind,
  normalizePPTReferenceImages,
} from '../../../services/ppt';
import type { PPTFrameMeta } from '../../../services/ppt';
import {
  findPreviousPPTSlideImage,
  findPPTSlideImage,
  getPPTSlidePrompt,
} from '../../../utils/frame-insertion-utils';
import { matchFrameAspectRatio } from '../../../utils/frame-size-matcher';
import {
  extractElementTextContent,
  isPlainTextElement,
  openCardInKnowledgeBase,
  saveCardToKnowledgeBase,
  sortElementsForContentMerge,
  syncMergedCardKnowledgeBinding,
} from '../../../utils/card-actions';
import { isAudioNodeElement } from '../../../types/audio-node.types';
import { getCanvasAudioPlaybackQueue } from '../../../data/audio';
import { openMusicPlayerToolAndPlay } from '../../../services/tool-launch-service';
import { useCanvasAudioPlayback } from '../../../hooks/useCanvasAudioPlayback';
import { buildImageTaskAIInputPrefillData } from '../../../utils/image-task-prefill';
import { requestAIInputPrefill } from '../../../services/ai-input-ui-events';
import {
  AUDIO_PLAYLIST_CANVAS_AUDIO_ID,
  AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL,
  AUDIO_PLAYLIST_CANVAS_READING_ID,
  AUDIO_PLAYLIST_CANVAS_READING_LABEL,
} from '../../../types/audio-playlist.types';
import { fitPPTFrameMediaToFrameWithNaturalSize } from '../../../utils/ppt-media-fit';
import {
  createCanvasReadingPlaybackSource,
  createCanvasReadingPlaybackQueue,
  getCanvasSpeechText,
  type CanvasSpeechTextResult,
} from './text-to-speech-utils';
import { isOrdinary3DTransformImage } from '../../../utils/image-3d-transform';
import {
  findMaskBrushesForImage,
  isMaskBrushEligibleImage,
} from '../../../utils/ai-mask-brush';

const ImageEditor = lazy(() =>
  import('../../image-editor').then((module) => ({
    default: module.ImageEditor,
  }))
);

const FrameSlideshow = lazy(() =>
  import('../../project-drawer/FrameSlideshow').then((module) => ({
    default: module.FrameSlideshow,
  }))
);

const POPUP_TOOLBAR_POSITION_FRAMES = 2;

const schedulePopupToolbarFrame = (callback: FrameRequestCallback) => {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(Date.now()), 0);
};

const cancelPopupToolbarFrame = (frameId: number) => {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
    return;
  }
  window.clearTimeout(frameId);
};

export const PopupToolbar = () => {
  const board = useBoard();
  // 过滤掉 WorkZone 元素，避免点击 WorkZone 时弹出 popup-toolbar
  const allSelectedElements = getSelectedElements(board);
  const selectedElements = allSelectedElements.filter(
    (element) => !isWorkZoneElement(element)
  );
  const { openDialog } = useDrawnix();
  const { language, t } = useI18n();
  const [movingOrDragging, setMovingOrDragging] = useState(false);
  const movingOrDraggingRef = useRef(movingOrDragging);

  // 视频帧选择弹窗状态
  const [showVideoFrameSelector, setShowVideoFrameSelector] = useState(false);
  const [selectedVideoElement, setSelectedVideoElement] =
    useState<PlaitElement | null>(null);

  // 图片编辑器状态
  const [showImageEditor, setShowImageEditor] = useState(false);
  const [editingImageUrl, setEditingImageUrl] = useState('');
  const [editingImageElement, setEditingImageElement] =
    useState<PlaitDrawElement | null>(null);

  // 属性面板状态
  const [showPropertyPanel, setShowPropertyPanel] = useState(false);
  const propertyPanelOpenRef = useRef(false);

  // Frame 幻灯片播放状态
  const [showSlideshow, setShowSlideshow] = useState(false);
  const [slideshowFrameId, setSlideshowFrameId] = useState<
    string | undefined
  >();
  const [speechTextResult, setSpeechTextResult] =
    useState<CanvasSpeechTextResult>({
      text: '',
      title: '',
      source: null,
    });

  // 保存 toolbar 和选中元素的位置信息，用于定位属性面板
  const [toolbarRect, setToolbarRect] = useState<
    { top: number; left: number; width: number; height: number } | undefined
  >();
  const [selectionRect, setSelectionRect] = useState<
    | {
        top: number;
        left: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
      }
    | undefined
  >();
  const toolbarRef = useRef<HTMLDivElement>(null);

  // 初始化全局鼠标位置跟踪
  useGlobalMousePosition();
  const playback = useCanvasAudioPlayback();
  const activeReadingSourceId =
    playback.mediaType === 'reading'
      ? playback.activeReadingSourceId
      : undefined;
  const isCurrentReadingSelection =
    !!speechTextResult.sourceId &&
    !!activeReadingSourceId &&
    activeReadingSourceId.startsWith(speechTextResult.sourceId);
  const speechSelectionKey = useMemo(
    () =>
      selectedElements
        .map((element) => element.id)
        .sort()
        .join('|'),
    [selectedElements]
  );
  const speechActionLabel = isCurrentReadingSelection
    ? playback.playing
      ? language === 'zh'
        ? '暂停朗读'
        : 'Pause reading'
      : language === 'zh'
      ? '继续朗读'
      : 'Resume reading'
    : language === 'zh'
    ? '语音朗读'
    : 'Read aloud';

  useEffect(() => {
    if (selectedElements.length === 0 || movingOrDragging) {
      setSpeechTextResult((prev) =>
        prev.text || prev.source ? { text: '', title: '', source: null } : prev
      );
      return;
    }

    const updateSpeechText = () => {
      const next = getCanvasSpeechText(board, selectedElements);
      setSpeechTextResult((prev) =>
        prev.text === next.text &&
        prev.source === next.source &&
        prev.title === next.title &&
        prev.sourceId === next.sourceId
          ? prev
          : next
      );
    };

    updateSpeechText();
    document.addEventListener('selectionchange', updateSpeechText);
    return () => {
      document.removeEventListener('selectionchange', updateSpeechText);
    };
  }, [board, speechSelectionKey, movingOrDragging]);

  // popup-toolbar 的显示逻辑
  const open = selectedElements.length > 0 && !isSelectionMoving(board);
  const { viewport, selection, children } = board;
  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    middleware: [
      offset(12), // Close to reference point
      shift({ padding: 16 }), // Ensure it stays within screen bounds
      flip({ fallbackPlacements: ['bottom', 'right', 'left'] }), // Smart fallback positioning
    ],
  });
  let state: {
    fill: string | FillConfig | undefined;
    strokeColor?: string;
    hasFill?: boolean;
    hasText?: boolean;
    fontColor?: string;
    fontSize?: string;
    hasFontColor?: boolean;
    hasFontSize?: boolean;
    hasStroke?: boolean;
    hasStrokeStyle?: boolean;
    hasStrokeWidth?: boolean; // 是否显示线宽设置
    strokeWidth?: number; // 当前线宽值
    marks?: Record<string, any>;
    hasAIImage?: boolean; // 是否显示AI图像生成按钮
    hasAIVideo?: boolean; // 是否显示AI视频生成按钮
    hasVideoFrame?: boolean; // 是否显示视频帧选择按钮
    hasSplitImage?: boolean; // 是否显示拆图按钮
    hasLayerDecomposition?: boolean; // 是否显示 AI 语义分层按钮
    hasDownloadable?: boolean; // 是否显示下载按钮
    hasMergeable?: boolean; // 是否显示合并按钮
    hasVideoMergeable?: boolean; // 是否显示视频合成按钮
    hasImageEdit?: boolean; // 是否显示图片编辑按钮
    hasRegenerateImage?: boolean; // 是否显示再次生成回填按钮
    hasCornerRadius?: boolean; // 是否显示圆角设置按钮
    cornerRadius?: number; // 当前圆角值
    hasSizeInput?: boolean; // 是否显示宽高输入
    isTextOnly?: boolean; // 是否只选中了纯文本元素
    hasAlignment?: boolean; // 是否显示对齐按钮（多选时显示）
    hasDistribute?: boolean; // 是否显示间距按钮（多选时显示）
    hasBoolean?: boolean; // 是否显示布尔组合按钮（多选时显示）
    hasMindmapToPPT?: boolean; // 是否显示思维导图转PPT按钮
    hasCardEdit?: boolean; // 是否显示 Card 编辑按钮（打开知识库）
    hasCardSave?: boolean; // 是否显示 Card 保存到知识库按钮
    hasContentMerge?: boolean; // 是否显示内容合并按钮
    hasFramePlay?: boolean; // 是否显示 Frame 幻灯片播放按钮
    hasAudioPlayer?: boolean; // 是否显示在音乐播放器中播放按钮
    hasTextToSpeech?: boolean; // 是否显示语音朗读按钮
    hasMediaFitPPT?: boolean; // 是否显示素材自适应 PPT 按钮
    hasImage3DTransform?: boolean; // 是否显示图片 3D 调节按钮
    hasMaskInvert?: boolean; // 是否显示蒙版反选按钮
    maskInverted?: boolean; // 当前蒙版是否反选
  } = {
    fill: 'red',
  };
  if (open && !movingOrDragging) {
    const hasFill =
      selectedElements.some((value) => hasFillProperty(board, value)) &&
      !PlaitBoard.hasBeenTextEditing(board);
    const hasText = selectedElements.some((value) =>
      hasTextProperty(board, value)
    );
    // 检查是否只选中了纯文本元素（用于提示词按钮）
    const isTextOnly =
      selectedElements.length > 0 &&
      selectedElements.every(
        (element) =>
          PlaitDrawElement.isDrawElement(element) &&
          PlaitDrawElement.isText(element)
      );
    const hasStroke =
      selectedElements.some((value) => hasStrokeProperty(board, value)) &&
      !PlaitBoard.hasBeenTextEditing(board);
    const hasStrokeStyle =
      selectedElements.some((value) => hasStrokeStyleProperty(board, value)) &&
      !PlaitBoard.hasBeenTextEditing(board);
    // 检查是否选中了视频元素
    const hasVideoSelected = selectedElements.some((element) =>
      isVideoElement(element)
    );

    // 检查是否选中了工具元素(内嵌网页)
    const hasToolSelected = selectedElements.some((element) =>
      isToolElement(element)
    );

    // 检查是否选中了 Card 元素
    const hasCardSelected = selectedElements.some((element) =>
      isCardElement(element)
    );
    const hasTextOrCardOnlySelection =
      selectedElements.length > 1 &&
      selectedElements.every(
        (element) => isCardElement(element) || isPlainTextElement(element)
      );

    // 检查是否选中了包含图片的元素（单个或多个），但排除视频元素和 Card 元素
    const hasAIVideo =
      selectedElements.length > 0 &&
      !hasVideoSelected &&
      !hasToolSelected &&
      !hasCardSelected &&
      selectedElements.some(
        (element) =>
          PlaitDrawElement.isDrawElement(element) &&
          PlaitDrawElement.isImage(element)
      ) &&
      !PlaitBoard.hasBeenTextEditing(board);

    // 检查是否只选中了一个视频元素
    const hasVideoFrame =
      selectedElements.length === 1 &&
      isVideoElement(selectedElements[0]) &&
      !PlaitBoard.hasBeenTextEditing(board);

    // AI图片生成按钮：排除视频元素、工具元素(内嵌网页)和 Card 元素
    const hasAIImage =
      !hasVideoSelected &&
      !hasToolSelected &&
      !hasCardSelected &&
      !PlaitBoard.hasBeenTextEditing(board);

    // 拆图按钮：只在选中单个图片元素且检测到分割线时显示
    // 排除SVG图片（SVG不能被智能拆分）
    const imageElement = selectedElements[0];
    const isSvgImage =
      PlaitDrawElement.isDrawElement(imageElement) &&
      PlaitDrawElement.isImage(imageElement) &&
      imageElement.url?.startsWith('data:image/svg+xml');

    const isImageSelected =
      selectedElements.length === 1 &&
      !hasVideoSelected &&
      !hasToolSelected &&
      PlaitDrawElement.isDrawElement(selectedElements[0]) &&
      PlaitDrawElement.isImage(selectedElements[0]) &&
      !isSvgImage && // 排除SVG图片
      !PlaitBoard.hasBeenTextEditing(board);

    // 只有检测到分割线时才显示拆图按钮
    const hasSplitImage = isImageSelected;
    const hasLayerDecomposition = isImageSelected;

    // 图片编辑按钮：选中单个非 SVG 图片时显示
    const hasImageEdit = isImageSelected;

    // 下载按钮：选中图片、视频或音频时显示
    const hasDownloadable =
      selectedElements.length > 0 &&
      !hasToolSelected &&
      selectedElements.some(
        (element) =>
          (PlaitDrawElement.isDrawElement(element) &&
            PlaitDrawElement.isImage(element)) ||
          isVideoElement(element) ||
          isAudioNodeElement(element)
      ) &&
      !PlaitBoard.hasBeenTextEditing(board);

    // 合并按钮：选中多个元素，支持图片、文字、图形、线条、手绘等（排除视频和工具元素）
    const hasMergeable =
      selectedElements.length > 1 &&
      !hasTextOrCardOnlySelection &&
      !hasVideoSelected &&
      !hasToolSelected &&
      selectedElements.every(
        (element) =>
          // 图片元素
          (PlaitDrawElement.isDrawElement(element) &&
            PlaitDrawElement.isImage(element)) ||
          // 包含文字的绘图元素
          (PlaitDrawElement.isDrawElement(element) &&
            isDrawElementsIncludeText([element])) ||
          // 图形元素（矩形、圆形等，排除图片和纯文本）
          (PlaitDrawElement.isDrawElement(element) &&
            PlaitDrawElement.isShapeElement(element) &&
            !PlaitDrawElement.isImage(element)) ||
          // 箭头线
          (PlaitDrawElement.isDrawElement(element) &&
            PlaitDrawElement.isArrowLine(element)) ||
          // 矢量线
          (PlaitDrawElement.isDrawElement(element) &&
            PlaitDrawElement.isVectorLine(element)) ||
          // 表格
          (PlaitDrawElement.isDrawElement(element) &&
            PlaitDrawElement.isTable(element)) ||
          // 手绘元素
          Freehand.isFreehand(element) ||
          // 钢笔路径
          PenPath.isPenPath(element) ||
          // 思维导图元素
          MindElement.isMindElement(board, element)
      ) &&
      !PlaitBoard.hasBeenTextEditing(board);

    // 视频合成按钮：选中多个视频元素（超过1个）
    const videoElements = selectedElements.filter((element) =>
      isVideoElement(element)
    );
    const hasVideoMergeable =
      videoElements.length > 1 && !PlaitBoard.hasBeenTextEditing(board);

    // 圆角设置按钮：选中 PenPath 元素时显示
    const penPathElements = selectedElements.filter((element) =>
      PenPath.isPenPath(element)
    ) as PenPath[];
    const hasCornerRadius =
      penPathElements.length > 0 && !PlaitBoard.hasBeenTextEditing(board);

    // 获取选中 PenPath 元素的圆角值（如果所有元素值相同则返回该值，否则返回 undefined）
    let cornerRadius: number | undefined = undefined;
    if (penPathElements.length > 0) {
      const firstRadius = penPathElements[0].cornerRadius ?? 0;
      const allSame = penPathElements.every(
        (el) => (el.cornerRadius ?? 0) === firstRadius
      );
      cornerRadius = allSame ? firstRadius : undefined;
    }

    // 线宽设置：选中 PenPath 或 Freehand 元素时显示
    const freehandElements = selectedElements.filter((element) =>
      Freehand.isFreehand(element)
    ) as Freehand[];
    const hasStrokeWidth =
      (penPathElements.length > 0 || freehandElements.length > 0) &&
      !PlaitBoard.hasBeenTextEditing(board);

    // 获取线宽值（同时检查 PenPath 和 Freehand 元素）
    let strokeWidth: number | undefined = undefined;
    const allStrokeWidthElements = [
      ...penPathElements.map((el) => el.strokeWidth ?? 2),
      ...freehandElements.map((el) => el.strokeWidth ?? 2),
    ];
    if (allStrokeWidthElements.length > 0) {
      const firstWidth = allStrokeWidthElements[0];
      const allSame = allStrokeWidthElements.every((w) => w === firstWidth);
      strokeWidth = allSame ? firstWidth : undefined;
    }

    // 宽高输入：选中任何可缩放的元素时显示
    // 排除视频、工具元素和正在编辑文本的情况
    const hasSizeInput =
      selectedElements.length > 0 &&
      !hasToolSelected &&
      !PlaitBoard.hasBeenTextEditing(board);

    const isAllMindmap =
      selectedElements.length > 0 &&
      selectedElements.every((element) =>
        MindElement.isMindElement(board, element)
      );

    // 对齐按钮：选中多个元素时显示（思维导图场景不显示）
    const hasAlignment =
      selectedElements.length > 1 &&
      !isAllMindmap &&
      !PlaitBoard.hasBeenTextEditing(board);

    // 间距按钮：选中多个元素时显示（思维导图场景不显示）
    const hasDistribute =
      selectedElements.length > 1 &&
      !isAllMindmap &&
      !PlaitBoard.hasBeenTextEditing(board);

    // 布尔组合按钮：选中多个闭合图形时显示（所有元素都必须支持布尔运算）
    const hasBoolean =
      selectedElements.length > 1 &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      selectedElements.every((element) =>
        supportsBooleanOperation(board, element)
      );

    // 思维导图转PPT按钮：选中思维导图根元素或任意思维导图节点时显示
    const hasMindmapToPPT =
      selectedElements.length > 0 &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      !!findMindRootFromSelection(board, selectedElements);

    // Card 编辑按钮：选中单个 Card 元素时显示
    const hasCardEdit =
      selectedElements.length === 1 &&
      isCardElement(selectedElements[0]) &&
      !!(selectedElements[0] as any).noteId &&
      !PlaitBoard.hasBeenTextEditing(board);

    const hasCardSave =
      selectedElements.length === 1 &&
      isCardElement(selectedElements[0]) &&
      !(selectedElements[0] as any).noteId &&
      !PlaitBoard.hasBeenTextEditing(board);

    const hasContentMerge =
      hasTextOrCardOnlySelection && !PlaitBoard.hasBeenTextEditing(board);

    // Frame 播放按钮：选中单个 Frame 元素时显示
    const hasFramePlay =
      selectedElements.length === 1 &&
      isFrameElement(selectedElements[0]) &&
      !PlaitBoard.hasBeenTextEditing(board);

    const hasAudioPlayer =
      selectedElements.length === 1 &&
      isAudioNodeElement(selectedElements[0]) &&
      !PlaitBoard.hasBeenTextEditing(board);

    const hasTextToSpeech =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      speechTextResult.text.length > 0;
    const hasMediaFitPPT =
      selectedElements.length === 1 &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      isFrameElement(selectedElements[0]);
    const hasImage3DTransform =
      selectedElements.length === 1 &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      isOrdinary3DTransformImage(selectedElements[0]);
    const hasMaskInvert =
      selectedElements.length === 1 &&
      !PlaitBoard.hasBeenTextEditing(board) &&
      isMaskBrushEligibleImage(selectedElements[0]) &&
      findMaskBrushesForImage(board, selectedElements[0]).length > 0;
    const maskInverted =
      hasMaskInvert && !!(selectedElements[0] as any).aiMaskInverted;

    state = {
      ...getElementState(board),
      hasFill,
      hasFontColor: hasText,
      hasFontSize: hasText,
      hasStroke,
      hasStrokeStyle,
      hasStrokeWidth,
      strokeWidth,
      hasText,
      isTextOnly,
      hasAIImage,
      hasAIVideo,
      hasVideoFrame,
      hasSplitImage,
      hasLayerDecomposition,
      hasImageEdit,
      hasRegenerateImage: isImageSelected,
      hasDownloadable,
      hasMergeable,
      hasVideoMergeable,
      hasCornerRadius,
      cornerRadius,
      hasSizeInput,
      hasAlignment,
      hasDistribute,
      hasBoolean,
      hasMindmapToPPT,
      hasCardEdit,
      hasCardSave,
      hasContentMerge,
      hasFramePlay,
      hasAudioPlayer,
      hasTextToSpeech,
      hasMediaFitPPT,
      hasImage3DTransform,
      hasMaskInvert,
      maskInverted,
    };
  }

  const copyCardText = async (cardElement: any, source: string) => {
    if (!cardElement) return;
    const title = cardElement.title ? `# ${cardElement.title}\n\n` : '';
    const body = cardElement.body || '';
    const text = `${title}${body}`.trim();
    try {
      await copyToClipboard(text);
      MessagePlugin.success(
        language === 'zh' ? '已复制到剪贴板' : 'Copied to clipboard',
        2000
      );
    } catch (err) {
      MessagePlugin.error(language === 'zh' ? '复制失败' : 'Copy failed', 2000);
    }
  };

  const mergeContentSelection = async () => {
    const sortedElements = sortElementsForContentMerge(board, selectedElements);
    if (sortedElements.length < 2) return;

    const hostElement = sortedElements[0];
    const mergedContent = sortedElements
      .map((element, index) => {
        if (
          index === 0 &&
          isCardElement(hostElement) &&
          isCardElement(element)
        ) {
          return (element.body || '').trim();
        }
        return extractElementTextContent(element);
      })
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (!mergedContent) {
      MessagePlugin.warning(
        language === 'zh' ? '没有可合并的内容' : 'No content to merge'
      );
      return;
    }

    const linkedNoteIds = sortedElements.flatMap((element) =>
      isCardElement(element) && element.noteId ? [element.noteId] : []
    );

    try {
      const preservedNoteId = await syncMergedCardKnowledgeBinding(
        linkedNoteIds,
        mergedContent
      );

      const mergedAwayIndexes = sortedElements
        .slice(1)
        .map((element) =>
          board.children.findIndex((child) => child.id === element.id)
        )
        .filter((index) => index >= 0)
        .sort((a, b) => b - a);

      for (const index of mergedAwayIndexes) {
        Transforms.removeNode(board, [index]);
      }

      let resultElement: PlaitElement | undefined;

      if (isCardElement(hostElement)) {
        const hostIndex = board.children.findIndex(
          (child) => child.id === hostElement.id
        );
        if (hostIndex < 0) {
          throw new Error(
            language === 'zh' ? '合并目标不存在' : 'Merge target missing'
          );
        }

        const updates: Partial<typeof hostElement> = { body: mergedContent };
        if (preservedNoteId) {
          updates.noteId = preservedNoteId;
        }
        Transforms.setNode(board, updates as any, [hostIndex]);
        resultElement = board.children[hostIndex];
      } else {
        const hostRect = getRectangleByElements(board, [hostElement], false);
        const hostIndex = board.children.findIndex(
          (child) => child.id === hostElement.id
        );
        if (hostIndex < 0) {
          throw new Error(
            language === 'zh' ? '合并目标不存在' : 'Merge target missing'
          );
        }

        const cardWidth = Math.max(hostRect.width, 320);
        const cardHeight = Math.max(hostRect.height, 180);
        const newCard = {
          type: 'card',
          id: `card-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 9)}`,
          body: mergedContent,
          fillColor: '#FA8C16',
          points: [
            [hostRect.x, hostRect.y],
            [hostRect.x + cardWidth, hostRect.y + cardHeight],
          ],
          children: [],
          ...(preservedNoteId ? { noteId: preservedNoteId } : {}),
        };

        Transforms.insertNode(board, newCard as any, [hostIndex]);
        Transforms.removeNode(board, [hostIndex + 1]);
        resultElement = board.children[hostIndex];
      }

      clearSelectedElement(board);
      if (resultElement) {
        addSelectedElement(board, resultElement);
      }

      MessagePlugin.success(
        language === 'zh'
          ? `已合并 ${sortedElements.length} 个元素`
          : `Merged ${sortedElements.length} elements`
      );
    } catch (error: any) {
      console.error('[PopupToolbar] Failed to merge content:', error);
      MessagePlugin.error(
        error?.message ||
          (language === 'zh' ? '合并内容失败' : 'Failed to merge content')
      );
    }
  };

  const prefillSelectedImageTaskToAIInput = useCallback(async () => {
    const imageElement = selectedElements[0];
    if (
      selectedElements.length !== 1 ||
      !PlaitDrawElement.isDrawElement(imageElement) ||
      !PlaitDrawElement.isImage(imageElement) ||
      !imageElement.url
    ) {
      return;
    }

    try {
      const task = await taskQueueService.findImageTaskByResultUrl(
        imageElement.url
      );
      if (!task) {
        MessagePlugin.warning(
          language === 'zh'
            ? '未找到该图片的历史生成任务'
            : 'No historical generation task found for this image'
        );
        return;
      }

      requestAIInputPrefill({
        ...buildImageTaskAIInputPrefillData(task),
        source: 'canvas-toolbar',
      });
    } catch (error) {
      console.error('[PopupToolbar] Failed to prefill image generation:', error);
      MessagePlugin.error(
        language === 'zh'
          ? '回填失败，请稍后重试'
          : 'Failed to load generation inputs, please try again'
      );
    }
  }, [language, selectedElements]);

  const openAIImageGenerationDialog = useCallback(() => {
    const selectedFrame =
      selectedElements.length === 1 && isFrameElement(selectedElements[0])
        ? selectedElements[0]
        : null;

    if (!selectedFrame) {
      openDialog(DialogType.aiImageGeneration);
      return;
    }

    const rect = RectangleClient.getRectangleByPoints(selectedFrame.points);
    const pptMeta = (selectedFrame as any).pptMeta as PPTFrameMeta | undefined;
    const slidePrompt = getPPTSlidePrompt(pptMeta);
    const commonPrompt = pptMeta
      ? pptMeta.commonPrompt?.trim() || formatPPTCommonPrompt(pptMeta.styleSpec)
      : '';
    const slideImage = findPPTSlideImage(board, selectedFrame.id);
    const previousSlideImage = findPreviousPPTSlideImage(
      board,
      selectedFrame.id
    );
    const initialImages: Array<{ url: string; name: string }> = [];
    if (slideImage?.url) {
      initialImages.push({
        url: slideImage.url,
        name: `${selectedFrame.name || 'frame'}-reference.png`,
      });
    }
    if (previousSlideImage?.url && previousSlideImage.url !== slideImage?.url) {
      initialImages.push({
        url: previousSlideImage.url,
        name: `${selectedFrame.name || 'frame'}-previous-reference.png`,
      });
    }
    const existingReferenceUrls = new Set(
      initialImages.map((image) => image.url)
    );
    normalizePPTReferenceImages(pptMeta?.referenceImages).forEach(
      (url, index) => {
        if (existingReferenceUrls.has(url)) {
          return;
        }
        existingReferenceUrls.add(url);
        initialImages.push({
          url,
          name: `${selectedFrame.name || 'frame'}-deck-reference-${
            index + 1
          }.png`,
        });
      }
    );

    openDialog(DialogType.aiImageGeneration, {
      initialPrompt: buildPPTImageGenerationPrompt(commonPrompt, slidePrompt),
      initialImages,
      initialAspectRatio: matchFrameAspectRatio(rect.width, rect.height),
      initialWidth: rect.width,
      initialHeight: rect.height,
      targetFrameId: selectedFrame.id,
      targetFrameDimensions: {
        width: rect.width,
        height: rect.height,
      },
      autoInsertToCanvas: true,
      pptSlideImage: true,
      pptSlidePrompt: slidePrompt,
      pptReplaceElementId: slideImage?.elementId,
    });
  }, [board, openDialog, selectedElements]);

  const toggleMaskInvert = useCallback(() => {
    const imageElement = selectedElements[0];
    if (
      selectedElements.length !== 1 ||
      !isMaskBrushEligibleImage(imageElement)
    ) {
      return;
    }
    const elementIndex = board.children.findIndex(
      (child) => child.id === imageElement.id
    );
    if (elementIndex < 0) {
      return;
    }
    const nextInverted = !(imageElement as any).aiMaskInverted;
    Transforms.setNode(
      board,
      { aiMaskInverted: nextInverted || undefined } as Partial<PlaitElement>,
      [elementIndex]
    );
    MessagePlugin.success(
      nextInverted
        ? language === 'zh'
          ? '已开启蒙层反选'
          : 'Mask inverted'
        : language === 'zh'
        ? '已关闭蒙层反选'
        : 'Mask inversion off',
      1200
    );
  }, [board, language, selectedElements]);

  const updatePopupToolbarPosition = useCallback(() => {
    if (!open || movingOrDragging) {
      return;
    }

    const elements = getSelectedElements(board);
    if (elements.length === 0) {
      setSelectionRect(undefined);
      return;
    }

    const rectangle = getRectangleByElements(board, elements, false);
    const [start, end] = RectangleClient.getPoints(rectangle);
    const screenStart = toScreenPointFromHostPoint(
      board,
      toHostPointFromViewBoxPoint(board, start)
    );
    const screenEnd = toScreenPointFromHostPoint(
      board,
      toHostPointFromViewBoxPoint(board, end)
    );
    const referenceX = screenStart[0] + (screenEnd[0] - screenStart[0]) / 2;
    const referenceY = screenStart[1];

    refs.setPositionReference({
      getBoundingClientRect() {
        return {
          width: 1,
          height: 1,
          x: referenceX,
          y: referenceY,
          top: referenceY,
          left: referenceX,
          right: referenceX + 1,
          bottom: referenceY + 1,
        };
      },
    });

    setSelectionRect({
      top: screenStart[1],
      left: screenStart[0],
      right: screenEnd[0],
      bottom: screenEnd[1],
      width: screenEnd[0] - screenStart[0],
      height: screenEnd[1] - screenStart[1],
    });

    if (toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect();
      setToolbarRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [board, movingOrDragging, open, refs]);

  // 等待 viewBox/scroll 在缩放后落定，再更新 toolbar 和属性面板坐标。
  useEffect(() => {
    if (!open || movingOrDragging) {
      return;
    }

    let cancelled = false;
    let frame = 0;
    let animationFrameId: number | null = null;

    const run = () => {
      if (cancelled) {
        return;
      }
      updatePopupToolbarPosition();
      if (frame >= POPUP_TOOLBAR_POSITION_FRAMES) {
        return;
      }
      frame += 1;
      animationFrameId = schedulePopupToolbarFrame(run);
    };

    run();

    return () => {
      cancelled = true;
      if (animationFrameId !== null) {
        cancelPopupToolbarFrame(animationFrameId);
      }
    };
  }, [
    open,
    movingOrDragging,
    viewport,
    selection,
    children,
    floatingStyles,
    updatePopupToolbarPosition,
  ]);

  // 同步 ref 和 state
  useEffect(() => {
    propertyPanelOpenRef.current = showPropertyPanel;
  }, [showPropertyPanel]);

  // 当选中元素完全清空时，延迟关闭属性面板（避免因修改属性导致的短暂重新渲染）
  useEffect(() => {
    if (selectedElements.length === 0 && !movingOrDragging) {
      // 延迟关闭，给重新渲染留出时间
      const timer = setTimeout(() => {
        setShowPropertyPanel(false);
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [selectedElements.length, movingOrDragging]);

  useEffect(() => {
    movingOrDraggingRef.current = movingOrDragging;
  }, [movingOrDragging]);

  useEffect(() => {
    const { pointerUp, pointerMove } = board;

    board.pointerMove = (event: PointerEvent) => {
      if (
        (isMovingElements(board) || isDragging(board)) &&
        !movingOrDraggingRef.current
      ) {
        setMovingOrDragging(true);
      }
      pointerMove(event);
    };

    board.pointerUp = (event: PointerEvent) => {
      if (
        movingOrDraggingRef.current &&
        (isMovingElements(board) || isDragging(board))
      ) {
        setMovingOrDragging(false);
      }
      pointerUp(event);
    };

    return () => {
      board.pointerUp = pointerUp;
      board.pointerMove = pointerMove;
    };
  }, [board]);

  return (
    <>
      {open && !movingOrDragging && (
        <Island
          padding={1}
          className={classNames('popup-toolbar', ATTACHED_ELEMENT_CLASS_NAME)}
          ref={(node) => {
            refs.setFloating(node);
            (
              toolbarRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node;
          }}
          style={floatingStyles}
          data-testid="popup-toolbar"
        >
          <Stack.Row gap={1}>
            {/* ========== 左侧：公共属性图标（样式相关，位置相对固定） ========== */}
            {state.hasFill && (
              <PopupFillButton
                board={board}
                key={3}
                currentColor={state.fill}
                title={t('toolbar.fillColor')}
              >
                <label
                  className={classNames('fill-label', 'color-label', {
                    'color-white':
                      state.fill &&
                      isSolidFill(state.fill) &&
                      isWhite(removeHexAlpha(state.fill)),
                    'color-mixed': state.fill === undefined,
                    'color-gradient':
                      state.fill &&
                      isFillConfig(state.fill) &&
                      state.fill.type === 'gradient',
                    'color-image':
                      state.fill &&
                      isFillConfig(state.fill) &&
                      state.fill.type === 'image',
                  })}
                  style={
                    // 当 fill 为 undefined 时（杂色状态），不设置内联 background，让 CSS 类生效
                    state.fill === undefined
                      ? undefined
                      : {
                          // 统一使用 background 属性，避免 backgroundColor 和 background 冲突
                          background: isSolidFill(state.fill)
                            ? state.fill
                            : isFillConfig(state.fill)
                            ? state.fill.type === 'gradient' &&
                              state.fill.gradient
                              ? gradientToCSS(state.fill.gradient)
                              : state.fill.type === 'solid' && state.fill.solid
                              ? state.fill.solid.color
                              : state.fill.type === 'image' &&
                                state.fill.image?.imageUrl
                              ? `url(${state.fill.image.imageUrl}) center/cover no-repeat`
                              : undefined
                            : undefined,
                        }
                  }
                ></label>
              </PopupFillButton>
            )}
            {state.hasStroke && (
              <PopupStrokeButton
                board={board}
                key={2}
                currentColor={state.strokeColor}
                title={t('toolbar.stroke')}
                hasStrokeStyle={state.hasStrokeStyle || false}
                hasStrokeWidth={state.hasStrokeWidth || false}
                currentStrokeWidth={state.strokeWidth}
              >
                <label
                  className={classNames('stroke-label', 'color-label', {
                    'color-mixed': state.strokeColor === undefined,
                  })}
                  style={{ borderColor: state.strokeColor }}
                ></label>
              </PopupStrokeButton>
            )}
            {state.hasFontColor && (
              <PopupFontColorButton
                board={board}
                key={0}
                currentColor={state.marks?.color}
                title={t('toolbar.fontColor')}
                fontColorIcon={
                  <FontColorIcon currentColor={state.marks?.color} />
                }
              ></PopupFontColorButton>
            )}
            {state.hasFontSize && (
              <PopupFontSizeButton
                board={board}
                key={1}
                currentFontSize={state.fontSize}
                title={t('toolbar.fontSize')}
              ></PopupFontSizeButton>
            )}

            {/* ========== 中间：场景特定图标（按需显示） ========== */}
            {state.hasCornerRadius && (
              <PopupCornerRadiusButton
                board={board}
                key="corner-radius"
                currentRadius={state.cornerRadius}
                title={t('toolbar.cornerRadius')}
                selectionRect={selectionRect}
              />
            )}
            {state.hasText && (
              <PopupLinkButton
                board={board}
                key={4}
                title={`Link`}
              ></PopupLinkButton>
            )}
            {state.isTextOnly && (
              <PopupPromptButton
                board={board}
                key={'prompt'}
                language={language as 'zh' | 'en'}
                title={language === 'zh' ? '提示词' : 'Prompts'}
              />
            )}
            {state.hasTextToSpeech && (
              <ToolButton
                className="text-to-speech"
                key="text-to-speech"
                type="icon"
                icon={
                  isCurrentReadingSelection && playback.playing ? (
                    <VolumeX size={15} />
                  ) : (
                    <Volume2 size={15} />
                  )
                }
                visible={true}
                selected={isCurrentReadingSelection && playback.playing}
                tooltip={speechActionLabel}
                aria-label={speechActionLabel}
                data-track="toolbar_click_text_to_speech"
                onPointerUp={() => {
                  if (!speechTextResult.text) return;
                  const readingSource =
                    createCanvasReadingPlaybackSource(speechTextResult);
                  if (!readingSource) return;
                  const readingQueue = createCanvasReadingPlaybackQueue(
                    board,
                    speechTextResult
                  );

                  if (isCurrentReadingSelection) {
                    if (playback.playing) {
                      playback.pausePlayback();
                    } else {
                      void playback.resumePlayback();
                    }
                    return;
                  }

                  void openMusicPlayerToolAndPlay({
                    source: readingSource,
                    queue:
                      readingQueue.length > 0 ? readingQueue : [readingSource],
                    queueTab: {
                      queueId: AUDIO_PLAYLIST_CANVAS_READING_ID,
                      queueName: AUDIO_PLAYLIST_CANVAS_READING_LABEL,
                    },
                  });
                }}
              />
            )}
            {/* 属性设置按钮 - 仅在选中包含文本的元素时显示 */}
            {state.hasText && (
              <ToolButton
                className="property-settings"
                key={'property-settings'}
                type="icon"
                icon={<PropertySettingsIcon />}
                visible={true}
                selected={showPropertyPanel}
                tooltip={t('propertyPanel.title')}
                aria-label={t('propertyPanel.title')}
                data-track="toolbar_click_property_settings"
                onPointerUp={() => {
                  setShowPropertyPanel(!showPropertyPanel);
                }}
              />
            )}
            {/* 对齐按钮 - 仅在多选时显示 */}
            {state.hasAlignment && (
              <PopupAlignmentButton
                board={board}
                key={'alignment'}
                title={t('toolbar.alignment')}
              />
            )}
            {/* 间距按钮 - 仅在多选时显示 */}
            {state.hasDistribute && (
              <PopupDistributeButton
                board={board}
                key={'distribute'}
                title={t('toolbar.distribute')}
              />
            )}
            {/* 布尔组合按钮 - 仅在多选时显示 */}
            {state.hasBoolean && (
              <PopupBooleanButton
                board={board}
                key={'boolean'}
                title={t('toolbar.boolean')}
              />
            )}
            {/* 思维导图转PPT按钮 - 选中思维导图时显示 */}
            {state.hasMindmapToPPT && (
              <ToolButton
                className="mindmap-to-ppt"
                key="mindmap-to-ppt"
                type="icon"
                icon={<Presentation size={15} />}
                visible={true}
                tooltip={language === 'zh' ? '转换为PPT' : 'Convert to PPT'}
                aria-label={language === 'zh' ? '转换为PPT' : 'Convert to PPT'}
                data-track="toolbar_click_mindmap_to_ppt"
                onPointerUp={async () => {
                  const mindRoot = findMindRootFromSelection(
                    board,
                    selectedElements
                  );
                  if (!mindRoot) return;

                  const loadingInstance = MessagePlugin.loading(
                    language === 'zh'
                      ? '正在转换为PPT...'
                      : 'Converting to PPT...',
                    0
                  );

                  try {
                    const { generatePPTFromMindmap } = await import(
                      '../../../services/ppt'
                    );
                    const result = await generatePPTFromMindmap(
                      board,
                      mindRoot as any
                    );

                    MessagePlugin.close(loadingInstance);

                    if (result.success) {
                      MessagePlugin.success(
                        language === 'zh'
                          ? `已生成 ${result.pageCount} 页PPT`
                          : `Generated ${result.pageCount} PPT slides`
                      );
                    } else {
                      MessagePlugin.error(
                        result.error ||
                          (language === 'zh' ? '转换失败' : 'Conversion failed')
                      );
                    }
                  } catch (error: any) {
                    MessagePlugin.close(loadingInstance);
                    MessagePlugin.error(
                      error.message ||
                        (language === 'zh' ? '转换失败' : 'Conversion failed')
                    );
                  }
                }}
              />
            )}
            {/* Card 编辑按钮 - 选中 Card 时显示，点击打开知识库 */}
            {state.hasCardEdit && (
              <ToolButton
                className="card-edit"
                key="card-edit"
                type="icon"
                icon={<Pencil size={15} />}
                visible={true}
                tooltip={
                  language === 'zh'
                    ? '在知识库中编辑'
                    : 'Edit in Knowledge Base'
                }
                aria-label={
                  language === 'zh'
                    ? '在知识库中编辑'
                    : 'Edit in Knowledge Base'
                }
                data-track="toolbar_click_card_edit"
                onPointerUp={async () => {
                  const cardElement = selectedElements[0] as any;
                  if (!cardElement) return;
                  await openCardInKnowledgeBase(
                    board,
                    cardElement,
                    language as 'zh' | 'en'
                  );
                }}
              />
            )}
            {state.hasCardSave && (
              <ToolButton
                className="card-save"
                key="card-save"
                type="icon"
                icon={<SaveFileIcon size={15} />}
                visible={true}
                tooltip={
                  language === 'zh' ? '保存到知识库' : 'Save to Knowledge Base'
                }
                aria-label={
                  language === 'zh' ? '保存到知识库' : 'Save to Knowledge Base'
                }
                data-track="toolbar_click_card_save"
                onPointerUp={async () => {
                  const cardElement = selectedElements[0] as any;
                  if (!cardElement) return;
                  const noteId = await saveCardToKnowledgeBase(
                    board,
                    cardElement,
                    language as 'zh' | 'en'
                  );
                  if (noteId) {
                    MessagePlugin.success(
                      language === 'zh'
                        ? '已保存到知识库'
                        : 'Saved to knowledge base'
                    );
                  }
                }}
              />
            )}
            {/* Card 复制按钮 - 选中 Card 时显示，点击复制卡片文本内容 */}
            {(state.hasCardEdit || state.hasCardSave) && (
              <ToolButton
                className="card-copy"
                key="card-copy"
                type="icon"
                icon={<Copy size={15} />}
                visible={true}
                tooltip={language === 'zh' ? '复制文本内容' : 'Copy text content'}
                aria-label={
                  language === 'zh' ? '复制文本内容' : 'Copy text content'
                }
                data-track="toolbar_click_card_copy"
                onPointerDown={({ event }) => {
                  event.stopPropagation();
                }}
                onPointerUp={async () => {
                  await copyCardText(selectedElements[0] as any, 'card-copy');
                }}
              />
            )}
            {state.hasContentMerge && (
              <ToolButton
                className="content-merge"
                key="content-merge"
                type="icon"
                icon={<MergeIcon />}
                visible={true}
                tooltip={language === 'zh' ? '合并内容' : 'Merge Content'}
                aria-label={language === 'zh' ? '合并内容' : 'Merge Content'}
                data-track="toolbar_click_content_merge"
                onPointerUp={() => {
                  void mergeContentSelection();
                }}
              />
            )}
            {state.hasAIImage && (
              <ToolButton
                className="ai-image"
                key={5}
                type="icon"
                icon={<AIImageIcon />}
                visible={true}
                tooltip={language === 'zh' ? 'AI图片生成' : 'AI Image Generation'}
                aria-label={
                  language === 'zh' ? 'AI图片生成' : 'AI Image Generation'
                }
                data-track="toolbar_click_ai_image"
                onPointerUp={openAIImageGenerationDialog}
              />
            )}
            {state.hasAIVideo && (
              <ToolButton
                className="ai-video"
                key={6}
                type="icon"
                icon={<AIVideoIcon />}
                visible={true}
                tooltip={language === 'zh' ? 'AI视频生成' : 'AI Video Generation'}
                aria-label={
                  language === 'zh' ? 'AI视频生成' : 'AI Video Generation'
                }
                data-track="toolbar_click_ai_video"
                onPointerUp={() => {
                  openDialog(DialogType.aiVideoGeneration);
                }}
              />
            )}
            {state.hasVideoFrame && (
              <ToolButton
                className="video-frame"
                key={7}
                type="icon"
                icon={<VideoFrameIcon />}
                visible={true}
                tooltip={
                  language === 'zh' ? '视频帧选择' : 'Video Frame Selection'
                }
                aria-label={
                  language === 'zh' ? '视频帧选择' : 'Video Frame Selection'
                }
                data-track="toolbar_click_video_frame"
                onPointerUp={() => {
                  // 找到选中的视频元素
                  const videoElement = selectedElements.find((element) =>
                    isVideoElement(element)
                  );
                  if (videoElement) {
                    setSelectedVideoElement(videoElement);
                    setShowVideoFrameSelector(true);
                  }
                }}
              />
            )}
            {state.hasMediaFitPPT && (
              <ToolButton
                className="media-fit-ppt"
                key="media-fit-ppt"
                type="icon"
                icon={<Scaling size={15} />}
                visible={true}
                tooltip={language === 'zh' ? '素材自适应PPT' : 'Fit media to PPT'}
                aria-label={
                  language === 'zh' ? '素材自适应PPT' : 'Fit media to PPT'
                }
                data-track="toolbar_click_media_fit_ppt"
                onPointerUp={() => {
                  void (async () => {
                    const frameElement = selectedElements[0];
                    if (!isFrameElement(frameElement)) return;

                    const result = await fitPPTFrameMediaToFrameWithNaturalSize(
                      board,
                      frameElement
                    );
                    if (result.fittedCount > 0) {
                      MessagePlugin.success(
                        language === 'zh'
                          ? `已自适应 ${result.fittedCount} 个素材`
                          : `Fitted ${result.fittedCount} media item${
                              result.fittedCount > 1 ? 's' : ''
                            }`
                      );
                      return;
                    }

                    MessagePlugin.warning(
                      language === 'zh'
                        ? '未找到可自适应的PPT素材'
                        : 'No media item can be fitted to PPT'
                    );
                  })();
                }}
              />
            )}
            {state.hasSplitImage && (
              <ToolButton
                className="split-image"
                key="split-image"
                type="icon"
                icon={<SplitImageIcon />}
                visible={true}
                tooltip={language === 'zh' ? '智能拆图' : 'Smart Split'}
                aria-label={language === 'zh' ? '智能拆图' : 'Smart Split'}
                data-track="toolbar_click_split_image"
                onPointerUp={async () => {
                  // 获取选中的图片元素
                  const imageElement = selectedElements[0] as PlaitDrawElement;
                  if (
                    PlaitDrawElement.isImage(imageElement) &&
                    imageElement.url
                  ) {
                    const loadingInstance = MessagePlugin.loading(
                      language === 'zh'
                        ? '正在分析图片...'
                        : 'Analyzing image...',
                      0
                    );
                    try {
                      // 获取源图片的位置信息
                      const sourceRect = getRectangleByElements(
                        board,
                        [imageElement],
                        false
                      );
                      const result = await splitAndInsertImages(
                        board,
                        imageElement.url,
                        {
                          sourceRect: {
                            x: sourceRect.x,
                            y: sourceRect.y,
                            width: sourceRect.width,
                            height: sourceRect.height,
                          },
                          scrollToResult: true,
                        }
                      );
                      MessagePlugin.close(loadingInstance);
                      if (result.success) {
                        MessagePlugin.success(
                          language === 'zh'
                            ? `成功拆分为 ${result.count} 张图片`
                            : `Split into ${result.count} images`
                        );
                      } else {
                        MessagePlugin.warning(
                          result.error ||
                            (language === 'zh' ? '拆图失败' : 'Split failed')
                        );
                      }
                    } catch (error: any) {
                      MessagePlugin.close(loadingInstance);
                      MessagePlugin.error(
                        error.message ||
                          (language === 'zh' ? '拆图失败' : 'Split failed')
                      );
                    }
                  }
                }}
              />
            )}
            {state.hasLayerDecomposition && (
              <ToolButton
                className="ai-layer-decomposition"
                key="ai-layer-decomposition"
                type="icon"
                icon={<Layers3 size={16} />}
                visible={true}
                tooltip={language === 'zh' ? 'AI 分层' : 'AI Layers'}
                aria-label={language === 'zh' ? 'AI 分层' : 'AI Layers'}
                data-track="toolbar_click_ai_layer_decomposition"
                onPointerUp={() => {
                  const image = selectedElements[0];
                  if (
                    PlaitDrawElement.isDrawElement(image) &&
                    PlaitDrawElement.isImage(image) &&
                    image.url
                  ) {
                    const launch = startAutomaticLayerDecomposition(
                      board,
                      image.id,
                      image.url
                    );
                    if (!launch.started) return;

                    const loadingInstance = MessagePlugin.loading(
                      language === 'zh'
                        ? '正在进行 AI 分层...'
                        : 'Creating AI layers...',
                      0
                    );
                    void launch.promise
                      .then((outcome) => {
                        MessagePlugin.close(loadingInstance);
                        if (outcome.kind === 'test') {
                          MessagePlugin.warning(
                            language === 'zh'
                              ? '当前为测试后端，未接入真实 AI 分层模型；源图片未修改'
                              : 'The test backend has no real AI layer model; the source image is unchanged'
                          );
                          return;
                        }
                        MessagePlugin.success(
                          language === 'zh'
                            ? `已生成 ${outcome.layerCount} 个可编辑图层`
                            : `Created ${outcome.layerCount} editable layers`
                        );
                      })
                      .catch((error) => {
                        MessagePlugin.close(loadingInstance);
                        if (
                          error instanceof
                          LayerDecompositionCorrectionRequiredError
                        ) {
                          MessagePlugin.warning(
                            language === 'zh'
                              ? '分层质量未通过，源图片保持不变'
                              : 'Layer quality check failed; the source image is unchanged'
                          );
                          return;
                        }
                        MessagePlugin.error(
                          error instanceof Error
                            ? error.message
                            : language === 'zh'
                            ? '图片分层失败'
                            : 'Layer decomposition failed'
                        );
                      });
                  }
                }}
              />
            )}
            {state.hasImageEdit && (
              <ToolButton
                className="image-edit"
                key="image-edit"
                type="icon"
                icon={<Pencil size={15} />}
                visible={true}
                tooltip={language === 'zh' ? '编辑图片' : 'Edit Image'}
                aria-label={language === 'zh' ? '编辑图片' : 'Edit Image'}
                data-track="toolbar_click_image_edit"
                onPointerUp={() => {
                  const imageElement = selectedElements[0] as PlaitDrawElement;
                  if (
                    PlaitDrawElement.isImage(imageElement) &&
                    imageElement.url
                  ) {
                    setEditingImageUrl(imageElement.url);
                    setEditingImageElement(imageElement);
                    setShowImageEditor(true);
                  }
                }}
              />
            )}
            {state.hasMaskInvert && (
              <ToolButton
                className="mask-invert"
                key="mask-invert"
                type="icon"
                icon={<PaintBucket size={15} />}
                visible={true}
                selected={state.maskInverted}
                tooltip={
                  language === 'zh'
                    ? '蒙层反选：反向填充图片'
                    : 'Invert mask: fill the opposite area'
                }
                aria-label={
                  language === 'zh'
                    ? '蒙层反选'
                    : 'Invert mask'
                }
                data-track="toolbar_click_mask_invert"
                onPointerUp={toggleMaskInvert}
              />
            )}
            {state.hasDownloadable && (
              <ToolButton
                className="download"
                key="download"
                type="icon"
                icon={<DownloadIcon />}
                visible={true}
                tooltip={language === 'zh' ? '下载' : 'Download'}
                aria-label={language === 'zh' ? '下载' : 'Download'}
                data-track="toolbar_click_download"
                onPointerUp={async () => {
                  // 收集可下载的元素
                  const downloadItems: BatchDownloadItem[] = [];
                  for (const element of selectedElements) {
                    if (
                      PlaitDrawElement.isDrawElement(element) &&
                      PlaitDrawElement.isImage(element) &&
                      element.url
                    ) {
                      downloadItems.push({ url: element.url, type: 'image' });
                    } else if (
                      isVideoElement(element) &&
                      (element as any).url
                    ) {
                      downloadItems.push({
                        url: (element as any).url,
                        type: 'video',
                      });
                    } else if (
                      isAudioNodeElement(element) &&
                      element.audioUrl
                    ) {
                      downloadItems.push({
                        url: element.audioUrl,
                        type: 'audio',
                        filename: buildDownloadFilename(
                          element.title,
                          'audio',
                          'mp3'
                        ),
                        audioMetadata: {
                          title: element.title,
                          prompt: element.prompt,
                          tags: element.tags,
                          coverUrl: element.previewImageUrl,
                          artist: element.modelVersion || 'Aitu',
                          album: 'Aitu Generated',
                        },
                      });
                    }
                  }

                  if (downloadItems.length === 0) {
                    MessagePlugin.warning(
                      language === 'zh'
                        ? '没有可下载的内容'
                        : 'No downloadable content'
                    );
                    return;
                  }

                  const loadingMsg =
                    downloadItems.length > 1
                      ? language === 'zh'
                        ? '正在打包下载...'
                        : 'Packaging download...'
                      : language === 'zh'
                      ? '正在下载...'
                      : 'Downloading...';

                  const loadingInstance = MessagePlugin.loading(loadingMsg, 0);
                  try {
                    // 特殊处理 blob: URL（可能是从IndexedDB缓存的视频）
                    const { unifiedCacheService } = await import(
                      '../../../services/unified-cache-service'
                    );
                    const { downloadFromBlob } = await import('@aitu/utils');

                    const processedItems: BatchDownloadItem[] = [];

                    for (const item of downloadItems) {
                      if (item.url.startsWith('blob:')) {
                        // 从 URL fragment 提取 taskId (格式: blob:http://...#merged-video-{timestamp})
                        const hashIndex = item.url.indexOf('#');
                        const taskId =
                          hashIndex > 0
                            ? item.url.substring(hashIndex + 1)
                            : null;

                        // console.log('[Download] Processing blob URL:', { url: item.url, taskId });

                        if (taskId && taskId.startsWith('merged-video-')) {
                          // 从 IndexedDB 获取缓存的视频
                          const cachedBlob =
                            await unifiedCacheService.getCachedBlob(taskId);
                          if (cachedBlob) {
                            const mimeType = cachedBlob.type || 'video/webm';
                            const ext = mimeType.startsWith('video/mp4')
                              ? 'mp4'
                              : mimeType.startsWith('video/webm')
                              ? 'webm'
                              : 'bin';
                            const filename = `merged-video-${Date.now()}.${ext}`;

                            // console.log('[Download] Downloading from IndexedDB cache:', { taskId, ext, size: cachedBlob.size });
                            downloadFromBlob(cachedBlob, filename);
                            continue;
                          } else {
                            console.warn(
                              '[Download] Cache not found for taskId:',
                              taskId
                            );
                          }
                        }

                        // 如果没有 taskId 或缓存不存在，尝试直接 fetch blob URL
                        try {
                          // console.log('[Download] Fetching blob URL directly');
                          const response = await fetch(item.url);
                          const blob = await response.blob();
                          const ext = blob.type.startsWith('video/mp4')
                            ? 'mp4'
                            : blob.type.startsWith('video/webm')
                            ? 'webm'
                            : blob.type.startsWith('image/')
                            ? 'png'
                            : 'bin';
                          const filename = `${item.type}_${Date.now()}.${ext}`;
                          downloadFromBlob(blob, filename);
                        } catch (fetchError) {
                          console.error(
                            '[Download] Failed to fetch blob URL:',
                            fetchError
                          );
                          throw new Error(
                            `Failed to download ${item.type}: Blob URL inaccessible`
                          );
                        }
                      } else {
                        // 普通 URL，添加到待处理列表
                        processedItems.push(item);
                      }
                    }

                    // 下载普通 URL
                    let downloadResult;
                    if (processedItems.length > 0) {
                      downloadResult = await smartDownload(processedItems);
                    }

                    MessagePlugin.close(loadingInstance);
                    if (
                      downloadResult?.openedCount &&
                      downloadResult.downloadedCount === 0
                    ) {
                      MessagePlugin.success(
                        language === 'zh'
                          ? downloadResult.openedCount > 1
                            ? `已打开 ${downloadResult.openedCount} 个链接，请在新标签页下载`
                            : '资源不支持直接下载，已打开链接'
                          : downloadResult.openedCount > 1
                          ? `Opened ${downloadResult.openedCount} links for download`
                          : 'Opened link for download'
                      );
                    } else {
                      MessagePlugin.success(
                        downloadItems.length > 1
                          ? language === 'zh'
                            ? `已下载 ${downloadItems.length} 个文件`
                            : `Downloaded ${downloadItems.length} files`
                          : language === 'zh'
                          ? '下载成功'
                          : 'Download complete'
                      );
                    }
                  } catch (error: any) {
                    MessagePlugin.close(loadingInstance);
                    MessagePlugin.error(
                      error.message ||
                        (language === 'zh' ? '下载失败' : 'Download failed')
                    );
                  }
                }}
              />
            )}
            {state.hasMergeable && (
              <ToolButton
                className="merge"
                key="merge"
                type="icon"
                icon={<MergeIcon />}
                visible={true}
                tooltip={language === 'zh' ? '合并为图片' : 'Merge to Image'}
                aria-label={language === 'zh' ? '合并为图片' : 'Merge to Image'}
                data-track="toolbar_click_merge"
                onPointerUp={async () => {
                  const endTrack = trackMemory('图片合并');
                  const loadingInstance = MessagePlugin.loading(
                    language === 'zh' ? '正在合并...' : 'Merging...',
                    0
                  );
                  try {
                    // 检查是否有外部图片可能导致 CORS 问题
                    const externalImageElements = selectedElements.filter(
                      (el: any) => {
                        const url = el.url || el.imageUrl;
                        if (!url) return false;
                        // 跳过本地路径和缓存路径
                        if (
                          url.startsWith('/') ||
                          url.startsWith('data:') ||
                          url.startsWith('blob:')
                        )
                          return false;
                        // 检查是否为外部 URL
                        try {
                          const urlObj = new URL(url);
                          return urlObj.origin !== location.origin;
                        } catch {
                          return false;
                        }
                      }
                    );

                    if (externalImageElements.length > 0) {
                      // 尝试预检查外部图片是否可访问
                      const corsCheckPromises = externalImageElements.map(
                        async (el: any) => {
                          const url = el.url || el.imageUrl;
                          try {
                            // 尝试 cors 模式 fetch（带超时）
                            const controller = new AbortController();
                            const timeoutId = setTimeout(
                              () => controller.abort(),
                              3000
                            );
                            const response = await fetch(url, {
                              method: 'HEAD',
                              mode: 'cors',
                              signal: controller.signal,
                            });
                            clearTimeout(timeoutId);
                            return response.ok;
                          } catch {
                            return false;
                          }
                        }
                      );

                      const corsResults = await Promise.all(corsCheckPromises);
                      const hasCorsProblem = corsResults.some((ok) => !ok);

                      if (hasCorsProblem) {
                        MessagePlugin.close(loadingInstance);
                        MessagePlugin.warning(
                          language === 'zh'
                            ? '部分外部图片无法访问，请先下载到本地后再合并'
                            : 'Some external images are inaccessible. Please download them locally first.'
                        );
                        endTrack();
                        return;
                      }
                    }

                    // 获取选中元素的边界矩形
                    const boundingRect = getRectangleByElements(
                      board,
                      selectedElements,
                      false
                    );

                    // 按照元素在画布中的顺序排序，保持层级
                    const sortedElements = [...selectedElements].sort(
                      (a, b) => {
                        const indexA = board.children.findIndex(
                          (child) => child.id === a.id
                        );
                        const indexB = board.children.findIndex(
                          (child) => child.id === b.id
                        );
                        return indexA - indexB;
                      }
                    );

                    // 使用 toImage 将选中元素转换为图片
                    const imageDataUrl = await safeToImage(board, {
                      elements: sortedElements,
                      fillStyle: 'transparent',
                      inlineStyleClassNames: '.extend,.emojis,.text',
                      ratio: 2, // 2x 清晰度
                    });

                    if (!imageDataUrl) {
                      throw new Error(
                        language === 'zh'
                          ? '合并失败：无法生成图片'
                          : 'Merge failed: Unable to generate image'
                      );
                    }

                    // 创建图片并裁剪透明边框
                    const img = new Image();
                    await new Promise<void>((resolve, reject) => {
                      img.onload = () => resolve();
                      img.onerror = () =>
                        reject(new Error('Failed to load merged image'));
                      img.src = imageDataUrl;
                    });

                    // 创建 canvas 裁剪透明边框
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                      throw new Error('Failed to get canvas context');
                    }

                    // 绘制图片到 canvas
                    ctx.drawImage(img, 0, 0);

                    // 使用公共方法去除白边和透明边，同时获取裁剪偏移信息
                    const trimResult =
                      trimCanvasWhiteAndTransparentBorderWithInfo(canvas);
                    const {
                      canvas: trimmedCanvas,
                      left,
                      top,
                      trimmedWidth,
                      trimmedHeight,
                    } = trimResult;

                    // 转换为 Blob
                    const blob = await new Promise<Blob>((resolve, reject) => {
                      trimmedCanvas.toBlob((b) => {
                        if (b) resolve(b);
                        else
                          reject(new Error('Failed to convert canvas to blob'));
                      }, 'image/png');
                    });

                    // 使用虚拟路径 URL（由 Service Worker 拦截返回缓存内容）
                    // 避免 @plait/core 的 toImage 对 data: URL 发起 fetch 请求（会被 CSP 阻止）
                    const { unifiedCacheService } = await import(
                      '../../../services/unified-cache-service'
                    );
                    const taskId = `merged-image-${Date.now()}`;
                    const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
                    // 使用相对路径作为缓存 key，避免代理场景下 origin 不一致导致缓存查找失败
                    const cacheKey = stableUrl;

                    // 缓存到 Cache API
                    await unifiedCacheService.cacheMediaFromBlob(
                      cacheKey,
                      blob,
                      'image',
                      { taskId }
                    );

                    // 计算插入位置（考虑裁剪偏移）
                    // 原始边界矩形是基于 ratio=2 的，所以需要除以 2
                    const scale = 2; // ratio 参数
                    const insertX = boundingRect.x + left / scale;
                    const insertY = boundingRect.y + top / scale;
                    const insertWidth = trimmedWidth / scale;
                    const insertHeight = trimmedHeight / scale;

                    // 删除原元素
                    deleteFragment(board);

                    // 记录插入前的元素数量
                    const childrenCountBefore = board.children.length;

                    // 插入裁剪后的图片（使用虚拟路径 URL）
                    const imageItem = {
                      url: stableUrl,
                      width: insertWidth,
                      height: insertHeight,
                    };
                    DrawTransforms.insertImage(board, imageItem, [
                      insertX,
                      insertY,
                    ]);

                    // 选中新插入的图片元素
                    const newElement = board.children[childrenCountBefore];
                    if (newElement) {
                      clearSelectedElement(board);
                      addSelectedElement(board, newElement);
                    }

                    MessagePlugin.close(loadingInstance);
                    endTrack();
                    MessagePlugin.success(
                      language === 'zh'
                        ? `已将 ${selectedElements.length} 个元素合并为图片`
                        : `Merged ${selectedElements.length} elements into image`
                    );
                  } catch (error: any) {
                    MessagePlugin.close(loadingInstance);
                    endTrack();
                    MessagePlugin.error(
                      error.message ||
                        (language === 'zh' ? '合并失败' : 'Merge failed')
                    );
                  }
                }}
              />
            )}
            {state.hasVideoMergeable && (
              <ToolButton
                className="video-merge"
                key="video-merge"
                type="icon"
                icon={<VideoMergeIcon />}
                visible={true}
                tooltip={language === 'zh' ? '合成视频' : 'Merge Videos'}
                aria-label={language === 'zh' ? '合成视频' : 'Merge Videos'}
                data-track="toolbar_click_video_merge"
                onPointerUp={async () => {
                  // 收集所有视频元素的 URL
                  const videoUrls: string[] = [];
                  for (const element of selectedElements) {
                    if (isVideoElement(element) && (element as any).url) {
                      videoUrls.push((element as any).url);
                    }
                  }

                  if (videoUrls.length < 2) {
                    MessagePlugin.warning(
                      language === 'zh'
                        ? '请选择至少2个视频'
                        : 'Please select at least 2 videos'
                    );
                    return;
                  }

                  const loadingInstance = MessagePlugin.loading(
                    language === 'zh' ? '正在合成视频...' : 'Merging videos...',
                    0
                  );

                  try {
                    const result = await mergeVideos(
                      videoUrls,
                      (progress, stage) => {
                        const stageText = {
                          downloading:
                            language === 'zh'
                              ? '下载视频...'
                              : 'Downloading videos...',
                          decoding:
                            language === 'zh'
                              ? '解码视频...'
                              : 'Decoding videos...',
                          encoding:
                            language === 'zh'
                              ? '编码视频...'
                              : 'Encoding videos...',
                          finalizing:
                            language === 'zh'
                              ? '生成文件中...'
                              : 'Finalizing...',
                        };
                        // console.log(`[VideoMerge] ${stageText[stage]} ${Math.round(progress)}%`);
                      }
                    );

                    MessagePlugin.close(loadingInstance);

                    // console.log('[VideoMerge] Merge result:', {
                    //   blobType: result.blob.type,
                    //   blobSize: result.blob.size,
                    //   url: result.url,
                    //   duration: result.duration,
                    //   urlType: result.url.startsWith('blob:') ? 'blob' : 'other'
                    // });

                    // 插入合成后的视频到画布（而不是下载）
                    try {
                      // 导入插入视频的工具
                      const { quickInsert } = await import(
                        '../../../mcp/tools/canvas-insertion'
                      );
                      // console.log('[VideoMerge] Attempting to insert video with URL:', result.url);
                      await quickInsert('video', result.url);

                      MessagePlugin.success(
                        language === 'zh'
                          ? `已合成并插入 ${videoUrls.length} 个视频`
                          : `Merged and inserted ${videoUrls.length} videos`
                      );
                    } catch (insertError) {
                      console.error(
                        '[VideoMerge] Failed to insert video:',
                        insertError
                      );
                      // 如果插入失败，回退到下载
                      // 根据 Blob 类型确定文件扩展名
                      const mimeType = result.blob.type || 'video/webm';
                      const extension = mimeType.startsWith('video/mp4')
                        ? 'mp4'
                        : 'webm';

                      // console.log('[VideoMerge] Fallback download:', {
                      //   mimeType,
                      //   extension,
                      //   blobSize: result.blob.size,
                      //   url: result.url
                      // });

                      // 创建一个新的 Blob URL 确保 MIME 类型正确
                      const downloadBlob = new Blob([result.blob], {
                        type: mimeType,
                      });
                      const downloadUrl = URL.createObjectURL(downloadBlob);

                      const link = document.createElement('a');
                      link.href = downloadUrl;
                      link.download = `merged-video-${Date.now()}.${extension}`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);

                      // 延迟释放 URL
                      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

                      MessagePlugin.warning(
                        language === 'zh'
                          ? `视频已合成，但插入失败，已自动下载 (${extension.toUpperCase()})`
                          : `Video merged but failed to insert, downloaded as ${extension.toUpperCase()}`
                      );
                    }
                  } catch (error: any) {
                    MessagePlugin.close(loadingInstance);
                    MessagePlugin.error(
                      error.message ||
                        (language === 'zh'
                          ? '视频合成失败'
                          : 'Video merge failed')
                    );
                  }
                }}
              />
            )}

            {/* ========== 右侧：公共操作图标（位置相对固定） ========== */}
            <PopupLayerControlButton
              board={board}
              key={'layer-control'}
              title={t('textEffect.layer')}
            />
            {state.hasImage3DTransform && selectedElements.length === 1 && (
              <PopupImage3DTransformButton
                board={board}
                element={selectedElements[0]}
                key="image-3d-transform"
                language={language as 'zh' | 'en'}
                selectionRect={selectionRect}
                title={language === 'zh' ? '图片 3D 调节' : 'Image 3D Adjust'}
              />
            )}
            {state.hasSizeInput && <SizeInput board={board} key="size-input" />}
            {/* Frame 幻灯片播放按钮 - 选中单个 Frame 时显示 */}
            {state.hasFramePlay && (
              <ToolButton
                className="frame-play"
                key="frame-play"
                type="icon"
                icon={<Play size={15} />}
                visible={true}
                tooltip={language === 'zh' ? '播放幻灯片' : 'Play Slideshow'}
                aria-label={language === 'zh' ? '播放幻灯片' : 'Play Slideshow'}
                data-track="toolbar_click_frame_play"
                onPointerUp={() => {
                  const frameElement = selectedElements.find((el) =>
                    isFrameElement(el)
                  );
                  if (frameElement) {
                    setSlideshowFrameId(frameElement.id);
                    setShowSlideshow(true);
                  }
                }}
              />
            )}
            {state.hasAudioPlayer && (
              <ToolButton
                className="audio-player-play"
                key="audio-player-play"
                type="icon"
                icon={<Play size={15} />}
                visible={true}
                tooltip={
                  language === 'zh'
                    ? '在音乐播放器中播放'
                    : 'Play in Music Player'
                }
                aria-label={
                  language === 'zh'
                    ? '在音乐播放器中播放'
                    : 'Play in Music Player'
                }
                data-track="toolbar_click_audio_player_play"
                onPointerUp={() => {
                  const audioElement = selectedElements.find((el) =>
                    isAudioNodeElement(el)
                  );
                  if (!audioElement || !isAudioNodeElement(audioElement)) {
                    return;
                  }

                  void openMusicPlayerToolAndPlay({
                    source: {
                      elementId: audioElement.id,
                      audioUrl: audioElement.audioUrl,
                      title: audioElement.title,
                      duration: audioElement.duration,
                      previewImageUrl: audioElement.previewImageUrl,
                      providerTaskId: audioElement.providerTaskId,
                      clipId: audioElement.clipId,
                      clipIds: audioElement.clipIds,
                    },
                    queue: getCanvasAudioPlaybackQueue(board.children),
                    queueTab: {
                      queueId: AUDIO_PLAYLIST_CANVAS_AUDIO_ID,
                      queueName: AUDIO_PLAYLIST_CANVAS_AUDIO_LABEL,
                    },
                  });
                }}
              />
            )}
            <ToolButton
              className="duplicate"
              key={8}
              type="icon"
              icon={<DuplicateIcon />}
              visible={true}
              tooltip={t('general.duplicate')}
              aria-label={t('general.duplicate')}
              data-track="toolbar_click_duplicate"
              onPointerUp={() => {
                // 检查是否只选中了 Frame
                const isOnlyFrameSelected =
                  selectedElements.length === 1 &&
                  isFrameElement(selectedElements[0]);

                if (isOnlyFrameSelected) {
                  // 使用 Frame 专用的复制逻辑
                  const clonedFrame = duplicateFrame(
                    board,
                    selectedElements[0] as any,
                    language as 'zh' | 'en'
                  );

                  // 如果复制成功，自动聚焦到新 Frame
                  if (clonedFrame) {
                    focusFrame(board, clonedFrame);
                  }
                } else {
                  // Card 也走标准 fragment 克隆逻辑，确保生成新元素
                  duplicateElements(board);
                }
              }}
            />
            {state.hasRegenerateImage && (
              <ToolButton
                className="regenerate-image"
                key="regenerate-image"
                type="icon"
                icon={<RefreshCw size={15} />}
                visible={true}
                tooltip={
                  language === 'zh'
                    ? '以当前提示词再次生成'
                    : 'Generate again with the current prompt'
                }
                aria-label={language === 'zh' ? '再次生成' : 'Generate again'}
                data-track="toolbar_click_regenerate_image_prefill"
                onPointerUp={() => {
                  void prefillSelectedImageTaskToAIInput();
                }}
              />
            )}
            <ToolButton
              className="trash"
              key={9}
              type="icon"
              icon={<TrashIcon />}
              visible={true}
              tooltip={t('general.delete')}
              aria-label={t('general.delete')}
              data-track="toolbar_click_delete"
              onPointerUp={() => {
                deleteFragment(board);
              }}
            />
          </Stack.Row>
        </Island>
      )}

      {/* 视频帧选择弹窗 */}
      {showVideoFrameSelector && selectedVideoElement && (
        <VideoFrameSelector
          visible={showVideoFrameSelector}
          videoUrl={(selectedVideoElement as any).url || ''}
          onClose={() => {
            setShowVideoFrameSelector(false);
            setSelectedVideoElement(null);
          }}
          onConfirm={async (frameImageDataUrl: string, timestamp: number) => {
            try {
              if (selectedVideoElement) {
                await insertVideoFrame(
                  board,
                  selectedVideoElement,
                  frameImageDataUrl,
                  timestamp
                );
              }
            } catch (error) {
              console.error('Failed to insert video frame:', error);
              // 可以在这里添加错误提示
            }
          }}
        />
      )}

      {/* 图片编辑器 */}
      {showImageEditor && editingImageUrl && (
        <Suspense fallback={null}>
          <ImageEditor
            visible={showImageEditor}
            imageUrl={editingImageUrl}
            showOverwrite={!!editingImageElement}
            onClose={() => {
              setShowImageEditor(false);
              setEditingImageUrl('');
              setEditingImageElement(null);
            }}
            onOverwrite={async (editedImageUrl: string) => {
              if (editingImageElement) {
                try {
                  // 创建虚拟路径 URL 缓存编辑后的图片
                  const { unifiedCacheService } = await import(
                    '../../../services/unified-cache-service'
                  );
                  const taskId = `edited-image-${Date.now()}`;
                  const stableUrl = `/__aitu_cache__/image/${taskId}.png`;

                  // 将 data URL 转换为 Blob
                  const response = await fetch(editedImageUrl);
                  const blob = await response.blob();

                  // 缓存到 Cache API
                  await unifiedCacheService.cacheMediaFromBlob(
                    stableUrl,
                    blob,
                    'image',
                    { taskId }
                  );

                  // 加载编辑后的图片获取其实际尺寸
                  const img = new Image();
                  await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () =>
                      reject(new Error('Failed to load edited image'));
                    img.src = editedImageUrl;
                  });

                  // 使用 Transforms.setNode 更新画布中的图片元素
                  const elementIndex = board.children.findIndex(
                    (child) => child.id === editingImageElement.id
                  );
                  if (elementIndex >= 0) {
                    const element = board.children[elementIndex] as any;
                    const { newPoints } = await calculateEditedImagePoints(
                      {
                        url: element.url,
                        width: element.width,
                        height: element.height,
                        points: element.points || [
                          [0, 0],
                          [0, 0],
                        ],
                      },
                      img.naturalWidth,
                      img.naturalHeight
                    );

                    Transforms.setNode(
                      board,
                      {
                        url: stableUrl,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        points: newPoints,
                      } as Partial<PlaitElement>,
                      [elementIndex]
                    );
                  }
                } catch (error) {
                  console.error('Failed to update image:', error);
                  MessagePlugin.error(
                    language === 'zh' ? '更新失败' : 'Update failed'
                  );
                }
              }
            }}
            onInsert={async (editedImageUrl: string) => {
              try {
                // 创建虚拟路径 URL 缓存编辑后的图片
                const { unifiedCacheService } = await import(
                  '../../../services/unified-cache-service'
                );
                const taskId = `edited-image-${Date.now()}`;
                const stableUrl = `/__aitu_cache__/image/${taskId}.png`;

                // 将 data URL 转换为 Blob
                const response = await fetch(editedImageUrl);
                const blob = await response.blob();

                // 缓存到 Cache API
                await unifiedCacheService.cacheMediaFromBlob(
                  stableUrl,
                  blob,
                  'image',
                  { taskId }
                );

                // 加载图片获取尺寸
                const img = new Image();
                await new Promise<void>((resolve, reject) => {
                  img.onload = () => resolve();
                  img.onerror = () =>
                    reject(new Error('Failed to load edited image'));
                  img.src = editedImageUrl;
                });

                // 在当前图片旁边插入新图片
                const origination = getViewportOrigination(board);
                const offsetX = editingImageElement
                  ? editingImageElement.points[1][0] -
                    editingImageElement.points[0][0] +
                    20
                  : 0;
                const baseX = editingImageElement
                  ? editingImageElement.points[0][0]
                  : origination
                  ? origination[0] + 100
                  : 100;
                const baseY = editingImageElement
                  ? editingImageElement.points[0][1]
                  : origination
                  ? origination[1] + 100
                  : 100;

                // 使用 insertImageFromUrl 插入图片
                const insertPoint: [number, number] = [baseX + offsetX, baseY];
                await insertImageFromUrl(
                  board,
                  stableUrl,
                  insertPoint,
                  false,
                  { width: img.naturalWidth, height: img.naturalHeight },
                  false,
                  true
                );
              } catch (error) {
                console.error('Failed to insert image:', error);
                MessagePlugin.error(
                  language === 'zh' ? '插入失败' : 'Insert failed'
                );
              }
            }}
          />
        </Suspense>
      )}

      {/* 文本属性设置面板 */}
      {state.hasText && (
        <TextPropertyPanel
          board={board}
          isOpen={showPropertyPanel}
          onClose={() => setShowPropertyPanel(false)}
          currentFontSize={state.fontSize}
          currentFontFamily={state.marks?.['font-family']}
          currentColor={state.marks?.color}
          toolbarRect={toolbarRect}
          selectionRect={selectionRect}
        />
      )}

      {/* Frame 幻灯片播放 */}
      {showSlideshow && (
        <Suspense fallback={null}>
          <FrameSlideshow
            visible={showSlideshow}
            board={board}
            onClose={() => {
              setShowSlideshow(false);
              setSlideshowFrameId(undefined);
            }}
            initialFrameId={slideshowFrameId}
          />
        </Suspense>
      )}
    </>
  );
};

export const getMindElementState = (
  board: PlaitBoard,
  element: MindElement
) => {
  const marks: Record<string, any> = getTextMarksByElement(element);
  return {
    // 使用 getElementFillValue 获取完整的填充信息（支持渐变/图片填充）
    fill: getElementFillValue(element),
    strokeColor: getStrokeColorByMindElement(board, element),
    fontSize: marks['font-size'],
    marks,
  };
};

export const getDrawElementState = (
  board: PlaitBoard,
  element: PlaitDrawElement
) => {
  const marks: Record<string, any> = getTextMarksByElement(element);
  return {
    // 使用 getElementFillValue 获取完整的填充信息（支持渐变/图片填充）
    fill: getElementFillValue(element),
    strokeColor: getStrokeColorByDrawElement(board, element),
    fontSize: marks['font-size'],
    marks,
  };
};

export const getElementState = (board: PlaitBoard) => {
  const selectedElements = getSelectedElements(board);

  // 没有选中元素时返回默认状态
  if (selectedElements.length === 0) {
    return { fill: undefined, strokeColor: undefined };
  }

  // 单选时使用原有逻辑
  if (selectedElements.length === 1) {
    const selectedElement = selectedElements[0];
    // Card 元素返回 fillColor 作为 fill 值
    if (isCardElement(selectedElement)) {
      return { fill: selectedElement.fillColor, strokeColor: undefined };
    }
    if (MindElement.isMindElement(board, selectedElement)) {
      return getMindElementState(board, selectedElement);
    }
    if (Freehand.isFreehand(selectedElement)) {
      return getFreehandElementState(board, selectedElement);
    }
    if (PenPath.isPenPath(selectedElement)) {
      return getPenPathElementState(board, selectedElement);
    }
    return getDrawElementState(board, selectedElement as PlaitDrawElement);
  }

  // 多选时计算混合状态
  return getMultiSelectElementState(board, selectedElements);
};

/**
 * 获取多选元素的混合状态
 * 如果所有元素的某个属性值相同，则返回该值；否则返回 undefined（表示混合状态）
 */
const getMultiSelectElementState = (
  board: PlaitBoard,
  elements: PlaitElement[]
) => {
  const states = elements.map((element) => {
    // Card 元素
    if (isCardElement(element)) {
      return {
        fill: element.fillColor as string | undefined,
        strokeColor: undefined,
      };
    }
    if (MindElement.isMindElement(board, element)) {
      return getMindElementState(board, element);
    }
    if (Freehand.isFreehand(element)) {
      return getFreehandElementState(board, element);
    }
    if (PenPath.isPenPath(element)) {
      return getPenPathElementState(board, element);
    }
    if (PlaitDrawElement.isDrawElement(element)) {
      return getDrawElementState(board, element);
    }
    return { fill: undefined, strokeColor: undefined };
  });

  // 计算混合状态：如果所有值相同则返回该值，否则返回 undefined
  const fills = states.map((s) => s.fill);
  const strokeColors = states.map((s) => s.strokeColor);

  const allFillsSame = fills.every((f) => f === fills[0]);
  const allStrokeColorsSame = strokeColors.every((c) => c === strokeColors[0]);

  return {
    fill: allFillsSame ? fills[0] : undefined,
    strokeColor: allStrokeColorsSame ? strokeColors[0] : undefined,
  };
};

export const getFreehandElementState = (
  board: PlaitBoard,
  element: Freehand
) => {
  return {
    // 使用 getElementFillValue 获取完整的填充信息（支持渐变/图片填充）
    fill: getElementFillValue(element),
    strokeColor: getStrokeColorByFreehandElement(board, element),
  };
};

export const getPenPathElementState = (
  _board: PlaitBoard,
  element: PenPath
) => {
  return {
    // 使用 getElementFillValue 获取完整的填充信息（支持渐变/图片填充）
    fill: getElementFillValue(element),
    strokeColor: element.strokeColor,
    cornerRadius: element.cornerRadius,
  };
};

export const hasFillProperty = (board: PlaitBoard, element: PlaitElement) => {
  // Card 元素支持填充颜色
  if (isCardElement(element)) {
    return true;
  }
  if (MindElement.isMindElement(board, element)) {
    return true;
  }
  if (isClosedCustomGeometry(board, element)) {
    return true;
  }
  // 画笔闭合图形支持填充（检测路径点是否闭合）
  if (Freehand.isFreehand(element)) {
    return isClosedPoints(element.points);
  }
  // 钢笔闭合图形支持填充
  if (PenPath.isPenPath(element)) {
    return element.closed;
  }
  if (PlaitDrawElement.isDrawElement(element)) {
    return (
      PlaitDrawElement.isShapeElement(element) &&
      !PlaitDrawElement.isImage(element) &&
      !PlaitDrawElement.isText(element) &&
      isClosedDrawElement(element)
    );
  }
  return false;
};

export const hasStrokeProperty = (board: PlaitBoard, element: PlaitElement) => {
  if (MindElement.isMindElement(board, element)) {
    return true;
  }
  if (Freehand.isFreehand(element)) {
    return true;
  }
  if (PenPath.isPenPath(element)) {
    return true;
  }
  if (PlaitDrawElement.isDrawElement(element)) {
    return (
      (PlaitDrawElement.isShapeElement(element) &&
        !PlaitDrawElement.isImage(element) &&
        !PlaitDrawElement.isText(element)) ||
      PlaitDrawElement.isArrowLine(element) ||
      PlaitDrawElement.isVectorLine(element) ||
      PlaitDrawElement.isTable(element)
    );
  }
  return false;
};

export const hasStrokeStyleProperty = (
  board: PlaitBoard,
  element: PlaitElement
) => {
  return hasStrokeProperty(board, element);
};

export const hasTextProperty = (board: PlaitBoard, element: PlaitElement) => {
  if (MindElement.isMindElement(board, element)) {
    return true;
  }
  if (PlaitDrawElement.isDrawElement(element)) {
    return isDrawElementsIncludeText([element]);
  }
  return false;
};

export const getColorPropertyValue = (color: string) => {
  if (color === NO_COLOR) {
    return null;
  } else {
    return color;
  }
};

/**
 * 检查元素是否支持布尔运算
 * 支持的元素类型：
 * - 闭合的 PenPath
 * - 闭合的 Freehand
 * - 闭合的 PlaitDrawElement 形状（不包括图片、文本、箭头线、矢量线）
 */
export const supportsBooleanOperation = (
  board: PlaitBoard,
  element: PlaitElement
): boolean => {
  // 闭合的钢笔路径
  if (PenPath.isPenPath(element)) {
    return element.closed;
  }

  // 闭合的手绘路径
  if (Freehand.isFreehand(element)) {
    const points = element.points;
    if (!points || points.length < 3) return false;
    // 检查是否闭合（首尾点接近）
    const first = points[0];
    const last = points[points.length - 1];
    const distance = Math.hypot(last[0] - first[0], last[1] - first[1]);
    return distance <= 10;
  }

  // PlaitDrawElement 形状元素
  if (PlaitDrawElement.isDrawElement(element)) {
    // 排除图片、文本、箭头线、矢量线
    if (
      PlaitDrawElement.isImage(element) ||
      PlaitDrawElement.isText(element) ||
      PlaitDrawElement.isArrowLine(element) ||
      PlaitDrawElement.isVectorLine(element)
    ) {
      return false;
    }
    // 必须是闭合的形状
    return (
      PlaitDrawElement.isShapeElement(element) && isClosedDrawElement(element)
    );
  }

  // 思维导图元素不支持布尔运算
  if (MindElement.isMindElement(board, element)) {
    return false;
  }

  return false;
};
