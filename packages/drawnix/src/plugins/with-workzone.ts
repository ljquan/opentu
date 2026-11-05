import {
  setWorkZoneRenderedSize,
  clearWorkZoneRenderedSize,
} from './workzone-transforms';
/**
 * WorkZone 插件
 *
 * 注册 WorkZone 画布元素，支持在画布上直接显示工作流进度
 */

import {
  PlaitBoard,
  PlaitPlugin,
  PlaitPluginElementContext,
  Point,
  RectangleClient,
  PlaitElement,
  Selection,
} from '@plait/core';
import {
  CommonElementFlavour,
  ActiveGenerator,
  createActiveGenerator,
} from '@plait/common';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import type { PlaitWorkZone } from '../types/workzone.types';
import type { WorkflowMessageData } from '../types/chat.types';
import { WorkZoneContent } from '../components/workzone-element/WorkZoneContent';
import { ToolProviderWrapper } from '../components/startup/ToolProviderWrapper';
import {
  getWorkZoneRenderScale,
  getWorkZoneVisualRectangle,
  isWorkZoneElement,
  WorkZoneTransforms,
} from './workzone-transforms';

import { LS_KEYS } from '../constants/storage-keys';

export { isWorkZoneElement, WorkZoneTransforms } from './workzone-transforms';

const WORKZONE_VISIBILITY_EVENT = 'workzone-visibility-changed';

function isWorkZoneCardVisible(): boolean {
  try {
    return localStorage.getItem(LS_KEYS.WORKZONE_CARD_VISIBLE) !== 'false';
  } catch {
    return true;
  }
}

/**
 * WorkZone 元素组件
 */
export class WorkZoneComponent extends CommonElementFlavour<
  PlaitWorkZone,
  PlaitBoard
