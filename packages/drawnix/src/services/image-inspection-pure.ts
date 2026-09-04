import {
  getCompatibleParams,
  type ModelConfig,
} from '../constants/model-config';
import {
  isGPTImage2Model,
  resolveOfficialGPTImageSize,
} from './model-adapters/image-size-quality-resolver';

export type ImageInspectionResolution = '1k' | '2k' | '4k' | 'hd' | null;
export type ImageInspectionValidationStatus = 'passed' | 'failed' | 'warning';

export interface ImageInspectionTarget {
  profileId: string;
  profileName: string;
  model: ModelConfig;
}

export interface ImageInspectionProfileModels {
  profileId: string;
  profileName: string;
  enabled: boolean;
  models: ModelConfig[];
}

export interface ImageInspectionCase {
  id: string;
  profileId: string;
  profileName: string;
  modelId: string;
  modelLabel: string;
  selectionKey: string;
  requestedAspectRatio: string;
  requestedResolution: ImageInspectionResolution;
  resolutionParamId: 'resolution' | 'quality' | null;
  expectedSize: string | null;
  expectedWidth: number | null;
  expectedHeight: number | null;
}

export interface ParsedImageDimensions {
  width: number;
  height: number;
  pixels: number;
  encodedWidth?: string;
  encodedHeight?: string;
}

export interface ImageInspectionValidation {
  status: ImageInspectionValidationStatus;
  message: string;
}

export interface ImageInspectionDimensionSources {
  response: ParsedImageDimensions | null;
  natural: ParsedImageDimensions | null;
  url: ParsedImageDimensions | null;
}

export interface ImageInspectionDimensionValidation {
  dimensions: ParsedImageDimensions | null;
  validation: ImageInspectionValidation;
}

export interface ImageInspectionResolutionParams {
  resolution?: Exclude<ImageInspectionResolution, 'hd' | null>;
  quality?: Exclude<ImageInspectionResolution, 'hd' | null>;
}

export interface ImageInspectionResultPage {
  totalPages: number;
  pageFromLatest: number;
  start: number;
  end: number;
}

export type ImageInspectionAutoRunAction =
  | 'idle'
  | 'wait'
  | 'discover'
  | 'start'
  | 'focus-running'
  | 'unavailable';

export interface ImageInspectionAutoRunState {
  token?: number;
  handledToken: number | null;
  discoveryToken: number | null;
  discoveryAttemptedToken: number | null;
  ready: boolean;
  targetCount: number;
  plannedCount: number;
  canDiscover: boolean;
  hasRunningSession: boolean;
}

export function resolveImageInspectionAutoRunAction({
  token,
  handledToken,
  discoveryToken,
  discoveryAttemptedToken,
  ready,
  targetCount,
  plannedCount,
  canDiscover,
  hasRunningSession,
}: ImageInspectionAutoRunState): ImageInspectionAutoRunAction {
  if (!token || handledToken === token) return 'idle';
  if (!ready || discoveryToken !== null) return 'wait';
  if (hasRunningSession) return 'focus-running';
  if (canDiscover && discoveryAttemptedToken !== token) return 'discover';
  if (targetCount > 0 && plannedCount > 0) {
    return 'start';
  }
  return 'unavailable';
}

export function resolveImageInspectionResultPage(
  totalResults: number,
  requestedPageFromLatest: number,
  pageSize: number
): ImageInspectionResultPage {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const safeTotal = Math.max(0, Math.floor(totalResults));
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const pageFromLatest = Math.min(
    Math.max(0, Math.floor(requestedPageFromLatest)),
    totalPages - 1
  );
  const end = Math.max(0, safeTotal - pageFromLatest * safePageSize);
  return {
    totalPages,
    pageFromLatest,
    start: Math.max(0, end - safePageSize),
    end,
  };
}

const URL_DIMENSION_PATTERN = /-([0-9a-t]+)x([0-9a-t]+)-/i;
const MAX_IMAGE_DIMENSION = 16384;
const GPT_IMAGE_2_ASPECT_RATIOS = [
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
];
const GEMINI_ASPECT_RATIOS = [
  '1x1',
  '16x9',
  '9x16',
  '3x2',
  '2x3',
  '4x3',
  '3x4',
  '5x4',
  '4x5',
  '21x9',
];
const GEMINI_FLASH_31_EXTRA_ASPECT_RATIOS = ['1x4', '4x1', '1x8', '8x1'];
export const IMAGE_INSPECTION_MODEL_IDS = Object.freeze([
  'gpt-image-2-vip',
  'gpt-image-2',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-3-pro-image-preview-2k-vip',
  'gemini-3-pro-image-preview-4k-vip',
  'gemini-3.1-flash-image-preview-4k',
  'gemini-3.1-flash-image-preview-2k',
  'gemini-3-pro-image-preview-4k-async',
]);
const IMAGE_INSPECTION_MODEL_ID_SET = new Set<string>(
  IMAGE_INSPECTION_MODEL_IDS
);
const RESOLUTION_LONG_EDGE_RANGES: Record<
  Exclude<ImageInspectionResolution, null>,
  { min: number; maxExclusive: number | null }
