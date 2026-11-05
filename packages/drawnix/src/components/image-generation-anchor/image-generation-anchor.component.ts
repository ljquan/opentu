import {
  ACTIVE_STROKE_WIDTH,
  OnContextChanged,
  PlaitBoard,
  PlaitPluginElementContext,
} from '@plait/core';
import {
  ActiveGenerator,
  CommonElementFlavour,
  createActiveGenerator,
} from '@plait/common';
import type { PlaitImageGenerationAnchor } from '../../types/image-generation-anchor.types';
import { ImageGenerationAnchorGenerator } from './image-generation-anchor.generator';
import {
  getImageGenerationAnchorRenderedRectangle,
  setImageGenerationAnchorRenderedSize,
  clearImageGenerationAnchorRenderedSize,
} from '../../utils/image-generation-anchor-bounds';

export class ImageGenerationAnchorComponent
  extends CommonElementFlavour<PlaitImageGenerationAnchor, PlaitBoard>
  implements OnContextChanged<PlaitImageGenerationAnchor, PlaitBoard>
{
  private anchorGenerator!: ImageGenerationAnchorGenerator;
  private activeGenerator!: ActiveGenerator<PlaitImageGenerationAnchor>;
  private renderedG?: SVGGElement;
  private destroyed = false;

  initializeGenerator(): void {
    this.activeGenerator = createActiveGenerator(this.board, {
      getRectangle: (element: PlaitImageGenerationAnchor) => {
        return getImageGenerationAnchorRenderedRectangle(this.board, element);
      },
      getStrokeWidth: () => ACTIVE_STROKE_WIDTH,
      getStrokeOpacity: () => 0.9,
      hasResizeHandle: () => false,
    });

    this.anchorGenerator = new ImageGenerationAnchorGenerator(this.board);
    this.anchorGenerator.onSizeChange = (size) => {
      if (
        this.destroyed ||
        !setImageGenerationAnchorRenderedSize(this.board, this.element.id, size)
      )
        return;
      this.activeGenerator.processDrawing(
        this.element,
        PlaitBoard.getActiveHost(this.board),
        { selected: this.selected }
      );
    };
  }

  initialize(): void {
    super.initialize();
    this.initializeGenerator();

    const elementG = this.getElementG();
    this.renderedG = this.anchorGenerator.processDrawing(
      this.element,
      elementG,
      this.selected
    );

    this.activeGenerator.processDrawing(
      this.element,
      PlaitBoard.getActiveHost(this.board),
      { selected: this.selected }
    );
  }

  onContextChanged(
    value: PlaitPluginElementContext<PlaitImageGenerationAnchor, PlaitBoard>,
    previous: PlaitPluginElementContext<PlaitImageGenerationAnchor, PlaitBoard>
  ): void {
    const viewportChanged =
      value.board.viewport.zoom !== previous.board.viewport.zoom ||
      value.board.viewport.offsetX !== previous.board.viewport.offsetX ||
      value.board.viewport.offsetY !== previous.board.viewport.offsetY;

    if (value.element !== previous.element || value.hasThemeChanged) {
      if (this.renderedG) {
        this.anchorGenerator.updateDrawing(
          this.element,
          this.renderedG,
          this.selected
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
        this.anchorGenerator.updateDrawing(
          this.element,
          this.renderedG,
          this.selected
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
    this.destroyed = true;
    clearImageGenerationAnchorRenderedSize(this.board, this.element.id);
    super.destroy();

    if (this.activeGenerator) {
      this.activeGenerator.destroy();
    }

    if (this.anchorGenerator) {
      this.anchorGenerator.destroy();
    }

    this.renderedG = undefined;
  }
}
