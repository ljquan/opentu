import {
  PlaitElement,
  RectangleClient,
  rotateAntiPointsByElement,
  type PlaitPlugin,
  type Point,
} from '@plait/core';
import { isCanvasImageReady } from '../services/canvas-image-readiness';

const MASK_MAX_EDGE = 512;
const HIT_SLOP_PX = 2;

interface PaintMask {
  width: number;
  height: number;
  bits: Uint8Array;
}

interface CachedMask {
  source: string;
  url: string;
  width: number;
  height: number;
  mask: PaintMask | null;
}

// Only mounted, already-decoded images are sampled. Each mask is at most 32 KiB
// and is collected with its image; no source fetch, persistent data or SVG DOM.
const masks = new WeakMap<HTMLImageElement, CachedMask>();

function readPaintMask(image: HTMLImageElement, url: string): PaintMask | null {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  const source = image.currentSrc || image.src;
  const cached = masks.get(image);
  if (cached && cached.source === source && cached.url === url &&
    cached.width === image.naturalWidth && cached.height === image.naturalHeight) {
    return cached.mask;
  }
  const entry: CachedMask = {
    source, url, width: image.naturalWidth, height: image.naturalHeight, mask: null,
  };
  masks.set(image, entry);
  const scale = Math.min(1, MASK_MAX_EDGE / Math.max(entry.width, entry.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(entry.width * scale));
  canvas.height = Math.max(1, Math.ceil(entry.height * scale));
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const bits = new Uint8Array(Math.ceil(canvas.width * canvas.height / 8));
    for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
      if (data[pixel * 4 + 3] > 0) bits[pixel >> 3] |= 1 << (pixel & 7);
    }
    entry.mask = { width: canvas.width, height: canvas.height, bits };
    return entry.mask;
  } catch {
    // Keep ordinary selection available if the browser cannot read the pixels.
    return null;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function isPainted(
  mask: PaintMask,
  point: Point,
  rectangle: RectangleClient,
  zoom: number
): boolean {
  if (rectangle.width <= 0 || rectangle.height <= 0) return false;
  const sx = mask.width / rectangle.width;
  const sy = mask.height / rectangle.height;
  const x = (point[0] - rectangle.x) * sx;
  const y = (point[1] - rectangle.y) * sy;
  const slop = HIT_SLOP_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
  const left = Math.max(0, Math.floor(x - slop * sx));
  const right = Math.min(mask.width - 1, Math.floor(x + slop * sx));
  const top = Math.max(0, Math.floor(y - slop * sy));
  const bottom = Math.min(mask.height - 1, Math.floor(y + slop * sy));
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const pixel = row * mask.width + col;
      if (mask.bits[pixel >> 3] & (1 << (pixel & 7))) return true;
    }
  }
  return false;
}

/** Let clicks pass through transparent margins/holes of editable SVG parts. */
export const withSvgVectorHit: PlaitPlugin = (board) => {
  const { isHit } = board;
  board.isHit = (element, point, isStrict) => {
    const hit = isHit(element, point, isStrict);
    if (!hit || element.type !== 'image' || element.svgVectorPart?.version !== 1 ||
      typeof element.url !== 'string' || !element.points?.length ||
      !isCanvasImageReady(board, element.id, element.url)) return hit;

    let image: HTMLImageElement | null;
    try {
      image = PlaitElement.getElementG(element).querySelector('img.image-origin');
    } catch {
      return hit;
    }
    if (!image) return hit;
    const mask = readPaintMask(image, element.url);
    if (!mask) return hit;

    const rectangle = RectangleClient.getRectangleByPoints(element.points);
    const local = rotateAntiPointsByElement(board, point, element) || point;
    // The canvas renderer uses natural image height, or object-fit: contain for
    // frame images. Map pixels to that content rectangle, excluding letterbox.
    const content = { ...rectangle };
    if (image.style.objectFit === 'contain') {
      const scale = Math.min(rectangle.width / image.naturalWidth, rectangle.height / image.naturalHeight);
      content.width = image.naturalWidth * scale;
      content.height = image.naturalHeight * scale;
      content.x += (rectangle.width - content.width) / 2;
      content.y += (rectangle.height - content.height) / 2;
    } else {
      content.height = rectangle.width * (
        image.clientWidth && image.clientHeight
          ? image.clientHeight / image.clientWidth
          : image.naturalHeight / image.naturalWidth
      );
    }
    return isPainted(mask, local, content, board.viewport.zoom);
  };
  return board;
};
