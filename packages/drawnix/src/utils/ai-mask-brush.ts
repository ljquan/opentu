import { PlaitBoard, Point, RectangleClient } from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { Freehand, FreehandShape } from '../plugins/freehand/type';
import { BrushShape } from '../plugins/freehand/freehand-settings';
import { getFreehandRectangle } from '../plugins/freehand/utils';
import { getImageNaturalSize as loadImageNaturalSize } from './image-natural-size';
import { isPlaitVideo } from '../interfaces/video';
import { sanitizeImage3DTransform } from './image-3d-transform';
import { unifiedCacheService } from '../services/unified-cache-service';
import { isVirtualMediaUrl } from './virtual-media-url';

export const MAX_AI_MASK_PIXELS = 16_777_216;
export const MAX_AI_MASK_BYTES = 4 * 1024 * 1024;
const MAX_AI_MASK_BYTE_RETRY_COUNT = 3;
const AI_MASK_EDGE_TRIM_PX = 2;

export interface MaskStrokeDrawCommand {
  points: Point[];
  strokeWidth: number;
  brushShape?: BrushShape;
}

export interface MaskExportInfo {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
}

export interface ExportMaskBrushOptions {
  imageElement: PlaitDrawElement;
  maskElements: Freehand[];
  invert?: boolean;
  naturalSize?: { width: number; height: number };
  cacheId?: string;
  cacheMask?: boolean;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  onDrawStroke?: (command: MaskStrokeDrawCommand) => void;
  onExportInfo?: (info: MaskExportInfo) => void;
}

function isRectangleHit(left: RectangleClient, right: RectangleClient) {
  return RectangleClient.isHit(left, right);
}

function hasRenderableMaskPoints(element: Freehand): boolean {
  return Array.isArray(element.points) && element.points.length > 0;
}

