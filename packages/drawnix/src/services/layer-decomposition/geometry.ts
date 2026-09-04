import { sortLayerArtifacts } from './contract';
import type {
  CanvasBounds,
  ImagePixelSize,
  LayerArtifact,
  LayerCanvasPlacement,
} from './types';

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function validateGeometryInputs(
  sourceBounds: CanvasBounds,
  backgroundPixelSize: ImagePixelSize
): void {
  requireFinite(sourceBounds.x, 'sourceBounds.x');
  requireFinite(sourceBounds.y, 'sourceBounds.y');
  requirePositiveFinite(sourceBounds.width, 'sourceBounds.width');
  requirePositiveFinite(sourceBounds.height, 'sourceBounds.height');
  requirePositiveFinite(backgroundPixelSize.width, 'backgroundPixelSize.width');
  requirePositiveFinite(
    backgroundPixelSize.height,
    'backgroundPixelSize.height'
  );
}

export function calculateLayerCanvasBounds(
  artifact: LayerArtifact,
  sourceBounds: CanvasBounds,
  backgroundPixelSize: ImagePixelSize
): CanvasBounds {
  validateGeometryInputs(sourceBounds, backgroundPixelSize);
  if (artifact.zIndex === 0) return { ...sourceBounds };

  const [x1, y1, x2, y2] = artifact.boundingBox.absolute;
  if (x2 > backgroundPixelSize.width || y2 > backgroundPixelSize.height) {
    throw new Error(
      'Layer absolute bounding box exceeds background pixel bounds'
    );
  }
  const scaleX = sourceBounds.width / backgroundPixelSize.width;
  const scaleY = sourceBounds.height / backgroundPixelSize.height;
  return {
    x: sourceBounds.x + x1 * scaleX,
    y: sourceBounds.y + y1 * scaleY,
    width: (x2 - x1) * scaleX,
    height: (y2 - y1) * scaleY,
  };
}

export function calculateLayerCanvasPlacements(
  artifacts: readonly LayerArtifact[],
  sourceBounds: CanvasBounds,
  backgroundPixelSize: ImagePixelSize
): LayerCanvasPlacement[] {
  return sortLayerArtifacts(artifacts).map((artifact) => ({
    artifact,
    bounds: calculateLayerCanvasBounds(
      artifact,
      sourceBounds,
      backgroundPixelSize
    ),
  }));
}
