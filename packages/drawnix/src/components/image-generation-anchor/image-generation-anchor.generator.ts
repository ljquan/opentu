import { RectangleClient, type PlaitBoard } from '@plait/core';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';
import { ImageGenerationAnchorContent } from './ImageGenerationAnchorContent';

export class ImageGenerationAnchorGenerator {
  constructor(private board: PlaitBoard) {}

  private foreignObject: SVGForeignObjectElement | null = null;
  private htmlContainer: HTMLElement | null = null;
  private reactRoot: Root | null = null;
  onSizeChange?: (size: { width: number; height: number }) => void;

  processDrawing(
    element: PlaitImageGenerationAnchor,
    parentG: SVGGElement,
    selected: boolean
  ): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'image-generation-anchor-element');
    parentG.appendChild(g);

    this.createForeignObject(element, g);
    this.renderReact(element, selected);
    return g;
  }

  updateDrawing(
    element: PlaitImageGenerationAnchor,
    _g: SVGGElement,
    selected: boolean
  ): void {
    this.updateForeignObject(element);
    this.renderReact(element, selected);
  }

  private createForeignObject(
    element: PlaitImageGenerationAnchor,
    g: SVGGElement
  ): void {
    const rect = RectangleClient.getRectangleByPoints(element.points);

    this.foreignObject = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'foreignObject'
    );
    this.foreignObject.setAttribute('x', String(rect.x));
    this.foreignObject.setAttribute('y', String(rect.y));
    this.foreignObject.setAttribute('width', String(rect.width));
    this.foreignObject.setAttribute('height', String(rect.height));
    this.foreignObject.style.overflow = 'visible';
    this.foreignObject.style.pointerEvents = 'auto';

    this.htmlContainer = document.createElementNS(
      'http://www.w3.org/1999/xhtml',
      'div'
    ) as HTMLElement;
    this.htmlContainer.style.cssText = `
      width: 100%;
      height: 100%;
      pointer-events: auto;
      overflow: visible;
    `;

    this.foreignObject.appendChild(this.htmlContainer);
    g.appendChild(this.foreignObject);
  }

  private updateForeignObject(element: PlaitImageGenerationAnchor): void {
    if (!this.foreignObject) {
      return;
    }

    const rect = RectangleClient.getRectangleByPoints(element.points);
    this.foreignObject.setAttribute('x', String(rect.x));
    this.foreignObject.setAttribute('y', String(rect.y));
    this.foreignObject.setAttribute('width', String(rect.width));
    this.foreignObject.setAttribute('height', String(rect.height));
  }

  private renderReact(
    element: PlaitImageGenerationAnchor,
    selected: boolean
  ): void {
    if (!this.htmlContainer) {
      return;
    }

    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.htmlContainer);
    }

    this.reactRoot.render(
      React.createElement(ImageGenerationAnchorContent, {
        board: this.board,
        element,
        selected,
        onSizeChange: this.onSizeChange,
      })
    );
  }

  destroy(): void {
    if (this.reactRoot) {
      const root = this.reactRoot;
      this.reactRoot = null;
      setTimeout(() => {
        try {
          root.unmount();
        } catch {
          // Ignore unmount failures during teardown.
        }
      }, 0);
    }

    this.foreignObject = null;
    this.htmlContainer = null;
  }
}
