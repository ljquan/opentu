/**
 * Frame 内部插入工具
 *
 * 将生成的图片/视频插入到 Frame 内部，缩放到 Frame 尺寸，
 * 并自动绑定到 Frame（设置 frameId）。
 */

import type { PlaitBoard, PlaitElement, Point } from '@plait/core';
import {
  RectangleClient,
  Transforms,
  getSelectedElements,
  idCreator,
} from '@plait/core';
import { DrawTransforms } from '@plait/draw';
import { isFrameElement, type PlaitFrame } from '../types/frame.types';
import { FrameTransforms } from '../plugins/with-frame';
import { getImageRegion } from '../services/ppt/ppt-layout-engine';
import type {
  PPTFrameMeta,
  PPTSlideImageHistoryItem,
} from '../services/ppt/ppt.types';
import { normalizePPTSlidePrompt } from '../services/ppt/ppt-prompts';

const PPT_PLACEHOLDER_IMAGE_URL =
  'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

type PPTImageStatus = 'placeholder' | 'loading' | 'generated' | 'failed';
const PPT_SLIDE_IMAGE_HISTORY_LIMIT = 20;
const DEFAULT_FRAME_NAME_REGEXP = /^(Frame|Slide|PPT\s*页面)\s*\d+$/i;
const PPT_FRAME_TITLE_PROMPT_LENGTH = 10;

export type FrameMediaInsertionResult =
  | {
      point: Point;
      size: { width: number; height: number };
      elementId?: string;
    }
  | undefined;

export interface FrameMediaInsertionOptions {
  fit?: 'contain' | 'stretch';
  boardGuard?: () => boolean;
  metadata?: Record<string, unknown>;
}

function assertFrameInsertionBoardCurrent(boardGuard?: () => boolean): void {
  if (boardGuard && !boardGuard()) {
    throw new Error('画板已切换，取消本次插入');
  }
}

export interface PPTSlideImageInfo {
  element?: any;
  index: number;
  elementId?: string;
  url?: string;
}

export type PPTSlideImageHistoryInput = Omit<
  PPTSlideImageHistoryItem,
  'id' | 'createdAt'
> &
  Partial<Pick<PPTSlideImageHistoryItem, 'id' | 'createdAt'>>;

export function findPPTImagePlaceholder(
  board: PlaitBoard,
  frameId: string
): { element: any; index: number } | null {
  const index = board.children.findIndex(
    (el: any) => el?.pptImagePlaceholder && el?.frameId === frameId
  );
  if (index === -1) return null;
  return { element: board.children[index] as any, index };
}

export function setFramePPTImageStatus(
  board: PlaitBoard,
  frameId: string,
  status: PPTImageStatus
): void {
  const frameIndex = board.children.findIndex(
    (el) => el.id === frameId && isFrameElement(el)
  );
  if (frameIndex === -1) return;

  const frame = board.children[frameIndex] as PlaitFrame & { pptMeta?: any };
  const nextMeta = {
    ...(frame.pptMeta || {}),
    imageStatus: status,
  };
  Transforms.setNode(board, { pptMeta: nextMeta } as any, [frameIndex]);
}

export function getPPTSlidePrompt(pptMeta?: PPTFrameMeta): string {
  return normalizePPTSlidePrompt(pptMeta?.slidePrompt || pptMeta?.imagePrompt);
}

function getFrameIndex(board: PlaitBoard, frameId: string): number {
  return board.children.findIndex(
    (el) => el.id === frameId && isFrameElement(el)
  );
}

function getFramePPTMeta(
  board: PlaitBoard,
  frameId: string
): PPTFrameMeta | undefined {
  const frameIndex = getFrameIndex(board, frameId);
  if (frameIndex === -1) return undefined;
  return (board.children[frameIndex] as PlaitFrame & { pptMeta?: PPTFrameMeta })
    .pptMeta;
}

