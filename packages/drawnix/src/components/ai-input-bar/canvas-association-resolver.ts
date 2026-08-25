import {
  getRectangleByElements,
  type PlaitBoard,
  type PlaitElement,
} from '@plait/core';
import { isPlaitVideo } from '../../interfaces/video';
import { isCanvasAssociationCandidate } from '../../plugins/canvas-association';
import { isAudioNodeElement } from '../../types/audio-node.types';
import { isCardElement } from '../../types/card.types';
import { isFrameElement } from '../../types/frame.types';
import type {
  CanvasAssociationKind,
  CanvasAssociationRef,
} from '../../types/shared/core.types';
import {
  convertElementsToImage,
  extractImagesFromElementForAI,
  extractTextFromElement,
  getImageDimensionsFromUrl,
  isGraphicsElement,
  isImageElement,
  isTextElement,
} from '../../utils/selection-utils';
import {
  CANVAS_ASSOCIATION_REFERENCE_LIMIT,
  normalizeCanvasAssociationLabel,
  snapshotCanvasAssociationRefs,
} from './canvas-association-state';
import {
  areSeedanceAudioDataUrlsWithinLimit,
  isPublicHttpMediaUrl,
  isSeedanceAudioReference,
  SEEDANCE_AUDIO_DATA_URL_MAX_LENGTH,
} from '../../utils/virtual-media-url';
import {
  getSeedance2Capabilities,
  getSeedance2Label,
  isSeedance2ModelId,
} from '../../utils/seedance-model';

const DEFAULT_RASTER_OUTPUT_RATIO = 2;
const MAX_RASTER_OUTPUT_DIMENSION = 2048;
const MAX_RASTER_OUTPUT_AREA = 2_500_000;
const INLINE_MEDIA_PAYLOAD_LIMIT_ERROR = 'INLINE_MEDIA_PAYLOAD_LIMIT';

export type CanvasAssociationResolvedContentType =
  | 'image'
  | 'video'
  | 'audio'
  | 'graphics'
  | 'text';

export interface CanvasAssociationResolvedContent {
  type: CanvasAssociationResolvedContentType;
  url?: string;
  text?: string;
  name: string;
  width?: number;
  height?: number;
}

export type CanvasAssociationResolutionErrorCode =
  | 'board_changed'
  | 'element_missing'
  | 'element_not_referencable'
  | 'media_missing'
  | 'audio_payload_limit'
  | 'raster_limit'
  | 'raster_failed';

export interface CanvasAssociationResolutionError {
  reference: CanvasAssociationRef;
  code: CanvasAssociationResolutionErrorCode;
  message: string;
}

export interface CanvasAssociationResolutionResult {
  references: CanvasAssociationRef[];
  content: CanvasAssociationResolvedContent[];
  errors: CanvasAssociationResolutionError[];
}

export interface CanvasAssociationCapabilityInput {
  generationType: 'image' | 'video' | 'audio' | 'text' | 'agent';
  modelId: string;
  content: readonly CanvasAssociationResolvedContent[];
  textImageInput?: {
    supported: boolean;
    maxCount: number;
  };
  videoImageInput?: {
    maxCount: number;
  };
}

