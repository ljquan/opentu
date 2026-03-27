/**
 * Image Utilities
 *
 * 图片处理工具函数
 * - 图片压缩（10-25MB 自动压缩）
 * - 图片加载
 * - 去白边/透明边
 */

import type {
  CompressionStrategy,
  CompressionResult,
  BorderTrimResult,
  CanvasTrimResult,
  BorderColorOptions,
  TrimOptions,
  TrimOutputOptions,
} from './types';

// ==================== 压缩策略常量 ====================

const COMPRESSION_STRATEGIES: Record<string, CompressionStrategy> = {
  small: {
    // <10MB - 不压缩
    shouldCompress: false,
    targetSizeMB: 0,
    initialQuality: 1,
    minQuality: 0,
    maxQuality: 1,
  },
  medium: {
    // 10-15MB
    shouldCompress: true,
    targetSizeMB: 5,
    initialQuality: 0.8,
    minQuality: 0.5,
    maxQuality: 0.9,
  },
  large: {
    // 15-20MB
    shouldCompress: true,
    targetSizeMB: 3,
    initialQuality: 0.7,
    minQuality: 0.4,
    maxQuality: 0.85,
  },
  veryLarge: {
    // 20-25MB
    shouldCompress: true,
    targetSizeMB: 2,
    initialQuality: 0.6,
    minQuality: 0.3,
    maxQuality: 0.75,
  },
};

// ==================== 图片加载 ====================

/**
 * 加载图片
 *
 * 对于外部图片，设置 crossOrigin 以支持 Canvas 操作。
 * 如果 CORS 失败，会提供友好的错误提示。
 *
 * @param imageUrl - 图片 URL 或 data URL
 * @returns 加载完成的 HTMLImageElement
 *
 * @example
 * ```typescript
 * const img = await loadImage('/image.png');
 * console.log(img.naturalWidth, img.naturalHeight);
 * ```
 */
export async function loadImage(imageUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // 检查是否为外部 URL
    const isExternalUrl =
      imageUrl.startsWith('http') &&
      typeof location !== 'undefined' &&
      !imageUrl.startsWith(location.origin);

    // 对于需要 Canvas 操作的图片，必须设置 crossOrigin
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = () => {
      if (isExternalUrl) {
        reject(
          new Error(
            `无法加载外部图片，可能是跨域 (CORS) 限制。请先下载图片到本地后再操作。`
          )
        );
      } else {
        reject(new Error(`图片加载失败，请检查图片是否有效`));
      }
    };
    img.src = imageUrl;
  });
}

/**
 * 从图片 URL 创建 Canvas
 *
 * @param imageUrl - 图片 URL 或 data URL
 * @param options - 配置选项
 * @returns Canvas、Context 和图片元素
 *
 * @example
 * ```typescript
 * const { canvas, ctx, img } = await createCanvasFromImage('/image.png');
 * const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
 * ```
 */
export async function createCanvasFromImage(
  imageUrl: string,
  options?: { willReadFrequently?: boolean }
): Promise<{
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: HTMLImageElement;
}> {
  const img = await loadImage(imageUrl);
  const { naturalWidth: width, naturalHeight: height } = img;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', {
    willReadFrequently: options?.willReadFrequently ?? true,
  });
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // const { width, height } = canvas;
  ctx.drawImage(img, 0, 0);

  return { canvas, ctx, img };
}

export interface PixelSize {
  width: number;
  height: number;
}

export interface NormalizeImageBlobOptions {
  fit?: 'cover' | 'contain';
  outputType?: string;
  quality?: number;
  backgroundColor?: string;
}

export function parsePixelSize(size?: string | null): PixelSize | null {
  if (!size) {
    return null;
  }

  const match = size.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) {
    return null;
  }

  return { width, height };
}

// ==================== 图片压缩 ====================

/**
 * 根据文件大小获取压缩策略
 *
 * @param fileSizeMB - 文件大小（MB）
 * @returns 压缩策略
 *
 * @example
 * ```typescript
 * getCompressionStrategy(5);   // { shouldCompress: false, ... }
 * getCompressionStrategy(12);  // { shouldCompress: true, targetSizeMB: 5, ... }
 * getCompressionStrategy(18);  // { shouldCompress: true, targetSizeMB: 3, ... }
 * ```
 */