export function setFramePPTMeta(
  board: PlaitBoard,
  frameId: string,
  patch: Partial<PPTFrameMeta>
): void {
  const frameIndex = getFrameIndex(board, frameId);
  if (frameIndex === -1) return;

  const frame = board.children[frameIndex] as PlaitFrame & {
    pptMeta?: PPTFrameMeta;
  };
  Transforms.setNode(
    board,
    {
      pptMeta: {
        ...(frame.pptMeta || {}),
        ...patch,
      },
    } as any,
    [frameIndex]
  );
}

function isImageElement(element: any): boolean {
  return element?.type === 'image' && typeof element.url === 'string';
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildGenerationMetadataPatch(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  const prompt = readMetadataString(metadata, 'prompt');
  const explicitGenerationPrompt =
    readMetadataString(metadata, 'generationPrompt') ||
    readMetadataString(metadata, 'aiPrompt');
  const generationTaskId = readMetadataString(metadata, 'generationTaskId');
  const generationAnchorId = readMetadataString(metadata, 'generationAnchorId');
  const generationPrompt =
    explicitGenerationPrompt ||
    (generationTaskId || generationAnchorId ? prompt : undefined);
  const patch: Record<string, unknown> = {};

  if (prompt) {
    patch.prompt = prompt;
  }
  if (generationPrompt) {
    patch.aiPrompt = generationPrompt;
    patch.generationPrompt = generationPrompt;
  }
  if (generationTaskId) {
    patch.generationTaskId = generationTaskId;
  }
  if (generationAnchorId) {
    patch.generationAnchorId = generationAnchorId;
  }

  return patch;
}

function normalizeHistoryPrompt(prompt?: string): string | undefined {
  const normalized = prompt?.trim();
  return normalized ? normalized : undefined;
}

function isDefaultFrameTitle(name?: string): boolean {
  const normalized = name?.trim();
  return !normalized || DEFAULT_FRAME_NAME_REGEXP.test(normalized);
}

function createFrameTitleFromPrompt(prompt: string): string {
  const normalizedPrompt = prompt.trim().replace(/\s+/g, ' ');
  let title = '';
  let length = 0;

  for (const char of normalizedPrompt) {
    if (length >= PPT_FRAME_TITLE_PROMPT_LENGTH) {
      break;
    }
    title += char;
    length += 1;
  }

  return title;
}

function updateDefaultFrameTitleFromPrompt(
  board: PlaitBoard,
  frameId: string,
  prompt?: string
): void {
  const normalizedPrompt = normalizeHistoryPrompt(prompt);
  if (!normalizedPrompt) return;

  const frameIndex = getFrameIndex(board, frameId);
  if (frameIndex === -1) return;

  const frame = board.children[frameIndex] as PlaitFrame;
  if (!isDefaultFrameTitle(frame.name)) return;

  const title = createFrameTitleFromPrompt(normalizedPrompt);
  if (!title || title === frame.name) return;

  Transforms.setNode(board, { name: title } as any, [frameIndex]);
}

function createSlideImageHistoryId(
  imageUrl: string,
  elementId?: string
): string {
  const source = elementId || imageUrl;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `slide-image-${Date.now().toString(36)}-${hash.toString(36)}`;
}

function appendPPTSlideImageHistory(
  history: PPTSlideImageHistoryItem[] | undefined,
  item: PPTSlideImageHistoryInput
): PPTSlideImageHistoryItem[] {
  const imageUrl = item.imageUrl.trim();
  if (!imageUrl) {
    return history || [];
  }

  const nextItem: PPTSlideImageHistoryItem = {
    id: item.id || createSlideImageHistoryId(imageUrl, item.elementId),
    imageUrl,
    ...(item.elementId ? { elementId: item.elementId } : {}),
    ...(normalizeHistoryPrompt(item.prompt)
      ? { prompt: normalizeHistoryPrompt(item.prompt) }
      : {}),
    createdAt: item.createdAt || Date.now(),
    ...(item.source ? { source: item.source } : {}),
  };

  const existing = Array.isArray(history) ? history : [];
  const matchIndex = existing.findIndex((historyItem) => {
    if (item.elementId && historyItem.elementId === item.elementId) {
      return true;
    }
    return historyItem.imageUrl === imageUrl;
  });

  const nextHistory =
    matchIndex === -1
      ? [...existing, nextItem]
      : existing.map((historyItem, index) => {
          if (index !== matchIndex) {
            return historyItem;
          }
          return {
            ...historyItem,
            ...nextItem,
            id: item.id || historyItem.id,
            createdAt: item.createdAt || historyItem.createdAt,
            ...(normalizeHistoryPrompt(item.prompt)
              ? { prompt: normalizeHistoryPrompt(item.prompt) }
              : historyItem.prompt
              ? { prompt: historyItem.prompt }
              : {}),
          };
        });

  return nextHistory
    .map((historyItem, index) => ({ historyItem, index }))
    .sort((left, right) => {
      const leftCreatedAt = Number.isFinite(left.historyItem.createdAt)
        ? left.historyItem.createdAt
        : 0;
      const rightCreatedAt = Number.isFinite(right.historyItem.createdAt)
        ? right.historyItem.createdAt
        : 0;
      return leftCreatedAt - rightCreatedAt || left.index - right.index;
    })
    .slice(-PPT_SLIDE_IMAGE_HISTORY_LIMIT)
    .map(({ historyItem }) => historyItem);
}

function appendPPTSlideImageHistoryItems(
  history: PPTSlideImageHistoryItem[] | undefined,
  items: PPTSlideImageHistoryInput[]
): PPTSlideImageHistoryItem[] {
  return items.reduce<PPTSlideImageHistoryItem[]>(
    (nextHistory, item) => appendPPTSlideImageHistory(nextHistory, item),
    history || []
  );
}

function loadFrameImageElement(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = imageUrl;
  });
}

