/**
 * Minimap Component (Smart Display Version)
 *
 * 小地图组件 - 智能显示/隐藏
 *
 * 显示模式：
 * - always: 始终显示
 * - auto: 智能显示（默认）
 * - manual: 完全手动控制
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PlaitBoard, RectangleClient, BoardTransforms, getViewportOrigination } from '@plait/core';
import {
  MinimapProps,
  MinimapConfig,
  MinimapElement,
  MinimapState,
  DEFAULT_MINIMAP_CONFIG,
  DEFAULT_AUTO_TRIGGER_CONFIG,
  MinimapAutoTriggerConfig,
} from '../../types/minimap.types';
import { ChevronRightIcon } from 'tdesign-icons-react';
import { Z_INDEX } from '../../constants/z-index';
import { analytics } from '../../utils/umami-analytics';
import { HoverTip } from '../shared/hover';
import './minimap.scss';

type ViewportSnapshot = {
  zoom: number;
  originX: number;
  originY: number;
};

const parseViewBox = (viewBox: string | null) => {
  if (!viewBox) {
    return null;
  }

  const [x, y] = viewBox.trim().split(/[\s,]+/).map((value) => Number(value));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
};

const getViewportOriginFromScroll = (
  board: PlaitBoard
): [number, number] | null => {
  const zoom = board.viewport.zoom;
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return null;
  }

  try {
    const viewportContainer = PlaitBoard.getViewportContainer(board);
    const host = PlaitBoard.getHost(board);
    const viewBox = parseViewBox(host.getAttribute('viewBox'));
    if (!viewBox) {
      return null;
    }

    return [
      viewportContainer.scrollLeft / zoom + viewBox.x,
      viewportContainer.scrollTop / zoom + viewBox.y,
    ];
  } catch {
    return null;
  }
};

const getViewportOrigin = (board: PlaitBoard): [number, number] => {
  const originFromScroll = getViewportOriginFromScroll(board);
  if (originFromScroll) {
    return originFromScroll;
  }

  return getViewportOrigination(board) || board.viewport.origination || [0, 0];
};

const getViewportSnapshot = (board: PlaitBoard): ViewportSnapshot => {
  const [originX, originY] = getViewportOrigin(board);
  return {
    zoom: board.viewport.zoom,
    originX,
    originY,
  };
};

/**
 * Minimap 组件
 */
