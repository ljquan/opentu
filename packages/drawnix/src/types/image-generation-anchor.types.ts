import type { PlaitElement, Point } from '@plait/core';

export type ImageGenerationAnchorType = 'frame' | 'ratio' | 'ghost' | 'stack';

export type ImageGenerationAnchorPhase =
  | 'submitted'
  | 'queued'
  | 'generating'
  | 'developing'
  | 'inserting'
  | 'completed'
  | 'failed';

export type ImageGenerationAnchorTransitionMode = 'hold' | 'morph' | 'fade';

export type ImageGenerationAnchorActionType =
  | 'retry'
  | 'details'
  | 'dismiss'
  | 'none';

export interface ImageGenerationAnchorAction {
  type: ImageGenerationAnchorActionType;
  label: string;
  disabled?: boolean;
}

export type ImageGenerationAnchorBatchSlotStatus =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed';

export interface ImageGenerationAnchorBatchSlot {
  id: string;
  taskId?: string;
  status: ImageGenerationAnchorBatchSlotStatus;
  previewImageUrl?: string;
  error?: string;
}

export interface ImageGenerationAnchorBatchPreview {
  totalCount: number;
  visibleSlotCount: number;
  overflowCount: number;
  readySlotCount: number;
  generatingSlotCount: number;
  pendingSlotCount: number;
  failedSlotCount: number;
  hasPreviewImage: boolean;
  progress: number | null;
  statusText: string;
  slots: ImageGenerationAnchorBatchSlot[];
}

export interface ImageGenerationAnchorGeometry {
  position: Point;
  width: number;
  height: number;
}

export interface ImageGenerationAnchorSubmissionContext {
  workflowId: string;
  taskIds?: string[];
  expectedInsertPosition?: Point;
  prompt?: string;
  resultElementId?: string;
  targetElementId?: string;
  sourceTaskId?: string;
  latestTaskId?: string;
  targetFrameId?: string;
  targetFrameDimensions?: { width: number; height: number };
  frameAffinityId?: string;
  frameAffinityDimensions?: { width: number; height: number };
  requestedSize?: string;
  requestedCount?: number;
  zoom: number;
}

export interface ImageGenerationAnchorViewModel {
  id: string;
  anchorType: ImageGenerationAnchorType;
  phase: ImageGenerationAnchorPhase;
  title: string;
  subtitle: string;
  previewImageUrl?: string;
  batchPreview?: ImageGenerationAnchorBatchPreview;
  progress: number | null;
  progressMode: 'determinate' | 'indeterminate' | 'hidden';
  phaseLabel: string;
  tone: 'default' | 'warning' | 'success' | 'danger';
  geometry: ImageGenerationAnchorGeometry;
  transitionMode: ImageGenerationAnchorTransitionMode;
  primaryAction: ImageGenerationAnchorAction;
  secondaryAction?: ImageGenerationAnchorAction;
  error?: string;
  isTerminal: boolean;
}

export interface ImageGenerationAnchorCreateOptions
  extends ImageGenerationAnchorSubmissionContext {
  position: Point;
  size?: { width: number; height: number };
  anchorType?: ImageGenerationAnchorType;
  phase?: ImageGenerationAnchorPhase;
  title?: string;
  subtitle?: string;
  primaryTaskId?: string;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  progress?: number | null;
  error?: string;
  transitionMode?: ImageGenerationAnchorTransitionMode;
}

export interface PlaitImageGenerationAnchor extends PlaitElement {
  type: 'generation-anchor';
  points: [Point, Point];
  angle: number;
  anchorType: ImageGenerationAnchorType;
  phase: ImageGenerationAnchorPhase;
  title: string;
  subtitle?: string;
  previewImageUrl?: string;
  progress?: number | null;
  error?: string;
  transitionMode: ImageGenerationAnchorTransitionMode;
  createdAt: number;
  workflowId: string;
  taskIds: string[];
  primaryTaskId?: string;
  prompt?: string;
  resultElementId?: string;
  targetElementId?: string;
  sourceTaskId?: string;
  latestTaskId?: string;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  expectedInsertPosition?: Point;
  targetFrameId?: string;
  targetFrameDimensions?: { width: number; height: number };
  frameAffinityId?: string;
  frameAffinityDimensions?: { width: number; height: number };
  requestedSize?: string;
  requestedCount?: number;
  zoom: number;
}

export const DEFAULT_IMAGE_GENERATION_ANCHOR_SIZE = {
  width: 320,
  height: 180,
};

export const GHOST_IMAGE_GENERATION_ANCHOR_SIZE = {
  width: 168,
  height: 72,
};

export const IMAGE_GENERATION_ANCHOR_RETRY_EVENT =
  'image-generation-anchor:retry';

export const isImageGenerationAnchorElement = (
  element: any
): element is PlaitImageGenerationAnchor => {
  return element?.type === 'generation-anchor';
};
