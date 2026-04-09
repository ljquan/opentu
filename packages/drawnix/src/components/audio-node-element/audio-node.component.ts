import {
  ACTIVE_STROKE_WIDTH,
  OnContextChanged,
  PlaitBoard,
  PlaitPluginElementContext,
  RectangleClient,
  SELECTION_RECTANGLE_CLASS_NAME,
  createG,
  drawRectangle,
  toActiveRectangleFromViewBoxRectangle,
} from '@plait/core';
import {
  CommonElementFlavour,
  Generator,
  drawPrimaryHandle,
  hasResizeHandle,
} from '@plait/common';
import { getCanvasAudioPlaybackQueue } from '../../data/audio';
import type { PlaitAudioNode } from '../../types/audio-node.types';
import { AudioNodeGenerator } from './audio-node.generator';

interface AudioNodeSelectionData {
  selected: boolean;
}

class AudioNodeSelectionGenerator extends Generator<PlaitAudioNode, AudioNodeSelectionData> {
  canDraw(_element: PlaitAudioNode, data?: AudioNodeSelectionData): boolean {
    return Boolean(data?.selected);
  }

  draw(element: PlaitAudioNode): SVGGElement {
    const selectionG = createG();
    const rectangle = RectangleClient.getRectangleByPoints(element.points);
    const activeRectangle = toActiveRectangleFromViewBoxRectangle(this.board, rectangle);
    const activeRectangleWithDelta = RectangleClient.inflate(activeRectangle, ACTIVE_STROKE_WIDTH);
    const strokeG = drawRectangle(this.board, activeRectangleWithDelta, {
      stroke: '#2563eb',
      strokeWidth: ACTIVE_STROKE_WIDTH,
    });

    if (strokeG) {
      strokeG.classList.add(SELECTION_RECTANGLE_CLASS_NAME);
      strokeG.style.opacity = '0.9';
      selectionG.append(strokeG);
    }

    if (this.options?.active && hasResizeHandle(this.board, element)) {
      const midY = activeRectangleWithDelta.y + activeRectangleWithDelta.height / 2;
      const leftHandle = drawPrimaryHandle(this.board, [
        activeRectangleWithDelta.x,
        midY,
      ]);
      const rightHandle = drawPrimaryHandle(this.board, [
        activeRectangleWithDelta.x + activeRectangleWithDelta.width,
        midY,
      ]);
      selectionG.append(leftHandle, rightHandle);
    }

    return selectionG;
  }
}

export class AudioNodeComponent
  extends CommonElementFlavour<PlaitAudioNode, PlaitBoard>
  implements OnContextChanged<PlaitAudioNode, PlaitBoard>
{
  private audioNodeGenerator!: AudioNodeGenerator;
  private activeGenerator!: AudioNodeSelectionGenerator;
  private renderedG?: SVGGElement;

  initializeGenerator(): void {
    this.activeGenerator = new AudioNodeSelectionGenerator(this.board, { active: true });
    this.audioNodeGenerator = new AudioNodeGenerator();
  }

  initialize(): void {
    super.initialize();
    this.initializeGenerator();

    const elementG = this.getElementG();
    this.renderedG = this.audioNodeGenerator.processDrawing(
      this.element,
      elementG,
      this.selected,
      getCanvasAudioPlaybackQueue(this.board.children)
    );

    this.activeGenerator.processDrawing(
      this.element,
      PlaitBoard.getActiveHost(this.board),
      { selected: this.selected }
    );
  }

  onContextChanged(
    value: PlaitPluginElementContext<PlaitAudioNode, PlaitBoard>,
    previous: PlaitPluginElementContext<PlaitAudioNode, PlaitBoard>
  ): void {
    const viewportChanged =
      value.board.viewport.zoom !== previous.board.viewport.zoom ||
      value.board.viewport.offsetX !== previous.board.viewport.offsetX ||
      value.board.viewport.offsetY !== previous.board.viewport.offsetY;

    if (value.element !== previous.element || value.hasThemeChanged) {
      if (this.renderedG) {
        this.audioNodeGenerator.updateDrawing(
          this.element,
          this.renderedG,
          this.selected,
          getCanvasAudioPlaybackQueue(this.board.children)
        );
      }

      this.activeGenerator.processDrawing(
        this.element,
        PlaitBoard.getActiveHost(this.board),
        { selected: this.selected }
      );
    } else if (viewportChanged && value.selected) {
      this.activeGenerator.processDrawing(
        this.element,
        PlaitBoard.getActiveHost(this.board),
        { selected: this.selected }
      );
    } else {
      const needUpdate = value.selected !== previous.selected;

      if (needUpdate && this.renderedG) {
        this.audioNodeGenerator.updateDrawing(
          this.element,
          this.renderedG,
          this.selected,
          getCanvasAudioPlaybackQueue(this.board.children)
        );
      }

      if (needUpdate || value.selected) {
        this.activeGenerator.processDrawing(
          this.element,
          PlaitBoard.getActiveHost(this.board),
          { selected: this.selected }
        );
      }
    }
  }

  destroy(): void {
    super.destroy();

    if (this.activeGenerator) {
      this.activeGenerator.destroy();
    }

    if (this.audioNodeGenerator) {
      this.audioNodeGenerator.destroy();
    }

    this.renderedG = undefined;
  }
}
