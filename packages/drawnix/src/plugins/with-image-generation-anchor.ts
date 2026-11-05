import {
  getSelectedElements,
  PlaitBoard,
  PlaitElement,
  PlaitPlugin,
  PlaitPluginElementContext,
  Point,
  RectangleClient,
  Selection,
} from '@plait/core';
import { ImageGenerationAnchorComponent } from '../components/image-generation-anchor/image-generation-anchor.component';
import { ImageGenerationAnchorTransforms } from '../components/image-generation-anchor/image-generation-anchor.transforms';
import { getImageGenerationAnchorRenderedRectangle } from '../utils/image-generation-anchor-bounds';
import {
  isImageGenerationAnchorElement,
} from '../types/image-generation-anchor.types';

function isRectIntersect(
  rect1: { x: number; y: number; width: number; height: number },
  rect2: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}

export { ImageGenerationAnchorTransforms };

export const withImageGenerationAnchor: PlaitPlugin = (board: PlaitBoard) => {
  const {
    drawElement,
    getRectangle,
    isHit,
    isRectangleHit,
    isMovable,
    isAlign,
    getDeletedFragment: originGetDeletedFragment,
  } =
    board;

  board.drawElement = (context: PlaitPluginElementContext) => {
    if (isImageGenerationAnchorElement(context.element)) {
      return ImageGenerationAnchorComponent;
    }

    return drawElement(context);
  };

  board.getRectangle = (element: PlaitElement) => {
    if (isImageGenerationAnchorElement(element)) {
      return getImageGenerationAnchorRenderedRectangle(board, element);
    }

    return getRectangle(element);
  };

  board.isHit = (element: PlaitElement, point: Point, isStrict?: boolean) => {
    if (isImageGenerationAnchorElement(element)) {
      const rect = getImageGenerationAnchorRenderedRectangle(board, element);
      return (
        point[0] >= rect.x &&
        point[0] <= rect.x + rect.width &&
        point[1] >= rect.y &&
        point[1] <= rect.y + rect.height
      );
    }

    return isHit(element, point, isStrict);
  };

  board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
    if (isImageGenerationAnchorElement(element)) {
      const rect = getImageGenerationAnchorRenderedRectangle(board, element);
      const selectionRect = RectangleClient.getRectangleByPoints([
        selection.anchor,
        selection.focus,
      ]);

      return isRectIntersect(rect, selectionRect);
    }

    return isRectangleHit(element, selection);
  };

  board.isMovable = (element: PlaitElement) => {
    if (isImageGenerationAnchorElement(element)) {
      return true;
    }

    return isMovable(element);
  };

  board.isAlign = (element: PlaitElement) => {
    if (isImageGenerationAnchorElement(element)) {
      return true;
    }

    return isAlign(element);
  };

  board.getDeletedFragment = (data: PlaitElement[]) => {
    const selectedAnchors = getSelectedElements(board).filter(
      isImageGenerationAnchorElement
    );

    if (selectedAnchors.length > 0) {
      data.push(...selectedAnchors);
    }

    return originGetDeletedFragment(data);
  };

  return board;
};

export default withImageGenerationAnchor;
