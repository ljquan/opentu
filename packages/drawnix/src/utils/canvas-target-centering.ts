import {
  getRectangleByElements,
  getSelectedElements,
  PlaitBoard,
  type Point,
} from '@plait/core';
import { isWorkZoneElement } from '../plugins/with-workzone';
import { getCanvasGenerationDetailsSource } from './canvas-generation-details-source';

export function getCanvasTargetCenteringOrigination(
  board: PlaitBoard
): Point | null {
  const elements = getSelectedElements(board).filter(
    (element) => !isWorkZoneElement(element)
  );
  if (
    elements.length !== 1 ||
    !getCanvasGenerationDetailsSource(elements[0]) ||
    PlaitBoard.hasBeenTextEditing(board)
  )
    return null;

  const rectangle = getRectangleByElements(board, elements, false);
  const viewport = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
  const zoom = board.viewport.zoom;
  if (
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }
  return [
    rectangle.x + rectangle.width / 2 - viewport.width / (2 * zoom),
    rectangle.y + rectangle.height / 2 - viewport.height / (2 * zoom),
  ];
}