export function getCompressionStrategy(fileSizeMB: number): CompressionStrategy {
  if (fileSizeMB < 10) {
    return COMPRESSION_STRATEGIES.small!;
  }
  if (fileSizeMB < 15) {
    return COMPRESSION_STRATEGIES.medium!;
  }
  if (fileSizeMB < 20) {
    return COMPRESSION_STRATEGIES.large!;
  }
  if (fileSizeMB <= 25) {
    return COMPRESSION_STRATEGIES.veryLarge!;
  }
  // >25MB 将由调用者处理
  return COMPRESSION_STRATEGIES.small!;
}

/**
 * 使用指定质量压缩图片
 */
function compressImageWithQuality(blob: Blob, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(img.src);
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas to Blob failed'));
          }
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    img.src = URL.createObjectURL(blob);
  });
}

type LoadedCanvasSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
};

async function loadCanvasSourceFromBlob(blob: Blob): Promise<LoadedCanvasSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close?.(),
    };
  }

  if (typeof document === 'undefined') {
    throw new Error('Canvas image decoding is not available in this environment');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);

    img.onload = () => {
      resolve({
        source: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to decode image blob'));
    };
    img.src = objectUrl;
  });
}

type Canvas2DContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

type CanvasSurface = {
  ctx: Canvas2DContext;
  toBlob: (type: string, quality?: number) => Promise<Blob>;
};

function createCanvasSurface(width: number, height: number): CanvasSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get offscreen canvas context');
    }

    return {
      ctx,
      toBlob: async (type: string, quality?: number) =>
        canvas.convertToBlob({ type, quality }),
    };
  }

  if (typeof document === 'undefined') {
    throw new Error('Canvas rendering is not available in this environment');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  return {
    ctx,
    toBlob: (type: string, quality?: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (output) => {
            if (output) {
              resolve(output);
            } else {
              reject(new Error('Canvas to Blob failed'));
            }
          },
          type,
          quality
        );
      }),
  };
}

function resolveCanvasOutputType(
  blob: Blob,
  preferredType?: string
): string {
  const candidate = (preferredType || blob.type || '').toLowerCase();
  if (
    candidate === 'image/jpeg' ||
    candidate === 'image/png' ||
    candidate === 'image/webp'
  ) {
    return candidate;
  }
  return 'image/png';
}

export async function normalizeImageBlobToSize(
  blob: Blob,
  size?: string | null,
  options: NormalizeImageBlobOptions = {}
): Promise<Blob> {
  if (!blob.type.startsWith('image/')) {
    return blob;
  }

  const targetSize = parsePixelSize(size);
  if (!targetSize) {
    return blob;
  }

  const loaded = await loadCanvasSourceFromBlob(blob);
  try {
    if (
      loaded.width === targetSize.width &&
      loaded.height === targetSize.height
    ) {
      return blob;
    }

    const { fit = 'cover', quality = 0.92 } = options;
    const outputType = resolveCanvasOutputType(blob, options.outputType);
    const { ctx, toBlob } = createCanvasSurface(
      targetSize.width,
      targetSize.height
    );

    ctx.clearRect(0, 0, targetSize.width, targetSize.height);
    ctx.imageSmoothingEnabled = true;
    (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'high';

    if (fit === 'contain') {
      const backgroundColor =
        options.backgroundColor ||
        (outputType === 'image/jpeg' ? '#ffffff' : '');
      if (backgroundColor) {
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, targetSize.width, targetSize.height);
      }
    }

    const scale =
      fit === 'contain'
        ? Math.min(targetSize.width / loaded.width, targetSize.height / loaded.height)
        : Math.max(targetSize.width / loaded.width, targetSize.height / loaded.height);
    const drawWidth = loaded.width * scale;
    const drawHeight = loaded.height * scale;
    const dx = (targetSize.width - drawWidth) / 2;
    const dy = (targetSize.height - drawHeight) / 2;

    ctx.drawImage(loaded.source, dx, dy, drawWidth, drawHeight);
    return await toBlob(
      outputType,
      outputType === 'image/png' ? undefined : quality
    );
  } finally {
    loaded.cleanup();
  }
}