> {
  private g: SVGGElement | null = null;
  private container: HTMLElement | null = null;
  private reactRoot: Root | null = null;
  private destroyed = false;
  private handleSizeChange = (size: {
    width: number;
    height: number;
  }): void => {
    if (
      this.destroyed ||
      !setWorkZoneRenderedSize(this.board, this.element.id, size)
    )
      return;
    this.updateForeignObjectLayout(this.element);
    this.activeGenerator.processDrawing(
      this.element,
      PlaitBoard.getActiveHost(this.board),
      { selected: this.selected }
    );
  };

  activeGenerator!: ActiveGenerator<PlaitWorkZone>;

  initialize(): void {
    super.initialize();

    // 创建选中状态生成器
    this.activeGenerator = createActiveGenerator(this.board, {
      getRectangle: (element: PlaitWorkZone) => {
        return getWorkZoneVisualRectangle(element, this.board);
      },
      getStrokeWidth: () => 2,
      getStrokeOpacity: () => 1,
      hasResizeHandle: () => false,
    });

    // 创建 SVG 结构
    this.createSVGStructure();

    // 渲染 React 内容
    this.renderContent();

    // 监听全局可见性变化事件
    window.addEventListener(
      WORKZONE_VISIBILITY_EVENT,
      this.handleVisibilityChange
    );
  }

  /**
   * 创建 SVG foreignObject 结构
   */
  private createSVGStructure(): void {
    const rect = RectangleClient.getRectangleByPoints(this.element.points);
    const visualRect = getWorkZoneVisualRectangle(this.element, this.board);

    // 创建 SVG group
    this.g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.g.setAttribute('data-element-id', this.element.id);
    this.g.classList.add('plait-workzone-element');
    this.g.style.pointerEvents = 'auto';

    // 创建 foreignObject
    const foreignObject = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'foreignObject'
    );
    foreignObject.setAttribute('x', String(rect.x));
    foreignObject.setAttribute('y', String(rect.y));
    foreignObject.setAttribute('width', String(visualRect.width));
    foreignObject.setAttribute('height', String(visualRect.height));
    foreignObject.style.overflow = 'visible';
    foreignObject.style.pointerEvents = 'auto';

    // 创建 HTML 容器（需要在 XHTML 命名空间中）
    this.container = document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'div'
    );
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.pointerEvents = 'auto';
    this.container.style.cursor = 'default';
    this.container.style.position = 'relative';
    this.container.classList.add('plait-workzone-container');

    // 应用缩放以保持内容视觉大小恒定
    this.container.style.width = `${rect.width}px`;
    this.container.style.height = `${rect.height}px`;
    this.container.style.transform = `scale(${getWorkZoneRenderScale(
      this.element
    )})`;
    this.container.style.transformOrigin = 'top left';

    foreignObject.appendChild(this.container);
    this.g.appendChild(foreignObject);

    // 添加到 elementG（普通元素层），这样可以接收鼠标事件
    const elementG = this.getElementG();
    elementG.appendChild(this.g);
  }

  /**
   * 删除当前 WorkZone
   */
  private handleDelete = (): void => {
    // console.log('[WorkZone] Delete button clicked:', this.element.id);
    // console.log('[WorkZone] Board children before delete:', this.board.children.length);
    WorkZoneTransforms.removeWorkZone(this.board, this.element.id);
    // console.log('[WorkZone] Board children after delete:', this.board.children.length);
  };

  /**
   * 处理工作流状态变更（来自 SW claim 结果）
   * 当 SW 中的工作流已完成/失败/不存在时更新 UI
   */
  private handleWorkflowStateChange = (
    workflowId: string,
    status: 'completed' | 'failed',
    error?: string
  ): void => {
    // 失败的工作流直接删除 WorkZone，避免残留无用卡片
    if (status === 'failed') {
      setTimeout(() => {
        WorkZoneTransforms.removeWorkZone(this.board, this.element.id);
      }, 1500);
      return;
    }

    // 更新 workflow 状态
    const updatedWorkflow = {
      ...this.element.workflow,
      status,
    };

    // 通过 WorkZoneTransforms 更新工作流
    WorkZoneTransforms.updateWorkflow(
      this.board,
      this.element.id,
      updatedWorkflow
    );
  };

  /**
   * 永远不再显示 WorkZone 卡片
   */
  private handleHideForever = (): void => {
    try {
      localStorage.setItem(LS_KEYS.WORKZONE_CARD_VISIBLE, 'false');
    } catch {
      // localStorage not available
    }
    window.dispatchEvent(new CustomEvent(WORKZONE_VISIBILITY_EVENT));
  };

  private handleVisibilityChange = (): void => {
    if (!this.container) return;
    this.container.style.display = isWorkZoneCardVisible() ? '' : 'none';
  };

  /**
   * 处理工作流重试（从失败步骤开始）
   */
  private handleRetry = async (
    workflow: WorkflowMessageData,
    stepIndex: number
  ): Promise<void> => {
    const executeRetry = (this.board as any).__executeWorkflowRetry;
    if (executeRetry) {
      // 传入当前 WorkZone 的 element ID，以便重试时同步更新
      await executeRetry(workflow, stepIndex, this.element.id);
    } else {
      console.warn('[WorkZone] No retry handler registered on board');
    }
  };

  private updateForeignObjectLayout(element: PlaitWorkZone): void {
    if (!this.g) return;

    const rect = RectangleClient.getRectangleByPoints(element.points);
    const visualRect = getWorkZoneVisualRectangle(element, this.board);
    const foreignObject = this.g.querySelector('foreignObject');

    if (foreignObject) {
      foreignObject.setAttribute('x', String(rect.x));
      foreignObject.setAttribute('y', String(rect.y));
      foreignObject.setAttribute('width', String(visualRect.width));
      foreignObject.setAttribute('height', String(visualRect.height));
    }

    if (this.container) {
      this.container.style.width = `${rect.width}px`;
      this.container.style.height = `${rect.height}px`;
      this.container.style.transform = `scale(${getWorkZoneRenderScale(
        element
      )})`;
    }
  }

  /**
   * 使用 React 渲染内容
   */
  private renderContent(): void {
    if (!this.container) return;

    // 根据设置控制初始可见性
    this.container.style.display = isWorkZoneCardVisible() ? '' : 'none';

    // 创建 React root
    this.reactRoot = createRoot(this.container);
    this.reactRoot.render(
      React.createElement(
        ToolProviderWrapper as any,
        { board: this.board },
        React.createElement(WorkZoneContent as any, {
          workflow: this.element.workflow,
          onSizeChange: this.handleSizeChange,
          onDelete: this.handleDelete,
          onWorkflowStateChange: this.handleWorkflowStateChange,
          onRetry: this.handleRetry,
          onHideForever: this.handleHideForever,
        })
      )
    );
  }

  /**
   * 响应元素变化
   */
  onContextChanged(
    value: PlaitPluginElementContext<PlaitWorkZone, PlaitBoard>,
    previous: PlaitPluginElementContext<PlaitWorkZone, PlaitBoard>
  ): void {
    // 更新位置和大小
    if (value.element !== previous.element && this.g) {
      this.updateForeignObjectLayout(value.element);

      // 重新渲染 React 内容（workflow 数据可能变化）
      if (this.reactRoot) {
        this.reactRoot.render(
          React.createElement(
            ToolProviderWrapper as any,
            { board: this.board },
            React.createElement(WorkZoneContent as any, {
              workflow: value.element.workflow,
              onSizeChange: this.handleSizeChange,
              onDelete: this.handleDelete,
              onWorkflowStateChange: this.handleWorkflowStateChange,
              onRetry: this.handleRetry,
              onHideForever: this.handleHideForever,
            })
          )
        );
      }
    }

    // 更新选中状态
    this.activeGenerator.processDrawing(
      this.element,
      PlaitBoard.getActiveHost(this.board),
      { selected: this.selected }
    );
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.destroyed = true;
    clearWorkZoneRenderedSize(this.board, this.element.id);
    window.removeEventListener(
      WORKZONE_VISIBILITY_EVENT,
      this.handleVisibilityChange
    );

    // 先从 DOM 中移除 SVG 元素（同步）
    if (this.g && this.g.parentNode) {
      // console.log('[WorkZone] Removing g from DOM');
      this.g.parentNode.removeChild(this.g);
    }

    // 清理 ActiveGenerator
    if (this.activeGenerator) {
      this.activeGenerator.destroy();
    }

    // 异步卸载 React root 以避免竞态条件
    const reactRoot = this.reactRoot;
    if (reactRoot) {
      // console.log('[WorkZone] Scheduling React root unmount');
      this.reactRoot = null;
      // 使用 setTimeout 延迟卸载，避免在 React 渲染期间同步卸载
      setTimeout(() => {
        reactRoot.unmount();
        // console.log('[WorkZone] React root unmounted');
      }, 0);
    }

    this.g = null;
    this.container = null;

    super.destroy();

    // console.log('[WorkZone] Element destroyed successfully:', this.element?.id);
  }
}

