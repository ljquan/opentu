import type {
  LayerArtifact,
  LayerBoundingBox,
  LayerBoundingBoxTuple,
  LayerDecompositionRequest,
  LayerDecompositionRequestPayload,
  LayerDecompositionResponse,
} from './types';

export const MAX_DECOMPOSITION_FOREGROUND_LAYERS = 16;
export const DEFAULT_DECOMPOSITION_FOREGROUND_LAYERS = 16;
export const MAX_DECOMPOSITION_PROMPT_LENGTH = 4_096;

const MAX_GROUP_ID_LENGTH = 128;
const MAX_LAYER_NAME_LENGTH = 128;
const MAX_LAYER_DESCRIPTION_LENGTH = 1_000;
const NORMALIZED_BOUNDING_BOX_MAX = 1_000;
const DATA_IMAGE_PATTERN =
  /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;
const NORMALIZED_BBOX_PROMPT_PATTERN =
  /<bbox>\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*<\/bbox>/gi;

function invalid(path: string, message: string): never {
  throw new Error(`Invalid layer decomposition ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(path, 'expected an object');
  return value;
}

function requireString(
  value: unknown,
  path: string,
  maxLength: number,
  allowEmpty = false
): string {
  if (typeof value !== 'string') invalid(path, 'expected a string');
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0)
    invalid(path, 'must not be empty');
  if (normalized.length > maxLength) {
    invalid(path, `must not exceed ${maxLength} characters`);
  }
  return normalized;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(path, 'expected a finite number');
  }
  return value;
}

function isImageLocation(value: string): boolean {
  const dataMatch = DATA_IMAGE_PATTERN.exec(value);
  if (dataMatch) {
    return dataMatch[2].length % 4 === 0;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function isRequestImageSource(value: string): boolean {
  if (isImageLocation(value)) return true;
  if (/^blob:/i.test(value)) {
    try {
      return new URL(value).protocol === 'blob:';
    } catch {
      return false;
    }
  }
  return /^(?:\/(?!\/)|\.\.?\/)/.test(value);
}

function requireImageLocation(value: unknown, path: string): string {
  const location = requireString(value, path, Number.MAX_SAFE_INTEGER);
  if (!isImageLocation(location) && !/^\/(?!\/)/.test(location)) {
    invalid(path, 'expected an HTTP(S), same-origin, or image data URL');
  }
  return location;
}

function requireRequestImageSource(value: unknown, path: string): string {
  const source = requireString(value, path, Number.MAX_SAFE_INTEGER);
  if (!isRequestImageSource(source)) {
    invalid(path, 'expected an HTTP(S), blob, local, or image data URL');
  }
  return source;
}

function parseBoundingBoxTuple(
  value: unknown,
  path: string,
  max?: number
): LayerBoundingBoxTuple {
  if (!Array.isArray(value) || value.length !== 4) {
    invalid(path, 'expected [x1, y1, x2, y2]');
  }
  const tuple = value.map((coordinate, index) =>
    requireFiniteNumber(coordinate, `${path}[${index}]`)
  ) as LayerBoundingBoxTuple;
  const [x1, y1, x2, y2] = tuple;
  if (x1 < 0 || y1 < 0 || x2 <= x1 || y2 <= y1) {
    invalid(
      path,
      'must describe a positive rectangle with non-negative origin'
    );
  }
  if (max !== undefined && tuple.some((coordinate) => coordinate > max)) {
    invalid(path, `coordinates must be within 0..${max}`);
  }
  return tuple;
}

function parseBoundingBox(value: unknown, path: string): LayerBoundingBox {
  const box = requireRecord(value, path);
  return {
    absolute: parseBoundingBoxTuple(box.absolute, `${path}.absolute`),
    normalized: parseBoundingBoxTuple(
      box.normalized,
      `${path}.normalized`,
      NORMALIZED_BOUNDING_BOX_MAX
    ),
  };
}

function validatePromptBoundingBoxes(prompt: string): void {
  NORMALIZED_BBOX_PROMPT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let stripped = prompt;
  while ((match = NORMALIZED_BBOX_PROMPT_PATTERN.exec(prompt)) !== null) {
    parseBoundingBoxTuple(
      match.slice(1, 5).map(Number),
      'request.prompt bbox',
      NORMALIZED_BOUNDING_BOX_MAX
    );
    stripped = stripped.replace(match[0], '');
  }
  if (/<\/?bbox\b/i.test(stripped)) {
    invalid('request.prompt', 'contains a malformed <bbox> tag');
  }
}

export function parseLayerDecompositionRequest(
  value: unknown
): LayerDecompositionRequest {
  const request = requireRecord(value, 'request');
  const image = requireRequestImageSource(request.image, 'request.image');
  const maxLayersValue =
    request.max_layers ?? DEFAULT_DECOMPOSITION_FOREGROUND_LAYERS;
  const maxLayers = requireFiniteNumber(maxLayersValue, 'request.max_layers');
  if (
    !Number.isInteger(maxLayers) ||
    maxLayers < 1 ||
    maxLayers > MAX_DECOMPOSITION_FOREGROUND_LAYERS
  ) {
    invalid(
      'request.max_layers',
      `must be an integer within 1..${MAX_DECOMPOSITION_FOREGROUND_LAYERS}`
    );
  }

  const modeValue = request.mode;
  if (
    modeValue !== undefined &&
    modeValue !== 'auto' &&
    modeValue !== 'prompt'
  ) {
    invalid('request.mode', 'must be auto or prompt');
  }
  const result: LayerDecompositionRequest = {
    image,
    maxLayers,
    ...(modeValue === undefined ? {} : { mode: modeValue }),
  };
  if (request.prompt !== undefined) {
    const prompt = requireString(
      request.prompt,
      'request.prompt',
      MAX_DECOMPOSITION_PROMPT_LENGTH
    );
    validatePromptBoundingBoxes(prompt);
    result.prompt = prompt;
  }
  if (result.mode === 'prompt' && !result.prompt) {
    invalid('request.prompt', 'is required when mode is prompt');
  }
  return result;
}

export function toLayerDecompositionRequestPayload(
  request: LayerDecompositionRequest
): LayerDecompositionRequestPayload {
  const validated = parseLayerDecompositionRequest({
    image: request.image,
    prompt: request.prompt,
    mode: request.mode,
    max_layers: request.maxLayers,
  });
  return {
    image: validated.image,
    ...(validated.prompt ? { prompt: validated.prompt } : {}),
    ...(validated.mode ? { mode: validated.mode } : {}),
    max_layers: validated.maxLayers,
  };
}

function parseArtifact(
  value: unknown,
  path: string,
  groupId: string
): LayerArtifact {
  const item = requireRecord(value, path);
  const zIndex = requireFiniteNumber(item.z_index, `${path}.z_index`);
  if (!Number.isSafeInteger(zIndex) || zIndex < 0) {
    invalid(`${path}.z_index`, 'must be a non-negative safe integer');
  }
  const confidence =
    item.confidence === undefined
      ? undefined
      : requireFiniteNumber(item.confidence, `${path}.confidence`);
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    invalid(`${path}.confidence`, 'must be within 0..1');
  }

  return {
    groupId,
    url: requireImageLocation(item.url, `${path}.url`),
    zIndex,
    boundingBox: parseBoundingBox(item.bounding_box, `${path}.bounding_box`),
    name: requireString(item.name, `${path}.name`, MAX_LAYER_NAME_LENGTH),
    description: requireString(
      item.description,
      `${path}.description`,
      MAX_LAYER_DESCRIPTION_LENGTH,
      true
    ),
    ...(confidence === undefined ? {} : { confidence }),
  };
}

export function parseLayerDecompositionResponse(
  value: unknown
): LayerDecompositionResponse {
  const response = requireRecord(value, 'response');
  const groupId = requireString(
    response.group_id,
    'response.group_id',
    MAX_GROUP_ID_LENGTH
  );
  if (!Array.isArray(response.data) || response.data.length === 0) {
    invalid(
      'response.data',
      'must contain one background and foreground layers'
    );
  }

  const artifacts = response.data.map((item, index) =>
    parseArtifact(item, `response.data[${index}]`, groupId)
  );
  const backgrounds = artifacts.filter((artifact) => artifact.zIndex === 0);
  if (backgrounds.length !== 1) {
    invalid('response.data', 'must contain exactly one z_index=0 background');
  }
  const background = backgrounds[0];
  const [normalizedX1, normalizedY1, normalizedX2, normalizedY2] =
    background.boundingBox.normalized;
  if (
    normalizedX1 !== 0 ||
    normalizedY1 !== 0 ||
    normalizedX2 !== NORMALIZED_BOUNDING_BOX_MAX ||
    normalizedY2 !== NORMALIZED_BOUNDING_BOX_MAX
  ) {
    invalid(
      'response.data background.bounding_box.normalized',
      'must cover [0, 0, 1000, 1000]'
    );
  }
  const layers = artifacts.filter((artifact) => artifact.zIndex !== 0);
  if (layers.length > MAX_DECOMPOSITION_FOREGROUND_LAYERS) {
    invalid(
      'response.data',
      `must not contain more than ${MAX_DECOMPOSITION_FOREGROUND_LAYERS} foreground layers`
    );
  }
  const zIndexes = new Set<number>();
  for (const artifact of artifacts) {
    if (zIndexes.has(artifact.zIndex)) {
      invalid('response.data', `contains duplicate z_index=${artifact.zIndex}`);
    }
    zIndexes.add(artifact.zIndex);
  }

  const width =
    response.width === undefined
      ? undefined
      : requireFiniteNumber(response.width, 'response.width');
  const height =
    response.height === undefined
      ? undefined
      : requireFiniteNumber(response.height, 'response.height');
  if (
    (width !== undefined && (!Number.isSafeInteger(width) || width <= 0)) ||
    (height !== undefined && (!Number.isSafeInteger(height) || height <= 0))
  ) {
    invalid(
      'response dimensions',
      'width and height must be positive integers'
    );
  }
  const qualityRecord =
    response.quality === undefined
      ? undefined
      : requireRecord(response.quality, 'response.quality');
  const ssim =
    qualityRecord?.ssim === undefined
      ? undefined
      : requireFiniteNumber(qualityRecord.ssim, 'response.quality.ssim');
  const channelErrorRate =
    qualityRecord?.channel_error_rate === undefined &&
    qualityRecord?.channelErrorRate === undefined &&
    qualityRecord?.channel_error_within_one_ratio === undefined
      ? undefined
      : requireFiniteNumber(
          qualityRecord.channel_error_rate ??
            qualityRecord.channelErrorRate ??
            1 - Number(qualityRecord.channel_error_within_one_ratio),
          qualityRecord.channel_error_within_one_ratio !== undefined
            ? 'response.quality.channel_error_within_one_ratio'
            : qualityRecord.channel_error_rate === undefined
            ? 'response.quality.channelErrorRate'
            : 'response.quality.channel_error_rate'
        );
  if (ssim !== undefined && (ssim < 0 || ssim > 1)) {
    invalid('response.quality.ssim', 'must be within 0..1');
  }
  if (
    channelErrorRate !== undefined &&
    (channelErrorRate < 0 || channelErrorRate > 1)
  ) {
    invalid('response.quality.channel_error_rate', 'must be within 0..1');
  }
  const passed =
    qualityRecord?.passed === undefined
      ? undefined
      : qualityRecord.passed === true || qualityRecord.passed === false
      ? qualityRecord.passed
      : invalid('response.quality.passed', 'must be boolean');
  const resultKind = response.result_kind;
  if (
    resultKind !== undefined &&
    resultKind !== 'inference' &&
    resultKind !== 'test'
  ) {
    invalid('response.result_kind', 'must be inference or test');
  }
  const decisions =
    response.decisions === undefined
      ? undefined
      : !Array.isArray(response.decisions)
      ? invalid('response.decisions', 'must be an array of strings')
      : response.decisions.length > 32
      ? invalid('response.decisions', 'must not contain more than 32 decisions')
      : response.decisions.map((decision, index) =>
          requireString(
            decision,
            `response.decisions[${index}]`,
            256,
            false
          )
        );

  return {
    groupId,
    background,
    layers: sortLayerArtifacts(layers),
    ...(resultKind === undefined ? {} : { resultKind }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(qualityRecord === undefined
      ? {}
      : {
          quality: {
            ...(ssim === undefined ? {} : { ssim }),
            ...(channelErrorRate === undefined ? {} : { channelErrorRate }),
            ...(passed === undefined ? {} : { passed }),
          },
        }),
    ...(decisions === undefined ? {} : { decisions }),
  };
}

export function sortLayerArtifacts<T extends Pick<LayerArtifact, 'zIndex'>>(
  artifacts: readonly T[]
): T[] {
  return artifacts
    .map((artifact, inputIndex) => ({ artifact, inputIndex }))
    .sort(
      (left, right) =>
        left.artifact.zIndex - right.artifact.zIndex ||
        left.inputIndex - right.inputIndex
    )
    .map(({ artifact }) => artifact);
}