function readElementString(element: PlaitElement, key: string): string {
  const value = (element as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function createReferenceId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `canvas-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface CanvasAssociationTraversalFrame {
  elements: readonly PlaitElement[];
  index: number;
  owner: PlaitElement | null;
}

function visitCanvasAssociationElements(
  elements: readonly PlaitElement[],
  visitor: (element: PlaitElement) => boolean
): void {
  const frames: CanvasAssociationTraversalFrame[] = [
    { elements, index: 0, owner: null },
  ];
  const activeElements = new WeakSet<PlaitElement>();

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.elements.length) {
      frames.pop();
      if (frame.owner) activeElements.delete(frame.owner);
      continue;
    }

    const element = frame.elements[frame.index++];
    if (activeElements.has(element)) continue;
    if (!visitor(element)) return;

    const children = element.children as PlaitElement[] | undefined;
    if (Array.isArray(children) && children.length > 0) {
      activeElements.add(element);
      frames.push({ elements: children, index: 0, owner: element });
    }
  }
}

function findCanvasAssociationElements(
  elements: readonly PlaitElement[],
  elementIds: readonly string[]
): Map<string, PlaitElement> {
  const pendingIds = new Set(elementIds.filter(Boolean));
  const foundElements = new Map<string, PlaitElement>();
  if (pendingIds.size === 0) return foundElements;

  visitCanvasAssociationElements(elements, (element) => {
    if (pendingIds.delete(element.id)) {
      foundElements.set(element.id, element);
    }
    return pendingIds.size > 0;
  });

  return foundElements;
}

export function findCanvasAssociationElement(
  elements: readonly PlaitElement[],
  elementId: string
): PlaitElement | null {
  return (
    findCanvasAssociationElements(elements, [elementId]).get(elementId) || null
  );
}

export function getCanvasAssociationKind(
  board: PlaitBoard,
  element: PlaitElement
): CanvasAssociationKind {
  if (isAudioNodeElement(element)) return 'audio';
  if (isPlaitVideo(element)) return 'video';
  if (isFrameElement(element)) return 'frame';
  if (isCardElement(element)) return 'card';
  if (isImageElement(board, element)) return 'image';
  if (element.type === 'geometry') return 'graphics';
  if (isTextElement(board, element)) return 'text';
  if (isGraphicsElement(board, element)) return 'graphics';
  return 'other';
}

export function getCanvasAssociationLabel(
  board: PlaitBoard,
  element: PlaitElement,
  kind = getCanvasAssociationKind(board, element)
): string {
  const explicitLabel =
    readElementString(element, 'name') ||
    readElementString(element, 'title') ||
    readElementString(element, 'label');
  if (explicitLabel) return normalizeCanvasAssociationLabel(explicitLabel);

  if (kind === 'text' || kind === 'card') {
    const text = extractTextFromElement(element, board);
    if (text) return normalizeCanvasAssociationLabel(text);
  }

  const fallbackLabels: Record<CanvasAssociationKind, string> = {
    image: '图片',
    video: '视频',
    audio: '音频',
    text: '文字',
    graphics: '图形',
    frame: '画框',
    card: '卡片',
    other: '画布元素',
  };
  return fallbackLabels[kind];
}

export function createCanvasAssociationRef(
  board: PlaitBoard,
  boardId: string,
  element: PlaitElement,
  referenceId = createReferenceId()
): CanvasAssociationRef | null {
  if (!boardId.trim() || !isCanvasAssociationCandidate(element)) return null;
  const kind = getCanvasAssociationKind(board, element);
  return {
    referenceId,
    boardId: boardId.trim(),
    elementId: element.id,
    kind,
    label: getCanvasAssociationLabel(board, element, kind),
  };
}

function isElementInsideFrame(
  board: PlaitBoard,
  element: PlaitElement,
  frame: PlaitElement,
  frameBounds: { x: number; y: number; width: number; height: number }
): boolean {
  if (element === frame) return true;
  if (isFrameElement(element)) return false;

  const frameId = readElementString(element, 'frameId');
  if (frameId) return frameId === frame.id;

  try {
    const bounds = getRectangleByElements(board, [element], false);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    return (
      centerX >= frameBounds.x &&
      centerX <= frameBounds.x + frameBounds.width &&
      centerY >= frameBounds.y &&
      centerY <= frameBounds.y + frameBounds.height
    );
  } catch {
    return false;
  }
}

function collectRasterCandidates(
  elements: readonly PlaitElement[],
  predicate: (element: PlaitElement) => boolean = () => true
): PlaitElement[] {
  const result: PlaitElement[] = [];
  visitCanvasAssociationElements(elements, (element) => {
    if (!isCanvasAssociationCandidate(element) || !predicate(element)) {
      return true;
    }
    result.push(element);
    return true;
  });
  return result;
}

function collectRasterElements(
  board: PlaitBoard,
  element: PlaitElement
): PlaitElement[] {
  if (isFrameElement(element)) {
    const frameBounds = getRectangleByElements(board, [element], false);
    return collectRasterCandidates(
      board.children as PlaitElement[],
      (candidate) =>
        isElementInsideFrame(board, candidate, element, frameBounds)
    );
  }

  return collectRasterCandidates([element]);
}

function getRasterOutputRatio(bounds: {
  width: number;
  height: number;
}): number {
  return Math.min(
    DEFAULT_RASTER_OUTPUT_RATIO,
    MAX_RASTER_OUTPUT_DIMENSION / bounds.width,
    MAX_RASTER_OUTPUT_DIMENSION / bounds.height,
    Math.sqrt(MAX_RASTER_OUTPUT_AREA) /
      Math.sqrt(bounds.width) /
      Math.sqrt(bounds.height)
  );
}

function uniqueContent(
  content: readonly CanvasAssociationResolvedContent[]
): CanvasAssociationResolvedContent[] {
  const seen = new Set<string>();
  return content.filter((item) => {
    const identity = JSON.stringify([
      item.type,
      item.url || '',
      item.text || '',
    ]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function isHexDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}

function isInlineDataUrlWithinByteLimit(
  value: string,
  maxBytes: number
): boolean {
  const separatorIndex = value.indexOf(',');
  if (separatorIndex < 0) return true;

  const payloadStart = separatorIndex + 1;
  const payloadLength = value.length - payloadStart;
  const base64Marker = ';base64';
  const markerStart = separatorIndex - base64Marker.length;
  const isBase64 =
    markerStart >= 0 &&
    value.slice(markerStart, separatorIndex).toLowerCase() === base64Marker;

  if (isBase64) {
    const remainder = payloadLength % 4;
    if (remainder === 1) return false;

    let decodedBytes = Math.floor(payloadLength / 4) * 3;
    if (remainder === 2) decodedBytes += 1;
    if (remainder === 3) decodedBytes += 2;
    if (remainder === 0) {
      if (value.charCodeAt(value.length - 1) === 61) decodedBytes -= 1;
      if (value.charCodeAt(value.length - 2) === 61) decodedBytes -= 1;
    }
    return decodedBytes <= maxBytes;
  }

  let decodedBytes = 0;
  for (let index = payloadStart; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 37 &&
      index + 2 < value.length &&
      isHexDigit(value.charCodeAt(index + 1)) &&
      isHexDigit(value.charCodeAt(index + 2))
    ) {
      decodedBytes += 1;
      index += 2;
    } else if (code <= 0x7f) {
      decodedBytes += 1;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      decodedBytes += 4;
      index += 1;
    } else if (code <= 0x7ff) {
      decodedBytes += 2;
    } else {
      decodedBytes += 3;
    }
    if (decodedBytes > maxBytes) return false;
  }
  return true;
}

async function cacheInlineReferenceMedia(
  url: string,
  type: 'image' | 'audio',
  reference: CanvasAssociationRef
): Promise<string> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('data:')) return normalizedUrl;
  if (
    type === 'audio' &&
    normalizedUrl.length > SEEDANCE_AUDIO_DATA_URL_MAX_LENGTH
  ) {
    throw new Error(INLINE_MEDIA_PAYLOAD_LIMIT_ERROR);
  }

  const cacheModule =
    type === 'image'
      ? await import('../../services/unified-cache-service')
      : null;
  const maxBytes =
    type === 'image'
      ? cacheModule?.CACHE_CONSTANTS.MAX_IMAGE_SIZE || 0
      : SEEDANCE_AUDIO_DATA_URL_MAX_LENGTH;
  if (!isInlineDataUrlWithinByteLimit(normalizedUrl, maxBytes)) {
    throw new Error(INLINE_MEDIA_PAYLOAD_LIMIT_ERROR);
  }

  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    throw new Error('INLINE_MEDIA_CACHE_FAILED');
  }
  const blob = await response.blob();
  if (blob.size === 0 || !blob.type.toLowerCase().startsWith(`${type}/`)) {
    throw new Error('INLINE_MEDIA_CACHE_FAILED');
  }
  if (blob.size > maxBytes) {
    throw new Error(INLINE_MEDIA_PAYLOAD_LIMIT_ERROR);
  }

  const { unifiedCacheService } =
    cacheModule || (await import('../../services/unified-cache-service'));
  const cached = await unifiedCacheService.cacheLocalMediaByContent(
    blob,
    type,
    {
      source: 'CANVAS_ASSOCIATION',
      boardId: reference.boardId,
      elementId: reference.elementId,
    }
  );
  const persistedBlob = cached.url
    ? await unifiedCacheService.getCachedBlob(cached.url)
    : null;
  if (
    !cached.url ||
    cached.url.startsWith('data:') ||
    !persistedBlob ||
    persistedBlob.size === 0 ||
    !persistedBlob.type.toLowerCase().startsWith(`${type}/`)
  ) {
    throw new Error('INLINE_MEDIA_CACHE_FAILED');
  }
  return cached.url;
}

async function resolveReferenceContent(
  board: PlaitBoard,
  reference: CanvasAssociationRef,
  element: PlaitElement
): Promise<CanvasAssociationResolvedContent[]> {
  const label = reference.label;

  if (isAudioNodeElement(element)) {
    const url = await cacheInlineReferenceMedia(
      element.audioUrl,
      'audio',
      reference
    );
    return url ? [{ type: 'audio', url, name: label }] : [];
  }

  if (isPlaitVideo(element)) {
    const url = element.url?.trim();
    return url
      ? [
          {
            type: 'video',
            url,
            name: label,
            width: element.width,
            height: element.height,
          },
        ]
      : [];
  }

  if (reference.kind === 'image') {
    const images = await extractImagesFromElementForAI(board, element);
    const resolvedImages: CanvasAssociationResolvedContent[] = [];
    for (const image of images) {
      if (!image.url.trim()) continue;
      resolvedImages.push({
        type: 'image',
        url: await cacheInlineReferenceMedia(image.url, 'image', reference),
        name: image.name || label,
        width: image.width,
        height: image.height,
      });
    }
    return uniqueContent(resolvedImages);
  }

  if (reference.kind === 'text') {
    const text = extractTextFromElement(element, board).trim();
    return text ? [{ type: 'text', text, name: label }] : [];
  }

  const rasterElements = collectRasterElements(board, element);
  const rasterBounds = getRectangleByElements(board, rasterElements, false);
  if (
    !Number.isFinite(rasterBounds.width) ||
    !Number.isFinite(rasterBounds.height) ||
    rasterBounds.width <= 0 ||
    rasterBounds.height <= 0
  ) {
    throw new Error('INVALID_RASTER_BOUNDS');
  }
  const url = await convertElementsToImage(
    board,
    rasterElements,
    getRasterOutputRatio(rasterBounds)
  );
  if (!url) return [];
  const dimensions = await getImageDimensionsFromUrl(url);
  const cachedUrl = await cacheInlineReferenceMedia(url, 'image', reference);
  return [
    {
      type: 'graphics',
      url: cachedUrl,
      name: label,
      width: dimensions?.width,
      height: dimensions?.height,
    },
  ];
}

export async function resolveCanvasAssociationsForSubmission(
  board: PlaitBoard,
  currentBoardId: string,
  inputReferences: readonly CanvasAssociationRef[],
  options: { enforceSeedanceAudioDataUrlLimit?: boolean } = {}
): Promise<CanvasAssociationResolutionResult> {
  const references = snapshotCanvasAssociationRefs(
    inputReferences.slice(0, CANVAS_ASSOCIATION_REFERENCE_LIMIT)
  );
  const content: CanvasAssociationResolvedContent[] = [];
  const errors: CanvasAssociationResolutionError[] = [];
  const sourceAudioUrls: string[] = [];
  const sourceAudioReferences: CanvasAssociationRef[] = [];
  const referenceElements = findCanvasAssociationElements(
    board.children as PlaitElement[],
    references
      .filter((reference) => reference.boardId === currentBoardId)
      .map((reference) => reference.elementId)
  );

  for (const reference of references) {
    if (reference.boardId !== currentBoardId) continue;
    const element = referenceElements.get(reference.elementId);
    if (
      options.enforceSeedanceAudioDataUrlLimit &&
      element &&
      isCanvasAssociationCandidate(element) &&
      isAudioNodeElement(element)
    ) {
      sourceAudioUrls.push(element.audioUrl);
      sourceAudioReferences.push(reference);
    }
  }
  if (
    options.enforceSeedanceAudioDataUrlLimit &&
    !areSeedanceAudioDataUrlsWithinLimit(sourceAudioUrls)
  ) {
    const reference = sourceAudioReferences[0];
    if (reference) {
      return {
        references,
        content: [],
        errors: [
          {
            reference,
            code: 'audio_payload_limit',
            message: 'Seedance 2.0 音频 Data URL 合计不能超过 16 MiB',
          },
        ],
      };
    }
  }

  // Resolve sequentially so multiple large frame snapshots cannot spike memory.
  for (const reference of references) {
    if (reference.boardId !== currentBoardId) {
      errors.push({
        reference,
        code: 'board_changed',
        message: `“${reference.label}”不属于当前画板`,
      });
      continue;
    }

    const element = referenceElements.get(reference.elementId) || null;
    if (!element) {
      errors.push({
        reference,
        code: 'element_missing',
        message: `“${reference.label}”已从画布删除`,
      });
      continue;
    }
    if (!isCanvasAssociationCandidate(element)) {
      errors.push({
        reference,
        code: 'element_not_referencable',
        message: `“${reference.label}”不能作为联想引用`,
      });
      continue;
    }
    try {
      const resolved = await resolveReferenceContent(board, reference, element);
      if (resolved.length === 0) {
        errors.push({
          reference,
          code: 'media_missing',
          message: `“${reference.label}”没有可用内容`,
        });
        continue;
      }
      content.push(...resolved);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '';
      const inlineMediaLimit =
        errorMessage === INLINE_MEDIA_PAYLOAD_LIMIT_ERROR;
      const audioPayloadLimit = inlineMediaLimit && isAudioNodeElement(element);
      let code: CanvasAssociationResolutionErrorCode = 'raster_failed';
      let message = `“${reference.label}”转换失败`;
      if (audioPayloadLimit) {
        code = 'audio_payload_limit';
        message = `“${reference.label}”音频 Data URL 超过 16 MiB，无法作为联想引用`;
      } else if (inlineMediaLimit) {
        code = 'raster_limit';
        message = `“${reference.label}”图片数据过大，无法作为联想引用`;
      }
      errors.push({
        reference,
        code,
        message,
      });
    }
  }

  return { references, content: uniqueContent(content), errors };
}

export function validateCanvasAssociationCapability({
  generationType,
  modelId,
  content,
  textImageInput,
  videoImageInput,
}: CanvasAssociationCapabilityInput): string[] {
  const videoCount = content.filter((item) => item.type === 'video').length;
  const audioCount = content.filter((item) => item.type === 'audio').length;
  const audioUrls = content
    .filter((item) => item.type === 'audio')
    .map((item) => item.url || '');
  const audioDataUrlsWithinLimit =
    areSeedanceAudioDataUrlsWithinLimit(audioUrls);
  const visualCount = content.filter(
    (item) => item.type === 'image' || item.type === 'graphics'
  ).length;
  const errors: string[] = [];

  if (generationType === 'image') {
    if (videoCount > 0) errors.push('当前图片模型不支持视频联想引用');
    if (audioCount > 0) errors.push('当前图片模型不支持音频联想引用');
  } else if (generationType === 'video') {
    const seedance2Capabilities = getSeedance2Capabilities(modelId);
    const isSeedance2 = isSeedance2ModelId(modelId);
    const seedance2Label = getSeedance2Label(modelId);
    const isHappyHorseEdit = modelId === 'happyhorse-1.0-video-edit';
    if (visualCount > 0 && videoImageInput && videoImageInput.maxCount === 0) {
      errors.push('当前视频模型不支持图片联想引用');
    }
    if (videoCount > 0 && !isSeedance2 && !isHappyHorseEdit) {
      errors.push('当前视频模型不支持视频联想引用');
    }
    if (isHappyHorseEdit && videoCount > 1) {
      errors.push('当前视频编辑模型最多支持 1 个视频联想引用');
    }
    if (
      isHappyHorseEdit &&
      content.some(
        (item) => item.type === 'video' && !isPublicHttpMediaUrl(item.url || '')
      )
    ) {
      errors.push('当前视频编辑模型的视频联想引用仅支持公网 HTTP(S) 地址');
    }
    if (audioCount > 0 && !isSeedance2) {
      errors.push('当前视频模型不支持音频联想引用');
    }
    if (
      seedance2Capabilities &&
      videoCount > seedance2Capabilities.maxReferenceVideos
    ) {
      errors.push(
        `${seedance2Label} 最多支持 ${seedance2Capabilities.maxReferenceVideos} 个视频联想引用`
      );
    }
    if (
      seedance2Capabilities &&
      audioCount > seedance2Capabilities.maxReferenceAudios
    ) {
      errors.push(
        `${seedance2Label} 最多支持 ${seedance2Capabilities.maxReferenceAudios} 个音频联想引用`
      );
    }
    if (
      isSeedance2 &&
      content.some(
        (item) => item.type === 'video' && !isPublicHttpMediaUrl(item.url || '')
      )
    ) {
      errors.push(`${seedance2Label} 视频联想引用仅支持公网 HTTP(S) 地址`);
    }
    if (
      isSeedance2 &&
      audioDataUrlsWithinLimit &&
      content.some(
        (item) =>
          item.type === 'audio' && !isSeedanceAudioReference(item.url || '')
      )
    ) {
      errors.push(
        `${seedance2Label} 音频联想引用仅支持 HTTP(S)、asset://、音频 Data URL 或素材 ID`
      );
    }
    if (isSeedance2 && !audioDataUrlsWithinLimit) {
      errors.push(`${seedance2Label} 音频 Data URL 合计不能超过 16 MiB`);
    }
  } else if (generationType === 'audio') {
    if (visualCount > 0) errors.push('当前音频模型不支持图片联想引用');
    if (videoCount > 0) errors.push('当前音频模型不支持视频联想引用');
    if (audioCount > 0) errors.push('当前音频模型不支持音频联想引用');
  } else if (generationType === 'text' || generationType === 'agent') {
    if (visualCount > 0) {
      const textImageCapability = textImageInput;
      if (!textImageCapability || !textImageCapability.supported) {
        errors.push('当前文本流程不支持图片联想引用');
      }
    }
    if (videoCount > 0) errors.push('当前文本流程不支持视频联想引用');
    if (audioCount > 0) errors.push('当前文本流程不支持音频联想引用');
  }

  return errors;
}