function insertFrameMediaElement(
  board: PlaitBoard,
  imageItem: {
    url: string;
    width: number;
    height: number;
    isVideo?: boolean;
    videoType?: 'video';
  },
  point: Point
): PlaitElement | undefined {
  // insertImage 同步追加节点；在同一调用边界内取回元素，避免异步加载使旧下标失效。
  const insertionIndex = board.children.length;
  DrawTransforms.insertImage(board, imageItem, point);
  return board.children[insertionIndex];
}

function fitMediaIntoRegion(
  mediaDimensions: { width: number; height: number },
  regionDimensions: { width: number; height: number }
): { width: number; height: number } {
  const mediaAspect = mediaDimensions.width / mediaDimensions.height;
  const regionAspect = regionDimensions.width / regionDimensions.height;

  if (mediaAspect > regionAspect) {
    return {
      width: regionDimensions.width,
      height: regionDimensions.width / mediaAspect,
    };
  }

  return {
    width: regionDimensions.height * mediaAspect,
    height: regionDimensions.height,
  };
}

export function findPPTSlideImage(
  board: PlaitBoard,
  frameId: string
): PPTSlideImageInfo | null {
  const pptMeta = getFramePPTMeta(board, frameId);
  const preferredElementId = pptMeta?.slideImageElementId;

  if (preferredElementId) {
    const index = board.children.findIndex(
      (el: any) => el.id === preferredElementId
    );
    const element = board.children[index] as any;
    if (index !== -1 && isImageElement(element)) {
      return {
        element,
        index,
        elementId: element.id,
        url: element.url,
      };
    }
  }

  const taggedIndex = board.children.findIndex(
    (el: any) =>
      el?.frameId === frameId && el?.pptSlideImage && isImageElement(el)
  );
  if (taggedIndex !== -1) {
    const element = board.children[taggedIndex] as any;
    return {
      element,
      index: taggedIndex,
      elementId: element.id,
      url: element.url,
    };
  }

  const fallbackIndex = board.children.findIndex(
    (el: any) =>
      el?.frameId === frameId && !el?.pptImagePlaceholder && isImageElement(el)
  );
  if (fallbackIndex !== -1) {
    const element = board.children[fallbackIndex] as any;
    return {
      element,
      index: fallbackIndex,
      elementId: element.id,
      url: element.url,
    };
  }

  if (pptMeta?.slideImageUrl) {
    return {
      index: -1,
      url: pptMeta.slideImageUrl,
    };
  }

  return null;
}

