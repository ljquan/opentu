/**
 * 图片编辑器核心组件
 * 抽象出的公共编辑器，供 ImageEditor（独立模态框）和 UnifiedMediaViewer（嵌入式）复用
 */

import React, {
  useState,
  useMemo,
  useId,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  X,
  Crop,
  Sliders,
  Check,
  RotateCcw,
  Replace,
  ImagePlus,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Eye,
  Scissors,
  ImageUpscale,
} from 'lucide-react';
import { MessagePlugin } from '../../utils/message-plugin';
import {
  EditMode,
  CropArea,
  FilterType,
  FilterParams,
  SaveAction,
  DEFAULT_FILTER_PARAMS,
  ASPECT_RATIO_PRESETS,
  FILTER_PRESETS,
  type ResizeImageHandler,
} from './types';
import { CropPanel } from './CropPanel';
import { FilterPanel } from './FilterPanel';
import { ImageResizePanel } from './ImageResizePanel';
import { DecodedImagePreview } from './DecodedImagePreview';
import './ImageEditorCore.scss';
import { HoverTip } from '../shared/hover';
import { loadImageElementForCanvas } from '../../data/image';
import {
  imageSplitCuts,
  splitImageRegions,
  imageResizeDimensions,
} from '../../utils/canvas-image-tools';
import type { DataURL } from '../../types';
import type {
  ImageResizeOptions,
  ImageResizeStage,
} from '../../services/canvas-operations/resize-canvas-image';

// Tooltip z-index 需要高于模态框
const TOOLTIP_Z_INDEX = 10010;

/**
 * 检测图片白边的配置
 */
interface WhitespaceDetectionOptions {
  /** 白色阈值 (0-255)，像素值高于此值被认为是白色，默认 250 */
  threshold?: number;
  /** 容差百分比 (0-1)，允许边缘有一定比例的非白色像素，默认 0.02 */
  tolerance?: number;
  /** 最小内容尺寸（像素），防止裁剪过度，默认 50 */
  minContentSize?: number;
}

/**
 * 检测图片白边并返回裁剪区域
 * @param img 图片元素
 * @param options 检测配置
 * @returns 裁剪区域，如果没有检测到白边则返回 null
 */
function detectWhitespace(
  img: HTMLImageElement,
  options: WhitespaceDetectionOptions = {}
): { x: number; y: number; width: number; height: number } | null {
  const { threshold = 250, tolerance = 0.02, minContentSize = 50 } = options;

  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // 创建 canvas 读取像素数据
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  /**
   * 检查单个像素是否接近白色
   */
  const isWhitePixel = (index: number): boolean => {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    // 透明像素也视为白色
    if (a < 10) return true;
    // RGB 都接近白色
    return r >= threshold && g >= threshold && b >= threshold;
  };

  /**
   * 检查一行是否大部分是白色
   */
  const isRowWhite = (y: number): boolean => {
    let whiteCount = 0;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (isWhitePixel(index)) whiteCount++;
    }
    return whiteCount / width >= 1 - tolerance;
  };

  /**
   * 检查一列是否大部分是白色
   */
  const isColWhite = (x: number): boolean => {
    let whiteCount = 0;
    for (let y = 0; y < height; y++) {
      const index = (y * width + x) * 4;
      if (isWhitePixel(index)) whiteCount++;
    }
    return whiteCount / height >= 1 - tolerance;
  };

  // 从上往下找第一行非白色
  let top = 0;
  while (top < height && isRowWhite(top)) {
    top++;
  }

  // 从下往上找第一行非白色
  let bottom = height - 1;
  while (bottom > top && isRowWhite(bottom)) {
    bottom--;
  }

  // 从左往右找第一列非白色
  let left = 0;
  while (left < width && isColWhite(left)) {
    left++;
  }

  // 从右往左找第一列非白色
  let right = width - 1;
  while (right > left && isColWhite(right)) {
    right--;
  }

  // 计算裁剪区域
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;

  // 检查是否有效裁剪（有白边且内容区域足够大）
  const hasWhitespace =
    top > 0 || left > 0 || right < width - 1 || bottom < height - 1;
  const contentSizeValid =
    cropWidth >= minContentSize && cropHeight >= minContentSize;

  if (!hasWhitespace || !contentSizeValid) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: cropWidth,
    height: cropHeight,
  };
}

export interface ImageEditorCoreProps {
  /** 图片 URL */
  imageUrl: string;
  /** 是否显示覆盖选项 */
  showOverwrite?: boolean;
  /** 覆盖原图回调 */
  onOverwrite?: (editedImageUrl: string) => void;
  /** 插入到画布回调 */
  onInsert?: (editedImageUrl: string) => void;
  onSplit?: (images: string[]) => Promise<void>;
  onResize?: ResizeImageHandler;
  onBusyChange?: (busy: boolean) => void;
  /** 关闭回调（可选，有则显示关闭按钮） */
  onClose?: () => void;
  /** 保存回调（可选，有则显示保存按钮） */
  onSave?: (editedImageUrl: string) => void;
  /** 自定义类名 */
  className?: string;
}

/** 编辑状态（用于保存/恢复） */
export interface ImageEditState {
  cropArea: CropArea | null;
  confirmedCropArea: CropArea | null;
  aspectRatio: number | null;
  filterType: FilterType;
  filterParams: FilterParams;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface ImageEditorCoreRef {
  /** 重置编辑状态 */
  reset: () => void;
  /** 触发保存流程 */
  save: () => void;
  /** 是否有修改 */
  hasChanges: () => boolean;
  /** 获取当前编辑状态 */
  getState: () => ImageEditState;
  /** 设置编辑状态 */
  setState: (state: ImageEditState) => void;
}

export const ImageEditorCore = forwardRef<
  ImageEditorCoreRef,
  ImageEditorCoreProps
>(
  (
    {
      imageUrl,
      showOverwrite = false,
      onOverwrite,
      onInsert,
      onSplit,
      onResize,
      onBusyChange,
      onClose,
      onSave,
      className,
    },
    ref
  ) => {
    // 编辑模式
    const [mode, setMode] = useState<EditMode | 'split' | 'resize'>('crop');
    const [resizeTarget, setResizeTarget] = useState(2048);
    const [resizeAlgorithm, setResizeAlgorithm] =
      useState<ImageResizeOptions['algorithm']>('high');
    const [resizeStage, setResizeStage] = useState<ImageResizeStage | null>(
      null
    );
    const [resizeError, setResizeError] = useState('');
    const resizeController = useRef<AbortController | null>(null);
    const [horizontalCuts, setHorizontalCuts] = useState('50');
    const [verticalCuts, setVerticalCuts] = useState('50');
    const [splitError, setSplitError] = useState('');
    const [splitting, setSplitting] = useState(false);
    const processing = splitting || resizeStage !== null;
    useEffect(() => {
      onBusyChange?.(processing);
    }, [processing, onBusyChange]);
    const splitLock = useRef(false);
    const splitPreviewRef = useRef<HTMLCanvasElement>(null);
    const splitHelpId = useId();
    const splitErrorId = useId();

    // 裁剪状态
    const [cropArea, setCropArea] = useState<CropArea | null>(null);
    const [aspectRatio, setAspectRatio] = useState<number | null>(null);

    // 滤镜状态
    const [filterType, setFilterType] = useState<FilterType>('none');
    const [filterParams, setFilterParams] = useState<FilterParams>(
      DEFAULT_FILTER_PARAMS
    );

    // 变换状态
    const [rotation, setRotation] = useState(0);
    const [flipH, setFlipH] = useState(false);
    const [flipV, setFlipV] = useState(false);

    // 图片原始尺寸
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

    // 显示比例（用于将图片适配到预览区域）
    const [displayScale, setDisplayScale] = useState(1);

    // 缩放状态
    const [zoom, setZoom] = useState(1);
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 5;
    const ZOOM_STEP = 0.1;

    // 拖拽平移状态
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });

    // 保存选项弹窗
    const [showSaveOptions, setShowSaveOptions] = useState(false);
    const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);

    // 对比原图
    const [isComparing, setIsComparing] = useState(false);

    // 已确认的裁剪区域（用于在其他模式下预览裁剪效果）
    const [confirmedCropArea, setConfirmedCropArea] = useState<CropArea | null>(
      null
    );

    // 智能去白边检测中
    const [isDetectingWhitespace, setIsDetectingWhitespace] = useState(false);

    // 历史记录（撤销/重做）
    const [history, setHistory] = useState<ImageEditState[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const isUndoingRef = useRef(false);

    // refs
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [loadedImage, setLoadedImage] = useState<{
      source: string;
      image: HTMLImageElement;
    } | null>(null);
    const [imageLoadError, setImageLoadError] = useState('');
    const previewImage =
      loadedImage?.source === imageUrl ? loadedImage.image : null;
    const previewRef = useRef<HTMLDivElement>(null);
    const prevImageUrlRef = useRef<string | null>(null);

    // 当图片 URL 变化时重置所有编辑状态
    useEffect(() => {
      if (
        prevImageUrlRef.current !== null &&
        prevImageUrlRef.current !== imageUrl
      ) {
        // 图片变化，重置所有状态
        setCropArea(null);
        setConfirmedCropArea(null);
        setAspectRatio(null);
        setFilterType('none');
        setFilterParams(DEFAULT_FILTER_PARAMS);
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
        setZoom(1);
        setDisplayScale(1); // 重置显示比例，等新图片加载后重新计算
        setImageSize({ width: 0, height: 0 }); // 重置图片尺寸，防止用旧尺寸初始化裁剪区域
        setPanOffset({ x: 0, y: 0 });
        setMode('crop');
        setHorizontalCuts('50');
        setVerticalCuts('50');
        setSplitError('');
        // 重置历史记录
        const initialState: ImageEditState = {
          cropArea: null,
          confirmedCropArea: null,
          aspectRatio: null,
          filterType: 'none',
          filterParams: DEFAULT_FILTER_PARAMS,
          rotation: 0,
          flipH: false,
          flipV: false,
        };
        setHistory([initialState]);
        setHistoryIndex(0);
      }
      prevImageUrlRef.current = imageUrl;
    }, [imageUrl]);

    // 加载图片
    useEffect(() => {
      let active = true;
      imageRef.current = null;
      setLoadedImage(null);
      setImageLoadError('');
      setResizeError('');
      setResizeStage(null);
      if (!imageUrl) return;
      void loadImageElementForCanvas(imageUrl as DataURL)
        .then((img) => {
          if (!active) return;
          imageRef.current = img;
          setLoadedImage({ source: imageUrl, image: img });
          setResizeTarget(
            Math.max(
              2048,
              Math.max(
                img.naturalWidth || img.width,
                img.naturalHeight || img.height
              ) * 2
            )
          );
          setResizeAlgorithm('high');
          setResizeError('');
          setImageSize({
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
          });
        })
        .catch(() => {
          if (active) {
            setImageLoadError('图片加载失败，请确认原图仍可访问。');
            MessagePlugin.error('图片加载失败');
          }
        });

      return () => {
        active = false;
        imageRef.current = null;
        resizeController.current?.abort();
        resizeController.current = null;
      };
    }, [imageUrl]);

    const resizePreview = useMemo(() => {
      if (!previewImage) return { output: null, error: '' };
      try {
        const width = previewImage.naturalWidth || previewImage.width;
        const height = previewImage.naturalHeight || previewImage.height;
        const output = imageResizeDimensions(width, height, resizeTarget);
        if (output.width === width && output.height === height)
          throw new Error('目标尺寸与原图一致，请调整目标长边');
        return { output, error: '' };
      } catch (error) {
        return {
          output: null,
          error: error instanceof Error ? error.message : '参数无效',
        };
      }
    }, [previewImage, resizeTarget]);

    const handleResize = async () => {
      if (
        !onResize ||
        !previewImage ||
        resizePreview.error ||
        resizeController.current
      )
        return;
      const controller = new AbortController();
      resizeController.current = controller;
      setResizeError('');
      setResizeStage('resizing');
      try {
        const output = await onResize(
          {
            image: previewImage,
            target: resizeTarget,
            algorithm: resizeAlgorithm,
          },
          (stage) => {
            if (!controller.signal.aborted) setResizeStage(stage);
          },
          controller.signal
        );
        if (!controller.signal.aborted) {
          MessagePlugin.success(
            `缩放完成：${output.width} × ${output.height} 像素，已加入画布，原图保留。`,
            4000
          );
          onClose?.();
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setResizeError(
            error instanceof Error ? error.message : '图片处理失败'
          );
      } finally {
        if (resizeController.current === controller)
          resizeController.current = null;
        if (!controller.signal.aborted) setResizeStage(null);
      }
    };

    const splitPreview = useMemo(() => {
      if (!imageSize.width || !imageSize.height) return null;
      try {
        const x = imageSplitCuts(verticalCuts, imageSize.width);
        const y = imageSplitCuts(horizontalCuts, imageSize.height);
        return { x, y, count: (x.length - 1) * (y.length - 1), error: '' };
      } catch (error) {
        return {
          x: [],
          y: [],
          count: 0,
          error: error instanceof Error ? error.message : '分割线无效',
        };
      }
    }, [imageSize, horizontalCuts, verticalCuts]);

    useEffect(() => {
      const canvas = splitPreviewRef.current;
      const image = imageRef.current;
      if (mode !== 'split' || !canvas || !image) return;
      try {
        const scale = Math.min(
          1,
          560 / imageSize.width,
          560 / imageSize.height
        );
        canvas.width = Math.max(1, Math.round(imageSize.width * scale));
        canvas.height = Math.max(1, Math.round(imageSize.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法创建图片预览');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } catch (error) {
        setSplitError(error instanceof Error ? error.message : '图片预览失败');
      }
    }, [mode, imageSize, imageUrl]);

    const handleSplit = async () => {
      if (
        !onSplit ||
        !imageRef.current ||
        !splitPreview ||
        splitPreview.error ||
        splitLock.current
      )
        return;
      splitLock.current = true;
      setSplitting(true);
      setSplitError('');
      try {
        await onSplit(
          splitImageRegions(imageRef.current, splitPreview.x, splitPreview.y)
        );
        onClose?.();
      } catch (error) {
        setSplitError(
          error instanceof Error ? error.message : '拆图失败，请重试'
        );
      } finally {
        splitLock.current = false;
        setSplitting(false);
      }
    };

    // 初始化历史记录（仅首次加载时）
    useEffect(() => {
      if (imageUrl && history.length === 0) {
        const initialState: ImageEditState = {
          cropArea: null,
          confirmedCropArea: null,
          aspectRatio: null,
          filterType: 'none',
          filterParams: DEFAULT_FILTER_PARAMS,
          rotation: 0,
          flipH: false,
          flipV: false,
        };
        setHistory([initialState]);
        setHistoryIndex(0);
      }
    }, [imageUrl, history.length]);

    // 计算显示比例（让图片适配到预览区域）
    useEffect(() => {
      if (!previewRef.current || imageSize.width === 0) return;

      const updateDisplayScale = () => {
        const container = previewRef.current;
        if (!container) return;

        const containerWidth = container.clientWidth - 80; // 留出边距
        const containerHeight = container.clientHeight - 80;

        // 确保容器有有效尺寸
        if (containerWidth <= 0 || containerHeight <= 0) return;

        const scaleX = containerWidth / imageSize.width;
        const scaleY = containerHeight / imageSize.height;
        const newScale = Math.min(scaleX, scaleY, 1);

        // 只有当计算出有效的比例时才更新
        if (newScale > 0 && isFinite(newScale)) {
          setDisplayScale(newScale);
        }
      };

      // 延迟一帧执行，确保布局已完成
      requestAnimationFrame(updateDisplayScale);

      // 监听容器大小变化
      const resizeObserver = new ResizeObserver(updateDisplayScale);
      resizeObserver.observe(previewRef.current);

      return () => resizeObserver.disconnect();
    }, [imageSize]);

    // 监听状态变化并保存历史（带防抖）
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
      // 跳过撤销/重做操作和初始化
      if (isUndoingRef.current || history.length === 0) return;

      // 防抖保存
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveToHistory();
      }, 300);

      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      };
    }, [
      rotation,
      flipH,
      flipV,
      filterType,
      filterParams,
      aspectRatio,
      confirmedCropArea,
    ]);

    // 获取当前滤镜 CSS
    const getFilterCSS = useCallback(() => {
      if (filterType !== 'none') {
        const preset = FILTER_PRESETS.find((p) => p.type === filterType);
        if (preset) return preset.filter;
      }

      // 使用自定义参数
      const parts: string[] = [];
      if (filterParams.brightness !== 100) {
        parts.push(`brightness(${filterParams.brightness}%)`);
      }
      if (filterParams.contrast !== 100) {
        parts.push(`contrast(${filterParams.contrast}%)`);
      }
      if (filterParams.saturate !== 100) {
        parts.push(`saturate(${filterParams.saturate}%)`);
      }
      if (filterParams.blur > 0) {
        parts.push(`blur(${filterParams.blur}px)`);
      }
      if (filterParams.grayscale > 0) {
        parts.push(`grayscale(${filterParams.grayscale}%)`);
      }
      if (filterParams.sepia > 0) {
        parts.push(`sepia(${filterParams.sepia}%)`);
      }
      if (filterParams.hueRotate !== 0) {
        parts.push(`hue-rotate(${filterParams.hueRotate}deg)`);
      }
      if (filterParams.invert > 0) {
        parts.push(`invert(${filterParams.invert}%)`);
      }

      return parts.length > 0 ? parts.join(' ') : 'none';
    }, [filterType, filterParams]);

    // 获取变换 CSS
    const getTransformCSS = useCallback(() => {
      const transforms: string[] = [];
      if (rotation !== 0) {
        transforms.push(`rotate(${rotation}deg)`);
      }
      if (flipH) {
        transforms.push('scaleX(-1)');
      }
      if (flipV) {
        transforms.push('scaleY(-1)');
      }
      return transforms.join(' ');
    }, [rotation, flipH, flipV]);

    // 获取当前编辑状态
    const getCurrentState = useCallback(
      (): ImageEditState => ({
        cropArea,
        confirmedCropArea,
        aspectRatio,
        filterType,
        filterParams,
        rotation,
        flipH,
        flipV,
      }),
      [
        cropArea,
        confirmedCropArea,
        aspectRatio,
        filterType,
        filterParams,
        rotation,
        flipH,
        flipV,
      ]
    );

    // 应用编辑状态
    const applyState = useCallback((state: ImageEditState) => {
      isUndoingRef.current = true;
      setCropArea(state.cropArea);
      setConfirmedCropArea(state.confirmedCropArea);
      setAspectRatio(state.aspectRatio);
      setFilterType(state.filterType);
      setFilterParams(state.filterParams);
      setRotation(state.rotation);
      setFlipH(state.flipH);
      setFlipV(state.flipV);
      // 在下一帧重置标志
      requestAnimationFrame(() => {
        isUndoingRef.current = false;
      });
    }, []);

    // 保存状态到历史记录
    const saveToHistory = useCallback(() => {
      if (isUndoingRef.current) return;

      const currentState = getCurrentState();
      setHistory((prev) => {
        // 如果当前不在历史末尾，删除后面的记录
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(currentState);
        // 限制历史记录数量
        if (newHistory.length > 50) {
          newHistory.shift();
          return newHistory;
        }
        return newHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 49));
    }, [getCurrentState, historyIndex]);

    // 撤销
    const handleUndo = useCallback(() => {
      if (historyIndex <= 0) return;
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      applyState(history[newIndex]);
    }, [historyIndex, history, applyState]);

    // 重做
    const handleRedo = useCallback(() => {
      if (historyIndex >= history.length - 1) return;
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      applyState(history[newIndex]);
    }, [historyIndex, history, applyState]);

    // 检查是否可以撤销/重做
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    // 检查是否有修改
    const hasChanges = useCallback(() => {
      return (
        confirmedCropArea !== null ||
        cropArea !== null ||
        rotation !== 0 ||
        flipH ||
        flipV ||
        filterType !== 'none' ||
        Object.keys(filterParams).some(
          (key) =>
            filterParams[key as keyof FilterParams] !==
            DEFAULT_FILTER_PARAMS[key as keyof FilterParams]
        )
      );
    }, [
      confirmedCropArea,
      cropArea,
      rotation,
      flipH,
      flipV,
      filterType,
      filterParams,
    ]);

    // 重置所有编辑
    const handleReset = useCallback(() => {
      if (splitLock.current || resizeController.current) return;
      setHorizontalCuts('50');
      setVerticalCuts('50');
      setSplitError('');
      setCropArea(null);
      const sourceImage = imageRef.current;
      if (sourceImage)
        setResizeTarget(
          Math.max(
            2048,
            Math.max(
              sourceImage.naturalWidth || sourceImage.width,
              sourceImage.naturalHeight || sourceImage.height
            ) * 2
          )
        );
      setResizeAlgorithm('high');
      setResizeError('');
      setConfirmedCropArea(null);
      setAspectRatio(null);
      setFilterType('none');
      setFilterParams(DEFAULT_FILTER_PARAMS);
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
      // 重置历史
      setHistory([]);
      setHistoryIndex(-1);
    }, []);

    // 应用编辑并保存
    const handleSave = useCallback(async () => {
      const img = imageRef.current;
      if (!img) {
        MessagePlugin.error('图片未加载');
        return;
      }

      const loadingInstance = MessagePlugin.loading('正在处理图片...', 0);

      try {
        // 创建临时 canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('无法创建 Canvas 上下文');
        }

        // 计算最终尺寸
        let finalWidth = img.naturalWidth;
        let finalHeight = img.naturalHeight;
        let sourceX = 0;
        let sourceY = 0;
        let sourceWidth = img.naturalWidth;
        let sourceHeight = img.naturalHeight;

        // 应用裁剪（优先使用已确认的裁剪区域）
        const effectiveCropArea = confirmedCropArea || cropArea;
        if (effectiveCropArea) {
          sourceX = effectiveCropArea.x;
          sourceY = effectiveCropArea.y;
          sourceWidth = effectiveCropArea.width;
          sourceHeight = effectiveCropArea.height;
          finalWidth = effectiveCropArea.width;
          finalHeight = effectiveCropArea.height;
        }

        // 处理旋转（90度的倍数会交换宽高）
        const normalizedRotation = ((rotation % 360) + 360) % 360;
        if (normalizedRotation === 90 || normalizedRotation === 270) {
          [finalWidth, finalHeight] = [finalHeight, finalWidth];
        }

        canvas.width = finalWidth;
        canvas.height = finalHeight;

        // 应用变换
        ctx.save();
        ctx.translate(finalWidth / 2, finalHeight / 2);

        if (rotation !== 0) {
          ctx.rotate((rotation * Math.PI) / 180);
        }
        if (flipH) {
          ctx.scale(-1, 1);
        }
        if (flipV) {
          ctx.scale(1, -1);
        }

        // 计算绘制位置（考虑旋转后的尺寸交换）
        let drawWidth = sourceWidth;
        let drawHeight = sourceHeight;
        if (normalizedRotation === 90 || normalizedRotation === 270) {
          [drawWidth, drawHeight] = [drawHeight, drawWidth];
        }

        // 应用滤镜
        const filterCSS = getFilterCSS();
        if (filterCSS !== 'none') {
          ctx.filter = filterCSS;
        }

        // 绘制图片
        ctx.drawImage(
          img,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          -drawWidth / 2,
          -drawHeight / 2,
          drawWidth,
          drawHeight
        );

        ctx.restore();

        // 转换为 data URL
        const editedImageUrl = canvas.toDataURL('image/png');

        MessagePlugin.close(loadingInstance);

        // 如果有 onSave 回调，直接调用
        if (onSave) {
          onSave(editedImageUrl);
          return;
        }

        // 否则显示保存选项
        setPendingImageUrl(editedImageUrl);
        setShowSaveOptions(true);
      } catch (error) {
        MessagePlugin.close(loadingInstance);
        MessagePlugin.error(
          error instanceof Error ? error.message : '图片处理失败'
        );
      }
    }, [
      confirmedCropArea,
      cropArea,
      rotation,
      flipH,
      flipV,
      getFilterCSS,
      onSave,
    ]);

    // 处理保存选项
    const handleSaveAction = useCallback(
      (action: SaveAction) => {
        if (!pendingImageUrl) return;

        switch (action) {
          case 'overwrite':
            onOverwrite?.(pendingImageUrl);
            break;
          case 'insert':
            onInsert?.(pendingImageUrl);
            break;
          case 'download': {
            const link = document.createElement('a');
            link.href = pendingImageUrl;
            link.download = `edited-image-${Date.now()}.png`;
            link.click();
            MessagePlugin.success('图片已下载');
            break;
          }
        }

        setShowSaveOptions(false);
        setPendingImageUrl(null);
        onClose?.();
      },
      [pendingImageUrl, onOverwrite, onInsert, onClose]
    );

    // 处理比例变化
    const handleAspectRatioChange = useCallback((ratio: number | null) => {
      setAspectRatio(ratio);
      // 重置裁剪区域以应用新比例
      setCropArea(null);
      setConfirmedCropArea(null);
    }, []);

    // 处理滤镜预设选择
    const handleFilterPresetSelect = useCallback((type: FilterType) => {
      setFilterType(type);
      // 选择预设时重置自定义参数
      if (type !== 'none') {
        setFilterParams(DEFAULT_FILTER_PARAMS);
      }
    }, []);

    // 处理滤镜参数变化
    const handleFilterParamChange = useCallback(
      (param: keyof FilterParams, value: number) => {
        setFilterParams((prev) => ({ ...prev, [param]: value }));
        // 调整参数时切换到自定义模式
        setFilterType('none');
      },
      []
    );

    // 处理旋转
    const handleRotate = useCallback((delta: number) => {
      setRotation((prev) => prev + delta);
    }, []);

    // 处理翻转
    const handleFlipH = useCallback(() => {
      setFlipH((prev) => !prev);
    }, []);

    const handleFlipV = useCallback(() => {
      setFlipV((prev) => !prev);
    }, []);

    // 确认裁剪（应用裁剪区域到图片）
    const handleConfirmCrop = useCallback(() => {
      if (!cropArea || !imageRef.current) return;

      // 保存已确认的裁剪区域，用于在其他模式下预览裁剪效果
      setConfirmedCropArea({ ...cropArea });
      // 切换到滤镜模式以查看裁剪效果（历史记录会在状态更新后自动保存）
      setMode('filter');
    }, [cropArea]);

    // 智能去白边
    const handleAutoTrimWhitespace = useCallback(() => {
      const img = imageRef.current;
      if (!img) {
        MessagePlugin.warning('图片未加载完成');
        return;
      }

      setIsDetectingWhitespace(true);

      // 使用 requestAnimationFrame 避免阻塞 UI
      requestAnimationFrame(() => {
        try {
          const detectedArea = detectWhitespace(img);

          if (detectedArea) {
            // 清除固定比例，因为智能裁剪可能不符合预设比例
            setAspectRatio(null);
            // 设置裁剪区域
            setCropArea(detectedArea);
            MessagePlugin.success('已检测到白边，裁剪框已自动调整');
          } else {
            MessagePlugin.info('未检测到明显的白边');
          }
        } catch (error) {
          MessagePlugin.error('检测白边失败');
        } finally {
          setIsDetectingWhitespace(false);
        }
      });
    }, []);

    // 键盘快捷键监听
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (mode === 'split' || mode === 'resize') return;
        // 避免在输入框中触发
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          return;
        }

        // Enter 键确认裁剪
        if (e.key === 'Enter' && mode === 'crop' && cropArea) {
          e.preventDefault();
          handleConfirmCrop();
        }

        // Ctrl/Cmd + Z 撤销
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        }

        // Ctrl/Cmd + Shift + Z 或 Ctrl/Cmd + Y 重做
        if (
          (e.ctrlKey || e.metaKey) &&
          (e.key === 'y' || (e.key === 'z' && e.shiftKey))
        ) {
          e.preventDefault();
          handleRedo();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mode, cropArea, handleConfirmCrop, handleUndo, handleRedo]);

    // 缩放处理
    const handleZoomIn = useCallback(() => {
      setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
    }, []);

    const handleZoomOut = useCallback(() => {
      setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
    }, []);

    const handleZoomReset = useCallback(() => {
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    }, []);

    // 滚轮缩放处理
    const handleWheel = useCallback((e: WheelEvent) => {
      e.preventDefault();
      // 根据 deltaY 大小动态调整缩放幅度
      // 触控板 deltaY 较小（1-30），鼠标滚轮较大（100+）
      const absDelta = Math.abs(e.deltaY);
      let zoomDelta: number;

      if (absDelta > 50) {
        // 鼠标滚轮：使用固定步长
        zoomDelta = e.deltaY > 0 ? -0.15 : 0.15;
      } else {
        // 触控板：使用渐进式缩放，更平滑
        zoomDelta = -e.deltaY * 0.008;
      }

      setZoom((prev) =>
        Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + zoomDelta))
      );
    }, []);

    // 使用 useEffect 添加 wheel 事件监听器（需要 passive: false 才能 preventDefault）
    useEffect(() => {
      const preview = previewRef.current;
      if (!preview) return;

      preview.addEventListener('wheel', handleWheel, { passive: false });
      return () => preview.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    // 处理模式切换
    const handleModeChange = useCallback(
      (newMode: EditMode | 'split' | 'resize') => {
        if (splitLock.current || resizeController.current) return;
        if (newMode === 'crop' && confirmedCropArea && !cropArea) {
          // 切换到裁剪模式时，如果有已确认的裁剪区域，将它设置为当前的裁剪区域
          setCropArea({ ...confirmedCropArea });
        }
        setMode(newMode);
      },
      [confirmedCropArea, cropArea]
    );

    // 拖拽平移处理
    const handlePanStart = useCallback(
      (e: React.MouseEvent) => {
        // 避免与裁剪框拖动冲突
        if (mode === 'crop') return;

        setIsPanning(true);
        setPanStart({
          x: e.clientX - panOffset.x,
          y: e.clientY - panOffset.y,
        });
      },
      [mode, panOffset]
    );

    const handlePanMove = useCallback(
      (e: React.MouseEvent) => {
        if (!isPanning) return;

        setPanOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      },
      [isPanning, panStart]
    );

    const handlePanEnd = useCallback(() => {
      setIsPanning(false);
    }, []);

    // 全局鼠标事件处理（用于拖动超出预览区域）
    useEffect(() => {
      if (!isPanning) return;

      const handleMouseMove = (e: MouseEvent) => {
        setPanOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      };

      const handleMouseUp = () => {
        setIsPanning(false);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [isPanning, panStart]);

    // 重置缩放和平移当切换模式时
    useEffect(() => {
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    }, [mode]);

    // 暴露给父组件的方法
    useImperativeHandle(ref, () => ({
      reset: handleReset,
      save: mode === 'resize' ? handleResize : handleSave,
      hasChanges,
      getState: getCurrentState,
      setState: applyState,
    }));

    const filterCSS = getFilterCSS();
    const transformCSS = getTransformCSS();

    return (
      <div className={`image-editor-core ${className || ''}`}>
        {/* 顶部工具栏 */}
        <div className="image-editor-core__header">
          <div className="image-editor-core__title">编辑图片</div>
          <div className="image-editor-core__actions">
            <HoverTip
              content="撤销 (Ctrl+Z)"
              theme="light"
              placement="bottom"
              zIndex={TOOLTIP_Z_INDEX}
            >
              <button
                type="button"
                className={`image-editor-core__btn ${
                  !canUndo ? 'disabled' : ''
                }`}
                onClick={handleUndo}
                disabled={!canUndo || mode === 'split' || mode === 'resize'}
              >
                <Undo2 size={18} />
              </button>
            </HoverTip>
            <HoverTip
              content="重做 (Ctrl+Y)"
              theme="light"
              placement="bottom"
              zIndex={TOOLTIP_Z_INDEX}
            >
              <button
                type="button"
                className={`image-editor-core__btn ${
                  !canRedo ? 'disabled' : ''
                }`}
                onClick={handleRedo}
                disabled={!canRedo || mode === 'split' || mode === 'resize'}
              >
                <Redo2 size={18} />
              </button>
            </HoverTip>
            <div className="image-editor-core__divider" />
            <HoverTip
              content="对比原图（按住查看）"
              theme="light"
              placement="bottom"
              zIndex={TOOLTIP_Z_INDEX}
            >
              <button
                type="button"
                className={`image-editor-core__btn ${
                  isComparing ? 'active' : ''
                }`}
                onMouseDown={() => setIsComparing(true)}
                onMouseUp={() => setIsComparing(false)}
                onMouseLeave={() => setIsComparing(false)}
                disabled={mode === 'split' || mode === 'resize'}
              >
                <Eye size={18} />
              </button>
            </HoverTip>
            <HoverTip
              content="重置"
              theme="light"
              placement="bottom"
              zIndex={TOOLTIP_Z_INDEX}
            >
              <button
                type="button"
                className="image-editor-core__btn"
                onClick={handleReset}
                disabled={processing}
              >
                <RotateCcw size={18} />
              </button>
            </HoverTip>
            {onClose && (
              <HoverTip
                content="取消"
                theme="light"
                placement="bottom"
                zIndex={TOOLTIP_Z_INDEX}
              >
                <button
                  type="button"
                  className="image-editor-core__btn"
                  aria-label="关闭图片编辑器"
                  disabled={processing}
                  onClick={onClose}
                >
                  <X size={18} />
                </button>
              </HoverTip>
            )}
            {(onSave || onOverwrite || onInsert || onSplit || onResize) && (
              <HoverTip
                content={
                  mode === 'resize'
                    ? '缩放并插入画布'
                    : mode === 'split'
                    ? '拆分并插入画布'
                    : '保存'
                }
                theme="light"
                placement="bottom"
                zIndex={TOOLTIP_Z_INDEX}
              >
                <button
                  type="button"
                  className="image-editor-core__btn image-editor-core__btn--primary"
                  aria-label={
                    mode === 'resize'
                      ? '缩放并插入画布'
                      : mode === 'split'
                      ? '拆分并插入画布'
                      : '保存图片'
                  }
                  disabled={
                    !previewImage ||
                    processing ||
                    (mode === 'resize' && !!resizePreview.error) ||
                    (mode === 'split' &&
                      (splitting || !splitPreview || !!splitPreview.error))
                  }
                  onClick={
                    mode === 'resize'
                      ? handleResize
                      : mode === 'split'
                      ? handleSplit
                      : handleSave
                  }
                >
                  <Check size={18} />
                </button>
              </HoverTip>
            )}
          </div>
        </div>

        {/* 主内容区 */}
        <div className="image-editor-core__main">
          {/* 左侧工具面板 */}
          <div className="image-editor-core__sidebar">
            {/* 模式切换 */}
            <div className="image-editor-core__mode-tabs">
              <button
                type="button"
                className={`image-editor-core__mode-tab ${
                  mode === 'crop' ? 'active' : ''
                }`}
                onClick={() => handleModeChange('crop')}
                aria-pressed={mode === 'crop'}
                disabled={processing}
              >
                <Crop size={16} />
                <span>裁剪</span>
              </button>
              {onSplit && (
                <button
                  type="button"
                  className={`image-editor-core__mode-tab ${
                    mode === 'split' ? 'active' : ''
                  }`}
                  aria-pressed={mode === 'split'}
                  disabled={processing}
                  onClick={() => handleModeChange('split')}
                >
                  <Scissors size={16} aria-hidden="true" />
                  <span>拆分</span>
                </button>
              )}
              <button
                type="button"
                className={`image-editor-core__mode-tab ${
                  mode === 'filter' ? 'active' : ''
                }`}
                onClick={() => handleModeChange('filter')}
                aria-pressed={mode === 'filter'}
                disabled={processing}
              >
                <Sliders size={16} />
                <span>滤镜</span>
              </button>
              {onResize && (
                <button
                  type="button"
                  className={`image-editor-core__mode-tab ${
                    mode === 'resize' ? 'active' : ''
                  }`}
                  aria-pressed={mode === 'resize'}
                  disabled={processing}
                  onClick={() => handleModeChange('resize')}
                >
                  <ImageUpscale size={16} aria-hidden="true" />
                  <span>缩放</span>
                </button>
              )}
            </div>

            {/* 工具面板内容 */}
            <div className="image-editor-core__panel">
              {mode === 'crop' ? (
                <CropPanel
                  aspectRatio={aspectRatio}
                  presets={ASPECT_RATIO_PRESETS}
                  onAspectRatioChange={handleAspectRatioChange}
                  rotation={rotation}
                  flipH={flipH}
                  flipV={flipV}
                  onRotate={handleRotate}
                  onFlipH={handleFlipH}
                  onFlipV={handleFlipV}
                  onConfirmCrop={handleConfirmCrop}
                  hasCropArea={!!cropArea}
                  onAutoTrimWhitespace={handleAutoTrimWhitespace}
                  isDetectingWhitespace={isDetectingWhitespace}
                />
              ) : mode === 'resize' ? (
                <ImageResizePanel
                  width={imageSize.width}
                  height={imageSize.height}
                  target={resizeTarget}
                  algorithm={resizeAlgorithm}
                  output={resizePreview.output}
                  error={resizeError || resizePreview.error}
                  stage={resizeStage}
                  onTargetChange={(value) => {
                    setResizeTarget(value);
                    setResizeError('');
                  }}
                  onAlgorithmChange={setResizeAlgorithm}
                />
              ) : mode === 'split' ? (
                <div className="image-editor-core__split-panel">
                  <p id={splitHelpId}>
                    按原图百分比设置分割线，多条用逗号分隔；留空表示该方向不拆分。裁剪、滤镜等编辑不参与拆分。
                  </p>
                  {(['horizontal', 'vertical'] as const).map((direction) => (
                    <label key={direction}>
                      {direction === 'horizontal'
                        ? '横向分割线（%）'
                        : '纵向分割线（%）'}
                      <input
                        value={
                          direction === 'horizontal'
                            ? horizontalCuts
                            : verticalCuts
                        }
                        disabled={processing}
                        aria-describedby={`${splitHelpId} ${splitErrorId}`}
                        aria-invalid={!!splitPreview?.error}
                        onChange={(event) => {
                          setSplitError('');
                          (direction === 'horizontal'
                            ? setHorizontalCuts
                            : setVerticalCuts)(event.target.value);
                        }}
                      />
                    </label>
                  ))}
                  <p role="status">
                    {splitting
                      ? '正在拆分并插入画布…'
                      : splitPreview && !splitPreview.error
                      ? `将生成 ${splitPreview.count} 张图片，原图保留。`
                      : '请设置有效的分割线。'}
                  </p>
                  <p
                    id={splitErrorId}
                    role={
                      splitError || splitPreview?.error ? 'alert' : undefined
                    }
                  >
                    {splitPreview?.error || splitError}
                  </p>
                </div>
              ) : (
                <FilterPanel
                  filterType={filterType}
                  filterParams={filterParams}
                  presets={FILTER_PRESETS}
                  image={previewImage}
                  onPresetSelect={handleFilterPresetSelect}
                  onParamChange={handleFilterParamChange}
                />
              )}
            </div>
          </div>

          {/* 预览区域 */}
          <div
            className="image-editor-core__preview"
            ref={previewRef}
            onMouseDown={handlePanStart}
            onMouseMove={handlePanMove}
            onMouseUp={handlePanEnd}
            onMouseLeave={handlePanEnd}
            style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
          >
            <div
              className="image-editor-core__canvas-wrapper"
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
              }}
            >
              {!previewImage ? (
                <p role={imageLoadError ? 'alert' : 'status'}>
                  {imageLoadError || '正在加载图片…'}
                </p>
              ) : mode === 'split' ? (
                <div
                  className="image-editor-core__split-preview"
                  style={{
                    width: imageSize.width * displayScale * zoom,
                    height: imageSize.height * displayScale * zoom,
                  }}
                >
                  <canvas
                    ref={splitPreviewRef}
                    role="img"
                    aria-label="原图与分割线预览"
                  />
                  {splitPreview && !splitPreview.error && (
                    <div
                      className="image-editor-core__split-lines"
                      aria-hidden="true"
                    >
                      {splitPreview.x.slice(1, -1).map((x) => (
                        <span
                          key={`x${x}`}
                          style={{
                            left: `${(x / imageSize.width) * 100}%`,
                            top: 0,
                            bottom: 0,
                            borderLeft: '2px solid currentColor',
                          }}
                        />
                      ))}
                      {splitPreview.y.slice(1, -1).map((y) => (
                        <span
                          key={`y${y}`}
                          style={{
                            top: `${(y / imageSize.height) * 100}%`,
                            left: 0,
                            right: 0,
                            borderTop: '2px solid currentColor',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : mode === 'resize' ? (
                <div
                  className="image-editor-core__resize-preview"
                  style={{
                    width: imageSize.width * displayScale * zoom,
                    height: imageSize.height * displayScale * zoom,
                  }}
                >
                  <DecodedImagePreview
                    image={previewImage}
                    label="缩放原图预览"
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : isComparing ? (
                // 对比模式：显示原图（保持与当前视图相同的尺寸和位置）
                confirmedCropArea ? (
                  // 有裁剪区域时，使用 clip-path 显示相同裁剪位置的原图（不带滤镜）
                  (() => {
                    const clipTop =
                      (confirmedCropArea.y / imageSize.height) * 100;
                    const clipRight =
                      ((imageSize.width -
                        confirmedCropArea.x -
                        confirmedCropArea.width) /
                        imageSize.width) *
                      100;
                    const clipBottom =
                      ((imageSize.height -
                        confirmedCropArea.y -
                        confirmedCropArea.height) /
                        imageSize.height) *
                      100;
                    const clipLeft =
                      (confirmedCropArea.x / imageSize.width) * 100;

                    return (
                      <div
                        className="image-editor-core__filter-preview"
                        style={{
                          transform: `${transformCSS} scale(${
                            displayScale * zoom
                          })`.trim(),
                          clipPath: `inset(${clipTop}% ${clipRight}% ${clipBottom}% ${clipLeft}%)`,
                        }}
                      >
                        <DecodedImagePreview
                          image={previewImage}
                          label="Original"
                        />
                      </div>
                    );
                  })()
                ) : (
                  // 无裁剪区域时，显示完整原图
                  <div
                    className="image-editor-core__filter-preview"
                    style={{
                      transform: `${transformCSS} scale(${
                        displayScale * zoom
                      })`.trim(),
                    }}
                  >
                    <DecodedImagePreview
                      image={previewImage}
                      label="Original"
                    />
                  </div>
                )
              ) : mode === 'crop' ? (
                <CropCanvas
                  key={imageUrl}
                  image={previewImage}
                  imageSize={imageSize}
                  cropArea={cropArea}
                  aspectRatio={aspectRatio}
                  rotation={rotation}
                  displayScale={displayScale}
                  flipH={flipH}
                  flipV={flipV}
                  zoom={zoom}
                  filterCSS={filterCSS}
                  onCropChange={setCropArea}
                />
              ) : confirmedCropArea ? (
                // 有已确认的裁剪区域时，使用 clip-path 裁剪效果
                (() => {
                  // 计算 clip-path inset 值（基于原始图片尺寸的百分比）
                  const clipTop =
                    (confirmedCropArea.y / imageSize.height) * 100;
                  const clipRight =
                    ((imageSize.width -
                      confirmedCropArea.x -
                      confirmedCropArea.width) /
                      imageSize.width) *
                    100;
                  const clipBottom =
                    ((imageSize.height -
                      confirmedCropArea.y -
                      confirmedCropArea.height) /
                      imageSize.height) *
                    100;
                  const clipLeft =
                    (confirmedCropArea.x / imageSize.width) * 100;

                  return (
                    <div
                      className="image-editor-core__filter-preview"
                      style={{
                        filter: filterCSS,
                        transform: `${transformCSS} scale(${
                          displayScale * zoom
                        })`.trim(),
                        clipPath: `inset(${clipTop}% ${clipRight}% ${clipBottom}% ${clipLeft}%)`,
                      }}
                    >
                      <DecodedImagePreview
                        image={previewImage}
                        label="Preview"
                      />
                    </div>
                  );
                })()
              ) : (
                <div
                  className="image-editor-core__filter-preview"
                  style={{
                    filter: filterCSS,
                    transform: `${transformCSS} scale(${
                      displayScale * zoom
                    })`.trim(),
                  }}
                >
                  <DecodedImagePreview image={previewImage} label="Preview" />
                </div>
              )}
            </div>

            {/* 缩放控制栏 */}
            <div className="image-editor-core__zoom-controls">
              <HoverTip
                content="缩小"
                theme="light"
                placement="top"
                zIndex={TOOLTIP_Z_INDEX}
              >
                <button
                  type="button"
                  className="image-editor-core__zoom-btn"
                  onClick={handleZoomOut}
                  disabled={zoom <= MIN_ZOOM}
                >
                  <ZoomOut size={16} />
                </button>
              </HoverTip>
              <span className="image-editor-core__zoom-value">
                {Math.round(zoom * 100)}%
              </span>
              <HoverTip
                content="放大"
                theme="light"
                placement="top"
                zIndex={TOOLTIP_Z_INDEX}
              >
                <button
                  type="button"
                  className="image-editor-core__zoom-btn"
                  onClick={handleZoomIn}
                  disabled={zoom >= MAX_ZOOM}
                >
                  <ZoomIn size={16} />
                </button>
              </HoverTip>
              <HoverTip
                content="重置视图"
                theme="light"
                placement="top"
                zIndex={TOOLTIP_Z_INDEX}
              >
                <button
                  type="button"
                  className="image-editor-core__zoom-btn"
                  onClick={handleZoomReset}
                >
                  <Maximize2 size={16} />
                </button>
              </HoverTip>
            </div>
          </div>
        </div>

        {/* 保存选项弹窗 */}
        {showSaveOptions && pendingImageUrl && (
          <div className="image-editor-core__save-dialog">
            <div
              className="image-editor-core__save-dialog-backdrop"
              onClick={() => setShowSaveOptions(false)}
            />
            <div className="image-editor-core__save-dialog-content">
              <h3 className="image-editor-core__save-dialog-title">保存图片</h3>
              <div className="image-editor-core__save-options">
                {showOverwrite && onOverwrite && (
                  <button
                    type="button"
                    className="image-editor-core__save-option"
                    onClick={() => handleSaveAction('overwrite')}
                  >
                    <Replace size={20} />
                    <div className="image-editor-core__save-option-content">
                      <span className="image-editor-core__save-option-label">
                        覆盖原图
                      </span>
                      <span className="image-editor-core__save-option-desc">
                        替换画布中的原图片
                      </span>
                    </div>
                  </button>
                )}
                {onInsert && (
                  <button
                    type="button"
                    className="image-editor-core__save-option"
                    onClick={() => handleSaveAction('insert')}
                  >
                    <ImagePlus size={20} />
                    <div className="image-editor-core__save-option-content">
                      <span className="image-editor-core__save-option-label">
                        插入新图片
                      </span>
                      <span className="image-editor-core__save-option-desc">
                        在画布中插入编辑后的图片
                      </span>
                    </div>
                  </button>
                )}
                <button
                  type="button"
                  className="image-editor-core__save-option"
                  onClick={() => handleSaveAction('download')}
                >
                  <Download size={20} />
                  <div className="image-editor-core__save-option-content">
                    <span className="image-editor-core__save-option-label">
                      下载到本地
                    </span>
                    <span className="image-editor-core__save-option-desc">
                      保存编辑后的图片到本地
                    </span>
                  </div>
                </button>
              </div>
              <button
                type="button"
                className="image-editor-core__save-cancel"
                onClick={() => setShowSaveOptions(false)}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
);

ImageEditorCore.displayName = 'ImageEditorCore';

/**
 * 裁剪画布组件
 */
interface CropCanvasProps {
  image: HTMLImageElement;
  imageSize: { width: number; height: number };
  cropArea: CropArea | null;
  aspectRatio: number | null;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  zoom: number;
  displayScale: number;
  filterCSS?: string;
  onCropChange: (area: CropArea | null) => void;
}

const CropCanvas: React.FC<CropCanvasProps> = ({
  image,
  imageSize,
  cropArea,
  aspectRatio,
  rotation,
  flipH,
  flipV,
  zoom,
  displayScale,
  filterCSS,
  onCropChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<'move' | 'resize' | null>(null);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [initialCrop, setInitialCrop] = useState<CropArea | null>(null);

  // 初始化裁剪区域
  useEffect(() => {
    if (!cropArea && imageSize.width > 0) {
      let newCrop: CropArea;
      if (aspectRatio) {
        // 根据比例计算初始裁剪区域
        const imgRatio = imageSize.width / imageSize.height;
        if (imgRatio > aspectRatio) {
          const cropHeight = imageSize.height;
          const cropWidth = cropHeight * aspectRatio;
          newCrop = {
            x: (imageSize.width - cropWidth) / 2,
            y: 0,
            width: cropWidth,
            height: cropHeight,
          };
        } else {
          const cropWidth = imageSize.width;
          const cropHeight = cropWidth / aspectRatio;
          newCrop = {
            x: 0,
            y: (imageSize.height - cropHeight) / 2,
            width: cropWidth,
            height: cropHeight,
          };
        }
      } else {
        // 默认使用整张图片
        newCrop = {
          x: 0,
          y: 0,
          width: imageSize.width,
          height: imageSize.height,
        };
      }
      onCropChange(newCrop);
    }
  }, [aspectRatio, imageSize, cropArea, onCropChange]);

  // 处理鼠标按下
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'move' | 'resize', handle?: string) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      setDragType(type);
      setResizeHandle(handle || null);
      setDragStart({ x: e.clientX, y: e.clientY });
      setInitialCrop(cropArea);
    },
    [cropArea]
  );

  // 处理鼠标移动
  useEffect(() => {
    if (!isDragging || !initialCrop) return;

    const handleMouseMove = (e: MouseEvent) => {
      // 计算屏幕坐标的移动距离
      let screenDeltaX = (e.clientX - dragStart.x) / (displayScale * zoom);
      let screenDeltaY = (e.clientY - dragStart.y) / (displayScale * zoom);

      // 根据旋转角度转换屏幕坐标到图片坐标
      const normalizedRotation = ((rotation % 360) + 360) % 360;
      let deltaX: number, deltaY: number;

      switch (normalizedRotation) {
        case 90:
          deltaX = screenDeltaY;
          deltaY = -screenDeltaX;
          break;
        case 180:
          deltaX = -screenDeltaX;
          deltaY = -screenDeltaY;
          break;
        case 270:
          deltaX = -screenDeltaY;
          deltaY = screenDeltaX;
          break;
        default: // 0
          deltaX = screenDeltaX;
          deltaY = screenDeltaY;
      }

      // 根据翻转状态调整移动方向（翻转在旋转之后应用）
      if (flipH) deltaX = -deltaX;
      if (flipV) deltaY = -deltaY;

      const newCrop = { ...initialCrop };

      if (dragType === 'move') {
        // 移动裁剪框
        newCrop.x = Math.max(
          0,
          Math.min(initialCrop.x + deltaX, imageSize.width - initialCrop.width)
        );
        newCrop.y = Math.max(
          0,
          Math.min(
            initialCrop.y + deltaY,
            imageSize.height - initialCrop.height
          )
        );
      } else if (dragType === 'resize' && resizeHandle) {
        const minSize = 20;

        // 根据手柄位置调整大小
        switch (resizeHandle) {
          case 'nw':
            newCrop.x = Math.min(
              initialCrop.x + deltaX,
              initialCrop.x + initialCrop.width - minSize
            );
            newCrop.y = Math.min(
              initialCrop.y + deltaY,
              initialCrop.y + initialCrop.height - minSize
            );
            newCrop.width = Math.max(minSize, initialCrop.width - deltaX);
            newCrop.height = Math.max(minSize, initialCrop.height - deltaY);
            break;
          case 'ne':
            newCrop.y = Math.min(
              initialCrop.y + deltaY,
              initialCrop.y + initialCrop.height - minSize
            );
            newCrop.width = Math.max(minSize, initialCrop.width + deltaX);
            newCrop.height = Math.max(minSize, initialCrop.height - deltaY);
            break;
          case 'sw':
            newCrop.x = Math.min(
              initialCrop.x + deltaX,
              initialCrop.x + initialCrop.width - minSize
            );
            newCrop.width = Math.max(minSize, initialCrop.width - deltaX);
            newCrop.height = Math.max(minSize, initialCrop.height + deltaY);
            break;
          case 'se':
            newCrop.width = Math.max(minSize, initialCrop.width + deltaX);
            newCrop.height = Math.max(minSize, initialCrop.height + deltaY);
            break;
          case 'n':
            newCrop.y = Math.min(
              initialCrop.y + deltaY,
              initialCrop.y + initialCrop.height - minSize
            );
            newCrop.height = Math.max(minSize, initialCrop.height - deltaY);
            break;
          case 's':
            newCrop.height = Math.max(minSize, initialCrop.height + deltaY);
            break;
          case 'w':
            newCrop.x = Math.min(
              initialCrop.x + deltaX,
              initialCrop.x + initialCrop.width - minSize
            );
            newCrop.width = Math.max(minSize, initialCrop.width - deltaX);
            break;
          case 'e':
            newCrop.width = Math.max(minSize, initialCrop.width + deltaX);
            break;
        }

        // 如果有固定比例，调整高度以匹配
        if (aspectRatio) {
          if (['e', 'w', 'ne', 'nw', 'se', 'sw'].includes(resizeHandle)) {
            newCrop.height = newCrop.width / aspectRatio;
          } else if (['n', 's'].includes(resizeHandle)) {
            newCrop.width = newCrop.height * aspectRatio;
          }
        }

        // 限制 x, y 不能为负数
        if (newCrop.x < 0) {
          newCrop.width += newCrop.x; // 减少宽度
          newCrop.x = 0;
        }
        if (newCrop.y < 0) {
          newCrop.height += newCrop.y; // 减少高度
          newCrop.y = 0;
        }

        // 限制宽高不能超出图片边界
        newCrop.width = Math.min(newCrop.width, imageSize.width - newCrop.x);
        newCrop.height = Math.min(newCrop.height, imageSize.height - newCrop.y);

        // 确保最小尺寸
        newCrop.width = Math.max(minSize, newCrop.width);
        newCrop.height = Math.max(minSize, newCrop.height);

        // 如果有固定比例，需要重新调整以满足边界限制
        if (aspectRatio) {
          const maxWidthByHeight = newCrop.height * aspectRatio;
          const maxHeightByWidth = newCrop.width / aspectRatio;

          if (newCrop.width > maxWidthByHeight) {
            newCrop.width = maxWidthByHeight;
          } else if (newCrop.height > maxHeightByWidth) {
            newCrop.height = maxHeightByWidth;
          }
        }
      }

      onCropChange(newCrop);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragType(null);
      setResizeHandle(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    isDragging,
    dragType,
    resizeHandle,
    dragStart,
    initialCrop,
    displayScale,
    zoom,
    rotation,
    flipH,
    flipV,
    imageSize,
    aspectRatio,
    onCropChange,
  ]);

  // 应用缩放后的显示尺寸
  const displayWidth = imageSize.width * displayScale * zoom;
  const displayHeight = imageSize.height * displayScale * zoom;

  const transformStyle = {
    transform: `rotate(${rotation}deg) ${flipH ? 'scaleX(-1)' : ''} ${
      flipV ? 'scaleY(-1)' : ''
    }`.trim(),
  };

  // 根据旋转和翻转状态计算正确的 cursor 样式
  const getCursorForHandle = (handle: string): string => {
    const cursorMap: Record<string, string> = {
      nw: 'nw-resize',
      ne: 'ne-resize',
      sw: 'sw-resize',
      se: 'se-resize',
      n: 'n-resize',
      s: 's-resize',
      w: 'w-resize',
      e: 'e-resize',
    };

    // 旋转映射表：每 90 度顺时针旋转一次的映射
    const rotateMap: Record<string, string> = {
      nw: 'ne',
      ne: 'se',
      se: 'sw',
      sw: 'nw',
      n: 'e',
      e: 's',
      s: 'w',
      w: 'n',
    };

    let adjustedHandle = handle;

    // 先处理旋转（标准化到 0, 90, 180, 270）
    const normalizedRotation = ((rotation % 360) + 360) % 360;
    const rotationSteps = Math.round(normalizedRotation / 90) % 4;

    // 应用旋转变换
    for (let i = 0; i < rotationSteps; i++) {
      adjustedHandle = rotateMap[adjustedHandle] || adjustedHandle;
    }

    // 再处理翻转
    // 水平翻转：左右互换
    if (flipH) {
      if (adjustedHandle.includes('w')) {
        adjustedHandle = adjustedHandle.replace('w', 'e');
      } else if (adjustedHandle.includes('e')) {
        adjustedHandle = adjustedHandle.replace('e', 'w');
      }
    }

    // 垂直翻转：上下互换
    if (flipV) {
      if (adjustedHandle.includes('n')) {
        adjustedHandle = adjustedHandle.replace('n', 's');
      } else if (adjustedHandle.includes('s')) {
        adjustedHandle = adjustedHandle.replace('s', 'n');
      }
    }

    return cursorMap[adjustedHandle] || 'pointer';
  };

  return (
    <div ref={containerRef} className="crop-canvas">
      <div
        className="crop-canvas__image-container"
        style={{
          width: displayWidth,
          height: displayHeight,
          ...transformStyle,
        }}
      >
        <DecodedImagePreview
          image={image}
          label="Crop"
          style={{ width: '100%', height: '100%', filter: filterCSS || 'none' }}
        />

        {/* 裁剪遮罩 */}
        {cropArea && (
          <>
            <div className="crop-canvas__overlay" />
            <div
              className="crop-canvas__crop-area"
              style={{
                left: cropArea.x * displayScale * zoom,
                top: cropArea.y * displayScale * zoom,
                width: cropArea.width * displayScale * zoom,
                height: cropArea.height * displayScale * zoom,
              }}
              onMouseDown={(e) => handleMouseDown(e, 'move')}
            >
              {/* 裁剪框内的图片 */}
              <div className="crop-canvas__crop-image">
                <DecodedImagePreview
                  image={image}
                  style={{
                    position: 'absolute',
                    left: -cropArea.x * displayScale * zoom,
                    top: -cropArea.y * displayScale * zoom,
                    width: displayWidth,
                    height: displayHeight,
                    filter: filterCSS || 'none',
                  }}
                />
              </div>

              {/* 网格线 */}
              <div className="crop-canvas__grid">
                <div className="crop-canvas__grid-line crop-canvas__grid-line--h1" />
                <div className="crop-canvas__grid-line crop-canvas__grid-line--h2" />
                <div className="crop-canvas__grid-line crop-canvas__grid-line--v1" />
                <div className="crop-canvas__grid-line crop-canvas__grid-line--v2" />
              </div>

              {/* 调整手柄 */}
              <div
                className="crop-canvas__handle crop-canvas__handle--nw"
                style={{ cursor: getCursorForHandle('nw') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 'nw')}
              />
              <div
                className="crop-canvas__handle crop-canvas__handle--ne"
                style={{ cursor: getCursorForHandle('ne') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 'ne')}
              />
              <div
                className="crop-canvas__handle crop-canvas__handle--sw"
                style={{ cursor: getCursorForHandle('sw') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 'sw')}
              />
              <div
                className="crop-canvas__handle crop-canvas__handle--se"
                style={{ cursor: getCursorForHandle('se') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 'se')}
              />
              <div
                className="crop-canvas__handle crop-canvas__handle--n"
                style={{ cursor: getCursorForHandle('n') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 'n')}
              />
              <div
                className="crop-canvas__handle crop-canvas__handle--s"
                style={{ cursor: getCursorForHandle('s') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 's')}
              />
              <div
                className="crop-canvas__handle crop-canvas__handle--w"
                style={{ cursor: getCursorForHandle('w') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 'w')}
              />
              <div
                className="crop-canvas__handle crop-canvas__handle--e"
                style={{ cursor: getCursorForHandle('e') }}
                onMouseDown={(e) => handleMouseDown(e, 'resize', 'e')}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ImageEditorCore;