/**
 * WorkZone 插件
 */
export const withWorkZone: PlaitPlugin = (board: PlaitBoard) => {
  const { drawElement, getRectangle, isHit, isRectangleHit, isMovable } = board;

  // 注册元素渲染
  board.drawElement = (context: PlaitPluginElementContext) => {
    if (context.element.type === 'workzone') {
      return WorkZoneComponent;
    }
    return drawElement(context);
  };

  // 注册 getRectangle
  board.getRectangle = (element: PlaitElement) => {
    if (isWorkZoneElement(element)) {
      return getWorkZoneVisualRectangle(element, board);
    }
    return getRectangle(element);
  };

  // 注册 isHit
  board.isHit = (element: PlaitElement, point: Point) => {
    if (isWorkZoneElement(element)) {
      const rect = getWorkZoneVisualRectangle(element, board);
      const [x, y] = point;
      return (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      );
    }
    return isHit(element, point);
  };

  // 注册 isRectangleHit
  board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
    if (isWorkZoneElement(element)) {
      const rect = getWorkZoneVisualRectangle(element as PlaitWorkZone, board);
      const selectionRect = RectangleClient.getRectangleByPoints([
        selection.anchor,
        selection.focus,
      ]);
      return RectangleClient.isHit(rect, selectionRect);
    }
    return isRectangleHit(element, selection);
  };

  // 注册 isMovable（WorkZone 可移动）
  board.isMovable = (element: PlaitElement) => {
    if (isWorkZoneElement(element)) {
      return true;
    }
    return isMovable(element);
  };

  // console.log('[WorkZone] Plugin initialized');
  return board;
};

export default withWorkZone;
