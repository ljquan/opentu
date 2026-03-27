import React, { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import 'winbox/dist/css/winbox.min.css';
import './winbox-custom.scss';
import { useViewportScale } from '../../hooks/useViewportScale';

// 全局存储 WinBox 构造函数
let WinBoxConstructor: any = null;
let loadingPromise: Promise<any> | null = null;

// 动态加载 WinBox - 使用 Vite 动态导入
const loadWinBox = async (): Promise<any> => {
  if (WinBoxConstructor) return WinBoxConstructor;

  if (typeof window !== 'undefined' && (window as any).WinBox) {
    WinBoxConstructor = (window as any).WinBox;
    return WinBoxConstructor;
  }

  if (loadingPromise) return loadingPromise;

  // 使用动态导入，Vite 会正确处理这个 bundle
  loadingPromise = (async () => {
    try {
      // 动态导入 winbox bundle，Vite 会将其作为外部资源处理
      // @ts-ignore
      await import('winbox/dist/winbox.bundle.min.js');
      WinBoxConstructor = (window as any).WinBox;
      if (WinBoxConstructor) {
        return WinBoxConstructor;
      }
      throw new Error('WinBox not found after import');
    } catch (error) {
      console.warn('Dynamic import failed, falling back to CDN:', error);
      // Fallback: 使用 CDN
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src =
          'https://cdn.jsdelivr.net/npm/winbox@0.2.82/dist/winbox.bundle.min.js';
        script.async = true;
        script.onload = () => {
          WinBoxConstructor = (window as any).WinBox;
          if (WinBoxConstructor) {
            resolve(WinBoxConstructor);
          } else {
            reject(new Error('WinBox not found after CDN loading'));
          }
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
  })();

  return loadingPromise;
};

export interface WinBoxWindowProps {
  /** 窗口是否可见 */
  visible: boolean;
  /** 窗口标题 */
  title: string;
  /** 标题栏图标（支持 emoji 字符串或 React 组件） */
  icon?: React.ReactNode;
  /** 窗口关闭回调 */
  onClose?: () => void;
  /** 子组件 */
  children: React.ReactNode;
  /** 窗口宽度，支持数字(px)或字符串(如 '80%') */
  width?: number | string;
  /** 窗口高度，支持数字(px)或字符串(如 '80%') */
  height?: number | string;
  /** 最小宽度 */
  minWidth?: number;
  /** 最小高度 */
  minHeight?: number;
  /** 窗口初始位置 x，支持 'center'、'right'、数字 */
  x?: number | string;
  /** 窗口初始位置 y，支持 'center'、'bottom'、数字 */
  y?: number | string;
  /** 是否可最大化 */
  maximizable?: boolean;
  /** 是否可最小化 */
  minimizable?: boolean;
  /** 是否可调整大小 */
  resizable?: boolean;
  /** 是否可移动 */
  movable?: boolean;
  /** 是否模态窗口 */
  modal?: boolean;
  /** 背景色 */
  background?: string;
  /** 边框宽度 */
  border?: number;
  /** 额外的 CSS 类名 */
  className?: string;
  /** 窗口 ID */
  id?: string;
  /** 标题栏自定义内容（使用 React.Portal 渲染） */
  headerContent?: React.ReactNode;
  /** 挂载容器 */
  container?: HTMLElement | null;
  /** 窗口最大化回调 */
  onMaximize?: () => void;
  /** 窗口最小化回调，返回窗口位置和尺寸 */
  onMinimize?: (
    position: { x: number; y: number },
    size: { width: number; height: number }
  ) => void;
  /** 窗口恢复回调 */
  onRestore?: () => void;
  /** 窗口聚焦回调 */
  onFocus?: () => void;
  /** 窗口失焦回调 */
  onBlur?: () => void;
  /** 窗口移动回调 */
  onMove?: (x: number, y: number) => void;
  /** 窗口调整大小回调 */
  onResize?: (width: number, height: number) => void;
  /** 是否自动最大化 */
  autoMaximize?: boolean;
  /** 允许窗口移出视口时，至少保留在屏幕内的像素数（默认 50） */
  minVisiblePixels?: number;
  /** 插入到画布的回调，如果提供则显示"插入到画布"按钮，参数为弹窗当前位置和尺寸 */
  onInsertToCanvas?: (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  /** 是否保持窗口实例存活，设为 true 时 visible=false 只隐藏窗口而不销毁 */
  keepAlive?: boolean;
  /** 最小化动画目标元素选择器，如果提供则最小化时会播放缩放动画到目标位置 */
  minimizeTargetSelector?: string;
}

/**
 * WinBox 窗口 React 封装组件
 * 提供可拖拽、可调整大小、可最小化/最大化的浮动窗口体验
 *
 * 重要：使用 React Portal 渲染内容到 WinBox 的 .wb-body 中，
 * 而不是使用 WinBox 的 mount 选项，以保持 React 事件系统正常工作。
 */
export const WinBoxWindow: React.FC<WinBoxWindowProps> = ({
  visible,
  title,
  icon,
  onClose,
  children,
  width = '80%',
  height = '80%',
  minWidth = 400,
  minHeight = 300,
  x = 'center',
  y = 'center',
  maximizable = true,
  minimizable = true,
  resizable = true,
  movable = true,
  modal = false,
  background = 'linear-gradient(135deg, #5A4FCF 0%, #7B68EE 50%, #E91E63 100%)',
  border = 0,
  className,
  id,
  headerContent,
  container,
  onMaximize,
  onMinimize,
  onRestore,
  onFocus,
  onBlur,
  onMove,
  onResize,
  autoMaximize = false,
  minVisiblePixels = 50,
  onInsertToCanvas,
  keepAlive = false,
  minimizeTargetSelector,
}) => {
  const winboxRef = useRef<any>(null);
  const winboxElementRef = useRef<HTMLDivElement | null>(null); // WinBox 窗口的 DOM 元素
  const onCloseRef = useRef(onClose);
  // WinBox 的 onclose 只在实例创建时绑定一次，这里用 ref 保持最新回调。
  onCloseRef.current = onClose;
  // 保存最后的正常位置（非最小化/最大化状态），用于最小化恢复
  const lastNormalPositionRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  // 标记是否正在进行最小化操作，用于阻止 onmove 更新位置
  const isMinimizingRef = useRef(false);
  const [headerPortalContainer, setHeaderPortalContainer] =
    useState<HTMLElement | null>(null);
  const [bodyPortalContainer, setBodyPortalContainer] =
    useState<HTMLElement | null>(null);
  const [iconPortalContainer, setIconPortalContainer] =
    useState<HTMLElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [winboxLoaded, setWinboxLoaded] = useState(!!WinBoxConstructor);

  // 跟踪分屏状态 (使用 state 以便触发 hook 重新计算)
  const [splitSide, _setSplitSide] = useState<'left' | 'right' | null>(null);
  const splitSideRef = useRef<'left' | 'right' | null>(null);
  // 保存原始 minWidth 以便分屏后恢复
  const originalMinWidthRef = useRef<number | null>(null);

  const setSplitSide = useCallback((side: 'left' | 'right' | null) => {
    _setSplitSide(side);
    splitSideRef.current = side;

    // 退出分屏时恢复原始 minWidth
    if (
      side === null &&
      originalMinWidthRef.current !== null &&
      winboxRef.current
    ) {
      winboxRef.current.minwidth = originalMinWidthRef.current;
      originalMinWidthRef.current = null;
    }
  }, []);

  // 静态跟踪全局分屏占用情况
  const getOccupiedSides = useCallback(() => {
    const sides = { left: false, right: false };
    if (typeof window === 'undefined' || !(window as any).WinBox) return sides;

    // 直接从 WinBox 栈中获取实例，避免受 CSS transform 影响
    const WinBox = (window as any).WinBox;
    const allBoxes = WinBox.stack();
    const viewportWidth = window.innerWidth;

    allBoxes.forEach((wb: any) => {
      // 忽略当前正在操作的窗口
      if (wb === winboxRef.current) return;

      const isHalfWidth = Math.abs(wb.width - viewportWidth / 2) < 20;
      if (isHalfWidth) {
        if (wb.x < 20) sides.left = true;
        if (Math.abs(wb.x + wb.width - viewportWidth) < 20) sides.right = true;
      }
    });
    return sides;
  }, []);

  // 恢复居中显示
  const restoreCenter = useCallback(
    (wb: any) => {
      if (!wb || !wb.window) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // 恢复原始 minWidth
      if (originalMinWidthRef.current !== null) {
        wb.minwidth = originalMinWidthRef.current;
        originalMinWidthRef.current = null;
      }

      // 重置边界
      wb.left = 0;
      wb.right = 0;
      wb.top = 0;
      wb.bottom = 0;

      // 计算居中位置和尺寸（使用初始设置的 80% 或更合理的尺寸）
      let targetWidth: number;
      let targetHeight: number;

      if (typeof width === 'string' && width.endsWith('%')) {
        targetWidth = Math.floor((viewportWidth * parseInt(width)) / 100);
      } else {
        targetWidth =
          typeof width === 'number' ? width : Math.floor(viewportWidth * 0.8);
      }

      if (typeof height === 'string' && height.endsWith('%')) {
        targetHeight = Math.floor((viewportHeight * parseInt(height)) / 100);
      } else {
        targetHeight =
          typeof height === 'number'
            ? height
            : Math.floor(viewportHeight * 0.8);
      }

      // 确保尺寸不超过最小宽高
      targetWidth = Math.max(targetWidth, minWidth);
      targetHeight = Math.max(targetHeight, minHeight);

      const centerX = Math.floor((viewportWidth - targetWidth) / 2);
      const centerY = Math.floor((viewportHeight - targetHeight) / 2);

      wb.resize(targetWidth, targetHeight).move(centerX, centerY);
      setSplitSide(null);
    },
    [width, height, minWidth, minHeight, setSplitSide]
  );

  // 执行实际的分屏操作
  const performSplit = useCallback(
    (
      wb: any,
      targetSide: 'left' | 'right',
      halfWidth: number,
      viewportWidth: number,
      viewportHeight: number
    ) => {
      if (!wb || !wb.window) return;

      // 关键：分屏前必须重置边界，否则 resize 会加上负边界的宽度
      wb.left = 0;
      wb.right = 0;
      wb.top = 0;
      wb.bottom = 0;

      if (targetSide === 'left') {
        wb.resize(halfWidth, viewportHeight).move(0, 0);
        setSplitSide('left');
      } else {
        // 使用 viewportWidth - halfWidth 确保精准靠右
        wb.resize(halfWidth, viewportHeight).move(viewportWidth - halfWidth, 0);
        setSplitSide('right');
      }
    },
    [setSplitSide]
  );

  const handleSplit = useCallback(() => {
    const wb = winboxRef.current;
    // 使用 ref 获取最新的分屏状态，避免闭包捕获旧值
    const currentSplitSide = splitSideRef.current;

    // 安全检查：确保 WinBox 实例和其 DOM 元素都存在
    if (!wb || !wb.window) {
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const occupied = getOccupiedSides();
    const halfWidth = Math.floor(viewportWidth / 2);

    // 辅助函数：执行分屏到指定方向
    const doSplit = (targetSide: 'left' | 'right') => {
      // 保存原始 minWidth，并临时设置为较小的值以允许半屏
      if (originalMinWidthRef.current === null) {
        originalMinWidthRef.current = wb.minwidth;
      }

      // 分屏时强制设置 minwidth 为一个足够小的值，确保可以缩小到半屏
      wb.minwidth = Math.min(200, halfWidth);

      // 执行分屏：先重置最大化状态
      if (wb.max) {
        wb.restore();
        requestAnimationFrame(() => {
          if (!wb || !wb.window) return;
          performSplit(
            wb,
            targetSide,
            halfWidth,
            viewportWidth,
            viewportHeight
          );
        });
      } else {
        performSplit(wb, targetSide, halfWidth, viewportWidth, viewportHeight);
      }
    };

    // 辅助函数：恢复居中
    const doRestoreCenter = () => {
      if (wb.max) {
        wb.restore();
        requestAnimationFrame(() => {
          if (!wb || !wb.window) return;
          restoreCenter(wb);
        });
      } else {
        restoreCenter(wb);
      }
    };

    // 新逻辑：
    // 1. 没有分屏 -> 优先贴右半屏，如果右边被占用则贴左半屏
    // 2. 在右半屏 -> 如果左边没被占用则贴左半屏，否则恢复居中
    // 3. 在左半屏 -> 恢复居中

    if (currentSplitSide === 'left') {
      // 在左半屏，恢复居中
      doRestoreCenter();
      return;
    }

    if (currentSplitSide === 'right') {
      // 在右半屏
      if (occupied.left) {
        // 左边有其他窗口，恢复居中
        doRestoreCenter();
      } else {
        // 左边没有窗口，贴左半屏
        doSplit('left');
      }
      return;
    }

    // 没有分屏：优先贴右半屏，如果右边被占用则贴左半屏
    if (occupied.right && !occupied.left) {
      doSplit('left');
    } else {
      doSplit('right');
    }
  }, [getOccupiedSides, restoreCenter, performSplit]);

  // 应用 viewport scale 以确保缩放时窗口位置和大小不变
  // 注意：分屏或最大化时禁用缩放补偿，防止超出屏幕
  const refreshViewportScale = useViewportScale(winboxElementRef, {
    enablePositionTracking: false,
    enableScaleCompensation: !splitSide && !winboxRef.current?.max,
  });

  // 加载 WinBox
  useEffect(() => {
    if (!winboxLoaded) {
      loadWinBox().then(() => setWinboxLoaded(true));
    }
  }, [winboxLoaded]);

  const isMovingRef = useRef(false);

  // 处理窗口关闭
  const handleClose = useCallback(() => {
    onCloseRef.current?.();
    return false; // 返回 false 让 WinBox 不自动销毁，由 React 控制
  }, []);

  // 创建或更新窗口
  useEffect(() => {
    if (!winboxLoaded || !WinBoxConstructor) return;

    // 当 visible 变为 false 时
    if (!visible) {
      if (winboxRef.current) {
        if (keepAlive) {
          // keepAlive 模式：只隐藏窗口，不销毁实例
          winboxRef.current.hide();
        } else {
          // 非 keepAlive 模式：关闭并清理窗口
          try {
            winboxRef.current.close(true); // force close
          } catch {
            // 忽略关闭错误
          }
          winboxRef.current = null;
          winboxElementRef.current = null; // 清空 DOM 元素引用
          setHeaderPortalContainer(null);
          setBodyPortalContainer(null);
          setIsReady(false);
        }
      }
      return;
    }

    // 当 visible 变为 true 时
    if (visible && winboxRef.current) {
      // 窗口已存在（keepAlive 模式），显示并聚焦
      winboxRef.current.show();
      winboxRef.current.focus();
      return;
    }

    // 当 visible 变为 true 且窗口不存在时，创建窗口
    if (visible && !winboxRef.current) {
      // 构建 class 列表
      const classList: string[] = ['winbox-react'];
      if (!maximizable) classList.push('no-max');
      if (!minimizable) classList.push('no-min');
      if (!resizable) classList.push('no-resize');
      if (!movable) classList.push('no-move');
      // 隐藏全屏按钮,因为全屏功能可能导致用户体验问题
      classList.push('no-full');
      if (className) classList.push(className);

      // 创建 WinBox 实例 - 不使用 mount 选项，改用 Portal
      const wb = new WinBoxConstructor({
        id,
        title,
        // 不使用 mount，改用 React Portal 渲染内容
        width,
        height,
        minwidth: minWidth,
        minheight: minHeight,
        x,
        y,
        modal,
        background,
        border,
        overflow: true, // 允许内容移出视口
        class: classList,
        root: container || document.body,
        onclose: handleClose,
        onmaximize: onMaximize,
        onminimize: function (this: any) {
          // 标记正在最小化，阻止 onmove 更新位置
          isMinimizingRef.current = true;

          // 使用保存的正常位置，而不是当前位置（当前位置可能已经是最小化后的位置）
          const savedPosition = lastNormalPositionRef.current;
          const position = savedPosition
            ? { x: savedPosition.x, y: savedPosition.y }
            : { x: this.x || 0, y: this.y || 0 };
          const size = savedPosition
            ? { width: savedPosition.width, height: savedPosition.height }
            : { width: this.width || 800, height: this.height || 600 };

          // 获取窗口 DOM 元素
          const wbWindow = this.window as HTMLElement;

          // 如果提供了目标选择器，播放最小化动画
          if (minimizeTargetSelector && wbWindow) {
            const targetElement = document.querySelector(
              minimizeTargetSelector
            );
            if (targetElement) {
              // 立即重置 WinBox 可能已应用的任何变换，恢复到正常状态
              wbWindow.style.transition = 'none';
              wbWindow.style.transform = '';
              wbWindow.style.opacity = '1';
              // 如果 WinBox 已经开始移动窗口，恢复到保存的位置
              if (savedPosition) {
                wbWindow.style.left = `${savedPosition.x}px`;
                wbWindow.style.top = `${savedPosition.y}px`;
                wbWindow.style.width = `${savedPosition.width}px`;
                wbWindow.style.height = `${savedPosition.height}px`;
              }

              // 强制重绘，确保样式已应用
              void wbWindow.offsetHeight;

              // 获取当前窗口位置（重置后的位置）
              const windowRect = wbWindow.getBoundingClientRect();
              const targetRect = targetElement.getBoundingClientRect();

              // 计算目标中心点
              const targetCenterX = targetRect.left + targetRect.width / 2;
              const targetCenterY = targetRect.top + targetRect.height / 2;

              // 计算窗口左边缘中心（因为工具栏在左边）
              const windowLeftCenterX = windowRect.left;
              const windowLeftCenterY = windowRect.top + windowRect.height / 2;

              // 计算偏移量（窗口左边缘到目标中心的距离）
              const translateX = targetCenterX - windowLeftCenterX;
              const translateY = targetCenterY - windowLeftCenterY;

              // 计算缩放比例
              const scale = Math.min(
                targetRect.width / windowRect.width,
                targetRect.height / windowRect.height,
                0.06
              );

              // 设置变换原点为左侧中心（朝向目标的方向）
              wbWindow.style.transformOrigin = 'left center';

              // 添加透视容器样式（在父元素上，如果没有则在自身）
              const parentEl = wbWindow.parentElement;
              if (parentEl) {
                parentEl.style.perspective = '1000px';
                parentEl.style.perspectiveOrigin = 'left center';
              }

              // 强制重绘
              void wbWindow.offsetHeight;

              // 动画时长
              const duration = 400;

              // 应用 Genie effect 动画
              // 使用 rotateY 产生透视变形，让右侧看起来收缩更慢
              wbWindow.style.transition = `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${duration}ms ease-out`;
              wbWindow.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale}) rotateY(-30deg)`;
              wbWindow.style.opacity = '0';

              // 动画结束后隐藏窗口并清理
              setTimeout(() => {
                wbWindow.style.transition = 'none';
                wbWindow.style.transform = '';
                wbWindow.style.opacity = '';
                if (parentEl) {
                  parentEl.style.perspective = '';
                  parentEl.style.perspectiveOrigin = '';
                }
                this.hide();
                onMinimize?.(position, size);
              }, duration);

              return true;
            }
          }

          // 没有目标选择器或找不到目标元素，直接隐藏
          this.hide();
          onMinimize?.(position, size);
          // 返回 true 阻止 WinBox 的默认最小化行为
          return true;
        },
        onrestore: onRestore,
        onfocus: onFocus,
        onblur: onBlur,
        onmove: function (this: any, x: number, y: number) {
          if (this.max || this.min || isMovingRef.current) return;

          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const wbWidth = this.width;
          const wbHeight = this.height;
          const minVisible = minVisiblePixels;

          // 如果是手动移动（不是由 handleSplit 触发的移动），且位移较大，则退出分屏状态
          if (splitSideRef.current) {
            const expectedX =
              splitSideRef.current === 'left' ? 0 : viewportWidth - wbWidth;
            if (Math.abs(x - expectedX) > 50) {
              setSplitSide(null);
            }
          }

          let newX = x;
          let newY = y;

          // X 轴约束：左侧至少留 50px，右侧至少留 50px
          if (x < minVisible - wbWidth) newX = minVisible - wbWidth;
          if (x > viewportWidth - minVisible) newX = viewportWidth - minVisible;

          // Y 轴约束：顶部不能出 (确保标题栏可见)，底部至少留 50px
          if (y < 0) newY = 0;
          if (y > viewportHeight - minVisible)
            newY = viewportHeight - minVisible;

          if (newX !== x || newY !== y) {
            isMovingRef.current = true;
            this.move(newX, newY);
            isMovingRef.current = false;
          }

          // 保存正常状态下的位置（非最小化/最大化，且不在最小化过程中）
          // 检测异常位置变化：如果 y 突然大幅增加，可能是最小化动画
          const prevPos = lastNormalPositionRef.current;
          const isLikelyMinimizeAnimation = prevPos && newY - prevPos.y > 200;

          if (
            !this.min &&
            !this.max &&
            !isMinimizingRef.current &&
            !isLikelyMinimizeAnimation
          ) {
            lastNormalPositionRef.current = {
              x: newX,
              y: newY,
              width: this.width,
              height: this.height,
            };
          }

          onMove?.(newX, newY);
        },
        onresize: function (this: any, w: number, h: number) {
          // 保存正常状态下的尺寸（非最小化/最大化，且不在最小化过程中）
          // 检测异常尺寸：如果尺寸突然变得很小，可能是最小化动画
          const prevPos = lastNormalPositionRef.current;
          const isLikelyMinimizeAnimation =
            prevPos && (h < 100 || prevPos.height - h > 200);

          if (
            !this.min &&
            !this.max &&
            !isMinimizingRef.current &&
            !isLikelyMinimizeAnimation
          ) {
            lastNormalPositionRef.current = {
              x: this.x,
              y: this.y,
              width: w,
              height: h,
            };
          }
          onResize?.(w, h);
        },
      });

      winboxRef.current = wb;

      // 添加分屏按钮
      wb.addControl({
        index: 0, // 在最大化按钮左边（WinBox 默认按钮索引从右往左是 0:close, 1:full, 2:max, 3:min）
        // 但 WinBox 的 addControl 是往左添加，所以 index 影响排序
        class: 'wb-split',
        image:
          'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIj48L3JlY3Q+PGxpbmUgeDE9IjEyIiB5MT0iMyIgeDI9IjEyIiB5Mj0iMjEiPjwvbGluZT48L3N2Zz4=',
        click: (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          handleSplit();
        },
      });

      // 添加"插入到画布"按钮（如果提供了回调）
      if (onInsertToCanvas) {
        wb.addControl({
          index: 0,
          class: 'wb-insert-canvas',
          // 插入到画布图标 - 画框 + 中心加号 (base64 encoded)
          image:
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiLz48cGF0aCBkPSJNMTIgOHY4Ii8+PHBhdGggZD0iTTggMTJoOCIvPjwvc3ZnPg==',
          click: (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            // 使用 getBoundingClientRect 获取弹窗在视口中的准确位置
            const wbWindow = wb.window as HTMLElement;
            if (wbWindow) {
              const domRect = wbWindow.getBoundingClientRect();
              const rect = {
                x: domRect.left,
                y: domRect.top,
                width: domRect.width,
                height: domRect.height,
              };
              onInsertToCanvas(rect);
            } else {
              // 回退到 WinBox 属性
              const rect = {
                x: wb.x || 0,
                y: wb.y || 0,
                width: wb.width || 800,
                height: wb.height || 600,
              };
              onInsertToCanvas(rect);
            }
          },
        });
      }

      // 保存 WinBox 窗口的 DOM 元素引用，用于应用 viewport scale
      if (wb.window) {
        winboxElementRef.current = wb.window as HTMLDivElement;
        // 立即触发一次缩放计算，确保弹窗首次显示时就应用正确的缩放
        requestAnimationFrame(() => {
          refreshViewportScale();
        });

        // 获取 .wb-body 元素作为内容的 Portal 容器
        const wbBody = wb.window.querySelector('.wb-body');
        if (wbBody) {
          setBodyPortalContainer(wbBody as HTMLElement);
        }

        // 如果有图标，创建图标 portal 容器
        if (icon) {
          const drag = wb.window.querySelector('.wb-drag');
          const wbTitle = wb.window.querySelector('.wb-title');
          if (drag && wbTitle) {
            // 创建图标容器
            const iconContainer = document.createElement('div');
            iconContainer.className = 'wb-icon-container';
            // 插入到标题之前
            drag.insertBefore(iconContainer, wbTitle);
            setIconPortalContainer(iconContainer);
          }
        }
      }

      // 如果有自定义标题栏内容，创建 portal 容器
      if (headerContent && wb.window) {
        const drag = wb.window.querySelector('.wb-drag');
        if (drag) {
          // 创建一个容器用于渲染自定义标题栏内容（如模型选择器）
          const portalContainer = document.createElement('div');
          portalContainer.className = 'wb-header-custom';

          // 阻止触摸和鼠标事件冒泡到拖拽区域，确保按钮可点击
          const stopPropagation = (e: Event) => {
            e.stopPropagation();
          };
          portalContainer.addEventListener('mousedown', stopPropagation, true);
          portalContainer.addEventListener('touchstart', stopPropagation, true);
          portalContainer.addEventListener(
            'pointerdown',
            stopPropagation,
            true
          );

          // 插入到拖拽区域末尾（标题后面）
          drag.appendChild(portalContainer);
          setHeaderPortalContainer(portalContainer);
        }
      }

      // 保存初始位置
      if (wb && !wb.min && !wb.max) {
        lastNormalPositionRef.current = {
          x: wb.x,
          y: wb.y,
          width: wb.width,
          height: wb.height,
        };
      }

      setIsReady(true);

      // 如果设置了自动最大化，则在创建后最大化窗口
      if (autoMaximize) {
        // 使用 setTimeout 确保窗口完全创建后再最大化
        setTimeout(() => {
          if (winboxRef.current) {
            winboxRef.current.maximize();
          }
        }, 100);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, winboxLoaded, autoMaximize, keepAlive]);
  // 注意: handleClose 不在依赖中，因为它只在创建时使用一次，
  // 添加到依赖会导致 WinBox 实例频繁重建并触发关闭回调

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (winboxRef.current) {
        try {
          // 防止在卸载时触发 onclose 回调
          winboxRef.current.onclose = null;
          winboxRef.current.close(true);
        } catch {
          // 忽略
        }
        winboxRef.current = null;
        winboxElementRef.current = null; // 清空 DOM 元素引用
      }
    };
  }, []);

  // 更新标题
  useEffect(() => {
    if (winboxRef.current && title) {
      winboxRef.current.setTitle(title);
    }
  }, [title]);

  // 处理 icon 变化 - 如果窗口已存在但图标容器还没创建
  useEffect(() => {
    if (winboxRef.current && icon && !iconPortalContainer) {
      const wb = winboxRef.current;
      const drag = wb.window?.querySelector('.wb-drag');
      const wbTitle = wb.window?.querySelector('.wb-title');
      if (drag && wbTitle) {
        // 检查是否已存在图标容器
        const existingContainer = drag.querySelector('.wb-icon-container');
        if (!existingContainer) {
          const iconContainer = document.createElement('div');
          iconContainer.className = 'wb-icon-container';
          drag.insertBefore(iconContainer, wbTitle);
          setIconPortalContainer(iconContainer);
        }
      }
    }
  }, [icon, iconPortalContainer]);

  // 控制显示/隐藏
  useEffect(() => {
    if (winboxRef.current) {
      const savedPos = lastNormalPositionRef.current;
      if (visible) {
        // 如果窗口处于最小化状态，需要先恢复
        const wasMinimized = winboxRef.current.min || winboxRef.current.hidden;
        if (winboxRef.current.min) {
          winboxRef.current.restore();
          // restore() 后需要重新设置位置到保存的正常位置
          // 使用内部保存的位置而不是 props，因为 props 可能被 onmove 污染
          if (savedPos) {
            winboxRef.current.move(savedPos.x, savedPos.y);
            winboxRef.current.resize(savedPos.width, savedPos.height);
          }
          // 重置最小化标记
          isMinimizingRef.current = false;
        }
        winboxRef.current.show();
        winboxRef.current.focus();

        // 如果是从最小化恢复，播放展开动画
        if (wasMinimized && minimizeTargetSelector) {
          requestAnimationFrame(() => {
            playRestoreAnimation();
          });
        }
      } else {
        winboxRef.current.hide();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 从最小化恢复时播放展开动画
  const playRestoreAnimation = useCallback(() => {
    if (!minimizeTargetSelector || !winboxRef.current) return;

    const wbWindow = winboxRef.current.window as HTMLElement;
    const targetElement = document.querySelector(minimizeTargetSelector);

    if (!wbWindow || !targetElement) return;

    const savedPos = lastNormalPositionRef.current;
    if (!savedPos) return;

    const targetRect = targetElement.getBoundingClientRect();

    // 计算起始位置（从图标位置开始）
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const windowLeftCenterX = savedPos.x;
    const windowLeftCenterY = savedPos.y + savedPos.height / 2;

    // 计算偏移量
    const translateX = targetCenterX - windowLeftCenterX;
    const translateY = targetCenterY - windowLeftCenterY;
    const scale = Math.min(
      targetRect.width / savedPos.width,
      targetRect.height / savedPos.height,
      0.06
    );

    // 添加透视容器样式
    const parentEl = wbWindow.parentElement;
    if (parentEl) {
      parentEl.style.perspective = '1000px';
      parentEl.style.perspectiveOrigin = 'left center';
    }

    // 设置初始状态（从图标位置缩小状态开始）
    wbWindow.style.transition = 'none';
    wbWindow.style.transformOrigin = 'left center';
    wbWindow.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale}) rotateY(-30deg)`;
    wbWindow.style.opacity = '0';

    // 强制重绘
    void wbWindow.offsetHeight;

    // 动画时长
    const duration = 350;

    // 播放展开动画
    wbWindow.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0, 0.4, 1), opacity ${
      duration * 0.6
    }ms ease-out`;
    wbWindow.style.transform = '';
    wbWindow.style.opacity = '1';

    // 动画结束后清理
    setTimeout(() => {
      wbWindow.style.transition = 'none';
      wbWindow.style.transform = '';
      wbWindow.style.transformOrigin = '';
      if (parentEl) {
        parentEl.style.perspective = '';
        parentEl.style.perspectiveOrigin = '';
      }
    }, duration);
  }, [minimizeTargetSelector]);

  // 监听 autoMaximize 变化，动态最大化窗口
  useEffect(() => {
    if (winboxRef.current && autoMaximize) {
      winboxRef.current.maximize();
    }
  }, [autoMaximize]);

  // 使用 Portal 渲染内容到 WinBox 的 .wb-body 中
  // 这样可以保持 React 事件系统正常工作
  return (
    <>
      {/* 图标通过 Portal 渲染到标题栏 */}
      {isReady &&
        icon &&
        iconPortalContainer &&
        createPortal(
          <span className="wb-icon-content">{icon}</span>,
          iconPortalContainer
        )}
      {/* 内容通过 Portal 渲染到 WinBox 的 .wb-body */}
      {isReady &&
        bodyPortalContainer &&
        createPortal(
          <div className="winbox-content-wrapper">{children}</div>,
          bodyPortalContainer
        )}
      {/* 自定义标题栏内容通过 Portal 渲染 */}
      {isReady &&
        headerContent &&
        headerPortalContainer &&
        createPortal(headerContent, headerPortalContainer)}
    </>
  );
};

export default WinBoxWindow;
