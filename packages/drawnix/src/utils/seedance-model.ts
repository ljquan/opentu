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

export const SEEDANCE_25_RATIOS = ['16:9', '9:16', '1:1'] as const;

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