function getPPTFramePageIndex(element: any): number | undefined {
  const pageIndex = element?.pptMeta?.pageIndex;
  return typeof pageIndex === 'number' && Number.isFinite(pageIndex)
    ? pageIndex
    : undefined;
}

export function findPreviousPPTSlideImage(
  board: PlaitBoard,
  frameId: string
): PPTSlideImageInfo | null {
  const currentFrameIndex = getFrameIndex(board, frameId);
  if (currentFrameIndex === -1) return null;

  const currentFrame = board.children[currentFrameIndex] as any;
  const currentPageIndex = getPPTFramePageIndex(currentFrame);
  let previousFrameId: string | undefined;

  if (currentPageIndex !== undefined) {
    let bestPageIndex = -Infinity;
    for (const element of board.children as any[]) {
      if (!isFrameElement(element) || element.id === frameId) continue;
      const pageIndex = getPPTFramePageIndex(element);
      if (
        pageIndex !== undefined &&
        pageIndex < currentPageIndex &&
        pageIndex > bestPageIndex
      ) {
        bestPageIndex = pageIndex;
        previousFrameId = element.id;
      }
    }
  }

  if (!previousFrameId) {
    for (let i = currentFrameIndex - 1; i >= 0; i -= 1) {
      const element = board.children[i] as any;
      if (isFrameElement(element)) {
        previousFrameId = element.id;
        break;
      }
    }
  }

  return previousFrameId ? findPPTSlideImage(board, previousFrameId) : null;
}

export function markPPTSlideImage(
  board: PlaitBoard,
  frameId: string,
  elementId: string,
  imageUrl: string,
  prompt?: string,
  historyItems: PPTSlideImageHistoryInput[] = [],
  imageCreatedAt?: number,
  slidePrompt?: string
): void {
  const pptMeta = getFramePPTMeta(board, frameId);
  const nextSlidePrompt =
    normalizeHistoryPrompt(slidePrompt) ||
    normalizeHistoryPrompt(prompt) ||
    getPPTSlidePrompt(pptMeta);
  const historyPrompt = normalizeHistoryPrompt(prompt) || nextSlidePrompt;
  const fallbackCreatedAt = Date.now();
  const currentImageCreatedAt =
    typeof imageCreatedAt === 'number' &&
    Number.isFinite(imageCreatedAt) &&
    imageCreatedAt > 0
      ? imageCreatedAt
      : fallbackCreatedAt + historyItems.length;

  const elementIndex = board.children.findIndex(
    (el: any) => el.id === elementId
  );
  if (elementIndex !== -1) {
    Transforms.setNode(
      board,
      {
        pptSlideImage: true,
        frameId,
      } as any,
      [elementIndex]
    );
  }

  updateDefaultFrameTitleFromPrompt(board, frameId, nextSlidePrompt);
  setFramePPTMeta(board, frameId, {
    ...(nextSlidePrompt ? { slidePrompt: nextSlidePrompt } : {}),
    slideImageElementId: elementId,
    slideImageUrl: imageUrl,
    slideImageStatus: 'generated',
    imageStatus: 'generated',
    slideImageHistory: appendPPTSlideImageHistoryItems(
      pptMeta?.slideImageHistory,
      [
        ...historyItems.map((item, index) => ({
          ...item,
          ...(normalizeHistoryPrompt(item.prompt) || !historyPrompt
            ? {}
            : { prompt: historyPrompt }),
          createdAt: item.createdAt || fallbackCreatedAt + index,
        })),
        {
          imageUrl,
          elementId,
          prompt: historyPrompt,
          createdAt: currentImageCreatedAt,
        },
      ]
    ),
  });
}

