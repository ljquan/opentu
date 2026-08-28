export const SEEDANCE_25_MODEL_ID = 'doubao-seedance-2-5-260628';

const SEEDANCE_20_MODEL_PREFIX = 'doubao-seedance-2-0-';

export const SEEDANCE_20_RATIOS = [
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
  'adaptive',
] as const;

export const SEEDANCE_25_RATIOS = [
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
  'adaptive',
] as const;

export const SEEDANCE_2_RESOLUTIONS = ['480p', '720p', '1080p'] as const;

export interface Seedance2Capabilities {
  minDuration: number;
  maxDuration: number;
  defaultDuration: number;
  ratios: readonly string[];
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxReferenceAudios: number;
  supportsAdvancedControls: boolean;
}

const SEEDANCE_20_CAPABILITIES: Seedance2Capabilities = {
  minDuration: 4,
  maxDuration: 12,
  defaultDuration: 5,
  ratios: SEEDANCE_20_RATIOS,
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  maxReferenceAudios: 3,
  supportsAdvancedControls: true,
};

const SEEDANCE_25_CAPABILITIES: Seedance2Capabilities = {
  minDuration: 4,
  maxDuration: 30,
  defaultDuration: 8,
  ratios: SEEDANCE_25_RATIOS,
  maxReferenceImages: 30,
  maxReferenceVideos: 10,
  maxReferenceAudios: 10,
  supportsAdvancedControls: false,
};

export function isSeedance20ModelId(modelId?: string | null): boolean {
  return modelId?.toLowerCase().startsWith(SEEDANCE_20_MODEL_PREFIX) ?? false;
}

export function isSeedance25ModelId(modelId?: string | null): boolean {
  return modelId?.toLowerCase() === SEEDANCE_25_MODEL_ID;
}

export function isSeedance2ModelId(modelId?: string | null): boolean {
  return isSeedance20ModelId(modelId) || isSeedance25ModelId(modelId);
}

/** Normalize UI and legacy aspect-ratio spellings to the provider contract. */
export function normalizeSeedanceRatio(value?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto') return 'adaptive';

  const dimensions = normalized.match(/^(\d+)\s*[x:]\s*(\d+)$/);
  if (!dimensions) return normalized;

  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return normalized;
  }

  const gcd = (left: number, right: number): number =>
    right === 0 ? left : gcd(right, left % right);
  const divisor = gcd(width, height);
  const reducedWidth = width / divisor;
  const reducedHeight = height / divisor;

  for (const ratio of SEEDANCE_20_RATIOS) {
    if (ratio === 'adaptive') continue;
    const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
    const ratioDivisor = gcd(ratioWidth, ratioHeight);
    if (
      reducedWidth === ratioWidth / ratioDivisor &&
      reducedHeight === ratioHeight / ratioDivisor
    ) {
      return ratio;
    }
  }

  if (width >= 100 || height >= 100) {
    const numericRatio = width / height;
    return SEEDANCE_20_RATIOS.filter(
      (ratio) => ratio !== 'adaptive'
    ).reduce((closest, ratio) => {
      const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
      const [closestWidth, closestHeight] = closest.split(':').map(Number);
      return Math.abs(numericRatio - ratioWidth / ratioHeight) <
        Math.abs(numericRatio - closestWidth / closestHeight)
        ? ratio
        : closest;
    }, '16:9');
  }

  return `${dimensions[1]}:${dimensions[2]}`;
}

export function getSeedance2Capabilities(
  modelId?: string | null
): Seedance2Capabilities | null {
  if (isSeedance25ModelId(modelId)) return SEEDANCE_25_CAPABILITIES;
  if (isSeedance20ModelId(modelId)) return SEEDANCE_20_CAPABILITIES;
  return null;
}

export function getSeedance2Label(modelId?: string | null): string {
  return isSeedance25ModelId(modelId) ? 'Seedance 2.5' : 'Seedance 2.0';
}