/**
 * 使用二分查找压缩到目标大小
 */
async function compressToBinary(
  blob: Blob,
  targetSizeMB: number,
  strategy: CompressionStrategy
): Promise<Blob> {
  let minQuality = strategy.minQuality;
  let maxQuality = strategy.maxQuality;
  let bestBlob = blob;
  const targetBytes = targetSizeMB * 1024 * 1024;
  const maxIterations = 8;

  for (let i = 0; i < maxIterations; i++) {
    const currentQuality = (minQuality + maxQuality) / 2;
    const compressedBlob = await compressImageWithQuality(blob, currentQuality);

    if (compressedBlob.size <= targetBytes) {
      bestBlob = compressedBlob;
      maxQuality = currentQuality;
    } else {
      minQuality = currentQuality;
    }

    if (maxQuality - minQuality < 0.01) {
      break;
    }
  }

  return bestBlob;
}

/**
 * 压缩图片 Blob
 *
 * 自动根据文件大小选择压缩策略：
 * - <10MB: 不压缩
 * - 10-15MB: 压缩到 5MB
 * - 15-20MB: 压缩到 3MB
 * - 20-25MB: 压缩到 2MB
 * - >25MB: 抛出错误
 *
 * @param blob - 图片 Blob
 * @param targetSizeMB - 目标大小（MB），如果不指定则根据文件大小自动选择
 * @returns 压缩后的 Blob
 *
 * @example
 * ```typescript
 * const largeBlob = await fetch('/large-image.png').then(r => r.blob());
 * const compressed = await compressImageBlob(largeBlob);
 * console.log(`Compressed from ${largeBlob.size} to ${compressed.size}`);
 * ```
 */
export async function compressImageBlob(
  blob: Blob,
  targetSizeMB?: number
): Promise<Blob> {
  const fileSizeMB = blob.size / (1024 * 1024);

  // 超过 25MB 拒绝
  if (fileSizeMB > 25) {
    throw new Error('Image size exceeds maximum limit of 25MB');
  }

  if (typeof targetSizeMB === 'number' && targetSizeMB > 0) {
    const targetBytes = targetSizeMB * 1024 * 1024;
    if (blob.size <= targetBytes) {
      return blob;
    }

    const strategy = getCompressionStrategy(fileSizeMB);
    const effectiveStrategy: CompressionStrategy = strategy.shouldCompress
      ? strategy
      : {
          shouldCompress: true,
          targetSizeMB,
          initialQuality: 0.9,
          minQuality: 0.35,
          maxQuality: 0.95,
        };

    try {
      return await compressToBinary(blob, targetSizeMB, effectiveStrategy);
    } catch (error) {
      console.error('[compressImageBlob] Compression failed:', error);
      throw new Error('Image compression failed');
    }
  }

  const strategy = getCompressionStrategy(fileSizeMB);

  // 不需要压缩
  if (!strategy.shouldCompress) {
    return blob;
  }

  try {
    return await compressToBinary(blob, strategy.targetSizeMB, strategy);
  } catch (error) {
    console.error('[compressImageBlob] Compression failed:', error);
    throw new Error('Image compression failed');
  }
}

/**
 * 压缩图片并返回详细统计信息
 *
 * @param blob - 图片 Blob
 * @returns 压缩结果（包含原始大小、压缩后大小、质量等）
 *
 * @example
 * ```typescript
 * const result = await compressImageBlobWithStats(largeBlob);
 * console.log(`Compressed: ${result.originalSize} -> ${result.compressedSize}`);
 * console.log(`Quality used: ${result.quality}`);
 * ```
 */
