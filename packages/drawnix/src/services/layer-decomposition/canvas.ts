import {
  PlaitHistoryBoard,
  RectangleClient,
  Transforms,
  addSelectedElement,
  clearSelectedElement,
  createGroup,
  type PlaitBoard,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { generateUUID } from '@aitu/utils';
import { loadImageElementForCanvas } from '../../data/image';
import type { DataURL } from '../../types';
import { cacheRemoteUrl } from '../media-executor/fallback-utils';
import {
  downloadAsZip,
  type BatchDownloadItem,
} from '../../utils/download-utils';
import {
  buildLayerDecompositionManifest,
  calculateLayerCanvasPlacements,
} from '.';
import type {
  CanvasBounds,
  LayerArtifact,
  LayerDecompositionManifest,
  LayerDecompositionResponse,
} from './types';

export const SEMANTIC_LAYER_SCHEMA_VERSION = 1 as const;

export interface SemanticLayerMetadata {
  schemaVersion: typeof SEMANTIC_LAYER_SCHEMA_VERSION;
  providerGroupId: string;
  kind: 'background' | 'foreground';
  zIndex: number;
  name: string;
  description: string;
  boundingBox: LayerArtifact['boundingBox'];
  confidence?: number;
  hidden?: boolean;
}

export interface SemanticLayerGroupMetadata {
  schemaVersion: typeof SEMANTIC_LAYER_SCHEMA_VERSION;
  providerGroupId: string;
  manifest: LayerDecompositionManifest;
  originalCompositeUrl?: string;
}

export interface InsertLayerDecompositionOptions {
  signal?: AbortSignal;
  boardGuard?: () => boolean;
}

export interface InsertLayerDecompositionResult {
  groupId: string;
  elementIds: string[];
  manifest: LayerDecompositionManifest;
}

interface CachedArtifact extends LayerArtifact {
  url: string;
}

function assertActive(options: InsertLayerDecompositionOptions): void {
  options.signal?.throwIfAborted();
  if (options.boardGuard && !options.boardGuard()) {
    throw new Error('画板已切换，已取消本次分层');
  }
}

function rotatePoint(point: Point, center: Point, angle: number): Point {
  if (!angle) return point;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const offsetX = point[0] - center[0];
  const offsetY = point[1] - center[1];
  return [
    center[0] + offsetX * cosine - offsetY * sine,
    center[1] + offsetX * sine + offsetY * cosine,
  ];
}

export function getSemanticLayerElementPoints(
  bounds: CanvasBounds,
  sourceBounds: CanvasBounds,
  angle: number
): [Point, Point] {
  const sourceCenter: Point = [
    sourceBounds.x + sourceBounds.width / 2,
    sourceBounds.y + sourceBounds.height / 2,
  ];
  const layerCenter = rotatePoint(
    [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
    sourceCenter,
    angle
  );
  return [
    [layerCenter[0] - bounds.width / 2, layerCenter[1] - bounds.height / 2],
    [layerCenter[0] + bounds.width / 2, layerCenter[1] + bounds.height / 2],
  ];
}

function createLayerElement(
  artifact: CachedArtifact,
  bounds: CanvasBounds,
  sourceBounds: CanvasBounds,
  source: PlaitElement,
  groupId: string
): PlaitElement {
  const semanticLayer: SemanticLayerMetadata = {
    schemaVersion: SEMANTIC_LAYER_SCHEMA_VERSION,
    providerGroupId: artifact.groupId,
    kind: artifact.zIndex === 0 ? 'background' : 'foreground',
    zIndex: artifact.zIndex,
    name: artifact.name,
    description: artifact.description,
    boundingBox: {
      absolute: [...artifact.boundingBox.absolute],
      normalized: [...artifact.boundingBox.normalized],
    },
    ...(artifact.confidence === undefined
      ? {}
      : { confidence: artifact.confidence }),
  };
  const angle = typeof source.angle === 'number' ? source.angle : 0;
  return {
    id: generateUUID(),
    type: 'image',
    points: getSemanticLayerElementPoints(bounds, sourceBounds, angle),
    url: artifact.url,
    groupId,
    angle,
    ...(typeof source.opacity === 'number' ? { opacity: source.opacity } : {}),
    metadata: {
      ...(source.metadata || {}),
      semanticLayer,
    },
  };
}

async function cacheArtifactsSequentially(
  response: LayerDecompositionResponse,
  options: InsertLayerDecompositionOptions
): Promise<CachedArtifact[]> {
  const artifacts = [response.background, ...response.layers].sort(
    (left, right) => left.zIndex - right.zIndex
  );
  const cached: CachedArtifact[] = [];
  for (const artifact of artifacts) {
    assertActive(options);
    const sourceUrl =
      artifact.url.startsWith('/') && typeof window !== 'undefined'
        ? new URL(artifact.url, window.location.origin).toString()
        : artifact.url;
    const url = await cacheRemoteUrl(
      sourceUrl,
      `semantic-layer-${response.groupId}`,
      'image',
      'png',
      artifact.zIndex,
      {
        forceRemoteCache: true,
        returnLocalCacheUrl: true,
        cacheKey: `semantic-layer-${response.groupId}`,
        signal: options.signal,
        extraMetadata: {
          providerGroupId: response.groupId,
          zIndex: artifact.zIndex,
          name: artifact.name,
        },
      }
    );
    assertActive(options);
    // Seedream may return signed CDN URLs whose response can be displayed by
    // an image element but cannot be read by fetch because of CORS. Prefer the
    // stable local copy, while allowing a verified remote URL to keep the
    // native layer result usable. The service worker still gets a chance to
    // retain the opaque response under its original URL.
    await loadImageElementForCanvas(url as any);
    cached.push({ ...artifact, url });
  }
  return cached;
}

async function resolvePixelSize(
  response: LayerDecompositionResponse,
  backgroundUrl: string
): Promise<{ width: number; height: number }> {
  if (response.width && response.height) {
    return { width: response.width, height: response.height };
  }
  const image = await loadImageElementForCanvas(backgroundUrl as any);
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

export function getSemanticLayerMetadata(
  element: PlaitElement
): SemanticLayerMetadata | null {
  const value = element.metadata?.semanticLayer;
  if (!value || typeof value !== 'object') return null;
  const metadata = value as Partial<SemanticLayerMetadata>;
  return metadata.schemaVersion === SEMANTIC_LAYER_SCHEMA_VERSION &&
    typeof metadata.providerGroupId === 'string' &&
    typeof metadata.name === 'string' &&
    typeof metadata.zIndex === 'number'
    ? (metadata as SemanticLayerMetadata)
    : null;
}

export async function exportSemanticLayerGroup(
  board: PlaitBoard,
  providerGroupId: string,
  options: { filename?: string; onProgress?: (progress: number) => void } = {}
): Promise<void> {
  const group = board.children.find(
    (element) =>
      element.type === 'group' &&
      element.metadata?.semanticLayerGroup?.providerGroupId === providerGroupId
  );
  if (!group) throw new Error('未找到语义分层组');

  const layers = board.children
    .map((element) => ({
      element,
      metadata: getSemanticLayerMetadata(element),
    }))
    .filter(
      ({ element, metadata }) =>
        element.groupId === group.id &&
        !!metadata &&
        metadata.providerGroupId === providerGroupId
    )
    .sort((left, right) => left.metadata!.zIndex - right.metadata!.zIndex);
  if (layers.length === 0) throw new Error('语义分层组没有可导出的图层');

  const manifest = group.metadata?.semanticLayerGroup?.manifest;
  const items: BatchDownloadItem[] = layers.map(
    ({ element, metadata }, index) => ({
      url: element.url,
      type: 'image',
      filename: `${String(index).padStart(2, '0')}-${
        metadata!.name || 'layer'
      }.png`,
    })
  );
  await downloadAsZip(
    items,
    options.filename || `semantic-layers-${providerGroupId}.zip`,
    options.onProgress,
    manifest
      ? [
          {
            filename: 'manifest.json',
            content: JSON.stringify(manifest, null, 2),
          },
        ]
      : undefined
  );
}

export async function insertLayerDecomposition(
  board: PlaitBoard,
  sourceElementId: string,
  response: LayerDecompositionResponse,
  options: InsertLayerDecompositionOptions = {}
): Promise<InsertLayerDecompositionResult> {
  assertActive(options);
  if (
    response.quality?.passed === false ||
    (response.quality?.ssim !== undefined && response.quality.ssim < 0.999) ||
    (response.quality?.channelErrorRate !== undefined &&
      response.quality.channelErrorRate > 0.001)
  ) {
    throw new Error('分层重组质量未达标，源图片保持不变');
  }
  const cachedArtifacts = await cacheArtifactsSequentially(response, options);
  const pixelSize = await resolvePixelSize(response, cachedArtifacts[0].url);
  assertActive(options);

  const sourceIndex = board.children.findIndex(
    (element) => element.id === sourceElementId
  );
  if (sourceIndex < 0) {
    throw new Error('源图片已不存在，未修改画布');
  }
  const source = board.children[sourceIndex];
  if (source.type !== 'image' || !source.points) {
    throw new Error('源元素不是可分层图片，未修改画布');
  }

  const rectangle = RectangleClient.getRectangleByPoints(source.points);
  const sourceBounds: CanvasBounds = {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
  };
  const placements = calculateLayerCanvasPlacements(
    cachedArtifacts,
    sourceBounds,
    pixelSize
  );
  const manifest = buildLayerDecompositionManifest({
    ...response,
    background: cachedArtifacts[0],
    layers: cachedArtifacts.slice(1),
  });
  const group = createGroup();
  const groupMetadata: SemanticLayerGroupMetadata = {
    schemaVersion: SEMANTIC_LAYER_SCHEMA_VERSION,
    providerGroupId: response.groupId,
    manifest,
    originalCompositeUrl: source.url,
  };
  const elements = placements.map(({ artifact, bounds }) =>
    createLayerElement(
      artifact as CachedArtifact,
      bounds,
      sourceBounds,
      source,
      group.id
    )
  );

  assertActive(options);
  const groupElement = {
    ...group,
    metadata: { semanticLayerGroup: groupMetadata },
  } as PlaitElement;
  try {
    PlaitHistoryBoard.withNewBatch(board, () => {
      Transforms.removeNode(board, [sourceIndex]);
      elements.forEach((element, offset) => {
        Transforms.insertNode(board, element, [sourceIndex + offset]);
      });
      Transforms.insertNode(board, groupElement, [
        sourceIndex + elements.length,
      ]);
      clearSelectedElement(board);
      addSelectedElement(board, groupElement);
    });
  } catch (error) {
    // Transforms are synchronous, but a provider/plugin can still reject an
    // insertion. Restore the original element before surfacing that failure.
    try {
      const insertedIds = new Set([
        ...elements.map((element) => element.id),
        groupElement.id,
      ]);
      for (let index = board.children.length - 1; index >= 0; index -= 1) {
        if (insertedIds.has(board.children[index].id)) {
          Transforms.removeNode(board, [index]);
        }
      }
      if (!board.children.some((element) => element.id === source.id)) {
        Transforms.insertNode(board, source, [
          Math.min(sourceIndex, board.children.length),
        ]);
      }
      clearSelectedElement(board);
      addSelectedElement(board, source);
    } catch {
      // Keep the original insertion error as the actionable failure.
    }
    throw error;
  }

  return {
    groupId: group.id,
    elementIds: elements.map((element) => element.id),
    manifest,
  };
}
