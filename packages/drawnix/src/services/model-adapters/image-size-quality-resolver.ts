import {
  GPT_IMAGE_25_MODEL_IDS,
  GPT_IMAGE_2_MODEL_IDS,
} from '../../constants/model-config';

export type ImageResolutionTier = '1k' | '2k' | '4k';
export type OfficialGPTImageQuality =
  | 'auto'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

type GPTImageAspectRatioKey =
  | '1x1'
  | '2x3'
  | '3x2'
  | '3x4'
  | '4x3'
  | '4x5'
  | '5x4'
  | '9x16'
  | '16x9'
  | '21x9';

type LegacyGPTImageAspectRatioKey = '1x1' | '2x3' | '3x2';

const GPT_IMAGE_2_MODEL_ID_SET = new Set(GPT_IMAGE_2_MODEL_IDS);
const GPT_IMAGE_25_MODEL_ID_SET = new Set(GPT_IMAGE_25_MODEL_IDS);
const EXTENDED_GPT_IMAGE_QUALITY_MODEL_IDS = new Set([
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
]);
const LEGACY_GPT_IMAGE_MODEL_IDS = new Set(['gpt-image-1', 'gpt-image-1.5']);

const OFFICIAL_GPT_IMAGE_QUALITY_VALUES = new Set<OfficialGPTImageQuality>([
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const LEGACY_RESOLUTION_VALUES = new Set<ImageResolutionTier>([
  '1k',
  '2k',
  '4k',
]);

const GPT_IMAGE_2_SIZE_MATRIX: Record<
  ImageResolutionTier,
  Record<GPTImageAspectRatioKey, string>
> = {
  '1k': {
    '1x1': '1024x1024',
    '2x3': '832x1248',
    '3x2': '1248x832',
    '3x4': '880x1184',
    '4x3': '1184x880',
    '4x5': '912x1152',
    '5x4': '1152x912',
    '9x16': '768x1360',
    '16x9': '1360x768',
    '21x9': '1568x672',
  },
  '2k': {
    '1x1': '2048x2048',
    '2x3': '1680x2512',
    '3x2': '2512x1680',
    '3x4': '1776x2368',
    '4x3': '2368x1776',
    '4x5': '1824x2288',
    '5x4': '2288x1824',
    '9x16': '1536x2736',
    '16x9': '2736x1536',
    '21x9': '3136x1344',
  },
  '4k': {
    '1x1': '2880x2880',
    '2x3': '2352x3520',
    '3x2': '3520x2352',
    '3x4': '2480x3312',
    '4x3': '3312x2480',
    '4x5': '2576x3216',
    '5x4': '3216x2576',
    '9x16': '2160x3840',
    '16x9': '3840x2160',
    '21x9': '3840x1632',
  },
};

const LEGACY_GPT_IMAGE_SIZE_BY_RATIO: Record<
  LegacyGPTImageAspectRatioKey,
  string
> = {
  '1x1': '1024x1024',
  '2x3': '1024x1536',
  '3x2': '1536x1024',
};

const LEGACY_GPT_IMAGE_SIZES = new Set(
  Object.values(LEGACY_GPT_IMAGE_SIZE_BY_RATIO).concat('auto')
);
const GPT_IMAGE_25_SIZES = new Set(
  Object.values(LEGACY_GPT_IMAGE_SIZE_BY_RATIO)
);
const OFFICIAL_GPT_IMAGE_EDIT_SIZES = new Set([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
]);

const KNOWN_GPT_IMAGE_RATIOS = new Set<GPTImageAspectRatioKey>([
  '1x1',
  '2x3',
  '3x2',
  '3x4',
  '4x3',
  '4x5',
  '5x4',
  '9x16',
  '16x9',
  '21x9',
]);

function getNormalizedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : undefined;
}

function parsePixelSize(
  value: string
): { width: number; height: number } | undefined {
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return undefined;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !width || !height) {
    return undefined;
  }

  return { width, height };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function isPixelSize(value: string): boolean {
  const parsed = parsePixelSize(value);
  return !!parsed && (parsed.width > 32 || parsed.height > 32);
}

function resolveKnownAspectRatio(
  size?: string
): GPTImageAspectRatioKey | undefined {
  const normalized = size?.trim().toLowerCase().replace(':', 'x');
  if (!normalized || normalized === 'auto') {
    return undefined;
  }

  if (KNOWN_GPT_IMAGE_RATIOS.has(normalized as GPTImageAspectRatioKey)) {
    return normalized as GPTImageAspectRatioKey;
  }

  const parsed = parsePixelSize(normalized);
  if (!parsed) {
    return undefined;
  }

  const divisor = gcd(parsed.width, parsed.height);
  const ratioKey = `${parsed.width / divisor}x${parsed.height / divisor}`;
  if (KNOWN_GPT_IMAGE_RATIOS.has(ratioKey as GPTImageAspectRatioKey)) {
    return ratioKey as GPTImageAspectRatioKey;
  }

  return undefined;
}

function isValidGPTImage2PixelSize(width: number, height: number): boolean {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const totalPixels = width * height;

  if (longEdge > 3840) {
    return false;
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return false;
  }
  if (shortEdge === 0 || longEdge / shortEdge > 3) {
    return false;
  }
  return totalPixels >= 655_360 && totalPixels <= 8_294_400;
}

function toLegacyAspectRatio(
  aspectRatio: GPTImageAspectRatioKey
): LegacyGPTImageAspectRatioKey {
  if (aspectRatio === '1x1') {
    return '1x1';
  }

  const portraitRatios = new Set<GPTImageAspectRatioKey>([
    '2x3',
    '3x4',
    '4x5',
    '9x16',
  ]);

  return portraitRatios.has(aspectRatio) ? '2x3' : '3x2';
}

export function isGPTImage2Model(modelId?: string | null): boolean {
  return (
    typeof modelId === 'string' &&
    GPT_IMAGE_2_MODEL_ID_SET.has(modelId.trim().toLowerCase())
  );
}

function isGPTImage25Model(modelId?: string | null): boolean {
  return (
    typeof modelId === 'string' &&
    GPT_IMAGE_25_MODEL_ID_SET.has(modelId.trim().toLowerCase())
  );
}

export function isLegacyGPTImageModel(modelId?: string | null): boolean {
  return !!modelId && LEGACY_GPT_IMAGE_MODEL_IDS.has(modelId);
}

export function normalizeImageResolutionTier(
  value: unknown
): ImageResolutionTier | undefined {
  const normalized = getNormalizedString(value);
  if (
    normalized &&
    LEGACY_RESOLUTION_VALUES.has(normalized as ImageResolutionTier)
  ) {
    return normalized as ImageResolutionTier;
  }
  return undefined;
}

export function resolveImageResolutionTier(
  params?: Record<string, unknown>
): ImageResolutionTier | undefined {
  if (params?.resolution !== undefined && !normalizeImageResolutionTier(params.resolution)) {
    throw new Error('当前图片模型的分辨率必须为 1K、2K 或 4K。');
  }
  return (
    normalizeImageResolutionTier(params?.resolution) ||
    normalizeImageResolutionTier(params?.quality)
  );
}

export function normalizeOfficialGPTImageQuality(
  value: unknown
): OfficialGPTImageQuality | undefined {
  const normalized = getNormalizedString(value);
  if (
    normalized &&
    OFFICIAL_GPT_IMAGE_QUALITY_VALUES.has(normalized as OfficialGPTImageQuality)
  ) {
    return normalized as OfficialGPTImageQuality;
  }
  return undefined;
}

export function resolveOfficialGPTImageQuality(
  params?: Record<string, unknown>,
  modelId?: string
): OfficialGPTImageQuality | undefined {
  const quality = normalizeOfficialGPTImageQuality(params?.quality);
  if (quality !== 'xhigh' && quality !== 'max') {
    return quality;
  }

  return modelId &&
    EXTENDED_GPT_IMAGE_QUALITY_MODEL_IDS.has(modelId.trim().toLowerCase())
    ? quality
    : undefined;
}

export function resolveOfficialGPTImageSize(
  modelId: string | undefined,
  size?: string,
  params?: Record<string, unknown>
): string | undefined {
  const normalizedSize = size?.trim().toLowerCase().replace(':', 'x');
  const requestedResolution = resolveImageResolutionTier(params);
  const useLegacySizing = isLegacyGPTImageModel(modelId);
  const useGPTImage25Sizing = isGPTImage25Model(modelId);

  // Keep model capability validation even when the aspect ratio is automatic.
  if (
    (useLegacySizing || useGPTImage25Sizing) &&
    requestedResolution &&
    requestedResolution !== '1k'
  ) {
    throw new Error('当前 GPT Image 模型不支持所选分辨率，请选择 1K 或更换模型。');
  }

  if (!normalizedSize || normalizedSize === 'auto') {
    if (requestedResolution && requestedResolution !== '1k') {
      throw new Error(
        'GPT Image 选择 2K/4K 时必须明确图片比例或提供参考图，避免分辨率档位被上游忽略。'
      );
    }
    return undefined;
  }

  const parsedPixelSize = parsePixelSize(normalizedSize);

  if (parsedPixelSize && isPixelSize(normalizedSize)) {
    if (useGPTImage25Sizing) {
      return GPT_IMAGE_25_SIZES.has(normalizedSize)
        ? normalizedSize
        : undefined;
    } else if (isGPTImage2Model(modelId)) {
      if (
        isValidGPTImage2PixelSize(parsedPixelSize.width, parsedPixelSize.height)
      ) {
        if (!requestedResolution) return normalizedSize;
      }
    } else if (useLegacySizing && LEGACY_GPT_IMAGE_SIZES.has(normalizedSize)) {
      return normalizedSize;
    }
  }

  const aspectRatio = resolveKnownAspectRatio(normalizedSize);
  if (!aspectRatio) {
    if (parsedPixelSize && !useLegacySizing && !useGPTImage25Sizing) {
      return scaleGPTImageSize(parsedPixelSize.width, parsedPixelSize.height, requestedResolution || '1k');
    }
    throw new Error('图片尺寸或比例不受当前 GPT Image 模型支持。');
  }

  if (useLegacySizing || useGPTImage25Sizing) {
    return LEGACY_GPT_IMAGE_SIZE_BY_RATIO[toLegacyAspectRatio(aspectRatio)];
  }

  const resolution = requestedResolution || '1k';
  return GPT_IMAGE_2_SIZE_MATRIX[resolution][aspectRatio];
}

function scaleGPTImageSize(width: number, height: number, tier: ImageResolutionTier): string {
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio > 3 || ratio < 1 / 3) {
    throw new Error('GPT Image 图片的长短边比例不能超过 3:1。');
  }
  const pixels = { '1k': 1_048_576, '2k': 4_194_304, '4k': 8_294_400 }[tier];
  const scale = Math.min(Math.sqrt(pixels / (width * height)), 3840 / Math.max(width, height));
  let w = Math.max(16, Math.floor(width * scale / 16) * 16);
  let h = Math.max(16, Math.floor(height * scale / 16) * 16);
  // Grid rounding must not cross the provider's aspect-ratio boundary.
  if (w > h * 3) w = h * 3;
  if (h > w * 3) h = w * 3;
  if (!isValidGPTImage2PixelSize(w, h)) throw new Error('无法为所选比例生成有效的 GPT Image 尺寸。');
  return `${w}x${h}`;
}