export async function compressImageBlobWithStats(
  blob: Blob
): Promise<CompressionResult> {
  const fileSizeMB = blob.size / (1024 * 1024);
  const strategy = getCompressionStrategy(fileSizeMB);

  if (!strategy.shouldCompress) {
    return {
      compressed: blob,
      originalSize: blob.size,
      compressedSize: blob.size,
      quality: 1,
    };
  }

  if (fileSizeMB > 25) {
    throw new Error('Image size exceeds maximum limit of 25MB');
  }

  let minQuality = strategy.minQuality;
  let maxQuality = strategy.maxQuality;
  let bestBlob = blob;
  let bestQuality = strategy.initialQuality;
  const targetBytes = strategy.targetSizeMB * 1024 * 1024;
  const maxIterations = 8;

  for (let i = 0; i < maxIterations; i++) {
    const currentQuality = (minQuality + maxQuality) / 2;
    const compressedBlob = await compressImageWithQuality(blob, currentQuality);

    if (compressedBlob.size <= targetBytes) {
      bestBlob = compressedBlob;
      bestQuality = currentQuality;
      maxQuality = currentQuality;
    } else {
      minQuality = currentQuality;
    }

    if (maxQuality - minQuality < 0.01) {
      break;
    }
  }

  return {
    compressed: bestBlob,
    originalSize: blob.size,
    compressedSize: bestBlob.size,
    quality: bestQuality,
  };
}

// ==================== 边框检测 ====================

/**
 * 检测像素是否为边框色（白色、灰色或透明/黑色）
 *
 * @param r - 红色通道值
 * @param g - 绿色通道值
 * @param b - 蓝色通道值
 * @param options - 检测选项
 * @returns 是否为边框色
 */
export function isBorderColor(
  r: number,
  g: number,
  b: number,
  options: BorderColorOptions = {}
): boolean {
  const {
    whiteThreshold = 230,
    grayMinValue = 150,
    grayMaxValue = 255,
    maxColorDiff = 25,
    alpha = 255,
  } = options;

  // 透明像素
  if (alpha < 128) {
    return true;
  }

  // 黑色或接近黑色
  if (r <= 10 && g <= 10 && b <= 10) {
    return true;
  }

  // 白色（高亮度）
  if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
    return true;
  }

  // 灰色（R、G、B 接近且在一定范围内）
  const maxVal = Math.max(r, g, b);
  const minVal = Math.min(r, g, b);
  const colorDiff = maxVal - minVal;
  const grayValue = (r + g + b) / 3;

  if (
    colorDiff <= maxColorDiff &&
    grayValue >= grayMinValue &&
    grayValue <= grayMaxValue
  ) {
    return true;
  }

  return false;
}

/**
 * 检测像素是否为背景色（灰色或白色）
 *
 * @param r - 红色通道值
 * @param g - 绿色通道值
 * @param b - 蓝色通道值
 * @param options - 检测选项
 * @returns 是否为背景色
 */
export function isBackgroundPixel(
  r: number,
  g: number,
  b: number,
  options: { minGray?: number; maxGray?: number; maxColorDiff?: number } = {}
): boolean {
  const { minGray = 180, maxGray = 255, maxColorDiff = 15 } = options;

  const maxVal = Math.max(r, g, b);
  const minVal = Math.min(r, g, b);
  const colorDiff = maxVal - minVal;

  if (colorDiff > maxColorDiff) {
    return false;
  }

  const grayValue = (r + g + b) / 3;
  return grayValue >= minGray && grayValue <= maxGray;
}

/**
 * 检测像素是否为白色边框
 *
 * @param r - 红色通道值
 * @param g - 绿色通道值
 * @param b - 蓝色通道值
 * @param threshold - 白色阈值（默认 245）
 * @returns 是否为白色
 */
export function isWhiteBorderPixel(
  r: number,
  g: number,
  b: number,
  threshold = 245
): boolean {
  return r >= threshold && g >= threshold && b >= threshold;
}

// ==================== 边框裁剪 ====================

/**
 * 裁剪图片的白边和灰边
 *
 * 从四个方向向内扫描，找到第一个非边框行/列。
 *
 * @param imageData - Canvas ImageData
 * @param borderRatio - 判定为边框行/列的边框色占比阈值（默认 0.5）
 * @param maxTrimRatio - 每个方向最大裁剪比例（默认 0.15）
 * @returns 裁剪边界
 */