export function replacePPTSlideImage(
  board: PlaitBoard,
  frameId: string,
  newElementId: string,
  imageUrl: string,
  options: {
    replaceElementId?: string;
    prompt?: string;
    slidePrompt?: string;
    historyItems?: PPTSlideImageHistoryInput[];
    imageCreatedAt?: number;
  } = {}
): void {
  const requestedReplaceElementId = options.replaceElementId;
  const requestedReplaceElementExists = requestedReplaceElementId
    ? board.children.some((el: any) => el.id === requestedReplaceElementId)
    : false;
  const existingElementId =
    requestedReplaceElementId && requestedReplaceElementExists
      ? requestedReplaceElementId
      : findPPTSlideImage(board, frameId)?.elementId;

  markPPTSlideImage(
    board,
    frameId,
    newElementId,
    imageUrl,
    options.prompt,
    options.historyItems,
    options.imageCreatedAt,
    options.slidePrompt
  );

  const replaceElementId = existingElementId;
  if (!replaceElementId || replaceElementId === newElementId) {
    return;
  }

  const oldIndex = board.children.findIndex(
    (el: any) => el.id === replaceElementId
  );
  if (oldIndex !== -1) {
    Transforms.removeNode(board, [oldIndex]);
  }
}

export function syncEditedPPTSlideImage(
  board: PlaitBoard,
  elementId: string,
  imageUrl: string
): void {
  const element = board.children.find((el: any) => el.id === elementId) as
    | (PlaitElement & {
        frameId?: string;
        pptSlideImage?: boolean;
      })
    | undefined;
  const frameId = element?.frameId;
  if (!frameId) {
    return;
  }

  const pptMeta = getFramePPTMeta(board, frameId);
  const isCurrentPPTSlideImage =
    element.pptSlideImage === true ||
    pptMeta?.slideImageElementId === elementId;
  if (!isCurrentPPTSlideImage) {
    return;
  }

  markPPTSlideImage(
    board,
    frameId,
    elementId,
    imageUrl,
    undefined,
    [],
    undefined,
    getPPTSlidePrompt(pptMeta)
  );
}

export function setPPTImagePlaceholderStatus(
  board: PlaitBoard,
  frameId: string,
  status: PPTImageStatus
): void {
  const hit = findPPTImagePlaceholder(board, frameId);
  if (!hit) return;
  Transforms.setNode(board, { pptImageStatus: status } as any, [hit.index]);
}

export function removePPTImagePlaceholder(
  board: PlaitBoard,
  frameId: string
): void {
  const hit = findPPTImagePlaceholder(board, frameId);
  if (!hit) return;
  Transforms.removeNode(board, [hit.index]);
}

export function insertPPTImagePlaceholder(
  board: PlaitBoard,
  frame: PlaitFrame,
  imagePrompt: string
): void {
  if (!imagePrompt) return;
  if (findPPTImagePlaceholder(board, frame.id)) return;

  const frameRect = RectangleClient.getRectangleByPoints(frame.points);
  const imageRegion = getImageRegion({
    x: frameRect.x,
    y: frameRect.y,
    width: frameRect.width,
    height: frameRect.height,
  });

  const startPoint: Point = [imageRegion.x, imageRegion.y];
  const endPoint: Point = [
    imageRegion.x + imageRegion.width,
    imageRegion.y + imageRegion.height,
  ];

  const placeholderElement = {
    id: idCreator(),
    type: 'image',
    points: [startPoint, endPoint],
    url: PPT_PLACEHOLDER_IMAGE_URL,
    frameId: frame.id,
    pptImagePlaceholder: true,
    pptImageStatus: 'placeholder' as PPTImageStatus,
    pptImagePrompt: imagePrompt,
  } as any;

  Transforms.insertNode(board, placeholderElement, [board.children.length]);
}

