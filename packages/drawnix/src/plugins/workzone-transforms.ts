import type { PlaitBoard } from '@plait/core';
import { PlaitHistoryBoard, RectangleClient, Transforms } from '@plait/core';
import type {
  PlaitWorkZone,
  WorkZoneCreateOptions,
} from '../types/workzone.types';
import { DEFAULT_WORKZONE_SIZE } from '../types/workzone.types';

export function isWorkZoneElement(element: any): element is PlaitWorkZone {
  return element && element.type === 'workzone';
}

export function getWorkZoneRenderScale(
  element: Pick<PlaitWorkZone, 'zoom'>
): number {
  return Number.isFinite(element.zoom) && element.zoom > 0
    ? 1 / element.zoom
    : 1;
}

export function getWorkZoneVisualRectangle(element: PlaitWorkZone) {
  const rect = RectangleClient.getRectangleByPoints(element.points);
  const scale = getWorkZoneRenderScale(element);
  return {
    ...rect,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

function generateId(): string {
  return `workzone_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export const WorkZoneTransforms = {
  insertWorkZone(
    board: PlaitBoard,
    options: WorkZoneCreateOptions
  ): PlaitWorkZone {
    const {
      workflow,
      position,
      size = DEFAULT_WORKZONE_SIZE,
      expectedInsertPosition,
      targetFrameId,
      targetFrameDimensions,
      zoom,
    } = options;

    const workzoneElement: PlaitWorkZone = {
      id: generateId(),
      type: 'workzone',
      points: [position, [position[0] + size.width, position[1] + size.height]],
      angle: 0,
      workflow,
      createdAt: Date.now(),
      expectedInsertPosition,
      targetFrameId,
      targetFrameDimensions,
      zoom,
    };

    PlaitHistoryBoard.withoutSaving(board, () => {
      Transforms.insertNode(board, workzoneElement, [board.children.length]);
    });

    return workzoneElement;
  },

  updateWorkflow(
    board: PlaitBoard,
    elementId: string,
    workflow: Partial<PlaitWorkZone['workflow']>
  ): void {
    const index = board.children.findIndex((el: any) => el.id === elementId);
    if (index < 0) return;

    const element = board.children[index] as PlaitWorkZone;
    const updatedWorkflow = { ...element.workflow, ...workflow };
    PlaitHistoryBoard.withoutSaving(board, () => {
      Transforms.setNode(
        board,
        { workflow: updatedWorkflow } as Partial<PlaitWorkZone>,
        [index]
      );
    });
  },

  removeWorkZone(board: PlaitBoard, elementId: string): void {
    const index = board.children.findIndex((el: any) => el.id === elementId);
    if (index < 0) return;

    PlaitHistoryBoard.withoutSaving(board, () => {
      Transforms.removeNode(board, [index]);
    });
  },

  getWorkZoneById(
    board: PlaitBoard,
    elementId: string
  ): PlaitWorkZone | null {
    const element = board.children.find((el: any) => el.id === elementId);
    return element && isWorkZoneElement(element) ? element : null;
  },

  getAllWorkZones(board: PlaitBoard): PlaitWorkZone[] {
    return board.children.filter(isWorkZoneElement) as PlaitWorkZone[];
  },
};