export function trimBorders(
  imageData: ImageData,
  borderRatio = 0.5,
  maxTrimRatio = 0.15
): BorderTrimResult {
  const { width, height, data } = imageData;

  const maxTrimTop = Math.floor(height * maxTrimRatio);
  const maxTrimBottom = Math.floor(height * maxTrimRatio);
  const maxTrimLeft = Math.floor(width * maxTrimRatio);
  const maxTrimRight = Math.floor(width * maxTrimRatio);

  const isRowBorder = (y: number): boolean => {
    let borderCount = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (
        isBorderColor(data[idx]!, data[idx + 1]!, data[idx + 2]!, {
          alpha: alpha!,
        })
      ) {
        borderCount++;
      }
    }
    return borderCount / width > borderRatio;
  };

  const isColBorder = (x: number): boolean => {
    let borderCount = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (
        isBorderColor(data[idx]!, data[idx + 1]!, data[idx + 2]!, {
          alpha: alpha!,
        })
      ) {
        borderCount++;
      }
    }
    return borderCount / height > borderRatio;
  };

  let top = 0;
  while (top < maxTrimTop && top < height - 1 && isRowBorder(top)) {
    top++;
  }

  let bottom = height - 1;
  while (
    height - 1 - bottom < maxTrimBottom &&
    bottom > top &&
    isRowBorder(bottom)
  ) {
    bottom--;
  }

  let left = 0;
  while (left < maxTrimLeft && left < width - 1 && isColBorder(left)) {
    left++;
  }

  let right = width - 1;
  while (
    width - 1 - right < maxTrimRight &&
    right > left &&
    isColBorder(right)
  ) {
    right--;
  }

  return { top, right, bottom, left };
}

/**
 * 从 Canvas 裁剪边框并返回新的 Canvas
 *
 * @param sourceCanvas - 原始 Canvas
 * @param minSize - 裁剪后最小尺寸（默认 10）
 * @returns 裁剪后的 Canvas，如果裁剪后太小则返回 null
 */
export function trimCanvasBorders(
  sourceCanvas: HTMLCanvasElement,
  minSize = 10
): HTMLCanvasElement | null {
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const imageData = ctx.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height
  );

  const borders = trimBorders(imageData, 0.5);

  const trimmedWidth = borders.right - borders.left + 1;
  const trimmedHeight = borders.bottom - borders.top + 1;

  if (trimmedWidth <= minSize || trimmedHeight <= minSize) {
    return null;
  }

  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = trimmedWidth;
  trimmedCanvas.height = trimmedHeight;

  const trimmedCtx = trimmedCanvas.getContext('2d');
  if (!trimmedCtx) return null;

  trimmedCtx.drawImage(
    sourceCanvas,
    borders.left,
    borders.top,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight
  );

  return trimmedCanvas;
}

/**
 * 去除 Canvas 四周的白边和透明边（返回详细信息）
 *
 * @param canvas - 原始 Canvas
 * @param options - 配置选项
 * @returns 裁剪结果，包含裁剪后的 Canvas 和偏移信息
 */
export function trimCanvasWhiteAndTransparentBorderWithInfo(
  canvas: HTMLCanvasElement,
  options: TrimOptions = {}
): CanvasTrimResult {
  const { whiteThreshold = 240, alphaThreshold = 10, minSize = 10 } = options;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      canvas,
      left: 0,
      top: 0,
      trimmedWidth: canvas.width,
      trimmedHeight: canvas.height,
      wasTrimmed: false,
    };
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  const isBorderPixel = (idx: number): boolean => {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const alpha = data[idx + 3];

    if (alpha! < alphaThreshold) return true;
    if (r! >= whiteThreshold && g! >= whiteThreshold && b! >= whiteThreshold)
      return true;

    return false;
  };

  const isRowBorder = (y: number): boolean => {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (!isBorderPixel(idx)) return false;
    }
    return true;
  };

  const isColBorder = (x: number): boolean => {
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      if (!isBorderPixel(idx)) return false;
    }
    return true;
  };

  let top = 0;
  while (top < height && isRowBorder(top)) top++;

  let bottom = height - 1;
  while (bottom > top && isRowBorder(bottom)) bottom--;

  let left = 0;
  while (left < width && isColBorder(left)) left++;

  let right = width - 1;
  while (right > left && isColBorder(right)) right--;

  const trimmedWidth = right - left + 1;
  const trimmedHeight = bottom - top + 1;

  if (trimmedWidth === width && trimmedHeight === height) {
    return {
      canvas,
      left: 0,
      top: 0,
      trimmedWidth: width,
      trimmedHeight: height,
      wasTrimmed: false,
    };
  }

  if (trimmedWidth <= minSize || trimmedHeight <= minSize) {
    return {
      canvas,
      left: 0,
      top: 0,
      trimmedWidth: canvas.width,
      trimmedHeight: canvas.height,
      wasTrimmed: false,
    };
  }

  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = trimmedWidth;
  trimmedCanvas.height = trimmedHeight;
  const trimmedCtx = trimmedCanvas.getContext('2d');

  if (!trimmedCtx) {
    return {
      canvas,
      left: 0,
      top: 0,
      trimmedWidth: canvas.width,
      trimmedHeight: canvas.height,
      wasTrimmed: false,
    };
  }

  trimmedCtx.drawImage(
    canvas,
    left,
    top,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight
  );

  return {
    canvas: trimmedCanvas,
    left,
    top,
    trimmedWidth,
    trimmedHeight,
    wasTrimmed: true,
  };
}

