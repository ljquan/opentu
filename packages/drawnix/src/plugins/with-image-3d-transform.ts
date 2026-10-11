import type {
  ImageProps,
  PlaitImageBoard,
  RenderComponentRef,
} from '@plait/common';
import {
  ActiveGenerator,
  CommonElementFlavour,
  FOREIGN_OBJECT_IMAGE_CLASS_NAME,
  Generator,
  createActiveGenerator,
  getElementOfFocusedImage,
  hasResizeHandle,
} from '@plait/common';
import {
  ACTIVE_STROKE_WIDTH,
  OnContextChanged,
  PlaitBoard,
  PlaitElement,
  PlaitPlugin,
  PlaitPluginElementContext,
  Point,
  RectangleClient,
  Selection,
  createForeignObject,
  createG,
  getSelectedElements,
  isSelectionMoving,
  setAngleForG,
  updateForeignObject,
} from '@plait/core';
import { ArrowLineAutoCompleteGenerator } from '@plait/draw';
import {
  getImage3DSourceRectangle,
  getImage3DVisualGeometry,
  getImage3DVisualRectangle,
  isPointInImage3DVisualGeometry,
  isRectangleHitImage3DVisualGeometry,
} from '../utils/image-3d-transform';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

type Image3DElement = PlaitElement & {
  points: [Point, Point];
  url: string;
  angle?: number;
};

class Image3DTransformGenerator extends Generator<Image3DElement> {
  element!: Image3DElement;
  foreignObject?: SVGForeignObjectElement;
  imageComponentRef?: RenderComponentRef<ImageProps>;
  activeGenerator: ActiveGenerator<Image3DElement>;
  isFocus = false;
  private lastReactRenderKey = '';

  constructor(public board: PlaitBoard & PlaitImageBoard) {
    super(board);
    this.activeGenerator = createActiveGenerator(this.board, {
      getStrokeWidth: () => ACTIVE_STROKE_WIDTH,
      getStrokeOpacity: () => {
        const selectedElements = getSelectedElements(this.board);
        if (
          (selectedElements.length === 1 && !isSelectionMoving(this.board)) ||
          !selectedElements.length
        ) {
          return 1;
        }
        return 0.5;
      },
      getRectangle: (element) => this.getActiveRectangle(element),
      hasResizeHandle: () => {
        const isSelectedImageElement = hasResizeHandle(this.board, this.element);
        const isSelectedImage = !!getElementOfFocusedImage(this.board);
        return isSelectedImage || isSelectedImageElement;
      },
    });
  }

  canDraw(element: Image3DElement): boolean {
    return !!getImage3DVisualGeometry(element);
  }

  draw(element: Image3DElement): SVGGElement {
    this.element = element;
    this.lastReactRenderKey = this.getReactRenderKey(element, true);
    const g = createG();
    const sourceRectangle = this.getSourceRectangle(element);
    this.foreignObject = createForeignObject(
      sourceRectangle.x,
      sourceRectangle.y,
      sourceRectangle.width,
      sourceRectangle.height
    );
    this.foreignObject.classList.add(FOREIGN_OBJECT_IMAGE_CLASS_NAME);
    g.append(this.foreignObject);
    this.imageComponentRef = this.board.renderImage(
      this.foreignObject,
      this.getImageProps(element)
    );

    return g;
  }

  updateImage(current: Image3DElement) {
    this.element = current;
    const geometry = getImage3DVisualGeometry(current);
    const didSyncSvgOverlay = geometry
      ? this.syncSvgOverlay(current, geometry)
      : false;
    const reactRenderKey = this.getReactRenderKey(current, !!geometry);
    const shouldUpdateImageProps =
      reactRenderKey !== this.lastReactRenderKey ||
      (!!geometry && !didSyncSvgOverlay);

    if (shouldUpdateImageProps && this.imageComponentRef) {
      this.imageComponentRef.update(this.getImageProps(current));
    }
    this.lastReactRenderKey = reactRenderKey;

    if (this.g) {
      const sourceRectangle = this.getSourceRectangle(current);
      updateForeignObject(
        this.g,
        sourceRectangle.width,
        sourceRectangle.height,
        sourceRectangle.x,
        sourceRectangle.y
      );
      if (current.angle !== undefined) {
        setAngleForG(
          this.g,
          RectangleClient.getCenterPoint(sourceRectangle),
          current.angle
        );
      }
    }
  }

  setFocus(element: Image3DElement, isFocus: boolean) {
    const focusChanged = this.isFocus !== isFocus;
    this.isFocus = isFocus;
    this.drawActive(element, isFocus);
    if (focusChanged) {
      this.imageComponentRef?.update({ isFocus });
    }
  }

  destroy() {
    super.destroy();
    this.imageComponentRef?.destroy();
    this.activeGenerator?.destroy();
  }

  private drawActive(element: Image3DElement, selected: boolean) {
    this.activeGenerator.processDrawing(
      element,
      PlaitBoard.getActiveHost(this.board),
      { selected }
    );
  }

  private getImageProps(element: Image3DElement): ImageProps {
    const sourceRectangle = this.getSourceRectangle(element);
    return {
      board: this.board,
      imageItem: {
        url: element.url,
        width: sourceRectangle.width,
        height: sourceRectangle.height,
      },
      element,
      getRectangle: () => this.getSourceRectangle(element),
    };
  }

  private getSourceRectangle(element: Image3DElement): RectangleClient {
    return (
      getImage3DSourceRectangle(element) ||
      RectangleClient.getRectangleByPoints(element.points)
    );
  }

