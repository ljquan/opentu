import type { WorkflowMessageData } from '../types/chat.types';
import type {
  ImageGenerationAnchorPhase,
  ImageGenerationAnchorViewModel,
  PlaitImageGenerationAnchor,
} from '../types/image-generation-anchor.types';
import type { Task } from '../types/task.types';
import {
  buildImageGenerationAnchorViewModel,
  deriveImageGenerationAnchorPhase,
} from './image-generation-anchor-view-model';

export interface ImageGenerationAnchorControllerOptions {
  anchor: PlaitImageGenerationAnchor;
  task?: Task | null;
  tasks?: Task[];
  workflow?: WorkflowMessageData | null;
  postProcessingStatus?: WorkflowMessageData['postProcessingStatus'];
  isInserting?: boolean;
  hasInserted?: boolean;
  canvasReady?: boolean;
  taskDisplayProgress?: number | null;
}

export interface ImageGenerationAnchorControllerResult {
  phase: ImageGenerationAnchorPhase;
  nextPatch: Partial<PlaitImageGenerationAnchor>;
  viewModel: ImageGenerationAnchorViewModel;
}

export function getImageGenerationAnchorControllerResult(
  options: ImageGenerationAnchorControllerOptions
): ImageGenerationAnchorControllerResult {
  const {
    anchor,
    task,
    tasks,
    taskDisplayProgress,
    workflow,
    postProcessingStatus,
    isInserting,
    hasInserted,
    canvasReady,
  } = options;

  const phase = deriveImageGenerationAnchorPhase({
    anchor,
    task,
    tasks,
    workflow,
    postProcessingStatus,
    isInserting,
    hasInserted,
    canvasReady,
  });

  const viewModel = buildImageGenerationAnchorViewModel({
    anchor,
    task,
    tasks,
    taskDisplayProgress,
    workflow,
    postProcessingStatus,
    isInserting,
    hasInserted,
    canvasReady,
  });

  return {
    phase,
    nextPatch: {
      phase,
      progress: viewModel.progress,
      subtitle: viewModel.subtitle,
      error: viewModel.error,
    },
    viewModel,
  };
}