/**
 * 去除 Canvas 四周的白边和透明边
 *
 * @param canvas - 原始 Canvas
 * @param options - 配置选项
 * @returns 裁剪后的 Canvas
 */
export function trimCanvasWhiteAndTransparentBorder(
  canvas: HTMLCanvasElement,
  options: TrimOptions = {}
): HTMLCanvasElement {
  return trimCanvasWhiteAndTransparentBorderWithInfo(canvas, options).canvas;
}

/**
 * 去除图片 URL 四周的白边和透明边
 *
 * @param imageUrl - 图片 URL 或 data URL
 * @param options - 配置选项
 * @returns 去除白边后的 data URL，如果失败返回原 URL
 *
 * @example
 * ```typescript
 * const trimmedUrl = await trimImageWhiteAndTransparentBorder('/image-with-border.png');
 * ```
 */
export async function trimImageWhiteAndTransparentBorder(
  imageUrl: string,
  options: TrimOutputOptions = {}
): Promise<string> {
  const {
    outputFormat = 'image/jpeg',
    outputQuality = 0.92,
    ...trimOptions
  } = options;

  try {
    const img = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) return imageUrl;

    ctx.drawImage(img, 0, 0);

    const trimmedCanvas = trimCanvasWhiteAndTransparentBorder(
      canvas,
      trimOptions
    );

    if (trimmedCanvas === canvas) {
      return imageUrl;
    }

    return trimmedCanvas.toDataURL(outputFormat, outputQuality);
  } catch (error) {
    console.error('[trimImageWhiteAndTransparentBorder] Error:', error);
    return imageUrl;
  }
}

/**
 * 去除图片的白边（简化版）
 *
 * @param imageUrl - 图片 URL 或 data URL
 * @param options - 配置选项
 * @returns 去除白边后的 data URL，如果失败返回原 URL
 */
export async function removeWhiteBorder(
  imageUrl: string,
  options: { borderRatio?: number } = {}
): Promise<string> {
  const { borderRatio = 0.3 } = options;

  try {
    const img = await loadImage(imageUrl);
    const { naturalWidth: width, naturalHeight: height } = img;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return imageUrl;

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);

    const borders = trimBorders(imageData, borderRatio);

    const trimmedWidth = borders.right - borders.left + 1;
    const trimmedHeight = borders.bottom - borders.top + 1;

    if (trimmedWidth === width && trimmedHeight === height) {
      return imageUrl;
    }

    const trimmedCanvas = document.createElement('canvas');
    trimmedCanvas.width = trimmedWidth;
    trimmedCanvas.height = trimmedHeight;
    const trimmedCtx = trimmedCanvas.getContext('2d');
    if (!trimmedCtx) return imageUrl;

    trimmedCtx.drawImage(
      canvas,
      borders.left,
      borders.top,
      trimmedWidth,
      trimmedHeight,
      0,
      0,
      trimmedWidth,
      trimmedHeight
    );

    return trimmedCanvas.toDataURL('image/jpeg', 0.92);
  } catch (error) {
    console.error('[removeWhiteBorder] Error:', error);
    return imageUrl;
  }
}
