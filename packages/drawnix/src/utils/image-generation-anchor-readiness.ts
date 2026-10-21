import type { PlaitBoard } from '@plait/core';
import { isCanvasImageReady } from '../services/canvas-image-readiness';
import { workflowCompletionService } from '../services/workflow-completion-service';
import type { PlaitImageGenerationAnchor } from '../types/image-generation-anchor.types';
import type { Task } from '../types/task.types';

export function areImageGenerationResultsReady(
  board: PlaitBoard,
  anchor: PlaitImageGenerationAnchor,
  tasks: Task[]
): boolean {
  const taskIds = new Set(tasks.map((task) => task.id));
  const resultIds = new Set(
    tasks
      .map(
        (task) =>
          workflowCompletionService.getPostProcessingStatus(task.id)
            ?.firstElementId
      )
      .filter(Boolean)
  );
  if (anchor.resultElementId) {
    resultIds.add(anchor.resultElementId);
  }

  const images = board.children.filter(
    (element) =>
      element.type === 'image' &&
      typeof element.url === 'string' &&
      (resultIds.has(element.id) ||
        taskIds.has(element.generationTaskId) ||
        element.generationAnchorId === anchor.id)
  );

  if (images.length === 0) {
    return false;
  }

  // Every inserted task must have a canvas result; a thumbnail is not enough.
  if (
    !tasks.every((task) => {
      const resultId = workflowCompletionService.getPostProcessingStatus(
        task.id
      )?.firstElementId;
      return images.some(
        (image) =>
          image.generationTaskId === task.id ||
          image.id === resultId ||
          (tasks.length === 1 && image.id === anchor.resultElementId)
      );
    })
  ) {
    return false;
  }

  return images.every((image) =>
    isCanvasImageReady(board, image.id, image.url)
  );
}
