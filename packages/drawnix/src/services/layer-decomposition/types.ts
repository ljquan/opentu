export type LayerBoundingBoxTuple = [number, number, number, number];

export interface LayerBoundingBox {
  absolute: LayerBoundingBoxTuple;
  normalized: LayerBoundingBoxTuple;
}

export interface LayerArtifact {
  groupId: string;
  url: string;
  zIndex: number;
  boundingBox: LayerBoundingBox;
  name: string;
  description: string;
  confidence?: number;
}

export interface LayerDecompositionRequest {
  image: string;
  prompt?: string;
  mode?: Exclude<LayerDecompositionMode, 'bbox'>;
  maxLayers: number;
}

export interface LayerDecompositionRequestPayload {
  image: string;
  prompt?: string;
  mode?: Exclude<LayerDecompositionMode, 'bbox'>;
  max_layers?: number;
}

export type LayerDecompositionPhase =
  | 'recognizing'
  | 'extracting'
  | 'inpainting'
  | 'validating'
  | (string & {});

export type LayerDecompositionJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'in_progress'
  | 'correcting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stopped';

export interface LayerDecompositionJob {
  taskId: string;
  status: LayerDecompositionJobStatus;
  progress: number;
  phase?: LayerDecompositionPhase;
  result?: LayerDecompositionResponse;
  error?: string;
}

export interface LayerDecompositionCorrectionRequest {
  prompt?: string;
  action?: 'add' | 'remove' | 'replace';
  layerZIndex?: number;
  boundingBox?: LayerBoundingBoxTuple;
  mask?: string;
}

export interface LayerDecompositionProgress {
  taskId: string;
  status: LayerDecompositionJobStatus;
  progress: number;
  phase?: LayerDecompositionPhase;
}

export interface LayerDecompositionPollingOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
  maxConsecutiveErrors?: number;
  onProgress?: (progress: LayerDecompositionProgress) => void;
}

export interface LayerArtifactPayload {
  url: string;
  z_index: number;
  bounding_box: {
    absolute: LayerBoundingBoxTuple;
    normalized: LayerBoundingBoxTuple;
  };
  name: string;
  description: string;
  confidence?: number;
}

export interface LayerDecompositionResponsePayload {
  group_id: string;
  data: LayerArtifactPayload[];
  result_kind?: 'inference' | 'test';
  width?: number;
  height?: number;
  quality?: {
    ssim?: number;
    channel_error_rate?: number;
    channelErrorRate?: number;
  };
  decisions?: string[];
}

export interface LayerDecompositionResponse {
  groupId: string;
  background: LayerArtifact;
  layers: LayerArtifact[];
  resultKind?: 'inference' | 'test';
  width?: number;
  height?: number;
  quality?: {
    ssim?: number;
    channelErrorRate?: number;
    channel_error_rate?: number;
    channel_error_within_one_ratio?: number;
    passed?: boolean;
  };
  decisions?: string[];
}

export type LayerDecompositionMode = 'auto' | 'prompt' | 'bbox';

export interface CanvasBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImagePixelSize {
  width: number;
  height: number;
}

export interface LayerCanvasPlacement {
  artifact: LayerArtifact;
  bounds: CanvasBounds;
}

export interface LayerManifestItem extends LayerArtifact {
  kind: 'background' | 'foreground';
}

export interface LayerDecompositionManifest {
  schemaVersion: 1;
  groupId: string;
  layers: LayerManifestItem[];
}