> = {
  '1k': { min: 900, maxExclusive: 1900 },
  '2k': { min: 1900, maxExclusive: 3500 },
  '4k': { min: 3500, maxExclusive: null },
  hd: { min: 1400, maxExclusive: null },
};

export function isImageInspectionModel(model: ModelConfig): boolean {
  return model.type === 'image' && IMAGE_INSPECTION_MODEL_ID_SET.has(model.id);
}

export function collectImageInspectionTargets(
  profiles: ImageInspectionProfileModels[]
): ImageInspectionTarget[] {
  return profiles.flatMap(({ profileId, profileName, enabled, models }) => {
    if (!enabled) return [];
    const unique = new Map(
      models
        .filter(isImageInspectionModel)
        .map((model) => [model.id, model] as const)
    );
    return Array.from(unique.values()).map((model) => ({
      profileId,
      profileName,
      model,
    }));
  });
}

export function inferFixedImageResolution(
  modelId: string
): ImageInspectionResolution {
  const normalized = modelId.toLowerCase();
  if (normalized.includes('4k')) return '4k';
  if (normalized.includes('2k')) return '2k';
  if (normalized.includes('1k')) return '1k';
  if (/(?:^|[-_])hd(?:[-_]|$)/.test(normalized)) return 'hd';
  if (/^nbp-async$/.test(normalized)) return '1k';
  if (
    /^(?:nano-banana|nano-banana-vip|nano-banana-pro-vip)$/.test(normalized)
  ) {
    return '1k';
  }
  return null;
}

function getEnumValues(modelId: string, paramId: string): string[] {
  const param = getCompatibleParams(modelId).find(
    (item) => item.id === paramId
  );
  return (param?.options || []).map((item) => item.value.toLowerCase());
}

function normalizeAspectRatios(modelId: string): string[] {
  const configured = getEnumValues(modelId, 'size').filter(
    (value) => value !== 'auto' && /^\d+x\d+$/.test(value)
  );
  if (configured.length) return Array.from(new Set(configured));
  if (isGPTImage2Model(modelId)) return GPT_IMAGE_2_ASPECT_RATIOS;
  if (/gemini-3\.1-flash-image/i.test(modelId)) {
    return [
      '1x1',
      ...GEMINI_FLASH_31_EXTRA_ASPECT_RATIOS,
      ...GEMINI_ASPECT_RATIOS.slice(1),
    ];
  }
  return GEMINI_ASPECT_RATIOS;
}

function resolveResolutionConfig(modelId: string): {
  values: ImageInspectionResolution[];
  paramId: 'resolution' | 'quality' | null;
} {
  if (isGPTImage2Model(modelId)) {
    return { values: ['1k', '2k', '4k'], paramId: 'resolution' };
  }
  const normalizedModelId = modelId.toLowerCase();
  const fixed = inferFixedImageResolution(modelId);
  if (fixed) return { values: [fixed], paramId: null };
  const resolutionValues = getEnumValues(modelId, 'resolution').filter(
    (value) => /^(1k|2k|4k|hd)$/.test(value)
  );
  if (resolutionValues.length) {
    return {
      values: Array.from(
        new Set(resolutionValues)
      ) as ImageInspectionResolution[],
      paramId: 'resolution',
    };
  }
  const qualityValues = getEnumValues(modelId, 'quality').filter((value) =>
    /^(1k|2k|4k|hd)$/.test(value)
  );
  if (qualityValues.length) {
    return {
      values: Array.from(new Set(qualityValues)) as ImageInspectionResolution[],
      paramId: 'quality',
    };
  }
  return /gemini|nano[\s_-]?banana|(?:^|[-_])nbp(?:[-_]|$)/i.test(
    normalizedModelId
  )
    ? { values: ['1k', '2k', '4k'], paramId: 'quality' }
    : { values: [null], paramId: null };
}