export function resolveOfficialGPTImageEditSize(
  modelId: string | undefined,
  size?: string,
  params?: Record<string, unknown>
): string | undefined {
  if (isGPTImage2Model(modelId) || isGPTImage25Model(modelId)) {
    return resolveOfficialGPTImageSize(modelId, size, params);
  }

  const tier = resolveImageResolutionTier(params);
  if (tier && tier !== '1k') throw new Error('当前 GPT Image 编辑模型不支持所选分辨率。');

  const normalizedSize = size?.trim().toLowerCase().replace(':', 'x');
  if (!normalizedSize || normalizedSize === 'auto') {
    return undefined;
  }

  if (OFFICIAL_GPT_IMAGE_EDIT_SIZES.has(normalizedSize)) {
    return normalizedSize;
  }

  const parsedPixelSize = parsePixelSize(normalizedSize);
  if (parsedPixelSize) {
    if (parsedPixelSize.width === parsedPixelSize.height) {
      return '1024x1024';
    }

    return parsedPixelSize.width > parsedPixelSize.height
      ? '1536x1024'
      : '1024x1536';
  }

  const aspectRatio = resolveKnownAspectRatio(normalizedSize);
  if (!aspectRatio) {
    return undefined;
  }

  if (aspectRatio === '1x1') {
    return '1024x1024';
  }

  const portraitRatios = new Set<GPTImageAspectRatioKey>([
    '2x3',
    '3x4',
    '4x5',
    '9x16',
  ]);

  return portraitRatios.has(aspectRatio) ? '1024x1536' : '1536x1024';
}
