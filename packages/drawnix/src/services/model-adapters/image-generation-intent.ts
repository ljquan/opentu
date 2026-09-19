import { getImageNaturalSize } from '../../utils/image-natural-size';
import type { ImageGenerationRequest } from './types';

export interface ImageReferenceMetadata {
  url: string;
  width?: number;
  height?: number;
}

/** Top-level task fields take precedence over legacy nested fields. */
export function mergeImageGenerationParams(input: {
  size?: unknown;
  resolution?: unknown;
  quality?: unknown;
  params?: Record<string, unknown>;
  uploadedImages?: unknown;
  uploadedImage?: unknown;
}): Record<string, unknown> {
  const result = { ...input.params };
  for (const key of ['size', 'resolution', 'quality'] as const) {
    if (input[key] !== undefined) result[key] = input[key];
  }
  const metadata = mergeImageReferenceMetadata(
    result.referenceImageMetadata,
    input.uploadedImages,
    [input.uploadedImage]
  );
  if (metadata.length > 0) {
    result.referenceImageMetadata = metadata;
  }
  return result;
}

/** Merge whole dimension pairs by URL, never by reference position. */
export function mergeImageReferenceMetadata(
  ...sources: unknown[]
): ImageReferenceMetadata[] {
  const result = new Map<string, ImageReferenceMetadata>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const image of source) {
      if (typeof image?.url !== 'string' || !image.url) continue;
      const url = image.url;
      if (hasImageDimensions(image)) {
        result.set(url, { url, width: image.width, height: image.height });
      } else if (!result.has(url)) {
        result.set(url, { url });
      }
    }
  }
  return [...result.values()];
}

/** Call before deduplicating converted URLs so each source keeps its dimensions. */
export function remapImageReferenceMetadata(
  metadata: unknown,
  sourceUrls: string[],
  targetUrls: string[]
): ImageReferenceMetadata[] {
  const byUrl = new Map(mergeImageReferenceMetadata(metadata).map((item) => [item.url, item]));
  return mergeImageReferenceMetadata(sourceUrls.map((url, index) => ({
    ...byUrl.get(url),
    url: targetUrls[index],
  })));
}

export function hasImageDimensions(
  value: unknown
): value is { width: number; height: number } {
  if (!value || typeof value !== 'object') return false;
  const { width, height } = value as ImageReferenceMetadata;
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    (width as number) > 0 &&
    (height as number) > 0
  );
}

export function imageDimensionsToRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${width / divisor}x${height / divisor}`;
}

export function getRequestedImageSize(
  request: ImageGenerationRequest
): string | undefined {
  const raw = request.size ?? request.params?.size;
  const size = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
  if (size && size !== 'auto') return size;
  const firstUrl = request.referenceImages?.[0];
  const metadata = request.params?.referenceImageMetadata;
  const first = Array.isArray(metadata)
    ? metadata.find((item) => item?.url === firstUrl)
    : undefined;
  return firstUrl && hasImageDimensions(first)
    ? imageDimensionsToRatio(first.width, first.height)
    : size;
}

/** Resolve automatic aspect ratio before URLs are converted to base64. */
export async function prepareImageGenerationRequest(
  request: ImageGenerationRequest
): Promise<ImageGenerationRequest> {
  const size = getRequestedImageSize(request);
  if (size && size !== 'auto') return { ...request, size };
  const firstUrl = request.referenceImages?.[0];
  if (!firstUrl) return { ...request, size };

  const { normalizeImageDataUrl } = await import('@aitu/utils');
  const dimensions = await getImageNaturalSize(normalizeImageDataUrl(firstUrl), 0, 0);
  if (!hasImageDimensions(dimensions)) {
    throw new Error(
      '无法读取第一张参考图的宽高，请重新上传参考图或明确选择图片比例。'
    );
  }
  return {
    ...request,
    size: imageDimensionsToRatio(dimensions.width, dimensions.height),
    params: {
      ...request.params,
      referenceImageMetadata: mergeImageReferenceMetadata(
        request.params?.referenceImageMetadata,
        [{ url: firstUrl, ...dimensions }]
      ),
    },
  };
}