function describeExpectedSize(
  modelId: string,
  ratio: string,
  resolution: ImageInspectionResolution
): { label: string | null; width: number | null; height: number | null } {
  if (isGPTImage2Model(modelId) && resolution && resolution !== 'hd') {
    const size = resolveOfficialGPTImageSize(modelId, ratio, {
      resolution,
    });
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
      label: size || null,
      width: match ? Number(match[1]) : null,
      height: match ? Number(match[2]) : null,
    };
  }
  if (!resolution) return { label: null, width: null, height: null };
  const range = RESOLUTION_LONG_EDGE_RANGES[resolution];
  const upper = range.maxExclusive ? `–${range.maxExclusive - 1}px` : '以上';
  return {
    label: `长边 ${range.min}px${upper}`,
    width: null,
    height: null,
  };
}

export function buildImageInspectionCases(
  targets: ImageInspectionTarget[]
): ImageInspectionCase[] {
  return targets.flatMap(({ profileId, profileName, model }) => {
    if (!isImageInspectionModel(model)) return [];
    const ratios = normalizeAspectRatios(model.id);
    const resolutionConfig = resolveResolutionConfig(model.id);
    return (ratios.length ? ratios : ['auto']).flatMap((ratio) =>
      resolutionConfig.values.map((resolution) => {
        const expected = describeExpectedSize(model.id, ratio, resolution);
        return {
          id: `${profileId}::${model.id}::${ratio}::${resolution || 'default'}`,
          profileId,
          profileName,
          modelId: model.id,
          modelLabel: model.shortLabel || model.label || model.id,
          selectionKey: `${profileId}::${model.id}`,
          requestedAspectRatio: ratio,
          requestedResolution: resolution,
          resolutionParamId: resolutionConfig.paramId,
          expectedSize: expected.label,
          expectedWidth: expected.width,
          expectedHeight: expected.height,
        };
      })
    );
  });
}

export function resolveImageInspectionResolutionParams(
  inspectionCase: Pick<
    ImageInspectionCase,
    'requestedResolution' | 'resolutionParamId'
  >
): ImageInspectionResolutionParams {
  const requestedResolution =
    inspectionCase.requestedResolution === 'hd'
      ? undefined
      : inspectionCase.requestedResolution || undefined;
  if (inspectionCase.resolutionParamId === 'resolution') {
    return { resolution: requestedResolution };
  }
  if (inspectionCase.resolutionParamId === 'quality') {
    return { quality: requestedResolution };
  }
  return {};
}

export function parseImageDimensionsFromUrl(
  url?: string | null
): ParsedImageDimensions | null {
  if (!url || url.startsWith('data:')) return null;
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // 非标准 URL 继续按原始字符串解析尺寸编码。
  }
  const match = pathname.match(URL_DIMENSION_PATTERN);
  if (!match) return null;
  const width = Number.parseInt(match[1], 30);
  const height = Number.parseInt(match[2], 30);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION
  ) {
    return null;
  }
  return {
    encodedWidth: match[1],
    encodedHeight: match[2],
    width,
    height,
    pixels: width * height,
  };
}

export function formatImageInspectionFormula(
  urlDimensions: ParsedImageDimensions | null,
  naturalDimensions: ParsedImageDimensions | null
): string {
  if (urlDimensions?.encodedWidth && urlDimensions.encodedHeight) {
    return `parseInt("${urlDimensions.encodedWidth}", 30) × parseInt("${
      urlDimensions.encodedHeight
    }", 30)\n= ${urlDimensions.width} × ${
      urlDimensions.height
    }\n= ${urlDimensions.pixels.toLocaleString('en-US')} px`;
  }
  if (naturalDimensions) {
    return `URL 未携带可识别的 base-30 尺寸编码\n实际图片：${
      naturalDimensions.width
    } × ${
      naturalDimensions.height
    }\n= ${naturalDimensions.pixels.toLocaleString('en-US')} px`;
  }
  return 'URL 未携带可识别的 base-30 尺寸编码，且无法读取实际图片尺寸';
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function ratioMatchesExactly(
  width: number,
  height: number,
  ratio: string
): boolean | null {
  const match = ratio.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  const expectedWidth = Number(match[1]);
  const expectedHeight = Number(match[2]);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    expectedWidth <= 0 ||
    expectedHeight <= 0
  ) {
    return false;
  }
  const divisor = greatestCommonDivisor(width, height);
  const expectedDivisor = greatestCommonDivisor(
    expectedWidth,
    expectedHeight
  );
  return (
    width / divisor === expectedWidth / expectedDivisor &&
    height / divisor === expectedHeight / expectedDivisor
  );
}