export function getSelectedInsertionFrame(
  board: PlaitBoard
): PlaitFrame | null {
  const selectedElements = getSelectedElements(board);
  if (selectedElements.length > 0) {
    const selectedElement = selectedElements[0];
    return selectedElements.length === 1 && isFrameElement(selectedElement)
      ? selectedElement
      : null;
  }

  const savedElementIds = (board as any).appState?.lastSelectedElementIds;
  if (!Array.isArray(savedElementIds) || savedElementIds.length !== 1) {
    return null;
  }

  const savedElement = board.children.find(
    (element) => element.id === savedElementIds[0]
  );
  return savedElement && isFrameElement(savedElement) ? savedElement : null;
}

export async function insertMediaIntoSelectedFrame(
  board: PlaitBoard,
  mediaUrl: string,
  mediaType: 'image' | 'video',
  mediaDimensions?: { width: number; height: number },
  options?: FrameMediaInsertionOptions
): Promise<FrameMediaInsertionResult> {
  assertFrameInsertionBoardCurrent(options?.boardGuard);
  const frame = getSelectedInsertionFrame(board);
  if (!frame) return undefined;

  const frameRect = RectangleClient.getRectangleByPoints(frame.points);
  return insertMediaIntoFrame(
    board,
    mediaUrl,
    mediaType,
    frame.id,
    { width: frameRect.width, height: frameRect.height },
    mediaDimensions,
    undefined,
    options
  );
}

/**
 * 将图片/视频插入到指定 Frame 内部
 *
 * 行为：
 * 1. 查找目标 Frame，获取其矩形区域
 * 2. 计算媒体应该占据的尺寸（contain 模式等比缩放适配目标区域）
 * 3. 将媒体居中放置在目标区域内
 * 4. 插入后绑定到 Frame（设置 frameId）
 *
 * @param board - PlaitBoard 实例
 * @param mediaUrl - 媒体 URL
 * @param mediaType - 'image' | 'video'
 * @param frameId - 目标 Frame 的 ID
 * @param frameDimensions - Frame 的宽高（用于缩放媒体）
 * @param mediaDimensions - 实际媒体的宽高（用于等比缩放，缺省则填满目标区域）
 * @param targetRegion - 可选的目标插入区域（世界坐标），不指定则使用整个 Frame
 */
