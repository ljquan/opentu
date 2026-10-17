import {
  PlaitBoard,
  PlaitElement,
  PlaitOptionsBoard,
  PlaitPluginElementContext,
  Selection,
} from '@plait/core';
import { Freehand, FREEHAND_TYPE } from './type';
import { FreehandComponent } from './freehand.component';
import { withFreehandCreate } from './with-freehand-create';
import { isHitFreehand, isRectangleHitFreehand, getFreehandRectangle } from './utils';
import { withFreehandFragment } from './with-freehand-fragment';
import { withFreehandResize } from './with-freehand-resize';
import {
  getHitDrawElement,
  WithDrawOptions,
  WithDrawPluginKey,
} from '@plait/draw';
import { withFreehandErase } from './with-freehand-erase';
import { withLaserPointer } from './with-laser-pointer';
import { withImageMaskBinding } from './with-image-mask-binding';

export const withFreehand = (board: PlaitBoard) => {
  const {
    getRectangle,
    drawElement,
    isHit,
    isRectangleHit,
    getOneHitElement,
    isMovable,
    isAlign,
  } = board;

  board.drawElement = (context: PlaitPluginElementContext) => {
    if (Freehand.isFreehand(context.element)) {
      return FreehandComponent;
    }
    return drawElement(context);
  };

  board.getRectangle = (element: PlaitElement) => {
    if (Freehand.isFreehand(element)) {
      return getFreehandRectangle(element);
    }
    return getRectangle(element);
  };

  board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
    if (Freehand.isFreehand(element)) {
      return isRectangleHitFreehand(board, element, selection);
    }
    return isRectangleHit(element, selection);
  };

  board.isHit = (element, point, isStrict?: boolean) => {
    if (Freehand.isFreehand(element)) {
      return isHitFreehand(board, element, point);
    }
    return isHit(element, point, isStrict);
  };

  board.getOneHitElement = (elements) => {
    const isAllFreehand = elements.every((item) => Freehand.isFreehand(item));
    if (isAllFreehand) {
      return getHitDrawElement(board, elements as Freehand[]);
    }
    return getOneHitElement(elements);
  };

  board.isMovable = (element) => {
    if (Freehand.isFreehand(element)) {
      return true;
    }
    return isMovable(element);
  };

  board.isAlign = (element) => {
    if (Freehand.isFreehand(element)) {
      return true;
    }
    return isAlign(element);
  };

  (board as PlaitOptionsBoard).setPluginOptions<WithDrawOptions>(
    WithDrawPluginKey,
    { customGeometryTypes: [FREEHAND_TYPE] }
  );

  return withImageMaskBinding(withLaserPointer(withFreehandResize(withFreehandErase(withFreehandFragment(withFreehandCreate(board))))));
};
