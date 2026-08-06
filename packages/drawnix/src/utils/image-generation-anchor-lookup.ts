import type { PlaitBoard } from '@plait/core';
import { ImageGenerationAnchorTransforms } from '../plugins/with-image-generation-anchor';
import type { PlaitImageGenerationAnchor } from '../types/image-generation-anchor.types';
import type { Task } from '../types/task.types';
import {
  getImageGenerationAnchorTaskBatchId,
  getImageGenerationAnchorTaskBatchIndex,
  getImageGenerationAnchorTaskWorkflowId,
  hasExplicitBatchBinding,
} from './image-generation-anchor-task';

export function findImageGenerationAnchorForTaskOnBoard(
  board: PlaitBoard,
  taskOrTaskId: Task | string
): PlaitImageGenerationAnchor | null {
  if (typeof taskOrTaskId === 'string') {
    return ImageGenerationAnchorTransforms.getAnchorByTaskId(
      board,
      taskOrTaskId
    );
  }

  const explicitAnchorId = taskOrTaskId.params?.anchorId;
  if (typeof explicitAnchorId === 'string' && explicitAnchorId.trim()) {
    const byAnchorId = ImageGenerationAnchorTransforms.getAnchorById(
      board,
      explicitAnchorId.trim()
    );
    if (byAnchorId) {
      return byAnchorId;
    }
  }

  const byTaskId = ImageGenerationAnchorTransforms.getAnchorByTaskId(
    board,
    taskOrTaskId.id
  );
  if (byTaskId) {
    return byTaskId;
  }

  const workflowId = getImageGenerationAnchorTaskWorkflowId(taskOrTaskId);
  const batchId = getImageGenerationAnchorTaskBatchId(taskOrTaskId);
  const batchIndex = getImageGenerationAnchorTaskBatchIndex(taskOrTaskId);

  if (batchId && typeof batchIndex === 'number') {
    const byBatchSlot = ImageGenerationAnchorTransforms.getAnchorByBatchSlot(
      board,
      {
        workflowId,
        batchId,
        batchIndex,
      }
    );

    if (byBatchSlot) {
      return byBatchSlot;
    }

    const byLegacyBatchSlot = ImageGenerationAnchorTransforms.getAllAnchors(
      board
    ).find(
      (anchor) =>
        anchor.anchorType !== 'stack' &&
        anchor.batchId === batchId &&
        anchor.batchIndex === batchIndex &&
        (!workflowId || anchor.workflowId === workflowId)
    );

    if (byLegacyBatchSlot) {
      return byLegacyBatchSlot;
    }
  }

  if (workflowId) {
    const workflowAnchors =
      ImageGenerationAnchorTransforms.getAnchorsByWorkflowId(board, workflowId);
    const legacyWorkflowAnchor = workflowAnchors.find(
      (anchor) => !hasExplicitBatchBinding(anchor)
    );

    return legacyWorkflowAnchor || workflowAnchors[0] || null;
  }

  return null;
}