export async function insertMediaIntoFrame(
  board: PlaitBoard,
  mediaUrl: string,
  mediaType: 'image' | 'video',
  frameId: string,
  frameDimensions: { width: number; height: number },
  mediaDimensions?: { width: number; height: number },
  targetRegion?: { x: number; y: number; width: number; height: number },
  options?: FrameMediaInsertionOptions
): Promise<FrameMediaInsertionResult> {
  assertFrameInsertionBoardCurrent(options?.boardGuard);
  // 查找目标 Frame
  const frameElement = board.children.find(
    (el) => el.id === frameId && isFrameElement(el)
  ) as PlaitFrame | undefined;

  if (!frameElement) {
    console.warn(
      '[insertMediaIntoFrame] Frame not found, skip frame insertion:',
      frameId
    );
    return undefined;
  }

  const frameRect = RectangleClient.getRectangleByPoints(frameElement.points);

  // 确定目标区域：优先使用指定的 targetRegion，否则使用整个 Frame
  const region = targetRegion ?? {
    x: frameRect.x,
    y: frameRect.y,
    width: frameRect.width,
    height: frameRect.height,
  };
  const regionDimensions = { width: region.width, height: region.height };

  // 默认 contain 等比缩放；仅显式要求时才 stretch 铺满 Frame。
  const shouldStretch = options?.fit === 'stretch';
  const shouldLoadImageForContain =
    mediaType === 'image' && !shouldStretch && !mediaDimensions;
  let mediaWidth: number;
  let mediaHeight: number;

  if (shouldStretch) {
    mediaWidth = regionDimensions.width;
    mediaHeight = regionDimensions.height;
  } else if (
    mediaDimensions &&
    mediaDimensions.width > 0 &&
    mediaDimensions.height > 0
  ) {
    const mediaAspect = mediaDimensions.width / mediaDimensions.height;
    const regionAspect = regionDimensions.width / regionDimensions.height;

    if (mediaAspect > regionAspect) {
      mediaWidth = regionDimensions.width;
      mediaHeight = regionDimensions.width / mediaAspect;
    } else {
      mediaHeight = regionDimensions.height;
      mediaWidth = regionDimensions.height * mediaAspect;
    }
  } else if (mediaType === 'video') {
    const fitted = fitMediaIntoRegion(
      { width: 16, height: 9 },
      regionDimensions
    );
    mediaWidth = fitted.width;
    mediaHeight = fitted.height;
  } else {
    mediaWidth = regionDimensions.width;
    mediaHeight = regionDimensions.height;
  }

  // 居中放置在目标区域内
  const insertX = region.x + (region.width - mediaWidth) / 2;
  const insertY = region.y + (region.height - mediaHeight) / 2;
  const insertionPoint: Point = [insertX, insertY];

  let insertedElement: PlaitElement | undefined;

  if (mediaType === 'video') {
    assertFrameInsertionBoardCurrent(options?.boardGuard);
    const videoWithFragment = mediaUrl.includes('#')
      ? mediaUrl
      : `${mediaUrl}#video`;
    insertedElement = insertFrameMediaElement(
      board,
      {
        url: videoWithFragment,
        width: mediaWidth,
        height: mediaHeight,
        isVideo: true,
        videoType: 'video',
      },
      insertionPoint
    );
  } else {
    if (shouldLoadImageForContain) {
      try {
        const image = await loadFrameImageElement(mediaUrl);
        const fitted = fitMediaIntoRegion(
          { width: image.width, height: image.height },
          regionDimensions
        );
        mediaWidth = fitted.width;
        mediaHeight = fitted.height;
      } catch {
        // 图片尺寸不可读时沿用目标区域尺寸，保持插入不中断。
      }
    }

    assertFrameInsertionBoardCurrent(options?.boardGuard);
    insertedElement = insertFrameMediaElement(
      board,
      {
        url: mediaUrl,
        width: mediaWidth,
        height: mediaHeight,
      },
      insertionPoint
    );
  }
  let finalPoint = insertionPoint;
  let finalSize = {
    width: mediaWidth,
    height: mediaHeight,
  };

  // 查找新插入的元素并绑定到 Frame
  if (insertedElement) {
    const insertedElementIndex = board.children.findIndex(
      (element) => element.id === insertedElement?.id
    );
    if (
      mediaType === 'image' &&
      shouldLoadImageForContain &&
      (insertedElement as any).points?.length >= 2 &&
      insertedElementIndex !== -1
    ) {
      const insertedRect = RectangleClient.getRectangleByPoints(
        (insertedElement as any).points
      );
      const centeredRect = {
        x: region.x + (region.width - insertedRect.width) / 2,
        y: region.y + (region.height - insertedRect.height) / 2,
        width: insertedRect.width,
        height: insertedRect.height,
      };
      finalPoint = [centeredRect.x, centeredRect.y];
      finalSize = {
        width: centeredRect.width,
        height: centeredRect.height,
      };
      Transforms.setNode(
        board,
        {
          points: [
            [centeredRect.x, centeredRect.y],
            [
              centeredRect.x + centeredRect.width,
              centeredRect.y + centeredRect.height,
            ],
          ],
        } as any,
        [insertedElementIndex]
      );
    }
    const generationPatch = buildGenerationMetadataPatch(options?.metadata);
    if (Object.keys(generationPatch).length > 0 && insertedElementIndex >= 0) {
      Transforms.setNode(board, generationPatch as any, [insertedElementIndex]);
    }
    FrameTransforms.bindToFrame(board, insertedElement, frameElement);
  }

  return {
    point: finalPoint,
    elementId: insertedElement?.id,
    size: finalSize,
  };
}
