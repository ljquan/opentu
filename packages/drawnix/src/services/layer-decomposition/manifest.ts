import { sortLayerArtifacts } from './contract';
import type {
  LayerArtifact,
  LayerDecompositionManifest,
  LayerDecompositionResponse,
  LayerManifestItem,
} from './types';

function cloneManifestItem(artifact: LayerArtifact): LayerManifestItem {
  return {
    ...artifact,
    kind: artifact.zIndex === 0 ? 'background' : 'foreground',
    boundingBox: {
      absolute: [...artifact.boundingBox.absolute],
      normalized: [...artifact.boundingBox.normalized],
    },
  };
}

export function buildLayerDecompositionManifest(
  response: LayerDecompositionResponse
): LayerDecompositionManifest {
  const artifacts = sortLayerArtifacts([
    response.background,
    ...response.layers,
  ]);
  return {
    schemaVersion: 1,
    groupId: response.groupId,
    layers: artifacts.map(cloneManifestItem),
  };
}

export function serializeLayerDecompositionManifest(
  response: LayerDecompositionResponse,
  space = 2
): string {
  return JSON.stringify(buildLayerDecompositionManifest(response), null, space);
}
