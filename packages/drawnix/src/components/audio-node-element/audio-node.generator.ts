import { RectangleClient } from '@plait/core';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import type { PlaitAudioNode } from '../../types/audio-node.types';
import type { CanvasAudioPlaybackSource } from '../../services/canvas-audio-playback-service';
import { AudioNodeContent } from './AudioNodeContent';

export class AudioNodeGenerator {
  private foreignObject: SVGForeignObjectElement | null = null;
  private htmlContainer: HTMLElement | null = null;
  private reactRoot: Root | null = null;

  processDrawing(
    element: PlaitAudioNode,
    parentG: SVGGElement,
    selected: boolean,
    canvasQueue: CanvasAudioPlaybackSource[]
  ): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'audio-node-element');
    parentG.appendChild(g);

    this.createForeignObject(element, g);
    this.renderReact(element, selected, canvasQueue);
    return g;
  }

  updateDrawing(
    element: PlaitAudioNode,
    _g: SVGGElement,
    selected: boolean,
    canvasQueue: CanvasAudioPlaybackSource[]
  ): void {
    this.updateForeignObject(element);
    this.renderReact(element, selected, canvasQueue);
  }

  private createForeignObject(element: PlaitAudioNode, g: SVGGElement): void {
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

  private updateForeignObject(element: PlaitAudioNode): void {
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
    element: PlaitAudioNode,
    selected: boolean,
    canvasQueue: CanvasAudioPlaybackSource[]
  ): void {
    if (!this.htmlContainer) {
      return;
    }

    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.htmlContainer);
    }

    this.reactRoot.render(
      React.createElement(AudioNodeContent, {
        element,
        selected,
        canvasQueue,
      })
    );
  }

  destroy(): void {
    if (this.reactRoot) {
      try {
        this.reactRoot.unmount();
      } catch {
        // Ignore unmount failures during teardown.
      }
      this.reactRoot = null;
    }

    this.foreignObject = null;
    this.htmlContainer = null;
  }
}