function ratioMatches(
  width: number,
  height: number,
  ratio: string
): boolean | null {
  const match = ratio.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  const expected = Number(match[1]) / Number(match[2]);
  return Math.abs(width / height - expected) / expected <= 0.025;
}

function isDefaultGPTImage2RatioOnlyCase(
  inspectionCase: ImageInspectionCase
): boolean {
  return (
    inspectionCase.profileId === 'default' &&
    (inspectionCase.modelId === 'gpt-image-2' ||
      inspectionCase.modelId === 'gpt-image-2-vip')
  );
}

export function validateImageInspectionDimensions(
  inspectionCase: ImageInspectionCase,
  dimensions: ParsedImageDimensions | null
): ImageInspectionValidation {
  if (!dimensions) {
    return { status: 'warning', message: '生成成功，但无法读取图片尺寸' };
  }
  if (isDefaultGPTImage2RatioOnlyCase(inspectionCase)) {
    const ratioPassed = ratioMatchesExactly(
      dimensions.width,
      dimensions.height,
      inspectionCase.requestedAspectRatio
    );
    return ratioPassed === false
      ? {
          status: 'failed',
          message: `实际尺寸 ${dimensions.width}×${dimensions.height} 约分后不等于请求比例 ${inspectionCase.requestedAspectRatio.replace('x', ':')}`,
        }
      : {
          status: 'passed',
          message: `default 分组 Image 2 仅校验比例：实际尺寸 ${dimensions.width}×${dimensions.height} 精确约分为 ${inspectionCase.requestedAspectRatio.replace('x', ':')}`,
        };
  }
  if (inspectionCase.expectedWidth && inspectionCase.expectedHeight) {
    return dimensions.width === inspectionCase.expectedWidth &&
      dimensions.height === inspectionCase.expectedHeight
      ? { status: 'passed', message: '尺寸与比例校验通过' }
      : {
          status: 'failed',
          message: `实际尺寸 ${dimensions.width}×${dimensions.height} != 期望 ${inspectionCase.expectedWidth}×${inspectionCase.expectedHeight}`,
        };
  }
  const errors: string[] = [];
  if (inspectionCase.requestedAspectRatio !== 'auto') {
    if (
      ratioMatches(
        dimensions.width,
        dimensions.height,
        inspectionCase.requestedAspectRatio
      ) === false
    ) {
      errors.push(
        `实际尺寸 ${dimensions.width}×${
          dimensions.height
        } 不符合比例 ${inspectionCase.requestedAspectRatio.replace('x', ':')}`
      );
    }
  }
  const resolution = inspectionCase.requestedResolution;
  if (resolution) {
    const range = RESOLUTION_LONG_EDGE_RANGES[resolution];
    const longEdge = Math.max(dimensions.width, dimensions.height);
    if (longEdge < range.min) {
      errors.push(
        `实际长边 ${longEdge}px 未达到 ${resolution.toUpperCase()} 最低 ${
          range.min
        }px`
      );
    } else if (range.maxExclusive && longEdge >= range.maxExclusive) {
      errors.push(
        `实际长边 ${longEdge}px 超出 ${resolution.toUpperCase()} 档位上限 ${
          range.maxExclusive - 1
        }px`
      );
    }
  }
  return errors.length
    ? { status: 'failed', message: errors.join('；') }
    : { status: 'passed', message: '尺寸与比例校验通过' };
}

export function validateImageInspectionDimensionSources(
  inspectionCase: ImageInspectionCase,
  sources: ImageInspectionDimensionSources
): ImageInspectionDimensionValidation {
  const dimensions = sources.natural || sources.response || sources.url;
  const validation = validateImageInspectionDimensions(
    inspectionCase,
    dimensions
  );
  const availableSources: Array<
    readonly [string, ParsedImageDimensions | null]
  > = [
    ['实际图片', sources.natural],
    ['任务元数据', sources.response],
    ['URL 编码', sources.url],
  ];
  const available = availableSources.filter(
    (item): item is readonly [string, ParsedImageDimensions] => !!item[1]
  );
  const uniqueSizes = new Set(
    available.map(([, item]) => `${item.width}x${item.height}`)
  );
  if (uniqueSizes.size <= 1) {
    return { dimensions, validation };
  }
  const sourceSummary = available
    .map(([label, item]) => `${label} ${item.width}×${item.height}`)
    .join('，');
  return {
    dimensions,
    validation: {
      status: 'failed',
      message: `尺寸来源冲突：${sourceSummary}；${validation.message}`,
    },
  };
}
