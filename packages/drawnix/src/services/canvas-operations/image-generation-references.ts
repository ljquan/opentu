import {
  idCreator,
  PlaitHistoryBoard,
  Transforms,
  type PlaitBoard,
  type PlaitElement,
  type Point,
} from '@plait/core';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { loadImageElementForCanvas } from '../../data/image';
import { cacheRemoteUrl } from '../media-executor/fallback-utils';
import type { DataURL } from '../../types';
import type { CanvasAssociationRef } from '../../types/shared/core.types';
import { calculateImageDisplayDimensions } from '../../utils/canvas-insertion-layout';
import {
  getImageReferenceBounds,
  getIndependentImagePosition,
  placeImageColumn,
} from '../../utils/image-generation-lineage-placement';
import { CANVAS_ASSOCIATION_REFERENCE_LIMIT } from '../../components/ai-input-bar/canvas-association-state';

export interface GenerationReferenceImage {
  url: string;
  name?: string;
  sourceElementId?: string;
}

function imageKey(url: string): string {
  let normalized = url.trim();
  try {
    const parsed = new URL(normalized, window.location.origin);
    parsed.searchParams.delete('_retry');
    parsed.searchParams.delete('bypass_sw');
    normalized = parsed.toString();
  } catch {
    /* Inline sources are already normalized. */
  }
  return bytesToHex(sha256(normalized));
}

/** Prepare everything off-board before writing any uploaded source nodes. */
export async function prepareImageGenerationReferences(options: {
  board: PlaitBoard;
  boardId: string;
  images: readonly GenerationReferenceImage[];
  associations: readonly CanvasAssociationRef[];
  emptyPosition: Point;
  boardGuard: () => boolean;
}): Promise<{ references: CanvasAssociationRef[]; imageSourceIds: string[] }> {
  const { board, boardId, images, associations, boardGuard, emptyPosition } =
    options;
  const assertCurrent = () => {
    if (!boardGuard())
      throw new Error('画板已切换，取消参考图准备，请重新发送');
  };
  assertCurrent();
  const { normalizeImageDataUrl } = await import('@aitu/utils');
  assertCurrent();
  const keyFor = (url: string) => imageKey(normalizeImageDataUrl(url));
  const assertAssociations = () => {
    if (
      associations.some(
        (reference) =>
          reference.boardId !== boardId ||
          !board.children.some((element) => element.id === reference.elementId)
      )
    )
      throw new Error('引用来源已变化，请重新选择后发送');
  };
  assertAssociations();
  const references = associations.map((reference) => ({ ...reference }));
  const sourceIds = new Set<string>();
  const staged: Array<{
    element: PlaitElement;
    size: { width: number; height: number };
  }> = [];
  const allImages = () =>
    [...board.children, ...staged.map((item) => item.element)].filter(
      (element) =>
        element.type === 'image' && !element.isVideo && !element.isAudio
    );
  const existingSources = new Map<string, string>();

  for (const image of images) {
    assertCurrent();
    const key = keyFor(image.url);
    const source = allImages().find((element) =>
      image.sourceElementId
        ? element.id === image.sourceElementId
        : element.generationReferenceKey === key ||
          (typeof element.url === 'string' && keyFor(element.url) === key)
    );
    if (image.sourceElementId && !source)
      throw new Error('参考图已从画布删除，请重新选择');
    let sourceElement = source;
    if (!sourceElement) {
      const cachedUrl = await cacheRemoteUrl(
        image.url,
        `reference-${key}`,
        'image',
        'png',
        undefined,
        { forceRemoteCache: true, returnLocalCacheUrl: true }
      );
      assertCurrent();
      const pathname = new URL(cachedUrl, window.location.origin).pathname;
      if (
        !pathname.startsWith('/__aitu_cache__/') &&
        !pathname.startsWith('/asset-library/')
      )
        throw new Error('参考图未能保存到本地，请重试');
      const decoded = await loadImageElementForCanvas(cachedUrl as DataURL);
      assertCurrent();
      const width = decoded.naturalWidth || decoded.width;
      const height = decoded.naturalHeight || decoded.height;
      if (!(width > 0 && height > 0))
        throw new Error('参考图尺寸无效，请重新选择');
      const size = calculateImageDisplayDimensions(width, height, 400);
      sourceElement = {
        id: idCreator(),
        type: 'image',
        url: cachedUrl,
        generationReferenceKey: key,
        points: [
          [0, 0],
          [size.width, size.height],
        ],
      };
      staged.push({ element: sourceElement, size });
    } else if (board.children.includes(sourceElement)) {
      existingSources.set(sourceElement.id, String(sourceElement.url));
    }
    sourceIds.add(sourceElement.id);
    if (
      !references.some(
        (reference) =>
          reference.elementId === sourceElement.id &&
          reference.boardId === boardId
      )
    ) {
      references.push({
        referenceId: `${boardId}:${sourceElement.id}`,
        boardId,
        elementId: sourceElement.id,
        kind: 'image',
        label: image.name || '参考图',
      });
    }
  }
  assertCurrent();
  assertAssociations();
  if (references.length > CANVAS_ASSOCIATION_REFERENCE_LIMIT)
    throw new Error(
      `参考来源不能超过 ${CANVAS_ASSOCIATION_REFERENCE_LIMIT} 个`
    );
  for (const [id, url] of existingSources) {
    if (
      !board.children.some(
        (element) => element.id === id && element.url === url
      )
    )
      throw new Error('参考图在准备过程中已变化，请重新发送');
  }
  const bounds = getImageReferenceBounds(board, [...sourceIds]);
  const origin: Point = bounds
    ? [bounds.x, bounds.y + bounds.height + 40]
    : getIndependentImagePosition(board, emptyPosition);
  const positions = placeImageColumn(
    board,
    origin,
    staged.map((item) => item.size)
  );
  PlaitHistoryBoard.withNewBatch(board, () => {
    staged.forEach(({ element, size }, index) => {
      const point = positions[index];
      element.points = [point, [point[0] + size.width, point[1] + size.height]];
      Transforms.insertNode(board, element, [board.children.length]);
    });
  });
  return { references, imageSourceIds: [...sourceIds] };
}