export const Minimap: React.FC<MinimapProps> = ({
  board,
  config: configOverride,
  className,
  displayMode = 'auto',
  autoTriggerConfig: autoTriggerConfigOverride,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 合并配置
  const config: MinimapConfig = {
    ...DEFAULT_MINIMAP_CONFIG,
    ...configOverride,
  };

  const autoTriggerConfig: MinimapAutoTriggerConfig = {
    ...DEFAULT_AUTO_TRIGGER_CONFIG,
    ...autoTriggerConfigOverride,
  };

  // 组件状态
  const [state, setState] = useState<MinimapState>(() => ({
    expanded: displayMode === 'always' ? true : config.defaultExpanded,
    dragging: false,
    autoMode: displayMode === 'auto',
    manuallyExpanded: false,  // 初始不是手动展开
  }));

  // 拖拽状态
  const dragStateRef = useRef<{
    isDragging: boolean;
    startPoint: [number, number] | null;
  }>({
    isDragging: false,
    startPoint: null,
  });

  // Hover 预览状态
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const hoverPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  
  // 预览配置
  const PREVIEW_SIZE = 120; // 预览框大小
  const PREVIEW_ZOOM = 3; // 放大倍数

  // 记录上次交互时间和视口状态
  const lastInteractionRef = useRef<number>(0);
  const lastViewportRef = useRef<ViewportSnapshot | null>(null);

  /**
   * 获取所有元素的边界
   */
  const getAllElementBounds = useCallback((): MinimapElement[] => {
    if (!board || !board.children) return [];

    const elements: MinimapElement[] = [];

    board.children.forEach((element: any) => {
      try {
        let bounds: RectangleClient | null = null;

        if (element.points && Array.isArray(element.points)) {
          bounds = RectangleClient.getRectangleByPoints(element.points);
        } else if (element.x !== undefined && element.y !== undefined) {
          bounds = {
            x: element.x,
            y: element.y,
            width: element.width || 100,
            height: element.height || 100,
          };
        }

        if (bounds && bounds.width > 0 && bounds.height > 0) {
          elements.push({
            id: element.id,
            bounds,
            type: element.type,
          });
        }
      } catch (error) {
        console.warn('Failed to get bounds for element:', element.id, error);
      }
    });

    return elements;
  }, [board]);

  /**
   * 获取当前视口边界（在画布坐标系中）
   */
  const getViewportBounds = useCallback((): RectangleClient => {
    const boardContainer = PlaitBoard.getBoardContainer(board);
    const containerRect = boardContainer.getBoundingClientRect();
    const zoom = board.viewport.zoom;
    const origination = getViewportOrigin(board);

    const x = origination[0];
    const y = origination[1];
    const width = containerRect.width / zoom;
    const height = containerRect.height / zoom;

    return { x, y, width, height };
  }, [board]);

  // 用 ref 追踪展开状态，避免 useEffect 循环依赖
  const expandedRef = useRef(state.expanded);
  expandedRef.current = state.expanded;

  // 用 ref 存储 contentBounds 和 scale，避免在 render 中调用 setState
  const contentBoundsRef = useRef<RectangleClient | null>(null);
  const scaleRef = useRef<number>(1);

  /**
   * 监听 viewport 变化，触发智能显示
   *
   * 方案 A：使用定时器主动轮询
   * - 每 100ms 检查一次 viewport 是否有变化
   * - 任何 viewport 变化（拖拽、缩放）都会显示小地图
   */
  useEffect(() => {
    // always 模式：始终显示
    if (displayMode === 'always') {
      if (!expandedRef.current) {
        setState((prev) => ({ ...prev, expanded: true }));
      }
      return;
    }

    // 非 auto 模式：不处理
    if (displayMode !== 'auto') return;

    // 定时器：主动检查 viewport 变化
    const checkInterval = setInterval(() => {
      const current = getViewportSnapshot(board);
      const last = lastViewportRef.current;
      if (!last) {
        lastViewportRef.current = current;
        return;
      }

      const hasZoomChanged = Math.abs(current.zoom - last.zoom) > 0.001;
      const hasOriginChanged =
        Math.abs(current.originX - last.originX) > 0.5 ||
        Math.abs(current.originY - last.originY) > 0.5;

      const hasInteraction = hasZoomChanged || hasOriginChanged;

      if (hasInteraction) {
        // 更新记录
        lastViewportRef.current = current;

        lastInteractionRef.current = Date.now();

        // 有交互时自动展开小地图
        if (!expandedRef.current) {
          setState((prev) => {
            return { ...prev, expanded: true, manuallyExpanded: false };
          });
        }
      }
    }, 100); // 每 100ms 检查一次

    return () => {
      clearInterval(checkInterval);
    };
  }, [displayMode, board]);

  /**
   * 自动隐藏逻辑（方案 A）
   *
   * 规则：
   * 1. 交互停止后 3 秒自动隐藏
   * 2. 如果用户手动展开，则不自动隐藏
   * 3. 如果正在拖拽小地图，则不自动隐藏
   */
  useEffect(() => {
    if (displayMode !== 'auto') return;
    if (!state.expanded) return; // 已经隐藏
    if (state.manuallyExpanded) return; // 用户手动展开，不自动隐藏
    if (state.dragging) return; // 正在拖拽小地图，不自动隐藏

    // 设置自动隐藏定时器：交互停止后 X 秒自动隐藏
    const timer = setTimeout(() => {
      setState((prev) => {
        // 再次检查条件，避免误隐藏
        if (!prev.autoMode || prev.manuallyExpanded || prev.dragging) {
          return prev;
        }
        return { ...prev, expanded: false };
      });
    }, autoTriggerConfig.autoHideDelay);

    return () => {
      clearTimeout(timer);
    };
  }, [
    displayMode,
    state.expanded,
    state.manuallyExpanded,
    state.dragging,
    autoTriggerConfig.autoHideDelay,
  ]);

  /**
   * 计算显示边界
   */
  const calculateDisplayBounds = useCallback((
    elements: MinimapElement[],
    viewportBounds: RectangleClient
  ): RectangleClient => {
    if (elements.length === 0) {
      const padding = 200;
      return {
        x: viewportBounds.x - padding,
        y: viewportBounds.y - padding,
        width: viewportBounds.width + padding * 2,
        height: viewportBounds.height + padding * 2,
      };
    }

    let minX = viewportBounds.x;
    let minY = viewportBounds.y;
    let maxX = viewportBounds.x + viewportBounds.width;
    let maxY = viewportBounds.y + viewportBounds.height;

    elements.forEach((element) => {
      const { x, y, width, height } = element.bounds;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    });

    const padding = 100;
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }, []);

  const calculateScale = useCallback((
    displayBounds: RectangleClient
  ): number => {
    const padding = 20;
    const scaleX = (config.width - padding) / displayBounds.width;
    const scaleY = (config.height - padding) / displayBounds.height;
    return Math.min(scaleX, scaleY);
  }, [config.width, config.height]);

  const canvasToMinimapCoords = useCallback((
    canvasX: number,
    canvasY: number,
    displayBounds: RectangleClient,
    scale: number
  ): [number, number] => {
    const padding = 10;
    const x = (canvasX - displayBounds.x) * scale + padding;
    const y = (canvasY - displayBounds.y) * scale + padding;
    return [x, y];
  }, []);

  const minimapToCanvasCoords = useCallback((
    minimapX: number,
    minimapY: number,
    displayBounds: RectangleClient,
    scale: number
  ): [number, number] => {
    const padding = 10;
    const x = (minimapX - padding) / scale + displayBounds.x;
    const y = (minimapY - padding) / scale + displayBounds.y;
    return [x, y];
  }, []);

  const drawGrid = useCallback((
    ctx: CanvasRenderingContext2D,
    displayBounds: RectangleClient,
    scale: number
  ) => {
    const gridSize = 100;
    const minimapGridSize = gridSize * scale;

    if (minimapGridSize < 5) return;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 0.5;

    const startX = Math.floor(displayBounds.x / gridSize) * gridSize;
    const startY = Math.floor(displayBounds.y / gridSize) * gridSize;
    const endX = displayBounds.x + displayBounds.width;
    const endY = displayBounds.y + displayBounds.height;

    for (let x = startX; x <= endX; x += gridSize) {
      const [mx] = canvasToMinimapCoords(x, 0, displayBounds, scale);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, config.height);
      ctx.stroke();
    }

    for (let y = startY; y <= endY; y += gridSize) {
      const [, my] = canvasToMinimapCoords(0, y, displayBounds, scale);
      ctx.beginPath();
      ctx.moveTo(0, my);
      ctx.lineTo(config.width, my);
      ctx.stroke();
    }
  }, [canvasToMinimapCoords, config.width, config.height]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, config.width, config.height);

    const elements = getAllElementBounds();
    const viewportBounds = getViewportBounds();

    if (elements.length === 0 && !viewportBounds) {
      ctx.fillStyle = '#999';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('空画布', config.width / 2, config.height / 2);
      return;
    }

    const displayBounds = calculateDisplayBounds(elements, viewportBounds);
    const scale = calculateScale(displayBounds);

    // 用 ref 存储，避免 setState 导致的无限循环
    contentBoundsRef.current = displayBounds;
    scaleRef.current = scale;

    drawGrid(ctx, displayBounds, scale);

    ctx.fillStyle = config.elementColor;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 0.5;

    elements.forEach((element) => {
      const { x, y, width, height } = element.bounds;
      const [mx, my] = canvasToMinimapCoords(x, y, displayBounds, scale);
      const mw = width * scale;
      const mh = height * scale;

      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
    });

    const [vx, vy] = canvasToMinimapCoords(
      viewportBounds.x,
      viewportBounds.y,
      displayBounds,
      scale
    );
    const vw = viewportBounds.width * scale;
    const vh = viewportBounds.height * scale;

    ctx.fillStyle = config.viewportColor;
    ctx.fillRect(vx, vy, vw, vh);

    ctx.strokeStyle = config.viewportColor.replace('0.3', '1');
    ctx.lineWidth = 2;
    ctx.strokeRect(vx, vy, vw, vh);

    const cornerSize = 8;
    ctx.fillStyle = config.viewportColor.replace('0.3', '0.8');
    ctx.fillRect(vx, vy, cornerSize, 2);
    ctx.fillRect(vx, vy, 2, cornerSize);
    ctx.fillRect(vx + vw - cornerSize, vy, cornerSize, 2);
    ctx.fillRect(vx + vw - 2, vy, 2, cornerSize);
    ctx.fillRect(vx, vy + vh - 2, cornerSize, 2);
    ctx.fillRect(vx, vy + vh - cornerSize, 2, cornerSize);
    ctx.fillRect(vx + vw - cornerSize, vy + vh - 2, cornerSize, 2);
    ctx.fillRect(vx + vw - 2, vy + vh - cornerSize, 2, cornerSize);

    // 绘制 hover 预览区域指示框（橙色）- 大小与视口框相同
    const hoverPos = hoverPositionRef.current;
    if (hoverPos) {
      // 橙色框以鼠标位置为中心，大小与视口框相同
      const indicatorX = hoverPos.x - vw / 2;
      const indicatorY = hoverPos.y - vh / 2;
      
      // 橙色填充
      ctx.fillStyle = 'rgba(243, 156, 18, 0.15)';
      ctx.fillRect(indicatorX, indicatorY, vw, vh);
      
      // 橙色边框
      ctx.strokeStyle = 'rgba(243, 156, 18, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(indicatorX, indicatorY, vw, vh);
    }
  }, [
    board,
    config,
    getAllElementBounds,
    getViewportBounds,
    calculateDisplayBounds,
    calculateScale,
    canvasToMinimapCoords,
    drawGrid,
  ]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas || !contentBoundsRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const minimapX = e.clientX - rect.left;
    const minimapY = e.clientY - rect.top;

    // 埋点：小地图导航点击
    analytics.track('minimap_navigate', {
      action: 'click',
      displayMode,
    });

    const [canvasX, canvasY] = minimapToCanvasCoords(
      minimapX,
      minimapY,
      contentBoundsRef.current,
      scaleRef.current
    );

    dragStateRef.current = {
      isDragging: true,
      startPoint: [minimapX, minimapY],
    };

    setState((prev) => ({ ...prev, dragging: true }));

    moveViewportToCenter(canvasX, canvasY);
  }, [minimapToCanvasCoords, board]);

  const moveViewportToCenter = useCallback((canvasX: number, canvasY: number) => {
    const boardContainer = PlaitBoard.getBoardContainer(board);
    const containerRect = boardContainer.getBoundingClientRect();
    const zoom = board.viewport.zoom;

    const newOriginationX = canvasX - containerRect.width / (2 * zoom);
    const newOriginationY = canvasY - containerRect.height / (2 * zoom);

    BoardTransforms.updateViewport(board, [newOriginationX, newOriginationY], zoom);

    requestAnimationFrame(() => render());
  }, [board, render]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStateRef.current.isDragging || !contentBoundsRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const minimapX = e.clientX - rect.left;
    const minimapY = e.clientY - rect.top;

    const [canvasX, canvasY] = minimapToCanvasCoords(
      minimapX,
      minimapY,
      contentBoundsRef.current,
      scaleRef.current
    );

    moveViewportToCenter(canvasX, canvasY);
  }, [minimapToCanvasCoords, moveViewportToCenter]);

  const handlePointerUp = useCallback(() => {
    // 如果之前在拖拽，记录拖拽导航
    if (dragStateRef.current.isDragging) {
      analytics.track('minimap_navigate', {
        action: 'drag',
        displayMode,
      });
    }

    dragStateRef.current = {
      isDragging: false,
      startPoint: null,
    };
    setState((prev) => ({ ...prev, dragging: false }));
  }, [displayMode]);

  /**
   * 渲染 hover 预览 - 显示真实画布内容（与视口大小相同的区域）
   */
  const renderPreview = useCallback((minimapX: number, minimapY: number) => {
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas || !contentBoundsRef.current) return;

    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;

    // 将 minimap 坐标转换为画布坐标
    const [canvasX, canvasY] = minimapToCanvasCoords(
      minimapX,
      minimapY,
      contentBoundsRef.current,
      scaleRef.current
    );

    // 获取当前视口大小（在画布坐标系中）
    const viewportBounds = getViewportBounds();
    const viewportWidth = viewportBounds.width;
    const viewportHeight = viewportBounds.height;

    // 预览区域与视口大小相同
    const previewCanvasWidth = viewportWidth;
    const previewCanvasHeight = viewportHeight;

    // 清空预览画布
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    // 绘制白色背景
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    // 计算裁剪区域（以鼠标位置为中心）
    const clipX = canvasX - previewCanvasWidth / 2;
    const clipY = canvasY - previewCanvasHeight / 2;
    
    // 计算渲染缩放比例（保持宽高比，使用较小的缩放比）
    const scaleX = PREVIEW_SIZE / previewCanvasWidth;
    const scaleY = PREVIEW_SIZE / previewCanvasHeight;
    const renderScale = Math.min(scaleX, scaleY);
    
    // 计算渲染偏移（居中显示）
    const renderOffsetX = (PREVIEW_SIZE - previewCanvasWidth * renderScale) / 2;
    const renderOffsetY = (PREVIEW_SIZE - previewCanvasHeight * renderScale) / 2;

    // 遍历所有元素并绘制
    const elements = getAllElementBounds();

    elements.forEach((element) => {
      const { bounds } = element;
      // 检查元素是否在预览区域内
      if (
        bounds.x + bounds.width >= clipX &&
        bounds.x <= clipX + previewCanvasWidth &&
        bounds.y + bounds.height >= clipY &&
        bounds.y <= clipY + previewCanvasHeight
      ) {
        // 将画布坐标转换为预览坐标
        const previewX = (bounds.x - clipX) * renderScale + renderOffsetX;
        const previewY = (bounds.y - clipY) * renderScale + renderOffsetY;
        const previewW = bounds.width * renderScale;
        const previewH = bounds.height * renderScale;

        // 绘制元素的简化表示
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(previewX, previewY, previewW, previewH);
      }
    });

    // 绘制中心十字准星
    ctx.strokeStyle = 'rgba(90, 79, 207, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    
    // 水平线
    ctx.beginPath();
    ctx.moveTo(0, PREVIEW_SIZE / 2);
    ctx.lineTo(PREVIEW_SIZE, PREVIEW_SIZE / 2);
    ctx.stroke();
    
    // 垂直线
    ctx.beginPath();
    ctx.moveTo(PREVIEW_SIZE / 2, 0);
    ctx.lineTo(PREVIEW_SIZE / 2, PREVIEW_SIZE);
    ctx.stroke();
    
    ctx.setLineDash([]);

    // 绘制边框
    ctx.strokeStyle = 'rgba(90, 79, 207, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  }, [getAllElementBounds, getViewportBounds, minimapToCanvasCoords]);

  /**
   * 处理鼠标进入 minimap
   */
  const handleMouseEnter = useCallback(() => {
    if (!state.dragging) {
      setPreviewVisible(true);
    }
  }, [state.dragging]);

  /**
   * 处理鼠标离开 minimap
   */
  const handleMouseLeave = useCallback(() => {
    setPreviewVisible(false);
    setHoverPosition(null);
    hoverPositionRef.current = null;
  }, []);

  /**
   * 处理鼠标在 minimap 上移动（更新预览位置）
   */
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (state.dragging) {
      setPreviewVisible(false);
      hoverPositionRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const minimapX = e.clientX - rect.left;
    const minimapY = e.clientY - rect.top;

    const pos = { x: minimapX, y: minimapY };
    setHoverPosition(pos);
    hoverPositionRef.current = pos;
    setPreviewVisible(true);

    // 渲染预览
    renderPreview(minimapX, minimapY);
    
    // 触发 minimap 重绘以显示预览区域指示框
    render();
  }, [state.dragging, renderPreview, render]);

  // 追踪是否正在触控（用于区分移动端和桌面端交互）
  const isTouchingRef = useRef(false);

  /**
   * 处理触控开始 - 显示预览（移动端 hover 效果）
   */
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    isTouchingRef.current = true;
    
    const canvas = canvasRef.current;
    if (!canvas) return;

    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const minimapX = touch.clientX - rect.left;
    const minimapY = touch.clientY - rect.top;

    const pos = { x: minimapX, y: minimapY };
    setHoverPosition(pos);
    hoverPositionRef.current = pos;
    setPreviewVisible(true);

    // 渲染预览
    renderPreview(minimapX, minimapY);
    
    // 触发 minimap 重绘以显示预览区域指示框
    render();
  }, [renderPreview, render]);

  /**
   * 处理触控移动 - 更新预览位置（移动端 hover 效果）
   * 移动端触控时始终显示预览，不受拖拽状态影响
   */
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const minimapX = touch.clientX - rect.left;
    const minimapY = touch.clientY - rect.top;

    const pos = { x: minimapX, y: minimapY };
    setHoverPosition(pos);
    hoverPositionRef.current = pos;

    // 移动端触控时始终显示预览（不管是否在拖拽）
    setPreviewVisible(true);
    // 渲染预览
    renderPreview(minimapX, minimapY);
    
    // 触发 minimap 重绘以显示预览区域指示框
    render();
  }, [renderPreview, render]);

  /**
   * 处理触控结束 - 隐藏预览
   */
  const handleTouchEnd = useCallback(() => {
    isTouchingRef.current = false;
    
    // 延迟隐藏预览，给用户一点时间看到最终位置
    setTimeout(() => {
      // 只有在不再触控时才隐藏
      if (!isTouchingRef.current) {
        setPreviewVisible(false);
        setHoverPosition(null);
        hoverPositionRef.current = null;
        render();
      }
    }, 500); // 延长到 500ms，让用户更清楚看到最终位置
  }, [render]);

  useEffect(() => {
    if (!state.expanded) return;

    render();

    const intervalId = setInterval(() => {
      render();
    }, 100);

    return () => {
      clearInterval(intervalId);
    };
  }, [board, state.expanded, render]);

  const toggleExpanded = useCallback(() => {
    setState((prev) => {
      const willExpand = !prev.expanded;
      return {
        ...prev,
        expanded: willExpand,
        // 如果用户手动展开，标记为 manuallyExpanded，这样就不会自动隐藏
        // 如果用户手动折叠，取消 manuallyExpanded，下次交互时还会自动显示
        manuallyExpanded: willExpand,
      };
    });
  }, []);

  const positionStyle: React.CSSProperties = {
    bottom: config.position.includes('bottom') ? config.margin : undefined,
    top: config.position.includes('top') ? config.margin : undefined,
    right: config.position.includes('right') ? config.margin : undefined,
    left: config.position.includes('left') ? config.margin : undefined,
  };

  // 计算预览框位置（在 minimap 左侧）
  // 移动端触控时（isTouchingRef.current）即使拖拽也显示预览
  const shouldShowPreview = previewVisible && (isTouchingRef.current || !state.dragging);
  const previewStyle: React.CSSProperties = hoverPosition ? {
    position: 'absolute',
    right: config.width + 8, // 在 minimap 左侧
    top: Math.max(0, Math.min(hoverPosition.y - PREVIEW_SIZE / 2, config.height - PREVIEW_SIZE)),
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    opacity: shouldShowPreview ? 1 : 0,
    pointerEvents: 'none',
    transition: 'opacity 0.15s ease-out, top 0.1s ease-out',
  } : {
    display: 'none',
  };

  return (
    <div
      ref={containerRef}
      className={`minimap ${state.expanded ? 'minimap--expanded' : 'minimap--collapsed'} ${
        displayMode === 'auto' ? 'minimap--auto' : ''
      } ${className || ''}`}
      style={{ ...positionStyle, zIndex: Z_INDEX.MINIMAP }}
      data-track="minimap_container"
    >
      {state.expanded && (
        <div className="minimap__content">
          <canvas
            ref={canvasRef}
            width={config.width}
            height={config.height}
            className="minimap__canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              cursor: state.dragging ? 'grabbing' : 'pointer',
            }}
          />
          
          {/* Hover 放大预览 */}
          <div className="minimap__preview" style={previewStyle}>
            <canvas
              ref={previewCanvasRef}
              width={PREVIEW_SIZE}
              height={PREVIEW_SIZE}
              className="minimap__preview-canvas"
            />
          </div>
        </div>
      )}

      {config.collapsible && (
        <HoverTip
          content={state.expanded ? '折叠小地图' : '展开小地图'}
          showArrow={false}
        >
          <button
            className={`minimap__toggle ${state.expanded ? 'minimap__toggle--expanded' : ''}`}
            onClick={toggleExpanded}
            data-track="minimap_click_toggle"
          >
            <ChevronRightIcon />
          </button>
        </HoverTip>
      )}
    </div>
  );
};