function getFiniteNaturalSize(size: {
  width?: number;
  height?: number;
}): { width: number; height: number } | null {
  const width = Math.round(Number(size.width));
  const height = Math.round(Number(size.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function isMaskBrushEligibleImage(element: unknown): element is PlaitDrawElement {
  if (
    !element ||
    isPlaitVideo(element as any) ||
    !PlaitDrawElement.isDrawElement(element) ||
    !PlaitDrawElement.isImage(element) ||
    !(element as PlaitDrawElement).url
  ) {
    return false;
  }
  const angle = Number((element as any).angle || 0);
  return (
    Math.abs(angle) < 0.0001 &&
    !sanitizeImage3DTransform((element as any).transform3d)
  );
}

export function findMaskBrushesForImage(
  board: PlaitBoard,
  imageElement: PlaitDrawElement
): Freehand[] {
  const imageRect = RectangleClient.getRectangleByPoints(imageElement.points);
  return board.children.filter((element): element is Freehand => {
    if (
      !Freehand.isFreehand(element) ||
      element.shape !== FreehandShape.mask ||
      (element.aiMaskTargetId && element.aiMaskTargetId !== imageElement.id) ||
      !hasRenderableMaskPoints(element)
    ) {
      return false;
    }
    return isRectangleHit(imageRect, getFreehandRectangle(element));
  });
}

async function resolveImageNaturalSize(
  imageElement: PlaitDrawElement,
  providedSize?: { width: number; height: number }
) {
  const provided = providedSize && getFiniteNaturalSize(providedSize);
  if (provided) {
    return provided;
  }

  // Element width/height describe its canvas size, not the uploaded file's pixels.
  // Virtual URLs can serve a preview (or an SPA fallback), so decode the original blob.
  let sourceUrl = imageElement.url;
  let objectUrl: string | undefined;
  try {
    if (isVirtualMediaUrl(sourceUrl)) {
      const blob = await unifiedCacheService.getCachedBlob(sourceUrl, {
        allowNetwork: false,
      });
      if (!blob) {
        throw new Error('无法读取蒙版编辑原图，图片缓存已失效');
      }
      objectUrl = URL.createObjectURL(blob);
      sourceUrl = objectUrl;
    }
    const size = getFiniteNaturalSize(
      await loadImageNaturalSize(sourceUrl, 0, 0)
    );
    if (!size) {
      throw new Error('无法读取蒙版编辑原图的像素尺寸，请重新加载图片');
    }
    return size;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function createDefaultCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('蒙版 PNG 生成失败'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function toImageLocalPoint(
  point: Point,
  imageRect: RectangleClient,
  naturalSize: { width: number; height: number }
): Point {
  return [
    ((point[0] - imageRect.x) / imageRect.width) * naturalSize.width,
    ((point[1] - imageRect.y) / imageRect.height) * naturalSize.height,
  ];
}

function drawSinglePoint(
  ctx: CanvasRenderingContext2D,
  point: Point,
  width: number,
  brushShape?: BrushShape
) {
  const radius = width / 2;
  if (brushShape === BrushShape.square) {
    ctx.fillRect(point[0] - radius, point[1] - radius, width, width);
    return;
  }
  ctx.beginPath();
  ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawMaskStroke(
  ctx: CanvasRenderingContext2D,
  command: MaskStrokeDrawCommand,
  color = '#000'
) {
  const { points, strokeWidth, brushShape } = command;
  if (points.length === 0) {
    return;
  }

  ctx.lineCap = brushShape === BrushShape.square ? 'square' : 'round';
  ctx.lineJoin = brushShape === BrushShape.square ? 'miter' : 'round';
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  if (points.length === 1) {
    drawSinglePoint(ctx, points[0], strokeWidth, brushShape);
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index][0], points[index][1]);
  }
  ctx.stroke();
}

function clearMaskCanvasEdges(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  inset = AI_MASK_EDGE_TRIM_PX
) {
  const edge = Math.max(0, Math.min(inset, Math.floor(width / 2), Math.floor(height / 2)));
  if (edge <= 0) {
    return;
  }
  ctx.clearRect(0, 0, width, edge);
  ctx.clearRect(width - edge, 0, edge, height);
  ctx.clearRect(0, height - edge, width, edge);
  ctx.clearRect(0, 0, edge, height);
}

export function buildMaskStrokeCommands(
  imageElement: PlaitDrawElement,
  maskElements: Freehand[],
  naturalSize: { width: number; height: number }
): MaskStrokeDrawCommand[] {
  const imageRect = RectangleClient.getRectangleByPoints(imageElement.points);
  if (imageRect.width <= 0 || imageRect.height <= 0) {
    return [];
  }

  const scaleX = naturalSize.width / imageRect.width;
  const scaleY = naturalSize.height / imageRect.height;
  const strokeScale = Math.max(scaleX, scaleY);

  return maskElements
    .map((element) => ({
      points: element.points.map((point) =>
        toImageLocalPoint(point, imageRect, naturalSize)
      ),
      strokeWidth: Math.max(1, ((element as any).strokeWidth || 2) * strokeScale),
      brushShape: element.brushShape,
    }))
    .filter((command) => command.points.length > 0);
}

function createScaledSize(
  naturalSize: { width: number; height: number },
  scale: number
): { width: number; height: number; scale: number } {
  const safeScale = Math.max(0, Math.min(1, scale));
  return {
    width: Math.max(1, Math.floor(naturalSize.width * safeScale)),
    height: Math.max(1, Math.floor(naturalSize.height * safeScale)),
    scale: safeScale,
  };
}

export function fitMaskSizeToMaxPixels(
  naturalSize: { width: number; height: number },
  maxPixels = MAX_AI_MASK_PIXELS
): { width: number; height: number; scale: number } {
  const pixels = naturalSize.width * naturalSize.height;
  if (pixels <= maxPixels) {
    return { ...naturalSize, scale: 1 };
  }
  return createScaledSize(naturalSize, Math.sqrt(maxPixels / pixels));
}

async function renderMaskBlob(
  options: ExportMaskBrushOptions,
  naturalSize: { width: number; height: number },
  maskSize: { width: number; height: number; scale: number }
) {
  const canvas = (options.createCanvas || createDefaultCanvas)(
    maskSize.width,
    maskSize.height
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建蒙版画布');
  }

  const invert = !!options.invert;
  ctx.clearRect(0, 0, maskSize.width, maskSize.height);
  if (!invert) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, maskSize.width, maskSize.height);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, maskSize.width, maskSize.height);
  ctx.clip();
  ctx.globalCompositeOperation = invert ? 'source-over' : 'destination-out';

  const commands = buildMaskStrokeCommands(
    options.imageElement,
    options.maskElements,
    maskSize
  );
  for (const command of commands) {
    drawMaskStroke(ctx, command, invert ? '#fff' : '#000');
  }
  ctx.restore();
  if (!invert) {
    clearMaskCanvasEdges(ctx, maskSize.width, maskSize.height);
  }

  return {
    blob: await canvasToBlob(canvas),
    commands,
    info: {
      width: maskSize.width,
      height: maskSize.height,
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      scale: maskSize.scale,
    },
  };
}

export async function exportImageMaskFromBrushes(
  options: ExportMaskBrushOptions
): Promise<string | undefined> {
  const { imageElement, maskElements } = options;
  if (maskElements.length === 0) {
    return undefined;
  }

  const naturalSize = await resolveImageNaturalSize(
    imageElement,
    options.naturalSize
  );
  if (!naturalSize) {
    return undefined;
  }

  let maskSize = fitMaskSizeToMaxPixels(naturalSize);
  let rendered = await renderMaskBlob(options, naturalSize, maskSize);

  for (
    let attempt = 0;
    rendered.blob.size > MAX_AI_MASK_BYTES &&
    attempt < MAX_AI_MASK_BYTE_RETRY_COUNT;
    attempt += 1
  ) {
    const nextScale = rendered.info.scale *
      Math.sqrt(MAX_AI_MASK_BYTES / rendered.blob.size) *
      0.92;
    const nextSize = createScaledSize(naturalSize, nextScale);
    if (nextSize.width === maskSize.width && nextSize.height === maskSize.height) {
      break;
    }
    maskSize = nextSize;
    rendered = await renderMaskBlob(options, naturalSize, maskSize);
  }

  if (rendered.blob.size > MAX_AI_MASK_BYTES) {
    throw new Error('蒙版 PNG 降采样后仍超过 4MB，请缩小原图或减少蒙版复杂度');
  }

  for (const command of rendered.commands) {
    options.onDrawStroke?.(command);
  }
  options.onExportInfo?.(rendered.info);

  if (options.cacheMask === false) {
    return URL.createObjectURL(rendered.blob);
  }

  const cacheId =
    options.cacheId ||
    `ai-mask-${imageElement.id || 'image'}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  const stableUrl = `/__aitu_cache__/image/${cacheId}.png`;
  await unifiedCacheService.cacheMediaFromBlob(stableUrl, rendered.blob, 'image', {
    metadata: {
      source: 'ai-mask-brush',
      imageElementId: imageElement.id,
      invert: !!options.invert,
      width: rendered.info.width,
      height: rendered.info.height,
      naturalWidth: rendered.info.naturalWidth,
      naturalHeight: rendered.info.naturalHeight,
      scale: rendered.info.scale,
    },
  });
  return stableUrl;
}