  private getActiveRectangle(element: Image3DElement): RectangleClient {
    return getImage3DVisualRectangle(element) || this.getSourceRectangle(element);
  }

  private getReactRenderKey(
    element: Image3DElement,
    has3DGeometry: boolean
  ): string {
    const rectangle = this.getSourceRectangle(element);
    const needsOriginal = Math.max(rectangle.width, rectangle.height) * this.board.viewport.zoom * (window.devicePixelRatio || 1) > 400;
    return [
      element.id,
      element.url,
      has3DGeometry ? '3d' : 'flat',
      rectangle.width,
      rectangle.height,
      needsOriginal ? 'original' : 'preview',
    ].join('|');
  }

  private syncSvgOverlay(
    element: Image3DElement,
    geometry = getImage3DVisualGeometry(element)
  ): boolean {
    if (!this.g || !geometry) {
      return false;
    }

    const overlayGroup = this.g.querySelector<SVGGElement>(
      'g[data-image-3d-overlay="true"]'
    );
    const overlayImage =
      overlayGroup?.querySelector<SVGImageElement>('image') || null;
    const clipPolygon =
      overlayGroup?.querySelector<SVGPolygonElement>('clipPath polygon') ||
      null;
    if (!overlayGroup || !overlayImage || !clipPolygon) {
      return false;
    }

    clipPolygon.setAttribute('points', geometry.pointsAttribute);
    // Keep the cached source resolved by React during viewport-only updates.
    if (overlayImage.dataset.originalSource !== element.url) {
      overlayImage.dataset.originalSource = element.url;
      overlayImage.setAttribute('href', element.url);
      overlayImage.setAttributeNS(XLINK_NS, 'href', element.url);
    }
    overlayImage.setAttribute('x', String(geometry.boundingBox.x));
    overlayImage.setAttribute('y', String(geometry.boundingBox.y));
    overlayImage.setAttribute('width', String(geometry.boundingBox.width));
    overlayImage.setAttribute('height', String(geometry.boundingBox.height));
    if (geometry.textureTransform) {
      overlayImage.setAttribute('transform', geometry.textureTransform);
    } else {
      overlayImage.removeAttribute('transform');
    }

    return true;
  }
}

class Image3DTransformComponent
  extends CommonElementFlavour<Image3DElement, PlaitBoard>
  implements OnContextChanged<Image3DElement, PlaitBoard>
{
  imageGenerator!: Image3DTransformGenerator;
  lineAutoCompleteGenerator!: ArrowLineAutoCompleteGenerator<any>;

  initializeGenerator() {
    this.imageGenerator = new Image3DTransformGenerator(
      this.board as PlaitBoard & PlaitImageBoard
    );
    this.lineAutoCompleteGenerator = new ArrowLineAutoCompleteGenerator(
      this.board
    );
    this.getRef().addGenerator(
      ArrowLineAutoCompleteGenerator.key,
      this.lineAutoCompleteGenerator
    );
    this.getRef().updateActiveSection = () => this.updateActiveSection();
  }

  initialize(): void {
    super.initialize();
    this.initializeGenerator();
    this.imageGenerator.processDrawing(this.element, this.getElementG());
    this.updateActiveSection();
  }

  onContextChanged(
    value: PlaitPluginElementContext<Image3DElement, PlaitBoard>,
    previous: PlaitPluginElementContext<Image3DElement, PlaitBoard>
  ) {
    const viewportChanged =
      value.board.viewport.zoom !== previous.board.viewport.zoom ||
      value.board.viewport.offsetX !== previous.board.viewport.offsetX ||
      value.board.viewport.offsetY !== previous.board.viewport.offsetY;

    const shouldUpdateImage =
      value.element !== previous.element ||
      value.hasThemeChanged ||
      value.selected;

    if (shouldUpdateImage || viewportChanged) {
      this.imageGenerator.updateImage(value.element);
      this.updateActiveSection();
      return;
    }

    if (viewportChanged && value.selected) {
      this.updateActiveSection();
      return;
    }

    if (value.selected !== previous.selected || value.selected) {
      this.updateActiveSection();
    }
  }

  destroy(): void {
    super.destroy();
    this.imageGenerator?.destroy();
    this.lineAutoCompleteGenerator?.destroy();
  }

  private updateActiveSection() {
    this.imageGenerator.setFocus(this.element, this.selected);
    this.lineAutoCompleteGenerator.processDrawing(
      this.element as any,
      PlaitBoard.getActiveHost(this.board),
      { selected: this.selected }
    );
  }
}

export const withImage3DTransform: PlaitPlugin = (board: PlaitBoard) => {
  const { drawElement, isHit, isRectangleHit } = board;

  board.drawElement = (context: PlaitPluginElementContext) => {
    if (getImage3DVisualGeometry(context.element)) {
      return Image3DTransformComponent;
    }
    return drawElement(context);
  };

  board.isHit = (element: PlaitElement, point: Point, isStrict?: boolean) => {
    const geometry = getImage3DVisualGeometry(element);
    if (geometry) {
      return isPointInImage3DVisualGeometry(point, geometry);
    }
    return isHit(element, point, isStrict);
  };

  board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
    const geometry = getImage3DVisualGeometry(element);
    if (geometry) {
      const selectionRectangle = RectangleClient.getRectangleByPoints([
        selection.anchor,
        selection.focus,
      ]);
      return isRectangleHitImage3DVisualGeometry(
        selectionRectangle,
        geometry
      );
    }
    return isRectangleHit(element, selection);
  };

  return board;
};
