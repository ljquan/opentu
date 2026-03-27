/**
 * Card 标签贴元素渲染生成器
 *
 * 使用 SVG foreignObject 嵌入 HTML，通过 React 渲染 MarkdownEditor（只读模式）
 */
import { RectangleClient } from '@plait/core';
import { PlaitCard } from '../../types/card.types';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import { CardElement } from './CardElement';

export class CardGenerator {
  private containerG: SVGGElement | null = null;
  private foreignObject: SVGForeignObjectElement | null = null;
  private htmlContainer: HTMLElement | null = null;
  private reactRoot: Root | null = null;
  private resizeObserver: ResizeObserver | null = null;
  onHeightMeasured?: (height: number) => void;

  processDrawing(element: PlaitCard, parentG: SVGGElement): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'card-element');
    parentG.appendChild(g);
    this.containerG = g;

    this.createForeignObject(element, g);
    return g;
  }

  updateDrawing(element: PlaitCard, _g: SVGGElement): void {
    this.updateForeignObject(element);
    this.renderReact(element);
  }

  private createForeignObject(element: PlaitCard, g: SVGGElement): void {
    const rect = RectangleClient.getRectangleByPoints(element.points);

    // 创建 foreignObject
    this.foreignObject = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'foreignObject'
    );
    this.foreignObject.setAttribute('x', String(rect.x));
    this.foreignObject.setAttribute('y', String(rect.y));
    this.foreignObject.setAttribute('width', String(rect.width));
    this.foreignObject.setAttribute('height', String(rect.height));
    this.foreignObject.style.overflow = 'visible';
    // foreignObject 层允许鼠标事件穿透到 React 组件
    this.foreignObject.style.pointerEvents = 'none';

    // 创建 HTML 容器（XHTML 命名空间）
    this.htmlContainer = document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'div'
    ) as HTMLElement;
    this.htmlContainer.style.cssText = `
      width: 100%;
      height: 100%;
      pointer-events: none;
    `;

    this.foreignObject.appendChild(this.htmlContainer);
    g.appendChild(this.foreignObject);

    this.setupResizeObserver();

    // 延迟渲染 React，确保 DOM 已挂载
    setTimeout(() => this.renderReact(element), 0);
  }

  private updateForeignObject(element: PlaitCard): void {
    if (!this.foreignObject) return;
    const rect = RectangleClient.getRectangleByPoints(element.points);
    this.foreignObject.setAttribute('x', String(rect.x));
    this.foreignObject.setAttribute('y', String(rect.y));
    this.foreignObject.setAttribute('width', String(rect.width));
    this.foreignObject.setAttribute('height', String(rect.height));
  }

  private setupResizeObserver(): void {
    if (!this.htmlContainer) return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (height > 0) {
          this.onHeightMeasured?.(height);
        }
      }
    });

    this.resizeObserver.observe(this.htmlContainer);
  }

  private renderReact(element: PlaitCard): void {
    if (!this.htmlContainer) return;

    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.htmlContainer);
    }

    this.reactRoot.render(
      React.createElement(CardElement, { element })
    );

    // 兜底：foreignObject 内 ResizeObserver 可能不触发
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.htmlContainer && this.onHeightMeasured) {
          const height = this.htmlContainer.offsetHeight;
          if (height > 0) {
            this.onHeightMeasured(height);
          }
        }
      });
    });
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.reactRoot) {
      try {
        this.reactRoot.unmount();
      } catch {
        // 忽略卸载错误
      }
      this.reactRoot = null;
    }
    this.containerG = null;
    this.foreignObject = null;
    this.htmlContainer = null;
  }
}
